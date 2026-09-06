/**
 * Pure forward predictor for the speculative ink tail, with an explicit over-prediction budget.
 *
 * ## Why a predictor of our own
 *
 * The repo already consumes `PointerEvent.getPredictedEvents()` and routes it to a replaceable
 * surface. That API exists only on Chromium, is unavailable during a `pointerrawupdate`-only burst,
 * and is a black box: it cannot be measured, tuned, or capped. This module provides a model whose
 * error is measurable and whose worst case is bounded, so prediction can be enabled with a number
 * attached rather than as a feel-based guess.
 *
 * ## Model
 *
 * Second-order extrapolation on the last three authoritative samples:
 *
 *     v_n   = (p_n - p_{n-1}) / dt_n                      instantaneous velocity
 *     v̂_n   = α·v_n + (1-α)·v̂_{n-1}                        EMA-smoothed velocity
 *     a_n   = (v_n - v_{n-1}) / dt_n                      instantaneous acceleration
 *     â_n   = α·a_n + (1-α)·â_{n-1}                        EMA-smoothed acceleration
 *     d(h)  = τ · (v̂_n·h·g + ½·â_n·h²·κ)                   raw displacement over horizon h
 *     p(h)  = p_n + clampMagnitude(d(h), L)
 *
 * with
 *
 *     τ = directionTrust  ∈ [0,1]   collapses the whole displacement through a turn
 *     g = velocityGain              1 reproduces exact constant-velocity motion
 *     κ = accelerationTrust         < 1 because a curved path's acceleration term is the main
 *                                   source of overshoot at the moment curvature changes
 *     L = min(maxLeadPx, maxLeadStepMultiple · |v_n| · h)   with v_n the *instantaneous* velocity
 *
 * ## Over-prediction control, and what measurement said about it
 *
 * Overshoot is visible at direction changes, where a velocity estimate keeps flying along the old
 * heading after the pen has turned back. Three mechanisms could suppress it; they were measured
 * against each other with `evaluateStudioPredictor` on synthetic paths at an 8ms sample interval
 * (the tests re-derive every number below):
 *
 * 1. **The EMA itself.** At α = 0.6 the smoothed velocity has already turned by the first sample
 *    *after* a reversal, so the wrong-direction lead lasts a single frame.
 * 2. **Lead clamp (L).** A prediction can never travel further than `maxLeadStepMultiple` times the
 *    distance the pen would cover over the horizon at its most recent *instantaneous* speed, nor
 *    further than `maxLeadPx`. Derived from the raw finite difference rather than the smoothed state
 *    the model extrapolates from, so one corrupt timestamp inflating v̂ cannot escape it and a pen
 *    that has stopped predicts nothing. On every realistic path measured, this clamp never binds —
 *    it exists purely for driver glitches, which is exactly what a safety bound should look like.
 * 3. **Direction trust (τ).** Collapses the whole displacement through a turn.
 *
 * τ is **off by default** (`directionTrustFloor: -1`), because measurement did not support it at the
 * default smoothing: gating changed neither peak overshoot nor overshoot rate on any path, while
 * costing accuracy (zigzag mean error 7.71px gated-off vs 9.10px gated-on at h=8). The reason is
 * mechanism 1 — by the time a turn is detectable, the EMA has already produced a small, correct
 * backward prediction, and τ throws that away.
 *
 * τ does earn its place when the velocity estimate is slow (α = 0.25, e.g. a noisy or low-rate
 * digitiser). Measured at h=8ms, α=0.25, floor 0.2 vs gate off:
 *
 *     path           overshoot rate     mean overshoot (px)
 *     arc            1.00 -> 0.05       0.010 -> -0.049
 *     cusp           0.65 -> 0.52       0.762 ->  0.313
 *     hard reversal  0.08 -> 0.03       0.548 -> -0.122
 *     zigzag         0.38 -> 0.17       3.504 ->  1.997
 *
 * so the mechanism stays, opt-in, with its operating conditions written down.
 *
 * All three guards are pure functions of the sample history, so a given sample sequence always
 * produces the same tail — the stamp-brush determinism contract is preserved.
 */

import { studioLowLatencyPercentile } from "./studio-lowlatency-latency-metrics";

export interface StudioPredictorSample {
  readonly x: number;
  readonly y: number;
  readonly timeStamp: number;
  readonly pressure?: number;
}

export interface StudioPredictorPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly timeStamp: number;
  /** Horizon in milliseconds ahead of the newest authoritative sample. */
  readonly horizonMs: number;
  /** Direction trust applied to this point, in [0,1]. 0 means the tail collapsed to the tip. */
  readonly trust: number;
  /** True when the lead clamp bound this point's displacement. */
  readonly clamped: boolean;
}

export interface StudioPredictorOptions {
  /** EMA weight on the newest instantaneous estimate. */
  readonly smoothing?: number;
  readonly velocityGain?: number;
  readonly accelerationTrust?: number;
  /** cos(theta) at or below which prediction collapses entirely. `<= -1` disables the gate. */
  readonly directionTrustFloor?: number;
  /** Absolute lead budget in the sample coordinate space. */
  readonly maxLeadPx?: number;
  /** Lead budget as a multiple of the last observed step length. */
  readonly maxLeadStepMultiple?: number;
  /** Upper bound on any requested horizon. */
  readonly maxHorizonMs?: number;
  /** Timestamp deltas below this are treated as unusable and skip the velocity update. */
  readonly minSampleDeltaMs?: number;
}

export interface StudioPredictorResolvedOptions {
  readonly smoothing: number;
  readonly velocityGain: number;
  readonly accelerationTrust: number;
  readonly directionTrustFloor: number;
  readonly maxLeadPx: number;
  readonly maxLeadStepMultiple: number;
  readonly maxHorizonMs: number;
  readonly minSampleDeltaMs: number;
}

export const STUDIO_PREDICTOR_DEFAULTS: StudioPredictorResolvedOptions = Object.freeze({
  smoothing: 0.6,
  velocityGain: 1,
  // A full second-order term overshoots hard the instant curvature changes sign. Half weight keeps
  // the useful lead on accelerating straight motion without paying for it at every inflection.
  accelerationTrust: 0.5,
  // Measured OFF by default. See the module header: at this smoothing the EMA has already turned by
  // the first post-reversal sample, so the gate suppresses a *correct* small backward prediction and
  // buys no reduction in peak overshoot. It earns its place only at slow smoothing / low sample
  // rates, where the caller opts in with a floor in [0, 1).
  directionTrustFloor: -1,
  maxLeadPx: 48,
  maxLeadStepMultiple: 1.5,
  // Measured: at one display frame (<=16ms) the model beats the do-nothing baseline on every
  // synthetic path tried, including a hairpin. At 32ms it loses to the baseline on reversal-heavy
  // paths, so 32ms is not an operating point and the clamp refuses to reach it.
  maxHorizonMs: 16,
  minSampleDeltaMs: 0.05,
});

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

export function resolveStudioPredictorOptions(
  options: StudioPredictorOptions = {}
): StudioPredictorResolvedOptions {
  return {
    smoothing: clamp(finiteOr(options.smoothing, STUDIO_PREDICTOR_DEFAULTS.smoothing), 0, 1),
    velocityGain: Math.max(0, finiteOr(options.velocityGain, STUDIO_PREDICTOR_DEFAULTS.velocityGain)),
    accelerationTrust: clamp(
      finiteOr(options.accelerationTrust, STUDIO_PREDICTOR_DEFAULTS.accelerationTrust),
      0,
      1
    ),
    directionTrustFloor: clamp(
      finiteOr(options.directionTrustFloor, STUDIO_PREDICTOR_DEFAULTS.directionTrustFloor),
      -1,
      0.999
    ),
    maxLeadPx: Math.max(0, finiteOr(options.maxLeadPx, STUDIO_PREDICTOR_DEFAULTS.maxLeadPx)),
    maxLeadStepMultiple: Math.max(
      0,
      finiteOr(options.maxLeadStepMultiple, STUDIO_PREDICTOR_DEFAULTS.maxLeadStepMultiple)
    ),
    maxHorizonMs: Math.max(0, finiteOr(options.maxHorizonMs, STUDIO_PREDICTOR_DEFAULTS.maxHorizonMs)),
    minSampleDeltaMs: Math.max(
      0,
      finiteOr(options.minSampleDeltaMs, STUDIO_PREDICTOR_DEFAULTS.minSampleDeltaMs)
    ),
  };
}

interface PredictorState {
  x: number;
  y: number;
  pressure: number;
  timeStamp: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  /** Newest instantaneous velocity, before smoothing. */
  lastVx: number;
  lastVy: number;
  /** Smoothed velocity as it stood *before* the newest sample was folded in. */
  priorVx: number;
  priorVy: number;
  samples: number;
}

/**
 * Incremental predictor over one stroke. Fed only authoritative samples; predicted output is never
 * fed back, so the state cannot drift away from the hardware path.
 */
export class StudioLowLatencyPredictor {
  private readonly options: StudioPredictorResolvedOptions;
  private state: PredictorState | null = null;

  constructor(options: StudioPredictorOptions = {}) {
    this.options = resolveStudioPredictorOptions(options);
  }

  getOptions(): StudioPredictorResolvedOptions {
    return this.options;
  }

  reset(): void {
    this.state = null;
  }

  /** Number of authoritative samples consumed so far. */
  get sampleCount(): number {
    return this.state?.samples ?? 0;
  }

  push(sample: StudioPredictorSample): void {
    const x = finiteOr(sample.x, Number.NaN);
    const y = finiteOr(sample.y, Number.NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const pressure = clamp(finiteOr(sample.pressure, 0.5), 0, 1);
    const timeStamp = finiteOr(sample.timeStamp, this.state ? this.state.timeStamp : 0);

    const previous = this.state;
    if (!previous) {
      this.state = {
        x,
        y,
        pressure,
        timeStamp,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        lastVx: 0,
        lastVy: 0,
        priorVx: 0,
        priorVy: 0,
        samples: 1,
      };
      return;
    }

    const dt = timeStamp - previous.timeStamp;
    const dx = x - previous.x;
    const dy = y - previous.y;
    if (!(dt >= this.options.minSampleDeltaMs)) {
      // Degenerate or regressing clock: keep the position current but do not derive an infinite
      // velocity from it. The previous kinematics remain the best available estimate.
      this.state = {
        ...previous,
        x,
        y,
        pressure,
        timeStamp: Math.max(previous.timeStamp, timeStamp),
        samples: previous.samples + 1,
      };
      return;
    }

    const instantVx = dx / dt;
    const instantVy = dy / dt;
    const alpha = this.options.smoothing;
    const seeded = previous.samples >= 2;
    const vx = seeded ? alpha * instantVx + (1 - alpha) * previous.vx : instantVx;
    const vy = seeded ? alpha * instantVy + (1 - alpha) * previous.vy : instantVy;
    const instantAx = seeded ? (instantVx - previous.lastVx) / dt : 0;
    const instantAy = seeded ? (instantVy - previous.lastVy) / dt : 0;
    const ax = seeded ? alpha * instantAx + (1 - alpha) * previous.ax : 0;
    const ay = seeded ? alpha * instantAy + (1 - alpha) * previous.ay : 0;

    this.state = {
      x,
      y,
      pressure,
      timeStamp,
      vx,
      vy,
      ax,
      ay,
      lastVx: instantVx,
      lastVy: instantVy,
      priorVx: previous.vx,
      priorVy: previous.vy,
      samples: previous.samples + 1,
    };
  }

  /**
   * Cosine between the newest instantaneous velocity and the heading the stroke had *before* that
   * sample. Comparing against the already-updated smoothed velocity would be self-referential: the
   * smoothed value has absorbed the turn and would report a straight line through a hairpin.
   * Returns 1 when there is not enough history to have a heading yet.
   */
  directionCosine(): number {
    const state = this.state;
    if (!state || state.samples < 3) return 1;
    const currentMagnitude = Math.hypot(state.lastVx, state.lastVy);
    const priorMagnitude = Math.hypot(state.priorVx, state.priorVy);
    if (currentMagnitude === 0 || priorMagnitude === 0) return 1;
    const dot = state.lastVx * state.priorVx + state.lastVy * state.priorVy;
    return clamp(dot / (currentMagnitude * priorMagnitude), -1, 1);
  }

  /**
   * τ in the model above. `directionTrustFloor <= -1` disables the gate entirely (τ = 1), which
   * exists so the guard can be A/B-measured against an otherwise identical predictor.
   */
  directionTrust(): number {
    const floor = this.options.directionTrustFloor;
    if (floor <= -1) return 1;
    const cosine = this.directionCosine();
    if (cosine <= floor) return 0;
    return clamp((cosine - floor) / (1 - floor), 0, 1);
  }

  /**
   * Predicts a single point `horizonMs` ahead of the newest authoritative sample.
   * Returns null before enough history exists to derive a velocity.
   */
  predict(horizonMs: number): StudioPredictorPoint | null {
    const state = this.state;
    if (!state || state.samples < 2) return null;
    const horizon = clamp(finiteOr(horizonMs, 0), 0, this.options.maxHorizonMs);
    if (horizon === 0) return null;

    const trust = this.directionTrust();
    const rawDx = trust * (
      state.vx * horizon * this.options.velocityGain
      + 0.5 * state.ax * horizon * horizon * this.options.accelerationTrust
    );
    const rawDy = trust * (
      state.vy * horizon * this.options.velocityGain
      + 0.5 * state.ay * horizon * horizon * this.options.accelerationTrust
    );
    if (!Number.isFinite(rawDx) || !Number.isFinite(rawDy)) return null;

    const magnitude = Math.hypot(rawDx, rawDy);
    // Kinematic budget: never lead further than `maxLeadStepMultiple` times the distance the pen
    // would cover over the horizon at its most recent *instantaneous* speed. This is independent of
    // the smoothed velocity the model extrapolates from, so one corrupt timestamp inflating v̂
    // cannot escape the cap, and a pen that has stopped predicts nothing.
    const instantSpeed = Math.hypot(state.lastVx, state.lastVy);
    const budget = Math.min(
      this.options.maxLeadPx,
      instantSpeed * horizon * this.options.maxLeadStepMultiple
    );
    const clamped = magnitude > budget && magnitude > 0;
    const scale = clamped ? budget / magnitude : 1;

    return {
      x: state.x + rawDx * scale,
      y: state.y + rawDy * scale,
      pressure: state.pressure,
      timeStamp: state.timeStamp + horizon,
      horizonMs: horizon,
      trust,
      clamped,
    };
  }

  /** Predicts an evenly spaced tail. Points are ordered nearest-first, like the native API. */
  predictTail(horizonMs: number, steps: number): readonly StudioPredictorPoint[] {
    const total = clamp(finiteOr(horizonMs, 0), 0, this.options.maxHorizonMs);
    const count = Number.isFinite(steps) ? Math.max(0, Math.floor(steps)) : 0;
    if (total === 0 || count === 0) return [];
    const points: StudioPredictorPoint[] = [];
    for (let index = 1; index <= count; index += 1) {
      const point = this.predict((total * index) / count);
      if (point === null) return points;
      points.push(point);
    }
    return points;
  }
}

export function createStudioLowLatencyPredictor(
  options: StudioPredictorOptions = {}
): StudioLowLatencyPredictor {
  return new StudioLowLatencyPredictor(options);
}

export interface StudioPredictionErrorObservation {
  readonly predictedX: number;
  readonly predictedY: number;
  readonly actualX: number;
  readonly actualY: number;
  /** Authoritative point the prediction departed from; defines the "forward" direction. */
  readonly originX: number;
  readonly originY: number;
  readonly horizonMs: number;
  readonly trust: number;
}

export interface StudioPredictionErrorMetrics {
  readonly count: number;
  /** Euclidean distance between prediction and truth. */
  readonly meanError: number;
  readonly p50Error: number;
  readonly p95Error: number;
  readonly maxError: number;
  /**
   * Signed component of the error along the direction the prediction itself travelled.
   * Positive = the speculative tip sticks out past where the pen really is — the visible artifact.
   *
   * Measuring along the *predicted* displacement rather than the pen's actual travel matters at a
   * reversal: once the pen turns around, "along actual travel" points backwards and reports a real
   * forward overshoot as a negative number, exactly hiding the case that motivated the metric.
   * A prediction that collapsed to the authoritative tip has no displacement and scores 0.
   */
  readonly meanOvershoot: number;
  readonly p95Overshoot: number;
  readonly maxOvershoot: number;
  /** Fraction of observations with any positive overshoot. */
  readonly overshootRate: number;
  /** Largest perpendicular deviation; shows corner-cutting rather than flying past. */
  readonly maxLateral: number;
}

const EMPTY_ERROR_METRICS: StudioPredictionErrorMetrics = Object.freeze({
  count: 0,
  meanError: 0,
  p50Error: 0,
  p95Error: 0,
  maxError: 0,
  meanOvershoot: 0,
  p95Overshoot: 0,
  maxOvershoot: 0,
  overshootRate: 0,
  maxLateral: 0,
});

/**
 * Decomposes prediction error into the two components that matter perceptually:
 * forward overshoot (the pen tip visibly leading past the hand) and lateral deviation
 * (the tail cutting a corner). A single Euclidean number hides which one regressed.
 */
export function studioPredictionErrorMetrics(
  observations: readonly StudioPredictionErrorObservation[]
): StudioPredictionErrorMetrics {
  const errors: number[] = [];
  const overshoots: number[] = [];
  let overshootCount = 0;
  let maxLateral = 0;
  let errorTotal = 0;
  let overshootTotal = 0;

  for (const observation of observations) {
    const ex = observation.predictedX - observation.actualX;
    const ey = observation.predictedY - observation.actualY;
    if (!Number.isFinite(ex) || !Number.isFinite(ey)) continue;
    const error = Math.hypot(ex, ey);
    errors.push(error);
    errorTotal += error;

    const lx = observation.predictedX - observation.originX;
    const ly = observation.predictedY - observation.originY;
    const lead = Math.hypot(lx, ly);
    let overshoot: number;
    let lateral: number;
    if (lead > 0) {
      const ux = lx / lead;
      const uy = ly / lead;
      overshoot = ex * ux + ey * uy;
      lateral = Math.abs(ex * -uy + ey * ux);
    } else {
      // A collapsed prediction draws nothing beyond the authoritative tip, so nothing sticks out.
      // Its distance from the truth is still counted as error, just not as overshoot.
      overshoot = 0;
      lateral = 0;
    }
    overshoots.push(overshoot);
    overshootTotal += overshoot;
    if (overshoot > 0) overshootCount += 1;
    if (lateral > maxLateral) maxLateral = lateral;
  }

  if (errors.length === 0) return EMPTY_ERROR_METRICS;

  const sortedErrors = [...errors].sort((left, right) => left - right);
  const sortedOvershoots = [...overshoots].sort((left, right) => left - right);

  return {
    count: errors.length,
    meanError: errorTotal / errors.length,
    p50Error: studioLowLatencyPercentile(sortedErrors, 50),
    p95Error: studioLowLatencyPercentile(sortedErrors, 95),
    maxError: sortedErrors[sortedErrors.length - 1] ?? 0,
    meanOvershoot: overshootTotal / overshoots.length,
    p95Overshoot: studioLowLatencyPercentile(sortedOvershoots, 95),
    maxOvershoot: sortedOvershoots[sortedOvershoots.length - 1] ?? 0,
    overshootRate: overshootCount / errors.length,
    maxLateral,
  };
}

/**
 * Linear interpolation of a timestamped path at an arbitrary time, used as ground truth for a
 * prediction horizon that lands between two real samples.
 */
export function studioSamplePathAt(
  path: readonly StudioPredictorSample[],
  timeStamp: number
): { readonly x: number; readonly y: number } | null {
  if (path.length === 0) return null;
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return null;
  if (timeStamp <= first.timeStamp) return { x: first.x, y: first.y };
  if (timeStamp >= last.timeStamp) return { x: last.x, y: last.y };
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    if (!previous || !current) continue;
    if (timeStamp <= current.timeStamp) {
      const span = current.timeStamp - previous.timeStamp;
      if (span <= 0) return { x: current.x, y: current.y };
      const ratio = (timeStamp - previous.timeStamp) / span;
      return {
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      };
    }
  }
  return { x: last.x, y: last.y };
}

/**
 * Replays a synthetic path through a fresh predictor and scores every prediction against the
 * interpolated truth at the same instant. This is the harness the tests use to attach numbers to
 * a predictor change instead of eyeballing a curve.
 *
 * Predictions whose horizon lands past the end of the recorded path are skipped: there is no truth
 * to score them against, and clamping to the final sample would report the predictor's lead as
 * error and quietly flatter a predictor that does nothing.
 */
export function evaluateStudioPredictor(
  path: readonly StudioPredictorSample[],
  horizonMs: number,
  options: StudioPredictorOptions = {}
): StudioPredictionErrorMetrics {
  const predictor = new StudioLowLatencyPredictor(options);
  const last = path[path.length - 1];
  const observations: StudioPredictionErrorObservation[] = [];
  for (const sample of path) {
    predictor.push(sample);
    const prediction = predictor.predict(horizonMs);
    if (prediction === null) continue;
    if (last && prediction.timeStamp > last.timeStamp) continue;
    const truth = studioSamplePathAt(path, prediction.timeStamp);
    if (truth === null) continue;
    observations.push({
      predictedX: prediction.x,
      predictedY: prediction.y,
      actualX: truth.x,
      actualY: truth.y,
      originX: sample.x,
      originY: sample.y,
      horizonMs: prediction.horizonMs,
      trust: prediction.trust,
    });
  }
  return studioPredictionErrorMetrics(observations);
}

/**
 * Scores the do-nothing predictor — "show the newest authoritative sample" — on the same path and
 * horizon. Prediction is only worth its complexity where it beats this baseline, and a reversal
 * guard is only correct if it degrades *to* this baseline rather than past it.
 */
export function evaluateStudioNoPrediction(
  path: readonly StudioPredictorSample[],
  horizonMs: number,
  options: StudioPredictorOptions = {}
): StudioPredictionErrorMetrics {
  const resolved = resolveStudioPredictorOptions(options);
  const horizon = clamp(finiteOr(horizonMs, 0), 0, resolved.maxHorizonMs);
  const predictor = new StudioLowLatencyPredictor(options);
  const last = path[path.length - 1];
  const observations: StudioPredictionErrorObservation[] = [];
  for (const sample of path) {
    predictor.push(sample);
    // Mirror the real predictor's warm-up so both series cover exactly the same instants.
    if (predictor.predict(horizonMs) === null) continue;
    const at = sample.timeStamp + horizon;
    if (last && at > last.timeStamp) continue;
    const truth = studioSamplePathAt(path, at);
    if (truth === null) continue;
    observations.push({
      predictedX: sample.x,
      predictedY: sample.y,
      actualX: truth.x,
      actualY: truth.y,
      originX: sample.x,
      originY: sample.y,
      horizonMs: horizon,
      trust: 0,
    });
  }
  return studioPredictionErrorMetrics(observations);
}
