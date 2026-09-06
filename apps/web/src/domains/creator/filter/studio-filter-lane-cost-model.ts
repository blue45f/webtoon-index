/**
 * Size-aware cost model for the image-filter lane ladder (pure module).
 *
 * ## Why this exists
 *
 * The filter island used to pick its head lane from one boolean
 * (`gpuChainEligible`). That is size-blind, and the measured data says size is
 * the dominant term: the GPU lane pays a submit+readback floor that barely
 * moves with the workload, while every CPU lane is linear in pixels × passes.
 * Below the crossover the GPU lane is *slower* than the CPU lanes it is
 * supposed to accelerate.
 *
 * ## Measurement provenance (seed constants below)
 *
 * - source:  tests/benchmarks/results/filter-lanes.json
 * - host:    Apple M2 Max — darwin/arm64, 12 cores, 32 GB, node v24.16.0
 * - date:    2026-08-08T05:54:18.069Z (`generatedAt`)
 * - method:  production code paths (`applyGpuFilterChain` procedure in-page,
 *            `studio-image-filter.worker.ts`, `runImageFilterDirect`, real
 *            `konva` Filters registry) over 256²…4096² × 1/3/6-step chains.
 *            Least-squares fits live in `crossover.costModelSeed`
 *            (r² ≥ 0.956); the measured step thresholds live in
 *            `crossover.thresholdByChain`.
 * - quality: GPU and CPU outputs were bit-identical (max channel delta 0), so
 *            reordering lanes by cost carries no quality risk.
 *
 * The measured per-chain fits are:
 *   gpu-fused-apply : 2.446 + 1.779·MP (1 dispatch) · 2.597 + 1.571·MP (2) ·
 *                     2.172 + 1.917·MP (4)   → ≈ 2.4 fixed, ≈ 1.8/MP
 *   worker-cpu      : 3.696/MP (1 step) · 13.535/MP (3) · 24.823/MP (6)
 *   direct-cpu      : 3.665 · 12.913 · 24.741  (same lane, different host loop)
 *   konva-fallback  : 3.953 · 12.566 · 25.064
 * The three CPU lanes are within measurement noise of each other, which is why
 * this model gives them one shared coefficient: their *relative* order must
 * stay whatever the planner decided, and only GPU-vs-CPU is a real decision.
 *
 * ## Device portability
 *
 * `fixedMs` is the least portable number here — a discrete GPU, a software
 * adapter or a loaded system all move it. So the seed is only ever a
 * cold-start prior: {@link chooseLaneByCost} prefers real per-lane samples
 * (the tournament's `ProviderCostModel`) for any lane that has enough of them,
 * and falls back to the seed lane by lane.
 *
 * ## No hysteresis band here (deliberate)
 *
 * The seed verdict is a pure function of a quantized workload, not of noisy
 * timings, so it cannot flap: the same bucket always yields the same order.
 * A margin would only push the effective threshold away from the measured
 * crossover (it would, for example, wrongly keep the GPU lane at 1024² single,
 * where the benchmark measured 3.6 ms GPU vs 2.93 ms CPU). Noise protection
 * belongs to the *measured* tier instead, via `minMeasuredSamples`.
 */

export type StudioFilterLane = "gpu-chain" | "worker" | "konva-native";

/**
 * Least-squares seed distilled from `crossover.costModelSeed`. Kept as round
 * numbers on purpose: the per-chain fits differ in the third digit, and this
 * model is a prior, not a claim of per-device accuracy. Pinned by
 * studio-filter-lane-cost-model.test.ts against every measured cell.
 */
export const STUDIO_FILTER_LANE_COST_SEED = {
  source: "tests/benchmarks/results/filter-lanes.json",
  measuredOn: "Apple M2 Max (darwin/arm64, 12 cores, 32GB, node v24.16.0)",
  measuredAt: "2026-08-08T05:54:18.069Z",
  gpu: {
    /** Submit + readback floor — paid whatever the size or chain length is. */
    fixedMs: 2.4,
    /** Upload/readback throughput term. */
    perMegapixelMs: 1.8,
    /** Pure-compute add-on per extra dispatch (measured 0.076→0.16 /MP). */
    perMegapixelMsPerDispatch: 0.05,
  },
  cpu: {
    /** Measured intercepts are ±1.5 ms noise around zero — no real floor. */
    fixedMs: 0,
    /** worker/direct/konva all land on ≈3.7 ms per megapixel per pass. */
    perMegapixelMsPerStep: 3.7,
  },
} as const;

/** Minimum measured samples before a lane's real timing outranks the seed. */
export const STUDIO_FILTER_LANE_MIN_MEASURED_SAMPLES = 3;

export interface StudioFilterLaneMeasuredCost {
  /** Median of measured warm runs; null when only cold runs were recorded. */
  warmP50Ms: number | null;
  samples: number;
}

/**
 * Lookup into real measurements for this workload bucket — normally
 * `(lane) => runtime.costModel.estimate(providerId(lane), bucket)`.
 * Returning null means "nothing measured", never "measured as free".
 */
export type StudioFilterLaneMeasuredLookup = (
  lane: StudioFilterLane,
) => StudioFilterLaneMeasuredCost | null;

export interface StudioFilterLaneWorkload {
  /** Pixels to filter, in megapixels (width × height ÷ 1e6). */
  megapixels: number;
  /** Filter passes the CPU lanes execute (Konva filter array length). */
  chainSteps: number;
  /**
   * GPU dispatches after LUT fusion. Defaults to
   * {@link gpuDispatchCountForChainSteps} — the term is small enough
   * (0.05 ms/MP each) that the estimate never flips a verdict.
   */
  gpuDispatchCount?: number;
  /** Real samples for this bucket; consulted before the seed. */
  measured?: StudioFilterLaneMeasuredLookup | null;
  /** Override for {@link STUDIO_FILTER_LANE_MIN_MEASURED_SAMPLES}. */
  minMeasuredSamples?: number;
}

export type StudioFilterLaneCostBasis = "measured" | "seed";

export interface StudioFilterLaneCostEntry {
  lane: StudioFilterLane;
  costMs: number;
  basis: StudioFilterLaneCostBasis;
  /** Measured sample count behind `costMs` (0 for seed estimates). */
  samples: number;
}

export interface StudioFilterLaneCostRanking {
  /** Candidates ordered cheapest-first; ties keep the input order. */
  lanes: StudioFilterLane[];
  /** Per-lane detail in *input* order (audit trail, never reordered). */
  entries: StudioFilterLaneCostEntry[];
  /** "mixed" when some lanes had samples and others fell back to the seed. */
  basis: StudioFilterLaneCostBasis | "mixed";
}

function assertFiniteNonNegative(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number, got ${value}`);
  }
}

/** Pixel count → megapixels. Rejects NaN/negative rather than guessing. */
export function megapixelsOf(pixelCount: number): number {
  assertFiniteNonNegative("pixelCount", pixelCount);
  return pixelCount / 1_000_000;
}

/**
 * CPU filter passes → GPU dispatches after `fuseAdjacentLutSteps`.
 * Calibrated on the benchmark's own chains: 1 step→1 dispatch, 3→2, 6→4.
 */
export function gpuDispatchCountForChainSteps(chainSteps: number): number {
  assertFiniteNonNegative("chainSteps", chainSteps);
  return Math.max(1, Math.round(chainSteps * 0.7));
}

/**
 * Seed cost for one lane at `megapixels` with `passCount` passes (GPU
 * dispatches for `gpu-chain`, filter passes for the CPU lanes).
 *
 * The two CPU lanes share a coefficient on purpose — see the module header.
 */
export function estimateLaneCostMs(
  lane: StudioFilterLane,
  megapixels: number,
  passCount: number,
): number {
  assertFiniteNonNegative("megapixels", megapixels);
  assertFiniteNonNegative("passCount", passCount);
  const passes = Math.max(1, passCount);
  if (lane === "gpu-chain") {
    const { fixedMs, perMegapixelMs, perMegapixelMsPerDispatch } =
      STUDIO_FILTER_LANE_COST_SEED.gpu;
    return fixedMs + (perMegapixelMs + perMegapixelMsPerDispatch * passes) * megapixels;
  }
  const { fixedMs, perMegapixelMsPerStep } = STUDIO_FILTER_LANE_COST_SEED.cpu;
  return fixedMs + perMegapixelMsPerStep * passes * megapixels;
}

function passCountFor(lane: StudioFilterLane, workload: StudioFilterLaneWorkload): number {
  if (lane !== "gpu-chain") return Math.max(1, workload.chainSteps);
  return workload.gpuDispatchCount ?? gpuDispatchCountForChainSteps(workload.chainSteps);
}

function resolveMeasured(
  lane: StudioFilterLane,
  workload: StudioFilterLaneWorkload,
): StudioFilterLaneCostEntry | null {
  const lookup = workload.measured;
  if (!lookup) return null;
  const minSamples = workload.minMeasuredSamples ?? STUDIO_FILTER_LANE_MIN_MEASURED_SAMPLES;
  const measured = lookup(lane);
  if (!measured) return null;
  const { warmP50Ms, samples } = measured;
  // Never invent a number: a null median, an unusable value or too few samples
  // all mean "no evidence yet" and fall through to the cold-start seed.
  if (warmP50Ms === null || !Number.isFinite(warmP50Ms) || warmP50Ms < 0) return null;
  if (!Number.isFinite(samples) || samples < minSamples) return null;
  return { lane, costMs: warmP50Ms, basis: "measured", samples };
}

/**
 * Ranks `candidates` cheapest-first for `workload`, preferring real per-lane
 * measurements and falling back to the seed lane by lane. The sort is stable,
 * so equal costs (notably the two CPU lanes) keep the caller's order — this
 * function only ever answers the GPU-vs-CPU question the benchmark studied.
 */
export function chooseLaneByCost(
  candidates: readonly StudioFilterLane[],
  workload: StudioFilterLaneWorkload,
): StudioFilterLaneCostRanking {
  assertFiniteNonNegative("workload.megapixels", workload.megapixels);
  assertFiniteNonNegative("workload.chainSteps", workload.chainSteps);
  const entries: StudioFilterLaneCostEntry[] = candidates.map((lane) => {
    const measured = resolveMeasured(lane, workload);
    if (measured) return measured;
    return {
      lane,
      costMs: estimateLaneCostMs(lane, workload.megapixels, passCountFor(lane, workload)),
      basis: "seed",
      samples: 0,
    };
  });
  const measuredCount = entries.filter((entry) => entry.basis === "measured").length;
  const basis: StudioFilterLaneCostRanking["basis"] =
    entries.length === 0 || measuredCount === 0
      ? "seed"
      : measuredCount === entries.length
        ? "measured"
        : "mixed";
  const lanes = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.costMs - b.entry.costMs || a.index - b.index)
    .map(({ entry }) => entry.lane);
  return { lanes, entries, basis };
}
