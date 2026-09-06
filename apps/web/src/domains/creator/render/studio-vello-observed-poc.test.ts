import { describe, expect, it } from "vitest";

import {
  STUDIO_VELLO_CHROME_PAGE_REPEATABILITY,
  STUDIO_VELLO_OBSERVED_FRAME_RUNS,
  STUDIO_VELLO_OBSERVED_POC_DECISION,
  STUDIO_VELLO_OBSERVED_POC_LIMITATIONS,
  STUDIO_VELLO_OBSERVED_SOURCE,
  STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY,
  STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY_VERSION,
  evaluateStudioVelloRecordedObservationConsistency,
} from "./studio-vello-observed-poc";

describe("studio Vello recorded observation consistency", () => {
  it("pins every observation to the audited upstream source", () => {
    expect(STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY_VERSION).toBe(
      "studio-vello-recorded-observation-consistency-v1",
    );
    expect(STUDIO_VELLO_OBSERVED_SOURCE).toMatchObject({
      evaluatedVersion: "0.9.0",
      packageVersion: "0.9.0",
      sourceCommit: "875f324f21da93019cae9e8e61d4abfd69893206",
      buildFingerprint: null,
      benchmarkScene: "official-mmark",
      observedOn: "2026-07-30",
      evidenceGranularity: "recorded-aggregates-only",
      rawFrameSamplesAvailable: false,
      verificationScope: "static-aggregate-consistency-only",
    });
    expect(STUDIO_VELLO_OBSERVED_SOURCE.officialRepository).toBe(
      "https://github.com/linebender/vello",
    );
    expect(STUDIO_VELLO_OBSERVED_SOURCE.benchmarkNotice).toContain(
      "not directly comparable",
    );
  });

  it("records both native and real Chrome WebGPU observations without conflating them", () => {
    expect(STUDIO_VELLO_OBSERVED_FRAME_RUNS.map(({ id }) => id)).toEqual([
      "native-metal-mmark-10k",
      "chrome-webgpu-mmark-10k",
      "chrome-webgpu-mmark-50k",
    ]);
    expect(STUDIO_VELLO_OBSERVED_FRAME_RUNS[0]).toMatchObject({
      runtime: "native-wgpu-metal",
      pathElementCount: 10_000,
      measuredFrames: 120,
      p95Milliseconds: 5.4946,
      maximumResidentBytes: 67_108_864,
    });
    expect(STUDIO_VELLO_OBSERVED_FRAME_RUNS[1]).toMatchObject({
      runtime: "chrome-webgpu-metal",
      browserVersion: "150.0.7871.187",
      pathElementCount: 10_000,
      warmupFrames: 60,
      measuredFrames: 100,
      p95Milliseconds: 13.6,
      p99Milliseconds: 13.9,
    });
    expect(STUDIO_VELLO_OBSERVED_FRAME_RUNS[2]).toMatchObject({
      runtime: "chrome-webgpu-metal",
      pathElementCount: 50_000,
      p95Milliseconds: 59.6,
      p99Milliseconds: 60.2,
    });
  });

  it("keeps the candidate fail-closed despite the promising 10k result", () => {
    expect(STUDIO_VELLO_OBSERVED_POC_DECISION).toMatchObject({
      disposition: "keep-isolated-research-candidate",
      tenThousandPathSceneWithinSixtyFpsBudget: true,
      fiftyThousandPathSceneWithinSixtyFpsBudget: false,
      chromePageRepeatabilityPassed: true,
      productRuntimeActivationAllowed: false,
      canonicalAuthorityAllowed: false,
      brushPixelAuthorityAllowed: false,
    });
    expect(STUDIO_VELLO_OBSERVED_POC_DECISION.eligibleUseCases).toEqual([
      "isolated-settled-vector-overlay-poc",
      "future-retained-scene-benchmark",
    ]);
    expect(STUDIO_VELLO_OBSERVED_POC_LIMITATIONS).toHaveLength(5);
    expect(STUDIO_VELLO_OBSERVED_POC_LIMITATIONS.join(" ")).toContain(
      "device-loss recovery",
    );
  });

  it("checks recorded aggregates without claiming a benchmark rerun or raw-sample proof", () => {
    expect(evaluateStudioVelloRecordedObservationConsistency()).toEqual(
      STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY,
    );
    expect(STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY).toEqual({
      scope: "recorded-aggregate-consistency-only",
      valid: true,
      errors: [],
      aggregateRecordsChecked: 3,
      reranBenchmark: false,
      rawFrameSamplesVerified: false,
      percentilesRecomputedFromRawSamples: false,
    });
    expect(STUDIO_VELLO_OBSERVED_POC_LIMITATIONS.join(" ")).toContain(
      "Original per-frame samples",
    );
  });

  it("records five successful page-level repeats without calling them device-loss recovery", () => {
    expect(STUDIO_VELLO_CHROME_PAGE_REPEATABILITY).toMatchObject({
      runCount: 5,
      completedRuns: 5,
      failedRuns: 0,
      pathElementCount: 10_000,
      measuredFramesPerRun: 100,
      maximumMeanSpreadMilliseconds: 0.21,
      maximumP95Milliseconds: 13.2,
      classification: "same-process-independent-page-repeatability",
    });
    expect(STUDIO_VELLO_CHROME_PAGE_REPEATABILITY.meanMilliseconds).toHaveLength(5);
    expect(STUDIO_VELLO_CHROME_PAGE_REPEATABILITY.p95Milliseconds).toHaveLength(5);
    expect(STUDIO_VELLO_CHROME_PAGE_REPEATABILITY.p99Milliseconds).toHaveLength(5);
    expect(STUDIO_VELLO_OBSERVED_POC_LIMITATIONS.join(" ")).toContain(
      "device-loss recovery",
    );
  });

  it("freezes public evidence so runtime code cannot rewrite the audit result", () => {
    expect(Object.isFrozen(STUDIO_VELLO_OBSERVED_SOURCE)).toBe(true);
    expect(Object.isFrozen(STUDIO_VELLO_OBSERVED_FRAME_RUNS)).toBe(true);
    expect(STUDIO_VELLO_OBSERVED_FRAME_RUNS.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(STUDIO_VELLO_OBSERVED_POC_LIMITATIONS)).toBe(true);
    expect(Object.isFrozen(STUDIO_VELLO_CHROME_PAGE_REPEATABILITY)).toBe(true);
    expect(Object.isFrozen(
      STUDIO_VELLO_CHROME_PAGE_REPEATABILITY.meanMilliseconds,
    )).toBe(true);
    expect(Object.isFrozen(STUDIO_VELLO_OBSERVED_POC_DECISION)).toBe(true);
    expect(Object.isFrozen(
      STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY,
    )).toBe(true);
    expect(Object.isFrozen(
      STUDIO_VELLO_RECORDED_OBSERVATION_CONSISTENCY.errors,
    )).toBe(true);
  });
});
