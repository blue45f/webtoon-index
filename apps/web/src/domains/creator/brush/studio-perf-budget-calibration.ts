/**
 * Machine-speed calibration for the brush suite's wall-clock budgets.
 *
 * The perf budgets in this directory were recorded as absolute milliseconds on one machine, which
 * makes them assertions about the *runner* as much as about the code. Measured on a cloud dev
 * container at the merge-base commit, three of them failed while GitHub Actions stayed green:
 * the impasto scribble plan at 78.5ms against a 60ms budget, the 1e6-sample paper sampler at
 * 241.7ms against 200ms, and the 2000-station impasto plan at 32.5ms against 30ms. Nothing had
 * regressed; the machine was slower. The cost is not a red test — it is that `pnpm test` cannot be
 * run to completion off CI, so real failures hide behind the noise.
 *
 * Taking the minimum of several samples, which all three already did, does not fix this. Minima
 * cancel *preemption* (noise is additive, so the cheapest run is the honest one) but they cannot
 * cancel a machine that is simply slower at every sample: the floor itself moves.
 *
 * So the budget stops being a millisecond count and becomes a RATIO. A fixed calibration workload
 * runs in the same process, at the same moment, under the same load, and the recorded budget is
 * scaled by how much slower this machine is than the machine the budget was recorded on:
 *
 *     slowdown         = calibrationMs / REFERENCE_CALIBRATION_MS
 *     effectiveBudget  = recordedBudgetMs * slowdown
 *
 * This is the same move `detectStudioBrushSoakMonotonicDegradation` made in the perf matrix, for
 * the same reason: stop comparing raw numbers, and make the measurement earn its baseline. There
 * the baseline was the series' own first half; here it is a workload whose cost is known.
 *
 * Detection power is preserved because the calibration workload is INDEPENDENT of the code under
 * test. A regression in ribbon planning or paper sampling does not make `Math.sqrt` slower, so the
 * numerator doubles while the denominator does not and the ratio doubles with it. That is pinned
 * by synthetic-regression tests, not asserted here.
 *
 * Two deliberate asymmetries:
 *
 *   - There is NO lower clamp. A machine faster than the reference gets a proportionally *tighter*
 *     budget, which is what makes this stronger than the `process.env.CI ? loose : strict` branches
 *     it replaces — those handed the busiest machines the loosest gate, exactly backwards.
 *   - There IS an upper clamp. Past `MAX_SLOWDOWN` the calibration is no longer measuring machine
 *     speed but something pathological, and an unbounded scale factor would quietly turn every
 *     budget in this directory into a no-op. Beyond the clamp the gate stays where the clamp puts
 *     it and fails rather than dissolving.
 *
 * **Prefer `studio-perf-calibration.ts` for new call sites.** That module reaches the same goal by
 * interleaving the reference with the workload sample-for-sample and taking the minimum of both,
 * so a contended stretch inflates numerator and denominator together; it also makes a violation
 * earn confirmation passes, and asserts live that a 2x regression would still be convicted. This
 * module measures its reference in a separate window, which tracks a slower machine well and a
 * momentarily busier one less well, and it proves nothing about its own detection power at the
 * call site.
 *
 * The shape that used to keep call sites here -- measured work that is not a re-runnable
 * `() => void`, because the timed window lives INSIDE the work rather than around it -- no longer
 * does. `evaluateStudioCalibratedSampledBudget` takes the finished reference/workload pair from
 * the caller, so a per-slice budget inside an idle-pump loop states its budget the interleaved
 * way; the idle-prewarm freeze gate in studio-dry-media-long-stroke-regression.test.ts moved onto
 * it. What is left here is the stateful append pass, and it should move too.
 */

/**
 * Cost of one `studioPerfCalibrationWorkload()` pass, in milliseconds, on the machine the budgets
 * in this directory are recorded against.
 *
 * Recorded on the cloud dev container described above: min-of-7, three independent rounds, 2.3116
 * / 2.3108 / 2.2994ms — a spread of 0.5%, which is what makes it usable as a denominator at all.
 * Re-record this together with every budget that references it; a reference drifting alone
 * silently rescales all of them.
 */
export const STUDIO_PERF_CALIBRATION_REFERENCE_MS = 2.3;

/**
 * Largest slowdown the calibration is allowed to certify. A machine reading slower than this is
 * not "slow", it is starved or mismeasured, and scaling a budget by an unbounded factor is how a
 * perf gate becomes decoration.
 */
export const STUDIO_PERF_CALIBRATION_MAX_SLOWDOWN = 4;

/**
 * Smallest sibling measurement `studioPerfRatioBudgetMs` will divide a budget by. Below this the
 * reading is mostly timer resolution and call overhead, so it says nothing about the machine.
 */
export const STUDIO_PERF_CALIBRATION_MIN_SIBLING_MS = 0.05;

/** Samples per calibration measurement. Minimum-of-N, for the additive-noise reason above. */
const STUDIO_PERF_CALIBRATION_SAMPLES = 5;

/**
 * The calibration workload: dense float math over a small resident buffer.
 *
 * Chosen to share a profile with what the budgets guard — transcendental and square-root math over
 * packed coordinate runs — so that a machine slow at one is slow at the other, while sharing no
 * code with any of it. It must stay cheap (~2ms) because it runs at every budget check, and it
 * must not be eliminable, which is why the accumulator is returned.
 */
export function studioPerfCalibrationWorkload(): number {
  const scratch = new Float64Array(1024);
  let accumulator = 0;
  for (let pass = 0; pass < 64; pass += 1) {
    for (let index = 0; index < 1024; index += 1) {
      const t = (index + pass) * 0.013;
      scratch[index] = Math.sqrt(t * t + 1) + Math.sin(t) * Math.cos(t * 0.5);
    }
    for (let index = 1; index < 1024; index += 1) {
      const delta = scratch[index] - scratch[index - 1];
      accumulator += Math.abs(delta) + Math.atan2(delta, 0.5);
    }
  }
  return accumulator;
}

/**
 * Measures this machine's calibration cost, now.
 *
 * Deliberately NOT memoized across calls. The dominant source of error is not the machine's
 * nominal speed but the load on it, and under `pnpm test` that load is other worker processes: the
 * 2000-station plan measures 20.7ms alone on the reference container and 32.5ms inside the full
 * suite. A calibration cached from an idle moment would certify the wrong denominator for a budget
 * checked in a busy one. At ~2.3ms x 5 samples this is affordable per assertion.
 */
export function measureStudioPerfCalibrationMs(): number {
  studioPerfCalibrationWorkload();
  let best = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < STUDIO_PERF_CALIBRATION_SAMPLES; sample += 1) {
    const startedAt = performance.now();
    studioPerfCalibrationWorkload();
    best = Math.min(best, performance.now() - startedAt);
  }
  return best;
}

/**
 * Scales a recorded budget to this machine — pure, so the scaling rule is unit-testable against
 * recorded calibration costs and synthetic regressions instead of only through a live measurement.
 *
 * A calibration that did not measure (zero, negative, non-finite) yields the recorded budget
 * unscaled rather than an infinite one: an unmeasurable machine gets the strict gate, not none.
 */
export function studioCalibratedBudgetMs(
  recordedBudgetMs: number,
  calibrationMs: number,
  referenceMs: number = STUDIO_PERF_CALIBRATION_REFERENCE_MS,
): number {
  if (!Number.isFinite(calibrationMs) || calibrationMs <= 0) return recordedBudgetMs;
  if (!Number.isFinite(referenceMs) || referenceMs <= 0) return recordedBudgetMs;
  const slowdown = Math.min(
    calibrationMs / referenceMs,
    STUDIO_PERF_CALIBRATION_MAX_SLOWDOWN,
  );
  return recordedBudgetMs * slowdown;
}

/**
 * Convenience for the assertion site: measures this machine and scales `recordedBudgetMs`.
 *
 * Only sound for budgets whose measured code has the SAME resource profile as the workload above —
 * a tight numeric loop over a small resident working set. See the profile note on
 * `studioPerfRatioBudgetMs` for what to use when it does not.
 */
export function studioPerfBudgetMs(recordedBudgetMs: number): number {
  return studioCalibratedBudgetMs(recordedBudgetMs, measureStudioPerfCalibrationMs());
}

/**
 * Budget for code the synthetic workload CANNOT calibrate, expressed against a sibling operation.
 *
 * The synthetic workload above tracks a slower machine but not a busy one, and that distinction was
 * measured, not assumed. Running the 2000-station impasto plan against 8 competing CPU hogs on the
 * reference container:
 *
 *              idle      loaded     slowdown
 *   plan       30.94ms   133.24ms   x4.31
 *   synthetic   2.30ms     2.36ms   x1.03   -> plan/synthetic moved x13.5 -> x56.5  (+320%)
 *   sibling    21.71ms    88.61ms   x4.08   -> plan/sibling   moved x1.43 -> x1.50  (+5%)
 *
 * The reason is resource profile. A 1024-element float loop is core-bound and stays in cache, so
 * concurrent load barely touches it; a stroke planner is bound by memory bandwidth and GC, which
 * is exactly what contention takes away. Minimum-of-N does not rescue this either -- it cancels a
 * single preempted sample, not a floor that has risen under every sample.
 *
 * So for those budgets the calibration is a REAL sibling operation: same domain and comparable
 * footprint, so contention cancels, but different code, so a regression in the measured path does
 * not move the denominator with it. `planOilBrushDabs` calibrates the ribbon carrier for that
 * reason -- the carrier consumes its output and neither calls the other.
 *
 * @param recordedRatio measured-over-sibling, recorded on the reference container with margin.
 * @param calibrate the sibling operation; called once to warm, then sampled.
 */
export function studioPerfRatioBudgetMs(
  recordedRatio: number,
  calibrate: () => void,
  samples: number = STUDIO_PERF_CALIBRATION_SAMPLES,
): number {
  calibrate();
  let best = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < Math.max(1, samples); sample += 1) {
    const startedAt = performance.now();
    calibrate();
    best = Math.min(best, performance.now() - startedAt);
  }
  return studioRatioBudgetFromSiblingMs(recordedRatio, best);
}

/**
 * The pure half of the sibling form: what a recorded ratio is worth once the sibling has been
 * measured at `siblingMs`.
 *
 * Split out so the contract -- linear in the ratio, and refusing to gate below the floor -- can be
 * pinned exactly rather than within the spread of two live measurements. Timing that linearity
 * meant measuring the same sibling twice, non-interleaved, and asserting the readings agreed; on a
 * contended box they do not (recorded at 12.18 against a 2.5 ceiling, and 0.258 against a 1.5
 * floor, in the same suite), so the test was failing on the machine rather than on the code.
 */
export function studioRatioBudgetFromSiblingMs(
  recordedRatio: number,
  siblingMs: number,
): number {
  // A sibling this cheap is not a denominator: below it, timer resolution and call overhead are
  // most of the reading, and multiplying it by the ratio would gate healthy code to a few
  // microseconds. Refusing to gate is the safe direction -- a broken calibration must never
  // manufacture a failure in code that never regressed.
  if (!Number.isFinite(siblingMs) || siblingMs < STUDIO_PERF_CALIBRATION_MIN_SIBLING_MS) {
    return Number.POSITIVE_INFINITY;
  }
  return recordedRatio * siblingMs;
}

/**
 * Repeats the base workload to ~200ms, for calibrating budgets that measure work of that duration.
 *
 * Duration, not just memory profile, decides whether a calibration tracks a busy machine, and that
 * was measured too. The 1e6-sample paper sampler against 8 competing CPU hogs on the reference
 * container:
 *
 *                    idle      loaded      slowdown
 *   paper sampler    223.9ms   2268.9ms    x10.13
 *   base workload      2.38ms     2.36ms    x0.99  -> ratio moved x94.0 -> x963.3  (+925%)
 *   this workload    210.8ms   2072.0ms    x9.83   -> ratio moved x1.06 -> x1.10   (+3%)
 *
 * A 2ms workload usually completes inside one scheduler quantum, so oversubscription barely
 * touches it; a 200ms one is descheduled repeatedly, exactly like the code it is calibrating.
 * Minimum-of-N cannot recover this because every sample is long enough to be preempted.
 *
 * Callers should pass a small `samples` count to `studioPerfRatioBudgetMs` for this workload -- at
 * ~200ms a call, the default five would cost a second of wall clock per assertion.
 */
export function studioPerfSustainedCalibrationWorkload(): number {
  let accumulator = 0;
  for (let repeat = 0; repeat < 90; repeat += 1) {
    accumulator += studioPerfCalibrationWorkload();
  }
  return accumulator;
}
