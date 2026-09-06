/**
 * PSD layer-mask import bridge.
 *
 * ag-psd exposes a mask as opaque grayscale RGB pixels. Studio stores the same
 * visibility values as the alpha channel of an otherwise-white PNG. Keeping
 * this conversion here makes imported masks editable by Studio's existing
 * non-destructive layer-mask tools instead of baking them into the layer.
 */
import type { LayerMaskData, PixelArray, PixelData } from "ag-psd";

export const PSD_IMPORTED_MASK_MAX_WIDTH = 1280;
export const PSD_IMPORTED_MASK_MAX_PIXELS = 16_777_216;
export const PSD_IMPORTED_MASK_MAX_FEATHER_PX = 64;

export type PsdLayerMaskKind = "primary" | "real";

export interface PsdLayerMaskSource {
  kind: PsdLayerMaskKind;
  mask: LayerMaskData;
  /** Density/feather parameters are stored on the primary mask descriptor even
   * when the pixel channel itself is the PSD "real user mask" channel. */
  parameterMask?: LayerMaskData;
}

export interface PsdLayerMaskRasterInput {
  layerLeft: number;
  layerTop: number;
  layerPixelWidth: number;
  layerPixelHeight: number;
  /** Effective channels to import. A PSD real-user-mask channel is already the
   * final pixel+vector composite and therefore remains the sole authoritative
   * source when present. */
  masks: readonly PsdLayerMaskSource[];
  /** Primary/user channel retained only as a non-destructive recovery source
   * when the authoritative real-user-mask pixels are missing or malformed. */
  fallbackMask?: PsdLayerMaskSource;
  maxWidth?: number;
  maxPixels?: number;
}

export interface PsdLayerMaskRasterResult {
  maskSrc?: string;
  /** Studio defaults an omitted value to enabled. Preserve Photoshop's explicit
   * disabled state without throwing away the imported editable pixels. */
  disabled?: boolean;
  warnings: string[];
}

export interface PsdLayerMaskRasterPlan {
  outputWidth: number;
  outputHeight: number;
  proxyScale: number;
  maskPixelWidth: number;
  maskPixelHeight: number;
  destinationLeft: number;
  destinationTop: number;
  destinationWidth: number;
  destinationHeight: number;
  defaultAlpha: number;
  density: number;
  featherPx: number;
  featherWasClamped: boolean;
}

function optionalSafeInteger(value: number | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positiveInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function maskPixelDimensions(mask: LayerMaskData): { width: number; height: number } | null {
  if (mask.imageData) {
    const width = positiveInteger(mask.imageData.width);
    const height = positiveInteger(mask.imageData.height);
    return width && height ? { width, height } : null;
  }
  if (mask.canvas) {
    const width = positiveInteger(mask.canvas.width);
    const height = positiveInteger(mask.canvas.height);
    return width && height ? { width, height } : null;
  }
  return null;
}

/** Photoshop density: 0 means reveal everything, 1 means use the stored mask. */
export function applyPsdMaskDensity(value: number, density: number): number {
  const sample = clamp(Number.isFinite(value) ? value : 255, 0, 255);
  const amount = clamp(Number.isFinite(density) ? density : 1, 0, 1);
  return Math.round(255 - amount * (255 - sample));
}

function maskDensity(mask: LayerMaskData, parameterMask: LayerMaskData): number {
  const value = mask.fromVectorData
    ? parameterMask.vectorMaskDensity
    : parameterMask.userMaskDensity;
  if (value === undefined) return 1;
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : Number.NaN;
}

function maskFeather(mask: LayerMaskData, parameterMask: LayerMaskData): number {
  const value = mask.fromVectorData
    ? parameterMask.vectorMaskFeather
    : parameterMask.userMaskFeather;
  if (value === undefined) return 0;
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
}

function typedMaskSample(data: PixelArray, offset: number): number | null {
  const value = data[offset];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (data instanceof Uint16Array) return Math.round(value / 257);
  if (data instanceof Float32Array) return Math.round(clamp(value, 0, 1) * 255);
  return clamp(Math.round(value), 0, 255);
}

/**
 * Converts ag-psd's RGBA grayscale pixels into Studio's white-RGB/alpha mask.
 * Malformed lengths and non-finite float samples fail closed instead of
 * manufacturing a destructive all-black mask.
 */
export function convertPsdMaskPixelsToStudioAlpha(
  data: PixelArray,
  width: number,
  height: number,
  density = 1,
): Uint8ClampedArray | null {
  if (
    !(data instanceof Uint8ClampedArray)
    && !(data instanceof Uint8Array)
    && !(data instanceof Uint16Array)
    && !(data instanceof Float32Array)
  ) return null;
  const w = positiveInteger(width);
  const h = positiveInteger(height);
  if (!w || !h || w * h > PSD_IMPORTED_MASK_MAX_PIXELS) return null;
  const required = w * h * 4;
  if (data.length !== required) return null;

  const output = new Uint8ClampedArray(required);
  for (let i = 0; i < required; i += 4) {
    const sample = typedMaskSample(data, i);
    if (sample === null) return null;
    output[i] = 255;
    output[i + 1] = 255;
    output[i + 2] = 255;
    output[i + 3] = applyPsdMaskDensity(sample, density);
  }
  return output;
}

/** Pure coordinate/scale plan used both by the DOM rasterizer and unit tests. */
export function planPsdLayerMaskRaster(
  input: Omit<PsdLayerMaskRasterInput, "masks"> & {
    mask: LayerMaskData;
    parameterMask?: LayerMaskData;
  },
): PsdLayerMaskRasterPlan | null {
  const layerWidth = positiveInteger(input.layerPixelWidth);
  const layerHeight = positiveInteger(input.layerPixelHeight);
  const dimensions = maskPixelDimensions(input.mask);
  if (!layerWidth || !layerHeight || !dimensions) return null;

  const maxWidth = positiveInteger(input.maxWidth ?? PSD_IMPORTED_MASK_MAX_WIDTH);
  const maxPixels = positiveInteger(input.maxPixels ?? PSD_IMPORTED_MASK_MAX_PIXELS);
  if (!maxWidth || !maxPixels || dimensions.width * dimensions.height > maxPixels) return null;

  const declaredLeft = optionalSafeInteger(input.mask.left, 0);
  const declaredTop = optionalSafeInteger(input.mask.top, 0);
  const declaredRight = optionalSafeInteger(input.mask.right, dimensions.width);
  const declaredBottom = optionalSafeInteger(input.mask.bottom, dimensions.height);
  const layerLeft = optionalSafeInteger(input.layerLeft, 0);
  const layerTop = optionalSafeInteger(input.layerTop, 0);
  if (
    declaredLeft === null
    || declaredTop === null
    || declaredRight === null
    || declaredBottom === null
    || layerLeft === null
    || layerTop === null
  ) return null;
  const boundsWidth = declaredRight - declaredLeft;
  const boundsHeight = declaredBottom - declaredTop;
  // A channel whose declared rectangle disagrees with its decoded pixel buffer
  // is malformed. Stretching it would make the imported mask silently drift.
  if (boundsWidth !== dimensions.width || boundsHeight !== dimensions.height) return null;

  const proxyScale = Math.min(1, maxWidth / layerWidth);
  const outputWidth = Math.max(1, Math.round(layerWidth * proxyScale));
  const outputHeight = Math.max(1, Math.round(layerHeight * proxyScale));
  if (outputWidth * outputHeight > maxPixels) return null;

  const localLeft = input.mask.positionRelativeToLayer
    ? declaredLeft
    : declaredLeft - layerLeft;
  const localTop = input.mask.positionRelativeToLayer
    ? declaredTop
    : declaredTop - layerTop;
  const destinationLeft = Math.round(localLeft * proxyScale);
  const destinationTop = Math.round(localTop * proxyScale);
  const destinationRight = Math.round((localLeft + dimensions.width) * proxyScale);
  const destinationBottom = Math.round((localTop + dimensions.height) * proxyScale);
  const parameterMask = input.parameterMask ?? input.mask;
  const density = maskDensity(input.mask, parameterMask);
  const feather = maskFeather(input.mask, parameterMask);
  const defaultColor = input.mask.defaultColor ?? 0;
  if (
    !Number.isFinite(density)
    || !Number.isFinite(feather)
    || (defaultColor !== 0 && defaultColor !== 255)
  ) return null;
  const requestedFeather = feather * proxyScale;
  const featherPx = Math.min(PSD_IMPORTED_MASK_MAX_FEATHER_PX, requestedFeather);

  return {
    outputWidth,
    outputHeight,
    proxyScale,
    maskPixelWidth: dimensions.width,
    maskPixelHeight: dimensions.height,
    destinationLeft,
    destinationTop,
    destinationWidth: Math.max(1, destinationRight - destinationLeft),
    destinationHeight: Math.max(1, destinationBottom - destinationTop),
    defaultAlpha: applyPsdMaskDensity(defaultColor, density),
    density,
    featherPx,
    featherWasClamped: requestedFeather > PSD_IMPORTED_MASK_MAX_FEATHER_PX,
  };
}

function readMaskPixels(mask: LayerMaskData): PixelData | null {
  if (mask.imageData) return mask.imageData;
  if (!mask.canvas) return null;
  try {
    const context = mask.canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    return context.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
  } catch {
    return null;
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext("2d") ? canvas : null;
  } catch {
    return null;
  }
}

function fillMaskDefault(context: CanvasRenderingContext2D, width: number, height: number, alpha: number): void {
  context.clearRect(0, 0, width, height);
  context.fillStyle = `rgba(255,255,255,${alpha / 255})`;
  context.fillRect(0, 0, width, height);
}

function blurMaskCanvas(
  source: HTMLCanvasElement,
  defaultAlpha: number,
  featherPx: number,
  maxPixels: number,
): HTMLCanvasElement | null {
  if (featherPx <= 0) return source;
  const padding = Math.max(2, Math.ceil(featherPx * 2));
  const paddedWidth = source.width + padding * 2;
  const paddedHeight = source.height + padding * 2;
  if (paddedWidth * paddedHeight > maxPixels) return null;

  const padded = createCanvas(paddedWidth, paddedHeight);
  const output = createCanvas(source.width, source.height);
  const paddedContext = padded?.getContext("2d");
  const outputContext = output?.getContext("2d");
  if (!padded || !output || !paddedContext || !outputContext) return null;
  if (!("filter" in outputContext)) return null;

  fillMaskDefault(paddedContext, padded.width, padded.height, defaultAlpha);
  paddedContext.clearRect(padding, padding, source.width, source.height);
  paddedContext.drawImage(source, padding, padding);
  const blurFilter = `blur(${featherPx}px)`;
  outputContext.filter = blurFilter;
  if (outputContext.filter !== blurFilter) return null;
  outputContext.drawImage(padded, -padding, -padding);
  outputContext.filter = "none";
  return output;
}

function rasterizeOneMask(
  source: PsdLayerMaskSource,
  input: PsdLayerMaskRasterInput,
): { canvas: HTMLCanvasElement; plan: PsdLayerMaskRasterPlan; featherSkipped: boolean } | null {
  try {
    const plan = planPsdLayerMaskRaster({
      ...input,
      mask: source.mask,
      parameterMask: source.parameterMask,
    });
    const pixels = readMaskPixels(source.mask);
    if (!plan || !pixels) return null;
    const converted = convertPsdMaskPixelsToStudioAlpha(
      pixels.data,
      pixels.width,
      pixels.height,
      plan.density,
    );
    if (!converted) return null;

    const sourceCanvas = createCanvas(plan.maskPixelWidth, plan.maskPixelHeight);
    const fullCanvas = createCanvas(plan.outputWidth, plan.outputHeight);
    const sourceContext = sourceCanvas?.getContext("2d");
    const fullContext = fullCanvas?.getContext("2d");
    if (!sourceCanvas || !fullCanvas || !sourceContext || !fullContext) return null;
    const studioMaskPixels = sourceContext.createImageData(plan.maskPixelWidth, plan.maskPixelHeight);
    studioMaskPixels.data.set(converted);
    sourceContext.putImageData(studioMaskPixels, 0, 0);

    fillMaskDefault(fullContext, fullCanvas.width, fullCanvas.height, plan.defaultAlpha);
    fullContext.clearRect(
      plan.destinationLeft,
      plan.destinationTop,
      plan.destinationWidth,
      plan.destinationHeight,
    );
    fullContext.drawImage(
      sourceCanvas,
      0,
      0,
      plan.maskPixelWidth,
      plan.maskPixelHeight,
      plan.destinationLeft,
      plan.destinationTop,
      plan.destinationWidth,
      plan.destinationHeight,
    );

    const maxPixels = input.maxPixels ?? PSD_IMPORTED_MASK_MAX_PIXELS;
    const blurred = blurMaskCanvas(fullCanvas, plan.defaultAlpha, plan.featherPx, maxPixels);
    return {
      canvas: blurred ?? fullCanvas,
      plan,
      featherSkipped: plan.featherPx > 0 && !blurred,
    };
  } catch {
    // Canvas allocation, ImageData, drawImage and browser security failures all
    // degrade to an omitted mask rather than aborting the document import.
    return null;
  }
}

/**
 * Browser rasterizer. PSD's real-user-mask channel is already the final
 * pixel+vector composite, so it is never multiplied by the primary channel.
 * A primary channel may be retained as an explicit recovery source only.
 */
export function rasterizePsdLayerMasks(input: PsdLayerMaskRasterInput): PsdLayerMaskRasterResult {
  const warnings: string[] = [];
  if (input.masks.length === 0) return { warnings };

  const realMask = input.masks.find(({ kind }) => kind === "real");
  const primaryFallback = input.fallbackMask
    ?? input.masks.find(({ kind }) => kind === "primary");
  let selected: readonly PsdLayerMaskSource[];
  let disabled: boolean;
  if (realMask) {
    selected = [realMask];
    disabled = !!realMask.mask.disabled;
  } else {
    const enabled = input.masks.filter(({ mask }) => !mask.disabled);
    selected = enabled.length > 0 ? enabled : input.masks;
    disabled = enabled.length === 0;
    if (enabled.length > 0 && enabled.length !== input.masks.length) {
      warnings.push("비활성 마스크 채널은 적용하지 않고 활성 채널만 가져왔어요.");
    }
  }

  let rasters = selected
    .map((source) => rasterizeOneMask(source, input))
    .filter((value): value is NonNullable<typeof value> => value !== null);
  if (realMask && rasters.length === 0 && primaryFallback && primaryFallback !== realMask) {
    const fallbackRaster = rasterizeOneMask(primaryFallback, input);
    if (fallbackRaster) {
      rasters = [fallbackRaster];
      warnings.push("PSD 최종 합성 마스크 채널이 손상되어 기본 픽셀 마스크를 근사값으로 가져왔어요.");
    }
  }
  if (rasters.length === 0) {
    warnings.push("마스크 픽셀 데이터가 없거나 손상되어 원본 레이어를 가리지 않고 가져왔어요.");
    return { warnings };
  }
  if (rasters.length !== selected.length) {
    warnings.push("손상된 마스크 채널은 제외하고 읽을 수 있는 채널만 가져왔어요.");
  }
  if (rasters.some(({ plan }) => plan.featherPx > 0)) {
    warnings.push("Photoshop 마스크 페더를 Canvas 블러로 근사했어요.");
  }
  if (rasters.some(({ plan }) => plan.featherWasClamped)) {
    warnings.push(`마스크 페더는 성능 보호를 위해 최대 ${PSD_IMPORTED_MASK_MAX_FEATHER_PX}px로 제한했어요.`);
  }
  if (rasters.some(({ featherSkipped }) => featherSkipped)) {
    warnings.push("마스크 페더는 메모리 한도 때문에 생략했어요.");
  }

  try {
    const first = rasters[0]!;
    const combined = createCanvas(first.canvas.width, first.canvas.height);
    const context = combined?.getContext("2d");
    if (!combined || !context) {
      warnings.push("마스크 캔버스를 만들지 못해 원본 레이어를 가리지 않고 가져왔어요.");
      return { warnings };
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, combined.width, combined.height);
    context.globalCompositeOperation = "destination-in";
    for (const raster of rasters) context.drawImage(raster.canvas, 0, 0);
    context.globalCompositeOperation = "source-over";

    const maskSrc = combined.toDataURL("image/png");
    const separator = maskSrc.indexOf(",");
    if (
      separator <= 0
      || !maskSrc.slice(0, separator).toLowerCase().startsWith("data:image/png")
      || separator === maskSrc.length - 1
    ) throw new Error("Canvas returned an empty PNG data URL");
    return { maskSrc, disabled, warnings };
  } catch {
    warnings.push("마스크 PNG 인코딩에 실패해 원본 레이어를 가리지 않고 가져왔어요.");
    return { warnings };
  }
}
