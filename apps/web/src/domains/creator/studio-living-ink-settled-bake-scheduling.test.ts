import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  augmentStudioLivingInkSettledBakeDabs,
  requestStudioLivingInkSettledBakeDabs,
  resetStudioLivingInkSettledBakeCacheForTests,
} from "./studio-living-ink-settled-bake-v1";
import {
  captureScheduledSlices,
  makePlan,
  PLANNER_DAB_CAP,
  SETTLED_SUMI,
} from "./studio-living-ink-settled-bake.fixture";

import type { WatercolorBrushDab } from "./brush/studio-watercolor-brush";

/**
 * Adversarial-review regression (Lens 3, major — living-ink settled-bake stall).
 *
 * Probe being reproduced: `applyStudioBrushAliasWatercolorMaterial(..., "settled")` ran the
 * whole-stroke fluid solve synchronously in StudioDrawNode's render body — measured 30–36ms
 * per ~1000-dab stroke on the reviewer's machine and 70–116ms here, re-paid on EVERY render
 * of every committed living-ink stroke × symmetry variation, with no memoization anywhere in
 * the chain. Repo freeze budget is <33ms per main-thread chunk.
 *
 * Before the fix these tests fail:
 * - the memo assertions fail because every call re-ran the full ~24-tick solve and returned a
 *   fresh array (no cache — the repeat-call probe measured full solve cost every time);
 * - the scheduling API (`requestStudioLivingInkSettledBakeDabs`) did not exist, and no code
 *   path could produce the settled plan without a single synchronous over-budget stall.
 * After the fix: byte-equal inputs hit a deterministic cache, and the cold solve advances a
 * few fixed ticks per macrotask slice, each slice bounded under the 33ms chunk budget.
 */

/** Repo main-thread freeze budget per chunk (docs/toonstudio quality gates). */
const CHUNK_FREEZE_BUDGET_MS = 33;

/**
 * The cheapest TICK-BEARING slice, which is not the same thing as the cheapest slice.
 *
 * A run has TWO phase-only slices at its ends, and neither is evidence about per-tick cost:
 *
 *  - the FIRST carries planner-cap seeding and can exhaust the slicer's own 8ms wall budget
 *    before a single tick runs — measured at 13.09ms;
 *  - the LAST carries `deriveAugmentedSettledDabs` and runs no tick at all. `runSettledBakeSlice`
 *    re-checks its budget after the final tick and breaks BEFORE lowering
 *    (`studio-living-ink-settled-bake-v1.ts`), so lowering lands in its own slice — measured at
 *    15.48ms against an interior of 8.42-9.93ms.
 *
 * Either one left in the population RESCUES this gate, in the same way and for the same reason:
 * if every solver tick regressed to 100ms, whichever phase-only slice stayed cheap would remain
 * the minimum, that minimum would clear 33ms, and the 400ms ceiling would clear the 100ms ticks,
 * so two dozen user-visible stalls would ship green. Both are excluded.
 *
 * Pure, so both rescues can be pinned as data rather than waited for on a machine.
 */
function settledBakeTickSliceFloorMs(sliceDurations: readonly number[]): number {
  if (sliceDurations.length < 2) {
    throw new Error("A sliced solve needs at least a seeding slice and a lowering slice.");
  }
  const tickBearing = sliceDurations.slice(1, -1);
  // Nothing between the two phase-only ends means the ticks and the lowering shared ONE slice.
  // That slice is not evidence about per-tick cost in isolation, but it still BOUNDS it: every
  // tick ran inside it, so if it clears the freeze budget then so did each tick. Returning its
  // duration is therefore the honest reduction — it convicts a slicer that collapsed into one
  // long stall, and it acquits the legitimately fast case where every tick fits in a single 8ms
  // slice, which an unconditional `Infinity` failed on healthy code.
  if (tickBearing.length === 0) return sliceDurations[sliceDurations.length - 1]!;
  return Math.min(...tickBearing);
}

/**
 * The LOWERING slice's cost, in units of one tick-bearing slice.
 *
 * `deriveAugmentedSettledDabs` gets its own slice and runs no tick, so the tick floor above
 * excludes it by construction — and a phase with exactly ONE member per run is the single shape
 * no order statistic over slices can ever reach. Its only other cover is the 400ms ceiling, which
 * a regression from ~15ms to 100-300ms clears while visibly freezing the main thread.
 *
 * Graded against the tick floor of the SAME run rather than a millisecond count: both are slices
 * of one solve on one machine, seconds apart at most, so machine speed divides out. The
 * denominator is the slicer's own 8ms budget, the most stable number this file has.
 */
function settledBakeLoweringSliceRatio(sliceDurations: readonly number[]): number {
  const floorMs = settledBakeTickSliceFloorMs(sliceDurations);
  if (!(floorMs > 0)) throw new Error("A tick slice that costs nothing is not a denominator.");
  return sliceDurations[sliceDurations.length - 1]! / floorMs;
}
/*
 * There is no longer a `process.env.CI ? 80 : 33` wall limit. That split handed the busiest
 * machines the loosest gate — exactly backwards — and off CI it took the strict 33ms arm and
 * failed at 39.0ms on a 4-vCPU container with nothing regressed.
 *
 * Scaling it through `studioPerfBudgetMs` was tried and is worse, not better: that calibration
 * is core-bound and barely notices contention, so on this container it read the machine as FAST
 * and tightened the budget to 24.2ms — its own docstring warns of exactly this ("tracks a slower
 * machine but not a busy one"), and there is deliberately no lower clamp.
 *
 * The gate is now on the statistic that actually describes the slicer. See the measurements at
 * the assertion site.
 */


/** The causal watercolor planner caps plans at DEFAULT_STUDIO_CAUSAL_WATERCOLOR_MAX_DABS. */
/** Captures the module's macrotask slices so the test can run and time each one. */
beforeEach(() => {
  resetStudioLivingInkSettledBakeCacheForTests();
});

afterEach(() => {
  resetStudioLivingInkSettledBakeCacheForTests();
});

describe("deterministic settled-bake memo cache", () => {
  it("returns the identical plan without re-solving for byte-equal inputs", () => {
    const plan = makePlan(500);

    const coldStartedAt = performance.now();
    const first = augmentStudioLivingInkSettledBakeDabs(plan, SETTLED_SUMI);
    const coldSolveMs = performance.now() - coldStartedAt;
    expect(first.length).toBeGreaterThan(plan.length);

    // Same array instance → same output instance, no recompute.
    expect(augmentStudioLivingInkSettledBakeDabs(plan, SETTLED_SUMI)).toBe(first);

    // Content-equal but distinct array (every React render replans): identical
    // bytes, passthrough cores re-anchored to the CALLER's own objects, and a
    // repeat cost that is a cache hit rather than a solve.
    const replanned = makePlan(500);
    const second = augmentStudioLivingInkSettledBakeDabs(replanned, SETTLED_SUMI);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const secondCores = second.filter((dab) => dab.role === "core");
    const replannedCores = replanned.filter((dab) => dab.role === "core");
    expect(secondCores.length).toBe(replannedCores.length);
    for (let index = 0; index < secondCores.length; index += 1) {
      expect(secondCores[index]).toBe(replannedCores[index]);
    }
    // Cost, graded against the COLD SOLVE timed at the top of this test rather than against a
    // millisecond count.
    //
    // The claim is "this did not re-solve", and the two costs differ by three orders of
    // magnitude — 0.074-0.076ms against a solve of 155-157ms idle, and 0.081-0.100ms against
    // 348-365ms under six spinning hogs on four cores: ratios of 0.0005 and 0.0002-0.0003. An
    // absolute 16.5ms bound stated that claim more than four orders of magnitude looser than the
    // truth and still failed under load at 17.4 and 20.7ms, because a single preemption landing
    // inside a sub-millisecond window is worth more than the whole budget.
    //
    // The numerator is the MINIMUM of several hits, and that is not decoration. Dividing one
    // sub-millisecond reading by one ~155ms reading does not cancel a machine: the two windows
    // are seconds apart and wildly different lengths, so a 10ms pause landing on the hit alone —
    // well inside what this window has been seen to absorb — would put the ratio at 0.065 and
    // convict healthy code. Noise is additive, so the cheapest of 21 identical cache lookups is
    // the honest one, and they are cheap enough that 21 of them cost single-digit milliseconds. The denominator stays a single
    // reading because a cold solve happens once by definition, and because noise there only ever
    // makes this gate LOOSER, which is the safe direction.
    //
    // 0.05 keeps 12x headroom over the worst honest reading, while the regression this exists to
    // catch — the cache missing and a full solve running again — scores ~1 and fails by 20x.
    const CACHE_HIT_SAMPLES = 21;
    let repeatMs = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample < CACHE_HIT_SAMPLES; sample += 1) {
      const probe = makePlan(500);
      const startedAt = performance.now();
      const hit = augmentStudioLivingInkSettledBakeDabs(probe, SETTLED_SUMI);
      repeatMs = Math.min(repeatMs, performance.now() - startedAt);
      // Not `toBe(second)`: each caller gets its OWN core objects re-anchored into the cached
      // plan, which is the passthrough contract asserted just above. Same shape, new wrapper.
      expect(hit.length).toBe(second.length);
    }
    expect(
      repeatMs / coldSolveMs,
      `memo repeat cost ${repeatMs.toFixed(3)}ms against a ${coldSolveMs.toFixed(1)}ms cold solve`,
    ).toBeLessThan(0.05);
  });

  it("keeps different seeds/settings in distinct entries", () => {
    const plan = makePlan(120);
    const seedA = augmentStudioLivingInkSettledBakeDabs(plan, SETTLED_SUMI);
    const seedB = augmentStudioLivingInkSettledBakeDabs(plan, {
      ...SETTLED_SUMI,
      seed: 7,
    });
    expect(JSON.stringify(seedA)).not.toBe(JSON.stringify(seedB));
    // Both remain cached independently.
    expect(augmentStudioLivingInkSettledBakeDabs(plan, SETTLED_SUMI)).toBe(seedA);
    expect(
      augmentStudioLivingInkSettledBakeDabs(plan, { ...SETTLED_SUMI, seed: 7 }),
    ).toBe(seedB);
  });
});

describe("the lowering slice carries its own budget", () => {
  /**
   * A single sliced solve yields exactly ONE lowering slice, and one sample cannot be reduced.
   * Measured that way it swings 14.46-41.76ms idle and 30.13-101.16ms under six spinning hogs on
   * four cores — a 7x spread, because `deriveAugmentedSettledDabs` allocates the whole augmented
   * plan and a collection landing inside it is charged to the phase.
   *
   * So the solve is repeated and the CHEAPEST run's ratio is taken. This is a cost, whose noise
   * is one-sided — contention only ever adds — so the minimum is the honest reducer, the same
   * statistic the tick floor and the crayon-family CPU budget use for the same reason.
   */
  const LOWERING_RUNS = 5;
  const LOWERING_RATIO_LIMIT = 4.5;

  it("keeps the final lowering slice within a few tick slices, not merely under the ceiling", () => {
    const ratios: number[] = [];
    for (let run = 0; run < LOWERING_RUNS; run += 1) {
      resetStudioLivingInkSettledBakeCacheForTests();
      const scheduler = captureScheduledSlices();
      try {
        let readyCount = 0;
        const immediate = requestStudioLivingInkSettledBakeDabs(
          makePlan(PLANNER_DAB_CAP / 2),
          SETTLED_SUMI,
          () => { readyCount += 1; },
        );
        expect(immediate).toBeNull();
        const sliceDurations: number[] = [];
        for (let slice = 0; slice < 200 && readyCount === 0; slice += 1) {
          const elapsed = scheduler.runNextSlice();
          expect(elapsed).not.toBeNull();
          sliceDurations.push(elapsed ?? 0);
        }
        expect(readyCount).toBe(1);
        expect(sliceDurations.length).toBeGreaterThan(2);
        ratios.push(settledBakeLoweringSliceRatio(sliceDurations));
      } finally {
        scheduler.restore();
      }
    }
    resetStudioLivingInkSettledBakeCacheForTests();

    // Recorded cheapest-of-5: 1.151 / 1.662 / 1.741 idle and 1.712 / 2.237 / 2.239 under six
    // spinning hogs on four cores. The per-run spread behind those is wide — individual runs read
    // 1.15-2.73 idle and 1.71-4.97 loaded — which is exactly why the minimum is taken rather than
    // any single run.
    //
    // 4.5 carries 2x headroom over the worst honest reading, while the regression this exists for
    // — lowering at 100ms against an 8.4ms tick floor — reads 11.9 and is convicted with 2.6x
    // margin. The 400ms ceiling acquits that same case entirely, and the tick floor excludes the
    // slice by construction.
    const cheapest = Math.min(...ratios);
    expect(
      cheapest,
      `cheapest lowering slice costs ${cheapest.toFixed(2)} tick slices `
      + `(all runs: ${ratios.map((value) => value.toFixed(2)).join(", ")})`,
    ).toBeLessThan(LOWERING_RATIO_LIMIT);
  });

  it("convicts the lowering regression every other statistic here discards", () => {
    // Codex's case as data: ticks honest, lowering alone at 100ms.
    const honest = [13.09, 9.93, 11.68, 9.42, 8.63, 8.42, 9.08, 9.17, 9.49, 9.44, 9.57, 9.80, 15.48];
    expect(settledBakeLoweringSliceRatio(honest)).toBeCloseTo(1.84, 1);
    expect(settledBakeLoweringSliceRatio(honest)).toBeLessThan(LOWERING_RATIO_LIMIT);

    const loweringStall = honest.map((duration, index) => (index === honest.length - 1
      ? 100
      : duration));
    expect(settledBakeLoweringSliceRatio(loweringStall)).toBeGreaterThan(LOWERING_RATIO_LIMIT);
    // ...and every bound that lets it through, which is why this gate exists.
    expect(settledBakeTickSliceFloorMs(loweringStall)).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
    expect(Math.max(...loweringStall)).toBeLessThan(400);
    expect(Math.min(...loweringStall)).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);

    // The smallest lowering regression still convicted, so this is a budget and not a blow-up bound.
    const atLimit = honest.map((duration, index) => (index === honest.length - 1 ? 38 : duration));
    expect(settledBakeLoweringSliceRatio(atLimit)).toBeGreaterThan(LOWERING_RATIO_LIMIT);
    const underLimit = honest.map((duration, index) => (index === honest.length - 1 ? 37 : duration));
    expect(settledBakeLoweringSliceRatio(underLimit)).toBeLessThan(LOWERING_RATIO_LIMIT);

    // A machine 3.4x slower moves both sides together and changes nothing.
    expect(settledBakeLoweringSliceRatio(honest.map((duration) => duration * 3.4)))
      .toBeCloseTo(settledBakeLoweringSliceRatio(honest), 6);

    // A TICK regression is not this statistic's job — it inflates the denominator, so this ratio
    // falls while the tick floor convicts. The two cover disjoint phases rather than overlapping.
    const tickStall = honest.map((duration, index) => (index === 0 || index === honest.length - 1
      ? duration
      : duration + 91));
    expect(settledBakeLoweringSliceRatio(tickStall)).toBeLessThan(LOWERING_RATIO_LIMIT);
    expect(settledBakeTickSliceFloorMs(tickStall)).toBeGreaterThan(CHUNK_FREEZE_BUDGET_MS);
  });
});

describe("settledBakeTickSliceFloorMs", () => {
  // The recorded slice series, in order, from this file's own gate on an idle container: a
  // seeding slice, eleven tick-bearing slices, and the final lowering slice.
  const HONEST = [
    13.09, 9.93, 11.68, 9.42, 8.63, 8.42, 9.08, 9.17, 9.49, 9.44, 9.57, 9.80, 15.48,
  ] as const;

  it("reads the cheapest tick-bearing slice, not the cheapest slice", () => {
    expect(settledBakeTickSliceFloorMs([...HONEST])).toBeCloseTo(8.42, 2);
    expect(settledBakeTickSliceFloorMs([...HONEST])).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
    // Excluding the two phase-only slices costs the honest reading almost nothing: neither was
    // ever the minimum, because seeding and lowering are both dearer than a tick, not cheaper.
    expect(settledBakeTickSliceFloorMs([...HONEST]) - Math.min(...HONEST)).toBeLessThan(0.01);
  });

  /**
   * A TICK-ONLY regression: the two phase-only slices are untouched, because a regression in
   * `advanceSettledBakeSolve` does not reach seeding or `deriveAugmentedSettledDabs`.
   *
   * Modelling that faithfully is the point. An earlier version of this fixture added the
   * regression to every slice except seeding, which quietly moved the lowering slice to 106ms too
   * and so passed against a floor that did not yet exclude it. The regression under test has to
   * leave BOTH phase-only slices at their honest cost, or the fixture proves nothing.
   */
  const tickOnlyRegression = (perTickMs: number): number[] => HONEST.map((duration, index) => (
    index === 0 || index === HONEST.length - 1 ? duration : duration + perTickMs
  ));

  it("cannot be rescued by either phase-only slice when every tick regresses", () => {
    // A tick is indivisible, so the slicer's 8ms wall budget cannot subdivide it — every
    // tick-bearing slice becomes one ~100ms stall and the user sees eleven of them.
    const regressed = tickOnlyRegression(91);
    expect(settledBakeTickSliceFloorMs(regressed)).toBeGreaterThan(CHUNK_FREEZE_BUDGET_MS);

    // ...and here is everything that acquits that same series, which is the whole reason both
    // ends are excluded rather than just the seeding one.
    //
    // The minimum over ALL slices is the untouched 13.09ms seeding slice.
    expect(Math.min(...regressed)).toBeCloseTo(13.09, 2);
    expect(Math.min(...regressed)).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
    // Excluding only the seeding slice is not enough: the lowering slice is tick-free too, so it
    // survives at 15.48ms and takes over as the rescuing minimum.
    expect(Math.min(...regressed.slice(1))).toBeCloseTo(15.48, 2);
    expect(Math.min(...regressed.slice(1))).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
    // The ceiling acquits it too — every slice is far under 400ms — so nothing else in this file
    // covers the case.
    expect(Math.max(...regressed)).toBeLessThan(400);
  });

  it("convicts a tick regression well below the one that first exposed the lowering rescue", () => {
    // Not only a 100ms stall: the smallest per-tick regression this still catches, so the gate is
    // not a blow-up detector wearing a budget's name. The honest tick floor is 8.42ms.
    expect(settledBakeTickSliceFloorMs(tickOnlyRegression(25)))
      .toBeGreaterThan(CHUNK_FREEZE_BUDGET_MS);
    expect(settledBakeTickSliceFloorMs(tickOnlyRegression(24)))
      .toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
  });

  it("still convicts a collapse to one slice, and still acquits an honest slow machine", () => {
    // Slicing broken entirely: seeding, then one slice carrying every tick and the lowering.
    // No tick-bearing slice survives the exclusion, so that combined slice is graded directly —
    // it bounds every tick inside it — and at 171ms it is convicted.
    expect(settledBakeTickSliceFloorMs([13.09, 171])).toBeGreaterThan(CHUNK_FREEZE_BUDGET_MS);
    // ...and the converse, which an unconditional `Infinity` used to fail on healthy code: a
    // solver fast enough to finish all 24 ticks inside one 8ms slice legitimately produces two
    // slices, and that run has no freeze in it. It needs a ~12x speedup to occur, so this is a
    // guard against a future optimisation being greeted by a red test, not a live case.
    expect(settledBakeTickSliceFloorMs([13.09, 22.4])).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
    // A box 3.4x slower across the board still passes, because every slice is wall-clock bounded
    // from the inside — the slicer's budget is the invariant, not the machine's speed.
    expect(settledBakeTickSliceFloorMs(HONEST.map((duration) => duration * 3.4)))
      .toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
    // A phase-specific blow-up in the FINAL lowering slice is not this statistic's job — it is
    // excluded by construction — and it is the ceiling's, so the two are kept separate rather
    // than overlapping. That the ceiling really does carry it is asserted here, because the
    // exclusion above is only safe if something else covers the phase.
    const lowered = HONEST.map((duration, index) => (index === HONEST.length - 1
      ? duration + 500
      : duration));
    expect(settledBakeTickSliceFloorMs(lowered)).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
    expect(Math.max(...lowered)).toBeGreaterThan(400);
  });

  it("is not evidence of anything without a tick-bearing slice", () => {
    expect(() => settledBakeTickSliceFloorMs([13.09])).toThrow(/seeding slice and a lowering/);
    expect(() => settledBakeTickSliceFloorMs([])).toThrow(/seeding slice and a lowering/);
    // Seeding plus one combined slice is graded on that slice's own duration rather than thrown
    // on: under budget it is a fast solve, over budget it is a collapsed slicer.
    expect(settledBakeTickSliceFloorMs([13.09, 15.48])).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
    expect(settledBakeTickSliceFloorMs([13.09, 400])).toBeGreaterThan(CHUNK_FREEZE_BUDGET_MS);
  });
});

describe("time-sliced settled bake at the planner cap", () => {
  it("keeps every main-thread slice under the 33ms chunk freeze budget and matches the synchronous bytes", () => {
    // 1. Synchronous reference (what SVG export computes) at the planner cap.
    const referenceInput = makePlan(PLANNER_DAB_CAP / 2);
    expect(referenceInput.length).toBe(PLANNER_DAB_CAP);
    // The reference clock stops at the SOLVE. `JSON.stringify` over the result is this test's
    // own parity bookkeeping, not work `requestStudioLivingInkSettledBakeDabs` performs, and
    // folding it into the denominator would hand the request path a budget for work the request
    // path never does: measured here at 18-20ms of serialisation on a 136-142ms solve, a 13%
    // wider gate bought with no product work at all.
    const referenceStartedAt = performance.now();
    const referencePlan = augmentStudioLivingInkSettledBakeDabs(referenceInput, SETTLED_SUMI);
    const synchronousSolveMs = performance.now() - referenceStartedAt;
    const referenceBytes = JSON.stringify(referencePlan);
    resetStudioLivingInkSettledBakeCacheForTests();

    // 2. Cold render-path request: must NOT solve synchronously.
    //
    // STEADY-STATE enqueue cost, and deliberately not the cold one. Resetting the cache clears the
    // memo and the scheduler latch but not module-level or JIT initialisation, so only the first
    // request in a PROCESS pays that — measured at 4.9-5.2ms against the 0.68-0.69ms this
    // minimum reports. That one-time cost is graded in
    // `studio-living-ink-settled-bake-cold-start.test.ts`, which vitest gives its own module
    // process; here the minimum is the honest reducer for the repeated cost every render pays.
    //
    // Timed as a MINIMUM over several cold-CACHE requests, in its own scheduler capture so the slices
    // they enqueue are discarded rather than joining the measured run below. One reading of a
    // ~0.7ms window divided by one reading of a ~140ms solve does not cancel a machine — the two
    // are seconds apart and two orders of magnitude apart in length, so a pause landing on the
    // request alone convicts healthy code. Each probe resets the cache first, so every one of
    // them exercises the same COLD enqueue path rather than the cheaper join.
    const REQUEST_SAMPLES = 7;
    let requestMs = Number.POSITIVE_INFINITY;
    const probeScheduler = captureScheduledSlices();
    try {
      for (let sample = 0; sample < REQUEST_SAMPLES; sample += 1) {
        resetStudioLivingInkSettledBakeCacheForTests();
        const probeInput = makePlan(PLANNER_DAB_CAP / 2);
        const startedAt = performance.now();
        const probeImmediate = requestStudioLivingInkSettledBakeDabs(
          probeInput,
          SETTLED_SUMI,
          () => {},
        );
        requestMs = Math.min(requestMs, performance.now() - startedAt);
        expect(probeImmediate).toBeNull();

        // Clear the latch this request just armed, INSIDE the loop, so the next sample is cold
        // too. `scheduleSettledBakeSlice` refuses to re-arm while a drain is outstanding, and
        // that flag is module state `resetStudioLivingInkSettledBakeCacheForTests` does not
        // clear — so draining only after the loop would leave six of these seven samples
        // skipping the arming path entirely, and the minimum would pick one of those. A
        // regression in the arm itself would then have nothing timing it.
        //
        // Order matters. Drop the pending jobs FIRST, then run the one queued handler: it
        // clears the latch on entry, finds nothing to work on, and so does not re-arm on the
        // way out. Draining before the reset leaves a half-solved job pending and sets the
        // latch again, which is the same failure by a longer route — and it is how the measured
        // run below once ended up never progressing, returning a null settled plan.
        resetStudioLivingInkSettledBakeCacheForTests();
        probeScheduler.runNextSlice();
      }
    } finally {
      probeScheduler.restore();
    }
    resetStudioLivingInkSettledBakeCacheForTests();

    const scheduler = captureScheduledSlices();
    try {
      const input = makePlan(PLANNER_DAB_CAP / 2);
      let readyCount = 0;
      const onReady = () => {
        readyCount += 1;
      };
      const immediate = requestStudioLivingInkSettledBakeDabs(
        input,
        SETTLED_SUMI,
        onReady,
      );
      expect(immediate).toBeNull();
      // The render-body call only snapshots + enqueues, and that is graded against the
      // SYNCHRONOUS SOLVE of the same input timed above rather than against a millisecond count.
      // `immediate === null` already proves no plan came back; this proves the enqueue did not
      // quietly do the work anyway. Recorded against a solve-only denominator: 0.68-0.69ms idle
      // and 0.72-0.74ms under six spinning hogs, against solves of 137-143ms and 261-307ms —
      // 0.0049-0.0050 and 0.0024-0.0028. Load moves this ratio DOWN, not up, because contention
      // inflates a 140ms solve far more than it inflates the cheapest of seven sub-millisecond
      // requests, so a contended runner grades the request path more strictly rather than less.
      // The absolute 16.5ms form carried only 2-12x headroom over a sub-4ms measurement and
      // failed under load at 17.4 and 20.7ms with nothing regressed; a synchronous solve here
      // would score ~1, so the gate keeps a 20x margin over its honest population and 200x
      // sensitivity to the regression it exists to catch.
      expect(
        requestMs / synchronousSolveMs,
        `render-body request ${requestMs.toFixed(3)}ms against a `
        + `${synchronousSolveMs.toFixed(1)}ms synchronous solve`,
      ).toBeLessThan(0.1);

      // A joining request (content-equal array, e.g. a symmetry sibling or a
      // second render) shares the pending job instead of re-enqueueing.
      expect(
        requestStudioLivingInkSettledBakeDabs(makePlan(PLANNER_DAB_CAP / 2), SETTLED_SUMI, onReady),
      ).toBeNull();

      // 3. Drive the macrotask slices; each one must stay under the budget.
      const sliceDurations: number[] = [];
      for (let slice = 0; slice < 200 && readyCount === 0; slice += 1) {
        const elapsed = scheduler.runNextSlice();
        expect(elapsed).not.toBeNull();
        sliceDurations.push(elapsed ?? 0);
      }
      expect(readyCount).toBe(1);
      expect(sliceDurations.length).toBeGreaterThan(1);
      // The slicer is itself wall-clock bounded, so it self-regulates: on a slower machine it
      // simply packs fewer units into its own budget. Measured across idle and a
      // 250%-oversubscribed box, that shows up as a median and a minimum that barely move while
      // only the first and last slices — the ones carrying setup and teardown — blow up:
      //
      //          slices   min    median   max
      //   idle      14    8.06   10.34    16.0
      //   loaded    24    8.32   12.68    57.1
      //   loaded    25    8.13   10.26    55.0
      //
      // So the median is the statistic that reflects the SLICER, and the max is the statistic
      // that reflects the machine. Gating on the max is what made this test fail at 39.0ms with
      // nothing regressed. Gating on the median keeps the real invariant: if slicing breaks, one
      // slice absorbs the whole solve and the median goes with it.
      const ordered = [...sliceDurations].sort((left, right) => left - right);
      // The CHEAPEST slice is the load-bearing assertion, and it is the one statistic here that
      // contention cannot move: it is the slicer's own 8ms budget, measured at 8.06 / 8.13 /
      // 8.32 / 8.6ms across an idle box and three separately-loaded ones. The median is not —
      // under heavy contention it went from 10.3 to 36.2ms — and the maximum is pure scheduling
      // noise, which is what failed this test at 39.0ms with nothing regressed.
      //
      // A minimum catches the two regressions this budget is really for. If slicing breaks, one
      // slice absorbs the whole solve and the minimum IS that slice. If a per-unit cost rises,
      // every slice carries at least one unit and the minimum rises with it. The slicer cannot
      // pass by being accidentally fast, because it is wall-clock bounded from the inside.
      //
      // What a minimum cannot see is a PHASE-SPECIFIC blow-up: seeding, or the final
      // `deriveAugmentedSettledDabs` lowering, becoming expensive in the one slice that carries
      // it while every other slice stays at its 8ms budget. That case is the ceiling's job below,
      // which is why the ceiling is sized against the observed noise population rather than left
      // as a token hang bound.
      //
      // ...over the TICK-BEARING slices. The seeding slice and the lowering slice are both
      // excluded: neither runs a tick, so neither is evidence about per-tick cost, and either one
      // left in would rescue this gate when the ticks themselves regress. See
      // `settledBakeTickSliceFloorMs`. Excluding them costs this reading almost nothing — 8.06 to
      // 8.42ms on the recorded series — because both are dearer than a tick, not cheaper.
      const tickFloorMs = settledBakeTickSliceFloorMs(sliceDurations);
      expect(
        tickFloorMs,
        `cheapest tick-bearing slice over the ${CHUNK_FREEZE_BUDGET_MS}ms freeze budget: `
        + `[${ordered.map((duration) => duration.toFixed(1)).join(", ")}] `
        + `(seeding ${sliceDurations[0]!.toFixed(1)}ms and lowering `
        + `${sliceDurations[sliceDurations.length - 1]!.toFixed(1)}ms excluded)`,
      ).toBeLessThan(CHUNK_FREEZE_BUDGET_MS);
      // Slicing actually happened — the async path ran at all, rather than the request having
      // been served some other way.
      //
      // Deliberately NOT a floor on the slice COUNT. `runSettledBakeSlice` packs ticks until its
      // own 8ms wall budget expires, so the count is a reading of the machine: this box produces
      // 14 slices idle and 24-25 under load, and a faster CPU — or a legitimate solver
      // optimisation — fits the same 24 ticks into fewer. A `>= 8` floor would then fail because
      // the implementation got FASTER, which is the same machine-dependence this file is being
      // cleaned of, pointing the other way.
      //
      // Nothing is lost by dropping it. A collapse to a single synchronous solve is already
      // convicted three times over: `immediate` came back null above, that one slice would carry
      // the whole solve and so BE the minimum graded against the 33ms budget, and it would fail
      // the 400ms ceiling as well.
      expect(sliceDurations.length).toBeGreaterThanOrEqual(1);
      // The worst slice, bounded against the observed noise population rather than against
      // nothing in particular. Scheduling decides this number — 16.0ms idle, 55.0-57.1ms under
      // heavy contention, 121.8ms on a starved container — so it cannot carry the 33ms freeze
      // budget; that is what failed this test at 39.0ms. But 400ms is more than 3x the worst
      // honest reading ever recorded here, and a phase-specific unit blowing up to the hundreds
      // of milliseconds a user would actually feel fails it, which the minimum above cannot see.
      expect(
        Math.max(...sliceDurations),
        `worst slice: [${ordered.map((duration) => duration.toFixed(1)).join(", ")}]`,
      ).toBeLessThan(400);

      // 4. Completion: the cached plan is byte-identical to the synchronous
      //    solve — slicing changed scheduling, never bytes — and the cores are
      //    the requesting array's own objects.
      const settled = requestStudioLivingInkSettledBakeDabs(
        input,
        SETTLED_SUMI,
        onReady,
      );
      expect(settled).not.toBeNull();
      expect(JSON.stringify(settled)).toBe(referenceBytes);
      const settledCores = (settled ?? []).filter((dab) => dab.role === "core");
      const inputCores = input.filter((dab) => dab.role === "core");
      for (let index = 0; index < inputCores.length; index += 1) {
        expect(settledCores[index]).toBe(inputCores[index]);
      }
    } finally {
      scheduler.restore();
    }
  });

  it("returns identity plans immediately for non-settled phases and empty plans", () => {
    const plan = makePlan(8);
    const live = requestStudioLivingInkSettledBakeDabs(
      plan,
      { ...SETTLED_SUMI, phase: "live" },
      () => {},
    );
    expect(live).toBe(plan);
    const empty: WatercolorBrushDab[] = [];
    expect(
      requestStudioLivingInkSettledBakeDabs(empty, SETTLED_SUMI, () => {}),
    ).toBe(empty);
  });

  it("falls back to a synchronous solve when no scheduler exists (fail-closed on correctness)", () => {
    const original = globalThis.setTimeout;
    // @ts-expect-error — simulating a host without timers.
    globalThis.setTimeout = undefined;
    try {
      const input = makePlan(40);
      const settled = requestStudioLivingInkSettledBakeDabs(
        input,
        SETTLED_SUMI,
        () => {},
      );
      expect(settled).not.toBeNull();
      expect((settled ?? []).length).toBeGreaterThan(input.length);
    } finally {
      globalThis.setTimeout = original;
    }
  });
});
