import { describe, expect, it } from "vitest";

import {
  bindPixelSelectionHistory,
  canRedoPixelSelectionHistory,
  canUndoPixelSelectionHistory,
  commitPixelSelectionHistory,
  createPixelSelectionHistory,
  redoPixelSelectionHistory,
  resolvePixelSelectionHistoryShortcut,
  undoPixelSelectionHistory,
} from "./studio-pixel-selection-session-history";
import { addSelectionSubpath, rectSelectionPolygon, setSelectionFeather } from "./studio-selection-tools";

import type { PixelSelection } from "./studio-selection-tools";

function box(offset = 0): PixelSelection {
  return addSelectionSubpath(
    null,
    "add",
    rectSelectionPolygon(
      { x: 0.1 + offset, y: 0.1 },
      { x: 0.5 + offset, y: 0.5 },
    ),
  )!;
}

describe("trusted pixel-selection session history", () => {
  it("deep-clones and owner-isolates undo/redo snapshots", () => {
    const source = box();
    let history = createPixelSelectionHistory("image-a", null);
    history = commitPixelSelectionHistory(history, "image-a", source, {
      operation: "marquee",
    }).history;
    source.subpaths[0]!.points[0]!.x = 0.99;

    expect(history.present?.selection?.subpaths[0]!.points[0]!.x).toBe(0.1);
    expect(Object.isFrozen(history.present?.selection)).toBe(true);
    expect(canUndoPixelSelectionHistory(history, "image-a")).toBe(true);
    expect(canUndoPixelSelectionHistory(history, "image-b")).toBe(false);

    const undone = undoPixelSelectionHistory(history, "image-a");
    expect(undone).toMatchObject({ applied: true, selection: null });
    expect(canRedoPixelSelectionHistory(undone.history, "image-a")).toBe(true);
    expect(redoPixelSelectionHistory(undone.history, "image-a").selection).toEqual(
      history.present?.selection,
    );
    expect(bindPixelSelectionHistory(history, "image-b").past).toEqual([]);
  });

  it("coalesces slider input and retains the configured entry bound", () => {
    const limits = {
      maxEntries: 3,
      maxBytes: 4 * 1024 * 1024,
      maxSubpathsPerSnapshot: 128,
      maxPointsPerSubpath: 4_096,
      maxPointsPerSnapshot: 8_192,
    } as const;
    let history = createPixelSelectionHistory("image-a", box(), limits);
    history = commitPixelSelectionHistory(history, "image-a", setSelectionFeather(box(), 4), {
      operation: "feather",
      coalesceKey: "feather",
    }).history;
    const pastLength = history.past.length;
    history = commitPixelSelectionHistory(history, "image-a", setSelectionFeather(box(), 12), {
      operation: "feather",
      coalesceKey: "feather",
    }).history;
    expect(history.past).toHaveLength(pastLength);

    for (let index = 1; index <= 5; index += 1) {
      history = commitPixelSelectionHistory(history, "image-a", box(index * 0.01), {
        operation: "move",
      }).history;
    }
    expect(history.past.length + 1).toBeLessThanOrEqual(3);
    expect(history.retainedBytes).toBeLessThanOrEqual(limits.maxBytes);
  });

  it("routes only eligible selection undo/redo shortcuts", () => {
    let history = createPixelSelectionHistory("image-a", null);
    history = commitPixelSelectionHistory(history, "image-a", box(), {
      operation: "free-lasso",
    }).history;
    const context = {
      history,
      activeElementId: "image-a",
      pixelSelectionContextActive: true,
    };

    expect(resolvePixelSelectionHistoryShortcut({ key: "z", metaKey: true }, context))
      .toMatchObject({ command: "selection-undo", preventDefault: true });
    expect(resolvePixelSelectionHistoryShortcut(
      { key: "z", metaKey: true },
      { ...context, shortcutBoundaryActive: true },
    )).toMatchObject({ command: null, route: "document-history" });
    expect(resolvePixelSelectionHistoryShortcut(
      { key: "z", metaKey: true },
      { ...context, documentHistoryOwnsLatestEdit: true },
    )).toMatchObject({ command: null, route: "document-history" });
  });
});
