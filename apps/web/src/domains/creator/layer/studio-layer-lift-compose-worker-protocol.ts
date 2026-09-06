import {
  STUDIO_LAYER_LIFT_ARTIFACT_LIMITS,
} from "./studio-layer-lift-artifact";
import {
  parseStudioLayerLiftCompositionReceipt,
} from "./studio-layer-lift-composition-receipt";
import {
  STUDIO_LAYER_LIFT_COMPOSITOR_ALGORITHM,
  STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS,
  StudioLayerLiftCompositorError,
  admitStudioLayerLiftCompositorInput,
  isStudioLayerLiftTrustedComposition,
} from "./studio-layer-lift-compositor";

import type {
  StudioLayerLiftArtifactPairReceipt,
} from "./studio-layer-lift-artifact";
import type {
  StudioLayerLiftCompositionReceipt,
} from "./studio-layer-lift-composition-receipt";
import type {
  StudioLayerLiftCompositorDiagnostics,
  StudioLayerLiftCompositorErrorCode,
  StudioLayerLiftCompositorInput,
  StudioLayerLiftCompositorOwnedInput,
  StudioLayerLiftTrustedComposition,
} from "./studio-layer-lift-compositor";

export const STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_LAYER_LIFT_COMPOSE_WORKER_REQUEST_KIND =
  "studio-layer-lift-compose/run" as const;
export const STUDIO_LAYER_LIFT_COMPOSE_WORKER_RESULT_KIND =
  "studio-layer-lift-compose/result" as const;
export const STUDIO_LAYER_LIFT_COMPOSE_WORKER_ERROR_KIND =
  "studio-layer-lift-compose/error" as const;

const MAXIMUM_SEQUENCE = 0x7fff_ffff;
const MAXIMUM_ERROR_MESSAGE_CHARACTERS = 256;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export interface StudioLayerLiftComposeWorkerProviderLayer {
  readonly layerId: string;
  readonly role: StudioLayerLiftCompositorOwnedInput["providerLayers"][number]["role"];
  readonly order: number;
  readonly rgbaSha256: `sha256:${string}`;
  readonly maskSha256: `sha256:${string}`;
}

export interface StudioLayerLiftComposeWorkerRequest {
  readonly version: typeof STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION;
  readonly kind: typeof STUDIO_LAYER_LIFT_COMPOSE_WORKER_REQUEST_KIND;
  readonly generation: number;
  readonly sequence: number;
  readonly requestId: string;
  readonly sourceId: string;
  readonly width: number;
  readonly height: number;
  readonly sourceSha256: `sha256:${string}`;
  readonly sourceByteLength: number;
  readonly sourceRgbaBuffer: ArrayBuffer;
  readonly providerReceiptSha256: `sha256:${string}`;
  readonly providerLayers: readonly StudioLayerLiftComposeWorkerProviderLayer[];
  readonly foregroundLayerId: string;
  readonly foregroundMaskSha256: `sha256:${string}`;
  readonly foregroundMaskByteLength: number;
  readonly foregroundMaskBuffer: ArrayBuffer;
  readonly backgroundOutputId: string;
  readonly foregroundOutputId: string;
  readonly fillTilePixels: number;
}

export interface StudioLayerLiftComposeWorkerResult {
  readonly version: typeof STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION;
  readonly kind: typeof STUDIO_LAYER_LIFT_COMPOSE_WORKER_RESULT_KIND;
  readonly generation: number;
  readonly sequence: number;
  readonly requestId: string;
  readonly sourceId: string;
  readonly width: number;
  readonly height: number;
  readonly backgroundOutputId: string;
  readonly foregroundOutputId: string;
  readonly backgroundRgbaByteLength: number;
  readonly foregroundRgbaByteLength: number;
  readonly removalMaskByteLength: number;
  readonly backgroundPngByteLength: number;
  readonly foregroundPngByteLength: number;
  readonly backgroundRgbaBuffer: ArrayBuffer;
  readonly foregroundRgbaBuffer: ArrayBuffer;
  readonly removalMaskBuffer: ArrayBuffer;
  readonly backgroundPngBuffer: ArrayBuffer;
  readonly foregroundPngBuffer: ArrayBuffer;
  readonly diagnostics: StudioLayerLiftCompositorDiagnostics;
  readonly artifactReceipt: StudioLayerLiftArtifactPairReceipt;
  readonly compositionReceipt: StudioLayerLiftCompositionReceipt;
}

export type StudioLayerLiftComposeWorkerErrorCode =
  | StudioLayerLiftCompositorErrorCode
  | "internal"
  | "protocol";

export interface StudioLayerLiftComposeWorkerError {
  readonly version: typeof STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION;
  readonly kind: typeof STUDIO_LAYER_LIFT_COMPOSE_WORKER_ERROR_KIND;
  readonly generation: number;
  readonly sequence: number;
  readonly code: StudioLayerLiftComposeWorkerErrorCode;
  readonly message: string;
}

export type StudioLayerLiftComposeWorkerResponse =
  | StudioLayerLiftComposeWorkerResult
  | StudioLayerLiftComposeWorkerError;

export class StudioLayerLiftComposeWorkerProtocolError extends Error {
  constructor(
    readonly code: "invalid-request" | "budget-exceeded",
    message: string,
  ) {
    super(message);
    this.name = "StudioLayerLiftComposeWorkerProtocolError";
  }
}

type ExactRecord = Readonly<Record<string, unknown>>;

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): ExactRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length
    || ownKeys.some(
      (key) => typeof key !== "string" || !expectedKeys.includes(key),
    )
  ) {
    return null;
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined
      || !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      return null;
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function sequence(value: unknown): value is number {
  return (
    Number.isSafeInteger(value)
    && Number(value) > 0
    && Number(value) <= MAXIMUM_SEQUENCE
  );
}

function ownedBuffer(value: unknown): value is ArrayBuffer {
  return (
    value instanceof ArrayBuffer
    && Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

function digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function requestKeys(): readonly string[] {
  return [
    "version",
    "kind",
    "generation",
    "sequence",
    "requestId",
    "sourceId",
    "width",
    "height",
    "sourceSha256",
    "sourceByteLength",
    "sourceRgbaBuffer",
    "providerReceiptSha256",
    "providerLayers",
    "foregroundLayerId",
    "foregroundMaskSha256",
    "foregroundMaskByteLength",
    "foregroundMaskBuffer",
    "backgroundOutputId",
    "foregroundOutputId",
    "fillTilePixels",
  ];
}

function inputFromRequest(
  request: Readonly<Record<string, unknown>>,
): StudioLayerLiftCompositorInput {
  if (
    !ownedBuffer(request.sourceRgbaBuffer)
    || !ownedBuffer(request.foregroundMaskBuffer)
  ) {
    throw new StudioLayerLiftComposeWorkerProtocolError(
      "invalid-request",
      "Layer Lift compositor request buffers are invalid.",
    );
  }
  return {
    requestId: request.requestId as string,
    sourceId: request.sourceId as string,
    width: request.width as number,
    height: request.height as number,
    sourceSha256: request.sourceSha256 as `sha256:${string}`,
    sourceRgba: new Uint8ClampedArray(request.sourceRgbaBuffer),
    providerReceiptSha256:
      request.providerReceiptSha256 as `sha256:${string}`,
    providerLayers:
      request.providerLayers as readonly StudioLayerLiftComposeWorkerProviderLayer[],
    foregroundLayerId: request.foregroundLayerId as string,
    foregroundMaskSha256:
      request.foregroundMaskSha256 as `sha256:${string}`,
    foregroundMask: new Uint8Array(request.foregroundMaskBuffer),
    backgroundOutputId: request.backgroundOutputId as string,
    foregroundOutputId: request.foregroundOutputId as string,
    fillTilePixels: request.fillTilePixels as number,
  };
}

/**
 * Creates a transfer-ready message from private source/mask snapshots. Caller
 * storage is never detached; only the admitted copies are moved to the Worker.
 */
export function createStudioLayerLiftComposeWorkerRequest(
  input: StudioLayerLiftCompositorInput,
  generation: number,
  sequenceNumber: number,
): StudioLayerLiftComposeWorkerRequest {
  if (!sequence(generation) || !sequence(sequenceNumber)) {
    throw new StudioLayerLiftComposeWorkerProtocolError(
      "invalid-request",
      "Layer Lift Worker identity is invalid.",
    );
  }
  let owned: StudioLayerLiftCompositorOwnedInput;
  try {
    owned = admitStudioLayerLiftCompositorInput(input);
  } catch (error) {
    throw new StudioLayerLiftComposeWorkerProtocolError(
      error instanceof StudioLayerLiftCompositorError
        && error.code === "budget-exceeded"
        ? "budget-exceeded"
        : "invalid-request",
      "Layer Lift compositor input failed Worker admission.",
    );
  }
  return Object.freeze({
    version: STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION,
    kind: STUDIO_LAYER_LIFT_COMPOSE_WORKER_REQUEST_KIND,
    generation,
    sequence: sequenceNumber,
    requestId: owned.requestId,
    sourceId: owned.sourceId,
    width: owned.width,
    height: owned.height,
    sourceSha256: owned.sourceSha256,
    sourceByteLength: owned.sourceRgba.byteLength,
    sourceRgbaBuffer: owned.sourceRgba.buffer,
    providerReceiptSha256: owned.providerReceiptSha256,
    providerLayers: owned.providerLayers,
    foregroundLayerId: owned.foregroundLayerId,
    foregroundMaskSha256: owned.foregroundMaskSha256,
    foregroundMaskByteLength: owned.foregroundMask.byteLength,
    foregroundMaskBuffer: owned.foregroundMask.buffer,
    backgroundOutputId: owned.backgroundOutputId,
    foregroundOutputId: owned.foregroundOutputId,
    fillTilePixels: owned.fillTilePixels,
  });
}

/**
 * Revalidates and snapshots a structured-clone request in the Worker realm.
 * No caller-owned input storage is returned.
 */
export function decodeStudioLayerLiftComposeWorkerRequest(
  value: unknown,
): Readonly<{
  readonly generation: number;
  readonly sequence: number;
  readonly input: StudioLayerLiftCompositorOwnedInput;
}> {
  const request = exactRecord(value, requestKeys());
  if (
    !request
    || request.version !== STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION
    || request.kind !== STUDIO_LAYER_LIFT_COMPOSE_WORKER_REQUEST_KIND
    || !sequence(request.generation)
    || !sequence(request.sequence)
    || !Number.isSafeInteger(request.sourceByteLength)
    || Number(request.sourceByteLength) < 1
    || !Number.isSafeInteger(request.foregroundMaskByteLength)
    || Number(request.foregroundMaskByteLength) < 1
    || !ownedBuffer(request.sourceRgbaBuffer)
    || !ownedBuffer(request.foregroundMaskBuffer)
    || request.sourceRgbaBuffer.byteLength !== request.sourceByteLength
    || request.foregroundMaskBuffer.byteLength
      !== request.foregroundMaskByteLength
  ) {
    throw new StudioLayerLiftComposeWorkerProtocolError(
      "invalid-request",
      "Layer Lift Worker request is malformed.",
    );
  }
  try {
    return Object.freeze({
      generation: request.generation,
      sequence: request.sequence,
      input: admitStudioLayerLiftCompositorInput(inputFromRequest(request)),
    });
  } catch (error) {
    throw new StudioLayerLiftComposeWorkerProtocolError(
      error instanceof StudioLayerLiftCompositorError
        && error.code === "budget-exceeded"
        ? "budget-exceeded"
        : "invalid-request",
      "Layer Lift Worker request failed compositor admission.",
    );
  }
}

export function isStudioLayerLiftComposeWorkerRequest(
  value: unknown,
): value is StudioLayerLiftComposeWorkerRequest {
  try {
    decodeStudioLayerLiftComposeWorkerRequest(value);
    return true;
  } catch {
    return false;
  }
}

export function studioLayerLiftComposeWorkerRequestTransfers(
  request: StudioLayerLiftComposeWorkerRequest,
): readonly [ArrayBuffer, ArrayBuffer] {
  return [request.sourceRgbaBuffer, request.foregroundMaskBuffer];
}

function resultKeys(): readonly string[] {
  return [
    "version",
    "kind",
    "generation",
    "sequence",
    "requestId",
    "sourceId",
    "width",
    "height",
    "backgroundOutputId",
    "foregroundOutputId",
    "backgroundRgbaByteLength",
    "foregroundRgbaByteLength",
    "removalMaskByteLength",
    "backgroundPngByteLength",
    "foregroundPngByteLength",
    "backgroundRgbaBuffer",
    "foregroundRgbaBuffer",
    "removalMaskBuffer",
    "backgroundPngBuffer",
    "foregroundPngBuffer",
    "diagnostics",
    "artifactReceipt",
    "compositionReceipt",
  ];
}

const DIAGNOSTIC_KEYS = [
  "algorithm",
  "fillTilePixels",
  "pixelCount",
  "selectedPixelCount",
  "partialPixelCount",
  "transparentSelectedPixelCount",
  "estimatedPeakBytes",
  "estimatedWorkUnits",
  "sourceRgbaSha256",
  "foregroundMaskSha256",
  "backgroundRgbaSha256",
  "foregroundRgbaSha256",
  "paritySha256",
] as const;

function diagnostics(
  value: unknown,
  width: number,
  height: number,
): value is StudioLayerLiftCompositorDiagnostics {
  const input = exactRecord(value, DIAGNOSTIC_KEYS);
  const pixelCount = width * height;
  return (
    input !== null
    && input.algorithm === STUDIO_LAYER_LIFT_COMPOSITOR_ALGORITHM
    && Number.isSafeInteger(input.fillTilePixels)
    && Number(input.fillTilePixels) >= CONTENT_AWARE_TILE_MIN
    && Number(input.fillTilePixels) <= CONTENT_AWARE_TILE_MAX
    && input.pixelCount === pixelCount
    && Number.isSafeInteger(input.selectedPixelCount)
    && Number(input.selectedPixelCount) > 0
    && Number(input.selectedPixelCount) <= pixelCount
    && Number.isSafeInteger(input.partialPixelCount)
    && Number(input.partialPixelCount) >= 0
    && Number(input.partialPixelCount) <= Number(input.selectedPixelCount)
    && Number.isSafeInteger(input.transparentSelectedPixelCount)
    && Number(input.transparentSelectedPixelCount) >= 0
    && Number(input.transparentSelectedPixelCount)
      <= Number(input.selectedPixelCount)
    && Number.isSafeInteger(input.estimatedPeakBytes)
    && Number(input.estimatedPeakBytes) > 0
    && Number(input.estimatedPeakBytes)
      <= STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumPeakBytes
    && Number.isSafeInteger(input.estimatedWorkUnits)
    && Number(input.estimatedWorkUnits) > 0
    && Number(input.estimatedWorkUnits)
      <= STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumWorkUnits
    && digest(input.sourceRgbaSha256)
    && digest(input.foregroundMaskSha256)
    && digest(input.backgroundRgbaSha256)
    && digest(input.foregroundRgbaSha256)
    && digest(input.paritySha256)
  );
}

const CONTENT_AWARE_TILE_MIN = 8;
const CONTENT_AWARE_TILE_MAX = 16;

export function createStudioLayerLiftComposeWorkerResult(
  request: StudioLayerLiftComposeWorkerRequest,
  result: StudioLayerLiftTrustedComposition,
): StudioLayerLiftComposeWorkerResult {
  if (
    !isStudioLayerLiftTrustedComposition(result)
    || result.requestId !== request.requestId
    || result.sourceId !== request.sourceId
    || result.width !== request.width
    || result.height !== request.height
    || result.artifacts.background.outputId !== request.backgroundOutputId
    || result.artifacts.foreground.outputId !== request.foregroundOutputId
  ) {
    throw new StudioLayerLiftComposeWorkerProtocolError(
      "invalid-request",
      "Trusted compositor result does not match the Worker request.",
    );
  }
  return Object.freeze({
    version: STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION,
    kind: STUDIO_LAYER_LIFT_COMPOSE_WORKER_RESULT_KIND,
    generation: request.generation,
    sequence: request.sequence,
    requestId: request.requestId,
    sourceId: request.sourceId,
    width: request.width,
    height: request.height,
    backgroundOutputId: request.backgroundOutputId,
    foregroundOutputId: request.foregroundOutputId,
    backgroundRgbaByteLength: result.backgroundRgba.byteLength,
    foregroundRgbaByteLength: result.foregroundRgba.byteLength,
    removalMaskByteLength: result.removalMask.byteLength,
    backgroundPngByteLength: result.artifacts.background.byteLength,
    foregroundPngByteLength: result.artifacts.foreground.byteLength,
    backgroundRgbaBuffer: result.backgroundRgba.bytes.buffer,
    foregroundRgbaBuffer: result.foregroundRgba.bytes.buffer,
    removalMaskBuffer: result.removalMask.bytes.buffer,
    backgroundPngBuffer: result.artifacts.background.bytes,
    foregroundPngBuffer: result.artifacts.foreground.bytes,
    diagnostics: result.diagnostics,
    artifactReceipt: result.artifacts.receipt,
    compositionReceipt: result.compositionReceipt,
  });
}

export function studioLayerLiftComposeWorkerResultTransfers(
  result: StudioLayerLiftComposeWorkerResult,
): readonly [
  ArrayBuffer,
  ArrayBuffer,
  ArrayBuffer,
  ArrayBuffer,
  ArrayBuffer,
] {
  return [
    result.backgroundRgbaBuffer,
    result.foregroundRgbaBuffer,
    result.removalMaskBuffer,
    result.backgroundPngBuffer,
    result.foregroundPngBuffer,
  ];
}

function errorKeys(): readonly string[] {
  return [
    "version",
    "kind",
    "generation",
    "sequence",
    "code",
    "message",
  ];
}

const ERROR_CODES = new Set<StudioLayerLiftComposeWorkerErrorCode>([
  "aborted",
  "artifact-invalid",
  "budget-exceeded",
  "encode-failed",
  "encode-unavailable",
  "internal",
  "invalid-input",
  "protocol",
  "provenance-mismatch",
]);

export function createStudioLayerLiftComposeWorkerError(
  identity: Readonly<{ readonly generation: number; readonly sequence: number }>,
  code: StudioLayerLiftComposeWorkerErrorCode,
  message: string,
): StudioLayerLiftComposeWorkerError {
  const normalizedMessage = message.slice(
    0,
    MAXIMUM_ERROR_MESSAGE_CHARACTERS,
  ) || "Layer Lift Worker failed closed.";
  return Object.freeze({
    version: STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION,
    kind: STUDIO_LAYER_LIFT_COMPOSE_WORKER_ERROR_KIND,
    generation: identity.generation,
    sequence: identity.sequence,
    code,
    message: normalizedMessage,
  });
}

export function studioLayerLiftComposeWorkerResponseIdentity(
  value: unknown,
): Readonly<{ readonly generation: number; readonly sequence: number }> | null {
  try {
    if (typeof value !== "object" || value === null) return null;
    const generationDescriptor = Object.getOwnPropertyDescriptor(
      value,
      "generation",
    );
    const sequenceDescriptor = Object.getOwnPropertyDescriptor(
      value,
      "sequence",
    );
    const generation = generationDescriptor?.value;
    const sequenceNumber = sequenceDescriptor?.value;
    if (!sequence(generation) || !sequence(sequenceNumber)) return null;
    return Object.freeze({ generation, sequence: sequenceNumber });
  } catch {
    return null;
  }
}

export function isStudioLayerLiftComposeWorkerResult(
  value: unknown,
): value is StudioLayerLiftComposeWorkerResult {
  const result = exactRecord(value, resultKeys());
  if (
    !result
    || result.version !== STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION
    || result.kind !== STUDIO_LAYER_LIFT_COMPOSE_WORKER_RESULT_KIND
    || !sequence(result.generation)
    || !sequence(result.sequence)
    || typeof result.requestId !== "string"
    || typeof result.sourceId !== "string"
    || !Number.isSafeInteger(result.width)
    || Number(result.width) < 1
    || !Number.isSafeInteger(result.height)
    || Number(result.height) < 1
    || typeof result.backgroundOutputId !== "string"
    || typeof result.foregroundOutputId !== "string"
    || !ownedBuffer(result.backgroundRgbaBuffer)
    || !ownedBuffer(result.foregroundRgbaBuffer)
    || !ownedBuffer(result.removalMaskBuffer)
    || !ownedBuffer(result.backgroundPngBuffer)
    || !ownedBuffer(result.foregroundPngBuffer)
  ) {
    return false;
  }
  const width = Number(result.width);
  const height = Number(result.height);
  const pixelCount = width * height;
  if (
    width > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumAxisPixels
    || height > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumAxisPixels
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_LAYER_LIFT_COMPOSITOR_LIMITS.maximumPixels
    || result.backgroundRgbaByteLength !== pixelCount * 4
    || result.foregroundRgbaByteLength !== pixelCount * 4
    || result.removalMaskByteLength !== pixelCount
    || result.backgroundRgbaBuffer.byteLength
      !== result.backgroundRgbaByteLength
    || result.foregroundRgbaBuffer.byteLength
      !== result.foregroundRgbaByteLength
    || result.removalMaskBuffer.byteLength !== result.removalMaskByteLength
    || result.backgroundPngBuffer.byteLength
      !== result.backgroundPngByteLength
    || result.foregroundPngBuffer.byteLength
      !== result.foregroundPngByteLength
    || !Number.isSafeInteger(result.backgroundPngByteLength)
    || Number(result.backgroundPngByteLength) < 57
    || Number(result.backgroundPngByteLength)
      > STUDIO_LAYER_LIFT_ARTIFACT_LIMITS.maximumCompressedBytes
    || !Number.isSafeInteger(result.foregroundPngByteLength)
    || Number(result.foregroundPngByteLength) < 57
    || Number(result.foregroundPngByteLength)
      > STUDIO_LAYER_LIFT_ARTIFACT_LIMITS.maximumCompressedBytes
    || Number(result.backgroundPngByteLength)
      + Number(result.foregroundPngByteLength)
      > STUDIO_LAYER_LIFT_ARTIFACT_LIMITS.maximumPairCompressedBytes
    || !diagnostics(result.diagnostics, width, height)
  ) {
    return false;
  }
  const parsedReceipt = parseStudioLayerLiftCompositionReceipt(
    result.compositionReceipt,
  );
  return (
    parsedReceipt.ok
    && parsedReceipt.value.requestId === result.requestId
    && parsedReceipt.value.background.outputId === result.backgroundOutputId
    && parsedReceipt.value.foreground.outputId === result.foregroundOutputId
  );
}

export function isStudioLayerLiftComposeWorkerError(
  value: unknown,
): value is StudioLayerLiftComposeWorkerError {
  const error = exactRecord(value, errorKeys());
  return (
    error !== null
    && error.version === STUDIO_LAYER_LIFT_COMPOSE_WORKER_PROTOCOL_VERSION
    && error.kind === STUDIO_LAYER_LIFT_COMPOSE_WORKER_ERROR_KIND
    && sequence(error.generation)
    && sequence(error.sequence)
    && typeof error.code === "string"
    && ERROR_CODES.has(error.code as StudioLayerLiftComposeWorkerErrorCode)
    && typeof error.message === "string"
    && error.message.length > 0
    && error.message.length <= MAXIMUM_ERROR_MESSAGE_CHARACTERS
  );
}

export function isStudioLayerLiftComposeWorkerResponse(
  value: unknown,
): value is StudioLayerLiftComposeWorkerResponse {
  return (
    isStudioLayerLiftComposeWorkerResult(value)
    || isStudioLayerLiftComposeWorkerError(value)
  );
}
