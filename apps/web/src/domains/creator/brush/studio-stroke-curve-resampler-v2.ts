import type {
  StudioCanonicalStrokeSampleV2,
  StudioCanonicalStrokeV2,
  StudioCanonicalStrokePointerTypeV2,
} from "../studio-canonical-stroke-v2";

/**
 * Deterministic curve geometry for StudioCanonicalStrokeV2.
 *
 * A segment becomes settled only after one authoritative look-ahead sample exists. Appending an
 * authoritative sample can replace the former preview tail, but cannot alter an already settled
 * segment or station. Predictions are consumed only by the replaceable preview suffix.
 */

export const STUDIO_STROKE_CURVE_RESAMPLER_V2_VERSION = 2 as const;

export const STUDIO_STROKE_CURVE_RESAMPLER_V2_BUDGETS = Object.freeze({
  maxSegments: 66_560,
  maxStations: 262_144,
  maxArcLutEntries: 2_130_000,
  maxLutSubdivisions: 128,
} as const);

export interface StudioStrokeCurveResamplerOptionsV2 {
  /** Base arc-length spacing in document CSS pixels. */
  readonly spacing: number;
  /** 0 disables curvature adaptation; larger values add stations around tight turns. */
  readonly curvatureStrength?: number;
  /** Lower bound relative to `spacing`. */
  readonly minimumSpacingRatio?: number;
  /** Direction change at or above this angle is kept as an intentional corner. */
  readonly cornerThresholdDegrees?: number;
  readonly lutSubdivisions?: number;
  readonly maximumStations?: number;
  /** Pointer-up may seal the final authoritative segment because no later sample can revise it. */
  readonly sealAuthoritativeTail?: boolean;
}

export interface StudioStrokeCurveArcLengthLutV2 {
  readonly subdivisions: number;
  readonly parameters: readonly number[];
  readonly lengths: readonly number[];
  readonly totalLength: number;
}

export interface StudioStrokeCurveSegmentV2 {
  readonly index: number;
  readonly settled: boolean;
  readonly role: "authoritative" | "predicted";
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly p0: Readonly<{ x: number; y: number }>;
  readonly p1: Readonly<{ x: number; y: number }>;
  readonly p2: Readonly<{ x: number; y: number }>;
  readonly p3: Readonly<{ x: number; y: number }>;
  /** Cubic Bézier controls after centripetal Catmull-Rom lowering. */
  readonly c1: Readonly<{ x: number; y: number }>;
  readonly c2: Readonly<{ x: number; y: number }>;
  readonly arcLengthLut: StudioStrokeCurveArcLengthLutV2;
}

export interface StudioStrokeCurveStationV2 {
  readonly distance: number;
  readonly segmentIndex: number;
  readonly parameter: number;
  readonly role: "authoritative" | "predicted";
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly timeMilliseconds: number;
  readonly sourceTimeMilliseconds: number;
  readonly pointerId: number;
  readonly pointerType: StudioCanonicalStrokePointerTypeV2;
  readonly button: number;
  readonly buttons: number;
  readonly flags: number;
  readonly fromSequence: number;
  readonly toSequence: number;
}

export interface StudioStrokeCurvePlanV2 {
  readonly kind: "studio-stroke-curve-plan";
  readonly version: typeof STUDIO_STROKE_CURVE_RESAMPLER_V2_VERSION;
  readonly strokeId: string;
  readonly segments: readonly StudioStrokeCurveSegmentV2[];
  readonly settledSegmentCount: number;
  readonly settledLength: number;
  readonly totalLength: number;
  /** Immutable stations whose geometry will not change when a new authoritative point arrives. */
  readonly settledStations: readonly StudioStrokeCurveStationV2[];
  /** Replaceable authoritative tail plus any predicted suffix. */
  readonly previewStations: readonly StudioStrokeCurveStationV2[];
}

export type StudioStrokeCurvePlanFailureReasonV2 =
  | "budget-exceeded"
  | "invalid-options"
  | "invalid-stroke"
  | "numeric-overflow";

export type StudioStrokeCurvePlanResultV2 =
  | Readonly<{ ok: true; value: StudioStrokeCurvePlanV2 }>
  | Readonly<{ ok: false; reason: StudioStrokeCurvePlanFailureReasonV2 }>;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface InternalSegment {
  readonly publicSegment: StudioStrokeCurveSegmentV2;
  readonly previous: StudioCanonicalStrokeSampleV2 | null;
  readonly from: StudioCanonicalStrokeSampleV2;
  readonly to: StudioCanonicalStrokeSampleV2;
  readonly next: StudioCanonicalStrokeSampleV2 | null;
  readonly cumulativeStart: number;
  readonly cumulativeEnd: number;
}

const EPSILON = 1e-9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function frozenPoint(x: number, y: number): Readonly<Point> {
  return Object.freeze({ x, y });
}

function extrapolate(from: Point, through: Point): Point {
  return {
    x: through.x + (through.x - from.x),
    y: through.y + (through.y - from.y),
  };
}

function knotIncrement(left: Point, right: Point): number {
  // alpha=0.5 centripetal parameterization.
  return Math.sqrt(Math.max(EPSILON, Math.hypot(right.x - left.x, right.y - left.y)));
}

function scaledDifference(
  left: Point,
  right: Point,
  scale: number,
): Point {
  return {
    x: (right.x - left.x) * scale,
    y: (right.y - left.y) * scale,
  };
}

function centripetalTangent(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
): readonly [Point, Point] {
  const t0 = 0;
  const t1 = t0 + knotIncrement(p0, p1);
  const t2 = t1 + knotIncrement(p1, p2);
  const t3 = t2 + knotIncrement(p2, p3);
  const span = t2 - t1;

  const a = scaledDifference(p0, p1, 1 / (t1 - t0));
  const b = scaledDifference(p0, p2, 1 / (t2 - t0));
  const c = scaledDifference(p1, p2, 1 / (t2 - t1));
  const d = scaledDifference(p1, p2, 1 / (t2 - t1));
  const e = scaledDifference(p1, p3, 1 / (t3 - t1));
  const f = scaledDifference(p2, p3, 1 / (t3 - t2));
  let start = {
    x: span * (a.x - b.x + c.x),
    y: span * (a.y - b.y + c.y),
  };
  let end = {
    x: span * (d.x - e.x + f.x),
    y: span * (d.y - e.y + f.y),
  };

  const chordX = p2.x - p1.x;
  const chordY = p2.y - p1.y;
  const chordLength = Math.hypot(chordX, chordY);
  if (chordLength <= EPSILON) return [{ x: 0, y: 0 }, { x: 0, y: 0 }];
  const limit = chordLength * 2;
  const bound = (tangent: Point): Point => {
    const length = Math.hypot(tangent.x, tangent.y);
    const dot = tangent.x * chordX + tangent.y * chordY;
    if (!Number.isFinite(length) || dot <= 0) return { x: 0, y: 0 };
    if (length <= limit) return tangent;
    return { x: tangent.x * limit / length, y: tangent.y * limit / length };
  };
  start = bound(start);
  end = bound(end);
  return [start, end];
}

function isSharpCorner(
  previous: Point,
  current: Point,
  next: Point,
  thresholdDegrees: number,
): boolean {
  const incomingX = current.x - previous.x;
  const incomingY = current.y - previous.y;
  const outgoingX = next.x - current.x;
  const outgoingY = next.y - current.y;
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);
  if (incomingLength <= EPSILON || outgoingLength <= EPSILON) return false;
  const cosine = clamp(
    (incomingX * outgoingX + incomingY * outgoingY)
      / (incomingLength * outgoingLength),
    -1,
    1,
  );
  return Math.acos(cosine) * 180 / Math.PI >= thresholdDegrees;
}

function cubicPoint(segment: StudioStrokeCurveSegmentV2, u: number): Point {
  const inverse = 1 - u;
  const inverse2 = inverse * inverse;
  const u2 = u * u;
  return {
    x: inverse2 * inverse * segment.p1.x
      + 3 * inverse2 * u * segment.c1.x
      + 3 * inverse * u2 * segment.c2.x
      + u2 * u * segment.p2.x,
    y: inverse2 * inverse * segment.p1.y
      + 3 * inverse2 * u * segment.c1.y
      + 3 * inverse * u2 * segment.c2.y
      + u2 * u * segment.p2.y,
  };
}

function cubicDerivatives(
  segment: StudioStrokeCurveSegmentV2,
  u: number,
): readonly [Point, Point] {
  const inverse = 1 - u;
  const first = {
    x: 3 * inverse * inverse * (segment.c1.x - segment.p1.x)
      + 6 * inverse * u * (segment.c2.x - segment.c1.x)
      + 3 * u * u * (segment.p2.x - segment.c2.x),
    y: 3 * inverse * inverse * (segment.c1.y - segment.p1.y)
      + 6 * inverse * u * (segment.c2.y - segment.c1.y)
      + 3 * u * u * (segment.p2.y - segment.c2.y),
  };
  const second = {
    x: 6 * inverse * (segment.c2.x - 2 * segment.c1.x + segment.p1.x)
      + 6 * u * (segment.p2.x - 2 * segment.c2.x + segment.c1.x),
    y: 6 * inverse * (segment.c2.y - 2 * segment.c1.y + segment.p1.y)
      + 6 * u * (segment.p2.y - 2 * segment.c2.y + segment.c1.y),
  };
  return [first, second];
}

function buildArcLengthLut(
  segment: Omit<StudioStrokeCurveSegmentV2, "arcLengthLut">,
  subdivisions: number,
): StudioStrokeCurveArcLengthLutV2 | null {
  const parameters = new Array<number>(subdivisions + 1);
  const lengths = new Array<number>(subdivisions + 1);
  parameters[0] = 0;
  lengths[0] = 0;
  let previous = segment.p1;
  let totalLength = 0;
  for (let index = 1; index <= subdivisions; index += 1) {
    const parameter = index / subdivisions;
    const current = cubicPoint(
      segment as StudioStrokeCurveSegmentV2,
      parameter,
    );
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    totalLength += distance;
    if (!Number.isFinite(totalLength)) return null;
    parameters[index] = parameter;
    lengths[index] = totalLength;
    previous = current;
  }
  return Object.freeze({
    subdivisions,
    parameters: Object.freeze(parameters),
    lengths: Object.freeze(lengths),
    totalLength,
  });
}

function makeSegment(
  samples: readonly StudioCanonicalStrokeSampleV2[],
  index: number,
  settled: boolean,
  subdivisions: number,
  cornerThresholdDegrees: number,
): StudioStrokeCurveSegmentV2 | null {
  const from = samples[index]!;
  const to = samples[index + 1]!;
  const p1 = { x: from.x, y: from.y };
  const p2 = { x: to.x, y: to.y };
  const p0 = index > 0
    ? { x: samples[index - 1]!.x, y: samples[index - 1]!.y }
    : extrapolate(p2, p1);
  const p3 = index + 2 < samples.length
    ? { x: samples[index + 2]!.x, y: samples[index + 2]!.y }
    : extrapolate(p1, p2);
  let [startTangent, endTangent] = centripetalTangent(p0, p1, p2, p3);
  if (index > 0 && isSharpCorner(p0, p1, p2, cornerThresholdDegrees)) {
    startTangent = { x: 0, y: 0 };
  }
  if (
    index + 2 < samples.length
    && isSharpCorner(p1, p2, p3, cornerThresholdDegrees)
  ) {
    endTangent = { x: 0, y: 0 };
  }
  const base = {
    index,
    settled,
    role: (
      from.role === "predicted" || to.role === "predicted"
        ? "predicted"
        : "authoritative"
    ) as "authoritative" | "predicted",
    fromSequence: from.sequence,
    toSequence: to.sequence,
    p0: frozenPoint(p0.x, p0.y),
    p1: frozenPoint(p1.x, p1.y),
    p2: frozenPoint(p2.x, p2.y),
    p3: frozenPoint(p3.x, p3.y),
    c1: frozenPoint(p1.x + startTangent.x / 3, p1.y + startTangent.y / 3),
    c2: frozenPoint(p2.x - endTangent.x / 3, p2.y - endTangent.y / 3),
  };
  const arcLengthLut = buildArcLengthLut(base, subdivisions);
  return arcLengthLut ? Object.freeze({ ...base, arcLengthLut }) : null;
}

function parameterAtLength(
  lut: StudioStrokeCurveArcLengthLutV2,
  distance: number,
): number {
  if (distance <= 0 || lut.totalLength <= EPSILON) return 0;
  if (distance >= lut.totalLength) return 1;
  let lower = 0;
  let upper = lut.lengths.length - 1;
  while (upper - lower > 1) {
    const middle = (lower + upper) >>> 1;
    if (lut.lengths[middle]! <= distance) lower = middle;
    else upper = middle;
  }
  const lengthStart = lut.lengths[lower]!;
  const lengthSpan = lut.lengths[upper]! - lengthStart;
  const amount = lengthSpan <= EPSILON ? 0 : (distance - lengthStart) / lengthSpan;
  return lut.parameters[lower]!
    + (lut.parameters[upper]! - lut.parameters[lower]!) * amount;
}

function channelKnotInterval(
  left: StudioCanonicalStrokeSampleV2,
  right: StudioCanonicalStrokeSampleV2,
): number {
  // Match the centripetal geometry parameterization. This keeps pressure and pen orientation
  // stable when the browser delivers the same physical path at a different event cadence.
  return knotIncrement(left, right);
}

function monotoneDerivative(
  leftSlope: number,
  rightSlope: number,
  leftInterval: number,
  rightInterval: number,
): number {
  if (
    Math.abs(leftSlope) <= EPSILON
    || Math.abs(rightSlope) <= EPSILON
    || Math.sign(leftSlope) !== Math.sign(rightSlope)
  ) return 0;
  const leftWeight = 2 * rightInterval + leftInterval;
  const rightWeight = rightInterval + 2 * leftInterval;
  return (leftWeight + rightWeight)
    / (leftWeight / leftSlope + rightWeight / rightSlope);
}

function interpolateMonotoneValues(
  previousValue: number | null,
  fromValue: number,
  toValue: number,
  nextValue: number | null,
  previousInterval: number,
  interval: number,
  nextInterval: number,
  parameter: number,
): number {
  const slope = (toValue - fromValue) / interval;

  let fromDerivative = slope;
  if (previousValue !== null) {
    const previousSlope = (fromValue - previousValue) / previousInterval;
    fromDerivative = monotoneDerivative(
      previousSlope,
      slope,
      previousInterval,
      interval,
    );
  }

  let toDerivative = slope;
  if (nextValue !== null) {
    const nextSlope = (nextValue - toValue) / nextInterval;
    toDerivative = monotoneDerivative(
      slope,
      nextSlope,
      interval,
      nextInterval,
    );
  }

  const parameter2 = parameter * parameter;
  const parameter3 = parameter2 * parameter;
  const fromBasis = 2 * parameter3 - 3 * parameter2 + 1;
  const fromDerivativeBasis = parameter3 - 2 * parameter2 + parameter;
  const toBasis = -2 * parameter3 + 3 * parameter2;
  const toDerivativeBasis = parameter3 - parameter2;
  const value = fromBasis * fromValue
    + fromDerivativeBasis * interval * fromDerivative
    + toBasis * toValue
    + toDerivativeBasis * interval * toDerivative;

  // The harmonic derivatives above are shape preserving. The clamp also protects the renderer
  // from the last few floating-point ulps escaping a physical channel's endpoint range.
  return clamp(value, Math.min(fromValue, toValue), Math.max(fromValue, toValue));
}

function interpolateMonotoneChannel(
  previous: StudioCanonicalStrokeSampleV2 | null,
  from: StudioCanonicalStrokeSampleV2,
  to: StudioCanonicalStrokeSampleV2,
  next: StudioCanonicalStrokeSampleV2 | null,
  parameter: number,
  channel: "pressure" | "tangentialPressure" | "tiltX" | "tiltY",
): number {
  return interpolateMonotoneValues(
    previous ? previous[channel] : null,
    from[channel],
    to[channel],
    next ? next[channel] : null,
    previous ? channelKnotInterval(previous, from) : 1,
    channelKnotInterval(from, to),
    next ? channelKnotInterval(to, next) : 1,
    parameter,
  );
}

function shortestTwistDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function interpolateMonotoneTwist(
  previous: StudioCanonicalStrokeSampleV2 | null,
  from: StudioCanonicalStrokeSampleV2,
  to: StudioCanonicalStrokeSampleV2,
  next: StudioCanonicalStrokeSampleV2 | null,
  parameter: number,
): number {
  const fromTwist = from.twist;
  const toTwist = fromTwist + shortestTwistDelta(from.twist, to.twist);
  const previousTwist = previous
    ? fromTwist - shortestTwistDelta(previous.twist, from.twist)
    : fromTwist;
  const nextTwist = next
    ? toTwist + shortestTwistDelta(to.twist, next.twist)
    : toTwist;
  const value = interpolateMonotoneValues(
    previous ? previousTwist : null,
    fromTwist,
    toTwist,
    next ? nextTwist : null,
    previous ? channelKnotInterval(previous, from) : 1,
    channelKnotInterval(from, to),
    next ? channelKnotInterval(to, next) : 1,
    parameter,
  ) % 360;
  return value < 0 ? value + 360 : value;
}

function stationAt(
  segment: InternalSegment,
  distance: number,
): StudioStrokeCurveStationV2 {
  const localDistance = clamp(
    distance - segment.cumulativeStart,
    0,
    segment.publicSegment.arcLengthLut.totalLength,
  );
  const parameter = parameterAtLength(
    segment.publicSegment.arcLengthLut,
    localDistance,
  );
  const point = cubicPoint(segment.publicSegment, parameter);
  const interpolate = (from: number, to: number): number =>
    from + (to - from) * parameter;
  const discrete = parameter <= 0 ? segment.from : segment.to;
  return Object.freeze({
    distance,
    segmentIndex: segment.publicSegment.index,
    parameter,
    role: segment.publicSegment.role,
    x: point.x,
    y: point.y,
    pressure: interpolateMonotoneChannel(
      segment.previous,
      segment.from,
      segment.to,
      segment.next,
      parameter,
      "pressure",
    ),
    tangentialPressure: interpolateMonotoneChannel(
      segment.previous,
      segment.from,
      segment.to,
      segment.next,
      parameter,
      "tangentialPressure",
    ),
    tiltX: interpolateMonotoneChannel(
      segment.previous,
      segment.from,
      segment.to,
      segment.next,
      parameter,
      "tiltX",
    ),
    tiltY: interpolateMonotoneChannel(
      segment.previous,
      segment.from,
      segment.to,
      segment.next,
      parameter,
      "tiltY",
    ),
    twist: interpolateMonotoneTwist(
      segment.previous,
      segment.from,
      segment.to,
      segment.next,
      parameter,
    ),
    timeMilliseconds: interpolate(
      segment.from.timeMilliseconds,
      segment.to.timeMilliseconds,
    ),
    sourceTimeMilliseconds: interpolate(
      segment.from.sourceTimeMilliseconds,
      segment.to.sourceTimeMilliseconds,
    ),
    pointerId: discrete.pointerId,
    pointerType: discrete.pointerType,
    button: discrete.button,
    buttons: discrete.buttons,
    flags: discrete.flags,
    fromSequence: segment.from.sequence,
    toSequence: segment.to.sequence,
  });
}

function segmentAtDistance(
  segments: readonly InternalSegment[],
  distance: number,
): InternalSegment | null {
  if (segments.length === 0) return null;
  let lower = 0;
  let upper = segments.length - 1;
  while (lower < upper) {
    const middle = (lower + upper) >>> 1;
    if (segments[middle]!.cumulativeEnd < distance) lower = middle + 1;
    else upper = middle;
  }
  return segments[lower]!;
}

function curvatureAt(segment: StudioStrokeCurveSegmentV2, parameter: number): number {
  const [first, second] = cubicDerivatives(segment, parameter);
  const speedSquared = first.x * first.x + first.y * first.y;
  if (speedSquared <= EPSILON) return 0;
  return Math.abs(first.x * second.y - first.y * second.x)
    / Math.pow(speedSquared, 1.5);
}

function nextSpacing(
  station: StudioStrokeCurveStationV2,
  segment: StudioStrokeCurveSegmentV2,
  spacing: number,
  curvatureStrength: number,
  minimumSpacingRatio: number,
): number {
  const curvature = Math.min(
    4,
    curvatureAt(segment, station.parameter) * spacing,
  );
  return Math.max(
    spacing * minimumSpacingRatio,
    spacing / (1 + curvatureStrength * curvature),
  );
}

function invalid(
  reason: StudioStrokeCurvePlanFailureReasonV2,
): StudioStrokeCurvePlanResultV2 {
  return Object.freeze({ ok: false, reason });
}

export function planStudioStrokeCurveV2(
  stroke: StudioCanonicalStrokeV2,
  options: StudioStrokeCurveResamplerOptionsV2,
): StudioStrokeCurvePlanResultV2 {
  try {
    if (
      stroke.kind !== "studio-canonical-stroke"
      || stroke.version !== 2
      || stroke.streams.authoritative.length === 0
    ) return invalid("invalid-stroke");
    const spacing = options.spacing;
    const curvatureStrength = options.curvatureStrength ?? 1;
    const minimumSpacingRatio = options.minimumSpacingRatio ?? 0.35;
    const cornerThresholdDegrees = options.cornerThresholdDegrees ?? 55;
    const subdivisions = options.lutSubdivisions ?? 32;
    const maximumStations = options.maximumStations
      ?? STUDIO_STROKE_CURVE_RESAMPLER_V2_BUDGETS.maxStations;
    if (
      !finitePositive(spacing)
      || !Number.isFinite(curvatureStrength)
      || curvatureStrength < 0
      || !Number.isFinite(minimumSpacingRatio)
      || minimumSpacingRatio <= 0
      || minimumSpacingRatio > 1
      || !Number.isFinite(cornerThresholdDegrees)
      || cornerThresholdDegrees <= 0
      || cornerThresholdDegrees > 180
      || !Number.isInteger(subdivisions)
      || subdivisions < 4
      || subdivisions
        > STUDIO_STROKE_CURVE_RESAMPLER_V2_BUDGETS.maxLutSubdivisions
      || !Number.isInteger(maximumStations)
      || maximumStations < 1
      || maximumStations > STUDIO_STROKE_CURVE_RESAMPLER_V2_BUDGETS.maxStations
    ) return invalid("invalid-options");

    const authoritative = stroke.streams.authoritative;
    const samples = Object.freeze([
      ...authoritative,
      ...stroke.streams.predicted,
    ]);
    const segmentCount = Math.max(0, samples.length - 1);
    const settledSegmentCount = options.sealAuthoritativeTail === true
      ? Math.max(0, authoritative.length - 1)
      : Math.max(0, authoritative.length - 2);
    if (
      segmentCount > STUDIO_STROKE_CURVE_RESAMPLER_V2_BUDGETS.maxSegments
      || segmentCount * (subdivisions + 1)
        > STUDIO_STROKE_CURVE_RESAMPLER_V2_BUDGETS.maxArcLutEntries
    ) return invalid("budget-exceeded");

    const segments: InternalSegment[] = [];
    let totalLength = 0;
    for (let index = 0; index < segmentCount; index += 1) {
      const publicSegment = makeSegment(
        samples,
        index,
        index < settledSegmentCount,
        subdivisions,
        cornerThresholdDegrees,
      );
      if (!publicSegment) return invalid("numeric-overflow");
      const cumulativeStart = totalLength;
      totalLength += publicSegment.arcLengthLut.totalLength;
      if (!Number.isFinite(totalLength)) return invalid("numeric-overflow");
      segments.push({
        publicSegment,
        previous: samples[index - 1] ?? null,
        from: samples[index]!,
        to: samples[index + 1]!,
        next: samples[index + 2] ?? null,
        cumulativeStart,
        cumulativeEnd: totalLength,
      });
    }
    const settledLength = settledSegmentCount === 0
      ? 0
      : segments[settledSegmentCount - 1]!.cumulativeEnd;

    const settledStations: StudioStrokeCurveStationV2[] = [];
    const first = authoritative[0]!;
    const firstSegment = segments[0];
    if (firstSegment) settledStations.push(stationAt(firstSegment, 0));
    else {
      settledStations.push(Object.freeze({
        distance: 0,
        segmentIndex: -1,
        parameter: 0,
        role: "authoritative",
        x: first.x,
        y: first.y,
        pressure: first.pressure,
        tangentialPressure: first.tangentialPressure,
        tiltX: first.tiltX,
        tiltY: first.tiltY,
        twist: first.twist,
        timeMilliseconds: first.timeMilliseconds,
        sourceTimeMilliseconds: first.sourceTimeMilliseconds,
        pointerId: first.pointerId,
        pointerType: first.pointerType,
        button: first.button,
        buttons: first.buttons,
        flags: first.flags,
        fromSequence: first.sequence,
        toSequence: first.sequence,
      }));
    }

    let nextDistance = spacing;
    while (nextDistance < settledLength - EPSILON) {
      if (settledStations.length >= maximumStations) {
        return invalid("budget-exceeded");
      }
      const segment = segmentAtDistance(segments, nextDistance);
      if (!segment) return invalid("numeric-overflow");
      const station = stationAt(segment, nextDistance);
      settledStations.push(station);
      nextDistance += nextSpacing(
        station,
        segment.publicSegment,
        spacing,
        curvatureStrength,
        minimumSpacingRatio,
      );
    }

    const previewStations: StudioStrokeCurveStationV2[] = [];
    while (nextDistance < totalLength - EPSILON) {
      if (settledStations.length + previewStations.length >= maximumStations) {
        return invalid("budget-exceeded");
      }
      const segment = segmentAtDistance(segments, nextDistance);
      if (!segment) return invalid("numeric-overflow");
      const station = stationAt(segment, nextDistance);
      previewStations.push(station);
      nextDistance += nextSpacing(
        station,
        segment.publicSegment,
        spacing,
        curvatureStrength,
        minimumSpacingRatio,
      );
    }
    if (segments.length > 0) {
      const terminalSegment = segments.at(-1)!;
      const terminal = stationAt(terminalSegment, totalLength);
      const previous = previewStations.at(-1) ?? settledStations.at(-1);
      if (
        !previous
        || Math.hypot(terminal.x - previous.x, terminal.y - previous.y) > EPSILON
      ) {
        if (settledStations.length + previewStations.length >= maximumStations) {
          return invalid("budget-exceeded");
        }
        if (
          options.sealAuthoritativeTail === true
          && stroke.streams.predicted.length === 0
        ) settledStations.push(terminal);
        else previewStations.push(terminal);
      }
    }

    const value: StudioStrokeCurvePlanV2 = Object.freeze({
      kind: "studio-stroke-curve-plan",
      version: STUDIO_STROKE_CURVE_RESAMPLER_V2_VERSION,
      strokeId: stroke.strokeId,
      segments: Object.freeze(segments.map(segment => segment.publicSegment)),
      settledSegmentCount,
      settledLength,
      totalLength,
      settledStations: Object.freeze(settledStations),
      previewStations: Object.freeze(previewStations),
    });
    return Object.freeze({ ok: true, value });
  } catch {
    return invalid("invalid-stroke");
  }
}
