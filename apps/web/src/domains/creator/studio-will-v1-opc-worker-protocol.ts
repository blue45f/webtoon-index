import {
  STUDIO_WILL_V1_LIMITS,
  type StudioWillV1Limits,
} from "./studio-will-v1-interchange";
import {
  STUDIO_WILL_V1_OPC_LIMITS,
  type StudioWillV1OpcErrorCode,
  type StudioWillV1OpcLimits,
} from "./studio-will-v1-opc-interchange";
import {
  isStudioWillV1OpcPacked,
} from "./studio-will-v1-opc-packed-codec";

export const STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION = 2 as const;
/** Kept for diagnostics: v2 no longer sends point object graphs across the Worker boundary. */
export const STUDIO_WILL_V1_OPC_WORKER_MAX_STRUCTURED_CLONE_POINTS = 0;
export const STUDIO_WILL_V1_OPC_WORKER_MAX_PACKED_POINTS =
  STUDIO_WILL_V1_LIMITS.maxTotalPoints;

export interface StudioWillV1OpcWorkerCodecOptions {
  readonly limits?: Partial<StudioWillV1OpcLimits>;
  readonly willLimits?: Partial<StudioWillV1Limits>;
}

interface StudioWillV1OpcWorkerRequestBase {
  readonly version: typeof STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
}

export interface StudioWillV1OpcWorkerEncodeRequest
  extends StudioWillV1OpcWorkerRequestBase {
  readonly type: "studio-will-v1-opc/encode";
  readonly packedInput: Uint8Array;
  readonly options?: StudioWillV1OpcWorkerCodecOptions;
}

export interface StudioWillV1OpcWorkerDecodeRequest
  extends StudioWillV1OpcWorkerRequestBase {
  readonly type: "studio-will-v1-opc/decode";
  /** Uint8Array snapshots are transferred; Blob inputs are cloned and read in-Worker. */
  readonly source: Uint8Array | Blob;
  readonly options?: StudioWillV1OpcWorkerCodecOptions;
}

export type StudioWillV1OpcWorkerRequest =
  | StudioWillV1OpcWorkerEncodeRequest
  | StudioWillV1OpcWorkerDecodeRequest;

export type StudioWillV1OpcWorkerFailureCode =
  | StudioWillV1OpcErrorCode
  | "INVALID_REQUEST"
  | "OPERATION_FAILED";

export interface StudioWillV1OpcWorkerSerializedError {
  readonly code: StudioWillV1OpcWorkerFailureCode;
  readonly name: string;
  readonly message: string;
  readonly path?: string;
}

export interface StudioWillV1OpcWorkerEncodeSuccess {
  readonly type: "studio-will-v1-opc/encode-success";
  readonly version: typeof STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly archive: Uint8Array;
  readonly packedResult: Uint8Array;
}

export interface StudioWillV1OpcWorkerDecodeSuccess {
  readonly type: "studio-will-v1-opc/decode-success";
  readonly version: typeof STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly packedResult: Uint8Array;
}

export interface StudioWillV1OpcWorkerFailure {
  readonly type: "studio-will-v1-opc/failure";
  readonly version: typeof STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly operation: "decode" | "encode";
  readonly error: StudioWillV1OpcWorkerSerializedError;
}

export type StudioWillV1OpcWorkerResponse =
  | StudioWillV1OpcWorkerEncodeSuccess
  | StudioWillV1OpcWorkerDecodeSuccess
  | StudioWillV1OpcWorkerFailure;

const FAILURE_CODES = new Set<StudioWillV1OpcWorkerFailureCode>([
  "ABORTED",
  "ARCHIVE_INVALID",
  "CONTENT_TYPES_INVALID",
  "DIMENSION_INVALID",
  "LIMIT_INVALID",
  "METADATA_INVALID",
  "PART_SET_INVALID",
  "RELATIONSHIP_INVALID",
  "RESOURCE_LIMIT",
  "STROKES_INVALID",
  "SVG_INVALID",
  "XML_INVALID",
  "INVALID_REQUEST",
  "OPERATION_FAILED",
]);

const CODEC_OPTION_KEYS = ["limits", "willLimits"] as const;
const OPC_LIMIT_KEYS = [
  "maxArchiveBytes",
  "maxXmlPartBytes",
  "maxStrokesBytes",
  "maxMetadataCharacters",
  "maxDimension",
  "maxXmlDepth",
  "maxXmlElements",
  "maxXmlAttributesPerElement",
] as const;
const WILL_LIMIT_KEYS = [
  "maxStrokesBytes",
  "maxPathMessageBytes",
  "maxPaths",
  "maxPointsPerPath",
  "maxTotalPoints",
  "maxDecimalPrecision",
  "maxCoordinateMagnitude",
  "maxStrokeWidth",
] as const;

function ownDataRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.some((key) => typeof key !== "string" || !allowed.has(key))
      || requiredKeys.some((key) => !ownKeys.includes(key))
    ) {
      return null;
    }
    const record: Record<string, unknown> = {};
    for (const key of ownKeys) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function ownValue(value: unknown, key: string): unknown {
  try {
    if (value === null || typeof value !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length >= 1
    && value.length <= 128
    && !hasControlCharacter(value)
  );
}

function isPartialNumericRecord(
  value: unknown,
  allowedKeys: readonly string[],
): boolean {
  if (value === undefined) return true;
  const record = ownDataRecord(value, [], allowedKeys);
  return (
    record !== null
    && Object.values(record).every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )
  );
}

function isCodecOptions(
  value: unknown,
): value is StudioWillV1OpcWorkerCodecOptions {
  if (value === undefined) return true;
  const record = ownDataRecord(value, [], CODEC_OPTION_KEYS);
  if (!record) return false;
  const willLimits = record.willLimits === undefined
    ? null
    : ownDataRecord(record.willLimits, [], WILL_LIMIT_KEYS);
  return (
    isPartialNumericRecord(record.limits, OPC_LIMIT_KEYS)
    && isPartialNumericRecord(record.willLimits, WILL_LIMIT_KEYS)
    && (
      willLimits?.maxTotalPoints === undefined
      || (
        typeof willLimits.maxTotalPoints === "number"
        && willLimits.maxTotalPoints <= STUDIO_WILL_V1_LIMITS.maxTotalPoints
      )
    )
  );
}

function packetOptions(
  options: StudioWillV1OpcWorkerCodecOptions | undefined,
): StudioWillV1OpcWorkerCodecOptions {
  return {
    ...(options?.limits ? { limits: options.limits } : {}),
    ...(options?.willLimits ? { willLimits: options.willLimits } : {}),
  };
}

function isOwnedBytes(
  value: unknown,
  minimum: number,
  maximum: number,
): value is Uint8Array {
  return (
    value instanceof Uint8Array
    && value.buffer instanceof ArrayBuffer
    && value.byteOffset === 0
    && value.byteLength === value.buffer.byteLength
    && value.byteLength >= minimum
    && value.byteLength <= maximum
  );
}

export function isStudioWillV1OpcWorkerRequest(
  value: unknown,
): value is StudioWillV1OpcWorkerRequest {
  const type = ownValue(value, "type");
  const record = type === "studio-will-v1-opc/encode"
    ? ownDataRecord(
        value,
        ["type", "version", "requestId", "packedInput"],
        ["options"],
      )
    : type === "studio-will-v1-opc/decode"
      ? ownDataRecord(
          value,
          ["type", "version", "requestId", "source"],
          ["options"],
        )
      : null;
  if (
    !record
    || record.version !== STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION
    || !isRequestId(record.requestId)
    || !isCodecOptions(record.options)
  ) {
    return false;
  }
  if (type === "studio-will-v1-opc/encode") {
    return isStudioWillV1OpcPacked(
      record.packedInput,
      "export-input",
      packetOptions(record.options as StudioWillV1OpcWorkerCodecOptions | undefined),
    );
  }
  return (
    type === "studio-will-v1-opc/decode"
    && (
      isOwnedBytes(record.source, 0, STUDIO_WILL_V1_OPC_LIMITS.maxArchiveBytes)
      || (
        typeof Blob !== "undefined"
        && record.source instanceof Blob
        && record.source.size <= STUDIO_WILL_V1_OPC_LIMITS.maxArchiveBytes
      )
    )
  );
}

export function studioWillV1OpcWorkerCorrelation(
  value: unknown,
): { readonly requestId: string; readonly operation?: "decode" | "encode" } | null {
  const requestId = ownValue(value, "requestId");
  if (!isRequestId(requestId)) return null;
  const type = ownValue(value, "type");
  let operation: "decode" | "encode" | undefined;
  if (
    type === "studio-will-v1-opc/encode"
    || type === "studio-will-v1-opc/encode-success"
  ) {
    operation = "encode";
  } else if (
    type === "studio-will-v1-opc/decode"
    || type === "studio-will-v1-opc/decode-success"
  ) {
    operation = "decode";
  } else if (
    type === "studio-will-v1-opc/failure"
    && (
      ownValue(value, "operation") === "decode"
      || ownValue(value, "operation") === "encode"
    )
  ) {
    operation = ownValue(value, "operation") as "decode" | "encode";
  }
  return operation === undefined ? { requestId } : { requestId, operation };
}

function isSerializedError(value: unknown): value is StudioWillV1OpcWorkerSerializedError {
  const error = ownDataRecord(value, ["code", "name", "message"], ["path"]);
  if (
    !error
    || typeof error.code !== "string"
    || !FAILURE_CODES.has(error.code as StudioWillV1OpcWorkerFailureCode)
    || typeof error.name !== "string"
    || error.name.length < 1
    || error.name.length > 128
    || typeof error.message !== "string"
    || error.message.length < 1
    || error.message.length > 2_048
  ) {
    return false;
  }
  return error.path === undefined
    || (
      typeof error.path === "string"
      && error.path.length >= 1
      && error.path.length <= 1_024
    );
}

export function isStudioWillV1OpcWorkerResponse(
  value: unknown,
): value is StudioWillV1OpcWorkerResponse {
  const type = ownValue(value, "type");
  const record = type === "studio-will-v1-opc/encode-success"
    ? ownDataRecord(
        value,
        ["type", "version", "requestId", "archive", "packedResult"],
      )
    : type === "studio-will-v1-opc/decode-success"
      ? ownDataRecord(
          value,
          ["type", "version", "requestId", "packedResult"],
        )
      : type === "studio-will-v1-opc/failure"
        ? ownDataRecord(
            value,
            ["type", "version", "requestId", "operation", "error"],
          )
        : null;
  if (
    !record
    || record.version !== STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION
    || !isRequestId(record.requestId)
  ) {
    return false;
  }
  if (type === "studio-will-v1-opc/encode-success") {
    return (
      isOwnedBytes(record.archive, 22, STUDIO_WILL_V1_OPC_LIMITS.maxArchiveBytes)
      && isStudioWillV1OpcPacked(record.packedResult, "build-result")
      && (record.archive as Uint8Array).buffer
        !== (record.packedResult as Uint8Array).buffer
    );
  }
  if (type === "studio-will-v1-opc/decode-success") {
    return isStudioWillV1OpcPacked(record.packedResult, "import-result");
  }
  return (
    type === "studio-will-v1-opc/failure"
    && (record.operation === "decode" || record.operation === "encode")
    && isSerializedError(record.error)
  );
}

function uniqueOwnedBuffers(values: readonly unknown[]): Transferable[] {
  const buffers: ArrayBuffer[] = [];
  for (const value of values) {
    if (
      !(value instanceof Uint8Array)
      || !(value.buffer instanceof ArrayBuffer)
      || value.byteOffset !== 0
      || value.byteLength !== value.buffer.byteLength
      || buffers.includes(value.buffer)
    ) {
      return [];
    }
    buffers.push(value.buffer);
  }
  return buffers;
}

export function studioWillV1OpcWorkerRequestTransfers(
  request: StudioWillV1OpcWorkerRequest,
): Transferable[] {
  if (request.type === "studio-will-v1-opc/encode") {
    return uniqueOwnedBuffers([request.packedInput]);
  }
  return request.source instanceof Uint8Array
    ? uniqueOwnedBuffers([request.source])
    : [];
}

export function studioWillV1OpcWorkerResponseTransfers(
  response: StudioWillV1OpcWorkerResponse,
): Transferable[] {
  if (response.type === "studio-will-v1-opc/encode-success") {
    return uniqueOwnedBuffers([response.archive, response.packedResult]);
  }
  if (response.type === "studio-will-v1-opc/decode-success") {
    return uniqueOwnedBuffers([response.packedResult]);
  }
  return [];
}
