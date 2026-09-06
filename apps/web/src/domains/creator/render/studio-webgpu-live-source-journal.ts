import {
  isStudioBrushEraserAliasId,
  isStudioBrushAliasId,
  mapStudioBrushAliasPressure,
  studioBrushAliasEffectiveDiameter,
} from "../brush/studio-brush-alias-profile";
import {
  STUDIO_BRUSH_MAX_SYMMETRY_VARIATIONS,
  type StudioBrushSymmetryTransform,
} from "../brush/studio-brush-symmetry";
import {
  isStudioInkPressureModel,
  resolveStudioInkPressure,
  studioInkFallbackPressure,
  studioInkUsesPathResidualDabSpacing,
} from "../brush/studio-ink-pressure-model";

import { isStudioGpuColorSupported } from "./studio-webgpu-color";
import { STUDIO_GPU_MAX_BRUSH_SIZE } from "./studio-webgpu-stroke";

import type { StudioGpuComposite } from "./studio-webgpu-stroke";
import type { StudioBrushAliasId } from "../brush/studio-brush-alias-profile";
import type { StudioInkPressureModel } from "../brush/studio-ink-pressure-model";

/** The live planner already caps kaleidoscope expansion at 32 rotations plus 32 reflections. */
export const STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATIONS =
  STUDIO_BRUSH_MAX_SYMMETRY_VARIATIONS;
/** Prevents an untrusted array length from turning one pointer delivery into an unbounded loop. */
export const STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_SOURCE_POINTS = 1_000_000;
/** A browser delivery may skip frames, but one call may not monopolize the main thread. */
export const STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_ADVANCE_SOURCE_POINTS = 100_000;
/** Caps the whole epoch's transformed point slots across all symmetry copies. */
export const STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATION_POINTS = 1_000_000;

const MAX_IDENTITY_TEXT_LENGTH = 1_024;

export type StudioGpuLiveSourceJournalMode = "pen" | "eraser";

export interface StudioGpuLiveSourceJournalVariation {
  /** Stable operation identity, normally the GPU stroke id for this symmetry copy. */
  readonly id: string;
  readonly transform: StudioBrushSymmetryTransform;
}

/**
 * Immutable paint identity for one append-only pointer epoch.
 *
 * `styleKey` is an opaque caller revision for paint semantics outside the fields understood by
 * this leaf (for example a future tip/material revision). Every listed field is still compared
 * directly, so reusing a style key can never hide a changed GPU operation.
 */
export interface StudioGpuLiveSourceJournalIdentity {
  readonly epoch: number;
  readonly strokeId: string;
  readonly styleKey: string;
  readonly pressureModel?: StudioInkPressureModel;
  readonly brushAlias: StudioBrushAliasId | null;
  readonly mode: StudioGpuLiveSourceJournalMode;
  /** Toolbar diameter before the named-brush visual scale is applied. */
  readonly selectedDiameter: number;
  readonly color: string;
  readonly opacity: number;
  readonly composite: StudioGpuComposite;
  readonly orderKey?: string;
  readonly sampleSpacing: number;
  readonly variations: readonly StudioGpuLiveSourceJournalVariation[];
}

export interface StudioGpuLiveSourceJournalSample {
  readonly x: number;
  readonly y: number;
  /** Pressure after the versioned document pressure model, before named-brush response. */
  readonly sourcePressure: number;
  /** Pressure supplied to the live GPU operation after named-brush response. */
  readonly renderPressure: number;
  readonly sourceIndex: number;
}

/**
 * Bounded state: no source history, transformed history, or recovery stroke arrays are retained.
 * A caller replacing any historical sample must start a new epoch instead of advancing this one.
 */
export interface StudioGpuLiveSourceJournalState {
  readonly identity: StudioGpuLiveSourceJournalIdentity;
  readonly effectiveDiameter: number;
  readonly revision: number;
  readonly sourcePointCount: number;
  /** Number of dense pressure slots observed. Missing tail slots have already used fallback. */
  readonly pressurePointCount: number;
  readonly renderedPointCount: number;
  readonly lastSourceSample: StudioGpuLiveSourceJournalSample | null;
  readonly lastRenderedSample: StudioGpuLiveSourceJournalSample | null;
  readonly sealed: boolean;
}

export interface StudioGpuLiveSourceJournalAdvanceInput {
  /** Repeated so an epoch/style mutation fails before any source array index is touched. */
  readonly identity: StudioGpuLiveSourceJournalIdentity;
  /** Full append-only source view. Only indices at or after `state.sourcePointCount` are read. */
  readonly points: readonly number[];
  /** Full append-only pressure view. Only newly appended source indices are read. */
  readonly pressures?: readonly number[];
  /** Promotes the stored final source point without re-reading its historical array slot. */
  readonly sealEndpoint?: boolean;
}

export interface StudioGpuLiveSourceJournalVariationSuffix {
  readonly id: string;
  readonly previousRenderedPointCount: number;
  readonly nextRenderedPointCount: number;
  readonly points: readonly number[];
  /** Shared immutable pressure suffix; symmetry changes coordinates, never pressure order. */
  readonly pressures: readonly number[];
}

interface StudioGpuLiveSourceJournalAcceptedAdvance {
  readonly status: "advanced" | "retained";
  readonly state: StudioGpuLiveSourceJournalState;
  readonly sourcePointCountDelta: number;
  readonly renderedPointCountDelta: number;
  /** Base, source-index-preserving accepted suffix. Never contains retained history. */
  readonly samples: readonly StudioGpuLiveSourceJournalSample[];
  /** One transformed suffix per pinned variation when geometry advanced; otherwise empty. */
  readonly suffixes: readonly StudioGpuLiveSourceJournalVariationSuffix[];
}

export type StudioGpuLiveSourceJournalRejectionReason =
  | "invalid-state"
  | "stale-epoch"
  | "style-changed"
  | "sealed"
  | "source-count-regression"
  | "pressure-count-regression"
  | "pressure-prefix-growth"
  | "invalid-coordinate-layout"
  | "invalid-pressure-layout"
  | "invalid-coordinate"
  | "invalid-pressure"
  | "invalid-seal"
  | "source-advance-budget"
  | "variation-budget"
  | "invalid-variation-output"
  | "input-access";

interface StudioGpuLiveSourceJournalRejectedAdvance {
  readonly status: "rejected";
  readonly reason: StudioGpuLiveSourceJournalRejectionReason;
  /** Exact prior object: rejection never advances or partially mutates the journal. */
  readonly state: StudioGpuLiveSourceJournalState;
  readonly sourcePointCountDelta: 0;
  readonly renderedPointCountDelta: 0;
  readonly samples: readonly [];
  readonly suffixes: readonly [];
}

export type StudioGpuLiveSourceJournalAdvance =
  | StudioGpuLiveSourceJournalAcceptedAdvance
  | StudioGpuLiveSourceJournalRejectedAdvance;

const EMPTY_SAMPLES = Object.freeze([]) as readonly [];
const EMPTY_SUFFIXES = Object.freeze([]) as readonly [];
const trustedStudioGpuLiveSourceJournalStates = new WeakSet<object>();

function boundedIdentityText(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string"
    && value.length <= MAX_IDENTITY_TEXT_LENGTH
    && (allowEmpty || value.length > 0);
}

function finiteGpuScalar(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
}

function validTransform(transform: StudioBrushSymmetryTransform): boolean {
  return [
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e,
    transform.f,
  ].every(finiteGpuScalar);
}

function validIdentity(identity: StudioGpuLiveSourceJournalIdentity): boolean {
  if (
    !Number.isSafeInteger(identity.epoch)
    || identity.epoch < 0
    || !boundedIdentityText(identity.strokeId)
    || !boundedIdentityText(identity.styleKey)
    || (identity.pressureModel !== undefined
      && !isStudioInkPressureModel(identity.pressureModel))
    || (identity.brushAlias !== null && !isStudioBrushAliasId(identity.brushAlias))
    || (identity.mode !== "pen" && identity.mode !== "eraser")
    || !Number.isFinite(identity.selectedDiameter)
    || identity.selectedDiameter <= 0
    || identity.selectedDiameter > STUDIO_GPU_MAX_BRUSH_SIZE
    || !isStudioGpuColorSupported(identity.color)
    || !Number.isFinite(identity.opacity)
    || identity.opacity < 0
    || identity.opacity > 1
    || (identity.composite !== "normal" && identity.composite !== "erase")
    || (identity.mode === "eraser") !== (identity.composite === "erase")
    || (identity.orderKey !== undefined && !boundedIdentityText(identity.orderKey, true))
    || !Number.isFinite(identity.sampleSpacing)
    || identity.sampleSpacing < 0
    || !Array.isArray(identity.variations)
    || identity.variations.length < 1
    || identity.variations.length > STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATIONS
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const variation of identity.variations) {
    if (
      !variation
      || !boundedIdentityText(variation.id)
      || ids.has(variation.id)
      || !variation.transform
      || !validTransform(variation.transform)
    ) {
      return false;
    }
    ids.add(variation.id);
  }
  return true;
}

function snapshotIdentity(
  identity: StudioGpuLiveSourceJournalIdentity
): StudioGpuLiveSourceJournalIdentity {
  const variations = identity.variations.map((variation) => Object.freeze({
    id: variation.id,
    transform: Object.freeze({
      a: variation.transform.a,
      b: variation.transform.b,
      c: variation.transform.c,
      d: variation.transform.d,
      e: variation.transform.e,
      f: variation.transform.f,
    }),
  }));
  return Object.freeze({
    epoch: identity.epoch,
    strokeId: identity.strokeId,
    styleKey: identity.styleKey,
    ...(identity.pressureModel === undefined ? {} : { pressureModel: identity.pressureModel }),
    brushAlias: identity.brushAlias,
    mode: identity.mode,
    selectedDiameter: identity.selectedDiameter,
    color: identity.color,
    opacity: identity.opacity,
    composite: identity.composite,
    ...(identity.orderKey === undefined ? {} : { orderKey: identity.orderKey }),
    sampleSpacing: identity.sampleSpacing,
    variations: Object.freeze(variations),
  });
}

function sameTransform(
  left: StudioBrushSymmetryTransform,
  right: StudioBrushSymmetryTransform
): boolean {
  return Object.is(left.a, right.a)
    && Object.is(left.b, right.b)
    && Object.is(left.c, right.c)
    && Object.is(left.d, right.d)
    && Object.is(left.e, right.e)
    && Object.is(left.f, right.f);
}

/** Exact identity comparison used before reading a source-array suffix. */
export function sameStudioGpuLiveSourceJournalIdentity(
  left: StudioGpuLiveSourceJournalIdentity,
  right: StudioGpuLiveSourceJournalIdentity
): boolean {
  try {
    return left.epoch === right.epoch
      && left.strokeId === right.strokeId
      && left.styleKey === right.styleKey
      && left.pressureModel === right.pressureModel
      && left.brushAlias === right.brushAlias
      && left.mode === right.mode
      && Object.is(left.selectedDiameter, right.selectedDiameter)
      && left.color === right.color
      && Object.is(left.opacity, right.opacity)
      && left.composite === right.composite
      && left.orderKey === right.orderKey
      && Object.is(left.sampleSpacing, right.sampleSpacing)
      && left.variations.length === right.variations.length
      && left.variations.every((variation, index) => {
        const other = right.variations[index];
        return !!other
          && variation.id === other.id
          && sameTransform(variation.transform, other.transform);
      });
  } catch {
    return false;
  }
}

function effectiveDiameter(identity: StudioGpuLiveSourceJournalIdentity): number {
  const selectedDiameter = Math.max(1, identity.selectedDiameter);
  return identity.mode === "eraser" && !isStudioBrushEraserAliasId(identity.brushAlias)
    ? selectedDiameter
    : studioBrushAliasEffectiveDiameter(identity.brushAlias, selectedDiameter);
}

/** Creates an empty, immutable append epoch. No source array is inspected at this boundary. */
export function createStudioGpuLiveSourceJournal(
  identity: StudioGpuLiveSourceJournalIdentity
): StudioGpuLiveSourceJournalState | null {
  try {
    if (!validIdentity(identity)) return null;
    const pinnedIdentity = snapshotIdentity(identity);
    const state = Object.freeze({
      identity: pinnedIdentity,
      effectiveDiameter: effectiveDiameter(pinnedIdentity),
      revision: 0,
      sourcePointCount: 0,
      pressurePointCount: 0,
      renderedPointCount: 0,
      lastSourceSample: null,
      lastRenderedSample: null,
      sealed: false,
    });
    trustedStudioGpuLiveSourceJournalStates.add(state);
    return state;
  } catch {
    return null;
  }
}

function rejected(
  state: StudioGpuLiveSourceJournalState,
  reason: StudioGpuLiveSourceJournalRejectionReason
): StudioGpuLiveSourceJournalRejectedAdvance {
  return Object.freeze({
    status: "rejected",
    reason,
    state,
    sourcePointCountDelta: 0,
    renderedPointCountDelta: 0,
    samples: EMPTY_SAMPLES,
    suffixes: EMPTY_SUFFIXES,
  });
}

function freezeSample(
  sample: StudioGpuLiveSourceJournalSample
): StudioGpuLiveSourceJournalSample {
  return Object.freeze(sample);
}

function shouldRetainSample(
  previous: StudioGpuLiveSourceJournalSample,
  candidate: StudioGpuLiveSourceJournalSample,
  identity: StudioGpuLiveSourceJournalIdentity
): boolean {
  const samePoint = candidate.x === previous.x && candidate.y === previous.y;
  if (
    samePoint
    && studioInkUsesPathResidualDabSpacing(identity.pressureModel)
    && !Object.is(candidate.sourcePressure, previous.sourcePressure)
  ) {
    return true;
  }
  const distance = Math.hypot(candidate.x - previous.x, candidate.y - previous.y);
  return Number.isFinite(distance)
    && distance > 0
    && distance >= identity.sampleSpacing;
}

function transformAcceptedSuffix(
  state: StudioGpuLiveSourceJournalState,
  samples: readonly StudioGpuLiveSourceJournalSample[]
): readonly StudioGpuLiveSourceJournalVariationSuffix[] | null {
  if (samples.length === 0) return EMPTY_SUFFIXES;
  const basePoints = new Array<number>(samples.length * 2);
  const pressures = new Array<number>(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    basePoints[index * 2] = sample.x;
    basePoints[index * 2 + 1] = sample.y;
    pressures[index] = sample.renderPressure;
  }
  Object.freeze(basePoints);
  Object.freeze(pressures);

  const previousRenderedPointCount = state.renderedPointCount;
  const nextRenderedPointCount = previousRenderedPointCount + samples.length;
  const suffixes: StudioGpuLiveSourceJournalVariationSuffix[] = [];
  for (const variation of state.identity.variations) {
    const { transform } = variation;
    const identityTransform = transform.a === 1
      && transform.b === 0
      && transform.c === 0
      && transform.d === 1
      && transform.e === 0
      && transform.f === 0;
    let points: readonly number[] = basePoints;
    if (!identityTransform) {
      const transformed = new Array<number>(basePoints.length);
      for (let index = 0; index < basePoints.length; index += 2) {
        const x = basePoints[index]!;
        const y = basePoints[index + 1]!;
        const nextX = transform.a * x + transform.c * y + transform.e;
        const nextY = transform.b * x + transform.d * y + transform.f;
        if (!finiteGpuScalar(nextX) || !finiteGpuScalar(nextY)) return null;
        transformed[index] = nextX;
        transformed[index + 1] = nextY;
      }
      points = Object.freeze(transformed);
    }
    suffixes.push(Object.freeze({
      id: variation.id,
      previousRenderedPointCount,
      nextRenderedPointCount,
      points,
      pressures,
    }));
  }
  return Object.freeze(suffixes);
}

/**
 * Advances from a full append-only view while touching only newly appended source slots.
 *
 * Historical array contents are deliberately trusted under the pinned epoch. Replacing them must
 * rotate `identity.epoch`; this is what lets a Proxy make every old numeric property unreadable
 * while a valid advance still succeeds. Explicit non-finite pressure values fail closed, whereas
 * an absent pressure slot keeps the current versioned fallback semantics.
 */
function advanceStudioGpuLiveSourceJournalUnchecked(
  state: StudioGpuLiveSourceJournalState,
  input: StudioGpuLiveSourceJournalAdvanceInput
): StudioGpuLiveSourceJournalAdvance {
  if (input.sealEndpoint !== undefined && typeof input.sealEndpoint !== "boolean") {
    return rejected(state, "invalid-seal");
  }
  if (input.identity.epoch !== state.identity.epoch) {
    return rejected(state, "stale-epoch");
  }
  if (
    !validIdentity(input.identity)
    || !sameStudioGpuLiveSourceJournalIdentity(state.identity, input.identity)
  ) {
    return rejected(state, "style-changed");
  }
  if (!Array.isArray(input.points) || input.points.length % 2 !== 0) {
    return rejected(state, "invalid-coordinate-layout");
  }
  const sourcePointCount = input.points.length / 2;
  if (
    !Number.isSafeInteger(sourcePointCount)
    || sourcePointCount > STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_SOURCE_POINTS
  ) {
    return rejected(state, "invalid-coordinate-layout");
  }
  if (sourcePointCount < state.sourcePointCount) {
    return rejected(state, "source-count-regression");
  }
  if (
    sourcePointCount - state.sourcePointCount
    > STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_ADVANCE_SOURCE_POINTS
  ) {
    return rejected(state, "source-advance-budget");
  }
  if (input.pressures !== undefined && !Array.isArray(input.pressures)) {
    return rejected(state, "invalid-pressure-layout");
  }
  const pressurePointCount = input.pressures?.length ?? 0;
  if (pressurePointCount > sourcePointCount) {
    return rejected(state, "invalid-pressure-layout");
  }
  if (pressurePointCount < state.pressurePointCount) {
    return rejected(state, "pressure-count-regression");
  }
  // A pressure slot omitted in a prior revision has already painted with fallback pressure. A
  // later dense-array growth across that old hole would rewrite history, so a new epoch is needed.
  if (
    state.pressurePointCount < state.sourcePointCount
    && pressurePointCount > state.pressurePointCount
  ) {
    return rejected(state, "pressure-prefix-growth");
  }
  if (state.sealed && sourcePointCount > state.sourcePointCount) {
    return rejected(state, "sealed");
  }

  let lastSourceSample = state.lastSourceSample;
  let lastRenderedSample = state.lastRenderedSample;
  const accepted: StudioGpuLiveSourceJournalSample[] = [];
  for (let sourceIndex = state.sourcePointCount; sourceIndex < sourcePointCount; sourceIndex += 1) {
    const x = input.points[sourceIndex * 2];
    const y = input.points[sourceIndex * 2 + 1];
    if (
      typeof x !== "number"
      || typeof y !== "number"
      || !finiteGpuScalar(x)
      || !finiteGpuScalar(y)
    ) {
      return rejected(state, "invalid-coordinate");
    }
    const rawPressure = sourceIndex < pressurePointCount
      ? input.pressures![sourceIndex]
      : undefined;
    if (
      rawPressure !== undefined
      && (typeof rawPressure !== "number" || !Number.isFinite(rawPressure))
    ) {
      return rejected(state, "invalid-pressure");
    }
    const sourcePressure = resolveStudioInkPressure(
      rawPressure,
      state.identity.pressureModel
    );
    const renderPressure = mapStudioBrushAliasPressure(
      state.identity.mode === "eraser"
        && !isStudioBrushEraserAliasId(state.identity.brushAlias)
        ? null
        : state.identity.brushAlias,
      sourcePressure,
      studioInkFallbackPressure(state.identity.pressureModel)
    );
    const candidate = freezeSample({
      x,
      y,
      sourcePressure,
      renderPressure,
      sourceIndex,
    });
    lastSourceSample = candidate;
    if (!lastRenderedSample || shouldRetainSample(
      lastRenderedSample,
      candidate,
      state.identity
    )) {
      accepted.push(candidate);
      lastRenderedSample = candidate;
    }
  }

  if (
    input.sealEndpoint
    && lastSourceSample
    && (!lastRenderedSample
      || lastSourceSample.x !== lastRenderedSample.x
      || lastSourceSample.y !== lastRenderedSample.y)
  ) {
    accepted.push(lastSourceSample);
    lastRenderedSample = lastSourceSample;
  }

  const variationCount = state.identity.variations.length;
  const nextRenderedPointCount = state.renderedPointCount + accepted.length;
  if (
    !Number.isSafeInteger(nextRenderedPointCount)
    || nextRenderedPointCount
      > Math.floor(STUDIO_GPU_LIVE_SOURCE_JOURNAL_MAX_VARIATION_POINTS / variationCount)
  ) {
    return rejected(state, "variation-budget");
  }
  const frozenAccepted = Object.freeze(accepted);
  const suffixes = transformAcceptedSuffix(state, frozenAccepted);
  if (!suffixes) return rejected(state, "invalid-variation-output");

  const nextSealed = state.sealed || input.sealEndpoint === true;
  const changed = sourcePointCount !== state.sourcePointCount
    || pressurePointCount !== state.pressurePointCount
    || accepted.length > 0
    || nextSealed !== state.sealed;
  const nextState = changed
    ? Object.freeze({
        ...state,
        revision: state.revision + 1,
        sourcePointCount,
        pressurePointCount,
        renderedPointCount: nextRenderedPointCount,
        lastSourceSample,
        lastRenderedSample,
        sealed: nextSealed,
      })
    : state;
  if (changed) trustedStudioGpuLiveSourceJournalStates.add(nextState);
  return Object.freeze({
    status: accepted.length > 0 ? "advanced" : "retained",
    state: nextState,
    sourcePointCountDelta: sourcePointCount - state.sourcePointCount,
    renderedPointCountDelta: accepted.length,
    samples: frozenAccepted,
    suffixes,
  });
}

export function advanceStudioGpuLiveSourceJournal(
  state: StudioGpuLiveSourceJournalState,
  input: StudioGpuLiveSourceJournalAdvanceInput
): StudioGpuLiveSourceJournalAdvance {
  if (
    typeof state !== "object"
    || state === null
    || !trustedStudioGpuLiveSourceJournalStates.has(state)
  ) {
    return rejected(state, "invalid-state");
  }
  try {
    return advanceStudioGpuLiveSourceJournalUnchecked(state, input);
  } catch {
    return rejected(state, "input-access");
  }
}
