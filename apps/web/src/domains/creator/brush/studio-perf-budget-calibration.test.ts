import { describe, expect, it } from "vitest";

import {
  measureStudioPerfCalibrationMs,
  STUDIO_PERF_CALIBRATION_MAX_SLOWDOWN,
  STUDIO_PERF_CALIBRATION_MIN_SIBLING_MS,
  STUDIO_PERF_CALIBRATION_REFERENCE_MS,
  studioCalibratedBudgetMs,
  studioPerfCalibrationWorkload,
  studioPerfRatioBudgetMs,
  studioPerfSustainedCalibrationWorkload,
  studioRatioBudgetFromSiblingMs,
} from "./studio-perf-budget-calibration";

/**
 * Calibration costs recorded on real machines, so the scaling rule is judged against measurements
 * rather than only against round numbers.
 *
 * `REFERENCE_CONTAINER` is the cloud dev container the budgets in this directory are recorded on
 * (min-of-7, three rounds: 2.3116 / 2.3108 / 2.2994ms). `LOADED_CONTAINER` is that same container
 * with the rest of the suite running beside it, where the 2000-station impasto plan reads 32.5ms
 * instead of its isolated 20.7ms — the case the old absolute budgets could not survive.
 */
const REFERENCE_CONTAINER_MS = 2.3;
const LOADED_CONTAINER_MS = 3.6;

describe("studioCalibratedBudgetMs", () => {
  it("leaves a recorded budget alone on the machine it was recorded on", () => {
    expect(studioCalibratedBudgetMs(60, REFERENCE_CONTAINER_MS)).toBeCloseTo(60, 6);
  });

  it("widens the budget in proportion to how much slower the machine measures", () => {
    // The whole point: a machine 1.57x slower gets 1.57x the budget, so the gate keeps asking
    // "is this code slow?" instead of "is this runner fast?".
    expect(studioCalibratedBudgetMs(60, LOADED_CONTAINER_MS)).toBeCloseTo(
      60 * (LOADED_CONTAINER_MS / REFERENCE_CONTAINER_MS),
      6,
    );
  });

  it("TIGHTENS the budget on a machine faster than the reference", () => {
    // No lower clamp, deliberately. This is what makes calibration stronger than the
    // `process.env.CI ? loose : strict` branches it replaces, which gave the busiest machines the
    // loosest gate. A runner twice as fast must clear half the budget.
    expect(studioCalibratedBudgetMs(200, REFERENCE_CONTAINER_MS / 2)).toBeCloseTo(100, 6);
  });

  it("refuses to scale past the clamp, so a starved machine cannot dissolve the gate", () => {
    const absurd = REFERENCE_CONTAINER_MS * 1_000;
    expect(studioCalibratedBudgetMs(60, absurd)).toBe(
      60 * STUDIO_PERF_CALIBRATION_MAX_SLOWDOWN,
    );
  });

  it("falls back to the strict recorded budget when the calibration did not measure", () => {
    // An unmeasurable machine gets the strict gate, never an infinite one.
    for (const unusable of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(studioCalibratedBudgetMs(60, unusable)).toBe(60);
    }
    expect(studioCalibratedBudgetMs(60, REFERENCE_CONTAINER_MS, 0)).toBe(60);
  });
});

describe("synthetic regressions still fail every calibrated budget", () => {
  /**
   * The property that matters. Calibration must absorb machine speed WITHOUT absorbing a
   * regression, and those are only separable because the calibration workload shares no code with
   * the budgeted path: a 2x-slower planner leaves `Math.sqrt` exactly as fast as it was.
   *
   * So the two are swept independently here — for every machine speed from twice as fast as the
   * reference to the clamp, a 2x regression in the measured path must still be rejected.
   */
  it("rejects a 2x regression at every machine speed the clamp admits", () => {
    const recordedBudgetMs = 60;
    // Healthy cost on the reference machine, with the margin the budget is recorded with.
    const healthyAtReferenceMs = 48;
    for (const slowdown of [0.5, 0.75, 1, 1.25, 1.57, 2, 3, STUDIO_PERF_CALIBRATION_MAX_SLOWDOWN]) {
      const calibrationMs = REFERENCE_CONTAINER_MS * slowdown;
      const budget = studioCalibratedBudgetMs(recordedBudgetMs, calibrationMs);

      // Healthy code scales with the machine and stays inside the budget...
      expect(healthyAtReferenceMs * slowdown, `healthy at x${slowdown}`).toBeLessThan(budget);
      // ...while a 2x regression scales with the machine too and is still caught.
      expect(healthyAtReferenceMs * 2 * slowdown, `2x regression at x${slowdown}`)
        .toBeGreaterThanOrEqual(budget);
    }
  });

  it("catches a regression that a machine-speed excuse would otherwise cover", () => {
    // The failure mode a naive "just raise the number" fix creates: code 2x slower on a machine
    // that is itself 1.57x slower reads as 3.1x the recorded budget. Raising the constant to admit
    // the machine admits the regression with it; scaling by the calibration does not.
    const measuredMs = 48 * 2 * (LOADED_CONTAINER_MS / REFERENCE_CONTAINER_MS);
    expect(measuredMs).toBeGreaterThan(60 * 1.57); // a raised absolute budget would pass this
    expect(measuredMs).toBeGreaterThanOrEqual(
      studioCalibratedBudgetMs(60, LOADED_CONTAINER_MS),
    );
  });
});

describe("the live calibration measurement", () => {
  it("is stable enough to divide by", () => {
    // A denominator is only usable if repeating it agrees with itself. The recorded spread on the
    // reference container is 0.5%; this asserts the far looser property that two back-to-back
    // measurements on ANY machine land within 2x, which is what the clamp assumes.
    const first = measureStudioPerfCalibrationMs();
    const second = measureStudioPerfCalibrationMs();
    expect(first).toBeGreaterThan(0);
    expect(Number.isFinite(first)).toBe(true);
    const ratio = Math.max(first, second) / Math.min(first, second);
    expect(ratio).toBeLessThan(2);
  });

  it("does real work that cannot be optimised away", () => {
    const accumulator = studioPerfCalibrationWorkload();
    expect(Number.isFinite(accumulator)).toBe(true);
    expect(accumulator).toBeGreaterThan(0);
    // Deterministic: same input, same total, so the workload cannot drift into a different cost.
    expect(studioPerfCalibrationWorkload()).toBe(accumulator);
  });

  it("keeps the recorded reference in the range this machine class actually measures", () => {
    // Guards the reference constant against silent drift: it is a recorded measurement, and if no
    // machine in the fleet lands within the clamp of it the budgets it scales are meaningless.
    expect(STUDIO_PERF_CALIBRATION_REFERENCE_MS).toBeGreaterThan(0);
    const measured = measureStudioPerfCalibrationMs();
    expect(measured / STUDIO_PERF_CALIBRATION_REFERENCE_MS).toBeLessThan(
      STUDIO_PERF_CALIBRATION_MAX_SLOWDOWN,
    );
  });
});

/**
 * The sibling/duration-matched form, for budgets the short synthetic workload cannot calibrate.
 * Both limits it works around were measured on the reference container under 8 competing CPU hogs
 * and are recorded in the module's docstrings; these tests pin the mechanics.
 */
describe("studioPerfRatioBudgetMs", () => {
  it("scales the recorded ratio by the sibling's measured cost", () => {
    // A sibling that measures ~0 would divide the gate away, so the contract is simply
    // budget = ratio x sibling: a sibling twice as slow buys twice the budget, and nothing else.
    //
    // Pinned against the pure half, EXACTLY. Timing it instead meant measuring the same sibling
    // twice, non-interleaved, and asserting the two readings agreed within 1.5-2.5x; under
    // contention they do not (12.18 and 0.258 were both recorded here), so that form graded the
    // machine rather than the rule. Nothing is weakened by moving it: the rule now has to hold
    // for every sibling cost, not just the one this run happened to measure.
    expect(studioRatioBudgetFromSiblingMs(2, 3)).toBe(6);
    expect(studioRatioBudgetFromSiblingMs(1, 3)).toBe(3);
    expect(studioRatioBudgetFromSiblingMs(2, 3) / studioRatioBudgetFromSiblingMs(1, 3)).toBe(2);
    // A sibling twice as slow buys twice the budget, at any ratio.
    expect(studioRatioBudgetFromSiblingMs(0.034, 400)).toBeCloseTo(13.6, 10);
    expect(studioRatioBudgetFromSiblingMs(0.034, 800)).toBeCloseTo(27.2, 10);
    // And the live form still measures a real sibling and produces a usable number.
    const budget = studioPerfRatioBudgetMs(2, () => studioPerfCalibrationWorkload(), 2);
    expect(budget).toBeGreaterThan(0);
    expect(Number.isFinite(budget)).toBe(true);
  });

  it("refuses to gate below the sibling floor, whatever the ratio", () => {
    // Below the floor a reading is timer resolution, not machine speed, and multiplying it would
    // manufacture a failure in code that never regressed.
    expect(studioRatioBudgetFromSiblingMs(2, STUDIO_PERF_CALIBRATION_MIN_SIBLING_MS / 2))
      .toBe(Number.POSITIVE_INFINITY);
    expect(studioRatioBudgetFromSiblingMs(2, Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(studioRatioBudgetFromSiblingMs(2, Number.POSITIVE_INFINITY))
      .toBe(Number.POSITIVE_INFINITY);
    // Exactly at the floor it still gates -- the floor is a minimum, not an exclusive bound.
    expect(studioRatioBudgetFromSiblingMs(2, STUDIO_PERF_CALIBRATION_MIN_SIBLING_MS))
      .toBeCloseTo(2 * STUDIO_PERF_CALIBRATION_MIN_SIBLING_MS, 10);
  });

  it("refuses to gate at all rather than gate on an unmeasurable sibling", () => {
    // A sibling that cannot be timed yields no budget instead of a zero one: a broken calibration
    // must not manufacture a failure in code that never regressed.
    expect(studioPerfRatioBudgetMs(1.85, () => undefined, 1)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("honours a small sample count, because the sustained workload is expensive", () => {
    const startedAt = performance.now();
    studioPerfRatioBudgetMs(1.4, () => studioPerfCalibrationWorkload(), 1);
    // One warm-up plus one sample of a ~2ms workload; far under the default five.
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});

describe("studioPerfSustainedCalibrationWorkload", () => {
  it("does real, deterministic work at the duration it exists to match", () => {
    const first = studioPerfSustainedCalibrationWorkload();
    expect(Number.isFinite(first)).toBe(true);
    expect(first).toBeGreaterThan(0);
    // Deterministic, so its cost cannot drift into a different denominator.
    expect(studioPerfSustainedCalibrationWorkload()).toBe(first);
  });

  it("is a repeat of the base workload, not a different computation", () => {
    // Staying a repeat is what keeps it independent of every measured path while sharing their
    // exposure to preemption. The accumulator makes that exact: N identical passes sum to N x one.
    const base = studioPerfCalibrationWorkload();
    expect(studioPerfSustainedCalibrationWorkload() / base).toBeCloseTo(90, 6);
  });

  it("runs long enough to be descheduled like the code it calibrates", () => {
    // The whole point of this workload is duration: a ~2ms sibling completes inside one scheduler
    // quantum and so cannot track a busy machine, which is what the +925% figure above records.
    const startedAt = performance.now();
    studioPerfSustainedCalibrationWorkload();
    expect(performance.now() - startedAt).toBeGreaterThan(20);
  });
});
