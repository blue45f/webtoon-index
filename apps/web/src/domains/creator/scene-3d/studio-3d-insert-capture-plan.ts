/**
 * Deterministic sizing for 3D→canvas insert captures.
 *
 * A 3D editor knows the logical size its capture will occupy on the document at 100% zoom
 * (display units). Rendering the offscreen capture at exactly that size looks soft on any
 * HiDPI screen (the Konva stage rasterizes at devicePixelRatio) and falls apart the moment
 * the artist scales the layer up. This module turns the display size into a capture pixel
 * size at `devicePixelRatio × supersample`, bounded by the same hard budgets the LT capture
 * pipeline enforces, so every insert surface (VRM poser today, bg3d/mannequin via spec)
 * shares one auditable admission decision.
 *
 * The function is DOM-free and pure: identical inputs always produce identical plans.
 */

import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "../bg3d/studio-bg3d-lt-render";
import { STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION } from "../bg3d/studio-bg3d-shot-batch-limits";

/** Extra density beyond devicePixelRatio so a moderate scale-up on canvas stays crisp. */
export const STUDIO_3D_INSERT_CAPTURE_SUPERSAMPLE = 2;
/** Hard ceiling on capture density — 4× a 520px-tall insert is ~3MP, well inside budgets. */
export const STUDIO_3D_INSERT_CAPTURE_MAX_SCALE = 4;
/** devicePixelRatio is a device signal, not document data; clamp instead of failing closed. */
export const STUDIO_3D_INSERT_CAPTURE_MAX_DPR = 3;

export interface Studio3dInsertCapturePlanInput {
  /** Logical width the insert will occupy on the document at 100% zoom, in canvas units. */
  readonly displayWidth: number;
  /** Logical height the insert will occupy on the document at 100% zoom, in canvas units. */
  readonly displayHeight: number;
  /** Runtime `globalThis.devicePixelRatio`; non-finite or sub-1 values are treated as 1. */
  readonly devicePixelRatio: number;
  /** Hard pixel budget for the capture raster. Defaults to the LT render budget. */
  readonly maxPixels?: number;
  /** Hard per-edge budget for the capture raster. Defaults to the shot batch dimension cap. */
  readonly maxEdge?: number;
}

export interface Studio3dInsertCapturePlan {
  /** Capture raster width in pixels. */
  readonly width: number;
  /** Capture raster height in pixels. */
  readonly height: number;
  /** Achieved density relative to the display size (height / displayHeight). */
  readonly scale: number;
  /** True when a budget forced the plan below the ideal dpr × supersample density. */
  readonly wasReduced: boolean;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Returns null instead of normalizing hostile display geometry. A valid plan always fits both
 * hard budgets, never drops below the display size unless the display itself exceeds a budget,
 * and preserves the display aspect ratio to within integer rounding.
 */
export function planStudio3dInsertCaptureSize(
  input: Studio3dInsertCapturePlanInput,
): Studio3dInsertCapturePlan | null {
  const maxPixels = input.maxPixels ?? STUDIO_BG3D_LT_RENDER_MAX_PIXELS;
  const maxEdge = input.maxEdge ?? STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION;
  if (
    !isPositiveFinite(input.displayWidth) ||
    !isPositiveFinite(input.displayHeight) ||
    !Number.isSafeInteger(Math.round(input.displayWidth)) ||
    !Number.isSafeInteger(Math.round(input.displayHeight)) ||
    !isPositiveFinite(maxPixels) ||
    !Number.isSafeInteger(maxPixels) ||
    maxPixels > STUDIO_BG3D_LT_RENDER_MAX_PIXELS ||
    !isPositiveFinite(maxEdge) ||
    !Number.isSafeInteger(maxEdge) ||
    maxEdge > STUDIO_BG3D_SHOT_BATCH_MAX_DIMENSION
  ) {
    return null;
  }

  const displayWidth = input.displayWidth;
  const displayHeight = input.displayHeight;
  const aspectRatio = displayWidth / displayHeight;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;

  const dpr = isPositiveFinite(input.devicePixelRatio)
    ? Math.min(STUDIO_3D_INSERT_CAPTURE_MAX_DPR, Math.max(1, input.devicePixelRatio))
    : 1;
  const idealScale = Math.min(
    STUDIO_3D_INSERT_CAPTURE_MAX_SCALE,
    dpr * STUDIO_3D_INSERT_CAPTURE_SUPERSAMPLE,
  );
  const idealHeight = Math.max(1, Math.round(displayHeight * idealScale));

  const heightByHeightEdge = maxEdge;
  const heightByWidthEdge = Math.max(1, Math.floor(maxEdge / aspectRatio));
  const heightByPixels = Math.max(1, Math.floor(Math.sqrt(maxPixels / aspectRatio)));
  let height = Math.min(idealHeight, heightByHeightEdge, heightByWidthEdge, heightByPixels);
  let width = Math.max(1, Math.round(aspectRatio * height));

  // Rounding width can exceed an exact edge/pixel boundary by one. Reduce deterministically
  // until both hard limits hold; this loop runs at most a handful of times.
  while ((width > maxEdge || width * height > maxPixels) && height > 1) {
    height -= 1;
    width = Math.max(1, Math.round(aspectRatio * height));
  }

  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount) ||
    width < 1 ||
    height < 1 ||
    width > maxEdge ||
    height > maxEdge ||
    pixelCount > maxPixels
  ) {
    return null;
  }

  return Object.freeze({
    width,
    height,
    scale: height / displayHeight,
    wasReduced: height < idealHeight,
  });
}
