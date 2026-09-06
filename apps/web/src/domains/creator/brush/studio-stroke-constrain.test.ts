import { describe, expect, it } from "vitest";

import {
  buildShiftConstrainedFreehandPoints,
  classifyStrokeAngleSnap,
  resolveShiftFreehandTransition,
  snapStrokeEndpointToCardinalOrDiagonal,
  studioStrokeAngleSnapLabel,
} from "./studio-stroke-constrain";

describe("studio stroke constrain (Shift freehand)", () => {
  it("snaps near-horizontal drags to a pure horizontal line", () => {
    const end = snapStrokeEndpointToCardinalOrDiagonal({ x: 10, y: 20 }, { x: 100, y: 25 });
    expect(end).toEqual({ x: 100, y: 20 });
    expect(classifyStrokeAngleSnap({ x: 10, y: 20 }, end)).toBe("horizontal");
  });

  it("snaps near-vertical drags to a pure vertical line", () => {
    const end = snapStrokeEndpointToCardinalOrDiagonal({ x: 50, y: 10 }, { x: 55, y: 200 });
    expect(end).toEqual({ x: 50, y: 200 });
    expect(classifyStrokeAngleSnap({ x: 50, y: 10 }, end)).toBe("vertical");
  });

  it("snaps diagonal intent to 45 degrees", () => {
    const end = snapStrokeEndpointToCardinalOrDiagonal({ x: 0, y: 0 }, { x: 80, y: 60 });
    expect(end).toEqual({ x: 80, y: 80 });
    expect(classifyStrokeAngleSnap({ x: 0, y: 0 }, end)).toBe("diagonal");
    expect(studioStrokeAngleSnapLabel("diagonal")).toBe("45° 직선");
  });

  it("builds a two-point polyline for freehand Shift strokes", () => {
    expect(buildShiftConstrainedFreehandPoints(0, 0, 100, 5)).toEqual([0, 0, 100, 0]);
  });

  it("replaces the suffix and invalidates the stale stabilizer endpoint", () => {
    expect(resolveShiftFreehandTransition({
      currentPoints: [0, 0, 20, 3, 40, 6],
      currentPressures: [0.4, 0.5, 0.6],
      endX: 100,
      endY: 5,
      pressure: 0.8,
    })).toEqual({
      points: [0, 0, 100, 0],
      pressures: [0.4, 0.8],
      stabilizerState: null,
    });
  });
});
