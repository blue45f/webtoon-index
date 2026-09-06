import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_ENGINE_ADOPTION_POLICY,
  calculateStudioBg3dEngineCaptureDiff,
  calculateStudioBg3dEngineTimingP95,
  evaluateStudioBg3dEngineAdoption as evaluateStudioBg3dEngineAdoptionRaw,
} from "./studio-bg3d-engine-benchmark-analysis";
import {
  STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES,
  STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES,
} from "./studio-bg3d-engine-benchmark-contract";

function timings(value: number, count = STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES) {
  return Array.from({ length: count }, () => value);
}

function sample(
  corpusItemId: string,
  sceneClass: "small" | "medium" | "large",
  frameTimeMs: number,
  inputLatencyMs: number,
  editableObjectCountAt30Fps: number,
) {
  return {
    corpusItemId,
    sceneClass,
    frameTimeMs: timings(frameTimeMs),
    inputLatencyMs: timings(inputLatencyMs),
    editableObjectCountAt30Fps,
  };
}

function conformance() {
  return {
    sceneRoundTripPassed: true,
    undoRedoPassed: true,
    glbGoldenPassed: true,
    gltfGoldenPassed: true,
    objGoldenPassed: true,
  };
}

function recovery() {
  return {
    soakDurationMs: STUDIO_BG3D_ENGINE_ADOPTION_POLICY.minimumSoakDurationMs,
    sustainedMemoryGrowth: false,
    unexpectedContextLossCount: 0,
    initializationFailureRecovered: true,
    deviceLossRecovered: true,
    contextLossRecovered: true,
    documentPreserved: true,
    pendingJobsSettled: true,
    disposeCompleted: true,
    ownedResourcesReleased: true,
  };
}

function run(engineId: string, backend: "webgl2" | "webgpu", candidate: boolean) {
  return {
    engineId,
    environment: {
      corpusHash: "sha256:canonical-corpus-v1",
      buildId: "build-8248f956",
      captureProfileHash: "sha256:camera-light-depth-v1",
      deviceFingerprint: "iPhone 16 / Safari 20 / Apple GPU",
    },
    adapter: {
      backend,
      adapterClass: "hardware",
      adapterFingerprint: "Apple GPU / Metal family 9",
    },
    toolOpenGzipBytes: candidate ? 115_000 : 100_000,
    samples: [
      sample("small-room", "small", candidate ? 9 : 10, 100, candidate ? 600 : 500),
      sample("medium-street", "medium", candidate ? 18 : 20, 90, candidate ? 2_400 : 2_000),
      // Exactly 25% faster at the adoption boundary.
      sample("large-city", "large", candidate ? 30 : 40, 100, candidate ? 6_000 : 5_000),
    ],
    conformance: conformance(),
    recovery: recovery(),
  };
}

function captureDiff(corpusItemId: string) {
  return {
    corpusItemId,
    width: 10,
    height: 10,
    comparedPixelCount: 100,
    mismatchedPixelCount: 0,
    maximumChannelDelta: 0,
    meanAbsoluteChannelDelta: 0,
    comparedDepthSampleCount: 100,
    mismatchedDepthSampleCount: 0,
    maximumDepthDelta: 0,
    meanAbsoluteDepthDelta: 0,
  };
}

function approvedCorpusManifest() {
  return [
    { corpusItemId: "small-room", sceneClass: "small" as const, captureWidth: 10, captureHeight: 10 },
    {
      corpusItemId: "medium-street",
      sceneClass: "medium" as const,
      captureWidth: 10,
      captureHeight: 10,
    },
    { corpusItemId: "large-city", sceneClass: "large" as const, captureWidth: 10, captureHeight: 10 },
  ];
}

function validReport() {
  return {
    kind: "toonspectrum.bg3d-engine-benchmark",
    version: 1,
    benchmarkId: "iphone16-session-003",
    baseline: run("three-webgl", "webgl2", false),
    candidate: run("playcanvas-webgpu-lab", "webgpu", true),
    captureDiffs: [
      captureDiff("small-room"),
      captureDiff("medium-street"),
      captureDiff("large-city"),
    ],
  };
}

function approvedContext() {
  return {
    approvalId: "lab-policy-iphone16-2026-07",
    corpusHash: "sha256:canonical-corpus-v1",
    buildId: "build-8248f956",
    captureProfileHash: "sha256:camera-light-depth-v1",
    deviceFingerprint: "iPhone 16 / Safari 20 / Apple GPU",
    corpusManifest: approvedCorpusManifest(),
    baselineEngineId: "three-webgl",
    candidateEngineId: "playcanvas-webgpu-lab",
    baselineBackend: "webgl2" as const,
    candidateBackend: "webgpu" as const,
    baselineAdapterFingerprint: "Apple GPU / Metal family 9",
    candidateAdapterFingerprint: "Apple GPU / Metal family 9",
  };
}

function evaluateStudioBg3dEngineAdoption(value: unknown) {
  return evaluateStudioBg3dEngineAdoptionRaw(value, approvedContext());
}

describe("Studio BG3D capture diff", () => {
  it("computes bounded RGBA and normalized-depth differences without retaining input buffers", () => {
    const baseline = {
      width: 2,
      height: 1,
      rgba: new Uint8ClampedArray([10, 20, 30, 255, 100, 110, 120, 255]),
      depthFloat32: new Float32Array([0.25, 0.75]),
    };
    const candidate = {
      width: 2,
      height: 1,
      rgba: new Uint8Array([14, 20, 30, 255, 120, 110, 120, 255]),
      depthFloat32: new Float32Array([0.2505, 0.76]),
    };

    const result = calculateStudioBg3dEngineCaptureDiff("scene-1", baseline, candidate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diff).toMatchObject({
      comparedPixelCount: 2,
      mismatchedPixelCount: 1,
      maximumChannelDelta: 20,
      comparedDepthSampleCount: 2,
      mismatchedDepthSampleCount: 1,
    });
    expect(result.diff.meanAbsoluteChannelDelta).toBe(3);
    expect(result.diff.maximumDepthDelta).toBeCloseTo(0.01, 5);
    expect(result.diff.meanAbsoluteDepthDelta).toBeCloseTo(0.00525, 5);
    expect(Object.isFrozen(result.diff)).toBe(true);
    expect(result.diff).not.toHaveProperty("rgba");
    expect(result.diff).not.toHaveProperty("depthFloat32");
  });

  it("treats deltas at the comparison tolerance as matching", () => {
    const result = calculateStudioBg3dEngineCaptureDiff(
      "tolerance-scene",
      {
        width: 1,
        height: 1,
        rgba: new Uint8Array([10, 10, 10, 255]),
        depthFloat32: new Float32Array([0.5]),
      },
      {
        width: 1,
        height: 1,
        rgba: new Uint8Array([14, 10, 10, 255]),
        depthFloat32: new Float32Array([0.5005]),
      },
    );
    expect(result).toMatchObject({
      ok: true,
      diff: { mismatchedPixelCount: 0, mismatchedDepthSampleCount: 0 },
    });
  });

  it("fails closed for dimension mismatch, oversized captures, and malformed RGBA storage", () => {
    const depth = new Float32Array([0]);
    expect(calculateStudioBg3dEngineCaptureDiff(
      "scene",
      { width: 1, height: 1, rgba: new Uint8Array(4), depthFloat32: depth },
      { width: 2, height: 1, rgba: new Uint8Array(8), depthFloat32: new Float32Array(2) },
    )).toEqual({ ok: false, reason: "capture-size-mismatch" });

    expect(calculateStudioBg3dEngineCaptureDiff(
      "scene",
      { width: 16_384, height: 1_025, rgba: new Uint8Array(), depthFloat32: new Float32Array() },
      { width: 16_384, height: 1_025, rgba: new Uint8Array(), depthFloat32: new Float32Array() },
    )).toEqual({ ok: false, reason: "capture-pixel-budget-exceeded" });

    expect(calculateStudioBg3dEngineCaptureDiff(
      "scene",
      { width: 1, height: 1, rgba: new Uint8Array(3), depthFloat32: depth },
      { width: 1, height: 1, rgba: new Uint8Array(4), depthFloat32: depth },
    )).toEqual({ ok: false, reason: "invalid-capture" });
  });

  it("requires complete finite [0, 1] depth from both adapters", () => {
    const rgba = new Uint8Array(4);
    expect(calculateStudioBg3dEngineCaptureDiff(
      "scene",
      { width: 1, height: 1, rgba },
      { width: 1, height: 1, rgba },
    )).toEqual({ ok: false, reason: "missing-depth" });

    for (const invalidDepth of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      expect(calculateStudioBg3dEngineCaptureDiff(
        "scene",
        { width: 1, height: 1, rgba, depthFloat32: new Float32Array([0.5]) },
        {
          width: 1,
          height: 1,
          rgba: new Uint8Array(rgba),
          depthFloat32: new Float32Array([invalidDepth]),
        },
      )).toEqual({ ok: false, reason: "invalid-depth" });
    }
  });

  it("rejects reused backing stores and SharedArrayBuffer captures before comparison", () => {
    const sharedRgba = new Uint8Array([1, 2, 3, 255]);
    const sharedDepth = new Float32Array([0.5]);
    expect(calculateStudioBg3dEngineCaptureDiff(
      "aliased",
      { width: 1, height: 1, rgba: sharedRgba, depthFloat32: sharedDepth },
      { width: 1, height: 1, rgba: sharedRgba, depthFloat32: sharedDepth },
    )).toEqual({ ok: false, reason: "aliased-capture-buffer" });

    const reusedBuffer = new ArrayBuffer(8);
    expect(calculateStudioBg3dEngineCaptureDiff(
      "same-backing-store",
      {
        width: 1,
        height: 1,
        rgba: new Uint8Array(reusedBuffer, 0, 4),
        depthFloat32: new Float32Array([0.5]),
      },
      {
        width: 1,
        height: 1,
        rgba: new Uint8Array(reusedBuffer, 4, 4),
        depthFloat32: new Float32Array([0.5]),
      },
    )).toEqual({ ok: false, reason: "aliased-capture-buffer" });

    if (typeof SharedArrayBuffer !== "undefined") {
      expect(calculateStudioBg3dEngineCaptureDiff(
        "shared-memory",
        {
          width: 1,
          height: 1,
          rgba: new Uint8Array(new SharedArrayBuffer(4)),
          depthFloat32: new Float32Array([0.5]),
        },
        {
          width: 1,
          height: 1,
          rgba: new Uint8Array(4),
          depthFloat32: new Float32Array([0.5]),
        },
      )).toEqual({ ok: false, reason: "shared-capture-buffer" });
    }
  });

  it("rejects capture accessors and exotic prototypes without invoking getters", () => {
    const candidate = {
      width: 1,
      height: 1,
      rgba: new Uint8Array(4),
      depthFloat32: new Float32Array([0.5]),
    };
    const baseline = { ...candidate };
    let getterReads = 0;
    Object.defineProperty(baseline, "width", {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        return getterReads === 1 ? 1 : 2;
      },
    });
    expect(calculateStudioBg3dEngineCaptureDiff("scene", baseline, candidate))
      .toEqual({ ok: false, reason: "invalid-capture" });
    expect(getterReads).toBe(0);

    const exotic = { ...candidate };
    Object.setPrototypeOf(exotic, { captureKind: "exotic" });
    expect(calculateStudioBg3dEngineCaptureDiff("scene", exotic, candidate))
      .toEqual({ ok: false, reason: "invalid-capture" });
  });
});

describe("Studio BG3D benchmark analysis", () => {
  it("calculates nearest-rank p95 deterministically and does not mutate samples", () => {
    const input = Array.from({ length: 20 }, (_, index) => 20 - index);
    expect(calculateStudioBg3dEngineTimingP95(input)).toBe(19);
    expect(input).toEqual(Array.from({ length: 20 }, (_, index) => 20 - index));
  });

  it("rejects missing, NaN, and over-cap p95 series", () => {
    expect(calculateStudioBg3dEngineTimingP95([])).toBeNull();
    expect(calculateStudioBg3dEngineTimingP95([
      ...timings(10, STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES - 1),
      Number.NaN,
    ])).toBeNull();
    expect(calculateStudioBg3dEngineTimingP95(timings(
      10,
      STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES + 1,
    ))).toBeNull();
    expect(calculateStudioBg3dEngineTimingP95(timings(0.000_999))).toBeNull();
    expect(calculateStudioBg3dEngineTimingP95(timings(0.001))).toBe(0.001);
  });

  it("rejects changing timing getters and replaced array prototypes without reading them", () => {
    const input = timings(10);
    let getterReads = 0;
    Object.defineProperty(input, "0", {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        return getterReads === 1 ? 10 : 999;
      },
    });
    expect(calculateStudioBg3dEngineTimingP95(input)).toBeNull();
    expect(getterReads).toBe(0);

    const exotic = timings(10);
    Object.setPrototypeOf(exotic, Object.create(Array.prototype));
    expect(calculateStudioBg3dEngineTimingP95(exotic)).toBeNull();
  });

  it("qualifies only the approved context at exact 25%, 100ms, and 15% policy boundaries", () => {
    const result = evaluateStudioBg3dEngineAdoption(validReport());

    expect(result.decision).toBe("qualify-approved-context");
    expect(result.scope).toBe("approved-device-context");
    expect(result.approvalId).toBe("lab-policy-iphone16-2026-07");
    expect(result.failures).toEqual([]);
    expect(result.metrics?.toolOpenGzipRegressionRatio).toBeCloseTo(0.15, 10);
    expect(result.metrics?.sceneComparisons[2]).toMatchObject({
      corpusItemId: "large-city",
      baselineFrameTimeP95Ms: 40,
      candidateFrameTimeP95Ms: 30,
      frameTimeImprovementRatio: 0.25,
      candidateInputLatencyP95Ms: 100,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.metrics)).toBe(true);
    expect(Object.isFrozen(result.metrics?.sceneComparisons)).toBe(true);
  });

  it("accepts a 2x object-capacity improvement as the alternative large-scene performance proof", () => {
    const input = validReport();
    input.candidate.samples[2]!.frameTimeMs = timings(40);
    input.candidate.samples[2]!.editableObjectCountAt30Fps = 10_000;

    const result = evaluateStudioBg3dEngineAdoption(input);
    expect(result.decision).toBe("qualify-approved-context");
    expect(result.metrics?.sceneComparisons[2]).toMatchObject({
      frameTimeImprovementRatio: 0,
      editableObjectScaleRatio: 2,
    });
  });

  it("rejects each large scene that proves neither 25% faster frames nor 2x scale", () => {
    const input = validReport();
    input.candidate.samples[2]!.frameTimeMs = timings(30.1);
    input.candidate.samples[2]!.editableObjectCountAt30Fps = 9_999;

    expect(evaluateStudioBg3dEngineAdoption(input).failures).toContainEqual({
      code: "large-scene-performance-gate-failed",
      corpusItemId: "large-city",
    });
  });

  it("allows exact all-scene regression boundaries while retaining the large-scene win", () => {
    const input = validReport();
    input.candidate.samples[0]!.frameTimeMs = timings(10.5);
    input.candidate.samples[0]!.editableObjectCountAt30Fps = 450;

    const result = evaluateStudioBg3dEngineAdoption(input);
    expect(result.decision).toBe("qualify-approved-context");
    expect(result.failures).toEqual([]);
  });

  it("rejects frame-time and editable-capacity regressions on every scene", () => {
    const input = validReport();
    input.candidate.samples[0]!.frameTimeMs = timings(10.500_1);
    input.candidate.samples[1]!.editableObjectCountAt30Fps = 1_799;

    expect(evaluateStudioBg3dEngineAdoption(input).failures).toEqual(expect.arrayContaining([
      { code: "scene-frame-time-regression-gate-failed", corpusItemId: "small-room" },
      { code: "scene-editable-capacity-regression-gate-failed", corpusItemId: "medium-street" },
    ]));
  });

  it("still rejects a large-scene frame regression when its 2x capacity proof passes", () => {
    const input = validReport();
    input.candidate.samples[2]!.frameTimeMs = timings(42.001);
    input.candidate.samples[2]!.editableObjectCountAt30Fps = 10_000;

    const failures = evaluateStudioBg3dEngineAdoption(input).failures;
    expect(failures).toContainEqual({
      code: "scene-frame-time-regression-gate-failed",
      corpusItemId: "large-city",
    });
    expect(failures).not.toContainEqual({
      code: "large-scene-performance-gate-failed",
      corpusItemId: "large-city",
    });
  });

  it("binds scene composition to the approved manifest instead of trusting report labels", () => {
    const input = validReport();
    for (const benchmarkRun of [input.baseline, input.candidate]) {
      for (const benchmarkSample of benchmarkRun.samples) benchmarkSample.sceneClass = "small";
    }

    expect(evaluateStudioBg3dEngineAdoption(input)).toMatchObject({
      decision: "reject",
      metrics: null,
      failures: [{ code: "unapproved-benchmark-context" }],
    });

    const allSmallContext = approvedContext();
    allSmallContext.corpusManifest = allSmallContext.corpusManifest.map((item) => ({
      ...item,
      sceneClass: "small" as const,
    }));
    expect(evaluateStudioBg3dEngineAdoptionRaw(input, allSmallContext)).toMatchObject({
      decision: "reject",
      metrics: null,
      failures: [{ code: "unapproved-benchmark-context" }],
    });
  });

  it("requires an independently approved exact corpus, profile, device, build, and engine pair", () => {
    const report = validReport();
    expect(evaluateStudioBg3dEngineAdoptionRaw(report, undefined)).toMatchObject({
      decision: "reject",
      scope: "approved-device-context",
      approvalId: null,
      metrics: null,
      failures: [{ code: "unapproved-benchmark-context" }],
    });

    for (const field of [
      "corpusHash",
      "buildId",
      "captureProfileHash",
      "deviceFingerprint",
      "baselineEngineId",
      "candidateEngineId",
      "baselineBackend",
      "candidateBackend",
      "baselineAdapterFingerprint",
      "candidateAdapterFingerprint",
    ] as const) {
      const context = approvedContext();
      Object.assign(context, { [field]: `${context[field]}-different` });
      expect(evaluateStudioBg3dEngineAdoptionRaw(report, context).failures)
        .toEqual([{ code: "unapproved-benchmark-context" }]);
    }

    const omittedScene = validReport();
    omittedScene.baseline.samples.splice(1, 1);
    omittedScene.candidate.samples.splice(1, 1);
    omittedScene.captureDiffs.splice(1, 1);
    expect(evaluateStudioBg3dEngineAdoptionRaw(omittedScene, approvedContext()).failures)
      .toEqual([{ code: "unapproved-benchmark-context" }]);

    const relabeled = approvedContext();
    relabeled.corpusManifest[2] = {
      ...relabeled.corpusManifest[2]!,
      sceneClass: "medium",
    };
    expect(evaluateStudioBg3dEngineAdoptionRaw(report, relabeled).failures)
      .toEqual([{ code: "unapproved-benchmark-context" }]);

    const resized = approvedContext();
    resized.corpusManifest[0] = {
      ...resized.corpusManifest[0]!,
      captureWidth: 9,
    };
    expect(evaluateStudioBg3dEngineAdoptionRaw(report, resized).failures)
      .toEqual([{ code: "unapproved-benchmark-context" }]);
  });

  it("rejects p95 input latency above 100ms and gzip regression above 15%", () => {
    const input = validReport();
    input.candidate.samples[0]!.inputLatencyMs = timings(100.01);
    input.candidate.toolOpenGzipBytes = 115_001;

    const codes = evaluateStudioBg3dEngineAdoption(input).failures.map(({ code }) => code);
    expect(codes).toContain("input-latency-gate-failed");
    expect(codes).toContain("tool-open-gzip-gate-failed");
  });

  it("rejects software and unknown adapters instead of accepting misleading timing wins", () => {
    const input = validReport();
    input.baseline.adapter.adapterClass = "software";
    input.candidate.adapter.adapterClass = "unknown";

    expect(evaluateStudioBg3dEngineAdoption(input).failures).toEqual(expect.arrayContaining([
      { code: "baseline-software-adapter" },
      { code: "candidate-software-adapter" },
    ]));
  });

  it("gates pixel and depth regressions independently for every corpus capture", () => {
    const input = validReport();
    Object.assign(input.captureDiffs[0]!, {
      mismatchedPixelCount: 1,
      maximumChannelDelta: 17,
      meanAbsoluteChannelDelta: 0.5,
    });
    Object.assign(input.captureDiffs[1]!, {
      mismatchedDepthSampleCount: 1,
      maximumDepthDelta: 0.006,
      meanAbsoluteDepthDelta: 0.000_6,
    });

    expect(evaluateStudioBg3dEngineAdoption(input).failures).toEqual(expect.arrayContaining([
      { code: "pixel-diff-gate-failed", corpusItemId: "small-room" },
      { code: "depth-diff-gate-failed", corpusItemId: "medium-street" },
    ]));
  });

  it("reports every failed baseline and candidate golden contract", () => {
    const input = validReport();
    input.baseline.conformance.sceneRoundTripPassed = false;
    input.candidate.conformance.undoRedoPassed = false;
    input.candidate.conformance.objGoldenPassed = false;

    expect(evaluateStudioBg3dEngineAdoption(input).failures).toEqual(expect.arrayContaining([
      { code: "baseline-conformance-failed", field: "sceneRoundTripPassed" },
      { code: "candidate-conformance-failed", field: "undoRedoPassed" },
      { code: "candidate-conformance-failed", field: "objGoldenPassed" },
    ]));
  });

  it("requires the full 30-minute recovery, memory, context, job, and dispose proof", () => {
    const input = validReport();
    Object.assign(input.candidate.recovery, {
      soakDurationMs: STUDIO_BG3D_ENGINE_ADOPTION_POLICY.minimumSoakDurationMs - 1,
      sustainedMemoryGrowth: true,
      unexpectedContextLossCount: 1,
      initializationFailureRecovered: false,
      deviceLossRecovered: false,
      contextLossRecovered: false,
      documentPreserved: false,
      pendingJobsSettled: false,
      disposeCompleted: false,
      ownedResourcesReleased: false,
    });

    const codes = evaluateStudioBg3dEngineAdoption(input).failures.map(({ code }) => code);
    expect(codes).toEqual(expect.arrayContaining([
      "soak-duration-gate-failed",
      "sustained-memory-growth",
      "unexpected-context-loss",
      "initialization-recovery-failed",
      "device-loss-recovery-failed",
      "context-loss-recovery-failed",
      "recovery-data-loss",
      "pending-jobs-not-settled",
      "dispose-failed",
      "owned-resources-not-released",
    ]));
  });

  it("does not demand a WebGPU device-loss test from a WebGL-only candidate", () => {
    const input = validReport();
    input.candidate.adapter.backend = "webgl2";
    input.candidate.recovery.deviceLossRecovered = false;

    expect(evaluateStudioBg3dEngineAdoption(input).failures.map(({ code }) => code))
      .not.toContain("device-loss-recovery-failed");
  });

  it("fails closed before analysis for mismatched devices, missing fields, NaN, or sample overflow", () => {
    const mismatchedDevice = validReport();
    mismatchedDevice.candidate.environment.deviceFingerprint = "different-device";
    expect(evaluateStudioBg3dEngineAdoption(mismatchedDevice)).toMatchObject({
      decision: "reject",
      metrics: null,
      failures: [{ code: "invalid-benchmark-contract" }],
    });

    const missing = validReport();
    delete (missing.candidate as Partial<typeof missing.candidate>).recovery;
    expect(evaluateStudioBg3dEngineAdoption(missing).failures)
      .toEqual([{ code: "invalid-benchmark-contract" }]);

    const nan = validReport();
    nan.candidate.samples[0]!.frameTimeMs[0] = Number.NaN;
    expect(evaluateStudioBg3dEngineAdoption(nan).failures)
      .toEqual([{ code: "invalid-benchmark-contract" }]);

    const overflow = validReport();
    overflow.candidate.samples[0]!.inputLatencyMs = timings(
      1,
      STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES + 1,
    );
    expect(evaluateStudioBg3dEngineAdoption(overflow).failures)
      .toEqual([{ code: "invalid-benchmark-contract" }]);
  });
});
