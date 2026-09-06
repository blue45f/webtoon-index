import { describe, expect, it } from "vitest";

import {
  adjustDrawStrokeWidth,
  calculateAdjustedStrokeWidth,
  LINE_WIDTH_PRESETS,
  MIN_STROKE_WIDTH,
} from "./studio-line-width-adjust";

import type { DrawEl } from "../studio-element-model";

describe("studio-line-width-adjust", () => {
  it("thickens stroke width accurately", () => {
    expect(calculateAdjustedStrokeWidth(4, { action: "thicken", value: 2 })).toBe(6);
    expect(calculateAdjustedStrokeWidth(1, { action: "thicken", value: 0.5 })).toBe(1.5);
  });

  it("narrows stroke width and respects minimum clamp", () => {
    expect(calculateAdjustedStrokeWidth(5, { action: "narrow", value: 2 })).toBe(3);
    expect(calculateAdjustedStrokeWidth(1, { action: "narrow", value: 5 })).toBe(MIN_STROKE_WIDTH);
  });

  it("scales stroke width by multiplier", () => {
    expect(calculateAdjustedStrokeWidth(10, { action: "scale", value: 1.5 })).toBe(15);
    expect(calculateAdjustedStrokeWidth(10, { action: "scale", value: 0.5 })).toBe(5);
  });

  it("fixes stroke width to exact value", () => {
    expect(calculateAdjustedStrokeWidth(10, { action: "fix", value: 3 })).toBe(3);
  });

  it("adjusts a DrawEl and optionally scales pressures", () => {
    const stroke: DrawEl = {
      id: "draw-1",
      type: "draw",
      points: [0, 0, 10, 10],
      stroke: "#000000",
      strokeWidth: 4,
      pressures: [0.5, 0.8],
    };

    const patched = adjustDrawStrokeWidth(stroke, {
      action: "thicken",
      value: 2,
      scalePressures: true,
    });

    expect(patched.strokeWidth).toBe(6);
    expect(patched.pressures).toBeDefined();
    expect(patched.pressures?.[0]).toBeCloseTo(0.75, 2);
  });

  it("provides standard presets", () => {
    expect(LINE_WIDTH_PRESETS.length).toBeGreaterThanOrEqual(6);
  });
});
