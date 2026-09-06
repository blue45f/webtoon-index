/**
 * Shape-driven identity guard for the retained impasto height field.
 *
 * `studio-oil-ribbon-carrier.incremental.test.ts` walks one smooth stroke sample by sample. That
 * catches boundary errors in the bake/tail split, but not errors that depend on WHERE the stroke
 * goes — and the retained field has one of those. Its layers are blitted onto the new tile when
 * the tile moves or grows, and a blit can only carry cells that already existed. If a stamp was
 * clipped at the old tile edge and the stroke later grows back over that station, the batch
 * planner fills the newly exposed cells and a blit never can.
 *
 * `climb` is the shape that actually exercised it: a long horizontal run (which makes the cell
 * coarse, so the film feather overhangs the box by more than its pad) followed by a turn back up
 * across its own settled prefix. Before `IMPASTO_RELIEF_STAMP_REACH_*` widened the tile, 185 of
 * 556 appends on that stroke had a differing shading field, worst cell off by 0.294 — while the
 * smooth per-sample walk and every checkpoint test stayed green.
 *
 * The others cover the rest of the ways the tile can move under the settled layer.
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
  planStudioOilRibbonCarrier,
  studioOilRibbonProgramsForBrush,
} from "./studio-oil-ribbon-carrier";

const SEED = fxBrushSeedFromKey("relief-tile-shapes");
const BRUSH = "oil--impasto-ribbon";

type Shape = (index: number) => readonly [number, number, number];

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

const SHAPES: Record<string, { shape: Shape; samples: number }> = {
  // The regression above: long run, then a climb back across the settled prefix. The turn is at
  // 300; before the fix the field started diverging at 302 and never recovered.
  climb: {
    shape: (i) => (i < 300
      ? [60 + i * 11, 800 + Math.sin(i / 23) * 6, 0.6]
      : [60 + 299 * 11, 800 - (i - 300) * 11, 0.6]),
    samples: 520,
  },
  // Back-and-forth: the box's leading edge is set by the mutable tail and retracts.
  zigzag: {
    shape: (i) => [
      200 + Math.sin(i / 6) * 90,
      120 + i * 1.4,
      0.3 + 0.5 * Math.abs(Math.sin(i / 17)),
    ],
    samples: 240,
  },
  // Inward spiral: the extents are set early by stations that settle, then the tail comes back
  // inside them, so the tile stops growing while the settled prefix keeps advancing.
  spiral: {
    shape: (i) => {
      const t = i / 9;
      const r = 240 - i * 0.5;
      return [420 + Math.cos(t) * r, 420 + Math.sin(t) * r, 0.5];
    },
    samples: 240,
  },
  // Hairpin: folds back past its own start, so the origin moves and the tile grows leftward.
  hairpin: {
    shape: (i) => [
      i < 60 ? 100 + i * 6 : i < 140 ? 460 - (i - 60) * 6 : -20 + (i - 140) * 9,
      300 + Math.sin(i / 11) * 30,
      0.6,
    ],
    samples: 240,
  },
  // Hard pressure swing: radiusY drives the film's stamp gap AND the reach margin, so the tile
  // grows for a reason unrelated to where the stroke is.
  pressure: {
    shape: (i) => [
      90 + i * 3.4,
      300 + Math.cos(i / 13) * 40,
      0.06 + 0.92 * Math.abs(Math.sin(i / 9)),
    ],
    samples: 240,
  },
};

describe("StudioOilRibbonCarrierPlanner — retained relief tile under a moving box", () => {
  for (const [name, { shape, samples }] of Object.entries(SHAPES)) {
    it(`stays batch-identical at every append — ${name}`, () => {
      const options = studioOilRibbonProgramsForBrush(BRUSH, SEED);
      const planner = new StudioOilRibbonCarrierPlanner();
      const dabPlanner = new FxOilDabPlanner();
      const points: number[] = [];
      const pressures: number[] = [];
      // Collected, not asserted in place: which appends diverge is the diagnosis. A single
      // boundary slip and "every append after the turn" look identical from a first failure.
      const diverged: number[] = [];
      for (let index = 0; index < samples; index += 1) {
        const [x, y, pressure] = shape(index);
        points.push(x, y);
        pressures.push(pressure);
        if (index < 3) continue;
        const dabs = dabsAt([...points], [...pressures], dabPlanner);
        try {
          expect(planner.plan(dabs, options).impastoReliefLanes)
            .toEqual(planStudioOilRibbonCarrier(dabs, options).impastoReliefLanes);
        } catch {
          diverged.push(index);
        }
      }
      expect(diverged).toEqual([]);
    }, 600_000);
  }

  // Equality alone cannot tell a working cache from one that reuses nothing: both are batch-
  // identical, and only one of them is the point. The stride cuts a run every three stations, so
  // a settled prefix of S stations offers roughly S/3 run indices across every track.
  it("takes most of its runs from the previous move once the prefix settles", () => {
    const options = studioOilRibbonProgramsForBrush(BRUSH, SEED);
    const planner = new StudioOilRibbonCarrierPlanner();
    const dabPlanner = new FxOilDabPlanner();
    const points: number[] = [];
    const pressures: number[] = [];
    let lastPlanned = 0;
    for (let index = 0; index < 200; index += 1) {
      points.push(120 + index * 7, 400 + Math.sin(index / 19) * 40);
      pressures.push(0.55);
      const plan = planner.plan(dabsAt([...points], [...pressures], dabPlanner), options);
      lastPlanned = (plan.impastoReliefLanes ?? []).reduce((total, lane) => total + lane.runs.length, 0);
    }
    expect(lastPlanned).toBeGreaterThan(0);
    expect(planner.reusedReliefRuns).toBeGreaterThan(0);
    // Runs are welded into stripes before they reach the plan, so the reused count is compared
    // against the pre-weld population it comes from, not against the lane runs.
    expect(planner.reusedReliefRuns).toBeGreaterThan(planner.settledStations);
  });

  // The bed every measurement in this effort is taken on, and the one shape the per-append walks
  // above cannot reach: past FX_OIL_DAB_CAP the lattice refits under the stroke on every append,
  // so the settled prefix, the tile and the hair stride all move for reasons the shorter strokes
  // never produce. A window is compared rather than the whole climb — a batch replan at the cap
  // is the expensive half.
  it("stays batch-identical at every append past the dab cap", () => {
    const options = studioOilRibbonProgramsForBrush(BRUSH, SEED);
    const planner = new StudioOilRibbonCarrierPlanner();
    const dabPlanner = new FxOilDabPlanner();
    const points: number[] = [];
    const pressures: number[] = [];
    let capped = 0;
    for (let index = 0; capped < 12; index += 1) {
      const t = index / 40;
      points.push(700 + Math.cos(t) * (140 + index * 0.7), 700 + Math.sin(t) * (140 + index * 0.7));
      pressures.push(0.3 + 0.6 * Math.abs(Math.sin(index / 57)));
      if (index < 3) continue;
      const dabs = dabsAt([...points], [...pressures], dabPlanner);
      const plan = planner.plan(dabs, options);
      if (dabs.length < FX_OIL_DAB_CAP - 8) continue;
      capped += 1;
      expect(plan.impastoReliefLanes)
        .toEqual(planStudioOilRibbonCarrier(dabs, options).impastoReliefLanes);
    }
    expect(capped).toBe(12);
  }, 900_000);
});
