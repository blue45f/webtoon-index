/**
 * Pure handwriting-path finalizer for velocity-sensitive pen presets.
 *
 * This boundary intentionally does not replace the canonical pointer journal, pressure profiles,
 * the fixed-rate input filter, or the centripetal curve resampler. It consumes an already-admitted
 * sample journal and produces a small renderer-neutral cubic path:
 *
 * - source pressure and its provenance are retained at every knot;
 * - velocity is a causal EMA, so appending input never changes an existing knot;
 * - one look-ahead sample settles a cubic segment, while the newest segment remains replaceable;
 * - sealing changes only the segment lifecycle, not the preview geometry;
 * - batch and immutable streaming entry points share the exact same numeric primitives;
 * - streaming snapshots share append-only storage and process only the newly admitted suffix.
 *
 * The cubic handles use a chord-length-weighted midpoint construction. That is a general
 * interpolation technique, implemented here independently rather than copied from a third-party
 * library. Handle lengths are additionally clamped to the local chord to avoid loops and numeric
 * explosions around unevenly sampled input.
 */

export const STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION =
  "velocity-bezier-handwriting-finalizer-v1" as const;

export const STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS = Object.freeze({
  maxIdentifierCharacters: 128,
  maxSamples: 65_536,
  maxSegments: 65_535,
  maxCoordinateAbsolute: 1_000_000,
  maxWidth: 65_536,
  maxVelocity: 1_000_000,
} as const);

export type StudioVelocityBezierPressureSource =
  | "hardware"
  | "velocity"
  | "nominal"
  | "canonical";

/**
 * Provenance remains attached to the source sample rather than being interpolated into a new,
 * ambiguous source. `inputPressure` is the pressure observed before an upstream curve/profile and
 * `resolvedPressure` must equal the sample's pressure exactly.
 */
export interface StudioVelocityBezierPressureProvenance {
  readonly source: StudioVelocityBezierPressureSource;
  readonly sourceSequence: number;
  readonly inputPressure: number;
  readonly resolvedPressure: number;
}

export interface StudioVelocityBezierSourceSample {
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
  readonly timeMilliseconds: number;
  readonly pressure: number;
  readonly pressureProvenance: StudioVelocityBezierPressureProvenance;
}

export type StudioVelocityBezierWidthStrategy =
  | "velocity"
  | "source-pressure"
  | "source-pressure-with-velocity-fallback";

export interface StudioVelocityBezierFinalizerOptions {
  /** Weight assigned to the newest instantaneous velocity in the causal EMA. */
  readonly velocityFilterWeight?: number;
  /** Velocity at which the kinematic pressure reaches `minimumVelocityPressure`. */
  readonly maximumVelocity?: number;
  readonly minimumVelocityPressure?: number;
  readonly minimumWidth?: number;
  readonly maximumWidth?: number;
  /**
   * `source-pressure-with-velocity-fallback` preserves pen/canonical pressure and uses velocity
   * only when upstream provenance explicitly says the pressure was nominal or velocity-derived.
   */
  readonly widthStrategy?: StudioVelocityBezierWidthStrategy;
  /** Scales the chord-weighted handles. 2/3 yields one-third handles on uniformly spaced lines. */
  readonly handleTension?: number;
  /** Maximum control-handle length relative to its segment chord. */
  readonly maximumHandleRatio?: number;
  /** Per-call admission limit, never larger than the hard global sample budget. */
  readonly maximumSamples?: number;
}

export interface StudioVelocityBezierResolvedOptions {
  readonly velocityFilterWeight: number;
  readonly maximumVelocity: number;
  readonly minimumVelocityPressure: number;
  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly widthStrategy: StudioVelocityBezierWidthStrategy;
  readonly handleTension: number;
  readonly maximumHandleRatio: number;
  readonly maximumSamples: number;
}

export interface StudioVelocityBezierKnot {
  readonly sampleIndex: number;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
  readonly timeMilliseconds: number;
  /** Exact resolved source pressure; no curve is re-applied in this finalizer. */
  readonly pressure: number;
  /** Same frozen object exposed by `sourceSamples[sampleIndex]`. */
  readonly pressureProvenance: StudioVelocityBezierPressureProvenance;
  readonly instantaneousVelocity: number;
  readonly filteredVelocity: number;
  readonly velocityPressure: number;
  readonly width: number;
}

export interface StudioVelocityBezierPoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioVelocityBezierSegment {
  readonly index: number;
  readonly lifecycle: "settled" | "preview";
  readonly fromSampleIndex: number;
  readonly toSampleIndex: number;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly p0: StudioVelocityBezierPoint;
  readonly c1: StudioVelocityBezierPoint;
  readonly c2: StudioVelocityBezierPoint;
  readonly p3: StudioVelocityBezierPoint;
  readonly startWidth: number;
  readonly endWidth: number;
}

export interface StudioVelocityBezierTap {
  readonly sampleIndex: 0;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly pressure: number;
  readonly pressureProvenance: StudioVelocityBezierPressureProvenance;
}

export interface StudioVelocityBezierBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface StudioVelocityBezierPath {
  readonly kind: "studio-velocity-bezier-handwriting-path";
  readonly version: typeof STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION;
  readonly strokeId: string;
  readonly phase: "preview" | "committed";
  readonly options: StudioVelocityBezierResolvedOptions;
  readonly sourceSamples: readonly StudioVelocityBezierSourceSample[];
  readonly knots: readonly StudioVelocityBezierKnot[];
  readonly segments: readonly StudioVelocityBezierSegment[];
  readonly settledSegmentCount: number;
  readonly settledSegments: readonly StudioVelocityBezierSegment[];
  readonly previewSegments: readonly StudioVelocityBezierSegment[];
  readonly tap: StudioVelocityBezierTap | null;
  readonly bounds: StudioVelocityBezierBounds | null;
}

export interface StudioVelocityBezierFinalizerInput {
  readonly strokeId: string;
  readonly samples: readonly StudioVelocityBezierSourceSample[];
  readonly options?: StudioVelocityBezierFinalizerOptions;
  readonly phase?: "preview" | "committed";
}

export type StudioVelocityBezierFinalizerFailureReason =
  | "budget-exceeded"
  | "invalid-identifier"
  | "invalid-options"
  | "invalid-sample"
  | "numeric-overflow"
  | "pressure-provenance-mismatch"
  | "sample-order"
  | "sealed-stream";

export type StudioVelocityBezierFinalizerResult =
  | Readonly<{ ok: true; value: StudioVelocityBezierPath }>
  | Readonly<{
      ok: false;
      reason: StudioVelocityBezierFinalizerFailureReason;
      sampleIndex?: number;
    }>;

export interface StudioVelocityBezierStreamState {
  readonly kind: "studio-velocity-bezier-handwriting-stream";
  readonly version: typeof STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION;
  readonly strokeId: string;
  readonly sealed: boolean;
  readonly options: StudioVelocityBezierResolvedOptions;
  readonly samples: readonly StudioVelocityBezierSourceSample[];
  /**
   * Deterministic work counters. They make accidental O(N²) replanning observable in tests and
   * diagnostics without exposing the mutable append-only buffers.
   */
  readonly metrics: StudioVelocityBezierStreamMetrics;
}

export interface StudioVelocityBezierStreamMetrics {
  /** Number of samples currently admitted by this snapshot. */
  readonly acceptedSamples: number;
  /** Segment evaluations performed by append transitions; the one-time seal replay is excluded. */
  readonly evaluatedSegments: number;
  readonly appendTransitions: number;
  /** Number of prefix entries copied after explicitly appending from an older branched snapshot. */
  readonly branchPrefixCopies: number;
}

export type StudioVelocityBezierStreamResult =
  | Readonly<{
      ok: true;
      state: StudioVelocityBezierStreamState;
      path: StudioVelocityBezierPath;
    }>
  | Readonly<{
      ok: false;
      reason: StudioVelocityBezierFinalizerFailureReason;
      sampleIndex?: number;
    }>;

const DEFAULT_OPTIONS: StudioVelocityBezierResolvedOptions = Object.freeze({
  velocityFilterWeight: 0.72,
  maximumVelocity: 2.25,
  minimumVelocityPressure: 0.08,
  minimumWidth: 0.5,
  maximumWidth: 4,
  widthStrategy: "source-pressure-with-velocity-fallback",
  handleTension: 2 / 3,
  maximumHandleRatio: 0.75,
  maximumSamples: STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxSamples,
});

const PRESSURE_SOURCES = new Set<StudioVelocityBezierPressureSource>([
  "hardware",
  "velocity",
  "nominal",
  "canonical",
]);

const WIDTH_STRATEGIES = new Set<StudioVelocityBezierWidthStrategy>([
  "velocity",
  "source-pressure",
  "source-pressure-with-velocity-fallback",
]);

interface MutableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface StudioVelocityBezierStreamBuffers {
  readonly samples: StudioVelocityBezierSourceSample[];
  readonly knots: StudioVelocityBezierKnot[];
  readonly settledSegments: StudioVelocityBezierSegment[];
}

interface StudioVelocityBezierStreamCache {
  readonly buffers: StudioVelocityBezierStreamBuffers;
  readonly sampleCount: number;
  readonly settledSegmentCount: number;
  readonly previewSegment: StudioVelocityBezierSegment | null;
  readonly stableBounds: Readonly<MutableBounds>;
  readonly metrics: StudioVelocityBezierStreamMetrics;
}

const STREAM_CACHE = new WeakMap<
  StudioVelocityBezierStreamState,
  StudioVelocityBezierStreamCache
>();

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

/**
 * Frozen array facade over an append-only buffer prefix.
 *
 * A sparse frozen Array is used as the proxy target, so Array.isArray/Object.isFrozen and native
 * map/slice/iteration semantics remain intact. Numeric reads are redirected into the captured
 * buffer prefix. Later appends cannot become visible because the target's frozen `length` is the
 * snapshot length.
 */
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

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function unsignedSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function fail(
  reason: StudioVelocityBezierFinalizerFailureReason,
  sampleIndex?: number,
): StudioVelocityBezierFinalizerResult {
  return Object.freeze(
    sampleIndex === undefined ? { ok: false, reason } : { ok: false, reason, sampleIndex },
  ) as StudioVelocityBezierFinalizerResult;
}

function streamFail(
  reason: StudioVelocityBezierFinalizerFailureReason,
  sampleIndex?: number,
): StudioVelocityBezierStreamResult {
  return Object.freeze(
    sampleIndex === undefined ? { ok: false, reason } : { ok: false, reason, sampleIndex },
  ) as StudioVelocityBezierStreamResult;
}

function resolveOptions(
  options: StudioVelocityBezierFinalizerOptions | undefined,
): StudioVelocityBezierResolvedOptions | null {
  const value = options ?? {};
  const velocityFilterWeight = value.velocityFilterWeight ?? DEFAULT_OPTIONS.velocityFilterWeight;
  const maximumVelocity = value.maximumVelocity ?? DEFAULT_OPTIONS.maximumVelocity;
  const minimumVelocityPressure =
    value.minimumVelocityPressure ?? DEFAULT_OPTIONS.minimumVelocityPressure;
  const minimumWidth = value.minimumWidth ?? DEFAULT_OPTIONS.minimumWidth;
  const maximumWidth = value.maximumWidth ?? DEFAULT_OPTIONS.maximumWidth;
  const widthStrategy = value.widthStrategy ?? DEFAULT_OPTIONS.widthStrategy;
  const handleTension = value.handleTension ?? DEFAULT_OPTIONS.handleTension;
  const maximumHandleRatio = value.maximumHandleRatio ?? DEFAULT_OPTIONS.maximumHandleRatio;
  const maximumSamples = value.maximumSamples ?? DEFAULT_OPTIONS.maximumSamples;

  if (
    !finiteInRange(velocityFilterWeight, 0, 1)
    || !finiteInRange(
      maximumVelocity,
      Number.EPSILON,
      STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxVelocity,
    )
    || !finiteInRange(minimumVelocityPressure, 0, 1)
    || !finiteInRange(
      minimumWidth,
      0,
      STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxWidth,
    )
    || !finiteInRange(
      maximumWidth,
      minimumWidth,
      STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxWidth,
    )
    || !WIDTH_STRATEGIES.has(widthStrategy)
    || !finiteInRange(handleTension, 0, 1)
    || !finiteInRange(maximumHandleRatio, 0, 2)
    || !Number.isSafeInteger(maximumSamples)
    || maximumSamples < 1
    || maximumSamples > STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxSamples
  ) return null;

  return Object.freeze({
    velocityFilterWeight: canonicalNumber(velocityFilterWeight),
    maximumVelocity: canonicalNumber(maximumVelocity),
    minimumVelocityPressure: canonicalNumber(minimumVelocityPressure),
    minimumWidth: canonicalNumber(minimumWidth),
    maximumWidth: canonicalNumber(maximumWidth),
    widthStrategy,
    handleTension: canonicalNumber(handleTension),
    maximumHandleRatio: canonicalNumber(maximumHandleRatio),
    maximumSamples,
  });
}

function copyAndValidateSamples(
  samples: readonly StudioVelocityBezierSourceSample[],
  maximumSamples: number,
):
  | Readonly<{ ok: true; samples: readonly StudioVelocityBezierSourceSample[] }>
  | Readonly<{
      ok: false;
      reason: StudioVelocityBezierFinalizerFailureReason;
      sampleIndex?: number;
    }> {
  if (!Array.isArray(samples) || samples.length > maximumSamples) {
    return Object.freeze({ ok: false, reason: "budget-exceeded" });
  }

  const copied: StudioVelocityBezierSourceSample[] = [];
  let previousSequence = -1;
  let previousTime = -1;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sample = samples[sampleIndex];
    const provenance = sample?.pressureProvenance;
    if (
      !sample
      || !unsignedSafeInteger(sample.sequence)
      || !finiteInRange(
        sample.x,
        -STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxCoordinateAbsolute,
        STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxCoordinateAbsolute,
      )
      || !finiteInRange(
        sample.y,
        -STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxCoordinateAbsolute,
        STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxCoordinateAbsolute,
      )
      || !finiteInRange(sample.timeMilliseconds, 0, Number.MAX_SAFE_INTEGER)
      || !finiteInRange(sample.pressure, 0, 1)
      || !provenance
      || !PRESSURE_SOURCES.has(provenance.source)
      || !unsignedSafeInteger(provenance.sourceSequence)
      || !finiteInRange(provenance.inputPressure, 0, 1)
      || !finiteInRange(provenance.resolvedPressure, 0, 1)
    ) {
      return Object.freeze({ ok: false, reason: "invalid-sample", sampleIndex });
    }
    if (sample.sequence <= previousSequence || sample.timeMilliseconds < previousTime) {
      return Object.freeze({ ok: false, reason: "sample-order", sampleIndex });
    }
    if (canonicalNumber(sample.pressure) !== canonicalNumber(provenance.resolvedPressure)) {
      return Object.freeze({
        ok: false,
        reason: "pressure-provenance-mismatch",
        sampleIndex,
      });
    }

    const copiedProvenance: StudioVelocityBezierPressureProvenance = Object.freeze({
      source: provenance.source,
      sourceSequence: provenance.sourceSequence,
      inputPressure: canonicalNumber(provenance.inputPressure),
      resolvedPressure: canonicalNumber(provenance.resolvedPressure),
    });
    copied.push(
      Object.freeze({
        sequence: sample.sequence,
        x: canonicalNumber(sample.x),
        y: canonicalNumber(sample.y),
        timeMilliseconds: canonicalNumber(sample.timeMilliseconds),
        pressure: canonicalNumber(sample.pressure),
        pressureProvenance: copiedProvenance,
      }),
    );
    previousSequence = sample.sequence;
    previousTime = sample.timeMilliseconds;
  }
  return Object.freeze({ ok: true, samples: Object.freeze(copied) });
}

function widthPressure(
  pressure: number,
  source: StudioVelocityBezierPressureSource,
  velocityPressure: number,
  strategy: StudioVelocityBezierWidthStrategy,
): number {
  if (strategy === "velocity") return velocityPressure;
  if (strategy === "source-pressure") return pressure;
  return source === "hardware" || source === "canonical" ? pressure : velocityPressure;
}

function buildKnot(
  sample: StudioVelocityBezierSourceSample,
  sampleIndex: number,
  previous: StudioVelocityBezierSourceSample | undefined,
  previousFilteredVelocity: number,
  options: StudioVelocityBezierResolvedOptions,
): StudioVelocityBezierKnot | null {
  let instantaneousVelocity = 0;
  if (previous) {
    const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y);
    const elapsed = sample.timeMilliseconds - previous.timeMilliseconds;
    instantaneousVelocity = elapsed > 0
      ? distance / elapsed
      : distance === 0
        ? previousFilteredVelocity
        : options.maximumVelocity;
  }
  instantaneousVelocity = clamp(
    instantaneousVelocity,
    0,
    STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxVelocity,
  );
  const filteredVelocity = previous === undefined
    ? 0
    : options.velocityFilterWeight * instantaneousVelocity
      + (1 - options.velocityFilterWeight) * previousFilteredVelocity;
  if (!Number.isFinite(filteredVelocity)) return null;

  const normalizedVelocity = clamp(filteredVelocity / options.maximumVelocity, 0, 1);
  const velocityPressure =
    1 - normalizedVelocity * (1 - options.minimumVelocityPressure);
  const finalPressure = widthPressure(
    sample.pressure,
    sample.pressureProvenance.source,
    velocityPressure,
    options.widthStrategy,
  );
  const width =
    options.minimumWidth
    + (options.maximumWidth - options.minimumWidth) * clamp(finalPressure, 0, 1);
  if (!Number.isFinite(width)) return null;

  return Object.freeze({
    sampleIndex,
    sequence: sample.sequence,
    x: sample.x,
    y: sample.y,
    timeMilliseconds: sample.timeMilliseconds,
    pressure: sample.pressure,
    pressureProvenance: sample.pressureProvenance,
    instantaneousVelocity: canonicalNumber(instantaneousVelocity),
    filteredVelocity: canonicalNumber(filteredVelocity),
    velocityPressure: canonicalNumber(velocityPressure),
    width: canonicalNumber(width),
  });
}

function buildKnots(
  samples: readonly StudioVelocityBezierSourceSample[],
  options: StudioVelocityBezierResolvedOptions,
): readonly StudioVelocityBezierKnot[] | null {
  const knots: StudioVelocityBezierKnot[] = [];
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const knot = buildKnot(
      samples[sampleIndex]!,
      sampleIndex,
      samples[sampleIndex - 1],
      knots[sampleIndex - 1]?.filteredVelocity ?? 0,
      options,
    );
    if (!knot) return null;
    knots.push(knot);
  }
  return Object.freeze(knots);
}

function point(x: number, y: number): StudioVelocityBezierPoint {
  return Object.freeze({ x: canonicalNumber(x), y: canonicalNumber(y) });
}

interface VertexHandles {
  readonly incoming: StudioVelocityBezierPoint;
  readonly outgoing: StudioVelocityBezierPoint;
}

function vertexHandles(
  previous: StudioVelocityBezierKnot,
  vertex: StudioVelocityBezierKnot,
  next: StudioVelocityBezierKnot,
  tension: number,
): VertexHandles | null {
  const leftLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
  const rightLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
  const totalLength = leftLength + rightLength;
  if (totalLength === 0) {
    const same = point(vertex.x, vertex.y);
    return Object.freeze({ incoming: same, outgoing: same });
  }

  const leftMidX = (previous.x + vertex.x) / 2;
  const leftMidY = (previous.y + vertex.y) / 2;
  const rightMidX = (vertex.x + next.x) / 2;
  const rightMidY = (vertex.y + next.y) / 2;
  const centerRatio = leftLength / totalLength;
  const weightedCenterX = leftMidX + (rightMidX - leftMidX) * centerRatio;
  const weightedCenterY = leftMidY + (rightMidY - leftMidY) * centerRatio;
  const translateX = vertex.x - weightedCenterX;
  const translateY = vertex.y - weightedCenterY;
  const rawIncomingX = leftMidX + translateX;
  const rawIncomingY = leftMidY + translateY;
  const rawOutgoingX = rightMidX + translateX;
  const rawOutgoingY = rightMidY + translateY;

  const incomingX = vertex.x + (rawIncomingX - vertex.x) * tension;
  const incomingY = vertex.y + (rawIncomingY - vertex.y) * tension;
  const outgoingX = vertex.x + (rawOutgoingX - vertex.x) * tension;
  const outgoingY = vertex.y + (rawOutgoingY - vertex.y) * tension;
  if (
    !Number.isFinite(incomingX)
    || !Number.isFinite(incomingY)
    || !Number.isFinite(outgoingX)
    || !Number.isFinite(outgoingY)
  ) return null;

  return Object.freeze({
    incoming: point(incomingX, incomingY),
    outgoing: point(outgoingX, outgoingY),
  });
}

function clampHandle(
  anchor: StudioVelocityBezierKnot,
  candidate: StudioVelocityBezierPoint,
  maximumLength: number,
): StudioVelocityBezierPoint | null {
  const dx = candidate.x - anchor.x;
  const dy = candidate.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || !Number.isFinite(maximumLength)) return null;
  if (length === 0 || length <= maximumLength) return candidate;
  const ratio = maximumLength / length;
  return point(anchor.x + dx * ratio, anchor.y + dy * ratio);
}

function mirroredEndpoint(
  endpoint: StudioVelocityBezierKnot,
  neighbor: StudioVelocityBezierKnot,
): StudioVelocityBezierKnot | null {
  const x = endpoint.x * 2 - neighbor.x;
  const y = endpoint.y * 2 - neighbor.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    ...endpoint,
    x,
    y,
  };
}

function buildSegmentAt(
  knots: readonly StudioVelocityBezierKnot[],
  index: number,
  options: StudioVelocityBezierResolvedOptions,
  lifecycle: "settled" | "preview",
): StudioVelocityBezierSegment | null {
  const from = knots[index];
  const to = knots[index + 1];
  if (!from || !to) return null;
  const previous = knots[index - 1] ?? mirroredEndpoint(from, to);
  const next = knots[index + 2] ?? mirroredEndpoint(to, from);
  if (!previous || !next) return null;

  const fromHandles = vertexHandles(
    previous,
    from,
    to,
    options.handleTension,
  );
  const toHandles = vertexHandles(from, to, next, options.handleTension);
  if (!fromHandles || !toHandles) return null;

  const chordLength = Math.hypot(to.x - from.x, to.y - from.y);
  const maximumHandleLength = chordLength * options.maximumHandleRatio;
  const c1 = clampHandle(from, fromHandles.outgoing, maximumHandleLength);
  const c2 = clampHandle(to, toHandles.incoming, maximumHandleLength);
  if (!c1 || !c2) return null;

  return Object.freeze({
    index,
    lifecycle,
    fromSampleIndex: from.sampleIndex,
    toSampleIndex: to.sampleIndex,
    fromSequence: from.sequence,
    toSequence: to.sequence,
    p0: point(from.x, from.y),
    c1,
    c2,
    p3: point(to.x, to.y),
    startWidth: from.width,
    endWidth: to.width,
  });
}

function buildSegments(
  knots: readonly StudioVelocityBezierKnot[],
  options: StudioVelocityBezierResolvedOptions,
  committed: boolean,
): readonly StudioVelocityBezierSegment[] | null {
  if (knots.length < 2) return Object.freeze([]);
  if (knots.length - 1 > STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxSegments) {
    return null;
  }

  const segments: StudioVelocityBezierSegment[] = [];
  for (let index = 0; index < knots.length - 1; index += 1) {
    const lifecycle =
      committed || index < knots.length - 2 ? "settled" : "preview";
    const segment = buildSegmentAt(knots, index, options, lifecycle);
    if (!segment) return null;
    segments.push(segment);
  }
  return Object.freeze(segments);
}

function emptyBounds(): MutableBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function copyBounds(bounds: Readonly<MutableBounds>): MutableBounds {
  return { ...bounds };
}

function includeBoundsPoint(
  bounds: MutableBounds,
  candidate: StudioVelocityBezierPoint,
  radius = 0,
): void {
  bounds.minX = Math.min(bounds.minX, candidate.x - radius);
  bounds.minY = Math.min(bounds.minY, candidate.y - radius);
  bounds.maxX = Math.max(bounds.maxX, candidate.x + radius);
  bounds.maxY = Math.max(bounds.maxY, candidate.y + radius);
}

function includeBoundsSegment(
  bounds: MutableBounds,
  segment: StudioVelocityBezierSegment,
): void {
  // A cubic lies inside its control-point convex hull. Padding the hull by the larger endpoint
  // radius therefore remains conservative for a linearly interpolated width renderer.
  const radius = Math.max(segment.startWidth, segment.endWidth) / 2;
  includeBoundsPoint(bounds, segment.c1, radius);
  includeBoundsPoint(bounds, segment.c2, radius);
}

function freezeBounds(bounds: Readonly<MutableBounds>): StudioVelocityBezierBounds | null {
  if (
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
  ) return null;
  return Object.freeze({
    minX: canonicalNumber(bounds.minX),
    minY: canonicalNumber(bounds.minY),
    maxX: canonicalNumber(bounds.maxX),
    maxY: canonicalNumber(bounds.maxY),
  });
}

function pathBounds(
  knots: readonly StudioVelocityBezierKnot[],
  segments: readonly StudioVelocityBezierSegment[],
): StudioVelocityBezierBounds | null {
  if (knots.length === 0) return null;
  const bounds = emptyBounds();
  for (const knot of knots) includeBoundsPoint(bounds, knot, knot.width / 2);
  for (const segment of segments) {
    includeBoundsSegment(bounds, segment);
  }
  return freezeBounds(bounds);
}

/** Plans one deterministic path. The input and its nested provenance records are never mutated. */
export function finalizeStudioVelocityBezierHandwriting(
  input: StudioVelocityBezierFinalizerInput,
): StudioVelocityBezierFinalizerResult {
  try {
    if (
      typeof input.strokeId !== "string"
      || input.strokeId.length === 0
      || input.strokeId.length
        > STUDIO_VELOCITY_BEZIER_FINALIZER_BUDGETS.maxIdentifierCharacters
    ) return fail("invalid-identifier");
    if (input.phase !== undefined && input.phase !== "preview" && input.phase !== "committed") {
      return fail("invalid-options");
    }
    const options = resolveOptions(input.options);
    if (!options) return fail("invalid-options");
    const copied = copyAndValidateSamples(input.samples, options.maximumSamples);
    if (!copied.ok) {
      return fail(copied.reason, copied.sampleIndex);
    }
    const knots = buildKnots(copied.samples, options);
    if (!knots) return fail("numeric-overflow");
    const committed = input.phase === "committed";
    const segments = buildSegments(knots, options, committed);
    if (!segments) return fail("numeric-overflow");
    const settledSegmentCount = committed
      ? segments.length
      : Math.max(0, segments.length - 1);
    const settledSegments = Object.freeze(segments.slice(0, settledSegmentCount));
    const previewSegments = Object.freeze(segments.slice(settledSegmentCount));
    const only = knots.length === 1 ? knots[0]! : null;
    const tap: StudioVelocityBezierTap | null = only
      ? Object.freeze({
          sampleIndex: 0,
          sequence: only.sequence,
          x: only.x,
          y: only.y,
          radius: only.width / 2,
          pressure: only.pressure,
          pressureProvenance: only.pressureProvenance,
        })
      : null;
    const bounds = pathBounds(knots, segments);
    if (knots.length > 0 && !bounds) return fail("numeric-overflow");

    const value: StudioVelocityBezierPath = Object.freeze({
      kind: "studio-velocity-bezier-handwriting-path",
      version: STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION,
      strokeId: input.strokeId,
      phase: committed ? "committed" : "preview",
      options,
      sourceSamples: copied.samples,
      knots,
      segments,
      settledSegmentCount,
      settledSegments,
      previewSegments,
      tap,
      bounds,
    });
    return Object.freeze({ ok: true, value });
  } catch {
    return fail("invalid-sample");
  }
}

function metrics(
  acceptedSamples: number,
  evaluatedSegments: number,
  appendTransitions: number,
  branchPrefixCopies: number,
): StudioVelocityBezierStreamMetrics {
  return Object.freeze({
    acceptedSamples,
    evaluatedSegments,
    appendTransitions,
    branchPrefixCopies,
  });
}

function stableBoundsFor(
  knots: readonly StudioVelocityBezierKnot[],
  settledSegments: readonly StudioVelocityBezierSegment[],
): MutableBounds {
  const bounds = emptyBounds();
  for (const knot of knots) includeBoundsPoint(bounds, knot, knot.width / 2);
  for (const segment of settledSegments) includeBoundsSegment(bounds, segment);
  return bounds;
}

function cacheFromPreviewPath(
  path: StudioVelocityBezierPath,
): StudioVelocityBezierStreamCache {
  const buffers: StudioVelocityBezierStreamBuffers = {
    samples: [...path.sourceSamples],
    knots: [...path.knots],
    settledSegments: [...path.settledSegments],
  };
  return {
    buffers,
    sampleCount: path.sourceSamples.length,
    settledSegmentCount: path.settledSegmentCount,
    previewSegment: path.previewSegments[0] ?? null,
    stableBounds: stableBoundsFor(buffers.knots, buffers.settledSegments),
    metrics: metrics(
      path.sourceSamples.length,
      path.segments.length,
      0,
      0,
    ),
  };
}

function pathFromStreamCache(
  strokeId: string,
  options: StudioVelocityBezierResolvedOptions,
  cache: StudioVelocityBezierStreamCache,
): StudioVelocityBezierPath | null {
  const {
    buffers,
    sampleCount,
    settledSegmentCount,
    previewSegment,
  } = cache;
  const previewCount = previewSegment ? 1 : 0;
  const sourceSamples = frozenArraySnapshot(
    sampleCount,
    (index) => buffers.samples[index]!,
  );
  const knots = frozenArraySnapshot(sampleCount, (index) => buffers.knots[index]!);
  const settledSegments = frozenArraySnapshot(
    settledSegmentCount,
    (index) => buffers.settledSegments[index]!,
  );
  const previewSegments: readonly StudioVelocityBezierSegment[] = previewSegment
    ? Object.freeze([previewSegment])
    : Object.freeze([]);
  const segments = frozenArraySnapshot(
    settledSegmentCount + previewCount,
    (index) =>
      index < settledSegmentCount
        ? buffers.settledSegments[index]!
        : previewSegment!,
  );
  const only = sampleCount === 1 ? buffers.knots[0]! : null;
  const tap: StudioVelocityBezierTap | null = only
    ? Object.freeze({
        sampleIndex: 0,
        sequence: only.sequence,
        x: only.x,
        y: only.y,
        radius: only.width / 2,
        pressure: only.pressure,
        pressureProvenance: only.pressureProvenance,
      })
    : null;
  const mutableBounds = copyBounds(cache.stableBounds);
  if (previewSegment) includeBoundsSegment(mutableBounds, previewSegment);
  const bounds = sampleCount === 0 ? null : freezeBounds(mutableBounds);
  if (sampleCount > 0 && !bounds) return null;

  return Object.freeze({
    kind: "studio-velocity-bezier-handwriting-path",
    version: STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION,
    strokeId,
    phase: "preview",
    options,
    sourceSamples,
    knots,
    segments,
    settledSegmentCount,
    settledSegments,
    previewSegments,
    tap,
    bounds,
  });
}

function stateFromStreamCache(
  strokeId: string,
  options: StudioVelocityBezierResolvedOptions,
  cache: StudioVelocityBezierStreamCache,
): StudioVelocityBezierStreamState {
  const state: StudioVelocityBezierStreamState = Object.freeze({
    kind: "studio-velocity-bezier-handwriting-stream",
    version: STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION,
    strokeId,
    sealed: false,
    options,
    samples: frozenArraySnapshot(
      cache.sampleCount,
      (index) => cache.buffers.samples[index]!,
    ),
    metrics: cache.metrics,
  });
  STREAM_CACHE.set(state, cache);
  return state;
}

function recoverStreamCache(
  state: StudioVelocityBezierStreamState,
): StudioVelocityBezierStreamCache | null {
  const cached = STREAM_CACHE.get(state);
  if (cached) return cached;
  const planned = finalizeStudioVelocityBezierHandwriting({
    strokeId: state.strokeId,
    samples: state.samples,
    options: state.options,
    phase: "preview",
  });
  if (!planned.ok) return null;
  return cacheFromPreviewPath(planned.value);
}

function writableStreamBuffers(
  cache: StudioVelocityBezierStreamCache,
): Readonly<{
  buffers: StudioVelocityBezierStreamBuffers;
  copiedPrefixEntries: number;
}> {
  const { buffers } = cache;
  const isTail =
    buffers.samples.length === cache.sampleCount
    && buffers.knots.length === cache.sampleCount
    && buffers.settledSegments.length === cache.settledSegmentCount;
  if (isTail) return { buffers, copiedPrefixEntries: 0 };
  return {
    buffers: {
      samples: buffers.samples.slice(0, cache.sampleCount),
      knots: buffers.knots.slice(0, cache.sampleCount),
      settledSegments: buffers.settledSegments.slice(0, cache.settledSegmentCount),
    },
    copiedPrefixEntries:
      cache.sampleCount * 2 + cache.settledSegmentCount,
  };
}

/** Creates an empty immutable stream and its empty preview path. */
export function createStudioVelocityBezierHandwritingStream(
  strokeId: string,
  options?: StudioVelocityBezierFinalizerOptions,
): StudioVelocityBezierStreamResult {
  const planned = finalizeStudioVelocityBezierHandwriting({
    strokeId,
    samples: [],
    options,
    phase: "preview",
  });
  if (!planned.ok) return streamFail(planned.reason, planned.sampleIndex);
  const cache = cacheFromPreviewPath(planned.value);
  const state = stateFromStreamCache(strokeId, planned.value.options, cache);
  return Object.freeze({ ok: true, state, path: planned.value });
}

/**
 * Appends a bounded batch without mutating the previous state.
 *
 * The normal forward-only path shares append-only buffers and processes only `appendedSamples`
 * plus one replaceable preview segment. Appending from an older snapshot remains correct by
 * copying that branch's captured prefix once; this exceptional branch cost is reported through
 * `metrics.branchPrefixCopies`.
 */
export function appendStudioVelocityBezierHandwritingSamples(
  state: StudioVelocityBezierStreamState,
  appendedSamples: readonly StudioVelocityBezierSourceSample[],
): StudioVelocityBezierStreamResult {
  try {
    if (state.sealed) return streamFail("sealed-stream");
    if (!Array.isArray(appendedSamples)) return streamFail("budget-exceeded");
    const cache = recoverStreamCache(state);
    if (!cache) return streamFail("invalid-sample");
    if (
      cache.sampleCount + appendedSamples.length > state.options.maximumSamples
    ) return streamFail("budget-exceeded");

    const copied = copyAndValidateSamples(
      appendedSamples,
      state.options.maximumSamples - cache.sampleCount,
    );
    if (!copied.ok) {
      return streamFail(
        copied.reason,
        copied.sampleIndex === undefined
          ? undefined
          : cache.sampleCount + copied.sampleIndex,
      );
    }
    const previousSource = cache.buffers.samples[cache.sampleCount - 1];
    const first = copied.samples[0];
    if (
      previousSource
      && first
      && (
        first.sequence <= previousSource.sequence
        || first.timeMilliseconds < previousSource.timeMilliseconds
      )
    ) return streamFail("sample-order", cache.sampleCount);

    const writable = writableStreamBuffers(cache);
    const { buffers } = writable;
    const stableBounds = copyBounds(cache.stableBounds);
    let previousFilteredVelocity =
      buffers.knots[cache.sampleCount - 1]?.filteredVelocity ?? 0;
    let previous = buffers.samples[cache.sampleCount - 1];

    for (let localIndex = 0; localIndex < copied.samples.length; localIndex += 1) {
      const nextSample = copied.samples[localIndex]!;
      const sampleIndex = cache.sampleCount + localIndex;
      const knot = buildKnot(
        nextSample,
        sampleIndex,
        previous,
        previousFilteredVelocity,
        state.options,
      );
      if (!knot) return streamFail("numeric-overflow", sampleIndex);
      buffers.samples.push(nextSample);
      buffers.knots.push(knot);
      includeBoundsPoint(stableBounds, knot, knot.width / 2);
      previous = nextSample;
      previousFilteredVelocity = knot.filteredVelocity;
    }

    const sampleCount = cache.sampleCount + copied.samples.length;
    const nextSettledSegmentCount = Math.max(0, sampleCount - 2);
    let evaluatedSegments = cache.metrics.evaluatedSegments;
    for (
      let index = cache.settledSegmentCount;
      index < nextSettledSegmentCount;
      index += 1
    ) {
      const segment = buildSegmentAt(
        buffers.knots,
        index,
        state.options,
        "settled",
      );
      if (!segment) return streamFail("numeric-overflow");
      buffers.settledSegments.push(segment);
      includeBoundsSegment(stableBounds, segment);
      evaluatedSegments += 1;
    }

    let previewSegment: StudioVelocityBezierSegment | null = cache.previewSegment;
    if (copied.samples.length > 0) {
      previewSegment = sampleCount >= 2
        ? buildSegmentAt(
            buffers.knots,
            sampleCount - 2,
            state.options,
            "preview",
          )
        : null;
      if (sampleCount >= 2 && !previewSegment) {
        return streamFail("numeric-overflow");
      }
      if (previewSegment) evaluatedSegments += 1;
    }

    const nextCache: StudioVelocityBezierStreamCache = {
      buffers,
      sampleCount,
      settledSegmentCount: nextSettledSegmentCount,
      previewSegment,
      stableBounds,
      metrics: metrics(
        sampleCount,
        evaluatedSegments,
        cache.metrics.appendTransitions + 1,
        cache.metrics.branchPrefixCopies + writable.copiedPrefixEntries,
      ),
    };
    const path = pathFromStreamCache(state.strokeId, state.options, nextCache);
    if (!path) return streamFail("numeric-overflow");
    const nextState = stateFromStreamCache(state.strokeId, state.options, nextCache);
    return Object.freeze({ ok: true, state: nextState, path });
  } catch {
    return streamFail("invalid-sample");
  }
}

/** Seals the current immutable stream for committed replay without changing its curve geometry. */
export function sealStudioVelocityBezierHandwritingStream(
  state: StudioVelocityBezierStreamState,
): StudioVelocityBezierStreamResult {
  if (state.sealed) return streamFail("sealed-stream");
  const planned = finalizeStudioVelocityBezierHandwriting({
    strokeId: state.strokeId,
    samples: state.samples,
    options: state.options,
    phase: "committed",
  });
  if (!planned.ok) return streamFail(planned.reason, planned.sampleIndex);
  const priorMetrics = STREAM_CACHE.get(state)?.metrics ?? state.metrics;
  const nextState: StudioVelocityBezierStreamState = Object.freeze({
    kind: "studio-velocity-bezier-handwriting-stream",
    version: STUDIO_VELOCITY_BEZIER_FINALIZER_VERSION,
    strokeId: state.strokeId,
    sealed: true,
    options: planned.value.options,
    samples: planned.value.sourceSamples,
    metrics: priorMetrics,
  });
  return Object.freeze({ ok: true, state: nextState, path: planned.value });
}
