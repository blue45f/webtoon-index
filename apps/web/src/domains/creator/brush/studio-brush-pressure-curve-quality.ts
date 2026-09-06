/**
 * Full-range hardware-pressure quality probe for dynamic brushes.
 *
 * Existing catalogue tests prove that low and high pressure differ. This layer measures the space
 * between them so a preset cannot technically "support pressure" while behaving like a binary
 * switch. The probe runs through the real deterministic dab planner and observes every authored
 * response axis: size, opacity, flow, spacing, scatter, angle and roundness.
 *
 * It is diagnostic/governance-only. No runtime mapping, saved stroke or renderer output changes.
 */

import {
  planNormalizedStudioDynamicBrushDabs,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";

export const STUDIO_BRUSH_PRESSURE_CURVE_QUALITY_VERSION =
  "studio-brush-pressure-curve-quality-v1" as const;

export const STUDIO_BRUSH_PRESSURE_PROBE_LEVELS = Object.freeze([
  0.02,
  0.08,
  0.16,
  0.28,
  0.42,
  0.58,
  0.72,
  0.84,
  0.92,
  0.98,
] as const);

/** A single interval may own at most this share of the complete response path. */
export const STUDIO_BRUSH_PRESSURE_MAX_STEP_SHARE = 0.9;
/** Responsive presets need more than low/middle/high buckets across a continuous stylus range. */
export const STUDIO_BRUSH_PRESSURE_MIN_DISTINCT_STATES = 4;

const PROBE_POINTS = Object.freeze([0, 0, 18, 7, 37, -4, 58, 9, 80, 0] as const);
const PROBE_POINT_COUNT = PROBE_POINTS.length / 2;
const PROBE_SPEED = 0.45;
const PROBE_SEED = 73;
const PROBE_MAX_DABS = 512;
const FINGERPRINT_DIGITS = 8;
const DISTINCT_DIGITS = 7;
const RESPONSE_EPSILON = 1e-9;

export interface StudioBrushPressureCurveSample {
  readonly pressure: number;
  readonly dabCount: number;
  readonly meanSizeRatio: number;
  readonly meanOpacity: number;
  readonly meanFlow: number;
  readonly meanDeposit: number;
  readonly meanSpacingRatio: number;
  readonly meanScatterRatio: number;
  readonly meanScatterOffsetRatio: number;
  readonly meanRoundness: number;
  readonly meanAngleCos: number;
  readonly meanAngleSin: number;
}

export interface StudioBrushPressureCurveAnalysis {
  readonly responsive: boolean;
  readonly distinctStateCount: number;
  readonly coarseResponse: boolean;
  readonly abruptResponse: boolean;
  readonly maxStepShare: number;
  readonly continuityScore: number;
  readonly pathDistance: number;
  readonly endpointDistance: number;
  /** Extra response travel beyond the direct low→high path; high values suggest reversals. */
  readonly reversalRatio: number;
  readonly stepDistances: readonly number[];
  readonly normalizedVectors: readonly (readonly number[])[];
}

export interface StudioBrushPressureCurveProfile {
  readonly version: typeof STUDIO_BRUSH_PRESSURE_CURVE_QUALITY_VERSION;
  readonly catalogId: string;
  readonly runtimeBrushId: string;
  readonly samples: readonly StudioBrushPressureCurveSample[];
  readonly analysis: StudioBrushPressureCurveAnalysis;
  readonly fingerprint: string;
}

export interface StudioBrushPressureCurveProfileInput {
  readonly catalogId: string;
  readonly runtimeBrushId: string;
  readonly defaultWidth: number;
  readonly defaultOpacity: number;
  readonly settings: NormalizedStudioBrushDynamicsSettings;
  readonly seed?: number;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function rounded(value: number, digits = FINGERPRINT_DIGITS): number {
  const multiplier = 10 ** digits;
  return Math.round(finite(value) * multiplier) / multiplier;
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + finite(value), 0) / values.length;
}

function sampleVector(sample: StudioBrushPressureCurveSample): readonly number[] {
  return Object.freeze([
    sample.dabCount,
    sample.meanSizeRatio,
    sample.meanOpacity,
    sample.meanFlow,
    sample.meanDeposit,
    sample.meanSpacingRatio,
    sample.meanScatterRatio,
    sample.meanScatterOffsetRatio,
    sample.meanRoundness,
    sample.meanAngleCos,
    sample.meanAngleSin,
  ].map((value) => rounded(value)));
}

function euclideanDistance(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new Error("Studio pressure vectors have different lengths");
  }
  let squared = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    squared += delta * delta;
  }
  return Math.sqrt(squared);
}

function distinctSampleKey(sample: StudioBrushPressureCurveSample): string {
  return JSON.stringify(sampleVector(sample).map((value) => rounded(value, DISTINCT_DIGITS)));
}

/**
 * Analyses already measured samples. Exported separately so threshold behavior can be unit-tested
 * without fabricating renderer settings.
 */
export function analyzeStudioBrushPressureCurveSamples(
  samplesInput: readonly StudioBrushPressureCurveSample[],
): StudioBrushPressureCurveAnalysis {
  const samples = [...samplesInput].sort((left, right) => left.pressure - right.pressure);
  if (samples.length < 2) {
    throw new Error("Studio pressure curve quality requires at least two samples");
  }
  const vectors = samples.map(sampleVector);
  const axisCount = vectors[0]?.length ?? 0;
  const minima = Array.from({ length: axisCount }, () => Number.POSITIVE_INFINITY);
  const maxima = Array.from({ length: axisCount }, () => Number.NEGATIVE_INFINITY);
  for (const vector of vectors) {
    if (vector.length !== axisCount || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("Studio pressure curve contains a non-finite or malformed response vector");
    }
    for (let axis = 0; axis < axisCount; axis += 1) {
      minima[axis] = Math.min(minima[axis]!, vector[axis]!);
      maxima[axis] = Math.max(maxima[axis]!, vector[axis]!);
    }
  }
  const normalizedVectors = vectors.map((vector) => Object.freeze(vector.map((value, axis) => {
    const range = maxima[axis]! - minima[axis]!;
    return range <= RESPONSE_EPSILON ? 0 : rounded((value - minima[axis]!) / range);
  })));
  const stepDistances = normalizedVectors.slice(1).map((vector, index) => (
    rounded(euclideanDistance(normalizedVectors[index]!, vector))
  ));
  const pathDistance = stepDistances.reduce((sum, value) => sum + value, 0);
  const endpointDistance = euclideanDistance(
    normalizedVectors[0]!,
    normalizedVectors.at(-1)!,
  );
  const responsive = pathDistance > RESPONSE_EPSILON;
  const maxStepShare = responsive
    ? Math.max(...stepDistances) / pathDistance
    : 0;
  const idealStepShare = 1 / Math.max(1, stepDistances.length);
  const continuityScore = responsive
    ? clamp01(
        1 - (maxStepShare - idealStepShare) / Math.max(
          RESPONSE_EPSILON,
          1 - idealStepShare,
        ),
      )
    : 1;
  const distinctStateCount = new Set(samples.map(distinctSampleKey)).size;
  const reversalRatio = responsive
    ? clamp01((pathDistance - endpointDistance) / pathDistance)
    : 0;
  return Object.freeze({
    responsive,
    distinctStateCount,
    coarseResponse:
      responsive && distinctStateCount < STUDIO_BRUSH_PRESSURE_MIN_DISTINCT_STATES,
    abruptResponse:
      responsive && maxStepShare > STUDIO_BRUSH_PRESSURE_MAX_STEP_SHARE,
    maxStepShare: rounded(maxStepShare),
    continuityScore: rounded(continuityScore),
    pathDistance: rounded(pathDistance),
    endpointDistance: rounded(endpointDistance),
    reversalRatio: rounded(reversalRatio),
    stepDistances: Object.freeze(stepDistances),
    normalizedVectors: Object.freeze(normalizedVectors),
  });
}

function pressureSample(
  input: StudioBrushPressureCurveProfileInput,
  pressureInput: number,
): StudioBrushPressureCurveSample {
  const pressure = clamp01(finite(pressureInput));
  const defaultWidth = Math.max(0.25, finite(input.defaultWidth, 1));
  const dabs = planNormalizedStudioDynamicBrushDabs({
    points: PROBE_POINTS,
    pressures: Array.from({ length: PROBE_POINT_COUNT }, () => pressure),
    speeds: Array.from({ length: PROBE_POINT_COUNT }, () => PROBE_SPEED),
    baseWidth: defaultWidth,
    baseOpacity: clamp01(finite(input.defaultOpacity, 1)),
    seed: input.seed ?? PROBE_SEED,
    maxDabs: PROBE_MAX_DABS,
  }, input.settings);
  const sizeRatios = dabs.map(({ size }) => size / defaultWidth);
  const opacity = dabs.map((dab) => dab.opacity);
  const flow = dabs.map((dab) => dab.flow);
  const spacingRatios = dabs.map(({ spacing }) => spacing / defaultWidth);
  const scatterRatios = dabs.map(({ scatter }) => scatter / defaultWidth);
  const scatterOffsetRatios = dabs.map(({ x, y, sourceX, sourceY }) => (
    Math.hypot(x - sourceX, y - sourceY) / defaultWidth
  ));
  const angleRadians = dabs.map(({ angle }) => angle * Math.PI / 180);
  const sample: StudioBrushPressureCurveSample = {
    pressure,
    dabCount: dabs.length,
    meanSizeRatio: mean(sizeRatios),
    meanOpacity: mean(opacity),
    meanFlow: mean(flow),
    meanDeposit: mean(dabs.map((dab) => dab.opacity * dab.flow)),
    meanSpacingRatio: mean(spacingRatios),
    meanScatterRatio: mean(scatterRatios),
    meanScatterOffsetRatio: mean(scatterOffsetRatios),
    meanRoundness: mean(dabs.map(({ roundness }) => roundness)),
    meanAngleCos: mean(angleRadians.map((angle) => Math.cos(angle))),
    meanAngleSin: mean(angleRadians.map((angle) => Math.sin(angle))),
  };
  if (Object.values(sample).some((value) => !Number.isFinite(value))) {
    throw new Error(`${input.catalogId}: non-finite dynamic pressure response`);
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(sample).map(([key, value]) => [key, rounded(value)]),
    ) as unknown as StudioBrushPressureCurveSample,
  );
}

export function profileStudioBrushPressureCurve(
  input: StudioBrushPressureCurveProfileInput,
): StudioBrushPressureCurveProfile {
  const samples = Object.freeze(
    STUDIO_BRUSH_PRESSURE_PROBE_LEVELS.map((pressure) => pressureSample(input, pressure)),
  );
  const analysis = analyzeStudioBrushPressureCurveSamples(samples);
  return Object.freeze({
    version: STUDIO_BRUSH_PRESSURE_CURVE_QUALITY_VERSION,
    catalogId: input.catalogId,
    runtimeBrushId: input.runtimeBrushId,
    samples,
    analysis,
    fingerprint: JSON.stringify({
      version: STUDIO_BRUSH_PRESSURE_CURVE_QUALITY_VERSION,
      samples: samples.map(sampleVector),
      analysis,
    }),
  });
}
