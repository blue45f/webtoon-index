/**
 * Append-identity contract for `StudioBristlePhysicsOilPlanner`.
 *
 * The tuft march is strictly causal: station k reads its own sample plus the state station k-1
 * left behind, and never looks ahead. The one input that was not per-station is `baseRadiusPx`,
 * and the ribbon carrier now freezes it, so a live oil stroke can resume the simulation rather
 * than re-running the hairs it has already drawn — the thing that made a long `oil` sweep degrade
 * as it grew.
 *
 * The whole value of that is that it changes NOTHING, so what is pinned here is byte equality with
 * `planStudioBristlePhysicsOil` at every step of a growing stroke, plus the cases where the
 * planner must refuse to resume: a series that no longer spans the stroke (`sampleSeries` holds a
 * short one at its last value), a moved anchor, tilt or dial, and a shrinking stroke.
 */
import { describe, expect, it } from "vitest";

import {
  StudioBristlePhysicsOilPlanner,
  planStudioBristlePhysicsOil,
  type StudioBristlePhysicsOilInput,
  type StudioBristlePhysicsOilPlan,
} from "./studio-bristle-physics-oil-v1";

const LANE_COUNT = 9;
const SEED = 24601;

function stationXs(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 60 + index * 1.7 + Math.sin(index / 23) * 14);
}
function stationYs(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 200 + Math.cos(index / 31) * 46);
}
function pressures(count: number): number[] {
  return Array.from({ length: count }, (_, index) => 0.2 + 0.6 * Math.abs(Math.sin(index / 37)));
}

function inputAt(
  stationCount: number,
  extra: Partial<StudioBristlePhysicsOilInput> = {},
): StudioBristlePhysicsOilInput {
  return {
    stationXs: stationXs(stationCount),
    stationYs: stationYs(stationCount),
    laneCount: LANE_COUNT,
    seed: SEED,
    baseRadiusPx: 9.5,
    pressures: pressures(stationCount),
    ...extra,
  };
}

function expectSamePlan(
  actual: StudioBristlePhysicsOilPlan,
  expected: StudioBristlePhysicsOilPlan,
): void {
  expect(actual.stationCount).toBe(expected.stationCount);
  expect(actual.laneCount).toBe(expected.laneCount);
  expect(actual.bristleCount).toBe(expected.bristleCount);
  expect([...actual.laneOffsetRatio]).toEqual([...expected.laneOffsetRatio]);
  expect([...actual.laneLoadMultiplier]).toEqual([...expected.laneLoadMultiplier]);
  expect([...actual.laneWidthScale]).toEqual([...expected.laneWidthScale]);
  expect([...actual.spread]).toEqual([...expected.spread]);
  expect([...actual.splitDrive]).toEqual([...expected.splitDrive]);
  expect([...actual.inkRatio]).toEqual([...expected.inkRatio]);
}

/** What the carrier passes: the station prefix an append cannot have changed. */
const settledFor = (stationCount: number): number => Math.max(0, stationCount - 8);

describe("StudioBristlePhysicsOilPlanner", () => {
  it("matches the batch plan at every step of a growing stroke", () => {
    const planner = new StudioBristlePhysicsOilPlanner();
    for (let stationCount = 2; stationCount <= 220; stationCount += 1) {
      const input = inputAt(stationCount);
      expectSamePlan(planner.plan(input, settledFor(stationCount)), planStudioBristlePhysicsOil(input));
    }
  });

  it("matches the batch plan with tilt, speeds and a partial dip", () => {
    const planner = new StudioBristlePhysicsOilPlanner();
    for (let stationCount = 2; stationCount <= 160; stationCount += 1) {
      const input = inputAt(stationCount, {
        tiltX: 0.55,
        tiltY: -0.24,
        initialLoad: 0.6,
        bristleCount: 28,
        speeds: Array.from({ length: stationCount }, (_, i) => 0.4 + 0.4 * Math.sin(i / 17)),
      });
      expectSamePlan(planner.plan(input, settledFor(stationCount)), planStudioBristlePhysicsOil(input));
    }
  });

  it("refuses to resume when a series is shorter than the stroke", () => {
    const planner = new StudioBristlePhysicsOilPlanner();
    const held = pressures(25);
    for (const stationCount of [40, 70, 120]) {
      const input = inputAt(stationCount, { pressures: held });
      expectSamePlan(planner.plan(input, settledFor(stationCount)), planStudioBristlePhysicsOil(input));
    }
  });

  it("rebuilds when the anchor, lane count, seed, tilt or dial moves mid-stroke", () => {
    const planner = new StudioBristlePhysicsOilPlanner();
    planner.plan(inputAt(140), settledFor(140));
    for (const variant of [
      { baseRadiusPx: 11.25 },
      { laneCount: LANE_COUNT + 2 },
      { seed: SEED + 7 },
      { tiltX: 0.4 },
      { initialLoad: 0.35 },
      { bristleCount: 31 },
    ] satisfies Partial<StudioBristlePhysicsOilInput>[]) {
      const input = inputAt(150, variant);
      expectSamePlan(planner.plan(input, settledFor(150)), planStudioBristlePhysicsOil(input));
    }
  });

  it("matches the batch plan when the stroke shrinks, is replaced, or after reset()", () => {
    const planner = new StudioBristlePhysicsOilPlanner();
    planner.plan(inputAt(180), settledFor(180));
    for (const stationCount of [70, 30, 190]) {
      const input = inputAt(stationCount);
      expectSamePlan(planner.plan(input, settledFor(stationCount)), planStudioBristlePhysicsOil(input));
    }
    planner.reset();
    const input = inputAt(200);
    expectSamePlan(planner.plan(input, settledFor(200)), planStudioBristlePhysicsOil(input));

    for (const degenerate of [
      { stationXs: [], stationYs: [], laneCount: LANE_COUNT, seed: SEED, baseRadiusPx: 9.5 },
      { stationXs: [1, 2], stationYs: [3, 4], laneCount: 0, seed: SEED, baseRadiusPx: 9.5 },
    ] satisfies StudioBristlePhysicsOilInput[]) {
      expectSamePlan(planner.plan(degenerate, 0), planStudioBristlePhysicsOil(degenerate));
    }
  });

  it("actually resumes — otherwise every case above passes trivially", () => {
    // Convicts the reuse itself: a resumed frame must not re-simulate the settled prefix, so
    // editing the already-marched part of the journal after the fact leaves those rows alone
    // while the batch planner picks the edit up.
    const planner = new StudioBristlePhysicsOilPlanner();
    const journal = pressures(200);
    planner.plan(inputAt(200, { pressures: journal }), 192);

    const edited = [...journal, ...pressures(210).slice(200)];
    edited[12] = 0.97;
    const resumed = planner.plan(inputAt(210, { pressures: edited }), 192);
    const batch = planStudioBristlePhysicsOil(inputAt(210, { pressures: edited }));
    expect(resumed.spread[12]).not.toBe(batch.spread[12]);
    expect(resumed.spread[12]).toBe(
      planStudioBristlePhysicsOil(
        inputAt(210, { pressures: journal.concat(pressures(210).slice(200)) }),
      ).spread[12],
    );
  });
});
