import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PERF_BUDGET_TEST_FILES } from "../vitest.perf-budget-files.mjs";

const root = path.resolve(import.meta.dirname, "..");
const CATALOGUE_TIMING_TEST = "scripts/studio-brush-catalogue-perf-matrix.test.ts";
const CATALOGUE_TIMING_HELPER = "scripts/studio-brush-catalogue-perf-matrix.ts";
const CATALOGUE_TIMING_CALL = /\bevaluateStudioBrushCataloguePaint(?:PerfMatrix|PerfRow|Soak)\s*\(/u;

function measuresWallClock(source: string): boolean {
  return source.includes("performance.now(")
    || source.includes("evaluateStudioCalibrated")
    || (source.includes('from "./studio-brush-catalogue-perf-matrix"')
      && CATALOGUE_TIMING_CALL.test(source));
}

/**
 * The perf-budget partition is a list of file paths, and a list of paths drifts the moment a
 * file is renamed or a budget assertion is dropped. This pins the two facts the partition
 * depends on: every entry is a real test file, and every entry actually times something —
 * otherwise a deterministic test would be quietly moved out of the parallel run for no reason,
 * or a renamed budget test would fall back into the main run and start flaking again.
 */
describe("wall-clock budget partition", () => {
  it("lists only files that exist", () => {
    const missing = PERF_BUDGET_TEST_FILES.filter((file) => !existsSync(path.join(root, file)));
    expect(missing, "renamed or deleted — update vitest.perf-budget-files.mjs").toEqual([]);
  });

  it("lists only files that measure wall-clock time", () => {
    // The clock can be owned by a shared helper. Both calibrated budgets and the catalogue
    // matrix are live measurements even though the test does not call performance.now itself.
    const notTimed = PERF_BUDGET_TEST_FILES.filter((file) =>
      !measuresWallClock(readFileSync(path.join(root, file), "utf8")));
    expect(
      notTimed,
      "neither a direct clock nor a known timing helper — this belongs in the main run",
    ).toEqual([]);
  });

  it("does not leave a calibrated-budget file behind in the parallel run", () => {
    // The partition is a hand-maintained list, and the failure mode is silent: a new calibrated
    // budget lands in the main run, passes on a quiet machine, and reddens main weeks later.
    const brushDir = path.join(root, "apps/web/src/domains/creator/brush");
    const stragglers = readdirSync(brushDir)
      .filter((name) => name.endsWith(".test.ts"))
      .filter((name) =>
        readFileSync(path.join(brushDir, name), "utf8").includes("evaluateStudioCalibrated"))
      .map((name) => `apps/web/src/domains/creator/brush/${name}`)
      .filter((file) => !PERF_BUDGET_TEST_FILES.includes(file));

    expect(stragglers, "add these to vitest.perf-budget-files.mjs").toEqual([]);
  });

  it("runs the helper-owned catalogue soak in the required quiet pass", () => {
    expect(PERF_BUDGET_TEST_FILES).toContain(CATALOGUE_TIMING_TEST);
    const source = readFileSync(path.join(root, CATALOGUE_TIMING_TEST), "utf8");
    const helper = readFileSync(path.join(root, CATALOGUE_TIMING_HELPER), "utf8");
    expect(measuresWallClock(source)).toBe(true);
    expect(helper).toContain("performance.now(");
    expect(source).toMatch(/evaluateStudioBrushCataloguePaintSoak\s*\(/u);
  });

  it("does not mistake deterministic catalogue helpers for elapsed-time measurements", () => {
    const deterministicOnly = [
      'import { detectStudioBrushSoakMonotonicDegradation } from "./studio-brush-catalogue-perf-matrix";',
      "detectStudioBrushSoakMonotonicDegradation([10, 10, 10]);",
    ].join("\n");
    expect(measuresWallClock(deterministicOnly)).toBe(false);
    expect(measuresWallClock("expect(geometry.length).toBe(42);")).toBe(false);
  });

  it("keeps the list sorted so additions diff cleanly", () => {
    expect([...PERF_BUDGET_TEST_FILES]).toEqual([...PERF_BUDGET_TEST_FILES].sort());
  });

  it("does not list itself or any other partition bookkeeping", () => {
    expect(PERF_BUDGET_TEST_FILES.some((file) => file.startsWith("tests/"))).toBe(false);
  });
});
