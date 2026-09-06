import { describe, expect, it } from "vitest";

import {
  bindPixelSelectionHistory,
  canRedoPixelSelectionHistory,
  canUndoPixelSelectionHistory,
  commitPixelSelectionHistory,
  createPixelSelectionHistory,
  normalizePixelSelection,
  normalizePixelSelectionHistoryLimits,
  normalizePixelSelectionSnapshot,
  readPixelSelectionHistoryCurrent,
  redoPixelSelectionHistory,
  resolvePixelSelectionHistoryShortcut,
  undoPixelSelectionHistory,
  type PixelSelectionHistory,
  type PixelSelectionHistoryOperation,
} from "./studio-pixel-selection-history";
import {
  addSelectionSubpath,
  emptyPixelSelection,
  rectSelectionPolygon,
  removeLastSubpath,
  selectAllPixels,
  setSelectionFeather,
  toggleSelectionInvert,
  translateSelection,
  type PixelSelection,
} from "./studio-selection-tools";

function box(
  x1 = 0.1,
  y1 = 0.1,
  x2 = 0.6,
  y2 = 0.6,
): PixelSelection {
  return addSelectionSubpath(
    null,
    "add",
    rectSelectionPolygon({ x: x1, y: y1 }, { x: x2, y: y2 }),
  )!;
}

function commit(
  history: PixelSelectionHistory,
  selection: PixelSelection | null,
  operation: PixelSelectionHistoryOperation = "other",
  coalesceKey?: string,
): PixelSelectionHistory {
  const result = commitPixelSelectionHistory(history, "image-a", selection, {
    operation,
    coalesceKey,
  });
  expect(result.applied).toBe(true);
  return result.history;
}

describe("pixel selection history — isolated selection commands", () => {
  it("records free/poly lasso, subpath removal, move, feather, invert, select-all and clear independently", () => {
    let history = createPixelSelectionHistory("image-a", null);
    const first = box();
    history = commit(history, first, "free-lasso");

    const withPoly = addSelectionSubpath(
      first,
      "add",
      rectSelectionPolygon({ x: 0.7, y: 0.2 }, { x: 0.9, y: 0.5 }),
    )!;
    history = commit(history, withPoly, "poly-lasso");
    history = commit(history, removeLastSubpath(withPoly), "remove-subpath");
    history = commit(history, translateSelection(first, 0.1, 0.05), "move");
    history = commit(history, setSelectionFeather(translateSelection(first, 0.1, 0.05)!, 12), "feather");
    history = commit(history, toggleSelectionInvert(setSelectionFeather(translateSelection(first, 0.1, 0.05)!, 12)), "invert");
    history = commit(history, selectAllPixels(first), "select-all");
    history = commit(history, null, "clear");

    expect(history.present?.operation).toBe("clear");
    expect(history.present?.selection).toBeNull();
    expect(history.past.map((snapshot) => snapshot.operation)).toEqual([
      "initial",
      "free-lasso",
      "poly-lasso",
      "remove-subpath",
      "move",
      "feather",
      "invert",
      "select-all",
    ]);

    const undoClear = undoPixelSelectionHistory(history, "image-a");
    expect(undoClear).toMatchObject({ applied: true, reason: "undone" });
    expect(undoClear.selection).toEqual(selectAllPixels(first));
    const redoClear = redoPixelSelectionHistory(undoClear.history, "image-a");
    expect(redoClear).toMatchObject({ applied: true, reason: "redone", selection: null });
  });

  it("starts with a clear current state so the first created marquee can be undone to null", () => {
    let history = createPixelSelectionHistory("image-a", null);
    history = commit(history, box(), "marquee");

    const result = undoPixelSelectionHistory(history, "image-a");
    expect(result.selection).toBeNull();
    expect(result.applied).toBe(true);
    expect(canUndoPixelSelectionHistory(result.history, "image-a")).toBe(false);
    expect(canRedoPixelSelectionHistory(result.history, "image-a")).toBe(true);
  });

  it("does not create duplicate steps and a no-op after undo does not discard redo", () => {
    let history = createPixelSelectionHistory("image-a", null);
    history = commit(history, box(), "marquee");
    history = commit(history, setSelectionFeather(box(), 8), "feather");
    const undone = undoPixelSelectionHistory(history, "image-a");

    const duplicate = commitPixelSelectionHistory(
      undone.history,
      "image-a",
      box(),
      { operation: "other" },
    );
    expect(duplicate).toMatchObject({ applied: false, reason: "no-change" });
    expect(duplicate.history).toBe(undone.history);
    expect(canRedoPixelSelectionHistory(duplicate.history, "image-a")).toBe(true);
  });

  it("drops the redo branch after a genuinely new edit", () => {
    let history = createPixelSelectionHistory("image-a", null);
    history = commit(history, box(), "marquee");
    history = commit(history, setSelectionFeather(box(), 8), "feather");
    const undone = undoPixelSelectionHistory(history, "image-a");
    expect(canRedoPixelSelectionHistory(undone.history, "image-a")).toBe(true);

    const branched = commitPixelSelectionHistory(
      undone.history,
      "image-a",
      toggleSelectionInvert(box()),
      { operation: "invert" },
    );
    expect(branched.applied).toBe(true);
    expect(branched.history.future).toEqual([]);
    expect(canRedoPixelSelectionHistory(branched.history, "image-a")).toBe(false);
  });

  it("coalesces consecutive slider edits with the same operation/key into one undo step", () => {
    let history = createPixelSelectionHistory("image-a", box());
    history = commit(history, setSelectionFeather(box(), 4), "feather", "inspector-feather");
    const firstPastLength = history.past.length;
    const second = commitPixelSelectionHistory(
      history,
      "image-a",
      setSelectionFeather(box(), 18),
      { operation: "feather", coalesceKey: "inspector-feather" },
    );
    expect(second).toMatchObject({ applied: true, reason: "coalesced" });
    expect(second.history.past).toHaveLength(firstPastLength);

    const undo = undoPixelSelectionHistory(second.history, "image-a");
    expect(undo.selection?.featherPx).toBe(0);
  });
});

describe("pixel selection history — image ownership", () => {
  it("never commits, reads, undoes or redoes a snapshot for another image", () => {
    let history = createPixelSelectionHistory("image-a", null);
    history = commit(history, box(), "marquee");

    expect(readPixelSelectionHistoryCurrent(history, "image-b")).toBeNull();
    expect(canUndoPixelSelectionHistory(history, "image-b")).toBe(false);
    expect(undoPixelSelectionHistory(history, "image-b")).toMatchObject({
      applied: false,
      reason: "owner-mismatch",
      history,
    });
    expect(redoPixelSelectionHistory(history, "image-b")).toMatchObject({
      applied: false,
      reason: "owner-mismatch",
    });
    expect(commitPixelSelectionHistory(history, "image-b", box(0.2, 0.2, 0.8, 0.8))).toMatchObject({
      applied: false,
      reason: "owner-mismatch",
    });
  });

  it("fails closed when a fabricated timeline contains a snapshot from another owner", () => {
    let history = createPixelSelectionHistory("image-a", null);
    history = commit(history, box(), "marquee");
    const poisoned = {
      ...history,
      ownerElementId: "image-b",
    } as PixelSelectionHistory;

    expect(undoPixelSelectionHistory(poisoned, "image-b")).toMatchObject({
      applied: false,
      reason: "owner-mismatch",
    });
    const rebound = bindPixelSelectionHistory(poisoned, "image-b", null);
    expect(rebound.ownerElementId).toBe("image-b");
    expect(rebound.past).toEqual([]);
    expect(rebound.present?.elementId).toBe("image-b");
  });

  it("binding a different image resets both branches; binding the same image preserves them", () => {
    let history = createPixelSelectionHistory("image-a", null);
    history = commit(history, box(), "marquee");
    expect(bindPixelSelectionHistory(history, "image-a", null)).toBe(history);

    const rebound = bindPixelSelectionHistory(history, "image-b", box(0.2, 0.2, 0.8, 0.8));
    expect(rebound.ownerElementId).toBe("image-b");
    expect(rebound.past).toEqual([]);
    expect(rebound.future).toEqual([]);
    expect(rebound.present?.selection).toEqual(box(0.2, 0.2, 0.8, 0.8));
    expect(canUndoPixelSelectionHistory(rebound, "image-b")).toBe(false);
  });

  it("null/blank element IDs create an unbound fail-closed timeline", () => {
    const history = createPixelSelectionHistory("  ", box());
    expect(history).toMatchObject({ ownerElementId: null, present: null, retainedBytes: 0 });
    expect(commitPixelSelectionHistory(history, null, box())).toMatchObject({
      applied: false,
      reason: "unbound",
    });
    expect(undoPixelSelectionHistory(history, null)).toMatchObject({
      applied: false,
      reason: "unbound",
    });
  });
});

describe("pixel selection history — immutable normalization and resource bounds", () => {
  it("deep-clones/freezes caller data, so later source mutation cannot rewrite history", () => {
    const source = box();
    const history = createPixelSelectionHistory("image-a", source);
    const snapshot = history.present!;
    const savedX = snapshot.selection!.subpaths[0]!.points[0]!.x;

    source.subpaths[0]!.points[0]!.x = 0.99;
    expect(snapshot.selection!.subpaths[0]!.points[0]!.x).toBe(savedX);
    expect(Object.isFrozen(history)).toBe(true);
    expect(Object.isFrozen(history.past)).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.selection)).toBe(true);
    expect(Object.isFrozen(snapshot.selection!.subpaths)).toBe(true);
    expect(Object.isFrozen(snapshot.selection!.subpaths[0]!.points)).toBe(true);
    expect(Object.isFrozen(snapshot.selection!.subpaths[0]!.points[0])).toBe(true);
  });

  it("normalizes malformed numbers/modes/kinds and never invokes accessors", () => {
    let getterCalls = 0;
    const accessorPayload = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorPayload, "subpaths", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return [];
      },
    });
    const accessorResult = normalizePixelSelection(accessorPayload)!;
    expect(getterCalls).toBe(0);
    expect(accessorResult).toEqual(emptyPixelSelection());

    const malformed = normalizePixelSelection({
      featherPx: Number.POSITIVE_INFINITY,
      invert: "yes",
      subpaths: [
        {
          mode: "add",
          points: [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
          ],
        },
        { mode: "unknown", points: [{ x: 0, y: 0 }] },
        { mode: "add", kind: "brush", radius: Number.NaN, points: [{ x: 0.5, y: 0.5 }] },
        { mode: "add", points: [{ x: Number.NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      ],
    })!;
    expect(malformed.featherPx).toBe(0);
    expect(malformed.invert).toBe(false);
    expect(malformed.subpaths).toHaveLength(1);
    expect(malformed.subpaths[0]!.points).toEqual([
      { x: -0.25, y: -0.25 },
      { x: 1.25, y: -0.25 },
      { x: 1.25, y: 1.25 },
    ]);
  });

  it("caps huge subpath/point inputs deterministically and estimates them within one-snapshot budget", () => {
    const points = Array.from({ length: 20_000 }, (_, index) => {
      const angle = (index / 20_000) * Math.PI * 2;
      return { x: 0.5 + Math.cos(angle) * 0.4, y: 0.5 + Math.sin(angle) * 0.4 };
    });
    const limits = normalizePixelSelectionHistoryLimits({
      maxBytes: 32 * 1024,
      maxSubpathsPerSnapshot: 4,
      maxPointsPerSubpath: 24,
      maxPointsPerSnapshot: 24,
    });
    const snapshot = normalizePixelSelectionSnapshot(
      "image-a",
      { subpaths: [{ mode: "add", points }], featherPx: 99, invert: false },
      { limits, operation: "free-lasso" },
    )!;
    expect(snapshot.selection!.subpaths[0]!.points.length).toBeLessThanOrEqual(24);
    expect(snapshot.selection!.featherPx).toBe(60);
    expect(snapshot.estimatedBytes).toBeLessThanOrEqual(limits.maxBytes);
  });

  it("enforces count and retained-byte limits by evicting the oldest undo snapshots", () => {
    let depthBound = createPixelSelectionHistory("image-a", null, { maxEntries: 3 });
    for (let index = 0; index < 8; index += 1) {
      depthBound = commit(
        depthBound,
        box(0.01 * index, 0.05, 0.4 + 0.01 * index, 0.5),
        "move",
      );
    }
    expect(depthBound.past.length + 1 + depthBound.future.length).toBeLessThanOrEqual(3);

    const manyPoints = (phase: number): PixelSelection => ({
      subpaths: [{
        mode: "add",
        points: Array.from({ length: 220 }, (_, index) => {
          const angle = (index / 220) * Math.PI * 2;
          return {
            x: 0.5 + Math.cos(angle + phase) * 0.35,
            y: 0.5 + Math.sin(angle + phase) * 0.35,
          };
        }),
      }],
      featherPx: phase,
      invert: false,
    });
    let memoryBound = createPixelSelectionHistory("image-a", null, {
      maxEntries: 64,
      maxBytes: 32 * 1024,
      maxPointsPerSubpath: 220,
      maxPointsPerSnapshot: 220,
    });
    for (let index = 0; index < 10; index += 1) {
      memoryBound = commit(memoryBound, manyPoints(index), "free-lasso");
    }
    expect(memoryBound.retainedBytes).toBeLessThanOrEqual(memoryBound.limits.maxBytes);
    expect(memoryBound.past.length).toBeLessThan(9);
  });
});

describe("pixel selection history — shortcut routing without document-history collision", () => {
  function historyWithUndoAndRedo(): PixelSelectionHistory {
    let history = createPixelSelectionHistory("image-a", null);
    history = commit(history, box(), "marquee");
    history = commit(history, setSelectionFeather(box(), 8), "feather");
    return undoPixelSelectionHistory(history, "image-a").history;
  }

  it("routes Cmd/Ctrl+Z and Shift+Z/Y only when that selection direction is available", () => {
    const history = historyWithUndoAndRedo();
    const context = {
      history,
      activeElementId: "image-a",
      pixelSelectionContextActive: true,
    };
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true }, context)).toEqual({
      command: "selection-undo",
      preventDefault: true,
      route: "pixel-selection",
    });
    expect(resolvePixelSelectionHistoryShortcut({ code: "KeyZ", ctrlKey: true, shiftKey: true }, context)).toEqual({
      command: "selection-redo",
      preventDefault: true,
      route: "pixel-selection",
    });
    expect(resolvePixelSelectionHistoryShortcut({ key: "Y", ctrlKey: true }, context)).toEqual({
      command: "selection-redo",
      preventDefault: true,
      route: "pixel-selection",
    });
  });

  it("falls through untouched for inputs/modals, document-priority edits, inactive context, wrong owner, Alt, or exhausted direction", () => {
    const history = historyWithUndoAndRedo();
    const base = {
      history,
      activeElementId: "image-a",
      pixelSelectionContextActive: true,
    };
    const documentRoute = {
      command: null,
      preventDefault: false,
      route: "document-history",
    };
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true }, {
      ...base,
      shortcutBoundaryActive: true,
    })).toEqual(documentRoute);
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true }, {
      ...base,
      documentHistoryOwnsLatestEdit: true,
    })).toEqual(documentRoute);
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true, isComposing: true }, base)).toEqual(documentRoute);
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true }, {
      ...base,
      pixelSelectionContextActive: false,
    })).toEqual(documentRoute);
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true }, {
      ...base,
      activeElementId: "image-b",
    })).toEqual(documentRoute);
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true, altKey: true }, base)).toEqual(documentRoute);
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true, defaultPrevented: true }, base)).toEqual(documentRoute);

    const noSelectionUndo = createPixelSelectionHistory("image-a", null);
    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true }, {
      ...base,
      history: noSelectionUndo,
    })).toEqual(documentRoute);
  });
});
