/**
 * Live liquify warp preview planning — pure geometry only.
 *
 * Primary path: full native resolution inside the stroke dirty ROI (no whole-image downscale).
 * Fallback: whole-frame downscale only when the ROI would exceed a soft pixel budget.
 */

import {
  STUDIO_LIQUIFY_PREVIEW_MAX_EDGE,
  thinStudioLiquifyPointsForPreview,
} from "./studio-liquify-stroke-sampling";

import type { StudioLiquifyPointerPoint } from "./studio-liquify-pointer";

/** Soft ROI budget (~1225²). Larger contact areas fall back to whole-frame downscale. */
export const STUDIO_LIQUIFY_LIVE_PREVIEW_MAX_ROI_PIXELS = 1_500_000;

export type StudioLiquifyLivePreviewMode = "roi-full-res" | "frame-downscale";

export interface StudioLiquifyLivePreviewPlan {
  readonly mode: StudioLiquifyLivePreviewMode;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
  readonly radiusDevice: number;
  readonly points: readonly StudioLiquifyPointerPoint[];
  /** Estimated dirty footprint in source pixels (width×height of brush-bounded ROI). */
  readonly estimatedRoiPixels: number;
}

/**
 * Scale so the longest raster edge is at most `maxEdge`. Scale is never greater than 1.
 * Used only for the frame-downscale fallback path.
 */
export function studioLiquifyLivePreviewScale(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number = STUDIO_LIQUIFY_PREVIEW_MAX_EDGE,
): number {
  if (
    !Number.isFinite(sourceWidth)
    || !Number.isFinite(sourceHeight)
    || sourceWidth <= 0
    || sourceHeight <= 0
  ) {
    return 1;
  }
  const longest = Math.max(sourceWidth, sourceHeight);
  if (!Number.isFinite(maxEdge) || maxEdge <= 0 || longest <= maxEdge) return 1;
  return maxEdge / longest;
}

/**
 * Conservative dirty-pixel estimate from the thinned stroke AABB + brush radius halo.
 * Matches the spirit of planLiquifyStrokeRasterRegion without importing the browser module.
 */
export function estimateStudioLiquifyStrokeRoiPixels(
  points: readonly StudioLiquifyPointerPoint[],
  radiusDevice: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  if (points.length === 0 || !(radiusDevice > 0)) return sourceWidth * sourceHeight;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return sourceWidth * sourceHeight;
    }
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  // radius + ~2× displacement halo + bilinear pad (see LIQUIFY_MAX_DISPLACEMENT_RADIUS_RATIO = 2)
  const pad = Math.ceil(radiusDevice * 3) + 2;
  const x0 = Math.max(0, Math.floor(minX - pad));
  const y0 = Math.max(0, Math.floor(minY - pad));
  const x1 = Math.min(sourceWidth - 1, Math.ceil(maxX + pad));
  const y1 = Math.min(sourceHeight - 1, Math.ceil(maxY + pad));
  const w = Math.max(1, x1 - x0 + 1);
  const h = Math.max(1, y1 - y0 + 1);
  return w * h;
}

/**
 * Prefer full-resolution ROI preview. Only downscale the whole frame when the estimated dirty
 * footprint exceeds {@link STUDIO_LIQUIFY_LIVE_PREVIEW_MAX_ROI_PIXELS}.
 */
export function planStudioLiquifyLivePreview(input: {
  readonly points: readonly StudioLiquifyPointerPoint[];
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly elementWidth: number;
  readonly radiusCanvasPx: number;
  readonly maxEdge?: number;
  readonly maxRoiPixels?: number;
  /** Force downscale path (tests / low-power). */
  readonly forceDownscale?: boolean;
}): StudioLiquifyLivePreviewPlan | null {
  if (input.points.length === 0) return null;
  if (
    !Number.isFinite(input.sourceWidth)
    || !Number.isFinite(input.sourceHeight)
    || input.sourceWidth <= 0
    || input.sourceHeight <= 0
  ) {
    return null;
  }

  const thinned = thinStudioLiquifyPointsForPreview(input.points);
  const radiusDeviceFull =
    (input.radiusCanvasPx / Math.max(1, input.elementWidth)) * input.sourceWidth;
  if (!(radiusDeviceFull > 0)) return null;

  const fullPoints = thinned.map((point) => ({
    x: point.x * input.sourceWidth,
    y: point.y * input.sourceHeight,
    ...(point.pressure === undefined ? {} : { pressure: point.pressure }),
  }));
  const estimatedRoiPixels = estimateStudioLiquifyStrokeRoiPixels(
    fullPoints,
    radiusDeviceFull,
    input.sourceWidth,
    input.sourceHeight,
  );
  const maxRoiPixels = input.maxRoiPixels ?? STUDIO_LIQUIFY_LIVE_PREVIEW_MAX_ROI_PIXELS;
  const useRoi =
    !input.forceDownscale
    && Number.isFinite(estimatedRoiPixels)
    && estimatedRoiPixels > 0
    && estimatedRoiPixels <= maxRoiPixels;

  if (useRoi) {
    return {
      mode: "roi-full-res",
      scale: 1,
      width: Math.round(input.sourceWidth),
      height: Math.round(input.sourceHeight),
      radiusDevice: radiusDeviceFull,
      points: fullPoints,
      estimatedRoiPixels,
    };
  }

  const scale = studioLiquifyLivePreviewScale(
    input.sourceWidth,
    input.sourceHeight,
    input.maxEdge,
  );
  const width = Math.max(1, Math.round(input.sourceWidth * scale));
  const height = Math.max(1, Math.round(input.sourceHeight * scale));
  const points = thinned.map((point) => ({
    x: point.x * width,
    y: point.y * height,
    ...(point.pressure === undefined ? {} : { pressure: point.pressure }),
  }));
  return {
    mode: "frame-downscale",
    scale,
    width,
    height,
    radiusDevice: radiusDeviceFull * scale,
    points,
    estimatedRoiPixels,
  };
}

/**
 * Map a source-pixel ROI onto a document-space image frame (optional axis flips).
 * Rotation is applied at the ROI top-left; callers with non-zero rotation accept this approx
 * (raster liquify layers are typically unrotated at edit time).
 */
export function mapLiquifyRoiToDocumentFrame(
  region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  sourceWidth: number,
  sourceHeight: number,
  frame: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly rotation: number;
  },
  flipX = false,
  flipY = false,
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
} {
  const sw = Math.max(1, sourceWidth);
  const sh = Math.max(1, sourceHeight);
  const localX = (region.x / sw) * frame.width;
  const localY = (region.y / sh) * frame.height;
  const localW = (region.width / sw) * frame.width;
  const localH = (region.height / sh) * frame.height;
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  return {
    x: frame.x + (flipX ? frame.width - localX : localX),
    y: frame.y + (flipY ? frame.height - localY : localY),
    width: localW,
    height: localH,
    scaleX: sx,
    scaleY: sy,
    rotation: frame.rotation,
  };
}
