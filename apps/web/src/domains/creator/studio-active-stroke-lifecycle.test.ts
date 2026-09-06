import { describe, expect, it, vi } from "vitest";

import {
  planStudioActiveStrokeUnmountRecovery,
  runStudioDrawingUnmountLifecycle,
  studioActiveStrokeRecoveryFingerprint,
} from "./studio-active-stroke-lifecycle";

import type { DrawEl } from "./studio-element-model";

function stroke(
  id: string,
  points: number[],
  kind: DrawEl["kind"] = "freehand"
): DrawEl {
  return {
    id,
    type: "draw",
    kind,
    points,
    stroke: "#111",
    strokeWidth: 8,
  };
}

describe("active stroke lifecycle recovery", () => {
  it("fingerprints successive live prefixes without copying the full stroke", () => {
    const first = stroke("active", [0, 0, 8, 8]);
    const pressureChanged = { ...first, pressures: [0.3, 0.7] };
    const extended = { ...pressureChanged, points: [...pressureChanged.points, 12, 9] };

    expect(studioActiveStrokeRecoveryFingerprint(first)).not.toBe("");
    expect(studioActiveStrokeRecoveryFingerprint(pressureChanged)).not.toBe(
      studioActiveStrokeRecoveryFingerprint(first)
    );
    expect(studioActiveStrokeRecoveryFingerprint(extended)).not.toBe(
      studioActiveStrokeRecoveryFingerprint(pressureChanged)
    );
    expect(studioActiveStrokeRecoveryFingerprint(null)).toBe("");
    expect(studioActiveStrokeRecoveryFingerprint(stroke("tiny", [0, 0, 1, 0], "line"))).toBe("");
  });

  it.each(["pen", "mouse"] as const)(
    "promotes a complete %s stroke after an existing same-page batch",
    (pointerType) => {
      const deferred = stroke("deferred", [0, 0, 8, 8]);
      const active = stroke("active", [10, 10, 16, 16]);
      const pending = { pageId: "page-1", strokes: [deferred] };

      const plan = planStudioActiveStrokeUnmountRecovery({
        activeStroke: active,
        activePageId: "page-1",
        pointerType,
        stableElementIds: new Set(["stable"]),
        pending,
      });

      expect(plan).toMatchObject({
        action: "recover",
        strokeId: "active",
        pending: { pageId: "page-1", strokes: [deferred, active] },
      });
      expect(pending.strokes).toEqual([deferred]);
    }
  );

  it("keeps touch cancellation and incomplete shape thresholds unchanged", () => {
    expect(planStudioActiveStrokeUnmountRecovery({
      activeStroke: stroke("touch", [0, 0, 12, 12]),
      activePageId: "page-1",
      pointerType: "touch",
      stableElementIds: new Set(),
      pending: null,
    })).toMatchObject({ action: "discard", reason: "touch-contact" });
    expect(planStudioActiveStrokeUnmountRecovery({
      activeStroke: stroke("tiny-line", [0, 0, 2, 0], "line"),
      activePageId: "page-1",
      pointerType: "pen",
      stableElementIds: new Set(),
      pending: null,
    })).toMatchObject({ action: "discard", reason: "incomplete-stroke" });
  });

  it("does not add an id that is already stable or pending", () => {
    const active = stroke("same", [0, 0]);
    expect(planStudioActiveStrokeUnmountRecovery({
      activeStroke: active,
      activePageId: "page-1",
      pointerType: "mouse",
      stableElementIds: new Set(["same"]),
      pending: null,
    })).toMatchObject({ action: "already-recoverable", reason: "stable-page" });
    expect(planStudioActiveStrokeUnmountRecovery({
      activeStroke: active,
      activePageId: "page-1",
      pointerType: "mouse",
      stableElementIds: new Set(),
      pending: { pageId: "page-1", strokes: [active] },
    })).toMatchObject({ action: "already-recoverable", reason: "pending-batch" });
  });

  it("fails closed instead of mixing pending strokes from different pages", () => {
    expect(planStudioActiveStrokeUnmountRecovery({
      activeStroke: stroke("active", [0, 0, 6, 6]),
      activePageId: "page-2",
      pointerType: "pen",
      stableElementIds: new Set(),
      pending: { pageId: "page-1", strokes: [stroke("deferred", [1, 1])] },
    })).toMatchObject({ action: "blocked", reason: "pending-page-conflict" });
  });

  it("persists before destructive cleanup and still exhausts cleanup after failures", () => {
    const order: string[] = [];
    const persistError = new Error("storage unavailable");
    const cleanupError = new Error("detached CRDT");
    const failures = runStudioDrawingUnmountLifecycle({
      promoteActiveStroke: () => order.push("promote"),
      persistRecovery: () => {
        order.push("persist");
        throw persistError;
      },
      cleanupDrawing: () => {
        order.push("cleanup-drawing");
        throw cleanupError;
      },
      disposePointerTransport: () => order.push("dispose-pointer"),
      clearPendingCommit: vi.fn(() => order.push("clear-pending")),
    });

    expect(order).toEqual([
      "promote",
      "persist",
      "cleanup-drawing",
      "dispose-pointer",
      "clear-pending",
    ]);
    expect(failures).toEqual([persistError, cleanupError]);
  });
});
