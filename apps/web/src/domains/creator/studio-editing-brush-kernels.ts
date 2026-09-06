/**
 * Deterministic, mask-driven pixel kernels for editing brushes.
 *
 * The module intentionally has no DOM, Canvas, Worker, GPU, or editor-state dependency. It is a
 * bounded CPU reference implementation that can be called from a Worker today and used as a
 * golden oracle when the same operations move to WebGPU. All kernels:
 *
 * - validate complete RGBA/mask extents before allocating an output buffer,
 * - refuse work that exceeds explicit pixel/sample/memory budgets,
 * - combine brush mask × optional selection mask × pressure × flow,
 * - preserve the current artwork alpha byte exactly,
 * - never mutate source, masks, selection, or immutable history snapshots,
 * - and emit a deterministic transaction receipt for later Worker/CRDT integration.
 */

export interface StudioEditingBrushRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface StudioEditingBrushMask {
  readonly width: number;
  readonly height: number;
  /** One coverage byte per pixel: 0 = excluded, 255 = fully included. */
  readonly data: Uint8ClampedArray;
}

export interface StudioEditingBrushHistorySnapshot {
  /** Stable document revision/content identity supplied by the future history/CRDT host. */
  readonly id: string;
  readonly image: StudioEditingBrushRgbaImage;
}

export type StudioEditingBrushKernelId =
  | "blur-brush"
  | "sharpen-brush"
  | "color-replacement-brush"
  | "art-history-restore-brush";

export interface StudioEditingBrushWorkBudget {
  readonly maxPixels: number;
  readonly maxNeighborhoodSamples: number;
  readonly maxWorkingBytes: number;
}

export interface StudioEditingBrushWorkReceipt {
  readonly pixels: number;
  /** Worst-case source samples for the requested kernel, calculated before output allocation. */
  readonly neighborhoodSamples: number;
  /** Bytes allocated by the kernel. Inputs and immutable snapshots are not counted as working RAM. */
  readonly workingBytes: number;
  readonly budget: StudioEditingBrushWorkBudget;
}

export interface StudioBlurBrushOptions {
  readonly radius: number;
}

export interface StudioSharpenBrushOptions {
  readonly radius: number;
  readonly amount: number;
}

export type StudioEditingBrushRgb = readonly [number, number, number];

export interface StudioColorReplacementBrushOptions {
  readonly target: StudioEditingBrushRgb;
  readonly replacement: StudioEditingBrushRgb;
  /** Euclidean RGB distance in the inclusive range 0..sqrt(3 × 255²). */
  readonly tolerance: number;
  /** 0 = hard threshold; 1 = feather the full tolerance range. */
  readonly softness: number;
  /** Keep each source pixel's HSL lightness while adopting the replacement hue/saturation. */
  readonly preserveLuminance: boolean;
}

interface StudioEditingBrushRequestBase {
  readonly source: StudioEditingBrushRgbaImage;
  readonly brushMask: StudioEditingBrushMask;
  readonly selectionMask?: StudioEditingBrushMask;
  readonly pressure?: number;
  readonly flow?: number;
}

export interface StudioBlurBrushRequest extends StudioEditingBrushRequestBase {
  readonly kernel: "blur-brush";
  readonly options?: Partial<StudioBlurBrushOptions>;
}

export interface StudioSharpenBrushRequest extends StudioEditingBrushRequestBase {
  readonly kernel: "sharpen-brush";
  readonly options?: Partial<StudioSharpenBrushOptions>;
}

export interface StudioColorReplacementBrushRequest extends StudioEditingBrushRequestBase {
  readonly kernel: "color-replacement-brush";
  readonly options: Partial<StudioColorReplacementBrushOptions> & {
    readonly target: StudioEditingBrushRgb;
    readonly replacement: StudioEditingBrushRgb;
  };
}

export interface StudioArtHistoryRestoreBrushRequest extends StudioEditingBrushRequestBase {
  readonly kernel: "art-history-restore-brush";
  /** Read-only source-of-truth captured before later destructive document edits. */
  readonly snapshot: StudioEditingBrushHistorySnapshot;
}

export type StudioEditingBrushRequest =
  | StudioBlurBrushRequest
  | StudioSharpenBrushRequest
  | StudioColorReplacementBrushRequest
  | StudioArtHistoryRestoreBrushRequest;

export type StudioEditingBrushNormalizedOptions =
  | { readonly kernel: "blur-brush"; readonly radius: number }
  | { readonly kernel: "sharpen-brush"; readonly radius: number; readonly amount: number }
  | {
    readonly kernel: "color-replacement-brush";
    readonly target: StudioEditingBrushRgb;
    readonly replacement: StudioEditingBrushRgb;
    readonly tolerance: number;
    readonly softness: number;
    readonly preserveLuminance: boolean;
  }
  | { readonly kernel: "art-history-restore-brush"; readonly snapshotId: string };

export interface StudioEditingBrushChangedBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A content-addressed receipt. `operationId` depends only on validated inputs and normalized
 * parameters, while `outputFingerprint` lets a Worker/peer verify execution without shipping a
 * second full pixel buffer.
 */
export interface StudioEditingBrushTransactionReceipt {
  readonly schema: "toonspectrum.editing-brush-operation/v1";
  readonly operationId: string;
  readonly kernel: StudioEditingBrushKernelId;
  readonly width: number;
  readonly height: number;
  readonly pressure: number;
  readonly flow: number;
  readonly sourceFingerprint: string;
  readonly brushMaskFingerprint: string;
  readonly selectionMaskFingerprint: string | null;
  readonly snapshotFingerprint: string | null;
  readonly outputFingerprint: string;
  readonly options: StudioEditingBrushNormalizedOptions;
  readonly maskedPixelCount: number;
  readonly changedPixelCount: number;
  readonly changedBounds: StudioEditingBrushChangedBounds | null;
}

export interface StudioEditingBrushApplied {
  readonly status: "applied";
  readonly kernel: StudioEditingBrushKernelId;
  readonly image: StudioEditingBrushRgbaImage;
  readonly work: StudioEditingBrushWorkReceipt;
  readonly alphaPreserved: true;
  readonly inputsMutated: false;
  readonly transaction: StudioEditingBrushTransactionReceipt;
}

export type StudioEditingBrushRefusalReason =
  | "invalid-request"
  | "invalid-source"
  | "invalid-mask"
  | "invalid-selection-mask"
  | "invalid-snapshot"
  | "invalid-parameters"
  | "invalid-budget"
  | "budget-exceeded";

export interface StudioEditingBrushRefusal {
  readonly status: "refused";
  readonly kernel: StudioEditingBrushKernelId | "unknown";
  readonly reason: StudioEditingBrushRefusalReason;
  readonly detail: string;
  /** Confirms that no image-sized output/scratch buffer was created for the refusal. */
  readonly allocationPerformed: false;
  readonly work?: StudioEditingBrushWorkReceipt;
}

export type StudioEditingBrushResult =
  | StudioEditingBrushApplied
  | StudioEditingBrushRefusal;

export const DEFAULT_STUDIO_EDITING_BRUSH_WORK_BUDGET: StudioEditingBrushWorkBudget =
  Object.freeze({
    maxPixels: 16_777_216,
    maxNeighborhoodSamples: 800_000_000,
    maxWorkingBytes: 268_435_456,
  });

export const DEFAULT_STUDIO_BLUR_BRUSH_OPTIONS: StudioBlurBrushOptions =
  Object.freeze({ radius: 2 });

export const DEFAULT_STUDIO_SHARPEN_BRUSH_OPTIONS: StudioSharpenBrushOptions =
  Object.freeze({ radius: 1, amount: 1 });

export const DEFAULT_STUDIO_COLOR_REPLACEMENT_BRUSH_OPTIONS =
  Object.freeze({
    tolerance: 72,
    softness: 0.35,
    preserveLuminance: true,
  });

const MAX_BLUR_RADIUS = 12;
const MAX_SHARPEN_RADIUS = 4;
const MAX_COLOR_DISTANCE = Math.sqrt(3 * 255 * 255);

interface ValidImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: number;
  readonly bytes: number;
  readonly data: Uint8ClampedArray;
}

interface ValidMask {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

interface PreparedRequest {
  readonly kernel: StudioEditingBrushKernelId;
  readonly source: ValidImage;
  readonly brushMask: ValidMask;
  readonly selectionMask: ValidMask | null;
  readonly pressure: number;
  readonly flow: number;
  readonly snapshot: StudioEditingBrushHistorySnapshot | null;
  readonly normalizedOptions: StudioEditingBrushNormalizedOptions;
  readonly work: StudioEditingBrushWorkReceipt;
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

function inspectMask(
  value: unknown,
  width: number,
  height: number,
): ValidMask | null {
  if (!isRecord(value)) return null;
  if (
    value.width !== width
    || value.height !== height
    || !(value.data instanceof Uint8ClampedArray)
    || value.data.length !== width * height
  ) {
    return null;
  }
  return { width, height, data: value.data };
}

function inspectBudget(value: unknown): StudioEditingBrushWorkBudget | null {
  if (!isRecord(value)) return null;
  const { maxPixels, maxNeighborhoodSamples, maxWorkingBytes } = value;
  if (
    !Number.isSafeInteger(maxPixels)
    || !Number.isSafeInteger(maxNeighborhoodSamples)
    || !Number.isSafeInteger(maxWorkingBytes)
    || (maxPixels as number) <= 0
    || (maxNeighborhoodSamples as number) <= 0
    || (maxWorkingBytes as number) <= 0
  ) {
    return null;
  }
  return {
    maxPixels: maxPixels as number,
    maxNeighborhoodSamples: maxNeighborhoodSamples as number,
    maxWorkingBytes: maxWorkingBytes as number,
  };
}

function validUnitInterval(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1
    ? value
    : null;
}

function validInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= min
    && value <= max
    ? value
    : null;
}

function validFinite(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined) return fallback;
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= min
    && value <= max
    ? value
    : null;
}

function validRgb(value: unknown): StudioEditingBrushRgb | null {
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

function refusal(
  kernel: StudioEditingBrushKernelId | "unknown",
  reason: StudioEditingBrushRefusalReason,
  detail: string,
  work?: StudioEditingBrushWorkReceipt,
): StudioEditingBrushRefusal {
  return work
    ? { status: "refused", kernel, reason, detail, allocationPerformed: false, work }
    : { status: "refused", kernel, reason, detail, allocationPerformed: false };
}

function kernelOf(value: unknown): StudioEditingBrushKernelId | "unknown" {
  if (
    value === "blur-brush"
    || value === "sharpen-brush"
    || value === "color-replacement-brush"
    || value === "art-history-restore-brush"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeOptions(
  request: Record<string, unknown>,
  kernel: StudioEditingBrushKernelId,
): StudioEditingBrushNormalizedOptions | null {
  const options = request.options === undefined
    ? {}
    : isRecord(request.options) ? request.options : null;
  if (options === null) return null;

  if (kernel === "blur-brush") {
    const radius = validInteger(
      options.radius,
      DEFAULT_STUDIO_BLUR_BRUSH_OPTIONS.radius,
      1,
      MAX_BLUR_RADIUS,
    );
    return radius === null ? null : { kernel, radius };
  }

  if (kernel === "sharpen-brush") {
    const radius = validInteger(
      options.radius,
      DEFAULT_STUDIO_SHARPEN_BRUSH_OPTIONS.radius,
      1,
      MAX_SHARPEN_RADIUS,
    );
    const amount = validFinite(
      options.amount,
      DEFAULT_STUDIO_SHARPEN_BRUSH_OPTIONS.amount,
      0,
      3,
    );
    return radius === null || amount === null ? null : { kernel, radius, amount };
  }

  if (kernel === "color-replacement-brush") {
    const target = validRgb(options.target);
    const replacement = validRgb(options.replacement);
    const tolerance = validFinite(
      options.tolerance,
      DEFAULT_STUDIO_COLOR_REPLACEMENT_BRUSH_OPTIONS.tolerance,
      0,
      MAX_COLOR_DISTANCE,
    );
    const softness = validUnitInterval(
      options.softness,
      DEFAULT_STUDIO_COLOR_REPLACEMENT_BRUSH_OPTIONS.softness,
    );
    const preserveLuminance = options.preserveLuminance
      ?? DEFAULT_STUDIO_COLOR_REPLACEMENT_BRUSH_OPTIONS.preserveLuminance;
    if (
      target === null
      || replacement === null
      || tolerance === null
      || softness === null
      || typeof preserveLuminance !== "boolean"
    ) {
      return null;
    }
    return {
      kernel,
      target,
      replacement,
      tolerance,
      softness,
      preserveLuminance,
    };
  }

  const snapshot = request.snapshot;
  if (
    !isRecord(snapshot)
    || typeof snapshot.id !== "string"
    || snapshot.id.trim().length === 0
    || snapshot.id.length > 256
  ) {
    return null;
  }
  return { kernel, snapshotId: snapshot.id };
}

function samplesPerPixel(options: StudioEditingBrushNormalizedOptions): number {
  if (options.kernel === "blur-brush" || options.kernel === "sharpen-brush") {
    const side = options.radius * 2 + 1;
    return side * side;
  }
  return 1;
}

function prepareRequest(
  requestValue: StudioEditingBrushRequest,
  budgetValue: StudioEditingBrushWorkBudget,
): PreparedRequest | StudioEditingBrushRefusal {
  if (!isRecord(requestValue)) {
    return refusal("unknown", "invalid-request", "Expected an editing-brush request object.");
  }
  const kernel = kernelOf(requestValue.kernel);
  if (kernel === "unknown") {
    return refusal(kernel, "invalid-request", "Unknown editing-brush kernel.");
  }
  const source = inspectImage(requestValue.source);
  if (!source) {
    return refusal(
      kernel,
      "invalid-source",
      "Expected positive safe dimensions and one exact Uint8ClampedArray RGBA extent.",
    );
  }
  const brushMask = inspectMask(requestValue.brushMask, source.width, source.height);
  if (!brushMask) {
    return refusal(
      kernel,
      "invalid-mask",
      "Brush mask dimensions must match the source and contain exactly one byte per pixel.",
    );
  }
  const selectionMask = requestValue.selectionMask === undefined
    ? null
    : inspectMask(requestValue.selectionMask, source.width, source.height);
  if (requestValue.selectionMask !== undefined && !selectionMask) {
    return refusal(
      kernel,
      "invalid-selection-mask",
      "Selection mask dimensions must match the source and contain exactly one byte per pixel.",
    );
  }
  const pressure = validUnitInterval(requestValue.pressure, 1);
  const flow = validUnitInterval(requestValue.flow, 1);
  const normalizedOptions = normalizeOptions(requestValue, kernel);
  if (pressure === null || flow === null || normalizedOptions === null) {
    return refusal(
      kernel,
      "invalid-parameters",
      "Pressure, flow, colors, radius, amount, tolerance, softness, or snapshot identity is invalid.",
    );
  }

  let snapshot: StudioEditingBrushHistorySnapshot | null = null;
  if (kernel === "art-history-restore-brush") {
    if (normalizedOptions.kernel !== "art-history-restore-brush") {
      return refusal(
        kernel,
        "invalid-parameters",
        "History restore options did not normalize to the requested kernel.",
      );
    }
    const snapshotValue = requestValue.snapshot;
    if (!isRecord(snapshotValue)) {
      return refusal(kernel, "invalid-snapshot", "Expected an immutable history snapshot.");
    }
    const snapshotImage = inspectImage(snapshotValue.image);
    if (
      !snapshotImage
      || snapshotImage.width !== source.width
      || snapshotImage.height !== source.height
    ) {
      return refusal(
        kernel,
        "invalid-snapshot",
        "History snapshot RGBA dimensions must exactly match the current source.",
      );
    }
    snapshot = {
      id: normalizedOptions.snapshotId,
      image: {
        width: snapshotImage.width,
        height: snapshotImage.height,
        data: snapshotImage.data,
      },
    };
  }

  const budget = inspectBudget(budgetValue);
  if (!budget) {
    return refusal(
      kernel,
      "invalid-budget",
      "Budget limits must be positive safe integers.",
    );
  }
  const neighborhoodSamples = boundedProduct(
    source.pixels,
    samplesPerPixel(normalizedOptions),
  );
  const work: StudioEditingBrushWorkReceipt = {
    pixels: source.pixels,
    neighborhoodSamples,
    workingBytes: source.bytes,
    budget,
  };
  if (
    source.pixels > budget.maxPixels
    || neighborhoodSamples > budget.maxNeighborhoodSamples
    || source.bytes > budget.maxWorkingBytes
  ) {
    return refusal(
      kernel,
      "budget-exceeded",
      "The operation exceeds its pixel, neighborhood-sample, or working-memory budget.",
      work,
    );
  }

  return {
    kernel,
    source,
    brushMask,
    selectionMask,
    pressure,
    flow,
    snapshot,
    normalizedOptions,
    work,
  };
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function maskWeight(prepared: PreparedRequest, pixelIndex: number): number {
  const brush = prepared.brushMask.data[pixelIndex]! / 255;
  const selection = prepared.selectionMask
    ? prepared.selectionMask.data[pixelIndex]! / 255
    : 1;
  return brush * selection * prepared.pressure * prepared.flow;
}

function alphaWeightedBoxRgb(
  source: ValidImage,
  x: number,
  y: number,
  radius: number,
): StudioEditingBrushRgb {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    const sampleY = Math.min(source.height - 1, Math.max(0, y + offsetY));
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const sampleX = Math.min(source.width - 1, Math.max(0, x + offsetX));
      const offset = (sampleY * source.width + sampleX) * 4;
      const alphaWeight = source.data[offset + 3]! / 255;
      red += source.data[offset]! * alphaWeight;
      green += source.data[offset + 1]! * alphaWeight;
      blue += source.data[offset + 2]! * alphaWeight;
      weight += alphaWeight;
    }
  }
  if (weight <= 0) {
    const offset = (y * source.width + x) * 4;
    return [
      source.data[offset]!,
      source.data[offset + 1]!,
      source.data[offset + 2]!,
    ];
  }
  return [red / weight, green / weight, blue / weight];
}

function rgbToHsl(rgb: StudioEditingBrushRgb): readonly [number, number, number] {
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

function hueToRgb(p: number, q: number, tValue: number): number {
  let t = tValue;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(hue: number, saturation: number, lightness: number): StudioEditingBrushRgb {
  if (saturation === 0) {
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

function smoothstep(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function colorMatchWeight(
  rgb: StudioEditingBrushRgb,
  options: Extract<
    StudioEditingBrushNormalizedOptions,
    { readonly kernel: "color-replacement-brush" }
  >,
): number {
  const red = rgb[0] - options.target[0];
  const green = rgb[1] - options.target[1];
  const blue = rgb[2] - options.target[2];
  const distance = Math.sqrt(red * red + green * green + blue * blue);
  if (options.tolerance === 0) return distance === 0 ? 1 : 0;
  const hardRadius = options.tolerance * (1 - options.softness);
  if (distance <= hardRadius) return 1;
  if (distance >= options.tolerance) return 0;
  const featherSpan = Math.max(Number.EPSILON, options.tolerance - hardRadius);
  return 1 - smoothstep((distance - hardRadius) / featherSpan);
}

function replacementRgb(
  source: StudioEditingBrushRgb,
  options: Extract<
    StudioEditingBrushNormalizedOptions,
    { readonly kernel: "color-replacement-brush" }
  >,
): StudioEditingBrushRgb {
  if (!options.preserveLuminance) return options.replacement;
  const [, , sourceLightness] = rgbToHsl(source);
  const [hue, saturation] = rgbToHsl(options.replacement);
  return hslToRgb(hue, saturation, sourceLightness);
}

function applyPixel(
  output: Uint8ClampedArray,
  offset: number,
  target: StudioEditingBrushRgb,
  weight: number,
): boolean {
  const sourceRed = output[offset]!;
  const sourceGreen = output[offset + 1]!;
  const sourceBlue = output[offset + 2]!;
  const red = clampByte(sourceRed + (target[0] - sourceRed) * weight);
  const green = clampByte(sourceGreen + (target[1] - sourceGreen) * weight);
  const blue = clampByte(sourceBlue + (target[2] - sourceBlue) * weight);
  output[offset] = red;
  output[offset + 1] = green;
  output[offset + 2] = blue;
  return red !== sourceRed || green !== sourceGreen || blue !== sourceBlue;
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

function optionsKey(options: StudioEditingBrushNormalizedOptions): string {
  if (options.kernel === "blur-brush") return `radius=${options.radius}`;
  if (options.kernel === "sharpen-brush") {
    return `radius=${options.radius};amount=${options.amount}`;
  }
  if (options.kernel === "color-replacement-brush") {
    return [
      `target=${options.target.join(",")}`,
      `replacement=${options.replacement.join(",")}`,
      `tolerance=${options.tolerance}`,
      `softness=${options.softness}`,
      `preserveLuminance=${options.preserveLuminance}`,
    ].join(";");
  }
  return `snapshotId=${options.snapshotId}`;
}

function createTransactionReceipt(input: {
  readonly prepared: PreparedRequest;
  readonly output: Uint8ClampedArray;
  readonly maskedPixelCount: number;
  readonly changedPixelCount: number;
  readonly changedBounds: StudioEditingBrushChangedBounds | null;
}): StudioEditingBrushTransactionReceipt {
  const { prepared, output, maskedPixelCount, changedPixelCount, changedBounds } = input;
  const sourceFingerprint = fingerprint(prepared.source.data);
  const brushMaskFingerprint = fingerprint(prepared.brushMask.data);
  const selectionMaskFingerprint = prepared.selectionMask
    ? fingerprint(prepared.selectionMask.data)
    : null;
  const snapshotFingerprint = prepared.snapshot
    ? fingerprint(prepared.snapshot.image.data)
    : null;
  const identity = [
    prepared.kernel,
    `${prepared.source.width}x${prepared.source.height}`,
    `pressure=${prepared.pressure}`,
    `flow=${prepared.flow}`,
    `source=${sourceFingerprint}`,
    `mask=${brushMaskFingerprint}`,
    `selection=${selectionMaskFingerprint ?? "none"}`,
    `snapshot=${snapshotFingerprint ?? "none"}`,
    optionsKey(prepared.normalizedOptions),
  ].join("|");
  return {
    schema: "toonspectrum.editing-brush-operation/v1",
    operationId: `editing-v1-${fnv1aText(identity).toString(16).padStart(8, "0")}`,
    kernel: prepared.kernel,
    width: prepared.source.width,
    height: prepared.source.height,
    pressure: prepared.pressure,
    flow: prepared.flow,
    sourceFingerprint,
    brushMaskFingerprint,
    selectionMaskFingerprint,
    snapshotFingerprint,
    outputFingerprint: fingerprint(output),
    options: prepared.normalizedOptions,
    maskedPixelCount,
    changedPixelCount,
    changedBounds,
  };
}

/**
 * Execute one bounded editing-brush operation. Callers should persist the returned transaction
 * receipt next to their future raster-tile/CRDT operation, not the mutable request object.
 */
export function applyStudioEditingBrushKernel(
  request: StudioEditingBrushRequest,
  budget: StudioEditingBrushWorkBudget = DEFAULT_STUDIO_EDITING_BRUSH_WORK_BUDGET,
): StudioEditingBrushResult {
  const prepared = prepareRequest(request, budget);
  if ("status" in prepared) return prepared;

  // This is deliberately the first image-sized allocation in the execution path.
  const output = prepared.source.data.slice();
  let maskedPixelCount = 0;
  let changedPixelCount = 0;
  let minimumX = prepared.source.width;
  let minimumY = prepared.source.height;
  let maximumX = -1;
  let maximumY = -1;

  for (let y = 0; y < prepared.source.height; y += 1) {
    for (let x = 0; x < prepared.source.width; x += 1) {
      const pixelIndex = y * prepared.source.width + x;
      let weight = maskWeight(prepared, pixelIndex);
      if (weight <= 0) continue;
      maskedPixelCount += 1;
      const offset = pixelIndex * 4;
      const sourceRgb: StudioEditingBrushRgb = [
        prepared.source.data[offset]!,
        prepared.source.data[offset + 1]!,
        prepared.source.data[offset + 2]!,
      ];
      let target: StudioEditingBrushRgb;

      if (prepared.normalizedOptions.kernel === "blur-brush") {
        target = alphaWeightedBoxRgb(
          prepared.source,
          x,
          y,
          prepared.normalizedOptions.radius,
        );
      } else if (prepared.normalizedOptions.kernel === "sharpen-brush") {
        const blurred = alphaWeightedBoxRgb(
          prepared.source,
          x,
          y,
          prepared.normalizedOptions.radius,
        );
        target = [
          sourceRgb[0] + (sourceRgb[0] - blurred[0]) * prepared.normalizedOptions.amount,
          sourceRgb[1] + (sourceRgb[1] - blurred[1]) * prepared.normalizedOptions.amount,
          sourceRgb[2] + (sourceRgb[2] - blurred[2]) * prepared.normalizedOptions.amount,
        ];
      } else if (prepared.normalizedOptions.kernel === "color-replacement-brush") {
        weight *= colorMatchWeight(sourceRgb, prepared.normalizedOptions);
        if (weight <= 0) continue;
        target = replacementRgb(sourceRgb, prepared.normalizedOptions);
      } else {
        const snapshot = prepared.snapshot!;
        target = [
          snapshot.image.data[offset]!,
          snapshot.image.data[offset + 1]!,
          snapshot.image.data[offset + 2]!,
        ];
      }

      if (applyPixel(output, offset, target, weight)) {
        changedPixelCount += 1;
        minimumX = Math.min(minimumX, x);
        minimumY = Math.min(minimumY, y);
        maximumX = Math.max(maximumX, x);
        maximumY = Math.max(maximumY, y);
      }
      // Alpha is copied by source.data.slice() and is intentionally never written.
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
  const transaction = createTransactionReceipt({
    prepared,
    output,
    maskedPixelCount,
    changedPixelCount,
    changedBounds,
  });
  return {
    status: "applied",
    kernel: prepared.kernel,
    image: {
      width: prepared.source.width,
      height: prepared.source.height,
      data: output,
    },
    work: prepared.work,
    alphaPreserved: true,
    inputsMutated: false,
    transaction,
  };
}

/** Typed convenience hooks for a future editing-brush tool router. */
export function applyStudioBlurBrush(
  request: Omit<StudioBlurBrushRequest, "kernel">,
  budget?: StudioEditingBrushWorkBudget,
): StudioEditingBrushResult {
  return applyStudioEditingBrushKernel({ ...request, kernel: "blur-brush" }, budget);
}

export function applyStudioSharpenBrush(
  request: Omit<StudioSharpenBrushRequest, "kernel">,
  budget?: StudioEditingBrushWorkBudget,
): StudioEditingBrushResult {
  return applyStudioEditingBrushKernel({ ...request, kernel: "sharpen-brush" }, budget);
}

export function applyStudioColorReplacementBrush(
  request: Omit<StudioColorReplacementBrushRequest, "kernel">,
  budget?: StudioEditingBrushWorkBudget,
): StudioEditingBrushResult {
  return applyStudioEditingBrushKernel(
    { ...request, kernel: "color-replacement-brush" },
    budget,
  );
}

export function applyStudioArtHistoryRestoreBrush(
  request: Omit<StudioArtHistoryRestoreBrushRequest, "kernel">,
  budget?: StudioEditingBrushWorkBudget,
): StudioEditingBrushResult {
  return applyStudioEditingBrushKernel(
    { ...request, kernel: "art-history-restore-brush" },
    budget,
  );
}
