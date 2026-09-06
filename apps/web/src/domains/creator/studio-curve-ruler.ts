/**
 * Studio Curve Ruler
 *
 * DOM/React/Konva independent cubic-Bezier geometry for a future authored curve ruler. The
 * module deliberately owns no document schema or UI state. Callers may persist a ruler in any
 * versioned envelope, then create an immutable snap session at pointer-down so editing the ruler
 * while a pointer is still down cannot bend an in-flight stroke.
 */

export interface StudioCurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioCubicBezier {
  readonly p0: StudioCurvePoint;
  readonly p1: StudioCurvePoint;
  readonly p2: StudioCurvePoint;
  readonly p3: StudioCurvePoint;
}

export interface StudioCurveRuler extends StudioCubicBezier {
  readonly id: string;
}

export interface StudioCurveProjection {
  /** Parameter on the authored cubic, clamped to [0, 1]. */
  readonly t: number;
  /** Nearest point on the requested base or parallel-offset curve. */
  readonly point: StudioCurvePoint;
  /** Point on the authored cubic before applying `offset`. */
  readonly curvePoint: StudioCurvePoint;
  readonly tangent: StudioCurvePoint;
  readonly normal: StudioCurvePoint;
  readonly offset: number;
  readonly distance: number;
}

export interface StudioCurveProjectionOptions {
  /** Signed distance along the curve's left normal. */
  readonly offset?: number;
  /** Deterministic coarse samples used before Newton refinement. */
  readonly samples?: number;
  /** Maximum Newton iterations for every local-minimum candidate. */
  readonly newtonIterations?: number;
  /** Tie-breaker for self-crossing curves; does not exclude a globally nearer branch. */
  readonly hintT?: number;
}

export type StudioCurveSnapOffsetMode = "on-curve" | "through-start" | "fixed";

export interface StudioCurveSnapSessionOptions {
  readonly offsetMode?: StudioCurveSnapOffsetMode;
  /** Used only by `offsetMode: "fixed"`. */
  readonly offset?: number;
  readonly samples?: number;
  readonly newtonIterations?: number;
}

/** Immutable, persistent stroke state. `snapStudioCurvePoint` returns a new session. */
export interface StudioCurveSnapSession {
  readonly version: 1;
  readonly ruler: StudioCurveRuler;
  readonly offset: number;
  readonly lastT: number;
  readonly samples: number;
  readonly newtonIterations: number;
}

export interface StudioCurveSnapTransition {
  readonly session: StudioCurveSnapSession;
  readonly projection: StudioCurveProjection;
  readonly point: StudioCurvePoint;
}

export const STUDIO_CURVE_RULER_MAX_COORDINATE = 10_000_000;
export const STUDIO_CURVE_RULER_MAX_OFFSET = 1_000_000;
export const STUDIO_CURVE_RULER_DEFAULT_SAMPLES = 96;
export const STUDIO_CURVE_RULER_MIN_SAMPLES = 16;
export const STUDIO_CURVE_RULER_MAX_SAMPLES = 512;
export const STUDIO_CURVE_RULER_DEFAULT_NEWTON_ITERATIONS = 8;
export const STUDIO_CURVE_RULER_MAX_NEWTON_ITERATIONS = 16;

const MAX_IDENTIFIER_LENGTH = 160;
const MIN_USABLE_CONTROL_POLYGON_LENGTH = 1e-6;
const MIN_TANGENT_LENGTH = 1e-10;
const NEWTON_DENOMINATOR_EPSILON = 1e-12;
const TIE_EPSILON = 1e-10;
const OFFSET_DERIVATIVE_STEP = 1e-4;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedCoordinate(value: unknown): value is number {
  return finiteNumber(value) && Math.abs(value) <= STUDIO_CURVE_RULER_MAX_COORDINATE;
}

function validIdentifier(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    return false;
  }
  return ![...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
}

function ownDataValue(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function pointFromUnknown(value: unknown): StudioCurvePoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = ownDataValue(value, "x");
  const y = ownDataValue(value, "y");
  return boundedCoordinate(x) && boundedCoordinate(y) ? { x, y } : null;
}

function pointIsFinite(point: StudioCurvePoint): boolean {
  return boundedCoordinate(point.x) && boundedCoordinate(point.y);
}

function curveIsFinite(curve: StudioCubicBezier): boolean {
  try {
    return pointIsFinite(curve.p0) && pointIsFinite(curve.p1)
      && pointIsFinite(curve.p2) && pointIsFinite(curve.p3);
  } catch {
    return false;
  }
}

function distance(left: StudioCurvePoint, right: StudioCurvePoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function controlPolygonLength(curve: StudioCubicBezier): number {
  return distance(curve.p0, curve.p1) + distance(curve.p1, curve.p2)
    + distance(curve.p2, curve.p3);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function sanitizedSamples(value: number | undefined): number {
  if (!finiteNumber(value)) return STUDIO_CURVE_RULER_DEFAULT_SAMPLES;
  return Math.min(
    STUDIO_CURVE_RULER_MAX_SAMPLES,
    Math.max(STUDIO_CURVE_RULER_MIN_SAMPLES, Math.round(value))
  );
}

function sanitizedIterations(value: number | undefined): number {
  if (!finiteNumber(value)) return STUDIO_CURVE_RULER_DEFAULT_NEWTON_ITERATIONS;
  return Math.min(
    STUDIO_CURVE_RULER_MAX_NEWTON_ITERATIONS,
    Math.max(0, Math.round(value))
  );
}

function sanitizedOffset(value: number | undefined): number | null {
  if (!finiteNumber(value) || Math.abs(value) > STUDIO_CURVE_RULER_MAX_OFFSET) return null;
  return value;
}

function freezePoint(point: StudioCurvePoint): StudioCurvePoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeRuler(ruler: StudioCurveRuler): StudioCurveRuler {
  return Object.freeze({
    id: ruler.id,
    p0: freezePoint(ruler.p0),
    p1: freezePoint(ruler.p1),
    p2: freezePoint(ruler.p2),
    p3: freezePoint(ruler.p3),
  });
}

/**
 * Canonicalizes an untrusted ruler without invoking accessors. Invalid identifiers, non-finite or
 * out-of-budget coordinates, and a completely collapsed control polygon fail closed with `null`.
 */
export function canonicalizeStudioCurveRuler(value: unknown): StudioCurveRuler | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = ownDataValue(value, "id");
  const p0 = pointFromUnknown(ownDataValue(value, "p0"));
  const p1 = pointFromUnknown(ownDataValue(value, "p1"));
  const p2 = pointFromUnknown(ownDataValue(value, "p2"));
  const p3 = pointFromUnknown(ownDataValue(value, "p3"));
  if (!validIdentifier(id) || !p0 || !p1 || !p2 || !p3) return null;
  const ruler = { id, p0, p1, p2, p3 };
  if (controlPolygonLength(ruler) < MIN_USABLE_CONTROL_POLYGON_LENGTH) return null;
  return freezeRuler(ruler);
}

/** Evaluates the cubic at `t`; invalid geometry or a non-finite parameter returns `null`. */
export function evaluateStudioCubicBezier(
  curve: StudioCubicBezier,
  t: number
): StudioCurvePoint | null {
  if (!finiteNumber(t) || !curveIsFinite(curve)) return null;
  const u = clamp01(t);
  const inverse = 1 - u;
  const w0 = inverse * inverse * inverse;
  const w1 = 3 * inverse * inverse * u;
  const w2 = 3 * inverse * u * u;
  const w3 = u * u * u;
  const x = w0 * curve.p0.x + w1 * curve.p1.x + w2 * curve.p2.x + w3 * curve.p3.x;
  const y = w0 * curve.p0.y + w1 * curve.p1.y + w2 * curve.p2.y + w3 * curve.p3.y;
  return finiteNumber(x) && finiteNumber(y) ? { x, y } : null;
}

/** First derivative of the cubic at `t`; invalid input returns `null`. */
export function derivativeStudioCubicBezier(
  curve: StudioCubicBezier,
  t: number
): StudioCurvePoint | null {
  if (!finiteNumber(t) || !curveIsFinite(curve)) return null;
  const u = clamp01(t);
  const inverse = 1 - u;
  const x = 3 * inverse * inverse * (curve.p1.x - curve.p0.x)
    + 6 * inverse * u * (curve.p2.x - curve.p1.x)
    + 3 * u * u * (curve.p3.x - curve.p2.x);
  const y = 3 * inverse * inverse * (curve.p1.y - curve.p0.y)
    + 6 * inverse * u * (curve.p2.y - curve.p1.y)
    + 3 * u * u * (curve.p3.y - curve.p2.y);
  return finiteNumber(x) && finiteNumber(y) ? { x, y } : null;
}

/** Second derivative used by the nearest-point Newton solver. */
export function secondDerivativeStudioCubicBezier(
  curve: StudioCubicBezier,
  t: number
): StudioCurvePoint | null {
  if (!finiteNumber(t) || !curveIsFinite(curve)) return null;
  const u = clamp01(t);
  const inverse = 1 - u;
  const x = 6 * inverse * (curve.p2.x - 2 * curve.p1.x + curve.p0.x)
    + 6 * u * (curve.p3.x - 2 * curve.p2.x + curve.p1.x);
  const y = 6 * inverse * (curve.p2.y - 2 * curve.p1.y + curve.p0.y)
    + 6 * u * (curve.p3.y - 2 * curve.p2.y + curve.p1.y);
  return finiteNumber(x) && finiteNumber(y) ? { x, y } : null;
}

function tangentAndNormal(
  curve: StudioCubicBezier,
  t: number
): { tangent: StudioCurvePoint; normal: StudioCurvePoint } | null {
  let tangent = derivativeStudioCubicBezier(curve, t);
  let tangentLength = tangent ? Math.hypot(tangent.x, tangent.y) : 0;
  if (tangentLength < MIN_TANGENT_LENGTH) {
    const before = evaluateStudioCubicBezier(curve, Math.max(0, t - 1e-3));
    const after = evaluateStudioCubicBezier(curve, Math.min(1, t + 1e-3));
    if (before && after) {
      tangent = { x: after.x - before.x, y: after.y - before.y };
      tangentLength = Math.hypot(tangent.x, tangent.y);
    }
  }
  if (!tangent || tangentLength < MIN_TANGENT_LENGTH || !finiteNumber(tangentLength)) return null;
  const unit = { x: tangent.x / tangentLength, y: tangent.y / tangentLength };
  return { tangent: unit, normal: { x: -unit.y, y: unit.x } };
}

/** Evaluates a signed parallel offset. Cusps fall back to a local secant; unusable cusps return null. */
export function evaluateStudioCurveParallelOffset(
  curve: StudioCubicBezier,
  t: number,
  offset: number
): StudioCurvePoint | null {
  const safeOffset = sanitizedOffset(offset);
  const base = evaluateStudioCubicBezier(curve, t);
  const frame = tangentAndNormal(curve, t);
  if (safeOffset === null || !base || !frame) return null;
  return {
    x: base.x + frame.normal.x * safeOffset,
    y: base.y + frame.normal.y * safeOffset,
  };
}

/** Deterministically samples a base or parallel curve, including both endpoints exactly once. */
export function sampleStudioCurveParallelOffset(
  curve: StudioCubicBezier,
  offset = 0,
  sampleCount = STUDIO_CURVE_RULER_DEFAULT_SAMPLES
): StudioCurvePoint[] {
  const count = sanitizedSamples(sampleCount);
  if (!curveIsFinite(curve) || sanitizedOffset(offset) === null) return [];
  const points: StudioCurvePoint[] = [];
  for (let index = 0; index <= count; index += 1) {
    const point = evaluateStudioCurveParallelOffset(curve, index / count, offset);
    if (!point) return [];
    points.push(point);
  }
  return points;
}

interface CurveEvaluationFrame {
  point: StudioCurvePoint;
  curvePoint: StudioCurvePoint;
  tangent: StudioCurvePoint;
  normal: StudioCurvePoint;
}

function evaluateFrame(
  curve: StudioCubicBezier,
  t: number,
  offset: number
): CurveEvaluationFrame | null {
  const curvePoint = evaluateStudioCubicBezier(curve, t);
  const frame = tangentAndNormal(curve, t);
  if (!curvePoint || !frame) return null;
  return {
    point: {
      x: curvePoint.x + frame.normal.x * offset,
      y: curvePoint.y + frame.normal.y * offset,
    },
    curvePoint,
    tangent: frame.tangent,
    normal: frame.normal,
  };
}

function squaredDistance(left: StudioCurvePoint, right: StudioCurvePoint): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function offsetDerivatives(
  curve: StudioCubicBezier,
  t: number,
  offset: number
): { first: StudioCurvePoint; second: StudioCurvePoint } | null {
  if (offset === 0) {
    const first = derivativeStudioCubicBezier(curve, t);
    const second = secondDerivativeStudioCubicBezier(curve, t);
    return first && second ? { first, second } : null;
  }
  if (t <= OFFSET_DERIVATIVE_STEP || t >= 1 - OFFSET_DERIVATIVE_STEP) return null;
  const before = evaluateStudioCurveParallelOffset(curve, t - OFFSET_DERIVATIVE_STEP, offset);
  const at = evaluateStudioCurveParallelOffset(curve, t, offset);
  const after = evaluateStudioCurveParallelOffset(curve, t + OFFSET_DERIVATIVE_STEP, offset);
  if (!before || !at || !after) return null;
  const inverseSpan = 1 / (2 * OFFSET_DERIVATIVE_STEP);
  const inverseSquaredStep = 1 / (OFFSET_DERIVATIVE_STEP * OFFSET_DERIVATIVE_STEP);
  return {
    first: {
      x: (after.x - before.x) * inverseSpan,
      y: (after.y - before.y) * inverseSpan,
    },
    second: {
      x: (after.x - 2 * at.x + before.x) * inverseSquaredStep,
      y: (after.y - 2 * at.y + before.y) * inverseSquaredStep,
    },
  };
}

function refineProjectionCandidate(
  curve: StudioCubicBezier,
  target: StudioCurvePoint,
  initialT: number,
  offset: number,
  iterations: number
): number {
  let t = clamp01(initialT);
  for (let index = 0; index < iterations; index += 1) {
    const frame = evaluateFrame(curve, t, offset);
    const derivatives = offsetDerivatives(curve, t, offset);
    if (!frame || !derivatives) break;
    const deltaX = frame.point.x - target.x;
    const deltaY = frame.point.y - target.y;
    const numerator = deltaX * derivatives.first.x + deltaY * derivatives.first.y;
    const denominator = derivatives.first.x * derivatives.first.x
      + derivatives.first.y * derivatives.first.y
      + deltaX * derivatives.second.x + deltaY * derivatives.second.y;
    if (!finiteNumber(numerator) || !finiteNumber(denominator)
      || Math.abs(denominator) < NEWTON_DENOMINATOR_EPSILON) break;
    const next = clamp01(t - numerator / denominator);
    if (!finiteNumber(next) || Math.abs(next - t) < 1e-12) {
      if (finiteNumber(next)) t = next;
      break;
    }
    t = next;
  }
  return t;
}

/**
 * Finds the globally nearest point using deterministic coarse samples, every sampled local
 * minimum, and bounded Newton refinement. Endpoints always remain candidates, so Newton cannot
 * move a valid endpoint solution off the finite curve.
 */
export function projectPointOntoStudioCubicBezier(
  curve: StudioCubicBezier,
  target: StudioCurvePoint,
  options: StudioCurveProjectionOptions = {}
): StudioCurveProjection | null {
  if (!curveIsFinite(curve) || !pointIsFinite(target)
    || controlPolygonLength(curve) < MIN_USABLE_CONTROL_POLYGON_LENGTH) return null;
  const offset = sanitizedOffset(options.offset ?? 0);
  if (offset === null) return null;
  const samples = sanitizedSamples(options.samples);
  const iterations = sanitizedIterations(options.newtonIterations);
  const hintT = finiteNumber(options.hintT) ? clamp01(options.hintT) : null;
  const sampledDistances = new Array<number>(samples + 1);
  for (let index = 0; index <= samples; index += 1) {
    const frame = evaluateFrame(curve, index / samples, offset);
    sampledDistances[index] = frame ? squaredDistance(frame.point, target) : Number.POSITIVE_INFINITY;
  }

  const candidateIndices = new Set<number>([0, samples]);
  for (let index = 1; index < samples; index += 1) {
    const value = sampledDistances[index]!;
    if (value <= sampledDistances[index - 1]! && value <= sampledDistances[index + 1]!) {
      candidateIndices.add(index);
    }
  }
  let globalIndex = 0;
  for (let index = 1; index <= samples; index += 1) {
    if (sampledDistances[index]! < sampledDistances[globalIndex]!) globalIndex = index;
  }
  candidateIndices.add(globalIndex);

  let bestT: number | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const index of candidateIndices) {
    const t = refineProjectionCandidate(curve, target, index / samples, offset, iterations);
    const frame = evaluateFrame(curve, t, offset);
    if (!frame) continue;
    const value = squaredDistance(frame.point, target);
    const tied = Math.abs(value - bestDistanceSquared) <= TIE_EPSILON;
    const closerToHint = tied && hintT !== null && bestT !== null
      && Math.abs(t - hintT) < Math.abs(bestT - hintT);
    if (value < bestDistanceSquared - TIE_EPSILON || closerToHint
      || (tied && hintT === null && (bestT === null || t < bestT))) {
      bestT = t;
      bestDistanceSquared = value;
    }
  }
  if (bestT === null || !finiteNumber(bestDistanceSquared)) return null;
  const best = evaluateFrame(curve, bestT, offset);
  if (!best) return null;
  return {
    t: bestT,
    point: best.point,
    curvePoint: best.curvePoint,
    tangent: best.tangent,
    normal: best.normal,
    offset,
    distance: Math.sqrt(Math.max(0, bestDistanceSquared)),
  };
}

function freezeSession(
  ruler: StudioCurveRuler,
  offset: number,
  lastT: number,
  samples: number,
  newtonIterations: number
): StudioCurveSnapSession {
  return Object.freeze({
    version: 1 as const,
    ruler,
    offset,
    lastT,
    samples,
    newtonIterations,
  });
}

/**
 * Captures a deep-frozen ruler at pointer-down. `through-start` derives one signed parallel offset
 * so the authored stroke starts under the pointer while remaining parallel to the ruler.
 */
export function beginStudioCurveSnapSession(
  rulerValue: unknown,
  strokeStart: StudioCurvePoint,
  options: StudioCurveSnapSessionOptions = {}
): StudioCurveSnapSession | null {
  const ruler = canonicalizeStudioCurveRuler(rulerValue);
  if (!ruler || !pointIsFinite(strokeStart)) return null;
  const samples = sanitizedSamples(options.samples);
  const newtonIterations = sanitizedIterations(options.newtonIterations);
  const mode = options.offsetMode ?? "on-curve";
  let offset = 0;
  if (mode === "fixed") {
    const fixed = sanitizedOffset(options.offset);
    if (fixed === null) return null;
    offset = fixed;
  } else if (mode === "through-start") {
    const base = projectPointOntoStudioCubicBezier(ruler, strokeStart, {
      samples,
      newtonIterations,
    });
    if (!base) return null;
    offset = (strokeStart.x - base.curvePoint.x) * base.normal.x
      + (strokeStart.y - base.curvePoint.y) * base.normal.y;
    if (Math.abs(offset) > STUDIO_CURVE_RULER_MAX_OFFSET) return null;
  }
  const initial = projectPointOntoStudioCubicBezier(ruler, strokeStart, {
    offset,
    samples,
    newtonIterations,
  });
  if (!initial) return null;
  return freezeSession(ruler, offset, initial.t, samples, newtonIterations);
}

/** Projects one sample and returns a new immutable session; the input session is never mutated. */
export function snapStudioCurvePoint(
  session: StudioCurveSnapSession,
  point: StudioCurvePoint
): StudioCurveSnapTransition | null {
  if (session.version !== 1 || !pointIsFinite(point)) return null;
  const projection = projectPointOntoStudioCubicBezier(session.ruler, point, {
    offset: session.offset,
    samples: session.samples,
    newtonIterations: session.newtonIterations,
    hintT: session.lastT,
  });
  if (!projection) return null;
  return Object.freeze({
    session: freezeSession(
      session.ruler,
      session.offset,
      projection.t,
      session.samples,
      session.newtonIterations
    ),
    projection,
    point: freezePoint(projection.point),
  });
}

/** Mirrors authored geometry around `canvasWidth / 2` without mutating the source ruler. */
export function mirrorStudioCurveRulerHorizontally(
  rulerValue: unknown,
  canvasWidth: number
): StudioCurveRuler | null {
  const ruler = canonicalizeStudioCurveRuler(rulerValue);
  if (!ruler || !boundedCoordinate(canvasWidth)) return null;
  return canonicalizeStudioCurveRuler({
    id: ruler.id,
    p0: { x: canvasWidth - ruler.p0.x, y: ruler.p0.y },
    p1: { x: canvasWidth - ruler.p1.x, y: ruler.p1.y },
    p2: { x: canvasWidth - ruler.p2.x, y: ruler.p2.y },
    p3: { x: canvasWidth - ruler.p3.x, y: ruler.p3.y },
  });
}

/** Mirrors an in-flight session. Signed left-normal offset flips to preserve the visible side. */
export function mirrorStudioCurveSnapSessionHorizontally(
  session: StudioCurveSnapSession,
  canvasWidth: number
): StudioCurveSnapSession | null {
  const ruler = mirrorStudioCurveRulerHorizontally(session.ruler, canvasWidth);
  if (!ruler || session.version !== 1) return null;
  return freezeSession(
    ruler,
    -session.offset,
    session.lastT,
    sanitizedSamples(session.samples),
    sanitizedIterations(session.newtonIterations)
  );
}
