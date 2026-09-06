import {
  STUDIO_PORTABLE_PATH_GEOMETRY_VERSION,
  type StudioPortablePathGeometry,
  type StudioPortablePathGeometryContour,
} from "./studio-canvaskit-adapter";

export const STUDIO_CANVASKIT_PORTABLE_GEOMETRY_FLATNESS_PX = 0.25 as const;

export const STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS = Object.freeze({
  maxCommandValues: 1_048_576,
  maxContours: 16_384,
  maxFlattenedPoints: 262_144,
  maxCoordinateAbsolute: 1_000_000,
  maxSubdivisionDepth: 12,
  maxConicSegments: 256,
} as const);

export interface StudioCanvasKitPathVerbValues {
  readonly move: number;
  readonly line: number;
  readonly quad: number;
  readonly conic: number;
  readonly cubic: number;
  readonly close: number;
}

export type StudioCanvasKitPortableGeometryResult =
  | Readonly<{ ok: true; geometry: StudioPortablePathGeometry }>
  | Readonly<{ ok: false; reason: string }>;

interface MutableContour {
  points: number[];
  closed: boolean;
}

interface Point {
  x: number;
  y: number;
}

function finiteCoordinate(value: number): boolean {
  return Number.isFinite(value)
    && Math.abs(value)
      <= STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxCoordinateAbsolute;
}

function roundCoordinate(value: number): number {
  const rounded = Math.round(value * 1_000) / 1_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function distanceToLine(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const squared = dx * dx + dy * dy;
  if (squared <= Number.EPSILON) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  return Math.abs(
    dy * point.x - dx * point.y + end.x * start.y - end.y * start.x,
  ) / Math.sqrt(squared);
}

function midpoint(left: Point, right: Point): Point {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  };
}

function addPoint(
  contour: MutableContour,
  point: Point,
  state: { flattenedPointCount: number },
): void {
  const x = roundCoordinate(point.x);
  const y = roundCoordinate(point.y);
  const length = contour.points.length;
  if (
    length >= 2
    && contour.points[length - 2] === x
    && contour.points[length - 1] === y
  ) {
    return;
  }
  state.flattenedPointCount += 1;
  if (
    state.flattenedPointCount
      > STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxFlattenedPoints
  ) {
    throw new RangeError("CanvasKit path exceeds the flattened-point budget.");
  }
  contour.points.push(x, y);
}

function flattenQuad(
  start: Point,
  control: Point,
  end: Point,
  contour: MutableContour,
  state: { flattenedPointCount: number },
  depth = 0,
): void {
  if (
    depth >= STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxSubdivisionDepth
    || distanceToLine(control, start, end)
      <= STUDIO_CANVASKIT_PORTABLE_GEOMETRY_FLATNESS_PX
  ) {
    addPoint(contour, end, state);
    return;
  }
  const startControl = midpoint(start, control);
  const controlEnd = midpoint(control, end);
  const split = midpoint(startControl, controlEnd);
  flattenQuad(start, startControl, split, contour, state, depth + 1);
  flattenQuad(split, controlEnd, end, contour, state, depth + 1);
}

function flattenCubic(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  contour: MutableContour,
  state: { flattenedPointCount: number },
  depth = 0,
): void {
  if (
    depth >= STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxSubdivisionDepth
    || Math.max(
      distanceToLine(control1, start, end),
      distanceToLine(control2, start, end),
    ) <= STUDIO_CANVASKIT_PORTABLE_GEOMETRY_FLATNESS_PX
  ) {
    addPoint(contour, end, state);
    return;
  }
  const p01 = midpoint(start, control1);
  const p12 = midpoint(control1, control2);
  const p23 = midpoint(control2, end);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const split = midpoint(p012, p123);
  flattenCubic(start, p01, p012, split, contour, state, depth + 1);
  flattenCubic(split, p123, p23, end, contour, state, depth + 1);
}

function conicPoint(
  start: Point,
  control: Point,
  end: Point,
  weight: number,
  t: number,
): Point {
  const inverse = 1 - t;
  const startWeight = inverse * inverse;
  const controlWeight = 2 * weight * inverse * t;
  const endWeight = t * t;
  const denominator = startWeight + controlWeight + endWeight;
  return {
    x: (
      startWeight * start.x
      + controlWeight * control.x
      + endWeight * end.x
    ) / denominator,
    y: (
      startWeight * start.y
      + controlWeight * control.y
      + endWeight * end.y
    ) / denominator,
  };
}

function flattenConic(
  start: Point,
  control: Point,
  end: Point,
  weight: number,
  contour: MutableContour,
  state: { flattenedPointCount: number },
): void {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new RangeError("CanvasKit conic weight is invalid.");
  }
  const deviation = Math.max(
    STUDIO_CANVASKIT_PORTABLE_GEOMETRY_FLATNESS_PX,
    distanceToLine(control, start, end),
  );
  const weightScale = Math.max(weight, 1 / weight);
  const segments = Math.min(
    STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxConicSegments,
    Math.max(
      2,
      Math.ceil(
        2 * Math.sqrt(
          (deviation * weightScale)
            / STUDIO_CANVASKIT_PORTABLE_GEOMETRY_FLATNESS_PX,
        ),
      ),
    ),
  );
  for (let index = 1; index <= segments; index += 1) {
    addPoint(
      contour,
      conicPoint(start, control, end, weight, index / segments),
      state,
    );
  }
}

function frozenContour(
  contour: MutableContour,
): StudioPortablePathGeometryContour | null {
  if (contour.points.length < 4) return null;
  return Object.freeze({
    points: Object.freeze([...contour.points]),
    closed: contour.closed,
  });
}

function geometryBounds(
  contours: readonly StudioPortablePathGeometryContour[],
): StudioPortablePathGeometry["bounds"] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (let index = 0; index + 1 < contour.points.length; index += 2) {
      const x = contour.points[index]!;
      const y = contour.points[index + 1]!;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) {
    return Object.freeze({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    });
  }
  return Object.freeze({
    minX: roundCoordinate(minX),
    minY: roundCoordinate(minY),
    maxX: roundCoordinate(maxX),
    maxY: roundCoordinate(maxY),
    width: roundCoordinate(maxX - minX),
    height: roundCoordinate(maxY - minY),
  });
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && keys.every((key) => expected.includes(key));
}

/**
 * Revalidates and snapshots untrusted Worker geometry into frozen plain data.
 * It is shared by the Worker projection and the main-thread response decoder.
 */
export function snapshotStudioPortablePathGeometry(
  candidate: unknown,
): StudioPortablePathGeometry | null {
  if (
    !plainRecord(candidate)
    || !exactKeys(candidate, [
      "kind",
      "version",
      "fillRule",
      "flatnessPx",
      "bounds",
      "contours",
      "flattenedPointCount",
      "sourceCommandValueCount",
    ])
    || candidate.kind !== "studio-portable-path-geometry"
    || candidate.version !== STUDIO_PORTABLE_PATH_GEOMETRY_VERSION
    || candidate.fillRule !== "nonzero"
    || candidate.flatnessPx
      !== STUDIO_CANVASKIT_PORTABLE_GEOMETRY_FLATNESS_PX
    || !Number.isSafeInteger(candidate.flattenedPointCount)
    || (candidate.flattenedPointCount as number) < 3
    || (candidate.flattenedPointCount as number)
      > STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxFlattenedPoints
    || !Number.isSafeInteger(candidate.sourceCommandValueCount)
    || (candidate.sourceCommandValueCount as number) < 1
    || (candidate.sourceCommandValueCount as number)
      > STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxCommandValues
    || !Array.isArray(candidate.contours)
    || candidate.contours.length < 1
    || candidate.contours.length
      > STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxContours
  ) {
    return null;
  }

  const contours: StudioPortablePathGeometryContour[] = [];
  let flattenedPointCount = 0;
  for (const contour of candidate.contours) {
    if (
      !plainRecord(contour)
      || !exactKeys(contour, ["points", "closed"])
      || typeof contour.closed !== "boolean"
      || !Array.isArray(contour.points)
      || contour.points.length < 4
      || contour.points.length % 2 !== 0
    ) {
      return null;
    }
    const points: number[] = [];
    for (const coordinate of contour.points) {
      if (typeof coordinate !== "number" || !finiteCoordinate(coordinate)) {
        return null;
      }
      points.push(roundCoordinate(coordinate));
    }
    flattenedPointCount += points.length / 2;
    if (
      flattenedPointCount
        > STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxFlattenedPoints
    ) {
      return null;
    }
    contours.push(Object.freeze({
      points: Object.freeze(points),
      closed: contour.closed,
    }));
  }
  if (flattenedPointCount !== candidate.flattenedPointCount) return null;

  const bounds = geometryBounds(contours);
  if (
    !plainRecord(candidate.bounds)
    || !exactKeys(candidate.bounds, [
      "minX",
      "minY",
      "maxX",
      "maxY",
      "width",
      "height",
    ])
  ) {
    return null;
  }
  const candidateBounds = candidate.bounds;
  if (
    (Object.keys(bounds) as (keyof typeof bounds)[]).some(
      (key) => candidateBounds[key] !== bounds[key],
    )
  ) return null;

  return Object.freeze({
    kind: "studio-portable-path-geometry",
    version: STUDIO_PORTABLE_PATH_GEOMETRY_VERSION,
    fillRule: "nonzero",
    flatnessPx: STUDIO_CANVASKIT_PORTABLE_GEOMETRY_FLATNESS_PX,
    bounds,
    contours: Object.freeze(contours),
    flattenedPointCount,
    sourceCommandValueCount: candidate.sourceCommandValueCount as number,
  });
}

/**
 * Converts CanvasKit's flattened verb/value stream into deterministic, structured-clone-safe
 * contours. The conversion runs before the Path is deleted and never exposes CanvasKit values.
 */
export function flattenStudioCanvasKitPathCommands(
  commands: ArrayLike<number>,
  verbs: StudioCanvasKitPathVerbValues,
): StudioCanvasKitPortableGeometryResult {
  if (
    !Number.isSafeInteger(commands.length)
    || commands.length <= 0
    || commands.length
      > STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxCommandValues
  ) {
    return Object.freeze({
      ok: false,
      reason: "CanvasKit 경로 명령이 비어 있거나 안전 예산을 초과했습니다.",
    });
  }
  if (
    Object.values(verbs).some(
      (value) => !Number.isInteger(value) || !Number.isFinite(value),
    )
  ) {
    return Object.freeze({
      ok: false,
      reason: "CanvasKit 경로 verb 테이블이 올바르지 않습니다.",
    });
  }

  const contours: StudioPortablePathGeometryContour[] = [];
  const state = { flattenedPointCount: 0 };
  let contour: MutableContour | null = null;
  let current: Point | null = null;
  let start: Point | null = null;
  let cursor = 0;

  const readPoint = (): Point => {
    if (cursor + 1 >= commands.length) {
      throw new RangeError("CanvasKit path command is truncated.");
    }
    const point = {
      x: Number(commands[cursor]),
      y: Number(commands[cursor + 1]),
    };
    cursor += 2;
    if (!finiteCoordinate(point.x) || !finiteCoordinate(point.y)) {
      throw new RangeError("CanvasKit path contains an invalid coordinate.");
    }
    return point;
  };
  const finishContour = (): void => {
    if (contour === null) return;
    const frozen = frozenContour(contour);
    if (frozen !== null) contours.push(frozen);
    contour = null;
    current = null;
    start = null;
    if (
      contours.length
        > STUDIO_CANVASKIT_PORTABLE_GEOMETRY_LIMITS.maxContours
    ) {
      throw new RangeError("CanvasKit path exceeds the contour budget.");
    }
  };

  try {
    while (cursor < commands.length) {
      const verb = Number(commands[cursor]);
      cursor += 1;
      if (verb === verbs.move) {
        finishContour();
        const point = readPoint();
        contour = { points: [], closed: false };
        current = point;
        start = point;
        addPoint(contour, point, state);
        continue;
      }
      if (contour === null || current === null || start === null) {
        throw new RangeError("CanvasKit path does not start with a move command.");
      }
      if (verb === verbs.line) {
        const end = readPoint();
        addPoint(contour, end, state);
        current = end;
      } else if (verb === verbs.quad) {
        const control = readPoint();
        const end = readPoint();
        flattenQuad(current, control, end, contour, state);
        current = end;
      } else if (verb === verbs.conic) {
        const control = readPoint();
        const end = readPoint();
        if (cursor >= commands.length) {
          throw new RangeError("CanvasKit conic command is truncated.");
        }
        const weight = Number(commands[cursor]);
        cursor += 1;
        flattenConic(current, control, end, weight, contour, state);
        current = end;
      } else if (verb === verbs.cubic) {
        const control1 = readPoint();
        const control2 = readPoint();
        const end = readPoint();
        flattenCubic(current, control1, control2, end, contour, state);
        current = end;
      } else if (verb === verbs.close) {
        if (!samePoint(current, start)) addPoint(contour, start, state);
        contour.closed = true;
        finishContour();
      } else {
        throw new RangeError("CanvasKit path contains an unsupported verb.");
      }
    }
    finishContour();
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error instanceof Error
        ? error.message
        : "CanvasKit 경로를 안전한 contour로 변환하지 못했습니다.",
    });
  }

  if (contours.length === 0 || state.flattenedPointCount < 3) {
    return Object.freeze({
      ok: false,
      reason: "CanvasKit 경로 결과에 사용할 수 있는 contour가 없습니다.",
    });
  }
  const geometry: StudioPortablePathGeometry = Object.freeze({
    kind: "studio-portable-path-geometry",
    version: STUDIO_PORTABLE_PATH_GEOMETRY_VERSION,
    fillRule: "nonzero",
    flatnessPx: STUDIO_CANVASKIT_PORTABLE_GEOMETRY_FLATNESS_PX,
    bounds: geometryBounds(contours),
    contours: Object.freeze(contours),
    flattenedPointCount: state.flattenedPointCount,
    sourceCommandValueCount: commands.length,
  });
  return Object.freeze({ ok: true, geometry });
}
