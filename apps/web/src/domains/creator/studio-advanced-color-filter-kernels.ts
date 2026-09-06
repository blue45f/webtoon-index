/**
 * Deterministic CPU golden oracles for advanced color filters.
 *
 * This module is intentionally independent from DOM/Canvas/Worker/GPU/editor state. Every filter
 * validates all dimensions/options and an explicit work budget before allocating its output,
 * preserves source alpha bytes exactly, never mutates input/auxiliary buffers, and emits a
 * content-addressed receipt that a future Worker/WebGPU backend can verify.
 */

export interface StudioAdvancedColorRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type StudioAdvancedColorRgb = readonly [number, number, number];

/**
 * Red-major 3D LUT: entry index = ((blue * size + green) * size + red) * 3.
 * Each entry stores an output RGB triplet in 0..255.
 */
export interface StudioColorLookupCube {
  readonly size: number;
  readonly data: Uint8ClampedArray;
}

export interface StudioSelectiveColorBand {
  readonly hueCenterDegrees: number;
  readonly hueHalfWidthDegrees: number;
  readonly hueFeatherDegrees: number;
  readonly lumaMinimum: number;
  readonly lumaMaximum: number;
  readonly lumaFeather: number;
  readonly hueShiftDegrees: number;
  readonly saturationScale: number;
  readonly lightnessDelta: number;
}

export type StudioAdvancedColorKernelId =
  | "3d-lut-color-lookup"
  | "selective-color-bands"
  | "reference-image-color-match"
  | "palette-normalization";

export interface StudioAdvancedColorWorkBudget {
  readonly maxPixels: number;
  /** LUT cells, color bands, reference pixels, or palette colors depending on the kernel. */
  readonly maxAuxiliaryEntries: number;
  readonly maxWorkUnits: number;
  readonly maxWorkingBytes: number;
}

export interface StudioAdvancedColorWorkReceipt {
  readonly pixels: number;
  readonly auxiliaryEntries: number;
  readonly workUnits: number;
  readonly workingBytes: number;
  readonly budget: StudioAdvancedColorWorkBudget;
}

export interface StudioColorLookupOptions {
  readonly strength: number;
}

export interface StudioReferenceColorMatchOptions {
  readonly strength: number;
  /** Clamp transformed channels to this many reference standard deviations around its mean. */
  readonly clipSigma: number;
  /** Prevent unstable ratios for nearly flat source channels. */
  readonly minimumStandardDeviation: number;
}

export interface StudioPaletteNormalizationOptions {
  readonly strength: number;
  readonly lineLumaThreshold: number;
  readonly edgeContrastThreshold: number;
  /** 0 disables edge protection; 1 fully preserves detected line/edge pixels. */
  readonly edgeProtection: number;
}

interface StudioAdvancedColorRequestBase {
  readonly source: StudioAdvancedColorRgbaImage;
}

export interface StudioColorLookupRequest extends StudioAdvancedColorRequestBase {
  readonly kernel: "3d-lut-color-lookup";
  readonly cube: StudioColorLookupCube;
  readonly options?: Partial<StudioColorLookupOptions>;
}

export interface StudioSelectiveColorRequest extends StudioAdvancedColorRequestBase {
  readonly kernel: "selective-color-bands";
  readonly bands: readonly StudioSelectiveColorBand[];
}

export interface StudioReferenceColorMatchRequest extends StudioAdvancedColorRequestBase {
  readonly kernel: "reference-image-color-match";
  readonly reference: StudioAdvancedColorRgbaImage;
  readonly options?: Partial<StudioReferenceColorMatchOptions>;
}

export interface StudioPaletteNormalizationRequest extends StudioAdvancedColorRequestBase {
  readonly kernel: "palette-normalization";
  readonly palette: readonly StudioAdvancedColorRgb[];
  readonly options?: Partial<StudioPaletteNormalizationOptions>;
}

export type StudioAdvancedColorRequest =
  | StudioColorLookupRequest
  | StudioSelectiveColorRequest
  | StudioReferenceColorMatchRequest
  | StudioPaletteNormalizationRequest;

export type StudioAdvancedColorNormalizedOptions =
  | {
    readonly kernel: "3d-lut-color-lookup";
    readonly strength: number;
    readonly cubeSize: number;
  }
  | {
    readonly kernel: "selective-color-bands";
    readonly bands: readonly StudioSelectiveColorBand[];
  }
  | ({ readonly kernel: "reference-image-color-match" } & StudioReferenceColorMatchOptions)
  | ({
    readonly kernel: "palette-normalization";
    readonly palette: readonly StudioAdvancedColorRgb[];
  } & StudioPaletteNormalizationOptions);

export interface StudioAdvancedColorChangedBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioAdvancedColorTransactionReceipt {
  readonly schema: "toonspectrum.advanced-color-filter/v1";
  readonly operationId: string;
  readonly kernel: StudioAdvancedColorKernelId;
  readonly width: number;
  readonly height: number;
  readonly alphaSemantics: "preserve-source-alpha";
  readonly sourceFingerprint: string;
  readonly auxiliaryFingerprint: string;
  readonly outputFingerprint: string;
  readonly options: StudioAdvancedColorNormalizedOptions;
  readonly changedPixelCount: number;
  readonly changedBounds: StudioAdvancedColorChangedBounds | null;
}

export interface StudioAdvancedColorApplied {
  readonly status: "applied";
  readonly kernel: StudioAdvancedColorKernelId;
  readonly image: StudioAdvancedColorRgbaImage;
  readonly alphaSemantics: "preserve-source-alpha";
  readonly alphaPreserved: true;
  readonly inputsMutated: false;
  readonly work: StudioAdvancedColorWorkReceipt;
  readonly transaction: StudioAdvancedColorTransactionReceipt;
}

export type StudioAdvancedColorRefusalReason =
  | "invalid-request"
  | "invalid-source"
  | "invalid-auxiliary"
  | "invalid-options"
  | "invalid-budget"
  | "budget-exceeded"
  | "empty-reference";

export interface StudioAdvancedColorRefusal {
  readonly status: "refused";
  readonly kernel: StudioAdvancedColorKernelId | "unknown";
  readonly reason: StudioAdvancedColorRefusalReason;
  readonly detail: string;
  readonly allocationPerformed: false;
  readonly work?: StudioAdvancedColorWorkReceipt;
}

export type StudioAdvancedColorResult =
  | StudioAdvancedColorApplied
  | StudioAdvancedColorRefusal;

export const DEFAULT_STUDIO_ADVANCED_COLOR_WORK_BUDGET: StudioAdvancedColorWorkBudget =
  Object.freeze({
    maxPixels: 16_777_216,
    maxAuxiliaryEntries: 16_777_216,
    maxWorkUnits: 1_500_000_000,
    maxWorkingBytes: 268_435_456,
  });

export const DEFAULT_STUDIO_COLOR_LOOKUP_OPTIONS: StudioColorLookupOptions =
  Object.freeze({ strength: 1 });

export const DEFAULT_STUDIO_REFERENCE_COLOR_MATCH_OPTIONS:
StudioReferenceColorMatchOptions = Object.freeze({
  strength: 1,
  clipSigma: 3,
  minimumStandardDeviation: 1,
});

export const DEFAULT_STUDIO_PALETTE_NORMALIZATION_OPTIONS:
StudioPaletteNormalizationOptions = Object.freeze({
  strength: 1,
  lineLumaThreshold: 54,
  edgeContrastThreshold: 64,
  edgeProtection: 1,
});

const MIN_LUT_SIZE = 2;
const MAX_LUT_SIZE = 64;
const MAX_COLOR_BANDS = 16;
const MAX_PALETTE_COLORS = 256;

interface ValidImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly bytes: number;
  readonly data: Uint8ClampedArray;
}

interface ValidCube {
  readonly size: number;
  readonly entries: number;
  readonly data: Uint8ClampedArray;
}

interface ChannelStatistics {
  readonly mean: StudioAdvancedColorRgb;
  readonly standardDeviation: StudioAdvancedColorRgb;
  readonly alphaWeight: number;
}

interface PreparedRequest {
  readonly kernel: StudioAdvancedColorKernelId;
  readonly source: ValidImage;
  readonly options: StudioAdvancedColorNormalizedOptions;
  readonly cube: ValidCube | null;
  readonly reference: ValidImage | null;
  readonly referenceStatistics: ChannelStatistics | null;
  readonly sourceStatistics: ChannelStatistics | null;
  readonly auxiliaryFingerprint: string;
  readonly work: StudioAdvancedColorWorkReceipt;
}

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

function inspectCube(value: unknown): ValidCube | null {
  if (!isRecord(value)) return null;
  const { size, data } = value;
  if (
    !Number.isInteger(size)
    || (size as number) < MIN_LUT_SIZE
    || (size as number) > MAX_LUT_SIZE
    || !(data instanceof Uint8ClampedArray)
  ) {
    return null;
  }
  const square = boundedProduct(size as number, size as number);
  const entries = boundedProduct(square, size as number);
  const bytes = boundedProduct(entries, 3);
  if (
    entries === Number.MAX_SAFE_INTEGER
    || bytes === Number.MAX_SAFE_INTEGER
    || data.length !== bytes
  ) {
    return null;
  }
  return { size: size as number, entries, data };
}

function inspectBudget(value: unknown): StudioAdvancedColorWorkBudget | null {
  if (!isRecord(value)) return null;
  const { maxPixels, maxAuxiliaryEntries, maxWorkUnits, maxWorkingBytes } = value;
  if (
    !Number.isSafeInteger(maxPixels)
    || !Number.isSafeInteger(maxAuxiliaryEntries)
    || !Number.isSafeInteger(maxWorkUnits)
    || !Number.isSafeInteger(maxWorkingBytes)
    || (maxPixels as number) <= 0
    || (maxAuxiliaryEntries as number) <= 0
    || (maxWorkUnits as number) <= 0
    || (maxWorkingBytes as number) <= 0
  ) {
    return null;
  }
  return {
    maxPixels: maxPixels as number,
    maxAuxiliaryEntries: maxAuxiliaryEntries as number,
    maxWorkUnits: maxWorkUnits as number,
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

function validRgb(value: unknown): StudioAdvancedColorRgb | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((channel) => (
      typeof channel !== "number"
      || !Number.isInteger(channel)
      || channel < 0
      || channel > 255
    ))
  ) {
    return null;
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function optionsRecord(value: unknown): Record<string, unknown> | null {
  return value === undefined ? {} : isRecord(value) ? value : null;
}

function normalizeHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

function normalizeBand(value: unknown): StudioSelectiveColorBand | null {
  if (!isRecord(value)) return null;
  const hueCenterDegrees = validFinite(value.hueCenterDegrees, 0, -1_000_000, 1_000_000);
  const hueHalfWidthDegrees = validFinite(value.hueHalfWidthDegrees, 30, 0, 180);
  const hueFeatherDegrees = validFinite(value.hueFeatherDegrees, 15, 0, 180);
  const lumaMinimum = validFinite(value.lumaMinimum, 0, 0, 1);
  const lumaMaximum = validFinite(value.lumaMaximum, 1, 0, 1);
  const lumaFeather = validFinite(value.lumaFeather, 0.1, 0, 1);
  const hueShiftDegrees = validFinite(value.hueShiftDegrees, 0, -360, 360);
  const saturationScale = validFinite(value.saturationScale, 1, 0, 4);
  const lightnessDelta = validFinite(value.lightnessDelta, 0, -1, 1);
  if (
    hueCenterDegrees === null
    || hueHalfWidthDegrees === null
    || hueFeatherDegrees === null
    || lumaMinimum === null
    || lumaMaximum === null
    || lumaFeather === null
    || hueShiftDegrees === null
    || saturationScale === null
    || lightnessDelta === null
    || lumaMinimum > lumaMaximum
  ) {
    return null;
  }
  return {
    hueCenterDegrees: normalizeHue(hueCenterDegrees),
    hueHalfWidthDegrees,
    hueFeatherDegrees,
    lumaMinimum,
    lumaMaximum,
    lumaFeather,
    hueShiftDegrees,
    saturationScale,
    lightnessDelta,
  };
}

function kernelOf(value: unknown): StudioAdvancedColorKernelId | "unknown" {
  if (
    value === "3d-lut-color-lookup"
    || value === "selective-color-bands"
    || value === "reference-image-color-match"
    || value === "palette-normalization"
  ) {
    return value;
  }
  return "unknown";
}

function refusal(
  kernel: StudioAdvancedColorKernelId | "unknown",
  reason: StudioAdvancedColorRefusalReason,
  detail: string,
  work?: StudioAdvancedColorWorkReceipt,
): StudioAdvancedColorRefusal {
  return work
    ? { status: "refused", kernel, reason, detail, allocationPerformed: false, work }
    : { status: "refused", kernel, reason, detail, allocationPerformed: false };
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

function textFingerprint(value: string): string {
  return fnv1aText(value).toString(16).padStart(8, "0");
}

function paletteKey(palette: readonly StudioAdvancedColorRgb[]): string {
  return palette.map((color) => color.join(",")).join(";");
}

function bandsKey(bands: readonly StudioSelectiveColorBand[]): string {
  return bands.map((band) => [
    band.hueCenterDegrees,
    band.hueHalfWidthDegrees,
    band.hueFeatherDegrees,
    band.lumaMinimum,
    band.lumaMaximum,
    band.lumaFeather,
    band.hueShiftDegrees,
    band.saturationScale,
    band.lightnessDelta,
  ].join(",")).join(";");
}

function estimateWork(
  kernel: StudioAdvancedColorKernelId,
  sourcePixels: number,
  auxiliaryEntries: number,
): number {
  if (kernel === "3d-lut-color-lookup") return boundedProduct(sourcePixels, 8);
  if (kernel === "selective-color-bands") {
    return boundedProduct(sourcePixels, Math.max(1, auxiliaryEntries));
  }
  if (kernel === "reference-image-color-match") {
    return Math.min(
      Number.MAX_SAFE_INTEGER,
      boundedProduct(sourcePixels, 2) + auxiliaryEntries,
    );
  }
  return boundedProduct(sourcePixels, auxiliaryEntries + 4);
}

function channelStatistics(image: ValidImage): ChannelStatistics {
  let alphaWeight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let redSquared = 0;
  let greenSquared = 0;
  let blueSquared = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const weight = image.data[offset + 3]! / 255;
    const currentRed = image.data[offset]!;
    const currentGreen = image.data[offset + 1]!;
    const currentBlue = image.data[offset + 2]!;
    alphaWeight += weight;
    red += currentRed * weight;
    green += currentGreen * weight;
    blue += currentBlue * weight;
    redSquared += currentRed * currentRed * weight;
    greenSquared += currentGreen * currentGreen * weight;
    blueSquared += currentBlue * currentBlue * weight;
  }
  if (alphaWeight <= Number.EPSILON) {
    return {
      mean: [0, 0, 0],
      standardDeviation: [0, 0, 0],
      alphaWeight: 0,
    };
  }
  const mean: StudioAdvancedColorRgb = [
    red / alphaWeight,
    green / alphaWeight,
    blue / alphaWeight,
  ];
  return {
    mean,
    standardDeviation: [
      Math.sqrt(Math.max(0, redSquared / alphaWeight - mean[0] ** 2)),
      Math.sqrt(Math.max(0, greenSquared / alphaWeight - mean[1] ** 2)),
      Math.sqrt(Math.max(0, blueSquared / alphaWeight - mean[2] ** 2)),
    ],
    alphaWeight,
  };
}

function prepareRequest(
  requestValue: StudioAdvancedColorRequest,
  budgetValue: StudioAdvancedColorWorkBudget,
): PreparedRequest | StudioAdvancedColorRefusal {
  if (!isRecord(requestValue)) {
    return refusal("unknown", "invalid-request", "Expected an advanced-color request object.");
  }
  const kernel = kernelOf(requestValue.kernel);
  if (kernel === "unknown") {
    return refusal(kernel, "invalid-request", "Unknown advanced-color kernel.");
  }
  const source = inspectImage(requestValue.source);
  if (!source) {
    return refusal(
      kernel,
      "invalid-source",
      "Expected positive safe dimensions and one exact Uint8ClampedArray RGBA extent.",
    );
  }

  let options: StudioAdvancedColorNormalizedOptions;
  let cube: ValidCube | null = null;
  let reference: ValidImage | null = null;
  let auxiliaryEntries: number;
  let auxiliaryFingerprint: string;

  if (kernel === "3d-lut-color-lookup") {
    cube = inspectCube(requestValue.cube);
    const optionValues = optionsRecord(requestValue.options);
    const strength = optionValues
      ? validFinite(optionValues.strength, DEFAULT_STUDIO_COLOR_LOOKUP_OPTIONS.strength, 0, 1)
      : null;
    if (!cube) {
      return refusal(
        kernel,
        "invalid-auxiliary",
        `Expected a ${MIN_LUT_SIZE}..${MAX_LUT_SIZE} cube with exactly size³ RGB entries.`,
      );
    }
    if (strength === null) {
      return refusal(kernel, "invalid-options", "LUT strength must be in the range 0..1.");
    }
    options = { kernel, strength, cubeSize: cube.size };
    auxiliaryEntries = cube.entries;
    auxiliaryFingerprint = fingerprint(cube.data);
  } else if (kernel === "selective-color-bands") {
    if (
      !Array.isArray(requestValue.bands)
      || requestValue.bands.length === 0
      || requestValue.bands.length > MAX_COLOR_BANDS
    ) {
      return refusal(
        kernel,
        "invalid-auxiliary",
        `Expected 1..${MAX_COLOR_BANDS} selective color bands.`,
      );
    }
    const bands = requestValue.bands.map(normalizeBand);
    if (bands.some((band) => band === null)) {
      return refusal(kernel, "invalid-options", "A selective hue/luma band is invalid.");
    }
    const normalizedBands = bands as StudioSelectiveColorBand[];
    options = { kernel, bands: normalizedBands };
    auxiliaryEntries = normalizedBands.length;
    auxiliaryFingerprint = textFingerprint(bandsKey(normalizedBands));
  } else if (kernel === "reference-image-color-match") {
    reference = inspectImage(requestValue.reference);
    const optionValues = optionsRecord(requestValue.options);
    const strength = optionValues
      ? validFinite(
        optionValues.strength,
        DEFAULT_STUDIO_REFERENCE_COLOR_MATCH_OPTIONS.strength,
        0,
        1,
      )
      : null;
    const clipSigma = optionValues
      ? validFinite(
        optionValues.clipSigma,
        DEFAULT_STUDIO_REFERENCE_COLOR_MATCH_OPTIONS.clipSigma,
        0.5,
        8,
      )
      : null;
    const minimumStandardDeviation = optionValues
      ? validFinite(
        optionValues.minimumStandardDeviation,
        DEFAULT_STUDIO_REFERENCE_COLOR_MATCH_OPTIONS.minimumStandardDeviation,
        0.01,
        64,
      )
      : null;
    if (!reference) {
      return refusal(kernel, "invalid-auxiliary", "Expected a valid RGBA reference image.");
    }
    if (strength === null || clipSigma === null || minimumStandardDeviation === null) {
      return refusal(kernel, "invalid-options", "Reference color-match options are invalid.");
    }
    options = { kernel, strength, clipSigma, minimumStandardDeviation };
    auxiliaryEntries = reference.pixels;
    auxiliaryFingerprint = fingerprint(reference.data);
  } else {
    if (
      !Array.isArray(requestValue.palette)
      || requestValue.palette.length === 0
      || requestValue.palette.length > MAX_PALETTE_COLORS
    ) {
      return refusal(
        kernel,
        "invalid-auxiliary",
        `Expected a palette containing 1..${MAX_PALETTE_COLORS} RGB colors.`,
      );
    }
    const palette = requestValue.palette.map(validRgb);
    if (palette.some((color) => color === null)) {
      return refusal(kernel, "invalid-auxiliary", "Palette colors must be integer RGB triplets.");
    }
    const normalizedPalette = palette as StudioAdvancedColorRgb[];
    const optionValues = optionsRecord(requestValue.options);
    const strength = optionValues
      ? validFinite(
        optionValues.strength,
        DEFAULT_STUDIO_PALETTE_NORMALIZATION_OPTIONS.strength,
        0,
        1,
      )
      : null;
    const lineLumaThreshold = optionValues
      ? validFinite(
        optionValues.lineLumaThreshold,
        DEFAULT_STUDIO_PALETTE_NORMALIZATION_OPTIONS.lineLumaThreshold,
        0,
        255,
      )
      : null;
    const edgeContrastThreshold = optionValues
      ? validFinite(
        optionValues.edgeContrastThreshold,
        DEFAULT_STUDIO_PALETTE_NORMALIZATION_OPTIONS.edgeContrastThreshold,
        0,
        255,
      )
      : null;
    const edgeProtection = optionValues
      ? validFinite(
        optionValues.edgeProtection,
        DEFAULT_STUDIO_PALETTE_NORMALIZATION_OPTIONS.edgeProtection,
        0,
        1,
      )
      : null;
    if (
      strength === null
      || lineLumaThreshold === null
      || edgeContrastThreshold === null
      || edgeProtection === null
    ) {
      return refusal(kernel, "invalid-options", "Palette normalization options are invalid.");
    }
    options = {
      kernel,
      palette: normalizedPalette,
      strength,
      lineLumaThreshold,
      edgeContrastThreshold,
      edgeProtection,
    };
    auxiliaryEntries = normalizedPalette.length;
    auxiliaryFingerprint = textFingerprint(paletteKey(normalizedPalette));
  }

  const budget = inspectBudget(budgetValue);
  if (!budget) {
    return refusal(kernel, "invalid-budget", "Budget limits must be positive safe integers.");
  }
  const workUnits = estimateWork(kernel, source.pixels, auxiliaryEntries);
  const work: StudioAdvancedColorWorkReceipt = {
    pixels: source.pixels,
    auxiliaryEntries,
    workUnits,
    workingBytes: source.bytes,
    budget,
  };
  if (
    source.pixels > budget.maxPixels
    || auxiliaryEntries > budget.maxAuxiliaryEntries
    || workUnits > budget.maxWorkUnits
    || source.bytes > budget.maxWorkingBytes
  ) {
    return refusal(
      kernel,
      "budget-exceeded",
      "The operation exceeds its pixel, auxiliary, work-unit, or working-memory budget.",
      work,
    );
  }

  let sourceStatistics: ChannelStatistics | null = null;
  let referenceStatistics: ChannelStatistics | null = null;
  if (kernel === "reference-image-color-match") {
    sourceStatistics = channelStatistics(source);
    referenceStatistics = channelStatistics(reference!);
    if (referenceStatistics.alphaWeight <= Number.EPSILON) {
      return refusal(
        kernel,
        "empty-reference",
        "Reference color matching requires at least one pixel with non-zero alpha.",
        work,
      );
    }
  }

  return {
    kernel,
    source,
    options,
    cube,
    reference,
    sourceStatistics,
    referenceStatistics,
    auxiliaryFingerprint,
    work,
  };
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

function cubeRgb(cube: ValidCube, red: number, green: number, blue: number): StudioAdvancedColorRgb {
  const offset = ((blue * cube.size + green) * cube.size + red) * 3;
  return [cube.data[offset]!, cube.data[offset + 1]!, cube.data[offset + 2]!];
}

function lookupCubeRgb(cube: ValidCube, source: StudioAdvancedColorRgb): StudioAdvancedColorRgb {
  const scale = cube.size - 1;
  const redPosition = source[0] / 255 * scale;
  const greenPosition = source[1] / 255 * scale;
  const bluePosition = source[2] / 255 * scale;
  const red0 = Math.floor(redPosition);
  const green0 = Math.floor(greenPosition);
  const blue0 = Math.floor(bluePosition);
  const red1 = Math.min(scale, red0 + 1);
  const green1 = Math.min(scale, green0 + 1);
  const blue1 = Math.min(scale, blue0 + 1);
  const redFraction = redPosition - red0;
  const greenFraction = greenPosition - green0;
  const blueFraction = bluePosition - blue0;
  let outputRed = 0;
  let outputGreen = 0;
  let outputBlue = 0;
  for (let blueCorner = 0; blueCorner <= 1; blueCorner += 1) {
    const blueIndex = blueCorner === 0 ? blue0 : blue1;
    const blueWeight = blueCorner === 0 ? 1 - blueFraction : blueFraction;
    for (let greenCorner = 0; greenCorner <= 1; greenCorner += 1) {
      const greenIndex = greenCorner === 0 ? green0 : green1;
      const greenWeight = greenCorner === 0 ? 1 - greenFraction : greenFraction;
      for (let redCorner = 0; redCorner <= 1; redCorner += 1) {
        const redIndex = redCorner === 0 ? red0 : red1;
        const redWeight = redCorner === 0 ? 1 - redFraction : redFraction;
        const weight = redWeight * greenWeight * blueWeight;
        const color = cubeRgb(cube, redIndex, greenIndex, blueIndex);
        outputRed += color[0] * weight;
        outputGreen += color[1] * weight;
        outputBlue += color[2] * weight;
      }
    }
  }
  return [outputRed, outputGreen, outputBlue];
}

function rgbToHsl(rgb: StudioAdvancedColorRgb): readonly [number, number, number] {
  const red = rgb[0] / 255;
  const green = rgb[1] / 255;
  const blue = rgb[2] / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  if (maximum === minimum) return [0, 0, lightness];
  const delta = maximum - minimum;
  const saturation = lightness > 0.5
    ? delta / (2 - maximum - minimum)
    : delta / (maximum + minimum);
  let hue: number;
  if (maximum === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (maximum === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return [hue / 6, saturation, lightness];
}

function hueToRgb(p: number, q: number, value: number): number {
  let hue = value;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number): StudioAdvancedColorRgb {
  if (saturation <= Number.EPSILON) {
    const gray = lightness * 255;
    return [gray, gray, gray];
  }
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    hueToRgb(p, q, hue + 1 / 3) * 255,
    hueToRgb(p, q, hue) * 255,
    hueToRgb(p, q, hue - 1 / 3) * 255,
  ];
}

function circularHueDistance(leftDegrees: number, rightDegrees: number): number {
  const absolute = Math.abs(normalizeHue(leftDegrees) - normalizeHue(rightDegrees));
  return Math.min(absolute, 360 - absolute);
}

function bandWeight(
  hueDegrees: number,
  lightness: number,
  band: StudioSelectiveColorBand,
): number {
  const hueDistance = circularHueDistance(hueDegrees, band.hueCenterDegrees);
  const hueWeight = hueDistance <= band.hueHalfWidthDegrees
    ? 1
    : band.hueFeatherDegrees <= 0
      ? 0
      : 1 - smoothstep(
        (hueDistance - band.hueHalfWidthDegrees) / band.hueFeatherDegrees,
      );
  let lumaWeight = 1;
  if (lightness < band.lumaMinimum) {
    lumaWeight = band.lumaFeather <= 0
      ? 0
      : 1 - smoothstep((band.lumaMinimum - lightness) / band.lumaFeather);
  } else if (lightness > band.lumaMaximum) {
    lumaWeight = band.lumaFeather <= 0
      ? 0
      : 1 - smoothstep((lightness - band.lumaMaximum) / band.lumaFeather);
  }
  return clamp(hueWeight * lumaWeight, 0, 1);
}

function selectiveColorRgb(
  source: StudioAdvancedColorRgb,
  bands: readonly StudioSelectiveColorBand[],
): StudioAdvancedColorRgb {
  let [hue, saturation, lightness] = rgbToHsl(source);
  for (const band of bands) {
    const weight = bandWeight(hue * 360, lightness, band);
    hue = ((hue + band.hueShiftDegrees / 360 * weight) % 1 + 1) % 1;
    saturation = clamp(
      saturation * (1 + (band.saturationScale - 1) * weight),
      0,
      1,
    );
    lightness = clamp(lightness + band.lightnessDelta * weight, 0, 1);
  }
  return hslToRgb(hue, saturation, lightness);
}

function referenceMatchedRgb(
  source: StudioAdvancedColorRgb,
  sourceStatistics: ChannelStatistics,
  referenceStatistics: ChannelStatistics,
  options: Extract<
    StudioAdvancedColorNormalizedOptions,
    { readonly kernel: "reference-image-color-match" }
  >,
): StudioAdvancedColorRgb {
  const output = [0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    const sourceMean = sourceStatistics.mean[channel]!;
    const sourceDeviation = sourceStatistics.standardDeviation[channel]!;
    const referenceMean = referenceStatistics.mean[channel]!;
    const referenceDeviation = referenceStatistics.standardDeviation[channel]!;
    const scale = sourceDeviation >= options.minimumStandardDeviation
      ? referenceDeviation / sourceDeviation
      : 1;
    const transformed = (source[channel]! - sourceMean) * scale + referenceMean;
    const clipRadius = Math.max(
      options.minimumStandardDeviation,
      referenceDeviation,
    ) * options.clipSigma;
    const clipped = clamp(
      transformed,
      referenceMean - clipRadius,
      referenceMean + clipRadius,
    );
    output[channel] = source[channel]! + (clipped - source[channel]!) * options.strength;
  }
  return output as unknown as StudioAdvancedColorRgb;
}

function luma(rgb: StudioAdvancedColorRgb): number {
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function pixelRgb(source: ValidImage, x: number, y: number): StudioAdvancedColorRgb {
  const offset = (y * source.width + x) * 4;
  return [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!];
}

function localEdgeContrast(source: ValidImage, x: number, y: number): number {
  const center = luma(pixelRgb(source, x, y));
  const coordinates = [
    [Math.max(0, x - 1), y],
    [Math.min(source.width - 1, x + 1), y],
    [x, Math.max(0, y - 1)],
    [x, Math.min(source.height - 1, y + 1)],
  ] as const;
  let maximum = 0;
  for (const [sampleX, sampleY] of coordinates) {
    maximum = Math.max(maximum, Math.abs(luma(pixelRgb(source, sampleX, sampleY)) - center));
  }
  return maximum;
}

function nearestPaletteRgb(
  source: StudioAdvancedColorRgb,
  palette: readonly StudioAdvancedColorRgb[],
): StudioAdvancedColorRgb {
  let selected = palette[0]!;
  let shortestDistance = Number.POSITIVE_INFINITY;
  for (const color of palette) {
    const red = source[0] - color[0];
    const green = source[1] - color[1];
    const blue = source[2] - color[2];
    const distance = red * red * 0.3 + green * green * 0.59 + blue * blue * 0.11;
    if (distance < shortestDistance) {
      shortestDistance = distance;
      selected = color;
    }
  }
  return selected;
}

function paletteNormalizedRgb(
  prepared: PreparedRequest,
  source: StudioAdvancedColorRgb,
  x: number,
  y: number,
  options: Extract<
    StudioAdvancedColorNormalizedOptions,
    { readonly kernel: "palette-normalization" }
  >,
): StudioAdvancedColorRgb {
  const paletteColor = nearestPaletteRgb(source, options.palette);
  const isLine = luma(source) <= options.lineLumaThreshold;
  const isEdge = localEdgeContrast(prepared.source, x, y) >= options.edgeContrastThreshold;
  const protection = isLine || isEdge ? options.edgeProtection : 0;
  const strength = options.strength * (1 - protection);
  return [
    source[0] + (paletteColor[0] - source[0]) * strength,
    source[1] + (paletteColor[1] - source[1]) * strength,
    source[2] + (paletteColor[2] - source[2]) * strength,
  ];
}

function filteredRgb(
  prepared: PreparedRequest,
  source: StudioAdvancedColorRgb,
  x: number,
  y: number,
): StudioAdvancedColorRgb {
  if (prepared.options.kernel === "3d-lut-color-lookup") {
    const lookedUp = lookupCubeRgb(prepared.cube!, source);
    return [
      source[0] + (lookedUp[0] - source[0]) * prepared.options.strength,
      source[1] + (lookedUp[1] - source[1]) * prepared.options.strength,
      source[2] + (lookedUp[2] - source[2]) * prepared.options.strength,
    ];
  }
  if (prepared.options.kernel === "selective-color-bands") {
    return selectiveColorRgb(source, prepared.options.bands);
  }
  if (prepared.options.kernel === "reference-image-color-match") {
    return referenceMatchedRgb(
      source,
      prepared.sourceStatistics!,
      prepared.referenceStatistics!,
      prepared.options,
    );
  }
  return paletteNormalizedRgb(prepared, source, x, y, prepared.options);
}

function optionsKey(options: StudioAdvancedColorNormalizedOptions): string {
  if (options.kernel === "3d-lut-color-lookup") {
    return `strength=${options.strength};cubeSize=${options.cubeSize}`;
  }
  if (options.kernel === "selective-color-bands") return bandsKey(options.bands);
  if (options.kernel === "reference-image-color-match") {
    return [
      `strength=${options.strength}`,
      `clipSigma=${options.clipSigma}`,
      `minimumStandardDeviation=${options.minimumStandardDeviation}`,
    ].join(";");
  }
  return [
    `palette=${paletteKey(options.palette)}`,
    `strength=${options.strength}`,
    `lineLumaThreshold=${options.lineLumaThreshold}`,
    `edgeContrastThreshold=${options.edgeContrastThreshold}`,
    `edgeProtection=${options.edgeProtection}`,
  ].join(";");
}

function createReceipt(input: {
  readonly prepared: PreparedRequest;
  readonly output: Uint8ClampedArray;
  readonly changedPixelCount: number;
  readonly changedBounds: StudioAdvancedColorChangedBounds | null;
}): StudioAdvancedColorTransactionReceipt {
  const { prepared, output, changedPixelCount, changedBounds } = input;
  const sourceFingerprint = fingerprint(prepared.source.data);
  const identity = [
    prepared.kernel,
    `${prepared.source.width}x${prepared.source.height}`,
    sourceFingerprint,
    prepared.auxiliaryFingerprint,
    optionsKey(prepared.options),
  ].join("|");
  return {
    schema: "toonspectrum.advanced-color-filter/v1",
    operationId: `advanced-color-v1-${textFingerprint(identity)}`,
    kernel: prepared.kernel,
    width: prepared.source.width,
    height: prepared.source.height,
    alphaSemantics: "preserve-source-alpha",
    sourceFingerprint,
    auxiliaryFingerprint: prepared.auxiliaryFingerprint,
    outputFingerprint: fingerprint(output),
    options: prepared.options,
    changedPixelCount,
    changedBounds,
  };
}

/**
 * Execute one bounded advanced-color operation. The CPU pixels and receipt are the golden oracle
 * for later Worker/WebGPU implementations.
 */
export function applyStudioAdvancedColorFilter(
  request: StudioAdvancedColorRequest,
  budget: StudioAdvancedColorWorkBudget = DEFAULT_STUDIO_ADVANCED_COLOR_WORK_BUDGET,
): StudioAdvancedColorResult {
  const prepared = prepareRequest(request, budget);
  if ("status" in prepared) return prepared;

  // First image-sized allocation, after all validation, budget checks, and reference validation.
  const output = prepared.source.data.slice();
  let changedPixelCount = 0;
  let minimumX = prepared.source.width;
  let minimumY = prepared.source.height;
  let maximumX = -1;
  let maximumY = -1;

  for (let y = 0; y < prepared.source.height; y += 1) {
    for (let x = 0; x < prepared.source.width; x += 1) {
      const offset = (y * prepared.source.width + x) * 4;
      const source: StudioAdvancedColorRgb = [
        prepared.source.data[offset]!,
        prepared.source.data[offset + 1]!,
        prepared.source.data[offset + 2]!,
      ];
      const filtered = filteredRgb(prepared, source, x, y);
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
      // Alpha remains the exact byte copied from source.
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
    transaction: createReceipt({
      prepared,
      output,
      changedPixelCount,
      changedBounds,
    }),
  };
}

export function applyStudioColorLookup(
  request: Omit<StudioColorLookupRequest, "kernel">,
  budget?: StudioAdvancedColorWorkBudget,
): StudioAdvancedColorResult {
  return applyStudioAdvancedColorFilter({ ...request, kernel: "3d-lut-color-lookup" }, budget);
}

export function applyStudioSelectiveColorBands(
  request: Omit<StudioSelectiveColorRequest, "kernel">,
  budget?: StudioAdvancedColorWorkBudget,
): StudioAdvancedColorResult {
  return applyStudioAdvancedColorFilter({ ...request, kernel: "selective-color-bands" }, budget);
}

export function applyStudioReferenceImageColorMatch(
  request: Omit<StudioReferenceColorMatchRequest, "kernel">,
  budget?: StudioAdvancedColorWorkBudget,
): StudioAdvancedColorResult {
  return applyStudioAdvancedColorFilter(
    { ...request, kernel: "reference-image-color-match" },
    budget,
  );
}

export function applyStudioPaletteNormalization(
  request: Omit<StudioPaletteNormalizationRequest, "kernel">,
  budget?: StudioAdvancedColorWorkBudget,
): StudioAdvancedColorResult {
  return applyStudioAdvancedColorFilter({ ...request, kernel: "palette-normalization" }, budget);
}

export interface StudioParsedCubeLut {
  size: number;
  data: Float32Array;
  title?: string;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export function parseStudioCubeLut(text: string): StudioParsedCubeLut | null {
  let size = 0;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  
  const lines = text.split(/\r?\n/);
  const data: number[] = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('TITLE')) {
      const match = line.match(/^TITLE\s+"?([^"]*)"?$/);
      if (match) title = match[1];
      continue;
    }

    if (line.startsWith('LUT_3D_SIZE')) {
      const match = line.match(/^LUT_3D_SIZE\s+(\d+)$/);
      if (match) size = parseInt(match[1], 10);
      continue;
    }

    if (line.startsWith('LUT_1D_SIZE')) {
      const match = line.match(/^LUT_1D_SIZE\s+(\d+)$/);
      if (match && size === 0) size = parseInt(match[1], 10);
      continue;
    }

    if (line.startsWith('DOMAIN_MIN')) {
      const match = line.match(/^DOMAIN_MIN\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)$/);
      if (match) {
        domainMin = [parseFloat(match[1]!), parseFloat(match[2]!), parseFloat(match[3]!)];
      }
      continue;
    }

    if (line.startsWith('DOMAIN_MAX')) {
      const match = line.match(/^DOMAIN_MAX\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)$/);
      if (match) {
        domainMax = [parseFloat(match[1]!), parseFloat(match[2]!), parseFloat(match[3]!)];
      }
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]!);
      const g = parseFloat(parts[1]!);
      const b = parseFloat(parts[2]!);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        data.push(r, g, b);
      }
    }
  }

  if (size === 0 || data.length === 0) return null;
  
  return {
    size,
    title,
    domainMin,
    domainMax,
    data: new Float32Array(data)
  };
}

export function applyStudio3dCubeLut(
  source: { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray },
  lut: StudioParsedCubeLut,
  blendAmount: number = 1
): void {
  if (blendAmount <= 0) return;
  const { data, size, domainMin, domainMax } = lut;
  const pixels = source.data;
  
  const [minR, minG, minB] = domainMin;
  const [maxR, maxG, maxB] = domainMax;
  
  const scaleR = maxR! > minR! ? 1 / (maxR! - minR!) : 1;
  const scaleG = maxG! > minG! ? 1 / (maxG! - minG!) : 1;
  const scaleB = maxB! > minB! ? 1 / (maxB! - minB!) : 1;
  
  const gridMax = size - 1;
  
  for (let i = 0; i < pixels.length; i += 4) {
    const sR = pixels[i]!;
    const sG = pixels[i + 1]!;
    const sB = pixels[i + 2]!;
    
    let rNorm = sR / 255;
    let gNorm = sG / 255;
    let bNorm = sB / 255;
    
    rNorm = Math.max(0, Math.min(1, (rNorm - minR!) * scaleR));
    gNorm = Math.max(0, Math.min(1, (gNorm - minG!) * scaleG));
    bNorm = Math.max(0, Math.min(1, (bNorm - minB!) * scaleB));
    
    const rPos = rNorm * gridMax;
    const gPos = gNorm * gridMax;
    const bPos = bNorm * gridMax;
    
    const r0 = Math.floor(rPos);
    const g0 = Math.floor(gPos);
    const b0 = Math.floor(bPos);
    
    const r1 = Math.min(gridMax, r0 + 1);
    const g1 = Math.min(gridMax, g0 + 1);
    const b1 = Math.min(gridMax, b0 + 1);
    
    const rFrac = rPos - r0;
    const gFrac = gPos - g0;
    const bFrac = bPos - b0;

    const offset000 = ((b0 * size + g0) * size + r0) * 3;
    const offset100 = ((b0 * size + g0) * size + r1) * 3;
    const offset010 = ((b0 * size + g1) * size + r0) * 3;
    const offset110 = ((b0 * size + g1) * size + r1) * 3;
    const offset001 = ((b1 * size + g0) * size + r0) * 3;
    const offset101 = ((b1 * size + g0) * size + r1) * 3;
    const offset011 = ((b1 * size + g1) * size + r0) * 3;
    const offset111 = ((b1 * size + g1) * size + r1) * 3;

    const cx00R = data[offset000]! + rFrac * (data[offset100]! - data[offset000]!);
    const cx00G = data[offset000 + 1]! + rFrac * (data[offset100 + 1]! - data[offset000 + 1]!);
    const cx00B = data[offset000 + 2]! + rFrac * (data[offset100 + 2]! - data[offset000 + 2]!);

    const cx10R = data[offset010]! + rFrac * (data[offset110]! - data[offset010]!);
    const cx10G = data[offset010 + 1]! + rFrac * (data[offset110 + 1]! - data[offset010 + 1]!);
    const cx10B = data[offset010 + 2]! + rFrac * (data[offset110 + 2]! - data[offset010 + 2]!);

    const cx01R = data[offset001]! + rFrac * (data[offset101]! - data[offset001]!);
    const cx01G = data[offset001 + 1]! + rFrac * (data[offset101 + 1]! - data[offset001 + 1]!);
    const cx01B = data[offset001 + 2]! + rFrac * (data[offset101 + 2]! - data[offset001 + 2]!);

    const cx11R = data[offset011]! + rFrac * (data[offset111]! - data[offset011]!);
    const cx11G = data[offset011 + 1]! + rFrac * (data[offset111 + 1]! - data[offset011 + 1]!);
    const cx11B = data[offset011 + 2]! + rFrac * (data[offset111 + 2]! - data[offset011 + 2]!);

    const cxx0R = cx00R + gFrac * (cx10R - cx00R);
    const cxx0G = cx00G + gFrac * (cx10G - cx00G);
    const cxx0B = cx00B + gFrac * (cx10B - cx00B);

    const cxx1R = cx01R + gFrac * (cx11R - cx01R);
    const cxx1G = cx01G + gFrac * (cx11G - cx01G);
    const cxx1B = cx01B + gFrac * (cx11B - cx01B);

    let outR = cxx0R + bFrac * (cxx1R - cxx0R);
    let outG = cxx0G + bFrac * (cxx1G - cxx0G);
    let outB = cxx0B + bFrac * (cxx1B - cxx0B);

    if (blendAmount < 1) {
      outR = (sR / 255) + (outR - (sR / 255)) * blendAmount;
      outG = (sG / 255) + (outG - (sG / 255)) * blendAmount;
      outB = (sB / 255) + (outB - (sB / 255)) * blendAmount;
    }

    pixels[i] = Math.max(0, Math.min(255, Math.round(outR * 255)));
    pixels[i + 1] = Math.max(0, Math.min(255, Math.round(outG * 255)));
    pixels[i + 2] = Math.max(0, Math.min(255, Math.round(outB * 255)));
  }
}
