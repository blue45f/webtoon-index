import { describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  planStudioOilBristleLoadDynamics,
  STUDIO_OIL_BRISTLE_DAMPING,
  STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_PROVENANCE,
  STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_V1_VERSION,
} from "./studio-oil-bristle-load-dynamics-v1";
import {
  planStudioOilRibbonCarrier,
  STUDIO_OIL_BRISTLE_WIDTH_GAUGES,
} from "./studio-oil-ribbon-carrier";

const LANES = 7;

function constantSeries(length: number, value: number): number[] {
  return Array.from({ length }, () => value);
}

function meanLaneStrengthAtStation(
  plan: ReturnType<typeof planStudioOilBristleLoadDynamics>,
  station: number,
): number {
  let sum = 0;
  for (let lane = 0; lane < plan.laneCount; lane += 1) {
    sum += plan.laneFilmStrength[station * plan.laneCount + lane]!;
  }
  return sum / plan.laneCount;
}

describe("studio oil bristle load dynamics v1", () => {
  it("carries frozen provenance and dli's 0.75 damping analog", () => {
    expect(STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_V1_VERSION).toBe(
      "studio-oil-bristle-load-dynamics-v1",
    );
    expect(Object.isFrozen(STUDIO_OIL_BRISTLE_LOAD_DYNAMICS_PROVENANCE)).toBe(true);
    expect(STUDIO_OIL_BRISTLE_DAMPING).toBe(0.75);
  });

  it("is deterministic call to call and per seed", () => {
    const input = {
      stationCount: 96,
      laneCount: LANES,
      seed: 41,
      pressures: constantSeries(96, 0.7),
      speeds: constantSeries(96, 0.6),
    };
    const first = planStudioOilBristleLoadDynamics(input);
    const second = planStudioOilBristleLoadDynamics(input);
    expect([...second.laneFilmStrength]).toEqual([...first.laneFilmStrength]);
    expect([...second.footprintScale]).toEqual([...first.footprintScale]);
    expect([...second.laneReservoir]).toEqual([...first.laneReservoir]);
    const reseeded = planStudioOilBristleLoadDynamics({ ...input, seed: 42 });
    expect([...reseeded.laneCapacity]).not.toEqual([...first.laneCapacity]);
  });

  it("maps more pressure to a wider flattened footprint and a higher deposit", () => {
    const light = planStudioOilBristleLoadDynamics({
      stationCount: 80,
      laneCount: LANES,
      seed: 7,
      pressures: constantSeries(80, 0.15),
      depletionRate: 0,
    });
    const heavy = planStudioOilBristleLoadDynamics({
      stationCount: 80,
      laneCount: LANES,
      seed: 7,
      pressures: constantSeries(80, 0.95),
      depletionRate: 0,
    });
    const tail = 79;
    expect(heavy.footprintScale[tail]!).toBeGreaterThan(light.footprintScale[tail]! * 1.2);
    expect(meanLaneStrengthAtStation(heavy, tail)).toBeGreaterThan(
      meanLaneStrengthAtStation(light, tail) * 1.5,
    );
    for (const scale of heavy.footprintScale) expect(scale).toBeGreaterThanOrEqual(1);
  });

  it("lags pressure steps with 0.75 momentum instead of snapping (손맛 hysteresis)", () => {
    const stations = 40;
    const pressures = constantSeries(stations, 0);
    for (let index = 10; index < stations; index += 1) pressures[index] = 1;
    const plan = planStudioOilBristleLoadDynamics({
      stationCount: stations,
      laneCount: LANES,
      seed: 3,
      pressures,
      depletionRate: 0,
    });
    const atStep = plan.footprintScale[10]!;
    const twoAfter = plan.footprintScale[12]!;
    const settled = plan.footprintScale[stations - 1]!;
    // First response carries only (1 − damping) = 25% of the step.
    expect(atStep).toBeLessThan(1 + (settled - 1) * 0.3);
    expect(twoAfter).toBeGreaterThan(atStep);
    expect(settled).toBeGreaterThan(twoAfter);
    // The film drive lags identically.
    expect(meanLaneStrengthAtStation(plan, 10)).toBeLessThan(
      meanLaneStrengthAtStation(plan, stations - 1) * 0.5,
    );
  });

  it("drains reservoirs monotonically and faster at speed (streaky depletion)", () => {
    const stations = 600;
    const base = {
      stationCount: stations,
      laneCount: LANES,
      seed: 11,
      pressures: constantSeries(stations, 0.8),
    };
    const slow = planStudioOilBristleLoadDynamics({
      ...base,
      speeds: constantSeries(stations, 0.05),
    });
    const fast = planStudioOilBristleLoadDynamics({
      ...base,
      speeds: constantSeries(stations, 1),
    });
    const reservoirTotal = (plan: typeof slow) =>
      [...plan.laneReservoir].reduce((sum, value) => sum + value, 0);
    expect(reservoirTotal(fast)).toBeLessThan(reservoirTotal(slow) * 0.75);
    for (let lane = 0; lane < LANES; lane += 1) {
      expect(fast.laneReservoir[lane]!).toBeLessThanOrEqual(fast.laneCapacity[lane]!);
      expect(fast.laneReservoir[lane]!).toBeGreaterThanOrEqual(0);
    }
    // Depletion starves the tail: film strength decays along the stroke.
    expect(meanLaneStrengthAtStation(fast, stations - 1)).toBeLessThan(
      meanLaneStrengthAtStation(fast, 20) * 0.6,
    );
    // Streaks: centre lanes starve while low-contact edge lanes still carry
    // film, so the tail's lane strengths spread apart instead of fading flat.
    const tailRow = (stations - 1) * fast.laneCount;
    const tailStrengths = [...fast.laneFilmStrength.slice(tailRow, tailRow + LANES)];
    expect(Math.max(...tailStrengths) - Math.min(...tailStrengths)).toBeGreaterThan(0.05);
    // Slow stroke keeps its film: no lane collapses early.
    expect(meanLaneStrengthAtStation(slow, stations - 1)).toBeGreaterThan(
      meanLaneStrengthAtStation(fast, stations - 1),
    );
  });

  it("returns empty frozen plans for degenerate inputs without throwing", () => {
    const empty = planStudioOilBristleLoadDynamics({
      stationCount: 0,
      laneCount: LANES,
      seed: 1,
    });
    expect(empty.laneFilmStrength).toHaveLength(0);
    expect(Object.isFrozen(empty)).toBe(true);
    const hostile = planStudioOilBristleLoadDynamics({
      stationCount: 8,
      laneCount: LANES,
      seed: Number.NaN,
      pressures: [Number.NaN, Number.POSITIVE_INFINITY, -3, 9],
      speeds: [Number.NaN],
      initialLoad: Number.NaN,
      depletionRate: Number.NaN,
    });
    for (const value of hostile.laneFilmStrength) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    for (const value of hostile.footprintScale) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("oil ribbon carrier × bristle load dynamics program flag", () => {
  const strokeDabs = () =>
    planOilBrushDabs({
      points: [0, 0, 500, 24, 1_000, -16, 1_500, 30, 2_000, 0],
      pressures: [0.85, 0.85, 0.85, 0.85, 0.85],
      baseWidth: 26,
      seed: 57,
    });

  it("keeps the legacy plan byte-identical when the flag is absent or disabled", () => {
    const dabs = strokeDabs();
    const legacy = planStudioOilRibbonCarrier(dabs);
    const withUndefinedOptions = planStudioOilRibbonCarrier(dabs, undefined);
    const withDisabledFlag = planStudioOilRibbonCarrier(dabs, {
      bristleLoadDynamics: { enabled: false, seed: 9, depletionRate: 8 },
    });
    expect(JSON.stringify(withUndefinedOptions)).toBe(JSON.stringify(legacy));
    expect(JSON.stringify(withDisabledFlag)).toBe(JSON.stringify(legacy));
  });

  it("widens loaded ridges under pressure when enabled (footprint flattening)", () => {
    const dabs = strokeDabs();
    const legacy = planStudioOilRibbonCarrier(dabs);
    const dynamic = planStudioOilRibbonCarrier(dabs, {
      bristleLoadDynamics: {
        enabled: true,
        seed: 57,
        pressures: constantSeries(dabs.length, 0.95),
        depletionRate: 0,
      },
    });
    const maxWidth = (plan: typeof legacy) =>
      Math.max(...plan.bristleLanes.map(({ lineWidth }) => lineWidth));
    expect(maxWidth(dynamic)).toBeGreaterThan(maxWidth(legacy) * 1.15);
    // The body and station structure stay owned by the legacy geometry.
    expect(JSON.stringify(dynamic.body)).toBe(JSON.stringify(legacy.body));
    expect(dynamic.bodyOpacity).toBe(legacy.bodyOpacity);
    expect(dynamic.sourceStationCount).toBe(legacy.sourceStationCount);
  });

  it("starves the stroke tail into the dry band under fast depletion (갈필)", () => {
    const dabs = strokeDabs();
    const dynamic = planStudioOilRibbonCarrier(dabs, {
      bristleLoadDynamics: {
        enabled: true,
        seed: 57,
        pressures: constantSeries(dabs.length, 0.85),
        speeds: constantSeries(dabs.length, 1),
        depletionRate: 1,
      },
    });
    const legacy = planStudioOilRibbonCarrier(dabs);
    const strokeMidX = 1_000;
    // 갈필 has two visible halves — the tail lays FEWER marks and the marks it does lay are
    // LIGHTER — so both are measured, per half, weighted by stations.
    //
    // Runs are counted ONCE each, keyed by geometry, because lanes are cumulative shells: a run in
    // load band m is repainted by shells 0..m, so walking `lane.runs` naively counts a loaded run
    // m+1 times. A run's band is the highest `loadBand` among the shells carrying it — the
    // innermost shell it survives into. Stations, not runs: consecutive runs of one hair that stay
    // in the same band are welded into one furrow, so a furrow can begin in the head and deposit
    // right through the tail, and counting whole runs by their first x credits the tail's paint to
    // the head.
    const halfStats = (plan: typeof legacy, tail: boolean) => {
      const bandByRun = new Map<string, number>();
      for (const lane of plan.bristleLanes) {
        for (const run of lane.runs) {
          const key = run.points.join(",");
          bandByRun.set(key, Math.max(bandByRun.get(key) ?? 0, lane.loadBand));
        }
      }
      let stations = 0;
      let bandSum = 0;
      for (const [key, band] of bandByRun) {
        const coordinates = key.split(",");
        for (let index = 0; index < coordinates.length; index += 2) {
          const x = Number.parseFloat(coordinates[index]!);
          if (tail ? x < strokeMidX : x >= strokeMidX) continue;
          stations += 1;
          bandSum += band;
        }
      }
      return { stations, meanBand: stations > 0 ? bandSum / stations : 0 };
    };
    const dynamicHead = halfStats(dynamic, false);
    const dynamicTail = halfStats(dynamic, true);
    const legacyHead = halfStats(legacy, false);
    const legacyTail = halfStats(legacy, true);
    // The tail must run out of paint: far fewer deposited stations than the head, where the legacy
    // plan — which models no reservoir at all — carries its load to the end. Measured 6504 -> 930
    // (86% down) against legacy's 7410 -> 6386 (14% down).
    const dynamicKeep = dynamicTail.stations / dynamicHead.stations;
    const legacyKeep = legacyTail.stations / legacyHead.stations;
    expect(dynamicKeep).toBeLessThan(legacyKeep * 0.5);
    expect(dynamicKeep).toBeLessThan(0.35);
    // …and what it does lay must be lighter. Legacy's mean band is flat across the stroke.
    expect(dynamicHead.meanBand - dynamicTail.meanBand)
      .toBeGreaterThan(legacyHead.meanBand - legacyTail.meanBand + 0.5);
  });

  it("stays green on the legacy contract shapes when enabled", () => {
    const dabs = strokeDabs();
    const dynamic = planStudioOilRibbonCarrier(dabs, {
      bristleLoadDynamics: { enabled: true, seed: 57 },
    });
    expect(dynamic.repeatedBodyStampCount).toBe(0);
    expect(dynamic.bristleLanes.length).toBeGreaterThan(0);
    // No upper bound on the count: lanes are cumulative load shells inside a width gauge, so the
    // count tracks the tonal resolution rather than how many passes can fold on one pixel. The
    // fold depth is the gauge count, pinned in studio-oil-ribbon-carrier.pixel.test.ts.
    expect(new Set(dynamic.bristleLanes.map(({ lineWidth }) => lineWidth)).size)
      .toBeLessThanOrEqual(STUDIO_OIL_BRISTLE_WIDTH_GAUGES);
    for (const lane of dynamic.bristleLanes) {
      expect(lane.lineWidth).toBeGreaterThan(0);
      expect(lane.opacity).toBeGreaterThanOrEqual(0);
      expect(lane.opacity).toBeLessThanOrEqual(0.96);
    }
  });
});
