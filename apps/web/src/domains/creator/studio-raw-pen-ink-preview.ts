import {
  clearStudioPredictedInkTail,
  endStudioPredictedInkTail,
  replaceStudioPredictedInkTail,
  type StudioPredictedInkSample,
  type StudioPredictedInkSurfaceUpdate,
  type StudioPredictedInkTailState,
  type StudioPredictedInkTailTransition,
} from "./studio-predicted-ink-tail";

/**
 * Fixed-size snapshot of every gate that must remain true while a raw pen preview is armed.
 *
 * This deliberately contains no DrawEl and no point prefix. The Page reduces its live refs to
 * these scalar facts once per raw delivery, keeping both eligibility and lifecycle work O(1).
 */
export interface StudioRawPenInkPreviewEligibility {
  readonly enabled: boolean;
  readonly pointerType: string;
  readonly tool: string;
  readonly strokeMode: string;
  readonly strokeKind: string;
  readonly directCanvas2d: boolean;
  readonly opacity: number;
  readonly fillActive: boolean;
  readonly symmetryType: string;
  readonly gpuActive: boolean;
  readonly stampActive: boolean;
  readonly stabilizerActive: boolean;
  readonly postCorrectionActive: boolean;
  readonly rulerActive: boolean;
  readonly shiftActive: boolean;
}

export interface StudioRawPenInkPreviewIdentity {
  readonly pointerId: number;
  readonly generation: number;
}

/** A single mapped document-space hardware sample, never an authoritative stroke prefix. */
export interface StudioRawPenInkPreviewPoint {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

export interface StudioRawPenInkPreviewState extends StudioRawPenInkPreviewIdentity {
  /**
   * Compact authority metadata plus the disposable prediction suffix. The authoritative pixel
   * surface is owned elsewhere; this module can only issue prediction-surface commands.
   */
  readonly tail: StudioPredictedInkTailState;
}

export interface StudioRawPenInkPreviewTransition {
  readonly state: StudioRawPenInkPreviewState;
  /** Raw preview transitions are structurally unable to append, clear, or replace durable ink. */
  readonly authoritativeSurface: { readonly kind: "keep" };
  /** Command for the independently clearable Canvas2D prediction surface. */
  readonly predictionSurface: StudioPredictedInkSurfaceUpdate;
}

export interface CreateStudioRawPenInkPreviewInput extends StudioRawPenInkPreviewIdentity {
  readonly eligibility: StudioRawPenInkPreviewEligibility;
  /** Canonical compact tail after the pointer-down sample became authoritative. */
  readonly authoritativeTail: StudioPredictedInkTailState;
}

export interface ReplaceStudioRawPenInkPreviewInput extends StudioRawPenInkPreviewIdentity {
  readonly eligibility: StudioRawPenInkPreviewEligibility;
  readonly point: StudioRawPenInkPreviewPoint;
}

export interface SyncStudioRawPenInkPreviewAuthorityInput
  extends StudioRawPenInkPreviewIdentity {
  /** Canonical tail returned by the real processed/coalesced pointer-move path. */
  readonly authoritativeTail: StudioPredictedInkTailState;
}

const KEEP_AUTHORITATIVE_SURFACE = Object.freeze({ kind: "keep" as const });
const KEEP_PREDICTION_SURFACE = Object.freeze({ kind: "keep" as const });

/**
 * Strict fail-closed feature gate. Any path that can transform, defer, composite, or persist the
 * raw point remains on the established authoritative pointer-move pipeline.
 */
export function isStudioRawPenInkPreviewEligible(
  input: StudioRawPenInkPreviewEligibility
): boolean {
  return input.enabled
    && input.pointerType === "pen"
    && input.tool === "draw"
    && input.strokeMode === "pen"
    && input.strokeKind === "freehand"
    && input.directCanvas2d
    && input.opacity === 1
    && !input.fillActive
    && input.symmetryType === "none"
    && !input.gpuActive
    && !input.stampActive
    && !input.stabilizerActive
    && !input.postCorrectionActive
    && !input.rulerActive
    && !input.shiftActive;
}

function validIdentity(identity: StudioRawPenInkPreviewIdentity): boolean {
  return Number.isSafeInteger(identity.pointerId)
    && identity.pointerId >= 0
    && Number.isSafeInteger(identity.generation)
    && identity.generation > 0;
}

function sameIdentity(
  state: StudioRawPenInkPreviewState,
  identity: StudioRawPenInkPreviewIdentity
): boolean {
  return validIdentity(identity)
    && identity.pointerId === state.pointerId
    && identity.generation === state.generation;
}

function sameSample(
  left: StudioPredictedInkSample | null,
  right: StudioPredictedInkSample | null
): boolean {
  return left === right || (
    left !== null
    && right !== null
    && left.x === right.x
    && left.y === right.y
    && left.pressure === right.pressure
  );
}

function validAuthoritativeTail(tail: StudioPredictedInkTailState): boolean {
  const endpoint = tail.authoritativeEndpoint;
  return tail.phase === "active"
    && Number.isSafeInteger(tail.authoritativeSampleCount)
    && tail.authoritativeSampleCount > 0
    && endpoint !== null
    && Number.isFinite(endpoint.x)
    && Number.isFinite(endpoint.y)
    && Number.isFinite(endpoint.pressure)
    && endpoint.pressure >= 0
    && endpoint.pressure <= 1;
}

function keepTransition(
  state: StudioRawPenInkPreviewState
): StudioRawPenInkPreviewTransition {
  return {
    state,
    authoritativeSurface: KEEP_AUTHORITATIVE_SURFACE,
    predictionSurface: KEEP_PREDICTION_SURFACE,
  };
}

function previewTransition(
  state: StudioRawPenInkPreviewState,
  tailTransition: StudioPredictedInkTailTransition
): StudioRawPenInkPreviewTransition {
  const previousTail = state.tail;
  const nextTail = tailTransition.state;
  const authorityWasPreserved = tailTransition.authoritativeSpan.samples.length === 0
    && nextTail.authoritativeSampleCount === previousTail.authoritativeSampleCount
    && sameSample(nextTail.authoritativeEndpoint, previousTail.authoritativeEndpoint);

  // Fail closed if the reused tail primitive ever changes its raw-preview authority contract.
  if (!authorityWasPreserved) return keepTransition(state);

  return {
    state: nextTail === previousTail ? state : { ...state, tail: nextTail },
    authoritativeSurface: KEEP_AUTHORITATIVE_SURFACE,
    predictionSurface: tailTransition.predictionSurface,
  };
}

/**
 * Arms a new raw-preview generation. An anchorless/malformed tail is rejected because a transient
 * point may never bootstrap durable geometry. A new pointer-down must provide a fresh generation.
 */
export function createStudioRawPenInkPreviewState(
  input: CreateStudioRawPenInkPreviewInput
): StudioRawPenInkPreviewState | null {
  if (
    !validIdentity(input)
    || !isStudioRawPenInkPreviewEligible(input.eligibility)
    || !validAuthoritativeTail(input.authoritativeTail)
    || input.authoritativeTail.predictedSamples.length > 0
  ) return null;

  return {
    pointerId: input.pointerId,
    generation: input.generation,
    tail: input.authoritativeTail,
  };
}

/**
 * Mirrors authority metadata only from the canonical processed-pointer path. This does not paint
 * authority; it clears the now-stale raw tail and advances the anchor in constant time.
 */
export function syncStudioRawPenInkPreviewAuthority(
  state: StudioRawPenInkPreviewState,
  input: SyncStudioRawPenInkPreviewAuthorityInput
): StudioRawPenInkPreviewTransition {
  if (
    state.tail.phase !== "active"
    || !sameIdentity(state, input)
    || !validAuthoritativeTail(input.authoritativeTail)
    || input.authoritativeTail.authoritativeSampleCount < state.tail.authoritativeSampleCount
    || (
      input.authoritativeTail.authoritativeSampleCount === state.tail.authoritativeSampleCount
      && !sameSample(
        input.authoritativeTail.authoritativeEndpoint,
        state.tail.authoritativeEndpoint
      )
    )
  ) return keepTransition(state);

  const cleared = clearStudioPredictedInkTail(input.authoritativeTail);
  return {
    state: { ...state, tail: cleared.state },
    authoritativeSurface: KEEP_AUTHORITATIVE_SURFACE,
    predictionSurface: cleared.predictionSurface,
  };
}

/**
 * Projects exactly one latest raw hardware point onto the replaceable tail. A second raw point
 * replaces the first complete tail; it can never append to the authoritative surface or history.
 */
export function replaceStudioRawPenInkPreview(
  state: StudioRawPenInkPreviewState,
  input: ReplaceStudioRawPenInkPreviewInput
): StudioRawPenInkPreviewTransition {
  if (state.tail.phase !== "active" || !sameIdentity(state, input)) {
    return keepTransition(state);
  }
  if (!isStudioRawPenInkPreviewEligible(input.eligibility)) {
    return previewTransition(state, clearStudioPredictedInkTail(state.tail));
  }

  return previewTransition(state, replaceStudioPredictedInkTail(state.tail, {
    points: [input.point.x, input.point.y],
    pressures: [input.point.pressure],
  }));
}

/** Seals this pointer/generation and makes every later raw delivery an identity-preserving no-op. */
export function endStudioRawPenInkPreview(
  state: StudioRawPenInkPreviewState,
  identity: StudioRawPenInkPreviewIdentity
): StudioRawPenInkPreviewTransition {
  if (!sameIdentity(state, identity)) return keepTransition(state);
  return previewTransition(state, endStudioPredictedInkTail(state.tail));
}
