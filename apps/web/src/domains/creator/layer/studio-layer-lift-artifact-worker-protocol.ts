import {
  STUDIO_LAYER_LIFT_ARTIFACT_KIND,
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS,
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES,
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_DECODED_BYTES,
  STUDIO_LAYER_LIFT_ARTIFACT_MAX_PIXELS,
  STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_COMPRESSED_BYTES,
  STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_DECODED_BYTES,
  STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_PIXELS,
  STUDIO_LAYER_LIFT_ARTIFACT_VERSION,
  type StudioLayerLiftArtifactErrorCode,
  type StudioLayerLiftArtifactPairReceipt,
} from "./studio-layer-lift-artifact";

export const STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_LAYER_LIFT_ARTIFACT_WORKER_REQUEST_KIND =
  "studio-layer-lift-artifact/validate-pair" as const;
export const STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND =
  "studio-layer-lift-artifact/result" as const;
export const STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND =
  "studio-layer-lift-artifact/error" as const;

const MAXIMUM_SEQUENCE = 0x7fff_ffff;
const MAXIMUM_ID_LENGTH = 160;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export interface StudioLayerLiftArtifactWorkerAuthority {
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly backgroundOutputId: string;
  readonly foregroundOutputId: string;
}

export interface StudioLayerLiftArtifactWorkerRequest
  extends StudioLayerLiftArtifactWorkerAuthority {
  readonly version: typeof STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION;
  readonly kind: typeof STUDIO_LAYER_LIFT_ARTIFACT_WORKER_REQUEST_KIND;
  readonly generation: number;
  readonly sequence: number;
  readonly backgroundByteLength: number;
  readonly foregroundByteLength: number;
  readonly backgroundBytes: ArrayBuffer;
  readonly foregroundBytes: ArrayBuffer;
}

export interface StudioLayerLiftArtifactWorkerResult {
  readonly version: typeof STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION;
  readonly kind: typeof STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND;
  readonly generation: number;
  readonly sequence: number;
  readonly receipt: StudioLayerLiftArtifactPairReceipt;
  readonly backgroundByteLength: number;
  readonly foregroundByteLength: number;
  readonly backgroundBytes: ArrayBuffer;
  readonly foregroundBytes: ArrayBuffer;
}

export type StudioLayerLiftArtifactWorkerErrorCode =
  | StudioLayerLiftArtifactErrorCode
  | "internal"
  | "protocol";

export interface StudioLayerLiftArtifactWorkerError {
  readonly version: typeof STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION;
  readonly kind: typeof STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND;
  readonly generation: number;
  readonly sequence: number;
  readonly code: StudioLayerLiftArtifactWorkerErrorCode;
  readonly message: string;
}

export type StudioLayerLiftArtifactWorkerResponse =
  | StudioLayerLiftArtifactWorkerResult
  | StudioLayerLiftArtifactWorkerError;

function hasOwnDataProperties(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some(
      (key) => typeof key !== "string" || !expectedKeys.includes(key),
    )
  ) {
    return false;
  }
  return expectedKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      Object.prototype.hasOwnProperty.call(descriptor, "value")
    );
  });
}

function isSequence(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > 0 &&
    Number(value) <= MAXIMUM_SEQUENCE
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isAuthorityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAXIMUM_ID_LENGTH &&
    value === value.normalize("NFC") &&
    !hasForbiddenIdCharacter(value) &&
    value !== "." &&
    value !== ".."
  );
}

function hasForbiddenIdCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      code === 0x7f ||
      code === 0x2f ||
      code === 0x5c
    ) {
      return true;
    }
  }
  return false;
}

function isOwnedArrayBuffer(value: unknown): value is ArrayBuffer {
  return (
    value instanceof ArrayBuffer &&
    Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

function isAuthorityRecord(
  value: Record<string, unknown>,
): value is Record<string, unknown> & StudioLayerLiftArtifactWorkerAuthority {
  const width = value.sourceWidth;
  const height = value.sourceHeight;
  return (
    isAuthorityId(value.requestId) &&
    isAuthorityId(value.sourceId) &&
    isPositiveSafeInteger(width) &&
    isPositiveSafeInteger(height) &&
    width <= STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS &&
    height <= STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS &&
    width * height <= STUDIO_LAYER_LIFT_ARTIFACT_MAX_PIXELS &&
    isAuthorityId(value.backgroundOutputId) &&
    isAuthorityId(value.foregroundOutputId) &&
    value.backgroundOutputId !== value.foregroundOutputId
  );
}

export function isStudioLayerLiftArtifactWorkerRequest(
  value: unknown,
): value is StudioLayerLiftArtifactWorkerRequest {
  if (
    !hasOwnDataProperties(value, [
      "version",
      "kind",
      "generation",
      "sequence",
      "requestId",
      "sourceId",
      "sourceWidth",
      "sourceHeight",
      "backgroundOutputId",
      "foregroundOutputId",
      "backgroundByteLength",
      "foregroundByteLength",
      "backgroundBytes",
      "foregroundBytes",
    ])
  ) {
    return false;
  }

  if (
    value.version !== STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION ||
    value.kind !== STUDIO_LAYER_LIFT_ARTIFACT_WORKER_REQUEST_KIND ||
    !isSequence(value.generation) ||
    !isSequence(value.sequence) ||
    !isAuthorityRecord(value) ||
    !isPositiveSafeInteger(value.backgroundByteLength) ||
    !isPositiveSafeInteger(value.foregroundByteLength) ||
    value.backgroundByteLength > STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES ||
    value.foregroundByteLength > STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES ||
    value.backgroundByteLength + value.foregroundByteLength >
      STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_COMPRESSED_BYTES ||
    !isOwnedArrayBuffer(value.backgroundBytes) ||
    !isOwnedArrayBuffer(value.foregroundBytes)
  ) {
    return false;
  }

  return (
    value.backgroundByteLength === value.backgroundBytes.byteLength &&
    value.foregroundByteLength === value.foregroundBytes.byteLength
  );
}

const RECEIPT_KEYS = [
  "kind",
  "version",
  "requestId",
  "sourceId",
  "sourceWidth",
  "sourceHeight",
  "background",
  "foreground",
  "aggregatePixelCount",
  "aggregateByteLength",
  "aggregateDecodedByteLength",
  "receiptSha256",
] as const;

function isPngReceipt(
  value: unknown,
  expectedWidth: number,
  expectedHeight: number,
): value is StudioLayerLiftArtifactPairReceipt["background"] {
  if (
    !hasOwnDataProperties(value, [
      "outputId",
      "width",
      "height",
      "pixelCount",
      "byteLength",
      "decodedByteLength",
      "sha256",
    ])
  ) {
    return false;
  }
  const pixelCount = expectedWidth * expectedHeight;
  return (
    isAuthorityId(value.outputId) &&
    value.width === expectedWidth &&
    value.height === expectedHeight &&
    value.pixelCount === pixelCount &&
    isPositiveSafeInteger(value.byteLength) &&
    value.byteLength >= 57 &&
    value.byteLength <= STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES &&
    value.decodedByteLength === pixelCount * 4 &&
    value.decodedByteLength <= STUDIO_LAYER_LIFT_ARTIFACT_MAX_DECODED_BYTES &&
    typeof value.sha256 === "string" &&
    SHA256_PATTERN.test(value.sha256)
  );
}

function isReceiptEnvelope(
  value: unknown,
): value is StudioLayerLiftArtifactPairReceipt {
  if (!hasOwnDataProperties(value, RECEIPT_KEYS)) {
    return false;
  }
  if (
    value.kind !== STUDIO_LAYER_LIFT_ARTIFACT_KIND ||
    value.version !== STUDIO_LAYER_LIFT_ARTIFACT_VERSION ||
    !isAuthorityId(value.requestId)
  ) {
    return false;
  }
  if (
    !isAuthorityId(value.sourceId) ||
    !isPositiveSafeInteger(value.sourceWidth) ||
    !isPositiveSafeInteger(value.sourceHeight) ||
    value.sourceWidth > STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS ||
    value.sourceHeight > STUDIO_LAYER_LIFT_ARTIFACT_MAX_AXIS_PIXELS ||
    value.sourceWidth * value.sourceHeight >
      STUDIO_LAYER_LIFT_ARTIFACT_MAX_PIXELS ||
    !isPngReceipt(value.background, value.sourceWidth, value.sourceHeight) ||
    !isPngReceipt(value.foreground, value.sourceWidth, value.sourceHeight)
  ) {
    return false;
  }
  return (
    value.background.outputId !== value.foreground.outputId &&
    value.aggregatePixelCount ===
      value.background.pixelCount + value.foreground.pixelCount &&
    value.aggregatePixelCount <= STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_PIXELS &&
    value.aggregateByteLength ===
      value.background.byteLength + value.foreground.byteLength &&
    value.aggregateByteLength <=
      STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_COMPRESSED_BYTES &&
    value.aggregateDecodedByteLength ===
      value.background.decodedByteLength + value.foreground.decodedByteLength &&
    value.aggregateDecodedByteLength <=
      STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_DECODED_BYTES &&
    typeof value.receiptSha256 === "string" &&
    SHA256_PATTERN.test(value.receiptSha256)
  );
}

const RESULT_KEYS = [
  "version",
  "kind",
  "generation",
  "sequence",
  "receipt",
  "backgroundByteLength",
  "foregroundByteLength",
  "backgroundBytes",
  "foregroundBytes",
] as const;

const ERROR_KEYS = [
  "version",
  "kind",
  "generation",
  "sequence",
  "code",
  "message",
] as const;

const ERROR_CODES = new Set<StudioLayerLiftArtifactWorkerErrorCode>([
  "aborted",
  "budget-exceeded",
  "decode-failed",
  "decode-unavailable",
  "dimension-mismatch",
  "internal",
  "invalid-input",
  "invalid-png",
  "protocol",
  "receipt-mismatch",
]);

export function isStudioLayerLiftArtifactWorkerResult(
  value: unknown,
): value is StudioLayerLiftArtifactWorkerResult {
  if (!hasOwnDataProperties(value, RESULT_KEYS)) {
    return false;
  }
  return (
    value.version === STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION &&
    value.kind === STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND &&
    isSequence(value.generation) &&
    isSequence(value.sequence) &&
    isReceiptEnvelope(value.receipt) &&
    isPositiveSafeInteger(value.backgroundByteLength) &&
    isPositiveSafeInteger(value.foregroundByteLength) &&
    value.backgroundByteLength <= STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES &&
    value.foregroundByteLength <= STUDIO_LAYER_LIFT_ARTIFACT_MAX_COMPRESSED_BYTES &&
    value.backgroundByteLength + value.foregroundByteLength <=
      STUDIO_LAYER_LIFT_ARTIFACT_PAIR_MAX_COMPRESSED_BYTES &&
    isOwnedArrayBuffer(value.backgroundBytes) &&
    isOwnedArrayBuffer(value.foregroundBytes) &&
    value.backgroundByteLength === value.backgroundBytes.byteLength &&
    value.foregroundByteLength === value.foregroundBytes.byteLength &&
    value.receipt.background.byteLength === value.backgroundByteLength &&
    value.receipt.foreground.byteLength === value.foregroundByteLength &&
    value.receipt.aggregateByteLength ===
      value.backgroundByteLength + value.foregroundByteLength
  );
}

export function isStudioLayerLiftArtifactWorkerError(
  value: unknown,
): value is StudioLayerLiftArtifactWorkerError {
  if (!hasOwnDataProperties(value, ERROR_KEYS)) {
    return false;
  }
  return (
    value.version === STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION &&
    value.kind === STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND &&
    isSequence(value.generation) &&
    isSequence(value.sequence) &&
    typeof value.code === "string" &&
    ERROR_CODES.has(value.code as StudioLayerLiftArtifactWorkerErrorCode) &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 500
  );
}

export function isStudioLayerLiftArtifactWorkerResponse(
  value: unknown,
): value is StudioLayerLiftArtifactWorkerResponse {
  return (
    isStudioLayerLiftArtifactWorkerResult(value) ||
    isStudioLayerLiftArtifactWorkerError(value)
  );
}

export function getStudioLayerLiftArtifactWorkerRequestTransferList(
  request: StudioLayerLiftArtifactWorkerRequest,
): [ArrayBuffer, ArrayBuffer] {
  return [request.backgroundBytes, request.foregroundBytes];
}

export function getStudioLayerLiftArtifactWorkerResultTransferList(
  result: StudioLayerLiftArtifactWorkerResult,
): [ArrayBuffer, ArrayBuffer] {
  return [result.backgroundBytes, result.foregroundBytes];
}
