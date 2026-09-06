import {
  STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE,
  STUDIO_POINTER_SAMPLE_ROLE_PREDICTED,
  STUDIO_SHARED_POINTER_RING_HEADER_BYTES,
  STUDIO_SHARED_POINTER_RING_MIN_CAPACITY,
  STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES,
  STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S,
  STUDIO_SHARED_POINTER_RING_VERSION,
  type StudioSharedPointerRingDescriptor,
} from "../studio-shared-pointer-ring-buffer";

/**
 * Pure structured-clone protocol boundary for a future OffscreenCanvas engine
 * Worker. This module intentionally imports no DOM, Worker or WebGPU types.
 *
 * Runtime-only objects such as OffscreenCanvas are represented by numbered
 * transfer slots. The adapter that calls postMessage owns the actual transfer
 * list and must resolve every required slot separately.
 */
export const STUDIO_ENGINE_WORKER_PROTOCOL_REVISION = 2 as const;

/**
 * Transferable replay/test batches keep their original float64-v1 twelve-field wire shape.
 * The live SharedArrayBuffer ring has independent layout versioning and may append sensor fields.
 */
export const STUDIO_ENGINE_POINTER_BATCH_V1_FLOAT64S = 12 as const;

export const STUDIO_ENGINE_WORKER_BUDGETS = Object.freeze({
  maxInFlightCommands: 1_024,
  maxPointerBatchSamples: 4_096,
  maxPointerRingSamples: 65_536,
  maxDocumentPatchBytes: 8 * 1024 * 1024,
  maxDocumentPatchOperations: 65_536,
  maxIdentifierCharacters: 128,
  maxBuildIdentifierCharacters: 96,
  maxErrorMessageCharacters: 2_048,
  maxErrorCodeCharacters: 96,
  maxSurfaceDimension: 262_144,
  maxSurfacePixels: 134_217_728,
  maxSurfaceBytes: 512 * 1024 * 1024,
  surfaceBytesPerPixelBudget: 4,
  maxDevicePixelRatio: 16,
  maxViewportZoom: 65_536,
  maxQueuedPointerSamples: 1_000_000,
} as const);

export const STUDIO_ENGINE_SURFACE_TRANSFER_CONTRACT =
  "attach-surface carries only a numbered runtime slot; the OffscreenCanvas-like object and transfer list stay in the host adapter";

export const STUDIO_ENGINE_EXECUTION_PROFILE =
  "webgpu-worker-rgba16float-vnext" as const;

export interface StudioEngineCapabilitySnapshot {
  readonly offscreenCanvas: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly webGpu: boolean;
  readonly wasmSimd: boolean;
  readonly memory64: boolean;
  readonly hardwareConcurrency: number;
  readonly maxTextureDimension2D: number;
}

/**
 * vNext is intentionally future-only. These capabilities are execution prerequisites rather than
 * signals for choosing a lower-quality renderer. WebGL2/Canvas capability probes are intentionally
 * absent from this writable-engine contract.
 */
export const STUDIO_ENGINE_FUTURE_REQUIRED_CAPABILITIES = Object.freeze([
  "offscreenCanvas",
  "sharedArrayBuffer",
  "crossOriginIsolated",
  "webGpu",
  "wasmSimd",
  "memory64",
] as const);

export type StudioEngineFutureRequiredCapability =
  (typeof STUDIO_ENGINE_FUTURE_REQUIRED_CAPABILITIES)[number];

export function missingStudioEngineFutureCapabilities(
  capabilities: StudioEngineCapabilitySnapshot,
): readonly StudioEngineFutureRequiredCapability[] {
  try {
    return Object.freeze(
      STUDIO_ENGINE_FUTURE_REQUIRED_CAPABILITIES.filter(
        (capability) => capabilities[capability] !== true,
      ),
    );
  } catch {
    return STUDIO_ENGINE_FUTURE_REQUIRED_CAPABILITIES;
  }
}

export interface StudioEngineHelloMessage {
  readonly type: "studio-engine/hello";
  readonly protocolRevision: typeof STUDIO_ENGINE_WORKER_PROTOCOL_REVISION;
  readonly sessionEpoch: number;
  readonly executionProfile: typeof STUDIO_ENGINE_EXECUTION_PROFILE;
  readonly clientBuild: string;
  readonly capabilities: StudioEngineCapabilitySnapshot;
}

export interface StudioEngineNegotiatedLimits {
  readonly maxInFlightCommands: number;
  readonly maxPointerBatchSamples: number;
  readonly maxPointerRingSamples: number;
  readonly maxDocumentPatchBytes: number;
}

export interface StudioEngineHelloAckMessage {
  readonly type: "studio-engine/hello-ack";
  readonly protocolRevision: typeof STUDIO_ENGINE_WORKER_PROTOCOL_REVISION;
  readonly sessionEpoch: number;
  readonly executionProfile: typeof STUDIO_ENGINE_EXECUTION_PROFILE;
  readonly engineBuild: string;
  readonly limits: StudioEngineNegotiatedLimits;
}

export interface StudioEngineAttachSurfaceCommand {
  readonly kind: "attach-surface";
  readonly surfaceId: string;
  /**
   * Static protocol budgets are only the first gate. The runtime adapter MUST
   * also compare both dimensions with the negotiated capability snapshot's
   * `maxTextureDimension2D` and with the selected GPU/device limit before it
   * resolves `runtimeTransfer.slot`.
   */
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly colorSpace: "srgb" | "display-p3";
  readonly alphaMode: "premultiplied" | "opaque";
  readonly runtimeTransfer: {
    readonly kind: "offscreen-canvas";
    readonly slot: number;
  };
}

export interface StudioEngineConfigurePointerRingCommand {
  readonly kind: "configure-pointer-ring";
  /**
   * SharedArrayBuffer is structured-cloned with the descriptor and MUST NOT be
   * included in a transfer list.
   */
  readonly descriptor: StudioSharedPointerRingDescriptor;
}

export interface StudioEnginePointerBatch {
  readonly encoding: "float64-v1";
  /**
   * Twelve Float64 fields in the original SPSC V1 prefix order. The live V2 ring appends sensor
   * channels independently. The host adapter may transfer `samples.buffer`; the protocol never
   * exposes DOM Transferable.
   */
  readonly samples: Float64Array<ArrayBuffer>;
  readonly sampleCount: number;
  readonly firstSampleSequence: number;
  readonly lastSampleSequence: number;
  readonly authoritativeCount: number;
  readonly predictedCount: number;
}

export interface StudioEnginePointerBatchCommand {
  readonly kind: "pointer-batch";
  /** Deterministic replay/test ingress only; live vNext input requires the SAB ring. */
  readonly batch: StudioEnginePointerBatch;
}

export interface StudioEngineViewportCommand {
  readonly kind: "set-viewport";
  readonly viewportRevision: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
  readonly rotationRadians: number;
}

export type StudioEngineBlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "destination-out";

export interface StudioEngineToolCommand {
  readonly kind: "set-tool";
  readonly toolRevision: number;
  readonly toolId: string;
  readonly brushSize: number;
  readonly opacity: number;
  readonly flow: number;
  readonly hardness: number;
  readonly spacing: number;
  readonly colorRgba: readonly [number, number, number, number];
  readonly blendMode: StudioEngineBlendMode;
  readonly stabilizer: number;
}

export interface StudioEngineDocumentPatchCommand {
  readonly kind: "apply-document-patch";
  readonly documentId: string;
  readonly baseRevision: number;
  readonly documentRevision: number;
  readonly operationCount: number;
  readonly encoding: "binary-v1" | "json-utf8";
  /** ArrayBuffer-backed so the host may transfer ownership without a copy. */
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export type StudioEngineCommand =
  | StudioEngineAttachSurfaceCommand
  | StudioEngineConfigurePointerRingCommand
  | StudioEnginePointerBatchCommand
  | StudioEngineViewportCommand
  | StudioEngineToolCommand
  | StudioEngineDocumentPatchCommand;

export interface StudioEngineCommandMessage {
  readonly type: "studio-engine/command";
  readonly protocolRevision: typeof STUDIO_ENGINE_WORKER_PROTOCOL_REVISION;
  readonly sessionEpoch: number;
  readonly commandSequence: number;
  readonly command: StudioEngineCommand;
}

export interface StudioEngineAcceptedPrefixReceipt {
  readonly type: "studio-engine/accepted-prefix";
  readonly protocolRevision: typeof STUDIO_ENGINE_WORKER_PROTOCOL_REVISION;
  readonly sessionEpoch: number;
  readonly acceptedThroughCommandSequence: number;
  readonly queuedCommands: number;
  readonly queuedPointerSamples: number;
  readonly pressure: "none" | "soft" | "hard";
}

export interface StudioEngineFrameReceipt {
  readonly type: "studio-engine/frame";
  readonly protocolRevision: typeof STUDIO_ENGINE_WORKER_PROTOCOL_REVISION;
  readonly sessionEpoch: number;
  readonly frameSequence: number;
  readonly acceptedThroughCommandSequence: number;
  readonly surfaceId: string;
  readonly documentRevision: number;
  readonly presentedAt: number;
  readonly cpuMilliseconds: number;
  readonly gpuMilliseconds: number | null;
  readonly pointerSamplesRendered: number;
  readonly droppedFrames: number;
}

export interface StudioEngineBackpressureSignal {
  readonly kind: "backpressure";
  readonly level: "soft" | "hard";
  readonly queuedCommands: number;
  readonly queuedPointerSamples: number;
  readonly retryAfterMilliseconds: number;
}

export interface StudioEngineOverflowSignal {
  readonly kind: "overflow";
  readonly source: "command-queue" | "pointer-ring" | "pointer-batch";
  readonly droppedCount: number;
  readonly acceptedThroughCommandSequence: number;
}

export interface StudioEngineDeviceLostSignal {
  readonly kind: "device-lost";
  readonly backend: "webgpu";
  readonly reason: string;
  readonly recoverable: boolean;
}

export interface StudioEngineFatalSignal {
  readonly kind: "fatal";
  readonly code: string;
  readonly message: string;
  readonly relatedCommandSequence: number | null;
}

export type StudioEngineSignal =
  | StudioEngineBackpressureSignal
  | StudioEngineOverflowSignal
  | StudioEngineDeviceLostSignal
  | StudioEngineFatalSignal;

export interface StudioEngineSignalMessage {
  readonly type: "studio-engine/signal";
  readonly protocolRevision: typeof STUDIO_ENGINE_WORKER_PROTOCOL_REVISION;
  readonly sessionEpoch: number;
  readonly signalSequence: number;
  readonly signal: StudioEngineSignal;
}

export type StudioEngineWorkerMessage =
  | StudioEngineAcceptedPrefixReceipt
  | StudioEngineFrameReceipt
  | StudioEngineSignalMessage;

export type StudioEngineProtocolFailureReason =
  | "not-an-object"
  | "invalid-message-type"
  | "future-protocol-revision"
  | "unsupported-protocol-revision"
  | "unknown-field"
  | "invalid-field"
  | "budget-exceeded"
  | "stale-session-epoch"
  | "stale-command-sequence"
  | "command-sequence-gap"
  | "receipt-ahead-of-sent-prefix"
  | "stale-accepted-prefix"
  | "stale-frame-sequence"
  | "stale-signal-sequence"
  | "malformed-pointer-ring"
  | "malformed-pointer-batch";

export type StudioEngineProtocolParseResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly reason: StudioEngineProtocolFailureReason;
      readonly path: string;
    };

export interface StudioEngineCommandValidationState {
  readonly sessionEpoch: number;
  readonly lastAcceptedCommandSequence: number;
}

export interface StudioEngineAcceptedCommand {
  readonly message: StudioEngineCommandMessage;
  readonly nextState: StudioEngineCommandValidationState;
}

export interface StudioEngineWorkerValidationState {
  readonly sessionEpoch: number;
  readonly lastSentCommandSequence: number;
  readonly lastAcceptedCommandSequence: number;
  readonly lastFrameSequence: number;
  readonly lastSignalSequence: number;
}

export interface StudioEngineAcceptedWorkerMessage {
  readonly message: StudioEngineWorkerMessage;
  readonly nextState: StudioEngineWorkerValidationState;
}

export interface StudioEngineRuntimeTransferSlot {
  readonly slot: number;
  readonly kind: "offscreen-canvas";
}

export interface StudioEngineSurfaceRuntimeLimits {
  /** Copied from the capability snapshot selected during the handshake. */
  readonly negotiatedMaxTextureDimension2D: number;
  /** Queried from the actual GPU/WebGL backend chosen by the engine adapter. */
  readonly runtimeMaxTextureDimension2D: number;
  /** Backend/device-specific allocation ceiling after texture format selection. */
  readonly runtimeMaxSurfaceBytes: number;
}

export type StudioEngineSurfaceRuntimeValidationResult =
  | {
      readonly ok: true;
      readonly pixelCount: number;
      readonly budgetedBytes: number;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid-runtime-limits" | "runtime-budget-exceeded";
    };

/**
 * ArrayBuffers may be added to the host transfer list. SharedArrayBuffers are
 * listed separately precisely so callers do not accidentally transfer them.
 */
export interface StudioEngineCommandTransportPlan {
  readonly runtimeTransferSlots: readonly StudioEngineRuntimeTransferSlot[];
  readonly transferableArrayBuffers: readonly ArrayBuffer[];
  readonly sharedArrayBuffers: readonly SharedArrayBuffer[];
}

type UnknownRecord = Record<string, unknown>;

function fail<T>(
  reason: StudioEngineProtocolFailureReason,
  path: string,
): StudioEngineProtocolParseResult<T> {
  return { ok: false, reason, path };
}

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: UnknownRecord,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isSafeUnsignedInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isUint32(value: unknown): value is number {
  return (
    Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= 0xffff_ffff
  );
}

function isFiniteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
  );
}

function isIdentifier(value: unknown, maximumCharacters: number): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= maximumCharacters
    && /^[A-Za-z0-9._:/+-]+$/.test(value)
  );
}

function isBoundedMessage(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length <= STUDIO_ENGINE_WORKER_BUDGETS.maxErrorMessageCharacters
  );
}

function validateRevision(
  value: UnknownRecord,
): StudioEngineProtocolParseResult<true> {
  const revision = value.protocolRevision;
  if (!Number.isSafeInteger(revision)) {
    return fail("invalid-field", "protocolRevision");
  }
  if (
    (revision as number) > STUDIO_ENGINE_WORKER_PROTOCOL_REVISION
  ) {
    return fail("future-protocol-revision", "protocolRevision");
  }
  if (revision !== STUDIO_ENGINE_WORKER_PROTOCOL_REVISION) {
    return fail("unsupported-protocol-revision", "protocolRevision");
  }
  return { ok: true, value: true };
}

function validateCapabilities(
  value: unknown,
): value is StudioEngineCapabilitySnapshot {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "offscreenCanvas",
      "sharedArrayBuffer",
      "crossOriginIsolated",
      "webGpu",
      "wasmSimd",
      "memory64",
      "hardwareConcurrency",
      "maxTextureDimension2D",
    ])
  ) {
    return false;
  }
  return (
    typeof value.offscreenCanvas === "boolean"
    && typeof value.sharedArrayBuffer === "boolean"
    && typeof value.crossOriginIsolated === "boolean"
    && typeof value.webGpu === "boolean"
    && typeof value.wasmSimd === "boolean"
    && typeof value.memory64 === "boolean"
    && isFiniteInRange(value.hardwareConcurrency, 1, 1_024)
    && Number.isInteger(value.hardwareConcurrency)
    && isFiniteInRange(
      value.maxTextureDimension2D,
      0,
      STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
    )
    && Number.isInteger(value.maxTextureDimension2D)
  );
}

export function parseStudioEngineHello(
  input: unknown,
): StudioEngineProtocolParseResult<StudioEngineHelloMessage> {
  if (!isRecord(input)) return fail("not-an-object", "$");
  if (input.type !== "studio-engine/hello") {
    return fail("invalid-message-type", "type");
  }
  if (
    !hasOnlyKeys(input, [
      "type",
      "protocolRevision",
      "sessionEpoch",
      "executionProfile",
      "clientBuild",
      "capabilities",
    ])
  ) {
    return fail("unknown-field", "$");
  }
  const revision = validateRevision(input);
  if (!revision.ok) return revision;
  if (!isPositiveSafeInteger(input.sessionEpoch)) {
    return fail("invalid-field", "sessionEpoch");
  }
  if (input.executionProfile !== STUDIO_ENGINE_EXECUTION_PROFILE) {
    return fail("invalid-field", "executionProfile");
  }
  if (
    !isIdentifier(
      input.clientBuild,
      STUDIO_ENGINE_WORKER_BUDGETS.maxBuildIdentifierCharacters,
    )
  ) {
    return fail("invalid-field", "clientBuild");
  }
  if (!validateCapabilities(input.capabilities)) {
    return fail("invalid-field", "capabilities");
  }
  return { ok: true, value: input as unknown as StudioEngineHelloMessage };
}

function validateNegotiatedLimits(
  value: unknown,
): value is StudioEngineNegotiatedLimits {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "maxInFlightCommands",
      "maxPointerBatchSamples",
      "maxPointerRingSamples",
      "maxDocumentPatchBytes",
    ])
  ) {
    return false;
  }
  return (
    isFiniteInRange(
      value.maxInFlightCommands,
      1,
      STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands,
    )
    && Number.isInteger(value.maxInFlightCommands)
    && isFiniteInRange(
      value.maxPointerBatchSamples,
      1,
      STUDIO_ENGINE_WORKER_BUDGETS.maxPointerBatchSamples,
    )
    && Number.isInteger(value.maxPointerBatchSamples)
    && isFiniteInRange(
      value.maxPointerRingSamples,
      2,
      STUDIO_ENGINE_WORKER_BUDGETS.maxPointerRingSamples,
    )
    && Number.isInteger(value.maxPointerRingSamples)
    && isFiniteInRange(
      value.maxDocumentPatchBytes,
      1,
      STUDIO_ENGINE_WORKER_BUDGETS.maxDocumentPatchBytes,
    )
    && Number.isInteger(value.maxDocumentPatchBytes)
  );
}

export function parseStudioEngineHelloAck(
  input: unknown,
  expectedSessionEpoch: number,
): StudioEngineProtocolParseResult<StudioEngineHelloAckMessage> {
  if (!isRecord(input)) return fail("not-an-object", "$");
  if (input.type !== "studio-engine/hello-ack") {
    return fail("invalid-message-type", "type");
  }
  if (
    !hasOnlyKeys(input, [
      "type",
      "protocolRevision",
      "sessionEpoch",
      "executionProfile",
      "engineBuild",
      "limits",
    ])
  ) {
    return fail("unknown-field", "$");
  }
  const revision = validateRevision(input);
  if (!revision.ok) return revision;
  if (input.sessionEpoch !== expectedSessionEpoch) {
    return fail("stale-session-epoch", "sessionEpoch");
  }
  if (input.executionProfile !== STUDIO_ENGINE_EXECUTION_PROFILE) {
    return fail("invalid-field", "executionProfile");
  }
  if (
    !isIdentifier(
      input.engineBuild,
      STUDIO_ENGINE_WORKER_BUDGETS.maxBuildIdentifierCharacters,
    )
  ) {
    return fail("invalid-field", "engineBuild");
  }
  if (!validateNegotiatedLimits(input.limits)) {
    return fail("budget-exceeded", "limits");
  }
  return { ok: true, value: input as unknown as StudioEngineHelloAckMessage };
}

function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
  const constructor = (
    globalThis as typeof globalThis & {
      SharedArrayBuffer?: SharedArrayBufferConstructor;
    }
  ).SharedArrayBuffer;
  return (
    typeof constructor === "function"
    && value instanceof constructor
  );
}

function validatePointerRingDescriptor(
  value: unknown,
): value is StudioSharedPointerRingDescriptor {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "kind",
      "version",
      "buffer",
      "byteLength",
      "headerBytes",
      "capacity",
      "sampleFloat64s",
      "sampleBytes",
    ])
    || value.kind !== "toonspectrum-studio-pointer-spsc"
    || value.version !== STUDIO_SHARED_POINTER_RING_VERSION
    || value.headerBytes !== STUDIO_SHARED_POINTER_RING_HEADER_BYTES
    || value.sampleFloat64s !== STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S
    || value.sampleBytes !== STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES
    || !isPositiveSafeInteger(value.capacity)
    || (value.capacity as number) < STUDIO_SHARED_POINTER_RING_MIN_CAPACITY
    || (value.capacity as number)
      > STUDIO_ENGINE_WORKER_BUDGETS.maxPointerRingSamples
    || (
      ((value.capacity as number) & ((value.capacity as number) - 1))
      !== 0
    )
    || !isSharedArrayBuffer(value.buffer)
  ) {
    return false;
  }
  const expectedBytes =
    STUDIO_SHARED_POINTER_RING_HEADER_BYTES
    + (value.capacity as number) * STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES;
  return (
    value.byteLength === expectedBytes
    && value.buffer.byteLength === expectedBytes
  );
}

function validatePointerBatch(
  value: unknown,
): StudioEngineProtocolParseResult<StudioEnginePointerBatch> {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, [
      "encoding",
      "samples",
      "sampleCount",
      "firstSampleSequence",
      "lastSampleSequence",
      "authoritativeCount",
      "predictedCount",
    ])
  ) {
    return fail("malformed-pointer-batch", "command.batch");
  }
  if (
    value.encoding !== "float64-v1"
    || !(value.samples instanceof Float64Array)
    || !(value.samples.buffer instanceof ArrayBuffer)
    || value.samples.byteOffset !== 0
    || value.samples.byteLength !== value.samples.buffer.byteLength
    || !isPositiveSafeInteger(value.sampleCount)
    || (value.sampleCount as number)
      > STUDIO_ENGINE_WORKER_BUDGETS.maxPointerBatchSamples
    || value.samples.length
      !== (value.sampleCount as number)
        * STUDIO_ENGINE_POINTER_BATCH_V1_FLOAT64S
    || !isSafeUnsignedInteger(value.firstSampleSequence)
    || !isSafeUnsignedInteger(value.lastSampleSequence)
    || value.lastSampleSequence
      !== (value.firstSampleSequence as number)
        + (value.sampleCount as number)
        - 1
    || !isSafeUnsignedInteger(value.authoritativeCount)
    || !isSafeUnsignedInteger(value.predictedCount)
    || (value.authoritativeCount as number)
      + (value.predictedCount as number)
      !== value.sampleCount
  ) {
    return fail("malformed-pointer-batch", "command.batch");
  }

  let authoritativeCount = 0;
  let predictedCount = 0;
  const samples = value.samples;
  const sampleCount = value.sampleCount as number;
  const firstSequence = value.firstSampleSequence as number;
  for (let index = 0; index < sampleCount; index += 1) {
    const offset = index * STUDIO_ENGINE_POINTER_BATCH_V1_FLOAT64S;
    const x = samples[offset];
    const y = samples[offset + 1];
    const pressure = samples[offset + 2];
    const tiltX = samples[offset + 3];
    const tiltY = samples[offset + 4];
    const twist = samples[offset + 5];
    const time = samples[offset + 6];
    const pointerId = samples[offset + 7];
    const sequence = samples[offset + 8];
    const role = samples[offset + 9];
    const channel = samples[offset + 10];
    const flags = samples[offset + 11];
    if (
      !Number.isFinite(x)
      || !Number.isFinite(y)
      || !isFiniteInRange(pressure, 0, 1)
      || !isFiniteInRange(tiltX, -90, 90)
      || !isFiniteInRange(tiltY, -90, 90)
      || !isFiniteInRange(twist, 0, 360 - Number.EPSILON)
      || !isFiniteInRange(time, 0, Number.MAX_VALUE)
      || !isSafeUnsignedInteger(pointerId)
      || sequence !== firstSequence + index
      || (
        role !== STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE
        && role !== STUDIO_POINTER_SAMPLE_ROLE_PREDICTED
      )
      || !isUint32(channel)
      || !isUint32(flags)
    ) {
      return fail(
        "malformed-pointer-batch",
        `command.batch.samples[${index}]`,
      );
    }
    if (role === STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE) {
      authoritativeCount += 1;
    } else {
      predictedCount += 1;
    }
  }
  if (
    authoritativeCount !== value.authoritativeCount
    || predictedCount !== value.predictedCount
  ) {
    return fail("malformed-pointer-batch", "command.batch.roleCounts");
  }
  return {
    ok: true,
    value: value as unknown as StudioEnginePointerBatch,
  };
}

function validateAttachSurface(
  value: UnknownRecord,
): StudioEngineProtocolParseResult<StudioEngineAttachSurfaceCommand> {
  if (
    !hasOnlyKeys(value, [
      "kind",
      "surfaceId",
      "width",
      "height",
      "devicePixelRatio",
      "colorSpace",
      "alphaMode",
      "runtimeTransfer",
    ])
    || !isIdentifier(
      value.surfaceId,
      STUDIO_ENGINE_WORKER_BUDGETS.maxIdentifierCharacters,
    )
    || !isFiniteInRange(
      value.width,
      1,
      STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
    )
    || !Number.isInteger(value.width)
    || !isFiniteInRange(
      value.height,
      1,
      STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
    )
    || !Number.isInteger(value.height)
    || !isFiniteInRange(
      value.devicePixelRatio,
      0.25,
      STUDIO_ENGINE_WORKER_BUDGETS.maxDevicePixelRatio,
    )
    || (value.colorSpace !== "srgb" && value.colorSpace !== "display-p3")
    || (
      value.alphaMode !== "premultiplied"
      && value.alphaMode !== "opaque"
    )
    || !isRecord(value.runtimeTransfer)
    || !hasOnlyKeys(value.runtimeTransfer, ["kind", "slot"])
    || value.runtimeTransfer.kind !== "offscreen-canvas"
    || !isSafeUnsignedInteger(value.runtimeTransfer.slot)
    || value.runtimeTransfer.slot > 15
  ) {
    return fail("invalid-field", "command");
  }
  const pixelCount =
    BigInt(value.width as number) * BigInt(value.height as number);
  const budgetedBytes =
    pixelCount
    * BigInt(STUDIO_ENGINE_WORKER_BUDGETS.surfaceBytesPerPixelBudget);
  if (
    pixelCount > BigInt(STUDIO_ENGINE_WORKER_BUDGETS.maxSurfacePixels)
    || budgetedBytes > BigInt(STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceBytes)
  ) {
    return fail("budget-exceeded", "command.surface");
  }
  return {
    ok: true,
    value: value as unknown as StudioEngineAttachSurfaceCommand,
  };
}

/**
 * Second-stage surface gate for the host adapter. Passing the static command
 * parser never substitutes for checking the negotiated and actual device limit.
 */
export function validateStudioEngineSurfaceAgainstRuntime(
  command: StudioEngineAttachSurfaceCommand,
  limits: StudioEngineSurfaceRuntimeLimits,
): StudioEngineSurfaceRuntimeValidationResult {
  if (
    !isPositiveSafeInteger(limits.negotiatedMaxTextureDimension2D)
    || !isPositiveSafeInteger(limits.runtimeMaxTextureDimension2D)
    || !isPositiveSafeInteger(limits.runtimeMaxSurfaceBytes)
  ) {
    return { ok: false, reason: "invalid-runtime-limits" };
  }
  const pixelCount = BigInt(command.width) * BigInt(command.height);
  const budgetedBytes =
    pixelCount
    * BigInt(STUDIO_ENGINE_WORKER_BUDGETS.surfaceBytesPerPixelBudget);
  const maximumDimension = Math.min(
    limits.negotiatedMaxTextureDimension2D,
    limits.runtimeMaxTextureDimension2D,
  );
  if (
    command.width > maximumDimension
    || command.height > maximumDimension
    || budgetedBytes > BigInt(limits.runtimeMaxSurfaceBytes)
    || pixelCount > BigInt(Number.MAX_SAFE_INTEGER)
    || budgetedBytes > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return { ok: false, reason: "runtime-budget-exceeded" };
  }
  return {
    ok: true,
    pixelCount: Number(pixelCount),
    budgetedBytes: Number(budgetedBytes),
  };
}

function validateViewport(
  value: UnknownRecord,
): StudioEngineProtocolParseResult<StudioEngineViewportCommand> {
  if (
    !hasOnlyKeys(value, [
      "kind",
      "viewportRevision",
      "cssWidth",
      "cssHeight",
      "devicePixelRatio",
      "zoom",
      "panX",
      "panY",
      "rotationRadians",
    ])
    || !isPositiveSafeInteger(value.viewportRevision)
    || !isFiniteInRange(
      value.cssWidth,
      1,
      STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
    )
    || !isFiniteInRange(
      value.cssHeight,
      1,
      STUDIO_ENGINE_WORKER_BUDGETS.maxSurfaceDimension,
    )
    || !isFiniteInRange(
      value.devicePixelRatio,
      0.25,
      STUDIO_ENGINE_WORKER_BUDGETS.maxDevicePixelRatio,
    )
    || !isFiniteInRange(
      value.zoom,
      1 / STUDIO_ENGINE_WORKER_BUDGETS.maxViewportZoom,
      STUDIO_ENGINE_WORKER_BUDGETS.maxViewportZoom,
    )
    || typeof value.panX !== "number"
    || !Number.isFinite(value.panX)
    || typeof value.panY !== "number"
    || !Number.isFinite(value.panY)
    || !isFiniteInRange(value.rotationRadians, -Math.PI * 2, Math.PI * 2)
  ) {
    return fail("invalid-field", "command");
  }
  return {
    ok: true,
    value: value as unknown as StudioEngineViewportCommand,
  };
}

const BLEND_MODES = new Set<StudioEngineBlendMode>([
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "destination-out",
]);

function validateTool(
  value: UnknownRecord,
): StudioEngineProtocolParseResult<StudioEngineToolCommand> {
  if (
    !hasOnlyKeys(value, [
      "kind",
      "toolRevision",
      "toolId",
      "brushSize",
      "opacity",
      "flow",
      "hardness",
      "spacing",
      "colorRgba",
      "blendMode",
      "stabilizer",
    ])
    || !isPositiveSafeInteger(value.toolRevision)
    || !isIdentifier(
      value.toolId,
      STUDIO_ENGINE_WORKER_BUDGETS.maxIdentifierCharacters,
    )
    || !isFiniteInRange(value.brushSize, 0.01, 65_536)
    || !isFiniteInRange(value.opacity, 0, 1)
    || !isFiniteInRange(value.flow, 0, 1)
    || !isFiniteInRange(value.hardness, 0, 1)
    || !isFiniteInRange(value.spacing, 0.01, 10)
    || !Array.isArray(value.colorRgba)
    || value.colorRgba.length !== 4
    || !value.colorRgba.every((channel) => isFiniteInRange(channel, 0, 1))
    || !BLEND_MODES.has(value.blendMode as StudioEngineBlendMode)
    || !isFiniteInRange(value.stabilizer, 0, 1)
  ) {
    return fail("invalid-field", "command");
  }
  return {
    ok: true,
    value: value as unknown as StudioEngineToolCommand,
  };
}

function validateDocumentPatch(
  value: UnknownRecord,
): StudioEngineProtocolParseResult<StudioEngineDocumentPatchCommand> {
  if (
    !hasOnlyKeys(value, [
      "kind",
      "documentId",
      "baseRevision",
      "documentRevision",
      "operationCount",
      "encoding",
      "bytes",
    ])
    || !isIdentifier(
      value.documentId,
      STUDIO_ENGINE_WORKER_BUDGETS.maxIdentifierCharacters,
    )
    || !isSafeUnsignedInteger(value.baseRevision)
    || !isPositiveSafeInteger(value.documentRevision)
    || value.documentRevision <= value.baseRevision
    || !isPositiveSafeInteger(value.operationCount)
    || value.operationCount
      > STUDIO_ENGINE_WORKER_BUDGETS.maxDocumentPatchOperations
    || (
      value.encoding !== "binary-v1"
      && value.encoding !== "json-utf8"
    )
    || !(value.bytes instanceof Uint8Array)
    || !(value.bytes.buffer instanceof ArrayBuffer)
    || value.bytes.byteOffset !== 0
    || value.bytes.byteLength !== value.bytes.buffer.byteLength
  ) {
    return fail("invalid-field", "command");
  }
  if (
    value.bytes.byteLength === 0
    || value.bytes.byteLength
      > STUDIO_ENGINE_WORKER_BUDGETS.maxDocumentPatchBytes
  ) {
    return fail("budget-exceeded", "command.bytes");
  }
  return {
    ok: true,
    value: value as unknown as StudioEngineDocumentPatchCommand,
  };
}

function validateCommand(
  value: unknown,
): StudioEngineProtocolParseResult<StudioEngineCommand> {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return fail("invalid-field", "command");
  }
  switch (value.kind) {
    case "attach-surface":
      return validateAttachSurface(value);
    case "configure-pointer-ring":
      if (
        !hasOnlyKeys(value, ["kind", "descriptor"])
        || !validatePointerRingDescriptor(value.descriptor)
      ) {
        return fail("malformed-pointer-ring", "command.descriptor");
      }
      return {
        ok: true,
        value: value as unknown as StudioEngineConfigurePointerRingCommand,
      };
    case "pointer-batch": {
      if (!hasOnlyKeys(value, ["kind", "batch"])) {
        return fail("unknown-field", "command");
      }
      const batch = validatePointerBatch(value.batch);
      if (!batch.ok) return batch;
      return {
        ok: true,
        value: value as unknown as StudioEnginePointerBatchCommand,
      };
    }
    case "set-viewport":
      return validateViewport(value);
    case "set-tool":
      return validateTool(value);
    case "apply-document-patch":
      return validateDocumentPatch(value);
    default:
      return fail("invalid-field", "command.kind");
  }
}

export function parseStudioEngineCommand(
  input: unknown,
  state: StudioEngineCommandValidationState,
): StudioEngineProtocolParseResult<StudioEngineAcceptedCommand> {
  if (!isRecord(input)) return fail("not-an-object", "$");
  if (input.type !== "studio-engine/command") {
    return fail("invalid-message-type", "type");
  }
  if (
    !hasOnlyKeys(input, [
      "type",
      "protocolRevision",
      "sessionEpoch",
      "commandSequence",
      "command",
    ])
  ) {
    return fail("unknown-field", "$");
  }
  const revision = validateRevision(input);
  if (!revision.ok) return revision;
  if (
    !isPositiveSafeInteger(state.sessionEpoch)
    || !isSafeUnsignedInteger(state.lastAcceptedCommandSequence)
  ) {
    return fail("invalid-field", "state");
  }
  if (input.sessionEpoch !== state.sessionEpoch) {
    return fail("stale-session-epoch", "sessionEpoch");
  }
  if (!isPositiveSafeInteger(input.commandSequence)) {
    return fail("invalid-field", "commandSequence");
  }
  if (input.commandSequence <= state.lastAcceptedCommandSequence) {
    return fail("stale-command-sequence", "commandSequence");
  }
  if (
    input.commandSequence !== state.lastAcceptedCommandSequence + 1
  ) {
    return fail("command-sequence-gap", "commandSequence");
  }
  const command = validateCommand(input.command);
  if (!command.ok) return command;
  const message = input as unknown as StudioEngineCommandMessage;
  return {
    ok: true,
    value: {
      message,
      nextState: {
        sessionEpoch: state.sessionEpoch,
        lastAcceptedCommandSequence: message.commandSequence,
      },
    },
  };
}

function validateAcceptedPrefix(
  input: UnknownRecord,
  state: StudioEngineWorkerValidationState,
): StudioEngineProtocolParseResult<StudioEngineAcceptedPrefixReceipt> {
  if (
    !hasOnlyKeys(input, [
      "type",
      "protocolRevision",
      "sessionEpoch",
      "acceptedThroughCommandSequence",
      "queuedCommands",
      "queuedPointerSamples",
      "pressure",
    ])
    || !isSafeUnsignedInteger(input.acceptedThroughCommandSequence)
    || !isSafeUnsignedInteger(input.queuedCommands)
    || input.queuedCommands
      > STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands
    || !isSafeUnsignedInteger(input.queuedPointerSamples)
    || input.queuedPointerSamples
      > STUDIO_ENGINE_WORKER_BUDGETS.maxQueuedPointerSamples
    || (
      input.pressure !== "none"
      && input.pressure !== "soft"
      && input.pressure !== "hard"
    )
  ) {
    return fail("invalid-field", "$");
  }
  if (
    input.acceptedThroughCommandSequence
      < state.lastAcceptedCommandSequence
  ) {
    return fail(
      "stale-accepted-prefix",
      "acceptedThroughCommandSequence",
    );
  }
  if (
    input.acceptedThroughCommandSequence
      > state.lastSentCommandSequence
  ) {
    return fail(
      "receipt-ahead-of-sent-prefix",
      "acceptedThroughCommandSequence",
    );
  }
  return {
    ok: true,
    value: input as unknown as StudioEngineAcceptedPrefixReceipt,
  };
}

function validateFrame(
  input: UnknownRecord,
  state: StudioEngineWorkerValidationState,
): StudioEngineProtocolParseResult<StudioEngineFrameReceipt> {
  if (
    !hasOnlyKeys(input, [
      "type",
      "protocolRevision",
      "sessionEpoch",
      "frameSequence",
      "acceptedThroughCommandSequence",
      "surfaceId",
      "documentRevision",
      "presentedAt",
      "cpuMilliseconds",
      "gpuMilliseconds",
      "pointerSamplesRendered",
      "droppedFrames",
    ])
    || !isPositiveSafeInteger(input.frameSequence)
    || !isSafeUnsignedInteger(input.acceptedThroughCommandSequence)
    || !isIdentifier(
      input.surfaceId,
      STUDIO_ENGINE_WORKER_BUDGETS.maxIdentifierCharacters,
    )
    || !isSafeUnsignedInteger(input.documentRevision)
    || !isFiniteInRange(input.presentedAt, 0, Number.MAX_VALUE)
    || !isFiniteInRange(input.cpuMilliseconds, 0, 60_000)
    || (
      input.gpuMilliseconds !== null
      && !isFiniteInRange(input.gpuMilliseconds, 0, 60_000)
    )
    || !isSafeUnsignedInteger(input.pointerSamplesRendered)
    || !isSafeUnsignedInteger(input.droppedFrames)
  ) {
    return fail("invalid-field", "$");
  }
  if (input.frameSequence <= state.lastFrameSequence) {
    return fail("stale-frame-sequence", "frameSequence");
  }
  if (
    input.acceptedThroughCommandSequence
      < state.lastAcceptedCommandSequence
  ) {
    return fail(
      "stale-accepted-prefix",
      "acceptedThroughCommandSequence",
    );
  }
  if (
    input.acceptedThroughCommandSequence
      > state.lastSentCommandSequence
  ) {
    return fail(
      "receipt-ahead-of-sent-prefix",
      "acceptedThroughCommandSequence",
    );
  }
  return {
    ok: true,
    value: input as unknown as StudioEngineFrameReceipt,
  };
}

function validateSignal(
  value: unknown,
  lastSentCommandSequence: number,
  lastAcceptedCommandSequence: number,
): StudioEngineProtocolParseResult<StudioEngineSignal> {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return fail("invalid-field", "signal");
  }
  switch (value.kind) {
    case "backpressure":
      if (
        !hasOnlyKeys(value, [
          "kind",
          "level",
          "queuedCommands",
          "queuedPointerSamples",
          "retryAfterMilliseconds",
        ])
        || (value.level !== "soft" && value.level !== "hard")
        || !isSafeUnsignedInteger(value.queuedCommands)
        || value.queuedCommands
          > STUDIO_ENGINE_WORKER_BUDGETS.maxInFlightCommands
        || !isSafeUnsignedInteger(value.queuedPointerSamples)
        || value.queuedPointerSamples
          > STUDIO_ENGINE_WORKER_BUDGETS.maxQueuedPointerSamples
        || !isFiniteInRange(value.retryAfterMilliseconds, 0, 60_000)
      ) {
        return fail("invalid-field", "signal");
      }
      break;
    case "overflow":
      if (
        !hasOnlyKeys(value, [
          "kind",
          "source",
          "droppedCount",
          "acceptedThroughCommandSequence",
        ])
        || (
          value.source !== "command-queue"
          && value.source !== "pointer-ring"
          && value.source !== "pointer-batch"
        )
        || !isPositiveSafeInteger(value.droppedCount)
        || !isSafeUnsignedInteger(value.acceptedThroughCommandSequence)
        || value.acceptedThroughCommandSequence > lastSentCommandSequence
      ) {
        return fail("invalid-field", "signal");
      }
      if (
        value.acceptedThroughCommandSequence
          < lastAcceptedCommandSequence
      ) {
        return fail(
          "stale-accepted-prefix",
          "signal.acceptedThroughCommandSequence",
        );
      }
      break;
    case "device-lost":
      if (
        !hasOnlyKeys(value, [
          "kind",
          "backend",
          "reason",
          "recoverable",
        ])
        || value.backend !== "webgpu"
        || !isBoundedMessage(value.reason)
        || typeof value.recoverable !== "boolean"
      ) {
        return fail("invalid-field", "signal");
      }
      break;
    case "fatal":
      if (
        !hasOnlyKeys(value, [
          "kind",
          "code",
          "message",
          "relatedCommandSequence",
        ])
        || !isIdentifier(
          value.code,
          STUDIO_ENGINE_WORKER_BUDGETS.maxErrorCodeCharacters,
        )
        || !isBoundedMessage(value.message)
        || (
          value.relatedCommandSequence !== null
          && (
            !isPositiveSafeInteger(value.relatedCommandSequence)
            || value.relatedCommandSequence > lastSentCommandSequence
          )
        )
      ) {
        return fail("invalid-field", "signal");
      }
      break;
    default:
      return fail("invalid-field", "signal.kind");
  }
  return { ok: true, value: value as unknown as StudioEngineSignal };
}

export function parseStudioEngineWorkerMessage(
  input: unknown,
  state: StudioEngineWorkerValidationState,
): StudioEngineProtocolParseResult<StudioEngineAcceptedWorkerMessage> {
  if (!isRecord(input)) return fail("not-an-object", "$");
  if (
    input.type !== "studio-engine/accepted-prefix"
    && input.type !== "studio-engine/frame"
    && input.type !== "studio-engine/signal"
  ) {
    return fail("invalid-message-type", "type");
  }
  const revision = validateRevision(input);
  if (!revision.ok) return revision;
  if (
    !isPositiveSafeInteger(state.sessionEpoch)
    || !isSafeUnsignedInteger(state.lastSentCommandSequence)
    || !isSafeUnsignedInteger(state.lastAcceptedCommandSequence)
    || state.lastAcceptedCommandSequence > state.lastSentCommandSequence
    || !isSafeUnsignedInteger(state.lastFrameSequence)
    || !isSafeUnsignedInteger(state.lastSignalSequence)
  ) {
    return fail("invalid-field", "state");
  }
  if (input.sessionEpoch !== state.sessionEpoch) {
    return fail("stale-session-epoch", "sessionEpoch");
  }

  let message: StudioEngineWorkerMessage;
  let nextAccepted = state.lastAcceptedCommandSequence;
  let nextFrame = state.lastFrameSequence;
  let nextSignal = state.lastSignalSequence;
  if (input.type === "studio-engine/accepted-prefix") {
    const receipt = validateAcceptedPrefix(input, state);
    if (!receipt.ok) return receipt;
    message = receipt.value;
    nextAccepted = receipt.value.acceptedThroughCommandSequence;
  } else if (input.type === "studio-engine/frame") {
    const frame = validateFrame(input, state);
    if (!frame.ok) return frame;
    message = frame.value;
    nextAccepted = frame.value.acceptedThroughCommandSequence;
    nextFrame = frame.value.frameSequence;
  } else {
    if (
      !hasOnlyKeys(input, [
        "type",
        "protocolRevision",
        "sessionEpoch",
        "signalSequence",
        "signal",
      ])
      || !isPositiveSafeInteger(input.signalSequence)
    ) {
      return fail("invalid-field", "$");
    }
    if (input.signalSequence <= state.lastSignalSequence) {
      return fail("stale-signal-sequence", "signalSequence");
    }
    const signal = validateSignal(
      input.signal,
      state.lastSentCommandSequence,
      state.lastAcceptedCommandSequence,
    );
    if (!signal.ok) return signal;
    message = input as unknown as StudioEngineSignalMessage;
    nextSignal = message.signalSequence;
  }

  return {
    ok: true,
    value: {
      message,
      nextState: {
        ...state,
        lastAcceptedCommandSequence: nextAccepted,
        lastFrameSequence: nextFrame,
        lastSignalSequence: nextSignal,
      },
    },
  };
}

export function describeStudioEngineCommandTransport(
  message: StudioEngineCommandMessage,
): StudioEngineCommandTransportPlan {
  switch (message.command.kind) {
    case "attach-surface":
      return Object.freeze({
        runtimeTransferSlots: Object.freeze([
          Object.freeze({ ...message.command.runtimeTransfer }),
        ]),
        transferableArrayBuffers: Object.freeze([]),
        sharedArrayBuffers: Object.freeze([]),
      });
    case "configure-pointer-ring":
      return Object.freeze({
        runtimeTransferSlots: Object.freeze([]),
        transferableArrayBuffers: Object.freeze([]),
        sharedArrayBuffers: Object.freeze([
          message.command.descriptor.buffer,
        ]),
      });
    case "pointer-batch":
      return Object.freeze({
        runtimeTransferSlots: Object.freeze([]),
        transferableArrayBuffers: Object.freeze([
          message.command.batch.samples.buffer as ArrayBuffer,
        ]),
        sharedArrayBuffers: Object.freeze([]),
      });
    case "apply-document-patch":
      return Object.freeze({
        runtimeTransferSlots: Object.freeze([]),
        transferableArrayBuffers: Object.freeze([
          message.command.bytes.buffer as ArrayBuffer,
        ]),
        sharedArrayBuffers: Object.freeze([]),
      });
    default:
      return Object.freeze({
        runtimeTransferSlots: Object.freeze([]),
        transferableArrayBuffers: Object.freeze([]),
        sharedArrayBuffers: Object.freeze([]),
      });
  }
}
