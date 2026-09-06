/**
 * Append-identity contract for `StudioOilBristleLoadDynamicsPlanner`.
 *
 * The load-dynamics march is strictly causal: station k reads `pressures[k]`, `speeds[k]` and the
 * state station k-1 left behind, and never looks ahead. That is what lets a live oil stroke resume
 * the march instead of re-running it from station 0 on every pointer frame — measured at 3.35 ms
 * per move on a 4096-station bed, paid again on the very next move.
 *
 * The whole value of that is that it changes NOTHING, so what is pinned here is byte equality with
 * `planStudioOilBristleLoadDynamics` at every step of a growing stroke, plus the cases where the
 * planner must refuse to resume: a series that is no longer station-length (`sampleSeries` holds a
 * short series at its last value, which would make a marched station read a moving number), a
 * changed dial, and a shrinking or replaced stroke.
 */
import { describe, expect, it } from "vitest";

import {
  StudioOilBristleLoadDynamicsPlanner,
  planStudioOilBristleLoadDynamics,
  type StudioOilBristleLoadDynamicsInput,
  type StudioOilBristleLoadDynamicsPlan,
} from "./studio-oil-bristle-load-dynamics-v1";

const LANE_COUNT = 11;
const SEED = 9137;

function pressures(count: number): number[] {
  return Array.from(
    { length: count },
    (_, index) => 0.18 + 0.62 * Math.abs(Math.sin(index / 43 + 0.7)),
  );
}

function speeds(count: number): number[] {
  return Array.from(
    { length: count },
    (_, index) => 0.5 + 0.5 * Math.sin(index / 29),
  );
}

function inputAt(
  stationCount: number,
  extra: Partial<StudioOilBristleLoadDynamicsInput> = {},
): StudioOilBristleLoadDynamicsInput {
  return {
    stationCount,
    laneCount: LANE_COUNT,
    seed: SEED,
    pressures: pressures(stationCount),
    ...extra,
  };
}

function expectSamePlan(
  actual: StudioOilBristleLoadDynamicsPlan,
  expected: StudioOilBristleLoadDynamicsPlan,
): void {
  expect(actual.version).toBe(expected.version);
  expect(actual.stationCount).toBe(expected.stationCount);
  expect(actual.laneCount).toBe(expected.laneCount);
  expect([...actual.laneFilmStrength]).toEqual([...expected.laneFilmStrength]);
  expect([...actual.footprintScale]).toEqual([...expected.footprintScale]);
  expect([...actual.laneReservoir]).toEqual([...expected.laneReservoir]);
  expect([...actual.laneCapacity]).toEqual([...expected.laneCapacity]);
}

/** What the carrier passes: the station prefix an append cannot have changed. */
function settledFor(stationCount: number): number {
  return Math.max(0, stationCount - 8);
}

describe("StudioOilBristleLoadDynamicsPlanner", () => {
  it("matches the batch plan at every step of a growing stroke", () => {
    const planner = new StudioOilBristleLoadDynamicsPlanner();
    for (let stationCount = 2; stationCount <= 260; stationCount += 1) {
      const input = inputAt(stationCount);
      expectSamePlan(
        planner.plan(input, settledFor(stationCount)),
        planStudioOilBristleLoadDynamics(input),
      );
    }
  });

  it("matches the batch plan with explicit speeds and the dials moved", () => {
    const planner = new StudioOilBristleLoadDynamicsPlanner();
    for (let stationCount = 2; stationCount <= 180; stationCount += 1) {
      const input = inputAt(stationCount, {
        speeds: speeds(stationCount),
        initialLoad: 0.55,
        depletionRate: 2.75,
      });
      expectSamePlan(
        planner.plan(input, settledFor(stationCount)),
        planStudioOilBristleLoadDynamics(input),
      );
    }
  });

  it("refuses to resume when a series is shorter than the stroke", () => {
    // `sampleSeries` holds a short series at its last value, so station 40 reads a different
    // number once the stroke reaches 90 stations. Reuse here would be silently wrong.
    const planner = new StudioOilBristleLoadDynamicsPlanner();
    const held = pressures(30);
    for (const stationCount of [40, 60, 90, 140]) {
      const input: StudioOilBristleLoadDynamicsInput = {
        stationCount,
        laneCount: LANE_COUNT,
        seed: SEED,
        pressures: held,
      };
      expectSamePlan(
        planner.plan(input, settledFor(stationCount)),
        planStudioOilBristleLoadDynamics(input),
      );
    }
  });

  it("rebuilds when the lane count, seed or a dial changes mid-stroke", () => {
    const planner = new StudioOilBristleLoadDynamicsPlanner();
    planner.plan(inputAt(120), settledFor(120));
    const variants: Partial<StudioOilBristleLoadDynamicsInput>[] = [
      { laneCount: LANE_COUNT + 3 },
      { seed: SEED + 1 },
      { initialLoad: 0.4 },
      { depletionRate: 5 },
    ];
    for (const variant of variants) {
      const input = inputAt(130, variant);
      expectSamePlan(planner.plan(input, settledFor(130)), planStudioOilBristleLoadDynamics(input));
    }
  });

  it("matches the batch plan when the stroke shrinks or is replaced", () => {
    const planner = new StudioOilBristleLoadDynamicsPlanner();
    planner.plan(inputAt(200), settledFor(200));
    for (const stationCount of [90, 40, 210]) {
      const input = inputAt(stationCount);
      expectSamePlan(
        planner.plan(input, settledFor(stationCount)),
        planStudioOilBristleLoadDynamics(input),
      );
    }
  });

  it("matches the batch plan after reset(), and on degenerate strokes", () => {
    const planner = new StudioOilBristleLoadDynamicsPlanner();
    planner.plan(inputAt(150), settledFor(150));
    planner.reset();
    const input = inputAt(160);
    expectSamePlan(planner.plan(input, settledFor(160)), planStudioOilBristleLoadDynamics(input));

    for (const degenerate of [
      { stationCount: 0, laneCount: LANE_COUNT, seed: SEED },
      { stationCount: 10, laneCount: 0, seed: SEED },
    ] satisfies StudioOilBristleLoadDynamicsInput[]) {
      expectSamePlan(
        planner.plan(degenerate, 0),
        planStudioOilBristleLoadDynamics(degenerate),
      );
    }
  });

  it("actually resumes — otherwise every case above passes trivially", () => {
    // Convicts the reuse itself: a resumed frame must not re-march the settled prefix. The proxy
    // is that mutating the already-settled part of the pressure journal AFTER the planner has
    // marched it leaves the settled rows alone, while the batch planner picks the change up.
    const planner = new StudioOilBristleLoadDynamicsPlanner();
    const journal = pressures(200);
    planner.plan({ stationCount: 200, laneCount: LANE_COUNT, seed: SEED, pressures: journal }, 192);

    const grown = [...journal, ...pressures(210).slice(200)];
    grown[10] = 0.99;
    const resumed = planner.plan(
      { stationCount: 210, laneCount: LANE_COUNT, seed: SEED, pressures: grown },
      192,
    );
    const batch = planStudioOilBristleLoadDynamics({
      stationCount: 210,
      laneCount: LANE_COUNT,
      seed: SEED,
      pressures: grown,
    });
    expect(resumed.footprintScale[10]).not.toBe(batch.footprintScale[10]);
    expect(resumed.footprintScale[10]).toBe(
      planStudioOilBristleLoadDynamics({
        stationCount: 210,
        laneCount: LANE_COUNT,
        seed: SEED,
        pressures: journal.concat(pressures(210).slice(200)),
      }).footprintScale[10],
    );
  });
});
