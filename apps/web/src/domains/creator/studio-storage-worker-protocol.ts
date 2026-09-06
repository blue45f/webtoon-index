import {
  STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES,
  STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
} from "./studio-large-document-address-space";
import { STUDIO_OPFS_SYNC_MAX_TRANSFER_BYTES } from "./studio-opfs-sync-access-store";

/**
 * Versioned structured-clone protocol for the long-lived Studio Storage Worker.
 *
 * Every request has a strictly increasing request sequence. Mutations also have
 * an independently increasing command sequence and carry the exact session
 * epoch/revision they were based on. The Worker is therefore able to reject
 * replayed, reordered and stale writes before they reach OPFS.
 */
export const STUDIO_STORAGE_WORKER_PROTOCOL_VERSION = 1 as const;

export const STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES =
  STUDIO_OPFS_SYNC_MAX_TRANSFER_BYTES;
export const STUDIO_STORAGE_WORKER_MAX_JOURNAL_APPEND_BYTES =
  16 * 1024 * 1024;
export const STUDIO_STORAGE_WORKER_MAX_SESSION_WRITE_BYTES =
  BigInt(8) * BigInt(1024) * BigInt(1024) * BigInt(1024);
export const STUDIO_STORAGE_WORKER_MAX_JOURNAL_BYTES =
  BigInt(2) * BigInt(1024) * BigInt(1024) * BigInt(1024);
export const STUDIO_STORAGE_WORKER_MAX_DOCUMENT_ID_CHARS = 128;
export const STUDIO_STORAGE_WORKER_MAX_CHECKPOINT_ID_CHARS = 128;
export const STUDIO_STORAGE_WORKER_MAX_ERROR_MESSAGE_CHARS = 1_024;

const DOCUMENT_ID_RE = /^[a-z0-9][a-z0-9._-]*$/u;

export interface StudioStorageWorkerSessionConfig {
  readonly sessionEpoch: number;
  readonly documentId: string;
  readonly shardBytes: bigint;
  readonly dataByteLength: bigint;
  readonly journalByteLength: bigint;
  readonly revision: number;
  readonly maxDocumentBytes: bigint;
  readonly maxJournalBytes: bigint;
  readonly maxSessionWriteBytes: bigint;
}

interface StudioStorageWorkerRequestBase {
  readonly version: typeof STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
  readonly requestSequence: number;
}

interface StudioStorageWorkerSessionRequestBase
extends StudioStorageWorkerRequestBase {
  readonly sessionEpoch: number;
  readonly expectedRevision: number;
}

interface StudioStorageWorkerCommandRequestBase
extends StudioStorageWorkerSessionRequestBase {
  readonly commandSequence: number;
}

export interface StudioStorageWorkerCapabilityRequest
extends StudioStorageWorkerRequestBase {
  readonly type: "studio-storage/capability";
}

export interface StudioStorageWorkerOpenRequest
extends StudioStorageWorkerRequestBase {
  readonly type: "studio-storage/open";
  readonly commandSequence: number;
  readonly session: StudioStorageWorkerSessionConfig;
}

export interface StudioStorageWorkerReadRequest
extends StudioStorageWorkerSessionRequestBase {
  readonly type: "studio-storage/read";
  readonly source: "document" | "journal";
  readonly globalByteOffset: bigint;
  readonly byteLength: number;
}

export interface StudioStorageWorkerWriteRequest
extends StudioStorageWorkerCommandRequestBase {
  readonly type: "studio-storage/write";
  readonly globalByteOffset: bigint;
  /** Dedicated transferable ownership; SharedArrayBuffer is rejected. */
  readonly data: ArrayBuffer;
}

export interface StudioStorageWorkerAppendJournalRequest
extends StudioStorageWorkerCommandRequestBase {
  readonly type: "studio-storage/append-journal";
  /** One complete framed journal record. */
  readonly data: ArrayBuffer;
}

export interface StudioStorageWorkerFlushRequest
extends StudioStorageWorkerCommandRequestBase {
  readonly type: "studio-storage/flush";
}

export interface StudioStorageWorkerTruncateRequest
extends StudioStorageWorkerCommandRequestBase {
  readonly type: "studio-storage/truncate";
  readonly target: "document" | "journal";
  readonly byteLength: bigint;
}

export interface StudioStorageWorkerCheckpointBarrierRequest
extends StudioStorageWorkerCommandRequestBase {
  readonly type: "studio-storage/checkpoint-barrier";
  readonly checkpointId: string;
}

export interface StudioStorageWorkerCloseRequest
extends StudioStorageWorkerCommandRequestBase {
  readonly type: "studio-storage/close";
}

export type StudioStorageWorkerRequest =
  | StudioStorageWorkerCapabilityRequest
  | StudioStorageWorkerOpenRequest
  | StudioStorageWorkerReadRequest
  | StudioStorageWorkerWriteRequest
  | StudioStorageWorkerAppendJournalRequest
  | StudioStorageWorkerFlushRequest
  | StudioStorageWorkerTruncateRequest
  | StudioStorageWorkerCheckpointBarrierRequest
  | StudioStorageWorkerCloseRequest;

export type StudioStorageWorkerCommandRequest =
  | StudioStorageWorkerOpenRequest
  | StudioStorageWorkerWriteRequest
  | StudioStorageWorkerAppendJournalRequest
  | StudioStorageWorkerFlushRequest
  | StudioStorageWorkerTruncateRequest
  | StudioStorageWorkerCheckpointBarrierRequest
  | StudioStorageWorkerCloseRequest;

export interface StudioStorageWorkerReadyResponse {
  readonly version: typeof STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
  readonly type: "studio-storage/ready";
}

export interface StudioStorageWorkerCapabilityResponse {
  readonly version: typeof STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
  readonly type: "studio-storage/capability-result";
  readonly requestSequence: number;
  /**
   * Cheap Dedicated Worker + OPFS probe. Native sync-handle support is verified
   * while opening a document, because it exists on a file handle, not StorageManager.
   */
  readonly candidateSupported: boolean;
  readonly reason: "available" | "not-dedicated-worker" | "opfs-unavailable";
  readonly requiresOpenProbe: true;
  readonly limits: {
    readonly maxRangeBytes: number;
    readonly maxJournalAppendBytes: number;
    readonly maxJournalBytes: bigint;
    readonly maxSessionWriteBytes: bigint;
    readonly maxLogicalBytes: bigint;
    readonly defaultShardBytes: bigint;
  };
}

export interface StudioStorageWorkerSessionState {
  readonly sessionEpoch: number;
  readonly revision: number;
  readonly dataByteLength: bigint;
  readonly journalByteLength: bigint;
  readonly sessionWrittenBytes: bigint;
}

export interface StudioStorageWorkerOpenedResponse
extends StudioStorageWorkerSessionState {
  readonly version: typeof STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
  readonly type: "studio-storage/opened";
  readonly requestSequence: number;
  readonly commandSequence: number;
  readonly documentId: string;
}

export interface StudioStorageWorkerReadResponse {
  readonly version: typeof STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
  readonly type: "studio-storage/read-result";
  readonly requestSequence: number;
  readonly sessionEpoch: number;
  readonly revision: number;
  readonly source: "document" | "journal";
  readonly globalByteOffset: bigint;
  readonly data: ArrayBuffer;
}

export type StudioStorageWorkerMutationOperation =
  | "write"
  | "append-journal"
  | "flush"
  | "truncate"
  | "close";

export interface StudioStorageWorkerCommandResponse
extends StudioStorageWorkerSessionState {
  readonly version: typeof STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
  readonly type: "studio-storage/command-result";
  readonly requestSequence: number;
  readonly commandSequence: number;
  readonly operation: StudioStorageWorkerMutationOperation;
}

export interface StudioStorageWorkerCheckpointResponse
extends StudioStorageWorkerSessionState {
  readonly version: typeof STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
  readonly type: "studio-storage/checkpointed";
  readonly requestSequence: number;
  readonly commandSequence: number;
  readonly checkpointId: string;
}

export const STUDIO_STORAGE_WORKER_ERROR_CODES = [
  "PROTOCOL",
  "OUT_OF_ORDER_REQUEST",
  "OUT_OF_ORDER_COMMAND",
  "NOT_OPEN",
  "ALREADY_OPEN",
  "STALE_EPOCH",
  "STALE_REVISION",
  "BUDGET_EXCEEDED",
  "CAPABILITY_UNAVAILABLE",
  "STORAGE_FAILED",
  "POISONED",
  "CLOSED",
  "INTERNAL",
] as const;

export type StudioStorageWorkerErrorCode =
  (typeof STUDIO_STORAGE_WORKER_ERROR_CODES)[number];

export interface StudioStorageWorkerErrorEnvelope {
  readonly code: StudioStorageWorkerErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface StudioStorageWorkerErrorResponse {
  readonly version: typeof STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
  readonly type: "studio-storage/error";
  /** Zero only when an invalid envelope did not contain a usable sequence. */
  readonly requestSequence: number;
  readonly commandSequence: number | null;
  readonly sessionEpoch: number | null;
  readonly error: StudioStorageWorkerErrorEnvelope;
}

export type StudioStorageWorkerResponse =
  | StudioStorageWorkerReadyResponse
  | StudioStorageWorkerCapabilityResponse
  | StudioStorageWorkerOpenedResponse
  | StudioStorageWorkerReadResponse
  | StudioStorageWorkerCommandResponse
  | StudioStorageWorkerCheckpointResponse
  | StudioStorageWorkerErrorResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === required.length
    && required.every((key) => hasOwn(value, key));
}

function positiveSequence(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function revision(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function logicalOffset(value: unknown): value is bigint {
  return typeof value === "bigint"
    && value >= BigInt(0)
    && value <= STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES;
}

function boundedRange(
  offset: unknown,
  byteLength: unknown,
  maximum: number,
): offset is bigint {
  return logicalOffset(offset)
    && typeof byteLength === "number"
    && Number.isSafeInteger(byteLength)
    && byteLength > 0
    && byteLength <= maximum
    && offset + BigInt(byteLength) <= STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES;
}

function ownedBuffer(value: unknown, maximum: number): value is ArrayBuffer {
  return value instanceof ArrayBuffer
    && value.byteLength > 0
    && value.byteLength <= maximum;
}

function sessionConfig(value: unknown): value is StudioStorageWorkerSessionConfig {
  if (
    !isRecord(value)
    || !hasExactKeys(value, [
      "sessionEpoch",
      "documentId",
      "shardBytes",
      "dataByteLength",
      "journalByteLength",
      "revision",
      "maxDocumentBytes",
      "maxJournalBytes",
      "maxSessionWriteBytes",
    ])
  ) {
    return false;
  }
  return positiveSequence(value.sessionEpoch)
    && typeof value.documentId === "string"
    && value.documentId.length > 0
    && value.documentId.length <= STUDIO_STORAGE_WORKER_MAX_DOCUMENT_ID_CHARS
    && DOCUMENT_ID_RE.test(value.documentId)
    && typeof value.shardBytes === "bigint"
    && value.shardBytes > BigInt(0)
    && value.shardBytes <= BigInt(Number.MAX_SAFE_INTEGER)
    && logicalOffset(value.dataByteLength)
    && logicalOffset(value.journalByteLength)
    && revision(value.revision)
    && typeof value.maxDocumentBytes === "bigint"
    && value.maxDocumentBytes > BigInt(0)
    && value.maxDocumentBytes <= STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES
    && value.dataByteLength <= value.maxDocumentBytes
    && typeof value.maxJournalBytes === "bigint"
    && value.maxJournalBytes > BigInt(0)
    && value.maxJournalBytes <= STUDIO_STORAGE_WORKER_MAX_JOURNAL_BYTES
    && value.journalByteLength <= value.maxJournalBytes
    && typeof value.maxSessionWriteBytes === "bigint"
    && value.maxSessionWriteBytes > BigInt(0)
    && value.maxSessionWriteBytes <= STUDIO_STORAGE_WORKER_MAX_SESSION_WRITE_BYTES;
}

const CAPABILITY_KEYS = ["version", "type", "requestSequence"] as const;
const OPEN_KEYS = [
  "version",
  "type",
  "requestSequence",
  "commandSequence",
  "session",
] as const;
const SESSION_KEYS = [
  "version",
  "type",
  "requestSequence",
  "sessionEpoch",
  "expectedRevision",
] as const;
const COMMAND_KEYS = [...SESSION_KEYS, "commandSequence"] as const;
const READ_KEYS = [
  ...SESSION_KEYS,
  "source",
  "globalByteOffset",
  "byteLength",
] as const;
const WRITE_KEYS = [
  ...COMMAND_KEYS,
  "globalByteOffset",
  "data",
] as const;
const APPEND_KEYS = [...COMMAND_KEYS, "data"] as const;
const TRUNCATE_KEYS = [
  ...COMMAND_KEYS,
  "target",
  "byteLength",
] as const;
const CHECKPOINT_KEYS = [...COMMAND_KEYS, "checkpointId"] as const;

function validBase(
  value: Record<string, unknown>,
  type: string,
): boolean {
  return value.version === STUDIO_STORAGE_WORKER_PROTOCOL_VERSION
    && value.type === type
    && positiveSequence(value.requestSequence);
}

function validSessionBase(
  value: Record<string, unknown>,
  type: string,
): boolean {
  return validBase(value, type)
    && positiveSequence(value.sessionEpoch)
    && revision(value.expectedRevision);
}

function validCommandBase(
  value: Record<string, unknown>,
  type: string,
): boolean {
  return validSessionBase(value, type)
    && positiveSequence(value.commandSequence);
}

export function isStudioStorageWorkerRequest(
  value: unknown,
): value is StudioStorageWorkerRequest {
  try {
    if (!isRecord(value)) return false;
    switch (value.type) {
      case "studio-storage/capability":
        return hasExactKeys(value, CAPABILITY_KEYS)
          && validBase(value, value.type);
      case "studio-storage/open":
        return hasExactKeys(value, OPEN_KEYS)
          && validBase(value, value.type)
          && positiveSequence(value.commandSequence)
          && sessionConfig(value.session);
      case "studio-storage/read":
        return hasExactKeys(value, READ_KEYS)
          && validSessionBase(value, value.type)
          && (value.source === "document" || value.source === "journal")
          && boundedRange(
            value.globalByteOffset,
            value.byteLength,
            STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES,
          );
      case "studio-storage/write":
        return hasExactKeys(value, WRITE_KEYS)
          && validCommandBase(value, value.type)
          && ownedBuffer(
            value.data,
            STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES,
          )
          && boundedRange(
            value.globalByteOffset,
            value.data.byteLength,
            STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES,
          );
      case "studio-storage/append-journal":
        return hasExactKeys(value, APPEND_KEYS)
          && validCommandBase(value, value.type)
          && ownedBuffer(
            value.data,
            STUDIO_STORAGE_WORKER_MAX_JOURNAL_APPEND_BYTES,
          );
      case "studio-storage/flush":
      case "studio-storage/close":
        return hasExactKeys(value, COMMAND_KEYS)
          && validCommandBase(value, value.type);
      case "studio-storage/truncate":
        return hasExactKeys(value, TRUNCATE_KEYS)
          && validCommandBase(value, value.type)
          && (value.target === "document" || value.target === "journal")
          && logicalOffset(value.byteLength);
      case "studio-storage/checkpoint-barrier":
        return hasExactKeys(value, CHECKPOINT_KEYS)
          && validCommandBase(value, value.type)
          && typeof value.checkpointId === "string"
          && value.checkpointId.length > 0
          && value.checkpointId.length
            <= STUDIO_STORAGE_WORKER_MAX_CHECKPOINT_ID_CHARS;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

const READY_KEYS = ["version", "type"] as const;
const CAPABILITY_RESULT_KEYS = [
  "version",
  "type",
  "requestSequence",
  "candidateSupported",
  "reason",
  "requiresOpenProbe",
  "limits",
] as const;
const STATE_KEYS = [
  "sessionEpoch",
  "revision",
  "dataByteLength",
  "journalByteLength",
  "sessionWrittenBytes",
] as const;
const OPENED_KEYS = [
  "version",
  "type",
  "requestSequence",
  "commandSequence",
  "documentId",
  ...STATE_KEYS,
] as const;
const READ_RESULT_KEYS = [
  "version",
  "type",
  "requestSequence",
  "sessionEpoch",
  "revision",
  "source",
  "globalByteOffset",
  "data",
] as const;
const COMMAND_RESULT_KEYS = [
  "version",
  "type",
  "requestSequence",
  "commandSequence",
  "operation",
  ...STATE_KEYS,
] as const;
const CHECKPOINT_RESULT_KEYS = [
  "version",
  "type",
  "requestSequence",
  "commandSequence",
  "checkpointId",
  ...STATE_KEYS,
] as const;
const ERROR_KEYS = [
  "version",
  "type",
  "requestSequence",
  "commandSequence",
  "sessionEpoch",
  "error",
] as const;
const ERROR_ENVELOPE_KEYS = [
  "code",
  "message",
  "recoverable",
] as const;
const CAPABILITY_LIMIT_KEYS = [
  "maxRangeBytes",
  "maxJournalAppendBytes",
  "maxJournalBytes",
  "maxSessionWriteBytes",
  "maxLogicalBytes",
  "defaultShardBytes",
] as const;

const ERROR_CODE_SET: ReadonlySet<string> = new Set(
  STUDIO_STORAGE_WORKER_ERROR_CODES,
);
const COMMAND_OPERATION_SET: ReadonlySet<string> = new Set([
  "write",
  "append-journal",
  "flush",
  "truncate",
  "close",
]);

function validState(value: Record<string, unknown>): boolean {
  return positiveSequence(value.sessionEpoch)
    && revision(value.revision)
    && logicalOffset(value.dataByteLength)
    && logicalOffset(value.journalByteLength)
    && typeof value.sessionWrittenBytes === "bigint"
    && value.sessionWrittenBytes >= BigInt(0)
    && value.sessionWrittenBytes <= STUDIO_STORAGE_WORKER_MAX_SESSION_WRITE_BYTES;
}

export function isStudioStorageWorkerResponse(
  value: unknown,
): value is StudioStorageWorkerResponse {
  try {
    if (!isRecord(value)) return false;
    switch (value.type) {
      case "studio-storage/ready":
        return hasExactKeys(value, READY_KEYS)
          && value.version === STUDIO_STORAGE_WORKER_PROTOCOL_VERSION;
      case "studio-storage/capability-result":
        return hasExactKeys(value, CAPABILITY_RESULT_KEYS)
          && validBase(value, value.type)
          && typeof value.candidateSupported === "boolean"
          && (
            value.reason === "available"
            || value.reason === "not-dedicated-worker"
            || value.reason === "opfs-unavailable"
          )
          && value.requiresOpenProbe === true
          && isRecord(value.limits)
          && hasExactKeys(value.limits, CAPABILITY_LIMIT_KEYS)
          && value.limits.maxRangeBytes
            === STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES
          && value.limits.maxJournalAppendBytes
            === STUDIO_STORAGE_WORKER_MAX_JOURNAL_APPEND_BYTES
          && value.limits.maxJournalBytes
            === STUDIO_STORAGE_WORKER_MAX_JOURNAL_BYTES
          && value.limits.maxSessionWriteBytes
            === STUDIO_STORAGE_WORKER_MAX_SESSION_WRITE_BYTES
          && value.limits.maxLogicalBytes
            === STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES
          && value.limits.defaultShardBytes
            === STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES;
      case "studio-storage/opened":
        return hasExactKeys(value, OPENED_KEYS)
          && validBase(value, value.type)
          && positiveSequence(value.commandSequence)
          && typeof value.documentId === "string"
          && value.documentId.length > 0
          && validState(value);
      case "studio-storage/read-result":
        return hasExactKeys(value, READ_RESULT_KEYS)
          && validBase(value, value.type)
          && positiveSequence(value.sessionEpoch)
          && revision(value.revision)
          && (value.source === "document" || value.source === "journal")
          && logicalOffset(value.globalByteOffset)
          && value.data instanceof ArrayBuffer
          && value.data.byteLength <= STUDIO_STORAGE_WORKER_MAX_RANGE_BYTES;
      case "studio-storage/command-result":
        return hasExactKeys(value, COMMAND_RESULT_KEYS)
          && validBase(value, value.type)
          && positiveSequence(value.commandSequence)
          && typeof value.operation === "string"
          && COMMAND_OPERATION_SET.has(value.operation)
          && validState(value);
      case "studio-storage/checkpointed":
        return hasExactKeys(value, CHECKPOINT_RESULT_KEYS)
          && validBase(value, value.type)
          && positiveSequence(value.commandSequence)
          && typeof value.checkpointId === "string"
          && value.checkpointId.length > 0
          && value.checkpointId.length
            <= STUDIO_STORAGE_WORKER_MAX_CHECKPOINT_ID_CHARS
          && validState(value);
      case "studio-storage/error":
        return hasExactKeys(value, ERROR_KEYS)
          && value.version === STUDIO_STORAGE_WORKER_PROTOCOL_VERSION
          && typeof value.requestSequence === "number"
          && Number.isSafeInteger(value.requestSequence)
          && value.requestSequence >= 0
          && (
            value.commandSequence === null
            || positiveSequence(value.commandSequence)
          )
          && (
            value.sessionEpoch === null
            || positiveSequence(value.sessionEpoch)
          )
          && isRecord(value.error)
          && hasExactKeys(value.error, ERROR_ENVELOPE_KEYS)
          && typeof value.error.code === "string"
          && ERROR_CODE_SET.has(value.error.code)
          && typeof value.error.message === "string"
          && value.error.message.length > 0
          && value.error.message.length
            <= STUDIO_STORAGE_WORKER_MAX_ERROR_MESSAGE_CHARS
          && typeof value.error.recoverable === "boolean";
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export function studioStorageWorkerRequestTransfers(
  request: StudioStorageWorkerRequest,
): Transferable[] {
  if (
    request.type === "studio-storage/write"
    || request.type === "studio-storage/append-journal"
  ) {
    return [request.data];
  }
  return [];
}

export function studioStorageWorkerResponseTransfers(
  response: StudioStorageWorkerResponse,
): Transferable[] {
  return response.type === "studio-storage/read-result"
    ? [response.data]
    : [];
}

export function studioStorageWorkerError(input: {
  readonly requestSequence?: number;
  readonly commandSequence?: number | null;
  readonly sessionEpoch?: number | null;
  readonly code: StudioStorageWorkerErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
}): StudioStorageWorkerErrorResponse {
  const message = input.message.length === 0
    ? "Storage Worker 요청을 처리하지 못했습니다."
    : input.message.slice(0, STUDIO_STORAGE_WORKER_MAX_ERROR_MESSAGE_CHARS);
  return {
    version: STUDIO_STORAGE_WORKER_PROTOCOL_VERSION,
    type: "studio-storage/error",
    requestSequence:
      typeof input.requestSequence === "number"
      && Number.isSafeInteger(input.requestSequence)
      && input.requestSequence > 0
        ? input.requestSequence
        : 0,
    commandSequence:
      typeof input.commandSequence === "number"
      && Number.isSafeInteger(input.commandSequence)
      && input.commandSequence > 0
        ? input.commandSequence
        : null,
    sessionEpoch:
      typeof input.sessionEpoch === "number"
      && Number.isSafeInteger(input.sessionEpoch)
      && input.sessionEpoch > 0
        ? input.sessionEpoch
        : null,
    error: {
      code: input.code,
      message,
      recoverable: input.recoverable,
    },
  };
}

/**
 * Correlation fields are extracted from a malformed envelope only for an error
 * response; they never make that envelope admissible.
 */
export function studioStorageWorkerLooseCorrelation(value: unknown): {
  readonly requestSequence: number;
  readonly commandSequence: number | null;
  readonly sessionEpoch: number | null;
} {
  if (!isRecord(value)) {
    return {
      requestSequence: 0,
      commandSequence: null,
      sessionEpoch: null,
    };
  }
  return {
    requestSequence: positiveSequence(value.requestSequence)
      ? value.requestSequence
      : 0,
    commandSequence: positiveSequence(value.commandSequence)
      ? value.commandSequence
      : null,
    sessionEpoch: positiveSequence(value.sessionEpoch)
      ? value.sessionEpoch
      : (
          isRecord(value.session) && positiveSequence(value.session.sessionEpoch)
            ? value.session.sessionEpoch
            : null
        ),
  };
}
