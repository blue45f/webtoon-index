import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CORPUS_ITEMS,
  STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES,
  STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES,
  normalizeStudioBg3dEngineBenchmarkApprovedContext,
  normalizeStudioBg3dEngineBenchmarkReport,
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
    soakDurationMs: 30 * 60 * 1_000,
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

function environment() {
  return {
    corpusHash: "sha256:corpus-v4",
    buildId: "build-8248f956",
    captureProfileHash: "sha256:rgba-depth-profile-v1",
    deviceFingerprint: "Pixel 8 / Chrome 130 / GPU device 744c",
  };
}

function run(engineId: string, backend: "webgl2" | "webgpu") {
  return {
    engineId,
    environment: environment(),
    adapter: {
      backend,
      adapterClass: "hardware",
      adapterFingerprint: "vendor:10de/device:2489/driver:stable",
    },
    toolOpenGzipBytes: engineId === "three-webgl" ? 100_000 : 110_000,
    samples: [
      sample("small-room", "small", 10, 30, 500),
      sample("medium-street", "medium", 20, 50, 2_000),
      sample("large-city", "large", 40, 80, 5_000),
    ],
    conformance: conformance(),
    recovery: recovery(),
  };
}

function captureDiff(corpusItemId: string) {
  return {
    corpusItemId,
    width: 2,
    height: 2,
    comparedPixelCount: 4,
    mismatchedPixelCount: 0,
    maximumChannelDelta: 0,
    meanAbsoluteChannelDelta: 0,
    comparedDepthSampleCount: 4,
    mismatchedDepthSampleCount: 0,
    maximumDepthDelta: 0,
    meanAbsoluteDepthDelta: 0,
  };
}

function approvedCorpusManifest() {
  return [
    { corpusItemId: "small-room", sceneClass: "small" as const, captureWidth: 2, captureHeight: 2 },
    {
      corpusItemId: "medium-street",
      sceneClass: "medium" as const,
      captureWidth: 2,
      captureHeight: 2,
    },
    { corpusItemId: "large-city", sceneClass: "large" as const, captureWidth: 2, captureHeight: 2 },
  ];
}

function validReport() {
  return {
    kind: "toonspectrum.bg3d-engine-benchmark",
    version: 1,
    benchmarkId: "pixel8-session-001",
    baseline: run("three-webgl", "webgl2"),
    candidate: run("babylon-webgpu-lab", "webgpu"),
    captureDiffs: [
      captureDiff("small-room"),
      captureDiff("medium-street"),
      captureDiff("large-city"),
    ],
  };
}

describe("Studio BG3D engine benchmark contract", () => {
  it("normalizes, clones, strips unknown fields, and deeply freezes a comparable report", () => {
    const input = {
      ...validReport(),
      injected: new Uint8Array(1_024),
    };
    const normalized = normalizeStudioBg3dEngineBenchmarkReport(input);

    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty("injected");
    expect(normalized).not.toBe(input);
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized?.baseline)).toBe(true);
    expect(Object.isFrozen(normalized?.baseline.environment)).toBe(true);
    expect(Object.isFrozen(normalized?.baseline.samples)).toBe(true);
    expect(Object.isFrozen(normalized?.baseline.samples[0]?.frameTimeMs)).toBe(true);
    expect(Object.isFrozen(normalized?.captureDiffs)).toBe(true);

    input.baseline.samples[0]!.frameTimeMs[0] = 999;
    expect(normalized?.baseline.samples[0]?.frameTimeMs[0]).toBe(10);
  });

  it.each(["corpusHash", "buildId", "captureProfileHash", "deviceFingerprint"] as const)(
    "rejects reports measured with a different %s",
    (field) => {
      const input = validReport();
      input.candidate.environment[field] = `${input.candidate.environment[field]}-different`;
      expect(normalizeStudioBg3dEngineBenchmarkReport(input)).toBeNull();
    },
  );

  it("requires different engines over the exact same ordered corpus", () => {
    const sameEngine = validReport();
    sameEngine.candidate.engineId = sameEngine.baseline.engineId;
    expect(normalizeStudioBg3dEngineBenchmarkReport(sameEngine)).toBeNull();

    const reordered = validReport();
    reordered.candidate.samples.reverse();
    expect(normalizeStudioBg3dEngineBenchmarkReport(reordered)).toBeNull();

    const classMismatch = validReport();
    classMismatch.candidate.samples[2]!.sceneClass = "medium";
    expect(normalizeStudioBg3dEngineBenchmarkReport(classMismatch)).toBeNull();

    const missingCapture = validReport();
    missingCapture.captureDiffs.pop();
    expect(normalizeStudioBg3dEngineBenchmarkReport(missingCapture)).toBeNull();
  });

  it("leaves minimum scene composition to the independently approved corpus manifest", () => {
    const input = validReport();
    for (const benchmarkRun of [input.baseline, input.candidate]) {
      for (const benchmarkSample of benchmarkRun.samples) benchmarkSample.sceneClass = "small";
    }

    expect(normalizeStudioBg3dEngineBenchmarkReport(input)).not.toBeNull();
  });

  it("rejects duplicate corpus identifiers and reports above the corpus cap", () => {
    const duplicate = validReport();
    duplicate.baseline.samples[1]!.corpusItemId = "small-room";
    expect(normalizeStudioBg3dEngineBenchmarkReport(duplicate)).toBeNull();

    const overCap = validReport();
    overCap.baseline.samples = Array.from(
      { length: STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CORPUS_ITEMS + 1 },
      (_, index) => sample(`scene-${index}`, "large", 40, 50, 1_000),
    );
    overCap.candidate.samples = overCap.baseline.samples.map((value) => ({ ...value }));
    overCap.captureDiffs = overCap.baseline.samples.map((value) => captureDiff(value.corpusItemId));
    expect(normalizeStudioBg3dEngineBenchmarkReport(overCap)).toBeNull();
  });

  it("rejects missing, non-finite, zero, and over-cap timing series", () => {
    const missing = validReport();
    missing.candidate.samples[0]!.frameTimeMs = timings(
      10,
      STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES - 1,
    );
    expect(normalizeStudioBg3dEngineBenchmarkReport(missing)).toBeNull();

    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 60_001]) {
      const input = validReport();
      input.candidate.samples[0]!.inputLatencyMs[0] = invalid;
      expect(normalizeStudioBg3dEngineBenchmarkReport(input)).toBeNull();
    }

    const subResolution = validReport();
    subResolution.candidate.samples[0]!.inputLatencyMs[0] = 0.000_999;
    expect(normalizeStudioBg3dEngineBenchmarkReport(subResolution)).toBeNull();

    const minimumResolution = validReport();
    minimumResolution.candidate.samples[0]!.inputLatencyMs[0] = 0.001;
    expect(normalizeStudioBg3dEngineBenchmarkReport(minimumResolution)).not.toBeNull();

    const overCap = validReport();
    overCap.candidate.samples[0]!.frameTimeMs = timings(
      10,
      STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES + 1,
    );
    expect(normalizeStudioBg3dEngineBenchmarkReport(overCap)).toBeNull();
  });

  it("accepts software metadata into the contract so analysis can reject it explicitly", () => {
    const input = validReport();
    input.candidate.adapter.adapterClass = "software";
    expect(normalizeStudioBg3dEngineBenchmarkReport(input)?.candidate.adapter.adapterClass)
      .toBe("software");
  });

  it("rejects malformed dimensions, missing depth metrics, and inconsistent diff counts", () => {
    const tooLarge = validReport();
    tooLarge.captureDiffs[0]!.width = 16_384;
    tooLarge.captureDiffs[0]!.height = 16_384;
    expect(normalizeStudioBg3dEngineBenchmarkReport(tooLarge)).toBeNull();

    const missingDepth = validReport();
    delete (missingDepth.captureDiffs[0] as Partial<typeof missingDepth.captureDiffs[number]>)
      .comparedDepthSampleCount;
    expect(normalizeStudioBg3dEngineBenchmarkReport(missingDepth)).toBeNull();

    const mismatched = validReport();
    mismatched.captureDiffs[0]!.mismatchedPixelCount = 5;
    expect(normalizeStudioBg3dEngineBenchmarkReport(mismatched)).toBeNull();

    const nan = validReport();
    nan.captureDiffs[0]!.maximumDepthDelta = Number.NaN;
    expect(normalizeStudioBg3dEngineBenchmarkReport(nan)).toBeNull();
  });

  it("enforces capture-diff mathematical and threshold-count invariants", () => {
    const channelMeanAboveMaximum = validReport();
    Object.assign(channelMeanAboveMaximum.captureDiffs[0]!, {
      maximumChannelDelta: 1,
      meanAbsoluteChannelDelta: 2,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(channelMeanAboveMaximum)).toBeNull();

    const depthMeanAboveMaximum = validReport();
    Object.assign(depthMeanAboveMaximum.captureDiffs[0]!, {
      maximumDepthDelta: 0.001,
      meanAbsoluteDepthDelta: 0.002,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(depthMeanAboveMaximum)).toBeNull();

    const nonzeroMaximumWithZeroMean = validReport();
    nonzeroMaximumWithZeroMean.captureDiffs[0]!.maximumChannelDelta = 1;
    expect(normalizeStudioBg3dEngineBenchmarkReport(nonzeroMaximumWithZeroMean)).toBeNull();

    const zeroPixelMismatchesAboveTolerance = validReport();
    Object.assign(zeroPixelMismatchesAboveTolerance.captureDiffs[0]!, {
      maximumChannelDelta: 5,
      meanAbsoluteChannelDelta: 0.1,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(zeroPixelMismatchesAboveTolerance)).toBeNull();

    const pixelMismatchNotAboveTolerance = validReport();
    Object.assign(pixelMismatchNotAboveTolerance.captureDiffs[0]!, {
      mismatchedPixelCount: 1,
      maximumChannelDelta: 4,
      meanAbsoluteChannelDelta: 0.1,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(pixelMismatchNotAboveTolerance)).toBeNull();

    const zeroDepthMismatchesAboveTolerance = validReport();
    Object.assign(zeroDepthMismatchesAboveTolerance.captureDiffs[0]!, {
      maximumDepthDelta: 0.001_001,
      meanAbsoluteDepthDelta: 0.000_1,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(zeroDepthMismatchesAboveTolerance)).toBeNull();

    const depthMismatchNotAboveTolerance = validReport();
    Object.assign(depthMismatchNotAboveTolerance.captureDiffs[0]!, {
      mismatchedDepthSampleCount: 1,
      maximumDepthDelta: 0.001,
      meanAbsoluteDepthDelta: 0.000_1,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(depthMismatchNotAboveTolerance)).toBeNull();

    const impossibleChannelMean = validReport();
    Object.assign(impossibleChannelMean.captureDiffs[0]!, {
      mismatchedPixelCount: 1,
      maximumChannelDelta: 5,
      meanAbsoluteChannelDelta: 0.01,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(impossibleChannelMean)).toBeNull();

    const impossibleDepthMean = validReport();
    Object.assign(impossibleDepthMean.captureDiffs[0]!, {
      mismatchedDepthSampleCount: 1,
      maximumDepthDelta: 0.002,
      meanAbsoluteDepthDelta: 0.000_1,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(impossibleDepthMean)).toBeNull();

    const withinTolerance = validReport();
    Object.assign(withinTolerance.captureDiffs[0]!, {
      maximumChannelDelta: 4,
      meanAbsoluteChannelDelta: 0.5,
      maximumDepthDelta: 0.001,
      meanAbsoluteDepthDelta: 0.000_25,
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(withinTolerance)).not.toBeNull();
  });

  it("rejects invalid enum, integer, identifier, and boolean fields", () => {
    const invalidBackend = validReport();
    invalidBackend.candidate.adapter.backend = "webgpu-fallback" as "webgpu";
    expect(normalizeStudioBg3dEngineBenchmarkReport(invalidBackend)).toBeNull();

    const fractionalGzip = validReport();
    fractionalGzip.candidate.toolOpenGzipBytes = 100_000.5;
    expect(normalizeStudioBg3dEngineBenchmarkReport(fractionalGzip)).toBeNull();

    const invalidId = validReport();
    invalidId.benchmarkId = "../ unsafe benchmark";
    expect(normalizeStudioBg3dEngineBenchmarkReport(invalidId)).toBeNull();

    const missingBoolean = validReport();
    missingBoolean.candidate.recovery.disposeCompleted = undefined as unknown as boolean;
    expect(normalizeStudioBg3dEngineBenchmarkReport(missingBoolean)).toBeNull();
  });

  it("rejects changing object and array getters without invoking either accessor", () => {
    const input = validReport();
    const originalSamples = input.candidate.samples;
    let objectGetterReads = 0;
    Object.defineProperty(input.candidate, "samples", {
      configurable: true,
      enumerable: true,
      get() {
        objectGetterReads += 1;
        return objectGetterReads === 1 ? originalSamples : [];
      },
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(input)).toBeNull();
    expect(objectGetterReads).toBe(0);

    const arrayInput = validReport();
    const timingSeries = arrayInput.baseline.samples[0]!.frameTimeMs;
    let arrayGetterReads = 0;
    Object.defineProperty(timingSeries, "0", {
      configurable: true,
      enumerable: true,
      get() {
        arrayGetterReads += 1;
        return arrayGetterReads === 1 ? 10 : 999;
      },
    });
    expect(normalizeStudioBg3dEngineBenchmarkReport(arrayInput)).toBeNull();
    expect(arrayGetterReads).toBe(0);
  });

  it("rejects class-like object prototypes and arrays with replaced prototypes", () => {
    const objectInput = validReport();
    Object.setPrototypeOf(objectInput.candidate, { engineKind: "exotic" });
    expect(normalizeStudioBg3dEngineBenchmarkReport(objectInput)).toBeNull();

    const arrayInput = validReport();
    Object.setPrototypeOf(arrayInput.baseline.samples, Object.create(Array.prototype));
    expect(normalizeStudioBg3dEngineBenchmarkReport(arrayInput)).toBeNull();
  });

  it("normalizes only a bounded, data-only externally approved context", () => {
    const context = {
      approvalId: "lab-policy-2026-07",
      corpusHash: "sha256:corpus-v4",
      buildId: "build-8248f956",
      captureProfileHash: "sha256:rgba-depth-profile-v1",
      deviceFingerprint: "Pixel 8 / Chrome 130 / GPU device 744c",
      corpusManifest: approvedCorpusManifest(),
      baselineEngineId: "three-webgl",
      candidateEngineId: "babylon-webgpu-lab",
      baselineBackend: "webgl2" as const,
      candidateBackend: "webgpu" as const,
      baselineAdapterFingerprint: "vendor:10de/device:2489/driver:stable",
      candidateAdapterFingerprint: "vendor:10de/device:2489/driver:stable",
    };
    const normalized = normalizeStudioBg3dEngineBenchmarkApprovedContext(context);
    expect(normalized).toEqual({
      approvalId: "lab-policy-2026-07",
      corpusHash: "sha256:corpus-v4",
      buildId: "build-8248f956",
      captureProfileHash: "sha256:rgba-depth-profile-v1",
      deviceFingerprint: "Pixel 8 / Chrome 130 / GPU device 744c",
      corpusManifest: approvedCorpusManifest(),
      baselineEngineId: "three-webgl",
      candidateEngineId: "babylon-webgpu-lab",
      baselineBackend: "webgl2",
      candidateBackend: "webgpu",
      baselineAdapterFingerprint: "vendor:10de/device:2489/driver:stable",
      candidateAdapterFingerprint: "vendor:10de/device:2489/driver:stable",
    });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized?.corpusManifest)).toBe(true);
    expect(Object.isFrozen(normalized?.corpusManifest[0])).toBe(true);

    expect(normalizeStudioBg3dEngineBenchmarkApprovedContext({
      ...context,
      ignored: "fail-closed",
    })).toBeNull();

    let getterReads = 0;
    Object.defineProperty(context, "corpusHash", {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        return "sha256:changing";
      },
    });
    expect(normalizeStudioBg3dEngineBenchmarkApprovedContext(context)).toBeNull();
    expect(getterReads).toBe(0);
  });

  it("rejects malformed, duplicate, accessor-backed, and oversized approved corpus manifests", () => {
    const base = {
      approvalId: "lab-policy-2026-07",
      corpusHash: "sha256:corpus-v4",
      buildId: "build-8248f956",
      captureProfileHash: "sha256:rgba-depth-profile-v1",
      deviceFingerprint: "Pixel 8 / Chrome 130 / GPU device 744c",
      corpusManifest: approvedCorpusManifest(),
      baselineEngineId: "three-webgl",
      candidateEngineId: "babylon-webgpu-lab",
      baselineBackend: "webgl2" as const,
      candidateBackend: "webgpu" as const,
      baselineAdapterFingerprint: "vendor:10de/device:2489/driver:stable",
      candidateAdapterFingerprint: "vendor:10de/device:2489/driver:stable",
    };

    const duplicate = approvedCorpusManifest();
    duplicate[1] = { ...duplicate[1]!, corpusItemId: duplicate[0]!.corpusItemId };
    expect(normalizeStudioBg3dEngineBenchmarkApprovedContext({
      ...base,
      corpusManifest: duplicate,
    })).toBeNull();

    const oversized = approvedCorpusManifest();
    oversized[0] = { ...oversized[0]!, captureWidth: 16_384, captureHeight: 16_384 };
    expect(normalizeStudioBg3dEngineBenchmarkApprovedContext({
      ...base,
      corpusManifest: oversized,
    })).toBeNull();

    let getterReads = 0;
    const accessorItem = { ...approvedCorpusManifest()[0] } as Record<string, unknown>;
    Object.defineProperty(accessorItem, "sceneClass", {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        return "large";
      },
    });
    expect(normalizeStudioBg3dEngineBenchmarkApprovedContext({
      ...base,
      corpusManifest: [accessorItem],
    })).toBeNull();
    expect(getterReads).toBe(0);

    expect(normalizeStudioBg3dEngineBenchmarkApprovedContext({
      ...base,
      corpusManifest: approvedCorpusManifest().map((item) => ({
        ...item,
        sceneClass: "small" as const,
      })),
    })).toBeNull();
  });
});
