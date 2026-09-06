/**
 * Product-agnostic command journal for Studio mutation adapters.
 *
 * This module records JSON-safe command/inverse pairs, but deliberately knows nothing about
 * canvases, pages, layers, CRDTs, or any other product state. Consumers turn a replay plan into
 * mutations and are responsible for atomically snapshotting application state at compaction.
 */

export const STUDIO_COMMAND_JOURNAL_FORMAT = "toonspectrum:studio-command-journal" as const;
export const STUDIO_COMMAND_JOURNAL_VERSION = 1 as const;

const CHECKSUM_PREFIX = "scj1-";
const CHECKSUM_PATTERN = /^scj1-[0-9a-f]{16}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const SAFE_KIND_PATTERN = /^[A-Za-z][A-Za-z0-9._:@/-]*$/u;
const MAX_ID_LENGTH = 160;
const MAX_KIND_LENGTH = 160;
const HARD_MAX_SERIALIZED_BYTES = 64 * 1024 * 1024;
const IDENTITY_FILTER_BYTE_LENGTH = 8 * 1024;
const IDENTITY_FILTER_HEX_LENGTH = IDENTITY_FILTER_BYTE_LENGTH * 2;
const IDENTITY_FILTER_PATTERN = new RegExp(
  `^[0-9a-f]{${IDENTITY_FILTER_HEX_LENGTH}}$`,
  "u",
);
const TEXT_ENCODER = new TextEncoder();

export type StudioCommandJsonPrimitive = null | boolean | number | string;
export type StudioCommandJsonValue =
  | StudioCommandJsonPrimitive
  | readonly StudioCommandJsonValue[]
  | { readonly [key: string]: StudioCommandJsonValue };

export type StudioCommandExtensionMetadata = Readonly<{
  [key: string]: StudioCommandJsonValue;
}>;

export type StudioCommandJournalErrorCode =
  | "INVALID_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_ID"
  | "INVALID_KIND"
  | "INVALID_LAMPORT"
  | "INVALID_ENVELOPE"
  | "DUPLICATE_CONFLICT"
  | "LAMPORT_REGRESSION"
  | "ACTOR_LIMIT_EXCEEDED"
  | "JOURNAL_LIMIT_EXCEEDED"
  | "TRANSACTION_ALREADY_ACTIVE"
  | "TRANSACTION_REUSED"
  | "TRANSACTION_NOT_ACTIVE"
  | "TRANSACTION_MISMATCH"
  | "EMPTY_TRANSACTION"
  | "GROUP_REOPENED"
  | "UNDO_EMPTY"
  | "REDO_EMPTY"
  | "UNDO_GROUP_MISMATCH"
  | "REDO_GROUP_MISMATCH"
  | "CORRUPT_PAYLOAD"
  | "CORRUPT_RECORD"
  | "CORRUPT_CHAIN"
  | "CORRUPT_CHECKPOINT"
  | "CORRUPT_SERIALIZATION"
  | "UNSUPPORTED_VERSION"
  | "INVALID_COMPACTION";

/** Stable, machine-readable journal failure. All rejected writes leave the journal unchanged. */
export class StudioCommandJournalError extends Error {
  readonly code: StudioCommandJournalErrorCode;
  readonly recordId: string | null;
  readonly path: string | null;

  constructor(
    code: StudioCommandJournalErrorCode,
    message: string,
    options: { readonly recordId?: string; readonly path?: string } = {},
  ) {
    super(message);
    this.name = "StudioCommandJournalError";
    this.code = code;
    this.recordId = options.recordId ?? null;
    this.path = options.path ?? null;
  }
}

function journalError(
  code: StudioCommandJournalErrorCode,
  message: string,
  options?: { readonly recordId?: string; readonly path?: string },
): never {
  throw new StudioCommandJournalError(code, message, options);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return (
    ownKeys.length === keys.length
    && ownKeys.every((key) => typeof key === "string")
    && keys.every((key) => Object.hasOwn(value, key))
  );
}

function canonicalJsonValue(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
  depth: number,
): string {
  if (depth > 64) {
    journalError("INVALID_JSON", "Command JSON nesting exceeds the supported depth.", { path });
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      journalError("INVALID_JSON", "Command JSON numbers must be finite.", { path });
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    journalError("INVALID_JSON", "Command data must contain only JSON-safe values.", { path });
  }
  if (ancestors.has(value)) {
    journalError("INVALID_JSON", "Command data must not contain cycles.", { path });
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (key === "length") continue;
        if (
          typeof key !== "string"
          || !/^(?:0|[1-9][0-9]*)$/u.test(key)
          || Number(key) >= value.length
        ) {
          journalError("INVALID_JSON", "Command JSON arrays must not have custom properties.", {
            path,
          });
        }
      }
      const serialized: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          journalError("INVALID_JSON", "Sparse arrays are not valid command data.", {
            path: `${path}[${index}]`,
          });
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          journalError("INVALID_JSON", "Accessors are not valid command data.", {
            path: `${path}[${index}]`,
          });
        }
        serialized.push(
          canonicalJsonValue(descriptor.value, `${path}[${index}]`, ancestors, depth + 1),
        );
      }
      return `[${serialized.join(",")}]`;
    }

    if (!isPlainRecord(value)) {
      journalError("INVALID_JSON", "Command JSON objects must use a plain or null prototype.", {
        path,
      });
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      journalError("INVALID_JSON", "Symbol keys are not valid command data.", { path });
    }
    const keys = (ownKeys as string[]).sort();
    const serialized: string[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        journalError("INVALID_JSON", "Accessors and hidden properties are not valid command data.", {
          path: `${path}.${key}`,
        });
      }
      serialized.push(
        `${JSON.stringify(key)}:${canonicalJsonValue(
          descriptor.value,
          `${path}.${key}`,
          ancestors,
          depth + 1,
        )}`,
      );
    }
    return `{${serialized.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * RFC-8259-compatible canonical JSON with sorted object keys.
 *
 * It also rejects values JSON.stringify would silently coerce or discard (NaN, holes, undefined,
 * getters, symbols, custom prototypes, and cycles), keeping checksum inputs fail-closed.
 */
export function canonicalStudioCommandJson(
  value: unknown,
  maxBytes = HARD_MAX_SERIALIZED_BYTES,
): string {
  const canonical = canonicalJsonValue(value, "$", new WeakSet(), 0);
  const byteLength = TEXT_ENCODER.encode(canonical).byteLength;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || byteLength > maxBytes) {
    journalError("PAYLOAD_TOO_LARGE", "Command JSON exceeds its configured byte budget.");
  }
  return canonical;
}

function checksumText(value: string): string {
  const bytes = TEXT_ENCODER.encode(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 0x01000193);
    second = Math.imul(second ^ byte, 0x85ebca6b);
    second ^= second >>> 13;
  }
  const firstHex = (first >>> 0).toString(16).padStart(8, "0");
  const secondHex = (second >>> 0).toString(16).padStart(8, "0");
  return `${CHECKSUM_PREFIX}${firstHex}${secondHex}`;
}

function checksumJson(value: unknown, maxBytes = HARD_MAX_SERIALIZED_BYTES): string {
  return checksumText(canonicalStudioCommandJson(value, maxBytes));
}

function decodeIdentityFilter(value?: string): Uint8Array {
  if (value === undefined) return new Uint8Array(IDENTITY_FILTER_BYTE_LENGTH);
  const bytes = new Uint8Array(IDENTITY_FILTER_BYTE_LENGTH);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function encodeIdentityFilter(bytes: Uint8Array): string {
  let encoded = "";
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, "0");
  return encoded;
}

function identityFilterPositions(identity: string): readonly number[] {
  const digest = checksumText(identity).slice(CHECKSUM_PREFIX.length);
  const first = Number.parseInt(digest.slice(0, 8), 16) >>> 0;
  const second = (Number.parseInt(digest.slice(8), 16) | 1) >>> 0;
  const bitLength = IDENTITY_FILTER_BYTE_LENGTH * 8;
  return Object.freeze([
    first % bitLength,
    ((first + second) >>> 0) % bitLength,
    ((first + Math.imul(second, 2)) >>> 0) % bitLength,
    ((first + Math.imul(second, 3)) >>> 0) % bitLength,
  ]);
}

function addIdentityToFilter(bytes: Uint8Array, identity: string): void {
  for (const position of identityFilterPositions(identity)) {
    const byteIndex = Math.floor(position / 8);
    bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (position % 8));
  }
}

function identityFilterMayContain(filter: string | undefined, identity: string): boolean {
  if (!filter) return false;
  const bytes = decodeIdentityFilter(filter);
  return identityFilterPositions(identity).every((position) => {
    const byte = bytes[Math.floor(position / 8)] ?? 0;
    return (byte & (1 << (position % 8))) !== 0;
  });
}

export function studioCommandPayloadChecksum(payload: StudioCommandJsonValue): string {
  return checksumJson(payload);
}

export const STUDIO_COMMAND_JOURNAL_GENESIS_CHECKSUM = checksumJson({
  format: STUDIO_COMMAND_JOURNAL_FORMAT,
  chain: "genesis",
});

export const STUDIO_COMMAND_REPLAY_GENESIS_CHECKSUM = checksumJson({
  format: STUDIO_COMMAND_JOURNAL_FORMAT,
  replay: "genesis",
});

function assertChecksum(value: unknown, code: StudioCommandJournalErrorCode, path: string): string {
  if (typeof value !== "string" || !CHECKSUM_PATTERN.test(value)) {
    journalError(code, "Journal checksum has an invalid shape.", { path });
  }
  return value;
}

function deepFreezeJson<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function cloneJson<T extends StudioCommandJsonValue>(
  value: T,
  maxBytes: number,
): T {
  const canonical = canonicalStudioCommandJson(value, maxBytes);
  return deepFreezeJson(JSON.parse(canonical) as T);
}

function normalizeExtensions(
  value: StudioCommandExtensionMetadata | undefined,
  maxBytes: number,
  path = "$.extensions",
): StudioCommandExtensionMetadata {
  const source = value ?? {};
  if (!isPlainRecord(source)) {
    journalError("INVALID_JSON", "Extension metadata must be a JSON object.", { path });
  }
  return cloneJson(source as StudioCommandExtensionMetadata, maxBytes);
}

function assertSafeId(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MAX_ID_LENGTH
    || !SAFE_ID_PATTERN.test(value)
  ) {
    journalError("INVALID_ID", "Journal identifiers must use the stable safe-ID format.", { path });
  }
  return value;
}

function assertKind(value: unknown, path: string): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > MAX_KIND_LENGTH
    || !SAFE_KIND_PATTERN.test(value)
  ) {
    journalError("INVALID_KIND", "Command kinds must use the stable safe-kind format.", { path });
  }
  return value;
}

function assertLamport(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    journalError("INVALID_LAMPORT", "Lamport values must be non-negative safe integers.", { path });
  }
  return value as number;
}

export interface StudioCommandOperation<
  TKind extends string = string,
  TPayload extends StudioCommandJsonValue = StudioCommandJsonValue,
> {
  readonly kind: TKind;
  readonly payload: TPayload;
  readonly payloadChecksum: string;
}

export interface StudioCommandOperationInput<
  TKind extends string = string,
  TPayload extends StudioCommandJsonValue = StudioCommandJsonValue,
> {
  readonly kind: TKind;
  readonly payload: TPayload;
}

export interface StudioCommandEnvelope<
  TCommand extends StudioCommandOperation = StudioCommandOperation,
  TInverse extends StudioCommandOperation = StudioCommandOperation,
> {
  readonly version: typeof STUDIO_COMMAND_JOURNAL_VERSION;
  readonly recordType: "command";
  readonly id: string;
  readonly actorId: string;
  readonly lamport: number;
  readonly transactionId: string | null;
  readonly groupId: string;
  readonly command: TCommand;
  readonly inverse: TInverse;
  readonly extensions: StudioCommandExtensionMetadata;
}

export interface StudioCommandEnvelopeInput<
  TCommand extends StudioCommandOperationInput = StudioCommandOperationInput,
  TInverse extends StudioCommandOperationInput = StudioCommandOperationInput,
> {
  readonly id: string;
  readonly actorId: string;
  readonly lamport: number;
  readonly transactionId: string | null;
  readonly groupId: string;
  readonly command: TCommand;
  readonly inverse: TInverse;
  readonly extensions?: StudioCommandExtensionMetadata;
}

function normalizeOperation(
  value: unknown,
  maxPayloadBytes: number,
  path: string,
): StudioCommandOperation {
  if (!isPlainRecord(value)) {
    journalError("INVALID_ENVELOPE", "Command operation must be an object.", { path });
  }
  const keys = Object.hasOwn(value, "payloadChecksum")
    ? ["kind", "payload", "payloadChecksum"]
    : ["kind", "payload"];
  if (!hasExactKeys(value, keys)) {
    journalError("INVALID_ENVELOPE", "Command operation has unexpected fields.", { path });
  }
  const kind = assertKind(value.kind, `${path}.kind`);
  const payload = cloneJson(
    value.payload as StudioCommandJsonValue,
    maxPayloadBytes,
  );
  const payloadChecksum = studioCommandPayloadChecksum(payload);
  if (
    Object.hasOwn(value, "payloadChecksum")
    && value.payloadChecksum !== payloadChecksum
  ) {
    journalError("CORRUPT_PAYLOAD", "Command payload checksum does not match its content.", {
      path: `${path}.payloadChecksum`,
    });
  }
  return deepFreezeJson({ kind, payload, payloadChecksum });
}

function normalizeEnvelope(
  value: unknown,
  maxPayloadBytes: number,
): StudioCommandEnvelope {
  if (!isPlainRecord(value)) {
    journalError("INVALID_ENVELOPE", "Command envelope must be an object.");
  }
  const isCreatedEnvelope = Object.hasOwn(value, "version");
  const expectedKeys = isCreatedEnvelope
    ? [
        "version",
        "recordType",
        "id",
        "actorId",
        "lamport",
        "transactionId",
        "groupId",
        "command",
        "inverse",
        "extensions",
      ]
    : [
        "id",
        "actorId",
        "lamport",
        "transactionId",
        "groupId",
        "command",
        "inverse",
        "extensions",
      ];
  const optionalExtensionsKeys = expectedKeys.filter((key) => key !== "extensions");
  if (!hasExactKeys(value, expectedKeys) && !hasExactKeys(value, optionalExtensionsKeys)) {
    journalError("INVALID_ENVELOPE", "Command envelope has unexpected fields.");
  }
  if (
    isCreatedEnvelope
    && (
      value.version !== STUDIO_COMMAND_JOURNAL_VERSION
      || value.recordType !== "command"
    )
  ) {
    journalError("UNSUPPORTED_VERSION", "Command envelope version is not supported.");
  }
  const transactionId = value.transactionId === null
    ? null
    : assertSafeId(value.transactionId, "$.transactionId");
  const envelope: StudioCommandEnvelope = {
    version: STUDIO_COMMAND_JOURNAL_VERSION,
    recordType: "command",
    id: assertSafeId(value.id, "$.id"),
    actorId: assertSafeId(value.actorId, "$.actorId"),
    lamport: assertLamport(value.lamport, "$.lamport"),
    transactionId,
    groupId: assertSafeId(value.groupId, "$.groupId"),
    command: normalizeOperation(value.command, maxPayloadBytes, "$.command"),
    inverse: normalizeOperation(value.inverse, maxPayloadBytes, "$.inverse"),
    extensions: normalizeExtensions(
      value.extensions as StudioCommandExtensionMetadata | undefined,
      maxPayloadBytes,
    ),
  };
  return deepFreezeJson(envelope);
}

export function createStudioCommandEnvelope<
  TCommand extends StudioCommandOperationInput,
  TInverse extends StudioCommandOperationInput,
>(
  input: StudioCommandEnvelopeInput<TCommand, TInverse>,
): StudioCommandEnvelope<
  StudioCommandOperation<TCommand["kind"], TCommand["payload"]>,
  StudioCommandOperation<TInverse["kind"], TInverse["payload"]>
> {
  return normalizeEnvelope(input, DEFAULT_STUDIO_COMMAND_JOURNAL_LIMITS.maxPayloadBytes) as
    StudioCommandEnvelope<
      StudioCommandOperation<TCommand["kind"], TCommand["payload"]>,
      StudioCommandOperation<TInverse["kind"], TInverse["payload"]>
    >;
}

export type StudioCommandJournalRecordType =
  | "transaction-begin"
  | "command"
  | "transaction-commit"
  | "transaction-abort"
  | "undo"
  | "redo";

interface StudioCommandJournalRecordBase {
  readonly version: typeof STUDIO_COMMAND_JOURNAL_VERSION;
  readonly recordType: StudioCommandJournalRecordType;
  readonly sequence: number;
  readonly id: string;
  readonly actorId: string;
  readonly lamport: number;
  readonly transactionId: string | null;
  readonly groupId: string;
  readonly extensions: StudioCommandExtensionMetadata;
  readonly idempotencyChecksum: string;
  readonly previousChecksum: string;
  readonly recordChecksum: string;
}

export interface StudioCommandEffect {
  readonly sourceCommandId: string;
  readonly kind: string;
  readonly payload: StudioCommandJsonValue;
  readonly payloadChecksum: string;
}

export interface StudioCommandRecord extends StudioCommandJournalRecordBase {
  readonly recordType: "command";
  readonly command: StudioCommandOperation;
  readonly inverse: StudioCommandOperation;
}

export interface StudioCommandTransactionBeginRecord extends StudioCommandJournalRecordBase {
  readonly recordType: "transaction-begin";
  readonly transactionId: string;
}

export interface StudioCommandTransactionCommitRecord extends StudioCommandJournalRecordBase {
  readonly recordType: "transaction-commit";
  readonly transactionId: string;
}

export interface StudioCommandTransactionAbortRecord extends StudioCommandJournalRecordBase {
  readonly recordType: "transaction-abort";
  readonly transactionId: string;
}

export interface StudioCommandUndoRecord extends StudioCommandJournalRecordBase {
  readonly recordType: "undo";
  readonly transactionId: null;
  readonly operations: readonly StudioCommandEffect[];
}

export interface StudioCommandRedoRecord extends StudioCommandJournalRecordBase {
  readonly recordType: "redo";
  readonly transactionId: null;
  readonly operations: readonly StudioCommandEffect[];
}

export type StudioCommandJournalRecord =
  | StudioCommandTransactionBeginRecord
  | StudioCommandRecord
  | StudioCommandTransactionCommitRecord
  | StudioCommandTransactionAbortRecord
  | StudioCommandUndoRecord
  | StudioCommandRedoRecord;

export interface StudioCommandRecordMetadataInput {
  readonly id: string;
  readonly actorId: string;
  readonly lamport: number;
  readonly transactionId: string;
  readonly groupId: string;
  readonly extensions?: StudioCommandExtensionMetadata;
}

export interface StudioCommandUndoRedoInput {
  readonly id: string;
  readonly actorId: string;
  readonly lamport: number;
  readonly groupId: string;
  readonly extensions?: StudioCommandExtensionMetadata;
}

export interface StudioCommandJournalLimits {
  readonly maxRecords: number;
  readonly maxIdempotencyKeys: number;
  readonly maxActors: number;
  readonly maxPayloadBytes: number;
  readonly maxSerializedBytes: number;
}

export const DEFAULT_STUDIO_COMMAND_JOURNAL_LIMITS: StudioCommandJournalLimits =
  Object.freeze({
    maxRecords: 2_048,
    maxIdempotencyKeys: 4_096,
    maxActors: 256,
    maxPayloadBytes: 1024 * 1024,
    maxSerializedBytes: 16 * 1024 * 1024,
  });

export interface StudioCommandJournalOptions {
  readonly limits?: Partial<StudioCommandJournalLimits>;
  readonly extensions?: StudioCommandExtensionMetadata;
}

function normalizeLimit(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    journalError("INVALID_ENVELOPE", "Journal limit is outside the supported range.", { path });
  }
  return value as number;
}

function normalizeLimits(
  value: Partial<StudioCommandJournalLimits> | undefined,
): StudioCommandJournalLimits {
  const limits = value ?? {};
  return Object.freeze({
    maxRecords: normalizeLimit(
      limits.maxRecords,
      DEFAULT_STUDIO_COMMAND_JOURNAL_LIMITS.maxRecords,
      4,
      100_000,
      "$.limits.maxRecords",
    ),
    maxIdempotencyKeys: normalizeLimit(
      limits.maxIdempotencyKeys,
      DEFAULT_STUDIO_COMMAND_JOURNAL_LIMITS.maxIdempotencyKeys,
      1,
      200_000,
      "$.limits.maxIdempotencyKeys",
    ),
    maxActors: normalizeLimit(
      limits.maxActors,
      DEFAULT_STUDIO_COMMAND_JOURNAL_LIMITS.maxActors,
      1,
      10_000,
      "$.limits.maxActors",
    ),
    maxPayloadBytes: normalizeLimit(
      limits.maxPayloadBytes,
      DEFAULT_STUDIO_COMMAND_JOURNAL_LIMITS.maxPayloadBytes,
      128,
      16 * 1024 * 1024,
      "$.limits.maxPayloadBytes",
    ),
    maxSerializedBytes: normalizeLimit(
      limits.maxSerializedBytes,
      DEFAULT_STUDIO_COMMAND_JOURNAL_LIMITS.maxSerializedBytes,
      1024,
      HARD_MAX_SERIALIZED_BYTES,
      "$.limits.maxSerializedBytes",
    ),
  });
}

interface NormalizedMetadata {
  readonly id: string;
  readonly actorId: string;
  readonly lamport: number;
  readonly transactionId: string;
  readonly groupId: string;
  readonly extensions: StudioCommandExtensionMetadata;
}

interface NormalizedUndoRedoMetadata {
  readonly id: string;
  readonly actorId: string;
  readonly lamport: number;
  readonly transactionId: null;
  readonly groupId: string;
  readonly extensions: StudioCommandExtensionMetadata;
}

function normalizeMetadata(
  input: StudioCommandRecordMetadataInput,
  maxPayloadBytes: number,
): NormalizedMetadata {
  if (!isPlainRecord(input)) {
    journalError("INVALID_ENVELOPE", "Transaction metadata must be an object.");
  }
  const keys = ["id", "actorId", "lamport", "transactionId", "groupId", "extensions"];
  if (!hasExactKeys(input, keys) && !hasExactKeys(input, keys.slice(0, -1))) {
    journalError("INVALID_ENVELOPE", "Transaction metadata has unexpected fields.");
  }
  return deepFreezeJson({
    id: assertSafeId(input.id, "$.id"),
    actorId: assertSafeId(input.actorId, "$.actorId"),
    lamport: assertLamport(input.lamport, "$.lamport"),
    transactionId: assertSafeId(input.transactionId, "$.transactionId"),
    groupId: assertSafeId(input.groupId, "$.groupId"),
    extensions: normalizeExtensions(input.extensions, maxPayloadBytes),
  });
}

function normalizeUndoRedoMetadata(
  input: StudioCommandUndoRedoInput,
  maxPayloadBytes: number,
): NormalizedUndoRedoMetadata {
  if (!isPlainRecord(input)) {
    journalError("INVALID_ENVELOPE", "Undo/redo metadata must be an object.");
  }
  const keys = ["id", "actorId", "lamport", "groupId", "extensions"];
  if (!hasExactKeys(input, keys) && !hasExactKeys(input, keys.slice(0, -1))) {
    journalError("INVALID_ENVELOPE", "Undo/redo metadata has unexpected fields.");
  }
  return deepFreezeJson({
    id: assertSafeId(input.id, "$.id"),
    actorId: assertSafeId(input.actorId, "$.actorId"),
    lamport: assertLamport(input.lamport, "$.lamport"),
    transactionId: null,
    groupId: assertSafeId(input.groupId, "$.groupId"),
    extensions: normalizeExtensions(input.extensions, maxPayloadBytes),
  });
}

export type StudioCommandAppendResult<TRecord extends StudioCommandJournalRecord> =
  | Readonly<{ status: "appended"; record: TRecord }>
  | Readonly<{
      status: "duplicate";
      record: TRecord | null;
      sequence: number;
      compacted: boolean;
    }>;

export interface StudioCommandIdempotencyEntry {
  readonly id: string;
  readonly recordType: StudioCommandJournalRecordType;
  readonly requestChecksum: string;
  readonly sequence: number;
}

export interface StudioCommandActorLamport {
  readonly actorId: string;
  readonly lamport: number;
}

export interface StudioCommandJournalCheckpoint<
  TState extends StudioCommandJsonValue = StudioCommandJsonValue,
> {
  readonly version: typeof STUDIO_COMMAND_JOURNAL_VERSION;
  readonly id: string;
  readonly upToSequence: number;
  readonly compactedHeadChecksum: string;
  readonly previousCheckpointChecksum: string | null;
  readonly actorLamports: readonly StudioCommandActorLamport[];
  readonly idempotency: readonly StudioCommandIdempotencyEntry[];
  /** Fixed-size, false-negative-free filter for identities older than exact retry retention. */
  readonly identityFilter: string;
  readonly replayChecksum: string;
  readonly state: TState;
  readonly stateChecksum: string;
  readonly extensions: StudioCommandExtensionMetadata;
  readonly checkpointChecksum: string;
}

export interface StudioCommandCheckpointInput<
  TState extends StudioCommandJsonValue = StudioCommandJsonValue,
> {
  readonly id: string;
  readonly state: TState;
  readonly extensions?: StudioCommandExtensionMetadata;
}

export interface StudioCommandReplayBatch {
  readonly mode: "apply" | "undo" | "redo";
  readonly actorId: string;
  readonly groupId: string;
  readonly transactionId: string | null;
  readonly sequence: number;
  readonly operations: readonly StudioCommandEffect[];
}

export interface StudioCommandReplayPlan<
  TState extends StudioCommandJsonValue = StudioCommandJsonValue,
> {
  readonly checkpoint: StudioCommandJournalCheckpoint<TState> | null;
  readonly batches: readonly StudioCommandReplayBatch[];
  readonly headChecksum: string;
  readonly replayChecksum: string;
  readonly recordCount: number;
  readonly nextSequence: number;
}

/**
 * Runtime verification counters.
 *
 * Full scans remain the trust boundary for restore/replay/compaction. Normal appends advance the
 * already-verified frontier by exactly one record, so this also gives performance tests a stable
 * way to prove that pointer-heavy command streams do not accidentally regress to O(n²) rescans.
 */
export interface StudioCommandJournalVerificationStats {
  readonly fullScanCount: number;
  readonly incrementalRecordCount: number;
}

interface SeenRecord {
  readonly id: string;
  readonly recordType: StudioCommandJournalRecordType;
  readonly requestChecksum: string;
  readonly sequence: number;
  readonly record: StudioCommandJournalRecord | null;
}

interface TransactionState {
  readonly transactionId: string;
  readonly actorId: string;
  readonly groupId: string;
  readonly commands: readonly StudioCommandRecord[];
}

interface GroupState {
  readonly actorId: string;
  readonly groupId: string;
  readonly transactionId: string | null;
  readonly commands: readonly StudioCommandRecord[];
}

interface ScanState {
  readonly headChecksum: string;
  readonly nextSequence: number;
  readonly replayChecksum: string;
  readonly actorLamports: ReadonlyMap<string, number>;
  readonly seen: ReadonlyMap<string, SeenRecord>;
  readonly openTransactions: ReadonlyMap<string, TransactionState>;
  readonly openByActor: ReadonlyMap<string, string>;
  readonly undoByActor: ReadonlyMap<string, readonly GroupState[]>;
  readonly redoByActor: ReadonlyMap<string, readonly GroupState[]>;
  readonly usedGroups: ReadonlySet<string>;
  readonly closedGroups: ReadonlySet<string>;
  readonly usedTransactionIds: ReadonlySet<string>;
  readonly lastCreatedGroupByActor: ReadonlyMap<string, string>;
  readonly batches: readonly StudioCommandReplayBatch[];
}

function groupKey(actorId: string, groupId: string): string {
  return JSON.stringify([actorId, groupId]);
}

function requestBody(
  recordType: StudioCommandJournalRecordType,
  value: {
    readonly id: string;
    readonly actorId: string;
    readonly lamport: number;
    readonly transactionId: string | null;
    readonly groupId: string;
    readonly extensions: StudioCommandExtensionMetadata;
  },
  command?: StudioCommandOperation,
  inverse?: StudioCommandOperation,
): StudioCommandJsonValue {
  const body: Record<string, StudioCommandJsonValue> = {
    version: STUDIO_COMMAND_JOURNAL_VERSION,
    recordType,
    id: value.id,
    actorId: value.actorId,
    lamport: value.lamport,
    transactionId: value.transactionId,
    groupId: value.groupId,
    extensions: value.extensions,
  };
  if (recordType === "command" && command && inverse) {
    body.command = command as unknown as StudioCommandJsonValue;
    body.inverse = inverse as unknown as StudioCommandJsonValue;
  }
  return body;
}

function requestChecksum(
  recordType: StudioCommandJournalRecordType,
  value: {
    readonly id: string;
    readonly actorId: string;
    readonly lamport: number;
    readonly transactionId: string | null;
    readonly groupId: string;
    readonly extensions: StudioCommandExtensionMetadata;
  },
  command?: StudioCommandOperation,
  inverse?: StudioCommandOperation,
): string {
  return checksumJson(requestBody(recordType, value, command, inverse));
}

function recordBody(record: Omit<StudioCommandJournalRecord, "recordChecksum">): StudioCommandJsonValue {
  return record as unknown as StudioCommandJsonValue;
}

function calculateRecordChecksum(
  record:
    | StudioCommandJournalRecord
    | Omit<StudioCommandJournalRecord, "recordChecksum">,
): string {
  if (Object.hasOwn(record, "recordChecksum")) {
    const {
      recordChecksum: _recordChecksum,
      ...withoutChecksum
    } = record as StudioCommandJournalRecord;
    return checksumJson(recordBody(withoutChecksum));
  }
  return checksumJson(recordBody(record));
}

function checkpointBody(
  checkpoint: Omit<StudioCommandJournalCheckpoint, "checkpointChecksum">,
): StudioCommandJsonValue {
  return checkpoint as unknown as StudioCommandJsonValue;
}

function calculateCheckpointChecksum(
  checkpoint: Omit<StudioCommandJournalCheckpoint, "checkpointChecksum">,
): string {
  return checksumJson(checkpointBody(checkpoint));
}

function commandEffect(
  command: StudioCommandRecord,
  direction: "command" | "inverse",
): StudioCommandEffect {
  const operation = direction === "command" ? command.command : command.inverse;
  return deepFreezeJson({
    sourceCommandId: command.id,
    kind: operation.kind,
    payload: operation.payload,
    payloadChecksum: operation.payloadChecksum,
  });
}

function batchChecksum(previous: string, batch: StudioCommandReplayBatch): string {
  return checksumJson({
    previous,
    batch: batch as unknown as StudioCommandJsonValue,
  });
}

function getActorStack(
  stacks: Map<string, GroupState[]>,
  actorId: string,
): GroupState[] {
  const existing = stacks.get(actorId);
  if (existing) return existing;
  const created: GroupState[] = [];
  stacks.set(actorId, created);
  return created;
}

function validateOperationChecksum(operation: StudioCommandOperation, path: string): void {
  if (studioCommandPayloadChecksum(operation.payload) !== operation.payloadChecksum) {
    journalError("CORRUPT_PAYLOAD", "Command payload checksum does not match its content.", { path });
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalStudioCommandJson(left) === canonicalStudioCommandJson(right);
}

function scanJournal(
  checkpoint: StudioCommandJournalCheckpoint | null,
  records: readonly StudioCommandJournalRecord[],
  limits: StudioCommandJournalLimits,
  verifiedPrefix?: ScanState,
): ScanState {
  if (!verifiedPrefix && records.length > limits.maxRecords) {
    journalError("JOURNAL_LIMIT_EXCEEDED", "Restored journal exceeds its configured record bound.");
  }

  const actorLamports = new Map<string, number>(
    verifiedPrefix?.actorLamports ?? [],
  );
  const seen = new Map<string, SeenRecord>(verifiedPrefix?.seen ?? []);
  const openTransactions = new Map<string, TransactionState>(
    verifiedPrefix?.openTransactions ?? [],
  );
  const openByActor = new Map<string, string>(verifiedPrefix?.openByActor ?? []);
  const undoByActor = new Map<string, GroupState[]>(
    [...(verifiedPrefix?.undoByActor ?? [])].map(([actorId, groups]) => [
      actorId,
      [...groups],
    ]),
  );
  const redoByActor = new Map<string, GroupState[]>(
    [...(verifiedPrefix?.redoByActor ?? [])].map(([actorId, groups]) => [
      actorId,
      [...groups],
    ]),
  );
  const usedGroups = new Set<string>(verifiedPrefix?.usedGroups ?? []);
  const closedGroups = new Set<string>(verifiedPrefix?.closedGroups ?? []);
  const usedTransactionIds = new Set<string>(
    verifiedPrefix?.usedTransactionIds ?? [],
  );
  const lastCreatedGroupByActor = new Map<string, string>(
    verifiedPrefix?.lastCreatedGroupByActor ?? [],
  );
  const batches: StudioCommandReplayBatch[] = [...(verifiedPrefix?.batches ?? [])];
  let previousChecksum = verifiedPrefix?.headChecksum
    ?? checkpoint?.checkpointChecksum
    ?? STUDIO_COMMAND_JOURNAL_GENESIS_CHECKSUM;
  let expectedSequence = verifiedPrefix?.nextSequence
    ?? ((checkpoint?.upToSequence ?? 0) + 1);
  let replayChecksum = verifiedPrefix?.replayChecksum
    ?? checkpoint?.replayChecksum
    ?? STUDIO_COMMAND_REPLAY_GENESIS_CHECKSUM;

  if (checkpoint && !verifiedPrefix) {
    for (const entry of checkpoint.actorLamports) {
      actorLamports.set(entry.actorId, entry.lamport);
    }
    for (const entry of checkpoint.idempotency) {
      seen.set(entry.id, {
        id: entry.id,
        recordType: entry.recordType,
        requestChecksum: entry.requestChecksum,
        sequence: entry.sequence,
        record: null,
      });
    }
  }

  const pushBatch = (batch: StudioCommandReplayBatch): void => {
    const frozen = deepFreezeJson(batch);
    batches.push(frozen);
    replayChecksum = batchChecksum(replayChecksum, frozen);
  };

  for (const record of records) {
    if (record.sequence !== expectedSequence || record.previousChecksum !== previousChecksum) {
      journalError("CORRUPT_CHAIN", "Journal sequence or previous checksum is discontinuous.", {
        recordId: record.id,
      });
    }
    if (calculateRecordChecksum(record) !== record.recordChecksum) {
      journalError("CORRUPT_RECORD", "Journal record checksum does not match its content.", {
        recordId: record.id,
      });
    }
    const expectedRequestChecksum = requestChecksum(
      record.recordType,
      record,
      record.recordType === "command" ? record.command : undefined,
      record.recordType === "command" ? record.inverse : undefined,
    );
    if (record.idempotencyChecksum !== expectedRequestChecksum) {
      journalError("CORRUPT_RECORD", "Journal idempotency checksum does not match its request.", {
        recordId: record.id,
      });
    }
    const duplicate = seen.get(record.id);
    if (duplicate) {
      journalError("DUPLICATE_CONFLICT", "A journal record ID appears more than once.", {
        recordId: record.id,
      });
    }
    if (
      identityFilterMayContain(checkpoint?.identityFilter, `record:${record.id}`)
      || identityFilterMayContain(checkpoint?.identityFilter, `checkpoint:${record.id}`)
    ) {
      journalError("DUPLICATE_CONFLICT", "Record identity may already exist before the checkpoint.", {
        recordId: record.id,
      });
    }
    const previousLamport = actorLamports.get(record.actorId);
    if (previousLamport !== undefined && record.lamport <= previousLamport) {
      journalError("LAMPORT_REGRESSION", "Actor Lamport values must increase monotonically.", {
        recordId: record.id,
      });
    }
    if (previousLamport === undefined && actorLamports.size >= limits.maxActors) {
      journalError("ACTOR_LIMIT_EXCEEDED", "Journal actor bound has been reached.", {
        recordId: record.id,
      });
    }
    actorLamports.set(record.actorId, record.lamport);
    seen.set(record.id, {
      id: record.id,
      recordType: record.recordType,
      requestChecksum: record.idempotencyChecksum,
      sequence: record.sequence,
      record,
    });

    if (record.recordType === "transaction-begin") {
      if (
        openByActor.has(record.actorId)
        || openTransactions.has(record.transactionId)
      ) {
        journalError("TRANSACTION_ALREADY_ACTIVE", "Transaction begin conflicts with an open transaction.", {
          recordId: record.id,
        });
      }
      const key = groupKey(record.actorId, record.groupId);
      if (
        usedTransactionIds.has(record.transactionId)
        || identityFilterMayContain(
          checkpoint?.identityFilter,
          `transaction:${record.transactionId}`,
        )
      ) {
        journalError("TRANSACTION_REUSED", "A transaction ID cannot be reused.", {
          recordId: record.id,
        });
      }
      if (usedGroups.has(key)) {
        journalError("GROUP_REOPENED", "A closed or open group ID cannot be reused.", {
          recordId: record.id,
        });
      }
      if (identityFilterMayContain(checkpoint?.identityFilter, `group:${key}`)) {
        journalError("GROUP_REOPENED", "A pre-checkpoint group ID cannot be reused.", {
          recordId: record.id,
        });
      }
      usedGroups.add(key);
      usedTransactionIds.add(record.transactionId);
      lastCreatedGroupByActor.set(record.actorId, record.groupId);
      openByActor.set(record.actorId, record.transactionId);
      openTransactions.set(record.transactionId, {
        transactionId: record.transactionId,
        actorId: record.actorId,
        groupId: record.groupId,
        commands: [],
      });
    } else if (record.recordType === "command") {
      validateOperationChecksum(record.command, `record:${record.id}.command`);
      validateOperationChecksum(record.inverse, `record:${record.id}.inverse`);
      if (record.transactionId !== null) {
        const transaction = openTransactions.get(record.transactionId);
        if (
          !transaction
          || transaction.actorId !== record.actorId
          || transaction.groupId !== record.groupId
          || openByActor.get(record.actorId) !== record.transactionId
        ) {
          journalError("TRANSACTION_MISMATCH", "Command does not match an open transaction.", {
            recordId: record.id,
          });
        }
        openTransactions.set(record.transactionId, {
          ...transaction,
          commands: [...transaction.commands, record],
        });
      } else {
        if (openByActor.has(record.actorId)) {
          journalError("TRANSACTION_MISMATCH", "Standalone command cannot bypass an open transaction.", {
            recordId: record.id,
          });
        }
        const key = groupKey(record.actorId, record.groupId);
        const undo = getActorStack(undoByActor, record.actorId);
        const current = undo.at(-1);
        if (usedGroups.has(key)) {
          if (
            closedGroups.has(key)
            ||
            current?.groupId !== record.groupId
            || current.transactionId !== null
            || lastCreatedGroupByActor.get(record.actorId) !== record.groupId
          ) {
            journalError("GROUP_REOPENED", "A non-contiguous command group cannot be reopened.", {
              recordId: record.id,
            });
          }
          undo[undo.length - 1] = {
            ...current,
            commands: [...current.commands, record],
          };
        } else {
          if (identityFilterMayContain(checkpoint?.identityFilter, `group:${key}`)) {
            journalError("GROUP_REOPENED", "A pre-checkpoint group ID cannot be reused.", {
              recordId: record.id,
            });
          }
          usedGroups.add(key);
          lastCreatedGroupByActor.set(record.actorId, record.groupId);
          undo.push({
            actorId: record.actorId,
            groupId: record.groupId,
            transactionId: null,
            commands: [record],
          });
        }
        getActorStack(redoByActor, record.actorId).splice(0);
        pushBatch({
          mode: "apply",
          actorId: record.actorId,
          groupId: record.groupId,
          transactionId: null,
          sequence: record.sequence,
          operations: [commandEffect(record, "command")],
        });
      }
    } else if (record.recordType === "transaction-commit") {
      const transaction = openTransactions.get(record.transactionId);
      if (
        !transaction
        || transaction.actorId !== record.actorId
        || transaction.groupId !== record.groupId
        || openByActor.get(record.actorId) !== record.transactionId
      ) {
        journalError("TRANSACTION_NOT_ACTIVE", "Commit does not match an open transaction.", {
          recordId: record.id,
        });
      }
      if (transaction.commands.length === 0) {
        journalError("EMPTY_TRANSACTION", "Empty transactions must be aborted, not committed.", {
          recordId: record.id,
        });
      }
      openTransactions.delete(record.transactionId);
      openByActor.delete(record.actorId);
      closedGroups.add(groupKey(record.actorId, record.groupId));
      getActorStack(undoByActor, record.actorId).push({
        actorId: record.actorId,
        groupId: record.groupId,
        transactionId: record.transactionId,
        commands: transaction.commands,
      });
      getActorStack(redoByActor, record.actorId).splice(0);
      pushBatch({
        mode: "apply",
        actorId: record.actorId,
        groupId: record.groupId,
        transactionId: record.transactionId,
        sequence: record.sequence,
        operations: transaction.commands.map((command) => commandEffect(command, "command")),
      });
    } else if (record.recordType === "transaction-abort") {
      const transaction = openTransactions.get(record.transactionId);
      if (
        !transaction
        || transaction.actorId !== record.actorId
        || transaction.groupId !== record.groupId
        || openByActor.get(record.actorId) !== record.transactionId
      ) {
        journalError("TRANSACTION_NOT_ACTIVE", "Abort does not match an open transaction.", {
          recordId: record.id,
        });
      }
      openTransactions.delete(record.transactionId);
      openByActor.delete(record.actorId);
      closedGroups.add(groupKey(record.actorId, record.groupId));
    } else if (record.recordType === "undo") {
      if (openByActor.has(record.actorId)) {
        journalError("TRANSACTION_ALREADY_ACTIVE", "Undo cannot cross an open transaction.", {
          recordId: record.id,
        });
      }
      const undo = getActorStack(undoByActor, record.actorId);
      const group = undo.at(-1);
      if (!group) {
        journalError("UNDO_EMPTY", "Undo record has no matching applied group.", {
          recordId: record.id,
        });
      }
      if (group.groupId !== record.groupId) {
        journalError("UNDO_GROUP_MISMATCH", "Undo record targets a non-current group.", {
          recordId: record.id,
        });
      }
      const expected = [...group.commands]
        .reverse()
        .map((command) => commandEffect(command, "inverse"));
      if (!sameJson(record.operations, expected)) {
        journalError("CORRUPT_RECORD", "Undo operations do not match their command inverses.", {
          recordId: record.id,
        });
      }
      undo.pop();
      closedGroups.add(groupKey(record.actorId, record.groupId));
      getActorStack(redoByActor, record.actorId).push(group);
      pushBatch({
        mode: "undo",
        actorId: record.actorId,
        groupId: record.groupId,
        transactionId: group.transactionId,
        sequence: record.sequence,
        operations: record.operations,
      });
    } else {
      if (openByActor.has(record.actorId)) {
        journalError("TRANSACTION_ALREADY_ACTIVE", "Redo cannot cross an open transaction.", {
          recordId: record.id,
        });
      }
      const redo = getActorStack(redoByActor, record.actorId);
      const group = redo.at(-1);
      if (!group) {
        journalError("REDO_EMPTY", "Redo record has no matching undone group.", {
          recordId: record.id,
        });
      }
      if (group.groupId !== record.groupId) {
        journalError("REDO_GROUP_MISMATCH", "Redo record targets a non-current group.", {
          recordId: record.id,
        });
      }
      const expected = group.commands.map((command) => commandEffect(command, "command"));
      if (!sameJson(record.operations, expected)) {
        journalError("CORRUPT_RECORD", "Redo operations do not match their original commands.", {
          recordId: record.id,
        });
      }
      redo.pop();
      getActorStack(undoByActor, record.actorId).push(group);
      pushBatch({
        mode: "redo",
        actorId: record.actorId,
        groupId: record.groupId,
        transactionId: group.transactionId,
        sequence: record.sequence,
        operations: record.operations,
      });
    }

    previousChecksum = record.recordChecksum;
    expectedSequence += 1;
  }

  return {
    headChecksum: previousChecksum,
    nextSequence: expectedSequence,
    replayChecksum,
    actorLamports,
    seen,
    openTransactions,
    openByActor,
    undoByActor,
    redoByActor,
    usedGroups,
    closedGroups,
    usedTransactionIds,
    lastCreatedGroupByActor,
    batches: deepFreezeJson(batches),
  };
}

function parseStoredEffect(
  value: unknown,
  limits: StudioCommandJournalLimits,
  path: string,
): StudioCommandEffect {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["sourceCommandId", "kind", "payload", "payloadChecksum"])
  ) {
    journalError("CORRUPT_RECORD", "Stored command effect has an invalid shape.", { path });
  }
  const effect = deepFreezeJson({
    sourceCommandId: assertSafeId(value.sourceCommandId, `${path}.sourceCommandId`),
    kind: assertKind(value.kind, `${path}.kind`),
    payload: cloneJson(value.payload as StudioCommandJsonValue, limits.maxPayloadBytes),
    payloadChecksum: assertChecksum(
      value.payloadChecksum,
      "CORRUPT_PAYLOAD",
      `${path}.payloadChecksum`,
    ),
  });
  validateOperationChecksum(effect, path);
  return effect;
}

function parseStoredRecord(
  value: unknown,
  limits: StudioCommandJournalLimits,
): StudioCommandJournalRecord {
  if (!isPlainRecord(value)) {
    journalError("CORRUPT_RECORD", "Stored journal record must be an object.");
  }
  const recordType = value.recordType;
  if (
    recordType !== "transaction-begin"
    && recordType !== "command"
    && recordType !== "transaction-commit"
    && recordType !== "transaction-abort"
    && recordType !== "undo"
    && recordType !== "redo"
  ) {
    journalError("CORRUPT_RECORD", "Stored journal record type is not supported.");
  }
  const baseKeys = [
    "version",
    "recordType",
    "sequence",
    "id",
    "actorId",
    "lamport",
    "transactionId",
    "groupId",
    "extensions",
    "idempotencyChecksum",
    "previousChecksum",
    "recordChecksum",
  ];
  const additionalKeys = recordType === "command"
    ? ["command", "inverse"]
    : recordType === "undo" || recordType === "redo"
      ? ["operations"]
      : [];
  if (!hasExactKeys(value, [...baseKeys, ...additionalKeys])) {
    journalError("CORRUPT_RECORD", "Stored journal record has unexpected fields.");
  }
  if (value.version !== STUDIO_COMMAND_JOURNAL_VERSION) {
    journalError("UNSUPPORTED_VERSION", "Stored journal record version is not supported.");
  }
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) {
    journalError("CORRUPT_RECORD", "Stored journal sequence is invalid.");
  }
  const requiresTransaction = (
    recordType === "transaction-begin"
    || recordType === "transaction-commit"
    || recordType === "transaction-abort"
  );
  const transactionId = value.transactionId === null
    ? null
    : assertSafeId(value.transactionId, "$.record.transactionId");
  if (requiresTransaction && transactionId === null) {
    journalError("CORRUPT_RECORD", "Stored record transaction identity is inconsistent.");
  }
  if ((recordType === "undo" || recordType === "redo") && transactionId !== null) {
    journalError("CORRUPT_RECORD", "Undo and redo records cannot belong to a transaction.");
  }
  const base = {
    version: STUDIO_COMMAND_JOURNAL_VERSION,
    recordType,
    sequence: value.sequence as number,
    id: assertSafeId(value.id, "$.record.id"),
    actorId: assertSafeId(value.actorId, "$.record.actorId"),
    lamport: assertLamport(value.lamport, "$.record.lamport"),
    transactionId,
    groupId: assertSafeId(value.groupId, "$.record.groupId"),
    extensions: normalizeExtensions(
      value.extensions as StudioCommandExtensionMetadata,
      limits.maxPayloadBytes,
      "$.record.extensions",
    ),
    idempotencyChecksum: assertChecksum(
      value.idempotencyChecksum,
      "CORRUPT_RECORD",
      "$.record.idempotencyChecksum",
    ),
    previousChecksum: assertChecksum(
      value.previousChecksum,
      "CORRUPT_CHAIN",
      "$.record.previousChecksum",
    ),
    recordChecksum: assertChecksum(
      value.recordChecksum,
      "CORRUPT_RECORD",
      "$.record.recordChecksum",
    ),
  };
  if (recordType === "command") {
    return deepFreezeJson({
      ...base,
      recordType,
      command: normalizeOperation(value.command, limits.maxPayloadBytes, "$.record.command"),
      inverse: normalizeOperation(value.inverse, limits.maxPayloadBytes, "$.record.inverse"),
    }) as StudioCommandRecord;
  }
  if (recordType === "undo" || recordType === "redo") {
    if (!Array.isArray(value.operations) || value.operations.length < 1) {
      journalError("CORRUPT_RECORD", "Undo/redo operation list must be non-empty.");
    }
    const operations = value.operations.map((effect, index) =>
      parseStoredEffect(effect, limits, `$.record.operations[${index}]`)
    );
    return deepFreezeJson({
      ...base,
      recordType,
      transactionId: null,
      operations,
    }) as StudioCommandUndoRecord | StudioCommandRedoRecord;
  }
  return deepFreezeJson({
    ...base,
    recordType,
    transactionId: transactionId as string,
  }) as
    | StudioCommandTransactionBeginRecord
    | StudioCommandTransactionCommitRecord
    | StudioCommandTransactionAbortRecord;
}

function parseCheckpoint(
  value: unknown,
  limits: StudioCommandJournalLimits,
): StudioCommandJournalCheckpoint | null {
  if (value === null) return null;
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      "version",
      "id",
      "upToSequence",
      "compactedHeadChecksum",
      "previousCheckpointChecksum",
      "actorLamports",
      "idempotency",
      "identityFilter",
      "replayChecksum",
      "state",
      "stateChecksum",
      "extensions",
      "checkpointChecksum",
    ])
  ) {
    journalError("CORRUPT_CHECKPOINT", "Stored checkpoint has an invalid shape.");
  }
  if (value.version !== STUDIO_COMMAND_JOURNAL_VERSION) {
    journalError("UNSUPPORTED_VERSION", "Stored checkpoint version is not supported.");
  }
  if (!Number.isSafeInteger(value.upToSequence) || (value.upToSequence as number) < 0) {
    journalError("CORRUPT_CHECKPOINT", "Stored checkpoint sequence is invalid.");
  }
  if (!Array.isArray(value.actorLamports) || value.actorLamports.length > limits.maxActors) {
    journalError("CORRUPT_CHECKPOINT", "Stored checkpoint actor frontier is invalid.");
  }
  const actorLamports: StudioCommandActorLamport[] = [];
  let lastActorId: string | null = null;
  for (const [index, raw] of value.actorLamports.entries()) {
    if (!isPlainRecord(raw) || !hasExactKeys(raw, ["actorId", "lamport"])) {
      journalError("CORRUPT_CHECKPOINT", "Stored actor frontier entry is invalid.", {
        path: `$.checkpoint.actorLamports[${index}]`,
      });
    }
    const actorId = assertSafeId(raw.actorId, `$.checkpoint.actorLamports[${index}].actorId`);
    const lamport = assertLamport(raw.lamport, `$.checkpoint.actorLamports[${index}].lamport`);
    if (lastActorId !== null && actorId <= lastActorId) {
      journalError("CORRUPT_CHECKPOINT", "Stored actor frontiers must be unique and sorted.");
    }
    lastActorId = actorId;
    actorLamports.push(deepFreezeJson({ actorId, lamport }));
  }
  if (
    !Array.isArray(value.idempotency)
    || value.idempotency.length > limits.maxIdempotencyKeys
  ) {
    journalError("CORRUPT_CHECKPOINT", "Stored idempotency frontier is invalid.");
  }
  const idempotency: StudioCommandIdempotencyEntry[] = [];
  const seenIds = new Set<string>();
  for (const [index, raw] of value.idempotency.entries()) {
    if (
      !isPlainRecord(raw)
      || !hasExactKeys(raw, ["id", "recordType", "requestChecksum", "sequence"])
    ) {
      journalError("CORRUPT_CHECKPOINT", "Stored idempotency entry is invalid.", {
        path: `$.checkpoint.idempotency[${index}]`,
      });
    }
    const id = assertSafeId(raw.id, `$.checkpoint.idempotency[${index}].id`);
    const recordType = raw.recordType;
    if (
      recordType !== "transaction-begin"
      && recordType !== "command"
      && recordType !== "transaction-commit"
      && recordType !== "transaction-abort"
      && recordType !== "undo"
      && recordType !== "redo"
    ) {
      journalError("CORRUPT_CHECKPOINT", "Stored idempotency record type is invalid.");
    }
    if (
      !Number.isSafeInteger(raw.sequence)
      || (raw.sequence as number) < 1
      || (raw.sequence as number) > (value.upToSequence as number)
      || seenIds.has(id)
    ) {
      journalError("CORRUPT_CHECKPOINT", "Stored idempotency sequence or ID is invalid.");
    }
    seenIds.add(id);
    idempotency.push(deepFreezeJson({
      id,
      recordType,
      requestChecksum: assertChecksum(
        raw.requestChecksum,
        "CORRUPT_CHECKPOINT",
        `$.checkpoint.idempotency[${index}].requestChecksum`,
      ),
      sequence: raw.sequence as number,
    }));
  }
  const state = cloneJson(value.state as StudioCommandJsonValue, limits.maxPayloadBytes);
  const stateChecksum = assertChecksum(
    value.stateChecksum,
    "CORRUPT_CHECKPOINT",
    "$.checkpoint.stateChecksum",
  );
  if (studioCommandPayloadChecksum(state) !== stateChecksum) {
    journalError("CORRUPT_CHECKPOINT", "Checkpoint state checksum does not match its content.");
  }
  const previousCheckpointChecksum = value.previousCheckpointChecksum === null
    ? null
    : assertChecksum(
        value.previousCheckpointChecksum,
        "CORRUPT_CHECKPOINT",
        "$.checkpoint.previousCheckpointChecksum",
      );
  if (
    typeof value.identityFilter !== "string"
    || !IDENTITY_FILTER_PATTERN.test(value.identityFilter)
  ) {
    journalError("CORRUPT_CHECKPOINT", "Checkpoint identity filter has an invalid shape.");
  }
  const withoutChecksum: Omit<StudioCommandJournalCheckpoint, "checkpointChecksum"> = {
    version: STUDIO_COMMAND_JOURNAL_VERSION,
    id: assertSafeId(value.id, "$.checkpoint.id"),
    upToSequence: value.upToSequence as number,
    compactedHeadChecksum: assertChecksum(
      value.compactedHeadChecksum,
      "CORRUPT_CHECKPOINT",
      "$.checkpoint.compactedHeadChecksum",
    ),
    previousCheckpointChecksum,
    actorLamports,
    idempotency,
    identityFilter: value.identityFilter,
    replayChecksum: assertChecksum(
      value.replayChecksum,
      "CORRUPT_CHECKPOINT",
      "$.checkpoint.replayChecksum",
    ),
    state,
    stateChecksum,
    extensions: normalizeExtensions(
      value.extensions as StudioCommandExtensionMetadata,
      limits.maxPayloadBytes,
      "$.checkpoint.extensions",
    ),
  };
  const checkpointChecksum = assertChecksum(
    value.checkpointChecksum,
    "CORRUPT_CHECKPOINT",
    "$.checkpoint.checkpointChecksum",
  );
  if (calculateCheckpointChecksum(withoutChecksum) !== checkpointChecksum) {
    journalError("CORRUPT_CHECKPOINT", "Checkpoint checksum does not match its content.");
  }
  return deepFreezeJson({ ...withoutChecksum, checkpointChecksum });
}

interface SerializedStudioCommandJournal {
  readonly format: typeof STUDIO_COMMAND_JOURNAL_FORMAT;
  readonly version: typeof STUDIO_COMMAND_JOURNAL_VERSION;
  readonly limits: StudioCommandJournalLimits;
  readonly extensions: StudioCommandExtensionMetadata;
  readonly checkpoint: StudioCommandJournalCheckpoint | null;
  readonly records: readonly StudioCommandJournalRecord[];
  readonly headChecksum: string;
  readonly nextSequence: number;
  readonly manifestChecksum: string;
}

function serializedManifestBody(
  value: Omit<SerializedStudioCommandJournal, "manifestChecksum">,
): StudioCommandJsonValue {
  return value as unknown as StudioCommandJsonValue;
}

/**
 * Immutable append-only journal. Methods append one record or throw a typed error before changing
 * observable state. Only `compact` replaces a verified prefix with an integrity-checked checkpoint.
 */
export class StudioCommandJournal<
  TCheckpointState extends StudioCommandJsonValue = StudioCommandJsonValue,
> {
  private readonly limitsValue: StudioCommandJournalLimits;
  private readonly extensionsValue: StudioCommandExtensionMetadata;
  private recordsValue: readonly StudioCommandJournalRecord[];
  private checkpointValue: StudioCommandJournalCheckpoint<TCheckpointState> | null;
  private scanValue: ScanState;
  private fullScanCountValue = 0;
  private incrementalRecordCountValue = 0;

  constructor(options: StudioCommandJournalOptions = {}) {
    this.limitsValue = normalizeLimits(options.limits);
    this.extensionsValue = normalizeExtensions(
      options.extensions,
      this.limitsValue.maxPayloadBytes,
      "$.journal.extensions",
    );
    this.recordsValue = Object.freeze([]);
    this.checkpointValue = null;
    this.scanValue = scanJournal(null, [], this.limitsValue);
    this.fullScanCountValue += 1;
  }

  get limits(): StudioCommandJournalLimits {
    return this.limitsValue;
  }

  get extensions(): StudioCommandExtensionMetadata {
    return this.extensionsValue;
  }

  get records(): readonly StudioCommandJournalRecord[] {
    return Object.freeze([...this.recordsValue]);
  }

  get checkpoint(): StudioCommandJournalCheckpoint<TCheckpointState> | null {
    return this.checkpointValue;
  }

  get length(): number {
    return this.recordsValue.length;
  }

  get headChecksum(): string {
    return this.scanValue.headChecksum;
  }

  get replayChecksum(): string {
    return this.scanValue.replayChecksum;
  }

  get nextSequence(): number {
    return this.scanValue.nextSequence;
  }

  get activeTransactionCount(): number {
    return this.scanValue.openTransactions.size;
  }

  get verificationStats(): StudioCommandJournalVerificationStats {
    return Object.freeze({
      fullScanCount: this.fullScanCountValue,
      incrementalRecordCount: this.incrementalRecordCountValue,
    });
  }

  activeTransactionId(actorId: string): string | null {
    return this.scanValue.openByActor.get(actorId) ?? null;
  }

  peekUndoGroup(actorId: string): string | null {
    return this.scanValue.undoByActor.get(actorId)?.at(-1)?.groupId ?? null;
  }

  peekRedoGroup(actorId: string): string | null {
    return this.scanValue.redoByActor.get(actorId)?.at(-1)?.groupId ?? null;
  }

  canUndo(actorId: string): boolean {
    return !this.scanValue.openByActor.has(actorId) && this.peekUndoGroup(actorId) !== null;
  }

  canRedo(actorId: string): boolean {
    return !this.scanValue.openByActor.has(actorId) && this.peekRedoGroup(actorId) !== null;
  }

  private duplicateResult<TRecord extends StudioCommandJournalRecord>(
    id: string,
    recordType: TRecord["recordType"],
    checksum: string,
  ): StudioCommandAppendResult<TRecord> | null {
    const seen = this.scanValue.seen.get(id);
    if (!seen) {
      if (this.checkpointValue?.id === id) {
        journalError("DUPLICATE_CONFLICT", "Record ID collides with the active checkpoint.", {
          recordId: id,
        });
      }
      if (
        identityFilterMayContain(this.checkpointValue?.identityFilter, `record:${id}`)
        || identityFilterMayContain(this.checkpointValue?.identityFilter, `checkpoint:${id}`)
      ) {
        journalError(
          "DUPLICATE_CONFLICT",
          "Record identity may already exist outside exact retry retention.",
          { recordId: id },
        );
      }
      return null;
    }
    if (seen.recordType !== recordType || seen.requestChecksum !== checksum) {
      journalError("DUPLICATE_CONFLICT", "Record ID was retried with different content.", {
        recordId: id,
      });
    }
    return Object.freeze({
      status: "duplicate",
      record: seen.record as TRecord | null,
      sequence: seen.sequence,
      compacted: seen.record === null,
    });
  }

  private assertActorLamport(actorId: string, lamport: number, recordId: string): void {
    const previous = this.scanValue.actorLamports.get(actorId);
    if (previous !== undefined && lamport <= previous) {
      journalError("LAMPORT_REGRESSION", "Actor Lamport values must increase monotonically.", {
        recordId,
      });
    }
    if (previous === undefined && this.scanValue.actorLamports.size >= this.limitsValue.maxActors) {
      journalError("ACTOR_LIMIT_EXCEEDED", "Journal actor bound has been reached.", {
        recordId,
      });
    }
  }

  private assertCapacity(reservedRecords = 1): void {
    if (this.recordsValue.length + reservedRecords > this.limitsValue.maxRecords) {
      journalError(
        "JOURNAL_LIMIT_EXCEEDED",
        "Journal record bound has been reached; create a compaction checkpoint.",
      );
    }
  }

  private appendPrepared<TRecord extends StudioCommandJournalRecord>(
    record: Omit<TRecord, "sequence" | "previousChecksum" | "recordChecksum">,
  ): StudioCommandAppendResult<TRecord> {
    const withoutChecksum = {
      ...record,
      sequence: this.scanValue.nextSequence,
      previousChecksum: this.scanValue.headChecksum,
    } as Omit<TRecord, "recordChecksum">;
    const appended = deepFreezeJson({
      ...withoutChecksum,
      recordChecksum: calculateRecordChecksum(
        withoutChecksum as Omit<StudioCommandJournalRecord, "recordChecksum">,
      ),
    }) as TRecord;
    const nextRecords = Object.freeze([...this.recordsValue, appended]);
    const nextScan = scanJournal(
      this.checkpointValue,
      [appended],
      this.limitsValue,
      this.scanValue,
    );
    this.recordsValue = nextRecords;
    this.scanValue = nextScan;
    this.incrementalRecordCountValue += 1;
    return Object.freeze({ status: "appended", record: appended });
  }

  appendCommand(envelopeInput: StudioCommandEnvelope): StudioCommandAppendResult<StudioCommandRecord> {
    const envelope = normalizeEnvelope(envelopeInput, this.limitsValue.maxPayloadBytes);
    const idempotencyChecksum = requestChecksum(
      "command",
      envelope,
      envelope.command,
      envelope.inverse,
    );
    const duplicate = this.duplicateResult<StudioCommandRecord>(
      envelope.id,
      "command",
      idempotencyChecksum,
    );
    if (duplicate) return duplicate;
    this.assertActorLamport(envelope.actorId, envelope.lamport, envelope.id);

    if (envelope.transactionId !== null) {
      const transaction = this.scanValue.openTransactions.get(envelope.transactionId);
      if (
        !transaction
        || transaction.actorId !== envelope.actorId
        || transaction.groupId !== envelope.groupId
        || this.scanValue.openByActor.get(envelope.actorId) !== envelope.transactionId
      ) {
        journalError("TRANSACTION_MISMATCH", "Command does not match an open transaction.", {
          recordId: envelope.id,
        });
      }
      // Preserve one final slot so a full transaction can always be aborted or committed.
      this.assertCapacity(2);
    } else {
      if (this.scanValue.openByActor.has(envelope.actorId)) {
        journalError("TRANSACTION_MISMATCH", "Standalone command cannot bypass an open transaction.", {
          recordId: envelope.id,
        });
      }
      const key = groupKey(envelope.actorId, envelope.groupId);
      if (this.scanValue.usedGroups.has(key)) {
        const current = this.scanValue.undoByActor.get(envelope.actorId)?.at(-1);
        if (
          this.scanValue.closedGroups.has(key)
          ||
          current?.groupId !== envelope.groupId
          || current.transactionId !== null
          || this.scanValue.lastCreatedGroupByActor.get(envelope.actorId) !== envelope.groupId
        ) {
          journalError("GROUP_REOPENED", "A non-contiguous command group cannot be reopened.", {
            recordId: envelope.id,
          });
        }
      } else if (
        identityFilterMayContain(this.checkpointValue?.identityFilter, `group:${key}`)
      ) {
        journalError("GROUP_REOPENED", "A pre-checkpoint group ID cannot be reused.", {
          recordId: envelope.id,
        });
      }
      this.assertCapacity();
    }

    return this.appendPrepared<StudioCommandRecord>({
      ...envelope,
      idempotencyChecksum,
    });
  }

  beginTransaction(
    input: StudioCommandRecordMetadataInput,
  ): StudioCommandAppendResult<StudioCommandTransactionBeginRecord> {
    const metadata = normalizeMetadata(input, this.limitsValue.maxPayloadBytes);
    const idempotencyChecksum = requestChecksum("transaction-begin", metadata);
    const duplicate = this.duplicateResult<StudioCommandTransactionBeginRecord>(
      metadata.id,
      "transaction-begin",
      idempotencyChecksum,
    );
    if (duplicate) return duplicate;
    this.assertActorLamport(metadata.actorId, metadata.lamport, metadata.id);
    if (
      this.scanValue.openByActor.has(metadata.actorId)
      || this.scanValue.openTransactions.has(metadata.transactionId)
    ) {
      journalError("TRANSACTION_ALREADY_ACTIVE", "Actor or transaction already has an open transaction.", {
        recordId: metadata.id,
      });
    }
    if (
      this.scanValue.usedTransactionIds.has(metadata.transactionId)
      || identityFilterMayContain(
        this.checkpointValue?.identityFilter,
        `transaction:${metadata.transactionId}`,
      )
    ) {
      journalError("TRANSACTION_REUSED", "A transaction ID cannot be reused.", {
        recordId: metadata.id,
      });
    }
    if (this.scanValue.usedGroups.has(groupKey(metadata.actorId, metadata.groupId))) {
      journalError("GROUP_REOPENED", "A closed or open group ID cannot be reused.", {
        recordId: metadata.id,
      });
    }
    if (
      identityFilterMayContain(
        this.checkpointValue?.identityFilter,
        `group:${groupKey(metadata.actorId, metadata.groupId)}`,
      )
    ) {
      journalError("GROUP_REOPENED", "A pre-checkpoint group ID cannot be reused.", {
        recordId: metadata.id,
      });
    }
    // Reserve one command plus the terminal commit/abort record at begin time.
    this.assertCapacity(3);
    return this.appendPrepared<StudioCommandTransactionBeginRecord>({
      version: STUDIO_COMMAND_JOURNAL_VERSION,
      recordType: "transaction-begin",
      ...metadata,
      idempotencyChecksum,
    });
  }

  commitTransaction(
    input: StudioCommandRecordMetadataInput,
  ): StudioCommandAppendResult<StudioCommandTransactionCommitRecord> {
    const metadata = normalizeMetadata(input, this.limitsValue.maxPayloadBytes);
    const idempotencyChecksum = requestChecksum("transaction-commit", metadata);
    const duplicate = this.duplicateResult<StudioCommandTransactionCommitRecord>(
      metadata.id,
      "transaction-commit",
      idempotencyChecksum,
    );
    if (duplicate) return duplicate;
    this.assertActorLamport(metadata.actorId, metadata.lamport, metadata.id);
    const transaction = this.scanValue.openTransactions.get(metadata.transactionId);
    if (
      !transaction
      || transaction.actorId !== metadata.actorId
      || transaction.groupId !== metadata.groupId
      || this.scanValue.openByActor.get(metadata.actorId) !== metadata.transactionId
    ) {
      journalError("TRANSACTION_NOT_ACTIVE", "Commit does not match an open transaction.", {
        recordId: metadata.id,
      });
    }
    if (transaction.commands.length === 0) {
      journalError("EMPTY_TRANSACTION", "Empty transactions must be aborted, not committed.", {
        recordId: metadata.id,
      });
    }
    this.assertCapacity();
    return this.appendPrepared<StudioCommandTransactionCommitRecord>({
      version: STUDIO_COMMAND_JOURNAL_VERSION,
      recordType: "transaction-commit",
      ...metadata,
      idempotencyChecksum,
    });
  }

  abortTransaction(
    input: StudioCommandRecordMetadataInput,
  ): StudioCommandAppendResult<StudioCommandTransactionAbortRecord> {
    const metadata = normalizeMetadata(input, this.limitsValue.maxPayloadBytes);
    const idempotencyChecksum = requestChecksum("transaction-abort", metadata);
    const duplicate = this.duplicateResult<StudioCommandTransactionAbortRecord>(
      metadata.id,
      "transaction-abort",
      idempotencyChecksum,
    );
    if (duplicate) return duplicate;
    this.assertActorLamport(metadata.actorId, metadata.lamport, metadata.id);
    const transaction = this.scanValue.openTransactions.get(metadata.transactionId);
    if (
      !transaction
      || transaction.actorId !== metadata.actorId
      || transaction.groupId !== metadata.groupId
      || this.scanValue.openByActor.get(metadata.actorId) !== metadata.transactionId
    ) {
      journalError("TRANSACTION_NOT_ACTIVE", "Abort does not match an open transaction.", {
        recordId: metadata.id,
      });
    }
    this.assertCapacity();
    return this.appendPrepared<StudioCommandTransactionAbortRecord>({
      version: STUDIO_COMMAND_JOURNAL_VERSION,
      recordType: "transaction-abort",
      ...metadata,
      idempotencyChecksum,
    });
  }

  undo(input: StudioCommandUndoRedoInput): StudioCommandAppendResult<StudioCommandUndoRecord> {
    const metadata = normalizeUndoRedoMetadata(input, this.limitsValue.maxPayloadBytes);
    const idempotencyChecksum = requestChecksum("undo", metadata);
    const duplicate = this.duplicateResult<StudioCommandUndoRecord>(
      metadata.id,
      "undo",
      idempotencyChecksum,
    );
    if (duplicate) return duplicate;
    this.assertActorLamport(metadata.actorId, metadata.lamport, metadata.id);
    if (this.scanValue.openByActor.has(metadata.actorId)) {
      journalError("TRANSACTION_ALREADY_ACTIVE", "Undo cannot cross an open transaction.", {
        recordId: metadata.id,
      });
    }
    const group = this.scanValue.undoByActor.get(metadata.actorId)?.at(-1);
    if (!group) {
      journalError("UNDO_EMPTY", "There is no applied command group to undo.", {
        recordId: metadata.id,
      });
    }
    if (group.groupId !== metadata.groupId) {
      journalError("UNDO_GROUP_MISMATCH", "Undo must target the actor's current group.", {
        recordId: metadata.id,
      });
    }
    this.assertCapacity();
    const operations = [...group.commands]
      .reverse()
      .map((command) => commandEffect(command, "inverse"));
    return this.appendPrepared<StudioCommandUndoRecord>({
      version: STUDIO_COMMAND_JOURNAL_VERSION,
      recordType: "undo",
      ...metadata,
      operations,
      idempotencyChecksum,
    });
  }

  redo(input: StudioCommandUndoRedoInput): StudioCommandAppendResult<StudioCommandRedoRecord> {
    const metadata = normalizeUndoRedoMetadata(input, this.limitsValue.maxPayloadBytes);
    const idempotencyChecksum = requestChecksum("redo", metadata);
    const duplicate = this.duplicateResult<StudioCommandRedoRecord>(
      metadata.id,
      "redo",
      idempotencyChecksum,
    );
    if (duplicate) return duplicate;
    this.assertActorLamport(metadata.actorId, metadata.lamport, metadata.id);
    if (this.scanValue.openByActor.has(metadata.actorId)) {
      journalError("TRANSACTION_ALREADY_ACTIVE", "Redo cannot cross an open transaction.", {
        recordId: metadata.id,
      });
    }
    const group = this.scanValue.redoByActor.get(metadata.actorId)?.at(-1);
    if (!group) {
      journalError("REDO_EMPTY", "There is no undone command group to redo.", {
        recordId: metadata.id,
      });
    }
    if (group.groupId !== metadata.groupId) {
      journalError("REDO_GROUP_MISMATCH", "Redo must target the actor's current group.", {
        recordId: metadata.id,
      });
    }
    this.assertCapacity();
    const operations = group.commands.map((command) => commandEffect(command, "command"));
    return this.appendPrepared<StudioCommandRedoRecord>({
      version: STUDIO_COMMAND_JOURNAL_VERSION,
      recordType: "redo",
      ...metadata,
      operations,
      idempotencyChecksum,
    });
  }

  /**
   * Replaces the complete verified prefix with an opaque application checkpoint.
   *
   * Compaction is allowed only with no open transaction. It intentionally establishes a new undo
   * horizon: groups before the checkpoint are represented by `state`, not retained inverse data.
   */
  compact(
    input: StudioCommandCheckpointInput<TCheckpointState>,
  ): StudioCommandJournalCheckpoint<TCheckpointState> {
    if (!isPlainRecord(input)) {
      journalError("INVALID_COMPACTION", "Checkpoint input must be an object.");
    }
    const keys = ["id", "state", "extensions"];
    if (!hasExactKeys(input, keys) && !hasExactKeys(input, keys.slice(0, -1))) {
      journalError("INVALID_COMPACTION", "Checkpoint input has unexpected fields.");
    }
    if (this.scanValue.openTransactions.size > 0) {
      journalError("INVALID_COMPACTION", "Open transactions must be committed or aborted first.");
    }
    const id = assertSafeId(input.id, "$.checkpoint.id");
    if (
      this.scanValue.seen.has(id)
      || this.checkpointValue?.id === id
      || identityFilterMayContain(this.checkpointValue?.identityFilter, `record:${id}`)
      || identityFilterMayContain(this.checkpointValue?.identityFilter, `checkpoint:${id}`)
    ) {
      journalError("DUPLICATE_CONFLICT", "Checkpoint ID collides with retained journal identity.", {
        recordId: id,
      });
    }
    const state = cloneJson(input.state, this.limitsValue.maxPayloadBytes);
    const extensions = normalizeExtensions(
      input.extensions,
      this.limitsValue.maxPayloadBytes,
      "$.checkpoint.extensions",
    );
    const retainedIdempotency = [...this.scanValue.seen.values()]
      .slice(-this.limitsValue.maxIdempotencyKeys)
      .map(({ id: recordId, recordType, requestChecksum: checksum, sequence }) =>
        deepFreezeJson({
          id: recordId,
          recordType,
          requestChecksum: checksum,
          sequence,
        })
      );
    const actorLamports = [...this.scanValue.actorLamports.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([actorId, lamport]) => deepFreezeJson({ actorId, lamport }));
    const identityFilterBytes = decodeIdentityFilter(this.checkpointValue?.identityFilter);
    for (const seen of this.scanValue.seen.values()) {
      addIdentityToFilter(identityFilterBytes, `record:${seen.id}`);
    }
    for (const transactionId of this.scanValue.usedTransactionIds) {
      addIdentityToFilter(identityFilterBytes, `transaction:${transactionId}`);
    }
    for (const key of this.scanValue.usedGroups) {
      addIdentityToFilter(identityFilterBytes, `group:${key}`);
    }
    if (this.checkpointValue) {
      addIdentityToFilter(identityFilterBytes, `checkpoint:${this.checkpointValue.id}`);
    }
    addIdentityToFilter(identityFilterBytes, `checkpoint:${id}`);
    const withoutChecksum: Omit<
      StudioCommandJournalCheckpoint<TCheckpointState>,
      "checkpointChecksum"
    > = {
      version: STUDIO_COMMAND_JOURNAL_VERSION,
      id,
      upToSequence: this.scanValue.nextSequence - 1,
      compactedHeadChecksum: this.scanValue.headChecksum,
      previousCheckpointChecksum: this.checkpointValue?.checkpointChecksum ?? null,
      actorLamports,
      idempotency: retainedIdempotency,
      identityFilter: encodeIdentityFilter(identityFilterBytes),
      replayChecksum: this.scanValue.replayChecksum,
      state,
      stateChecksum: studioCommandPayloadChecksum(state),
      extensions,
    };
    const checkpoint = deepFreezeJson({
      ...withoutChecksum,
      checkpointChecksum: calculateCheckpointChecksum(
        withoutChecksum as Omit<StudioCommandJournalCheckpoint, "checkpointChecksum">,
      ),
    });
    const nextScan = scanJournal(
      checkpoint as StudioCommandJournalCheckpoint,
      [],
      this.limitsValue,
    );
    this.checkpointValue = checkpoint;
    this.recordsValue = Object.freeze([]);
    this.scanValue = nextScan;
    this.fullScanCountValue += 1;
    return checkpoint;
  }

  replayPlan(): StudioCommandReplayPlan<TCheckpointState> {
    const verified = scanJournal(
      this.checkpointValue as StudioCommandJournalCheckpoint | null,
      this.recordsValue,
      this.limitsValue,
    );
    this.fullScanCountValue += 1;
    return deepFreezeJson({
      checkpoint: this.checkpointValue,
      batches: verified.batches,
      headChecksum: verified.headChecksum,
      replayChecksum: verified.replayChecksum,
      recordCount: this.recordsValue.length,
      nextSequence: verified.nextSequence,
    });
  }

  serialize(): string {
    const withoutManifest: Omit<SerializedStudioCommandJournal, "manifestChecksum"> = {
      format: STUDIO_COMMAND_JOURNAL_FORMAT,
      version: STUDIO_COMMAND_JOURNAL_VERSION,
      limits: this.limitsValue,
      extensions: this.extensionsValue,
      checkpoint: this.checkpointValue as StudioCommandJournalCheckpoint | null,
      records: this.recordsValue,
      headChecksum: this.scanValue.headChecksum,
      nextSequence: this.scanValue.nextSequence,
    };
    const serialized: SerializedStudioCommandJournal = {
      ...withoutManifest,
      manifestChecksum: checksumJson(serializedManifestBody(withoutManifest)),
    };
    return canonicalStudioCommandJson(serialized, this.limitsValue.maxSerializedBytes);
  }

  static restore<TState extends StudioCommandJsonValue = StudioCommandJsonValue>(
    serialized: string,
  ): StudioCommandJournal<TState> {
    if (typeof serialized !== "string" || TEXT_ENCODER.encode(serialized).byteLength > HARD_MAX_SERIALIZED_BYTES) {
      journalError("CORRUPT_SERIALIZATION", "Serialized journal is missing or exceeds the hard limit.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(serialized);
    } catch {
      journalError("CORRUPT_SERIALIZATION", "Serialized journal is not valid JSON.");
    }
    if (
      !isPlainRecord(raw)
      || !hasExactKeys(raw, [
        "format",
        "version",
        "limits",
        "extensions",
        "checkpoint",
        "records",
        "headChecksum",
        "nextSequence",
        "manifestChecksum",
      ])
    ) {
      journalError("CORRUPT_SERIALIZATION", "Serialized journal manifest has an invalid shape.");
    }
    if (raw.format !== STUDIO_COMMAND_JOURNAL_FORMAT) {
      journalError("CORRUPT_SERIALIZATION", "Serialized journal format is not recognized.");
    }
    if (raw.version !== STUDIO_COMMAND_JOURNAL_VERSION) {
      journalError("UNSUPPORTED_VERSION", "Serialized journal version is not supported.");
    }
    if (!isPlainRecord(raw.limits)) {
      journalError("CORRUPT_SERIALIZATION", "Serialized journal limits are invalid.");
    }
    const limits = normalizeLimits(raw.limits as Partial<StudioCommandJournalLimits>);
    if (TEXT_ENCODER.encode(serialized).byteLength > limits.maxSerializedBytes) {
      journalError("CORRUPT_SERIALIZATION", "Serialized journal exceeds its configured byte bound.");
    }
    const extensions = normalizeExtensions(
      raw.extensions as StudioCommandExtensionMetadata,
      limits.maxPayloadBytes,
      "$.journal.extensions",
    );
    const checkpoint = parseCheckpoint(raw.checkpoint, limits);
    if (!Array.isArray(raw.records)) {
      journalError("CORRUPT_SERIALIZATION", "Serialized journal records must be an array.");
    }
    const records = raw.records.map((record) => parseStoredRecord(record, limits));
    // Validate payloads, record hashes, transaction/group semantics, and the chain before consulting
    // the outer manifest so callers receive the most specific corruption classification.
    const scan = scanJournal(checkpoint, records, limits);
    const headChecksum = assertChecksum(
      raw.headChecksum,
      "CORRUPT_SERIALIZATION",
      "$.headChecksum",
    );
    if (scan.headChecksum !== headChecksum) {
      journalError("CORRUPT_CHAIN", "Serialized journal head does not match its verified chain.");
    }
    if (!Number.isSafeInteger(raw.nextSequence) || raw.nextSequence !== scan.nextSequence) {
      journalError("CORRUPT_CHAIN", "Serialized journal next sequence is inconsistent.");
    }
    const manifestChecksum = assertChecksum(
      raw.manifestChecksum,
      "CORRUPT_SERIALIZATION",
      "$.manifestChecksum",
    );
    const withoutManifest: Omit<SerializedStudioCommandJournal, "manifestChecksum"> = {
      format: STUDIO_COMMAND_JOURNAL_FORMAT,
      version: STUDIO_COMMAND_JOURNAL_VERSION,
      limits,
      extensions,
      checkpoint,
      records,
      headChecksum,
      nextSequence: scan.nextSequence,
    };
    if (checksumJson(serializedManifestBody(withoutManifest)) !== manifestChecksum) {
      journalError("CORRUPT_SERIALIZATION", "Serialized journal manifest checksum is invalid.");
    }

    const journal = new StudioCommandJournal<TState>({ limits, extensions });
    journal.checkpointValue = checkpoint as StudioCommandJournalCheckpoint<TState> | null;
    journal.recordsValue = Object.freeze(records);
    journal.scanValue = scan;
    // The constructor validates an empty genesis state; restore then installs the independently
    // verified serialized frontier above.
    journal.fullScanCountValue += 1;
    return journal;
  }
}

export function createStudioCommandJournal<
  TCheckpointState extends StudioCommandJsonValue = StudioCommandJsonValue,
>(
  options: StudioCommandJournalOptions = {},
): StudioCommandJournal<TCheckpointState> {
  return new StudioCommandJournal<TCheckpointState>(options);
}

export function serializeStudioCommandJournal(
  journal: StudioCommandJournal,
): string {
  return journal.serialize();
}

export function restoreStudioCommandJournal<
  TCheckpointState extends StudioCommandJsonValue = StudioCommandJsonValue,
>(
  serialized: string,
): StudioCommandJournal<TCheckpointState> {
  return StudioCommandJournal.restore<TCheckpointState>(serialized);
}

export function replayStudioCommandJournal<
  TCheckpointState extends StudioCommandJsonValue = StudioCommandJsonValue,
>(
  journal: StudioCommandJournal<TCheckpointState>,
): StudioCommandReplayPlan<TCheckpointState> {
  return journal.replayPlan();
}
