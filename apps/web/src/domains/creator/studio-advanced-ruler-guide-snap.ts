/**
 * Studio Advanced Ruler Guide Snap
 *
 * DOM/React/Konva independent geometry for the three Clip Studio Paint style special rulers:
 * parallel-line (평행선), concentric-circle (동심원) and radial-line (방사선). Each ruler mirrors the
 * curve/fisheye contract: a tolerant canonicalizer that never invokes accessors, an immutable snap
 * session captured at pointer-down so editing the ruler mid-stroke cannot bend an in-flight
 * stroke, and pure per-sample projection that rewrites positions only — callers keep pressure,
 * tilt and timestamp attributes untouched.
 */

export interface StudioGuidePoint {
  readonly x: number;
  readonly y: number;
}

export interface StudioGuideSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface StudioParallelRuler {
  readonly id: string;
  /** Line direction in degrees, canonical range [0, 180). */
  readonly angleDeg: number;
  /** Display anchor for overlay guides and handles; snapping ignores it. */
  readonly originX: number;
  readonly originY: number;
  /** Display-only spacing between neighboring guide lines. */
  readonly guideSpacing: number;
}

export interface StudioConcentricRuler {
  readonly id: string;
  readonly centerX: number;
  readonly centerY: number;
  /** Display-only spacing between neighboring guide circles. */
  readonly guideSpacing: number;
}

export interface StudioRadialRuler {
  readonly id: string;
  readonly centerX: number;
  readonly centerY: number;
}

/** Immutable, persistent stroke state captured at pointer-down. */
export interface StudioParallelSnapSession {
  readonly version: 1;
  readonly ruler: StudioParallelRuler;
  /** Stroke start; every snapped point lies on the line through it with the ruler direction. */
  readonly origin: StudioGuidePoint;
  readonly direction: StudioGuidePoint;
}

export interface StudioConcentricSnapSession {
  readonly version: 1;
  readonly ruler: StudioConcentricRuler;
  readonly center: StudioGuidePoint;
  /** Constant |strokeStart − center| captured at pointer-down. */
  readonly radius: number;
  /** Tie-breaker so a sample exactly on the center stays deterministic. */
  readonly lastAngle: number;
}

export interface StudioRadialSnapSession {
  readonly version: 1;
  readonly ruler: StudioRadialRuler;
  readonly center: StudioGuidePoint;
  /** Unit direction from center through the stroke start. */
  readonly direction: StudioGuidePoint;
}

export interface StudioParallelSnapTransition {
  readonly session: StudioParallelSnapSession;
  readonly point: StudioGuidePoint;
}

export interface StudioConcentricSnapTransition {
  readonly session: StudioConcentricSnapSession;
  readonly point: StudioGuidePoint;
}

export interface StudioRadialSnapTransition {
  readonly session: StudioRadialSnapSession;
  readonly point: StudioGuidePoint;
}

export const STUDIO_GUIDE_RULER_MAX_COORDINATE = 10_000_000;
export const STUDIO_GUIDE_RULER_MIN_SPACING = 16;
export const STUDIO_GUIDE_RULER_MAX_SPACING = 512;
export const STUDIO_GUIDE_RULER_DEFAULT_SPACING = 96;
/** Half-length of a rendered guide line/ray; the stage canvas clips any overshoot. */
export const STUDIO_GUIDE_RULER_DEFAULT_EXTENT = 1_600;
export const STUDIO_PARALLEL_MAX_GUIDE_LINES_PER_SIDE = 16;
export const STUDIO_CONCENTRIC_MAX_GUIDE_CIRCLES = 12;
export const STUDIO_RADIAL_GUIDE_RAY_COUNT = 12;

export const DEFAULT_STUDIO_PARALLEL_RULER: StudioParallelRuler = Object.freeze({
  id: "parallel-ruler",
  angleDeg: 0,
  originX: 0,
  originY: 0,
  guideSpacing: STUDIO_GUIDE_RULER_DEFAULT_SPACING,
});

export const DEFAULT_STUDIO_CONCENTRIC_RULER: StudioConcentricRuler = Object.freeze({
  id: "concentric-ruler",
  centerX: 0,
  centerY: 0,
  guideSpacing: STUDIO_GUIDE_RULER_DEFAULT_SPACING,
});

export const DEFAULT_STUDIO_RADIAL_RULER: StudioRadialRuler = Object.freeze({
  id: "radial-ruler",
  centerX: 0,
  centerY: 0,
});

const MAX_IDENTIFIER_LENGTH = 160;
/** Below this |strokeStart − center| a circle/ray direction is undefined and snapping fails closed. */
const CENTER_EPSILON = 1e-6;

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

function canonicalCoordinate(value: unknown, fallback: number): number {
  return canonicalNumber(
    value,
    fallback,
    -STUDIO_GUIDE_RULER_MAX_COORDINATE,
    STUDIO_GUIDE_RULER_MAX_COORDINATE
  );
}

function canonicalSpacing(value: unknown, fallback: number): number {
  return canonicalNumber(
    value,
    fallback,
    STUDIO_GUIDE_RULER_MIN_SPACING,
    STUDIO_GUIDE_RULER_MAX_SPACING
  );
}

/** Wraps a finite angle into the canonical parallel-line range [0, 180). */
export function normalizeStudioParallelAngleDeg(value: number): number {
  const wrapped = value % 180;
  const normalized = wrapped < 0 ? wrapped + 180 : wrapped;
  // -1e-14 % 180 wraps to exactly 180 after the negative correction; keep the range half-open.
  return normalized === 180 ? 0 : normalized;
}

function pointIsFinite(point: StudioGuidePoint): boolean {
  return finiteNumber(point.x) && finiteNumber(point.y)
    && Math.abs(point.x) <= STUDIO_GUIDE_RULER_MAX_COORDINATE
    && Math.abs(point.y) <= STUDIO_GUIDE_RULER_MAX_COORDINATE;
}

function freezePoint(point: StudioGuidePoint): StudioGuidePoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function sourceRecord(value: unknown): object {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function canonicalIdentifier(value: unknown, fallback: string): string {
  return validIdentifier(value) ? value : fallback;
}

/**
 * Canonicalizes untrusted parallel-ruler settings without invoking accessors. Malformed fields use
 * defaults, finite out-of-range values clamp, and the angle wraps into [0, 180).
 */
export function canonicalizeStudioParallelRuler(value: unknown): StudioParallelRuler {
  const source = sourceRecord(value);
  const angleValue = ownDataValue(source, "angleDeg");
  return Object.freeze({
    id: canonicalIdentifier(ownDataValue(source, "id"), DEFAULT_STUDIO_PARALLEL_RULER.id),
    angleDeg: normalizeStudioParallelAngleDeg(
      finiteNumber(angleValue) ? angleValue : DEFAULT_STUDIO_PARALLEL_RULER.angleDeg
    ),
    originX: canonicalCoordinate(
      ownDataValue(source, "originX"),
      DEFAULT_STUDIO_PARALLEL_RULER.originX
    ),
    originY: canonicalCoordinate(
      ownDataValue(source, "originY"),
      DEFAULT_STUDIO_PARALLEL_RULER.originY
    ),
    guideSpacing: canonicalSpacing(
      ownDataValue(source, "guideSpacing"),
      DEFAULT_STUDIO_PARALLEL_RULER.guideSpacing
    ),
  });
}

/** Canonicalizes untrusted concentric-ruler settings; same tolerance model as the parallel ruler. */
export function canonicalizeStudioConcentricRuler(value: unknown): StudioConcentricRuler {
  const source = sourceRecord(value);
  return Object.freeze({
    id: canonicalIdentifier(ownDataValue(source, "id"), DEFAULT_STUDIO_CONCENTRIC_RULER.id),
    centerX: canonicalCoordinate(
      ownDataValue(source, "centerX"),
      DEFAULT_STUDIO_CONCENTRIC_RULER.centerX
    ),
    centerY: canonicalCoordinate(
      ownDataValue(source, "centerY"),
      DEFAULT_STUDIO_CONCENTRIC_RULER.centerY
    ),
    guideSpacing: canonicalSpacing(
      ownDataValue(source, "guideSpacing"),
      DEFAULT_STUDIO_CONCENTRIC_RULER.guideSpacing
    ),
  });
}

/** Canonicalizes untrusted radial-ruler settings; same tolerance model as the parallel ruler. */
export function canonicalizeStudioRadialRuler(value: unknown): StudioRadialRuler {
  const source = sourceRecord(value);
  return Object.freeze({
    id: canonicalIdentifier(ownDataValue(source, "id"), DEFAULT_STUDIO_RADIAL_RULER.id),
    centerX: canonicalCoordinate(
      ownDataValue(source, "centerX"),
      DEFAULT_STUDIO_RADIAL_RULER.centerX
    ),
    centerY: canonicalCoordinate(
      ownDataValue(source, "centerY"),
      DEFAULT_STUDIO_RADIAL_RULER.centerY
    ),
  });
}

function directionFromAngleDeg(angleDeg: number): StudioGuidePoint {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** Captures a deep-frozen parallel session; every snapped point stays on the start-point line. */
export function beginStudioParallelSnapSession(
  rulerValue: unknown,
  strokeStart: StudioGuidePoint
): StudioParallelSnapSession | null {
  const ruler = canonicalizeStudioParallelRuler(rulerValue);
  if (!pointIsFinite(strokeStart)) return null;
  return Object.freeze({
    version: 1 as const,
    ruler,
    origin: freezePoint(strokeStart),
    direction: freezePoint(directionFromAngleDeg(ruler.angleDeg)),
  });
}

/** Orthogonal projection onto the session line; the input session is never mutated. */
export function snapStudioParallelPoint(
  session: StudioParallelSnapSession,
  point: StudioGuidePoint
): StudioParallelSnapTransition | null {
  if (session.version !== 1 || !pointIsFinite(point)) return null;
  const along = (point.x - session.origin.x) * session.direction.x
    + (point.y - session.origin.y) * session.direction.y;
  if (!finiteNumber(along)) return null;
  return Object.freeze({
    session,
    point: freezePoint({
      x: session.origin.x + session.direction.x * along,
      y: session.origin.y + session.direction.y * along,
    }),
  });
}

/**
 * Captures a concentric session. A stroke starting on the center has no defined circle and fails
 * closed with `null`, matching the curve ruler's degenerate-input contract.
 */
export function beginStudioConcentricSnapSession(
  rulerValue: unknown,
  strokeStart: StudioGuidePoint
): StudioConcentricSnapSession | null {
  const ruler = canonicalizeStudioConcentricRuler(rulerValue);
  if (!pointIsFinite(strokeStart)) return null;
  const deltaX = strokeStart.x - ruler.centerX;
  const deltaY = strokeStart.y - ruler.centerY;
  const radius = Math.hypot(deltaX, deltaY);
  if (!finiteNumber(radius) || radius < CENTER_EPSILON) return null;
  return Object.freeze({
    version: 1 as const,
    ruler,
    center: freezePoint({ x: ruler.centerX, y: ruler.centerY }),
    radius,
    lastAngle: Math.atan2(deltaY, deltaX),
  });
}

/**
 * Radially projects one sample onto the constant-radius circle and returns a new immutable
 * session. A sample exactly on the center reuses the previous angle deterministically.
 */
export function snapStudioConcentricPoint(
  session: StudioConcentricSnapSession,
  point: StudioGuidePoint
): StudioConcentricSnapTransition | null {
  if (session.version !== 1 || !pointIsFinite(point) || !finiteNumber(session.radius)
    || session.radius < CENTER_EPSILON) return null;
  const deltaX = point.x - session.center.x;
  const deltaY = point.y - session.center.y;
  const length = Math.hypot(deltaX, deltaY);
  const angle = length < CENTER_EPSILON ? session.lastAngle : Math.atan2(deltaY, deltaX);
  if (!finiteNumber(angle)) return null;
  return Object.freeze({
    session: Object.freeze({ ...session, lastAngle: angle }),
    point: freezePoint({
      x: session.center.x + Math.cos(angle) * session.radius,
      y: session.center.y + Math.sin(angle) * session.radius,
    }),
  });
}

/**
 * Captures a radial session. A stroke starting on the center has no defined ray direction and
 * fails closed with `null`.
 */
export function beginStudioRadialSnapSession(
  rulerValue: unknown,
  strokeStart: StudioGuidePoint
): StudioRadialSnapSession | null {
  const ruler = canonicalizeStudioRadialRuler(rulerValue);
  if (!pointIsFinite(strokeStart)) return null;
  const deltaX = strokeStart.x - ruler.centerX;
  const deltaY = strokeStart.y - ruler.centerY;
  const length = Math.hypot(deltaX, deltaY);
  if (!finiteNumber(length) || length < CENTER_EPSILON) return null;
  return Object.freeze({
    version: 1 as const,
    ruler,
    center: freezePoint({ x: ruler.centerX, y: ruler.centerY }),
    direction: freezePoint({ x: deltaX / length, y: deltaY / length }),
  });
}

/**
 * Orthogonal projection onto the ray from center through the stroke start. The signed distance is
 * clamped at zero so a sample can never cross to the opposite side of the center.
 */
export function snapStudioRadialPoint(
  session: StudioRadialSnapSession,
  point: StudioGuidePoint
): StudioRadialSnapTransition | null {
  if (session.version !== 1 || !pointIsFinite(point)) return null;
  const along = (point.x - session.center.x) * session.direction.x
    + (point.y - session.center.y) * session.direction.y;
  if (!finiteNumber(along)) return null;
  const clamped = Math.max(0, along);
  return Object.freeze({
    session,
    point: freezePoint({
      x: session.center.x + session.direction.x * clamped,
      y: session.center.y + session.direction.y * clamped,
    }),
  });
}

export interface StudioParallelGuideOptions {
  readonly halfLength?: number;
  readonly maxLinesPerSide?: number;
}

/**
 * Deterministic display-only guide lines around the authored origin. The center line is first so
 * renderers can emphasize it; siblings alternate outward at `guideSpacing` multiples.
 */
export function createStudioParallelGuideSegments(
  rulerValue: unknown,
  options: StudioParallelGuideOptions = {}
): readonly StudioGuideSegment[] {
  const ruler = canonicalizeStudioParallelRuler(rulerValue);
  const halfLength = finiteNumber(options.halfLength) && options.halfLength > 0
    ? Math.min(options.halfLength, STUDIO_GUIDE_RULER_MAX_COORDINATE)
    : STUDIO_GUIDE_RULER_DEFAULT_EXTENT;
  const maxPerSide = finiteNumber(options.maxLinesPerSide)
    ? clamp(Math.round(options.maxLinesPerSide), 0, STUDIO_PARALLEL_MAX_GUIDE_LINES_PER_SIDE)
    : STUDIO_PARALLEL_MAX_GUIDE_LINES_PER_SIDE;
  const direction = directionFromAngleDeg(ruler.angleDeg);
  const normal = { x: -direction.y, y: direction.x };
  const perSide = Math.min(maxPerSide, Math.floor(halfLength / ruler.guideSpacing));
  const segments: StudioGuideSegment[] = [];
  const push = (offset: number): void => {
    const centerX = ruler.originX + normal.x * offset;
    const centerY = ruler.originY + normal.y * offset;
    segments.push(Object.freeze({
      x1: centerX - direction.x * halfLength,
      y1: centerY - direction.y * halfLength,
      x2: centerX + direction.x * halfLength,
      y2: centerY + direction.y * halfLength,
    }));
  };
  push(0);
  for (let index = 1; index <= perSide; index += 1) {
    push(-index * ruler.guideSpacing);
    push(index * ruler.guideSpacing);
  }
  return Object.freeze(segments);
}

export interface StudioConcentricGuideOptions {
  readonly maxRadius?: number;
  readonly maxCircles?: number;
}

/** Deterministic display-only circle radii: ascending `guideSpacing` multiples, bounded. */
export function createStudioConcentricGuideRadii(
  rulerValue: unknown,
  options: StudioConcentricGuideOptions = {}
): readonly number[] {
  const ruler = canonicalizeStudioConcentricRuler(rulerValue);
  const maxRadius = finiteNumber(options.maxRadius) && options.maxRadius > 0
    ? Math.min(options.maxRadius, STUDIO_GUIDE_RULER_MAX_COORDINATE)
    : STUDIO_GUIDE_RULER_DEFAULT_EXTENT;
  const maxCircles = finiteNumber(options.maxCircles)
    ? clamp(Math.round(options.maxCircles), 0, STUDIO_CONCENTRIC_MAX_GUIDE_CIRCLES)
    : STUDIO_CONCENTRIC_MAX_GUIDE_CIRCLES;
  const radii: number[] = [];
  for (let index = 1; index <= maxCircles; index += 1) {
    const radius = index * ruler.guideSpacing;
    if (radius > maxRadius) break;
    radii.push(radius);
  }
  return Object.freeze(radii);
}

export interface StudioRadialGuideOptions {
  readonly length?: number;
  readonly rayCount?: number;
}

/** Deterministic display-only rays from the authored center, evenly spaced over a full turn. */
export function createStudioRadialGuideSegments(
  rulerValue: unknown,
  options: StudioRadialGuideOptions = {}
): readonly StudioGuideSegment[] {
  const ruler = canonicalizeStudioRadialRuler(rulerValue);
  const length = finiteNumber(options.length) && options.length > 0
    ? Math.min(options.length, STUDIO_GUIDE_RULER_MAX_COORDINATE)
    : STUDIO_GUIDE_RULER_DEFAULT_EXTENT;
  const rayCount = finiteNumber(options.rayCount)
    ? clamp(Math.round(options.rayCount), 1, 64)
    : STUDIO_RADIAL_GUIDE_RAY_COUNT;
  const segments: StudioGuideSegment[] = [];
  for (let index = 0; index < rayCount; index += 1) {
    const angle = (index / rayCount) * Math.PI * 2;
    segments.push(Object.freeze({
      x1: ruler.centerX,
      y1: ruler.centerY,
      x2: ruler.centerX + Math.cos(angle) * length,
      y2: ruler.centerY + Math.sin(angle) * length,
    }));
  }
  return Object.freeze(segments);
}

/** Mirrors the authored line family around `canvasWidth / 2`; spacing is unchanged. */
export function mirrorStudioParallelRulerHorizontally(
  rulerValue: unknown,
  canvasWidth: number
): StudioParallelRuler | null {
  if (!finiteNumber(canvasWidth) || Math.abs(canvasWidth) > STUDIO_GUIDE_RULER_MAX_COORDINATE) {
    return null;
  }
  const ruler = canonicalizeStudioParallelRuler(rulerValue);
  return canonicalizeStudioParallelRuler({
    ...ruler,
    originX: canvasWidth - ruler.originX,
    angleDeg: normalizeStudioParallelAngleDeg(180 - ruler.angleDeg),
  });
}

/** Mirrors the authored center around `canvasWidth / 2`; spacing is unchanged. */
export function mirrorStudioConcentricRulerHorizontally(
  rulerValue: unknown,
  canvasWidth: number
): StudioConcentricRuler | null {
  if (!finiteNumber(canvasWidth) || Math.abs(canvasWidth) > STUDIO_GUIDE_RULER_MAX_COORDINATE) {
    return null;
  }
  const ruler = canonicalizeStudioConcentricRuler(rulerValue);
  return canonicalizeStudioConcentricRuler({
    ...ruler,
    centerX: canvasWidth - ruler.centerX,
  });
}

/** Mirrors the authored center around `canvasWidth / 2`. */
export function mirrorStudioRadialRulerHorizontally(
  rulerValue: unknown,
  canvasWidth: number
): StudioRadialRuler | null {
  if (!finiteNumber(canvasWidth) || Math.abs(canvasWidth) > STUDIO_GUIDE_RULER_MAX_COORDINATE) {
    return null;
  }
  const ruler = canonicalizeStudioRadialRuler(rulerValue);
  return canonicalizeStudioRadialRuler({
    ...ruler,
    centerX: canvasWidth - ruler.centerX,
  });
}
