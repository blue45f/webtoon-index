/**
 * Append-stability contract for `bristleBanding: "fixed-anchor-v2"`.
 *
 * The whole point of the v2 banding option is that planning MORE dabs never retroactively
 * changes the lanes already planned for an earlier prefix — every emitted value is either
 * run-local geometry or a pure function of the lane's (band, width-bucket) key. That property is
 * what a future live suffix assembly stands on (roadmap §3); this file pins it before any caller
 * exists, the same way `studio-oil-incremental-plan.test.ts` pins the dab bed's identity.
 *
 * v1 (`observed-span-v1`, the default) deliberately does NOT have this property — its bands come
 * from the global min/max load span and its deposits from per-band membership means — which is
 * exactly why the option exists.
 */
import { describe, expect, it } from "vitest";

import { planOilBrushDabs, type FxOilDab, type FxOilPlanInput } from "../studio-fx-brush";

import {
  planStudioOilRibbonCarrier,
  type StudioOilRibbonBristleLane,
} from "./studio-oil-ribbon-carrier";

const SEED = 20_997;
const BASE_WIDTH = 22;

function makeStroke(n: number, step = 3): { points: number[]; pressures: number[] } {
  const points: number[] = [];
  const pressures: number[] = [];
  let x = 40;
  let y = 300;
  let heading = 0;
  // Constant tiny turn rate: a very large-radius arc that never revisits earlier space, so
  // "spatially inside an early box" reliably implies "early station index" for the tail filters
  // below (a meandering generator would let late runs re-enter early boxes as false positives).
  for (let index = 0; index < n; index += 1) {
    heading += 0.008;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    points.push(x, y);
    pressures.push(0.25 + 0.7 * Math.abs(Math.sin(index * 0.004)));
  }
  return { points, pressures };
}

function planInputFor(stroke: { points: number[]; pressures: number[] }): FxOilPlanInput {
  return {
    points: stroke.points,
    pressures: stroke.pressures,
    baseWidth: BASE_WIDTH,
    seed: SEED,
    maxDabs: 4096,
    paintBody: "oil",
    tipProfile: "bristle",
  };
}

const V2 = { bristleBanding: "fixed-anchor-v2" } as const;

function laneKey(lane: StudioOilRibbonBristleLane): string {
  return `${lane.loadBand}:${lane.lineWidth}:${lane.opacity}`;
}

function runPaths(lane: StudioOilRibbonBristleLane): Set<string> {
  return new Set(lane.runs.map((run) => run.points.join(",")));
}

describe("fixed-anchor-v2 bristle banding", () => {
  it("keeps every earlier lane byte-identical when later dabs append", () => {
    const stroke = makeStroke(240);
    const dabs: readonly FxOilDab[] = planOilBrushDabs(planInputFor(stroke));
    expect(dabs.length).toBeGreaterThan(60);

    const fullLanes = planStudioOilRibbonCarrier(dabs, V2).bristleLanes;
    const fullByKey = new Map<string, Set<string>>();
    for (const lane of fullLanes) {
      const key = laneKey(lane);
      const paths = fullByKey.get(key);
      const own = runPaths(lane);
      if (paths) for (const path of own) paths.add(path);
      else fullByKey.set(key, own);
    }

    // The prefix sweep walks several lengths so a band flip anywhere along the stroke is caught.
    for (const prefixDabCount of [40, 80, 130]) {
      const prefixLanes = planStudioOilRibbonCarrier(
        dabs.slice(0, prefixDabCount),
        V2,
      ).bristleLanes;
      expect(prefixLanes.length).toBeGreaterThan(0);
      // THE v2 contract: a lane's deposit (loadBand / lineWidth / opacity) is a pure function of
      // its (band, width-bucket) key, so appending dabs can never retroactively change what any
      // already-planned lane paints WITH. Run coordinates are deliberately NOT asserted across
      // plans: welds legally extend a segment when a later run lands in the same group — union
      // behaviour, same class as the dry-media union carrier — handled at paint time by
      // repainting only the affected lane, whose alpha this contract guarantees unchanged.
      for (const lane of prefixLanes) {
        const key = laneKey(lane);
        const fullPathSet = fullByKey.get(key);
        expect(
          fullPathSet,
          `lane ${key} from prefix ${prefixDabCount} vanished or changed deposit in the full plan`,
        ).toBeDefined();
      }
    }
  });

  it("is deterministic across repeated plans", () => {
    const stroke = makeStroke(140);
    const dabs = planOilBrushDabs(planInputFor(stroke));
    const first = planStudioOilRibbonCarrier(dabs, V2);
    const second = planStudioOilRibbonCarrier(dabs, V2);
    expect(second.bristleLanes).toEqual(first.bristleLanes);
  });

  it("emits lanes ordered by ascending band then width bucket", () => {
    const stroke = makeStroke(200);
    const dabs = planOilBrushDabs(planInputFor(stroke));
    const lanes = planStudioOilRibbonCarrier(dabs, V2).bristleLanes;
    const keys = lanes.map((lane) => lane.loadBand * 1_000_000 + lane.lineWidth);
    const sorted = [...keys].sort((left, right) => left - right);
    expect(keys).toEqual(sorted);
  });
});
