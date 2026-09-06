export const STUDIO_BRUSH_GPU_QUALITY_ELECTION_VERSION = 2 as const;
export const STUDIO_BRUSH_GPU_QUALITY_RENDER_CONTRACT_VERSION = 1 as const;

export type StudioBrushGpuQualityPolicyKind =
  | "strict-continuous"
  | "soft-wet-continuous"
  | "record-only-discrete"
  | "record-only-transparent"
  | "eraser";

export type StudioBrushGpuAdapterClass =
  | "hardware"
  | "software"
  | "unknown"
  | "unavailable";

export interface StudioBrushGpuExecutionEvidence {
  readonly adapterClass: StudioBrushGpuAdapterClass;
  readonly isFallbackAdapter: boolean | null;
  readonly adapterFingerprint: string | null;
}

export interface StudioBrushLongStrokePerformanceEvidence {
  readonly drawMilliseconds: number;
  readonly frameP50Milliseconds: number;
  readonly frameP95Milliseconds: number;
  readonly frameP99Milliseconds: number;
  readonly longTaskCount: number;
  readonly longTaskTotalMilliseconds: number;
  readonly inputDeliveryRatio: number;
  readonly heapGrowthBytes: number | null;
}

export interface StudioBrushLongStrokeQualityEvidence {
  readonly measured: boolean;
  readonly ownQualityPassed: boolean;
  readonly browserErrorCount: number;
  readonly refusedStrokeCount: number;
  readonly gpuSurfaceObserved: boolean;
  readonly liveToCommittedChangedRatio: number;
  readonly committedToSettledChangedRatio: number;
  readonly centerlineCoverage: number;
  readonly visiblePixels: number;
  readonly inkEnergy: number;
  readonly edgeDensity: number;
}

export interface StudioBrushCrossEngineQualityEvidence {
  readonly comparedPixels: number;
  /** Changed pixels divided by the union of baseline/GPU ink masks. */
  readonly changedInkRatio: number;
  readonly silhouetteIntersectionOverUnion: number;
  readonly inkEnergyRatio: number;
  readonly edgeDensityRatio: number;
  readonly gradientEnergyRatio: number;
  readonly luminanceHistogramIntersection: number;
  readonly horizontalProfileCorrelation: number;
  readonly verticalProfileCorrelation: number;
  readonly normalizedBoundsDrift: number;
  readonly normalizedCentroidDrift: number;
}

export interface StudioBrushGpuQualityElectionInput {
  readonly brushId: string;
  readonly policy: StudioBrushGpuQualityPolicyKind;
  readonly baseline: Readonly<{
    quality: StudioBrushLongStrokeQualityEvidence;
    performance: StudioBrushLongStrokePerformanceEvidence;
  }>;
  readonly gpu: Readonly<{
    quality: StudioBrushLongStrokeQualityEvidence;
    performance: StudioBrushLongStrokePerformanceEvidence;
  }>;
  readonly gpuExecution: StudioBrushGpuExecutionEvidence;
  readonly crossEngine: StudioBrushCrossEngineQualityEvidence;
}

export interface StudioBrushGpuQualityElectionThresholds {
  readonly maximumChangedInkRatio: number;
  readonly minimumSilhouetteIntersectionOverUnion: number;
  readonly minimumInkEnergyRatio: number;
  readonly maximumInkEnergyRatio: number;
  readonly minimumEdgeDensityRatio: number;
  readonly maximumEdgeDensityRatio: number;
  readonly minimumGradientEnergyRatio: number;
  readonly maximumGradientEnergyRatio: number;
  readonly minimumHistogramIntersection: number;
  readonly minimumProfileCorrelation: number;
  readonly maximumNormalizedBoundsDrift: number;
  readonly maximumNormalizedCentroidDrift: number;
  readonly maximumLiveCommitRegression: number;
  readonly maximumCommittedSettleRatio: number;
}

export interface StudioBrushGpuQualityElectionResult {
  readonly kind: "studio-brush-gpu-quality-election";
  readonly version: typeof STUDIO_BRUSH_GPU_QUALITY_ELECTION_VERSION;
  readonly brushId: string;
  readonly selected: "gpu" | "incumbent";
  readonly qualityEquivalent: boolean;
  readonly performanceNonInferior: boolean;
  readonly hardwareEligible: boolean;
  readonly reasons: readonly string[];
  readonly ratios: Readonly<{
    draw: number;
    frameP50: number;
    frameP95: number;
    frameP99: number;
  }>;
  readonly thresholds: StudioBrushGpuQualityElectionThresholds;
}

/**
 * These are equivalence tolerances, not aesthetic acceptance thresholds. The candidate must first
 * pass its own media-specific live/commit quality gate. Cross-engine tolerances then permit only
 * small antialiasing and browser-compositor variation; a faster but visibly different path stays on
 * the incumbent.
 */
const THRESHOLDS: Readonly<
  Record<StudioBrushGpuQualityPolicyKind, StudioBrushGpuQualityElectionThresholds>
> = Object.freeze({
  "strict-continuous": Object.freeze({
    maximumChangedInkRatio: 0.02,
    minimumSilhouetteIntersectionOverUnion: 0.99,
    minimumInkEnergyRatio: 0.985,
    maximumInkEnergyRatio: 1.015,
    minimumEdgeDensityRatio: 0.96,
    maximumEdgeDensityRatio: 1.04,
    minimumGradientEnergyRatio: 0.95,
    maximumGradientEnergyRatio: 1.05,
    minimumHistogramIntersection: 0.985,
    minimumProfileCorrelation: 0.99,
    maximumNormalizedBoundsDrift: 0.005,
    maximumNormalizedCentroidDrift: 0.005,
    maximumLiveCommitRegression: 0.002,
    maximumCommittedSettleRatio: 0.001,
  }),
  "soft-wet-continuous": Object.freeze({
    maximumChangedInkRatio: 0.08,
    minimumSilhouetteIntersectionOverUnion: 0.95,
    minimumInkEnergyRatio: 0.95,
    maximumInkEnergyRatio: 1.05,
    minimumEdgeDensityRatio: 0.9,
    maximumEdgeDensityRatio: 1.1,
    minimumGradientEnergyRatio: 0.88,
    maximumGradientEnergyRatio: 1.12,
    minimumHistogramIntersection: 0.95,
    minimumProfileCorrelation: 0.94,
    maximumNormalizedBoundsDrift: 0.015,
    maximumNormalizedCentroidDrift: 0.012,
    maximumLiveCommitRegression: 0.005,
    maximumCommittedSettleRatio: 0.003,
  }),
  "record-only-discrete": Object.freeze({
    maximumChangedInkRatio: 0.12,
    minimumSilhouetteIntersectionOverUnion: 0.9,
    minimumInkEnergyRatio: 0.92,
    maximumInkEnergyRatio: 1.08,
    minimumEdgeDensityRatio: 0.88,
    maximumEdgeDensityRatio: 1.12,
    minimumGradientEnergyRatio: 0.86,
    maximumGradientEnergyRatio: 1.14,
    minimumHistogramIntersection: 0.93,
    minimumProfileCorrelation: 0.9,
    maximumNormalizedBoundsDrift: 0.02,
    maximumNormalizedCentroidDrift: 0.018,
    maximumLiveCommitRegression: 0.01,
    maximumCommittedSettleRatio: 0.003,
  }),
  "record-only-transparent": Object.freeze({
    maximumChangedInkRatio: 0,
    minimumSilhouetteIntersectionOverUnion: 1,
    minimumInkEnergyRatio: 1,
    maximumInkEnergyRatio: 1,
    minimumEdgeDensityRatio: 1,
    maximumEdgeDensityRatio: 1,
    minimumGradientEnergyRatio: 1,
    maximumGradientEnergyRatio: 1,
    minimumHistogramIntersection: 1,
    minimumProfileCorrelation: 1,
    maximumNormalizedBoundsDrift: 0,
    maximumNormalizedCentroidDrift: 0,
    maximumLiveCommitRegression: 0,
    maximumCommittedSettleRatio: 0,
  }),
  eraser: Object.freeze({
    maximumChangedInkRatio: 0,
    minimumSilhouetteIntersectionOverUnion: 1,
    minimumInkEnergyRatio: 1,
    maximumInkEnergyRatio: 1,
    minimumEdgeDensityRatio: 1,
    maximumEdgeDensityRatio: 1,
    minimumGradientEnergyRatio: 1,
    maximumGradientEnergyRatio: 1,
    minimumHistogramIntersection: 1,
    minimumProfileCorrelation: 1,
    maximumNormalizedBoundsDrift: 0,
    maximumNormalizedCentroidDrift: 0,
    maximumLiveCommitRegression: 0,
    maximumCommittedSettleRatio: 0,
  }),
});

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function ratio(candidate: number, incumbent: number): number {
  return finite(candidate) && finite(incumbent) && incumbent > 0
    ? candidate / incumbent
    : Number.POSITIVE_INFINITY;
}

function inRange(value: number, minimum: number, maximum: number): boolean {
  return finite(value) && value >= minimum && value <= maximum;
}

/**
 * Quality is a hard prerequisite. A statistically tied physical-GPU path wins only after the
 * pictures are equivalent; software/fallback adapters remain diagnostic evidence and can never
 * author the product allowlist.
 */
export function electStudioBrushGpuQuality(
  input: StudioBrushGpuQualityElectionInput,
): StudioBrushGpuQualityElectionResult {
  const thresholds = THRESHOLDS[input.policy] ?? THRESHOLDS["strict-continuous"];
  const reasons: string[] = [];
  const baselineQuality = input.baseline.quality;
  const gpuQuality = input.gpu.quality;
  const cross = input.crossEngine;
  const execution = input.gpuExecution;

  if (typeof input.brushId !== "string" || input.brushId.length === 0) {
    reasons.push("invalid-brush-id");
  }
  if (input.policy === "eraser") reasons.push("eraser-transparent-overlay-ineligible");
  if (input.policy === "record-only-transparent") {
    reasons.push("transparent-tool-has-no-pixel-election");
  }
  if (!baselineQuality.measured || !gpuQuality.measured) reasons.push("measurement-incomplete");
  if (!baselineQuality.ownQualityPassed) reasons.push("incumbent-quality-failed");
  if (!gpuQuality.ownQualityPassed) reasons.push("gpu-quality-failed");
  if (baselineQuality.browserErrorCount > 0 || gpuQuality.browserErrorCount > 0) {
    reasons.push("browser-errors");
  }
  if (baselineQuality.refusedStrokeCount > 0 || gpuQuality.refusedStrokeCount > 0) {
    reasons.push("stroke-refused");
  }
  if (!gpuQuality.gpuSurfaceObserved) reasons.push("gpu-surface-not-observed");
  if (baselineQuality.visiblePixels <= 0 || gpuQuality.visiblePixels <= 0) {
    reasons.push("missing-visible-ink");
  }
  if (
    input.baseline.performance.inputDeliveryRatio < 0.98
    || input.gpu.performance.inputDeliveryRatio < 0.98
  ) reasons.push("input-delivery");
  if (cross.comparedPixels <= 0) reasons.push("cross-engine-images-missing");
  if (cross.changedInkRatio > thresholds.maximumChangedInkRatio) {
    reasons.push("changed-ink-ratio");
  }
  if (
    cross.silhouetteIntersectionOverUnion
      < thresholds.minimumSilhouetteIntersectionOverUnion
  ) reasons.push("silhouette-iou");
  if (
    !inRange(
      cross.inkEnergyRatio,
      thresholds.minimumInkEnergyRatio,
      thresholds.maximumInkEnergyRatio,
    )
  ) reasons.push("ink-energy");
  if (
    !inRange(
      cross.edgeDensityRatio,
      thresholds.minimumEdgeDensityRatio,
      thresholds.maximumEdgeDensityRatio,
    )
  ) reasons.push("edge-density");
  if (
    !inRange(
      cross.gradientEnergyRatio,
      thresholds.minimumGradientEnergyRatio,
      thresholds.maximumGradientEnergyRatio,
    )
  ) reasons.push("gradient-energy");
  if (cross.luminanceHistogramIntersection < thresholds.minimumHistogramIntersection) {
    reasons.push("luminance-histogram");
  }
  if (
    cross.horizontalProfileCorrelation < thresholds.minimumProfileCorrelation
    || cross.verticalProfileCorrelation < thresholds.minimumProfileCorrelation
  ) reasons.push("ink-profile");
  if (cross.normalizedBoundsDrift > thresholds.maximumNormalizedBoundsDrift) {
    reasons.push("bounds-drift");
  }
  if (cross.normalizedCentroidDrift > thresholds.maximumNormalizedCentroidDrift) {
    reasons.push("centroid-drift");
  }
  if (
    gpuQuality.liveToCommittedChangedRatio
      > baselineQuality.liveToCommittedChangedRatio + thresholds.maximumLiveCommitRegression
  ) reasons.push("live-commit-regression");
  if (gpuQuality.committedToSettledChangedRatio > thresholds.maximumCommittedSettleRatio) {
    reasons.push("post-commit-instability");
  }
  if (gpuQuality.centerlineCoverage + 0.005 < baselineQuality.centerlineCoverage) {
    reasons.push("centerline-coverage-regression");
  }

  if (execution.adapterClass === "software") reasons.push("software-gpu-evidence-only");
  if (execution.adapterClass === "unknown") reasons.push("gpu-hardware-unverified");
  if (execution.adapterClass === "unavailable") reasons.push("gpu-adapter-unavailable");
  if (execution.isFallbackAdapter === true) reasons.push("fallback-gpu-evidence-only");
  if (
    typeof execution.adapterFingerprint !== "string"
    || execution.adapterFingerprint.length === 0
  ) reasons.push("gpu-adapter-fingerprint-missing");
  const hardwareEligible = execution.adapterClass === "hardware"
    && execution.isFallbackAdapter !== true
    && typeof execution.adapterFingerprint === "string"
    && execution.adapterFingerprint.length > 0;

  const ratios = Object.freeze({
    draw: ratio(input.gpu.performance.drawMilliseconds, input.baseline.performance.drawMilliseconds),
    frameP50: ratio(
      input.gpu.performance.frameP50Milliseconds,
      input.baseline.performance.frameP50Milliseconds,
    ),
    frameP95: ratio(
      input.gpu.performance.frameP95Milliseconds,
      input.baseline.performance.frameP95Milliseconds,
    ),
    frameP99: ratio(
      input.gpu.performance.frameP99Milliseconds,
      input.baseline.performance.frameP99Milliseconds,
    ),
  });
  // Quality equivalence is the hard product gate. Once every visual, texture, continuity,
  // input-delivery and physical-adapter assertion is satisfied, GPU may win with a small bounded
  // overhead: persistent allocation or readback setup can cost a little while still reducing
  // texture churn and long-session stalls. Material regressions remain disqualifying.
  const heapRegression = input.gpu.performance.heapGrowthBytes !== null
    && input.baseline.performance.heapGrowthBytes !== null
    && input.gpu.performance.heapGrowthBytes
      > input.baseline.performance.heapGrowthBytes + 8 * 1024 * 1024;
  const performanceNonInferior = ratios.draw <= 1.1
    && ratios.frameP50 <= 1.1
    && ratios.frameP95 <= 1.08
    && ratios.frameP99 <= 1.15
    && input.gpu.performance.longTaskCount <= input.baseline.performance.longTaskCount + 2
    && input.gpu.performance.longTaskTotalMilliseconds
      <= input.baseline.performance.longTaskTotalMilliseconds + 100
    && !heapRegression;
  if (!performanceNonInferior) reasons.push("performance-regression");

  const qualityReasons = new Set([
    "invalid-brush-id",
    "eraser-transparent-overlay-ineligible",
    "transparent-tool-has-no-pixel-election",
    "measurement-incomplete",
    "incumbent-quality-failed",
    "gpu-quality-failed",
    "browser-errors",
    "stroke-refused",
    "gpu-surface-not-observed",
    "missing-visible-ink",
    "input-delivery",
    "cross-engine-images-missing",
    "changed-ink-ratio",
    "silhouette-iou",
    "ink-energy",
    "edge-density",
    "gradient-energy",
    "luminance-histogram",
    "ink-profile",
    "bounds-drift",
    "centroid-drift",
    "live-commit-regression",
    "post-commit-instability",
    "centerline-coverage-regression",
  ]);
  const qualityEquivalent = reasons.every((reason) => !qualityReasons.has(reason));
  const selected = qualityEquivalent && performanceNonInferior && hardwareEligible
    ? "gpu"
    : "incumbent";
  return Object.freeze({
    kind: "studio-brush-gpu-quality-election",
    version: STUDIO_BRUSH_GPU_QUALITY_ELECTION_VERSION,
    brushId: input.brushId,
    selected,
    qualityEquivalent,
    performanceNonInferior,
    hardwareEligible,
    reasons: Object.freeze(reasons),
    ratios,
    thresholds,
  });
}
