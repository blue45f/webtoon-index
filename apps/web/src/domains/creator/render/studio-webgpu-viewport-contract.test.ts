import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  StudioGpuViewport,
  StudioGpuViewTransform,
} from "./studio-webgpu-viewport-contract";

describe("studio WebGPU viewport contract", () => {
  it("keeps presentation transforms optional for identity-view callers", () => {
    const viewport: StudioGpuViewport = {
      logicalWidth: 800,
      logicalHeight: 1_200,
    };

    expect(viewport).toEqual({ logicalWidth: 800, logicalHeight: 1_200 });
    expectTypeOf(viewport).toMatchTypeOf<StudioGpuViewTransform>();
  });

  it("preserves the fully-resolved transform shape used by viewport planners", () => {
    const transform: Required<StudioGpuViewTransform> = {
      scaleX: 1.5,
      scaleY: 2,
      offsetX: -120,
      offsetY: -480,
      flipX: true,
    };
    const viewport: StudioGpuViewport = {
      logicalWidth: 800,
      logicalHeight: 12_000,
      cssWidth: 640,
      cssHeight: 720,
      dpr: 2,
      ...transform,
    };

    expect(viewport.flipX).toBe(true);
    expect(viewport.dpr).toBe(2);
    expectTypeOf<StudioGpuViewport>().toMatchTypeOf<StudioGpuViewTransform>();
  });
});
