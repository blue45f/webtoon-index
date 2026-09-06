import { describe, expect, it } from "vitest";

import {
  measureStudioLivingInkAlphaCoverage,
  studioLivingInkCoverageIntersectsStroke,
} from "./studio-living-ink-overlay";

describe("Living Ink canonical alpha coverage", () => {
  it("rejects malformed RGBA dimensions instead of manufacturing coverage", () => {
    expect(() => measureStudioLivingInkAlphaCoverage(
      new Uint8ClampedArray(3),
      1,
      1,
    )).toThrow(RangeError);
    expect(() => measureStudioLivingInkAlphaCoverage(
      new Uint8ClampedArray(0),
      0,
      1,
    )).toThrow(RangeError);
  });

  it("reports an honestly blank canonical frame", () => {
    expect(measureStudioLivingInkAlphaCoverage(
      new Uint8ClampedArray(4 * 3 * 2),
      3,
      2,
    )).toEqual({ pixelCount: 0, bounds: null });
  });

  it("counts non-zero alpha and returns its exact inclusive bounds", () => {
    const rgba = new Uint8ClampedArray(4 * 5 * 4);
    rgba[(1 * 5 + 3) * 4 + 3] = 1;
    rgba[(3 * 5 + 1) * 4 + 3] = 255;
    rgba[(2 * 5 + 4) * 4 + 3] = 72;

    expect(measureStudioLivingInkAlphaCoverage(rgba, 5, 4)).toEqual({
      pixelCount: 3,
      bounds: { x: 1, y: 1, width: 4, height: 3 },
    });
  });

  it("accepts only canonical ink that overlaps the authored document-space stroke", () => {
    const base = {
      outputWidth: 100,
      outputHeight: 200,
      documentWidth: 200,
      documentHeight: 400,
      points: [40, 100, 60, 120],
      diameter: 20,
    } as const;
    expect(studioLivingInkCoverageIntersectsStroke({
      ...base,
      coverage: { pixelCount: 12, bounds: { x: 22, y: 52, width: 8, height: 8 } },
    })).toBe(true);
    expect(studioLivingInkCoverageIntersectsStroke({
      ...base,
      coverage: { pixelCount: 12, bounds: { x: 22, y: 142, width: 8, height: 8 } },
    })).toBe(false);
    expect(studioLivingInkCoverageIntersectsStroke({
      ...base,
      coverage: { pixelCount: 0, bounds: null },
    })).toBe(false);
  });
});
