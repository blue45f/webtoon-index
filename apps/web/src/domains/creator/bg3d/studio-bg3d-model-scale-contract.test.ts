import { describe, expect, it } from "vitest";

import {
  computeStudioBg3dAutoFitScale,
  STUDIO_BG3D_AUTO_FIT_TARGET_SIZE,
} from "./studio-bg3d-model-scale-contract";

describe("Studio BG3D imported-model size contract", () => {
  it("normalizes the largest local dimension to the shared target size", () => {
    expect(STUDIO_BG3D_AUTO_FIT_TARGET_SIZE).toBe(2);
    expect(computeStudioBg3dAutoFitScale([1, 0.5, 0.25])).toBe(2);
    expect(computeStudioBg3dAutoFitScale([100, 50, 25])).toBe(0.02);
  });

  it("allows a producer to cancel loader normalization and retain authored size", () => {
    const localSize = [1, 1, 1] as const;
    const authoredScale = [1, 1, 1.5] as const;
    const loaderScale = computeStudioBg3dAutoFitScale(localSize);
    const persistedScale = authoredScale.map((value) => value / loaderScale);

    expect(localSize.map((value, axis) =>
      value * loaderScale * persistedScale[axis]!)).toEqual([1, 1, 1.5]);
  });

  it("fails safe with a no-op factor for empty or non-finite bounds", () => {
    expect(computeStudioBg3dAutoFitScale([0, 0, 0])).toBe(1);
    expect(computeStudioBg3dAutoFitScale([Number.NaN, 1, 1])).toBe(1);
    expect(computeStudioBg3dAutoFitScale([1, 1, 1], Number.POSITIVE_INFINITY)).toBe(1);
  });
});
