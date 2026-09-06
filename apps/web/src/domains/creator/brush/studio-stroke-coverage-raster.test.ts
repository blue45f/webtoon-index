/**
 * The raster's contract at its edges. The PICTURE it makes is verified in a browser
 * (`tests/benchmarks/harness/nib-shell-raster-cost.ts`), because a tonal decision measured in
 * jsdom would be measuring nothing — there is no 2D context here. What is worth pinning in a unit
 * test is the behaviour when the surface is unavailable, because that is the path a headless or
 * canvas-less environment takes and it must degrade to "paint the silhouette flat", never throw.
 */
import { describe, expect, it } from "vitest";

import {
  rasterizeStudioCoverageBands,
  resetStudioCoverageBandScratchForTest,
} from "./studio-stroke-coverage-raster";

const BAND = {
  band: 0,
  opacity: 0.8,
  polygons: [{ points: [0, 0, 10, 0, 10, 10, 0, 10] }],
};

describe("studio coverage band raster", () => {
  it("returns null instead of throwing when there is nothing to paint", () => {
    resetStudioCoverageBandScratchForTest();
    expect(rasterizeStudioCoverageBands([], "#000", 2)).toBeNull();
    // A band set whose polygons carry no area has no raster to make either.
    expect(rasterizeStudioCoverageBands(
      [{ ...BAND, polygons: [{ points: [5, 5, 5, 5, 5, 5] }] }],
      "#000",
      2,
    )).toBeNull();
    // Peak zero would divide the mark away rather than paint it.
    expect(rasterizeStudioCoverageBands([{ ...BAND, opacity: 0 }], "#000", 2)).toBeNull();
  });

  it("survives an environment with no 2D surface so the caller can fall through", () => {
    resetStudioCoverageBandScratchForTest();
    // jsdom has no canvas backend, so this exercises the real refusal path rather than a mock.
    expect(() => rasterizeStudioCoverageBands([BAND], "#000", 2)).not.toThrow();
  });
});
