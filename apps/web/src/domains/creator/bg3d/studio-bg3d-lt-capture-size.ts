/**
 * Resolves a bounded line-and-tone capture size before any canvas or RGBA allocation happens.
 *
 * The persisted scene may request up to 4096px in height, while a mobile quality profile can have
 * a much smaller pixel budget. Keeping this calculation DOM-free lets the editor, worker, tests,
 * and future render engines share the same admission decision.
 */

export const STUDIO_BG3D_LT_CAPTURE_MIN_HEIGHT = 256;
export const STUDIO_BG3D_LT_CAPTURE_MAX_HEIGHT = 4_096;
export const STUDIO_BG3D_LT_CAPTURE_MAX_EDGE = 8_192;
export const STUDIO_BG3D_LT_CAPTURE_MAX_PIXELS = 16_777_216;

export interface StudioBg3dLtCaptureSizeInput {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /**
   * Explicit capture aspect (width / height). Omit to keep the legacy behaviour of following the
   * live source aspect. An explicit ratio is what makes an insert reproducible: the same scene must
   * not change composition because the 3D panel was resized.
   */
  readonly aspectRatio?: number;
  readonly requestedHeight: number;
  readonly maxPixels: number;
  readonly maxEdge?: number;
}

export interface StudioBg3dLtCaptureSize {
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  readonly requestedHeight: number;
  readonly wasReduced: boolean;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function captureWidth(aspectRatio: number, height: number): number {
  return Math.max(1, Math.round(aspectRatio * height));
}

/**
 * Returns null instead of normalizing hostile or non-canonical input. A valid result always fits
 * both the pixel budget and edge budget and never exceeds the requested height.
 */
export function resolveStudioBg3dLtCaptureSize(
  input: StudioBg3dLtCaptureSizeInput
): StudioBg3dLtCaptureSize | null {
  const maxEdge = input.maxEdge ?? STUDIO_BG3D_LT_CAPTURE_MAX_EDGE;
  if (
    !isPositiveInteger(input.sourceWidth) ||
    !isPositiveInteger(input.sourceHeight) ||
    !isPositiveInteger(input.requestedHeight) ||
    input.requestedHeight < STUDIO_BG3D_LT_CAPTURE_MIN_HEIGHT ||
    input.requestedHeight > STUDIO_BG3D_LT_CAPTURE_MAX_HEIGHT ||
    !isPositiveInteger(input.maxPixels) ||
    input.maxPixels > STUDIO_BG3D_LT_CAPTURE_MAX_PIXELS ||
    !isPositiveInteger(maxEdge) ||
    maxEdge > STUDIO_BG3D_LT_CAPTURE_MAX_EDGE
  ) {
    return null;
  }

  // An omitted ratio keeps the historical source-derived framing bit-for-bit; an explicit ratio
  // replaces only the shape, never the budget guards below.
  const aspectRatio = input.aspectRatio === undefined
    ? input.sourceWidth / input.sourceHeight
    : input.aspectRatio;
  if (typeof aspectRatio !== "number" || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return null;
  }

  const heightByWidthEdge = Math.max(1, Math.floor(maxEdge / aspectRatio));
  const heightByPixels = Math.max(1, Math.floor(Math.sqrt(input.maxPixels / aspectRatio)));
  let height = Math.min(input.requestedHeight, maxEdge, heightByWidthEdge, heightByPixels);
  let width = captureWidth(aspectRatio, height);

  // Rounding width can exceed an exact edge/pixel boundary by one. Reduce deterministically until
  // both hard limits hold; this loop runs at most a handful of times.
  while ((width > maxEdge || width * height > input.maxPixels) && height > 1) {
    height -= 1;
    width = captureWidth(aspectRatio, height);
  }

  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(pixelCount) ||
    width < 1 ||
    height < 1 ||
    width > maxEdge ||
    height > maxEdge ||
    pixelCount > input.maxPixels
  ) {
    return null;
  }

  return Object.freeze({
    width,
    height,
    pixelCount,
    requestedHeight: input.requestedHeight,
    wasReduced: height < input.requestedHeight,
  });
}

export interface StudioBg3dShotCaptureSizeInput {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /**
   * Optional document/export aspect (width / height). When finite and > 0, capture composition
   * freezes to this ratio regardless of the live source viewport — matching LT insert capture.
   * null/undefined/non-finite values keep the legacy source-derived aspect.
   */
  readonly exportAspectRatio?: number | null;
  readonly requestedHeight: number;
  readonly maxPixels: number;
  readonly maxEdge?: number;
}

/**
 * Shot/batch capture size admission. Same budgets as {@link resolveStudioBg3dLtCaptureSize}; when
 * `exportAspectRatio` is a finite positive number it is forwarded as an explicit aspect so two
 * different source viewports produce the same raster for a fixed document ratio.
 */
export function resolveStudioBg3dShotCaptureSize(
  input: StudioBg3dShotCaptureSizeInput,
): StudioBg3dLtCaptureSize | null {
  if (typeof input !== "object" || input === null) return null;
  const exportAspectRatio = input.exportAspectRatio;
  const aspectRatio =
    typeof exportAspectRatio === "number" &&
    Number.isFinite(exportAspectRatio) &&
    exportAspectRatio > 0
      ? exportAspectRatio
      : undefined;
  return resolveStudioBg3dLtCaptureSize({
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    requestedHeight: input.requestedHeight,
    maxPixels: input.maxPixels,
    maxEdge: input.maxEdge,
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
  });
}
