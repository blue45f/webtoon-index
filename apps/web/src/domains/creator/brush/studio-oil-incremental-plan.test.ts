/**
 * Identity guard for the growing-stroke oil dab planner.
 *
 * `FxOilDabPlanner` exists so a live oil stroke stops rebuilding its whole bed on every pointer
 * move. It is only allowed to exist if the bed it returns is the one a full replan returns —
 * ADR-0010 puts texture and pen-feel above performance, so "close" is a regression.
 *
 * The interesting boundary is the dab cap. Below it `sampleStations` walks a prefix-stable arc
 * lattice; at `naturalStationCount > stationLimit` it coarsens the spacing one ladder rung at a
 * time, which keeps the placed stations still — but the append that climbs a rung re-spaces the
 * whole arc, and a cache that assumed stability there would silently diverge exactly where strokes
 * get long. The rows below pin cap-1 / cap and both sides of the first rung climb.
 */
import { describe, expect, it } from "vitest";

import {
  FX_OIL_DAB_CAP,
  FxOilDabPlanner,
  planOilBrushDabs,
  type FxOilDab,
  type FxOilPlanInput,
} from "../studio-fx-brush";

import { planStudioOilRibbonCarrier, studioOilRibbonProgramsForBrush } from "./studio-oil-ribbon-carrier";

const SEED = 20_997;
const BASE_WIDTH = 22;

function makeStroke(n: number, step = 3): { points: number[]; pressures: number[] } {
  const points: number[] = [];
  const pressures: number[] = [];
  let x = 40;
  let y = 300;
  let heading = 0;
  for (let index = 0; index < n; index += 1) {
    heading += 0.012 + Math.sin(index * 0.03) * 0.004;
    x += Math.cos(heading) * step + Math.sin(index * 0.37) * 0.04 * step;
    y += Math.sin(heading) * step + Math.cos(index * 0.51) * 0.04 * step;
    points.push(x, y);
    pressures.push(0.25 + 0.7 * Math.abs(Math.sin(index * 0.004)));
  }
  return { points, pressures };
}

function planInputFor(
  n: number,
  stroke: { points: number[]; pressures: number[] },
  maxDabs: number = FX_OIL_DAB_CAP,
): FxOilPlanInput {
  return {
    points: stroke.points.slice(0, n * 2),
    pressures: stroke.pressures.slice(0, n),
    baseWidth: BASE_WIDTH,
    seed: SEED,
    maxDabs,
    // The live oil path plans with the ladder, so the identity contract is asserted on it.
    capMode: "prefix-stable-ladder-v2",
    paintBody: "oil",
    tipProfile: "bristle",
  };
}

/** Exact identity, field by field — `toEqual` would accept a `+0`/`-0` swap, this does not. */
function expectByteEqualDabs(actual: readonly FxOilDab[], expected: readonly FxOilDab[]): void {
  expect(actual.length).toBe(expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    const left = actual[index]!;
    const right = expected[index]!;
    for (const key of ["x", "y", "radiusX", "radiusY", "angleRad", "opacity"] as const) {
      if (!Object.is(left[key], right[key])) {
        throw new Error(`dab[${index}].${key}: ${String(left[key])} !== ${String(right[key])}`);
      }
    }
    if (left.bristles.length !== right.bristles.length) {
      throw new Error(
        `dab[${index}].bristles.length: ${left.bristles.length} !== ${right.bristles.length}`,
      );
    }
    for (let hair = 0; hair < right.bristles.length; hair += 1) {
      const a = left.bristles[hair]!;
      const b = right.bristles[hair]!;
      for (const key of ["offsetRatio", "radiusXRatio", "radiusYRatio", "opacity"] as const) {
        if (!Object.is(a[key], b[key])) {
          throw new Error(
            `dab[${index}].bristles[${hair}].${key}: ${String(a[key])} !== ${String(b[key])}`,
          );
        }
      }
    }
  }
}

/**
 * Walks the stroke once and reports the two appends the capped regime turns on.
 *
 * `capped` is the first append whose bed fills the budget; `climb` is the first append after it
 * where the count DROPS, which is the ladder coarsening its spacing by a rung. A binary search
 * cannot find either: past the cap the count is not monotone in the point count, it saturates,
 * falls one rung and grows back. One linear scan is exact, and a small budget keeps it quick while
 * exercising the same lattice code the shipped cap does.
 */
function capBoundary(
  stroke: { points: number[]; pressures: number[] },
  maxDabs: number,
): { capped: number; climb: number } {
  let previous = 0;
  let capped = -1;
  for (let n = 2; n <= stroke.pressures.length; n += 1) {
    const count = planOilBrushDabs(planInputFor(n, stroke, maxDabs)).length;
    if (capped < 0 && count >= maxDabs) capped = n;
    if (capped > 0 && count < previous) return { capped, climb: n };
    previous = count;
  }
  throw new Error("stroke never reached a ladder rung climb");
}

describe("FxOilDabPlanner", () => {
  it("matches a full replan at every single-point append on a short stroke", () => {
    const stroke = makeStroke(60);
    const planner = new FxOilDabPlanner();
    for (let n = 1; n <= 60; n += 1) {
      const input = planInputFor(n, stroke);
      expectByteEqualDabs(planner.plan(input), planOilBrushDabs(input));
    }
  });

  it("matches a full replan while growing to n=50/400/3200", () => {
    const stroke = makeStroke(3200);
    const planner = new FxOilDabPlanner();
    const checkpoints = new Set([50, 400, 3200]);
    let reuseBelowCap = 0;
    // Eight points per replan, i.e. roughly two rAFs of pointer samples.
    for (let n = 1; n <= 3200; n += 1) {
      if (n % 8 !== 0 && !checkpoints.has(n)) continue;
      const input = planInputFor(n, stroke);
      const incremental = planner.plan(input);
      if (incremental.length < FX_OIL_DAB_CAP) {
        reuseBelowCap = Math.max(reuseBelowCap, planner.reusedDabs);
      }
      if (!checkpoints.has(n)) continue;
      expectByteEqualDabs(incremental, planOilBrushDabs(input));
    }
    // Reuse actually happened below the cap — otherwise this passes on a planner that never caches.
    expect(reuseBelowCap).toBeGreaterThan(0);
  });

  it("stays byte-identical across the dab cap and the ladder rung above it", () => {
    // A 512-dab budget puts the cap and the rung above it a few hundred appends in rather than
    // eight thousand, so every append in the interesting window can be checked individually. The
    // lattice code under test is the shipped one; only the budget is smaller.
    const PROBE_CAP = 512;
    const stroke = makeStroke(4000, 0.8);
    const { capped, climb } = capBoundary(stroke, PROBE_CAP);
    expect(planOilBrushDabs(planInputFor(capped - 1, stroke, PROBE_CAP)).length)
      .toBe(PROBE_CAP - 1);
    expect(planOilBrushDabs(planInputFor(capped, stroke, PROBE_CAP)).length).toBe(PROBE_CAP);
    expect(climb).toBeGreaterThan(capped);

    const planner = new FxOilDabPlanner();
    for (let n = 1; n <= climb + 2; n += 1) {
      const input = planInputFor(n, stroke, PROBE_CAP);
      const incremental = planner.plan(input);
      expectByteEqualDabs(incremental, planOilBrushDabs(input));
    }

    // The rung climb re-spaces the whole arc, so that one append has nothing to reuse — the
    // verifier must find nothing rather than trust a prefix that no longer holds.
    const rebuild = new FxOilDabPlanner();
    rebuild.plan(planInputFor(climb - 1, stroke, PROBE_CAP));
    rebuild.plan(planInputFor(climb, stroke, PROBE_CAP));
    expect(rebuild.reusedDabs).toBe(0);

    // Every other append past the cap keeps its prefix, which is the whole point of the ladder:
    // the arc-proportional refit it replaces moved every station on every append, so the bed — and
    // the entire carrier built on top of it — was rebuilt from scratch for the rest of the stroke.
    rebuild.plan(planInputFor(climb + 1, stroke, PROBE_CAP));
    expect(rebuild.reusedDabs).toBeGreaterThan(PROBE_CAP / 2);
  });

  it("keeps the ribbon carrier plan identical, including the impasto relief lanes", () => {
    const stroke = makeStroke(900);
    const planner = new FxOilDabPlanner();
    const programs = studioOilRibbonProgramsForBrush("oil", SEED);
    for (let n = 1; n <= 900; n += 1) planner.plan(planInputFor(n, stroke));
    const input = planInputFor(900, stroke);
    expect(planStudioOilRibbonCarrier(planner.plan(input), programs))
      .toEqual(planStudioOilRibbonCarrier(planOilBrushDabs(input), programs));
  });

  it("voids the cache when a settings input changes mid-stroke", () => {
    const stroke = makeStroke(200);
    const planner = new FxOilDabPlanner();
    planner.plan(planInputFor(200, stroke));
    const widened = { ...planInputFor(200, stroke), baseWidth: BASE_WIDTH * 2 };
    expectByteEqualDabs(planner.plan(widened), planOilBrushDabs(widened));
    expect(planner.reusedDabs).toBe(0);
  });
});
