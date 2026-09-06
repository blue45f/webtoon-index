/** Converts the renderer-neutral normalized depth buffer into an artist-readable grayscale pass. */

import {
  STUDIO_BG3D_LT_RENDER_MAX_PIXELS,
  type StudioBg3dLtRasterLayer,
} from "./studio-bg3d-lt-render";

export function createStudioBg3dDepthRasterLayer(
  width: number,
  height: number,
  depth: Float32Array,
): StudioBg3dLtRasterLayer {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError("3D depth pass dimensions must be positive safe integers.");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS) {
    throw new RangeError("3D depth pass exceeds the raster pixel budget.");
  }
  if (!(depth instanceof Float32Array) || depth.length !== pixels) {
    throw new RangeError("3D depth pass length must equal width * height.");
  }
  const data = new Uint8ClampedArray(pixels * 4);
  for (let index = 0; index < depth.length; index += 1) {
    const sample = depth[index];
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
      throw new RangeError("3D depth pass values must be finite and normalized to [0, 1].");
    }
    const value = Math.round(sample * 255);
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { role: "color", width, height, data };
}
