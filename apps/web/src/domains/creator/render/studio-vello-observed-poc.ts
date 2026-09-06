/**
 * Recorded aggregate consistency for the isolated Vello 0.9.0 proof of concept.
 *
 * This module does not rerun Vello, launch a browser, or recompute percentiles from frame samples.
 * The original frame arrays and a build fingerprint were not retained, so only relationships
 * between the recorded aggregate values can be checked. These records are intentionally not wired
 * into renderer selection; the promotion contract remains the sole activation gate.
 */

export const STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY_VERSION =
  "studio-vello-recorded-observation-consistency-v1" as const;

export const STUDIO_VELLO_OBSERVED_SOURCE = Object.freeze({
  evaluatedVersion: "0.9.0" as const,
  packageVersion: "0.9.0" as const,
  officialRepository: "https://github.com/linebender/vello" as const,
  sourceCommit: "875f324f21da93019cae9e8e61d4abfd69893206" as const,
  buildFingerprint: null,
  benchmarkScene: "official-mmark" as const,
  benchmarkNotice:
    "The upstream MMark source says it is not directly comparable to MotionMark." as const,
  observedOn: "2026-07-30" as const,
  evidenceGranularity: "recorded-aggregates-only" as const,
  rawFrameSamplesAvailable: false as const,
  verificationScope: "static-aggregate-consistency-only" as const,
});

export interface StudioVelloObservedFrameRun {
  readonly id: string;
  readonly runtime: "native-wgpu-metal" | "chrome-webgpu-metal";
  readonly browserVersion?: string;
  readonly architecture: "arm64";
  readonly gpuArchitecture: "metal-3";
  readonly viewportWidth: 1600;
  readonly viewportHeight: 1600;
  readonly pathElementCount: number;
  readonly warmupFrames: number;
  readonly measuredFrames: number;
  readonly meanMilliseconds: number;
  readonly p50Milliseconds: number;
  readonly p95Milliseconds: number;
  readonly p99Milliseconds: number;
  readonly maximumMilliseconds: number;
  readonly maximumResidentBytes?: number;
  readonly peakMemoryFootprintBytes?: number;
}

export const STUDIO_VELLO_OBSERVED_FRAME_RUNS =
  Object.freeze<readonly StudioVelloObservedFrameRun[]>([
    Object.freeze({
      id: "native-metal-mmark-10k",
      runtime: "native-wgpu-metal",
      architecture: "arm64",
      gpuArchitecture: "metal-3",
      viewportWidth: 1600,
      viewportHeight: 1600,
      pathElementCount: 10_000,
      warmupFrames: 12,
      measuredFrames: 120,
      meanMilliseconds: 4.1382,
      p50Milliseconds: 4.1615,
      p95Milliseconds: 5.4946,
      p99Milliseconds: 5.5261,
      maximumMilliseconds: 6.6215,
      maximumResidentBytes: 67_108_864,
      peakMemoryFootprintBytes: 254_919_208,
    }),
    Object.freeze({
      id: "chrome-webgpu-mmark-10k",
      runtime: "chrome-webgpu-metal",
      browserVersion: "150.0.7871.187",
      architecture: "arm64",
      gpuArchitecture: "metal-3",
      viewportWidth: 1600,
      viewportHeight: 1600,
      pathElementCount: 10_000,
      warmupFrames: 60,
      measuredFrames: 100,
      meanMilliseconds: 13.281,
      p50Milliseconds: 13.3,
      p95Milliseconds: 13.6,
      p99Milliseconds: 13.9,
      maximumMilliseconds: 13.9,
    }),
    Object.freeze({
      id: "chrome-webgpu-mmark-50k",
      runtime: "chrome-webgpu-metal",
      browserVersion: "150.0.7871.187",
      architecture: "arm64",
      gpuArchitecture: "metal-3",
      viewportWidth: 1600,
      viewportHeight: 1600,
      pathElementCount: 50_000,
      warmupFrames: 60,
      measuredFrames: 100,
      meanMilliseconds: 58.158,
      p50Milliseconds: 58,
      p95Milliseconds: 59.6,
      p99Milliseconds: 60.2,
      maximumMilliseconds: 60.2,
    }),
  ]);

/**
 * Five independent pages in one Chrome process, each creating its own Vello/WGPU application.
 * This is a repeatability probe, not device-loss recovery: the browser process and GPU service
 * remain alive between pages.
 */
export const STUDIO_VELLO_CHROME_PAGE_REPEATABILITY = Object.freeze({
  runCount: 5 as const,
  pathElementCount: 10_000 as const,
  measuredFramesPerRun: 100 as const,
  meanMilliseconds: Object.freeze([12.791, 12.642, 12.581, 12.691, 12.751]),
  p95Milliseconds: Object.freeze([13.1, 13.2, 12.8, 13.2, 13.2]),
  p99Milliseconds: Object.freeze([13.3, 13.5, 13, 13.4, 13.3]),
  completedRuns: 5 as const,
  failedRuns: 0 as const,
  maximumMeanSpreadMilliseconds: 0.21 as const,
  maximumP95Milliseconds: 13.2 as const,
  classification: "same-process-independent-page-repeatability" as const,
});

export const STUDIO_VELLO_OBSERVED_POC_LIMITATIONS = Object.freeze([
  "Original per-frame samples and the build fingerprint were not retained, so percentiles cannot be independently recomputed.",
  "The scene measures full-frame vector path rendering, not a 50k-point live brush stroke.",
  "The browser run covers one Chrome/Metal machine and does not establish Firefox or Safari support.",
  "No device-loss recovery, canonical Canvas2D/SVG parity, or post-dispose GPU-memory proof was collected.",
  "Browser process and GPU memory were not isolated, so only the native run records memory observations.",
] as const);

const SIXTY_FPS_FRAME_BUDGET_MS = 1000 / 60;

export const STUDIO_VELLO_OBSERVED_POC_DECISION = Object.freeze({
  disposition: "keep-isolated-research-candidate" as const,
  tenThousandPathSceneWithinSixtyFpsBudget:
    STUDIO_VELLO_OBSERVED_FRAME_RUNS.find(
      ({ id }) => id === "chrome-webgpu-mmark-10k",
    )!.p95Milliseconds <= SIXTY_FPS_FRAME_BUDGET_MS,
  fiftyThousandPathSceneWithinSixtyFpsBudget:
    STUDIO_VELLO_OBSERVED_FRAME_RUNS.find(
      ({ id }) => id === "chrome-webgpu-mmark-50k",
    )!.p95Milliseconds <= SIXTY_FPS_FRAME_BUDGET_MS,
  eligibleUseCases: Object.freeze([
    "isolated-settled-vector-overlay-poc",
    "future-retained-scene-benchmark",
  ] as const),
  chromePageRepeatabilityPassed:
    STUDIO_VELLO_CHROME_PAGE_REPEATABILITY.failedRuns === 0
    && STUDIO_VELLO_CHROME_PAGE_REPEATABILITY.completedRuns
      === STUDIO_VELLO_CHROME_PAGE_REPEATABILITY.runCount,
  productRuntimeActivationAllowed: false as const,
  canonicalAuthorityAllowed: false as const,
  brushPixelAuthorityAllowed: false as const,
  reason:
    "The 10k Chrome result is promising, but the 50k scene misses the frame budget and mandatory maturity, parity, recovery, memory, and cross-browser gates remain open." as const,
});

export interface StudioVelloRecordedObservationConsistency {
  readonly scope: "recorded-aggregate-consistency-only";
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly aggregateRecordsChecked: number;
  readonly reranBenchmark: false;
  readonly rawFrameSamplesVerified: false;
  readonly percentilesRecomputedFromRawSamples: false;
}

function approximatelyEqual(
  left: number,
  right: number,
  tolerance = 1e-6,
): boolean {
  return Math.abs(left - right) <= tolerance;
}

/**
 * Check only internal relationships between the aggregate values checked into this module.
 *
 * This is intentionally not a benchmark runner or provenance verifier. Without the original frame
 * samples it cannot prove that recorded means or percentiles were computed correctly.
 */
export function evaluateStudioVelloRecordedObservationConsistency():
StudioVelloRecordedObservationConsistency {
  const errors: string[] = [];
  const runIds = new Set<string>();

  for (const run of STUDIO_VELLO_OBSERVED_FRAME_RUNS) {
    if (runIds.has(run.id)) {
      errors.push(`duplicate aggregate run id: ${run.id}`);
    }
    runIds.add(run.id);
    if (
      run.pathElementCount <= 0
      || run.warmupFrames < 0
      || run.measuredFrames <= 0
      || run.meanMilliseconds < 0
      || run.p50Milliseconds < 0
      || run.p95Milliseconds < run.p50Milliseconds
      || run.p99Milliseconds < run.p95Milliseconds
      || run.maximumMilliseconds < run.p99Milliseconds
      || run.meanMilliseconds > run.maximumMilliseconds
    ) {
      errors.push(`invalid aggregate statistic ordering: ${run.id}`);
    }
    if (
      (run.maximumResidentBytes !== undefined && run.maximumResidentBytes < 0)
      || (
        run.peakMemoryFootprintBytes !== undefined
        && run.peakMemoryFootprintBytes < 0
      )
    ) {
      errors.push(`invalid aggregate memory value: ${run.id}`);
    }
  }

  const repeatability = STUDIO_VELLO_CHROME_PAGE_REPEATABILITY;
  const repeatSeries = [
    repeatability.meanMilliseconds,
    repeatability.p95Milliseconds,
    repeatability.p99Milliseconds,
  ];
  if (repeatSeries.some(({ length }) => length !== repeatability.runCount)) {
    errors.push("page-repeatability aggregate arrays do not match runCount");
  }
  if (
    repeatability.completedRuns + repeatability.failedRuns
    !== repeatability.runCount
  ) {
    errors.push("page-repeatability completion counts do not match runCount");
  }
  if (repeatability.meanMilliseconds.length > 0) {
    const recordedMeanSpread =
      Math.max(...repeatability.meanMilliseconds)
      - Math.min(...repeatability.meanMilliseconds);
    if (!approximatelyEqual(
      recordedMeanSpread,
      repeatability.maximumMeanSpreadMilliseconds,
    )) {
      errors.push("recorded page-repeatability mean spread is inconsistent");
    }
  }
  if (
    repeatability.p95Milliseconds.length > 0
    && !approximatelyEqual(
      Math.max(...repeatability.p95Milliseconds),
      repeatability.maximumP95Milliseconds,
    )
  ) {
    errors.push("recorded page-repeatability maximum p95 is inconsistent");
  }

  const tenThousandWeb = STUDIO_VELLO_OBSERVED_FRAME_RUNS.find(
    ({ id }) => id === "chrome-webgpu-mmark-10k",
  );
  const fiftyThousandWeb = STUDIO_VELLO_OBSERVED_FRAME_RUNS.find(
    ({ id }) => id === "chrome-webgpu-mmark-50k",
  );
  if (
    !tenThousandWeb
    || STUDIO_VELLO_OBSERVED_POC_DECISION
      .tenThousandPathSceneWithinSixtyFpsBudget
      !== (tenThousandWeb.p95Milliseconds <= SIXTY_FPS_FRAME_BUDGET_MS)
  ) {
    errors.push("recorded 10k-path frame-budget decision is inconsistent");
  }
  if (
    !fiftyThousandWeb
    || STUDIO_VELLO_OBSERVED_POC_DECISION
      .fiftyThousandPathSceneWithinSixtyFpsBudget
      !== (fiftyThousandWeb.p95Milliseconds <= SIXTY_FPS_FRAME_BUDGET_MS)
  ) {
    errors.push("recorded 50k-path frame-budget decision is inconsistent");
  }
  if (
    STUDIO_VELLO_OBSERVED_POC_DECISION.chromePageRepeatabilityPassed
    !== (
      repeatability.failedRuns === 0
      && repeatability.completedRuns === repeatability.runCount
    )
  ) {
    errors.push("recorded page-repeatability decision is inconsistent");
  }

  return Object.freeze({
    scope: "recorded-aggregate-consistency-only" as const,
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    aggregateRecordsChecked: STUDIO_VELLO_OBSERVED_FRAME_RUNS.length,
    reranBenchmark: false as const,
    rawFrameSamplesVerified: false as const,
    percentilesRecomputedFromRawSamples: false as const,
  });
}

export const STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY =
  evaluateStudioVelloRecordedObservationConsistency();
