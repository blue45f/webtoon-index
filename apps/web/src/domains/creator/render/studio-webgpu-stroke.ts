import {
  STUDIO_INK_MAX_BRUSH_SIZE,
  resolveStudioInkPressure,
  studioInkPressureRadius,
  type StudioInkPressureModel,
} from "../brush/studio-ink-pressure-model";

import type { StudioResidualInkState } from "../studio-causal-ink";

export type StudioGpuComposite = "normal" | "erase";

/**
 * Immutable root geometry retained by an append-only feed for device-loss/rebuild recovery.
 * The point arrays are canonical GPU samples and may alias the already-frozen baseline arrays;
 * suffix revisions must never replace or mutate this checkpoint.
 */
export interface StudioGpuStrokeFeedRecoveryCheckpoint {
  readonly lineage: string;
  readonly pointCount: number;
  readonly points: readonly number[];
  readonly pressures: readonly number[];
  readonly id: string;
  readonly color: string;
  readonly size: number;
  readonly pressureModel?: StudioInkPressureModel;
  readonly opacity?: number;
  readonly composite?: StudioGpuComposite;
  readonly orderKey?: string;
  readonly styleSignature: string;
  readonly trustedImmutable: true;
}

/**
 * Opaque lineage carried only by the imperative live-stroke feed. A revision proves that the
 * current samples were produced by appending the recorded suffix to its parent revision; normal
 * document strokes never receive this metadata and continue through exact full-array comparison.
 */
export interface StudioGpuStrokeFeedRevision {
  readonly lineage: string;
  readonly revision: number;
  readonly token: string;
  readonly pointCount: number;
  readonly parent: StudioGpuStrokeFeedRevision | null;
  readonly parentPointCount: number;
  /** Newly appended coordinate pairs only; the parent endpoint is kept separately. */
  readonly suffixPoints: readonly number[];
  readonly suffixPressures: readonly number[];
  readonly lastX: number;
  readonly lastY: number;
  readonly lastPressure: number;
  /** Cached append-only brush phase for residual V2; absent for frozen legacy/V1 strokes. */
  readonly residualInkState?: StudioResidualInkState;
  readonly residualDabCount?: number;
  /** Round-dab bounds before the caller-specific tile bleed is added. */
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
  readonly styleSignature: string;
  /** Present only on revision zero. Descendants reach it through their immutable parent chain. */
  readonly recoveryCheckpoint: StudioGpuStrokeFeedRecoveryCheckpoint | null;
  readonly trustedImmutable: true;
}

export const STUDIO_GPU_STROKE_FEED_REVISION: unique symbol = Symbol(
  "StudioGpuStrokeFeedRevision"
);

// `trustedImmutable` is descriptive metadata, not an authority token: callers can copy or forge
// the public symbol. Only wrappers registered by the feed implementation may bypass the ordinary
// deep snapshot boundary. Keeping the registry in this module avoids a stroke -> feed import cycle.
const trustedStudioGpuStrokeFeedStrokes = new WeakSet<object>();

export interface StudioGpuStroke {
  readonly id: string;
  readonly points: readonly number[];
  readonly pressures?: readonly number[];
  readonly color: string;
  readonly size: number;
  readonly pressureModel?: StudioInkPressureModel;
  readonly opacity?: number;
  readonly composite?: StudioGpuComposite;
  readonly orderKey?: string;
  /** Internal append-only proof. It does not alter paint semantics or serialized document data. */
  readonly [STUDIO_GPU_STROKE_FEED_REVISION]?: StudioGpuStrokeFeedRevision;
}

export function isTrustedStudioGpuStrokeFeedStroke(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && trustedStudioGpuStrokeFeedStrokes.has(value);
}

/** @internal Feed wrappers must be frozen before they receive in-process snapshot authority. */
export function registerTrustedStudioGpuStrokeFeedStroke(stroke: StudioGpuStroke): void {
  if (
    !Object.isFrozen(stroke)
    || !Array.isArray(stroke.points)
    || !Object.isFrozen(stroke.points)
    || (stroke.pressures !== undefined && (
      !Array.isArray(stroke.pressures) || !Object.isFrozen(stroke.pressures)
    ))
  ) {
    throw new TypeError("A trusted GPU stroke feed wrapper and its sample arrays must be frozen");
  }
  trustedStudioGpuStrokeFeedStrokes.add(stroke);
}

/**
 * Already-sampled live drawing input. The caller owns distance filtering and stabilization; this
 * boundary only snapshots GPU-safe samples so extending a stroke can never rewrite its history.
 */
export interface StudioGpuLiveStrokeInput {
  readonly id: string;
  readonly points: readonly number[];
  readonly pressures?: readonly number[];
  readonly color: string;
  readonly size: number;
  readonly pressureModel?: StudioInkPressureModel;
  readonly opacity?: number;
  readonly composite?: StudioGpuComposite;
}

export const STUDIO_GPU_MAX_BRUSH_SIZE = STUDIO_INK_MAX_BRUSH_SIZE;

/** Values uploaded to GPU float buffers must remain finite after Float32 conversion. */
export function isStudioGpuFiniteScalar(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isFinite(Math.fround(value));
}

export function sameStudioGpuNumberArray(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

/**
 * Exact semantic equality used at the authoritative Konva/WebGPU handoff boundary.
 * A hash is intentionally insufficient here: a collision must never hide the source pixels.
 */
export function sameStudioGpuStroke(left: StudioGpuStroke, right: StudioGpuStroke): boolean {
  if (
    left.id !== right.id
    || left.color !== right.color
    || !Object.is(left.size, right.size)
    || left.pressureModel !== right.pressureModel
    || !Object.is(left.opacity, right.opacity)
    || left.composite !== right.composite
    || left.orderKey !== right.orderKey
  ) {
    return false;
  }
  const leftRevision = left[STUDIO_GPU_STROKE_FEED_REVISION];
  const rightRevision = right[STUDIO_GPU_STROKE_FEED_REVISION];
  if (
    leftRevision
    && rightRevision
    && leftRevision.token === rightRevision.token
    && left.points === right.points
    && left.pressures === right.pressures
  ) {
    return true;
  }
  return sameStudioGpuNumberArray(left.points, right.points)
    && sameStudioGpuNumberArray(left.pressures, right.pressures);
}

export function sameStudioGpuStrokes(
  left: readonly StudioGpuStroke[],
  right: readonly StudioGpuStroke[]
): boolean {
  return left === right || (
    left.length === right.length
    && left.every((stroke, index) => sameStudioGpuStroke(stroke, right[index]!))
  );
}

export function snapshotStudioGpuStroke(stroke: StudioGpuStroke): StudioGpuStroke {
  if (isTrustedStudioGpuStrokeFeedStroke(stroke)) return stroke;
  return {
    ...stroke,
    points: [...stroke.points],
    pressures: stroke.pressures ? [...stroke.pressures] : undefined,
  };
}

export function snapshotStudioGpuStrokes(
  strokes: readonly StudioGpuStroke[]
): readonly StudioGpuStroke[] {
  return strokes.map(snapshotStudioGpuStroke);
}

/**
 * Snapshots an append-only live stroke for the WebGPU renderer.
 *
 * Points have already passed the pointer sampler/stabilizer and are deliberately not smoothed or
 * resampled here. Copying only the longest finite pair prefix, and resolving pressure by the same
 * point index, guarantees that appending a new sample leaves every historical GPU sample exact.
 */
export function buildStudioGpuLiveStroke(
  input: StudioGpuLiveStrokeInput
): StudioGpuStroke | null {
  const points: number[] = [];
  for (let index = 0; index + 1 < input.points.length; index += 2) {
    const x = input.points[index];
    const y = input.points[index + 1];
    if (!isStudioGpuFiniteScalar(x) || !isStudioGpuFiniteScalar(y)) break;
    points.push(x!, y!);
  }

  // The engine plans an initial dab for a single coordinate pair. Keeping that tap here is
  // important: while WebGPU owns the live surface, the Canvas/Konva draft is intentionally hidden.
  if (points.length < 2) return null;

  const pointCount = points.length / 2;
  const pressures = Array.from(
    { length: pointCount },
    (_, index) => resolveStudioInkPressure(input.pressures?.[index], input.pressureModel)
  );

  return {
    id: input.id,
    points: Object.freeze(points),
    pressures: Object.freeze(pressures),
    color: input.color,
    size: input.size,
    ...(input.pressureModel === undefined ? {} : { pressureModel: input.pressureModel }),
    opacity: input.opacity,
    composite: input.composite,
  };
}

export function studioGpuPressureRadius(
  size: number,
  pressure: number,
  pressureModel?: StudioInkPressureModel
): number {
  return studioInkPressureRadius(size, pressure, pressureModel);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function orderStudioGpuStrokes(
  strokes: readonly StudioGpuStroke[]
): readonly StudioGpuStroke[] {
  if (!strokes.some((stroke) => stroke.orderKey !== undefined)) return strokes;
  return strokes
    .map((stroke, index) => ({ stroke, index }))
    .sort((left, right) => {
      const leftKey = left.stroke.orderKey;
      const rightKey = right.stroke.orderKey;
      if (leftKey !== undefined && rightKey !== undefined) {
        // CRDT order must be identical across browsers/locales, so use UTF-16 code-unit order.
        const order = compareCodeUnits(leftKey, rightKey);
        if (order !== 0) return order;
      } else if (leftKey !== undefined) {
        return -1;
      } else if (rightKey !== undefined) {
        return 1;
      }
      return left.index - right.index;
    })
    .map(({ stroke }) => stroke);
}
