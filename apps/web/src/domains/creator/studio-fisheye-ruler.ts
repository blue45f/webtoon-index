/**
 * Studio Fisheye Ruler
 *
 * Pure equidistant-style spherical projection and great-circle snapping for a future fisheye
 * ruler. `strength` is the positive radial exponent: 1 is equidistant, values below 1 expand the
 * center and values above 1 compress it. The renderer, document schema and interaction UI remain
 * outside this module.
 */

export interface StudioFisheyePoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioFisheyeDirection {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type StudioFisheyeOutsidePolicy = "reject" | "clamp" | "passthrough";
export type StudioFisheyeGuideFamily = "radial" | "spherical";

export interface StudioFisheyeRuler {
  readonly id: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly radius: number;
  readonly rotationDeg: number;
  readonly fovDeg: number;
  readonly strength: number;
  readonly outsidePolicy: StudioFisheyeOutsidePolicy;
}

/** A great circle represented by the unit normal of its plane through the sphere origin. */
export interface StudioFisheyeGuideCurve {
  readonly family: StudioFisheyeGuideFamily;
  readonly index: number;
  readonly planeNormal: StudioFisheyeDirection;
}

export interface StudioFisheyeProjection {
  readonly status: "snapped" | "passthrough";
  readonly point: StudioFisheyePoint;
  /** Periodic great-circle parameter in [0, 2π), null for passthrough. */
  readonly parameter: number | null;
  readonly tangent: StudioFisheyePoint | null;
  readonly distance: number;
  readonly family: StudioFisheyeGuideFamily;
  readonly guideIndex: number;
  readonly inputWasOutside: boolean;
}

export interface StudioFisheyeProjectionOptions {
  readonly samples?: number;
  readonly newtonIterations?: number;
  readonly hintParameter?: number;
}

export interface StudioFisheyeGuideSelection {
  readonly guide: StudioFisheyeGuideCurve;
  readonly projection: StudioFisheyeProjection;
  readonly score: number;
}

export interface StudioFisheyeGuideSelectionOptions extends StudioFisheyeProjectionOptions {
  readonly family?: "auto" | StudioFisheyeGuideFamily;
}

/** Immutable, persistent state captured at pointer-down. */
export interface StudioFisheyeSnapSession {
  readonly version: 1;
  readonly ruler: StudioFisheyeRuler;
  readonly guide: StudioFisheyeGuideCurve;
  readonly lastParameter: number;
  readonly samples: number;
  readonly newtonIterations: number;
}

export interface StudioFisheyeSnapTransition {
  readonly session: StudioFisheyeSnapSession;
  readonly projection: StudioFisheyeProjection;
  readonly point: StudioFisheyePoint;
}

export const STUDIO_FISHEYE_MIN_RADIUS = 8;
export const STUDIO_FISHEYE_MAX_RADIUS = 10_000_000;
export const STUDIO_FISHEYE_MIN_FOV_DEG = 30;
export const STUDIO_FISHEYE_MAX_FOV_DEG = 220;
export const STUDIO_FISHEYE_MIN_STRENGTH = 0.25;
export const STUDIO_FISHEYE_MAX_STRENGTH = 4;
export const STUDIO_FISHEYE_MAX_COORDINATE = 10_000_000;
export const STUDIO_FISHEYE_DEFAULT_SAMPLES = 192;
export const STUDIO_FISHEYE_MIN_SAMPLES = 48;
export const STUDIO_FISHEYE_MAX_SAMPLES = 512;
export const STUDIO_FISHEYE_DEFAULT_NEWTON_ITERATIONS = 8;
export const STUDIO_FISHEYE_MAX_NEWTON_ITERATIONS = 16;

export const DEFAULT_STUDIO_FISHEYE_RULER: StudioFisheyeRuler = Object.freeze({
  id: "fisheye-ruler",
  centerX: 0,
  centerY: 0,
  radius: 400,
  rotationDeg: 0,
  fovDeg: 180,
  strength: 1,
  outsidePolicy: "clamp",
});

const MAX_IDENTIFIER_LENGTH = 160;
const TWO_PI = Math.PI * 2;
const DIRECTION_EPSILON = 1e-12;
const QUERY_EPSILON = 1e-10;
const NEWTON_EPSILON = 1e-11;
const NEWTON_STEP = 1e-4;
const SCORE_ANGLE_WEIGHT = 0.35;
const SCORE_TIE_EPSILON = 1e-10;
const RADIAL_GUIDE_COUNT = 8;
const SPHERICAL_STACK_ANGLES = [0, Math.PI / 2] as const;
const SPHERICAL_OFFSET_FRACTIONS = [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75] as const;
const OUTSIDE_POLICIES = new Set<StudioFisheyeOutsidePolicy>(["reject", "clamp", "passthrough"]);

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ownDataValue(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function canonicalNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return finiteNumber(value) ? clamp(value, minimum, maximum) : fallback;
}

function normalizeDegrees(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function sanitizedSamples(value: number | undefined): number {
  if (!finiteNumber(value)) return STUDIO_FISHEYE_DEFAULT_SAMPLES;
  return clamp(Math.round(value), STUDIO_FISHEYE_MIN_SAMPLES, STUDIO_FISHEYE_MAX_SAMPLES);
}

function sanitizedIterations(value: number | undefined): number {
  if (!finiteNumber(value)) return STUDIO_FISHEYE_DEFAULT_NEWTON_ITERATIONS;
  return clamp(Math.round(value), 0, STUDIO_FISHEYE_MAX_NEWTON_ITERATIONS);
}

function wrapParameter(value: number): number {
  const wrapped = value % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function periodicDistance(left: number, right: number): number {
  const difference = Math.abs(wrapParameter(left) - wrapParameter(right));
  return Math.min(difference, TWO_PI - difference);
}

function freezeDirection(direction: StudioFisheyeDirection): StudioFisheyeDirection {
  return Object.freeze({ x: direction.x, y: direction.y, z: direction.z });
}

function freezeRuler(ruler: StudioFisheyeRuler): StudioFisheyeRuler {
  return Object.freeze({ ...ruler });
}

function freezeGuide(guide: StudioFisheyeGuideCurve): StudioFisheyeGuideCurve {
  return Object.freeze({
    family: guide.family,
    index: guide.index,
    planeNormal: freezeDirection(guide.planeNormal),
  });
}

function pointIsFinite(point: StudioFisheyePoint): boolean {
  return finiteNumber(point.x) && finiteNumber(point.y)
    && Math.abs(point.x) <= STUDIO_FISHEYE_MAX_COORDINATE
    && Math.abs(point.y) <= STUDIO_FISHEYE_MAX_COORDINATE;
}

function directionIsFinite(direction: StudioFisheyeDirection): boolean {
  return finiteNumber(direction.x) && finiteNumber(direction.y) && finiteNumber(direction.z);
}

function cross(left: StudioFisheyeDirection, right: StudioFisheyeDirection): StudioFisheyeDirection {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalizeDirection(direction: StudioFisheyeDirection): StudioFisheyeDirection | null {
  if (!directionIsFinite(direction)) return null;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!finiteNumber(length) || length < DIRECTION_EPSILON) return null;
  return { x: direction.x / length, y: direction.y / length, z: direction.z / length };
}

/**
 * Canonicalizes untrusted settings without invoking accessors. Malformed fields use defaults;
 * finite out-of-range values clamp to the public safety bounds, and rotation wraps to [0, 360).
 */
export function canonicalizeStudioFisheyeRuler(value: unknown): StudioFisheyeRuler {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const idValue = ownDataValue(source, "id");
  const id = validIdentifier(idValue) ? idValue : DEFAULT_STUDIO_FISHEYE_RULER.id;
  const rotationValue = ownDataValue(source, "rotationDeg");
  const outsideValue = ownDataValue(source, "outsidePolicy");
  return freezeRuler({
    id,
    centerX: canonicalNumber(
      ownDataValue(source, "centerX"),
      DEFAULT_STUDIO_FISHEYE_RULER.centerX,
      -STUDIO_FISHEYE_MAX_COORDINATE,
      STUDIO_FISHEYE_MAX_COORDINATE
    ),
    centerY: canonicalNumber(
      ownDataValue(source, "centerY"),
      DEFAULT_STUDIO_FISHEYE_RULER.centerY,
      -STUDIO_FISHEYE_MAX_COORDINATE,
      STUDIO_FISHEYE_MAX_COORDINATE
    ),
    radius: canonicalNumber(
      ownDataValue(source, "radius"),
      DEFAULT_STUDIO_FISHEYE_RULER.radius,
      STUDIO_FISHEYE_MIN_RADIUS,
      STUDIO_FISHEYE_MAX_RADIUS
    ),
    rotationDeg: normalizeDegrees(
      finiteNumber(rotationValue) ? rotationValue : DEFAULT_STUDIO_FISHEYE_RULER.rotationDeg
    ),
    fovDeg: canonicalNumber(
      ownDataValue(source, "fovDeg"),
      DEFAULT_STUDIO_FISHEYE_RULER.fovDeg,
      STUDIO_FISHEYE_MIN_FOV_DEG,
      STUDIO_FISHEYE_MAX_FOV_DEG
    ),
    strength: canonicalNumber(
      ownDataValue(source, "strength"),
      DEFAULT_STUDIO_FISHEYE_RULER.strength,
      STUDIO_FISHEYE_MIN_STRENGTH,
      STUDIO_FISHEYE_MAX_STRENGTH
    ),
    outsidePolicy: typeof outsideValue === "string"
      && OUTSIDE_POLICIES.has(outsideValue as StudioFisheyeOutsidePolicy)
      ? outsideValue as StudioFisheyeOutsidePolicy
      : DEFAULT_STUDIO_FISHEYE_RULER.outsidePolicy,
  });
}

function rotate2d(x: number, y: number, radians: number): StudioFisheyePoint {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function pointOutside(ruler: StudioFisheyeRuler, point: StudioFisheyePoint): boolean {
  return Math.hypot(point.x - ruler.centerX, point.y - ruler.centerY) > ruler.radius + QUERY_EPSILON;
}

function clampPointToDisk(
  ruler: StudioFisheyeRuler,
  point: StudioFisheyePoint
): StudioFisheyePoint {
  const x = point.x - ruler.centerX;
  const y = point.y - ruler.centerY;
  const length = Math.hypot(x, y);
  if (length <= ruler.radius || length < QUERY_EPSILON) return point;
  const scale = ruler.radius / length;
  return { x: ruler.centerX + x * scale, y: ruler.centerY + y * scale };
}

/** Inverse lens projection. Outside points respect the ruler policy and passthrough returns null. */
export function studioFisheyePointToDirection(
  rulerValue: unknown,
  point: StudioFisheyePoint
): StudioFisheyeDirection | null {
  const ruler = canonicalizeStudioFisheyeRuler(rulerValue);
  if (!pointIsFinite(point)) return null;
  const outside = pointOutside(ruler, point);
  if (outside && ruler.outsidePolicy !== "clamp") return null;
  const query = outside ? clampPointToDisk(ruler, point) : point;
  const rotation = -(ruler.rotationDeg * Math.PI) / 180;
  const local = rotate2d(query.x - ruler.centerX, query.y - ruler.centerY, rotation);
  const normalizedRadius = clamp(Math.hypot(local.x, local.y) / ruler.radius, 0, 1);
  if (normalizedRadius < QUERY_EPSILON) return { x: 0, y: 0, z: 1 };
  const thetaMaximum = (ruler.fovDeg * Math.PI) / 360;
  const theta = thetaMaximum * Math.pow(normalizedRadius, 1 / ruler.strength);
  const azimuth = Math.atan2(local.y, local.x);
  const sine = Math.sin(theta);
  return {
    x: sine * Math.cos(azimuth),
    y: sine * Math.sin(azimuth),
    z: Math.cos(theta),
  };
}

/** Forward lens projection. Directions outside the configured circular FOV return null. */
export function studioFisheyeDirectionToPoint(
  rulerValue: unknown,
  directionValue: StudioFisheyeDirection
): StudioFisheyePoint | null {
  const ruler = canonicalizeStudioFisheyeRuler(rulerValue);
  const direction = normalizeDirection(directionValue);
  if (!direction) return null;
  const theta = Math.acos(clamp(direction.z, -1, 1));
  const thetaMaximum = (ruler.fovDeg * Math.PI) / 360;
  if (theta > thetaMaximum + QUERY_EPSILON) return null;
  if (theta < QUERY_EPSILON) return { x: ruler.centerX, y: ruler.centerY };
  const normalizedRadius = Math.pow(clamp(theta / thetaMaximum, 0, 1), ruler.strength);
  const localRadius = normalizedRadius * ruler.radius;
  const azimuth = Math.atan2(direction.y, direction.x);
  const local = { x: Math.cos(azimuth) * localRadius, y: Math.sin(azimuth) * localRadius };
  const screen = rotate2d(local.x, local.y, (ruler.rotationDeg * Math.PI) / 180);
  return { x: ruler.centerX + screen.x, y: ruler.centerY + screen.y };
}

function validGuide(value: StudioFisheyeGuideCurve): StudioFisheyeGuideCurve | null {
  if (value.family !== "radial" && value.family !== "spherical") return null;
  if (!Number.isSafeInteger(value.index) || value.index < 0) return null;
  const normal = normalizeDirection(value.planeNormal);
  return normal ? freezeGuide({ family: value.family, index: value.index, planeNormal: normal }) : null;
}

/**
 * Builds deterministic guide families. Radial guides are eight great-circle diameters. Two
 * orthogonal spherical stacks use ±25/50/75% of the configured half-FOV as their plane tilt.
 */
export function createStudioFisheyeGuideCurves(
  rulerValue: unknown
): readonly StudioFisheyeGuideCurve[] {
  const ruler = canonicalizeStudioFisheyeRuler(rulerValue);
  const guides: StudioFisheyeGuideCurve[] = [];
  for (let index = 0; index < RADIAL_GUIDE_COUNT; index += 1) {
    const angle = index * Math.PI / RADIAL_GUIDE_COUNT;
    guides.push(freezeGuide({
      family: "radial",
      index,
      planeNormal: { x: -Math.sin(angle), y: Math.cos(angle), z: 0 },
    }));
  }
  const thetaMaximum = (ruler.fovDeg * Math.PI) / 360;
  let sphericalIndex = 0;
  for (const stackAngle of SPHERICAL_STACK_ANGLES) {
    for (const fraction of SPHERICAL_OFFSET_FRACTIONS) {
      const tilt = thetaMaximum * fraction;
      guides.push(freezeGuide({
        family: "spherical",
        index: sphericalIndex,
        planeNormal: {
          x: Math.cos(stackAngle) * Math.cos(tilt),
          y: Math.sin(stackAngle) * Math.cos(tilt),
          z: Math.sin(tilt),
        },
      }));
      sphericalIndex += 1;
    }
  }
  return Object.freeze(guides);
}

function guideBasis(guide: StudioFisheyeGuideCurve): {
  first: StudioFisheyeDirection;
  second: StudioFisheyeDirection;
} | null {
  const normal = normalizeDirection(guide.planeNormal);
  if (!normal) return null;
  const reference = Math.abs(normal.z) < 0.9
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };
  const first = normalizeDirection(cross(normal, reference));
  const second = first ? normalizeDirection(cross(normal, first)) : null;
  return first && second ? { first, second } : null;
}

/** Evaluates a guide parameter. Portions behind/outside the configured lens return null. */
export function evaluateStudioFisheyeGuideCurve(
  rulerValue: unknown,
  guideValue: StudioFisheyeGuideCurve,
  parameter: number
): StudioFisheyePoint | null {
  if (!finiteNumber(parameter)) return null;
  const guide = validGuide(guideValue);
  const basis = guide ? guideBasis(guide) : null;
  if (!guide || !basis) return null;
  const t = wrapParameter(parameter);
  const direction = {
    x: basis.first.x * Math.cos(t) + basis.second.x * Math.sin(t),
    y: basis.first.y * Math.cos(t) + basis.second.y * Math.sin(t),
    z: basis.first.z * Math.cos(t) + basis.second.z * Math.sin(t),
  };
  return studioFisheyeDirectionToPoint(rulerValue, direction);
}

/** Samples visible portions only. Null gaps are omitted; callers should not join across gaps. */
export function sampleStudioFisheyeGuideCurve(
  rulerValue: unknown,
  guide: StudioFisheyeGuideCurve,
  sampleCount = STUDIO_FISHEYE_DEFAULT_SAMPLES
): readonly StudioFisheyePoint[] {
  const samples = sanitizedSamples(sampleCount);
  const points: StudioFisheyePoint[] = [];
  for (let index = 0; index < samples; index += 1) {
    const point = evaluateStudioFisheyeGuideCurve(rulerValue, guide, (index / samples) * TWO_PI);
    if (point) points.push(point);
  }
  return points;
}

function squaredDistance(left: StudioFisheyePoint, right: StudioFisheyePoint): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function numericalGuideFrame(
  ruler: StudioFisheyeRuler,
  guide: StudioFisheyeGuideCurve,
  parameter: number
): { point: StudioFisheyePoint; first: StudioFisheyePoint; second: StudioFisheyePoint } | null {
  const t = wrapParameter(parameter);
  const point = evaluateStudioFisheyeGuideCurve(ruler, guide, t);
  const before = evaluateStudioFisheyeGuideCurve(ruler, guide, t - NEWTON_STEP);
  const after = evaluateStudioFisheyeGuideCurve(ruler, guide, t + NEWTON_STEP);
  if (!point) return null;
  if (before && after) {
    return {
      point,
      first: {
        x: (after.x - before.x) / (2 * NEWTON_STEP),
        y: (after.y - before.y) / (2 * NEWTON_STEP),
      },
      second: {
        x: (after.x - 2 * point.x + before.x) / (NEWTON_STEP * NEWTON_STEP),
        y: (after.y - 2 * point.y + before.y) / (NEWTON_STEP * NEWTON_STEP),
      },
    };
  }
  // At the lens rim one side of a visible great-circle arc is outside the configured FOV. A
  // one-sided frame keeps clamped outside projection and edge handles finite instead of failing.
  if (after) {
    const afterTwice = evaluateStudioFisheyeGuideCurve(ruler, guide, t + 2 * NEWTON_STEP);
    if (!afterTwice) return null;
    return {
      point,
      first: {
        x: (after.x - point.x) / NEWTON_STEP,
        y: (after.y - point.y) / NEWTON_STEP,
      },
      second: {
        x: (afterTwice.x - 2 * after.x + point.x) / (NEWTON_STEP * NEWTON_STEP),
        y: (afterTwice.y - 2 * after.y + point.y) / (NEWTON_STEP * NEWTON_STEP),
      },
    };
  }
  if (before) {
    const beforeTwice = evaluateStudioFisheyeGuideCurve(ruler, guide, t - 2 * NEWTON_STEP);
    if (!beforeTwice) return null;
    return {
      point,
      first: {
        x: (point.x - before.x) / NEWTON_STEP,
        y: (point.y - before.y) / NEWTON_STEP,
      },
      second: {
        x: (point.x - 2 * before.x + beforeTwice.x) / (NEWTON_STEP * NEWTON_STEP),
        y: (point.y - 2 * before.y + beforeTwice.y) / (NEWTON_STEP * NEWTON_STEP),
      },
    };
  }
  return null;
}

function refineGuideParameter(
  ruler: StudioFisheyeRuler,
  guide: StudioFisheyeGuideCurve,
  target: StudioFisheyePoint,
  initialParameter: number,
  iterations: number
): number {
  let parameter = wrapParameter(initialParameter);
  for (let index = 0; index < iterations; index += 1) {
    const frame = numericalGuideFrame(ruler, guide, parameter);
    if (!frame) break;
    const deltaX = frame.point.x - target.x;
    const deltaY = frame.point.y - target.y;
    const numerator = deltaX * frame.first.x + deltaY * frame.first.y;
    const denominator = frame.first.x * frame.first.x + frame.first.y * frame.first.y
      + deltaX * frame.second.x + deltaY * frame.second.y;
    if (!finiteNumber(numerator) || !finiteNumber(denominator)
      || Math.abs(denominator) < NEWTON_EPSILON) break;
    const next = wrapParameter(parameter - numerator / denominator);
    if (!finiteNumber(next) || periodicDistance(next, parameter) < 1e-11) {
      if (finiteNumber(next)) parameter = next;
      break;
    }
    parameter = next;
  }
  return parameter;
}

function tangentAtGuideParameter(
  ruler: StudioFisheyeRuler,
  guide: StudioFisheyeGuideCurve,
  parameter: number
): StudioFisheyePoint | null {
  const frame = numericalGuideFrame(ruler, guide, parameter);
  if (!frame) return null;
  const length = Math.hypot(frame.first.x, frame.first.y);
  if (!finiteNumber(length) || length < DIRECTION_EPSILON) return null;
  return { x: frame.first.x / length, y: frame.first.y / length };
}

/**
 * Nearest point on a finite visible great-circle arc. Stable periodic sampling finds every local
 * minimum before bounded numerical Newton refinement. Outside behavior is explicit in the result.
 */
export function projectPointOntoStudioFisheyeGuide(
  rulerValue: unknown,
  guideValue: StudioFisheyeGuideCurve,
  input: StudioFisheyePoint,
  options: StudioFisheyeProjectionOptions = {}
): StudioFisheyeProjection | null {
  const ruler = canonicalizeStudioFisheyeRuler(rulerValue);
  const guide = validGuide(guideValue);
  if (!guide || !pointIsFinite(input)) return null;
  const inputWasOutside = pointOutside(ruler, input);
  if (inputWasOutside && ruler.outsidePolicy === "reject") return null;
  if (inputWasOutside && ruler.outsidePolicy === "passthrough") {
    return Object.freeze({
      status: "passthrough" as const,
      point: Object.freeze({ ...input }),
      parameter: null,
      tangent: null,
      distance: 0,
      family: guide.family,
      guideIndex: guide.index,
      inputWasOutside: true,
    });
  }
  const target = inputWasOutside ? clampPointToDisk(ruler, input) : input;
  const samples = sanitizedSamples(options.samples);
  const iterations = sanitizedIterations(options.newtonIterations);
  const hint = finiteNumber(options.hintParameter) ? wrapParameter(options.hintParameter) : null;
  const sampledPoints = new Array<StudioFisheyePoint | null>(samples);
  const sampledDistances = new Array<number>(samples);
  for (let index = 0; index < samples; index += 1) {
    const point = evaluateStudioFisheyeGuideCurve(ruler, guide, (index / samples) * TWO_PI);
    sampledPoints[index] = point;
    sampledDistances[index] = point ? squaredDistance(point, target) : Number.POSITIVE_INFINITY;
  }
  const candidates = new Set<number>();
  let globalIndex = -1;
  for (let index = 0; index < samples; index += 1) {
    if (globalIndex < 0 || sampledDistances[index]! < sampledDistances[globalIndex]!) globalIndex = index;
    const previous = sampledDistances[(index - 1 + samples) % samples]!;
    const next = sampledDistances[(index + 1) % samples]!;
    if (sampledDistances[index]! <= previous && sampledDistances[index]! <= next
      && sampledPoints[index]) candidates.add(index);
  }
  if (globalIndex < 0 || !sampledPoints[globalIndex]) return null;
  candidates.add(globalIndex);

  let bestParameter: number | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const index of candidates) {
    const initial = (index / samples) * TWO_PI;
    const parameter = refineGuideParameter(ruler, guide, target, initial, iterations);
    const point = evaluateStudioFisheyeGuideCurve(ruler, guide, parameter);
    if (!point) continue;
    const value = squaredDistance(point, target);
    const tied = Math.abs(value - bestDistanceSquared) <= SCORE_TIE_EPSILON;
    const closerToHint = tied && hint !== null && bestParameter !== null
      && periodicDistance(parameter, hint) < periodicDistance(bestParameter, hint);
    if (value < bestDistanceSquared - SCORE_TIE_EPSILON || closerToHint
      || (tied && hint === null && (bestParameter === null || parameter < bestParameter))) {
      bestParameter = parameter;
      bestDistanceSquared = value;
    }
  }
  if (bestParameter === null) return null;
  const point = evaluateStudioFisheyeGuideCurve(ruler, guide, bestParameter);
  const tangent = tangentAtGuideParameter(ruler, guide, bestParameter);
  if (!point || !tangent) return null;
  return Object.freeze({
    status: "snapped" as const,
    point: Object.freeze(point),
    parameter: bestParameter,
    tangent: Object.freeze(tangent),
    distance: Math.hypot(point.x - input.x, point.y - input.y),
    family: guide.family,
    guideIndex: guide.index,
    inputWasOutside,
  });
}

/** Selects the nearest direction-compatible radial or spherical curve for a new stroke. */
export function selectStudioFisheyeGuideCurve(
  rulerValue: unknown,
  strokeStart: StudioFisheyePoint,
  dragPoint: StudioFisheyePoint,
  options: StudioFisheyeGuideSelectionOptions = {}
): StudioFisheyeGuideSelection | null {
  const ruler = canonicalizeStudioFisheyeRuler(rulerValue);
  if (!pointIsFinite(strokeStart) || !pointIsFinite(dragPoint)) return null;
  // Selection still needs geometry when passthrough starts outside. Clamp only for the private
  // choice; the returned session retains the authored passthrough policy for actual samples.
  const selectionRuler = ruler.outsidePolicy === "passthrough"
    ? freezeRuler({ ...ruler, outsidePolicy: "clamp" })
    : ruler;
  const dragX = dragPoint.x - strokeStart.x;
  const dragY = dragPoint.y - strokeStart.y;
  const dragLength = Math.hypot(dragX, dragY);
  const unitDrag = dragLength > QUERY_EPSILON
    ? { x: dragX / dragLength, y: dragY / dragLength }
    : null;
  const family = options.family ?? "auto";
  let best: StudioFisheyeGuideSelection | null = null;
  for (const guide of createStudioFisheyeGuideCurves(selectionRuler)) {
    if (family !== "auto" && guide.family !== family) continue;
    const projection = projectPointOntoStudioFisheyeGuide(selectionRuler, guide, strokeStart, options);
    if (!projection || projection.status !== "snapped" || !projection.tangent) continue;
    const alignment = unitDrag
      ? Math.abs(unitDrag.x * projection.tangent.x + unitDrag.y * projection.tangent.y)
      : 1;
    const score = projection.distance / selectionRuler.radius
      + SCORE_ANGLE_WEIGHT * (1 - clamp(alignment, 0, 1));
    if (!best || score < best.score - SCORE_TIE_EPSILON) {
      best = Object.freeze({ guide, projection, score });
    }
  }
  return best;
}

function freezeSession(
  ruler: StudioFisheyeRuler,
  guide: StudioFisheyeGuideCurve,
  lastParameter: number,
  samples: number,
  newtonIterations: number
): StudioFisheyeSnapSession {
  return Object.freeze({
    version: 1 as const,
    ruler,
    guide,
    lastParameter: wrapParameter(lastParameter),
    samples,
    newtonIterations,
  });
}

/** Captures a ruler and selected curve at pointer-down for immutable per-stroke snapping. */
export function beginStudioFisheyeSnapSession(
  rulerValue: unknown,
  strokeStart: StudioFisheyePoint,
  dragPoint: StudioFisheyePoint,
  options: StudioFisheyeGuideSelectionOptions = {}
): StudioFisheyeSnapSession | null {
  const ruler = canonicalizeStudioFisheyeRuler(rulerValue);
  const samples = sanitizedSamples(options.samples);
  const newtonIterations = sanitizedIterations(options.newtonIterations);
  const selection = selectStudioFisheyeGuideCurve(ruler, strokeStart, dragPoint, {
    ...options,
    samples,
    newtonIterations,
  });
  if (!selection || selection.projection.parameter === null) return null;
  return freezeSession(
    ruler,
    selection.guide,
    selection.projection.parameter,
    samples,
    newtonIterations
  );
}

/** Projects one sample and returns a new immutable session; passthrough keeps the last parameter. */
export function snapStudioFisheyePoint(
  session: StudioFisheyeSnapSession,
  point: StudioFisheyePoint
): StudioFisheyeSnapTransition | null {
  if (session.version !== 1 || !pointIsFinite(point)) return null;
  const projection = projectPointOntoStudioFisheyeGuide(session.ruler, session.guide, point, {
    samples: session.samples,
    newtonIterations: session.newtonIterations,
    hintParameter: session.lastParameter,
  });
  if (!projection) return null;
  const nextParameter = projection.parameter ?? session.lastParameter;
  return Object.freeze({
    session: freezeSession(
      session.ruler,
      session.guide,
      nextParameter,
      session.samples,
      session.newtonIterations
    ),
    projection,
    point: projection.point,
  });
}

/** Mirrors the circular lens around `canvasWidth / 2`; FOV, strength and policy are unchanged. */
export function mirrorStudioFisheyeRulerHorizontally(
  rulerValue: unknown,
  canvasWidth: number
): StudioFisheyeRuler | null {
  if (!finiteNumber(canvasWidth) || Math.abs(canvasWidth) > STUDIO_FISHEYE_MAX_COORDINATE) return null;
  const ruler = canonicalizeStudioFisheyeRuler(rulerValue);
  return canonicalizeStudioFisheyeRuler({
    ...ruler,
    centerX: canvasWidth - ruler.centerX,
    rotationDeg: 180 - ruler.rotationDeg,
  });
}
