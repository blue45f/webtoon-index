import { describe, expect, it } from "vitest";

import {
  STUDIO_RETAINED_MEDIA_PRESSURE_VERSION,
  planStudioRetainedMediaPressureCurve,
  type StudioRetainedMediaCurvePlan,
  type StudioRetainedMediaCurveSegment,
} from "./studio-retained-media-pressure";
import { planStudioRetainedMediaRibbon } from "./studio-retained-media-ribbon";

function segment(
  sourceSegmentIndex: number,
  moveX: number,
  moveY: number,
  controlX: number,
  controlY: number,
  endX: number,
  endY: number,
  widthScale: number,
  opacityScale: number,
  flowScale: number,
): StudioRetainedMediaCurveSegment {
  return Object.freeze({
    moveX,
    moveY,
    controlX,
    controlY,
    endX,
    endY,
    sourceSegmentIndex,
    pressure: sourceSegmentIndex === 0 ? 0.2 : 0.9,
    sizeScale: widthScale,
    opacityScale,
    flowScale,
  });
}

function curvePlan(
  segments: readonly StudioRetainedMediaCurveSegment[],
): StudioRetainedMediaCurvePlan {
  return Object.freeze({
    kind: "studio-retained-media-pressure-curve",
    version: STUDIO_RETAINED_MEDIA_PRESSURE_VERSION,
    profileId: "pencil",
    sourcePointCount: segments.length + 1,
    segments: Object.freeze([...segments]),
  });
}

function pointKey(x: number, y: number): string {
  return `${x.toFixed(9)},${y.toFixed(9)}`;
}

function polygonVertexKeys(points: readonly number[]): Set<string> {
  const keys = new Set<string>();
  for (let coordinateIndex = 0; coordinateIndex < points.length; coordinateIndex += 2) {
    keys.add(pointKey(points[coordinateIndex]!, points[coordinateIndex + 1]!));
  }
  return keys;
}

function polygonArea(points: readonly number[]): number {
  let twiceArea = 0;
  for (let coordinateIndex = 0; coordinateIndex < points.length; coordinateIndex += 2) {
    const nextIndex = (coordinateIndex + 2) % points.length;
    twiceArea +=
      points[coordinateIndex]!
      * points[nextIndex + 1]!
      - points[nextIndex]!
      * points[coordinateIndex + 1]!;
  }
  return twiceArea / 2;
}

function pointInPolygon(x: number, y: number, points: readonly number[]): boolean {
  let inside = false;
  const pointCount = points.length / 2;
  for (
    let currentIndex = 0, previousIndex = pointCount - 1;
    currentIndex < pointCount;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const currentX = points[currentIndex * 2]!;
    const currentY = points[currentIndex * 2 + 1]!;
    const previousX = points[previousIndex * 2]!;
    const previousY = points[previousIndex * 2 + 1]!;
    const crosses = (currentY > y) !== (previousY > y)
      && x < (
        (previousX - currentX) * (y - currentY)
        / (previousY - currentY)
        + currentX
      );
    if (crosses) inside = !inside;
  }
  return inside;
}

describe("studio retained media ribbon", () => {
  it("partitions a 90-degree unequal-pressure turn into cells with one exact shared section", () => {
    const plan = planStudioRetainedMediaRibbon(curvePlan([
      segment(0, 0, 0, 5, 0, 10, 0, 0.5, 0.4, 0.5),
      segment(1, 10, 0, 10, 5, 10, 10, 1.5, 0.8, 1.1),
    ]), 10);

    expect(plan).toMatchObject({
      sourceSegmentCount: 2,
      acceptedSegmentCount: 2,
      cellCount: 2,
      splitReversalCount: 0,
    });
    expect(plan.runs).toHaveLength(1);
    const run = plan.runs[0]!;
    expect(run.cells).toHaveLength(2);
    expect(run.caps).toHaveLength(2);
    expect(run.caps.map(({ role }) => role)).toEqual(["start", "end"]);

    const firstVertices = polygonVertexKeys(run.cells[0]!.points);
    const secondVertices = polygonVertexKeys(run.cells[1]!.points);
    const shared = [...firstVertices].filter((point) => secondVertices.has(point));
    expect(shared).toHaveLength(2);
    expect(polygonArea(run.cells[0]!.points)).toBeGreaterThan(0);
    expect(polygonArea(run.cells[1]!.points)).toBeGreaterThan(0);
    expect(run.cells.map(({ width }) => width)).toEqual([5, 15]);
    expect(run.cells.map(({ opacityScale, flowScale }) => ({
      opacityScale,
      flowScale,
    }))).toEqual([
      { opacityScale: 0.4, flowScale: 0.5 },
      { opacityScale: 0.8, flowScale: 1.1 },
    ]);

    // A sub-pixel-offset coverage grid avoids testing the shared edge itself. Every sample inside
    // the whole ribbon belongs to exactly one alpha-bearing cell: no white outer wedge and no
    // source-over dark knot on the inner turn, even with unequal ~0.4 pressure pigments.
    let interiorSamples = 0;
    for (let x = 4.137; x <= 15; x += 0.37) {
      for (let y = -5.173; y <= 8; y += 0.41) {
        if (!pointInPolygon(x, y, run.outlinePoints)) continue;
        interiorSamples += 1;
        expect(run.cells.filter(({ points }) => pointInPolygon(x, y, points)))
          .toHaveLength(1);
      }
    }
    expect(interiorSamples).toBeGreaterThan(100);
  });

  it("keeps a sharp pressure-changing S-curve as one deterministic continuous run", () => {
    const pressureCurve = planStudioRetainedMediaPressureCurve(
      [0, 0, 18, 34, 36, -32, 54, 36, 78, 0],
      [0.08, 0.92, 0.2, 1, 0.35],
      "pencil-6b",
      { tension: 0.18, minimumDiameterRatio: 0.25 },
    );
    const first = planStudioRetainedMediaRibbon(pressureCurve, 14);
    const second = planStudioRetainedMediaRibbon(pressureCurve, 14);

    expect(second).toEqual(first);
    expect(first.runs).toHaveLength(1);
    expect(first.splitReversalCount).toBe(0);
    expect(first.cellCount).toBeGreaterThan(pressureCurve.segments.length);
    expect(first.runs[0]!.caps).toHaveLength(2);
    expect(first.runs[0]!.cells.every(({ points }) => (
      points.length === 8
      && points.every(Number.isFinite)
      && polygonArea(points) > 0
    ))).toBe(true);

    const cells = first.runs[0]!.cells;
    for (let cellIndex = 1; cellIndex < cells.length; cellIndex += 1) {
      const previous = polygonVertexKeys(cells[cellIndex - 1]!.points);
      const current = polygonVertexKeys(cells[cellIndex]!.points);
      expect(
        [...previous].filter((point) => current.has(point)),
        `cell ${cellIndex - 1}→${cellIndex} must share a complete cross-section`,
      ).toHaveLength(2);
    }
  });

  it("keeps only two non-overlapping semicircle terminal caps for a normal run", () => {
    const plan = planStudioRetainedMediaRibbon(curvePlan([
      segment(0, 0, 0, 6, 0, 12, 0, 0.7, 0.45, 0.6),
      segment(1, 12, 0, 18, 2, 24, 4, 1.2, 0.9, 1.2),
    ]), 8);
    const run = plan.runs[0]!;

    expect(run.caps).toHaveLength(2);
    expect(run.caps.every(({ points }) => (
      points.length === 34
      && points.every(Number.isFinite)
      && polygonArea(points) > 0
    ))).toBe(true);
    expect(run.caps[0]!.opacityScale).toBe(run.cells[0]!.opacityScale);
    expect(run.caps[1]!.opacityScale).toBe(run.cells.at(-1)!.opacityScale);
  });

  it("splits near-180-degree reversals instead of producing an unbounded miter", () => {
    const plan = planStudioRetainedMediaRibbon(curvePlan([
      segment(0, 0, 0, 5, 0, 10, 0, 1, 0.4, 0.4),
      segment(1, 10, 0, 5.01, 0.02, 0.02, 0.04, 1, 0.4, 0.4),
    ]), 20);

    expect(plan.splitReversalCount).toBe(1);
    expect(plan.runs).toHaveLength(2);
    expect(plan.runs.flatMap(({ cells }) => cells).every(({ points }) => (
      points.every(Number.isFinite)
    ))).toBe(true);
  });

  it("fails closed for invalid widths and malformed segments", () => {
    const malformed = curvePlan([
      segment(0, 0, 0, Number.NaN, 0, 10, 0, 1, 1, 1),
    ]);

    expect(planStudioRetainedMediaRibbon(malformed, 10).runs).toEqual([]);
    expect(planStudioRetainedMediaRibbon(malformed, 0).runs).toEqual([]);
    expect(planStudioRetainedMediaRibbon(malformed, Number.NaN).runs).toEqual([]);
  });
});
