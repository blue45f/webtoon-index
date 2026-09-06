/**
 * Pure geometry and pixel helpers for the Studio reference-board color sampler.
 *
 * Reference items are laid out in board pixels, then transformed around their center by CSS in
 * this order: translate-to-center, rotate, scale/flip. Sampling applies the exact inverse before
 * resolving the centered `object-contain` image rectangle. No document or panel state belongs in
 * this module.
 */

export const STUDIO_REFERENCE_COLOR_MAX_DECODED_PIXELS = 16_777_216;
export const STUDIO_REFERENCE_COLOR_DEFAULT_PALETTE_SIZE = 6;
export const STUDIO_REFERENCE_COLOR_MAX_PALETTE_SIZE = 12;
export const STUDIO_REFERENCE_COLOR_PALETTE_SAMPLE_BUDGET = 16_384;

const DEFAULT_FRAME_LONG_SIDE_PERCENT = 54;
const DEFAULT_QUANTIZE_STEP = 32;
const DEFAULT_PALETTE_ALPHA_THRESHOLD = 20;
const LOCAL_RASTER_DATA_URL_PATTERN = /^data:image\/(?:gif|jpeg|png|webp)(?:;|,)/iu;

export interface StudioReferencePoint {
  x: number;
  y: number;
}

export interface StudioReferenceSourcePixel {
  x: number;
  y: number;
}

export interface StudioReferenceColorSampleGeometry {
  /** Board viewport dimensions in CSS pixels. */
  boardWidth: number;
  boardHeight: number;
  /** Item center normalized to the board viewport. */
  centerX: number;
  centerY: number;
  /** Untransformed item frame dimensions in CSS pixels. */
  frameWidth: number;
  frameHeight: number;
  /** Decoded source dimensions in pixels. */
  sourceWidth: number;
  sourceHeight: number;
  zoom: number;
  rotationDeg: number;
  flipX: boolean;
  flipY: boolean;
}

export interface StudioReferenceImageRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface StudioReferencePaletteOptions {
  count?: number;
  quantizeStep?: number;
  alphaThreshold?: number;
  sampleBudget?: number;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function finiteUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function byte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function hexByte(value: number): string {
  return byte(value).toString(16).padStart(2, "0");
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/** Only browser-owned raster data URLs are eligible for pixel inspection. */
export function isStudioReferenceLocalRasterDataUrl(value: unknown): value is string {
  return typeof value === "string" && LOCAL_RASTER_DATA_URL_PATTERN.test(value);
}

/**
 * Mirrors the reference panel's intrinsic-aspect frame sizing. The longer intrinsic side occupies
 * 54% of the board by default and the other side shrinks proportionally.
 */
export function studioReferenceItemFramePercent(
  sourceWidth: number,
  sourceHeight: number,
  longSidePercent = DEFAULT_FRAME_LONG_SIDE_PERCENT
): { width: number; height: number } {
  const resolvedLongSide = finitePositive(longSidePercent)
    ? longSidePercent
    : DEFAULT_FRAME_LONG_SIDE_PERCENT;
  if (!finitePositive(sourceWidth) || !finitePositive(sourceHeight)) {
    return { width: resolvedLongSide, height: resolvedLongSide };
  }
  const aspect = Math.max(0.05, Math.min(20, sourceWidth / sourceHeight));
  return aspect >= 1
    ? { width: resolvedLongSide, height: resolvedLongSide / aspect }
    : { width: resolvedLongSide * aspect, height: resolvedLongSide };
}

/**
 * Maps a point in board-local CSS pixels to an integer source pixel. Returns null for invalid
 * geometry, points outside the transformed `object-contain` image, or its letterbox/pillarbox.
 */
export function mapStudioReferenceBoardPointToSourcePixel(
  point: StudioReferencePoint,
  geometry: StudioReferenceColorSampleGeometry
): StudioReferenceSourcePixel | null {
  if (
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || !finitePositive(geometry.boardWidth)
    || !finitePositive(geometry.boardHeight)
    || !finiteUnit(geometry.centerX)
    || !finiteUnit(geometry.centerY)
    || !finitePositive(geometry.frameWidth)
    || !finitePositive(geometry.frameHeight)
    || !Number.isSafeInteger(geometry.sourceWidth)
    || !Number.isSafeInteger(geometry.sourceHeight)
    || geometry.sourceWidth < 1
    || geometry.sourceHeight < 1
    || !finitePositive(geometry.zoom)
    || !Number.isFinite(geometry.rotationDeg)
  ) {
    return null;
  }

  const centerPixelX = geometry.centerX * geometry.boardWidth;
  const centerPixelY = geometry.centerY * geometry.boardHeight;
  const translatedX = point.x - centerPixelX;
  const translatedY = point.y - centerPixelY;

  // Inverse CSS rotate(theta): rotate(-theta).
  const radians = geometry.rotationDeg * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const inverseRotatedX = translatedX * cosine + translatedY * sine;
  const inverseRotatedY = -translatedX * sine + translatedY * cosine;

  // CSS scale uses a negative axis for a flip. Division applies scale and flip inverses together.
  const localX = inverseRotatedX / (geometry.zoom * (geometry.flipX ? -1 : 1));
  const localY = inverseRotatedY / (geometry.zoom * (geometry.flipY ? -1 : 1));

  const containScale = Math.min(
    geometry.frameWidth / geometry.sourceWidth,
    geometry.frameHeight / geometry.sourceHeight
  );
  const renderedWidth = geometry.sourceWidth * containScale;
  const renderedHeight = geometry.sourceHeight * containScale;
  if (!finitePositive(renderedWidth) || !finitePositive(renderedHeight)) return null;

  // object-contain is centered in the item frame, so its local origin is half the rendered size
  // from the transform origin regardless of letterbox/pillarbox size.
  const imageX = localX + renderedWidth / 2;
  const imageY = localY + renderedHeight / 2;
  if (imageX < 0 || imageY < 0 || imageX >= renderedWidth || imageY >= renderedHeight) {
    return null;
  }

  const sourceX = Math.floor(imageX / renderedWidth * geometry.sourceWidth);
  const sourceY = Math.floor(imageY / renderedHeight * geometry.sourceHeight);
  if (
    sourceX < 0
    || sourceY < 0
    || sourceX >= geometry.sourceWidth
    || sourceY >= geometry.sourceHeight
  ) {
    return null;
  }
  return { x: sourceX, y: sourceY };
}

/** Converts one RGBA pixel to lowercase #rrggbb. Fully transparent pixels have no selectable color. */
export function studioReferenceRgbaToHex(
  red: number,
  green: number,
  blue: number,
  alpha: number
): string | null {
  if (!Number.isFinite(alpha) || alpha <= 0) return null;
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

/** Reads one source pixel from an RGBA raster, rejecting malformed buffers and out-of-range points. */
export function sampleStudioReferenceRasterPixel(
  raster: StudioReferenceImageRaster,
  pixel: StudioReferenceSourcePixel | null
): string | null {
  if (
    !pixel
    || !Number.isSafeInteger(raster.width)
    || !Number.isSafeInteger(raster.height)
    || raster.width < 1
    || raster.height < 1
    || !Number.isSafeInteger(pixel.x)
    || !Number.isSafeInteger(pixel.y)
    || pixel.x < 0
    || pixel.y < 0
    || pixel.x >= raster.width
    || pixel.y >= raster.height
  ) {
    return null;
  }
  const requiredLength = raster.width * raster.height * 4;
  if (!Number.isSafeInteger(requiredLength) || raster.data.length < requiredLength) return null;
  const offset = (pixel.y * raster.width + pixel.x) * 4;
  return studioReferenceRgbaToHex(
    raster.data[offset] ?? 0,
    raster.data[offset + 1] ?? 0,
    raster.data[offset + 2] ?? 0,
    raster.data[offset + 3] ?? 0
  );
}

/** Maps and samples in one call for pointer and keyboard interactions. */
export function sampleStudioReferenceColorAtBoardPoint(
  raster: StudioReferenceImageRaster,
  point: StudioReferencePoint,
  geometry: Omit<StudioReferenceColorSampleGeometry, "sourceWidth" | "sourceHeight">
): string | null {
  return sampleStudioReferenceRasterPixel(
    raster,
    mapStudioReferenceBoardPointToSourcePixel(point, {
      ...geometry,
      sourceWidth: raster.width,
      sourceHeight: raster.height,
    })
  );
}

/**
 * Produces a bounded, deterministic dominant-color palette from RGBA bytes. Large rasters are
 * sampled with a stable pixel stride so palette work remains capped independently of image size.
 */
export function extractStudioReferencePalette(
  raster: StudioReferenceImageRaster,
  options: StudioReferencePaletteOptions = {}
): string[] {
  if (
    !Number.isSafeInteger(raster.width)
    || !Number.isSafeInteger(raster.height)
    || raster.width < 1
    || raster.height < 1
  ) {
    return [];
  }
  const pixelCount = raster.width * raster.height;
  const requiredLength = pixelCount * 4;
  if (!Number.isSafeInteger(requiredLength) || raster.data.length < requiredLength) return [];

  const count = boundedInteger(
    options.count,
    STUDIO_REFERENCE_COLOR_DEFAULT_PALETTE_SIZE,
    1,
    STUDIO_REFERENCE_COLOR_MAX_PALETTE_SIZE
  );
  const quantizeStep = boundedInteger(options.quantizeStep, DEFAULT_QUANTIZE_STEP, 1, 128);
  const alphaThreshold = boundedInteger(options.alphaThreshold, DEFAULT_PALETTE_ALPHA_THRESHOLD, 0, 255);
  const sampleBudget = boundedInteger(
    options.sampleBudget,
    STUDIO_REFERENCE_COLOR_PALETTE_SAMPLE_BUDGET,
    1,
    STUDIO_REFERENCE_COLOR_MAX_DECODED_PIXELS
  );
  const pixelStride = Math.max(1, Math.ceil(pixelCount / sampleBudget));
  const frequency = new Map<number, number>();

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += pixelStride) {
    const offset = pixelIndex * 4;
    const alpha = raster.data[offset + 3] ?? 0;
    if (alpha < alphaThreshold) continue;
    const red = Math.min(255, Math.round((raster.data[offset] ?? 0) / quantizeStep) * quantizeStep);
    const green = Math.min(255, Math.round((raster.data[offset + 1] ?? 0) / quantizeStep) * quantizeStep);
    const blue = Math.min(255, Math.round((raster.data[offset + 2] ?? 0) / quantizeStep) * quantizeStep);
    const key = (red << 16) | (green << 8) | blue;
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }

  return [...frequency.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, count)
    .map(([key]) => `#${hexByte((key >> 16) & 0xff)}${hexByte((key >> 8) & 0xff)}${hexByte(key & 0xff)}`);
}

/** Decode a selected local reference once so palette and exact-pixel sampling share the same bytes. */
export function loadStudioReferenceImageRaster(
  dataUrl: string,
  options: { signal?: AbortSignal; maximumPixels?: number } = {}
): Promise<StudioReferenceImageRaster> {
  if (!isStudioReferenceLocalRasterDataUrl(dataUrl)) {
    return Promise.reject(new Error("로컬 PNG, JPG, WebP 또는 GIF 참고 이미지만 색상을 추출할 수 있습니다."));
  }
  const maximumPixels = boundedInteger(
    options.maximumPixels,
    STUDIO_REFERENCE_COLOR_MAX_DECODED_PIXELS,
    1,
    STUDIO_REFERENCE_COLOR_MAX_DECODED_PIXELS
  );
  const signal = options.signal;

  return new Promise((resolve, reject) => {
    const image = new globalThis.Image();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => {
      image.src = "";
      reject(new DOMException("참고 이미지 색상 분석을 취소했습니다.", "AbortError"));
    });

    image.onerror = () => finish(() => reject(new Error("참고 이미지를 불러오지 못했습니다.")));
    image.onload = () => finish(() => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      const pixels = width * height;
      if (
        !Number.isSafeInteger(width)
        || !Number.isSafeInteger(height)
        || width < 1
        || height < 1
        || !Number.isSafeInteger(pixels)
        || pixels > maximumPixels
      ) {
        reject(new Error("참고 이미지 해상도가 색상 분석 안전 한도를 초과합니다."));
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      try {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("색상 분석 캔버스를 만들 수 없습니다.");
        context.drawImage(image, 0, 0, width, height);
        const imageData = context.getImageData(0, 0, width, height);
        resolve({ width, height, data: new Uint8ClampedArray(imageData.data) });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("참고 이미지 픽셀을 읽지 못했습니다."));
      } finally {
        // Release the backing store immediately; the copied RGBA bytes are the only retained data.
        canvas.width = 1;
        canvas.height = 1;
      }
    });

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    image.decoding = "async";
    image.src = dataUrl;
  });
}
