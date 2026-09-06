/**
 * Promotion gate for the bounded exact WebGPU count/scan/stable-scatter candidate.
 *
 * The GPU path is never selected solely because WebGPU exists. An observed browser report must
 * prove exact CSR parity, zero shader/GPU diagnostics, and a material p95 improvement without
 * regressing tail latency. Missing evidence keeps the CPU oracle authoritative.
 */
export const STUDIO_WEBGPU_DAB_TILE_BINNING_ELECTION_REVISION = 1 as const;

export interface StudioWebGpuDabTileBinningTimingDistribution {
  readonly samplesMs: readonly number[];
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

export interface StudioWebGpuDabTileBinningBenchmarkReport {
  readonly kind: "studio-webgpu-dab-tile-binning-benchmark";
  readonly revision: typeof STUDIO_WEBGPU_DAB_TILE_BINNING_ELECTION_REVISION;
  readonly environment: Readonly<{
    userAgent: string;
    adapterInfo: Readonly<Record<string, string | boolean | null>>;
  }>;
  readonly workload: Readonly<{
    dabCount: number;
    tileCount: number;
    referenceCount: number;
    warmupIterations: number;
    measuredIterations: number;
  }>;
  readonly cpu: StudioWebGpuDabTileBinningTimingDistribution;
  /** End-to-end candidate time including integer-span planning and queue completion, no readback. */
  readonly gpu: StudioWebGpuDabTileBinningTimingDistribution;
  readonly parity: Readonly<{
    offsetMismatches: number;
    indexMismatches: number;
  }>;
  readonly diagnostics: Readonly<{
    shaderCompilationMessages: number;
    scopedGpuErrors: number;
    uncapturedGpuErrors: number;
  }>;
}

export const STUDIO_WEBGPU_DAB_TILE_BINNING_PROMOTION_THRESHOLDS = Object.freeze({
  minimumMeasuredIterations: 12,
  maximumParityMismatches: 0,
  maximumShaderCompilationMessages: 0,
  maximumScopedGpuErrors: 0,
  maximumUncapturedGpuErrors: 0,
  maximumGpuP50Ratio: 0.95,
  maximumGpuP95Ratio: 0.85,
  maximumGpuP99Ratio: 1,
} as const);

export type StudioWebGpuDabTileBinningElection = Readonly<{
  selected: "cpu-oracle" | "webgpu-compute";
  promoted: boolean;
  reasons: readonly string[];
  ratios: Readonly<{
    p50: number;
    p95: number;
    p99: number;
  }>;
}>;

function ratio(candidate: number, incumbent: number): number {
  return Number.isFinite(candidate)
    && candidate >= 0
    && Number.isFinite(incumbent)
    && incumbent > 0
    ? candidate / incumbent
    : Number.POSITIVE_INFINITY;
}

export function electStudioWebGpuDabTileBinningBackend(
  report: StudioWebGpuDabTileBinningBenchmarkReport | null | undefined,
): StudioWebGpuDabTileBinningElection {
  const reasons: string[] = [];
  if (
    !report
    || report.kind !== "studio-webgpu-dab-tile-binning-benchmark"
    || report.revision !== STUDIO_WEBGPU_DAB_TILE_BINNING_ELECTION_REVISION
  ) {
    return Object.freeze({
      selected: "cpu-oracle",
      promoted: false,
      reasons: Object.freeze(["missing-or-invalid-report"]),
      ratios: Object.freeze({
        p50: Number.POSITIVE_INFINITY,
        p95: Number.POSITIVE_INFINITY,
        p99: Number.POSITIVE_INFINITY,
      }),
    });
  }
  const ratios = Object.freeze({
    p50: ratio(report.gpu.p50Ms, report.cpu.p50Ms),
    p95: ratio(report.gpu.p95Ms, report.cpu.p95Ms),
    p99: ratio(report.gpu.p99Ms, report.cpu.p99Ms),
  });
  const thresholds = STUDIO_WEBGPU_DAB_TILE_BINNING_PROMOTION_THRESHOLDS;
  if (
    !Number.isSafeInteger(report.workload.measuredIterations)
    || report.workload.measuredIterations < thresholds.minimumMeasuredIterations
  ) reasons.push("insufficient-samples");
  if (
    report.parity.offsetMismatches + report.parity.indexMismatches
      > thresholds.maximumParityMismatches
  ) reasons.push("csr-parity");
  if (
    report.diagnostics.shaderCompilationMessages
      > thresholds.maximumShaderCompilationMessages
  ) reasons.push("shader-diagnostics");
  if (
    report.diagnostics.scopedGpuErrors > thresholds.maximumScopedGpuErrors
  ) reasons.push("scoped-gpu-errors");
  if (
    report.diagnostics.uncapturedGpuErrors
      > thresholds.maximumUncapturedGpuErrors
  ) reasons.push("uncaptured-gpu-errors");
  if (ratios.p50 > thresholds.maximumGpuP50Ratio) reasons.push("p50");
  if (ratios.p95 > thresholds.maximumGpuP95Ratio) reasons.push("p95");
  if (ratios.p99 > thresholds.maximumGpuP99Ratio) reasons.push("p99");
  const promoted = reasons.length === 0;
  return Object.freeze({
    selected: promoted ? "webgpu-compute" : "cpu-oracle",
    promoted,
    reasons: Object.freeze(reasons),
    ratios,
  });
}
