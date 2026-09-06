/**
 * Browser-side raster allocation guard for Advanced Fill.
 *
 * 4096² keeps a single RGBA backing store at or below 64 MiB while still accepting UHD and a
 * 720 × 20,000 long-webtoon source. The pure fill engine has its own broader algorithmic limit;
 * this lower cap protects the browser before ImageData/canvas backing stores are allocated.
 */
export const STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS = 16 * 1024 * 1024;
export const STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS = 8 * 1024 * 1024;

export type StudioAdvancedFillRasterSizeErrorCode =
  | "invalid-number"
  | "non-integer"
  | "unsafe-integer"
  | "non-positive"
  | "pixel-count-overflow"
  | "pixel-cap-exceeded";

export interface StudioAdvancedFillRasterDimensions {
  width: number;
  height: number;
  pixelCount: number;
}

/** A typed failure that UI code can convert to stable, user-facing Korean copy. */
export class StudioAdvancedFillRasterSizeError extends RangeError {
  readonly code: StudioAdvancedFillRasterSizeErrorCode;
  readonly width: unknown;
  readonly height: unknown;
  readonly pixelCount?: number;
  readonly maxPixelCount: number;

  constructor(
    code: StudioAdvancedFillRasterSizeErrorCode,
    width: unknown,
    height: unknown,
    pixelCount?: number,
    maxPixelCount = STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS,
  ) {
    super("고급 채우기 이미지 크기가 브라우저의 안전 범위를 벗어났습니다.");
    this.name = "StudioAdvancedFillRasterSizeError";
    this.code = code;
    this.width = width;
    this.height = height;
    this.pixelCount = pixelCount;
    this.maxPixelCount = maxPixelCount;
  }
}

export interface StudioAdvancedFillBrowserCapabilities {
  coarsePointer?: boolean;
  deviceMemoryGb?: number;
  maxTouchPoints?: number;
}

export function resolveStudioAdvancedFillBrowserMaxPixels(
  capabilities: StudioAdvancedFillBrowserCapabilities = {},
): number {
  const memoryConstrained =
    typeof capabilities.deviceMemoryGb === "number" &&
    Number.isFinite(capabilities.deviceMemoryGb) &&
    capabilities.deviceMemoryGb > 0 &&
    capabilities.deviceMemoryGb <= 4;
  return capabilities.coarsePointer || (capabilities.maxTouchPoints ?? 0) > 0 || memoryConstrained
    ? STUDIO_ADVANCED_FILL_MOBILE_MAX_PIXELS
    : STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS;
}

export function currentStudioAdvancedFillBrowserMaxPixels(): number {
  let coarsePointer = false;
  try {
    coarsePointer = typeof globalThis.matchMedia === "function" && globalThis.matchMedia("(pointer: coarse)").matches;
  } catch {
    // Restricted embedded browsers can block matchMedia; the remaining capabilities still apply.
  }
  const runtimeNavigator = typeof navigator === "undefined"
    ? undefined
    : navigator as Navigator & { deviceMemory?: number };
  return resolveStudioAdvancedFillBrowserMaxPixels({
    coarsePointer,
    deviceMemoryGb: runtimeNavigator?.deviceMemory,
    maxTouchPoints: runtimeNavigator?.maxTouchPoints,
  });
}

/**
 * Validates decoded natural dimensions before any canvas or ImageData allocation.
 *
 * The multiplication guard intentionally precedes the pixel-cap check: two individually safe
 * dimensions can still produce an unsafe product and must never be rounded into an accepted size.
 */
export function validateStudioAdvancedFillRasterDimensions(
  width: unknown,
  height: unknown,
  maxPixelCount = STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS,
): StudioAdvancedFillRasterDimensions {
  const safeMaxPixelCount = Number.isSafeInteger(maxPixelCount) && maxPixelCount > 0
    ? Math.min(maxPixelCount, STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS)
    : STUDIO_ADVANCED_FILL_BROWSER_MAX_PIXELS;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new StudioAdvancedFillRasterSizeError("invalid-number", width, height, undefined, safeMaxPixelCount);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new StudioAdvancedFillRasterSizeError("non-integer", width, height, undefined, safeMaxPixelCount);
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new StudioAdvancedFillRasterSizeError("unsafe-integer", width, height, undefined, safeMaxPixelCount);
  }
  if (width <= 0 || height <= 0) {
    throw new StudioAdvancedFillRasterSizeError("non-positive", width, height, undefined, safeMaxPixelCount);
  }
  if (width > Math.floor(Number.MAX_SAFE_INTEGER / height)) {
    throw new StudioAdvancedFillRasterSizeError("pixel-count-overflow", width, height, undefined, safeMaxPixelCount);
  }

  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount)) {
    throw new StudioAdvancedFillRasterSizeError("pixel-count-overflow", width, height, undefined, safeMaxPixelCount);
  }
  if (pixelCount > safeMaxPixelCount) {
    throw new StudioAdvancedFillRasterSizeError("pixel-cap-exceeded", width, height, pixelCount, safeMaxPixelCount);
  }

  return { width, height, pixelCount };
}

function formatInteger(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Converts validation failures into actionable Korean UI copy without exposing engine internals. */
export function formatStudioAdvancedFillRasterSizeError(error: unknown): string {
  if (!(error instanceof StudioAdvancedFillRasterSizeError)) {
    return "고급 채우기용 이미지 크기를 확인하지 못했습니다. 이미지를 다시 불러온 뒤 시도해 주세요.";
  }

  switch (error.code) {
    case "invalid-number":
      return "고급 채우기 이미지의 가로·세로 픽셀 정보를 확인할 수 없습니다. 이미지를 다시 불러오거나 다른 형식으로 변환해 주세요.";
    case "non-integer":
      return "고급 채우기 이미지 크기는 정수 픽셀이어야 합니다. 이미지를 다시 불러온 뒤 시도해 주세요.";
    case "non-positive":
      return "고급 채우기 이미지의 가로·세로 크기는 1픽셀 이상이어야 합니다. 이미지 파일을 확인해 주세요.";
    case "unsafe-integer":
    case "pixel-count-overflow":
      return "이미지가 브라우저에서 안전하게 계산할 수 있는 크기 범위를 벗어났습니다. 이미지를 나누거나 해상도를 낮춰 주세요.";
    case "pixel-cap-exceeded": {
      const dimensions =
        typeof error.width === "number" && typeof error.height === "number"
          ? `${formatInteger(error.width)} × ${formatInteger(error.height)}`
          : "확인할 수 없는 크기";
      const pixelCount = error.pixelCount === undefined ? "" : ` (${formatInteger(error.pixelCount)}픽셀)`;
      return `고급 채우기는 브라우저 메모리 보호를 위해 이 기기에서 최대 ${formatInteger(error.maxPixelCount)}픽셀까지 지원합니다. 현재 이미지는 ${dimensions}${pixelCount}입니다. 이미지를 나누거나 해상도를 낮춘 뒤 다시 시도해 주세요.`;
    }
  }
}
