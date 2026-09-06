import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

export const STUDIO_BG3D_SHOT_PSD_MAX_CANVAS_PIXELS = 2_097_152;
export const STUDIO_BG3D_SHOT_PSD_MAX_AGGREGATE_LAYER_PIXELS = 8_388_608;
export const STUDIO_BG3D_SHOT_PSD_MAX_LAYERS = 4;
export const STUDIO_BG3D_SHOT_PSD_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
export const STUDIO_BG3D_SHOT_PSD_MIME = "image/vnd.adobe.photoshop";

export type StudioBg3dShotPsdAdmission =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: "empty" | "shape" | "canvas-budget" | "layer-budget" };

export function admitStudioBg3dShotPsdLayers(
  layers: readonly StudioBg3dLtRasterLayer[],
): StudioBg3dShotPsdAdmission {
  if (!Array.isArray(layers) || layers.length < 1) return { ok: false, reason: "empty" };
  if (layers.length > STUDIO_BG3D_SHOT_PSD_MAX_LAYERS) {
    return { ok: false, reason: "layer-budget" };
  }
  const first = layers[0];
  if (!first) return { ok: false, reason: "empty" };
  const { width, height } = first;
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) || width < 1 ||
    !Number.isSafeInteger(height) || height < 1 ||
    !Number.isSafeInteger(pixels) ||
    layers.some((layer) => (
      layer.width !== width ||
      layer.height !== height ||
      !(layer.data instanceof Uint8ClampedArray) ||
      layer.data.length !== pixels * 4
    ))
  ) {
    return { ok: false, reason: "shape" };
  }
  if (pixels > STUDIO_BG3D_SHOT_PSD_MAX_CANVAS_PIXELS) {
    return { ok: false, reason: "canvas-budget" };
  }
  if (pixels * layers.length > STUDIO_BG3D_SHOT_PSD_MAX_AGGREGATE_LAYER_PIXELS) {
    return { ok: false, reason: "layer-budget" };
  }
  return { ok: true, width, height };
}
