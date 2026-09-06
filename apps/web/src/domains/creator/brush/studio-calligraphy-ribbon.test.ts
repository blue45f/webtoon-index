import { describe, expect, it } from "vitest";

import {
  planStudioCalligraphyRibbon,
  studioCalligraphyRibbonWorkUpperBound,
} from "./studio-calligraphy-ribbon";

import type { CalligraphySegment } from "../studio-brush";

function segment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  tipAngleRad = 0,
  roundness = 0.35,
): CalligraphySegment {
  return {
    x0,
    y0,
    x1,
    y1,
    width,
    tipAngleRad,
    roundness,
  };
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

function windingAt(points: readonly number[], x: number, y: number): number {
  let winding = 0;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const nextIndex = (index + 2) % points.length;
    const x0 = points[index]!;
    const y0 = points[index + 1]!;
    const x1 = points[nextIndex]!;
    const y1 = points[nextIndex + 1]!;
    const side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
    if (y0 <= y && y1 > y && side > 0) winding += 1;
    if (y0 > y && y1 <= y && side < 0) winding -= 1;
  }
  return winding;
}

function bounds(points: readonly number[]) {
  const xs = points.filter((_, index) => index % 2 === 0);
  const ys = points.filter((_, index) => index % 2 === 1);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

describe("planStudioCalligraphyRibbon", () => {
  it("pins the 32-step renderer expansion used by live-transform admission", () => {
    const source = Array.from({ length: 255 }, (_, index) => segment(
      index * 2,
      index % 2 === 0 ? 0 : 100,
      (index + 1) * 2,
      (index + 1) % 2 === 0 ? 0 : 100,
      512,
      0,
      0.08,
    ));
    const plan = planStudioCalligraphyRibbon(source);
    const actualOutlineCoordinateScalars = plan.runs.reduce(
      (total, run) => total + run.outlinePoints.length,
      0,
    );
    const upper = studioCalligraphyRibbonWorkUpperBound(256);

    expect(upper).toEqual({
      acceptedSegmentCount: 255,
      outlineCoordinateScalars: 53_038,
      canvasPathCommands: 27_542,
    });
    expect(plan.acceptedSegmentCount).toBe(255);
    expect(actualOutlineCoordinateScalars).toBe(53_038);
  });

  it("sweeps the authored elliptical nib into the outline and neutralizes legacy circle caps", () => {
    const aligned = planStudioCalligraphyRibbon([
      segment(0, 0, 20, 0, 10, 0, 0.25),
    ]);
    const perpendicular = planStudioCalligraphyRibbon([
      segment(0, 0, 20, 0, 10, Math.PI / 2, 0.25),
    ]);

    expect(aligned).toMatchObject({
      sourceSegmentCount: 1,
      acceptedSegmentCount: 1,
    });
    expect(aligned.runs).toHaveLength(1);
    expect(aligned.runs[0]).toMatchObject({
      segmentCount: 1,
      startCap: { x: 0, y: 0, radius: 0 },
      endCap: { x: 20, y: 0, radius: 0 },
    });
    const alignedBounds = bounds(aligned.runs[0]!.outlinePoints);
    const perpendicularBounds = bounds(perpendicular.runs[0]!.outlinePoints);
    // The same projected width has a long cap when the flat nib is aligned with travel and a
    // compact cap when it is perpendicular. A legacy circular cap cannot express this difference.
    expect(alignedBounds.minX).toBeCloseTo(-20, 3);
    expect(perpendicularBounds.minX).toBeCloseTo(-1.25, 3);
    expect(alignedBounds.maxY).toBeCloseTo(5, 3);
    expect(perpendicularBounds.maxY).toBeCloseTo(5, 3);
    expect(signedArea(aligned.runs[0]!.outlinePoints)).toBeGreaterThan(0);
    expect(signedArea(perpendicular.runs[0]!.outlinePoints)).toBeGreaterThan(0);
  });

  it.each([
    ["0°", 0],
    ["90°", Math.PI / 2],
  ] as const)(
    "keeps explicit positive-winding terminal interiors for a %s tilted nib",
    (_label, tipAngleRad) => {
      const plan = planStudioCalligraphyRibbon([
        segment(30, 40, 90, 40, 18, tipAngleRad, 0.35),
      ]);
      const outline = plan.runs[0]!.outlinePoints;

      // Both the sweep and the explicit terminal footprint contribute positive winding. This is
      // intentional redundancy inside one fill, not alpha stacking.
      expect(windingAt(outline, 30, 40)).toBeGreaterThanOrEqual(2);
      expect(windingAt(outline, 90, 40)).toBeGreaterThanOrEqual(2);
      expect(signedArea(outline)).toBeGreaterThan(0);
    },
  );

  it("keeps contiguous segment sweeps in one same-opacity fill run", () => {
    const plan = planStudioCalligraphyRibbon([
      segment(0, 0, 20, 0, 8),
      segment(20, 0, 30, 10, 12),
      segment(30, 10, 45, 10, 16),
    ]);

    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]!.segmentCount).toBe(3);
    expect(plan.runs[0]!.outlinePoints.length).toBeGreaterThan(100);
    expect(plan.runs[0]!.startCap.radius).toBe(0);
    expect(plan.runs[0]!.endCap.radius).toBe(0);
    expect(signedArea(plan.runs[0]!.outlinePoints)).toBeGreaterThan(0);
    expect(plan.runs[0]!.outlinePoints.every(Number.isFinite)).toBe(true);
  });

  it("preserves pressure-driven width growth in the swept nib envelope", () => {
    const plan = planStudioCalligraphyRibbon([
      segment(0, 0, 20, 0, 2, 0, 1),
      segment(20, 0, 40, 0, 18, 0, 1),
    ]);
    const run = plan.runs[0]!;
    const envelope = bounds(run.outlinePoints);

    expect(envelope.minY).toBeCloseTo(-9, 3);
    expect(envelope.maxY).toBeCloseTo(9, 3);
    expect(windingAt(run.outlinePoints, 5, 0)).toBeGreaterThan(0);
    expect(windingAt(run.outlinePoints, 35, 8)).toBeGreaterThan(0);
  });

  it("bounds acute reversals without unbounded miter geometry", () => {
    const plan = planStudioCalligraphyRibbon([
      segment(0, 0, 20, 0, 20),
      segment(20, 0, 0.01, 0.1, 20),
    ]);
    const coordinates = plan.runs[0]!.outlinePoints;

    expect(coordinates.every(Number.isFinite)).toBe(true);
    for (let index = 0; index < coordinates.length; index += 2) {
      expect(Math.hypot(coordinates[index]! - 20, coordinates[index + 1]!))
        .toBeLessThan(64);
    }
  });

  it("keeps exact A→B→A retraces covered instead of cancelling the winding", () => {
    const plan = planStudioCalligraphyRibbon([
      segment(20, 30, 80, 30, 14, -Math.PI / 6, 0.32),
      segment(80, 30, 20, 30, 14, -Math.PI / 6, 0.32),
    ]);
    const run = plan.runs[0]!;

    expect(plan.runs).toHaveLength(1);
    expect(run.segmentCount).toBe(2);
    expect(signedArea(run.outlinePoints)).toBeGreaterThan(0);
    expect(windingAt(run.outlinePoints, 35, 30)).toBeGreaterThan(0);
    expect(windingAt(run.outlinePoints, 50, 30)).toBeGreaterThan(0);
    expect(windingAt(run.outlinePoints, 70, 30)).toBeGreaterThan(0);
  });

  it("keeps every arm and the crossing of a figure-eight covered", () => {
    const plan = planStudioCalligraphyRibbon([
      segment(20, 20, 80, 80, 10, Math.PI / 5, 0.42),
      segment(80, 80, 20, 80, 10, Math.PI / 5, 0.42),
      segment(20, 80, 80, 20, 10, Math.PI / 5, 0.42),
    ]);
    const outline = plan.runs[0]!.outlinePoints;

    expect(windingAt(outline, 32, 32)).toBeGreaterThan(0);
    expect(windingAt(outline, 50, 50)).toBeGreaterThan(0);
    expect(windingAt(outline, 68, 32)).toBeGreaterThan(0);
  });

  it("keeps an already displayed live prefix byte-identical after committed replay grows", () => {
    const source = [
      segment(10, 15, 35, 15, 7, -Math.PI / 5, 0.3),
      segment(35, 15, 48, 34, 11, -Math.PI / 7, 0.42),
      segment(48, 34, 72, 28, 9, Math.PI / 9, 0.55),
    ];
    const live = planStudioCalligraphyRibbon(source.slice(0, 2));
    const committed = planStudioCalligraphyRibbon(structuredClone(source));
    const replay = planStudioCalligraphyRibbon(structuredClone(source));
    const liveOutline = live.runs[0]!.outlinePoints;
    const committedOutline = committed.runs[0]!.outlinePoints;

    expect(committed).toEqual(replay);
    expect(committedOutline.slice(0, liveOutline.length)).toEqual(liveOutline);
  });

  it("splits discontinuities, drops invalid zero-length segments, and does not mutate input", () => {
    const source = [
      segment(0, 0, 10, 0, 4),
      segment(10, 0, 10, 0, 9),
      segment(50, 50, 60, 50, 6),
      segment(Number.NaN, 0, 70, 0, 8),
    ];
    const before = structuredClone(source);
    const plan = planStudioCalligraphyRibbon(source);

    expect(plan).toMatchObject({
      sourceSegmentCount: 4,
      acceptedSegmentCount: 2,
    });
    expect(plan.runs).toHaveLength(2);
    expect(plan.runs.map((run) => run.segmentCount)).toEqual([1, 1]);
    expect(source).toEqual(before);
  });
});
