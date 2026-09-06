/**
 * Deterministic two-dimensional One Euro candidate for Studio pointer input.
 *
 * This is intentionally a pure, renderer-neutral provider. It does not replace the currently
 * shipped adaptive stabilizer merely by existing: the engine-selection benchmark must prove lower
 * jitter at an equal-or-better lag budget before product routing may promote it.
 *
 * Important properties:
 * - x/y share one speed-derived cutoff, preventing axis-dependent curve deformation.
 * - speed is measured in CSS px/s, so zoom does not silently retune the filter.
 * - repeated or regressing browser timestamps reuse the last trustworthy cadence for one sample
 *   and re-anchor to the newest native timestamp.
 * - predicted points can evaluate a copied state without mutating committed stroke state.
 */

export const STUDIO_STROKE_ONE_EURO_V1_VERSION = 1 as const;
export const STUDIO_STROKE_ONE_EURO_DEFAULT_SAMPLE_INTERVAL_MS = 1_000 / 120;

const MIN_SAMPLE_INTERVAL_MS = 1;
const MAX_SAMPLE_INTERVAL_MS = 64;
const MIN_CUTOFF_HZ = 0.01;
const MAX_CUTOFF_HZ = 240;
const MAX_BETA_SECONDS_PER_CSS_PIXEL = 4;

export interface StudioStrokeOneEuroV1Options {
  /** Resting cutoff. Lower values remove more hand jitter but add more low-speed lag. */
  readonly minCutoffHz: number;
  /** Speed response in seconds per CSS pixel. Higher values follow fast gestures sooner. */
  readonly beta: number;
  /** Low-pass cutoff for the raw x/y derivative. */
  readonly derivativeCutoffHz: number;
  /** Number of CSS pixels represented by one logical canvas pixel. */
  readonly coordinateScale?: number;
}

export interface StudioStrokeOneEuroV1Sample {
  readonly x: number;
  readonly y: number;
  /** DOMHighResTimeStamp in milliseconds. */
  readonly timeStamp?: number;
}

export interface StudioStrokeOneEuroV1State {
  readonly rawX: number;
  readonly rawY: number;
  readonly outputX: number;
  readonly outputY: number;
  /** Filtered logical-pixel velocity in x/y per second. */
  readonly derivativeX: number;
  readonly derivativeY: number;
  readonly timeStamp: number;
  readonly sampleIntervalMs: number;
}

export interface StudioStrokeOneEuroV1Result {
  readonly point: readonly [number, number];
  readonly state: StudioStrokeOneEuroV1State;
  readonly cutoffHz: number;
  /** Filtered screen-space speed in CSS px/s. */
  readonly speedCssPixelsPerSecond: number;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeTimeStamp(value: unknown, fallback: number): number {
  return Math.max(0, finite(value, fallback));
}

function safeSampleInterval(value: unknown): number {
  return clamp(
    finite(value, STUDIO_STROKE_ONE_EURO_DEFAULT_SAMPLE_INTERVAL_MS),
    MIN_SAMPLE_INTERVAL_MS,
    MAX_SAMPLE_INTERVAL_MS,
  );
}

function safeCoordinateScale(value: unknown): number {
  return clamp(finite(value, 1), 0.01, 64);
}

function safeOptions(options: StudioStrokeOneEuroV1Options): {
  readonly minCutoffHz: number;
  readonly beta: number;
  readonly derivativeCutoffHz: number;
  readonly coordinateScale: number;
} {
  return {
    minCutoffHz: clamp(
      finite(options.minCutoffHz, 1.4),
      MIN_CUTOFF_HZ,
      MAX_CUTOFF_HZ,
    ),
    beta: clamp(
      finite(options.beta, 0.012),
      0,
      MAX_BETA_SECONDS_PER_CSS_PIXEL,
    ),
    derivativeCutoffHz: clamp(
      finite(options.derivativeCutoffHz, 1),
      MIN_CUTOFF_HZ,
      MAX_CUTOFF_HZ,
    ),
    coordinateScale: safeCoordinateScale(options.coordinateScale),
  };
}

function lowPassAlpha(cutoffHz: number, elapsedSeconds: number): number {
  const timeConstantSeconds = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + timeConstantSeconds / elapsedSeconds);
}

function resolveTiming(
  previousTimeStamp: number,
  previousSampleIntervalMs: number,
  nextTimeStamp: unknown,
): {
  readonly elapsedMs: number;
  readonly timeStamp: number;
  readonly sampleIntervalMs: number;
} {
  const timeStamp = safeTimeStamp(nextTimeStamp, previousTimeStamp);
  const rawElapsedMs = timeStamp - previousTimeStamp;
  if (Number.isFinite(rawElapsedMs) && rawElapsedMs > 0) {
    const elapsedMs = clamp(
      rawElapsedMs,
      MIN_SAMPLE_INTERVAL_MS,
      MAX_SAMPLE_INTERVAL_MS,
    );
    return {
      elapsedMs,
      timeStamp,
      sampleIntervalMs: rawElapsedMs <= MAX_SAMPLE_INTERVAL_MS
        ? elapsedMs
        : safeSampleInterval(previousSampleIntervalMs),
    };
  }
  const elapsedMs = safeSampleInterval(previousSampleIntervalMs);
  return {
    elapsedMs,
    // Re-anchor instead of advancing a synthetic clock. A following healthy native timestamp can
    // therefore recover immediately after one reduced or regressing delivery.
    timeStamp,
    sampleIntervalMs: elapsedMs,
  };
}

export function createStudioStrokeOneEuroV1State(
  sample: StudioStrokeOneEuroV1Sample,
): StudioStrokeOneEuroV1State {
  const x = finite(sample.x, 0);
  const y = finite(sample.y, 0);
  return Object.freeze({
    rawX: x,
    rawY: y,
    outputX: x,
    outputY: y,
    derivativeX: 0,
    derivativeY: 0,
    timeStamp: safeTimeStamp(sample.timeStamp, 0),
    sampleIntervalMs: STUDIO_STROKE_ONE_EURO_DEFAULT_SAMPLE_INTERVAL_MS,
  });
}

export function filterStudioStrokeOneEuroV1(
  previous: StudioStrokeOneEuroV1State,
  sample: StudioStrokeOneEuroV1Sample,
  options: StudioStrokeOneEuroV1Options,
): StudioStrokeOneEuroV1Result {
  const previousOutputX = finite(previous.outputX, 0);
  const previousOutputY = finite(previous.outputY, 0);
  const previousRawX = finite(previous.rawX, previousOutputX);
  const previousRawY = finite(previous.rawY, previousOutputY);
  const rawX = finite(sample.x, previousRawX);
  const rawY = finite(sample.y, previousRawY);
  const normalized = safeOptions(options);
  const timing = resolveTiming(
    safeTimeStamp(previous.timeStamp, 0),
    previous.sampleIntervalMs,
    sample.timeStamp,
  );
  const elapsedSeconds = timing.elapsedMs / 1_000;

  const rawDerivativeX = (rawX - previousRawX) / elapsedSeconds;
  const rawDerivativeY = (rawY - previousRawY) / elapsedSeconds;
  const derivativeAlpha = lowPassAlpha(
    normalized.derivativeCutoffHz,
    elapsedSeconds,
  );
  const derivativeX = finite(previous.derivativeX, 0)
    + (rawDerivativeX - finite(previous.derivativeX, 0)) * derivativeAlpha;
  const derivativeY = finite(previous.derivativeY, 0)
    + (rawDerivativeY - finite(previous.derivativeY, 0)) * derivativeAlpha;
  const speedCssPixelsPerSecond = Math.hypot(
    derivativeX,
    derivativeY,
  ) * normalized.coordinateScale;
  const cutoffHz = clamp(
    normalized.minCutoffHz + normalized.beta * speedCssPixelsPerSecond,
    MIN_CUTOFF_HZ,
    MAX_CUTOFF_HZ,
  );
  const alpha = lowPassAlpha(cutoffHz, elapsedSeconds);
  const outputX = previousOutputX + (rawX - previousOutputX) * alpha;
  const outputY = previousOutputY + (rawY - previousOutputY) * alpha;

  const state = Object.freeze({
    rawX,
    rawY,
    outputX,
    outputY,
    derivativeX,
    derivativeY,
    timeStamp: timing.timeStamp,
    sampleIntervalMs: timing.sampleIntervalMs,
  });
  return Object.freeze({
    point: Object.freeze([outputX, outputY]) as readonly [number, number],
    state,
    cutoffHz,
    speedCssPixelsPerSecond,
  });
}

/**
 * Pointer release must never leave the durable line behind the physical pen. The caught-up point
 * is appended to the same authoritative sample journal before rendering and persistence.
 */
export function flushStudioStrokeOneEuroV1Endpoint(
  state: StudioStrokeOneEuroV1State,
): StudioStrokeOneEuroV1Result {
  const outputX = finite(state.outputX, 0);
  const outputY = finite(state.outputY, 0);
  const rawX = finite(state.rawX, outputX);
  const rawY = finite(state.rawY, outputY);
  const nextState = Object.freeze({
    rawX,
    rawY,
    outputX: rawX,
    outputY: rawY,
    derivativeX: 0,
    derivativeY: 0,
    timeStamp: safeTimeStamp(state.timeStamp, 0),
    sampleIntervalMs: safeSampleInterval(state.sampleIntervalMs),
  });
  return Object.freeze({
    point: Object.freeze([rawX, rawY]) as readonly [number, number],
    state: nextState,
    cutoffHz: 0,
    speedCssPixelsPerSecond: 0,
  });
}
