import { describe, expect, it } from "vitest";

import {
  planStudioBristlePhysicsOil,
  STUDIO_BRISTLE_PHYSICS_OIL_BRISTLE_RANGE,
  STUDIO_BRISTLE_PHYSICS_OIL_DEFAULT_BRISTLE_COUNT,
  STUDIO_BRISTLE_PHYSICS_OIL_V1_VERSION,
  type StudioBristlePhysicsOilPlan,
} from "./studio-bristle-physics-oil-v1";

const LANE_COUNT = 7;
const STATION_COUNT = 240;

function straightPath(count = STATION_COUNT): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < count; index += 1) {
    xs.push(index * 1.8);
    ys.push(40);
  }
  return { xs, ys };
}

/** Symmetric pressure triangle 0.15 → 0.9 → 0.15 for reversal gates. */
function trianglePressures(count = STATION_COUNT): number[] {
  const half = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const t = 1 - Math.abs(index - half) / half;
    return 0.15 + 0.75 * t;
  });
}

function planWith(
  overrides: Partial<Parameters<typeof planStudioBristlePhysicsOil>[0]> = {},
): StudioBristlePhysicsOilPlan {
  const { xs, ys } = straightPath();
  return planStudioBristlePhysicsOil({
    stationXs: xs,
    stationYs: ys,
    laneCount: LANE_COUNT,
    seed: 41,
    baseRadiusPx: 9,
    pressures: trianglePressures(),
    ...overrides,
  });
}

function laneSeries(plan: StudioBristlePhysicsOilPlan, lane: number): number[] {
  const series: number[] = [];
  for (let station = 0; station < plan.stationCount; station += 1) {
    series.push(Math.abs(plan.laneOffsetRatio[station * plan.laneCount + lane]!));
  }
  return series;
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < n; index += 1) {
    meanA += a[index]!;
    meanB += b[index]!;
  }
  meanA /= n;
  meanB /= n;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < n; index += 1) {
    const da = a[index]! - meanA;
    const db = b[index]! - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator > 1e-12 ? covariance / denominator : 0;
}

function meanPairwiseLaneCorrelation(plan: StudioBristlePhysicsOilPlan): number {
  const series = Array.from({ length: plan.laneCount }, (_, lane) => laneSeries(plan, lane));
  let total = 0;
  let pairs = 0;
  for (let a = 0; a < plan.laneCount; a += 1) {
    for (let b = a + 1; b < plan.laneCount; b += 1) {
      total += pearson(series[a]!, series[b]!);
      pairs += 1;
    }
  }
  return pairs > 0 ? total / pairs : 0;
}

function mean(values: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index]!;
  return values.length > 0 ? total / values.length : 0;
}

describe("planStudioBristlePhysicsOil — contract", () => {
  it("produces correctly sized, bounded streams and is deterministic per seed", () => {
    const first = planWith({ seed: 77 });
    const second = planWith({ seed: 77 });
    const other = planWith({ seed: 78 });

    expect(first.version).toBe(STUDIO_BRISTLE_PHYSICS_OIL_V1_VERSION);
    expect(first.stationCount).toBe(STATION_COUNT);
    expect(first.laneCount).toBe(LANE_COUNT);
    expect(first.bristleCount).toBe(STUDIO_BRISTLE_PHYSICS_OIL_DEFAULT_BRISTLE_COUNT);
    expect(first.laneOffsetRatio.length).toBe(STATION_COUNT * LANE_COUNT);
    expect(first.laneLoadMultiplier.length).toBe(STATION_COUNT * LANE_COUNT);
    expect(first.laneWidthScale.length).toBe(STATION_COUNT * LANE_COUNT);
    expect(first.spread.length).toBe(STATION_COUNT);

    for (let index = 0; index < first.laneOffsetRatio.length; index += 1) {
      expect(Math.abs(first.laneOffsetRatio[index]!)).toBeLessThanOrEqual(0.92);
      expect(first.laneLoadMultiplier[index]!).toBeGreaterThanOrEqual(0);
      expect(first.laneLoadMultiplier[index]!).toBeLessThanOrEqual(1.6);
      expect(first.laneWidthScale[index]!).toBeGreaterThanOrEqual(0.4);
      expect(first.laneWidthScale[index]!).toBeLessThanOrEqual(2.2);
    }

    expect(Array.from(second.laneOffsetRatio)).toEqual(Array.from(first.laneOffsetRatio));
    expect(Array.from(second.laneLoadMultiplier)).toEqual(Array.from(first.laneLoadMultiplier));
    expect(Array.from(second.laneWidthScale)).toEqual(Array.from(first.laneWidthScale));
    // A different tuft seed lays out different hairs → different trajectories.
    expect(Array.from(other.laneOffsetRatio)).not.toEqual(Array.from(first.laneOffsetRatio));
  });

  it("orders lanes across the tuft like the carrier does (lane 0 left of last lane)", () => {
    const plan = planWith();
    const midStation = Math.floor(STATION_COUNT / 2) * LANE_COUNT;
    expect(plan.laneOffsetRatio[midStation]!)
      .toBeLessThan(plan.laneOffsetRatio[midStation + LANE_COUNT - 1]!);
  });

  it("normalizes malformed input without throwing and clamps bristleCount into 16..32", () => {
    expect(planWith({ bristleCount: 4 }).bristleCount)
      .toBe(STUDIO_BRISTLE_PHYSICS_OIL_BRISTLE_RANGE.min);
    expect(planWith({ bristleCount: 64 }).bristleCount)
      .toBe(STUDIO_BRISTLE_PHYSICS_OIL_BRISTLE_RANGE.max);
    expect(planWith({ bristleCount: Number.NaN }).bristleCount)
      .toBe(STUDIO_BRISTLE_PHYSICS_OIL_DEFAULT_BRISTLE_COUNT);

    const empty = planStudioBristlePhysicsOil({
      stationXs: [],
      stationYs: [],
      laneCount: LANE_COUNT,
      seed: 1,
      baseRadiusPx: 9,
    });
    expect(empty.stationCount).toBe(0);
    expect(empty.laneOffsetRatio.length).toBe(0);

    // Garbage seeds/pressures/tilt normalize instead of tripping sim validation.
    const garbage = planWith({
      seed: -12.7,
      baseRadiusPx: Number.NaN,
      pressures: [Number.NaN, 2, -1],
      tiltX: 9,
      tiltY: Number.NaN,
      initialLoad: 7,
    });
    expect(garbage.stationCount).toBe(STATION_COUNT);
    expect(Number.isFinite(mean(garbage.laneOffsetRatio))).toBe(true);
  });
});

describe("planStudioBristlePhysicsOil — hand-feel physics", () => {
  it("shows hysteresis on pressure reversal: unloading lags loading", () => {
    const plan = planWith({ speeds: Array.from({ length: STATION_COUNT }, () => 0.2) });
    const half = Math.floor(STATION_COUNT / 2);
    // Compare mirrored stations away from the apex/tails (same commanded pressure).
    const gaps: number[] = [];
    for (let index = Math.floor(STATION_COUNT * 0.08); index < half * 0.9; index += 1) {
      gaps.push(plan.spread[STATION_COUNT - 1 - index]! - plan.spread[index]!);
    }
    const meanGap = mean(gaps);
    expect(meanGap).toBeGreaterThan(0.02);
    // The fan geometry carries the same loop: the tuft stays open on the way down.
    // Inner lanes only — the outermost lanes ride the ±0.92 silhouette clamp at
    // full splay, which flattens their series to the clamp on both legs.
    const innerLanes = [1, 2, 4, 5];
    const widthGaps: number[] = [];
    for (const lane of innerLanes) {
      const series = laneSeries(plan, lane);
      for (let index = Math.floor(STATION_COUNT * 0.08); index < half * 0.9; index += 1) {
        widthGaps.push(series[STATION_COUNT - 1 - index]! - series[index]!);
      }
    }
    expect(mean(widthGaps)).toBeGreaterThan(0);
  });

  it("decorrelates lane offsets at speed (clump split + hair lift) and thins deposit", () => {
    const slow = planWith({ speeds: Array.from({ length: STATION_COUNT }, () => 0.06) });
    const fast = planWith({ speeds: Array.from({ length: STATION_COUNT }, () => 0.95) });

    expect(mean(fast.splitDrive)).toBeGreaterThan(mean(slow.splitDrive) + 0.05);

    const slowCorrelation = meanPairwiseLaneCorrelation(slow);
    const fastCorrelation = meanPairwiseLaneCorrelation(fast);
    expect(fastCorrelation).toBeLessThan(slowCorrelation - 0.05);

    // Lift-off at speed drops lane deposit below the slow stroke's.
    expect(mean(fast.laneLoadMultiplier)).toBeLessThan(mean(slow.laneLoadMultiplier));
  });

  it("depletes per-hair reservoirs along a long pull into dry-brush streaks", () => {
    const count = 2_048;
    const xs = Array.from({ length: count }, (_, index) => index * 1.8);
    const ys = Array.from({ length: count }, () => 0);
    const plan = planStudioBristlePhysicsOil({
      stationXs: xs,
      stationYs: ys,
      laneCount: LANE_COUNT,
      seed: 9,
      baseRadiusPx: 9,
      pressures: Array.from({ length: count }, () => 0.85),
    });
    // Ink monotonically drains…
    expect(plan.inkRatio[count - 1]!).toBeLessThan(plan.inkRatio[0]! - 0.2);
    // …and the drained tail deposits visibly less than the loaded head.
    const head = mean(Array.from(plan.laneLoadMultiplier.subarray(0, 64 * LANE_COUNT)));
    const tail = mean(Array.from(
      plan.laneLoadMultiplier.subarray((count - 64) * LANE_COUNT),
    ));
    expect(tail).toBeLessThan(head * 0.8);
  });
});
