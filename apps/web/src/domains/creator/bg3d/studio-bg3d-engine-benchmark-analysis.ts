import {
  STUDIO_BG3D_ENGINE_BENCHMARK_DEPTH_TOLERANCE,
  STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CAPTURE_PIXELS,
  STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES,
  STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_MS,
  STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES,
  STUDIO_BG3D_ENGINE_BENCHMARK_PIXEL_CHANNEL_TOLERANCE,
  normalizeStudioBg3dEngineBenchmarkApprovedContext,
  normalizeStudioBg3dEngineBenchmarkReport,
} from "./studio-bg3d-engine-benchmark-contract";

import type {
  StudioBg3dEngineBenchmarkApprovedContext,
  StudioBg3dEngineBenchmarkConformance,
  StudioBg3dEngineBenchmarkReport,
  StudioBg3dEngineCaptureDiff,
} from "./studio-bg3d-engine-benchmark-contract";

export const STUDIO_BG3D_ENGINE_ADOPTION_POLICY = Object.freeze({
  minimumFrameTimeImprovementRatio: 0.25,
  minimumEditableObjectScaleRatio: 2,
  maximumPerSceneFrameTimeRegressionRatio: 0.05,
  minimumPerSceneEditableObjectRetentionRatio: 0.9,
  maximumInputLatencyP95Ms: 100,
  maximumToolOpenGzipRegressionRatio: 0.15,
  minimumSoakDurationMs: 30 * 60 * 1_000,
  capture: Object.freeze({
    pixelChannelComparisonTolerance: STUDIO_BG3D_ENGINE_BENCHMARK_PIXEL_CHANNEL_TOLERANCE,
    maximumPixelMismatchRatio: 0.005,
    maximumChannelDelta: 16,
    maximumMeanAbsoluteChannelDelta: 1,
    depthComparisonTolerance: STUDIO_BG3D_ENGINE_BENCHMARK_DEPTH_TOLERANCE,
    maximumDepthMismatchRatio: 0.005,
    maximumDepthDelta: 0.005,
    maximumMeanAbsoluteDepthDelta: 0.0005,
  }),
});

export interface StudioBg3dEngineCapture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
  /** Linear normalized depth in [0, 1], one sample per pixel. */
  readonly depthFloat32?: Float32Array;
}

interface StudioBg3dEngineCaptureSourceSnapshot {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
  readonly depthFloat32?: Float32Array;
}

export type StudioBg3dEngineCaptureDiffFailureReason =
  | "invalid-corpus-item-id"
  | "invalid-capture"
  | "capture-size-mismatch"
  | "capture-pixel-budget-exceeded"
  | "missing-depth"
  | "invalid-depth"
  | "shared-capture-buffer"
  | "aliased-capture-buffer";

export type StudioBg3dEngineCaptureDiffResult =
  | { readonly ok: true; readonly diff: StudioBg3dEngineCaptureDiff }
  | { readonly ok: false; readonly reason: StudioBg3dEngineCaptureDiffFailureReason };

export type StudioBg3dEngineAdoptionFailureCode =
  | "invalid-benchmark-contract"
  | "unapproved-benchmark-context"
  | "baseline-software-adapter"
  | "candidate-software-adapter"
  | "scene-frame-time-regression-gate-failed"
  | "scene-editable-capacity-regression-gate-failed"
  | "large-scene-performance-gate-failed"
  | "input-latency-gate-failed"
  | "tool-open-gzip-gate-failed"
  | "pixel-diff-gate-failed"
  | "depth-diff-gate-failed"
  | "baseline-conformance-failed"
  | "candidate-conformance-failed"
  | "soak-duration-gate-failed"
  | "sustained-memory-growth"
  | "unexpected-context-loss"
  | "initialization-recovery-failed"
  | "device-loss-recovery-failed"
  | "context-loss-recovery-failed"
  | "recovery-data-loss"
  | "pending-jobs-not-settled"
  | "dispose-failed"
  | "owned-resources-not-released";

export interface StudioBg3dEngineAdoptionFailure {
  readonly code: StudioBg3dEngineAdoptionFailureCode;
  readonly corpusItemId?: string;
  readonly field?: string;
}

export interface StudioBg3dEngineSceneComparisonMetrics {
  readonly corpusItemId: string;
  readonly sceneClass: "small" | "medium" | "large";
  readonly baselineFrameTimeP95Ms: number;
  readonly candidateFrameTimeP95Ms: number;
  readonly frameTimeImprovementRatio: number;
  readonly editableObjectScaleRatio: number;
  readonly candidateInputLatencyP95Ms: number;
}

export interface StudioBg3dEngineAdoptionMetrics {
  readonly sceneComparisons: readonly StudioBg3dEngineSceneComparisonMetrics[];
  readonly toolOpenGzipRegressionRatio: number;
}

export interface StudioBg3dEngineAdoptionEvaluation {
  /** A qualification is limited to `scope`; it is never a global engine-adoption decision. */
  readonly decision: "qualify-approved-context" | "reject";
  readonly scope: "approved-device-context";
  readonly approvalId: string | null;
  readonly benchmarkId: string | null;
  readonly baselineEngineId: string | null;
  readonly candidateEngineId: string | null;
  readonly metrics: StudioBg3dEngineAdoptionMetrics | null;
  readonly failures: readonly StudioBg3dEngineAdoptionFailure[];
}

function captureDiffFailure(
  reason: StudioBg3dEngineCaptureDiffFailureReason,
): StudioBg3dEngineCaptureDiffResult {
  return Object.freeze({ ok: false, reason });
}

function isValidDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 16_384;
}

function isRgbaArray(value: unknown): value is Uint8Array | Uint8ClampedArray {
  return ArrayBuffer.isView(value) && (
    value instanceof Uint8Array && Object.getPrototypeOf(value) === Uint8Array.prototype ||
    value instanceof Uint8ClampedArray && Object.getPrototypeOf(value) === Uint8ClampedArray.prototype
  );
}

function validCorpusItemId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value);
}

function hasSharedBackingBuffer(value: ArrayBufferView): boolean {
  return typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer;
}

function snapshotCapture(
  value: unknown,
):
  | { readonly ok: true; readonly capture: StudioBg3dEngineCaptureSourceSnapshot }
  | { readonly ok: false; readonly reason: "invalid-capture" | "shared-capture-buffer" } {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, reason: "invalid-capture" };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, reason: "invalid-capture" };
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 8) return { ok: false, reason: "invalid-capture" };

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") return { ok: false, reason: "invalid-capture" };
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        return { ok: false, reason: "invalid-capture" };
      }
      snapshot[key] = descriptor.value;
    }
    if (
      !isValidDimension(snapshot.width) || !isValidDimension(snapshot.height) ||
      !isRgbaArray(snapshot.rgba) ||
      snapshot.depthFloat32 !== undefined && (
        !(snapshot.depthFloat32 instanceof Float32Array) ||
        !ArrayBuffer.isView(snapshot.depthFloat32) ||
        Object.getPrototypeOf(snapshot.depthFloat32) !== Float32Array.prototype
      )
    ) {
      return { ok: false, reason: "invalid-capture" };
    }
    if (
      hasSharedBackingBuffer(snapshot.rgba) ||
      snapshot.depthFloat32 !== undefined && hasSharedBackingBuffer(snapshot.depthFloat32)
    ) {
      return { ok: false, reason: "shared-capture-buffer" };
    }
    return Object.freeze({
      ok: true,
      capture: Object.freeze({
        width: snapshot.width,
        height: snapshot.height,
        rgba: snapshot.rgba,
        depthFloat32: snapshot.depthFloat32,
      }),
    });
  } catch {
    return { ok: false, reason: "invalid-capture" };
  }
}

function capturesShareBackingBuffer(
  baseline: StudioBg3dEngineCaptureSourceSnapshot,
  candidate: StudioBg3dEngineCaptureSourceSnapshot,
): boolean {
  const baselineBuffers = [baseline.rgba.buffer, baseline.depthFloat32?.buffer];
  const candidateBuffers = [candidate.rgba.buffer, candidate.depthFloat32?.buffer];
  return baselineBuffers.some(
    (baselineBuffer) => baselineBuffer !== undefined &&
      candidateBuffers.some((candidateBuffer) => candidateBuffer === baselineBuffer),
  );
}

function copyCaptureBuffers(
  source: StudioBg3dEngineCaptureSourceSnapshot,
): StudioBg3dEngineCaptureSourceSnapshot | null {
  try {
    const rgba = source.rgba instanceof Uint8ClampedArray
      ? new Uint8ClampedArray(source.rgba)
      : new Uint8Array(source.rgba);
    const depthFloat32 = source.depthFloat32 === undefined
      ? undefined
      : new Float32Array(source.depthFloat32);
    return Object.freeze({ width: source.width, height: source.height, rgba, depthFloat32 });
  } catch {
    return null;
  }
}

function snapshotTimingSamples(value: unknown): readonly number[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
  const length = lengthDescriptor.value;
  if (
    typeof length !== "number" || !Number.isSafeInteger(length) ||
    length < STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES ||
    length > STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES
  ) {
    return null;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1 || ownKeys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= length;
  })) {
    return null;
  }

  const snapshot: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    const sample = descriptor.value;
    if (
      typeof sample !== "number" || !Number.isFinite(sample) ||
      sample < STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_MS || sample > 60_000
    ) {
      return null;
    }
    snapshot.push(sample);
  }
  return Object.freeze(snapshot);
}

/**
 * Compares captures without retaining either image. Missing/non-finite depth is an explicit failure,
 * not a zero-diff result, because adoption requires RGBA and depth golden parity.
 */
export function calculateStudioBg3dEngineCaptureDiff(
  corpusItemId: string,
  baseline: StudioBg3dEngineCapture,
  candidate: StudioBg3dEngineCapture,
): StudioBg3dEngineCaptureDiffResult {
  try {
    if (!validCorpusItemId(corpusItemId)) return captureDiffFailure("invalid-corpus-item-id");
    const baselineAdmission = snapshotCapture(baseline);
    const candidateAdmission = snapshotCapture(candidate);
    if (!baselineAdmission.ok) return captureDiffFailure(baselineAdmission.reason);
    if (!candidateAdmission.ok) return captureDiffFailure(candidateAdmission.reason);
    const baselineSource = baselineAdmission.capture;
    const candidateSource = candidateAdmission.capture;
    if (
      baselineSource.width !== candidateSource.width ||
      baselineSource.height !== candidateSource.height
    ) {
      return captureDiffFailure("capture-size-mismatch");
    }
    const pixelCount = baselineSource.width * baselineSource.height;
    if (pixelCount > STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CAPTURE_PIXELS) {
      return captureDiffFailure("capture-pixel-budget-exceeded");
    }
    const rgbaLength = pixelCount * 4;
    if (baselineSource.rgba.length !== rgbaLength || candidateSource.rgba.length !== rgbaLength) {
      return captureDiffFailure("invalid-capture");
    }
    if (!baselineSource.depthFloat32 || !candidateSource.depthFloat32) {
      return captureDiffFailure("missing-depth");
    }
    if (
      baselineSource.depthFloat32.length !== pixelCount ||
      candidateSource.depthFloat32.length !== pixelCount
    ) {
      return captureDiffFailure("invalid-depth");
    }
    if (capturesShareBackingBuffer(baselineSource, candidateSource)) {
      return captureDiffFailure("aliased-capture-buffer");
    }
    const baselineSnapshot = copyCaptureBuffers(baselineSource);
    const candidateSnapshot = copyCaptureBuffers(candidateSource);
    if (!baselineSnapshot || !candidateSnapshot) return captureDiffFailure("invalid-capture");
    const baselineDepthSnapshot = baselineSnapshot.depthFloat32;
    const candidateDepthSnapshot = candidateSnapshot.depthFloat32;
    if (!baselineDepthSnapshot || !candidateDepthSnapshot) {
      return captureDiffFailure("missing-depth");
    }

    let mismatchedPixelCount = 0;
    let maximumChannelDelta = 0;
    let channelDeltaTotal = 0;
    const channelTolerance = STUDIO_BG3D_ENGINE_ADOPTION_POLICY.capture.pixelChannelComparisonTolerance;
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      let pixelMismatched = false;
      const channelOffset = pixelIndex * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(
          (baselineSnapshot.rgba[channelOffset + channel] ?? 0) -
          (candidateSnapshot.rgba[channelOffset + channel] ?? 0),
        );
        maximumChannelDelta = Math.max(maximumChannelDelta, delta);
        channelDeltaTotal += delta;
        if (delta > channelTolerance) pixelMismatched = true;
      }
      if (pixelMismatched) mismatchedPixelCount += 1;
    }

    let mismatchedDepthSampleCount = 0;
    let maximumDepthDelta = 0;
    let depthDeltaTotal = 0;
    const depthTolerance = STUDIO_BG3D_ENGINE_ADOPTION_POLICY.capture.depthComparisonTolerance;
    for (let index = 0; index < pixelCount; index += 1) {
      const baselineDepth = baselineDepthSnapshot[index];
      const candidateDepth = candidateDepthSnapshot[index];
      if (
        baselineDepth === undefined || candidateDepth === undefined ||
        !Number.isFinite(baselineDepth) || !Number.isFinite(candidateDepth) ||
        baselineDepth < 0 || baselineDepth > 1 || candidateDepth < 0 || candidateDepth > 1
      ) {
        return captureDiffFailure("invalid-depth");
      }
      const delta = Math.abs(baselineDepth - candidateDepth);
      maximumDepthDelta = Math.max(maximumDepthDelta, delta);
      depthDeltaTotal += delta;
      if (delta > depthTolerance) mismatchedDepthSampleCount += 1;
    }

    const diff: StudioBg3dEngineCaptureDiff = Object.freeze({
      corpusItemId,
      width: baselineSource.width,
      height: baselineSource.height,
      comparedPixelCount: pixelCount,
      mismatchedPixelCount,
      maximumChannelDelta,
      meanAbsoluteChannelDelta: channelDeltaTotal / rgbaLength,
      comparedDepthSampleCount: pixelCount,
      mismatchedDepthSampleCount,
      maximumDepthDelta,
      meanAbsoluteDepthDelta: depthDeltaTotal / pixelCount,
    });
    return Object.freeze({ ok: true, diff });
  } catch {
    return captureDiffFailure("invalid-capture");
  }
}

/** Deterministic nearest-rank p95 over a bounded, finite timing series. */
export function calculateStudioBg3dEngineTimingP95(samples: readonly number[]): number | null {
  const snapshot = snapshotTimingSamples(samples);
  if (!snapshot) return null;
  const sorted = [...snapshot].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}

function adoptionFailure(
  code: StudioBg3dEngineAdoptionFailureCode,
  details: Pick<StudioBg3dEngineAdoptionFailure, "corpusItemId" | "field"> = {},
): StudioBg3dEngineAdoptionFailure {
  return Object.freeze({ code, ...details });
}

function conformanceFailures(
  conformance: StudioBg3dEngineBenchmarkConformance,
  code: "baseline-conformance-failed" | "candidate-conformance-failed",
): StudioBg3dEngineAdoptionFailure[] {
  const failures: StudioBg3dEngineAdoptionFailure[] = [];
  for (const [field, passed] of Object.entries(conformance)) {
    if (!passed) failures.push(adoptionFailure(code, { field }));
  }
  return failures;
}

function invalidEvaluation(): StudioBg3dEngineAdoptionEvaluation {
  return Object.freeze({
    decision: "reject",
    scope: "approved-device-context",
    approvalId: null,
    benchmarkId: null,
    baselineEngineId: null,
    candidateEngineId: null,
    metrics: null,
    failures: Object.freeze([adoptionFailure("invalid-benchmark-contract")]),
  });
}

function approvedContextMatches(
  report: StudioBg3dEngineBenchmarkReport,
  context: StudioBg3dEngineBenchmarkApprovedContext,
): boolean {
  const { environment } = report.baseline;
  if (
    context.corpusHash !== environment.corpusHash ||
    context.buildId !== environment.buildId ||
    context.captureProfileHash !== environment.captureProfileHash ||
    context.deviceFingerprint !== environment.deviceFingerprint ||
    context.baselineEngineId !== report.baseline.engineId ||
    context.candidateEngineId !== report.candidate.engineId ||
    context.baselineBackend !== report.baseline.adapter.backend ||
    context.candidateBackend !== report.candidate.adapter.backend ||
    context.baselineAdapterFingerprint !== report.baseline.adapter.adapterFingerprint ||
    context.candidateAdapterFingerprint !== report.candidate.adapter.adapterFingerprint ||
    context.corpusManifest.length !== report.baseline.samples.length ||
    context.corpusManifest.length !== report.candidate.samples.length ||
    context.corpusManifest.length !== report.captureDiffs.length
  ) {
    return false;
  }
  return context.corpusManifest.every((approvedItem, index) => {
    const baselineSample = report.baseline.samples[index];
    const candidateSample = report.candidate.samples[index];
    const captureDiff = report.captureDiffs[index];
    return baselineSample !== undefined && candidateSample !== undefined && captureDiff !== undefined &&
      approvedItem.corpusItemId === baselineSample.corpusItemId &&
      approvedItem.corpusItemId === candidateSample.corpusItemId &&
      approvedItem.corpusItemId === captureDiff.corpusItemId &&
      approvedItem.sceneClass === baselineSample.sceneClass &&
      approvedItem.sceneClass === candidateSample.sceneClass &&
      approvedItem.captureWidth === captureDiff.width &&
      approvedItem.captureHeight === captureDiff.height;
  });
}

function unapprovedContextEvaluation(
  report: StudioBg3dEngineBenchmarkReport,
  approvalId: string | null,
): StudioBg3dEngineAdoptionEvaluation {
  return Object.freeze({
    decision: "reject",
    scope: "approved-device-context",
    approvalId,
    benchmarkId: report.benchmarkId,
    baselineEngineId: report.baseline.engineId,
    candidateEngineId: report.candidate.engineId,
    metrics: null,
    failures: Object.freeze([adoptionFailure("unapproved-benchmark-context")]),
  });
}

function analyzeComparableReport(
  report: StudioBg3dEngineBenchmarkReport,
  approvalId: string,
): StudioBg3dEngineAdoptionEvaluation {
  const failures: StudioBg3dEngineAdoptionFailure[] = [];
  const sceneComparisons: StudioBg3dEngineSceneComparisonMetrics[] = [];
  if (report.baseline.adapter.adapterClass !== "hardware") {
    failures.push(adoptionFailure("baseline-software-adapter"));
  }
  if (report.candidate.adapter.adapterClass !== "hardware") {
    failures.push(adoptionFailure("candidate-software-adapter"));
  }

  for (let index = 0; index < report.baseline.samples.length; index += 1) {
    const baseline = report.baseline.samples[index];
    const candidate = report.candidate.samples[index];
    if (!baseline || !candidate) return invalidEvaluation();
    const baselineFrameTimeP95Ms = calculateStudioBg3dEngineTimingP95(baseline.frameTimeMs);
    const candidateFrameTimeP95Ms = calculateStudioBg3dEngineTimingP95(candidate.frameTimeMs);
    const candidateInputLatencyP95Ms = calculateStudioBg3dEngineTimingP95(candidate.inputLatencyMs);
    if (
      baselineFrameTimeP95Ms === null ||
      candidateFrameTimeP95Ms === null ||
      candidateInputLatencyP95Ms === null
    ) {
      return invalidEvaluation();
    }
    const frameTimeImprovementRatio =
      (baselineFrameTimeP95Ms - candidateFrameTimeP95Ms) / baselineFrameTimeP95Ms;
    const editableObjectScaleRatio =
      candidate.editableObjectCountAt30Fps / baseline.editableObjectCountAt30Fps;
    if (!Number.isFinite(frameTimeImprovementRatio) || !Number.isFinite(editableObjectScaleRatio)) {
      return invalidEvaluation();
    }
    sceneComparisons.push(Object.freeze({
      corpusItemId: baseline.corpusItemId,
      sceneClass: baseline.sceneClass,
      baselineFrameTimeP95Ms,
      candidateFrameTimeP95Ms,
      frameTimeImprovementRatio,
      editableObjectScaleRatio,
      candidateInputLatencyP95Ms,
    }));
    if (
      candidateFrameTimeP95Ms > baselineFrameTimeP95Ms *
        (1 + STUDIO_BG3D_ENGINE_ADOPTION_POLICY.maximumPerSceneFrameTimeRegressionRatio)
    ) {
      failures.push(adoptionFailure("scene-frame-time-regression-gate-failed", {
        corpusItemId: baseline.corpusItemId,
      }));
    }
    if (
      editableObjectScaleRatio <
        STUDIO_BG3D_ENGINE_ADOPTION_POLICY.minimumPerSceneEditableObjectRetentionRatio
    ) {
      failures.push(adoptionFailure("scene-editable-capacity-regression-gate-failed", {
        corpusItemId: baseline.corpusItemId,
      }));
    }
    if (
      baseline.sceneClass === "large" &&
      frameTimeImprovementRatio < STUDIO_BG3D_ENGINE_ADOPTION_POLICY.minimumFrameTimeImprovementRatio &&
      editableObjectScaleRatio < STUDIO_BG3D_ENGINE_ADOPTION_POLICY.minimumEditableObjectScaleRatio
    ) {
      failures.push(adoptionFailure("large-scene-performance-gate-failed", {
        corpusItemId: baseline.corpusItemId,
      }));
    }
    if (candidateInputLatencyP95Ms > STUDIO_BG3D_ENGINE_ADOPTION_POLICY.maximumInputLatencyP95Ms) {
      failures.push(adoptionFailure("input-latency-gate-failed", {
        corpusItemId: baseline.corpusItemId,
      }));
    }
  }

  const toolOpenGzipRegressionRatio =
    (report.candidate.toolOpenGzipBytes - report.baseline.toolOpenGzipBytes) /
    report.baseline.toolOpenGzipBytes;
  if (!Number.isFinite(toolOpenGzipRegressionRatio)) return invalidEvaluation();
  if (
    toolOpenGzipRegressionRatio >
    STUDIO_BG3D_ENGINE_ADOPTION_POLICY.maximumToolOpenGzipRegressionRatio
  ) {
    failures.push(adoptionFailure("tool-open-gzip-gate-failed"));
  }

  for (const diff of report.captureDiffs) {
    const pixelMismatchRatio = diff.mismatchedPixelCount / diff.comparedPixelCount;
    if (!Number.isFinite(pixelMismatchRatio)) return invalidEvaluation();
    if (
      pixelMismatchRatio > STUDIO_BG3D_ENGINE_ADOPTION_POLICY.capture.maximumPixelMismatchRatio ||
      diff.maximumChannelDelta > STUDIO_BG3D_ENGINE_ADOPTION_POLICY.capture.maximumChannelDelta ||
      diff.meanAbsoluteChannelDelta >
        STUDIO_BG3D_ENGINE_ADOPTION_POLICY.capture.maximumMeanAbsoluteChannelDelta
    ) {
      failures.push(adoptionFailure("pixel-diff-gate-failed", {
        corpusItemId: diff.corpusItemId,
      }));
    }
    const depthMismatchRatio = diff.mismatchedDepthSampleCount / diff.comparedDepthSampleCount;
    if (!Number.isFinite(depthMismatchRatio)) return invalidEvaluation();
    if (
      depthMismatchRatio > STUDIO_BG3D_ENGINE_ADOPTION_POLICY.capture.maximumDepthMismatchRatio ||
      diff.maximumDepthDelta > STUDIO_BG3D_ENGINE_ADOPTION_POLICY.capture.maximumDepthDelta ||
      diff.meanAbsoluteDepthDelta >
        STUDIO_BG3D_ENGINE_ADOPTION_POLICY.capture.maximumMeanAbsoluteDepthDelta
    ) {
      failures.push(adoptionFailure("depth-diff-gate-failed", {
        corpusItemId: diff.corpusItemId,
      }));
    }
  }

  failures.push(...conformanceFailures(report.baseline.conformance, "baseline-conformance-failed"));
  failures.push(...conformanceFailures(report.candidate.conformance, "candidate-conformance-failed"));

  const recovery = report.candidate.recovery;
  if (recovery.soakDurationMs < STUDIO_BG3D_ENGINE_ADOPTION_POLICY.minimumSoakDurationMs) {
    failures.push(adoptionFailure("soak-duration-gate-failed"));
  }
  if (recovery.sustainedMemoryGrowth) failures.push(adoptionFailure("sustained-memory-growth"));
  if (recovery.unexpectedContextLossCount > 0) failures.push(adoptionFailure("unexpected-context-loss"));
  if (!recovery.initializationFailureRecovered) {
    failures.push(adoptionFailure("initialization-recovery-failed"));
  }
  if (report.candidate.adapter.backend === "webgpu" && !recovery.deviceLossRecovered) {
    failures.push(adoptionFailure("device-loss-recovery-failed"));
  }
  if (!recovery.contextLossRecovered) failures.push(adoptionFailure("context-loss-recovery-failed"));
  if (!recovery.documentPreserved) failures.push(adoptionFailure("recovery-data-loss"));
  if (!recovery.pendingJobsSettled) failures.push(adoptionFailure("pending-jobs-not-settled"));
  if (!recovery.disposeCompleted) failures.push(adoptionFailure("dispose-failed"));
  if (!recovery.ownedResourcesReleased) {
    failures.push(adoptionFailure("owned-resources-not-released"));
  }

  const metrics: StudioBg3dEngineAdoptionMetrics = Object.freeze({
    sceneComparisons: Object.freeze(sceneComparisons),
    toolOpenGzipRegressionRatio,
  });
  return Object.freeze({
    decision: failures.length === 0 ? "qualify-approved-context" : "reject",
    scope: "approved-device-context",
    approvalId,
    benchmarkId: report.benchmarkId,
    baselineEngineId: report.baseline.engineId,
    candidateEngineId: report.candidate.engineId,
    metrics,
    failures: Object.freeze(failures),
  });
}

/**
 * Re-normalizes untrusted input before applying every mandatory gate for one exact, independently
 * approved device context. `qualify-approved-context` only qualifies that corpus/build/profile/
 * device and engine pair; callers must not interpret it as global adoption. The approved context
 * must come from controlled configuration and must never be copied from the submitted report.
 */
export function evaluateStudioBg3dEngineAdoption(
  value: unknown,
  approvedContextValue: unknown,
): StudioBg3dEngineAdoptionEvaluation {
  const report = normalizeStudioBg3dEngineBenchmarkReport(value);
  if (!report) return invalidEvaluation();
  const approvedContext = normalizeStudioBg3dEngineBenchmarkApprovedContext(approvedContextValue);
  if (!approvedContext || !approvedContextMatches(report, approvedContext)) {
    return unapprovedContextEvaluation(report, approvedContext?.approvalId ?? null);
  }
  return analyzeComparableReport(report, approvedContext.approvalId);
}
