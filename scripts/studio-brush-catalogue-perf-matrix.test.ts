import { describe, expect, it } from "vitest";

import { STUDIO_PAINT_BRUSH_CATALOG_ITEMS } from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import {
  resolveStudioBrushDynamics,
  resolveStudioBrushDynamicsForNormalizedSettings,
  type StudioBrushDynamicsRecipe,
} from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import { materializeAllStudioBrushPackSelections } from "../apps/web/src/domains/creator/brush/studio-brush-pack-runtime";
import {
  computeStudioBrushPlanDigest,
  computeStudioBrushQualityReceiptSkeleton,
} from "../apps/web/src/domains/creator/brush/studio-brush-variant-group-manifest";

import {
  STUDIO_BRUSH_CATALOGUE_SOAK_IDS,
  STUDIO_BRUSH_CATALOGUE_SOAK_MIN_HALF_SAMPLES,
  STUDIO_BRUSH_CATALOGUE_SOAK_RUNS,
  STUDIO_BRUSH_CRAYON_FAMILY_CHUNK_BUDGET_MS,
  STUDIO_BRUSH_CRAYON_FAMILY_IDS,
  STUDIO_BRUSH_CRAYON_FAMILY_LONG_CPU_BUDGET_MS,
  STUDIO_BRUSH_CRAYON_FAMILY_LONG_WALL_BLOWUP_MS,
  detectStudioBrushSoakMonotonicDegradation,
  evaluateStudioBrushCataloguePaintDeterminismProbe,
  evaluateStudioBrushCataloguePaintPerfMatrix,
  evaluateStudioBrushCataloguePaintPerfRow,
  evaluateStudioBrushCataloguePaintSoak,
  evaluateStudioBrushCrayonFamilyIncrementalChunks,
  listStudioBrushCatalogueDeterminismSampleIds,
  planStudioBrushCataloguePaintDynamics,
  reduceStudioBrushCrayonFamilyGrowth,
  reduceStudioBrushCrayonFamilyPasses,
  studioBrushChunkSeriesFreezes,
  studioBrushCrayonFamilyCpuFreezes,
  type StudioBrushCataloguePerfRow,
  STUDIO_BRUSH_CRAYON_FAMILY_SHORT_SAMPLES,
  STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH,
  STUDIO_BRUSH_CRAYON_FAMILY_LONG_SAMPLES,
} from "./studio-brush-catalogue-perf-matrix";

/**
 * Deterministic pointer-sample grid spanning the full domain `dabAt` feeds the per-dab resolver:
 * rest/extreme pressures, clamped speed, full tilt corners, twist wrap, signed direction bounds
 * and small-through-large stamp indices (the seeded-jitter/scatter salt input).
 */
const RESOLVER_EQUIVALENCE_SAMPLES = [
  { pressure: 0, tangentialPressure: 0, speed: 0, tiltX: 0, tiltY: 0, twist: 0, direction: 0, stampIndex: 0 },
  { pressure: 0.42, tangentialPressure: 0, speed: 0.35, tiltX: 8, tiltY: -12, twist: 15, direction: 30, stampIndex: 1 },
  { pressure: 1, tangentialPressure: 1, speed: 64, tiltX: 90, tiltY: -90, twist: 359, direction: -180, stampIndex: 2 },
  { pressure: 0.85, tangentialPressure: -1, speed: 2.4, tiltX: -45, tiltY: 60, twist: 180, direction: 137.5, stampIndex: 7 },
  { pressure: 0.05, tangentialPressure: 0.25, speed: 0.9, tiltX: 22, tiltY: -8, twist: 45, direction: -90, stampIndex: 63 },
  { pressure: 0.62, tangentialPressure: 0, speed: 1.3, tiltX: 0, tiltY: 0, twist: 300, direction: 179.9, stampIndex: 1_160 },
  { pressure: 0.5, tangentialPressure: -0.5, speed: 6.5, tiltX: 65, tiltY: 65, twist: 90, direction: -0.5, stampIndex: 8_191 },
  { pressure: 0.73, tangentialPressure: 0.9, speed: 0.05, tiltX: -90, tiltY: 90, twist: 271, direction: 12.25, stampIndex: 65_535 },
] as const;

function* recipeDigestStream(
  recipes: readonly StudioBrushDynamicsRecipe[],
): Generator<number> {
  for (const recipe of recipes) {
    yield recipe.size;
    yield recipe.width;
    yield recipe.opacity;
    yield recipe.flow;
    yield recipe.spacing;
    yield recipe.scatter;
    yield recipe.scatterOffsetX;
    yield recipe.scatterOffsetY;
    yield recipe.scatterAngle;
    yield recipe.angle;
    yield recipe.roundness;
  }
}

describe("soak monotonic-degradation detector", () => {
  /**
   * Every noise series here is a RECORDED CI measurement from this gate's own hardening history
   * (see the detector docstring), so the decision is pinned against the real shapes that broke
   * it rather than against a live timing run that reproduces at most one of them.
   */
  it.each([
    // main CI: lucky 29.77 baseline vs 38.32 later-min reads x1.29, while the first half's OWN
    // spread already spans x1.71 — unresolvable noise, not degradation.
    ["needle-graphite (main CI)", [29.77, 37.52, 51.01, 34.03, 34.87, 53.45, 60.47, 62.61, 48.54, 38.32]],
    ["needle-graphite (three-run era)", [40.68, 38.13, 46.76, 46.16, 82.60, 63.89]],
    // Series too short to estimate within-half noise abstain rather than guess.
    ["acrylic-stiff-flat (lucky first run)", [6.55, 15.54, 13.59]],
    ["oil-pastel (one preempted run)", [7.22, 7.26, 18.90]],
    // A healthy planner that only warms up must never trip the gate.
    ["JIT warm-up", [52.0, 31.0, 29.5, 28.9, 28.7, 28.6, 28.5, 28.5, 28.4, 28.4]],
    // Found in review: contention that RAMPS and then subsides. The first half climbs cleanly so
    // its baseline is earned, and 15/10 clears the relative gate and the absolute floor — but the
    // whole second half runs at half the first half's peak, which no leak ever does.
    ["ramp that recovers", [10, 10, 10, 30, 30, 15, 15, 15, 15, 15]],
  ])("does not call degradation on recorded scheduler noise: %s", (_label, elapsed) => {
    expect(detectStudioBrushSoakMonotonicDegradation(elapsed)).toBe(false);
  });

  it.each([
    // Compounding growth: earlyMax/earlyMin = g^4 while laterMin/earlyMin = g^5, so every g > 1
    // clears its own first-half spread.
    ["20% per run", [10, 12, 14.4, 17.28, 20.74, 24.88, 29.86, 35.83, 43.0, 51.6]],
    ["45% per run", [8, 11.6, 16.8, 24.4, 35.4, 51.3, 74.4, 107.9, 156.4, 226.8]],
    // Step-change leak: a cache that starts thrashing halfway and stays slow.
    ["sustained step change", [10, 10.2, 9.9, 10.1, 10.0, 31.0, 32.2, 30.8, 31.5, 30.9]],
    // Found in review: a step that begins BEFORE the midpoint contaminates the first half, so
    // growth and first-half spread are both 3x and a spread comparison alone would suppress it.
    // The first half still only climbs, which is what a leak does and contention does not.
    ["step starting inside the first half", [10, 10, 10, 30, 30, 30, 30, 30, 30, 30]],
    ["step starting at the second run", [12, 44, 45, 44.5, 46, 45, 47, 44.8, 46.2, 45.5]],
    // Found in review: a rising first half with ONE ordinary jitter dip. The dip (12->11, x1.09)
    // defeats the drawdown shape, and a larger tolerance cannot rescue it -- the recorded noise
    // series [40.68, 38.13, 46.76] dips x1.067, inside what that would have to admit. The half's
    // travel separates them: x2.27 here against x1.03-x1.17 for every recorded noise series.
    ["rising first half with one jitter dip", [10, 12, 11, 20, 30, 40, 50, 60, 70, 80]],
  ])("still catches a genuine compounding leak: %s", (_label, elapsed) => {
    expect(detectStudioBrushSoakMonotonicDegradation(elapsed)).toBe(true);
  });

  it("still convicts a relentless climb that dips once just after the midpoint", () => {
    // The recovery guard's first form graded the later half's MINIMUM, so one ordinary dip
    // suppressed a real detection: here 28 falls a hair under the first half's 30/1.05 peak while
    // every other later run climbs far above it. Grading the MEDIAN asks the question the guard
    // was always meant to ask -- did the later half subside? -- and this one plainly did not.
    expect(
      detectStudioBrushSoakMonotonicDegradation([10, 12, 11, 20, 30, 28, 40, 50, 60, 70]),
    ).toBe(true);
  });

  it("still acquits a ramp whose WHOLE later half subsided", () => {
    // The shape the guard exists for, and the one the median must not lose: a clean first-half
    // climb whose entire second half runs at half the first half's peak. That is contention
    // easing, not a leak -- a leak never gives time back.
    expect(
      detectStudioBrushSoakMonotonicDegradation([10, 10, 10, 30, 30, 15, 15, 15, 15, 15]),
    ).toBe(false);
  });

  it("keeps the absolute floor so sub-millisecond timer jitter cannot manufacture a leak", () => {
    // x2 in ratio terms, but only ~1ms absolute — under the 4ms floor.
    expect(
      detectStudioBrushSoakMonotonicDegradation([1, 1.1, 1.05, 1.2, 1.1, 2, 2.1, 2.2, 2.05, 2.1]),
    ).toBe(false);
  });

  it("abstains instead of throwing on degenerate series", () => {
    expect(detectStudioBrushSoakMonotonicDegradation([])).toBe(false);
    expect(detectStudioBrushSoakMonotonicDegradation([12.5])).toBe(false);
    expect(detectStudioBrushSoakMonotonicDegradation([0, 0])).toBe(false);
    // A half below the sample floor cannot estimate its own spread, so it never calls degradation.
    expect(detectStudioBrushSoakMonotonicDegradation([1, 50, 60])).toBe(false);
  });

  it("the shipped soak runs enough samples for both halves to clear the sample floor", () => {
    expect(Math.floor(STUDIO_BRUSH_CATALOGUE_SOAK_RUNS / 2)).toBeGreaterThanOrEqual(
      STUDIO_BRUSH_CATALOGUE_SOAK_MIN_HALF_SAMPLES,
    );
  });
});

// Every series below is a recorded min-of-5 CPU reading from the reference container, idle and
// then against six spinning hogs on four cores.
// The last entry is the GitHub Actions runner, which reads this row 1.47x more expensively than
// the container the rest were recorded on. It is in the honest population precisely because a
// budget set without it failed CI on unregressed code.
const HONEST_CRAYON = [123.8, 116.8, 130.4, 123.3, 191.5] as const;
const HONEST_LIGHTEST = [58.7, 57.6, 55.3, 54.0] as const;

describe("reduceStudioBrushCrayonFamilyGrowth", () => {
  // The reading that red-flagged blue45f/toonspectrum#81, a PR carrying only VRM binaries and a
  // Blender script. CI reported "13.2ms -> 107.8ms" for x8.20, and those two numbers are each
  // side's own minimum across five passes -- so they are from DIFFERENT passes. Pass 2 has the
  // cheapest short leg because the JIT was warm by then; its long leg is the slowest of the five
  // because the 2000-sample working set provokes the GC that the 500-sample one does not. Pass 0
  // holds the cheapest long leg. No single pass ever ran at x8.
  const CI_PAIRS = [
    { shortElapsedMs: 24.4, longElapsedMs: 107.8 },
    { shortElapsedMs: 22.1, longElapsedMs: 109.5 },
    { shortElapsedMs: 13.2, longElapsedMs: 112.0 },
    { shortElapsedMs: 21.5, longElapsedMs: 108.4 },
    { shortElapsedMs: 23.0, longElapsedMs: 110.1 },
  ] as const;

  it("earns the ratio from one pass, not from each leg's own minimum", () => {
    // What the gate used to compute: the cheapest long over the cheapest short, two windows that
    // never coexisted. It clears the bound and convicts an innocent tree.
    const unpaired = Math.min(...CI_PAIRS.map((pair) => pair.longElapsedMs))
      / Math.min(...CI_PAIRS.map((pair) => pair.shortElapsedMs));
    expect(unpaired).toBeCloseTo(8.17, 2);
    expect(unpaired).toBeGreaterThan(STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH);

    const verdict = reduceStudioBrushCrayonFamilyGrowth(CI_PAIRS);
    expect(verdict.growth).toBeCloseTo(107.8 / 24.4, 10);
    expect(verdict.growth).toBeLessThanOrEqual(STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH);
    // The legs it reports are the two that actually produced the verdict, so the printed
    // diagnostic is one coherent observation rather than a pair assembled after the fact.
    expect(verdict.shortElapsedMs).toBe(24.4);
    expect(verdict.longElapsedMs).toBe(107.8);
  });

  it("still convicts a genuinely superlinear plan, which fails on every pass", () => {
    // x16 is the quadratic blowup at these lengths -- the class the gate exists for. Pairing
    // cannot acquit it, because no pass is clean.
    const quadratic = CI_PAIRS.map((pair) => ({
      shortElapsedMs: pair.shortElapsedMs,
      longElapsedMs: pair.shortElapsedMs * 16,
    }));
    const { growth } = reduceStudioBrushCrayonFamilyGrowth(quadratic);
    expect(growth).toBeCloseTo(16, 10);
    expect(growth).toBeGreaterThan(STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH);
  });

  it("lets one clean pass acquit a row the contended passes would convict", () => {
    // Interference is additive, so the least-disturbed pair is the honest one -- the same rule
    // the CPU reducer already applies, now applied to the pair rather than to each leg alone.
    const contended = [
      { shortElapsedMs: 20.0, longElapsedMs: 200.0 },
      { shortElapsedMs: 20.0, longElapsedMs: 88.0 },
      { shortElapsedMs: 20.0, longElapsedMs: 260.0 },
    ];
    expect(reduceStudioBrushCrayonFamilyGrowth(contended).growth).toBeCloseTo(4.4, 10);
  });

  it("reports every pass's ratio cheapest-first so a row near the bound is visible", () => {
    const { growthPasses, growth } = reduceStudioBrushCrayonFamilyGrowth(CI_PAIRS);
    expect(growthPasses).toHaveLength(CI_PAIRS.length);
    expect([...growthPasses]).toEqual([...growthPasses].sort((a, b) => a - b));
    expect(growthPasses[0]).toBeCloseTo(growth, 10);
    // Pass 2's own ratio is the one that looks alarming, and it is printed rather than hidden
    // behind the winner: 112.0 / 13.2 is the reading a real regression would make permanent.
    expect(growthPasses[growthPasses.length - 1]).toBeCloseTo(112.0 / 13.2, 10);
  });

  it("refuses a verdict with no passes, and survives a zero-length short leg", () => {
    expect(() => reduceStudioBrushCrayonFamilyGrowth([])).toThrow(/at least one paired pass/u);
    expect(
      reduceStudioBrushCrayonFamilyGrowth([{ shortElapsedMs: 0, longElapsedMs: 90 }]).growth,
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("studioBrushCrayonFamilyCpuFreezes", () => {
  it("acquits every honest reading, on an idle machine and a heavily contended one", () => {
    expect(studioBrushCrayonFamilyCpuFreezes([...HONEST_CRAYON])).toBe(false);
    expect(studioBrushCrayonFamilyCpuFreezes([...HONEST_LIGHTEST])).toBe(false);
    // Even one pass at the worst honest reading, with nothing cheaper to rescue it.
    expect(studioBrushCrayonFamilyCpuFreezes([Math.max(...HONEST_CRAYON)])).toBe(false);
  });

  it("convicts a doubled crayon plan on both of those machines", () => {
    // The gate must not have been loosened into a no-op. A 2x regression puts the heaviest row at
    // 234-383ms against a 210ms budget -- caught at its CHEAPEST pass on either machine, so no
    // lucky pass and no lucky runner rescues it. The wall-clock form this replaces convicted the
    // same doubling only when the box was idle: 2 x 84ms wall cleared a 200ms number.
    expect(studioBrushCrayonFamilyCpuFreezes(HONEST_CRAYON.map((ms) => ms * 2))).toBe(true);
    expect(Math.min(...HONEST_CRAYON) * 2)
      .toBeGreaterThan(STUDIO_BRUSH_CRAYON_FAMILY_LONG_CPU_BUDGET_MS);
    // ...and it is not only a doubling: the smallest regression it still convicts.
    expect(
      STUDIO_BRUSH_CRAYON_FAMILY_LONG_CPU_BUDGET_MS / Math.min(...HONEST_CRAYON),
    // 1.80, not the 1.5 a single machine's population suggested: the budget has to clear the
    // slowest machine this runs on, and buying more headroom than that would cost the doubling.
    ).toBeLessThan(1.85);
  });

  it("requires the CHEAPEST pass to be over budget, so one preempted pass cannot convict", () => {
    // The failure mode this reducer exists for: four honest passes and one that ran during a
    // collection. A maximum, or any single sample, would call that a freeze.
    expect(studioBrushCrayonFamilyCpuFreezes([118, 121, 640, 117, 119])).toBe(false);
    // ...while a series that is over budget throughout is convicted however many passes it gets.
    // These are the recorded honest readings doubled, so this is the regression itself and not an
    // arbitrary series: every pass is over, and so is the cheapest.
    expect(studioBrushCrayonFamilyCpuFreezes(HONEST_CRAYON.map((ms) => ms * 2))).toBe(true);
    expect(studioBrushCrayonFamilyCpuFreezes([234, 640, 261, 247, 383])).toBe(true);
    expect(studioBrushCrayonFamilyCpuFreezes([211, 211])).toBe(true);
    expect(studioBrushCrayonFamilyCpuFreezes([211, 209])).toBe(false);
    // The runner's own honest reading must not convict, which is the failure that set this budget.
    expect(studioBrushCrayonFamilyCpuFreezes([191.5])).toBe(false);
  });

  it("is not evidence of anything without a pass", () => {
    expect(() => studioBrushCrayonFamilyCpuFreezes([])).toThrow(/at least one pass/);
  });

  it("keeps the wall-clock ceiling a hang detector, not a second budget", () => {
    // Worst single wall pass observed under heavy load was 611ms, against a min-of-5 wall spread
    // of 89-210ms. The ceiling has to sit clear of that whole population or it becomes the
    // load-dependent gate this change removed.
    expect(STUDIO_BRUSH_CRAYON_FAMILY_LONG_WALL_BLOWUP_MS).toBeGreaterThan(611 * 3);
  });
});

describe("reduceStudioBrushCrayonFamilyPasses", () => {
  /**
   * One long-stroke pass. `cpuMs` is deliberately optional: the evaluator returns BEFORE it
   * samples the CPU clock when the causal planner rejects, which is the whole hazard this
   * reducer has to survive.
   */
  const pass = (
    overrides: Partial<StudioBrushCataloguePerfRow> = {},
  ): StudioBrushCataloguePerfRow => ({
    catalogId: "crayon",
    path: "causal-coverage",
    engine: "dynamic-dabs",
    dynamicsPreset: "crayon",
    sampleCount: 1_024,
    dabCount: 4_096,
    markCount: 61_440,
    elapsedMs: 140,
    cpuMs: 124,
    ok: true,
    failure: null,
    freeze: false,
    digest: "d0",
    ...overrides,
  });

  it("reports the cheapest pass, because contention only ever adds CPU", () => {
    const reduced = reduceStudioBrushCrayonFamilyPasses([
      pass({ cpuMs: 191.5, elapsedMs: 611 }),
      pass({ cpuMs: 123.8, elapsedMs: 140 }),
      pass({ cpuMs: 130.4, elapsedMs: 158 }),
    ]);
    expect(reduced.cpuMs).toBe(123.8);
    expect(reduced.elapsedMs).toBe(140);
    expect(reduced.ok).toBe(true);
    expect(reduced.freeze).toBe(false);
  });

  it("condemns a row when ANY pass failed, even though that pass has no cpuMs to win with", () => {
    // The hazard: a causal-planning rejection returns before the CPU clock is read, so it scores
    // `Infinity` and can never become the cheapest pass. Reading `ok` off that winner would let
    // an intermittent product-path failure ship a fully green matrix.
    const reduced = reduceStudioBrushCrayonFamilyPasses([
      pass({ cpuMs: 123.8 }),
      pass({ cpuMs: undefined, elapsedMs: 3, ok: false, failure: "seed-drift", digest: null }),
      pass({ cpuMs: 130.4 }),
    ]);
    expect(reduced.cpuMs).toBe(123.8);
    expect(reduced.ok).toBe(false);
    expect(reduced.failure).toBe("seed-drift");
  });

  it("condemns a failing pass that DOES carry cpuMs and is not the cheapest", () => {
    // The coverage-rejection path samples the clock before returning, so this row is eligible to
    // lose the minimum on its own merits. It must still condemn.
    const reduced = reduceStudioBrushCrayonFamilyPasses([
      pass({ cpuMs: 118 }),
      pass({ cpuMs: 260, ok: false, failure: "mark-budget-exhausted", digest: null }),
    ]);
    expect(reduced.cpuMs).toBe(118);
    expect(reduced.ok).toBe(false);
    expect(reduced.failure).toBe("mark-budget-exhausted");
  });

  it("keeps a clean row clean and preserves the winner's own failure when it is the failing one", () => {
    expect(reduceStudioBrushCrayonFamilyPasses([pass(), pass()]).failure).toBeNull();
    const allFailed = reduceStudioBrushCrayonFamilyPasses([
      pass({ cpuMs: 118, ok: false, failure: "seed-drift" }),
    ]);
    expect(allFailed.ok).toBe(false);
    expect(allFailed.failure).toBe("seed-drift");
  });

  it("accumulates the wall-clock hang detector across every pass", () => {
    // A cold or periodically initialising pass can blow the ceiling while a later warm pass costs
    // less CPU and wins the sample. Reading `freeze` off the winner alone would drop that stall.
    const reduced = reduceStudioBrushCrayonFamilyPasses([
      pass({ cpuMs: 400, elapsedMs: 2_400, freeze: true }),
      pass({ cpuMs: 123.8, elapsedMs: 140, freeze: false }),
    ]);
    expect(reduced.elapsedMs).toBe(140);
    expect(reduced.freeze).toBe(true);
  });

  it("still folds in the CPU freeze verdict, so it has not been loosened into a correctness-only check", () => {
    const doubled = HONEST_CRAYON.map((ms) => reduceStudioBrushCrayonFamilyPasses([pass({ cpuMs: ms * 2 })]));
    expect(doubled.every((row) => row.freeze)).toBe(true);
    expect(
      reduceStudioBrushCrayonFamilyPasses(HONEST_CRAYON.map((ms) => pass({ cpuMs: ms }))).freeze,
    ).toBe(false);
    expect(
      reduceStudioBrushCrayonFamilyPasses(HONEST_CRAYON.map((ms) => pass({ cpuMs: ms * 2 }))).freeze,
    ).toBe(true);
  });

  it("is not evidence of anything without a pass", () => {
    expect(() => reduceStudioBrushCrayonFamilyPasses([])).toThrow(/at least one pass/);
  });
});

describe("studio brush catalogue paint performance matrix", () => {
  it("exercises every shipped paint catalogue id on product planner paths", () => {
    const report = evaluateStudioBrushCataloguePaintPerfMatrix();

    expect(report.paintCatalogCount).toBe(STUDIO_PAINT_BRUSH_CATALOG_ITEMS.length);
    expect(report.rowCount).toBe(STUDIO_PAINT_BRUSH_CATALOG_ITEMS.length);
    expect(report.missingCatalogIds).toEqual([]);
    expect(new Set(report.rows.map((row) => row.catalogId)).size).toBe(
      STUDIO_PAINT_BRUSH_CATALOG_ITEMS.length,
    );

    const failures = report.rows.filter((row) => !row.ok);
    const freezes = report.rows.filter((row) => row.freeze);
    expect(failures, JSON.stringify(failures.slice(0, 8))).toEqual([]);
    expect(freezes, JSON.stringify(freezes.slice(0, 8))).toEqual([]);

    // How much work each crayon-family row plans, pinned exactly.
    //
    // This is the half of the freeze gate that owes nothing to a clock. The plan is deterministic
    // -- the determinism probe below proves the digests repeat -- so these counts are identical on
    // every machine under every load, and a regression that makes a planner emit more geometry is
    // convicted here exactly, for all five brushes, including the four whose CPU budget has slack.
    // Recorded on the reference container and reproduced unchanged idle and under six spinning
    // hogs on four cores.
    const PLANNED_WORK: Readonly<Record<string, readonly [number, number]>> = {
      crayon: [3_538, 11_231],
      chalk: [2_000, 10_000],
      charcoal: [1_979, 9_895],
      pastel: [1_658, 8_290],
      "oil-pastel": [2_295, 11_475],
    };
    expect(Object.keys(PLANNED_WORK).sort()).toEqual([...STUDIO_BRUSH_CRAYON_FAMILY_IDS].sort());
    for (const family of report.crayonFamily) {
      expect(family.ok, `${family.catalogId}: ${family.failure}`).toBe(true);
      expect(
        family.freeze,
        `${family.catalogId}: ${family.cpuMs?.toFixed(1)}ms CPU / ${family.elapsedMs}ms wall`,
      ).toBe(false);
      const [dabCount, markCount] = PLANNED_WORK[family.catalogId]!;
      expect(family.dabCount, `${family.catalogId} dabs`).toBe(dabCount);
      expect(family.markCount, `${family.catalogId} marks`).toBe(markCount);
      // The verdict has to have been measured: a row reporting no CPU cost would pass the freeze
      // gate by saying nothing, which is the one failure this whole mechanism exists to prevent.
      expect(family.cpuMs, `${family.catalogId} cpu`).toBeGreaterThan(0);
      expect(family.cpuMs!).toBeLessThanOrEqual(STUDIO_BRUSH_CRAYON_FAMILY_LONG_CPU_BUDGET_MS);
      expect(family.elapsedMs).toBeLessThan(STUDIO_BRUSH_CRAYON_FAMILY_LONG_WALL_BLOWUP_MS);
      // SCALING, a separate property from the CPU budget above and machine-immune where that one
      // is not -- but only because the ratio is earned from PAIRED windows and reduced per pass.
      // See STUDIO_BRUSH_CRAYON_FAMILY_SHORT_SAMPLES for why both are wanted, and
      // reduceStudioBrushCrayonFamilyGrowth for what happens when the pairing is dropped.
      expect(
        family.growth,
        `${family.catalogId}: wall cost grew x${family.growth.toFixed(2)} from`
          + ` ${STUDIO_BRUSH_CRAYON_FAMILY_SHORT_SAMPLES} to`
          + ` ${STUDIO_BRUSH_CRAYON_FAMILY_LONG_SAMPLES} samples`
          + ` (${family.shortElapsedMs.toFixed(1)}ms -> ${family.longElapsedMs.toFixed(1)}ms),`
          + ` allowed x${STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH};`
          + " linear in the input would be x4, and this bound is twice that."
          + ` Per-pass ratios: [${family.growthPasses.map((r) => `x${r.toFixed(2)}`).join(" ")}]`,
      ).toBeLessThanOrEqual(STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH);
    }

    // Printed every run, passing or not. This gate has no runner reading yet, and a bound is only
    // tightened honestly from two machine classes; printing is how the second one arrives without
    // a red build being the messenger.
    process.stdout.write(
      `\ncrayon-family plan scaling (${STUDIO_BRUSH_CRAYON_FAMILY_SHORT_SAMPLES} -> `
      + `${STUDIO_BRUSH_CRAYON_FAMILY_LONG_SAMPLES} samples, allowed x`
      + `${STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH})\n`
      + report.crayonFamily
        .map((family) =>
          `  ${family.catalogId.padEnd(12)} x${family.growth.toFixed(2)}`
          + `  ${family.shortElapsedMs.toFixed(1)}ms -> ${family.longElapsedMs.toFixed(1)}ms`
          + `  convicts from x${
            (STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH / family.growth).toFixed(2)
          }`
          // Every pass, not just the winner: a row one contended pass away from the bound is
          // invisible in a single reduced number, and that is the reading this gate wants next.
          + `  passes [${family.growthPasses.map((r) => r.toFixed(2)).join(" ")}]`)
        .join("\n")
      + "\n",
    );

    expect(report.determinism.probeCount).toBe(
      listStudioBrushCatalogueDeterminismSampleIds().length,
    );
    expect(report.determinism.probeCount).toBeGreaterThanOrEqual(
      STUDIO_BRUSH_CRAYON_FAMILY_IDS.length,
    );
    expect(report.determinism.nonDeterministicIds).toEqual([]);
    expect(report.determinism.deterministicCount).toBeGreaterThan(0);
    expect(
      report.determinism.deterministicCount + report.determinism.unmeasuredCount,
    ).toBe(report.determinism.probeCount);

    expect(report.ok).toBe(true);
  });

  it("replays identical same-seed digests and feeds honest bench receipts", () => {
    const packById = new Map(
      materializeAllStudioBrushPackSelections().map((selection) => [
        selection.catalogId,
        selection,
      ]),
    );

    // Mixed planner paths: causal coverage (crayon), dynamic dabs (airbrush), pro pack (core-round).
    for (const catalogId of ["crayon", "airbrush", "core-round"]) {
      const probe = evaluateStudioBrushCataloguePaintDeterminismProbe(catalogId, { packById });
      expect(probe.planOk, catalogId).toBe(true);
      expect(probe.digestFirst, catalogId).not.toBeNull();
      expect(probe.deterministic, catalogId).toBe(true);

      const receipt = computeStudioBrushQualityReceiptSkeleton(catalogId, probe.benchMeasurement);
      expect(receipt.status).toBe("bench");
      expect(receipt.determinismScore, catalogId).toBe(1);
      expect(receipt.performanceScore, catalogId).toBeGreaterThan(0);
      expect(receipt.performanceScore, catalogId).toBeLessThanOrEqual(1);
      expect(receipt.textureScore).toBeNull();
      expect(receipt.totalScore).toBeNull();
    }

    // Contract-only path plans no geometry: determinism stays unmeasured instead of failing.
    const contractOnly = evaluateStudioBrushCataloguePaintDeterminismProbe("pen", { packById });
    expect(contractOnly.planOk).toBe(true);
    expect(contractOnly.digestFirst).toBeNull();
    expect(contractOnly.deterministic).toBeNull();
    const contractOnlyReceipt = computeStudioBrushQualityReceiptSkeleton(
      "pen",
      contractOnly.benchMeasurement,
    );
    expect(contractOnlyReceipt.determinismScore).toBeNull();
    expect(contractOnlyReceipt.pendingAxes).toContain("determinism");
    expect(contractOnlyReceipt.performanceScore).not.toBeNull();
  });

  it.each(STUDIO_BRUSH_CRAYON_FAMILY_IDS)(
    "keeps %s long-stroke incremental coverage under freeze budgets",
    (catalogId) => {
      const result = evaluateStudioBrushCrayonFamilyIncrementalChunks(catalogId);
      expect(result.ok, catalogId).toBe(true);
      // `freeze` is decided from the chunk SERIES, not the single worst chunk: a max over dozens
      // of chunks is tripped by any one preempted by the scheduler (measured on CI at 46.3ms
      // against 33ms, on a commit touching no brush code). More than one over-budget chunk, or a
      // single catastrophic one, is still a freeze.
      expect(result.freeze, `${catalogId} maxChunk=${result.maxChunkMs}`).toBe(false);
      expect(result.totalMs).toBeLessThan(1_500);
      expect(result.chunkCount).toBeGreaterThan(10);
      expect(result.dabCount).toBeGreaterThan(500);
    },
  );

  it("resolves byte-identical recipes through the normalized-settings fast path for every plannable paint id", () => {
    // Byte-identity contract for the causal-walker hotspot optimization: `dabAt` swapped the
    // renormalizing reference resolver for the normalized-settings fast path, so any recipe
    // divergence here would change committed stroke geometry. Reference and optimized recipes are
    // hashed with the same plan-digest idiom the perf rows use (same seed ⇒ same plan hash).
    const packById = new Map(
      materializeAllStudioBrushPackSelections().map((selection) => [
        selection.catalogId,
        selection,
      ]),
    );
    let comparedIds = 0;
    for (const item of STUDIO_PAINT_BRUSH_CATALOG_ITEMS) {
      const dynamics = planStudioBrushCataloguePaintDynamics(item.id, packById);
      if (!dynamics) continue;
      comparedIds += 1;
      const referenceRecipes: StudioBrushDynamicsRecipe[] = [];
      const optimizedRecipes: StudioBrushDynamicsRecipe[] = [];
      for (const sample of RESOLVER_EQUIVALENCE_SAMPLES) {
        const reference = resolveStudioBrushDynamics(sample, dynamics);
        const optimized = resolveStudioBrushDynamicsForNormalizedSettings(sample, dynamics);
        expect(optimized, `${item.id} stampIndex=${sample.stampIndex}`).toStrictEqual(reference);
        referenceRecipes.push(reference);
        optimizedRecipes.push(optimized);
      }
      expect(
        computeStudioBrushPlanDigest(recipeDigestStream(optimizedRecipes)),
        item.id,
      ).toBe(computeStudioBrushPlanDigest(recipeDigestStream(referenceRecipes)));
    }
    expect(comparedIds).toBeGreaterThan(100);
  });

  it("soaks the five slowest catalogue ids without digest drift or monotonic degradation", () => {
    const packById = new Map(
      materializeAllStudioBrushPackSelections().map((selection) => [
        selection.catalogId,
        selection,
      ]),
    );
    for (const catalogId of STUDIO_BRUSH_CATALOGUE_SOAK_IDS) {
      // All five sentinels plan real geometry through the causal-coverage path.
      const row = evaluateStudioBrushCataloguePaintPerfRow(catalogId, { packById });
      expect(row.path, catalogId).toBe("causal-coverage");
      expect(row.digest, catalogId).not.toBeNull();

      const soak = evaluateStudioBrushCataloguePaintSoak(catalogId, { packById });
      expect(soak.runCount).toBe(STUDIO_BRUSH_CATALOGUE_SOAK_RUNS);
      expect(soak.elapsedMs).toHaveLength(STUDIO_BRUSH_CATALOGUE_SOAK_RUNS);
      expect(soak.planOk, catalogId).toBe(true);
      expect(soak.digests.every((digest) => digest !== null), catalogId).toBe(true);
      expect(soak.digestsStable, catalogId).toBe(true);
      expect(
        soak.monotonicDegradation,
        `${catalogId} elapsed=[${soak.elapsedMs.map((ms) => ms.toFixed(2)).join(", ")}]ms`,
      ).toBe(false);
      expect(soak.freezeCount, catalogId).toBe(0);
      expect(soak.ok, catalogId).toBe(true);
    }
  });
});

describe("studioBrushChunkSeriesFreezes", () => {
  const BUDGET = STUDIO_BRUSH_CRAYON_FAMILY_CHUNK_BUDGET_MS;

  it("tolerates exactly one preempted chunk", () => {
    // The recorded CI shape: every chunk inside the budget except one at 46.3ms against 33ms.
    expect(studioBrushChunkSeriesFreezes([5, 6, 5, BUDGET + 13, 6, 5])).toBe(false);
  });

  it("calls a freeze when the budget is exceeded repeatedly", () => {
    // Two is a pattern, not luck: the path itself is too slow.
    expect(studioBrushChunkSeriesFreezes([5, BUDGET + 2, 6, BUDGET + 3, 5])).toBe(true);
  });

  it("calls a freeze on a single catastrophic chunk", () => {
    // A lone chunk far past the budget is a real multi-frame stall however rare, so tolerance for
    // one preempted chunk must not cover it.
    expect(studioBrushChunkSeriesFreezes([5, 6, BUDGET * 2 + 1, 5])).toBe(true);
  });

  it("excludes the FIRST chunk, which is cold-start work rather than a steady-state chunk", () => {
    // Measured after review raised it and after this gate went red on CI and on a 4-vCPU
    // container: crayon plans 28 chunks, the most expensive costs 167.7ms and the other 27
    // average ~12ms. That one is the cold chunk — ~14x its own steady state and 5x a budget meant
    // for steady-state work — so grading it here reddened on entirely honest work.
    expect(studioBrushChunkSeriesFreezes([BUDGET * 5, 6, 5, 6, 5])).toBe(false);
    // Everything after it is graded exactly as before.
    expect(studioBrushChunkSeriesFreezes([BUDGET * 5, BUDGET + 2, BUDGET + 3, 5])).toBe(true);
    expect(studioBrushChunkSeriesFreezes([BUDGET * 5, BUDGET * 2 + 1, 5])).toBe(true);
    // A series that is nothing but a cold chunk has no steady state to judge, so it abstains.
    expect(studioBrushChunkSeriesFreezes([BUDGET * 5])).toBe(false);
  });

  it("is false for a healthy series and abstains on an empty one", () => {
    expect(studioBrushChunkSeriesFreezes([5, 6, 7, 8])).toBe(false);
    expect(studioBrushChunkSeriesFreezes([])).toBe(false);
  });
});
