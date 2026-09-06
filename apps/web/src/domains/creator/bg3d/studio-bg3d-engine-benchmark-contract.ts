/**
 * Serializable, renderer-independent contract for real-device 3D engine A/B measurements.
 *
 * The normalizer is intentionally fail closed. A report is comparable only when both runs use the
 * same canonical corpus, application build, capture profile, and physical device fingerprint. Raw
 * timing series stay bounded so an untrusted lab report cannot turn analysis into an allocation or
 * sort-time denial of service.
 */

export const STUDIO_BG3D_ENGINE_BENCHMARK_VERSION = 1 as const;
export const STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CORPUS_ITEMS = 32;
export const STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES = 20;
export const STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES = 4_096;
export const STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_MS = 0.001;
export const STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CAPTURE_PIXELS = 16_777_216;
export const STUDIO_BG3D_ENGINE_BENCHMARK_PIXEL_CHANNEL_TOLERANCE = 4;
export const STUDIO_BG3D_ENGINE_BENCHMARK_DEPTH_TOLERANCE = 0.001;

export type StudioBg3dEngineBenchmarkSceneClass = "small" | "medium" | "large";
export type StudioBg3dEngineBenchmarkBackend = "webgl2" | "webgpu";
export type StudioBg3dEngineBenchmarkAdapterClass = "hardware" | "software" | "unknown";

export interface StudioBg3dEngineBenchmarkEnvironment {
  readonly corpusHash: string;
  readonly buildId: string;
  readonly captureProfileHash: string;
  readonly deviceFingerprint: string;
}

export interface StudioBg3dEngineBenchmarkAdapter {
  readonly backend: StudioBg3dEngineBenchmarkBackend;
  readonly adapterClass: StudioBg3dEngineBenchmarkAdapterClass;
  readonly adapterFingerprint: string;
}

export interface StudioBg3dEngineBenchmarkSample {
  readonly corpusItemId: string;
  readonly sceneClass: StudioBg3dEngineBenchmarkSceneClass;
  readonly frameTimeMs: readonly number[];
  readonly inputLatencyMs: readonly number[];
  /** Largest measured editable object count that sustained 30 FPS within the device memory budget. */
  readonly editableObjectCountAt30Fps: number;
}

export interface StudioBg3dEngineBenchmarkConformance {
  readonly sceneRoundTripPassed: boolean;
  readonly undoRedoPassed: boolean;
  readonly glbGoldenPassed: boolean;
  readonly gltfGoldenPassed: boolean;
  readonly objGoldenPassed: boolean;
}

export interface StudioBg3dEngineBenchmarkRecovery {
  readonly soakDurationMs: number;
  readonly sustainedMemoryGrowth: boolean;
  readonly unexpectedContextLossCount: number;
  readonly initializationFailureRecovered: boolean;
  readonly deviceLossRecovered: boolean;
  readonly contextLossRecovered: boolean;
  readonly documentPreserved: boolean;
  readonly pendingJobsSettled: boolean;
  readonly disposeCompleted: boolean;
  readonly ownedResourcesReleased: boolean;
}

export interface StudioBg3dEngineBenchmarkRun {
  readonly engineId: string;
  readonly environment: StudioBg3dEngineBenchmarkEnvironment;
  readonly adapter: StudioBg3dEngineBenchmarkAdapter;
  /** Total gzip bytes needed when opening the tool after the replaced engine chunks are removed. */
  readonly toolOpenGzipBytes: number;
  readonly samples: readonly StudioBg3dEngineBenchmarkSample[];
  readonly conformance: StudioBg3dEngineBenchmarkConformance;
  readonly recovery: StudioBg3dEngineBenchmarkRecovery;
}

export interface StudioBg3dEngineCaptureDiff {
  readonly corpusItemId: string;
  readonly width: number;
  readonly height: number;
  readonly comparedPixelCount: number;
  readonly mismatchedPixelCount: number;
  readonly maximumChannelDelta: number;
  readonly meanAbsoluteChannelDelta: number;
  readonly comparedDepthSampleCount: number;
  readonly mismatchedDepthSampleCount: number;
  readonly maximumDepthDelta: number;
  readonly meanAbsoluteDepthDelta: number;
}

export interface StudioBg3dEngineBenchmarkReport {
  readonly kind: "toonspectrum.bg3d-engine-benchmark";
  readonly version: typeof STUDIO_BG3D_ENGINE_BENCHMARK_VERSION;
  readonly benchmarkId: string;
  readonly baseline: StudioBg3dEngineBenchmarkRun;
  readonly candidate: StudioBg3dEngineBenchmarkRun;
  readonly captureDiffs: readonly StudioBg3dEngineCaptureDiff[];
}

export interface StudioBg3dEngineBenchmarkApprovedCorpusItem {
  readonly corpusItemId: string;
  readonly sceneClass: StudioBg3dEngineBenchmarkSceneClass;
  readonly captureWidth: number;
  readonly captureHeight: number;
}

/**
 * Independently approved context for one device qualification run.
 *
 * This value is a trust boundary: callers must load it from controlled configuration and must
 * never derive it from the submitted benchmark report. Exact matching deliberately limits a
 * successful evaluation to one corpus/build/profile/device and engine pair.
 */
export interface StudioBg3dEngineBenchmarkApprovedContext {
  readonly approvalId: string;
  readonly corpusHash: string;
  readonly buildId: string;
  readonly captureProfileHash: string;
  readonly deviceFingerprint: string;
  /** Exact ordered corpus and capture dimensions approved independently of the submitted report. */
  readonly corpusManifest: readonly StudioBg3dEngineBenchmarkApprovedCorpusItem[];
  readonly baselineEngineId: string;
  readonly candidateEngineId: string;
  readonly baselineBackend: StudioBg3dEngineBenchmarkBackend;
  readonly candidateBackend: StudioBg3dEngineBenchmarkBackend;
  readonly baselineAdapterFingerprint: string;
  readonly candidateAdapterFingerprint: string;
}

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_FINGERPRINT_LENGTH = 512;
const MAX_GZIP_BYTES = 1_073_741_824;
const MAX_EDITABLE_OBJECTS = 10_000_000;
const MAX_TIMING_MS = 60_000;
const MIN_SOAK_DURATION_MS = 1;
const MAX_SOAK_DURATION_MS = 24 * 60 * 60 * 1_000;
const MAX_RECORD_PROPERTIES = 48;
const APPROVED_CONTEXT_KEYS = [
  "approvalId",
  "corpusHash",
  "buildId",
  "captureProfileHash",
  "deviceFingerprint",
  "corpusManifest",
  "baselineEngineId",
  "candidateEngineId",
  "baselineBackend",
  "candidateBackend",
  "baselineAdapterFingerprint",
  "candidateAdapterFingerprint",
] as const;
const APPROVED_CORPUS_ITEM_KEYS = [
  "corpusItemId",
  "sceneClass",
  "captureWidth",
  "captureHeight",
] as const;

type DataSnapshot = Readonly<Record<string, unknown>>;

/**
 * Snapshots every own data property exactly once without invoking user getters. Unknown fields are
 * retained only in this short-lived bounded snapshot and are omitted from normalized output.
 */
function snapshotPlainRecord(value: unknown): DataSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > MAX_RECORD_PROPERTIES) return null;

  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") return null;
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    });
  }
  return Object.freeze(snapshot);
}

function hasExactSnapshotKeys(value: DataSnapshot, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

/** Snapshots a dense standard Array without iteration hooks or repeated element reads. */
function snapshotPlainArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): readonly unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
  const length = boundedInteger(lengthDescriptor.value, minimumLength, maximumLength);
  if (length === null) return null;

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1 || ownKeys.some((key) => {
    if (key === "length") return false;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)) return true;
    const index = Number(key);
    return !Number.isSafeInteger(index) || index < 0 || index >= length;
  })) {
    return null;
  }

  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) return null;
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function identifier(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)
  ) {
    return null;
  }
  return value;
}

function fingerprint(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_FINGERPRINT_LENGTH ||
    value.trim() !== value
  ) {
    return null;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return null;
  }
  return value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function boundedFinite(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function normalizeTimingSeries(value: unknown): readonly number[] | null {
  const input = snapshotPlainArray(
    value,
    STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_SAMPLES,
    STUDIO_BG3D_ENGINE_BENCHMARK_MAX_TIMING_SAMPLES,
  );
  if (!input) return null;
  const normalized: number[] = [];
  for (const sample of input) {
    const valid = boundedFinite(sample, STUDIO_BG3D_ENGINE_BENCHMARK_MIN_TIMING_MS, MAX_TIMING_MS);
    if (valid === null) return null;
    normalized.push(valid);
  }
  return Object.freeze(normalized);
}

function normalizeEnvironment(value: unknown): StudioBg3dEngineBenchmarkEnvironment | null {
  const input = snapshotPlainRecord(value);
  if (!input) return null;
  const corpusHash = fingerprint(input.corpusHash);
  const buildId = identifier(input.buildId);
  const captureProfileHash = fingerprint(input.captureProfileHash);
  const deviceFingerprint = fingerprint(input.deviceFingerprint);
  if (!corpusHash || !buildId || !captureProfileHash || !deviceFingerprint) return null;
  return Object.freeze({ corpusHash, buildId, captureProfileHash, deviceFingerprint });
}

function normalizeAdapter(value: unknown): StudioBg3dEngineBenchmarkAdapter | null {
  const input = snapshotPlainRecord(value);
  if (!input) return null;
  if (input.backend !== "webgl2" && input.backend !== "webgpu") return null;
  if (
    input.adapterClass !== "hardware" &&
    input.adapterClass !== "software" &&
    input.adapterClass !== "unknown"
  ) {
    return null;
  }
  const adapterFingerprint = fingerprint(input.adapterFingerprint);
  if (!adapterFingerprint) return null;
  return Object.freeze({
    backend: input.backend,
    adapterClass: input.adapterClass,
    adapterFingerprint,
  });
}

function normalizeSample(value: unknown): StudioBg3dEngineBenchmarkSample | null {
  const input = snapshotPlainRecord(value);
  if (!input) return null;
  const corpusItemId = identifier(input.corpusItemId);
  if (!corpusItemId) return null;
  if (input.sceneClass !== "small" && input.sceneClass !== "medium" && input.sceneClass !== "large") {
    return null;
  }
  const frameTimeMs = normalizeTimingSeries(input.frameTimeMs);
  const inputLatencyMs = normalizeTimingSeries(input.inputLatencyMs);
  const editableObjectCountAt30Fps = boundedInteger(
    input.editableObjectCountAt30Fps,
    1,
    MAX_EDITABLE_OBJECTS,
  );
  if (!frameTimeMs || !inputLatencyMs || editableObjectCountAt30Fps === null) return null;
  return Object.freeze({
    corpusItemId,
    sceneClass: input.sceneClass,
    frameTimeMs,
    inputLatencyMs,
    editableObjectCountAt30Fps,
  });
}

function normalizeConformance(value: unknown): StudioBg3dEngineBenchmarkConformance | null {
  const input = snapshotPlainRecord(value);
  if (!input) return null;
  const keys = [
    "sceneRoundTripPassed",
    "undoRedoPassed",
    "glbGoldenPassed",
    "gltfGoldenPassed",
    "objGoldenPassed",
  ] as const;
  if (keys.some((key) => typeof input[key] !== "boolean")) return null;
  return Object.freeze({
    sceneRoundTripPassed: input.sceneRoundTripPassed as boolean,
    undoRedoPassed: input.undoRedoPassed as boolean,
    glbGoldenPassed: input.glbGoldenPassed as boolean,
    gltfGoldenPassed: input.gltfGoldenPassed as boolean,
    objGoldenPassed: input.objGoldenPassed as boolean,
  });
}

function normalizeRecovery(value: unknown): StudioBg3dEngineBenchmarkRecovery | null {
  const input = snapshotPlainRecord(value);
  if (!input) return null;
  const soakDurationMs = boundedInteger(
    input.soakDurationMs,
    MIN_SOAK_DURATION_MS,
    MAX_SOAK_DURATION_MS,
  );
  const unexpectedContextLossCount = boundedInteger(input.unexpectedContextLossCount, 0, 1_000);
  const booleanKeys = [
    "sustainedMemoryGrowth",
    "initializationFailureRecovered",
    "deviceLossRecovered",
    "contextLossRecovered",
    "documentPreserved",
    "pendingJobsSettled",
    "disposeCompleted",
    "ownedResourcesReleased",
  ] as const;
  if (
    soakDurationMs === null ||
    unexpectedContextLossCount === null ||
    booleanKeys.some((key) => typeof input[key] !== "boolean")
  ) {
    return null;
  }
  return Object.freeze({
    soakDurationMs,
    sustainedMemoryGrowth: input.sustainedMemoryGrowth as boolean,
    unexpectedContextLossCount,
    initializationFailureRecovered: input.initializationFailureRecovered as boolean,
    deviceLossRecovered: input.deviceLossRecovered as boolean,
    contextLossRecovered: input.contextLossRecovered as boolean,
    documentPreserved: input.documentPreserved as boolean,
    pendingJobsSettled: input.pendingJobsSettled as boolean,
    disposeCompleted: input.disposeCompleted as boolean,
    ownedResourcesReleased: input.ownedResourcesReleased as boolean,
  });
}

function normalizeRun(value: unknown): StudioBg3dEngineBenchmarkRun | null {
  const input = snapshotPlainRecord(value);
  if (!input) return null;
  const engineId = identifier(input.engineId);
  const environment = normalizeEnvironment(input.environment);
  const adapter = normalizeAdapter(input.adapter);
  const toolOpenGzipBytes = boundedInteger(input.toolOpenGzipBytes, 1, MAX_GZIP_BYTES);
  const conformance = normalizeConformance(input.conformance);
  const recovery = normalizeRecovery(input.recovery);
  const rawSamples = snapshotPlainArray(
    input.samples,
    1,
    STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CORPUS_ITEMS,
  );
  if (
    !engineId || !environment || !adapter || toolOpenGzipBytes === null || !conformance || !recovery ||
    !rawSamples
  ) {
    return null;
  }
  const samples: StudioBg3dEngineBenchmarkSample[] = [];
  const ids = new Set<string>();
  for (const item of rawSamples) {
    const sample = normalizeSample(item);
    if (!sample || ids.has(sample.corpusItemId)) return null;
    ids.add(sample.corpusItemId);
    samples.push(sample);
  }
  return Object.freeze({
    engineId,
    environment,
    adapter,
    toolOpenGzipBytes,
    samples: Object.freeze(samples),
    conformance,
    recovery,
  });
}

function normalizeApprovedCorpusManifest(
  value: unknown,
): readonly StudioBg3dEngineBenchmarkApprovedCorpusItem[] | null {
  const input = snapshotPlainArray(
    value,
    1,
    STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CORPUS_ITEMS,
  );
  if (!input) return null;
  const manifest: StudioBg3dEngineBenchmarkApprovedCorpusItem[] = [];
  const ids = new Set<string>();
  for (const rawItem of input) {
    const item = snapshotPlainRecord(rawItem);
    if (!item || !hasExactSnapshotKeys(item, APPROVED_CORPUS_ITEM_KEYS)) return null;
    const corpusItemId = identifier(item.corpusItemId);
    if (
      !corpusItemId || ids.has(corpusItemId) ||
      item.sceneClass !== "small" && item.sceneClass !== "medium" && item.sceneClass !== "large"
    ) {
      return null;
    }
    const captureWidth = boundedInteger(item.captureWidth, 1, 16_384);
    const captureHeight = boundedInteger(item.captureHeight, 1, 16_384);
    if (
      captureWidth === null || captureHeight === null ||
      captureWidth * captureHeight > STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CAPTURE_PIXELS
    ) {
      return null;
    }
    ids.add(corpusItemId);
    manifest.push(Object.freeze({
      corpusItemId,
      sceneClass: item.sceneClass,
      captureWidth,
      captureHeight,
    }));
  }
  // A production-engine qualification may not be proven by a toy-only corpus. The independently
  // approved manifest must contain at least one large scene, and report labels are then matched
  // against this manifest exactly by the adoption evaluator.
  if (!manifest.some((item) => item.sceneClass === "large")) return null;
  return Object.freeze(manifest);
}

function normalizeCaptureDiff(value: unknown): StudioBg3dEngineCaptureDiff | null {
  const input = snapshotPlainRecord(value);
  if (!input) return null;
  const corpusItemId = identifier(input.corpusItemId);
  const width = boundedInteger(input.width, 1, 16_384);
  const height = boundedInteger(input.height, 1, 16_384);
  if (!corpusItemId || width === null || height === null) return null;
  const expectedPixels = width * height;
  if (expectedPixels > STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CAPTURE_PIXELS) return null;
  const comparedPixelCount = boundedInteger(input.comparedPixelCount, 1, expectedPixels);
  const mismatchedPixelCount = boundedInteger(input.mismatchedPixelCount, 0, expectedPixels);
  const maximumChannelDelta = boundedInteger(input.maximumChannelDelta, 0, 255);
  const meanAbsoluteChannelDelta = boundedFinite(input.meanAbsoluteChannelDelta, 0, 255);
  const comparedDepthSampleCount = boundedInteger(input.comparedDepthSampleCount, 1, expectedPixels);
  const mismatchedDepthSampleCount = boundedInteger(input.mismatchedDepthSampleCount, 0, expectedPixels);
  const maximumDepthDelta = boundedFinite(input.maximumDepthDelta, 0, 1);
  const meanAbsoluteDepthDelta = boundedFinite(input.meanAbsoluteDepthDelta, 0, 1);
  if (
    comparedPixelCount !== expectedPixels ||
    mismatchedPixelCount === null || mismatchedPixelCount > comparedPixelCount ||
    maximumChannelDelta === null || meanAbsoluteChannelDelta === null ||
    comparedDepthSampleCount !== expectedPixels ||
    mismatchedDepthSampleCount === null || mismatchedDepthSampleCount > comparedDepthSampleCount ||
    maximumDepthDelta === null || meanAbsoluteDepthDelta === null
  ) {
    return null;
  }
  if (
    meanAbsoluteChannelDelta > maximumChannelDelta ||
    meanAbsoluteChannelDelta < maximumChannelDelta / (expectedPixels * 4) ||
    meanAbsoluteChannelDelta <
      (mismatchedPixelCount * (STUDIO_BG3D_ENGINE_BENCHMARK_PIXEL_CHANNEL_TOLERANCE + 1)) /
        (expectedPixels * 4) ||
    (meanAbsoluteChannelDelta === 0) !== (maximumChannelDelta === 0) ||
    (mismatchedPixelCount === 0 &&
      maximumChannelDelta > STUDIO_BG3D_ENGINE_BENCHMARK_PIXEL_CHANNEL_TOLERANCE) ||
    (mismatchedPixelCount > 0 &&
      maximumChannelDelta <= STUDIO_BG3D_ENGINE_BENCHMARK_PIXEL_CHANNEL_TOLERANCE) ||
    meanAbsoluteDepthDelta > maximumDepthDelta ||
    meanAbsoluteDepthDelta < maximumDepthDelta / expectedPixels ||
    meanAbsoluteDepthDelta <
      (mismatchedDepthSampleCount * STUDIO_BG3D_ENGINE_BENCHMARK_DEPTH_TOLERANCE) /
        expectedPixels ||
    (meanAbsoluteDepthDelta === 0) !== (maximumDepthDelta === 0) ||
    (mismatchedDepthSampleCount === 0 &&
      maximumDepthDelta > STUDIO_BG3D_ENGINE_BENCHMARK_DEPTH_TOLERANCE) ||
    (mismatchedDepthSampleCount > 0 &&
      maximumDepthDelta <= STUDIO_BG3D_ENGINE_BENCHMARK_DEPTH_TOLERANCE)
  ) {
    return null;
  }
  return Object.freeze({
    corpusItemId,
    width,
    height,
    comparedPixelCount,
    mismatchedPixelCount,
    maximumChannelDelta,
    meanAbsoluteChannelDelta,
    comparedDepthSampleCount,
    mismatchedDepthSampleCount,
    maximumDepthDelta,
    meanAbsoluteDepthDelta,
  });
}

function sameEnvironment(
  baseline: StudioBg3dEngineBenchmarkEnvironment,
  candidate: StudioBg3dEngineBenchmarkEnvironment,
): boolean {
  return baseline.corpusHash === candidate.corpusHash &&
    baseline.buildId === candidate.buildId &&
    baseline.captureProfileHash === candidate.captureProfileHash &&
    baseline.deviceFingerprint === candidate.deviceFingerprint;
}

/** Clones and deeply freezes a bounded report, or returns null for any malformed/incomparable input. */
export function normalizeStudioBg3dEngineBenchmarkReport(
  value: unknown,
): StudioBg3dEngineBenchmarkReport | null {
  try {
    const input = snapshotPlainRecord(value);
    if (!input) return null;
    if (
      input.kind !== "toonspectrum.bg3d-engine-benchmark" ||
      input.version !== STUDIO_BG3D_ENGINE_BENCHMARK_VERSION
    ) {
      return null;
    }
    const benchmarkId = identifier(input.benchmarkId);
    const baseline = normalizeRun(input.baseline);
    const candidate = normalizeRun(input.candidate);
    const rawCaptureDiffs = snapshotPlainArray(
      input.captureDiffs,
      baseline?.samples.length ?? 1,
      baseline?.samples.length ?? STUDIO_BG3D_ENGINE_BENCHMARK_MAX_CORPUS_ITEMS,
    );
    if (
      !benchmarkId || !baseline || !candidate || baseline.engineId === candidate.engineId ||
      !sameEnvironment(baseline.environment, candidate.environment) ||
      baseline.samples.length !== candidate.samples.length ||
      !rawCaptureDiffs || rawCaptureDiffs.length !== baseline.samples.length
    ) {
      return null;
    }

    const captureDiffs: StudioBg3dEngineCaptureDiff[] = [];
    for (let index = 0; index < baseline.samples.length; index += 1) {
      const baselineSample = baseline.samples[index];
      const candidateSample = candidate.samples[index];
      const captureDiff = normalizeCaptureDiff(rawCaptureDiffs[index]);
      if (
        !baselineSample || !candidateSample || !captureDiff ||
        baselineSample.corpusItemId !== candidateSample.corpusItemId ||
        baselineSample.sceneClass !== candidateSample.sceneClass ||
        captureDiff.corpusItemId !== baselineSample.corpusItemId
      ) {
        return null;
      }
      captureDiffs.push(captureDiff);
    }

    return Object.freeze({
      kind: "toonspectrum.bg3d-engine-benchmark",
      version: STUDIO_BG3D_ENGINE_BENCHMARK_VERSION,
      benchmarkId,
      baseline,
      candidate,
      captureDiffs: Object.freeze(captureDiffs),
    });
  } catch {
    return null;
  }
}

/**
 * Normalizes an independently controlled qualification context. Do not construct this value from
 * fields in the report being evaluated; doing so removes the approval boundary.
 */
export function normalizeStudioBg3dEngineBenchmarkApprovedContext(
  value: unknown,
): StudioBg3dEngineBenchmarkApprovedContext | null {
  try {
    const input = snapshotPlainRecord(value);
    if (!input || !hasExactSnapshotKeys(input, APPROVED_CONTEXT_KEYS)) return null;
    const approvalId = identifier(input.approvalId);
    const corpusHash = fingerprint(input.corpusHash);
    const buildId = identifier(input.buildId);
    const captureProfileHash = fingerprint(input.captureProfileHash);
    const deviceFingerprint = fingerprint(input.deviceFingerprint);
    const corpusManifest = normalizeApprovedCorpusManifest(input.corpusManifest);
    const baselineEngineId = identifier(input.baselineEngineId);
    const candidateEngineId = identifier(input.candidateEngineId);
    const baselineAdapterFingerprint = fingerprint(input.baselineAdapterFingerprint);
    const candidateAdapterFingerprint = fingerprint(input.candidateAdapterFingerprint);
    if (
      !approvalId || !corpusHash || !buildId || !captureProfileHash || !deviceFingerprint ||
      !corpusManifest ||
      !baselineEngineId || !candidateEngineId || baselineEngineId === candidateEngineId ||
      input.baselineBackend !== "webgl2" && input.baselineBackend !== "webgpu" ||
      input.candidateBackend !== "webgl2" && input.candidateBackend !== "webgpu" ||
      !baselineAdapterFingerprint || !candidateAdapterFingerprint
    ) {
      return null;
    }
    return Object.freeze({
      approvalId,
      corpusHash,
      buildId,
      captureProfileHash,
      deviceFingerprint,
      corpusManifest,
      baselineEngineId,
      candidateEngineId,
      baselineBackend: input.baselineBackend,
      candidateBackend: input.candidateBackend,
      baselineAdapterFingerprint,
      candidateAdapterFingerprint,
    });
  } catch {
    return null;
  }
}
