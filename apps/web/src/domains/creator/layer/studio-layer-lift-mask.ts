/**
 * DOM-free mask preparation for independent cut-layer extraction.
 *
 * Model confidence is always admitted as finite Float32 values in [0, 1].
 * Every public operation fails closed, snapshots its inputs, and returns newly
 * allocated buffers. This module deliberately has no OpenCV or canvas dependency.
 */

export const STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION = 8_192;
export const STUDIO_LAYER_LIFT_MASK_MAX_PIXELS = 16_777_216;
export const STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_ITERATIONS = 8;
/**
 * One 8-connected 3x3 pass performs at most nine neighbour reads per output
 * pixel. The budget admits one full-resolution open/close (two passes) while
 * rejecting requests that previously looked cheap only because they counted
 * output pixels instead of the actual kernel work.
 */
export const STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_NEIGHBOR_VISITS =
  STUDIO_LAYER_LIFT_MASK_MAX_PIXELS * 9 * 2;

export type StudioLayerLiftConnectivity = 4 | 8;
export type StudioLayerLiftMorphologyOperation =
  | "dilate"
  | "erode"
  | "close"
  | "open";

export interface StudioLayerLiftConfidenceMask {
  readonly width: number;
  readonly height: number;
  readonly confidence: Float32Array;
}

export interface StudioLayerLiftMorphologyWork {
  readonly passCount: number;
  readonly maximumNeighborsPerPixel: 5 | 9;
  readonly maximumNeighborVisits: number;
}

export interface StudioLayerLiftAlphaMask {
  readonly width: number;
  readonly height: number;
  readonly alpha: Float32Array;
}

export interface StudioLayerLiftBinaryMask {
  readonly width: number;
  readonly height: number;
  /** Canonical binary values: 0 or 1. */
  readonly pixels: Uint8Array;
}

export interface StudioLayerLiftSourceAlpha {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8Array | Uint8ClampedArray;
}

export interface StudioLayerLiftForegroundAlpha {
  readonly width: number;
  readonly height: number;
  readonly alpha: Uint8ClampedArray;
}

export interface StudioLayerLiftMaskBounds {
  readonly left: number;
  readonly top: number;
  /** Exclusive. */
  readonly right: number;
  /** Exclusive. */
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioLayerLiftMaskStatistics {
  readonly pixelCount: number;
  readonly nonZeroPixelCount: number;
  readonly opaquePixelCount: number;
  readonly minimumAlpha: number;
  readonly maximumAlpha: number;
  readonly sumAlpha: number;
  readonly meanAlpha: number;
  readonly coverage: number;
  readonly bounds: StudioLayerLiftMaskBounds | null;
}

export interface StudioLayerLiftIslandStatistics {
  readonly componentCount: number;
  readonly keptComponentCount: number;
  readonly removedComponentCount: number;
  readonly removedPixelCount: number;
  readonly largestComponentPixels: number;
}

export type StudioLayerLiftMaskFailureCode =
  | "invalid-mask"
  | "invalid-dimensions"
  | "dimension-budget-exceeded"
  | "pixel-budget-exceeded"
  | "buffer-length-mismatch"
  | "invalid-confidence-buffer"
  | "invalid-alpha-mask-buffer"
  | "invalid-source-alpha-buffer"
  | "invalid-binary-mask-buffer"
  | "invalid-confidence-value"
  | "invalid-mask-value"
  | "dimension-mismatch"
  | "invalid-options"
  | "work-budget-exceeded"
  | "allocation-failed"
  | "empty-foreground";

export interface StudioLayerLiftMaskFailure {
  readonly ok: false;
  readonly code: StudioLayerLiftMaskFailureCode;
  readonly message: string;
  readonly sampleIndex?: number;
}

export type StudioLayerLiftMaskResult<T> =
  | Readonly<{ readonly ok: true; readonly value: T }>
  | StudioLayerLiftMaskFailure;

const FAILURE_MESSAGES: Readonly<Record<StudioLayerLiftMaskFailureCode, string>> =
  Object.freeze({
    "invalid-mask": "Layer-lift mask input is not a supported raster.",
    "invalid-dimensions": "Layer-lift mask dimensions must be positive safe integers.",
    "dimension-budget-exceeded": "Layer-lift mask dimensions exceed the per-axis budget.",
    "pixel-budget-exceeded": "Layer-lift mask area exceeds the pixel budget.",
    "buffer-length-mismatch": "Layer-lift mask buffer length does not match its dimensions.",
    "invalid-confidence-buffer": "Layer-lift confidence must be a Float32Array.",
    "invalid-alpha-mask-buffer": "Layer-lift alpha mask must be a Float32Array.",
    "invalid-source-alpha-buffer": "Layer-lift source alpha must be an unsigned byte array.",
    "invalid-binary-mask-buffer": "Layer-lift binary mask must be a Uint8Array.",
    "invalid-confidence-value": "Layer-lift confidence contains a non-finite or out-of-range value.",
    "invalid-mask-value": "Layer-lift mask contains a non-finite, out-of-range, or non-binary value.",
    "dimension-mismatch": "Layer-lift rasters do not share the same dimensions.",
    "invalid-options": "Layer-lift mask options are invalid.",
    "work-budget-exceeded": "Layer-lift mask work exceeds the deterministic operation budget.",
    "allocation-failed": "Layer-lift mask working memory could not be allocated.",
    "empty-foreground": "Layer-lift preparation produced no visible foreground pixels.",
  });

interface ValidatedDimensions {
  readonly width: number;
  readonly height: number;
  readonly area: number;
}

function failure(
  code: StudioLayerLiftMaskFailureCode,
  sampleIndex?: number,
): StudioLayerLiftMaskFailure {
  return Object.freeze(sampleIndex === undefined
    ? { ok: false as const, code, message: FAILURE_MESSAGES[code] }
    : { ok: false as const, code, message: FAILURE_MESSAGES[code], sampleIndex });
}

function success<T>(value: T): StudioLayerLiftMaskResult<T> {
  return Object.freeze({ ok: true as const, value });
}

function readDimensions(
  width: unknown,
  height: unknown,
): StudioLayerLiftMaskResult<ValidatedDimensions> {
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    return failure("invalid-dimensions");
  }
  if (
    width > STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION
    || height > STUDIO_LAYER_LIFT_MASK_MAX_DIMENSION
  ) {
    return failure("dimension-budget-exceeded");
  }
  const area = width * height;
  if (area > STUDIO_LAYER_LIFT_MASK_MAX_PIXELS) {
    return failure("pixel-budget-exceeded");
  }
  return success(Object.freeze({ width, height, area }));
}

export function estimateStudioLayerLiftMorphologyWork(input: {
  readonly pixelCount: number;
  readonly operation: StudioLayerLiftMorphologyOperation;
  readonly iterations: number;
  readonly connectivity: StudioLayerLiftConnectivity;
}): StudioLayerLiftMaskResult<StudioLayerLiftMorphologyWork> {
  let pixelCount: unknown;
  let operation: unknown;
  let iterations: unknown;
  let connectivity: unknown;
  try {
    pixelCount = input?.pixelCount;
    operation = input?.operation;
    iterations = input?.iterations;
    connectivity = input?.connectivity;
  } catch {
    return failure("invalid-options");
  }
  if (
    typeof pixelCount !== "number"
    || !Number.isSafeInteger(pixelCount)
    || pixelCount < 1
    || pixelCount > STUDIO_LAYER_LIFT_MASK_MAX_PIXELS
    || (
      operation !== "dilate"
      && operation !== "erode"
      && operation !== "close"
      && operation !== "open"
    )
    || typeof iterations !== "number"
    || !Number.isSafeInteger(iterations)
    || iterations < 0
    || iterations > STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_ITERATIONS
    || (connectivity !== 4 && connectivity !== 8)
  ) {
    return failure("invalid-options");
  }
  const passCount = iterations
    * (operation === "close" || operation === "open" ? 2 : 1);
  const maximumNeighborsPerPixel = connectivity === 4 ? 5 : 9;
  const maximumNeighborVisits =
    pixelCount * passCount * maximumNeighborsPerPixel;
  if (
    !Number.isSafeInteger(maximumNeighborVisits)
    || maximumNeighborVisits
      > STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_NEIGHBOR_VISITS
  ) {
    return failure("work-budget-exceeded");
  }
  return success(Object.freeze({
    passCount,
    maximumNeighborsPerPixel,
    maximumNeighborVisits,
  }));
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object";
}

function copyFloatMask(
  input: unknown,
  key: "confidence" | "alpha",
): StudioLayerLiftMaskResult<{
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}> {
  try {
    if (!isRecord(input)) return failure("invalid-mask");
    const dimensions = readDimensions(input.width, input.height);
    if (!dimensions.ok) return dimensions;
    const candidate = input[key];
    if (!(candidate instanceof Float32Array)) {
      return failure(key === "confidence"
        ? "invalid-confidence-buffer"
        : "invalid-alpha-mask-buffer");
    }
    if (candidate.length !== dimensions.value.area) {
      return failure("buffer-length-mismatch");
    }
    const values = new Float32Array(candidate);
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index]!;
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        return failure(
          key === "confidence" ? "invalid-confidence-value" : "invalid-mask-value",
          index,
        );
      }
    }
    return success(Object.freeze({
      width: dimensions.value.width,
      height: dimensions.value.height,
      values,
    }));
  } catch {
    return failure("allocation-failed");
  }
}

function copyBinaryMask(
  input: unknown,
): StudioLayerLiftMaskResult<StudioLayerLiftBinaryMask> {
  try {
    if (!isRecord(input)) return failure("invalid-mask");
    const dimensions = readDimensions(input.width, input.height);
    if (!dimensions.ok) return dimensions;
    if (!(input.pixels instanceof Uint8Array)) {
      return failure("invalid-binary-mask-buffer");
    }
    if (input.pixels.length !== dimensions.value.area) {
      return failure("buffer-length-mismatch");
    }
    const pixels = new Uint8Array(input.pixels);
    for (let index = 0; index < pixels.length; index += 1) {
      if (pixels[index] !== 0 && pixels[index] !== 1) {
        return failure("invalid-mask-value", index);
      }
    }
    return success(Object.freeze({
      width: dimensions.value.width,
      height: dimensions.value.height,
      pixels,
    }));
  } catch {
    return failure("allocation-failed");
  }
}

function copySourceAlpha(
  input: unknown,
): StudioLayerLiftMaskResult<StudioLayerLiftForegroundAlpha> {
  try {
    if (!isRecord(input)) return failure("invalid-mask");
    const dimensions = readDimensions(input.width, input.height);
    if (!dimensions.ok) return dimensions;
    const alpha = input.alpha;
    if (!(alpha instanceof Uint8Array) && !(alpha instanceof Uint8ClampedArray)) {
      return failure("invalid-source-alpha-buffer");
    }
    if (alpha.length !== dimensions.value.area) {
      return failure("buffer-length-mismatch");
    }
    return success(Object.freeze({
      width: dimensions.value.width,
      height: dimensions.value.height,
      alpha: new Uint8ClampedArray(alpha),
    }));
  } catch {
    return failure("allocation-failed");
  }
}

/** Validate and defensively snapshot a model confidence raster. */
export function validateStudioLayerLiftConfidenceMask(
  input: unknown,
): StudioLayerLiftMaskResult<StudioLayerLiftConfidenceMask> {
  const copied = copyFloatMask(input, "confidence");
  if (!copied.ok) return copied;
  return success(Object.freeze({
    width: copied.value.width,
    height: copied.value.height,
    confidence: copied.value.values,
  }));
}

/** Validate and defensively snapshot a normalized alpha raster. */
export function validateStudioLayerLiftAlphaMask(
  input: unknown,
): StudioLayerLiftMaskResult<StudioLayerLiftAlphaMask> {
  const copied = copyFloatMask(input, "alpha");
  if (!copied.ok) return copied;
  return success(Object.freeze({
    width: copied.value.width,
    height: copied.value.height,
    alpha: copied.value.values,
  }));
}

/** Pixel-centre aligned bilinear resampling with edge clamping. */
function resampleValidatedConfidenceMask(
  source: StudioLayerLiftConfidenceMask,
  targetWidth: number,
  targetHeight: number,
): StudioLayerLiftMaskResult<StudioLayerLiftConfidenceMask> {
  const target = readDimensions(targetWidth, targetHeight);
  if (!target.ok) return target;
  if (source.width === targetWidth && source.height === targetHeight) {
    return success(Object.freeze({
      width: targetWidth,
      height: targetHeight,
      confidence: source.confidence,
    }));
  }
  try {
    const output = new Float32Array(target.value.area);
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    for (let y = 0; y < targetHeight; y += 1) {
      const sourceY = (y + 0.5) * sourceHeight / targetHeight - 0.5;
      const y0Unclamped = Math.floor(sourceY);
      const y0 = Math.max(0, Math.min(sourceHeight - 1, y0Unclamped));
      const y1 = Math.max(0, Math.min(sourceHeight - 1, y0Unclamped + 1));
      const ty = sourceY - y0Unclamped;
      for (let x = 0; x < targetWidth; x += 1) {
        const sourceX = (x + 0.5) * sourceWidth / targetWidth - 0.5;
        const x0Unclamped = Math.floor(sourceX);
        const x0 = Math.max(0, Math.min(sourceWidth - 1, x0Unclamped));
        const x1 = Math.max(0, Math.min(sourceWidth - 1, x0Unclamped + 1));
        const tx = sourceX - x0Unclamped;
        const top =
          source.confidence[y0 * sourceWidth + x0]! * (1 - tx)
          + source.confidence[y0 * sourceWidth + x1]! * tx;
        const bottom =
          source.confidence[y1 * sourceWidth + x0]! * (1 - tx)
          + source.confidence[y1 * sourceWidth + x1]! * tx;
        output[y * targetWidth + x] = top * (1 - ty) + bottom * ty;
      }
    }
    return success(Object.freeze({
      width: targetWidth,
      height: targetHeight,
      confidence: output,
    }));
  } catch {
    return failure("allocation-failed");
  }
}

/** Pixel-centre aligned bilinear resampling with edge clamping. */
export function resampleStudioLayerLiftConfidenceMask(
  input: unknown,
  targetWidth: number,
  targetHeight: number,
): StudioLayerLiftMaskResult<StudioLayerLiftConfidenceMask> {
  const source = validateStudioLayerLiftConfidenceMask(input);
  if (!source.ok) return source;
  return resampleValidatedConfidenceMask(
    source.value,
    targetWidth,
    targetHeight,
  );
}

export interface StudioLayerLiftThresholdOptions {
  /** Confidence midpoint, default 0.5. */
  readonly threshold?: number;
  /** Total confidence-space transition width, default 0. */
  readonly feather?: number;
}

function readThresholdOptions(
  options: StudioLayerLiftThresholdOptions | undefined,
): StudioLayerLiftMaskResult<Required<StudioLayerLiftThresholdOptions>> {
  let threshold: unknown;
  let feather: unknown;
  try {
    threshold = options?.threshold ?? 0.5;
    feather = options?.feather ?? 0;
  } catch {
    return failure("invalid-options");
  }
  if (
    typeof threshold !== "number"
    || typeof feather !== "number"
    || !Number.isFinite(threshold)
    || !Number.isFinite(feather)
    || threshold < 0
    || threshold > 1
    || feather < 0
    || feather > 1
    || (feather > 0 && (
      threshold - feather / 2 < 0
      || threshold + feather / 2 > 1
    ))
  ) {
    return failure("invalid-options");
  }
  return success(Object.freeze({ threshold, feather }));
}

/** Hard threshold, or a smoothstep transition centred on the threshold. */
function thresholdValidatedConfidenceMask(
  source: StudioLayerLiftConfidenceMask,
  options: Required<StudioLayerLiftThresholdOptions>,
): StudioLayerLiftMaskResult<StudioLayerLiftAlphaMask> {
  try {
    const alpha = new Float32Array(source.confidence.length);
    const { threshold, feather } = options;
    if (feather === 0) {
      for (let index = 0; index < alpha.length; index += 1) {
        alpha[index] = source.confidence[index]! >= threshold ? 1 : 0;
      }
    } else {
      const lower = threshold - feather / 2;
      for (let index = 0; index < alpha.length; index += 1) {
        const linear = Math.max(0, Math.min(
          1,
          (source.confidence[index]! - lower) / feather,
        ));
        alpha[index] = linear * linear * (3 - 2 * linear);
      }
    }
    return success(Object.freeze({
      width: source.width,
      height: source.height,
      alpha,
    }));
  } catch {
    return failure("allocation-failed");
  }
}

/** Hard threshold, or a smoothstep transition centred on the threshold. */
export function thresholdStudioLayerLiftConfidenceMask(
  input: unknown,
  options?: StudioLayerLiftThresholdOptions,
): StudioLayerLiftMaskResult<StudioLayerLiftAlphaMask> {
  const source = validateStudioLayerLiftConfidenceMask(input);
  if (!source.ok) return source;
  const admitted = readThresholdOptions(options);
  if (!admitted.ok) return admitted;
  return thresholdValidatedConfidenceMask(source.value, admitted.value);
}

export interface StudioLayerLiftMorphologyOptions {
  readonly operation: StudioLayerLiftMorphologyOperation;
  readonly iterations?: number;
  readonly connectivity?: StudioLayerLiftConnectivity;
}

function morphologyPass(
  source: Uint8Array,
  width: number,
  height: number,
  operation: "dilate" | "erode",
  connectivity: StudioLayerLiftConnectivity,
): Uint8Array {
  const output = new Uint8Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = operation === "erode" ? 1 : 0;
      let complete = false;
      for (let dy = -1; dy <= 1 && !complete; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (connectivity === 4 && Math.abs(dx) + Math.abs(dy) > 1) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const neighbor = source[ny * width + nx]!;
          if (operation === "dilate" && neighbor === 1) {
            value = 1;
            complete = true;
            break;
          }
          if (operation === "erode" && neighbor === 0) {
            value = 0;
            complete = true;
            break;
          }
        }
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

/** Binary 3x3 morphology. Border pixels consider in-bounds neighbours only. */
export function applyStudioLayerLiftMaskMorphology(
  input: unknown,
  options: StudioLayerLiftMorphologyOptions,
): StudioLayerLiftMaskResult<StudioLayerLiftBinaryMask> {
  const source = copyBinaryMask(input);
  if (!source.ok) return source;
  let operation: StudioLayerLiftMorphologyOperation | undefined;
  let iterations: number;
  let connectivity: StudioLayerLiftConnectivity;
  try {
    operation = options?.operation;
    iterations = options?.iterations ?? 1;
    connectivity = options?.connectivity ?? 8;
  } catch {
    return failure("invalid-options");
  }
  if (
    !["dilate", "erode", "close", "open"].includes(operation)
    || !Number.isSafeInteger(iterations)
    || iterations < 0
    || iterations > STUDIO_LAYER_LIFT_MASK_MAX_MORPHOLOGY_ITERATIONS
    || (connectivity !== 4 && connectivity !== 8)
  ) {
    return failure("invalid-options");
  }
  const work = estimateStudioLayerLiftMorphologyWork({
    pixelCount: source.value.pixels.length,
    operation,
    iterations,
    connectivity,
  });
  if (!work.ok) return work;
  try {
    // `copyBinaryMask` already owns a snapshot independent from the caller.
    // Reusing it avoids another full-frame allocation before the first pass.
    let pixels: Uint8Array = source.value.pixels;
    const first = operation === "open" || operation === "erode" ? "erode" : "dilate";
    const second = operation === "open" ? "dilate" : "erode";
    for (let index = 0; index < iterations; index += 1) {
      pixels = morphologyPass(
        pixels,
        source.value.width,
        source.value.height,
        first,
        connectivity,
      );
    }
    if (operation === "close" || operation === "open") {
      for (let index = 0; index < iterations; index += 1) {
        pixels = morphologyPass(
          pixels,
          source.value.width,
          source.value.height,
          second,
          connectivity,
        );
      }
    }
    return success(Object.freeze({
      width: source.value.width,
      height: source.value.height,
      pixels,
    }));
  } catch {
    return failure("allocation-failed");
  }
}

export interface StudioLayerLiftIslandRemovalOptions {
  readonly minimumPixels: number;
  readonly connectivity?: StudioLayerLiftConnectivity;
}

export interface StudioLayerLiftIslandRemoval {
  readonly mask: StudioLayerLiftBinaryMask;
  readonly statistics: StudioLayerLiftIslandStatistics;
}

/** Remove foreground connected components smaller than `minimumPixels`. */
export function removeStudioLayerLiftSmallIslands(
  input: unknown,
  options: StudioLayerLiftIslandRemovalOptions,
): StudioLayerLiftMaskResult<StudioLayerLiftIslandRemoval> {
  const source = copyBinaryMask(input);
  if (!source.ok) return source;
  let minimumPixels: number | undefined;
  let connectivity: StudioLayerLiftConnectivity;
  try {
    minimumPixels = options?.minimumPixels;
    connectivity = options?.connectivity ?? 8;
  } catch {
    return failure("invalid-options");
  }
  if (
    !Number.isSafeInteger(minimumPixels)
    || minimumPixels < 1
    || minimumPixels > STUDIO_LAYER_LIFT_MASK_MAX_PIXELS
    || (connectivity !== 4 && connectivity !== 8)
  ) {
    return failure("invalid-options");
  }
  try {
    // `copyBinaryMask` is the defensive-copy boundary. Cleanup can mutate its
    // private snapshot without retaining or altering the caller's buffer.
    const pixels = source.value.pixels;
    const visited = new Uint8Array(pixels.length);
    const queue = new Int32Array(pixels.length);
    let componentCount = 0;
    let keptComponentCount = 0;
    let removedComponentCount = 0;
    let removedPixelCount = 0;
    let largestComponentPixels = 0;
    const width = source.value.width;
    const height = source.value.height;
    for (let start = 0; start < pixels.length; start += 1) {
      if (visited[start] === 1) continue;
      visited[start] = 1;
      if (pixels[start] === 0) continue;
      componentCount += 1;
      let head = 0;
      let tail = 1;
      queue[0] = start;
      while (head < tail) {
        const current = queue[head++]!;
        const x = current % width;
        const y = Math.floor(current / width);
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            if (
              (dx === 0 && dy === 0)
              || (connectivity === 4 && Math.abs(dx) + Math.abs(dy) !== 1)
            ) {
              continue;
            }
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const neighbor = ny * width + nx;
            if (visited[neighbor] === 1 || pixels[neighbor] === 0) continue;
            visited[neighbor] = 1;
            queue[tail++] = neighbor;
          }
        }
      }
      largestComponentPixels = Math.max(largestComponentPixels, tail);
      if (tail < minimumPixels) {
        removedComponentCount += 1;
        removedPixelCount += tail;
        for (let index = 0; index < tail; index += 1) {
          pixels[queue[index]!] = 0;
        }
      } else {
        keptComponentCount += 1;
      }
    }
    return success(Object.freeze({
      mask: Object.freeze({
        width,
        height,
        pixels,
      }),
      statistics: Object.freeze({
        componentCount,
        keptComponentCount,
        removedComponentCount,
        removedPixelCount,
        largestComponentPixels,
      }),
    }));
  } catch {
    return failure("allocation-failed");
  }
}

function maskStatistics(
  width: number,
  height: number,
  values: ArrayLike<number>,
  divisor: number,
  activeThreshold: number,
): StudioLayerLiftMaskStatistics {
  let minimumAlpha = 1;
  let maximumAlpha = 0;
  let sumAlpha = 0;
  let nonZeroPixelCount = 0;
  let opaquePixelCount = 0;
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;
  for (let index = 0; index < values.length; index += 1) {
    const alpha = values[index]! / divisor;
    minimumAlpha = Math.min(minimumAlpha, alpha);
    maximumAlpha = Math.max(maximumAlpha, alpha);
    sumAlpha += alpha;
    if (alpha === 1) opaquePixelCount += 1;
    if (alpha <= activeThreshold) continue;
    nonZeroPixelCount += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + 1);
    bottom = Math.max(bottom, y + 1);
  }
  const bounds = nonZeroPixelCount === 0
    ? null
    : Object.freeze({
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    });
  return Object.freeze({
    pixelCount: values.length,
    nonZeroPixelCount,
    opaquePixelCount,
    minimumAlpha,
    maximumAlpha,
    sumAlpha,
    meanAlpha: sumAlpha / values.length,
    coverage: nonZeroPixelCount / values.length,
    bounds,
  });
}

/** Compute normalized alpha statistics and a non-zero, right/bottom-exclusive bound. */
export function analyzeStudioLayerLiftMask(
  input: unknown,
  activeThreshold = 0,
): StudioLayerLiftMaskResult<StudioLayerLiftMaskStatistics> {
  if (!Number.isFinite(activeThreshold) || activeThreshold < 0 || activeThreshold > 1) {
    return failure("invalid-options");
  }
  const source = validateStudioLayerLiftAlphaMask(input);
  if (!source.ok) return source;
  return success(maskStatistics(
    source.value.width,
    source.value.height,
    source.value.alpha,
    1,
    activeThreshold,
  ));
}

function composeValidatedForegroundAlpha(
  source: StudioLayerLiftForegroundAlpha,
  mask: StudioLayerLiftAlphaMask,
): StudioLayerLiftMaskResult<StudioLayerLiftForegroundAlpha> {
  if (
    source.width !== mask.width
    || source.height !== mask.height
  ) {
    return failure("dimension-mismatch");
  }
  try {
    const alpha = new Uint8ClampedArray(source.alpha.length);
    for (let index = 0; index < alpha.length; index += 1) {
      alpha[index] = Math.round(
        source.alpha[index]! * mask.alpha[index]!,
      );
    }
    return success(Object.freeze({
      width: source.width,
      height: source.height,
      alpha,
    }));
  } catch {
    return failure("allocation-failed");
  }
}

/** Multiply the normalized lift matte by source alpha; never replaces partial source alpha. */
export function composeStudioLayerLiftForegroundAlpha(
  sourceAlphaInput: unknown,
  maskInput: unknown,
): StudioLayerLiftMaskResult<StudioLayerLiftForegroundAlpha> {
  const source = copySourceAlpha(sourceAlphaInput);
  if (!source.ok) return source;
  const mask = validateStudioLayerLiftAlphaMask(maskInput);
  if (!mask.ok) return mask;
  return composeValidatedForegroundAlpha(source.value, mask.value);
}

export interface StudioLayerLiftPreparationOptions
  extends StudioLayerLiftThresholdOptions {
  readonly morphology?: StudioLayerLiftMorphologyOptions;
  readonly islands?: StudioLayerLiftIslandRemovalOptions;
}

export interface StudioLayerLiftPreparedMask {
  readonly confidence: StudioLayerLiftConfidenceMask;
  readonly matte: StudioLayerLiftAlphaMask;
  readonly binary: StudioLayerLiftBinaryMask;
  readonly foregroundAlpha: StudioLayerLiftForegroundAlpha;
  readonly maskStatistics: StudioLayerLiftMaskStatistics;
  readonly foregroundStatistics: StudioLayerLiftMaskStatistics;
  readonly islandStatistics: StudioLayerLiftIslandStatistics | null;
}

export type StudioLayerLiftPreparationResult =
  | Readonly<{
      readonly ok: true;
      readonly empty: false;
      readonly value: StudioLayerLiftPreparedMask;
    }>
  | Readonly<{
      readonly ok: false;
      readonly empty: true;
      readonly code: "empty-foreground";
      readonly message: string;
      readonly maskStatistics: StudioLayerLiftMaskStatistics;
      readonly foregroundStatistics: StudioLayerLiftMaskStatistics;
    }>
  | (StudioLayerLiftMaskFailure & Readonly<{ readonly empty: false }>);

function preparationFailure(
  result: StudioLayerLiftMaskFailure,
): StudioLayerLiftPreparationResult {
  return Object.freeze({ ...result, empty: false as const });
}

/**
 * End-to-end preparation. Confidence is resampled to source-alpha dimensions,
 * thresholded, optionally cleaned, and multiplied by source alpha.
 */
export function prepareStudioLayerLiftMask(input: {
  readonly confidence: StudioLayerLiftConfidenceMask;
  readonly sourceAlpha: StudioLayerLiftSourceAlpha;
  readonly options?: StudioLayerLiftPreparationOptions;
}): StudioLayerLiftPreparationResult {
  if (!isRecord(input)) return preparationFailure(failure("invalid-mask"));
  let sourceAlpha: unknown;
  let confidenceInput: unknown;
  let options: StudioLayerLiftPreparationOptions | undefined;
  try {
    sourceAlpha = input.sourceAlpha;
    confidenceInput = input.confidence;
    options = input.options;
  } catch {
    return preparationFailure(failure("invalid-mask"));
  }
  const source = copySourceAlpha(sourceAlpha);
  if (!source.ok) return preparationFailure(source);
  const thresholdOptions = readThresholdOptions(options);
  if (!thresholdOptions.ok) return preparationFailure(thresholdOptions);
  const admittedConfidence =
    validateStudioLayerLiftConfidenceMask(confidenceInput);
  if (!admittedConfidence.ok) {
    return preparationFailure(admittedConfidence);
  }
  const confidence = resampleValidatedConfidenceMask(
    admittedConfidence.value,
    source.value.width,
    source.value.height,
  );
  if (!confidence.ok) return preparationFailure(confidence);
  const soft = thresholdValidatedConfidenceMask(
    confidence.value,
    thresholdOptions.value,
  );
  if (!soft.ok) return preparationFailure(soft);

  const hardPixels = new Uint8Array(soft.value.alpha.length);
  for (let index = 0; index < hardPixels.length; index += 1) {
    hardPixels[index] =
      confidence.value.confidence[index]! >= thresholdOptions.value.threshold ? 1 : 0;
  }
  const originalHard = new Uint8Array(hardPixels);
  let binary: StudioLayerLiftBinaryMask = Object.freeze({
    width: source.value.width,
    height: source.value.height,
    pixels: hardPixels,
  });
  let morphology: StudioLayerLiftMorphologyOptions | undefined;
  let islands: StudioLayerLiftIslandRemovalOptions | undefined;
  try {
    morphology = options?.morphology;
    islands = options?.islands;
  } catch {
    return preparationFailure(failure("invalid-options"));
  }
  if (morphology) {
    const cleaned = applyStudioLayerLiftMaskMorphology(
      binary,
      morphology,
    );
    if (!cleaned.ok) return preparationFailure(cleaned);
    binary = cleaned.value;
  }

  let islandStatistics: StudioLayerLiftIslandStatistics | null = null;
  if (islands) {
    const removed = removeStudioLayerLiftSmallIslands(
      binary,
      islands,
    );
    if (!removed.ok) return preparationFailure(removed);
    binary = removed.value.mask;
    islandStatistics = removed.value.statistics;
  }

  const finalAlpha = new Float32Array(soft.value.alpha);
  for (let index = 0; index < finalAlpha.length; index += 1) {
    if (binary.pixels[index] === originalHard[index]) continue;
    finalAlpha[index] = binary.pixels[index]!;
  }
  const matte = Object.freeze({
    width: source.value.width,
    height: source.value.height,
    alpha: finalAlpha,
  });
  const composed = composeValidatedForegroundAlpha(source.value, matte);
  if (!composed.ok) return preparationFailure(composed);
  const maskStats = maskStatistics(
    matte.width,
    matte.height,
    matte.alpha,
    1,
    0,
  );
  const foregroundStats = maskStatistics(
    composed.value.width,
    composed.value.height,
    composed.value.alpha,
    255,
    0,
  );
  if (foregroundStats.nonZeroPixelCount === 0) {
    return Object.freeze({
      ok: false,
      empty: true,
      code: "empty-foreground",
      message: FAILURE_MESSAGES["empty-foreground"],
      maskStatistics: maskStats,
      foregroundStatistics: foregroundStats,
    });
  }
  return Object.freeze({
    ok: true,
    empty: false,
    value: Object.freeze({
      confidence: confidence.value,
      matte,
      binary,
      foregroundAlpha: composed.value,
      maskStatistics: maskStats,
      foregroundStatistics: foregroundStats,
      islandStatistics,
    }),
  });
}
