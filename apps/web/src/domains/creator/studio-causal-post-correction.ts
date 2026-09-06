import {
  STABILIZER_MAX,
  smoothStrokePoints,
  type SmoothStrokeOptions,
} from "./studio-brush";

/**
 * Fixed-lag post-correction for a retained, two-surface live preview.
 *
 * Corrected samples cross a one-way boundary:
 *
 *   raw input -> replaceable tail (8..16 samples) -> append-only settled head
 *
 * A renderer can therefore keep the settled head on a retained surface and redraw only the
 * bounded tail. The persistent linked histories below also keep pointer-move planning bounded;
 * an ordinary one-sample append smooths only the tail plus its dependency context instead of
 * copying or correcting the complete stroke.
 */

export const STUDIO_POST_CORRECTION_MIN_TAIL_SAMPLES = 8;
export const STUDIO_POST_CORRECTION_MAX_TAIL_SAMPLES = 16;

/**
 * Interaction policy: post-correction is a release-time document transform.
 *
 * A replaceable live tail makes already-visible pixels crawl under the pen and contradicts the
 * "after release" control label. Keep the causal tail engine for deterministic offline/release
 * planning, but never expose its replace surface while pointer contact is active.
 */
export function studioPostCorrectionRunsDuringPointerContact(): boolean {
  return false;
}

const EMPTY_POINTS: readonly number[] = Object.freeze([]);
const KEEP_TAIL_SURFACE: StudioPostCorrectionTailSurfaceUpdate = Object.freeze({ kind: "keep" });
const CLEAR_TAIL_SURFACE: StudioPostCorrectionTailSurfaceUpdate = Object.freeze({ kind: "clear" });

export interface StudioPostCorrectionPoint {
  readonly x: number;
  readonly y: number;
}

/** Persistent implementation detail exposed read-only so state remains serializable and pure. */
export interface StudioPostCorrectionPointHistory {
  readonly previous: StudioPostCorrectionPointHistory | null;
  readonly startSampleIndex: number;
  readonly sampleCount: number;
  readonly points: readonly number[];
}

export interface StudioCausalPostCorrectionOptions extends SmoothStrokeOptions {
  readonly strength: number;
  /** Optional latency budget. Values are clamped to 8..16 and raised to the exact safe lag. */
  readonly tailSampleCount?: number;
}

export interface StudioCausalPostCorrectionState {
  readonly phase: "active" | "sealed";
  readonly strength: number;
  readonly preserveCorners: boolean;
  readonly cornerThresholdDeg: number | undefined;
  /** Exact dependency-safe lag after normalization, always in the inclusive 8..16 range. */
  readonly tailSampleCount: number;
  readonly sourceSampleCount: number;
  readonly settledSampleCount: number;
  readonly sourceHistory: StudioPostCorrectionPointHistory | null;
  readonly settledHistory: StudioPostCorrectionPointHistory | null;
  readonly settledEndpoint: StudioPostCorrectionPoint | null;
  /** Corrected points on the independently clearable transient surface. */
  readonly tailPoints: readonly number[];
  /** Materialized once at seal time; null throughout the pointer hot path. */
  readonly finalPoints: readonly number[] | null;
}

/** New immutable geometry to append to the retained head surface. */
export interface StudioPostCorrectionSettledSpan {
  /** Existing settled endpoint used only to connect the new span. */
  readonly anchor: StudioPostCorrectionPoint | null;
  /** Original sample index of the first point, useful for pressure-array alignment. */
  readonly startSampleIndex: number;
  readonly points: readonly number[];
}

export type StudioPostCorrectionTailSurfaceUpdate =
  | { readonly kind: "keep" }
  | { readonly kind: "clear" }
  | {
      readonly kind: "replace";
      /** New settled endpoint; null while the complete short stroke still lives in the tail. */
      readonly anchor: StudioPostCorrectionPoint | null;
      readonly startSampleIndex: number;
      /** Complete corrected tail replacement, never an append. */
      readonly points: readonly number[];
    };

export interface StudioCausalPostCorrectionTransition {
  readonly state: StudioCausalPostCorrectionState;
  readonly settledSpan: StudioPostCorrectionSettledSpan;
  readonly tailSurface: StudioPostCorrectionTailSurfaceUpdate;
  /** Non-null only when sealing; safe to hand directly to the committed stroke. */
  readonly finalPoints: readonly number[] | null;
}

function finiteStrength(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(STABILIZER_MAX, Math.max(0, value));
}

function roundedStrength(value: number): number {
  return Math.round(finiteStrength(value));
}

/**
 * Future samples required before one corrected sample is immutable.
 *
 * Two smoothing passes have a `passes * radius` dependency. Corner preservation additionally
 * classifies every first-pass neighbor from a `2 * radius` neighborhood, making the worst case
 * `radius + 2 * radius` (12 samples at strength 10). This mirrors `smoothStrokePoints` exactly.
 */
export function studioPostCorrectionDependencySamples(
  strength: number,
  preserveCorners = false
): number {
  const normalized = roundedStrength(strength);
  if (normalized === 0) return 0;
  const radius = Math.max(1, Math.ceil(normalized / 3));
  const passes = normalized >= 6 ? 2 : 1;
  const smoothingDependency = radius * passes;
  if (!preserveCorners) return smoothingDependency;
  const cornerDependency = Math.max(2, radius * 2);
  return passes === 1
    ? Math.max(smoothingDependency, cornerDependency)
    : Math.max(smoothingDependency, radius + cornerDependency);
}

/** Returns an 8..16 sample latency budget that can never undercut the exact algorithmic lag. */
export function resolveStudioPostCorrectionTailSamples(
  options: StudioCausalPostCorrectionOptions
): number {
  const dependency = studioPostCorrectionDependencySamples(
    options.strength,
    options.preserveCorners === true
  );
  const requested = Number.isFinite(options.tailSampleCount)
    ? Math.round(options.tailSampleCount!)
    : STUDIO_POST_CORRECTION_MIN_TAIL_SAMPLES;
  return Math.max(
    dependency,
    Math.min(
      STUDIO_POST_CORRECTION_MAX_TAIL_SAMPLES,
      Math.max(STUDIO_POST_CORRECTION_MIN_TAIL_SAMPLES, requested)
    )
  );
}

function emptySettledSpan(startSampleIndex: number): StudioPostCorrectionSettledSpan {
  return { anchor: null, startSampleIndex, points: EMPTY_POINTS };
}

function keepTransition(
  state: StudioCausalPostCorrectionState
): StudioCausalPostCorrectionTransition {
  return {
    state,
    settledSpan: emptySettledSpan(state.settledSampleCount),
    tailSurface: KEEP_TAIL_SURFACE,
    finalPoints: state.phase === "sealed" ? state.finalPoints : null,
  };
}

function sanitizeFinitePrefix(points: readonly number[]): readonly number[] {
  const sanitized: number[] = [];
  const pairLength = points.length - (points.length % 2);
  for (let index = 0; index < pairLength; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    sanitized.push(x!, y!);
  }
  return sanitized.length > 0 ? Object.freeze(sanitized) : EMPTY_POINTS;
}

function appendHistory(
  previous: StudioPostCorrectionPointHistory | null,
  startSampleIndex: number,
  points: readonly number[]
): StudioPostCorrectionPointHistory | null {
  if (points.length === 0) return previous;
  return Object.freeze({
    previous,
    startSampleIndex,
    sampleCount: points.length / 2,
    points,
  });
}

function historyRange(
  history: StudioPostCorrectionPointHistory | null,
  startSampleIndex: number,
  endSampleIndex: number
): number[] {
  if (!history || startSampleIndex >= endSampleIndex) return [];
  const relevant: StudioPostCorrectionPointHistory[] = [];
  let node: StudioPostCorrectionPointHistory | null = history;
  while (node) {
    if (node.startSampleIndex < endSampleIndex) relevant.push(node);
    if (node.startSampleIndex <= startSampleIndex) break;
    node = node.previous;
  }
  relevant.reverse();

  const result: number[] = [];
  for (const chunk of relevant) {
    const chunkEnd = chunk.startSampleIndex + chunk.sampleCount;
    const overlapStart = Math.max(startSampleIndex, chunk.startSampleIndex);
    const overlapEnd = Math.min(endSampleIndex, chunkEnd);
    if (overlapStart >= overlapEnd) continue;
    const localStart = (overlapStart - chunk.startSampleIndex) * 2;
    const localEnd = (overlapEnd - chunk.startSampleIndex) * 2;
    for (let index = localStart; index < localEnd; index += 1) {
      result.push(chunk.points[index]!);
    }
  }
  return result;
}

function endpoint(points: readonly number[]): StudioPostCorrectionPoint | null {
  if (points.length < 2) return null;
  return { x: points[points.length - 2]!, y: points[points.length - 1]! };
}

function correctedRange(
  state: StudioCausalPostCorrectionState,
  sourceHistory: StudioPostCorrectionPointHistory,
  sourceSampleCount: number,
  startSampleIndex: number
): readonly number[] {
  const dependency = studioPostCorrectionDependencySamples(
    state.strength,
    state.preserveCorners
  );
  const windowStart = Math.max(0, startSampleIndex - dependency);
  const sourceWindow = historyRange(sourceHistory, windowStart, sourceSampleCount);
  const correctedWindow = smoothStrokePoints(sourceWindow, state.strength, {
    preserveCorners: state.preserveCorners,
    cornerThresholdDeg: state.cornerThresholdDeg,
  });
  const localStart = (startSampleIndex - windowStart) * 2;
  return Object.freeze(correctedWindow.slice(localStart));
}

function materializeHistory(
  history: StudioPostCorrectionPointHistory | null,
  sampleCount: number
): readonly number[] {
  return Object.freeze(historyRange(history, 0, sampleCount));
}

export function createStudioCausalPostCorrectionState(
  options: StudioCausalPostCorrectionOptions
): StudioCausalPostCorrectionState {
  return {
    phase: "active",
    strength: roundedStrength(options.strength),
    preserveCorners: options.preserveCorners === true,
    cornerThresholdDeg: options.cornerThresholdDeg,
    tailSampleCount: resolveStudioPostCorrectionTailSamples(options),
    sourceSampleCount: 0,
    settledSampleCount: 0,
    sourceHistory: null,
    settledHistory: null,
    settledEndpoint: null,
    tailPoints: EMPTY_POINTS,
    finalPoints: null,
  };
}

/**
 * Advances a stroke with newly accepted source coordinate pairs.
 *
 * `settledSpan` is append-only. `tailSurface` is the sole replace operation and contains at most
 * `state.tailSampleCount` samples. Odd or non-finite suffixes stop at their longest valid prefix.
 */
export function appendStudioCausalPostCorrection(
  state: StudioCausalPostCorrectionState,
  sourcePointSuffix: readonly number[]
): StudioCausalPostCorrectionTransition {
  if (state.phase !== "active") return keepTransition(state);
  const suffix = sanitizeFinitePrefix(sourcePointSuffix);
  if (suffix.length === 0) return keepTransition(state);

  const previousSourceSampleCount = state.sourceSampleCount;
  const suffixSampleCount = suffix.length / 2;
  const sourceSampleCount = previousSourceSampleCount + suffixSampleCount;
  const sourceHistory = appendHistory(
    state.sourceHistory,
    previousSourceSampleCount,
    suffix
  )!;
  const nextSettledSampleCount = Math.max(0, sourceSampleCount - state.tailSampleCount);
  const correctedSuffix = correctedRange(
    state,
    sourceHistory,
    sourceSampleCount,
    state.settledSampleCount
  );
  const newlySettledSampleCount = nextSettledSampleCount - state.settledSampleCount;
  const settledPointLength = newlySettledSampleCount * 2;
  const settledPoints = Object.freeze(correctedSuffix.slice(0, settledPointLength));
  const tailPoints = Object.freeze(correctedSuffix.slice(settledPointLength));
  const settledHistory = appendHistory(
    state.settledHistory,
    state.settledSampleCount,
    settledPoints
  );
  const nextSettledEndpoint = endpoint(settledPoints) ?? state.settledEndpoint;
  const nextState: StudioCausalPostCorrectionState = {
    ...state,
    sourceSampleCount,
    settledSampleCount: nextSettledSampleCount,
    sourceHistory,
    settledHistory,
    settledEndpoint: nextSettledEndpoint,
    tailPoints,
  };

  return {
    state: nextState,
    settledSpan: {
      anchor: settledPoints.length > 0 ? state.settledEndpoint : null,
      startSampleIndex: state.settledSampleCount,
      points: settledPoints,
    },
    tailSurface: tailPoints.length > 0
      ? {
          kind: "replace",
          anchor: nextSettledEndpoint,
          startSampleIndex: nextSettledSampleCount,
          points: tailPoints,
        }
      : CLEAR_TAIL_SURFACE,
    finalPoints: null,
  };
}

/**
 * Promotes the last corrected tail exactly once and seals the lifecycle.
 *
 * No settled point is revisited. The dependency-safe lag guarantees that the materialized result
 * is byte-for-byte equal to a whole-stroke `smoothStrokePoints` pass for the same supported options.
 */
export function sealStudioCausalPostCorrection(
  state: StudioCausalPostCorrectionState
): StudioCausalPostCorrectionTransition {
  if (state.phase === "sealed") return keepTransition(state);
  if (!state.sourceHistory) {
    const finalPoints = EMPTY_POINTS;
    const sealedState: StudioCausalPostCorrectionState = {
      ...state,
      phase: "sealed",
      tailPoints: EMPTY_POINTS,
      finalPoints,
    };
    return {
      state: sealedState,
      settledSpan: emptySettledSpan(0),
      tailSurface: CLEAR_TAIL_SURFACE,
      finalPoints,
    };
  }

  const finalSuffix = correctedRange(
    state,
    state.sourceHistory,
    state.sourceSampleCount,
    state.settledSampleCount
  );
  const settledHistory = appendHistory(
    state.settledHistory,
    state.settledSampleCount,
    finalSuffix
  );
  const settledEndpoint = endpoint(finalSuffix) ?? state.settledEndpoint;
  const finalPoints = materializeHistory(settledHistory, state.sourceSampleCount);
  const sealedState: StudioCausalPostCorrectionState = {
    ...state,
    phase: "sealed",
    settledSampleCount: state.sourceSampleCount,
    settledHistory,
    settledEndpoint,
    tailPoints: EMPTY_POINTS,
    finalPoints,
  };
  return {
    state: sealedState,
    settledSpan: {
      anchor: finalSuffix.length > 0 ? state.settledEndpoint : null,
      startSampleIndex: state.settledSampleCount,
      points: finalSuffix,
    },
    tailSurface: CLEAR_TAIL_SURFACE,
    finalPoints,
  };
}

/** Diagnostics/serialization helper. Avoid this O(n) materialization in the pointer-move path. */
export function materializeStudioCausalPostCorrection(
  state: StudioCausalPostCorrectionState
): readonly number[] {
  if (state.finalPoints) return state.finalPoints;
  const settled = historyRange(state.settledHistory, 0, state.settledSampleCount);
  return Object.freeze([...settled, ...state.tailPoints]);
}
