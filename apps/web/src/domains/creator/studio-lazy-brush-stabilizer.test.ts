import { describe, expect, it } from "vitest";

import {
  createStudioLazyBrushStabilizer,
  normalizeStudioLazyBrushOptions,
  shouldApplyStudioLazyBrush,
  STUDIO_LAZY_BRUSH_DEFAULT_RADIUS_CSS_PX,
} from "./studio-lazy-brush-stabilizer";

describe("studio lazy-brush stabilizer", () => {
  it("normalizes radius, zoom scale, friction, and the pointer policy", () => {
    const defaults = normalizeStudioLazyBrushOptions();
    expect(defaults).toMatchObject({
      enabled: true,
      radiusCssPx: STUDIO_LAZY_BRUSH_DEFAULT_RADIUS_CSS_PX,
      coordinateScale: 1,
      radiusDocumentPx: STUDIO_LAZY_BRUSH_DEFAULT_RADIUS_CSS_PX,
      friction: 0,
      pointerPolicy: {
        mouse: true,
        pen: false,
        touch: true,
        unknown: true,
      },
    });
    expect(normalizeStudioLazyBrushOptions({
      radiusCssPx: 40,
      coordinateScale: 2,
      friction: 4,
      pointerPolicy: "all",
    })).toMatchObject({
      radiusDocumentPx: 20,
      friction: 1,
      pointerPolicy: {
        mouse: true,
        pen: true,
        touch: true,
        unknown: true,
      },
    });
  });

  it("emits the exact first point and follows only after crossing the lazy radius", () => {
    const stabilizer = createStudioLazyBrushStabilizer();
    const first = stabilizer.update(
      { x: 0, y: 0, pointerType: "mouse", pointerId: 1 },
      { radiusCssPx: 30 },
    );
    const inside = stabilizer.update(
      { x: 20, y: 0, pointerType: "mouse", pointerId: 1 },
      { radiusCssPx: 30 },
    );
    const outside = stabilizer.update(
      { x: 40, y: 0, pointerType: "mouse", pointerId: 1 },
      { radiusCssPx: 30 },
    );

    expect(first).toMatchObject({
      point: [0, 0],
      pointer: [0, 0],
      firstPoint: true,
      initialized: true,
      moved: false,
    });
    expect(inside).toMatchObject({
      point: [0, 0],
      pointer: [20, 0],
      firstPoint: false,
      moved: false,
    });
    expect(outside).toMatchObject({
      point: [10, 0],
      pointer: [40, 0],
      moved: true,
    });
  });

  it("resets the leash between strokes instead of inheriting a trailing position", () => {
    const stabilizer = createStudioLazyBrushStabilizer();
    stabilizer.update(
      { x: 0, y: 0, pointerType: "mouse", pointerId: 1 },
      { radiusCssPx: 30 },
    );
    stabilizer.update(
      { x: 100, y: 0, pointerType: "mouse", pointerId: 1 },
      { radiusCssPx: 30 },
    );

    stabilizer.reset();
    const nextStroke = stabilizer.update(
      { x: 500, y: 400, pointerType: "mouse", pointerId: 1 },
      { radiusCssPx: 30 },
    );
    expect(nextStroke).toMatchObject({
      point: [500, 400],
      pointer: [500, 400],
      firstPoint: true,
    });
  });

  it("auto-resets when a different pointer starts feeding the adapter", () => {
    const stabilizer = createStudioLazyBrushStabilizer();
    stabilizer.update(
      { x: 0, y: 0, pointerType: "mouse", pointerId: 1 },
      { radiusCssPx: 30 },
    );
    stabilizer.update(
      { x: 100, y: 0, pointerType: "mouse", pointerId: 1 },
      { radiusCssPx: 30 },
    );
    const newPointer = stabilizer.update(
      { x: 600, y: 250, pointerType: "mouse", pointerId: 2 },
      { radiusCssPx: 30 },
    );

    expect(newPointer).toMatchObject({
      point: [600, 250],
      pointer: [600, 250],
      pointerId: 2,
      firstPoint: true,
    });
  });

  it("keeps the perceived lazy radius constant across canvas zoom", () => {
    const atOneX = createStudioLazyBrushStabilizer();
    atOneX.update(
      { x: 0, y: 0, pointerType: "mouse" },
      { radiusCssPx: 30, coordinateScale: 1 },
    );
    const oneX = atOneX.update(
      { x: 40, y: 0, pointerType: "mouse" },
      { radiusCssPx: 30, coordinateScale: 1 },
    );

    const atTwoX = createStudioLazyBrushStabilizer();
    atTwoX.update(
      { x: 0, y: 0, pointerType: "mouse" },
      { radiusCssPx: 30, coordinateScale: 2 },
    );
    const twoX = atTwoX.update(
      { x: 20, y: 0, pointerType: "mouse" },
      { radiusCssPx: 30, coordinateScale: 2 },
    );

    expect(oneX.radiusDocumentPx).toBe(30);
    expect(twoX.radiusDocumentPx).toBe(15);
    expect(oneX.point[0]).toBe(10);
    expect(twoX.point[0]).toBe(5);
    expect(twoX.point[0] * 2).toBe(oneX.point[0]);
  });

  it("supports optional friction without the dependency's exact-one edge case", () => {
    const immediate = createStudioLazyBrushStabilizer();
    immediate.update(
      { x: 0, y: 0, pointerType: "mouse" },
      { radiusCssPx: 10 },
    );
    const immediateResult = immediate.update(
      { x: 100, y: 0, pointerType: "mouse" },
      { radiusCssPx: 10 },
    );

    const damped = createStudioLazyBrushStabilizer();
    damped.update(
      { x: 0, y: 0, pointerType: "mouse" },
      { radiusCssPx: 10, friction: 0.5 },
    );
    const dampedResult = damped.update(
      { x: 100, y: 0, pointerType: "mouse" },
      { radiusCssPx: 10, friction: 0.5 },
    );

    const locked = createStudioLazyBrushStabilizer();
    locked.update(
      { x: 0, y: 0, pointerType: "mouse" },
      { radiusCssPx: 10, friction: 1 },
    );
    const lockedResult = locked.update(
      { x: 100, y: 0, pointerType: "mouse" },
      { radiusCssPx: 10, friction: 1 },
    );

    expect(immediateResult.point[0]).toBe(90);
    expect(dampedResult.point[0]).toBeGreaterThan(0);
    expect(dampedResult.point[0]).toBeLessThan(immediateResult.point[0]);
    expect(lockedResult.point[0]).toBe(0);
  });

  it("bypasses pen by default while allowing explicit per-pointer policies", () => {
    const options = normalizeStudioLazyBrushOptions({ radiusCssPx: 30 });
    expect(shouldApplyStudioLazyBrush("mouse", options)).toBe(true);
    expect(shouldApplyStudioLazyBrush("pen", options)).toBe(false);

    const pen = createStudioLazyBrushStabilizer();
    pen.update({ x: 0, y: 0, pointerType: "pen" }, { radiusCssPx: 30 });
    expect(pen.update(
      { x: 20, y: 0, pointerType: "pen" },
      { radiusCssPx: 30 },
    )).toMatchObject({
      active: false,
      point: [20, 0],
    });

    const optedInPen = createStudioLazyBrushStabilizer();
    optedInPen.update(
      { x: 0, y: 0, pointerType: "pen" },
      { radiusCssPx: 30, pointerPolicy: "all" },
    );
    expect(optedInPen.update(
      { x: 20, y: 0, pointerType: "pen" },
      { radiusCssPx: 30, pointerPolicy: "all" },
    )).toMatchObject({
      active: true,
      point: [0, 0],
    });
  });

  it("uses enabled=false and a zero radius as deterministic pass-through modes", () => {
    for (const options of [
      { enabled: false, radiusCssPx: 30 },
      { enabled: true, radiusCssPx: 0 },
    ]) {
      const stabilizer = createStudioLazyBrushStabilizer();
      stabilizer.update({ x: 5, y: 7, pointerType: "mouse" }, options);
      const result = stabilizer.update(
        { x: 31, y: 43, pointerType: "mouse" },
        options,
      );
      expect(result.point).toEqual([31, 43]);
    }
  });

  it("flushes the lazy trail to the real pointer-up endpoint", () => {
    const stabilizer = createStudioLazyBrushStabilizer();
    stabilizer.update(
      { x: 0, y: 0, pointerType: "mouse" },
      { radiusCssPx: 30 },
    );
    stabilizer.update(
      { x: 100, y: 50, pointerType: "mouse" },
      { radiusCssPx: 30 },
    );
    const flushed = stabilizer.flush();

    expect(flushed).toMatchObject({
      point: [100, 50],
      pointer: [100, 50],
      moved: true,
    });
  });

  it("returns immutable prefix-stable samples when later input arrives", () => {
    const stabilizer = createStudioLazyBrushStabilizer();
    const emitted = [
      stabilizer.update(
        { x: 0, y: 0, pointerType: "mouse" },
        { radiusCssPx: 12, friction: 0.25 },
      ),
      stabilizer.update(
        { x: 24, y: 3, pointerType: "mouse" },
        { radiusCssPx: 12, friction: 0.25 },
      ),
      stabilizer.update(
        { x: 46, y: 14, pointerType: "mouse" },
        { radiusCssPx: 12, friction: 0.25 },
      ),
    ];
    const prefix = emitted.map((sample) => ({
      point: [...sample.point],
      pointer: [...sample.pointer],
    }));

    stabilizer.update(
      { x: 80, y: 40, pointerType: "mouse" },
      { radiusCssPx: 12, friction: 0.25 },
    );

    expect(emitted.map((sample) => ({
      point: [...sample.point],
      pointer: [...sample.pointer],
    }))).toEqual(prefix);
    expect(emitted.every(Object.isFrozen)).toBe(true);
    expect(emitted.every((sample) => (
      Object.isFrozen(sample.point) && Object.isFrozen(sample.pointer)
    ))).toBe(true);
  });

  it("rejects non-finite samples without poisoning an active stroke", () => {
    const stabilizer = createStudioLazyBrushStabilizer();
    const invalidFirst = stabilizer.update({
      x: Number.NaN,
      y: 0,
      pointerType: "mouse",
    });
    expect(invalidFirst).toMatchObject({
      accepted: false,
      initialized: false,
      point: [0, 0],
    });

    const first = stabilizer.update(
      { x: 10, y: 20, pointerType: "mouse" },
      { radiusCssPx: 10 },
    );
    const invalidMiddle = stabilizer.update(
      { x: Infinity, y: 999, pointerType: "mouse" },
      { radiusCssPx: 10 },
    );
    const resumed = stabilizer.update(
      { x: 30, y: 20, pointerType: "mouse" },
      { radiusCssPx: 10 },
    );

    expect(first.point).toEqual([10, 20]);
    expect(invalidMiddle).toMatchObject({
      accepted: false,
      pointer: [10, 20],
      point: [10, 20],
    });
    expect(resumed.point).toEqual([20, 20]);
  });
});
