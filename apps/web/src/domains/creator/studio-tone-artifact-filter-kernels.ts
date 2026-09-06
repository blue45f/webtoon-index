/**
 * Deterministic CPU kernels for comic-tone and compression cleanup.
 *
 * This module deliberately has no DOM, Canvas, Worker, or third-party dependency. Callers can
 * execute the same contract on the main thread, in an OffscreenCanvas Worker, or as a CPU oracle
 * for a future GPU implementation. Every operation:
 *  - validates the complete RGBA extent before allocating,
 *  - refuses work that exceeds explicit pixel/sample/memory budgets,
 *  - leaves the source buffer untouched,
 *  - and preserves the exact source alpha bytes for destructive filters.
 */

export interface StudioToneArtifactRgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export type StudioToneArtifactKernelId =
  | "screentone-removal"
  | "moire-risk-analysis"
  | "jpeg-artifact-reduction"
  | "edge-aware-denoise";

export interface StudioToneArtifactWorkBudget {
  readonly maxPixels: number;
  readonly maxNeighborhoodSamples: number;
  readonly maxWorkingBytes: number;
}

export interface StudioToneArtifactWorkReceipt {
  readonly pixels: number;
  readonly neighborhoodSamples: number;
  readonly workingBytes: number;
  readonly budget: StudioToneArtifactWorkBudget;
}

export type StudioToneArtifactRefusalReason =
  | "invalid-image"
  | "invalid-budget"
  | "budget-exceeded";

export interface StudioToneArtifactRefusal {
  readonly status: "refused";
  readonly kernel: StudioToneArtifactKernelId;
  readonly reason: StudioToneArtifactRefusalReason;
  readonly detail: string;
  readonly work?: StudioToneArtifactWorkReceipt;
}

export interface StudioToneArtifactAppliedReceipt {
  readonly status: "applied";
  readonly kernel: Exclude<StudioToneArtifactKernelId, "moire-risk-analysis">;
  readonly image: StudioToneArtifactRgbaImage;
  readonly work: StudioToneArtifactWorkReceipt;
  readonly alphaPreserved: true;
  readonly changedPixelCount: number;
}

export type StudioMoireRiskLevel = "low" | "medium" | "high";
export type StudioMoireOrientation = "horizontal" | "vertical" | "diagonal-down" | "diagonal-up";

export interface StudioMoireRiskReceipt {
  readonly status: "analyzed";
  readonly kernel: "moire-risk-analysis";
  /** Transparent red/yellow overlay; this does not replace or mutate source artwork. */
  readonly heatmap: StudioToneArtifactRgbaImage;
  readonly work: StudioToneArtifactWorkReceipt;
  readonly riskScore: number;
  readonly hotPixelRatio: number;
  readonly level: StudioMoireRiskLevel;
  readonly dominantOrientation: StudioMoireOrientation | null;
  readonly dominantPeriodPx: 2 | null;
}

export type StudioToneArtifactAppliedResult =
  | StudioToneArtifactAppliedReceipt
  | StudioToneArtifactRefusal;

export type StudioMoireRiskResult =
  | StudioMoireRiskReceipt
  | StudioToneArtifactRefusal;

export interface StudioScreentoneRemovalOptions {
  readonly radius: number;
  readonly strength: number;
  readonly inkLumaThreshold: number;
}

export interface StudioMoireRiskOptions {
  readonly contrastThreshold: number;
  readonly hotPixelThreshold: number;
}

export interface StudioJpegArtifactReductionOptions {
  readonly deblockStrength: number;
  readonly deringStrength: number;
  readonly boundaryThreshold: number;
  readonly protectedEdgeThreshold: number;
  readonly ringingThreshold: number;
  readonly inkLumaThreshold: number;
}

export interface StudioEdgeAwareDenoiseOptions {
  readonly radius: number;
  readonly strength: number;
  readonly rangeThreshold: number;
}

export const DEFAULT_STUDIO_TONE_ARTIFACT_WORK_BUDGET: StudioToneArtifactWorkBudget =
  Object.freeze({
    maxPixels: 16_777_216,
    maxNeighborhoodSamples: 600_000_000,
    maxWorkingBytes: 268_435_456,
  });

export const DEFAULT_STUDIO_SCREENTONE_REMOVAL: StudioScreentoneRemovalOptions =
  Object.freeze({
    radius: 2,
    strength: 0.88,
    inkLumaThreshold: 72,
  });

export const DEFAULT_STUDIO_MOIRE_RISK: StudioMoireRiskOptions =
  Object.freeze({
    contrastThreshold: 14,
    hotPixelThreshold: 0.55,
  });

export const DEFAULT_STUDIO_JPEG_ARTIFACT_REDUCTION: StudioJpegArtifactReductionOptions =
  Object.freeze({
    deblockStrength: 0.72,
    deringStrength: 0.45,
    boundaryThreshold: 6,
    protectedEdgeThreshold: 88,
    ringingThreshold: 18,
    inkLumaThreshold: 64,
  });

export const DEFAULT_STUDIO_EDGE_AWARE_DENOISE: StudioEdgeAwareDenoiseOptions =
  Object.freeze({
    radius: 1,
    strength: 0.78,
    rangeThreshold: 72,
  });

type ValidImage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly pixels: number;
  readonly bytes: number;
};

type PreparedWork = {
  readonly image: ValidImage;
  readonly work: StudioToneArtifactWorkReceipt;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clamp(finite(value, fallback), min, max));
}

function boundedProduct(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  if (left > Number.MAX_SAFE_INTEGER / right) return Number.MAX_SAFE_INTEGER;
  return left * right;
}

function inspectImage(image: StudioToneArtifactRgbaImage): ValidImage | null {
  if (
    image === null
    || typeof image !== "object"
    || !Number.isSafeInteger(image.width)
    || !Number.isSafeInteger(image.height)
    || image.width <= 0
    || image.height <= 0
    || !(image.data instanceof Uint8ClampedArray)
  ) {
    return null;
  }
  const pixels = boundedProduct(image.width, image.height);
  const bytes = boundedProduct(pixels, 4);
  if (
    pixels === Number.MAX_SAFE_INTEGER
    || bytes === Number.MAX_SAFE_INTEGER
    || image.data.length !== bytes
  ) {
    return null;
  }
  return {
    width: image.width,
    height: image.height,
    data: image.data,
    pixels,
    bytes,
  };
}

function inspectBudget(
  budget: StudioToneArtifactWorkBudget,
): StudioToneArtifactWorkBudget | null {
  if (
    budget === null
    || typeof budget !== "object"
    || !Number.isSafeInteger(budget.maxPixels)
    || !Number.isSafeInteger(budget.maxNeighborhoodSamples)
    || !Number.isSafeInteger(budget.maxWorkingBytes)
    || budget.maxPixels <= 0
    || budget.maxNeighborhoodSamples <= 0
    || budget.maxWorkingBytes <= 0
  ) {
    return null;
  }
  return {
    maxPixels: budget.maxPixels,
    maxNeighborhoodSamples: budget.maxNeighborhoodSamples,
    maxWorkingBytes: budget.maxWorkingBytes,
  };
}

function refusal(
  kernel: StudioToneArtifactKernelId,
  reason: StudioToneArtifactRefusalReason,
  detail: string,
  work?: StudioToneArtifactWorkReceipt,
): StudioToneArtifactRefusal {
  return work
    ? { status: "refused", kernel, reason, detail, work }
    : { status: "refused", kernel, reason, detail };
}

function prepareWork(
  kernel: StudioToneArtifactKernelId,
  source: StudioToneArtifactRgbaImage,
  neighborhoodSamplesPerPixel: number,
  workingBufferCount: number,
  budgetInput: StudioToneArtifactWorkBudget,
): PreparedWork | StudioToneArtifactRefusal {
  const image = inspectImage(source);
  if (!image) {
    return refusal(
      kernel,
      "invalid-image",
      "Expected positive safe dimensions and one exact Uint8ClampedArray RGBA extent.",
    );
  }
  const budget = inspectBudget(budgetInput);
  if (!budget) {
    return refusal(
      kernel,
      "invalid-budget",
      "All work-budget limits must be positive safe integers.",
    );
  }
  const work: StudioToneArtifactWorkReceipt = {
    pixels: image.pixels,
    neighborhoodSamples: boundedProduct(image.pixels, neighborhoodSamplesPerPixel),
    workingBytes: boundedProduct(image.bytes, workingBufferCount),
    budget,
  };
  if (
    work.pixels > budget.maxPixels
    || work.neighborhoodSamples > budget.maxNeighborhoodSamples
    || work.workingBytes > budget.maxWorkingBytes
  ) {
    return refusal(
      kernel,
      "budget-exceeded",
      "The kernel was refused before output or scratch buffers were allocated.",
      work,
    );
  }
  return { image, work };
}

function isRefusal(
  value: PreparedWork | StudioToneArtifactRefusal,
): value is StudioToneArtifactRefusal {
  return "status" in value;
}

function lumaAt(data: Uint8ClampedArray, pixelIndex: number): number {
  const offset = pixelIndex * 4;
  return data[offset]! * 0.299 + data[offset + 1]! * 0.587 + data[offset + 2]! * 0.114;
}

/**
 * Returns straight-alpha colour luminance only for a pixel that contributes visible coverage.
 * RGB bytes below alpha=0 are unspecified payload and must never steer an image-space decision.
 */
function visibleLumaAt(data: Uint8ClampedArray, pixelIndex: number): number | null {
  return data[pixelIndex * 4 + 3] === 0 ? null : lumaAt(data, pixelIndex);
}

function clampedPixelIndex(
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const sampleX = clamp(x, 0, width - 1);
  const sampleY = clamp(y, 0, height - 1);
  return sampleY * width + sampleX;
}

function hasInkContinuity(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  threshold: number,
): boolean {
  const center = visibleLumaAt(data, y * width + x);
  if (center === null || center > threshold) return false;
  const neighborThreshold = Math.min(255, threshold + 24);
  const pairs = [
    [-1, 0, 1, 0],
    [0, -1, 0, 1],
    [-1, -1, 1, 1],
    [-1, 1, 1, -1],
  ] as const;
  return pairs.some(([x1, y1, x2, y2]) => {
    const first = visibleLumaAt(
      data,
      clampedPixelIndex(x + x1, y + y1, width, height),
    );
    const second = visibleLumaAt(
      data,
      clampedPixelIndex(x + x2, y + y2, width, height),
    );
    return first !== null
      && second !== null
      && first <= neighborThreshold
      && second <= neighborThreshold;
  });
}

export function normalizeStudioScreentoneRemovalOptions(
  value?: unknown,
): StudioScreentoneRemovalOptions {
  const source = asRecord(value);
  return {
    radius: clampInteger(
      source.radius,
      1,
      3,
      DEFAULT_STUDIO_SCREENTONE_REMOVAL.radius,
    ),
    strength: clamp(
      finite(source.strength, DEFAULT_STUDIO_SCREENTONE_REMOVAL.strength),
      0,
      1,
    ),
    inkLumaThreshold: clamp(
      finite(
        source.inkLumaThreshold,
        DEFAULT_STUDIO_SCREENTONE_REMOVAL.inkLumaThreshold,
      ),
      0,
      160,
    ),
  };
}

export function normalizeStudioMoireRiskOptions(value?: unknown): StudioMoireRiskOptions {
  const source = asRecord(value);
  return {
    contrastThreshold: clamp(
      finite(source.contrastThreshold, DEFAULT_STUDIO_MOIRE_RISK.contrastThreshold),
      1,
      128,
    ),
    hotPixelThreshold: clamp(
      finite(source.hotPixelThreshold, DEFAULT_STUDIO_MOIRE_RISK.hotPixelThreshold),
      0.1,
      1,
    ),
  };
}

export function normalizeStudioJpegArtifactReductionOptions(
  value?: unknown,
): StudioJpegArtifactReductionOptions {
  const source = asRecord(value);
  return {
    deblockStrength: clamp(
      finite(
        source.deblockStrength,
        DEFAULT_STUDIO_JPEG_ARTIFACT_REDUCTION.deblockStrength,
      ),
      0,
      1,
    ),
    deringStrength: clamp(
      finite(
        source.deringStrength,
        DEFAULT_STUDIO_JPEG_ARTIFACT_REDUCTION.deringStrength,
      ),
      0,
      1,
    ),
    boundaryThreshold: clamp(
      finite(
        source.boundaryThreshold,
        DEFAULT_STUDIO_JPEG_ARTIFACT_REDUCTION.boundaryThreshold,
      ),
      1,
      64,
    ),
    protectedEdgeThreshold: clamp(
      finite(
        source.protectedEdgeThreshold,
        DEFAULT_STUDIO_JPEG_ARTIFACT_REDUCTION.protectedEdgeThreshold,
      ),
      32,
      224,
    ),
    ringingThreshold: clamp(
      finite(
        source.ringingThreshold,
        DEFAULT_STUDIO_JPEG_ARTIFACT_REDUCTION.ringingThreshold,
      ),
      1,
      96,
    ),
    inkLumaThreshold: clamp(
      finite(
        source.inkLumaThreshold,
        DEFAULT_STUDIO_JPEG_ARTIFACT_REDUCTION.inkLumaThreshold,
      ),
      0,
      160,
    ),
  };
}

export function normalizeStudioEdgeAwareDenoiseOptions(
  value?: unknown,
): StudioEdgeAwareDenoiseOptions {
  const source = asRecord(value);
  return {
    radius: clampInteger(
      source.radius,
      1,
      3,
      DEFAULT_STUDIO_EDGE_AWARE_DENOISE.radius,
    ),
    strength: clamp(
      finite(source.strength, DEFAULT_STUDIO_EDGE_AWARE_DENOISE.strength),
      0,
      1,
    ),
    rangeThreshold: clamp(
      finite(
        source.rangeThreshold,
        DEFAULT_STUDIO_EDGE_AWARE_DENOISE.rangeThreshold,
      ),
      4,
      192,
    ),
  };
}

/**
 * Replaces isolated periodic tone dots with a local color estimate while retaining continuous
 * dark strokes. Opposite-neighbor continuity, rather than darkness alone, distinguishes a thin
 * one-pixel ink line from an isolated halftone dot.
 */
export function removeStudioScreentoneArtifacts(
  source: StudioToneArtifactRgbaImage,
  options?: Partial<StudioScreentoneRemovalOptions> | null,
  budget: StudioToneArtifactWorkBudget = DEFAULT_STUDIO_TONE_ARTIFACT_WORK_BUDGET,
): StudioToneArtifactAppliedResult {
  const normalized = normalizeStudioScreentoneRemovalOptions(options);
  const diameter = normalized.radius * 2 + 1;
  const prepared = prepareWork(
    "screentone-removal",
    source,
    diameter * diameter,
    1,
    budget,
  );
  if (isRefusal(prepared)) return prepared;
  const { image, work } = prepared;
  const output = image.data.slice();
  let changedPixelCount = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelIndex = y * image.width + x;
      const offset = pixelIndex * 4;
      const alpha = image.data[offset + 3]!;
      if (
        alpha === 0
        || normalized.strength === 0
        || hasInkContinuity(
          image.data,
          x,
          y,
          image.width,
          image.height,
          normalized.inkLumaThreshold,
        )
      ) {
        continue;
      }

      let red = 0;
      let green = 0;
      let blue = 0;
      let totalWeight = 0;
      for (let deltaY = -normalized.radius; deltaY <= normalized.radius; deltaY += 1) {
        for (let deltaX = -normalized.radius; deltaX <= normalized.radius; deltaX += 1) {
          const sampleIndex = clampedPixelIndex(
            x + deltaX,
            y + deltaY,
            image.width,
            image.height,
          );
          const sampleOffset = sampleIndex * 4;
          const sampleAlpha = image.data[sampleOffset + 3]!;
          // Accumulate visible premultiplied coverage. Transparent pixels can carry arbitrary
          // hidden RGB (for example after erasing) and must contribute exactly zero colour.
          const alphaWeight = (1 - Math.abs(sampleAlpha - alpha) / 255)
            * (sampleAlpha / 255);
          red += image.data[sampleOffset]! * alphaWeight;
          green += image.data[sampleOffset + 1]! * alphaWeight;
          blue += image.data[sampleOffset + 2]! * alphaWeight;
          totalWeight += alphaWeight;
        }
      }
      if (totalWeight <= 0) continue;
      const meanRed = red / totalWeight;
      const meanGreen = green / totalWeight;
      const meanBlue = blue / totalWeight;
      const centerLuma = lumaAt(image.data, pixelIndex);
      const meanLuma = meanRed * 0.299 + meanGreen * 0.587 + meanBlue * 0.114;
      const artifactConfidence = clamp(Math.abs(centerLuma - meanLuma) / 28, 0, 1);
      const blend = normalized.strength * artifactConfidence;
      if (blend === 0) continue;
      output[offset] = image.data[offset]! + (meanRed - image.data[offset]!) * blend;
      output[offset + 1] = image.data[offset + 1]!
        + (meanGreen - image.data[offset + 1]!) * blend;
      output[offset + 2] = image.data[offset + 2]!
        + (meanBlue - image.data[offset + 2]!) * blend;
      if (
        output[offset] !== image.data[offset]
        || output[offset + 1] !== image.data[offset + 1]
        || output[offset + 2] !== image.data[offset + 2]
      ) {
        changedPixelCount += 1;
      }
    }
  }

  return {
    status: "applied",
    kernel: "screentone-removal",
    image: { width: image.width, height: image.height, data: output },
    work,
    alphaPreserved: true,
    changedPixelCount,
  };
}

type MoireDirection = {
  readonly id: StudioMoireOrientation;
  readonly x: number;
  readonly y: number;
};

const MOIRE_DIRECTIONS: readonly MoireDirection[] = [
  { id: "horizontal", x: 1, y: 0 },
  { id: "vertical", x: 0, y: 1 },
  { id: "diagonal-down", x: 1, y: 1 },
  { id: "diagonal-up", x: 1, y: -1 },
];

function moireDirectionScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  direction: MoireDirection,
  contrastThreshold: number,
): number {
  const x2a = x - direction.x * 2;
  const y2a = y - direction.y * 2;
  const x2b = x + direction.x * 2;
  const y2b = y + direction.y * 2;
  if (x2a < 0 || x2a >= width || y2a < 0 || y2a >= height) return 0;
  if (x2b < 0 || x2b >= width || y2b < 0 || y2b >= height) return 0;

  const center = lumaAt(data, y * width + x);
  const previous = lumaAt(data, (y - direction.y) * width + x - direction.x);
  const next = lumaAt(data, (y + direction.y) * width + x + direction.x);
  const previous2 = lumaAt(data, y2a * width + x2a);
  const next2 = lumaAt(data, y2b * width + x2b);
  const leftSlope = center - previous;
  const rightSlope = next - center;
  if (leftSlope * rightSlope >= 0) return 0;
  const alternatingContrast = Math.min(Math.abs(leftSlope), Math.abs(rightSlope));
  if (alternatingContrast <= contrastThreshold) return 0;
  const phaseError = (Math.abs(center - previous2) + Math.abs(center - next2)) * 0.5;
  const phaseAgreement = 1 - clamp(phaseError / Math.max(contrastThreshold * 3, 1), 0, 1);
  const contrast = clamp(
    (alternatingContrast - contrastThreshold) / Math.max(96 - contrastThreshold, 1),
    0,
    1,
  );
  return contrast * phaseAgreement;
}

/**
 * Produces a non-destructive heatmap for two-pixel oscillation. Requiring the second neighbor to
 * return to the center phase suppresses isolated ink edges that otherwise resemble one half-cycle.
 */
export function analyzeStudioMoireRisk(
  source: StudioToneArtifactRgbaImage,
  options?: Partial<StudioMoireRiskOptions> | null,
  budget: StudioToneArtifactWorkBudget = DEFAULT_STUDIO_TONE_ARTIFACT_WORK_BUDGET,
): StudioMoireRiskResult {
  const normalized = normalizeStudioMoireRiskOptions(options);
  const prepared = prepareWork("moire-risk-analysis", source, 16, 1, budget);
  if (isRefusal(prepared)) return prepared;
  const { image, work } = prepared;
  const heatmap = new Uint8ClampedArray(image.bytes);
  const orientationTotals = new Map<StudioMoireOrientation, number>(
    MOIRE_DIRECTIONS.map((direction) => [direction.id, 0]),
  );
  let riskTotal = 0;
  let hotPixels = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelIndex = y * image.width + x;
      const sourceAlpha = image.data[pixelIndex * 4 + 3]!;
      let risk = 0;
      let winningOrientation: StudioMoireOrientation | null = null;
      for (const direction of MOIRE_DIRECTIONS) {
        const directionRisk = moireDirectionScore(
          image.data,
          image.width,
          image.height,
          x,
          y,
          direction,
          normalized.contrastThreshold,
        );
        if (directionRisk > risk) {
          risk = directionRisk;
          winningOrientation = direction.id;
        }
      }
      if (winningOrientation) {
        orientationTotals.set(
          winningOrientation,
          orientationTotals.get(winningOrientation)! + risk,
        );
      }
      riskTotal += risk;
      if (risk >= normalized.hotPixelThreshold) hotPixels += 1;
      const offset = pixelIndex * 4;
      heatmap[offset] = 255;
      heatmap[offset + 1] = 220 * (1 - risk);
      heatmap[offset + 2] = 0;
      heatmap[offset + 3] = 255 * risk * (sourceAlpha / 255);
    }
  }

  const riskScore = riskTotal / image.pixels;
  const hotPixelRatio = hotPixels / image.pixels;
  let dominantOrientation: StudioMoireOrientation | null = null;
  let dominantTotal = 0;
  for (const [orientation, total] of orientationTotals) {
    if (total > dominantTotal) {
      dominantOrientation = orientation;
      dominantTotal = total;
    }
  }
  const level: StudioMoireRiskLevel = riskScore >= 0.32
    ? "high"
    : riskScore >= 0.1
      ? "medium"
      : "low";

  return {
    status: "analyzed",
    kernel: "moire-risk-analysis",
    heatmap: { width: image.width, height: image.height, data: heatmap },
    work,
    riskScore,
    hotPixelRatio,
    level,
    dominantOrientation,
    dominantPeriodPx: riskScore >= 0.05 ? 2 : null,
  };
}

function deblockVerticalBoundary(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  boundaryX: number,
  options: StudioJpegArtifactReductionOptions,
): number {
  let adjusted = 0;
  for (let y = 0; y < height; y += 1) {
    const p1 = y * width + boundaryX - 2;
    const p0 = y * width + boundaryX - 1;
    const q0 = y * width + boundaryX;
    const q1 = y * width + boundaryX + 1;
    const p1Alpha = data[p1 * 4 + 3]!;
    const p0Alpha = data[p0 * 4 + 3]!;
    const q0Alpha = data[q0 * 4 + 3]!;
    const q1Alpha = data[q1 * 4 + 3]!;
    // A transparent boundary is an alpha edge, not JPEG blocking. Skipping it also prevents
    // undefined RGB under alpha=0 from being copied into visible neighbours.
    if (p1Alpha === 0 || p0Alpha === 0 || q0Alpha === 0 || q1Alpha === 0) continue;
    const boundaryJump = Math.abs(lumaAt(data, p0) - lumaAt(data, q0));
    const localGradient = Math.max(
      Math.abs(lumaAt(data, p1) - lumaAt(data, p0)),
      Math.abs(lumaAt(data, q0) - lumaAt(data, q1)),
    );
    if (
      boundaryJump <= options.boundaryThreshold
      || boundaryJump >= options.protectedEdgeThreshold
      || boundaryJump <= localGradient * 1.2 + options.boundaryThreshold
    ) {
      continue;
    }
    const onset = clamp(
      (boundaryJump - options.boundaryThreshold)
      / Math.max(options.boundaryThreshold * 2, 12),
      0,
      1,
    );
    const edgeProtection = clamp(
      (options.protectedEdgeThreshold - boundaryJump)
      / Math.max(options.protectedEdgeThreshold * 0.5, 1),
      0,
      1,
    );
    const correctionScale = options.deblockStrength
      * onset
      * edgeProtection
      * 0.25;
    for (let channel = 0; channel < 3; channel += 1) {
      const p0Offset = p0 * 4 + channel;
      const q0Offset = q0 * 4 + channel;
      const difference = data[q0Offset]! - data[p0Offset]!;
      const correction = difference * correctionScale;
      data[p0Offset] = data[p0Offset]! + correction;
      data[q0Offset] = data[q0Offset]! - correction;
      data[p1 * 4 + channel] = data[p1 * 4 + channel]! + correction * 0.18;
      data[q1 * 4 + channel] = data[q1 * 4 + channel]! - correction * 0.18;
    }
    adjusted += 1;
  }
  return adjusted;
}

function deblockHorizontalBoundary(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  boundaryY: number,
  options: StudioJpegArtifactReductionOptions,
): number {
  let adjusted = 0;
  for (let x = 0; x < width; x += 1) {
    const p1 = (boundaryY - 2) * width + x;
    const p0 = (boundaryY - 1) * width + x;
    const q0 = boundaryY * width + x;
    const q1 = (boundaryY + 1) * width + x;
    const p1Alpha = data[p1 * 4 + 3]!;
    const p0Alpha = data[p0 * 4 + 3]!;
    const q0Alpha = data[q0 * 4 + 3]!;
    const q1Alpha = data[q1 * 4 + 3]!;
    if (p1Alpha === 0 || p0Alpha === 0 || q0Alpha === 0 || q1Alpha === 0) continue;
    const boundaryJump = Math.abs(lumaAt(data, p0) - lumaAt(data, q0));
    const localGradient = Math.max(
      Math.abs(lumaAt(data, p1) - lumaAt(data, p0)),
      Math.abs(lumaAt(data, q0) - lumaAt(data, q1)),
    );
    if (
      boundaryJump <= options.boundaryThreshold
      || boundaryJump >= options.protectedEdgeThreshold
      || boundaryJump <= localGradient * 1.2 + options.boundaryThreshold
    ) {
      continue;
    }
    const onset = clamp(
      (boundaryJump - options.boundaryThreshold)
      / Math.max(options.boundaryThreshold * 2, 12),
      0,
      1,
    );
    const edgeProtection = clamp(
      (options.protectedEdgeThreshold - boundaryJump)
      / Math.max(options.protectedEdgeThreshold * 0.5, 1),
      0,
      1,
    );
    const correctionScale = options.deblockStrength
      * onset
      * edgeProtection
      * 0.25;
    for (let channel = 0; channel < 3; channel += 1) {
      const p0Offset = p0 * 4 + channel;
      const q0Offset = q0 * 4 + channel;
      const difference = data[q0Offset]! - data[p0Offset]!;
      const correction = difference * correctionScale;
      data[p0Offset] = data[p0Offset]! + correction;
      data[q0Offset] = data[q0Offset]! - correction;
      data[p1 * 4 + channel] = data[p1 * 4 + channel]! + correction * 0.18;
      data[q1 * 4 + channel] = data[q1 * 4 + channel]! - correction * 0.18;
    }
    adjusted += 1;
  }
  return adjusted;
}

function medianChannel(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  height: number,
  channel: number,
): number {
  const samples: number[] = [];
  for (let deltaY = -1; deltaY <= 1; deltaY += 1) {
    for (let deltaX = -1; deltaX <= 1; deltaX += 1) {
      const pixelIndex = clampedPixelIndex(x + deltaX, y + deltaY, width, height);
      if (data[pixelIndex * 4 + 3] !== 0) {
        samples.push(data[pixelIndex * 4 + channel]!);
      }
    }
  }
  if (samples.length === 0) return data[(y * width + x) * 4 + channel]!;
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length / 2)]!;
}

/**
 * Runs an adaptive eight-pixel deblock pass, then a guarded median dering pass. A large boundary
 * discontinuity and continuous dark ink are both protected instead of being mistaken for JPEG
 * defects.
 */
export function reduceStudioJpegArtifacts(
  source: StudioToneArtifactRgbaImage,
  options?: Partial<StudioJpegArtifactReductionOptions> | null,
  budget: StudioToneArtifactWorkBudget = DEFAULT_STUDIO_TONE_ARTIFACT_WORK_BUDGET,
): StudioToneArtifactAppliedResult {
  const normalized = normalizeStudioJpegArtifactReductionOptions(options);
  const prepared = prepareWork(
    "jpeg-artifact-reduction",
    source,
    18,
    2,
    budget,
  );
  if (isRefusal(prepared)) return prepared;
  const { image, work } = prepared;
  const deblocked = image.data.slice();
  if (normalized.deblockStrength > 0) {
    for (let x = 8; x + 1 < image.width; x += 8) {
      deblockVerticalBoundary(
        deblocked,
        image.width,
        image.height,
        x,
        normalized,
      );
    }
    for (let y = 8; y + 1 < image.height; y += 8) {
      deblockHorizontalBoundary(
        deblocked,
        image.width,
        image.height,
        y,
        normalized,
      );
    }
  }

  const output = deblocked.slice();
  if (normalized.deringStrength > 0) {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const pixelIndex = y * image.width + x;
        const offset = pixelIndex * 4;
        if (
          image.data[offset + 3] === 0
          || hasInkContinuity(
            deblocked,
            x,
            y,
            image.width,
            image.height,
            normalized.inkLumaThreshold,
          )
        ) {
          continue;
        }
        const medianRed = medianChannel(
          deblocked,
          x,
          y,
          image.width,
          image.height,
          0,
        );
        const medianGreen = medianChannel(
          deblocked,
          x,
          y,
          image.width,
          image.height,
          1,
        );
        const medianBlue = medianChannel(
          deblocked,
          x,
          y,
          image.width,
          image.height,
          2,
        );
        const medianLuma = medianRed * 0.299 + medianGreen * 0.587 + medianBlue * 0.114;
        const deviation = Math.abs(lumaAt(deblocked, pixelIndex) - medianLuma);
        if (deviation <= normalized.ringingThreshold) continue;
        const confidence = clamp(
          (deviation - normalized.ringingThreshold)
          / Math.max(normalized.ringingThreshold * 2, 1),
          0,
          1,
        );
        const blend = normalized.deringStrength * confidence;
        output[offset] = deblocked[offset]! + (medianRed - deblocked[offset]!) * blend;
        output[offset + 1] = deblocked[offset + 1]!
          + (medianGreen - deblocked[offset + 1]!) * blend;
        output[offset + 2] = deblocked[offset + 2]!
          + (medianBlue - deblocked[offset + 2]!) * blend;
      }
    }
  }

  let changedPixelCount = 0;
  for (let pixelIndex = 0; pixelIndex < image.pixels; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    if (
      output[offset] !== image.data[offset]
      || output[offset + 1] !== image.data[offset + 1]
      || output[offset + 2] !== image.data[offset + 2]
    ) {
      changedPixelCount += 1;
    }
  }

  return {
    status: "applied",
    kernel: "jpeg-artifact-reduction",
    image: { width: image.width, height: image.height, data: output },
    work,
    alphaPreserved: true,
    changedPixelCount,
  };
}

/**
 * Edge-aware bilateral-style denoise. Spatial and luminance-range weights remove low-amplitude
 * color noise while preventing ink edges and transparent boundaries from bleeding.
 */
export function denoiseStudioRgba(
  source: StudioToneArtifactRgbaImage,
  options?: Partial<StudioEdgeAwareDenoiseOptions> | null,
  budget: StudioToneArtifactWorkBudget = DEFAULT_STUDIO_TONE_ARTIFACT_WORK_BUDGET,
): StudioToneArtifactAppliedResult {
  const normalized = normalizeStudioEdgeAwareDenoiseOptions(options);
  const diameter = normalized.radius * 2 + 1;
  const prepared = prepareWork(
    "edge-aware-denoise",
    source,
    diameter * diameter,
    1,
    budget,
  );
  if (isRefusal(prepared)) return prepared;
  const { image, work } = prepared;
  const output = image.data.slice();
  let changedPixelCount = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelIndex = y * image.width + x;
      const offset = pixelIndex * 4;
      const alpha = image.data[offset + 3]!;
      if (alpha === 0 || normalized.strength === 0) continue;
      const centerLuma = lumaAt(image.data, pixelIndex);
      let red = 0;
      let green = 0;
      let blue = 0;
      let totalWeight = 0;

      for (let deltaY = -normalized.radius; deltaY <= normalized.radius; deltaY += 1) {
        for (let deltaX = -normalized.radius; deltaX <= normalized.radius; deltaX += 1) {
          const sampleIndex = clampedPixelIndex(
            x + deltaX,
            y + deltaY,
            image.width,
            image.height,
          );
          const sampleOffset = sampleIndex * 4;
          const sampleAlpha = image.data[sampleOffset + 3]!;
          const lumaDistance = Math.abs(lumaAt(image.data, sampleIndex) - centerLuma);
          const range = 1 - clamp(lumaDistance / normalized.rangeThreshold, 0, 1);
          const alphaAffinity = 1 - Math.abs(sampleAlpha - alpha) / 255;
          const spatial = 1 / (1 + deltaX * deltaX + deltaY * deltaY);
          // Alpha affinity protects semitransparent edges; multiplying by visible coverage makes
          // the accumulation premultiplied-alpha safe and removes hidden-RGB influence at alpha=0.
          const weight = spatial
            * range
            * range
            * alphaAffinity
            * alphaAffinity
            * (sampleAlpha / 255);
          red += image.data[sampleOffset]! * weight;
          green += image.data[sampleOffset + 1]! * weight;
          blue += image.data[sampleOffset + 2]! * weight;
          totalWeight += weight;
        }
      }
      if (totalWeight <= 0) continue;
      const filteredRed = red / totalWeight;
      const filteredGreen = green / totalWeight;
      const filteredBlue = blue / totalWeight;
      output[offset] = image.data[offset]!
        + (filteredRed - image.data[offset]!) * normalized.strength;
      output[offset + 1] = image.data[offset + 1]!
        + (filteredGreen - image.data[offset + 1]!) * normalized.strength;
      output[offset + 2] = image.data[offset + 2]!
        + (filteredBlue - image.data[offset + 2]!) * normalized.strength;
      if (
        output[offset] !== image.data[offset]
        || output[offset + 1] !== image.data[offset + 1]
        || output[offset + 2] !== image.data[offset + 2]
      ) {
        changedPixelCount += 1;
      }
    }
  }

  return {
    status: "applied",
    kernel: "edge-aware-denoise",
    image: { width: image.width, height: image.height, data: output },
    work,
    alphaPreserved: true,
    changedPixelCount,
  };
}
