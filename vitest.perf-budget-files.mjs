// Test files whose assertions bound a wall-clock measurement (performance.now() deltas).
//
// These run in their own Vitest pass, after the main suite and one file at a time
// (vitest.perf.config.ts). Inside the main run they compete with four workers spread over
// ~2,900 files, and then they measure the machine rather than the code: the bristle-physics
// budget passed 20/20 on a quiet machine and failed 12% of the time under load on the very same
// commit, and the live-overlay 30ms budget went red twice in one day with no change to the
// code it times. Sequencing them behind the main run removes the competition without touching
// a single threshold — every budget in these files stays exactly as tight as it was.
//
// Add a file here when a test times a code path and asserts on the elapsed value — whether it
// calls performance.now() itself or reaches it through studio-perf-calibration, which owns the
// clock for every calibrated budget. That second form is how four files stayed in the parallel
// run after this partition was created: the original guard only looked for a literal
// performance.now(), so a file that times through the shared helper read as deterministic.
// studio-oil-ribbon-carrier.impasto-relief then failed main at 8.582x against an 8.55x budget,
// on three retries, with nothing in the timed code changed.
//
// The catalogue matrix also delegates its clock to a helper. Its soak measures elapsed time
// across consecutive planner runs, so it belongs in this same quiet pass. Its budgets, digest
// checks, catalogue coverage, sample counts and degradation detector remain unchanged.
//
// A calibrated budget divides work by a reference kernel measured on the same machine, so it
// already survives a uniformly slow runner. What it cannot divide out is *contention*: four
// workers over ~3,000 files perturb the work and the reference by different amounts, and the
// ratio drifts. Sequencing is what fixes that, not a looser threshold.
//
// Do not add tests that assert only on counts, geometry or output bytes — those are deterministic
// and belong in the main run. tests/vitest-perf-budget-partition.test.ts pins that every entry
// exists and really times something.
export const PERF_BUDGET_TEST_FILES = Object.freeze([
  "scripts/studio-brush-catalogue-perf-matrix.test.ts",
  "apps/web/src/domains/creator/brush/studio-brush-stamp-engine.test.ts",
  "apps/web/src/domains/creator/brush/studio-dry-media-long-stroke-regression.test.ts",
  "apps/web/src/domains/creator/brush/studio-long-stroke-per-move-cost.test.ts",
  "apps/web/src/domains/creator/brush/studio-oil-ribbon-carrier.bristle-physics.test.ts",
  "apps/web/src/domains/creator/brush/studio-oil-ribbon-carrier.impasto-relief.test.ts",
  "apps/web/src/domains/creator/brush/studio-paper-media-profile-v1.test.ts",
  "apps/web/src/domains/creator/brush/studio-perf-budget-calibration.test.ts",
  "apps/web/src/domains/creator/brush/studio-perf-calibration.test.ts",
  "apps/web/src/domains/creator/brush/studio-wet-edge-bloom-v1.test.ts",
  "apps/web/src/domains/creator/brush/studio-wet-ribbon-carrier.test.ts",
  "apps/web/src/domains/creator/live/studio-live-dynamic-brush-overlay.test.ts",
  "apps/web/src/domains/creator/studio-impasto-relief-shading-v1.perf.test.ts",
  "apps/web/src/domains/creator/studio-living-ink-provider.test.ts",
  "apps/web/src/domains/creator/studio-living-ink-settled-bake-v1.test.ts",
]);
