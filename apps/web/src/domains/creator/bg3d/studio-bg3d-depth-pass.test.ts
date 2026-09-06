import { describe, expect, it } from "vitest";

import { createStudioBg3dDepthRasterLayer } from "./studio-bg3d-depth-pass";

describe("Studio BG3D depth raster pass", () => {
  it("maps normalized near-to-far samples to opaque grayscale without mutating the source", () => {
    const depth = new Float32Array([0, 0.25, 0.5, 0.75, 1]);
    const before = depth.slice();
    const layer = createStudioBg3dDepthRasterLayer(5, 1, depth);

    expect(layer).toMatchObject({ role: "color", width: 5, height: 1 });
    expect(Array.from(layer.data)).toEqual([
      0, 0, 0, 255,
      64, 64, 64, 255,
      128, 128, 128, 255,
      191, 191, 191, 255,
      255, 255, 255, 255,
    ]);
    expect(depth).toEqual(before);
  });

  it("rejects malformed shapes and non-finite or unnormalized samples", () => {
    expect(() => createStudioBg3dDepthRasterLayer(0, 1, new Float32Array())).toThrow(RangeError);
    expect(() => createStudioBg3dDepthRasterLayer(2, 1, new Float32Array(1))).toThrow(/length/u);
    expect(() => createStudioBg3dDepthRasterLayer(1, 1, new Float32Array([Number.NaN])))
      .toThrow(/normalized/u);
    expect(() => createStudioBg3dDepthRasterLayer(1, 1, new Float32Array([1.1])))
      .toThrow(/normalized/u);
  });
});
