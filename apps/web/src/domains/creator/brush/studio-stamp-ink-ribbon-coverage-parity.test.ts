/**
 * Coverage parity for the ink ribbon's join omission.
 *
 * `planStudioStampInkRibbon` drops the join disc of any station it can prove is already covered by
 * the surrounding bodies. That is a rendering optimisation, so it is held to a rendering contract:
 * every polygon that survives must be byte-identical to the historical carrier, and rasterising the
 * two plans with the shipped non-zero fill rule must agree everywhere except a sub-pixel boundary
 * band — at document scale and at the 500% zoom ceiling.
 */

import { describe, expect, it } from "vitest";

import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushStyle,
} from "./studio-brush-stamp-engine";
import {
  INK_RIBBON_JOIN_TOLERANCE,
  planStudioStampInkRibbon,
  type StudioStampInkRibbonPlan,
} from "./studio-stamp-ink-ribbon";

interface Raster {
  readonly width: number;
  readonly height: number;
  readonly covered: Uint8Array;
}

interface Edge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

interface Frame {
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
}

/** One shared pixel grid, so the two plans are compared sample for sample. */
function frameOf(plan: StudioStampInkRibbonPlan, scale: number): Frame {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const polygon of plan.polygons) {
    for (let index = 0; index + 1 < polygon.points.length; index += 2) {
      minX = Math.min(minX, polygon.points[index]! * scale);
      maxX = Math.max(maxX, polygon.points[index]! * scale);
      minY = Math.min(minY, polygon.points[index + 1]! * scale);
      maxY = Math.max(maxY, polygon.points[index + 1]! * scale);
    }
  }
  return {
    originX: minX - 2,
    originY: minY - 2,
    width: Math.ceil(maxX - minX) + 4,
    height: Math.ceil(maxY - minY) + 4,
  };
}

/** Scanline non-zero fill at pixel centres — the same rule the shipped single fill uses. */
function rasterize(
  plan: StudioStampInkRibbonPlan,
  scale: number,
  frame: Frame,
): Raster {
  const edges: Edge[] = [];
  for (const polygon of plan.polygons) {
    const points = polygon.points;
    if (points.length < 6) continue;
    for (let index = 0; index + 1 < points.length; index += 2) {
      const next = (index + 2) % points.length;
      edges.push({
        x1: points[index]! * scale,
        y1: points[index + 1]! * scale,
        x2: points[next]! * scale,
        y2: points[next + 1]! * scale,
      });
    }
  }
  const { originX: minX, originY: minY, width, height } = frame;
  const covered = new Uint8Array(width * height);
  const crossings: Array<{ x: number; winding: number }> = [];
  for (let row = 0; row < height; row += 1) {
    const y = minY + row + 0.5;
    crossings.length = 0;
    for (const edge of edges) {
      const rising = edge.y1 <= y && edge.y2 > y;
      const falling = edge.y2 <= y && edge.y1 > y;
      if (!rising && !falling) continue;
      const t = (y - edge.y1) / (edge.y2 - edge.y1);
      crossings.push({ x: edge.x1 + (edge.x2 - edge.x1) * t, winding: rising ? 1 : -1 });
    }
    if (crossings.length === 0) continue;
    crossings.sort((left, right) => left.x - right.x);
    let winding = 0;
    for (let index = 0; index + 1 < crossings.length; index += 1) {
      winding += crossings[index]!.winding;
      if (winding === 0) continue;
      const from = crossings[index]!.x;
      const to = crossings[index + 1]!.x;
      const firstColumn = Math.max(0, Math.ceil(from - minX - 0.5));
      const lastColumn = Math.min(width - 1, Math.floor(to - minX - 0.5));
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        covered[row * width + column] = 1;
      }
    }
  }
  return { width, height, covered };
}

function coveredCount(raster: Raster): number {
  let total = 0;
  for (const sample of raster.covered) total += sample;
  return total;
}

/**
 * Narrow dimension, in samples, of the uncovered region a lost sample sits in. A retraction that
 * only shaves the outline leaves a sliver whose narrowest run is a sample or two wide.
 */
/**
 * Is this sample deep inside the reference shape rather than on its silhouette?
 *
 * `narrowestUncoveredRun` only means "how wide is the hole" for a sample the reference says should
 * be surrounded by ink. On the silhouette it measures something else entirely: the run walks
 * straight out of the shape into open paper and returns its 64-step cap, so a retraction of ONE
 * sample at the outer edge - the sub-pixel boundary band this contract explicitly permits - was
 * scored as a 4-document-pixel gap. Filtering here rather than loosening the bound keeps the bound
 * meaningful; interior losses are still probed, and the pressure-ramp stroke exercises that path
 * with 18 of them.
 */
function isReferenceInterior(raster: Raster, column: number, row: number): boolean {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const x = column + dx;
      const y = row + dy;
      if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return false;
      if (raster.covered[y * raster.width + x] !== 1) return false;
    }
  }
  return true;
}

function narrowestUncoveredRun(raster: Raster, column: number, row: number): number {
  let narrowest = Number.POSITIVE_INFINITY;
  for (const [stepX, stepY] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
    let run = 1;
    for (const direction of [1, -1] as const) {
      for (let step = 1; step < 64; step += 1) {
        const x = column + stepX * step * direction;
        const y = row + stepY * step * direction;
        if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) break;
        if (raster.covered[y * raster.width + x] === 1) break;
        run += 1;
      }
    }
    narrowest = Math.min(narrowest, run);
  }
  return narrowest;
}

/** Accumulating x so a velocity change is a change of step, never a teleport. */
function ramped(steps: number, stepAt: (index: number) => number): number[] {
  let x = 0;
  return Array.from({ length: steps }, (_, index) => {
    if (index > 0) x += stepAt(index);
    return x;
  });
}

const STROKES = [
  {
    name: "harness burst sweep (straight, constant velocity)",
    size: 8,
    points: Array.from({ length: 26 }, (_, index) => [index * 8, 0]).flat(),
    pressures: Array.from({ length: 26 }, () => 0.5),
  },
  {
    name: "harness paced sine leg",
    size: 8,
    points: Array.from({ length: 26 }, (_, index) => [
      index * 8,
      Math.sin((index / 25) * Math.PI * 2.5) * 24,
    ]).flat(),
    pressures: Array.from({ length: 26 }, () => 0.5),
  },
  {
    name: "pressure ramp with velocity change",
    size: 18,
    points: ramped(26, (index) => (index < 13 ? 4 : 16)).flatMap((x, index) => [
      x,
      Math.cos(index / 4) * 12,
    ]),
    pressures: Array.from({ length: 26 }, (_, index) => 0.2 + 0.8 * (index / 25)),
  },
  {
    name: "sharp corners and exact retrace",
    size: 18,
    points: [0, 0, 60, 0, 60, 60, 0, 60, 0, 0, 60, 0],
    pressures: [0.8, 0.6, 0.9, 0.5, 0.8, 0.7],
  },
] as const;

function plans(stroke: (typeof STROKES)[number]) {
  const style = resolveStudioStampBrushStyle(
    "ink",
    { color: "#1b2430", size: stroke.size, opacity: 0.9 },
  );
  const dabs = planStudioStampBrushDabs(style, stroke.points, stroke.pressures);
  return {
    reference: planStudioStampInkRibbon(dabs, { joinTolerance: 0 }),
    shipped: planStudioStampInkRibbon(dabs),
  };
}

describe("stamp ink ribbon join omission", () => {
  it.each(STROKES)("keeps every surviving polygon byte-identical for $name", (stroke) => {
    const { reference, shipped } = plans(stroke);

    expect(shipped.opacity).toBe(reference.opacity);
    expect(shipped.acceptedDabCount).toBe(reference.acceptedDabCount);
    expect(shipped.sourceDabCount).toBe(reference.sourceDabCount);
    for (const role of ["body", "start-cap", "end-cap", "tap"] as const) {
      expect(shipped.polygons.filter((polygon) => polygon.role === role))
        .toEqual(reference.polygons.filter((polygon) => polygon.role === role));
    }
    // Joins are only ever removed, never moved: the survivors are a subsequence of the reference.
    const referenceJoins = reference.polygons.filter(({ role }) => role === "join");
    const shippedJoins = shipped.polygons.filter(({ role }) => role === "join");
    expect(shippedJoins.length + shipped.omittedJoinCount).toBe(referenceJoins.length);
    expect(referenceJoins).toEqual(expect.arrayContaining(shippedJoins));
    expect(reference.omittedJoinCount).toBe(0);
  });

  it.each(STROKES)("rasterises identically apart from a sub-pixel band for $name", (stroke) => {
    const { reference, shipped } = plans(stroke);

    // 1x is the document grid, 5x the zoom ceiling, 16x resolves the tolerance itself
    // (one sample is 0.0625 document pixels, wider than INK_RIBBON_JOIN_TOLERANCE).
    for (const scale of [1, 5, 16]) {
      const frame = frameOf(reference, scale);
      const referenceRaster = rasterize(reference, scale, frame);
      const shippedRaster = rasterize(shipped, scale, frame);

      let gained = 0;
      let lost = 0;
      let widestGap = 0;
      for (let row = 0; row < referenceRaster.height; row += 1) {
        for (let column = 0; column < referenceRaster.width; column += 1) {
          const offset = row * referenceRaster.width + column;
          const before = referenceRaster.covered[offset]!;
          if (before === shippedRaster.covered[offset]) continue;
          if (before === 0) {
            gained += 1;
            continue;
          }
          lost += 1;
          if (scale >= 16 && isReferenceInterior(referenceRaster, column, row)) {
            widestGap = Math.max(widestGap, narrowestUncoveredRun(shippedRaster, column, row));
          }
        }
      }
      const referenceArea = coveredCount(referenceRaster);
      expect(referenceArea).toBeGreaterThan(100);
      // Every polygon is positively wound, so a non-zero fill can only lose area here.
      expect(gained, `${stroke.name} @${scale}x gained`).toBe(0);
      expect(lost / referenceArea, `${stroke.name} @${scale}x lost area`).toBeLessThan(0.003);
      // 2 samples at 16x is 0.125 document pixels — the retraction never opens a visible gap.
      expect(widestGap, `${stroke.name} @${scale}x gap width`).toBeLessThanOrEqual(2);
    }
  });

  it("omits the joins that dominate a dense straight carrier and keeps corner joins", () => {
    const straight = plans(STROKES[0]!).shipped;
    const corners = plans(STROKES[3]!).shipped;

    expect(straight.joinTolerance).toBe(INK_RIBBON_JOIN_TOLERANCE);
    // Only the stations too close to an end to prove their own reach keep a join.
    expect(straight.omittedJoinCount).toBeGreaterThan(straight.acceptedDabCount * 0.9);
    expect(corners.polygons.filter(({ role }) => role === "join").length)
      .toBeGreaterThan(0);
  });

  it("never omits a join when the caller opts out", () => {
    for (const stroke of STROKES) {
      const exact = planStudioStampInkRibbon(
        planStudioStampBrushDabs(
          resolveStudioStampBrushStyle(
            "ink",
            { color: "#1b2430", size: stroke.size, opacity: 0.9 },
          ),
          stroke.points,
          stroke.pressures,
        ),
        { joinTolerance: 0 },
      );
      expect(exact.omittedJoinCount).toBe(0);
      expect(exact.polygons.filter(({ role }) => role === "join"))
        .toHaveLength(Math.max(0, exact.acceptedDabCount - 2));
    }
  });
});
