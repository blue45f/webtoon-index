import { fromUint8Array, toUint8Array } from "js-base64";

// v6 gates rooms that can persist segmented causal-deposit v4 stroke snapshots.
// Keeping this at v5 would let a long-open tab join the same room and silently truncate a
// renderer-significant dynamic stroke after the v2 dab ceiling. The local wire brand changes with
// the room protocol so stale BroadcastChannel peers are isolated before payload parsing.
export const STUDIO_CRDT_PROTOCOL_VERSION = 6 as const;
export const STUDIO_CRDT_LOCAL_WIRE_BRAND = "toonspectrum:studio-crdt:v6" as const;
/**
 * v2 adds renderer-significant `paintModel` semantics. v3 adds the paired material-pressure
 * model/geometry-floor snapshot and the dynamic-brush minimum-diameter geometry floor. v4 adds the
 * segmented causal-deposit continuation pipeline. New clients still read v1-v3, while older
 * clients reject v4 instead of silently rendering a truncated stroke in the same room.
 */
export const STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION = 1 as const;
export const STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION = 2 as const;
export const STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION = 3 as const;
export const STUDIO_CRDT_STROKE_PAYLOAD_VERSION = 4 as const;
export type StudioCrdtStrokePayloadVersion =
  | typeof STUDIO_CRDT_LEGACY_STROKE_PAYLOAD_VERSION
  | typeof STUDIO_CRDT_PAINT_STROKE_PAYLOAD_VERSION
  | typeof STUDIO_CRDT_MATERIAL_STROKE_PAYLOAD_VERSION
  | typeof STUDIO_CRDT_STROKE_PAYLOAD_VERSION;
export const STUDIO_CRDT_ORIGIN_LOCAL = Symbol("studio-crdt-local");
export const STUDIO_CRDT_ORIGIN_REMOTE = Symbol("studio-crdt-remote");
export const STUDIO_CRDT_ORIGIN_SYNC = Symbol("studio-crdt-sync");

/**
 * Incremental updates stay below the socket frame budget. A full state-vector diff is transported
 * as ordered raw-byte chunks and reassembled before the single Y.applyUpdate call.
 */
export const STUDIO_CRDT_UPDATE_MAX_BYTES = 48 * 1024;
export const STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES = 40 * 1024;
export const STUDIO_CRDT_SYNC_MAX_BYTES = 16 * 1024 * 1024;
export const STUDIO_CRDT_SYNC_MAX_CHUNKS = Math.ceil(
  STUDIO_CRDT_SYNC_MAX_BYTES / STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES
);
export const STUDIO_CRDT_STATE_VECTOR_MAX_BYTES = 256 * 1024;
export const STUDIO_CRDT_LOCAL_MESSAGE_MAX_BYTES =
  Math.ceil(STUDIO_CRDT_SYNC_MAX_BYTES / 3) * 4 + 64 * 1024;

const MAX_ID_LENGTH = 160;
const MAX_SEQUENCE_DIGITS = 20;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const DECIMAL_SEQUENCE_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TEXT_ENCODER = new TextEncoder();

export interface StudioCrdtSyncRequest {
  protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
  workId: string;
  requestId: string;
  stateVector: string;
}

export interface StudioCrdtSyncResponse {
  protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
  workId: string;
  requestId: string;
  transferId: string;
  /** Ordered base64 encoding of consecutive raw Yjs diff byte ranges. */
  chunks: string[];
  chunkCount: number;
  totalBytes: number;
  /** Lets the client compute and publish local/offline operations missing from the server. */
  serverStateVector: string;
  serverSequence: string;
}

export interface StudioCrdtUpdateRequest {
  protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
  workId: string;
  /** Stable across retries so the server can make publication idempotent. */
  updateId: string;
  clientSequence: number;
  update: string;
}

export interface StudioCrdtUpdateAck {
  protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
  workId: string;
  updateId: string;
  serverSequence: string;
  /** Local BroadcastChannel ACKs use null because there is no authoritative server document. */
  serverStateVector: string | null;
  duplicate: boolean;
}

export interface StudioCrdtRemoteUpdate {
  protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
  workId: string;
  updateId: string;
  serverSequence: string;
  update: string;
}

export type StudioCrdtTransportMessage =
  | {
      type: "sync-request";
      request: StudioCrdtSyncRequest;
      senderSessionId: string;
    }
  | {
      type: "sync-response";
      response: StudioCrdtSyncResponse;
      senderSessionId: string | null;
    }
  | {
      type: "update";
      update: StudioCrdtRemoteUpdate;
      senderSessionId: string | null;
    };

export type StudioCrdtLocalWireMessage =
  | {
      brand: typeof STUDIO_CRDT_LOCAL_WIRE_BRAND;
      protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
      workId: string;
      senderSessionId: string;
      targetSessionId: null;
      kind: "sync-request";
      payload: StudioCrdtSyncRequest;
    }
  | {
      brand: typeof STUDIO_CRDT_LOCAL_WIRE_BRAND;
      protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
      workId: string;
      senderSessionId: string;
      targetSessionId: string;
      kind: "sync-response";
      payload: StudioCrdtSyncResponse;
    }
  | {
      brand: typeof STUDIO_CRDT_LOCAL_WIRE_BRAND;
      protocolVersion: typeof STUDIO_CRDT_PROTOCOL_VERSION;
      workId: string;
      senderSessionId: string;
      targetSessionId: null;
      kind: "update";
      payload: StudioCrdtRemoteUpdate;
    };

export interface ParseStudioCrdtOptions {
  expectedWorkId?: string;
}

export interface ParseStudioCrdtLocalWireOptions extends ParseStudioCrdtOptions {
  selfSessionId?: string;
}

export class StudioCrdtProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioCrdtProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isSafeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    SAFE_ID_PATTERN.test(value)
  );
}

function isSequence(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_SEQUENCE_DIGITS &&
    DECIMAL_SEQUENCE_PATTERN.test(value)
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function jsonByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : TEXT_ENCODER.encode(serialized).byteLength;
  } catch {
    return null;
  }
}

function decodeCanonicalBase64(value: unknown, maximumBytes: number): Uint8Array | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(maximumBytes / 3) * 4 ||
    !BASE64_PATTERN.test(value)
  ) {
    return null;
  }
  try {
    const bytes = toUint8Array(value);
    if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) return null;
    return fromUint8Array(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

export function encodeStudioCrdtUpdate(update: Uint8Array): string {
  if (update.byteLength === 0 || update.byteLength > STUDIO_CRDT_UPDATE_MAX_BYTES) {
    throw new StudioCrdtProtocolError("CRDT 업데이트 크기가 허용 범위를 벗어났습니다.");
  }
  return fromUint8Array(update);
}

export function decodeStudioCrdtUpdate(value: string): Uint8Array {
  const decoded = decodeCanonicalBase64(value, STUDIO_CRDT_UPDATE_MAX_BYTES);
  if (!decoded) throw new StudioCrdtProtocolError("유효하지 않은 CRDT 업데이트입니다.");
  return decoded;
}

export function encodeStudioCrdtStateVector(stateVector: Uint8Array): string {
  if (
    stateVector.byteLength === 0 ||
    stateVector.byteLength > STUDIO_CRDT_STATE_VECTOR_MAX_BYTES
  ) {
    throw new StudioCrdtProtocolError("CRDT 상태 벡터 크기가 허용 범위를 벗어났습니다.");
  }
  return fromUint8Array(stateVector);
}

export function decodeStudioCrdtStateVector(value: string): Uint8Array {
  const decoded = decodeCanonicalBase64(value, STUDIO_CRDT_STATE_VECTOR_MAX_BYTES);
  if (!decoded) throw new StudioCrdtProtocolError("유효하지 않은 CRDT 상태 벡터입니다.");
  return decoded;
}

export function encodeStudioCrdtSyncChunks(update: Uint8Array): string[] {
  if (update.byteLength === 0 || update.byteLength > STUDIO_CRDT_SYNC_MAX_BYTES) {
    throw new StudioCrdtProtocolError("CRDT 동기화 데이터 크기가 허용 범위를 벗어났습니다.");
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < update.byteLength; offset += STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES) {
    chunks.push(
      fromUint8Array(update.subarray(offset, offset + STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES))
    );
  }
  return chunks;
}

export function decodeStudioCrdtSyncChunks(
  chunks: readonly string[],
  expectedTotalBytes?: number
): Uint8Array {
  if (chunks.length === 0 || chunks.length > STUDIO_CRDT_SYNC_MAX_CHUNKS) {
    throw new StudioCrdtProtocolError("CRDT 동기화 청크 수가 허용 범위를 벗어났습니다.");
  }
  const decodedChunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (const chunk of chunks) {
    const decoded = decodeCanonicalBase64(chunk, STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES);
    if (!decoded) throw new StudioCrdtProtocolError("유효하지 않은 CRDT 동기화 청크입니다.");
    totalBytes += decoded.byteLength;
    if (totalBytes > STUDIO_CRDT_SYNC_MAX_BYTES) {
      throw new StudioCrdtProtocolError("CRDT 동기화 데이터가 최대 크기를 초과했습니다.");
    }
    decodedChunks.push(decoded);
  }
  if (expectedTotalBytes !== undefined && totalBytes !== expectedTotalBytes) {
    throw new StudioCrdtProtocolError("CRDT 동기화 청크의 전체 크기가 일치하지 않습니다.");
  }
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of decodedChunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function commonContract(value: Record<string, unknown>, options: ParseStudioCrdtOptions): boolean {
  return (
    value.protocolVersion === STUDIO_CRDT_PROTOCOL_VERSION &&
    isSafeId(value.workId) &&
    (options.expectedWorkId === undefined || value.workId === options.expectedWorkId)
  );
}

export function parseStudioCrdtSyncRequest(
  value: unknown,
  options: ParseStudioCrdtOptions = {}
): StudioCrdtSyncRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["protocolVersion", "workId", "requestId", "stateVector"]) ||
    !commonContract(value, options) ||
    !isSafeId(value.requestId) ||
    decodeCanonicalBase64(value.stateVector, STUDIO_CRDT_STATE_VECTOR_MAX_BYTES) === null
  ) {
    return null;
  }
  return value as unknown as StudioCrdtSyncRequest;
}

export function parseStudioCrdtSyncResponse(
  value: unknown,
  options: ParseStudioCrdtOptions = {}
): StudioCrdtSyncResponse | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "workId",
      "requestId",
      "transferId",
      "chunks",
      "chunkCount",
      "totalBytes",
      "serverStateVector",
      "serverSequence",
    ]) ||
    !commonContract(value, options) ||
    !isSafeId(value.requestId) ||
    !isUuid(value.transferId) ||
    !isSequence(value.serverSequence) ||
    !Array.isArray(value.chunks) ||
    typeof value.chunkCount !== "number" ||
    !Number.isSafeInteger(value.chunkCount) ||
    value.chunkCount !== value.chunks.length ||
    value.chunkCount < 1 ||
    value.chunkCount > STUDIO_CRDT_SYNC_MAX_CHUNKS ||
    typeof value.totalBytes !== "number" ||
    !Number.isSafeInteger(value.totalBytes) ||
    value.totalBytes < 1 ||
    value.totalBytes > STUDIO_CRDT_SYNC_MAX_BYTES ||
    decodeCanonicalBase64(value.serverStateVector, STUDIO_CRDT_STATE_VECTOR_MAX_BYTES) === null
  ) {
    return null;
  }
  try {
    decodeStudioCrdtSyncChunks(value.chunks as string[], value.totalBytes);
  } catch {
    return null;
  }
  return value as unknown as StudioCrdtSyncResponse;
}

export function parseStudioCrdtUpdateRequest(
  value: unknown,
  options: ParseStudioCrdtOptions = {}
): StudioCrdtUpdateRequest | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "workId",
      "updateId",
      "clientSequence",
      "update",
    ]) ||
    !commonContract(value, options) ||
    !isUuid(value.updateId) ||
    typeof value.clientSequence !== "number" ||
    !Number.isSafeInteger(value.clientSequence) ||
    value.clientSequence < 1 ||
    decodeCanonicalBase64(value.update, STUDIO_CRDT_UPDATE_MAX_BYTES) === null
  ) {
    return null;
  }
  return value as unknown as StudioCrdtUpdateRequest;
}

/**
 * Protocol v2-v6 changed the room capability gate, not the encoded Yjs update shape. Pending
 * v1-v5 outbox and recovery rows can therefore be upgraded locally before resend/export, while
 * network parsers continue to reject live legacy peers and prevent mixed-capability rooms.
 */
export function parsePersistedStudioCrdtUpdateRequest(
  value: unknown,
  options: ParseStudioCrdtOptions = {}
): StudioCrdtUpdateRequest | null {
  const candidate = isRecord(value) && (
    value.protocolVersion === 1 ||
    value.protocolVersion === 2 ||
    value.protocolVersion === 3 ||
    value.protocolVersion === 4 ||
    value.protocolVersion === 5
  )
    ? { ...value, protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION }
    : value;
  return parseStudioCrdtUpdateRequest(candidate, options);
}

export function parseStudioCrdtUpdateAck(
  value: unknown,
  options: ParseStudioCrdtOptions = {}
): StudioCrdtUpdateAck | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "workId",
      "updateId",
      "serverSequence",
      "serverStateVector",
      "duplicate",
    ]) ||
    !commonContract(value, options) ||
    !isUuid(value.updateId) ||
    !isSequence(value.serverSequence) ||
    typeof value.duplicate !== "boolean" ||
    (value.serverStateVector !== null &&
      decodeCanonicalBase64(value.serverStateVector, STUDIO_CRDT_STATE_VECTOR_MAX_BYTES) === null)
  ) {
    return null;
  }
  return value as unknown as StudioCrdtUpdateAck;
}

export function parseStudioCrdtRemoteUpdate(
  value: unknown,
  options: ParseStudioCrdtOptions = {}
): StudioCrdtRemoteUpdate | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "protocolVersion",
      "workId",
      "updateId",
      "serverSequence",
      "update",
    ]) ||
    !commonContract(value, options) ||
    !isUuid(value.updateId) ||
    !isSequence(value.serverSequence) ||
    decodeCanonicalBase64(value.update, STUDIO_CRDT_UPDATE_MAX_BYTES) === null
  ) {
    return null;
  }
  return value as unknown as StudioCrdtRemoteUpdate;
}

export function createStudioCrdtLocalWireMessage(
  message:
    | {
        workId: string;
        senderSessionId: string;
        targetSessionId: null;
        kind: "sync-request";
        payload: StudioCrdtSyncRequest;
      }
    | {
        workId: string;
        senderSessionId: string;
        targetSessionId: string;
        kind: "sync-response";
        payload: StudioCrdtSyncResponse;
      }
    | {
        workId: string;
        senderSessionId: string;
        targetSessionId: null;
        kind: "update";
        payload: StudioCrdtRemoteUpdate;
      }
): StudioCrdtLocalWireMessage {
  const wire = {
    brand: STUDIO_CRDT_LOCAL_WIRE_BRAND,
    protocolVersion: STUDIO_CRDT_PROTOCOL_VERSION,
    ...message,
  } as StudioCrdtLocalWireMessage;
  const parsed = parseStudioCrdtLocalWireMessage(wire, {
    expectedWorkId: message.workId,
  });
  if (!parsed) throw new StudioCrdtProtocolError("유효하지 않은 로컬 CRDT 메시지입니다.");
  return parsed;
}

export function parseStudioCrdtLocalWireMessage(
  value: unknown,
  options: ParseStudioCrdtLocalWireOptions = {}
): StudioCrdtLocalWireMessage | null {
  const byteLength = jsonByteLength(value);
  if (
    byteLength === null ||
    byteLength > STUDIO_CRDT_LOCAL_MESSAGE_MAX_BYTES ||
    !isRecord(value) ||
    !hasExactKeys(value, [
      "brand",
      "protocolVersion",
      "workId",
      "senderSessionId",
      "targetSessionId",
      "kind",
      "payload",
    ]) ||
    value.brand !== STUDIO_CRDT_LOCAL_WIRE_BRAND ||
    value.protocolVersion !== STUDIO_CRDT_PROTOCOL_VERSION ||
    !isSafeId(value.workId) ||
    (options.expectedWorkId !== undefined && value.workId !== options.expectedWorkId) ||
    !isSafeId(value.senderSessionId) ||
    value.senderSessionId === options.selfSessionId
  ) {
    return null;
  }

  if (value.kind === "sync-request") {
    if (value.targetSessionId !== null) return null;
    const payload = parseStudioCrdtSyncRequest(value.payload, {
      expectedWorkId: value.workId,
    });
    return payload ? ({ ...value, payload } as StudioCrdtLocalWireMessage) : null;
  }
  if (value.kind === "sync-response") {
    if (!isSafeId(value.targetSessionId)) return null;
    if (options.selfSessionId !== undefined && value.targetSessionId !== options.selfSessionId) {
      return null;
    }
    const payload = parseStudioCrdtSyncResponse(value.payload, {
      expectedWorkId: value.workId,
    });
    return payload ? ({ ...value, payload } as StudioCrdtLocalWireMessage) : null;
  }
  if (value.kind === "update") {
    if (value.targetSessionId !== null) return null;
    const payload = parseStudioCrdtRemoteUpdate(value.payload, {
      expectedWorkId: value.workId,
    });
    return payload ? ({ ...value, payload } as StudioCrdtLocalWireMessage) : null;
  }
  return null;
}

export function isStudioCrdtLocalWireCandidate(value: unknown): boolean {
  return isRecord(value) && value.brand === STUDIO_CRDT_LOCAL_WIRE_BRAND;
}
