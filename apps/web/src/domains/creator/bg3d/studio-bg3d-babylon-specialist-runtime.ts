import { normalizeStudioBg3dArtifactCaptureResultV2 } from "./studio-bg3d-artifact-capture-v2";
import {
  STUDIO_BG3D_RUNTIME_CATALOG,
  type StudioBg3dRuntimeCapability,
} from "./studio-bg3d-runtime-topology";

import type {
  StudioBg3dRuntimeAdapter,
  StudioBg3dRuntimeAdapterJob,
  StudioBg3dSpecialistRequest,
  StudioBg3dSpecialistResult,
} from "./studio-bg3d-runtime-adapter";

export type StudioBg3dBabylonBackend = "webgl2" | "webgpu";
export type StudioBg3dBabylonRuntimeId = "babylon-webgl-lab" | "babylon-webgpu-lab";

export type StudioBg3dBabylonSpecialistErrorCode =
  | "aborted"
  | "binding-load-failed"
  | "context-lost"
  | "device-lost"
  | "disposed"
  | "engine-init-failed"
  | "invalid-result"
  | "unsupported-request";

export class StudioBg3dBabylonSpecialistError extends Error {
  readonly code: StudioBg3dBabylonSpecialistErrorCode;

  constructor(code: StudioBg3dBabylonSpecialistErrorCode, cause?: unknown) {
    super(`Studio Babylon specialist failed: ${code}`, cause === undefined ? undefined : { cause });
    this.name = "StudioBg3dBabylonSpecialistError";
    this.code = code;
  }
}

export interface StudioBg3dBabylonObservableLike {
  add(callback: () => void): unknown;
  remove(observer: unknown): unknown;
}

/** Direct WebGPU device-loss signal installed by the production Babylon binding. */
export const STUDIO_BG3D_BABYLON_DEVICE_LOSS_SIGNAL: unique symbol = Symbol(
  "studio-bg3d-babylon-device-loss-signal",
);

/** Sanitized adapter metadata installed by the production WebGPU binding. */
export const STUDIO_BG3D_BABYLON_ADAPTER_DIAGNOSTIC: unique symbol = Symbol(
  "studio-bg3d-babylon-adapter-diagnostic",
);

export interface StudioBg3dBabylonAdapterDiagnostic {
  readonly architecture: string;
  readonly description: string;
  readonly device: string;
  readonly isFallbackAdapter: boolean | null;
  readonly vendor: string;
}

export interface StudioBg3dBabylonDeviceLossDiagnostic {
  readonly message: string;
  readonly reason: "destroyed" | "unknown";
}

interface StudioBg3dBabylonDiagnosticBase {
  readonly adapter: StudioBg3dBabylonAdapterDiagnostic;
  readonly backend: "webgpu";
  readonly epoch: number;
  readonly runtimeId: "babylon-webgpu-lab";
  readonly version: 1;
}

export interface StudioBg3dBabylonAdapterReadyDiagnostic
  extends StudioBg3dBabylonDiagnosticBase {
  readonly kind: "adapter-ready";
}

export interface StudioBg3dBabylonDeviceLostDiagnostic
  extends StudioBg3dBabylonDiagnosticBase {
  readonly activeJobId: string | null;
  readonly kind: "device-lost";
  readonly loss: StudioBg3dBabylonDeviceLossDiagnostic;
}

export type StudioBg3dBabylonDiagnostic =
  | StudioBg3dBabylonAdapterReadyDiagnostic
  | StudioBg3dBabylonDeviceLostDiagnostic;

export type StudioBg3dBabylonDiagnosticListener = (
  diagnostic: StudioBg3dBabylonDiagnostic,
) => void;

export class StudioBg3dBabylonDeviceLostError extends Error {
  readonly code = "device-lost" as const;
  readonly diagnostic: StudioBg3dBabylonDeviceLostDiagnostic;

  constructor(diagnostic: StudioBg3dBabylonDeviceLostDiagnostic) {
    const message = diagnostic.loss.message.length > 0
      ? `: ${diagnostic.loss.message}`
      : "";
    super(
      `Babylon WebGPU device lost (reason: ${diagnostic.loss.reason})${message}`,
    );
    this.name = "StudioBg3dBabylonDeviceLostError";
    this.diagnostic = diagnostic;
  }
}

export interface StudioBg3dBabylonEngineHandle {
  readonly [STUDIO_BG3D_BABYLON_ADAPTER_DIAGNOSTIC]?:
    StudioBg3dBabylonAdapterDiagnostic;
  readonly [STUDIO_BG3D_BABYLON_DEVICE_LOSS_SIGNAL]?: PromiseLike<unknown>;
  readonly onContextLostObservable?: StudioBg3dBabylonObservableLike;
  readonly onContextRestoredObservable?: StudioBg3dBabylonObservableLike;
  dispose(): void;
}

export interface StudioBg3dBabylonSceneHandle {
  dispose(): void;
}

export interface StudioBg3dBabylonEngineSettings {
  readonly antialias: boolean;
  readonly adaptToDeviceRatio: boolean;
  readonly deterministicLockstep: boolean;
  /**
   * Production capture defaults to hardware-quality fail-closed behavior. An explicit diagnostics
   * probe may disable this so headless/software contexts can report their real backend capability.
   */
  readonly failIfMajorPerformanceCaveat: boolean;
  readonly lockstepMaxSteps: number;
  readonly timeStepSeconds: number;
  readonly powerPreference: "high-performance" | "low-power";
  readonly preserveDrawingBuffer: boolean;
  readonly premultipliedAlpha: boolean;
  readonly stencil: boolean;
}

export interface StudioBg3dBabylonRuntimeBindings {
  createWebGlEngine(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    settings: StudioBg3dBabylonEngineSettings,
  ): StudioBg3dBabylonEngineHandle;
  createWebGpuEngine(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    settings: StudioBg3dBabylonEngineSettings,
    initialization: StudioBg3dBabylonEngineInitializationControl,
  ): Promise<StudioBg3dBabylonEngineHandle>;
  createScene(engine: StudioBg3dBabylonEngineHandle): StudioBg3dBabylonSceneHandle;
}

/**
 * Gives the runtime ownership of a WebGPU engine as soon as the binding constructs it, rather than
 * only after the asynchronous Babylon initialization promise resolves. The binding supplies an
 * idempotent disposer so a timeout, caller abort, and late promise settlement can race safely.
 */
export interface StudioBg3dBabylonEngineInitializationControl {
  readonly signal: AbortSignal;
  registerPartialEngine(
    engine: StudioBg3dBabylonEngineHandle,
    dispose: () => void,
  ): void;
}

export interface StudioBg3dBabylonSpecialistExecutionContext {
  readonly backend: StudioBg3dBabylonBackend;
  readonly engine: StudioBg3dBabylonEngineHandle;
  readonly epoch: number;
  readonly job: StudioBg3dRuntimeAdapterJob;
  readonly scene: StudioBg3dBabylonSceneHandle;
  readonly signal: AbortSignal;
}

export type StudioBg3dBabylonSpecialistExecutor = (
  context: StudioBg3dBabylonSpecialistExecutionContext,
) => Promise<unknown> | unknown;

export interface StudioBg3dBabylonSpecialistRuntimeOptions {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /**
   * WebGL2 is deliberately the default. WebGPU is a separate, explicitly requested runtime so a
   * WebGL fallback can never be mislabeled as a WebGPU capture in benchmark receipts.
   */
  readonly backend?: StudioBg3dBabylonBackend;
  readonly capabilities?: readonly StudioBg3dRuntimeCapability[];
  /**
   * Keeps production initialization fail-closed at 20 seconds while allowing an explicit
   * conformance harness to budget for a slower software WebGPU adapter. The value is bounded so a
   * wedged adapter can never hold the serialized specialist queue indefinitely.
   */
  readonly engineInitializationTimeoutMs?: number;
  readonly execute?: StudioBg3dBabylonSpecialistExecutor;
  readonly loadBindings: () => Promise<StudioBg3dBabylonRuntimeBindings>;
  /** Optional observability only; listener failures never control runtime state or job results. */
  readonly onDiagnostic?: StudioBg3dBabylonDiagnosticListener;
  readonly settings?: Partial<StudioBg3dBabylonEngineSettings>;
}

export interface StudioBg3dBabylonSpecialistRuntimeState {
  readonly activeJobId: string | null;
  readonly backend: StudioBg3dBabylonBackend;
  readonly contextLost: boolean;
  readonly disposed: boolean;
  readonly engineInitialized: boolean;
  readonly epoch: number;
  readonly queuedJobs: number;
  readonly status: "idle" | "initializing" | "running" | "context-lost" | "disposed";
}

export interface StudioBg3dBabylonSpecialistRuntime extends StudioBg3dRuntimeAdapter {
  readonly runtimeId: StudioBg3dBabylonRuntimeId;
  getState(): StudioBg3dBabylonSpecialistRuntimeState;
}

const MAX_RASTER_PIXELS = 16_777_216;
const MAX_METRIC_ENTRIES = 128;
const MAX_METRIC_KEY_LENGTH = 64;
const MAX_METRIC_STRING_LENGTH = 4_096;
const MAX_TRANSFORM_SAMPLES = 512;
const MAX_TRANSFORM_NODE_ID_LENGTH = 128;
const MAX_TRANSFORM_POSITION = 1_000_000;
const MIN_QUATERNION_LENGTH = 1e-8;
const BABYLON_ENGINE_INIT_TIMEOUT_MS = 20_000;
const MIN_BABYLON_ENGINE_INIT_TIMEOUT_MS = 1_000;
const MAX_BABYLON_ENGINE_INIT_TIMEOUT_MS = 60_000;
const MAX_ADAPTER_DIAGNOSTIC_STRING_LENGTH = 256;
const MAX_DEVICE_LOSS_MESSAGE_LENGTH = 512;
const MAX_DIAGNOSTIC_JOB_ID_LENGTH = 256;

const DEFAULT_SETTINGS: StudioBg3dBabylonEngineSettings = Object.freeze({
  antialias: true,
  adaptToDeviceRatio: true,
  deterministicLockstep: true,
  failIfMajorPerformanceCaveat: true,
  lockstepMaxSteps: 4,
  timeStepSeconds: 1 / 60,
  powerPreference: "high-performance",
  preserveDrawingBuffer: false,
  premultipliedAlpha: false,
  stencil: true,
});

type ActiveAbortReason = "aborted" | "context-lost" | "device-lost" | "disposed";

interface ActiveJob {
  readonly controller: AbortController;
  readonly id: string;
  deviceLostError: StudioBg3dBabylonDeviceLostError | null;
  reason: ActiveAbortReason | null;
}

interface EngineRecord {
  readonly adapterDiagnostic: StudioBg3dBabylonAdapterDiagnostic;
  readonly createdAtEpoch: number;
  deviceLossHandled: boolean;
  readonly engine: StudioBg3dBabylonEngineHandle;
  disposed: boolean;
  expectedDisposal: boolean;
  lostObserver?: unknown;
  observersDetached: boolean;
  restoredObserver?: unknown;
  stopDeviceLossObservation?: () => void;
}

function specialistError(
  code: StudioBg3dBabylonSpecialistErrorCode,
  cause?: unknown,
): StudioBg3dBabylonSpecialistError {
  return new StudioBg3dBabylonSpecialistError(code, cause);
}

function runtimeIdForBackend(backend: StudioBg3dBabylonBackend): StudioBg3dBabylonRuntimeId {
  return backend === "webgpu" ? "babylon-webgpu-lab" : "babylon-webgl-lab";
}

function sanitizeSettings(
  value: Partial<StudioBg3dBabylonEngineSettings> | undefined,
): StudioBg3dBabylonEngineSettings {
  const lockstepMaxSteps = value?.lockstepMaxSteps;
  const timeStepSeconds = value?.timeStepSeconds;
  if (
    lockstepMaxSteps !== undefined &&
    (!Number.isSafeInteger(lockstepMaxSteps) || lockstepMaxSteps < 1 || lockstepMaxSteps > 16)
  ) {
    throw new RangeError("Babylon lockstepMaxSteps must be an integer between 1 and 16.");
  }
  if (
    timeStepSeconds !== undefined &&
    (!Number.isFinite(timeStepSeconds) || timeStepSeconds < 1 / 240 || timeStepSeconds > 1 / 15)
  ) {
    throw new RangeError("Babylon timeStepSeconds must be between 1/240 and 1/15 seconds.");
  }
  return Object.freeze({
    antialias: value?.antialias ?? DEFAULT_SETTINGS.antialias,
    adaptToDeviceRatio: value?.adaptToDeviceRatio ?? DEFAULT_SETTINGS.adaptToDeviceRatio,
    deterministicLockstep:
      value?.deterministicLockstep ?? DEFAULT_SETTINGS.deterministicLockstep,
    failIfMajorPerformanceCaveat:
      value?.failIfMajorPerformanceCaveat ?? DEFAULT_SETTINGS.failIfMajorPerformanceCaveat,
    lockstepMaxSteps: lockstepMaxSteps ?? DEFAULT_SETTINGS.lockstepMaxSteps,
    timeStepSeconds: timeStepSeconds ?? DEFAULT_SETTINGS.timeStepSeconds,
    powerPreference: value?.powerPreference ?? DEFAULT_SETTINGS.powerPreference,
    preserveDrawingBuffer:
      value?.preserveDrawingBuffer ?? DEFAULT_SETTINGS.preserveDrawingBuffer,
    premultipliedAlpha: value?.premultipliedAlpha ?? DEFAULT_SETTINGS.premultipliedAlpha,
    stencil: value?.stencil ?? DEFAULT_SETTINGS.stencil,
  });
}

function sanitizeEngineInitializationTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? BABYLON_ENGINE_INIT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MIN_BABYLON_ENGINE_INIT_TIMEOUT_MS ||
    timeoutMs > MAX_BABYLON_ENGINE_INIT_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Babylon engine initialization timeout must be an integer between ` +
        `${MIN_BABYLON_ENGINE_INIT_TIMEOUT_MS} and ` +
        `${MAX_BABYLON_ENGINE_INIT_TIMEOUT_MS} milliseconds.`,
    );
  }
  return timeoutMs;
}

function sanitizeCapabilities(
  runtimeId: StudioBg3dBabylonRuntimeId,
  values: readonly StudioBg3dRuntimeCapability[] | undefined,
): ReadonlySet<StudioBg3dRuntimeCapability> {
  const descriptor = STUDIO_BG3D_RUNTIME_CATALOG[runtimeId];
  const capabilities = new Set<StudioBg3dRuntimeCapability>();
  for (const capability of values ?? []) {
    if (!descriptor.capabilities.has(capability)) {
      throw new RangeError(`Babylon runtime capability is unavailable: ${capability}`);
    }
    capabilities.add(capability);
  }
  return capabilities;
}

function isSharedArrayBuffer(value: ArrayBufferLike): boolean {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

function validRasterSize(width: unknown, height: unknown): boolean {
  return typeof width === "number" && Number.isSafeInteger(width) && width > 0 &&
    typeof height === "number" && Number.isSafeInteger(height) && height > 0 &&
    width <= Math.floor(MAX_RASTER_PIXELS / height);
}

function expectedRasterSize(
  request: StudioBg3dSpecialistRequest,
): { readonly width: number; readonly height: number } | null {
  if ("width" in request && "height" in request) {
    return validRasterSize(request.width, request.height)
      ? { width: request.width, height: request.height }
      : null;
  }
  return null;
}

function plainDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return null;
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function diagnosticField(value: unknown, key: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function sanitizeDiagnosticString(
  value: unknown,
  maximumLength: number,
  fallback: string,
): string {
  if (typeof value !== "string") return fallback;
  let sanitized = "";
  for (const character of value) {
    if (sanitized.length + character.length > maximumLength) break;
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }
  return sanitized;
}

/** Produces a deeply portable snapshot and never retains a native GPUAdapterInfo object. */
export function sanitizeStudioBg3dBabylonAdapterDiagnostic(
  value: unknown,
  fallbackAdapterValue?: unknown,
): StudioBg3dBabylonAdapterDiagnostic {
  const architecture = diagnosticField(value, "architecture") ??
    diagnosticField(value, "renderer");
  const description = diagnosticField(value, "description") ??
    diagnosticField(value, "version");
  const fallbackAdapter = typeof fallbackAdapterValue === "boolean"
    ? fallbackAdapterValue
    : diagnosticField(value, "isFallbackAdapter");
  return Object.freeze({
    architecture: sanitizeDiagnosticString(
      architecture,
      MAX_ADAPTER_DIAGNOSTIC_STRING_LENGTH,
      "unknown",
    ),
    description: sanitizeDiagnosticString(
      description,
      MAX_ADAPTER_DIAGNOSTIC_STRING_LENGTH,
      "unknown",
    ),
    device: sanitizeDiagnosticString(
      diagnosticField(value, "device"),
      MAX_ADAPTER_DIAGNOSTIC_STRING_LENGTH,
      "unknown",
    ),
    isFallbackAdapter: typeof fallbackAdapter === "boolean" ? fallbackAdapter : null,
    vendor: sanitizeDiagnosticString(
      diagnosticField(value, "vendor"),
      MAX_ADAPTER_DIAGNOSTIC_STRING_LENGTH,
      "unknown",
    ),
  });
}

/** Copies the WebIDL payload into a bounded POJO before it can enter logs or callbacks. */
export function sanitizeStudioBg3dBabylonDeviceLossDiagnostic(
  value: unknown,
): StudioBg3dBabylonDeviceLossDiagnostic {
  const reason = diagnosticField(value, "reason");
  return Object.freeze({
    message: sanitizeDiagnosticString(
      diagnosticField(value, "message"),
      MAX_DEVICE_LOSS_MESSAGE_LENGTH,
      "",
    ),
    reason: reason === "destroyed" ? "destroyed" : "unknown",
  });
}

function sanitizeDiagnosticJobId(value: string | null): string | null {
  if (value === null) return null;
  return sanitizeDiagnosticString(value, MAX_DIAGNOSTIC_JOB_ID_LENGTH, "");
}

function createAdapterReadyDiagnostic(
  epoch: number,
  adapter: StudioBg3dBabylonAdapterDiagnostic,
): StudioBg3dBabylonAdapterReadyDiagnostic {
  return Object.freeze({
    adapter,
    backend: "webgpu",
    epoch,
    kind: "adapter-ready",
    runtimeId: "babylon-webgpu-lab",
    version: 1,
  });
}

function createDeviceLostDiagnostic(
  epoch: number,
  activeJobId: string | null,
  adapter: StudioBg3dBabylonAdapterDiagnostic,
  loss: StudioBg3dBabylonDeviceLossDiagnostic,
): StudioBg3dBabylonDeviceLostDiagnostic {
  return Object.freeze({
    activeJobId: sanitizeDiagnosticJobId(activeJobId),
    adapter,
    backend: "webgpu",
    epoch,
    kind: "device-lost",
    loss,
    runtimeId: "babylon-webgpu-lab",
    version: 1,
  });
}

export function sanitizeStudioBg3dBabylonSpecialistResult(
  value: unknown,
  request: StudioBg3dSpecialistRequest,
): StudioBg3dSpecialistResult {
  if (request.kind === "artifact-capture-v2") {
    const normalized = normalizeStudioBg3dArtifactCaptureResultV2(value);
    if (
      !normalized ||
      normalized.width !== request.width ||
      normalized.height !== request.height ||
      normalized.artifacts.length !== request.artifacts.length
    ) {
      throw specialistError("invalid-result");
    }
    const requestedProfiles = new Map(
      request.artifacts.map((artifact) => [artifact.kind, artifact.profile] as const),
    );
    if (normalized.artifacts.some((artifact) =>
      artifact.profile !== requestedProfiles.get(artifact.kind)
    )) {
      throw specialistError("invalid-result");
    }
    return normalized;
  }

  const result = plainDataRecord(value);
  if (!result || typeof result.kind !== "string") throw specialistError("invalid-result");

  if (result.kind === "metrics") {
    const values = plainDataRecord(result.values);
    if (!values) throw specialistError("invalid-result");
    const entries = Object.entries(values);
    if (
      entries.length > MAX_METRIC_ENTRIES ||
      entries.some(([key, metric]) =>
        key.length < 1 || key.length > MAX_METRIC_KEY_LENGTH ||
        !(metric === null || typeof metric === "string" || typeof metric === "boolean" ||
          (typeof metric === "number" && Number.isFinite(metric))) ||
        (typeof metric === "string" && metric.length > MAX_METRIC_STRING_LENGTH)
      )
    ) {
      throw specialistError("invalid-result");
    }
    const portableValues: Record<string, string | number | boolean | null> = {};
    for (const [key, metric] of entries) {
      portableValues[key] = metric as string | number | boolean | null;
    }
    return Object.freeze({
      kind: "metrics",
      values: Object.freeze(portableValues),
    });
  }

  if (result.kind === "capture") {
    const width = result.width;
    const height = result.height;
    if (!validRasterSize(width, height)) throw specialistError("invalid-result");
    const rasterWidth = width as number;
    const rasterHeight = height as number;
    const expected = expectedRasterSize(request);
    if (expected && (rasterWidth !== expected.width || rasterHeight !== expected.height)) {
      throw specialistError("invalid-result");
    }
    const pixels = rasterWidth * rasterHeight;
    const rgba = result.rgba;
    if (
      !(rgba instanceof Uint8Array) ||
      rgba.byteLength !== pixels * 4 ||
      isSharedArrayBuffer(rgba.buffer)
    ) {
      throw specialistError("invalid-result");
    }
    const depth = result.depthFloat32;
    if (
      depth !== undefined &&
      (
        !(depth instanceof Float32Array) ||
        depth.length !== pixels ||
        isSharedArrayBuffer(depth.buffer) ||
        depth.some((sample) => !Number.isFinite(sample) || sample < 0 || sample > 1)
      )
    ) {
      throw specialistError("invalid-result");
    }
    if (
      request.kind === "webtoon-fx-capture" &&
      request.includeDepth &&
      !(depth instanceof Float32Array)
    ) {
      throw specialistError("invalid-result");
    }
    return Object.freeze({
      kind: "capture",
      width: rasterWidth,
      height: rasterHeight,
      rgba: Uint8Array.from(rgba),
      ...(depth instanceof Float32Array
        ? { depthFloat32: Float32Array.from(depth) }
        : {}),
    });
  }

  if (result.kind === "transforms") {
    if (!Array.isArray(result.samples) || result.samples.length > MAX_TRANSFORM_SAMPLES) {
      throw specialistError("invalid-result");
    }
    const ids = new Set<string>();
    const samples = result.samples.map((rawSample) => {
      const sample = plainDataRecord(rawSample);
      if (
        !sample ||
        typeof sample.nodeId !== "string" ||
        sample.nodeId.length < 1 ||
        sample.nodeId.length > MAX_TRANSFORM_NODE_ID_LENGTH ||
        ids.has(sample.nodeId) ||
        !Array.isArray(sample.position) ||
        sample.position.length !== 3 ||
        !Array.isArray(sample.rotation) ||
        sample.rotation.length !== 4
      ) {
        throw specialistError("invalid-result");
      }
      const position = sample.position as unknown[];
      const rotation = sample.rotation as unknown[];
      if (
        position.some((part) =>
          typeof part !== "number" || !Number.isFinite(part) ||
          Math.abs(part) > MAX_TRANSFORM_POSITION
        ) ||
        rotation.some((part) => typeof part !== "number" || !Number.isFinite(part))
      ) {
        throw specialistError("invalid-result");
      }
      const numericRotation = rotation as number[];
      const rotationLength = Math.hypot(...numericRotation);
      if (!Number.isFinite(rotationLength) || rotationLength < MIN_QUATERNION_LENGTH) {
        throw specialistError("invalid-result");
      }
      ids.add(sample.nodeId);
      return Object.freeze({
        nodeId: sample.nodeId,
        position: Object.freeze([...position]) as readonly [number, number, number],
        rotation: Object.freeze(numericRotation.map((part) => part / rotationLength)) as
          readonly [number, number, number, number],
      });
    });
    return Object.freeze({ kind: "transforms", samples: Object.freeze(samples) });
  }

  throw specialistError("invalid-result");
}

function defaultExecutor(
  context: StudioBg3dBabylonSpecialistExecutionContext,
): StudioBg3dSpecialistResult {
  if (context.job.request.kind !== "runtime-metrics") {
    throw specialistError("unsupported-request");
  }
  return {
    kind: "metrics",
    values: {
      backend: context.backend,
      engine: "babylon",
      epoch: context.epoch,
      initialized: true,
    },
  };
}

function safeDispose(resource: { dispose(): void } | null): void {
  try {
    resource?.dispose();
  } catch {
    // Context/device loss must not prevent the queue or the outer registry from settling.
  }
}

function engineInitializationTimeoutCause(timeoutMs: number): Error {
  const error = new Error(
    `Babylon engine initialization exceeded ${timeoutMs} milliseconds.`,
  );
  error.name = "TimeoutError";
  return error;
}

function awaitBabylonEngineInitialization(
  startOperation: (
    initialization: StudioBg3dBabylonEngineInitializationControl,
  ) => Promise<StudioBg3dBabylonEngineHandle> | StudioBg3dBabylonEngineHandle,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<StudioBg3dBabylonEngineHandle> {
  return new Promise((resolve, reject) => {
    let acceptingResult = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let partialEngine: StudioBg3dBabylonEngineHandle | null = null;
    let disposePartialEngine: (() => void) | null = null;
    let partialEngineReleaseRequested = false;
    const initializationController = new AbortController();
    const disposedLateEngines = new Set<StudioBg3dBabylonEngineHandle>();
    const releasePartialEngine = (repeat = false): void => {
      const release = disposePartialEngine;
      if (!release || (partialEngineReleaseRequested && !repeat)) return;
      partialEngineReleaseRequested = true;
      try {
        release();
      } catch {
        // Initialization timeout/abort remains authoritative over best-effort partial cleanup.
      }
    };
    const releaseLateEngine = (engine: StudioBg3dBabylonEngineHandle): void => {
      if (engine === partialEngine) {
        // A first partial dispose may have run before Babylon acquired its GPUDevice/managers.
        // The binding disposer is idempotent and must get one more chance after late settlement.
        releasePartialEngine(true);
        return;
      }
      if (disposedLateEngines.has(engine)) return;
      disposedLateEngines.add(engine);
      safeDispose(engine);
    };
    const finish = (
      callback: () => void,
      cancelInitialization = false,
    ): void => {
      if (!acceptingResult) return;
      acceptingResult = false;
      if (timeout !== null) clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      if (cancelInitialization) {
        initializationController.abort();
        releasePartialEngine();
      }
      callback();
    };
    const onAbort = () => finish(
      () => reject(specialistError("aborted")),
      true,
    );
    timeout = setTimeout(
      () => finish(() => reject(specialistError(
        "engine-init-failed",
        engineInitializationTimeoutCause(timeoutMs),
      )), true),
      timeoutMs,
    );
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    const initialization: StudioBg3dBabylonEngineInitializationControl = {
      signal: initializationController.signal,
      registerPartialEngine(engine, dispose) {
        if (partialEngine && partialEngine !== engine) {
          throw new Error("Babylon binding registered more than one partial WebGPU engine.");
        }
        partialEngine = engine;
        disposePartialEngine = dispose;
        partialEngineReleaseRequested = false;
        if (!acceptingResult || initializationController.signal.aborted) {
          releasePartialEngine();
        }
      },
    };
    const operation = Promise.resolve().then(() => startOperation(initialization));
    operation.then(
      (engine) => {
        if (!acceptingResult) {
          releaseLateEngine(engine);
          return;
        }
        finish(() => resolve(engine));
      },
      (error: unknown) => {
        if (!acceptingResult) {
          releasePartialEngine(true);
          return;
        }
        releasePartialEngine();
        finish(() => reject(error));
      },
    );
  });
}

function abortErrorFor(active: ActiveJob): StudioBg3dBabylonSpecialistError {
  if (active.reason === "device-lost" && active.deviceLostError) {
    return specialistError("device-lost", active.deviceLostError);
  }
  return specialistError(active.reason ?? "aborted");
}

class StudioBg3dBabylonSpecialistRuntimeImpl
  implements StudioBg3dBabylonSpecialistRuntime {
  readonly runtimeId: StudioBg3dBabylonRuntimeId;
  readonly capabilities: ReadonlySet<StudioBg3dRuntimeCapability>;

  readonly #backend: StudioBg3dBabylonBackend;
  readonly #canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly #execute: StudioBg3dBabylonSpecialistExecutor;
  readonly #engineInitializationTimeoutMs: number;
  readonly #loadBindings: () => Promise<StudioBg3dBabylonRuntimeBindings>;
  readonly #onDiagnostic: StudioBg3dBabylonDiagnosticListener | undefined;
  readonly #settings: StudioBg3dBabylonEngineSettings;
  readonly #canvasTarget: EventTarget;

  #active: ActiveJob | null = null;
  #bindings: StudioBg3dBabylonRuntimeBindings | null = null;
  #bindingsPromise: Promise<StudioBg3dBabylonRuntimeBindings> | null = null;
  #contextLost = false;
  #disposePromise: Promise<void> | null = null;
  #disposed = false;
  #engineRecord: EngineRecord | null = null;
  #epoch = 0;
  #queuedJobs = 0;
  #queue: Promise<void> = Promise.resolve();
  readonly #retiredEngineRecords = new Set<EngineRecord>();
  #requiresCanvasContextRestore = false;
  #status: StudioBg3dBabylonSpecialistRuntimeState["status"] = "idle";

  constructor(options: StudioBg3dBabylonSpecialistRuntimeOptions) {
    if (!options || typeof options !== "object" || typeof options.loadBindings !== "function") {
      throw new TypeError("Babylon specialist runtime options and binding loader are required.");
    }
    this.#backend = options.backend ?? "webgl2";
    this.runtimeId = runtimeIdForBackend(this.#backend);
    this.capabilities = sanitizeCapabilities(this.runtimeId, options.capabilities);
    this.#canvas = options.canvas;
    this.#canvasTarget = options.canvas as unknown as EventTarget;
    this.#execute = options.execute ?? defaultExecutor;
    this.#engineInitializationTimeoutMs = sanitizeEngineInitializationTimeoutMs(
      options.engineInitializationTimeoutMs,
    );
    this.#loadBindings = options.loadBindings;
    this.#onDiagnostic = typeof options.onDiagnostic === "function"
      ? options.onDiagnostic
      : undefined;
    this.#settings = sanitizeSettings(options.settings);
    this.#canvasTarget.addEventListener("webglcontextlost", this.#onCanvasContextLost);
    this.#canvasTarget.addEventListener("webglcontextrestored", this.#onCanvasContextRestored);
  }

  readonly #onCanvasContextLost = (event: Event): void => {
    event.preventDefault();
    this.#handleContextLost(true);
  };

  readonly #onCanvasContextRestored = (): void => {
    if (this.#disposed) return;
    this.#requiresCanvasContextRestore = false;
    this.#contextLost = false;
    if (!this.#active) this.#status = "idle";
  };

  #handleContextLost(
    blockUntilRestore: boolean,
    expectedRecord: EngineRecord | null = null,
    activeReason: "context-lost" | "device-lost" = "context-lost",
    deviceLostError: StudioBg3dBabylonDeviceLostError | null = null,
  ): void {
    if (this.#disposed) return;
    if (expectedRecord && this.#engineRecord !== expectedRecord) return;
    if (blockUntilRestore) this.#requiresCanvasContextRestore = true;
    this.#contextLost = true;
    this.#epoch += 1;
    this.#status = "context-lost";
    const activeAtLoss = this.#active;
    if (activeAtLoss && !activeAtLoss.controller.signal.aborted) {
      this.#setActiveAbortReason(activeAtLoss, activeReason, deviceLostError);
      activeAtLoss.controller.abort();
    }
    const engineRecord = this.#engineRecord;
    this.#engineRecord = null;
    this.#retireEngineRecord(engineRecord, activeAtLoss !== null);
    if (!activeAtLoss && !this.#requiresCanvasContextRestore) {
      this.#contextLost = false;
      this.#status = "idle";
    }
  }

  #detachEngineObservers(record: EngineRecord): void {
    if (record.observersDetached) return;
    record.observersDetached = true;
    record.stopDeviceLossObservation?.();
    if (record.lostObserver !== undefined) {
      record.engine.onContextLostObservable?.remove(record.lostObserver);
    }
    if (record.restoredObserver !== undefined) {
      record.engine.onContextRestoredObservable?.remove(record.restoredObserver);
    }
  }

  #disposeEngineRecord(record: EngineRecord | null): void {
    if (!record || record.disposed) return;
    record.expectedDisposal = true;
    record.disposed = true;
    this.#retiredEngineRecords.delete(record);
    this.#detachEngineObservers(record);
    safeDispose(record.engine);
  }

  #retireEngineRecord(record: EngineRecord | null, deferDisposal: boolean): void {
    if (!record || record.disposed) return;
    this.#detachEngineObservers(record);
    if (deferDisposal) {
      this.#retiredEngineRecords.add(record);
      return;
    }
    this.#disposeEngineRecord(record);
  }

  #flushRetiredEngineRecords(): void {
    for (const record of [...this.#retiredEngineRecords]) {
      this.#disposeEngineRecord(record);
    }
  }

  #emitDiagnostic(diagnostic: StudioBg3dBabylonDiagnostic): void {
    try {
      this.#onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics are deliberately non-authoritative and can never break capture/recovery.
    }
  }

  #setActiveAbortReason(
    active: ActiveJob,
    reason: ActiveAbortReason,
    deviceLostError: StudioBg3dBabylonDeviceLostError | null = null,
  ): void {
    // Once the authoritative GPUDevice.lost signal has been observed, re-entrant diagnostic
    // listeners (including one that disposes the runtime or aborts the caller) must not downgrade
    // the job to a generic aborted/disposed result and erase the device-loss cause.
    if (active.reason === "device-lost" && active.deviceLostError) return;
    active.reason = reason;
    active.deviceLostError = reason === "device-lost" ? deviceLostError : null;
  }

  #handleDeviceLoss(record: EngineRecord, value: unknown): void {
    if (
      record.deviceLossHandled ||
      record.disposed ||
      record.expectedDisposal ||
      this.#disposed ||
      this.#engineRecord !== record
    ) {
      return;
    }
    record.deviceLossHandled = true;
    const loss = sanitizeStudioBg3dBabylonDeviceLossDiagnostic(value);
    const diagnostic = createDeviceLostDiagnostic(
      this.#epoch,
      this.#active?.id ?? null,
      record.adapterDiagnostic,
      loss,
    );
    const error = new StudioBg3dBabylonDeviceLostError(diagnostic);
    const activeAtLoss = this.#active;
    if (activeAtLoss && !activeAtLoss.controller.signal.aborted) {
      this.#setActiveAbortReason(activeAtLoss, "device-lost", error);
    }
    this.#emitDiagnostic(diagnostic);
    this.#handleContextLost(false, record, "device-lost", error);
  }

  async #bindingsForRun(): Promise<StudioBg3dBabylonRuntimeBindings> {
    if (this.#bindings) return this.#bindings;
    if (!this.#bindingsPromise) {
      this.#bindingsPromise = Promise.resolve()
        .then(() => this.#loadBindings())
        .then((bindings) => {
          if (
            !bindings ||
            typeof bindings.createWebGlEngine !== "function" ||
            typeof bindings.createWebGpuEngine !== "function" ||
            typeof bindings.createScene !== "function"
          ) {
            throw specialistError("binding-load-failed");
          }
          this.#bindings = bindings;
          return bindings;
        })
        .catch((error: unknown) => {
          this.#bindingsPromise = null;
          if (error instanceof StudioBg3dBabylonSpecialistError) throw error;
          throw specialistError("binding-load-failed", error);
        });
    }
    return this.#bindingsPromise;
  }

  async #engineForRun(signal: AbortSignal): Promise<StudioBg3dBabylonEngineHandle> {
    if (this.#engineRecord) return this.#engineRecord.engine;
    this.#status = "initializing";
    const bindings = await this.#bindingsForRun();
    if (signal.aborted) throw specialistError("aborted");
    if (this.#disposed) throw specialistError("disposed");
    if (this.#contextLost) throw specialistError("context-lost");
    let engine: StudioBg3dBabylonEngineHandle;
    try {
      engine = await awaitBabylonEngineInitialization(
        (initialization) => this.#backend === "webgpu"
          ? bindings.createWebGpuEngine(this.#canvas, this.#settings, initialization)
          : bindings.createWebGlEngine(this.#canvas, this.#settings),
        signal,
        this.#engineInitializationTimeoutMs,
      );
    } catch (error) {
      if (error instanceof StudioBg3dBabylonSpecialistError) throw error;
      throw specialistError("engine-init-failed", error);
    }
    if (this.#disposed || this.#contextLost) {
      safeDispose(engine);
      throw specialistError(this.#disposed ? "disposed" : "context-lost");
    }
    const deviceLossSignal = engine[STUDIO_BG3D_BABYLON_DEVICE_LOSS_SIGNAL];
    if (
      this.#backend === "webgpu" &&
      (!deviceLossSignal || typeof deviceLossSignal.then !== "function")
    ) {
      safeDispose(engine);
      throw specialistError(
        "engine-init-failed",
        new Error("Babylon WebGPU binding did not expose GPUDevice.lost."),
      );
    }
    const record: EngineRecord = {
      adapterDiagnostic: sanitizeStudioBg3dBabylonAdapterDiagnostic(
        engine[STUDIO_BG3D_BABYLON_ADAPTER_DIAGNOSTIC],
      ),
      createdAtEpoch: this.#epoch,
      deviceLossHandled: false,
      disposed: false,
      engine,
      expectedDisposal: false,
      observersDetached: false,
    };
    record.lostObserver = engine.onContextLostObservable?.add(() => {
      // WebGPU device loss has no DOM restoration event. It invalidates this engine, but the next
      // queued job may create a fresh device. WebGL is blocked by the canvas event until restored.
      // Its required GPUDevice.lost promise is the sole WebGPU authority, so a generic Babylon
      // observable racing ahead of that promise cannot discard the real reason/message payload.
      if (this.#backend === "webgl2") this.#handleContextLost(true, record);
    });
    record.restoredObserver = engine.onContextRestoredObservable?.add(() => {
      if (this.#disposed) return;
      this.#requiresCanvasContextRestore = false;
      this.#contextLost = false;
      if (!this.#active) this.#status = "idle";
    });
    this.#engineRecord = record;
    if (this.#backend === "webgpu") {
      this.#emitDiagnostic(createAdapterReadyDiagnostic(
        record.createdAtEpoch,
        record.adapterDiagnostic,
      ));
    }
    if (this.#backend === "webgpu" && deviceLossSignal) {
      let observing = true;
      record.stopDeviceLossObservation = () => {
        observing = false;
      };
      const handleDeviceLoss = (value: unknown) => {
        if (observing) this.#handleDeviceLoss(record, value);
      };
      void Promise.resolve(deviceLossSignal).then(handleDeviceLoss, handleDeviceLoss);
    }
    return engine;
  }

  #abortActive(reason: ActiveAbortReason): void {
    if (!this.#active || this.#active.controller.signal.aborted) return;
    this.#setActiveAbortReason(this.#active, reason);
    this.#active.controller.abort();
  }

  async #runOne(job: StudioBg3dRuntimeAdapterJob): Promise<StudioBg3dSpecialistResult> {
    if (this.#disposed) throw specialistError("disposed");
    if (job.signal.aborted) throw specialistError("aborted");
    if (this.#contextLost) throw specialistError("context-lost");

    const controller = new AbortController();
    const active: ActiveJob = {
      controller,
      deviceLostError: null,
      id: job.id,
      reason: null,
    };
    this.#active = active;
    this.#epoch += 1;
    const epoch = this.#epoch;
    const abortFromCaller = () => {
      if (this.#active === active && !controller.signal.aborted) {
        this.#setActiveAbortReason(active, "aborted");
        controller.abort();
      }
    };
    job.signal.addEventListener("abort", abortFromCaller, { once: true });

    let scene: StudioBg3dBabylonSceneHandle | null = null;
    try {
      const engine = await this.#engineForRun(controller.signal);
      if (controller.signal.aborted) throw abortErrorFor(active);
      const bindings = await this.#bindingsForRun();
      scene = bindings.createScene(engine);
      if (!scene || typeof scene.dispose !== "function") {
        throw specialistError("engine-init-failed");
      }
      this.#status = "running";
      const result = await this.#execute({
        backend: this.#backend,
        engine,
        epoch,
        job,
        scene,
        signal: controller.signal,
      });
      if (controller.signal.aborted) throw abortErrorFor(active);
      return sanitizeStudioBg3dBabylonSpecialistResult(result, job.request);
    } catch (error) {
      if (controller.signal.aborted) throw abortErrorFor(active);
      if (error instanceof StudioBg3dBabylonSpecialistError) throw error;
      throw error;
    } finally {
      job.signal.removeEventListener("abort", abortFromCaller);
      safeDispose(scene);
      if (this.#active === active) this.#active = null;
      this.#flushRetiredEngineRecords();
      if (this.#contextLost && !this.#requiresCanvasContextRestore) {
        this.#contextLost = false;
      }
      if (!this.#disposed) {
        this.#status = this.#contextLost ? "context-lost" : "idle";
      }
    }
  }

  runIsolated(job: StudioBg3dRuntimeAdapterJob): Promise<StudioBg3dSpecialistResult> {
    if (this.#disposed) return Promise.reject(specialistError("disposed"));
    this.#queuedJobs += 1;
    const run = this.#queue
      .catch(() => undefined)
      .then(() => this.#runOne(job));
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run.finally(() => {
      this.#queuedJobs = Math.max(0, this.#queuedJobs - 1);
    });
  }

  getState(): StudioBg3dBabylonSpecialistRuntimeState {
    return Object.freeze({
      activeJobId: this.#active?.id ?? null,
      backend: this.#backend,
      contextLost: this.#contextLost,
      disposed: this.#disposed,
      engineInitialized: this.#engineRecord !== null,
      epoch: this.#epoch,
      queuedJobs: this.#queuedJobs,
      status: this.#disposed ? "disposed" : this.#status,
    });
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.#status = "disposed";
    this.#abortActive("disposed");
    this.#canvasTarget.removeEventListener("webglcontextlost", this.#onCanvasContextLost);
    this.#canvasTarget.removeEventListener("webglcontextrestored", this.#onCanvasContextRestored);
    this.#disposePromise = this.#queue
      .catch(() => undefined)
      .then(() => {
        const engineRecord = this.#engineRecord;
        this.#engineRecord = null;
        this.#disposeEngineRecord(engineRecord);
        this.#flushRetiredEngineRecords();
        this.#bindings = null;
        this.#bindingsPromise = null;
      });
    return this.#disposePromise;
  }
}

export function createStudioBg3dBabylonSpecialistRuntime(
  options: StudioBg3dBabylonSpecialistRuntimeOptions,
): StudioBg3dBabylonSpecialistRuntime {
  return new StudioBg3dBabylonSpecialistRuntimeImpl(options);
}
