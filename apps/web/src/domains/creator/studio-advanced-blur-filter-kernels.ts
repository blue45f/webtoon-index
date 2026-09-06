/**
 * Deterministic CPU golden oracles for advanced blur filters.
 *
 * These kernels have no DOM, Canvas, Worker, GPU, or third-party dependency. They are deliberately
 * strict and bounded so the same request/receipt contract can be transported to an OffscreenCanvas
 * Worker or WebGPU implementation later. All four filters preserve each source alpha byte exactly;
 * RGB sampling is alpha-weighted to avoid pulling hidden color out of transparent neighbors.
 */

export interface StudioAdvancedBlurRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type StudioAdvancedBlurKernelId =
  | "lens-blur"
  | "field-iris-blur"
  | "tilt-shift-blur"
  | "selective-gaussian-blur";

export interface StudioAdvancedBlurWorkBudget {
  readonly maxPixels: number;
  /** Actual source texel reads, including four reads per bilinear sample point. */
  readonly maxSourceSamples: number;
  readonly maxWorkingBytes: number;
}

export interface StudioAdvancedBlurWorkReceipt {
  readonly pixels: number;
  readonly samplePoints: number;
  readonly sourceSamples: number;
  readonly workingBytes: number;
  readonly budget: StudioAdvancedBlurWorkBudget;
}

export interface StudioLensBlurOptions {
  readonly radius: number;
  readonly sampleCount: number;
  readonly apertureBlades: number;
  readonly apertureRotationRadians: number;
}

export interface StudioFieldIrisBlurOptions {
  readonly focusCenterX: number;
  readonly focusCenterY: number;
  /** Radius in normalized image coordinates. Pixels inside remain in focus. */
  readonly focusRadius: number;
  /** Normalized distance over which blur ramps from zero to full radius. */
  readonly feather: number;
  readonly maximumBlurRadius: number;
  readonly sampleCount: number;
  readonly apertureBlades: number;
}

export interface StudioTiltShiftBlurOptions {
  /** Direction of the in-focus band in radians. Zero is horizontal. */
  readonly axisRadians: number;
  /** Full width of the in-focus band, normalized by the shorter image edge. */
  readonly focusWidth: number;
  /** Perpendicular ramp distance, normalized by the shorter image edge. */
  readonly feather: number;
  readonly maximumBlurRadius: number;
  readonly sampleCount: number;
}

export interface StudioSelectiveGaussianBlurOptions {
  readonly radius: number;
  readonly spatialSigma: number;
  /** Luma differences at or below this threshold receive full range weight. */
  readonly edgeThreshold: number;
  /** Zero is a hard edge cutoff; larger values soften the cutoff without removing it. */
  readonly edgeSoftness: number;
}

interface StudioAdvancedBlurRequestBase {
  readonly source: StudioAdvancedBlurRgbaImage;
}

export interface StudioLensBlurRequest extends StudioAdvancedBlurRequestBase {
  readonly kernel: "lens-blur";
  readonly options?: Partial<StudioLensBlurOptions>;
}

export interface StudioFieldIrisBlurRequest extends StudioAdvancedBlurRequestBase {
  readonly kernel: "field-iris-blur";
  readonly options?: Partial<StudioFieldIrisBlurOptions>;
}

export interface StudioTiltShiftBlurRequest extends StudioAdvancedBlurRequestBase {
  readonly kernel: "tilt-shift-blur";
  readonly options?: Partial<StudioTiltShiftBlurOptions>;
}

export interface StudioSelectiveGaussianBlurRequest extends StudioAdvancedBlurRequestBase {
  readonly kernel: "selective-gaussian-blur";
  readonly options?: Partial<StudioSelectiveGaussianBlurOptions>;
}

export type StudioAdvancedBlurRequest =
  | StudioLensBlurRequest
  | StudioFieldIrisBlurRequest
  | StudioTiltShiftBlurRequest
  | StudioSelectiveGaussianBlurRequest;

export type StudioAdvancedBlurNormalizedOptions =
  | ({ readonly kernel: "lens-blur" } & StudioLensBlurOptions)
  | ({ readonly kernel: "field-iris-blur" } & StudioFieldIrisBlurOptions)
  | ({ readonly kernel: "tilt-shift-blur" } & StudioTiltShiftBlurOptions)
  | ({ readonly kernel: "selective-gaussian-blur" } & StudioSelectiveGaussianBlurOptions);

export interface StudioAdvancedBlurChangedBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioAdvancedBlurTransactionReceipt {
  readonly schema: "toonspectrum.advanced-blur-filter/v1";
  readonly operationId: string;
  readonly kernel: StudioAdvancedBlurKernelId;
  readonly width: number;
  readonly height: number;
  readonly alphaSemantics: "preserve-source-alpha";
  readonly sourceFingerprint: string;
  readonly outputFingerprint: string;
  readonly options: StudioAdvancedBlurNormalizedOptions;
  readonly changedPixelCount: number;
  readonly changedBounds: StudioAdvancedBlurChangedBounds | null;
}

export interface StudioAdvancedBlurApplied {
  readonly status: "applied";
  readonly kernel: StudioAdvancedBlurKernelId;
  readonly image: StudioAdvancedBlurRgbaImage;
  readonly alphaSemantics: "preserve-source-alpha";
  readonly alphaPreserved: true;
  readonly inputsMutated: false;
  readonly work: StudioAdvancedBlurWorkReceipt;
  readonly transaction: StudioAdvancedBlurTransactionReceipt;
}

export type StudioAdvancedBlurRefusalReason =
  | "invalid-request"
  | "invalid-source"
  | "invalid-options"
  | "invalid-budget"
  | "budget-exceeded";

export interface StudioAdvancedBlurRefusal {
  readonly status: "refused";
  readonly kernel: StudioAdvancedBlurKernelId | "unknown";
  readonly reason: StudioAdvancedBlurRefusalReason;
  readonly detail: string;
  /** No image-sized output/scratch buffer exists when a request is refused. */
  readonly allocationPerformed: false;
  readonly work?: StudioAdvancedBlurWorkReceipt;
}

export type StudioAdvancedBlurResult =
  | StudioAdvancedBlurApplied
  | StudioAdvancedBlurRefusal;

export const DEFAULT_STUDIO_ADVANCED_BLUR_WORK_BUDGET: StudioAdvancedBlurWorkBudget =
  Object.freeze({
    maxPixels: 16_777_216,
    maxSourceSamples: 1_200_000_000,
    maxWorkingBytes: 268_435_456,
  });

export const DEFAULT_STUDIO_LENS_BLUR_OPTIONS: StudioLensBlurOptions =
  Object.freeze({
    radius: 4,
    sampleCount: 21,
    apertureBlades: 6,
    apertureRotationRadians: 0,
  });

export const DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS: StudioFieldIrisBlurOptions =
  Object.freeze({
    focusCenterX: 0.5,
    focusCenterY: 0.5,
    focusRadius: 0.16,
    feather: 0.24,
    maximumBlurRadius: 7,
    sampleCount: 21,
    apertureBlades: 8,
  });

export const DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS: StudioTiltShiftBlurOptions =
  Object.freeze({
    axisRadians: 0,
    focusWidth: 0.2,
    feather: 0.22,
    maximumBlurRadius: 7,
    sampleCount: 19,
  });

export const DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS:
StudioSelectiveGaussianBlurOptions = Object.freeze({
  radius: 3,
  spatialSigma: 2,
  edgeThreshold: 20,
  edgeSoftness: 0.35,
});

const MAX_LENS_RADIUS = 18;
const MIN_SAMPLE_COUNT = 5;
const MAX_SAMPLE_COUNT = 64;
const MIN_APERTURE_BLADES = 3;
const MAX_APERTURE_BLADES = 12;
const MAX_SELECTIVE_RADIUS = 10;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TWO_PI = Math.PI * 2;

interface ValidImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly bytes: number;
  readonly data: Uint8ClampedArray;
}

interface PreparedRequest {
  readonly kernel: StudioAdvancedBlurKernelId;
  readonly source: ValidImage;
  readonly options: StudioAdvancedBlurNormalizedOptions;
  readonly work: StudioAdvancedBlurWorkReceipt;
  /** Pre-computed spatial gaussian weight LUT for selective-gaussian-blur. */
  spatialLut?: Float32Array;
  /** Pre-computed range weight LUT (256 entries) for selective-gaussian-blur. */
  rangeLut?: Float32Array;
}

interface PremultipliedSample {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

type Rgb = readonly [number, number, number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedProduct(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  if (left > Number.MAX_SAFE_INTEGER / right) return Number.MAX_SAFE_INTEGER;
  return left * right;
}

function inspectImage(value: unknown): ValidImage | null {
  if (!isRecord(value)) return null;
  const { width, height, data } = value;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || (width as number) <= 0
    || (height as number) <= 0
    || !(data instanceof Uint8ClampedArray)
  ) {
    return null;
  }
  const pixels = boundedProduct(width as number, height as number);
  const bytes = boundedProduct(pixels, 4);
  if (
    pixels === Number.MAX_SAFE_INTEGER
    || bytes === Number.MAX_SAFE_INTEGER
    || data.length !== bytes
  ) {
    return null;
  }
  return {
    width: width as number,
    height: height as number,
    pixels,
    bytes,
    data,
  };
}

function inspectBudget(value: unknown): StudioAdvancedBlurWorkBudget | null {
  if (!isRecord(value)) return null;
  const { maxPixels, maxSourceSamples, maxWorkingBytes } = value;
  if (
    !Number.isSafeInteger(maxPixels)
    || !Number.isSafeInteger(maxSourceSamples)
    || !Number.isSafeInteger(maxWorkingBytes)
    || (maxPixels as number) <= 0
    || (maxSourceSamples as number) <= 0
    || (maxWorkingBytes as number) <= 0
  ) {
    return null;
  }
  return {
    maxPixels: maxPixels as number,
    maxSourceSamples: maxSourceSamples as number,
    maxWorkingBytes: maxWorkingBytes as number,
  };
}

function validFinite(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function validInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function normalizeAngle(value: number): number {
  let angle = value % TWO_PI;
  if (angle > Math.PI) angle -= TWO_PI;
  if (angle < -Math.PI) angle += TWO_PI;
  return angle;
}

function optionsRecord(value: unknown): Record<string, unknown> | null {
  return value === undefined ? {} : isRecord(value) ? value : null;
}

function normalizeOptions(
  kernel: StudioAdvancedBlurKernelId,
  value: unknown,
): StudioAdvancedBlurNormalizedOptions | null {
  const options = optionsRecord(value);
  if (!options) return null;

  if (kernel === "lens-blur") {
    const radius = validFinite(
      options.radius,
      DEFAULT_STUDIO_LENS_BLUR_OPTIONS.radius,
      0.25,
      MAX_LENS_RADIUS,
    );
    const sampleCount = validInteger(
      options.sampleCount,
      DEFAULT_STUDIO_LENS_BLUR_OPTIONS.sampleCount,
      MIN_SAMPLE_COUNT,
      MAX_SAMPLE_COUNT,
    );
    const apertureBlades = validInteger(
      options.apertureBlades,
      DEFAULT_STUDIO_LENS_BLUR_OPTIONS.apertureBlades,
      MIN_APERTURE_BLADES,
      MAX_APERTURE_BLADES,
    );
    const rotation = validFinite(
      options.apertureRotationRadians,
      DEFAULT_STUDIO_LENS_BLUR_OPTIONS.apertureRotationRadians,
      -1_000_000,
      1_000_000,
    );
    if (radius === null || sampleCount === null || apertureBlades === null || rotation === null) {
      return null;
    }
    return {
      kernel,
      radius,
      sampleCount,
      apertureBlades,
      apertureRotationRadians: normalizeAngle(rotation),
    };
  }

  if (kernel === "field-iris-blur") {
    const focusCenterX = validFinite(
      options.focusCenterX,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.focusCenterX,
      0,
      1,
    );
    const focusCenterY = validFinite(
      options.focusCenterY,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.focusCenterY,
      0,
      1,
    );
    const focusRadius = validFinite(
      options.focusRadius,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.focusRadius,
      0,
      Math.SQRT2,
    );
    const feather = validFinite(
      options.feather,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.feather,
      0.001,
      Math.SQRT2,
    );
    const maximumBlurRadius = validFinite(
      options.maximumBlurRadius,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.maximumBlurRadius,
      0.25,
      MAX_LENS_RADIUS,
    );
    const sampleCount = validInteger(
      options.sampleCount,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.sampleCount,
      MIN_SAMPLE_COUNT,
      MAX_SAMPLE_COUNT,
    );
    const apertureBlades = validInteger(
      options.apertureBlades,
      DEFAULT_STUDIO_FIELD_IRIS_BLUR_OPTIONS.apertureBlades,
      MIN_APERTURE_BLADES,
      MAX_APERTURE_BLADES,
    );
    if (
      focusCenterX === null
      || focusCenterY === null
      || focusRadius === null
      || feather === null
      || maximumBlurRadius === null
      || sampleCount === null
      || apertureBlades === null
    ) {
      return null;
    }
    return {
      kernel,
      focusCenterX,
      focusCenterY,
      focusRadius,
      feather,
      maximumBlurRadius,
      sampleCount,
      apertureBlades,
    };
  }

  if (kernel === "tilt-shift-blur") {
    const axis = validFinite(
      options.axisRadians,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.axisRadians,
      -1_000_000,
      1_000_000,
    );
    const focusWidth = validFinite(
      options.focusWidth,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.focusWidth,
      0,
      Math.SQRT2 * 2,
    );
    const feather = validFinite(
      options.feather,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.feather,
      0.001,
      Math.SQRT2,
    );
    const maximumBlurRadius = validFinite(
      options.maximumBlurRadius,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.maximumBlurRadius,
      0.25,
      MAX_LENS_RADIUS,
    );
    const sampleCount = validInteger(
      options.sampleCount,
      DEFAULT_STUDIO_TILT_SHIFT_BLUR_OPTIONS.sampleCount,
      MIN_SAMPLE_COUNT,
      MAX_SAMPLE_COUNT,
    );
    if (
      axis === null
      || focusWidth === null
      || feather === null
      || maximumBlurRadius === null
      || sampleCount === null
    ) {
      return null;
    }
    return {
      kernel,
      axisRadians: normalizeAngle(axis),
      focusWidth,
      feather,
      maximumBlurRadius,
      sampleCount,
    };
  }

  const radius = validInteger(
    options.radius,
    DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS.radius,
    1,
    MAX_SELECTIVE_RADIUS,
  );
  const spatialSigma = validFinite(
    options.spatialSigma,
    DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS.spatialSigma,
    0.1,
    20,
  );
  const edgeThreshold = validFinite(
    options.edgeThreshold,
    DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS.edgeThreshold,
    0,
    255,
  );
  const edgeSoftness = validFinite(
    options.edgeSoftness,
    DEFAULT_STUDIO_SELECTIVE_GAUSSIAN_BLUR_OPTIONS.edgeSoftness,
    0,
    2,
  );
  if (
    radius === null
    || spatialSigma === null
    || edgeThreshold === null
    || edgeSoftness === null
  ) {
    return null;
  }
  return { kernel, radius, spatialSigma, edgeThreshold, edgeSoftness };
}

function kernelOf(value: unknown): StudioAdvancedBlurKernelId | "unknown" {
  if (
    value === "lens-blur"
    || value === "field-iris-blur"
    || value === "tilt-shift-blur"
    || value === "selective-gaussian-blur"
  ) {
    return value;
  }
  return "unknown";
}

function refusal(
  kernel: StudioAdvancedBlurKernelId | "unknown",
  reason: StudioAdvancedBlurRefusalReason,
  detail: string,
  work?: StudioAdvancedBlurWorkReceipt,
): StudioAdvancedBlurRefusal {
  return work
    ? { status: "refused", kernel, reason, detail, allocationPerformed: false, work }
    : { status: "refused", kernel, reason, detail, allocationPerformed: false };
}

function samplePointsPerPixel(options: StudioAdvancedBlurNormalizedOptions): number {
  if (options.kernel === "selective-gaussian-blur") {
    const side = options.radius * 2 + 1;
    return side * side;
  }
  return options.sampleCount;
}

function texelsPerSamplePoint(options: StudioAdvancedBlurNormalizedOptions): number {
  return options.kernel === "selective-gaussian-blur" ? 1 : 4;
}

function prepareRequest(
  requestValue: StudioAdvancedBlurRequest,
  budgetValue: StudioAdvancedBlurWorkBudget,
): PreparedRequest | StudioAdvancedBlurRefusal {
  if (!isRecord(requestValue)) {
    return refusal("unknown", "invalid-request", "Expected an advanced-blur request object.");
  }
  const kernel = kernelOf(requestValue.kernel);
  if (kernel === "unknown") {
    return refusal(kernel, "invalid-request", "Unknown advanced-blur kernel.");
  }
  const source = inspectImage(requestValue.source);
  if (!source) {
    return refusal(
      kernel,
      "invalid-source",
      "Expected positive safe dimensions and one exact Uint8ClampedArray RGBA extent.",
    );
  }
  const options = normalizeOptions(kernel, requestValue.options);
  if (!options) {
    return refusal(
      kernel,
      "invalid-options",
      "Radius, samples, aperture, focus geometry, edge threshold, or feather is invalid.",
    );
  }
  const budget = inspectBudget(budgetValue);
  if (!budget) {
    return refusal(kernel, "invalid-budget", "Budget limits must be positive safe integers.");
  }
  const samplePoints = boundedProduct(source.pixels, samplePointsPerPixel(options));
  const sourceSamples = boundedProduct(samplePoints, texelsPerSamplePoint(options));
  const work: StudioAdvancedBlurWorkReceipt = {
    pixels: source.pixels,
    samplePoints,
    sourceSamples,
    workingBytes: source.bytes,
    budget,
  };
  if (
    source.pixels > budget.maxPixels
    || sourceSamples > budget.maxSourceSamples
    || source.bytes > budget.maxWorkingBytes
  ) {
    return refusal(
      kernel,
      "budget-exceeded",
      "The operation exceeds its pixel, source-sample, or working-memory budget.",
      work,
    );
  }
  return { kernel, source, options, work };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampByte(value: number): number {
  return clamp(Math.round(value), 0, 255);
}

function smoothstep(value: number): number {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function sourceRgb(source: ValidImage, x: number, y: number): Rgb {
  const offset = (y * source.width + x) * 4;
  return [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!];
}

function bilinearPremultipliedSample(
  source: ValidImage,
  xValue: number,
  yValue: number,
  out: PremultipliedSample,
): void {
  const x = clamp(xValue, 0, source.width - 1);
  const y = clamp(yValue, 0, source.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  
  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;
  
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;

  let offset = (y0 * source.width + x0) * 4;
  let weightedAlpha = (source.data[offset + 3]! / 255) * w00;
  red += source.data[offset]! * weightedAlpha;
  green += source.data[offset + 1]! * weightedAlpha;
  blue += source.data[offset + 2]! * weightedAlpha;
  alpha += weightedAlpha;

  offset = (y0 * source.width + x1) * 4;
  weightedAlpha = (source.data[offset + 3]! / 255) * w10;
  red += source.data[offset]! * weightedAlpha;
  green += source.data[offset + 1]! * weightedAlpha;
  blue += source.data[offset + 2]! * weightedAlpha;
  alpha += weightedAlpha;

  offset = (y1 * source.width + x0) * 4;
  weightedAlpha = (source.data[offset + 3]! / 255) * w01;
  red += source.data[offset]! * weightedAlpha;
  green += source.data[offset + 1]! * weightedAlpha;
  blue += source.data[offset + 2]! * weightedAlpha;
  alpha += weightedAlpha;

  offset = (y1 * source.width + x1) * 4;
  weightedAlpha = (source.data[offset + 3]! / 255) * w11;
  red += source.data[offset]! * weightedAlpha;
  green += source.data[offset + 1]! * weightedAlpha;
  blue += source.data[offset + 2]! * weightedAlpha;
  alpha += weightedAlpha;

  out.red = red;
  out.green = green;
  out.blue = blue;
  out.alpha = alpha;
}

function polygonApertureRadiusScale(angle: number, blades: number): number {
  const sector = TWO_PI / blades;
  const localAngle = ((angle + Math.PI / blades) % sector + sector) % sector - Math.PI / blades;
  return Math.cos(Math.PI / blades) / Math.cos(localAngle);
}

function apertureBlurRgb(
  source: ValidImage,
  x: number,
  y: number,
  radius: number,
  sampleCount: number,
  apertureBlades: number,
  rotation: number,
): Rgb {
  if (radius < 0.01) return sourceRgb(source, x, y);
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  const sample: PremultipliedSample = { red: 0, green: 0, blue: 0, alpha: 0 };
  for (let index = 0; index < sampleCount; index += 1) {
    const angle = index * GOLDEN_ANGLE + rotation;
    const normalizedRadius = index === 0
      ? 0
      : Math.sqrt((index - 0.5) / Math.max(1, sampleCount - 1));
    const apertureScale = polygonApertureRadiusScale(angle, apertureBlades);
    const sampleRadius = radius * normalizedRadius * apertureScale;
    bilinearPremultipliedSample(
      source,
      x + Math.cos(angle) * sampleRadius,
      y + Math.sin(angle) * sampleRadius,
      sample,
    );
    red += sample.red;
    green += sample.green;
    blue += sample.blue;
    alpha += sample.alpha;
  }
  return alpha > Number.EPSILON
    ? [red / alpha, green / alpha, blue / alpha]
    : sourceRgb(source, x, y);
}

function lineBlurRgb(
  source: ValidImage,
  x: number,
  y: number,
  radius: number,
  sampleCount: number,
  perpendicularX: number,
  perpendicularY: number,
): Rgb {
  if (radius < 0.01) return sourceRgb(source, x, y);
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  const sample: PremultipliedSample = { red: 0, green: 0, blue: 0, alpha: 0 };
  for (let index = 0; index < sampleCount; index += 1) {
    const position = sampleCount === 1 ? 0 : index / (sampleCount - 1) * 2 - 1;
    const gaussianWeight = Math.exp(-0.5 * (position * 2.35) ** 2);
    bilinearPremultipliedSample(
      source,
      x + perpendicularX * position * radius,
      y + perpendicularY * position * radius,
      sample,
    );
    red += sample.red * gaussianWeight;
    green += sample.green * gaussianWeight;
    blue += sample.blue * gaussianWeight;
    alpha += sample.alpha * gaussianWeight;
  }
  return alpha > Number.EPSILON
    ? [red / alpha, green / alpha, blue / alpha]
    : sourceRgb(source, x, y);
}

function luma(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function selectiveGaussianRgb(
  source: ValidImage,
  x: number,
  y: number,
  options: Extract<
    StudioAdvancedBlurNormalizedOptions,
    { readonly kernel: "selective-gaussian-blur" }
  >,
  spatialLut: Float32Array,
  rangeLut: Float32Array,
): Rgb {
  const center = sourceRgb(source, x, y);
  const centerLuma = luma(center[0], center[1], center[2]);
  const centerLumaInt = Math.round(centerLuma);
  const radius = options.radius;
  const diameter = radius * 2 + 1;
  let red = 0;
  let green = 0;
  let blue = 0;
  let totalWeight = 0;

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const sampleY = clamp(y + offsetY, 0, source.height - 1);
    const spatialRow = (offsetY + radius) * diameter;
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const sampleX = clamp(x + offsetX, 0, source.width - 1);
      const offset = (sampleY * source.width + sampleX) * 4;
      const sampleRed = source.data[offset]!;
      const sampleGreen = source.data[offset + 1]!;
      const sampleBlue = source.data[offset + 2]!;
      const alphaWeight = source.data[offset + 3]! / 255;
      const spatialWeight = spatialLut[spatialRow + offsetX + radius]!;
      const sampleLumaInt = Math.round(luma(sampleRed, sampleGreen, sampleBlue));
      const difference = Math.abs(sampleLumaInt - centerLumaInt);
      const rangeWeight = rangeLut[Math.min(difference, 255)]!;
      const weight = spatialWeight * rangeWeight * alphaWeight;
      red += sampleRed * weight;
      green += sampleGreen * weight;
      blue += sampleBlue * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > Number.EPSILON
    ? [red / totalWeight, green / totalWeight, blue / totalWeight]
    : center;
}

function filteredRgb(prepared: PreparedRequest, x: number, y: number): Rgb {
  const { source, options } = prepared;
  if (options.kernel === "lens-blur") {
    return apertureBlurRgb(
      source,
      x,
      y,
      options.radius,
      options.sampleCount,
      options.apertureBlades,
      options.apertureRotationRadians,
    );
  }
  if (options.kernel === "field-iris-blur") {
    const normalizedX = (x + 0.5) / source.width;
    const normalizedY = (y + 0.5) / source.height;
    const distance = Math.hypot(
      normalizedX - options.focusCenterX,
      normalizedY - options.focusCenterY,
    );
    const blurFactor = smoothstep((distance - options.focusRadius) / options.feather);
    return apertureBlurRgb(
      source,
      x,
      y,
      options.maximumBlurRadius * blurFactor,
      options.sampleCount,
      options.apertureBlades,
      0,
    );
  }
  if (options.kernel === "tilt-shift-blur") {
    // Define both the visible focus-band angle and the blur sampling direction in pixel space.
    // Independently normalizing x/y by width/height changes a 45° band into a different visual
    // angle on non-square images. A common short-edge scale keeps the control dimensionless
    // without distorting its orientation.
    const shortEdge = Math.min(source.width, source.height);
    const normalizedX = (x + 0.5 - source.width / 2) / shortEdge;
    const normalizedY = (y + 0.5 - source.height / 2) / shortEdge;
    const perpendicularX = -Math.sin(options.axisRadians);
    const perpendicularY = Math.cos(options.axisRadians);
    const perpendicularDistance = Math.abs(
      normalizedX * perpendicularX + normalizedY * perpendicularY,
    );
    const blurFactor = smoothstep(
      (perpendicularDistance - options.focusWidth / 2) / options.feather,
    );
    return lineBlurRgb(
      source,
      x,
      y,
      options.maximumBlurRadius * blurFactor,
      options.sampleCount,
      perpendicularX,
      perpendicularY,
    );
  }
  return selectiveGaussianRgb(source, x, y, options, prepared.spatialLut!, prepared.rangeLut!);
}

function fnv1aBytes(data: Uint8ClampedArray, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < data.length; index += 1) {
    hash ^= data[index]!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function fnv1aText(value: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= code >>> 8;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function fingerprint(data: Uint8ClampedArray): string {
  return fnv1aBytes(data).toString(16).padStart(8, "0");
}

function optionsKey(options: StudioAdvancedBlurNormalizedOptions): string {
  if (options.kernel === "lens-blur") {
    return [
      `radius=${options.radius}`,
      `sampleCount=${options.sampleCount}`,
      `apertureBlades=${options.apertureBlades}`,
      `apertureRotationRadians=${options.apertureRotationRadians}`,
    ].join(";");
  }
  if (options.kernel === "field-iris-blur") {
    return [
      `focusCenter=${options.focusCenterX},${options.focusCenterY}`,
      `focusRadius=${options.focusRadius}`,
      `feather=${options.feather}`,
      `maximumBlurRadius=${options.maximumBlurRadius}`,
      `sampleCount=${options.sampleCount}`,
      `apertureBlades=${options.apertureBlades}`,
    ].join(";");
  }
  if (options.kernel === "tilt-shift-blur") {
    return [
      `axisRadians=${options.axisRadians}`,
      `focusWidth=${options.focusWidth}`,
      `feather=${options.feather}`,
      `maximumBlurRadius=${options.maximumBlurRadius}`,
      `sampleCount=${options.sampleCount}`,
    ].join(";");
  }
  return [
    `radius=${options.radius}`,
    `spatialSigma=${options.spatialSigma}`,
    `edgeThreshold=${options.edgeThreshold}`,
    `edgeSoftness=${options.edgeSoftness}`,
  ].join(";");
}

function createTransactionReceipt(input: {
  readonly prepared: PreparedRequest;
  readonly output: Uint8ClampedArray;
  readonly changedPixelCount: number;
  readonly changedBounds: StudioAdvancedBlurChangedBounds | null;
}): StudioAdvancedBlurTransactionReceipt {
  const { prepared, output, changedPixelCount, changedBounds } = input;
  const sourceFingerprint = fingerprint(prepared.source.data);
  const identity = [
    prepared.kernel,
    `${prepared.source.width}x${prepared.source.height}`,
    sourceFingerprint,
    optionsKey(prepared.options),
  ].join("|");
  return {
    schema: "toonspectrum.advanced-blur-filter/v1",
    operationId: `advanced-blur-v1-${fnv1aText(identity).toString(16).padStart(8, "0")}`,
    kernel: prepared.kernel,
    width: prepared.source.width,
    height: prepared.source.height,
    alphaSemantics: "preserve-source-alpha",
    sourceFingerprint,
    outputFingerprint: fingerprint(output),
    options: prepared.options,
    changedPixelCount,
    changedBounds,
  };
}

/**
 * Execute one advanced blur. This CPU result is the canonical comparison target for future
 * Worker/WebGPU backends; those backends can verify parity through the receipt fingerprints.
 */
export function applyStudioAdvancedBlurFilter(
  request: StudioAdvancedBlurRequest,
  budget: StudioAdvancedBlurWorkBudget = DEFAULT_STUDIO_ADVANCED_BLUR_WORK_BUDGET,
): StudioAdvancedBlurResult {
  const prepared = prepareRequest(request, budget);
  if ("status" in prepared) return prepared;

  // Deliberately the first image-sized allocation after all validation and budget checks.
  const output = prepared.source.data.slice();
  let changedPixelCount = 0;
  let minimumX = prepared.source.width;
  let minimumY = prepared.source.height;
  let maximumX = -1;
  let maximumY = -1;

  // Pre-compute LUTs for selective-gaussian-blur to eliminate per-pixel Math.exp calls.
  // Spatial LUT: (2R+1)×(2R+1) entries, computed once. Range LUT: 256 integer luma differences.
  if (prepared.options.kernel === "selective-gaussian-blur") {
    const opts = prepared.options;
    const radius = opts.radius;
    const diameter = radius * 2 + 1;
    const spatialDenominator = 2 * opts.spatialSigma * opts.spatialSigma;
    const spatialLut = new Float32Array(diameter * diameter);
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        spatialLut[(oy + radius) * diameter + ox + radius] =
          Math.exp(-(ox * ox + oy * oy) / spatialDenominator);
      }
    }
    const rangeSigma = Math.max(0.5, opts.edgeThreshold * opts.edgeSoftness);
    const rangeLut = new Float32Array(256);
    for (let d = 0; d < 256; d += 1) {
      if (d <= opts.edgeThreshold) {
        rangeLut[d] = 1;
      } else if (opts.edgeSoftness === 0) {
        rangeLut[d] = 0;
      } else {
        const excess = d - opts.edgeThreshold;
        rangeLut[d] = Math.exp(-0.5 * (excess / rangeSigma) ** 2);
      }
    }
    prepared.spatialLut = spatialLut;
    prepared.rangeLut = rangeLut;
  }

  for (let y = 0; y < prepared.source.height; y += 1) {
    for (let x = 0; x < prepared.source.width; x += 1) {
      const offset = (y * prepared.source.width + x) * 4;
      const filtered = filteredRgb(prepared, x, y);
      const red = clampByte(filtered[0]);
      const green = clampByte(filtered[1]);
      const blue = clampByte(filtered[2]);
      if (
        red !== output[offset]
        || green !== output[offset + 1]
        || blue !== output[offset + 2]
      ) {
        output[offset] = red;
        output[offset + 1] = green;
        output[offset + 2] = blue;
        changedPixelCount += 1;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
      // Alpha came from source.data.slice() and is intentionally never written.
    }
  }

  const changedBounds = changedPixelCount === 0
    ? null
    : {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX + 1,
      height: maximumY - minimumY + 1,
    };
  return {
    status: "applied",
    kernel: prepared.kernel,
    image: {
      width: prepared.source.width,
      height: prepared.source.height,
      data: output,
    },
    alphaSemantics: "preserve-source-alpha",
    alphaPreserved: true,
    inputsMutated: false,
    work: prepared.work,
    transaction: createTransactionReceipt({
      prepared,
      output,
      changedPixelCount,
      changedBounds,
    }),
  };
}

export function applyStudioLensBlur(
  request: Omit<StudioLensBlurRequest, "kernel">,
  budget?: StudioAdvancedBlurWorkBudget,
): StudioAdvancedBlurResult {
  return applyStudioAdvancedBlurFilter({ ...request, kernel: "lens-blur" }, budget);
}

export function applyStudioFieldIrisBlur(
  request: Omit<StudioFieldIrisBlurRequest, "kernel">,
  budget?: StudioAdvancedBlurWorkBudget,
): StudioAdvancedBlurResult {
  return applyStudioAdvancedBlurFilter({ ...request, kernel: "field-iris-blur" }, budget);
}

export function applyStudioTiltShiftBlur(
  request: Omit<StudioTiltShiftBlurRequest, "kernel">,
  budget?: StudioAdvancedBlurWorkBudget,
): StudioAdvancedBlurResult {
  return applyStudioAdvancedBlurFilter({ ...request, kernel: "tilt-shift-blur" }, budget);
}

export function applyStudioSelectiveGaussianBlur(
  request: Omit<StudioSelectiveGaussianBlurRequest, "kernel">,
  budget?: StudioAdvancedBlurWorkBudget,
): StudioAdvancedBlurResult {
  return applyStudioAdvancedBlurFilter(
    { ...request, kernel: "selective-gaussian-blur" },
    budget,
  );
}
