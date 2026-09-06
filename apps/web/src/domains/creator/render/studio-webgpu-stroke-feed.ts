import { STUDIO_BRUSH_MAX_SYMMETRY_VARIATIONS } from "../brush/studio-brush-symmetry";
import {
  resolveStudioInkPressure,
  studioInkUsesResidualDabSpacing,
} from "../brush/studio-ink-pressure-model";
import {
  advanceStudioResidualInk,
  startStudioResidualInk,
  STUDIO_CAUSAL_INK_MAX_DABS,
  type StudioResidualInkState,
} from "../studio-causal-ink";

import {
  STUDIO_GPU_STROKE_FEED_REVISION,
  isTrustedStudioGpuStrokeFeedStroke,
  registerTrustedStudioGpuStrokeFeedStroke,
  sameStudioGpuStroke,
  studioGpuPressureRadius,
  type StudioGpuStroke,
  type StudioGpuStrokeFeedRevision,
  type StudioGpuStrokeFeedRecoveryCheckpoint,
} from "./studio-webgpu-stroke";

let studioGpuStrokeFeedTokenSequence = 0;
const trustedStudioGpuStrokeFeedCheckpoints = new WeakSet<object>();
const trustedStudioGpuStrokeFeedRevisions = new WeakSet<object>();
const trustedStudioGpuStrokeFeedDabExtensionReceipts = new WeakSet<object>();
const studioGpuStrokeFeedDabExtensionReceiptCache = new WeakMap<
  StudioGpuStrokeFeedRevision,
  Map<number, StudioGpuStrokeFeedDabExtensionReceipt>
>();
const materializedStudioGpuStrokeFeedCache = new WeakMap<object, StudioGpuStroke>();
const trustedStudioGpuStrokeFeedSourceReceipts = new WeakMap<object, Readonly<{
  source: StudioGpuStroke;
  points: readonly number[];
  pressures: readonly number[] | undefined;
  styleSignature: string;
}>>();

/** Caps one skipped pointer delivery before any suffix copy or residual-dab planning begins. */
export const STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS = 100_000;
/** Caps aggregate work for one atomic symmetry fan. */
export const STUDIO_GPU_STROKE_FEED_MAX_BATCH_POINTS = 1_000_000;
/** Caps the one-time root snapshot retained for recovery. */
export const STUDIO_GPU_STROKE_FEED_MAX_BASELINE_POINTS = 1_000_000;
/** Caps all operations in one baseline before any source point/pressure array is cloned. */
export const STUDIO_GPU_STROKE_FEED_MAX_BASELINE_TOTAL_POINTS = 1_000_000;

export function isTrustedStudioGpuStrokeFeedRevision(
  value: unknown
): value is StudioGpuStrokeFeedRevision {
  return typeof value === "object"
    && value !== null
    && trustedStudioGpuStrokeFeedRevisions.has(value);
}

export { isTrustedStudioGpuStrokeFeedStroke } from "./studio-webgpu-stroke";

/** Returns a trusted feed's logical root-plus-suffix count without materializing its history. */
export function studioGpuStrokeFeedPointCount(stroke: StudioGpuStroke): number {
  const revision = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  return isTrustedStudioGpuStrokeFeedStroke(stroke)
    && isTrustedStudioGpuStrokeFeedRevision(revision)
    ? revision.pointCount
    : stroke.points.length / 2;
}

function createTrustedStudioGpuStrokeFeedStroke(
  source: StudioGpuStroke,
  revision: StudioGpuStrokeFeedRevision,
  sourceReference?: StudioGpuStroke
): StudioGpuStroke | null {
  try {
    // The wrapper retains feed-owned root storage only. Descendants reuse it while revision chunks
    // own their copied suffixes, so caller-owned full arrays never need an in-place freeze.
    if (
      !Object.isFrozen(source.points)
      || (source.pressures !== undefined && !Object.isFrozen(source.pressures))
    ) return null;
    const candidate: StudioGpuStroke = {
      id: source.id,
      points: source.points,
      ...(source.pressures === undefined ? {} : { pressures: source.pressures }),
      color: source.color,
      size: source.size,
      ...(source.pressureModel === undefined ? {} : { pressureModel: source.pressureModel }),
      ...(source.opacity === undefined ? {} : { opacity: source.opacity }),
      ...(source.composite === undefined ? {} : { composite: source.composite }),
      ...(source.orderKey === undefined ? {} : { orderKey: source.orderKey }),
    };
    Object.defineProperty(candidate, STUDIO_GPU_STROKE_FEED_REVISION, {
      value: revision,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    const frozen = Object.freeze(candidate);
    registerTrustedStudioGpuStrokeFeedStroke(frozen);
    if (sourceReference) {
      trustedStudioGpuStrokeFeedSourceReceipts.set(frozen, Object.freeze({
        source: sourceReference,
        points: sourceReference.points,
        pressures: sourceReference.pressures,
        styleSignature: studioGpuStrokeFeedStyleSignature(sourceReference),
      }));
    }
    return frozen;
  } catch {
    return null;
  }
}

function nextFeedToken(lineage: string): string {
  studioGpuStrokeFeedTokenSequence += 1;
  return `${lineage}:token:${studioGpuStrokeFeedTokenSequence}`;
}

export interface StudioGpuStrokeSuffixPatch {
  /** Stroke operation receiving the suffix. Pinned drawing normally extends the final operation. */
  readonly strokeIndex: number;
  readonly previousPointCount: number;
  /** New coordinate pairs only; the retained bridge endpoint is owned by the previous revision. */
  readonly suffixPoints: readonly number[];
  readonly suffixPressures: readonly number[];
  readonly previousRevisionToken?: string;
  /** Compatibility receipt for the full-array adapter. It is not retained by the compact feed. */
  readonly nextStroke: StudioGpuStroke;
  /** Compatibility fallback for the full-array adapter. */
  readonly fallbackStrokes: readonly StudioGpuStroke[];
}

/** Hot-path append contract: only a trusted prior revision plus newly sampled values cross it. */
export interface StudioGpuStrokeCompactSuffixPatch {
  readonly strokeIndex: number;
  readonly previousPointCount: number;
  readonly previousRevisionToken: string;
  readonly suffixPoints: readonly number[];
  readonly suffixPressures: readonly number[];
  readonly nextStroke?: never;
  readonly fallbackStrokes?: never;
}

type StudioGpuStrokeSuffixPatchInput =
  | StudioGpuStrokeSuffixPatch
  | StudioGpuStrokeCompactSuffixPatch;

export interface StudioGpuStrokeOperationsAppendPatch {
  readonly previousStrokeCount: number;
  readonly suffixStrokes: readonly StudioGpuStroke[];
  readonly fallbackStrokes: readonly StudioGpuStroke[];
}

/**
 * Applies one append-only suffix to every operation in a terminal symmetry group, then submits a
 * single frame. Each child patch keeps the ordinary suffix proof; the shared fallback prevents a
 * partially accepted group from becoming visible if any variation is stale or malformed.
 */
export interface StudioGpuStrokeSuffixBatchPatch {
  readonly patches: readonly StudioGpuStrokeSuffixPatch[];
  readonly fallbackStrokes: readonly StudioGpuStroke[];
}

export interface StudioGpuStrokeCompactSuffixBatchPatch {
  readonly patches: readonly StudioGpuStrokeCompactSuffixPatch[];
  readonly fallbackStrokes?: never;
}

type StudioGpuStrokeSuffixBatchPatchInput =
  | StudioGpuStrokeSuffixBatchPatch
  | StudioGpuStrokeCompactSuffixBatchPatch;

export type StudioGpuPinnedStrokeFeedUpdate =
  | { readonly mode: "reset" }
  | { readonly mode: "replace"; readonly strokes: readonly StudioGpuStroke[] }
  | { readonly mode: "retain"; readonly strokes: readonly StudioGpuStroke[] }
  | { readonly mode: "append-operations"; readonly patch: StudioGpuStrokeOperationsAppendPatch }
  | { readonly mode: "append"; readonly patch: StudioGpuStrokeSuffixPatch };

export interface StudioGpuStrokeFeedAdvance {
  readonly status: "appended" | "rejected";
  readonly strokes: readonly StudioGpuStroke[];
}

/**
 * Zero-copy authority for planning one retained stroke suffix.
 *
 * The receipt owns no source coordinates. It points at the already-frozen revision chunks and
 * carries the exact endpoint/pressure/spacing phase that preceded them. Consumers therefore touch
 * O(appended samples) coordinates without materializing either the settled prefix or a bridge
 * array. Only receipts minted from this module's private revision registry are trusted.
 */
export interface StudioGpuStrokeFeedDabExtensionReceipt {
  readonly lineage: string;
  readonly fromRevisionToken: string;
  readonly toRevisionToken: string;
  readonly previousPointCount: number;
  readonly pointCount: number;
  readonly suffixPointCount: number;
  readonly styleSignature: string;
  readonly previousX: number;
  readonly previousY: number;
  readonly previousPressure: number;
  readonly residualInkState?: StudioResidualInkState;
  readonly residualDabCount?: number;
  /** Oldest-to-newest immutable chunks; coordinate/pressure arrays are never copied here. */
  readonly suffixRevisions: readonly StudioGpuStrokeFeedRevision[];
}

export function isTrustedStudioGpuStrokeFeedDabExtensionReceipt(
  value: unknown
): value is StudioGpuStrokeFeedDabExtensionReceipt {
  return typeof value === "object"
    && value !== null
    && trustedStudioGpuStrokeFeedDabExtensionReceipts.has(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteGpuScalar(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
}

function freezeResidualInkState(state: StudioResidualInkState): StudioResidualInkState {
  return Object.freeze({
    previousX: state.previousX,
    previousY: state.previousY,
    previousPressure: state.previousPressure,
    lastDabX: state.lastDabX,
    lastDabY: state.lastDabY,
    distanceRemainder: state.distanceRemainder,
    ...(state.spacingPhase === undefined ? {} : { spacingPhase: state.spacingPhase }),
  });
}

function pressureAt(stroke: StudioGpuStroke, index: number): number {
  return resolveStudioInkPressure(stroke.pressures?.[index], stroke.pressureModel);
}

function stableNumber(value: number): string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

function semanticToken(value: string | number | undefined): string {
  if (value === undefined) return "u0:";
  const payload = typeof value === "number" ? stableNumber(value) : value;
  return `${typeof value === "number" ? "n" : "s"}${payload.length}:${payload}`;
}

export function studioGpuStrokeFeedStyleSignature(stroke: StudioGpuStroke): string {
  const legacySignature = [
    stroke.id,
    stroke.color,
    stroke.size,
    stroke.opacity,
    stroke.composite,
    stroke.orderKey,
  ].map((value) => semanticToken(value)).join("");
  return stroke.pressureModel === undefined
    ? legacySignature
    : `${legacySignature}${semanticToken(`pressure-model:${stroke.pressureModel}`)}`;
}

export function sameStudioGpuStrokeFeedStyle(
  left: StudioGpuStroke,
  right: StudioGpuStroke
): boolean {
  return left.id === right.id
    && left.color === right.color
    && Object.is(left.size, right.size)
    && left.pressureModel === right.pressureModel
    && Object.is(left.opacity ?? 1, right.opacity ?? 1)
    && (left.composite ?? "normal") === (right.composite ?? "normal")
    && left.orderKey === right.orderKey;
}

function validResidualInkState(state: StudioResidualInkState | undefined): boolean {
  return state !== undefined
    && Object.isFrozen(state)
    && finiteGpuScalar(state.previousX)
    && finiteGpuScalar(state.previousY)
    && finiteGpuScalar(state.previousPressure)
    && state.previousPressure >= 0
    && state.previousPressure <= 1
    && finiteGpuScalar(state.lastDabX)
    && finiteGpuScalar(state.lastDabY)
    && finiteGpuScalar(state.distanceRemainder)
    && state.distanceRemainder >= 0
    && (state.spacingPhase === undefined || (
      finiteGpuScalar(state.spacingPhase)
      && state.spacingPhase >= 0
      && state.spacingPhase < 1
    ));
}

/**
 * Proves and exposes only the immutable revision suffix missing from one retained point count.
 *
 * `maximumSuffixPoints` is a CPU admission budget, not a paint budget. Exceeding it returns null so
 * callers can request a bounded full rebuild/fallback instead of spending an unbounded frame in a
 * catch-up walk.
 */
export function studioGpuStrokeFeedDabExtensionReceipt(
  stroke: StudioGpuStroke,
  previousPointCount: number,
  maximumSuffixPoints = STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS
): StudioGpuStrokeFeedDabExtensionReceipt | null {
  try {
    const latest = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
    if (
      !isTrustedStudioGpuStrokeFeedStroke(stroke)
      || !isTrustedStudioGpuStrokeFeedRevision(latest)
      || !Object.isFrozen(stroke)
      || !Object.isFrozen(latest)
      || !Number.isSafeInteger(latest.revision)
      || latest.revision < 1
      || !Number.isSafeInteger(previousPointCount)
      || previousPointCount < 1
      || previousPointCount >= latest.pointCount
      || !Number.isSafeInteger(maximumSuffixPoints)
      || maximumSuffixPoints < 1
      || latest.styleSignature !== studioGpuStrokeFeedStyleSignature(stroke)
    ) {
      return null;
    }
    const cached = studioGpuStrokeFeedDabExtensionReceiptCache
      .get(latest)
      ?.get(previousPointCount);
    if (cached) {
      return cached.suffixPointCount <= maximumSuffixPoints ? cached : null;
    }

    const newestToOldest: StudioGpuStrokeFeedRevision[] = [];
    const visited = new Set<StudioGpuStrokeFeedRevision>();
    let suffixPointCount = 0;
    let remainingSteps = latest.revision + 1;
    let cursor: StudioGpuStrokeFeedRevision | null = latest;
    while (cursor && cursor.pointCount > previousPointCount) {
      const parent: StudioGpuStrokeFeedRevision | null = cursor.parent;
      const chunkPointCount = cursor.suffixPoints.length / 2;
      if (
        remainingSteps <= 0
        || visited.has(cursor)
        || !isTrustedStudioGpuStrokeFeedRevision(cursor)
        || !Object.isFrozen(cursor)
        || !parent
        || !isTrustedStudioGpuStrokeFeedRevision(parent)
        || !Object.isFrozen(parent)
        || !Number.isSafeInteger(cursor.revision)
        || !Number.isSafeInteger(parent.revision)
        || cursor.lineage !== latest.lineage
        || cursor.styleSignature !== latest.styleSignature
        || cursor.revision !== parent.revision + 1
        || cursor.parentPointCount !== parent.pointCount
        || !Object.isFrozen(cursor.suffixPoints)
        || !Object.isFrozen(cursor.suffixPressures)
        || cursor.suffixPoints.length < 2
        || !Number.isSafeInteger(chunkPointCount)
        || cursor.suffixPressures.length !== chunkPointCount
        || cursor.pointCount !== parent.pointCount + chunkPointCount
        || !cursor.suffixPoints.every(finiteGpuScalar)
        || !cursor.suffixPressures.every((pressure) => (
          finiteGpuScalar(pressure) && pressure >= 0 && pressure <= 1
        ))
        || !Object.is(cursor.lastX, cursor.suffixPoints.at(-2))
        || !Object.is(cursor.lastY, cursor.suffixPoints.at(-1))
        || !Object.is(cursor.lastPressure, cursor.suffixPressures.at(-1))
        || chunkPointCount > maximumSuffixPoints - suffixPointCount
      ) {
        return null;
      }
      remainingSteps -= 1;
      visited.add(cursor);
      suffixPointCount += chunkPointCount;
      newestToOldest.push(cursor);
      cursor = parent;
    }

    const usesResidualSpacing = studioInkUsesResidualDabSpacing(stroke.pressureModel);
    if (
      !cursor
      || !isTrustedStudioGpuStrokeFeedRevision(cursor)
      || !Object.isFrozen(cursor)
      || cursor.pointCount !== previousPointCount
      || cursor.lineage !== latest.lineage
      || cursor.styleSignature !== latest.styleSignature
      || suffixPointCount !== latest.pointCount - previousPointCount
      || !finiteGpuScalar(cursor.lastX)
      || !finiteGpuScalar(cursor.lastY)
      || !finiteGpuScalar(cursor.lastPressure)
      || cursor.lastPressure < 0
      || cursor.lastPressure > 1
      || (usesResidualSpacing && (
        !validResidualInkState(cursor.residualInkState)
        || !Number.isSafeInteger(cursor.residualDabCount)
        || cursor.residualDabCount! < 0
        || cursor.residualDabCount! > STUDIO_CAUSAL_INK_MAX_DABS
      ))
      || (!usesResidualSpacing && (
        cursor.residualInkState !== undefined || cursor.residualDabCount !== undefined
      ))
    ) {
      return null;
    }

    const suffixRevisions = Object.freeze(newestToOldest.reverse());
    const receipt: StudioGpuStrokeFeedDabExtensionReceipt = Object.freeze({
      lineage: latest.lineage,
      fromRevisionToken: cursor.token,
      toRevisionToken: latest.token,
      previousPointCount,
      pointCount: latest.pointCount,
      suffixPointCount,
      styleSignature: latest.styleSignature,
      previousX: cursor.lastX,
      previousY: cursor.lastY,
      previousPressure: cursor.lastPressure,
      ...(usesResidualSpacing
        ? {
          residualInkState: cursor.residualInkState!,
          residualDabCount: cursor.residualDabCount!,
        }
        : {}),
      suffixRevisions,
    });
    trustedStudioGpuStrokeFeedDabExtensionReceipts.add(receipt);
    const receiptsByPointCount = studioGpuStrokeFeedDabExtensionReceiptCache.get(latest)
      ?? new Map<number, StudioGpuStrokeFeedDabExtensionReceipt>();
    receiptsByPointCount.set(previousPointCount, receipt);
    studioGpuStrokeFeedDabExtensionReceiptCache.set(latest, receiptsByPointCount);
    return receipt;
  } catch {
    return null;
  }
}

function sameDabReceiptPressureSequence(
  left: StudioGpuStrokeFeedDabExtensionReceipt,
  right: StudioGpuStrokeFeedDabExtensionReceipt
): boolean {
  if (left.suffixPointCount !== right.suffixPointCount) return false;
  let leftRevisionIndex = 0;
  let rightRevisionIndex = 0;
  let leftPressureIndex = 0;
  let rightPressureIndex = 0;
  for (let consumed = 0; consumed < left.suffixPointCount; consumed += 1) {
    while (
      leftRevisionIndex < left.suffixRevisions.length
      && leftPressureIndex
        >= left.suffixRevisions[leftRevisionIndex]!.suffixPressures.length
    ) {
      leftRevisionIndex += 1;
      leftPressureIndex = 0;
    }
    while (
      rightRevisionIndex < right.suffixRevisions.length
      && rightPressureIndex
        >= right.suffixRevisions[rightRevisionIndex]!.suffixPressures.length
    ) {
      rightRevisionIndex += 1;
      rightPressureIndex = 0;
    }
    const leftPressure = left.suffixRevisions[leftRevisionIndex]
      ?.suffixPressures[leftPressureIndex];
    const rightPressure = right.suffixRevisions[rightRevisionIndex]
      ?.suffixPressures[rightPressureIndex];
    if (!Object.is(leftPressure, rightPressure)) return false;
    leftPressureIndex += 1;
    rightPressureIndex += 1;
  }
  return true;
}

/**
 * Atomically proves a caller-declared symmetry/variation suffix group.
 *
 * Variations may transform coordinates and identifiers, but a live symmetry fan must advance the
 * same source sample count with the same pressure sequence and brush paint semantics. A torn,
 * stale, or over-budget member rejects the complete group.
 */
export function studioGpuStrokeFeedDabExtensionReceiptBatch(
  strokes: readonly StudioGpuStroke[],
  previousPointCount: number,
  maximumSuffixPoints = STUDIO_GPU_STROKE_FEED_MAX_BATCH_POINTS
): readonly StudioGpuStrokeFeedDabExtensionReceipt[] | null {
  try {
    if (
      strokes.length < 1
      || strokes.length > STUDIO_BRUSH_MAX_SYMMETRY_VARIATIONS
      || !Number.isSafeInteger(maximumSuffixPoints)
      || maximumSuffixPoints < 1
    ) {
      return null;
    }
    const receipts: StudioGpuStrokeFeedDabExtensionReceipt[] = [];
    let aggregateSuffixPoints = 0;
    for (const stroke of strokes) {
      const receipt = studioGpuStrokeFeedDabExtensionReceipt(
        stroke,
        previousPointCount,
        Math.min(maximumSuffixPoints, STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS)
      );
      if (
        !receipt
        || receipt.suffixPointCount > maximumSuffixPoints - aggregateSuffixPoints
      ) {
        return null;
      }
      aggregateSuffixPoints += receipt.suffixPointCount;
      receipts.push(receipt);
    }

    const firstStroke = strokes[0]!;
    const firstReceipt = receipts[0]!;
    const lineages = new Set<string>();
    for (let index = 0; index < receipts.length; index += 1) {
      const stroke = strokes[index]!;
      const receipt = receipts[index]!;
      if (
        lineages.has(receipt.lineage)
        || receipt.previousPointCount !== firstReceipt.previousPointCount
        || receipt.pointCount !== firstReceipt.pointCount
        || receipt.suffixPointCount !== firstReceipt.suffixPointCount
        || stroke.color !== firstStroke.color
        || !Object.is(stroke.size, firstStroke.size)
        || stroke.pressureModel !== firstStroke.pressureModel
        || !Object.is(stroke.opacity ?? 1, firstStroke.opacity ?? 1)
        || (stroke.composite ?? "normal") !== (firstStroke.composite ?? "normal")
        || !sameDabReceiptPressureSequence(firstReceipt, receipt)
      ) {
        return null;
      }
      lineages.add(receipt.lineage);
    }
    return Object.freeze(receipts);
  } catch {
    return null;
  }
}

function boundsForPoint(
  size: number,
  x: number,
  y: number,
  pressure: number,
  pressureModel: StudioGpuStroke["pressureModel"]
): readonly [number, number, number, number] {
  const radius = studioGpuPressureRadius(size, pressure, pressureModel);
  return [x - radius, y - radius, x + radius, y + radius];
}

function includeResidualDabBounds(
  dabs: readonly { x: number; y: number; radius: number }[],
  bounds: { minimumX: number; minimumY: number; maximumX: number; maximumY: number }
): void {
  for (const dab of dabs) {
    bounds.minimumX = Math.min(bounds.minimumX, dab.x - dab.radius);
    bounds.minimumY = Math.min(bounds.minimumY, dab.y - dab.radius);
    bounds.maximumX = Math.max(bounds.maximumX, dab.x + dab.radius);
    bounds.maximumY = Math.max(bounds.maximumY, dab.y + dab.radius);
  }
}

function baseFeedRevision(
  stroke: StudioGpuStroke,
  lineage: string,
  recoveryCheckpoint: StudioGpuStrokeFeedRecoveryCheckpoint
): StudioGpuStrokeFeedRevision | null {
  const pointCount = stroke.points.length / 2;
  if (!Number.isSafeInteger(pointCount) || pointCount < 1) return null;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  let residualInkState: StudioResidualInkState | undefined;
  let residualDabCount: number | undefined;
  for (let index = 0; index < pointCount; index += 1) {
    const x = stroke.points[index * 2];
    const y = stroke.points[index * 2 + 1];
    if (!finiteGpuScalar(x) || !finiteGpuScalar(y)) return null;
    const [left, top, right, bottom] = boundsForPoint(
      stroke.size,
      x!,
      y!,
      pressureAt(stroke, index),
      stroke.pressureModel
    );
    minimumX = Math.min(minimumX, left);
    minimumY = Math.min(minimumY, top);
    maximumX = Math.max(maximumX, right);
    maximumY = Math.max(maximumY, bottom);
    if (studioInkUsesResidualDabSpacing(stroke.pressureModel) && stroke.pressureModel) {
      const sample = { x: x!, y: y!, pressure: pressureAt(stroke, index), sourceIndex: index };
      if (index === 0) {
        const started = startStudioResidualInk(
          sample,
          stroke.size,
          stroke.pressureModel,
          STUDIO_CAUSAL_INK_MAX_DABS
        );
        if (!started.complete) return null;
        residualInkState = freezeResidualInkState(started.state);
        residualDabCount = started.dabs.length;
        const bounds = { minimumX, minimumY, maximumX, maximumY };
        includeResidualDabBounds(started.dabs, bounds);
        ({ minimumX, minimumY, maximumX, maximumY } = bounds);
      } else {
        if (!residualInkState || residualDabCount === undefined) return null;
        const advanced = advanceStudioResidualInk(
          residualInkState,
          sample,
          stroke.size,
          stroke.pressureModel,
          STUDIO_CAUSAL_INK_MAX_DABS - residualDabCount
        );
        if (!advanced.complete) return null;
        residualInkState = freezeResidualInkState(advanced.state);
        residualDabCount += advanced.dabs.length;
        const bounds = { minimumX, minimumY, maximumX, maximumY };
        includeResidualDabBounds(advanced.dabs, bounds);
        ({ minimumX, minimumY, maximumX, maximumY } = bounds);
      }
    }
  }
  const lastIndex = pointCount - 1;
  const revision: StudioGpuStrokeFeedRevision = Object.freeze({
    lineage,
    revision: 0,
    token: nextFeedToken(lineage),
    pointCount,
    parent: null,
    parentPointCount: pointCount,
    suffixPoints: Object.freeze([]),
    suffixPressures: Object.freeze([]),
    lastX: stroke.points[lastIndex * 2]!,
    lastY: stroke.points[lastIndex * 2 + 1]!,
    lastPressure: pressureAt(stroke, lastIndex),
    ...(residualInkState === undefined
      ? {}
      : { residualInkState, residualDabCount: residualDabCount! }),
    minimumX,
    minimumY,
    maximumX,
    maximumY,
    styleSignature: studioGpuStrokeFeedStyleSignature(stroke),
    recoveryCheckpoint,
    trustedImmutable: true,
  });
  trustedStudioGpuStrokeFeedRevisions.add(revision);
  return revision;
}

function createStudioGpuStrokeFeedRecoveryCheckpoint(
  stroke: StudioGpuStroke,
  lineage: string
): StudioGpuStrokeFeedRecoveryCheckpoint | null {
  const pointCount = stroke.points.length / 2;
  if (!Number.isSafeInteger(pointCount) || pointCount < 1 || !Object.isFrozen(stroke.points)) {
    return null;
  }
  const resolvedPressures = Array.from(
    { length: pointCount },
    (_, index) => pressureAt(stroke, index)
  );
  const canReusePressures = stroke.pressures !== undefined
    && Object.isFrozen(stroke.pressures)
    && stroke.pressures.length === pointCount
    && stroke.pressures.every((value, index) => Object.is(value, resolvedPressures[index]));
  const pressures = canReusePressures
    ? stroke.pressures!
    : Object.freeze(resolvedPressures);
  const checkpoint: StudioGpuStrokeFeedRecoveryCheckpoint = Object.freeze({
    lineage,
    pointCount,
    points: stroke.points,
    pressures,
    id: stroke.id,
    color: stroke.color,
    size: stroke.size,
    ...(stroke.pressureModel === undefined ? {} : { pressureModel: stroke.pressureModel }),
    opacity: stroke.opacity,
    composite: stroke.composite,
    orderKey: stroke.orderKey,
    styleSignature: studioGpuStrokeFeedStyleSignature(stroke),
    trustedImmutable: true,
  });
  trustedStudioGpuStrokeFeedCheckpoints.add(checkpoint);
  return checkpoint;
}

/**
 * Creates the one-time immutable baseline for a pinned feed. Full arrays are inspected here; every
 * accepted update after this point touches only its new suffix.
 */
function createStudioGpuStrokeFeedBaselineInternal(
  strokes: readonly StudioGpuStroke[],
  lineage: string,
  captureSourceReceipts: boolean
): readonly StudioGpuStroke[] | null {
  try {
  const snapshots: StudioGpuStroke[] = [];
  const baselineSources: Array<{
    source: StudioGpuStroke;
    points: readonly number[];
    pressures: readonly number[] | undefined;
  }> = [];
  const prepared: Array<{
    source: StudioGpuStroke;
    snapshot: StudioGpuStroke;
    revision: StudioGpuStrokeFeedRevision;
  }> = [];
  let totalPointCount = 0;
  for (let index = 0; index < strokes.length; index += 1) {
    const source = strokes[index]!;
    const sourcePoints = source.points;
    const sourcePressures = source.pressures;
    const sourcePointCount = sourcePoints.length / 2;
    if (
      !Array.isArray(sourcePoints)
      || !Number.isSafeInteger(sourcePointCount)
      || sourcePointCount < 1
      || sourcePointCount > STUDIO_GPU_STROKE_FEED_MAX_BASELINE_POINTS
      || sourcePointCount
        > STUDIO_GPU_STROKE_FEED_MAX_BASELINE_TOTAL_POINTS - totalPointCount
      || (sourcePressures !== undefined && (
        !Array.isArray(sourcePressures)
        || sourcePressures.length > sourcePointCount
      ))
    ) return null;
    totalPointCount += sourcePointCount;
    baselineSources.push({
      source,
      points: sourcePoints,
      pressures: sourcePressures,
    });
  }
  for (let index = 0; index < baselineSources.length; index += 1) {
    const { source, points: sourcePoints, pressures: sourcePressures } = baselineSources[index]!;
    const points = Object.freeze([...sourcePoints]);
    const pressures = sourcePressures ? Object.freeze([...sourcePressures]) : undefined;
    const snapshot: StudioGpuStroke = {
      id: source.id,
      points,
      ...(pressures === undefined ? {} : { pressures }),
      color: source.color,
      size: source.size,
      ...(source.pressureModel === undefined ? {} : { pressureModel: source.pressureModel }),
      ...(source.opacity === undefined ? {} : { opacity: source.opacity }),
      ...(source.composite === undefined ? {} : { composite: source.composite }),
      ...(source.orderKey === undefined ? {} : { orderKey: source.orderKey }),
    };
    const strokeLineage = `${lineage}:${index}:${source.id}`;
    const recoveryCheckpoint = createStudioGpuStrokeFeedRecoveryCheckpoint(snapshot, strokeLineage);
    if (!recoveryCheckpoint) return null;
    const revision = baseFeedRevision(snapshot, strokeLineage, recoveryCheckpoint);
    if (!revision) return null;
    prepared.push({ source, snapshot, revision });
  }
  for (const { source, snapshot, revision } of prepared) {
    const baselineStroke = createTrustedStudioGpuStrokeFeedStroke(
      snapshot,
      revision,
      captureSourceReceipts ? source : undefined
    );
    if (!baselineStroke) return null;
    snapshots.push(baselineStroke);
  }
  return Object.freeze(snapshots);
  } catch {
    return null;
  }
}

export function createStudioGpuStrokeFeedBaseline(
  strokes: readonly StudioGpuStroke[],
  lineage: string
): readonly StudioGpuStroke[] | null {
  return createStudioGpuStrokeFeedBaselineInternal(strokes, lineage, true);
}

/** Creates a root-only baseline without retaining compatibility receipts to caller-owned arrays. */
export function createStudioGpuStrokeFeedCompactBaseline(
  strokes: readonly StudioGpuStroke[],
  lineage: string
): readonly StudioGpuStroke[] | null {
  return createStudioGpuStrokeFeedBaselineInternal(strokes, lineage, false);
}

/** Appends newly-started operations while preserving every existing operation revision. */
export function appendStudioGpuStrokeFeedOperations(
  previousStrokes: readonly StudioGpuStroke[],
  patch: StudioGpuStrokeOperationsAppendPatch,
  lineage: string
): readonly StudioGpuStroke[] | null {
  if (
    patch.previousStrokeCount !== previousStrokes.length
    || patch.suffixStrokes.length < 1
    || patch.fallbackStrokes.length !== previousStrokes.length + patch.suffixStrokes.length
  ) {
    return null;
  }
  for (let index = 0; index < previousStrokes.length; index += 1) {
    const previous = previousStrokes[index];
    const fallback = patch.fallbackStrokes[index];
    // Starting a new operation is low-frequency (once per stroke), so pay one exact semantic
    // prefix check here. Pointer-frame suffix appends remain history-free, while a direct public
    // operation patch can never silently retain edited/deleted authoritative history.
    if (
      !isTrustedStudioGpuStrokeFeedStroke(previous)
      || !isTrustedStudioGpuStrokeFeedRevision(previous[STUDIO_GPU_STROKE_FEED_REVISION])
      || !fallback
      || !sameStudioGpuStroke(previous, fallback)
    ) {
      return null;
    }
  }
  for (let index = 0; index < patch.suffixStrokes.length; index += 1) {
    if (patch.fallbackStrokes[previousStrokes.length + index] !== patch.suffixStrokes[index]) {
      return null;
    }
  }
  const suffix = createStudioGpuStrokeFeedBaseline(patch.suffixStrokes, lineage);
  return suffix ? Object.freeze([...previousStrokes, ...suffix]) : null;
}

function validSuffixPatch(
  previous: StudioGpuStroke,
  patch: StudioGpuStrokeSuffixPatchInput
): boolean {
  const revision = previous[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    !isTrustedStudioGpuStrokeFeedStroke(previous)
    || !isTrustedStudioGpuStrokeFeedRevision(revision)
    || (patch.nextStroke !== undefined
      && !sameStudioGpuStrokeFeedStyle(previous, patch.nextStroke))
    || patch.previousPointCount !== revision.pointCount
    || (patch.previousRevisionToken !== undefined
      && patch.previousRevisionToken !== revision.token)
    || patch.suffixPoints.length < 2
    || patch.suffixPoints.length > STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS * 2
    || patch.suffixPoints.length % 2 !== 0
    || patch.suffixPressures.length !== patch.suffixPoints.length / 2
    || !patch.suffixPoints.every(finiteGpuScalar)
    || !patch.suffixPressures.every(finiteGpuScalar)
  ) {
    return false;
  }
  const suffixPointCount = patch.suffixPoints.length / 2;
  if (patch.nextStroke !== undefined) {
    const nextPointCount = patch.nextStroke.points.length / 2;
    if (
      !Number.isSafeInteger(nextPointCount)
      || nextPointCount !== revision.pointCount + suffixPointCount
      || (patch.nextStroke.pressures !== undefined
        && patch.nextStroke.pressures.length !== nextPointCount)
    ) {
      return false;
    }
    const coordinateOffset = revision.pointCount * 2;
    for (let index = 0; index < patch.suffixPoints.length; index += 1) {
      if (!Object.is(patch.suffixPoints[index], patch.nextStroke.points[coordinateOffset + index])) {
        return false;
      }
    }
    for (let index = 0; index < suffixPointCount; index += 1) {
      if (!Object.is(
        clamp(patch.suffixPressures[index]!, 0, 1),
        pressureAt(patch.nextStroke, revision.pointCount + index)
      )) {
        return false;
      }
    }
  }
  return true;
}

interface PreparedStudioGpuStrokeFeedAdvance {
  readonly strokeIndex: number;
  readonly previousStroke: StudioGpuStroke;
  readonly sourceReference?: StudioGpuStroke;
  readonly revision: StudioGpuStrokeFeedRevision;
}

/** Prepares a proven suffix without mutating caller-owned source arrays. */
function prepareStudioGpuStrokeFeedAtIndex(
  previousStrokes: readonly StudioGpuStroke[],
  patch: StudioGpuStrokeSuffixPatchInput,
  requireTerminal: boolean
): PreparedStudioGpuStrokeFeedAdvance | null {
  if (
    !Number.isSafeInteger(patch.strokeIndex)
    || patch.strokeIndex < 0
    || patch.strokeIndex >= previousStrokes.length
    || (requireTerminal && patch.strokeIndex !== previousStrokes.length - 1)
    || (patch.fallbackStrokes !== undefined && (
      patch.fallbackStrokes.length !== previousStrokes.length
      || patch.nextStroke === undefined
      || patch.fallbackStrokes[patch.strokeIndex] !== patch.nextStroke
    ))
  ) {
    return null;
  }
  const previous = previousStrokes[patch.strokeIndex]!;
  const parent = previous[STUDIO_GPU_STROKE_FEED_REVISION];
  if (!parent || !validSuffixPatch(previous, patch)) {
    return null;
  }

  const suffixPoints = Object.freeze([...patch.suffixPoints]);
  const suffixPressures = Object.freeze(patch.suffixPressures.map((value) => clamp(value, 0, 1)));
  let minimumX = parent.minimumX;
  let minimumY = parent.minimumY;
  let maximumX = parent.maximumX;
  let maximumY = parent.maximumY;
  let residualInkState = parent.residualInkState;
  let residualDabCount = parent.residualDabCount;
  for (let index = 0; index < suffixPressures.length; index += 1) {
    const x = suffixPoints[index * 2]!;
    const y = suffixPoints[index * 2 + 1]!;
    const [left, top, right, bottom] = boundsForPoint(
      previous.size,
      x,
      y,
      suffixPressures[index]!,
      previous.pressureModel
    );
    minimumX = Math.min(minimumX, left);
    minimumY = Math.min(minimumY, top);
    maximumX = Math.max(maximumX, right);
    maximumY = Math.max(maximumY, bottom);
    if (studioInkUsesResidualDabSpacing(previous.pressureModel) && previous.pressureModel) {
      if (!residualInkState || residualDabCount === undefined) {
        return null;
      }
      const advanced = advanceStudioResidualInk(
        residualInkState,
        {
          x,
          y,
          pressure: suffixPressures[index]!,
          sourceIndex: parent.pointCount + index,
        },
        previous.size,
        previous.pressureModel,
        STUDIO_CAUSAL_INK_MAX_DABS - residualDabCount
      );
      if (!advanced.complete) return null;
      residualInkState = freezeResidualInkState(advanced.state);
      residualDabCount += advanced.dabs.length;
      const bounds = { minimumX, minimumY, maximumX, maximumY };
      includeResidualDabBounds(advanced.dabs, bounds);
      ({ minimumX, minimumY, maximumX, maximumY } = bounds);
    }
  }
  const pointCount = parent.pointCount + suffixPressures.length;
  const revisionNumber = parent.revision + 1;
  const revision: StudioGpuStrokeFeedRevision = Object.freeze({
    lineage: parent.lineage,
    revision: revisionNumber,
    token: nextFeedToken(parent.lineage),
    pointCount,
    parent,
    parentPointCount: parent.pointCount,
    suffixPoints,
    suffixPressures,
    lastX: suffixPoints.at(-2)!,
    lastY: suffixPoints.at(-1)!,
    lastPressure: suffixPressures.at(-1)!,
    ...(residualInkState === undefined
      ? {}
      : { residualInkState, residualDabCount: residualDabCount! }),
    minimumX,
    minimumY,
    maximumX,
    maximumY,
    styleSignature: parent.styleSignature,
    recoveryCheckpoint: null,
    trustedImmutable: true,
  });
  trustedStudioGpuStrokeFeedRevisions.add(revision);
  return Object.freeze({
    strokeIndex: patch.strokeIndex,
    previousStroke: previous,
    ...(patch.nextStroke === undefined ? {} : { sourceReference: patch.nextStroke }),
    revision,
  });
}

function publishPreparedStudioGpuStrokeFeedAdvance(
  prepared: PreparedStudioGpuStrokeFeedAdvance
): StudioGpuStroke | null {
  return createTrustedStudioGpuStrokeFeedStroke(
    prepared.previousStroke,
    prepared.revision,
    prepared.sourceReference
  );
}

function advanceStudioGpuStrokeFeedInternal(
  previousStrokes: readonly StudioGpuStroke[],
  patch: StudioGpuStrokeSuffixPatchInput
): StudioGpuStrokeFeedAdvance {
  const prepared = prepareStudioGpuStrokeFeedAtIndex(previousStrokes, patch, true);
  if (!prepared) return { status: "rejected", strokes: previousStrokes };
  const nextStroke = publishPreparedStudioGpuStrokeFeedAdvance(prepared);
  if (!nextStroke) return { status: "rejected", strokes: previousStrokes };
  const strokes = previousStrokes.slice();
  strokes[prepared.strokeIndex] = nextStroke;
  return { status: "appended", strokes: Object.freeze(strokes) };
}

/** Applies one compatibility-adapted full-array suffix to the terminal live operation. */
export function advanceStudioGpuStrokeFeed(
  previousStrokes: readonly StudioGpuStroke[],
  patch: StudioGpuStrokeSuffixPatch
): StudioGpuStrokeFeedAdvance {
  try {
    return advanceStudioGpuStrokeFeedInternal(previousStrokes, patch);
  } catch {
    return { status: "rejected", strokes: previousStrokes };
  }
}

/** Applies one compact suffix without requiring or retaining a full next-stroke snapshot. */
export function advanceStudioGpuStrokeFeedCompact(
  previousStrokes: readonly StudioGpuStroke[],
  patch: StudioGpuStrokeCompactSuffixPatch
): StudioGpuStrokeFeedAdvance {
  try {
    return advanceStudioGpuStrokeFeedInternal(previousStrokes, patch);
  } catch {
    return { status: "rejected", strokes: previousStrokes };
  }
}

/**
 * Advances a contiguous terminal group (for example radial/kaleidoscope copies) atomically.
 * Historical point arrays are never compared or copied. A single invalid variation rejects the
 * complete batch so symmetry cannot tear across frames.
 */
function advanceStudioGpuStrokeFeedBatchInternal(
  previousStrokes: readonly StudioGpuStroke[],
  batch: StudioGpuStrokeSuffixBatchPatchInput
): StudioGpuStrokeFeedAdvance {
  const { patches, fallbackStrokes } = batch;
  const firstStrokeIndex = previousStrokes.length - patches.length;
  if (
    patches.length < 1
    || patches.length > STUDIO_BRUSH_MAX_SYMMETRY_VARIATIONS
    || firstStrokeIndex < 0
    || (fallbackStrokes !== undefined && fallbackStrokes.length !== previousStrokes.length)
    || patches.reduce((total, patch) => total + patch.suffixPressures.length, 0)
      > STUDIO_GPU_STROKE_FEED_MAX_BATCH_POINTS
  ) {
    return { status: "rejected", strokes: previousStrokes };
  }
  const firstPatch = patches[0]!;
  const sharedPreviousPointCount = firstPatch.previousPointCount;
  const sharedSuffixCoordinateCount = firstPatch.suffixPoints.length;
  const sharedSuffixPressures = firstPatch.suffixPressures;
  for (let index = 0; fallbackStrokes !== undefined && index < firstStrokeIndex; index += 1) {
    // Pointer-frame symmetry updates prove the settled prefix with the source object captured when
    // the engine cloned its baseline. Semantic array comparison here would reread every settled
    // stroke on every hardware sample, while direct wrapper equality alone would reject the
    // engine's intentional baseline clone.
    const previous = previousStrokes[index]!;
    const fallback = fallbackStrokes[index]!;
    const receipt = trustedStudioGpuStrokeFeedSourceReceipts.get(previous);
    if (
      previous !== fallback
      && (
        receipt?.source !== fallback
        || receipt.points !== fallback.points
        || receipt.pressures !== fallback.pressures
        || receipt.styleSignature !== studioGpuStrokeFeedStyleSignature(fallback)
      )
    ) {
      return { status: "rejected", strokes: previousStrokes };
    }
  }
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index]!;
    if (
      patch.strokeIndex !== firstStrokeIndex + index
      || (patch.fallbackStrokes !== undefined && patch.fallbackStrokes !== fallbackStrokes)
      || (fallbackStrokes !== undefined && (
        patch.nextStroke === undefined
        || patch.nextStroke !== fallbackStrokes[patch.strokeIndex]
      ))
      || patch.previousPointCount !== sharedPreviousPointCount
      || patch.suffixPoints.length !== sharedSuffixCoordinateCount
      || patch.suffixPressures.length !== sharedSuffixPressures.length
      || patch.suffixPressures.some((pressure, pressureIndex) => (
        !Object.is(pressure, sharedSuffixPressures[pressureIndex])
      ))
      || !validSuffixPatch(previousStrokes[patch.strokeIndex]!, patch)
    ) {
      return { status: "rejected", strokes: previousStrokes };
    }
  }

  const preparedAdvances: PreparedStudioGpuStrokeFeedAdvance[] = [];
  for (const patch of patches) {
    const prepared = prepareStudioGpuStrokeFeedAtIndex(previousStrokes, patch, false);
    if (!prepared) return { status: "rejected", strokes: previousStrokes };
    preparedAdvances.push(prepared);
  }
  const published = preparedAdvances.map(publishPreparedStudioGpuStrokeFeedAdvance);
  if (published.some((stroke) => stroke === null)) {
    return { status: "rejected", strokes: previousStrokes };
  }
  const advancedStrokes = previousStrokes.slice();
  for (let index = 0; index < preparedAdvances.length; index += 1) {
    advancedStrokes[preparedAdvances[index]!.strokeIndex] = published[index]!;
  }
  return { status: "appended", strokes: Object.freeze(advancedStrokes) };
}

export function advanceStudioGpuStrokeFeedBatch(
  previousStrokes: readonly StudioGpuStroke[],
  batch: StudioGpuStrokeSuffixBatchPatch
): StudioGpuStrokeFeedAdvance {
  try {
    return advanceStudioGpuStrokeFeedBatchInternal(previousStrokes, batch);
  } catch {
    return { status: "rejected", strokes: previousStrokes };
  }
}

/** Atomically advances a terminal symmetry group using suffixes and trusted revisions only. */
export function advanceStudioGpuStrokeFeedBatchCompact(
  previousStrokes: readonly StudioGpuStroke[],
  batch: StudioGpuStrokeCompactSuffixBatchPatch
): StudioGpuStrokeFeedAdvance {
  try {
    return advanceStudioGpuStrokeFeedBatchInternal(previousStrokes, batch);
  } catch {
    return { status: "rejected", strokes: previousStrokes };
  }
}

interface ValidStudioGpuStrokeFeedRecoveryLineage {
  readonly checkpoint: StudioGpuStrokeFeedRecoveryCheckpoint;
  /** Child revisions in newest-to-oldest order. The checkpoint owns revision zero. */
  readonly suffixRevisions: readonly StudioGpuStrokeFeedRevision[];
  readonly latest: StudioGpuStrokeFeedRevision;
}

function validStudioGpuStrokeFeedRecoveryLineage(
  stroke: StudioGpuStroke
): ValidStudioGpuStrokeFeedRecoveryLineage | null {
  try {
    const latest = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
    if (
      !isTrustedStudioGpuStrokeFeedStroke(stroke)
      || !isTrustedStudioGpuStrokeFeedRevision(latest)
      || !Object.isFrozen(latest)
    ) return null;

    const suffixRevisions: StudioGpuStrokeFeedRevision[] = [];
    const visitedRevisions = new Set<StudioGpuStrokeFeedRevision>();
    const visitedTokens = new Set<string>();
    let cursor: StudioGpuStrokeFeedRevision | null = latest;
    while (cursor) {
      if (
        visitedRevisions.has(cursor)
        || !isTrustedStudioGpuStrokeFeedRevision(cursor)
        || typeof cursor.token !== "string"
        || cursor.token.length === 0
        || visitedTokens.has(cursor.token)
        || cursor.trustedImmutable !== true
        || !Object.isFrozen(cursor)
        || !Number.isSafeInteger(cursor.revision)
        || cursor.revision < 0
        || !Number.isSafeInteger(cursor.pointCount)
        || cursor.pointCount < 1
        || cursor.lineage !== latest.lineage
        || cursor.styleSignature !== latest.styleSignature
      ) {
        return null;
      }
      visitedRevisions.add(cursor);
      visitedTokens.add(cursor.token);

      const parent: StudioGpuStrokeFeedRevision | null = cursor.parent;
      if (parent === null) {
        const checkpoint = cursor.recoveryCheckpoint;
        if (
          cursor.revision !== 0
          || cursor.parentPointCount !== cursor.pointCount
          || cursor.suffixPoints.length !== 0
          || cursor.suffixPressures.length !== 0
          || !Object.isFrozen(cursor.suffixPoints)
          || !Object.isFrozen(cursor.suffixPressures)
          || !checkpoint
          || !trustedStudioGpuStrokeFeedCheckpoints.has(checkpoint)
          || checkpoint.trustedImmutable !== true
          || !Object.isFrozen(checkpoint)
          || checkpoint.lineage !== cursor.lineage
          || checkpoint.pointCount !== cursor.pointCount
          || checkpoint.styleSignature !== cursor.styleSignature
          || checkpoint.styleSignature !== studioGpuStrokeFeedStyleSignature(checkpoint)
          || !sameStudioGpuStrokeFeedStyle(checkpoint, stroke)
          || !Object.isFrozen(checkpoint.points)
          || checkpoint.points.length !== checkpoint.pointCount * 2
          || !checkpoint.points.every(finiteGpuScalar)
          || !Object.isFrozen(checkpoint.pressures)
          || checkpoint.pressures.length !== checkpoint.pointCount
          || !checkpoint.pressures.every((pressure) => (
            Number.isFinite(pressure) && pressure >= 0 && pressure <= 1
          ))
          || !Object.is(cursor.lastX, checkpoint.points.at(-2))
          || !Object.is(cursor.lastY, checkpoint.points.at(-1))
          || !Object.is(cursor.lastPressure, checkpoint.pressures.at(-1))
        ) {
          return null;
        }
        return { checkpoint, suffixRevisions, latest };
      }

      const suffixPointCount = cursor.suffixPoints.length / 2;
      if (
        cursor.recoveryCheckpoint !== null
        || !Object.isFrozen(cursor.suffixPoints)
        || !Object.isFrozen(cursor.suffixPressures)
        || cursor.suffixPoints.length < 2
        || !Number.isSafeInteger(suffixPointCount)
        || cursor.suffixPressures.length !== suffixPointCount
        || !cursor.suffixPoints.every(finiteGpuScalar)
        || !cursor.suffixPressures.every((pressure) => (
          Number.isFinite(pressure) && pressure >= 0 && pressure <= 1
        ))
        || cursor.revision !== parent.revision + 1
        || cursor.parentPointCount !== parent.pointCount
        || cursor.pointCount !== parent.pointCount + suffixPointCount
        || cursor.lineage !== parent.lineage
        || cursor.styleSignature !== parent.styleSignature
        || !Object.is(cursor.lastX, cursor.suffixPoints.at(-2))
        || !Object.is(cursor.lastY, cursor.suffixPoints.at(-1))
        || !Object.is(cursor.lastPressure, cursor.suffixPressures.at(-1))
      ) {
        return null;
      }
      suffixRevisions.push(cursor);
      cursor = parent;
    }
  } catch {
    // A forged Proxy/getter must fail closed instead of escaping the recovery boundary.
  }
  return null;
}

/**
 * Rebuilds one exact, immutable full stroke from its frozen root checkpoint and suffix lineage.
 * The current stroke's full point/pressure arrays are deliberately never inspected: they may be
 * unavailable after a device loss or may only exist in the caller's transient live-stroke model.
 */
export function materializeStudioGpuStrokeFeedStroke(
  stroke: StudioGpuStroke
): StudioGpuStroke | null {
  try {
    const cached = materializedStudioGpuStrokeFeedCache.get(stroke);
    if (cached) return cached;
    const lineage = validStudioGpuStrokeFeedRecoveryLineage(stroke);
    if (!lineage) return null;
    const { checkpoint, suffixRevisions, latest } = lineage;

    let points: readonly number[] = checkpoint.points;
    let pressures: readonly number[] = checkpoint.pressures;
    if (suffixRevisions.length > 0) {
      const fullPoints = new Array<number>(latest.pointCount * 2);
      const fullPressures = new Array<number>(latest.pointCount);
      let pointOffset = 0;
      let pressureOffset = 0;
      for (const value of checkpoint.points) fullPoints[pointOffset++] = value;
      for (const value of checkpoint.pressures) fullPressures[pressureOffset++] = value;
      for (let index = suffixRevisions.length - 1; index >= 0; index -= 1) {
        const revision = suffixRevisions[index]!;
        for (const value of revision.suffixPoints) fullPoints[pointOffset++] = value;
        for (const value of revision.suffixPressures) fullPressures[pressureOffset++] = value;
      }
      if (pointOffset !== fullPoints.length || pressureOffset !== fullPressures.length) return null;
      points = Object.freeze(fullPoints);
      pressures = Object.freeze(fullPressures);
    }

    const materialized = Object.freeze({
      id: checkpoint.id,
      points,
      pressures,
      color: checkpoint.color,
      size: checkpoint.size,
      ...(checkpoint.pressureModel === undefined
        ? {}
        : { pressureModel: checkpoint.pressureModel }),
      opacity: checkpoint.opacity,
      composite: checkpoint.composite,
      orderKey: checkpoint.orderKey,
    });
    materializedStudioGpuStrokeFeedCache.set(stroke, materialized);
    return materialized;
  } catch {
    return null;
  }
}

/** Atomically materializes a complete variation/symmetry feed, or rejects the whole set. */
export function materializeStudioGpuStrokeFeedStrokes(
  strokes: readonly StudioGpuStroke[]
): readonly StudioGpuStroke[] | null {
  const materialized: StudioGpuStroke[] = [];
  for (const stroke of strokes) {
    const recovered = materializeStudioGpuStrokeFeedStroke(stroke);
    if (!recovered) return null;
    materialized.push(recovered);
  }
  return Object.freeze(materialized);
}

/**
 * Reconstructs only the bridge plus suffix missing from a retained revision. It never reads the
 * historical prefix of `stroke.points`, even when several pointer frames were coalesced.
 */
export function studioGpuStrokeFeedSuffixFromPointCount(
  stroke: StudioGpuStroke,
  previousPointCount: number
): StudioGpuStroke | null {
  const latest = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    !isTrustedStudioGpuStrokeFeedStroke(stroke)
    || !isTrustedStudioGpuStrokeFeedRevision(latest)
    || !Number.isSafeInteger(previousPointCount)
    || previousPointCount < 1
    || previousPointCount >= latest.pointCount
  ) {
    return null;
  }
  const revisions: StudioGpuStrokeFeedRevision[] = [];
  let cursor: StudioGpuStrokeFeedRevision | null = latest;
  let remainingSteps = latest.revision + 1;
  while (cursor && cursor.pointCount > previousPointCount) {
    if (
      remainingSteps <= 0
      || !isTrustedStudioGpuStrokeFeedRevision(cursor)
      || (cursor.parent !== null && (
        !isTrustedStudioGpuStrokeFeedRevision(cursor.parent)
        || cursor.parent.revision !== cursor.revision - 1
        || cursor.parent.pointCount >= cursor.pointCount
      ))
    ) return null;
    remainingSteps -= 1;
    revisions.push(cursor);
    cursor = cursor.parent;
  }
  if (
    !cursor
    || !isTrustedStudioGpuStrokeFeedRevision(cursor)
    || cursor.pointCount !== previousPointCount
    || cursor.lineage !== latest.lineage
  ) {
    return null;
  }
  // One accepted catch-up delivery may legally carry STUDIO_GPU_STROKE_FEED_MAX_ADVANCE_POINTS
  // samples (200k coordinates). Spreading such a suffix into `push(...)` exceeds engine argument
  // limits (~65k on JSC, ~124k on V8), so the bridge is preallocated and filled by index.
  const suffixSampleCount = latest.pointCount - cursor.pointCount;
  const points = new Array<number>((suffixSampleCount + 1) * 2);
  const pressures = new Array<number>(suffixSampleCount + 1);
  points[0] = cursor.lastX;
  points[1] = cursor.lastY;
  pressures[0] = cursor.lastPressure;
  let pointOffset = 2;
  let pressureOffset = 1;
  for (let revisionIndex = revisions.length - 1; revisionIndex >= 0; revisionIndex -= 1) {
    const revision = revisions[revisionIndex]!;
    const { suffixPoints, suffixPressures } = revision;
    for (let index = 0; index < suffixPoints.length; index += 1) {
      points[pointOffset++] = suffixPoints[index]!;
    }
    for (let index = 0; index < suffixPressures.length; index += 1) {
      pressures[pressureOffset++] = suffixPressures[index]!;
    }
  }
  // The trusted revision chain guarantees suffix lengths sum to the point-count delta; a forged or
  // corrupted lineage that breaks that invariant must fail closed instead of emitting sparse holes.
  if (pointOffset !== points.length || pressureOffset !== pressures.length) return null;
  return {
    id: stroke.id,
    points,
    pressures,
    color: stroke.color,
    size: stroke.size,
    ...(stroke.pressureModel === undefined ? {} : { pressureModel: stroke.pressureModel }),
    opacity: stroke.opacity,
    composite: stroke.composite,
    orderKey: stroke.orderKey,
  };
}

/** Finds the immutable feed revision that owns exactly one retained source-point prefix. */
export function studioGpuStrokeFeedRevisionAtPointCount(
  stroke: StudioGpuStroke,
  pointCount: number
): StudioGpuStrokeFeedRevision | null {
  const latest = stroke[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    !isTrustedStudioGpuStrokeFeedStroke(stroke)
    || !isTrustedStudioGpuStrokeFeedRevision(latest)
    || !Number.isSafeInteger(pointCount)
    || pointCount < 1
  ) return null;
  let cursor: StudioGpuStrokeFeedRevision | null = latest;
  let remainingSteps = latest.revision + 1;
  while (cursor && cursor.pointCount > pointCount) {
    if (
      remainingSteps <= 0
      || !isTrustedStudioGpuStrokeFeedRevision(cursor)
      || (cursor.parent !== null && (
        !isTrustedStudioGpuStrokeFeedRevision(cursor.parent)
        || cursor.parent.revision !== cursor.revision - 1
        || cursor.parent.pointCount >= cursor.pointCount
      ))
    ) return null;
    remainingSteps -= 1;
    cursor = cursor.parent;
  }
  return cursor
    && isTrustedStudioGpuStrokeFeedRevision(cursor)
    && cursor.pointCount === pointCount
    && cursor.lineage === latest.lineage
    ? cursor
    : null;
}

function exactPrefixReferences(
  previous: readonly StudioGpuStroke[],
  next: readonly StudioGpuStroke[],
  count: number
): boolean {
  for (let index = 0; index < count; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

/**
 * Constant-history planner for the existing pinned full-array adapter. The pinned API already
 * promises immutable prefixes; incompatible shapes/styles are routed to the full rebuild path.
 */
export function planStudioGpuPinnedStrokeFeedUpdate(
  previous: readonly StudioGpuStroke[] | null,
  next: readonly StudioGpuStroke[]
): StudioGpuPinnedStrokeFeedUpdate {
  if (next.length === 0) return { mode: "reset" };
  if (!previous || previous.length === 0) {
    return { mode: "replace", strokes: next };
  }
  if (next.length > previous.length && exactPrefixReferences(previous, next, previous.length)) {
    return {
      mode: "append-operations",
      patch: {
        previousStrokeCount: previous.length,
        suffixStrokes: next.slice(previous.length),
        fallbackStrokes: next,
      },
    };
  }
  if (previous.length !== next.length) return { mode: "replace", strokes: next };
  const terminalIndex = next.length - 1;
  if (!exactPrefixReferences(previous, next, terminalIndex)) {
    return { mode: "replace", strokes: next };
  }
  const before = previous[terminalIndex]!;
  const after = next[terminalIndex]!;
  if (!sameStudioGpuStrokeFeedStyle(before, after)) {
    return { mode: "replace", strokes: next };
  }
  const previousPointCount = before.points.length / 2;
  const nextPointCount = after.points.length / 2;
  if (
    !Number.isSafeInteger(previousPointCount)
    || !Number.isSafeInteger(nextPointCount)
    || previousPointCount < 1
    || nextPointCount < previousPointCount
  ) {
    return { mode: "replace", strokes: next };
  }
  if (nextPointCount === previousPointCount) {
    // Pinned feeds promise immutable prefixes. Equal length therefore means a receipt/authority
    // refresh with no pixel change; arbitrary edits must use replacePinnedStrokes/full render.
    return { mode: "retain", strokes: next };
  }
  const suffixPoints = after.points.slice(previousPointCount * 2);
  const suffixPressures = Array.from(
    { length: nextPointCount - previousPointCount },
    (_, index) => pressureAt(after, previousPointCount + index)
  );
  return {
    mode: "append",
    patch: {
      strokeIndex: terminalIndex,
      previousPointCount,
      suffixPoints,
      suffixPressures,
      nextStroke: after,
      fallbackStrokes: next,
    },
  };
}
