/**
 * Continuous calligraphy ribbon geometry.
 *
 * `buildCalligraphySegments` describes the pressure/tilt width for each centre-line segment.
 * Painting every segment with an independent round-capped `stroke()` creates overlapping capsules,
 * visible width steps and same-stroke alpha stacking. A single left/right outline is not sufficient
 * either: an exact out-and-back retrace reverses that outline's winding and punches a transparent
 * hole through the mark.
 *
 * This pure planner sweeps the authored tilted elliptical nib over every accepted segment,
 * normalises every swept polygon to the same winding, and joins those polygons into one weakly
 * simple compound outline per contiguous source run. Canvas and SVG can therefore keep their
 * existing one-fill contract: overlap raises the winding magnitude but never cancels coverage or
 * applies stroke opacity twice.
 */
import type { CalligraphySegment } from "../studio-brush";

export interface StudioCalligraphyRibbonCap {
  readonly x: number;
  readonly y: number;
  /**
   * Kept for the established Canvas/SVG consumer contract. The tilted terminal footprint is now
   * part of `outlinePoints`, so this compatibility circle is intentionally zero-radius.
   */
  readonly radius: number;
}

export interface StudioCalligraphyRibbonRun {
  /**
   * Closed weakly-simple polygon `[x0,y0,x1,y1,…]`. Repeated zero-area bridges join multiple
   * same-winding swept nib lobes without requiring a new renderer API.
   */
  readonly outlinePoints: readonly number[];
  readonly startCap: StudioCalligraphyRibbonCap;
  readonly endCap: StudioCalligraphyRibbonCap;
  readonly segmentCount: number;
}

export interface StudioCalligraphyRibbonPlan {
  readonly runs: readonly StudioCalligraphyRibbonRun[];
  readonly sourceSegmentCount: number;
  readonly acceptedSegmentCount: number;
}

/** Renderer-expanded work facts derivable from source length without planning the ribbon. */
export interface StudioCalligraphyRibbonWorkUpperBound {
  readonly acceptedSegmentCount: number;
  /** Final compound-outline coordinate scalars materialized by the planner. */
  readonly outlineCoordinateScalars: number;
  /** Canvas path operations emitted by StudioDrawNode, including beginPath/fill. */
  readonly canvasPathCommands: number;
}

const COORDINATE_LIMIT = 1_000_000;
const WIDTH_LIMIT = 4_096;
const POINT_EPSILON = 1e-6;
const CONTINUITY_EPSILON = 1e-4;
const NIB_FOOTPRINT_STEPS = 32;
const GEOMETRY_QUANTIZATION = 10_000;

/**
 * O(1) upper bound for `planStudioCalligraphyRibbon` plus StudioDrawNode's Canvas path emission.
 *
 * For each accepted source segment, `sweptSegmentOutline` has at most 32 + 2 vertices and the two
 * explicit terminal footprints have 32 vertices each. `compoundOutline` adds a two-scalar anchor
 * after its first polygon and a four-scalar bridge after every later polygon. A contiguous run is
 * therefore `208 * segments - 2` final coordinate scalars. Splitting every segment into its own
 * run is smaller in geometry (206 scalars each) but larger in Canvas work: one moveTo, 102 lineTo,
 * closePath and two moveTo/arc pairs = 108 commands per segment, plus the shared beginPath/fill.
 *
 * `buildCalligraphySegments` creates at most `sourcePointCount - 1` segments and normalization can
 * only discard them, so the bound is conservative for zero-length and malformed source samples.
 */
export function studioCalligraphyRibbonWorkUpperBound(
  sourcePointCount: number,
): StudioCalligraphyRibbonWorkUpperBound | null {
  if (!Number.isSafeInteger(sourcePointCount) || sourcePointCount < 0) return null;
  const acceptedSegmentCount = Math.max(0, sourcePointCount - 1);
  if (acceptedSegmentCount === 0) {
    // The retained calligraphy branch may emit one fallback arc instead of a ribbon.
    return {
      acceptedSegmentCount,
      outlineCoordinateScalars: 0,
      canvasPathCommands: 3,
    };
  }
  const sweptHullCoordinateScalars = (NIB_FOOTPRINT_STEPS + 2) * 2;
  const footprintCoordinateScalars = NIB_FOOTPRINT_STEPS * 2;
  const firstSegmentCoordinateScalars = sweptHullCoordinateScalars + 2
    + 2 * (footprintCoordinateScalars + 4);
  const laterSegmentCoordinateScalars = sweptHullCoordinateScalars + 4
    + 2 * (footprintCoordinateScalars + 4);
  const outlineCoordinateScalars = firstSegmentCoordinateScalars
    + (acceptedSegmentCount - 1) * laterSegmentCoordinateScalars;
  const singleSegmentRunVertices = firstSegmentCoordinateScalars / 2;
  const commandsPerSingleSegmentRun = singleSegmentRunVertices + 5;
  return {
    acceptedSegmentCount,
    outlineCoordinateScalars,
    canvasPathCommands: commandsPerSingleSegmentRun * acceptedSegmentCount + 2,
  };
}

function finiteCoordinate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(COORDINATE_LIMIT, Math.max(-COORDINATE_LIMIT, value));
}

function finiteWidth(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(WIDTH_LIMIT, Math.max(0.05, value));
}

function hasValidDirection(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  return Number.isFinite(length) && length > POINT_EPSILON;
}

function samePoint(leftX: number, leftY: number, rightX: number, rightY: number): boolean {
  return Math.hypot(leftX - rightX, leftY - rightY) <= CONTINUITY_EPSILON;
}

function normalizedSegment(segment: CalligraphySegment): CalligraphySegment | null {
  const x0 = finiteCoordinate(segment.x0);
  const y0 = finiteCoordinate(segment.y0);
  const x1 = finiteCoordinate(segment.x1);
  const y1 = finiteCoordinate(segment.y1);
  const width = finiteWidth(segment.width);
  if (
    x0 === null
    || y0 === null
    || x1 === null
    || y1 === null
    || width === null
    || !hasValidDirection(x0, y0, x1, y1)
  ) {
    return null;
  }
  return {
    x0,
    y0,
    x1,
    y1,
    width,
    tipAngleRad:
      typeof segment.tipAngleRad === "number" && Number.isFinite(segment.tipAngleRad)
        ? segment.tipAngleRad
        : 0,
    roundness:
      typeof segment.roundness === "number" && Number.isFinite(segment.roundness)
        ? Math.min(1, Math.max(0.08, segment.roundness))
        : 1,
  };
}

function quantize(value: number): number {
  const quantized = Math.round(value * GEOMETRY_QUANTIZATION) / GEOMETRY_QUANTIZATION;
  return Object.is(quantized, -0) ? 0 : quantized;
}

function signedArea(points: readonly number[]): number {
  let area = 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const nextIndex = (index + 2) % points.length;
    area += points[index]! * points[nextIndex + 1]!
      - points[nextIndex]! * points[index + 1]!;
  }
  return area / 2;
}

function sameWinding(flattened: readonly number[]): readonly number[] {
  if (signedArea(flattened) >= 0) return flattened;
  const reversed: number[] = [];
  for (let index = flattened.length - 2; index >= 0; index -= 2) {
    reversed.push(flattened[index]!, flattened[index + 1]!);
  }
  return reversed;
}

function nibFootprint(
  centerX: number,
  centerY: number,
  segment: CalligraphySegment,
): readonly number[] {
  const travelAngle = Math.atan2(segment.y1 - segment.y0, segment.x1 - segment.x0);
  const relativeTravelAngle = travelAngle - segment.tipAngleRad;
  const sine = Math.sin(relativeTravelAngle);
  const cosine = Math.cos(relativeTravelAngle);
  const projection = Math.sqrt(
    sine * sine + segment.roundness * segment.roundness * cosine * cosine,
  );
  const majorRadius = Math.min(
    WIDTH_LIMIT / 2,
    segment.width / 2 / Math.max(segment.roundness, projection, POINT_EPSILON),
  );
  const minorRadius = majorRadius * segment.roundness;
  const tipCosine = Math.cos(segment.tipAngleRad);
  const tipSine = Math.sin(segment.tipAngleRad);
  
  const footprint = new Float64Array(NIB_FOOTPRINT_STEPS * 2);
  for (let step = 0; step < NIB_FOOTPRINT_STEPS; step += 1) {
    const angle = Math.PI * 2 * step / NIB_FOOTPRINT_STEPS;
    const localX = Math.cos(angle) * majorRadius;
    const localY = Math.sin(angle) * minorRadius;
    footprint[step * 2] = quantize(centerX + localX * tipCosine - localY * tipSine);
    footprint[step * 2 + 1] = quantize(centerY + localX * tipSine + localY * tipCosine);
  }
  return Array.from(footprint);
}

const SHARED_FOOTPRINT_X = new Float64Array(NIB_FOOTPRINT_STEPS);
const SHARED_FOOTPRINT_Y = new Float64Array(NIB_FOOTPRINT_STEPS);

function sweptSegmentOutline(segment: CalligraphySegment): readonly number[] {
  const travelAngle = Math.atan2(segment.y1 - segment.y0, segment.x1 - segment.x0);
  const relativeTravelAngle = travelAngle - segment.tipAngleRad;
  const sine = Math.sin(relativeTravelAngle);
  const cosine = Math.cos(relativeTravelAngle);
  const projection = Math.sqrt(
    sine * sine + segment.roundness * segment.roundness * cosine * cosine,
  );
  const majorRadius = Math.min(
    WIDTH_LIMIT / 2,
    segment.width / 2 / Math.max(segment.roundness, projection, POINT_EPSILON),
  );
  const minorRadius = majorRadius * segment.roundness;
  const tipCosine = Math.cos(segment.tipAngleRad);
  const tipSine = Math.sin(segment.tipAngleRad);

  const dx = segment.x1 - segment.x0;
  const dy = segment.y1 - segment.y0;
  const nx = -dy;
  const ny = dx;

  let maxDot = -Infinity;
  let minDot = Infinity;
  let maxIdx = 0;
  let minIdx = 0;

  for (let step = 0; step < NIB_FOOTPRINT_STEPS; step += 1) {
    const angle = Math.PI * 2 * step / NIB_FOOTPRINT_STEPS;
    const localX = Math.cos(angle) * majorRadius;
    const localY = Math.sin(angle) * minorRadius;
    const oxVal = localX * tipCosine - localY * tipSine;
    const oyVal = localX * tipSine + localY * tipCosine;
    
    SHARED_FOOTPRINT_X[step] = oxVal;
    SHARED_FOOTPRINT_Y[step] = oyVal;

    const dot = oxVal * nx + oyVal * ny;
    if (dot > maxDot) { maxDot = dot; maxIdx = step; }
    if (dot < minDot) { minDot = dot; minIdx = step; }
  }

  const hull: number[] = [];
  
  let i = minIdx;
  while (true) {
    hull.push(
      quantize(segment.x1 + SHARED_FOOTPRINT_X[i]!),
      quantize(segment.y1 + SHARED_FOOTPRINT_Y[i]!)
    );
    if (i === maxIdx) break;
    i = (i + 1) % NIB_FOOTPRINT_STEPS;
  }
  
  i = maxIdx;
  while (true) {
    hull.push(
      quantize(segment.x0 + SHARED_FOOTPRINT_X[i]!),
      quantize(segment.y0 + SHARED_FOOTPRINT_Y[i]!)
    );
    if (i === minIdx) break;
    i = (i + 1) % NIB_FOOTPRINT_STEPS;
  }

  if (signedArea(hull) >= 0) return hull;
  const reversed: number[] = [];
  for (let index = hull.length - 2; index >= 0; index -= 2) {
    reversed.push(hull[index]!, hull[index + 1]!);
  }
  return reversed;
}

/**
 * Keep each authored terminal footprint as an explicit positive-winding lobe in addition to the
 * swept convex hull. In theory the hull already contains both ellipses; in practice a hull edge
 * can meet a zero-area compound bridge exactly at a terminal vertex and leave a one-pixel
 * antialias pinhole in Canvas/SVG rasterizers. The redundant interior lobe does not change the
 * silhouette or alpha (the whole compound path is filled once), but guarantees positive winding
 * throughout the tilted nib interior at both 0° and 90°.
 *
 * Emit the pair for every accepted segment rather than only the final run endpoints. That keeps an
 * already rendered live prefix byte-identical when a later pointer sample extends the run.
 */
function sweptSegmentCoveragePolygons(
  segment: CalligraphySegment,
): readonly (readonly number[])[] {
  return [
    sweptSegmentOutline(segment),
    sameWinding(nibFootprint(segment.x0, segment.y0, segment)),
    sameWinding(nibFootprint(segment.x1, segment.y1, segment)),
  ];
}

/**
 * Encode several positive-winding polygons into one weakly-simple outline by returning to a
 * stable anchor over the same zero-area bridge after each lobe. Canvas/SVG non-zero fill sees the
 * lobes as a compound union, while the established `outlinePoints` API and one-run-per-contiguous
 * stroke contract remain unchanged.
 */
function compoundOutline(polygons: readonly (readonly number[])[]): readonly number[] {
  const first = polygons[0];
  if (!first) return [];
  if (polygons.length === 1) return first;
  const anchorX = first[0]!;
  const anchorY = first[1]!;
  const outline = [...first, anchorX, anchorY];
  for (let polygonIndex = 1; polygonIndex < polygons.length; polygonIndex += 1) {
    const polygon = polygons[polygonIndex]!;
    const firstX = polygon[0]!;
    const firstY = polygon[1]!;
    outline.push(
      firstX,
      firstY,
      ...polygon.slice(2),
      firstX,
      firstY,
      anchorX,
      anchorY,
    );
  }
  return outline;
}

function planRun(segments: readonly CalligraphySegment[]): StudioCalligraphyRibbonRun {
  const first = segments[0]!;
  const last = segments.at(-1)!;
  return {
    outlinePoints: compoundOutline(
      segments.flatMap(sweptSegmentCoveragePolygons),
    ),
    startCap: { x: first.x0, y: first.y0, radius: 0 },
    endCap: { x: last.x1, y: last.y1, radius: 0 },
    segmentCount: segments.length,
  };
}

export function planStudioCalligraphyRibbon(
  sourceSegments: readonly CalligraphySegment[]
): StudioCalligraphyRibbonPlan {
  const runs: CalligraphySegment[][] = [];
  let activeRun: CalligraphySegment[] = [];
  let acceptedSegmentCount = 0;

  for (const sourceSegment of sourceSegments) {
    const segment = normalizedSegment(sourceSegment);
    if (!segment) continue;
    acceptedSegmentCount += 1;
    const previous = activeRun.at(-1);
    if (
      previous
      && !samePoint(previous.x1, previous.y1, segment.x0, segment.y0)
    ) {
      runs.push(activeRun);
      activeRun = [];
    }
    activeRun.push(segment);
  }
  if (activeRun.length > 0) runs.push(activeRun);

  return {
    runs: runs.map(planRun),
    sourceSegmentCount: sourceSegments.length,
    acceptedSegmentCount,
  };
}
