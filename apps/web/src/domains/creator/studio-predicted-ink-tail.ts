import {
  STUDIO_CAUSAL_INK_DEFAULT_PRESSURE,
  selectStudioCausalInkSamples,
} from "./studio-causal-ink";

/**
 * Pure two-surface state for low-latency pointer prediction.
 *
 * The durable/authoritative surface is append-only. It only ever receives
 * `authoritativeSpan.samples`; no transition in this module can clear or replace that surface.
 * Predictions live on a physically separate transient surface described by `predictionSurface`,
 * so a newer browser estimate can be replaced without touching one already-authoritative pixel.
 */

export const STUDIO_PREDICTED_INK_DEFAULT_PRESSURE = STUDIO_CAUSAL_INK_DEFAULT_PRESSURE;

/**
 * A prediction simulation needs the stroke origin (ruler anchoring) and the latest authoritative
 * sample (causal append anchoring), but never the complete already-painted route. Keeping this
 * budget explicit prevents a long stroke from drifting back to one full-prefix clone per browser
 * prediction delivery.
 */
export const STUDIO_PREDICTED_INK_DRAFT_MAX_CONTEXT_SAMPLES = 2;

const EMPTY_SAMPLES: readonly StudioPredictedInkSample[] = Object.freeze([]);
const KEEP_PREDICTION_SURFACE: StudioPredictedInkSurfaceUpdate = Object.freeze({ kind: "keep" });
const CLEAR_PREDICTION_SURFACE: StudioPredictedInkSurfaceUpdate = Object.freeze({ kind: "clear" });

export interface StudioPredictedInkSample {
  readonly x: number;
  readonly y: number;
  /** Sanitized exact-source pressure in the inclusive 0..1 range. */
  readonly pressure: number;
}

export interface StudioPredictedInkSampleInput {
  /** Flat `[x0, y0, x1, y1, ...]` coordinates in browser delivery order. */
  readonly points: readonly number[];
  /** Pressure at the corresponding coordinate-pair index. */
  readonly pressures?: readonly number[];
}

/**
 * Per-sample channels needed by the existing freehand input pipeline while it simulates a
 * disposable prediction suffix. This intentionally mirrors only mutable sample arrays, not a
 * durable drawing/history/CRDT object.
 */
export interface StudioPredictedInkSuffixDraftInput {
  readonly points: readonly number[];
  readonly pressures?: readonly number[];
  readonly tiltXs?: readonly number[];
  readonly tiltYs?: readonly number[];
  readonly twists?: readonly number[];
  readonly speeds?: readonly number[];
  readonly tangentialPressures?: readonly number[];
  /** Raw pressure fallback used only when a present pressure channel has a sparse endpoint. */
  readonly fallbackPressure: number;
}

/**
 * A private, mutable seed for one browser-prediction pass.
 *
 * The caller may spread an authoritative drawing object and replace only its sample arrays with
 * these arrays. Predicted samples then append after `draftPredictionStartSampleIndex`. The seed
 * must stay transient: it is suitable for a separately replaceable prediction surface, never for
 * history, persistence, CRDT publication, or a full-path fallback preview.
 */
export interface StudioPredictedInkSuffixDraftPlan {
  /** Sample count in the untouched authoritative drawing; useful for invariant checks only. */
  readonly authoritativeSampleCount: number;
  /** First index that a predicted sample may occupy in this bounded private draft. */
  readonly draftPredictionStartSampleIndex: number;
  readonly points: number[];
  readonly pressures?: number[];
  readonly tiltXs?: number[];
  readonly tiltYs?: number[];
  readonly twists?: number[];
  readonly speeds?: number[];
  readonly tangentialPressures?: number[];
}

export interface StudioPredictedInkTailState {
  readonly phase: "active" | "ended";
  readonly authoritativeSampleCount: number;
  readonly authoritativeEndpoint: StudioPredictedInkSample | null;
  /** Prediction samples only; the authoritative connection point is stored separately. */
  readonly predictedSamples: readonly StudioPredictedInkSample[];
}

/**
 * Geometry for one append-only authoritative update.
 *
 * `anchor` is the already-painted endpoint and is provided only to seed segment interpolation.
 * A renderer must not paint it as a new initial dab. Only `samples` are new authoritative input.
 */
export interface StudioAuthoritativeInkSpan {
  readonly anchor: StudioPredictedInkSample | null;
  readonly samples: readonly StudioPredictedInkSample[];
}

export type StudioPredictedInkSurfaceUpdate =
  | { readonly kind: "keep" }
  | { readonly kind: "clear" }
  | {
      readonly kind: "replace";
      /** Already-authoritative endpoint used only as the tail's geometric origin. */
      readonly anchor: StudioPredictedInkSample;
      /** The newest complete prediction suffix; it replaces, never appends to, the old tail. */
      readonly samples: readonly StudioPredictedInkSample[];
    };

export interface StudioPredictedInkTailTransition {
  readonly state: StudioPredictedInkTailState;
  /** The only operation this model can issue to the authoritative surface. */
  readonly authoritativeSpan: StudioAuthoritativeInkSpan;
  /** Operation for a separate, independently clearable prediction surface. */
  readonly predictionSurface: StudioPredictedInkSurfaceUpdate;
}

function emptyAuthoritativeSpan(): StudioAuthoritativeInkSpan {
  return { anchor: null, samples: EMPTY_SAMPLES };
}

function keepTransition(state: StudioPredictedInkTailState): StudioPredictedInkTailTransition {
  return {
    state,
    authoritativeSpan: emptyAuthoritativeSpan(),
    predictionSurface: KEEP_PREDICTION_SURFACE,
  };
}

function samePoint(
  left: StudioPredictedInkSample | null,
  right: StudioPredictedInkSample
): boolean {
  return left?.x === right.x && left.y === right.y;
}

function finiteChannelFallback(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Selects at most the origin and authoritative endpoint without iterating a source channel. */
function boundedDraftChannel(
  values: readonly number[] | undefined,
  sourceSampleCount: number,
  sourceIndices: readonly number[],
  fallback: number
): number[] | undefined {
  if (!values) return undefined;
  const selected = new Array<number>(sourceIndices.length);
  for (let index = 0; index < sourceIndices.length; index += 1) {
    const sourceIndex = sourceIndices[index]!;
    selected[index] = sourceIndex < sourceSampleCount
      ? finiteChannelFallback(values[sourceIndex]!, fallback)
      : fallback;
  }
  return selected;
}

/**
 * Plans an O(1)-sized context for suffix-only native pointer prediction.
 *
 * Only four coordinate scalars and two scalars per present aligned channel are read for a
 * multi-sample stroke, regardless of authoritative length. Invalid or incomplete endpoints fail
 * closed because a prediction must never invent an anchor. The returned arrays are fresh and may
 * be mutated privately by one prediction pass; every source array remains untouched.
 */
export function planStudioPredictedInkSuffixDraft(
  input: StudioPredictedInkSuffixDraftInput
): StudioPredictedInkSuffixDraftPlan | null {
  const authoritativeSampleCount = Math.floor(input.points.length / 2);
  if (authoritativeSampleCount <= 0) return null;

  const endpointIndex = authoritativeSampleCount - 1;
  const originX = input.points[0];
  const originY = input.points[1];
  const endpointX = input.points[endpointIndex * 2];
  const endpointY = input.points[endpointIndex * 2 + 1];
  if (![originX, originY, endpointX, endpointY].every(Number.isFinite)) return null;

  const sourceIndices = endpointIndex === 0
    ? [0]
    : [0, endpointIndex];
  const points = endpointIndex === 0
    ? [originX!, originY!]
    : [originX!, originY!, endpointX!, endpointY!];
  const fallbackPressure = Number.isFinite(input.fallbackPressure)
    ? input.fallbackPressure
    : STUDIO_PREDICTED_INK_DEFAULT_PRESSURE;

  return {
    authoritativeSampleCount,
    draftPredictionStartSampleIndex: sourceIndices.length,
    points,
    pressures: boundedDraftChannel(
      input.pressures,
      authoritativeSampleCount,
      sourceIndices,
      fallbackPressure
    ),
    tiltXs: boundedDraftChannel(input.tiltXs, authoritativeSampleCount, sourceIndices, 0),
    tiltYs: boundedDraftChannel(input.tiltYs, authoritativeSampleCount, sourceIndices, 0),
    twists: boundedDraftChannel(input.twists, authoritativeSampleCount, sourceIndices, 0),
    speeds: boundedDraftChannel(input.speeds, authoritativeSampleCount, sourceIndices, 0),
    tangentialPressures: boundedDraftChannel(
      input.tangentialPressures,
      authoritativeSampleCount,
      sourceIndices,
      0
    ),
  };
}

/**
 * Reuses the canonical causal input boundary: longest finite coordinate prefix, source-index
 * pressure alignment, 0..1 pressure clamping and a nominal 0.5 fallback. Exact adjacent coordinate
 * duplicates are discarded because they cannot extend a causal segment.
 */
function sanitizedSamples(
  input: StudioPredictedInkSampleInput,
  predecessor: StudioPredictedInkSample | null
): readonly StudioPredictedInkSample[] {
  const selected = selectStudioCausalInkSamples({
    points: input.points,
    pressures: input.pressures,
    minDistance: 0,
  });
  if (selected.length === 0) return EMPTY_SAMPLES;

  const result: StudioPredictedInkSample[] = [];
  let previous = predecessor;
  for (const sample of selected) {
    if (samePoint(previous, sample)) continue;
    const next = { x: sample.x, y: sample.y, pressure: sample.pressure };
    result.push(next);
    previous = next;
  }
  return result.length > 0 ? result : EMPTY_SAMPLES;
}

/** Starts a fresh stroke. A finished state is deliberately not reusable by late pointer events. */
export function createStudioPredictedInkTailState(): StudioPredictedInkTailState {
  return {
    phase: "active",
    authoritativeSampleCount: 0,
    authoritativeEndpoint: null,
    predictedSamples: EMPTY_SAMPLES,
  };
}

/**
 * Appends hardware-backed samples and invalidates the entire previous prediction tail.
 *
 * Calling this for an authoritative browser batch always clears the transient surface, including
 * when the batch becomes empty after validation. That fail-closed rule prevents stale estimates
 * from surviving a malformed or duplicate catch-up event.
 */
export function appendStudioAuthoritativeInk(
  state: StudioPredictedInkTailState,
  input: StudioPredictedInkSampleInput
): StudioPredictedInkTailTransition {
  if (state.phase !== "active") return keepTransition(state);

  const anchor = state.authoritativeEndpoint;
  const samples = sanitizedSamples(input, anchor);
  const endpoint = samples[samples.length - 1] ?? anchor;
  const predictionAlreadyEmpty = state.predictedSamples.length === 0;
  const nextState = samples.length === 0 && predictionAlreadyEmpty
    ? state
    : {
        phase: "active" as const,
        authoritativeSampleCount: state.authoritativeSampleCount + samples.length,
        authoritativeEndpoint: endpoint,
        predictedSamples: EMPTY_SAMPLES,
      };

  return {
    state: nextState,
    authoritativeSpan: {
      anchor: samples.length > 0 ? anchor : null,
      samples,
    },
    predictionSurface: CLEAR_PREDICTION_SURFACE,
  };
}

/**
 * Replaces the complete transient estimate while preserving the authoritative state byte-for-byte.
 * Predictions are ignored until the first real sample establishes a connection anchor.
 */
export function replaceStudioPredictedInkTail(
  state: StudioPredictedInkTailState,
  input: StudioPredictedInkSampleInput
): StudioPredictedInkTailTransition {
  if (state.phase !== "active") return keepTransition(state);
  const anchor = state.authoritativeEndpoint;
  if (!anchor) {
    return {
      state: state.predictedSamples.length === 0
        ? state
        : { ...state, predictedSamples: EMPTY_SAMPLES },
      authoritativeSpan: emptyAuthoritativeSpan(),
      predictionSurface: CLEAR_PREDICTION_SURFACE,
    };
  }

  const samples = sanitizedSamples(input, anchor);
  if (samples.length === 0) {
    return {
      state: state.predictedSamples.length === 0
        ? state
        : { ...state, predictedSamples: EMPTY_SAMPLES },
      authoritativeSpan: emptyAuthoritativeSpan(),
      predictionSurface: CLEAR_PREDICTION_SURFACE,
    };
  }

  const nextState: StudioPredictedInkTailState = {
    ...state,
    predictedSamples: samples,
  };
  return {
    state: nextState,
    authoritativeSpan: emptyAuthoritativeSpan(),
    predictionSurface: { kind: "replace", anchor, samples },
  };
}

/** Clears only the replaceable tail; authoritative endpoint/count remain available to continue. */
export function clearStudioPredictedInkTail(
  state: StudioPredictedInkTailState
): StudioPredictedInkTailTransition {
  const nextState = state.predictedSamples.length === 0
    ? state
    : { ...state, predictedSamples: EMPTY_SAMPLES };
  return {
    state: nextState,
    authoritativeSpan: emptyAuthoritativeSpan(),
    predictionSurface: CLEAR_PREDICTION_SURFACE,
  };
}

/**
 * Ends the stroke, clears the replaceable surface and makes all later append/replace events no-ops.
 * A new pointerdown must create a new state instead of reopening this one.
 */
export function endStudioPredictedInkTail(
  state: StudioPredictedInkTailState
): StudioPredictedInkTailTransition {
  const nextState: StudioPredictedInkTailState = state.phase === "ended" && state.predictedSamples.length === 0
    ? state
    : {
        ...state,
        phase: "ended",
        predictedSamples: EMPTY_SAMPLES,
      };
  return {
    state: nextState,
    authoritativeSpan: emptyAuthoritativeSpan(),
    predictionSurface: CLEAR_PREDICTION_SURFACE,
  };
}
