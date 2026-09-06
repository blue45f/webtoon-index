/**
 * Renderer-facing adapter for velocity-Bézier handwriting paths.
 *
 * DrawEl stores coordinates and pressure as parallel flat arrays. This boundary validates those
 * arrays, converts every source pair to canonical pressure provenance, invokes the handwriting
 * finalizer with `source-pressure` as an invariant, and adaptively flattens cubic segments into
 * bounded `[x,y]` and pressure/width station arrays consumable by Canvas, dab walkers, or WebGPU.
 *
 * The live adapter retains settled stations in append-only storage. Only newly settled cubics and
 * the replaceable preview tail are flattened on each transition. Pointer-up performs one O(N)
 * committed replay so saved/replayed geometry is byte-for-byte equal to the batch adapter.
 */

import {
  STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS,
  STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION,
  appendStudioVelocityBezierHandwritingSamples,
  createStudioVelocityBezierHandwritingStream,
  finalizeStudioVelocityBezierHandwriting,
  sealStudioVelocityBezierHandwritingStream,
  type StudioVelocityBezierFinalizerFailureReason,
  type StudioVelocityBezierFinalizerOptions,
  type StudioVelocityBezierPath,
  type StudioVelocityBezierSegment,
  type StudioVelocityBezierSourceSample,
  type StudioVelocityBezierStreamState,
} from "./studio-velocity-bezier-handwriting-finalizer";

import type { DrawEl } from "./studio-element-model";

export const STUDIO_VELOCITY_BEZIER_INK_ADAPTER_VERSION =
  "velocity-bezier-ink-adapter-v1" as const;

export const STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS = Object.freeze({
  maxStations: 262_144,
  maxSubdivisionDepth: 24,
  maxFlatness: 64,
  maxStationSpacing: 4_096,
  maxSampleIntervalMilliseconds: 1_000,
} as const);

export interface StudioVelocityBezierInkDrawSource {
  readonly id: DrawEl["id"];
  readonly points: readonly number[];
  readonly pressures: readonly number[] | undefined;
  readonly strokeWidth: DrawEl["strokeWidth"];
}

export interface StudioVelocityBezierInkAdapterOptions {
  /** Maximum perpendicular control-point deviation before a cubic leaf is accepted. */
  readonly flatness?: number;
  /** Maximum control-polygon length of one accepted leaf; bounds its true arc length. */
  readonly maximumStationSpacing?: number;
  readonly maximumSubdivisionDepth?: number;
  readonly maximumStations?: number;
  /** DrawEl has no timestamps; deterministic canonical replay uses this fixed interval. */
  readonly sampleIntervalMilliseconds?: number;
  readonly handleTension?: number;
  readonly maximumHandleRatio?: number;
}

export interface StudioVelocityBezierInkResolvedOptions {
  readonly flatness: number;
  readonly maximumStationSpacing: number;
  readonly maximumSubdivisionDepth: number;
  readonly maximumStations: number;
  readonly sampleIntervalMilliseconds: number;
  readonly handleTension: number;
  readonly maximumHandleRatio: number;
  readonly widthStrategy: "source-pressure";
}

export interface StudioVelocityBezierInkStation {
  readonly ordinal: number;
  readonly segmentIndex: number;
  readonly parameter: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly width: number;
  readonly distance: number;
  readonly fromSequence: number;
  readonly toSequence: number;
  /** Preview arrays repeat their settled boundary so they can render on an isolated overlay. */
  readonly bridge: boolean;
  readonly primitive: "curve" | "tap";
}

export interface StudioVelocityBezierInkPlan {
  readonly kind: "studio-velocity-bezier-ink-plan";
  readonly version: typeof STUDIO_VELOCITY_BEZIER_INK_ADAPTER_VERSION;
  readonly finalizerVersion: typeof STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION;
  readonly drawId: string;
  readonly phase: "preview" | "committed";
  readonly strokeWidth: number;
  readonly options: StudioVelocityBezierInkResolvedOptions;
  readonly sourcePath: StudioVelocityBezierPath;
  readonly settledStations: readonly StudioVelocityBezierInkStation[];
  readonly previewStations: readonly StudioVelocityBezierInkStation[];
  readonly settledPoints: readonly number[];
  readonly settledPressures: readonly number[];
  readonly settledWidths: readonly number[];
  readonly previewPoints: readonly number[];
  readonly previewPressures: readonly number[];
  readonly previewWidths: readonly number[];
  readonly settledLength: number;
  readonly totalLength: number;
}

export interface StudioVelocityBezierInkBatchInput {
  readonly draw: StudioVelocityBezierInkDrawSource;
  readonly phase?: "preview" | "committed";
  readonly options?: StudioVelocityBezierInkAdapterOptions;
}

export type StudioVelocityBezierInkFailureReason =
  | "budget-exceeded"
  | "finalizer-rejected"
  | "flattening-limit"
  | "invalid-input"
  | "invalid-options"
  | "numeric-overflow"
  | "prefix-mismatch"
  | "sealed-stream";

export type StudioVelocityBezierInkPlanResult =
  | Readonly<{ ok: true; value: StudioVelocityBezierInkPlan }>
  | Readonly<{
      ok: false;
      reason: StudioVelocityBezierInkFailureReason;
      sourceReason?: StudioVelocityBezierFinalizerFailureReason;
      sourceSampleIndex?: number;
    }>;

export interface StudioVelocityBezierInkStreamCreateInput {
  readonly drawId: string;
  readonly strokeWidth: number;
  readonly options?: StudioVelocityBezierInkAdapterOptions;
}

export interface StudioVelocityBezierInkStreamAppendInput {
  /** Stale or skipped full-prefix writers fail before the suffix is admitted. */
  readonly previousSourceSampleCount: number;
  /** Newly admitted coordinate pairs only. */
  readonly points: readonly number[];
  readonly pressures: readonly number[];
}

export interface StudioVelocityBezierInkStreamMetrics {
  readonly acceptedSourceSamples: number;
  readonly evaluatedCubicSegments: number;
  /** Includes newly settled stations and each replaceable preview-tail evaluation. */
  readonly emittedStationWork: number;
  readonly appendTransitions: number;
  readonly branchPrefixCopies: number;
  readonly finalizerEvaluatedSegments: number;
}

export interface StudioVelocityBezierInkStreamState {
  readonly kind: "studio-velocity-bezier-ink-stream";
  readonly version: typeof STUDIO_VELOCITY_BEZIER_INK_ADAPTER_VERSION;
  readonly drawId: string;
  readonly strokeWidth: number;
  readonly sealed: boolean;
  readonly options: StudioVelocityBezierInkResolvedOptions;
  readonly sourceSampleCount: number;
  readonly finalizerState: StudioVelocityBezierStreamState;
  readonly metrics: StudioVelocityBezierInkStreamMetrics;
}

export type StudioVelocityBezierInkStreamResult =
  | Readonly<{
      ok: true;
      state: StudioVelocityBezierInkStreamState;
      plan: StudioVelocityBezierInkPlan;
    }>
  | Readonly<{
      ok: false;
      reason: StudioVelocityBezierInkFailureReason;
      sourceReason?: StudioVelocityBezierFinalizerFailureReason;
      sourceSampleIndex?: number;
    }>;

const DEFAULT_OPTIONS: StudioVelocityBezierInkResolvedOptions = Object.freeze({
  flatness: 0.25,
  maximumStationSpacing: 2,
  maximumSubdivisionDepth: 18,
  maximumStations: STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS.maxStations,
  sampleIntervalMilliseconds: 1,
  handleTension: 2 / 3,
  maximumHandleRatio: 0.75,
  widthStrategy: "source-pressure",
});

const MAX_COORDINATE =
  STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxCoordinateAbsolute;
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;
const EPSILON = 1e-9;

interface FlattenNode {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly x3: number;
  readonly y3: number;
  readonly t0: number;
  readonly t1: number;
  readonly depth: number;
}

interface FlattenResult {
  readonly stations: readonly StudioVelocityBezierInkStation[];
  readonly endDistance: number;
}

interface InkStreamBuffers {
  readonly settledStations: StudioVelocityBezierInkStation[];
}

interface InkStreamCache {
  readonly buffers: InkStreamBuffers;
  readonly settledStationCount: number;
  readonly settledSegmentCount: number;
  readonly metrics: StudioVelocityBezierInkStreamMetrics;
}

const STREAM_CACHE = new WeakMap<
  StudioVelocityBezierInkStreamState,
  InkStreamCache
>();

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function failed(
  reason: StudioVelocityBezierInkFailureReason,
  sourceReason?: StudioVelocityBezierFinalizerFailureReason,
  sourceSampleIndex?: number,
): StudioVelocityBezierInkPlanResult {
  return Object.freeze({
    ok: false,
    reason,
    ...(sourceReason === undefined ? {} : { sourceReason }),
    ...(sourceSampleIndex === undefined ? {} : { sourceSampleIndex }),
  });
}

function streamFailed(
  reason: StudioVelocityBezierInkFailureReason,
  sourceReason?: StudioVelocityBezierFinalizerFailureReason,
  sourceSampleIndex?: number,
): StudioVelocityBezierInkStreamResult {
  return Object.freeze({
    ok: false,
    reason,
    ...(sourceReason === undefined ? {} : { sourceReason }),
    ...(sourceSampleIndex === undefined ? {} : { sourceSampleIndex }),
  });
}

function finalizerFailureReason(
  reason: StudioVelocityBezierFinalizerFailureReason,
): StudioVelocityBezierInkFailureReason {
  if (reason === "budget-exceeded") return "budget-exceeded";
  if (reason === "invalid-options") return "invalid-options";
  if (reason === "sealed-stream") return "sealed-stream";
  return "finalizer-rejected";
}

function resolveOptions(
  options: StudioVelocityBezierInkAdapterOptions | undefined,
): StudioVelocityBezierInkResolvedOptions | null {
  const value = options ?? {};
  const flatness = value.flatness ?? DEFAULT_OPTIONS.flatness;
  const maximumStationSpacing =
    value.maximumStationSpacing ?? DEFAULT_OPTIONS.maximumStationSpacing;
  const maximumSubdivisionDepth =
    value.maximumSubdivisionDepth ?? DEFAULT_OPTIONS.maximumSubdivisionDepth;
  const maximumStations = value.maximumStations ?? DEFAULT_OPTIONS.maximumStations;
  const sampleIntervalMilliseconds =
    value.sampleIntervalMilliseconds ?? DEFAULT_OPTIONS.sampleIntervalMilliseconds;
  const handleTension = value.handleTension ?? DEFAULT_OPTIONS.handleTension;
  const maximumHandleRatio =
    value.maximumHandleRatio ?? DEFAULT_OPTIONS.maximumHandleRatio;
  if (
    !finiteInRange(
      flatness,
      Number.EPSILON,
      STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS.maxFlatness,
    )
    || !finiteInRange(
      maximumStationSpacing,
      Number.EPSILON,
      STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS.maxStationSpacing,
    )
    || !Number.isSafeInteger(maximumSubdivisionDepth)
    || maximumSubdivisionDepth < 1
    || maximumSubdivisionDepth
      > STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS.maxSubdivisionDepth
    || !Number.isSafeInteger(maximumStations)
    || maximumStations < 1
    || maximumStations > STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS.maxStations
    || !finiteInRange(
      sampleIntervalMilliseconds,
      Number.EPSILON,
      STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS.maxSampleIntervalMilliseconds,
    )
    || !finiteInRange(handleTension, 0, 1)
    || !finiteInRange(maximumHandleRatio, 0, 2)
  ) return null;
  return Object.freeze({
    flatness: canonicalNumber(flatness),
    maximumStationSpacing: canonicalNumber(maximumStationSpacing),
    maximumSubdivisionDepth,
    maximumStations,
    sampleIntervalMilliseconds: canonicalNumber(sampleIntervalMilliseconds),
    handleTension: canonicalNumber(handleTension),
    maximumHandleRatio: canonicalNumber(maximumHandleRatio),
    widthStrategy: "source-pressure",
  });
}

function finalizerOptions(
  strokeWidth: number,
  options: StudioVelocityBezierInkResolvedOptions,
): StudioVelocityBezierFinalizerOptions {
  return {
    minimumWidth: 0,
    maximumWidth: strokeWidth,
    widthStrategy: "source-pressure",
    handleTension: options.handleTension,
    maximumHandleRatio: options.maximumHandleRatio,
    maximumSamples: STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxSamples,
  };
}

function sourceSamples(
  points: readonly number[],
  pressures: readonly number[] | undefined,
  startSequence: number,
  interval: number,
): readonly StudioVelocityBezierSourceSample[] | null {
  if (
    !Array.isArray(points)
    || points.length % 2 !== 0
    || !Array.isArray(pressures)
    || pressures.length !== points.length / 2
  ) return null;
  const samples: StudioVelocityBezierSourceSample[] = [];
  for (let index = 0; index < pressures.length; index += 1) {
    const x = points[index * 2];
    const y = points[index * 2 + 1];
    const pressure = pressures[index];
    const sequence = startSequence + index;
    const timeMilliseconds = sequence * interval;
    if (
      !Number.isSafeInteger(sequence)
      || !finiteInRange(x, -MAX_COORDINATE, MAX_COORDINATE)
      || !finiteInRange(y, -MAX_COORDINATE, MAX_COORDINATE)
      || !finiteInRange(pressure, 0, 1)
      || !finiteInRange(timeMilliseconds, 0, Number.MAX_SAFE_INTEGER)
    ) return null;
    samples.push(
      Object.freeze({
        sequence,
        x: canonicalNumber(x),
        y: canonicalNumber(y),
        timeMilliseconds: canonicalNumber(timeMilliseconds),
        pressure: canonicalNumber(pressure),
        pressureProvenance: Object.freeze({
          source: "canonical" as const,
          sourceSequence: sequence,
          inputPressure: canonicalNumber(pressure),
          resolvedPressure: canonicalNumber(pressure),
        }),
      }),
    );
  }
  return Object.freeze(samples);
}

function frozenArraySnapshot<T>(
  length: number,
  valueAt: (index: number) => T,
): readonly T[] {
  const target = Object.freeze(new Array<T>(length));
  return new Proxy(target, {
    get(array, property, receiver) {
      if (typeof property === "string" && ARRAY_INDEX.test(property)) {
        const index = Number(property);
        if (index < length) return valueAt(index);
      }
      return Reflect.get(array, property, receiver);
    },
    has(array, property) {
      if (typeof property === "string" && ARRAY_INDEX.test(property)) {
        const index = Number(property);
        if (index < length) return true;
      }
      return Reflect.has(array, property);
    },
  });
}

function pointLineDistance(
  x: number,
  y: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const denominator = Math.hypot(dx, dy);
  if (denominator <= EPSILON) return Math.hypot(x - x0, y - y0);
  return Math.abs(dy * x - dx * y + x1 * y0 - y1 * x0) / denominator;
}

function nodeFlatness(node: FlattenNode): number {
  return Math.max(
    pointLineDistance(
      node.x1,
      node.y1,
      node.x0,
      node.y0,
      node.x3,
      node.y3,
    ),
    pointLineDistance(
      node.x2,
      node.y2,
      node.x0,
      node.y0,
      node.x3,
      node.y3,
    ),
  );
}

function controlPolygonLength(node: FlattenNode): number {
  return Math.hypot(node.x1 - node.x0, node.y1 - node.y0)
    + Math.hypot(node.x2 - node.x1, node.y2 - node.y1)
    + Math.hypot(node.x3 - node.x2, node.y3 - node.y2);
}

function splitNode(node: FlattenNode): readonly [FlattenNode, FlattenNode] {
  const x01 = (node.x0 + node.x1) / 2;
  const y01 = (node.y0 + node.y1) / 2;
  const x12 = (node.x1 + node.x2) / 2;
  const y12 = (node.y1 + node.y2) / 2;
  const x23 = (node.x2 + node.x3) / 2;
  const y23 = (node.y2 + node.y3) / 2;
  const x012 = (x01 + x12) / 2;
  const y012 = (y01 + y12) / 2;
  const x123 = (x12 + x23) / 2;
  const y123 = (y12 + y23) / 2;
  const x0123 = (x012 + x123) / 2;
  const y0123 = (y012 + y123) / 2;
  const middleParameter = (node.t0 + node.t1) / 2;
  const depth = node.depth + 1;
  return [
    {
      x0: node.x0,
      y0: node.y0,
      x1: x01,
      y1: y01,
      x2: x012,
      y2: y012,
      x3: x0123,
      y3: y0123,
      t0: node.t0,
      t1: middleParameter,
      depth,
    },
    {
      x0: x0123,
      y0: y0123,
      x1: x123,
      y1: y123,
      x2: x23,
      y2: y23,
      x3: node.x3,
      y3: node.y3,
      t0: middleParameter,
      t1: node.t1,
      depth,
    },
  ];
}

function station(
  segment: StudioVelocityBezierSegment,
  parameter: number,
  x: number,
  y: number,
  pressure: number,
  width: number,
  distance: number,
  ordinal: number,
  bridge: boolean,
): StudioVelocityBezierInkStation | null {
  if (
    ![
      parameter,
      x,
      y,
      pressure,
      width,
      distance,
    ].every(Number.isFinite)
  ) return null;
  return Object.freeze({
    ordinal,
    segmentIndex: segment.index,
    parameter: canonicalNumber(parameter),
    x: canonicalNumber(x),
    y: canonicalNumber(y),
    pressure: canonicalNumber(pressure),
    width: canonicalNumber(width),
    distance: canonicalNumber(distance),
    fromSequence: segment.fromSequence,
    toSequence: segment.toSequence,
    bridge,
    primitive: "curve",
  });
}

function flattenSegment(
  segment: StudioVelocityBezierSegment,
  startPressure: number,
  endPressure: number,
  options: StudioVelocityBezierInkResolvedOptions,
  startDistance: number,
  startOrdinal: number,
  includeStart: boolean,
  bridgeStart: boolean,
  stationBudget: number,
): FlattenResult | StudioVelocityBezierInkFailureReason {
  const stations: StudioVelocityBezierInkStation[] = [];
  let previousX = segment.p0.x;
  let previousY = segment.p0.y;
  let distance = startDistance;
  if (includeStart) {
    if (stationBudget < 1) return "budget-exceeded";
    const first = station(
      segment,
      0,
      segment.p0.x,
      segment.p0.y,
      startPressure,
      segment.startWidth,
      distance,
      startOrdinal,
      bridgeStart,
    );
    if (!first) return "numeric-overflow";
    stations.push(first);
  }

  const stack: FlattenNode[] = [{
    x0: segment.p0.x,
    y0: segment.p0.y,
    x1: segment.c1.x,
    y1: segment.c1.y,
    x2: segment.c2.x,
    y2: segment.c2.y,
    x3: segment.p3.x,
    y3: segment.p3.y,
    t0: 0,
    t1: 1,
    depth: 0,
  }];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const polygonLength = controlPolygonLength(node);
    const flatness = nodeFlatness(node);
    if (!Number.isFinite(polygonLength) || !Number.isFinite(flatness)) {
      return "numeric-overflow";
    }
    if (
      flatness > options.flatness
      || polygonLength > options.maximumStationSpacing
    ) {
      if (node.depth >= options.maximumSubdivisionDepth) {
        return "flattening-limit";
      }
      // Every pending leaf emits one station. Subdivision adds one more eventual leaf.
      if (stations.length + stack.length + 2 > stationBudget) {
        return "budget-exceeded";
      }
      const [left, right] = splitNode(node);
      stack.push(right, left);
      continue;
    }
    if (stations.length >= stationBudget) return "budget-exceeded";
    distance += Math.hypot(node.x3 - previousX, node.y3 - previousY);
    // Preserve source endpoints bit-for-bit; the algebraically equivalent interpolation can add a
    // final ULP (for example 0.3 + (0.9 - 0.3) * 1).
    const pressure = node.t1 === 1
      ? endPressure
      : startPressure + (endPressure - startPressure) * node.t1;
    const width = node.t1 === 1
      ? segment.endWidth
      : segment.startWidth + (segment.endWidth - segment.startWidth) * node.t1;
    const next = station(
      segment,
      node.t1,
      node.x3,
      node.y3,
      pressure,
      width,
      distance,
      startOrdinal + stations.length,
      false,
    );
    if (!next) return "numeric-overflow";
    stations.push(next);
    previousX = node.x3;
    previousY = node.y3;
  }
  return {
    stations: Object.freeze(stations),
    endDistance: canonicalNumber(distance),
  };
}

function flattenSegments(
  path: StudioVelocityBezierPath,
  segments: readonly StudioVelocityBezierSegment[],
  options: StudioVelocityBezierInkResolvedOptions,
  startDistance: number,
  startOrdinal: number,
  includeFirstStart: boolean,
  bridgeFirstStart: boolean,
  maximumAdditionalStations: number,
): FlattenResult | StudioVelocityBezierInkFailureReason {
  const stations: StudioVelocityBezierInkStation[] = [];
  let distance = startDistance;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const startKnot = path.knots[segment.fromSampleIndex];
    const endKnot = path.knots[segment.toSampleIndex];
    if (!startKnot || !endKnot) return "invalid-input";
    const flattened = flattenSegment(
      segment,
      startKnot.pressure,
      endKnot.pressure,
      options,
      distance,
      startOrdinal + stations.length,
      includeFirstStart && index === 0,
      bridgeFirstStart && index === 0,
      maximumAdditionalStations - stations.length,
    );
    if (typeof flattened === "string") return flattened;
    stations.push(...flattened.stations);
    distance = flattened.endDistance;
  }
  return {
    stations: Object.freeze(stations),
    endDistance: canonicalNumber(distance),
  };
}

function tapStation(
  path: StudioVelocityBezierPath,
  strokeWidth: number,
  bridge: boolean,
): StudioVelocityBezierInkStation | null {
  const tap = path.tap;
  if (!tap) return null;
  return Object.freeze({
    ordinal: 0,
    segmentIndex: -1,
    parameter: 0,
    x: tap.x,
    y: tap.y,
    pressure: tap.pressure,
    width: strokeWidth * tap.pressure,
    distance: 0,
    fromSequence: tap.sequence,
    toSequence: tap.sequence,
    bridge,
    primitive: "tap",
  });
}

function channelPoints(
  stations: readonly StudioVelocityBezierInkStation[],
): readonly number[] {
  return Object.freeze(stations.flatMap(({ x, y }) => [x, y]));
}

function channelPressures(
  stations: readonly StudioVelocityBezierInkStation[],
): readonly number[] {
  return Object.freeze(stations.map(({ pressure }) => pressure));
}

function channelWidths(
  stations: readonly StudioVelocityBezierInkStation[],
): readonly number[] {
  return Object.freeze(stations.map(({ width }) => width));
}

function frozenPlan(
  path: StudioVelocityBezierPath,
  strokeWidth: number,
  options: StudioVelocityBezierInkResolvedOptions,
  settledStations: readonly StudioVelocityBezierInkStation[],
  previewStations: readonly StudioVelocityBezierInkStation[],
  settledPoints = channelPoints(settledStations),
  settledPressures = channelPressures(settledStations),
  settledWidths = channelWidths(settledStations),
): StudioVelocityBezierInkPlan {
  const previewPoints = channelPoints(previewStations);
  const previewPressures = channelPressures(previewStations);
  const previewWidths = channelWidths(previewStations);
  const settledLength = settledStations.at(-1)?.distance ?? 0;
  const totalLength =
    previewStations.at(-1)?.distance
    ?? settledLength;
  return Object.freeze({
    kind: "studio-velocity-bezier-ink-plan",
    version: STUDIO_VELOCITY_BEZIER_INK_ADAPTER_VERSION,
    finalizerVersion: STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION,
    drawId: path.strokeId,
    phase: path.phase,
    strokeWidth,
    options,
    sourcePath: path,
    settledStations,
    previewStations,
    settledPoints,
    settledPressures,
    settledWidths,
    previewPoints,
    previewPressures,
    previewWidths,
    settledLength,
    totalLength,
  });
}

function batchPlanFromPath(
  path: StudioVelocityBezierPath,
  strokeWidth: number,
  options: StudioVelocityBezierInkResolvedOptions,
): StudioVelocityBezierInkPlanResult {
  if (path.options.widthStrategy !== "source-pressure") {
    return failed("invalid-input");
  }
  if (path.tap) {
    const tap = tapStation(path, strokeWidth, path.phase === "preview");
    if (!tap) return failed("numeric-overflow");
    const settled = path.phase === "committed" ? Object.freeze([tap]) : Object.freeze([]);
    const preview = path.phase === "preview" ? Object.freeze([tap]) : Object.freeze([]);
    return Object.freeze({
      ok: true,
      value: frozenPlan(path, strokeWidth, options, settled, preview),
    });
  }

  const settled = flattenSegments(
    path,
    path.settledSegments,
    options,
    0,
    0,
    true,
    false,
    options.maximumStations,
  );
  if (typeof settled === "string") return failed(settled);
  const remaining = options.maximumStations - settled.stations.length;
  const preview = flattenSegments(
    path,
    path.previewSegments,
    options,
    settled.endDistance,
    Math.max(0, settled.stations.length - 1),
    true,
    true,
    remaining,
  );
  if (typeof preview === "string") return failed(preview);
  return Object.freeze({
    ok: true,
    value: frozenPlan(
      path,
      strokeWidth,
      options,
      settled.stations,
      preview.stations,
    ),
  });
}

/** Converts one complete DrawEl-compatible source to a committed or live ink station plan. */
export function adaptStudioVelocityBezierInkDrawElement(
  input: StudioVelocityBezierInkBatchInput,
): StudioVelocityBezierInkPlanResult {
  try {
    if (
      !input
      || !input.draw
      || typeof input.draw.id !== "string"
      || !finiteInRange(
        input.draw.strokeWidth,
        Number.EPSILON,
        STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxWidth,
      )
      || (
        input.phase !== undefined
        && input.phase !== "preview"
        && input.phase !== "committed"
      )
    ) return failed("invalid-input");
    const options = resolveOptions(input.options);
    if (!options) return failed("invalid-options");
    const samples = sourceSamples(
      input.draw.points,
      input.draw.pressures,
      0,
      options.sampleIntervalMilliseconds,
    );
    if (!samples || samples.length === 0) return failed("invalid-input");
    const finalized = finalizeStudioVelocityBezierHandwriting({
      strokeId: input.draw.id,
      samples,
      options: finalizerOptions(input.draw.strokeWidth, options),
      phase: input.phase ?? "committed",
    });
    if (!finalized.ok) {
      return failed(
        finalizerFailureReason(finalized.reason),
        finalized.reason,
        finalized.sampleIndex,
      );
    }
    return batchPlanFromPath(finalized.value, input.draw.strokeWidth, options);
  } catch {
    return failed("invalid-input");
  }
}

function streamMetrics(
  acceptedSourceSamples: number,
  evaluatedCubicSegments: number,
  emittedStationWork: number,
  appendTransitions: number,
  branchPrefixCopies: number,
  finalizerEvaluatedSegments: number,
): StudioVelocityBezierInkStreamMetrics {
  return Object.freeze({
    acceptedSourceSamples,
    evaluatedCubicSegments,
    emittedStationWork,
    appendTransitions,
    branchPrefixCopies,
    finalizerEvaluatedSegments,
  });
}

function stateWithCache(
  drawId: string,
  strokeWidth: number,
  options: StudioVelocityBezierInkResolvedOptions,
  finalizerState: StudioVelocityBezierStreamState,
  cache: InkStreamCache,
): StudioVelocityBezierInkStreamState {
  const state: StudioVelocityBezierInkStreamState = Object.freeze({
    kind: "studio-velocity-bezier-ink-stream",
    version: STUDIO_VELOCITY_BEZIER_INK_ADAPTER_VERSION,
    drawId,
    strokeWidth,
    sealed: false,
    options,
    sourceSampleCount: finalizerState.samples.length,
    finalizerState,
    metrics: cache.metrics,
  });
  STREAM_CACHE.set(state, cache);
  return state;
}

function planFromStreamParts(
  path: StudioVelocityBezierPath,
  strokeWidth: number,
  options: StudioVelocityBezierInkResolvedOptions,
  settledBuffer: readonly StudioVelocityBezierInkStation[],
  settledStationCount: number,
  previewStations: readonly StudioVelocityBezierInkStation[],
): StudioVelocityBezierInkPlan {
  const settledStations = frozenArraySnapshot(
    settledStationCount,
    (index) => settledBuffer[index]!,
  );
  const settledPoints = frozenArraySnapshot(
    settledStationCount * 2,
    (index) => {
      const item = settledBuffer[Math.floor(index / 2)]!;
      return index % 2 === 0 ? item.x : item.y;
    },
  );
  const settledPressures = frozenArraySnapshot(
    settledStationCount,
    (index) => settledBuffer[index]!.pressure,
  );
  const settledWidths = frozenArraySnapshot(
    settledStationCount,
    (index) => settledBuffer[index]!.width,
  );
  return frozenPlan(
    path,
    strokeWidth,
    options,
    settledStations,
    previewStations,
    settledPoints,
    settledPressures,
    settledWidths,
  );
}

/** Creates an empty live adapter. Source suffixes are admitted with the append API below. */
export function createStudioVelocityBezierInkStream(
  input: StudioVelocityBezierInkStreamCreateInput,
): StudioVelocityBezierInkStreamResult {
  if (
    !input
    || typeof input.drawId !== "string"
    || !finiteInRange(
      input.strokeWidth,
      Number.EPSILON,
      STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxWidth,
    )
  ) return streamFailed("invalid-input");
  const options = resolveOptions(input.options);
  if (!options) return streamFailed("invalid-options");
  const created = createStudioVelocityBezierHandwritingStream(
    input.drawId,
    finalizerOptions(input.strokeWidth, options),
  );
  if (!created.ok) {
    return streamFailed(
      finalizerFailureReason(created.reason),
      created.reason,
      created.sampleIndex,
    );
  }
  const cache: InkStreamCache = {
    buffers: { settledStations: [] },
    settledStationCount: 0,
    settledSegmentCount: 0,
    metrics: streamMetrics(0, 0, 0, 0, 0, 0),
  };
  const state = stateWithCache(
    input.drawId,
    input.strokeWidth,
    options,
    created.state,
    cache,
  );
  const plan = planFromStreamParts(
    created.path,
    input.strokeWidth,
    options,
    cache.buffers.settledStations,
    0,
    Object.freeze([]),
  );
  return Object.freeze({ ok: true, state, plan });
}

/** Appends one DrawEl-compatible flat suffix and returns settled-prefix plus replaceable-tail data. */
export function appendStudioVelocityBezierInkStream(
  state: StudioVelocityBezierInkStreamState,
  input: StudioVelocityBezierInkStreamAppendInput,
): StudioVelocityBezierInkStreamResult {
  try {
    if (state.sealed) return streamFailed("sealed-stream");
    if (
      !input
      || !Number.isSafeInteger(input.previousSourceSampleCount)
      || input.previousSourceSampleCount !== state.sourceSampleCount
    ) return streamFailed("prefix-mismatch");
    const samples = sourceSamples(
      input.points,
      input.pressures,
      state.sourceSampleCount,
      state.options.sampleIntervalMilliseconds,
    );
    if (!samples) return streamFailed("invalid-input");
    const priorCache = STREAM_CACHE.get(state);
    if (!priorCache) return streamFailed("invalid-input");
    const advanced = appendStudioVelocityBezierHandwritingSamples(
      state.finalizerState,
      samples,
    );
    if (!advanced.ok) {
      return streamFailed(
        finalizerFailureReason(advanced.reason),
        advanced.reason,
        advanced.sampleIndex,
      );
    }

    const isTail =
      priorCache.buffers.settledStations.length === priorCache.settledStationCount;
    const settledBuffer = isTail
      ? priorCache.buffers.settledStations
      : priorCache.buffers.settledStations.slice(0, priorCache.settledStationCount);
    const copiedPrefix = isTail ? 0 : priorCache.settledStationCount;
    const newSettledSegments = advanced.path.settledSegments.slice(
      priorCache.settledSegmentCount,
    );
    const priorLast = settledBuffer[priorCache.settledStationCount - 1];
    const flattenedSettled = flattenSegments(
      advanced.path,
      newSettledSegments,
      state.options,
      priorLast?.distance ?? 0,
      priorCache.settledStationCount,
      priorCache.settledStationCount === 0,
      false,
      state.options.maximumStations - priorCache.settledStationCount,
    );
    if (typeof flattenedSettled === "string") {
      return streamFailed(flattenedSettled);
    }
    const settledStationCount =
      priorCache.settledStationCount + flattenedSettled.stations.length;
    const settledEndDistance =
      flattenedSettled.stations.at(-1)?.distance
      ?? priorLast?.distance
      ?? 0;
    const remainingStations = state.options.maximumStations - settledStationCount;
    let previewStations: readonly StudioVelocityBezierInkStation[] = Object.freeze([]);
    if (advanced.path.tap) {
      if (remainingStations < 1) return streamFailed("budget-exceeded");
      const tap = tapStation(advanced.path, state.strokeWidth, true);
      if (!tap) return streamFailed("numeric-overflow");
      previewStations = Object.freeze([tap]);
    } else {
      const flattenedPreview = flattenSegments(
        advanced.path,
        advanced.path.previewSegments,
        state.options,
        settledEndDistance,
        Math.max(0, settledStationCount - 1),
        true,
        true,
        remainingStations,
      );
      if (typeof flattenedPreview === "string") {
        return streamFailed(flattenedPreview);
      }
      previewStations = flattenedPreview.stations;
    }
    settledBuffer.push(...flattenedSettled.stations);

    const evaluatedCubicSegments =
      priorCache.metrics.evaluatedCubicSegments
      + newSettledSegments.length
      + advanced.path.previewSegments.length;
    const emittedStationWork =
      priorCache.metrics.emittedStationWork
      + flattenedSettled.stations.length
      + previewStations.length;
    const finalizerBranchCopyDelta = Math.max(
      0,
      advanced.state.metrics.branchPrefixCopies
        - state.finalizerState.metrics.branchPrefixCopies,
    );
    const nextMetrics = streamMetrics(
      advanced.state.samples.length,
      evaluatedCubicSegments,
      emittedStationWork,
      priorCache.metrics.appendTransitions + 1,
      priorCache.metrics.branchPrefixCopies
        + finalizerBranchCopyDelta
        + copiedPrefix,
      advanced.state.metrics.evaluatedSegments,
    );
    const nextCache: InkStreamCache = {
      buffers: { settledStations: settledBuffer },
      settledStationCount,
      settledSegmentCount: advanced.path.settledSegmentCount,
      metrics: nextMetrics,
    };
    const nextState = stateWithCache(
      state.drawId,
      state.strokeWidth,
      state.options,
      advanced.state,
      nextCache,
    );
    const plan = planFromStreamParts(
      advanced.path,
      state.strokeWidth,
      state.options,
      settledBuffer,
      settledStationCount,
      previewStations,
    );
    return Object.freeze({ ok: true, state: nextState, plan });
  } catch {
    return streamFailed("invalid-input");
  }
}

/** Seals the source stream and performs one authoritative O(N) flattening replay. */
export function sealStudioVelocityBezierInkStream(
  state: StudioVelocityBezierInkStreamState,
): StudioVelocityBezierInkStreamResult {
  if (state.sealed) return streamFailed("sealed-stream");
  const sealed = sealStudioVelocityBezierHandwritingStream(state.finalizerState);
  if (!sealed.ok) {
    return streamFailed(
      finalizerFailureReason(sealed.reason),
      sealed.reason,
      sealed.sampleIndex,
    );
  }
  const planned = batchPlanFromPath(sealed.path, state.strokeWidth, state.options);
  if (!planned.ok) return streamFailed(
    planned.reason,
    planned.sourceReason,
    planned.sourceSampleIndex,
  );
  const nextState: StudioVelocityBezierInkStreamState = Object.freeze({
    kind: "studio-velocity-bezier-ink-stream",
    version: STUDIO_VELOCITY_BEZIER_INK_ADAPTER_VERSION,
    drawId: state.drawId,
    strokeWidth: state.strokeWidth,
    sealed: true,
    options: state.options,
    sourceSampleCount: sealed.state.samples.length,
    finalizerState: sealed.state,
    metrics: state.metrics,
  });
  return Object.freeze({ ok: true, state: nextState, plan: planned.value });
}
