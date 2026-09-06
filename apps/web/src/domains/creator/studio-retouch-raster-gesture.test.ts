import { describe, expect, it } from "vitest";

import {
  appendStudioPendingRasterRetouchGesturePoint,
  beginStudioPendingRasterRetouchGesture,
  canApplyStudioPendingRasterRetouchGesture,
  endStudioPendingRasterRetouchGesture,
  normalizeStudioPendingRasterRetouchGesture,
  STUDIO_PENDING_RETOUCH_MAX_POINTS,
} from "./studio-retouch-raster-gesture";

const frame = { x: 10, y: 20, width: 100, height: 200, rotation: 0 };

describe("Studio vector-only retouch gesture journal", () => {
  it("keeps the owned first gesture until an asynchronous raster copy can replay it", () => {
    const started = beginStudioPendingRasterRetouchGesture({
      liquifyMode: "push",
      pageId: "page-1",
      point: { x: 20, y: 40 },
      pointer: { pointerId: 7, pointerType: "pen", pressure: 0.4 },
      runId: 12,
      tool: "wet-mix",
    });
    expect(started).not.toBeNull();
    if (!started) return;
    const moved = appendStudioPendingRasterRetouchGesturePoint(
      started,
      { pointerId: 7, pointerType: "pen", pressure: 0.8 },
      { x: 60, y: 120 },
    );
    expect(moved).toBe(started);
    const released = endStudioPendingRasterRetouchGesture(
      moved,
      { pointerId: 7, pointerType: "pen", pressure: 0.6 },
      { cancelled: false, releasePoint: { x: 90, y: 180 } },
    );
    const points = normalizeStudioPendingRasterRetouchGesture(released, frame);

    expect(points).toEqual([
      { x: 0.1, y: 0.1, pressure: 0.4 },
      { x: 0.5, y: 0.5, pressure: 0.8 },
      { x: 0.8, y: 0.8, pressure: 0.6 },
    ]);
    expect(canApplyStudioPendingRasterRetouchGesture(released, points)).toBe(true);
  });

  it("detaches a finalized point snapshot from its single-owner mutable journal", () => {
    const started = beginStudioPendingRasterRetouchGesture({
      liquifyMode: "push",
      pageId: "page-1",
      point: { x: 10, y: 20 },
      pointer: { pointerId: 5, pointerType: "pen", pressure: 0.25 },
      runId: 8,
      tool: "smudge",
    });
    expect(started).not.toBeNull();
    if (!started) return;
    appendStudioPendingRasterRetouchGesturePoint(
      started,
      { pointerId: 5, pointerType: "pen", pressure: 0.5 },
      { x: 30, y: 40 },
    );
    const finalized = endStudioPendingRasterRetouchGesture(
      started,
      { pointerId: 5, pointerType: "pen", pressure: 0.75 },
      { cancelled: false, releasePoint: { x: 50, y: 60 } },
    );
    const finalizedPoints = finalized.points.map((point) => ({ ...point }));

    expect(finalized.points).not.toBe(started.points);
    appendStudioPendingRasterRetouchGesturePoint(
      started,
      { pointerId: 5, pointerType: "pen", pressure: 1 },
      { x: 70, y: 80 },
    );

    expect(started.points.at(-1)).toEqual({ x: 70, y: 80, pressure: 1 });
    expect(finalized.points).toEqual(finalizedPoints);
    expect(finalized).toMatchObject({ cancelled: false, released: true });
  });

  it("ignores foreign pointers and fails closed on cancellation or underspecified push strokes", () => {
    const started = beginStudioPendingRasterRetouchGesture({
      liquifyMode: "push",
      pageId: "page-1",
      point: { x: 20, y: 40 },
      pointer: { pointerId: 3, pointerType: "touch" },
      runId: 4,
      tool: "liquify",
    });
    expect(started).not.toBeNull();
    if (!started) return;
    expect(appendStudioPendingRasterRetouchGesturePoint(
      started,
      { pointerId: 9 },
      { x: 80, y: 160 },
    )).toBe(started);
    const tap = endStudioPendingRasterRetouchGesture(
      started,
      { pointerId: 3 },
      { cancelled: false },
    );
    expect(canApplyStudioPendingRasterRetouchGesture(
      tap,
      normalizeStudioPendingRasterRetouchGesture(tap, frame),
    )).toBe(false);
    const cancelled = endStudioPendingRasterRetouchGesture(
      started,
      { pointerId: 3 },
      { cancelled: true, releasePoint: { x: 80, y: 160 } },
    );
    expect(canApplyStudioPendingRasterRetouchGesture(
      cancelled,
      normalizeStudioPendingRasterRetouchGesture(cancelled, frame),
    )).toBe(false);
  });

  it("caps preparation-time pointer samples while retaining the latest endpoint", () => {
    let gesture = beginStudioPendingRasterRetouchGesture({
      liquifyMode: "twirl-clockwise",
      pageId: "page-1",
      point: { x: 0, y: 0 },
      pointer: { pointerId: 1 },
      runId: 1,
      tool: "smudge",
    });
    expect(gesture).not.toBeNull();
    if (!gesture) return;
    for (let index = 1; index <= STUDIO_PENDING_RETOUCH_MAX_POINTS + 3; index += 1) {
      gesture = appendStudioPendingRasterRetouchGesturePoint(
        gesture,
        { pointerId: 1 },
        { x: index, y: 0 },
      );
    }
    expect(gesture.points).toHaveLength(STUDIO_PENDING_RETOUCH_MAX_POINTS);
    expect(gesture.points.at(-2)).toMatchObject({ x: STUDIO_PENDING_RETOUCH_MAX_POINTS - 2 });
    expect(gesture.points.at(-1)).toMatchObject({
      x: STUDIO_PENDING_RETOUCH_MAX_POINTS + 3,
    });
  });

  it("does not journal secondary or non-primary contacts", () => {
    const base = {
      liquifyMode: "push" as const,
      pageId: "page-1",
      point: { x: 0, y: 0 },
      runId: 1,
      tool: "dodge-burn" as const,
    };
    expect(beginStudioPendingRasterRetouchGesture({
      ...base,
      pointer: { pointerId: 1, button: 2 },
    })).toBeNull();
    expect(beginStudioPendingRasterRetouchGesture({
      ...base,
      pointer: { pointerId: 2, isPrimary: false },
    })).toBeNull();
  });
});
