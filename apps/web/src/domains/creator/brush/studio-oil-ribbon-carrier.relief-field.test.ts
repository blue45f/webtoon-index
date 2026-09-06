/**
 * Identity guard for the retained relief tile itself, one level below the lane comparisons.
 *
 * The sibling suites compare `impastoReliefLanes` against a full batch replan, which is the
 * contract that matters — but it cannot see everything the retained tile could get wrong.
 * `lineWidth` and `opacity` are quantised on the way out, so a tile that has drifted by less than
 * the quantisation step leaves those lanes byte-identical. `strength` is NOT quantised and does
 * gate the highlight/shadow sign, the raw tone bucket and whether a run clears
 * `IMPASTO_RELIEF_MIN_STRENGTH` at all — so drift is observable in principle, just only when it
 * happens to land on one of those edges. That is a probabilistic guard on a design whose whole
 * claim is that the tile never drifts at all.
 *
 * So this compares the tile. A planner walked append by append must hold exactly the shading a
 * planner handed the same dabs in one shot computes from scratch — same grid, same cell, same
 * origin, and every cell bit-for-bit.
 *
 * Two invalidation paths depend on the tile's reach margin in ways nothing else would catch (both
 * are written up at `IMPASTO_RELIEF_STAMP_REACH_RADIUS_RATIO`): `impastoStationBounds` boxes
 * stations at their CURRENT positions, so a station that moved far enough would strand its old
 * stamp; and `impastoGrowthBands` fires only where the tile grew, so a shrinking tile turns
 * interior cells into border cells whose shading switches to a clamped neighbourhood. Both are
 * held by the margin rather than by construction, which is exactly the kind of thing that rots
 * silently when a constant is retuned. The shapes below are chosen to move and shrink the tile.
 */
import { describe, expect, it } from "vitest";

import {
  FX_OIL_DAB_CAP,
  FxOilDabPlanner,
  fxBrushSeedFromKey,
  studioOilPaintBodyForBrush,
  studioOilTipProfileForBrush,
  type FxOilDab,
} from "../studio-fx-brush";

import {
  StudioOilRibbonCarrierPlanner,
  studioOilRibbonProgramsForBrush,
} from "./studio-oil-ribbon-carrier";

const SEED = fxBrushSeedFromKey("relief-field-shapes");
const BRUSH = "oil--impasto-ribbon";

function dabsAt(points: number[], pressures: number[], planner: FxOilDabPlanner): FxOilDab[] {
  return planner.plan({
    points,
    pressures,
    baseWidth: 24,
    seed: SEED,
    maxDabs: FX_OIL_DAB_CAP,
    paintBody: studioOilPaintBodyForBrush(BRUSH),
    tipProfile: studioOilTipProfileForBrush(BRUSH),
    capMode: "prefix-stable-ladder-v2" as const,
  });
}

const SHAPES: Record<string, { shape: (index: number) => readonly [number, number, number]; samples: number }> = {
  // Long run then a climb back across the settled prefix — the shape the reach margin was added
  // for, and the one that moves the tile furthest under an already-baked layer.
  climb: {
    shape: (i) => (i < 300
      ? [60 + i * 11, 800 + Math.sin(i / 23) * 6, 0.6]
      : [60 + 299 * 11, 800 - (i - 300) * 11, 0.6]),
    samples: 360,
  },
  // Back-and-forth: the leading edge is set by the mutable tail and RETRACTS, which is what
  // produces a shrinking blit — the case `impastoGrowthBands` does not emit a band for.
  zigzag: {
    shape: (i) => [
      200 + Math.sin(i / 6) * 90,
      120 + i * 1.4,
      0.3 + 0.5 * Math.abs(Math.sin(i / 17)),
    ],
    samples: 200,
  },
  // Folds back past its own start, so the origin moves and the tile grows leftward.
  hairpin: {
    shape: (i) => [
      i < 60 ? 100 + i * 6 : i < 140 ? 460 - (i - 60) * 6 : -20 + (i - 140) * 9,
      300 + Math.sin(i / 11) * 30,
      0.6,
    ],
    samples: 200,
  },
  // Hard pressure swing: radiusY drives the reach margin, so the tile grows and shrinks for a
  // reason unrelated to where the stroke goes.
  pressure: {
    shape: (i) => [
      90 + i * 3.4,
      300 + Math.cos(i / 13) * 40,
      0.06 + 0.92 * Math.abs(Math.sin(i / 9)),
    ],
    samples: 200,
  },
};

describe("StudioOilRibbonCarrierPlanner — retained relief field vs a one-shot build", () => {
  for (const [name, { shape, samples }] of Object.entries(SHAPES)) {
    it(`holds a bit-identical shading tile at every append — ${name}`, () => {
      const options = studioOilRibbonProgramsForBrush(BRUSH, SEED);
      const incremental = new StudioOilRibbonCarrierPlanner();
      const dabPlanner = new FxOilDabPlanner();
      const points: number[] = [];
      const pressures: number[] = [];
      // Collected rather than asserted in place: which appends drift, and by how much, is the
      // diagnosis. A single boundary slip and "everything after the turn" look the same from a
      // first failure.
      const drifted: { at: number; cells: number; worst: number; reason: string }[] = [];
      let compared = 0;
      for (let index = 0; index < samples; index += 1) {
        const [x, y, pressure] = shape(index);
        points.push(x, y);
        pressures.push(pressure);
        if (index < 3) continue;
        const dabs = dabsAt([...points], [...pressures], dabPlanner);
        incremental.plan(dabs, options);
        const retained = incremental.reliefField;
        const fresh = new StudioOilRibbonCarrierPlanner();
        fresh.plan(dabs, options);
        const built = fresh.reliefField;
        if (retained === null || built === null) {
          if (retained !== built) {
            drifted.push({ at: index, cells: 0, worst: 0, reason: "one side has no field" });
          }
          continue;
        }
        compared += 1;
        if (
          retained.gridWidth !== built.gridWidth
          || retained.gridHeight !== built.gridHeight
          || retained.cell !== built.cell
          || retained.originX !== built.originX
          || retained.originY !== built.originY
        ) {
          drifted.push({ at: index, cells: 0, worst: 0, reason: "grid differs" });
          continue;
        }
        let cells = 0;
        let worst = 0;
        for (let at = 0; at < retained.shading.length; at += 1) {
          const delta = Math.abs(retained.shading[at]! - built.shading[at]!);
          if (delta > 0) {
            cells += 1;
            if (delta > worst) worst = delta;
          }
        }
        if (cells > 0) drifted.push({ at: index, cells, worst, reason: "shading differs" });
      }
      expect(drifted).toEqual([]);
      // The comparison is worthless if the retained path never actually retained anything.
      expect(compared).toBeGreaterThan(samples / 2);
    }, 900_000);
  }
});
