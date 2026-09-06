/**
 * Continuous retained-media ribbon geometry.
 *
 * Canonical pencil pressure used to be painted as independent butt-capped quadratic strokes.
 * That representation has two structural defects at every bend: the inner halves overlap (and
 * therefore darken at partial alpha), while the outer halves leave a triangular hole. This
 * planner flattens the same quadratic centre line into a bounded mesh whose neighbouring cells
 * share one cross-section exactly. Cells retain their source segment's pigment response, so
 * Canvas and SVG can paint pressure-varying alpha without overlapping geometry.
 */

import type {
  StudioRetainedMediaCurvePlan,
  StudioRetainedMediaCurveSegment,
} from "./studio-retained-media-pressure";

export const STUDIO_RETAINED_MEDIA_RIBBON_VERSION = 1 as const;

export interface StudioRetainedMediaRibbonPaint {
  readonly pressure: number;
  readonly opacityScale: number;
  readonly flowScale: number;
}

export interface StudioRetainedMediaRibbonCell
  extends StudioRetainedMediaRibbonPaint {
  /** Positive-winding quadrilateral `[left0,left1,right1,right0]`. */
  readonly points: readonly number[];
  readonly sourceSegmentIndex: number;
  readonly width: number;
}

export interface StudioRetainedMediaRibbonCap
  extends StudioRetainedMediaRibbonPaint {
  readonly role: "start" | "end";
  /** Positive-winding semicircle polygon. Its closing edge is the terminal ribbon cross-section. */
  readonly points: readonly number[];
  readonly radius: number;
}

export interface StudioRetainedMediaRibbonRun {
  /** Positive-winding whole-run outline, useful for coverage/golden verification. */
  readonly outlinePoints: readonly number[];
  readonly cells: readonly StudioRetainedMediaRibbonCell[];
  readonly caps: readonly [
    StudioRetainedMediaRibbonCap,
    StudioRetainedMediaRibbonCap,
  ];
}

export interface StudioRetainedMediaRibbonPlan {
  readonly kind: "studio-retained-media-ribbon";
  readonly version: typeof STUDIO_RETAINED_MEDIA_RIBBON_VERSION;
  readonly sourceSegmentCount: number;
  readonly acceptedSegmentCount: number;
  readonly cellCount: number;
  readonly splitReversalCount: number;
  readonly runs: readonly StudioRetainedMediaRibbonRun[];
}

interface Point {
  readonly x: number;
  readonly y: number;
}

type Direction = Point;

interface FlatCell extends StudioRetainedMediaRibbonPaint {
  readonly from: Point;
  readonly to: Point;
  readonly halfWidth: number;
  readonly sourceSegmentIndex: number;
}

const COORDINATE_LIMIT = 1_000_000_000;
const WIDTH_LIMIT = 4_096;
const POINT_EPSILON = 1e-6;
const CONTINUITY_EPSILON = 1e-4;
const REVERSAL_DOT_LIMIT = -0.985;
const MITER_LIMIT = 2.5;
const MAX_FLATTEN_DEPTH = 5;
const CAP_STEPS = 16;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteCoordinate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clamp(value, -COORDINATE_LIMIT, COORDINATE_LIMIT);
}

function finitePositive(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return clamp(value, 0, maximum);
}

function finiteNonNegative(value: unknown, maximum = 16): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return clamp(value, 0, maximum);
}

function finiteUnit(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : fallback;
}

function normalizedDirection(from: Point, to: Point): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= POINT_EPSILON) return null;
  return Object.freeze({ x: dx / length, y: dy / length });
}

function samePoint(left: Point, right: Point): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= CONTINUITY_EPSILON;
}

function signedArea(points: readonly number[]): number {
  const pointCount = Math.floor(points.length / 2);
  let twiceArea = 0;
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const nextIndex = (pointIndex + 1) % pointCount;
    twiceArea +=
      points[pointIndex * 2]!
      * points[nextIndex * 2 + 1]!
      - points[nextIndex * 2]!
      * points[pointIndex * 2 + 1]!;
  }
  return twiceArea / 2;
}

function positiveWinding(points: readonly number[]): readonly number[] {
  if (signedArea(points) >= 0) return Object.freeze([...points]);
  const reversed: number[] = [];
  for (let coordinateIndex = points.length - 2; coordinateIndex >= 0; coordinateIndex -= 2) {
    reversed.push(points[coordinateIndex]!, points[coordinateIndex + 1]!);
  }
  return Object.freeze(reversed);
}

function pointOnQuadratic(
  segment: StudioRetainedMediaCurveSegment,
  t: number,
): Point {
  const inverse = 1 - t;
  return Object.freeze({
    x: inverse * inverse * segment.moveX
      + 2 * inverse * t * segment.controlX
      + t * t * segment.endX,
    y: inverse * inverse * segment.moveY
      + 2 * inverse * t * segment.controlY
      + t * t * segment.endY,
  });
}

function controlDistanceFromChord(segment: StudioRetainedMediaCurveSegment): number {
  const chordX = segment.endX - segment.moveX;
  const chordY = segment.endY - segment.moveY;
  const chordLength = Math.hypot(chordX, chordY);
  if (chordLength <= POINT_EPSILON) {
    return Math.hypot(
      segment.controlX - segment.moveX,
      segment.controlY - segment.moveY,
    );
  }
  return Math.abs(
    chordY * segment.controlX
    - chordX * segment.controlY
    + segment.endX * segment.moveY
    - segment.endY * segment.moveX
  ) / chordLength;
}

function flattenSubdivisionCount(
  segment: StudioRetainedMediaCurveSegment,
  strokeWidth: number,
): number {
  const tolerance = clamp(strokeWidth * 0.035, 0.12, 0.72);
  const flatness = controlDistanceFromChord(segment);
  if (!Number.isFinite(flatness) || flatness <= tolerance) return 1;
  const requestedDepth = Math.ceil(Math.log2(Math.sqrt(flatness / tolerance)));
  return 2 ** clamp(requestedDepth, 0, MAX_FLATTEN_DEPTH);
}

function normalizedSegment(
  segment: StudioRetainedMediaCurveSegment,
): StudioRetainedMediaCurveSegment | null {
  const moveX = finiteCoordinate(segment.moveX);
  const moveY = finiteCoordinate(segment.moveY);
  const controlX = finiteCoordinate(segment.controlX);
  const controlY = finiteCoordinate(segment.controlY);
  const endX = finiteCoordinate(segment.endX);
  const endY = finiteCoordinate(segment.endY);
  const sizeScale = finitePositive(segment.sizeScale, WIDTH_LIMIT);
  if (
    moveX === null
    || moveY === null
    || controlX === null
    || controlY === null
    || endX === null
    || endY === null
    || sizeScale === null
  ) {
    return null;
  }
  return Object.freeze({
    moveX,
    moveY,
    controlX,
    controlY,
    endX,
    endY,
    sourceSegmentIndex: Number.isSafeInteger(segment.sourceSegmentIndex)
      ? Math.max(0, segment.sourceSegmentIndex)
      : 0,
    pressure: finiteUnit(segment.pressure, 0.5),
    sizeScale,
    opacityScale: finiteNonNegative(segment.opacityScale) ?? 1,
    flowScale: finiteNonNegative(segment.flowScale) ?? 1,
  });
}

function flattenSegment(
  segment: StudioRetainedMediaCurveSegment,
  strokeWidth: number,
): readonly FlatCell[] {
  const subdivisions = flattenSubdivisionCount(segment, strokeWidth);
  const halfWidth = clamp(strokeWidth * segment.sizeScale / 2, 0.025, WIDTH_LIMIT / 2);
  const result: FlatCell[] = [];
  let from = pointOnQuadratic(segment, 0);
  for (let subdivisionIndex = 1; subdivisionIndex <= subdivisions; subdivisionIndex += 1) {
    const to = pointOnQuadratic(segment, subdivisionIndex / subdivisions);
    if (normalizedDirection(from, to)) {
      result.push(Object.freeze({
        from,
        to,
        halfWidth,
        sourceSegmentIndex: segment.sourceSegmentIndex,
        pressure: segment.pressure,
        opacityScale: segment.opacityScale,
        flowScale: segment.flowScale,
      }));
    }
    from = to;
  }
  return Object.freeze(result);
}

function splitContinuousRuns(
  cells: readonly FlatCell[],
): {
  readonly runs: readonly (readonly FlatCell[])[];
  readonly splitReversalCount: number;
} {
  const runs: FlatCell[][] = [];
  let active: FlatCell[] = [];
  let splitReversalCount = 0;
  for (const cell of cells) {
    const previous = active.at(-1);
    if (previous) {
      const previousDirection = normalizedDirection(previous.from, previous.to)!;
      const nextDirection = normalizedDirection(cell.from, cell.to)!;
      const dot = previousDirection.x * nextDirection.x
        + previousDirection.y * nextDirection.y;
      const disconnected = !samePoint(previous.to, cell.from);
      const reversal = dot <= REVERSAL_DOT_LIMIT;
      if (disconnected || reversal) {
        runs.push(active);
        active = [];
        if (reversal) splitReversalCount += 1;
      }
    }
    active.push(cell);
  }
  if (active.length > 0) runs.push(active);
  return {
    runs: Object.freeze(runs.map((run) => Object.freeze(run))),
    splitReversalCount,
  };
}

function vertexOffset(
  directions: readonly Direction[],
  vertexIndex: number,
  halfWidth: number,
): Direction {
  const previous = directions[Math.max(0, vertexIndex - 1)]!;
  const next = directions[Math.min(directions.length - 1, vertexIndex)]!;
  const previousNormal = { x: -previous.y, y: previous.x };
  const nextNormal = { x: -next.y, y: next.x };
  const sumX = previousNormal.x + nextNormal.x;
  const sumY = previousNormal.y + nextNormal.y;
  const sumLength = Math.hypot(sumX, sumY);
  if (sumLength <= POINT_EPSILON) {
    return Object.freeze({
      x: nextNormal.x * halfWidth,
      y: nextNormal.y * halfWidth,
    });
  }
  const miterX = sumX / sumLength;
  const miterY = sumY / sumLength;
  const projection = Math.abs(miterX * nextNormal.x + miterY * nextNormal.y);
  const requestedLength = halfWidth / Math.max(0.25, projection);
  const miterLength = Math.min(halfWidth * MITER_LIMIT, requestedLength);
  return Object.freeze({ x: miterX * miterLength, y: miterY * miterLength });
}

function capPolygon(
  role: StudioRetainedMediaRibbonCap["role"],
  center: Point,
  direction: Direction,
  radius: number,
): readonly number[] {
  const outward = role === "start"
    ? { x: -direction.x, y: -direction.y }
    : direction;
  const normal = { x: -direction.y, y: direction.x };
  const points: number[] = [];
  for (let step = 0; step <= CAP_STEPS; step += 1) {
    const phi = -Math.PI / 2 + Math.PI * (step / CAP_STEPS);
    points.push(
      center.x + (outward.x * Math.cos(phi) + normal.x * Math.sin(phi)) * radius,
      center.y + (outward.y * Math.cos(phi) + normal.y * Math.sin(phi)) * radius,
    );
  }
  return positiveWinding(points);
}

function planRun(flatCells: readonly FlatCell[]): StudioRetainedMediaRibbonRun {
  const directions = flatCells.map((cell) => normalizedDirection(cell.from, cell.to)!);
  const vertices: Point[] = [flatCells[0]!.from, ...flatCells.map((cell) => cell.to)];
  const halfWidths = vertices.map((_, vertexIndex) => {
    if (vertexIndex === 0) return flatCells[0]!.halfWidth;
    if (vertexIndex === flatCells.length) return flatCells.at(-1)!.halfWidth;
    return (
      flatCells[vertexIndex - 1]!.halfWidth
      + flatCells[vertexIndex]!.halfWidth
    ) / 2;
  });
  const left: Point[] = [];
  const right: Point[] = [];
  for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 1) {
    const vertex = vertices[vertexIndex]!;
    const offset = vertexOffset(directions, vertexIndex, halfWidths[vertexIndex]!);
    left.push(Object.freeze({ x: vertex.x + offset.x, y: vertex.y + offset.y }));
    right.push(Object.freeze({ x: vertex.x - offset.x, y: vertex.y - offset.y }));
  }

  const cells = flatCells.map((cell, cellIndex) => Object.freeze({
    points: positiveWinding([
      left[cellIndex]!.x,
      left[cellIndex]!.y,
      left[cellIndex + 1]!.x,
      left[cellIndex + 1]!.y,
      right[cellIndex + 1]!.x,
      right[cellIndex + 1]!.y,
      right[cellIndex]!.x,
      right[cellIndex]!.y,
    ]),
    sourceSegmentIndex: cell.sourceSegmentIndex,
    width: cell.halfWidth * 2,
    pressure: cell.pressure,
    opacityScale: cell.opacityScale,
    flowScale: cell.flowScale,
  }));
  const outline: number[] = [];
  for (const point of left) outline.push(point.x, point.y);
  for (let pointIndex = right.length - 1; pointIndex >= 0; pointIndex -= 1) {
    outline.push(right[pointIndex]!.x, right[pointIndex]!.y);
  }

  const first = flatCells[0]!;
  const last = flatCells.at(-1)!;
  const caps = Object.freeze([
    Object.freeze({
      role: "start" as const,
      points: capPolygon(
        "start",
        vertices[0]!,
        directions[0]!,
        halfWidths[0]!,
      ),
      radius: halfWidths[0]!,
      pressure: first.pressure,
      opacityScale: first.opacityScale,
      flowScale: first.flowScale,
    }),
    Object.freeze({
      role: "end" as const,
      points: capPolygon(
        "end",
        vertices.at(-1)!,
        directions.at(-1)!,
        halfWidths.at(-1)!,
      ),
      radius: halfWidths.at(-1)!,
      pressure: last.pressure,
      opacityScale: last.opacityScale,
      flowScale: last.flowScale,
    }),
  ] satisfies [
    StudioRetainedMediaRibbonCap,
    StudioRetainedMediaRibbonCap,
  ]);

  return Object.freeze({
    outlinePoints: positiveWinding(outline),
    cells: Object.freeze(cells),
    caps,
  });
}

export function planStudioRetainedMediaRibbon(
  curvePlan: StudioRetainedMediaCurvePlan,
  strokeWidthInput: unknown,
): StudioRetainedMediaRibbonPlan {
  const strokeWidth = finitePositive(strokeWidthInput, WIDTH_LIMIT);
  if (strokeWidth === null) {
    return Object.freeze({
      kind: "studio-retained-media-ribbon",
      version: STUDIO_RETAINED_MEDIA_RIBBON_VERSION,
      sourceSegmentCount: curvePlan.segments.length,
      acceptedSegmentCount: 0,
      cellCount: 0,
      splitReversalCount: 0,
      runs: Object.freeze([]),
    });
  }

  const flatCells: FlatCell[] = [];
  let acceptedSegmentCount = 0;
  for (const sourceSegment of curvePlan.segments) {
    const segment = normalizedSegment(sourceSegment);
    if (!segment) continue;
    const cells = flattenSegment(segment, strokeWidth);
    if (cells.length === 0) continue;
    acceptedSegmentCount += 1;
    flatCells.push(...cells);
  }
  const split = splitContinuousRuns(flatCells);
  const runs = split.runs.map(planRun);
  return Object.freeze({
    kind: "studio-retained-media-ribbon",
    version: STUDIO_RETAINED_MEDIA_RIBBON_VERSION,
    sourceSegmentCount: curvePlan.segments.length,
    acceptedSegmentCount,
    cellCount: flatCells.length,
    splitReversalCount: split.splitReversalCount,
    runs: Object.freeze(runs),
  });
}
