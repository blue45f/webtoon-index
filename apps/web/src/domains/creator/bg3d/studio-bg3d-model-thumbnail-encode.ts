import { encodeStudioBg3dShotPngInWorker } from "./studio-bg3d-shot-png-worker-client";

import type { StudioBg3dCapturedRaster } from "./studio-bg3d-capture-adapter";
import type { StudioBg3dLtRasterLayer } from "./studio-bg3d-lt-render";

interface StudioBg3dModelThumbnailEncodeIdentity {
  readonly generationId: number;
  readonly requestId: number;
}

/**
 * Shared thumbnail encoder seam. The lightweight PNG Worker client stays warm with the editor so
 * both thumbnail capture and the shot-batch runtime retain their existing bounded request graph;
 * the capture controller and integrity verifier remain lazy until a model import succeeds.
 */
export function encodeStudioBg3dModelThumbnailPng(
  raster: StudioBg3dCapturedRaster,
  _identity: StudioBg3dModelThumbnailEncodeIdentity,
  signal: AbortSignal,
): Promise<Blob> {
  const layer: StudioBg3dLtRasterLayer = Object.freeze({
    role: "color",
    width: raster.width,
    height: raster.height,
    data: raster.rgba instanceof Uint8ClampedArray
      ? raster.rgba
      : new Uint8ClampedArray(raster.rgba),
  });
  return encodeStudioBg3dShotPngInWorker([layer], { signal });
}
