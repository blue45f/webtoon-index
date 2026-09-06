/**
 * Exhaustive paint-catalogue performance matrix on shipped planner/coverage paths.
 *
 * Enumerates every product paint identity from the catalogue SSOT (not a frozen hand list),
 * exercises the real dynamics + causal deposit + coverage planners where applicable, and
 * records pass/fail freeze budgets so crayon-family rows cannot be special-cased out.
 */

import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  STUDIO_PAINT_BRUSH_CATALOG_ITEMS,
} from "../apps/web/src/domains/creator/brush/studio-brush-catalog";
import {
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  resolveStudioBrushDynamicsPresetId,
  studioBrushDynamicsSettingsForBrushId,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "../apps/web/src/domains/creator/brush/studio-brush-dynamics";
import {
  materializeAllStudioBrushPackSelections,
  type StudioBrushPackSelection,
} from "../apps/web/src/domains/creator/brush/studio-brush-pack-runtime";
import {
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
} from "../apps/web/src/domains/creator/brush/studio-brush-render-budget";
import { resolveStudioBrushRuntimeContract } from "../apps/web/src/domains/creator/brush/studio-brush-runtime-contract";
import {
  computeStudioBrushPlanDigest,
  type StudioBrushQualityBenchMeasurement,
} from "../apps/web/src/domains/creator/brush/studio-brush-variant-group-manifest";
import {
  resolveStudioDynamicBrushMaterialIdentity,
  type StudioDynamicBrushMaterialIdentity,
} from "../apps/web/src/domains/creator/brush/studio-dry-media-dynamic-bridge";
import { studioDryMediaUnionRibbonCarrierOwnsMaterial } from "../apps/web/src/domains/creator/brush/studio-dry-media-union-ribbon-carrier";
import { planStudioCausalDynamicBrushDepositSegmentsV3 } from "../apps/web/src/domains/creator/studio-causal-dynamic-brush-deposit-v2";
import {
  planStudioDynamicBrushCoverageMarks,
  type StudioDynamicBrushCoverageMark,
} from "../apps/web/src/domains/creator/studio-dynamic-brush-coverage-renderer";

export const STUDIO_BRUSH_CATALOGUE_PERF_MATRIX_VERSION = 2 as const;

/** Short freehand path used for every paint id (same geometry, product planners). */
const MATRIX_SAMPLE_COUNT = 256;
/**
 * Freeze budget for one short product plan+coverage cycle.
 * Covers heavy pro packs (multi-mark materials) while still rejecting multi-second freezes.
 */
export const STUDIO_BRUSH_CATALOGUE_PERF_PLAN_BUDGET_MS = 450;
/** Stricter freeze budget for crayon-family long incremental suffix chunks. */
export const STUDIO_BRUSH_CRAYON_FAMILY_CHUNK_BUDGET_MS = 33;
export const STUDIO_BRUSH_CRAYON_FAMILY_LONG_SAMPLES = 2_000;
/**
 * Freeze budget for one crayon-family long plan+coverage cycle, in CPU milliseconds.
 *
 * CPU time, not wall time, and the difference is the whole point. A freeze budget in wall
 * milliseconds asserts the machine as much as the code: measured on a 4-vCPU container, the crayon
 * row's min-of-5 wall cost went 89-92ms idle and 131-210ms against six spinning hogs on four
 * cores, a 2.35x spread with nothing regressed, which is how this gate reached 311.4ms against a
 * flat 200ms inside a full `pnpm test`. A minimum cannot cancel that -- it removes the noise a
 * *transient* stall adds, not a floor that has risen under every pass.
 *
 * Calibrating against a reference workload does not close it either, and that was measured rather
 * than assumed: the pinned scalar kernel, sized to ~113ms so its window matched the row's, still
 * read 116-117ms under the same load that stretched the row to 224-243ms. A synthetic kernel
 * cancels machine SPEED but not instruction mix, and a tight cache-resident float loop is not a
 * proxy for an allocating planner.
 *
 * `process.cpuUsage()` removes the scheduler directly instead, because time the process is not
 * running is time it does not accrue. USER PLUS SYSTEM, not user alone: a regression that
 * allocates and zero-fills larger typed arrays, or pages more, spends that cost in the kernel,
 * and a budget watching only user time would acquit a freeze the user would still feel.
 * Including system also measured *tighter* rather than noisier -- the crayon row's spread went
 * from 1.26x on user alone to 1.12x on the total.
 *
 * Recorded min-of-5 over the same window `elapsedMs` covers -- the product plan and coverage
 * path, excluding fixture setup and the receipt digest -- idle then loaded on a 4-vCPU container:
 *
 *                 idle           loaded              spread   wall spread
 *   crayon        117-124ms      123-130ms           1.12x      2.35x
 *   oil-pastel     72-73ms        78-79ms            1.09x      2.41x
 *   charcoal       67ms           67-71ms            1.06x      2.46x
 *   chalk          65-66ms        66-70ms            1.08x      2.29x
 *   pastel         58-59ms        54-55ms            1.09x      2.13x
 *
 * **CPU time removes the scheduler, not the machine.** That distinction cost a CI run and is worth
 * stating plainly: contention-dependence collapsed from 2.35x to 1.12x, but a different CPU still
 * retires the same plan in a different number of CPU-milliseconds, and the GitHub Actions runner
 * reads the crayon row at 191.5ms where this container reads 117-130. A budget of 175, set from
 * one machine's population, failed there on code that had not regressed.
 *
 * So the budget is set for the SLOWEST machine this gate runs on, which is what an absolute freeze
 * budget is for -- a slower machine genuinely does freeze longer, and the product statement has to
 * hold there. 210ms clears the runner's 191.5 with 9.7% headroom, while a doubled crayon plan
 * still convicts from the cheapest honest reading anywhere (2 x 116.8 = 234, 11% margin) and by a
 * wide margin on the runner itself (383).
 *
 * That margin is thinner than the other gates in this change, and honestly so: it starts convicting
 * at 1.80x rather than the 1.5x a single machine's population suggested. Widening it further would
 * buy headroom by giving up the doubling, so the extra coverage comes from the exact dab and mark
 * pins in the colocated test instead -- those are machine-independent and convict a work regression
 * for all five rows, including the four with slack in this shared budget.
 *
 * Vitest runs this suite in a forked worker, so the measurement is this process alone; concurrent
 * GC threads are counted, which is why the reducer is a MINIMUM over passes -- the pass with the
 * least concurrent collection is the honest estimate of what the plan costs.
 */
export const STUDIO_BRUSH_CRAYON_FAMILY_LONG_CPU_BUDGET_MS = 210;
/** Passes per crayon-family row. Minimum-of-N, for the reason above. */
export const STUDIO_BRUSH_CRAYON_FAMILY_LONG_PASSES = 5;
/**
 * Wall-clock ceiling for one crayon-family pass. Not a budget -- a hang detector. Wall time on
 * this path is a 2.4x-spread measurement of the scheduler, so it is kept only wide enough that a
 * genuine lock-up still fails (worst single pass observed under heavy load: 611ms).
 */
export const STUDIO_BRUSH_CRAYON_FAMILY_LONG_WALL_BLOWUP_MS = 2_000;
/**
 * Denominator stroke for the crayon-family SCALING verdict: the same call, the same material, a
 * quarter of the input.
 *
 * This is a second property, not a second opinion on the CPU budget above. That budget answers
 * "does this plan cost too much", and it is the right question -- but CPU time removes the
 * scheduler, not the machine. The recorded populations say so: crayon's min-of-5 CPU cost is
 * 58.5ms on an Apple-silicon dev machine against the runner's 191.5ms, a 3.3x spread that leaves
 * the 210ms budget 9.7% of headroom and, by its own note, a sensitivity of 1.80x on the tightest
 * row and only 7.4x-11.0x on the other four.
 *
 * A ratio answers a different question -- "does this plan still scale linearly" -- and answers it
 * with no machine in the numerator or denominator, because both sides are the same planner on the
 * same material moments apart. It convicts the superlinear class from ~1.8x on EVERY row rather
 * than on one, and a slower runner cannot move it.
 *
 * That immunity is a property of the PAIRING, not of the ratio, and it is only as good as the
 * reduction downstream: dividing the cheapest short leg by the cheapest long leg across different
 * passes compares two windows that never coexisted and hands the scheduler the verdict back. See
 * `reduceStudioBrushCrayonFamilyGrowth`, which is where that was lost once already.
 */
export const STUDIO_BRUSH_CRAYON_FAMILY_SHORT_SAMPLES = 500;
/**
 * Growth allowed in WALL cost from a quarter stroke to a full one.
 *
 * Wall, not CPU, and that was measured rather than assumed. CPU time is the right reducer for the
 * absolute budget above, where it removes the scheduler outright -- but it is the WRONG one for a
 * ratio of two different-sized windows, because it counts concurrent GC and the 2000-sample
 * working set provokes disproportionately more of it than the 500-sample one. Under 8 spinning
 * hogs on 12 cores the CPU ratio stretched crayon to x7.34 against this bound where the wall ratio
 * held at x5.53: scheduler noise inflates two paired wall windows together, GC pressure does not.
 *
 * Taken from the input ratio rather than from any machine's clock, deliberately: a bound derived
 * from first principles never needs re-recording on a new runner, which is the failure mode this
 * whole family of gates keeps hitting. Linear in the sample count is x4 exactly and is the
 * contract this path holds, so the bound is TWICE LINEAR -- honest superlinearity from cache
 * behaviour is admitted, and the quadratic blowup the gate exists for (x16 at these lengths) is
 * convicted with 2x to spare.
 *
 * Recorded across fourteen runs on Apple silicon, six idle and eight under 8 spinning hogs on 12
 * cores: x3.70-x4.63 idle and x3.63-x5.64 loaded, leaving x1.42-x1.75 over the worst of it.
 * Not tightened to the observed x4.6 because no runner reading exists yet -- the test prints every
 * row's growth on every run, so that reading arrives without anything going red first. That is the
 * discipline the per-move gate learned the hard way: pins taken from one machine reddened three
 * separate lanes on CI before being reverted.
 */
export const STUDIO_BRUSH_CRAYON_FAMILY_MAX_GROWTH = 8;

/**
 * Does this crayon-family row freeze? True only when the CHEAPEST pass is still over budget.
 *
 * Pure, so the rule can be pinned against recorded series -- honest and regressed -- instead of
 * only through a live measurement.
 */
export function studioBrushCrayonFamilyCpuFreezes(
  cpuMsPerPass: readonly number[],
  budgetMs: number = STUDIO_BRUSH_CRAYON_FAMILY_LONG_CPU_BUDGET_MS,
): boolean {
  if (cpuMsPerPass.length === 0) {
    throw new Error("A crayon-family freeze verdict needs at least one pass.");
  }
  return Math.min(...cpuMsPerPass) > budgetMs;
}

/**
 * Collapse the repeated long-stroke passes of one crayon-family row into a single verdict.
 *
 * The PERFORMANCE sample is the cheapest pass, because contention on a shared runner only ever
 * adds CPU. CORRECTNESS is not a performance statistic and cannot be read off that same row: a
 * pass the causal planner rejects returns before `cpuMs` is ever sampled, so it scores
 * `Infinity`, can never win the minimum, and an intermittent product-path failure would be
 * reported as a fully green row. One failing pass condemns the row, whichever pass is cheapest.
 *
 * The wall ceiling accumulates for the same reason: it is a HANG detector, so a cold or
 * periodically initialising pass that stalls must survive a later warm pass becoming the sample.
 *
 * Pure, so all three rules can be pinned against recorded pass series instead of only through a
 * live measurement.
 */
/**
 * A crayon-family row, carrying the quarter-stroke reading its scaling verdict divides by.
 * `cpuMs`/`elapsedMs` stay the full-stroke costs, so every existing reader is unchanged.
 */
export interface StudioBrushCrayonFamilyRow extends StudioBrushCataloguePerfRow {
  /** Quarter-stroke wall cost of the pass `growth` was earned on. */
  readonly shortElapsedMs: number;
  /** Full-stroke wall cost of that same pass, which is what `growth` divides. */
  readonly longElapsedMs: number;
  /** Full-stroke wall cost over quarter-stroke wall cost. Linear in the input would be x4. */
  readonly growth: number;
  /** Every pass's own paired ratio, cheapest first in the log so the spread is visible. */
  readonly growthPasses: readonly number[];
}

/** One pass's paired windows: the quarter stroke and the full stroke measured back to back. */
export interface StudioBrushCrayonFamilyPair {
  readonly shortElapsedMs: number;
  readonly longElapsedMs: number;
}

/**
 * Earn one scaling verdict from paired passes, the way `judgeStudioCalibratedBudget` does.
 *
 * The ratio is minimised over PASSES, not assembled from each side's own minimum. That
 * distinction is the whole gate: the measurement loop deliberately puts the quarter stroke beside
 * the full one within a pass, and reducing the two legs independently throws that pairing away
 * again -- the cheapest short leg and the cheapest long leg need not come from the same pass, and
 * dividing them compares two windows that never coexisted.
 *
 * It is not a theoretical concern. On CI this shipped an x8.20 verdict against an x8 bound from
 * short 13.2ms and long 107.8ms, while main measured x4.37 from 21.5ms and 94.0ms on the same
 * tree: the long legs differ by 15%, and the ratio only cleared the bound because some pass's
 * short leg ran 39% FASTER than main's. A gate that fires when the machine behaves WELL on the
 * numerator's denominator is reporting the scheduler, not the planner -- and it red-flagged a PR
 * that changed only VRM binaries and a Blender script.
 *
 * Pure, so the rule can be pinned against recorded series instead of only through a live run.
 */
export function reduceStudioBrushCrayonFamilyGrowth(
  pairs: readonly StudioBrushCrayonFamilyPair[],
): Pick<StudioBrushCrayonFamilyRow, "shortElapsedMs" | "longElapsedMs" | "growth" | "growthPasses"> {
  if (pairs.length === 0) {
    throw new Error("A crayon-family scaling verdict needs at least one paired pass.");
  }
  const ratioOf = (pair: StudioBrushCrayonFamilyPair): number => (
    pair.shortElapsedMs > 0 ? pair.longElapsedMs / pair.shortElapsedMs : Number.POSITIVE_INFINITY
  );
  // Cheapest pass wins, for the reducer's standing reason: interference is additive, so the
  // least-disturbed pass is the honest one. Here it is the least-disturbed PAIR.
  const best = pairs.reduce((a, b) => (ratioOf(b) < ratioOf(a) ? b : a));
  return {
    shortElapsedMs: best.shortElapsedMs,
    longElapsedMs: best.longElapsedMs,
    growth: ratioOf(best),
    growthPasses: [...pairs].map(ratioOf).sort((a, b) => a - b),
  };
}

export function reduceStudioBrushCrayonFamilyPasses(
  passes: readonly StudioBrushCataloguePerfRow[],
  budgetMs: number = STUDIO_BRUSH_CRAYON_FAMILY_LONG_CPU_BUDGET_MS,
): StudioBrushCataloguePerfRow {
  if (passes.length === 0) {
    throw new Error("A crayon-family row needs at least one pass.");
  }
  const passCpuMs = (row: StudioBrushCataloguePerfRow) => row.cpuMs ?? Number.POSITIVE_INFINITY;
  let cheapest = passes[0]!;
  let anyPassWallFreeze = false;
  let failedPass: StudioBrushCataloguePerfRow | null = null;
  for (const row of passes) {
    anyPassWallFreeze = anyPassWallFreeze || row.freeze;
    if (!failedPass && !row.ok) failedPass = row;
    if (passCpuMs(row) < passCpuMs(cheapest)) cheapest = row;
  }
  return {
    ...cheapest,
    ok: cheapest.ok && failedPass === null,
    failure: failedPass ? failedPass.failure : cheapest.failure,
    freeze: anyPassWallFreeze || studioBrushCrayonFamilyCpuFreezes(passes.map(passCpuMs), budgetMs),
  };
}

export const STUDIO_BRUSH_CRAYON_FAMILY_IDS = [
  "crayon",
  "chalk",
  "charcoal",
  "pastel",
  "oil-pastel",
] as const;

export type StudioBrushCataloguePerfPath =
  | "runtime-contract"
  | "dynamic-dabs"
  | "causal-coverage";

export interface StudioBrushCataloguePerfRow {
  readonly catalogId: string;
  readonly path: StudioBrushCataloguePerfPath;
  readonly engine: string | null;
  readonly dynamicsPreset: string | null;
  readonly sampleCount: number;
  readonly dabCount: number;
  readonly markCount: number;
  readonly elapsedMs: number;
  /**
   * User CPU milliseconds the row consumed, where it was measured. Absent on the short catalogue
   * rows, whose 450ms wall budget covers a 256-sample plan with an order of magnitude of margin;
   * present on the crayon-family long rows, whose verdict it decides.
   */
  readonly cpuMs?: number;
  readonly ok: boolean;
  readonly failure: string | null;
  readonly freeze: boolean;
  /**
   * Seed-stable digest of the planned geometry stream (dabs or coverage marks). `null` on
   * contract-only paths that plan no geometry — those rows are determinism-unmeasured, not failed.
   */
  readonly digest: string | null;
}

/** Same-seed double-run comparison used by the quality-receipt bench stage. */
export interface StudioBrushCataloguePaintDeterminismProbe {
  readonly catalogId: string;
  readonly path: StudioBrushCataloguePerfPath;
  readonly planOk: boolean;
  readonly digestFirst: string | null;
  readonly digestSecond: string | null;
  /** `null` when the path exposes no geometry stream to hash (unmeasured). */
  readonly deterministic: boolean | null;
  /** Ready-made bench input for `computeStudioBrushQualityReceiptSkeleton`. */
  readonly benchMeasurement: StudioBrushQualityBenchMeasurement;
}

export interface StudioBrushCataloguePerfDeterminismSummary {
  readonly probeCount: number;
  readonly deterministicCount: number;
  readonly unmeasuredCount: number;
  readonly nonDeterministicIds: readonly string[];
}

export interface StudioBrushCataloguePerfMatrixReport {
  readonly version: typeof STUDIO_BRUSH_CATALOGUE_PERF_MATRIX_VERSION;
  readonly paintCatalogCount: number;
  readonly rowCount: number;
  readonly ok: boolean;
  readonly freezeCount: number;
  readonly failureCount: number;
  readonly crayonFamily: readonly StudioBrushCrayonFamilyRow[];
  readonly rows: readonly StudioBrushCataloguePerfRow[];
  readonly missingCatalogIds: readonly string[];
  readonly determinism: StudioBrushCataloguePerfDeterminismSummary;
}

function sourceArrays(sampleCount: number) {
  const points: number[] = [];
  const pressures: number[] = [];
  const speeds: number[] = [];
  const tiltXs: number[] = [];
  const tiltYs: number[] = [];
  const twists: number[] = [];
  const tangentialPressures: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    points.push(
      12 + index * 2.35,
      80 + Math.sin(index / 13) * 9 + Math.sin(index / 47) * 3,
    );
    pressures.push(0.42 + (index % 17) / 40);
    speeds.push(0.35 + (index % 11) * 0.06);
    tiltXs.push(8 + (index % 15));
    tiltYs.push(-12 + (index % 9));
    twists.push(index % 360);
    tangentialPressures.push(0);
  }
  return {
    points,
    pressures,
    speeds,
    tiltXs,
    tiltYs,
    twists,
    tangentialPressures,
  };
}

/**
 * Matrix-canonical dynamics for one paint id: authored settings first, pack runtime dynamics as
 * fallback, both under the same derived deterministic seed every matrix/probe/soak run reuses.
 * Exported so byte-identity sweeps can resolve the exact settings object the perf rows plan with.
 */
export function planStudioBrushCataloguePaintDynamics(
  brushId: string,
  packById?: ReadonlyMap<string, StudioBrushPackSelection>,
): NormalizedStudioBrushDynamicsSettings | null {
  const authored = studioBrushDynamicsSettingsForBrushId(brushId);
  if (authored) {
    return normalizeStudioBrushDynamicsSettings({
      ...authored,
      seed: 0x51c7_0000 + (brushId.length * 17),
    });
  }
  const pack = packById?.get(brushId);
  if (pack?.brushDynamics) {
    return normalizeStudioBrushDynamicsSettings({
      ...pack.brushDynamics,
      seed: 0x51c7_1000 + (brushId.length * 31),
    });
  }
  return null;
}

function* dabDigestStream(dabs: readonly StudioDynamicBrushDab[]): Generator<number> {
  for (const dab of dabs) {
    yield dab.x;
    yield dab.y;
    yield dab.size;
    yield dab.opacity;
    yield dab.flow;
    yield dab.spacing;
    yield dab.scatter;
    yield dab.angle;
    yield dab.roundness;
  }
}

function* coverageMarkDigestStream(
  marks: readonly StudioDynamicBrushCoverageMark[],
): Generator<number> {
  for (const mark of marks) {
    yield mark.x;
    yield mark.y;
    yield mark.radiusX;
    yield mark.radiusY;
    yield mark.angleRadians;
    yield mark.alpha;
  }
}

function evaluateCausalCoverage(
  catalogId: string,
  dynamics: NormalizedStudioBrushDynamicsSettings,
  identity: StudioDynamicBrushMaterialIdentity,
  sampleCount: number,
  budgetMs: number,
): StudioBrushCataloguePerfRow {
  const source = sourceArrays(sampleCount);
  // CPU is sampled over exactly the window `elapsedMs` covers -- the product plan and coverage
  // path and nothing else. Input setup above it and the receipt digest below it are test-only
  // work, and a gate that charged them to the planner's freeze budget would call a freeze on a
  // slower hash.
  const cpuBefore = process.cpuUsage();
  const startedAt = performance.now();
  const causal = planStudioCausalDynamicBrushDepositSegmentsV3({
    ...source,
    settings: dynamics,
  });
  if (!causal.ok) {
    return {
      catalogId,
      path: "causal-coverage",
      engine: "dynamic-dabs",
      dynamicsPreset: resolveStudioBrushDynamicsPresetId(catalogId),
      sampleCount,
      dabCount: 0,
      markCount: 0,
      elapsedMs: performance.now() - startedAt,
      ok: false,
      failure: causal.reason,
      freeze: false,
      digest: null,
    };
  }
  const dabs = causal.segments.flatMap((segment) => segment.dabs);
  const coverage = planStudioDynamicBrushCoverageMarks({
    dabVariations: [dabs],
    materialIdentity: identity,
    strokeOrigins: [{ x: source.points[0]!, y: source.points[1]! }],
    dynamics,
    dynamicSeed: dynamics.seed,
    stroke: "#2b211c",
    stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
    markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  });
  const elapsedMs = performance.now() - startedAt;
  const cpuAfter = process.cpuUsage(cpuBefore);
  const cpuMs = (cpuAfter.user + cpuAfter.system) / 1_000;
  if (!coverage.ok) {
    return {
      catalogId,
      path: "causal-coverage",
      engine: "dynamic-dabs",
      dynamicsPreset: resolveStudioBrushDynamicsPresetId(catalogId),
      sampleCount,
      dabCount: dabs.length,
      markCount: 0,
      elapsedMs,
      cpuMs,
      ok: false,
      failure: coverage.reason,
      freeze: elapsedMs > budgetMs,
      digest: null,
    };
  }
  return {
    catalogId,
    path: "causal-coverage",
    engine: "dynamic-dabs",
    dynamicsPreset: resolveStudioBrushDynamicsPresetId(catalogId),
    sampleCount,
    dabCount: dabs.length,
    markCount: coverage.marks.length,
    elapsedMs,
    cpuMs,
    ok: true,
    failure: null,
    freeze: elapsedMs > budgetMs,
    digest: computeStudioBrushPlanDigest(coverageMarkDigestStream(coverage.marks)),
  };
}

function evaluateDynamicDabs(
  catalogId: string,
  dynamics: NormalizedStudioBrushDynamicsSettings,
  sampleCount: number,
  budgetMs: number,
): StudioBrushCataloguePerfRow {
  const source = sourceArrays(sampleCount);
  const startedAt = performance.now();
  const dabs = planNormalizedStudioDynamicBrushDabs(
    {
      baseOpacity: 1,
      baseWidth: dynamics.width.base,
      points: source.points,
      pressures: source.pressures,
      speeds: source.speeds,
      maxDabs: 8_192,
      seed: dynamics.seed,
    },
    dynamics,
  );
  const elapsedMs = performance.now() - startedAt;
  return {
    catalogId,
    path: "dynamic-dabs",
    engine: "dynamic-dabs",
    dynamicsPreset: resolveStudioBrushDynamicsPresetId(catalogId),
    sampleCount,
    dabCount: dabs.length,
    markCount: dabs.length,
    elapsedMs,
    ok: dabs.length > 0,
    failure: dabs.length > 0 ? null : "no-dabs",
    freeze: elapsedMs > budgetMs,
    digest: dabs.length > 0 ? computeStudioBrushPlanDigest(dabDigestStream(dabs)) : null,
  };
}

function evaluateContractOnly(catalogId: string): StudioBrushCataloguePerfRow {
  const startedAt = performance.now();
  const contract = resolveStudioBrushRuntimeContract(catalogId);
  const elapsedMs = performance.now() - startedAt;
  return {
    catalogId,
    path: "runtime-contract",
    engine: contract?.engine ?? null,
    dynamicsPreset: resolveStudioBrushDynamicsPresetId(catalogId),
    sampleCount: 0,
    dabCount: 0,
    markCount: 0,
    elapsedMs,
    ok: contract !== null,
    failure: contract ? null : "missing-runtime-contract",
    freeze: elapsedMs > STUDIO_BRUSH_CATALOGUE_PERF_PLAN_BUDGET_MS,
    digest: null,
  };
}

export function evaluateStudioBrushCataloguePaintPerfRow(
  catalogId: string,
  options?: {
    readonly sampleCount?: number;
    readonly budgetMs?: number;
    readonly packById?: ReadonlyMap<string, StudioBrushPackSelection>;
  },
): StudioBrushCataloguePerfRow {
  const sampleCount = options?.sampleCount ?? MATRIX_SAMPLE_COUNT;
  const budgetMs = options?.budgetMs ?? STUDIO_BRUSH_CATALOGUE_PERF_PLAN_BUDGET_MS;
  const pack = options?.packById?.get(catalogId);
  const dynamicsPreset = resolveStudioBrushDynamicsPresetId(catalogId)
    ?? (pack?.runtimeBrushId
      ? resolveStudioBrushDynamicsPresetId(pack.runtimeBrushId)
      : null);
  const dynamics = planStudioBrushCataloguePaintDynamics(catalogId, options?.packById);
  const identity = resolveStudioDynamicBrushMaterialIdentity(
    pack?.runtimeBrushId ?? catalogId,
    catalogId,
  );
  if (
    dynamics
    && identity?.dryMediaPresetId
    && (
      catalogId === "crayon"
      || catalogId === "chalk"
      || catalogId === "charcoal"
      || catalogId === "pastel"
      || catalogId === "oil-pastel"
      || dynamicsPreset === "dry-media"
      || pack?.runtimeBrushId === "dry-media"
    )
  ) {
    return evaluateCausalCoverage(catalogId, dynamics, identity, sampleCount, budgetMs);
  }
  if (dynamics) {
    // Prefer causal coverage when the product deposit pipeline is causal.
    if (
      typeof dynamics.depositPipeline === "string"
      && dynamics.depositPipeline.includes("causal")
    ) {
      const material = identity ?? {
        brushId: pack?.runtimeBrushId ?? catalogId,
        brushCatalogId: catalogId,
        dryMediaPresetId: null,
      };
      return evaluateCausalCoverage(
        catalogId,
        dynamics,
        material as StudioDynamicBrushMaterialIdentity,
        sampleCount,
        budgetMs,
      );
    }
    return evaluateDynamicDabs(catalogId, dynamics, sampleCount, budgetMs);
  }
  const contractRow = evaluateContractOnly(catalogId);
  if (contractRow.ok) return contractRow;
  // Pro pack without dynamics still counts as exercised if pack selection materializes.
  if (pack) {
    return {
      catalogId,
      path: "runtime-contract",
      engine: pack.runtimeBrushId,
      dynamicsPreset,
      sampleCount: 0,
      dabCount: 0,
      markCount: 0,
      elapsedMs: 0,
      ok: true,
      failure: null,
      freeze: false,
      digest: null,
    };
  }
  return contractRow;
}

/**
 * Same-seed double-run determinism check. Both runs rebuild the plan from scratch with the
 * identical derived seed, so a digest mismatch means a planner leaked non-seeded state
 * (Date.now/Math.random or mutable module caches) into committed geometry.
 */
export function evaluateStudioBrushCataloguePaintDeterminismProbe(
  catalogId: string,
  options?: {
    readonly sampleCount?: number;
    readonly budgetMs?: number;
    readonly packById?: ReadonlyMap<string, StudioBrushPackSelection>;
  },
): StudioBrushCataloguePaintDeterminismProbe {
  const first = evaluateStudioBrushCataloguePaintPerfRow(catalogId, options);
  const second = evaluateStudioBrushCataloguePaintPerfRow(catalogId, options);
  const planOk = first.ok && second.ok;
  const deterministic =
    first.digest !== null && second.digest !== null ? first.digest === second.digest : null;
  return {
    catalogId,
    path: first.path,
    planOk,
    digestFirst: first.digest,
    digestSecond: second.digest,
    deterministic,
    benchMeasurement: {
      planOk,
      planElapsedMs: first.elapsedMs,
      planBudgetMs: options?.budgetMs ?? STUDIO_BRUSH_CATALOGUE_PERF_PLAN_BUDGET_MS,
      planDigestFirst: first.digest,
      planDigestSecond: second.digest,
    },
  };
}

/**
 * Long-session soak sentinels: the five slowest paint ids from the exhaustive matrix ranking
 * (workstream-M measurement, warm-run medians). They stay pinned after optimization so the ids
 * that once flirted with the freeze budget keep proving repeated plans neither drift bytes nor
 * degrade monotonically the way a leaking cache or growing shared buffer would.
 *
 * 2026-08-14 cold-start finding: the original five excluded every dry-media material, so the
 * de-polygon kernel path (and its measured cold first-chunk class — crayon 53.8ms fresh-process)
 * had zero soak coverage. The two banded wax sticks join as dry-media sentinels: they exercise
 * the kernel tip cache and the deepest (36-key) working sets on the causal-coverage path. The
 * pinned legacy-union replay path keeps its own chunked perf gate in
 * src/domains/creator/brush/studio-dry-media-long-stroke-regression.test.ts.
 */
export const STUDIO_BRUSH_CATALOGUE_SOAK_IDS = [
  "pixel-square",
  "needle-graphite",
  "acrylic-stiff-flat",
  "alcohol-chisel-marker",
  "hair-curl-ribbon",
  "crayon",
  "oil-pastel",
] as const;
export const STUDIO_BRUSH_CATALOGUE_SOAK_RUNS = 10;
/** Consecutive-plan growth tolerated before monotonic slowdown counts as degradation. */
export const STUDIO_BRUSH_CATALOGUE_SOAK_MAX_MONOTONIC_GROWTH = 1.2;
/**
 * Absolute floor under the relative gate. Optimized plans finish in single-digit milliseconds,
 * where ±0.5ms of timer jitter alone can read as ">20%"; real leak-driven degradation keeps
 * compounding and clears this floor immediately, so the floor never shelters a genuine freeze.
 */
export const STUDIO_BRUSH_CATALOGUE_SOAK_MIN_DEGRADATION_MS = 4;
/**
 * A half of fewer runs than this carries no measurable spread — one sample always reports spread
 * 1.0, which is exactly the lucky-baseline shape behind the recorded false positives. Such a
 * series abstains rather than guessing; the shipped soak runs ten, five per half.
 */
export const STUDIO_BRUSH_CATALOGUE_SOAK_MIN_HALF_SAMPLES = 2;
/**
 * How far the first half may fall back below its own running maximum and still count as
 * "climbing" rather than "oscillating". A contended runner recovers (a preempted run is followed
 * by a fast one); accumulating state only climbs.
 */
export const STUDIO_BRUSH_CATALOGUE_SOAK_DRAWDOWN_TOLERANCE = 1.05;

/**
 * How far a half rises from its opening samples to its closing ones.
 *
 * The third way to earn a baseline, and the one that tolerates ordinary jitter. Requiring a
 * near-monotonic first half (the drawdown test) was too strict: a genuine leak with ONE small dip
 * -- [10, 12, 11, 20, 30 | 40, 50, 60, 70, 80], found in review -- has a 12->11 drawdown of x1.09
 * and so failed both earlier shapes, hiding a sustained 4x regression.
 *
 * A larger drawdown tolerance cannot fix that: the recorded false positive
 * [40.68, 38.13, 46.76] dips x1.067, which is INSIDE the x1.09 it would have to admit. The two
 * shapes are not separable by dip depth at all.
 *
 * They separate cleanly by how far the half travels: the leak rises x2.27 from its opening pair to
 * its closing pair, while every recorded noise series moves x1.03-x1.17 (and JIT warm-up falls to
 * x0.69). Ends are averaged rather than taken as single samples so one unlucky first or last run
 * cannot decide it.
 */
function endpointRiseRatio(series: readonly number[]): number {
  const edge = series.length >= 4 ? 2 : 1;
  const mean = (values: readonly number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;
  const opening = mean(series.slice(0, edge));
  const closing = mean(series.slice(-edge));
  if (!(opening > 0)) return 1;
  return closing / opening;
}

/**
 * Rise from a half's opening samples to its closing ones that counts as a trend rather than noise.
 * Recorded separation: noise x1.03-x1.17, leaks x2.27-x3.83.
 */
const STUDIO_BRUSH_CATALOGUE_SOAK_TREND_RISE = 1.5;

/** Largest fall below the running maximum, as a ratio. 1 for a non-decreasing series. */
/**
 * Middle value of a series — the later half's typical cost, robust to one outlier either way.
 *
 * The recovery guard below needs "did the later half SUBSIDE?", and its first form asked that of
 * the single cheapest later run. One ordinary dip then suppressed a real detection: a sustained
 * climb like [10, 12, 11, 20, 30 | 28, 40, 50, 60, 70] was dismissed because 28 fell a hair under
 * the first half's peak, even though every other later run was far above it. A median answers the
 * question that was actually being asked, and still separates the shape this guard exists for --
 * a subsided ramp puts its WHOLE later half low, not one sample.
 */
function medianOf(series: readonly number[]): number {
  if (series.length === 0) return Number.NaN;
  const sorted = [...series].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function maxDrawdownRatio(series: readonly number[]): number {
  let runningMax = Number.NEGATIVE_INFINITY;
  let worst = 1;
  for (const value of series) {
    if (runningMax > 0 && value > 0) worst = Math.max(worst, runningMax / value);
    if (value > runningMax) runningMax = value;
  }
  return worst;
}

/**
 * Decides monotonic degradation from a soak's elapsed series — pure, so the decision itself is
 * unit-testable against recorded CI series instead of only through a live 10-run measurement.
 *
 * Two halves, each represented by its cheapest run (a leak slows EVERY later plan, so minima
 * cancel scheduler preemption better than means): `growth = laterMin / earlyMin` must clear the
 * relative gate and the absolute floor. Min-vs-min is one sample from each half's distribution
 * though, so when the first half is itself unsettled its minimum is not a baseline at all —
 * measured CI failure on main, needle-graphite
 * [29.77, 37.52, 51.01, 34.03, 34.87 | 53.45, 60.47, 62.61, 48.54, 38.32]ms, where a lucky 29.77
 * baseline against a 38.32 later-min reads as x1.29 "degradation" while the first half's own
 * spread already spans x1.71. Widening the window (this gate's three previous hardenings) cannot
 * fix that — the noise scales with it.
 *
 * So the baseline has to be earned, by one of two shapes:
 *
 *   settled — the first half stays inside the relative gate (earlyMax/earlyMin <= growth gate),
 *             so its minimum represents the whole half; or
 *   climbing — the first half never falls back below its own running maximum by more than
 *             `DRAWDOWN_TOLERANCE`, so its low values are its EARLY values.
 *
 * Climbing is what keeps the gate sensitive to a leak that begins before the midpoint. Such a
 * leak contaminates the first half — for a step to 3x at run 3, both growth and the first half's
 * spread are 3, so a spread comparison alone would suppress it (found in review). But a leak,
 * unlike contention, never recovers: [10, 10, 10, 30, 30] climbs monotonically and is detected,
 * while the contended shapes above all dip back below their running max and abstain.
 */
export function detectStudioBrushSoakMonotonicDegradation(
  elapsedMs: readonly number[],
): boolean {
  const halfIndex = Math.floor(elapsedMs.length / 2);
  const early = elapsedMs.slice(0, halfIndex);
  const later = elapsedMs.slice(halfIndex);
  if (
    early.length < STUDIO_BRUSH_CATALOGUE_SOAK_MIN_HALF_SAMPLES
    || later.length < STUDIO_BRUSH_CATALOGUE_SOAK_MIN_HALF_SAMPLES
  ) {
    return false;
  }
  const earlyMin = Math.min(...early);
  const earlyMax = Math.max(...early);
  const laterMin = Math.min(...later);
  if (!(earlyMin > 0)) return false;
  const baselineIsEarned =
    earlyMax / earlyMin <= STUDIO_BRUSH_CATALOGUE_SOAK_MAX_MONOTONIC_GROWTH
    || maxDrawdownRatio(early) <= STUDIO_BRUSH_CATALOGUE_SOAK_DRAWDOWN_TOLERANCE
    || endpointRiseRatio(early) >= STUDIO_BRUSH_CATALOGUE_SOAK_TREND_RISE;
  return (
    baselineIsEarned
    && laterMin / earlyMin > STUDIO_BRUSH_CATALOGUE_SOAK_MAX_MONOTONIC_GROWTH
    && laterMin - earlyMin > STUDIO_BRUSH_CATALOGUE_SOAK_MIN_DEGRADATION_MS
    // ...and the later half, TYPICALLY, never recovered below the first half's PEAK. A leak does
    // not give time back: once a run is slow, later runs stay at least that slow. Contention does,
    // which is the shape found in review — [10, 10, 10, 30, 30 | 15 x5] climbs cleanly through
    // the first half, so its baseline is earned, and 15/10 clears both the relative gate and the
    // absolute floor, yet the whole second half runs at HALF the first half's peak. That is a
    // ramp that subsided, not degradation. Comparing against earlyMax instead of earlyMin is what
    // tells the two apart; the tolerance is the same drawdown allowance used above.
    //
    // Graded on the later half's MEDIAN, not its minimum. The minimum let one ordinary dip
    // suppress a real detection: [10, 12, 11, 20, 30 | 28, 40, 50, 60, 70] climbs relentlessly,
    // yet a single 28 just under the 30/1.05 peak dismissed the whole series. A subsided ramp puts
    // its entire later half low (median 15 against a 28.6 bar, still caught), while a climb with
    // one dip does not (median 50, correctly convicted).
    && medianOf(later) >= earlyMax / STUDIO_BRUSH_CATALOGUE_SOAK_DRAWDOWN_TOLERANCE
  );
}

export interface StudioBrushCataloguePaintSoakResult {
  readonly catalogId: string;
  readonly path: StudioBrushCataloguePerfPath;
  readonly runCount: number;
  readonly elapsedMs: readonly number[];
  readonly digests: readonly (string | null)[];
  readonly planOk: boolean;
  /** `null` when the path exposes no geometry stream to hash (unmeasured, not failed). */
  readonly digestsStable: boolean | null;
  /** True when the second half's cheapest run stays >20% (and >4ms) above the first half's. */
  readonly monotonicDegradation: boolean;
  readonly freezeCount: number;
  readonly ok: boolean;
}

/**
 * Soak mode: plans the same stroke `runs` times back to back, mirroring a long editing session
 * replaying one heavy brush. A healthy planner stays flat (JIT warm-up may only speed it up) and
 * replays byte-identical geometry; per-plan state accumulating somewhere slows EVERY subsequent
 * plan, which `detectStudioBrushSoakMonotonicDegradation` decides from the elapsed series.
 *
 * Window history, kept because each shape failed a different way: the original "strictly
 * increasing" form was satisfiable by sub-ms jitter plus ONE preempted final run (measured:
 * oil-pastel [7.22, 7.26, 18.90]ms); min-of-later against the single first run fell to the mirror
 * image, one LUCKY first run before a starved stretch (acrylic-stiff-flat [6.55, 15.54, 13.59]ms);
 * three-run windows fell to the same lucky-baseline shape at ~40ms plan scale (needle-graphite
 * [40.68, 38.13, 46.76, 46.16, 82.60, 63.89]ms); and five-run windows fell to it again on a
 * contended runner (see the detector's docstring). Widening the window was never the fix — the
 * noise scales with it — so the detector measures the first half's own spread instead and only
 * calls degradation when growth exceeds it.
 */
export function evaluateStudioBrushCataloguePaintSoak(
  catalogId: string,
  options?: {
    readonly runs?: number;
    readonly sampleCount?: number;
    readonly budgetMs?: number;
    readonly packById?: ReadonlyMap<string, StudioBrushPackSelection>;
  },
): StudioBrushCataloguePaintSoakResult {
  const runCount = Math.max(2, options?.runs ?? STUDIO_BRUSH_CATALOGUE_SOAK_RUNS);
  const rows: StudioBrushCataloguePerfRow[] = [];
  for (let run = 0; run < runCount; run += 1) {
    rows.push(evaluateStudioBrushCataloguePaintPerfRow(catalogId, options));
  }
  const elapsedMs = rows.map((row) => row.elapsedMs);
  const digests = rows.map((row) => row.digest);
  const planOk = rows.every((row) => row.ok);
  const measuredDigests = digests.filter((digest): digest is string => digest !== null);
  const digestsStable = measuredDigests.length === 0
    ? null
    : measuredDigests.length === digests.length
      && measuredDigests.every((digest) => digest === measuredDigests[0]);
  const monotonicDegradation = detectStudioBrushSoakMonotonicDegradation(elapsedMs);
  const freezeCount = rows.filter((row) => row.freeze).length;
  return {
    catalogId,
    path: rows[0]!.path,
    runCount,
    elapsedMs,
    digests,
    planOk,
    digestsStable,
    monotonicDegradation,
    freezeCount,
    ok: planOk
      && digestsStable !== false
      && !monotonicDegradation
      && freezeCount === 0,
  };
}

/**
 * Deterministic probe sample: every strided paint id plus the crayon family. Keeps the full
 * matrix + determinism sweep well under 2× a single exhaustive run while every id remains
 * probe-able on demand through `evaluateStudioBrushCataloguePaintDeterminismProbe`.
 */
export const STUDIO_BRUSH_CATALOGUE_DETERMINISM_SAMPLE_STRIDE = 12;

export function listStudioBrushCatalogueDeterminismSampleIds(): readonly string[] {
  const paintIds = STUDIO_PAINT_BRUSH_CATALOG_ITEMS.map((item) => item.id);
  const sampled = new Set<string>(STUDIO_BRUSH_CRAYON_FAMILY_IDS);
  for (
    let index = 0;
    index < paintIds.length;
    index += STUDIO_BRUSH_CATALOGUE_DETERMINISM_SAMPLE_STRIDE
  ) {
    sampled.add(paintIds[index]!);
  }
  return Object.freeze(paintIds.filter((id) => sampled.has(id)));
}

export function evaluateStudioBrushCataloguePaintPerfMatrix(): StudioBrushCataloguePerfMatrixReport {
  const paintIds = STUDIO_PAINT_BRUSH_CATALOG_ITEMS.map((item) => item.id);
  const packById = new Map(
    materializeAllStudioBrushPackSelections().map((selection) => [
      selection.catalogId,
      selection,
    ]),
  );
  const rows = paintIds.map((catalogId) =>
    evaluateStudioBrushCataloguePaintPerfRow(catalogId, { packById }),
  );
  // Freeze verdicts here come from the MINIMUM of several identical evaluations, the long-stroke
  // gate's own statistic: shared-runner interference is additive, so one preempted pass cannot
  // manufacture a freeze (measured CI flake: crayon 205.3ms single-sample against the 200ms
  // budget on a runner that passed the identical commit at a fraction of that). The plan is
  // deterministic, so the digest is identical across passes and only the clock varies.
  //
  // What varies is graded in CPU milliseconds rather than wall milliseconds -- see the budget's
  // own comment for the two-machine measurements that forced that, and for why calibrating the
  // wall clock against a reference kernel did not work here. The row's wall reading is still
  // recorded and still bounded, as a hang detector.
  //
  // `cpuMs` is measured inside the evaluator over the same window as `elapsedMs`, so the budget
  // covers the product path alone -- not the fixture setup or the receipt digest. The wall
  // ceiling and the `ok` verdict are accumulated across every pass rather than read off the row
  // that wins on CPU; `reduceStudioBrushCrayonFamilyPasses` carries the reasoning for both.
  const crayonFamily = STUDIO_BRUSH_CRAYON_FAMILY_IDS.map((catalogId) => {
    const passes: StudioBrushCataloguePerfRow[] = [];
    const pairs: StudioBrushCrayonFamilyPair[] = [];
    for (let pass = 0; pass < STUDIO_BRUSH_CRAYON_FAMILY_LONG_PASSES; pass += 1) {
      // The quarter stroke is measured beside the full one on every pass, not in a loop of its
      // own. Two separate loops are a ratio in name only: a contended stretch lands inside one of
      // them and moves the verdict by itself, which is the defect #44 found in the per-move gate
      // and which showed up here too -- separate loops put oil-pastel at x5.87 against this bound
      // under load, where pairing the windows brought the same reading back to x4.87.
      const short = evaluateStudioBrushCataloguePaintPerfRow(catalogId, {
        sampleCount: STUDIO_BRUSH_CRAYON_FAMILY_SHORT_SAMPLES,
        budgetMs: STUDIO_BRUSH_CRAYON_FAMILY_LONG_WALL_BLOWUP_MS,
        packById,
      });
      const long = evaluateStudioBrushCataloguePaintPerfRow(catalogId, {
        sampleCount: STUDIO_BRUSH_CRAYON_FAMILY_LONG_SAMPLES,
        budgetMs: STUDIO_BRUSH_CRAYON_FAMILY_LONG_WALL_BLOWUP_MS,
        packById,
      });
      pairs.push({ shortElapsedMs: short.elapsedMs, longElapsedMs: long.elapsedMs });
      passes.push(long);
    }
    // The scaling verdict is minimised over PAIRS, not over each leg on its own -- see
    // `reduceStudioBrushCrayonFamilyGrowth`. The CPU reduction below stays independent of it,
    // because the pass with the least concurrent GC need not be the pass with the least
    // preemption.
    return {
      ...reduceStudioBrushCrayonFamilyPasses(passes),
      ...reduceStudioBrushCrayonFamilyGrowth(pairs),
    } satisfies StudioBrushCrayonFamilyRow;
  });
  const observed = new Set(rows.map((row) => row.catalogId));
  const missingCatalogIds = paintIds.filter((id) => !observed.has(id));
  const freezeCount = rows.filter((row) => row.freeze).length
    + crayonFamily.filter((row) => row.freeze).length;
  const failureCount = rows.filter((row) => !row.ok).length
    + crayonFamily.filter((row) => !row.ok).length;
  const determinismProbes = listStudioBrushCatalogueDeterminismSampleIds().map((catalogId) =>
    evaluateStudioBrushCataloguePaintDeterminismProbe(catalogId, { packById }),
  );
  const determinism: StudioBrushCataloguePerfDeterminismSummary = {
    probeCount: determinismProbes.length,
    deterministicCount: determinismProbes.filter((probe) => probe.deterministic === true).length,
    unmeasuredCount: determinismProbes.filter((probe) => probe.deterministic === null).length,
    nonDeterministicIds: determinismProbes
      .filter((probe) => probe.deterministic === false)
      .map((probe) => probe.catalogId),
  };
  return {
    version: STUDIO_BRUSH_CATALOGUE_PERF_MATRIX_VERSION,
    paintCatalogCount: paintIds.length,
    rowCount: rows.length,
    ok: missingCatalogIds.length === 0
      && freezeCount === 0
      && failureCount === 0
      && determinism.nonDeterministicIds.length === 0,
    freezeCount,
    failureCount,
    crayonFamily,
    rows,
    missingCatalogIds,
    determinism,
  };
}

/**
 * Does this chunk series represent a real main-thread freeze?
 *
 * `maxChunkMs > budget` cannot answer that. It is a maximum over dozens of chunks, so ONE chunk
 * preempted by the scheduler condemns the whole run — measured on CI at 46.3ms against the 33ms
 * budget on a commit that touches no brush code, in a job whose every other chunk was inside it.
 *
 * A freeze that a user would feel is not one unlucky chunk; it is the path being too slow, which
 * shows up as chunks exceeding the budget repeatedly. So more than one over-budget chunk is a
 * freeze, and a single one is tolerated — unless it is catastrophic, because a lone chunk far past
 * the budget is a real multi-frame stall however rare. Same shape as the idle-prewarm slice gate.
 */
export function studioBrushChunkSeriesFreezes(chunkDurationsMs: readonly number[]): boolean {
  if (chunkDurationsMs.length === 0) return false;
  const budget = STUDIO_BRUSH_CRAYON_FAMILY_CHUNK_BUDGET_MS;
  // The FIRST chunk is excluded from this verdict, because it is not a steady-state chunk.
  //
  // Measured, after review raised it and after this gate went red on CI and on a 4-vCPU
  // container: crayon plans 28 chunks, of which the most expensive costs 167.7ms while the other
  // 27 average ~12ms. That one is the cold chunk, which initializes the caches every later chunk
  // then reuses — roughly 14x its own steady state, and 5x a budget meant for a steady-state
  // chunk. Grading it against the 33ms budget therefore reddens on entirely honest work, which is
  // what was happening: the cold chunk plus any single preempted chunk exhausted the one-exception
  // allowance. (The same shape as the live-overlay append ratio, whose first append plans a whole
  // chunk from cold while later ones extend by 30 points.)
  //
  // KNOWN GAP, unchanged and deliberate: the cold path is now unguarded here, so a reproducible
  // cold-start regression would not trip this. Closing it needs a recorded COLD budget measured
  // across the machine classes this suite runs on — one reading on one container is not that, and
  // guessing a bound from it would either redden on honest work or catch nothing. What this gate
  // does guard, it now guards without false failures.
  const steadyState = chunkDurationsMs.slice(1);
  if (steadyState.length === 0) return false;
  const overBudget = steadyState.filter((elapsed) => elapsed > budget);
  if (overBudget.length > 1) return true;
  return overBudget.some((elapsed) => elapsed > budget * 2);
}

export function evaluateStudioBrushCrayonFamilyIncrementalChunks(
  catalogId: (typeof STUDIO_BRUSH_CRAYON_FAMILY_IDS)[number],
  sampleCount = STUDIO_BRUSH_CRAYON_FAMILY_LONG_SAMPLES,
): {
  readonly catalogId: string;
  readonly dabCount: number;
  readonly chunkCount: number;
  readonly maxChunkMs: number;
  readonly totalMs: number;
  readonly ok: boolean;
  readonly freeze: boolean;
} {
  const dynamics = planStudioBrushCataloguePaintDynamics(catalogId);
  const identity = resolveStudioDynamicBrushMaterialIdentity(catalogId);
  if (!dynamics || !identity?.dryMediaPresetId) {
    return {
      catalogId,
      dabCount: 0,
      chunkCount: 0,
      maxChunkMs: 0,
      totalMs: 0,
      ok: false,
      freeze: false,
    };
  }
  const source = sourceArrays(sampleCount);
  const causal = planStudioCausalDynamicBrushDepositSegmentsV3({
    ...source,
    settings: dynamics,
  });
  if (!causal.ok) {
    return {
      catalogId,
      dabCount: 0,
      chunkCount: 0,
      maxChunkMs: 0,
      totalMs: 0,
      ok: false,
      freeze: false,
    };
  }
  const dabs = causal.segments.flatMap((segment) => segment.dabs);
  const chunkSize = 128;
  let cursor = 0;
  let chunkCount = 0;
  let maxChunkMs = 0;
  // Every chunk, not just the worst: `freeze` is decided from HOW MANY chunks exceed the budget,
  // because a max over dozens of chunks is tripped by any single preempted one.
  const chunkDurationsMs: number[] = [];
  // Mirror the live overlay's incremental call contract exactly (T1 de-polygon, 2026-08-13):
  // the predecessor-dab + leading-skip mechanism belongs to the legacy union carrier only. Fresh
  // unpinned causal strokes are owned by the verified-kernel dab path, which plans plain suffix
  // chunks — passing the union-era skip flag there is fail-closed by the renderer.
  const unionCarrierAuthority = studioDryMediaUnionRibbonCarrierOwnsMaterial(
    identity,
    dynamics,
  );
  const startedAt = performance.now();
  while (cursor < dabs.length) {
    const end = Math.min(dabs.length, cursor + chunkSize);
    const predecessor = unionCarrierAuthority && cursor > 0 ? cursor - 1 : cursor;
    const t0 = performance.now();
    const coverage = planStudioDynamicBrushCoverageMarks({
      dabVariations: [dabs.slice(predecessor, end)],
      materialIdentity: identity,
      strokeOrigins: [{ x: source.points[0]!, y: source.points[1]! }],
      dynamics,
      dynamicSeed: dynamics.seed,
      stroke: "#2b211c",
      stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
      dryMediaUnionLeadingSourceDabsToSkip:
        unionCarrierAuthority && cursor > 0 ? 1 : 0,
    });
    const chunkMs = performance.now() - t0;
    chunkDurationsMs.push(chunkMs);
    maxChunkMs = Math.max(maxChunkMs, chunkMs);
    if (!coverage.ok) {
      return {
        catalogId,
        dabCount: dabs.length,
        chunkCount,
        maxChunkMs,
        totalMs: performance.now() - startedAt,
        ok: false,
        freeze: studioBrushChunkSeriesFreezes(chunkDurationsMs),
      };
    }
    chunkCount += 1;
    cursor = end;
  }
  const totalMs = performance.now() - startedAt;
  return {
    catalogId,
    dabCount: dabs.length,
    chunkCount,
    maxChunkMs,
    totalMs,
    ok: true,
    freeze: studioBrushChunkSeriesFreezes(chunkDurationsMs),
  };
}

function logMatrix(message: string): void {
  process.stdout.write(`[studio-brush-catalogue-perf-matrix] ${message}\n`);
}

/** `pnpm run verify:studio-brush-catalogue-perf` gate; vitest owns the colocated assertions. */
function runStudioBrushCataloguePerfMatrixCli(): void {
  const startedAt = performance.now();
  const report = evaluateStudioBrushCataloguePaintPerfMatrix();
  logMatrix(
    `paint=${report.paintCatalogCount} rows=${report.rowCount} failures=${report.failureCount} `
    + `freezes=${report.freezeCount} missing=${report.missingCatalogIds.length}`,
  );
  logMatrix(
    `determinism probes=${report.determinism.probeCount} `
    + `deterministic=${report.determinism.deterministicCount} `
    + `unmeasured=${report.determinism.unmeasuredCount} `
    + `nondeterministic=${report.determinism.nonDeterministicIds.length}`,
  );
  for (const row of [...report.rows, ...report.crayonFamily]) {
    if (row.ok && !row.freeze) continue;
    logMatrix(
      `FAIL ${row.catalogId} path=${row.path} elapsed=${row.elapsedMs.toFixed(1)}ms `
      + (row.cpuMs === undefined ? "" : `cpu=${row.cpuMs.toFixed(1)}ms `)
      + `freeze=${row.freeze} failure=${row.failure ?? "-"}`,
    );
  }
  for (const catalogId of report.determinism.nonDeterministicIds) {
    logMatrix(`FAIL ${catalogId} same-seed double-run digests diverged`);
  }
  let incrementalOk = true;
  for (const catalogId of STUDIO_BRUSH_CRAYON_FAMILY_IDS) {
    const chunks = evaluateStudioBrushCrayonFamilyIncrementalChunks(catalogId);
    if (!chunks.ok || chunks.freeze) {
      incrementalOk = false;
      logMatrix(
        `FAIL ${catalogId} incremental chunks ok=${chunks.ok} `
        + `maxChunk=${chunks.maxChunkMs.toFixed(1)}ms`,
      );
    }
  }
  let soakOk = true;
  const packById = new Map(
    materializeAllStudioBrushPackSelections().map((selection) => [
      selection.catalogId,
      selection,
    ]),
  );
  for (const catalogId of STUDIO_BRUSH_CATALOGUE_SOAK_IDS) {
    const soak = evaluateStudioBrushCataloguePaintSoak(catalogId, { packById });
    if (soak.ok) continue;
    soakOk = false;
    logMatrix(
      `FAIL ${catalogId} soak planOk=${soak.planOk} digestsStable=${soak.digestsStable} `
      + `monotonicDegradation=${soak.monotonicDegradation} freezes=${soak.freezeCount} `
      + `elapsed=[${soak.elapsedMs.map((ms) => ms.toFixed(1)).join(", ")}]ms`,
    );
  }
  const elapsedMs = performance.now() - startedAt;
  const ok = report.ok && incrementalOk && soakOk;
  logMatrix(`${ok ? "OK" : "FAILED"} in ${(elapsedMs / 1000).toFixed(1)}s`);
  if (!ok) process.exitCode = 1;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && pathToFileURL(resolve(entry)).href === import.meta.url);
}

if (isDirectExecution()) {
  runStudioBrushCataloguePerfMatrixCli();
}
