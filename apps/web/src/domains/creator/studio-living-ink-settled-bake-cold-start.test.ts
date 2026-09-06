/**
 * The PROCESS-COLD settled-bake enqueue, in its own FILE on purpose.
 *
 * The sibling suite grades the render-path request as a minimum over seven cold-cache probes.
 * That is the right statistic for steady-state enqueue cost — noise is one-sided, so the cheapest
 * probe is the honest one — but it cannot see one-time cost.
 * `resetStudioLivingInkSettledBakeCacheForTests` clears the memo and the scheduler latch; it
 * cannot clear module-level or JIT initialisation, so only the FIRST probe in a process ever pays
 * that, and a minimum over seven discards it by construction. A first-use stall on the enqueue
 * path would leave every slice and output assertion green.
 *
 * So the first request in a fresh process is graded here, where it is genuinely the first.
 * Vitest isolates modules per file, which is what makes that true; an ordering convention inside
 * the sibling suite would be silently breakable by anyone adding a test above it.
 *
 * Exactly one measurement runs in this file, and nothing may precede it.
 */
import { describe, expect, it } from "vitest";

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

/**
 * A blow-up bound, not a budget, and for the same reason the overlay's cold-start gates are: one
 * cold reading is JIT-dominated and cannot be reduced, because a process is cold exactly once.
 *
 * The denominator is the synchronous solve of the same input, measured in the same process
 * immediately afterwards, so machine speed divides out — the same construction the steady-state
 * gate next door uses.
 */
const COLD_ENQUEUE_RATIO_LIMIT = 0.25;

/*
 * The one-time cost this file exists to measure is real and it is large: the process-cold request
 * costs 4.908-5.240ms idle where the steady-state gate next door records 0.68-0.69ms for the
 * cheapest of seven warm probes. A minimum over repeats was therefore hiding a 7x one-time cost,
 * exactly as review argued, and no amount of cache resetting would have exposed it.
 *
 * Recorded ratios: 0.0162 / 0.0163 / 0.0170 idle and 0.0191 / 0.0229 / 0.0392 under six spinning
 * hogs on four cores. 0.25 carries 6.4x headroom over the worst of those, while a request that
 * solved synchronously would score ~1 and is convicted with 4x margin.
 */

describe("living-ink settled bake, process-cold", () => {
  it("does not pay a one-time initialisation on the first render-path request", () => {
    // FIRST. Nothing in this file may run before it, which is the entire reason the file exists.
    const input = makePlan(PLANNER_DAB_CAP / 2);
    expect(input.length).toBe(PLANNER_DAB_CAP);

    const scheduler = captureScheduledSlices();
    let coldRequestMs: number;
    try {
      const startedAt = performance.now();
      const immediate = requestStudioLivingInkSettledBakeDabs(input, SETTLED_SUMI, () => {});
      coldRequestMs = performance.now() - startedAt;
      // The contract first: the cold request must not solve synchronously at all.
      expect(immediate).toBeNull();
    } finally {
      scheduler.restore();
    }
    resetStudioLivingInkSettledBakeCacheForTests();

    // The denominator: the same work done synchronously, which is what the request path is
    // refusing to do. Timed AFTER the measurement above so it cannot warm it.
    const referenceStartedAt = performance.now();
    augmentStudioLivingInkSettledBakeDabs(makePlan(PLANNER_DAB_CAP / 2), SETTLED_SUMI);
    const synchronousSolveMs = performance.now() - referenceStartedAt;
    resetStudioLivingInkSettledBakeCacheForTests();

    // The steady-state gate next door reads 0.0024-0.0050 for this same quotient once the process
    // is warm; this file reads 0.0162-0.0392. That gap IS the one-time cost, and it is why a
    // minimum over repeats cannot stand in for a genuinely cold measurement.
    const ratio = coldRequestMs / synchronousSolveMs;
    expect(
      ratio,
      `the process-cold request costs ${coldRequestMs.toFixed(3)}ms against a `
      + `${synchronousSolveMs.toFixed(1)}ms synchronous solve`,
    ).toBeLessThan(COLD_ENQUEUE_RATIO_LIMIT);
  });
});
