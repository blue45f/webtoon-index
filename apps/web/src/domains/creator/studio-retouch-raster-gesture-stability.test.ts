import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  appendStudioPendingRasterRetouchGesturePoint,
  beginStudioPendingRasterRetouchGesture,
  canApplyStudioPendingRasterRetouchGesture,
  endStudioPendingRasterRetouchGesture,
  STUDIO_PENDING_RETOUCH_MAX_POINTS,
  type StudioRasterRetouchGestureTool,
} from "./studio-retouch-raster-gesture";

const owner = { pointerId: 7, pointerType: "mouse" };
const normalizedPoints = [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }];

function begin(tool: StudioRasterRetouchGestureTool = "smudge") {
  const gesture = beginStudioPendingRasterRetouchGesture({
    tool,
    liquifyMode: "push",
    pageId: "page-1",
    runId: 12,
    pointer: owner,
    point: { x: 10, y: 20 },
  });
  assert.ok(gesture);
  appendStudioPendingRasterRetouchGesturePoint(gesture, owner, { x: 50, y: 60 });
  return gesture;
}

describe("pending raster retouch terminal state and point ownership", () => {
  const tools: readonly StudioRasterRetouchGestureTool[] = [
    "smudge", "dodge-burn", "wet-mix", "liquify",
  ];
  for (const tool of tools) {
    it(`${tool}: never revives a cancelled journal on a late successful end`, () => {
      const cancelled = endStudioPendingRasterRetouchGesture(begin(tool), owner, {
        cancelled: true,
      });
      const late = endStudioPendingRasterRetouchGesture(cancelled, owner, {
        cancelled: false,
        releasePoint: { x: 90, y: 100 },
      });
      assert.equal(canApplyStudioPendingRasterRetouchGesture(late, normalizedPoints), false);
      assert.equal(late, cancelled);
      assert.equal(late.points, cancelled.points);
    });
  }

  it("still permits cancellation after release while asynchronous preparation is pending", () => {
    const released = endStudioPendingRasterRetouchGesture(begin(), owner, { cancelled: false });
    assert.equal(canApplyStudioPendingRasterRetouchGesture(released, normalizedPoints), true);
    const cancelled = endStudioPendingRasterRetouchGesture(released, owner, {
      cancelled: true,
      releasePoint: { x: 900, y: 900 },
    });
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.released, true);
    assert.deepEqual(cancelled.points, released.points);
    assert.equal(canApplyStudioPendingRasterRetouchGesture(cancelled, normalizedPoints), false);
    assert.equal(endStudioPendingRasterRetouchGesture(cancelled, owner, {
      cancelled: false,
    }), cancelled);
  });

  it("does not append a cancellation endpoint to the replay journal", () => {
    const active = begin();
    const before = active.points.map((point) => ({ ...point }));
    const cancelled = endStudioPendingRasterRetouchGesture(active, owner, {
      cancelled: true,
      releasePoint: { x: 90, y: 100 },
    });
    assert.deepEqual(active.points, before);
    assert.deepEqual(cancelled.points, before);
    assert.notEqual(cancelled.points, active.points);
  });

  it("makes 10,000 duplicate terminal events idempotent without recopying a full journal", () => {
    const active = begin();
    for (let index = 1; index <= STUDIO_PENDING_RETOUCH_MAX_POINTS + 3; index += 1) {
      appendStudioPendingRasterRetouchGesturePoint(active, owner, { x: index * 2, y: 80 });
    }
    const released = endStudioPendingRasterRetouchGesture(active, owner, { cancelled: false });
    const cancelled = endStudioPendingRasterRetouchGesture(released, owner, { cancelled: true });
    for (let index = 0; index < 10_000; index += 1) {
      assert.equal(endStudioPendingRasterRetouchGesture(released, owner, {
        cancelled: false, releasePoint: { x: index, y: -index },
      }), released);
      assert.equal(endStudioPendingRasterRetouchGesture(cancelled, owner, {
        cancelled: index % 2 === 0,
      }), cancelled);
    }
    assert.equal(released.points.length, STUDIO_PENDING_RETOUCH_MAX_POINTS);
    assert.deepEqual(released.points.at(-1), {
      x: (STUDIO_PENDING_RETOUCH_MAX_POINTS + 3) * 2, y: 80,
    });
  });

  it("never lets a foreign pointer finish or cancel the owner's journal", () => {
    const active = begin();
    const foreign = { pointerId: 9, pointerType: "touch" };
    assert.equal(endStudioPendingRasterRetouchGesture(active, foreign, {
      cancelled: true, releasePoint: { x: 900, y: 900 },
    }), active);
    const released = endStudioPendingRasterRetouchGesture(active, owner, { cancelled: false });
    assert.equal(endStudioPendingRasterRetouchGesture(released, foreign, {
      cancelled: true,
    }), released);
    assert.equal(released.cancelled, false);
  });

  for (const pointerType of ["mouse", "touch", "pen"]) {
    const pointer = { pointerId: 7, pointerType, pressure: 0.5 };
    const expected = (x: number, y: number) => pointerType === "pen"
      ? { x, y, pressure: 0.5 }
      : { x, y };

    it(`${pointerType}: snapshots the caller's reused initial coordinate object`, () => {
      const point = { x: 10, y: 20 };
      const gesture = beginStudioPendingRasterRetouchGesture({
        tool: "wet-mix", liquifyMode: "push", pageId: "page-1", runId: 12, pointer, point,
      });
      assert.ok(gesture);
      point.x = 900;
      point.y = 900;
      assert.deepEqual(gesture.points, [expected(10, 20)]);
      assert.notEqual(gesture.points[0], point);
    });

    it(`${pointerType}: snapshots appended coordinates before asynchronous replay`, () => {
      const gesture = begin();
      const point = { x: 90, y: 100 };
      appendStudioPendingRasterRetouchGesturePoint(gesture, pointer, point);
      const released = endStudioPendingRasterRetouchGesture(gesture, pointer, {
        cancelled: false,
      });
      point.x = 900;
      point.y = 900;
      assert.deepEqual(released.points.at(-1), expected(90, 100));
    });

    it(`${pointerType}: snapshots the release endpoint before its caller reuses it`, () => {
      const point = { x: 90, y: 100 };
      const released = endStudioPendingRasterRetouchGesture(begin(), pointer, {
        cancelled: false, releasePoint: point,
      });
      point.x = 900;
      point.y = 900;
      assert.deepEqual(released.points.at(-1), expected(90, 100));
    });
  }

  it("preserves the finalized snapshot if the retired active owner receives another move", () => {
    const active = begin();
    const released = endStudioPendingRasterRetouchGesture(active, owner, {
      cancelled: false, releasePoint: { x: 90, y: 100 },
    });
    const before = released.points.map((point) => ({ ...point }));
    appendStudioPendingRasterRetouchGesturePoint(active, owner, { x: 110, y: 120 });
    assert.notEqual(released.points, active.points);
    assert.deepEqual(released.points, before);
    assert.deepEqual(active.points.at(-1), { x: 110, y: 120 });
  });

  it("uses pressure from the pointer, not an unrelated property on a coordinate object", () => {
    const point = { x: 90, y: 100, pressure: 0.75 };
    const active = begin();
    appendStudioPendingRasterRetouchGesturePoint(active, owner, point);
    assert.deepEqual(active.points.at(-1), { x: 90, y: 100 });
  });

  it("preserves pressure clamping and ignores non-finite pen pressure", () => {
    for (const pressure of [-1, 0, 0.75, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const released = endStudioPendingRasterRetouchGesture(begin(), {
        pointerId: 7, pointerType: "pen", pressure,
      }, { cancelled: false, releasePoint: { x: 90, y: 100 } });
      const expected = Number.isFinite(pressure)
        ? { x: 90, y: 100, pressure: Math.min(1, Math.max(0, pressure)) }
        : { x: 90, y: 100 };
      assert.deepEqual(released.points.at(-1), expected);
    }
  });

  it("keeps the sample cap and latest endpoint after repeated pointer moves", () => {
    const gesture = begin();
    for (let index = 1; index <= 20_000; index += 1) {
      assert.equal(appendStudioPendingRasterRetouchGesturePoint(gesture, owner, {
        x: index * 2, y: 80,
      }), gesture);
    }
    assert.equal(gesture.points.length, STUDIO_PENDING_RETOUCH_MAX_POINTS);
    assert.deepEqual(gesture.points[0], { x: 10, y: 20 });
    assert.deepEqual(gesture.points.at(-1), { x: 40_000, y: 80 });
  });

  it("does not leak cancellation into a new run that reuses the same pointer id", () => {
    const cancelled = endStudioPendingRasterRetouchGesture(begin(), owner, { cancelled: true });
    const next = beginStudioPendingRasterRetouchGesture({
      tool: "wet-mix", liquifyMode: "push", pageId: "page-2", runId: 13,
      pointer: owner, point: { x: 20, y: 30 },
    });
    assert.ok(next);
    const released = endStudioPendingRasterRetouchGesture(next, owner, { cancelled: false });
    assert.equal(canApplyStudioPendingRasterRetouchGesture(released, normalizedPoints), true);
    assert.equal(cancelled.cancelled, true);
    assert.equal(released.runId, 13);
    assert.equal(released.pageId, "page-2");
  });
});
