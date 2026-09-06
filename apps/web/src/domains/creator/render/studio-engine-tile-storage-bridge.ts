/**
 * Durable persistence boundary for the future Worker-owned RGBA16F tile engine.
 *
 * The existing Storage Worker protocol is intentionally not used here. Its v1 commands acknowledge
 * one `write` or `append-journal` at a time, do not echo a payload checksum, and cannot acknowledge
 * one journal frame plus a complete multi-tile replacement as a single idempotent transaction.
 * Treating those per-command responses as a durable engine commit would make a torn batch look
 * successful after a Worker restart.
 *
 * This module therefore defines the future-only v2 transaction DTO that the Storage Worker must
 * implement next. A conforming transport must:
 *
 * 1. validate the complete request and its transaction identity before writing;
 * 2. durably append/flush the journal frame as WAL;
 * 3. write every full RGBA16F tile at its BigInt logical offset;
 * 4. persist a commit marker, flush the document, and only then return the exact ACK;
 * 5. return the same exact ACK for an idempotent replay of the same transaction identity.
 *
 * There is deliberately no Canvas, WebGL, localStorage, IndexedDB, or main-thread persistence
 * fallback. Until the Storage Worker understands this DTO, integration must fail closed.
 */

import {
  canonicalStudioCommandJson,
  studioCommandPayloadChecksum,
  type StudioCommandJsonValue,
} from "../studio-command-journal";

import {
  STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
  STUDIO_ENGINE_TILE_ENCODING,
  studioEngineRgba16FloatTileDigest,
  type StudioEngineTileCommitReceipt,
  type StudioEngineTileCommitResult,
  type StudioEngineTileReadResult,
  type StudioEngineTileReceiptEntry,
} from "./studio-engine-tile-authority";
import { studioTileDocDigest } from "./studio-tiledoc-digest";

export const STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION = 2 as const;
export const STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND =
  "studio-engine-tile-storage/atomic-commit" as const;
export const STUDIO_ENGINE_TILE_STORAGE_ACK_KIND =
  "studio-engine-tile-storage/atomic-commit-ack" as const;

export const STUDIO_ENGINE_TILE_STORAGE_V1_INTEGRATION_GAP =
  "Storage Worker v1 has only per-write/per-journal revision ACKs; it has no atomic multi-payload transaction identity, payload checksum echo, commit marker, or idempotent whole-commit replay ACK." as const;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_TILES_PER_COMMIT = 4_096;
const DEFAULT_MAX_PAYLOAD_BYTES =
  BigInt(4) * BigInt(1024) * BigInt(1024) * BigInt(1024);
const MAX_SAFE_REVISION = Number.MAX_SAFE_INTEGER;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const MAX_ID_CHARACTERS = 192;
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

type CommittedTileResult = Extract<
  StudioEngineTileCommitResult,
  { readonly status: "committed" }
>;

export interface StudioEngineTileStorageInitialFrontier {
  readonly durableRevision: number;
  readonly documentRevision: number;
  readonly commandSequence: number;
  readonly transactionSequence: number;
  readonly journalByteLength: bigint;
}

export interface StudioEngineTileStorageLimits {
  readonly maxTilesPerCommit: number;
  readonly maxPayloadBytes: bigint;
}

export interface StudioEngineTileStoragePayloadSource {
  /**
   * Return the current authoritative full tile. The bridge copies and re-digests it before the
   * transport receives ownership. Returning a sparse delta is a protocol error.
   */
  readTile(
    tile: StudioEngineTileReceiptEntry,
    signal: AbortSignal,
  ):
    | StudioEngineTileReadResult
    | null
    | Promise<StudioEngineTileReadResult | null>;
}

export interface StudioEngineTileStorageJournalPayload {
  readonly sequence: number;
  readonly logicalByteOffset: bigint;
  readonly byteLength: number;
  readonly recordDigest: string;
  readonly payloadChecksum: string;
  /** Fresh, tightly packed ownership for this request. */
  readonly data: ArrayBuffer;
}

export interface StudioEngineTileStorageTilePayload {
  readonly index: number;
  readonly tileId: string;
  readonly column: number;
  readonly row: number;
  readonly layerId: string;
  readonly layerIndex: number;
  readonly logicalTileIndex: bigint;
  readonly logicalByteOffset: bigint;
  readonly shardIndex: bigint;
  readonly shardByteOffset: bigint;
  readonly baseTileRevision: number;
  readonly tileRevision: number;
  readonly byteLength: number;
  readonly contentDigest: string;
  readonly payloadChecksum: string;
  /** Fresh, tightly packed full little-endian RGBA16F ownership for this request. */
  readonly data: ArrayBuffer;
}

export interface StudioEngineTileStorageCommitRequest {
  readonly kind: typeof STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND;
  readonly version: typeof STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION;
  readonly authorityVersion: typeof STUDIO_ENGINE_TILE_AUTHORITY_VERSION;
  readonly encoding: typeof STUDIO_ENGINE_TILE_ENCODING;
  readonly requestSequence: number;
  readonly sessionEpoch: number;
  readonly transactionSequence: number;
  readonly transactionIdentity: string;
  readonly expectedDurableRevision: number;
  readonly documentId: string;
  readonly commandIdentity: string;
  readonly commandSequence: number;
  readonly baseDocumentRevision: number;
  readonly documentRevision: number;
  readonly writeCount: number;
  readonly totalPayloadBytes: bigint;
  readonly journal: StudioEngineTileStorageJournalPayload;
  readonly tiles: readonly StudioEngineTileStorageTilePayload[];
}

export interface StudioEngineTileStorageJournalAck {
  readonly sequence: number;
  readonly logicalByteOffset: bigint;
  readonly byteLength: number;
  readonly recordDigest: string;
  readonly payloadChecksum: string;
}

export interface StudioEngineTileStorageTileAck {
  readonly index: number;
  readonly tileId: string;
  readonly logicalTileIndex: bigint;
  readonly logicalByteOffset: bigint;
  readonly shardIndex: bigint;
  readonly shardByteOffset: bigint;
  readonly tileRevision: number;
  readonly byteLength: number;
  readonly contentDigest: string;
  readonly payloadChecksum: string;
}

export interface StudioEngineTileStorageCommitAck {
  readonly kind: typeof STUDIO_ENGINE_TILE_STORAGE_ACK_KIND;
  readonly version: typeof STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION;
  readonly complete: true;
  readonly disposition: "committed" | "idempotent-replay";
  readonly requestSequence: number;
  readonly sessionEpoch: number;
  readonly transactionSequence: number;
  readonly transactionIdentity: string;
  readonly expectedDurableRevision: number;
  readonly durableRevision: number;
  readonly documentId: string;
  readonly commandSequence: number;
  readonly documentRevision: number;
  readonly writeCount: number;
  readonly totalPayloadBytes: bigint;
  readonly journal: StudioEngineTileStorageJournalAck;
  readonly tiles: readonly StudioEngineTileStorageTileAck[];
}

export interface StudioEngineTileStorageTransport {
  commit(
    request: StudioEngineTileStorageCommitRequest,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<unknown> | unknown;
  dispose?(): Promise<void> | void;
}

export interface StudioEngineTileStorageBridgeOptions {
  readonly documentId: string;
  readonly sessionEpoch: number;
  readonly payloadSource: StudioEngineTileStoragePayloadSource;
  readonly transport: StudioEngineTileStorageTransport;
  readonly initialFrontier?: Partial<StudioEngineTileStorageInitialFrontier>;
  readonly limits?: Partial<StudioEngineTileStorageLimits>;
  readonly timeoutMs?: number;
}

export interface StudioEngineTileStoragePersistOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface StudioEngineTileStorageDurableReceipt {
  readonly kind: "studio-engine-tile-storage-durable-receipt";
  readonly version: typeof STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION;
  readonly disposition: StudioEngineTileStorageCommitAck["disposition"];
  readonly requestSequence: number;
  readonly sessionEpoch: number;
  readonly transactionSequence: number;
  readonly transactionIdentity: string;
  readonly durableRevision: number;
  readonly documentId: string;
  readonly commandIdentity: string;
  readonly commandSequence: number;
  readonly documentRevision: number;
  readonly journalLogicalByteOffset: bigint;
  readonly journalByteLength: number;
  readonly journalPayloadChecksum: string;
  readonly tileCount: number;
  readonly totalPayloadBytes: bigint;
}

export interface StudioEngineTileStorageBridgeStats
extends StudioEngineTileStorageInitialFrontier {
  readonly requestSequence: number;
  readonly durableReceiptCount: number;
  readonly retryRequired: boolean;
  readonly disposed: boolean;
}

export type StudioEngineTileStorageBridgeErrorCode =
  | "disposed"
  | "invalid-commit"
  | "invalid-journal"
  | "payload-source-failed"
  | "invalid-tile-payload"
  | "payload-budget-exceeded"
  | "sequence-gap"
  | "sequence-conflict"
  | "retry-required"
  | "timeout"
  | "aborted"
  | "transport-failed"
  | "ack-invalid"
  | "ack-partial"
  | "ack-duplicate"
  | "ack-conflict";

export class StudioEngineTileStorageBridgeError extends Error {
  public readonly code: StudioEngineTileStorageBridgeErrorCode;
  public override readonly cause?: unknown;

  public constructor(
    code: StudioEngineTileStorageBridgeErrorCode,
    message: string,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(message);
    this.name = "StudioEngineTileStorageBridgeError";
    this.code = code;
    this.cause = options.cause;
  }
}

interface NormalizedCommit {
  readonly receipt: StudioEngineTileCommitReceipt;
  readonly journalBytes: Uint8Array;
  readonly journalPayloadChecksum: string;
  readonly transactionIdentity: string;
}

interface RetryBarrier {
  readonly transactionSequence: number;
  readonly transactionIdentity: string;
  readonly prepared: PreparedTransaction;
}

interface PreparedTransaction {
  readonly normalized: NormalizedCommit;
  readonly tiles: readonly StudioEngineTileStorageTilePayload[];
  readonly totalPayloadBytes: bigint;
}

interface JobAbort {
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly timedOut: () => boolean;
  dispose(): void;
}

interface AckValidationSuccess {
  readonly ok: true;
  readonly ack: StudioEngineTileStorageCommitAck;
}

interface AckValidationFailure {
  readonly ok: false;
  readonly code:
    | "ack-invalid"
    | "ack-partial"
    | "ack-duplicate"
    | "ack-conflict";
}

type AckValidation = AckValidationSuccess | AckValidationFailure;

function fail(
  code: StudioEngineTileStorageBridgeErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StudioEngineTileStorageBridgeError(code, message, { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectExactRecord(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> | null {
  try {
    if (!isRecord(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== "string")
      || keys.some((key) => !Object.hasOwn(descriptors, key))
    ) {
      return null;
    }
    const value: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) return null;
      value[key] = descriptor.value;
    }
    return value;
  } catch {
    return null;
  }
}

function inspectDenseArray(
  input: unknown,
  maximum: number,
): readonly unknown[] | null {
  try {
    if (!Array.isArray(input)) return null;
    const length = Object.getOwnPropertyDescriptor(input, "length")?.value;
    if (
      !Number.isSafeInteger(length)
      || length < 0
      || length > maximum
      || Reflect.ownKeys(input).length !== length + 1
    ) {
      return null;
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) return null;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return null;
  }
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

function positiveByteLength(value: unknown): value is number {
  return positiveSequence(value);
}

function nonNegativeBigInt(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= BigInt(0);
}

function safeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ID_CHARACTERS
    && SAFE_ID.test(value);
}

function safeDigest(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256;
}

function copyArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function copyBytesBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function copyUint8Array(value: unknown): Uint8Array | null {
  try {
    if (
      !(value instanceof Uint8Array)
      || Object.getPrototypeOf(value) !== Uint8Array.prototype
      || !(value.buffer instanceof ArrayBuffer)
      || value.byteLength <= 0
    ) {
      return null;
    }
    return Uint8Array.from(value);
  } catch {
    return null;
  }
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout)
    || timeout < 1
    || timeout > MAX_TIMEOUT_MS
  ) {
    fail(
      "invalid-commit",
      `timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}.`,
    );
  }
  return timeout;
}

function normalizeNonNegativeRevision(
  value: number | undefined,
  fallback = 0,
): number {
  const resolved = value ?? fallback;
  if (!revision(resolved)) {
    fail("invalid-commit", "Initial storage frontier is invalid.");
  }
  return resolved;
}

function normalizeJournalByteLength(value: bigint | undefined): bigint {
  const resolved = value ?? BigInt(0);
  if (!nonNegativeBigInt(resolved)) {
    fail("invalid-commit", "Initial journal byte length is invalid.");
  }
  return resolved;
}

function normalizeLimits(
  input: Partial<StudioEngineTileStorageLimits> | undefined,
): StudioEngineTileStorageLimits {
  const maxTilesPerCommit =
    input?.maxTilesPerCommit ?? DEFAULT_MAX_TILES_PER_COMMIT;
  const maxPayloadBytes = input?.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  if (
    !positiveSequence(maxTilesPerCommit)
    || !nonNegativeBigInt(maxPayloadBytes)
    || maxPayloadBytes === BigInt(0)
  ) {
    fail("invalid-commit", "Studio engine storage limits are invalid.");
  }
  return Object.freeze({ maxTilesPerCommit, maxPayloadBytes });
}

function startJobAbort(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): JobAbort {
  const controller = new AbortController();
  let didTimeout = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error("Studio engine tile storage persistence timed out."));
  }, timeoutMs);
  return {
    controller,
    signal: controller.signal,
    timeout,
    timedOut: () => didTimeout,
    dispose() {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function aborted(job: JobAbort): never {
  if (job.timedOut()) {
    fail("timeout", "Studio engine tile storage persistence timed out.");
  }
  fail("aborted", "Studio engine tile storage persistence was aborted.", job.signal.reason);
}

async function awaitAbortable<T>(
  value: Promise<T> | T,
  job: JobAbort,
): Promise<T> {
  if (job.signal.aborted) aborted(job);
  let abortListener: (() => void) | null = null;
  const pending = Promise.resolve(value);
  // Always observe a late transport/source rejection after the abort race has settled.
  void pending.catch(() => undefined);
  const abortedPromise = new Promise<never>((_resolve, reject) => {
    abortListener = () => {
      try {
        aborted(job);
      } catch (error) {
        reject(error);
      }
    };
    job.signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    return await Promise.race([pending, abortedPromise]);
  } finally {
    if (abortListener) {
      job.signal.removeEventListener("abort", abortListener);
    }
  }
}

function tileReceiptFromUnknown(
  value: unknown,
): StudioEngineTileReceiptEntry | null {
  const record = inspectExactRecord(value, [
    "tileId",
    "column",
    "row",
    "layerId",
    "layerIndex",
    "logicalTileIndex",
    "logicalByteOffset",
    "shardIndex",
    "shardByteOffset",
    "baseTileRevision",
    "tileRevision",
    "contentDigest",
    "byteLength",
  ]);
  if (
    !record
    || !safeId(record.tileId)
    || !safeId(record.layerId)
    || !revision(record.column)
    || !revision(record.row)
    || !revision(record.layerIndex)
    || !nonNegativeBigInt(record.logicalTileIndex)
    || !nonNegativeBigInt(record.logicalByteOffset)
    || !nonNegativeBigInt(record.shardIndex)
    || !nonNegativeBigInt(record.shardByteOffset)
    || !revision(record.baseTileRevision)
    || !positiveSequence(record.tileRevision)
    || record.tileRevision !== record.baseTileRevision + 1
    || !safeDigest(record.contentDigest)
    || !positiveByteLength(record.byteLength)
  ) {
    return null;
  }
  return Object.freeze({
    tileId: record.tileId,
    column: record.column,
    row: record.row,
    layerId: record.layerId,
    layerIndex: record.layerIndex,
    logicalTileIndex: record.logicalTileIndex,
    logicalByteOffset: record.logicalByteOffset,
    shardIndex: record.shardIndex,
    shardByteOffset: record.shardByteOffset,
    baseTileRevision: record.baseTileRevision,
    tileRevision: record.tileRevision,
    contentDigest: record.contentDigest,
    byteLength: record.byteLength,
  });
}

function normalizedReceipt(
  value: unknown,
  maximumTiles: number,
): StudioEngineTileCommitReceipt | null {
  const record = inspectExactRecord(value, [
    "kind",
    "version",
    "encoding",
    "documentId",
    "commandIdentity",
    "commandSequence",
    "baseDocumentRevision",
    "documentRevision",
    "layerId",
    "baseLayerRevision",
    "layerRevision",
    "tiles",
    "journalSequence",
    "journalDigest",
    "journalByteLength",
    "journalLogicalByteOffset",
  ]);
  const rawTiles = record
    ? inspectDenseArray(record.tiles, maximumTiles)
    : null;
  if (
    !record
    || record.kind !== "studio-engine-tile-commit-receipt"
    || record.version !== STUDIO_ENGINE_TILE_AUTHORITY_VERSION
    || record.encoding !== STUDIO_ENGINE_TILE_ENCODING
    || !safeId(record.documentId)
    || !safeDigest(record.commandIdentity)
    || !positiveSequence(record.commandSequence)
    || !revision(record.baseDocumentRevision)
    || record.documentRevision !== record.baseDocumentRevision + 1
    || !safeId(record.layerId)
    || !revision(record.baseLayerRevision)
    || record.layerRevision !== record.baseLayerRevision + 1
    || !rawTiles
    || rawTiles.length === 0
    || !positiveSequence(record.journalSequence)
    || !safeDigest(record.journalDigest)
    || !positiveByteLength(record.journalByteLength)
    || !nonNegativeBigInt(record.journalLogicalByteOffset)
  ) {
    return null;
  }
  const tiles: StudioEngineTileReceiptEntry[] = [];
  const identities = new Set<string>();
  for (const rawTile of rawTiles) {
    const tile = tileReceiptFromUnknown(rawTile);
    const identity = tile
      ? `${tile.layerId}\u0000${tile.tileId}\u0000${tile.logicalTileIndex}`
      : "";
    if (
      !tile
      || tile.layerId !== record.layerId
      || identities.has(identity)
    ) {
      return null;
    }
    identities.add(identity);
    tiles.push(tile);
  }
  return Object.freeze({
    kind: "studio-engine-tile-commit-receipt",
    version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    documentId: record.documentId,
    commandIdentity: record.commandIdentity,
    commandSequence: record.commandSequence,
    baseDocumentRevision: record.baseDocumentRevision,
    documentRevision: record.documentRevision as number,
    layerId: record.layerId,
    baseLayerRevision: record.baseLayerRevision,
    layerRevision: record.layerRevision as number,
    tiles: Object.freeze(tiles),
    journalSequence: record.journalSequence,
    journalDigest: record.journalDigest,
    journalByteLength: record.journalByteLength,
    journalLogicalByteOffset: record.journalLogicalByteOffset,
  });
}

function journalFrameMatchesReceipt(
  bytes: Uint8Array,
  receipt: StudioEngineTileCommitReceipt,
): boolean {
  try {
    const text = TEXT_DECODER.decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) return false;
    if (
      canonicalStudioCommandJson(parsed as StudioCommandJsonValue) !== text
      || parsed.recordDigest !== receipt.journalDigest
      || parsed.sequence !== receipt.journalSequence
      || parsed.documentId !== receipt.documentId
      || parsed.commandIdentity !== receipt.commandIdentity
      || parsed.commandSequence !== receipt.commandSequence
      || parsed.baseDocumentRevision !== receipt.baseDocumentRevision
      || parsed.documentRevision !== receipt.documentRevision
      || parsed.layerId !== receipt.layerId
      || parsed.baseLayerRevision !== receipt.baseLayerRevision
      || parsed.layerRevision !== receipt.layerRevision
    ) {
      return false;
    }
    const deltas = Array.isArray(parsed.deltas) ? parsed.deltas : null;
    if (!deltas || deltas.length !== receipt.tiles.length) return false;
    for (let index = 0; index < deltas.length; index += 1) {
      const delta = deltas[index];
      const tile = receipt.tiles[index]!;
      if (
        !isRecord(delta)
        || delta.index !== index
        || delta.tileId !== tile.tileId
        || delta.column !== tile.column
        || delta.row !== tile.row
        || delta.layerId !== tile.layerId
        || delta.layerIndex !== tile.layerIndex
        || delta.logicalTileIndex !== tile.logicalTileIndex.toString()
        || delta.logicalByteOffset !== tile.logicalByteOffset.toString()
        || delta.shardIndex !== tile.shardIndex.toString()
        || delta.shardByteOffset !== tile.shardByteOffset.toString()
        || delta.baseTileRevision !== tile.baseTileRevision
        || delta.tileRevision !== tile.tileRevision
        || delta.byteLength !== tile.byteLength
        || delta.contentDigest !== tile.contentDigest
      ) {
        return false;
      }
    }
    const { recordDigest: _recordDigest, ...body } = parsed;
    return studioCommandPayloadChecksum(body as StudioCommandJsonValue)
      === receipt.journalDigest;
  } catch {
    return false;
  }
}

function transactionIdentity(
  receipt: StudioEngineTileCommitReceipt,
  journalPayloadChecksum: string,
): string {
  return `studio-engine-storage-v2:${studioCommandPayloadChecksum({
    authorityVersion: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    documentId: receipt.documentId,
    commandIdentity: receipt.commandIdentity,
    commandSequence: receipt.commandSequence,
    baseDocumentRevision: receipt.baseDocumentRevision,
    documentRevision: receipt.documentRevision,
    layerId: receipt.layerId,
    baseLayerRevision: receipt.baseLayerRevision,
    layerRevision: receipt.layerRevision,
    transactionSequence: receipt.journalSequence,
    journal: {
      logicalByteOffset: receipt.journalLogicalByteOffset.toString(),
      byteLength: receipt.journalByteLength,
      recordDigest: receipt.journalDigest,
      payloadChecksum: journalPayloadChecksum,
    },
    tiles: receipt.tiles.map((tile, index) => ({
      index,
      tileId: tile.tileId,
      layerId: tile.layerId,
      logicalTileIndex: tile.logicalTileIndex.toString(),
      logicalByteOffset: tile.logicalByteOffset.toString(),
      shardIndex: tile.shardIndex.toString(),
      shardByteOffset: tile.shardByteOffset.toString(),
      tileRevision: tile.tileRevision,
      byteLength: tile.byteLength,
      contentDigest: tile.contentDigest,
    })),
  })}`;
}

function normalizeCommit(
  input: unknown,
  maximumTiles: number,
): NormalizedCommit {
  const result = inspectExactRecord(input, ["status", "receipt", "journalBytes"]);
  if (!result || result.status !== "committed") {
    fail("invalid-commit", "Only a committed tile-authority result can be persisted.");
  }
  const receipt = normalizedReceipt(result.receipt, maximumTiles);
  const journalBytes = copyUint8Array(result.journalBytes);
  if (!receipt || !journalBytes) {
    fail("invalid-commit", "Tile-authority receipt is malformed.");
  }
  if (
    journalBytes.byteLength !== receipt.journalByteLength
    || !journalFrameMatchesReceipt(journalBytes, receipt)
  ) {
    fail("invalid-journal", "Tile-authority journal frame does not match its receipt.");
  }
  const journalPayloadChecksum = `bytes-v1:${studioTileDocDigest(journalBytes)}`;
  return Object.freeze({
    receipt,
    journalBytes,
    journalPayloadChecksum,
    transactionIdentity: transactionIdentity(receipt, journalPayloadChecksum),
  });
}

function normalizedTilePayload(
  value: unknown,
  expected: StudioEngineTileReceiptEntry,
): ArrayBuffer | null {
  const record = inspectExactRecord(value, [
    "tileId",
    "column",
    "row",
    "layerId",
    "layerIndex",
    "logicalTileIndex",
    "logicalByteOffset",
    "shardIndex",
    "shardByteOffset",
    "baseTileRevision",
    "tileRevision",
    "contentDigest",
    "byteLength",
    "encoded",
  ]);
  if (
    !record
    || record.tileId !== expected.tileId
    || record.column !== expected.column
    || record.row !== expected.row
    || record.layerId !== expected.layerId
    || record.layerIndex !== expected.layerIndex
    || record.logicalTileIndex !== expected.logicalTileIndex
    || record.logicalByteOffset !== expected.logicalByteOffset
    || record.shardIndex !== expected.shardIndex
    || record.shardByteOffset !== expected.shardByteOffset
    || record.baseTileRevision !== expected.baseTileRevision
    || record.tileRevision !== expected.tileRevision
    || record.contentDigest !== expected.contentDigest
    || record.byteLength !== expected.byteLength
    || !(record.encoded instanceof ArrayBuffer)
    || record.encoded.byteLength !== expected.byteLength
  ) {
    return null;
  }
  const copy = copyArrayBuffer(record.encoded);
  return studioEngineRgba16FloatTileDigest(copy) === expected.contentDigest
    ? copy
    : null;
}

function freezeRequest(
  request: StudioEngineTileStorageCommitRequest,
): StudioEngineTileStorageCommitRequest {
  Object.freeze(request.journal);
  for (const tile of request.tiles) Object.freeze(tile);
  Object.freeze(request.tiles);
  return Object.freeze(request);
}

function journalAckFromUnknown(
  input: unknown,
): StudioEngineTileStorageJournalAck | null {
  const value = inspectExactRecord(input, [
    "sequence",
    "logicalByteOffset",
    "byteLength",
    "recordDigest",
    "payloadChecksum",
  ]);
  if (
    !value
    || !positiveSequence(value.sequence)
    || !nonNegativeBigInt(value.logicalByteOffset)
    || !positiveByteLength(value.byteLength)
    || !safeDigest(value.recordDigest)
    || !safeDigest(value.payloadChecksum)
  ) {
    return null;
  }
  return Object.freeze({
    sequence: value.sequence,
    logicalByteOffset: value.logicalByteOffset,
    byteLength: value.byteLength,
    recordDigest: value.recordDigest,
    payloadChecksum: value.payloadChecksum,
  });
}

function tileAckFromUnknown(
  input: unknown,
): StudioEngineTileStorageTileAck | null {
  const value = inspectExactRecord(input, [
    "index",
    "tileId",
    "logicalTileIndex",
    "logicalByteOffset",
    "shardIndex",
    "shardByteOffset",
    "tileRevision",
    "byteLength",
    "contentDigest",
    "payloadChecksum",
  ]);
  if (
    !value
    || !revision(value.index)
    || !safeId(value.tileId)
    || !nonNegativeBigInt(value.logicalTileIndex)
    || !nonNegativeBigInt(value.logicalByteOffset)
    || !nonNegativeBigInt(value.shardIndex)
    || !nonNegativeBigInt(value.shardByteOffset)
    || !positiveSequence(value.tileRevision)
    || !positiveByteLength(value.byteLength)
    || !safeDigest(value.contentDigest)
    || !safeDigest(value.payloadChecksum)
  ) {
    return null;
  }
  return Object.freeze({
    index: value.index,
    tileId: value.tileId,
    logicalTileIndex: value.logicalTileIndex,
    logicalByteOffset: value.logicalByteOffset,
    shardIndex: value.shardIndex,
    shardByteOffset: value.shardByteOffset,
    tileRevision: value.tileRevision,
    byteLength: value.byteLength,
    contentDigest: value.contentDigest,
    payloadChecksum: value.payloadChecksum,
  });
}

function validateAck(
  input: unknown,
  request: StudioEngineTileStorageCommitRequest,
): AckValidation {
  const value = inspectExactRecord(input, [
    "kind",
    "version",
    "complete",
    "disposition",
    "requestSequence",
    "sessionEpoch",
    "transactionSequence",
    "transactionIdentity",
    "expectedDurableRevision",
    "durableRevision",
    "documentId",
    "commandSequence",
    "documentRevision",
    "writeCount",
    "totalPayloadBytes",
    "journal",
    "tiles",
  ]);
  if (!value) return { ok: false, code: "ack-invalid" };
  if (value.complete !== true) return { ok: false, code: "ack-partial" };
  if (
    value.kind !== STUDIO_ENGINE_TILE_STORAGE_ACK_KIND
    || value.version !== STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION
    || (
      value.disposition !== "committed"
      && value.disposition !== "idempotent-replay"
    )
    || !positiveSequence(value.requestSequence)
    || !positiveSequence(value.sessionEpoch)
    || !positiveSequence(value.transactionSequence)
    || !safeDigest(value.transactionIdentity)
    || !revision(value.expectedDurableRevision)
    || !positiveSequence(value.durableRevision)
    || !safeId(value.documentId)
    || !positiveSequence(value.commandSequence)
    || !positiveSequence(value.documentRevision)
    || !positiveSequence(value.writeCount)
    || !nonNegativeBigInt(value.totalPayloadBytes)
  ) {
    return { ok: false, code: "ack-invalid" };
  }
  const journal = journalAckFromUnknown(value.journal);
  const rawTiles = inspectDenseArray(value.tiles, request.tiles.length + 1);
  if (!journal || !rawTiles) return { ok: false, code: "ack-invalid" };
  if (
    rawTiles.length !== request.tiles.length
    || value.writeCount !== request.writeCount
  ) {
    return { ok: false, code: "ack-partial" };
  }
  const tiles: StudioEngineTileStorageTileAck[] = [];
  const indexes = new Set<number>();
  const identities = new Set<string>();
  for (const rawTile of rawTiles) {
    const tile = tileAckFromUnknown(rawTile);
    if (!tile) return { ok: false, code: "ack-invalid" };
    const identity = `${tile.tileId}\u0000${tile.logicalTileIndex}`;
    if (indexes.has(tile.index) || identities.has(identity)) {
      return { ok: false, code: "ack-duplicate" };
    }
    indexes.add(tile.index);
    identities.add(identity);
    tiles.push(tile);
  }
  if (
    value.requestSequence !== request.requestSequence
    || value.sessionEpoch !== request.sessionEpoch
    || value.transactionSequence !== request.transactionSequence
    || value.transactionIdentity !== request.transactionIdentity
    || value.expectedDurableRevision !== request.expectedDurableRevision
    || value.durableRevision !== request.expectedDurableRevision + 1
    || value.documentId !== request.documentId
    || value.commandSequence !== request.commandSequence
    || value.documentRevision !== request.documentRevision
    || value.totalPayloadBytes !== request.totalPayloadBytes
    || journal.sequence !== request.journal.sequence
    || journal.logicalByteOffset !== request.journal.logicalByteOffset
    || journal.byteLength !== request.journal.byteLength
    || journal.recordDigest !== request.journal.recordDigest
    || journal.payloadChecksum !== request.journal.payloadChecksum
  ) {
    return { ok: false, code: "ack-conflict" };
  }
  for (let index = 0; index < request.tiles.length; index += 1) {
    const expected = request.tiles[index]!;
    const tile = tiles[index];
    if (
      !tile
      || tile.index !== expected.index
      || tile.tileId !== expected.tileId
      || tile.logicalTileIndex !== expected.logicalTileIndex
      || tile.logicalByteOffset !== expected.logicalByteOffset
      || tile.shardIndex !== expected.shardIndex
      || tile.shardByteOffset !== expected.shardByteOffset
      || tile.tileRevision !== expected.tileRevision
      || tile.byteLength !== expected.byteLength
      || tile.contentDigest !== expected.contentDigest
      || tile.payloadChecksum !== expected.payloadChecksum
    ) {
      return { ok: false, code: "ack-conflict" };
    }
  }
  return {
    ok: true,
    ack: Object.freeze({
      kind: STUDIO_ENGINE_TILE_STORAGE_ACK_KIND,
      version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
      complete: true,
      disposition: value.disposition,
      requestSequence: value.requestSequence,
      sessionEpoch: value.sessionEpoch,
      transactionSequence: value.transactionSequence,
      transactionIdentity: value.transactionIdentity,
      expectedDurableRevision: value.expectedDurableRevision,
      durableRevision: value.durableRevision,
      documentId: value.documentId,
      commandSequence: value.commandSequence,
      documentRevision: value.documentRevision,
      writeCount: value.writeCount,
      totalPayloadBytes: value.totalPayloadBytes,
      journal,
      tiles: Object.freeze(tiles),
    }),
  };
}

/** Exact, duplicate-free transfer list for a future Storage Worker adapter. */
export function studioEngineTileStorageRequestTransfers(
  request: StudioEngineTileStorageCommitRequest,
): Transferable[] {
  return [
    request.journal.data,
    ...request.tiles.map((tile) => tile.data),
  ];
}

/**
 * Serial, one-document durability coordinator. A timeout, abort, transport failure, or malformed
 * ACK creates a retry barrier: only an exact replay of that transaction may cross the boundary
 * until the backend proves whether it committed. Later transactions fail closed.
 */
export class StudioEngineTileStorageBridge {
  public readonly documentId: string;
  public readonly sessionEpoch: number;

  readonly #payloadSource: StudioEngineTileStoragePayloadSource;
  readonly #transport: StudioEngineTileStorageTransport;
  readonly #limits: StudioEngineTileStorageLimits;
  readonly #defaultTimeoutMs: number;
  readonly #receiptBySequence = new Map<
  number,
  Readonly<{
    identity: string;
    receipt: StudioEngineTileStorageDurableReceipt;
  }>
  >();

  #durableRevision: number;
  #documentRevision: number;
  #commandSequence: number;
  #transactionSequence: number;
  #journalByteLength: bigint;
  #requestSequence = 0;
  #retryBarrier: RetryBarrier | null = null;
  #disposed = false;
  #activeAbort: AbortController | null = null;
  #tail: Promise<void> = Promise.resolve();

  public constructor(options: StudioEngineTileStorageBridgeOptions) {
    if (
      !safeId(options.documentId)
      || !positiveSequence(options.sessionEpoch)
      || !options.payloadSource
      || typeof options.payloadSource.readTile !== "function"
      || !options.transport
      || typeof options.transport.commit !== "function"
    ) {
      fail("invalid-commit", "Studio engine tile storage bridge options are invalid.");
    }
    const frontier = options.initialFrontier;
    this.documentId = options.documentId;
    this.sessionEpoch = options.sessionEpoch;
    this.#payloadSource = options.payloadSource;
    this.#transport = options.transport;
    this.#limits = normalizeLimits(options.limits);
    this.#defaultTimeoutMs = normalizeTimeout(options.timeoutMs);
    this.#durableRevision = normalizeNonNegativeRevision(
      frontier?.durableRevision,
    );
    this.#documentRevision = normalizeNonNegativeRevision(
      frontier?.documentRevision,
    );
    this.#commandSequence = normalizeNonNegativeRevision(
      frontier?.commandSequence,
    );
    this.#transactionSequence = normalizeNonNegativeRevision(
      frontier?.transactionSequence,
    );
    this.#journalByteLength = normalizeJournalByteLength(
      frontier?.journalByteLength,
    );
  }

  public stats(): StudioEngineTileStorageBridgeStats {
    return Object.freeze({
      durableRevision: this.#durableRevision,
      documentRevision: this.#documentRevision,
      commandSequence: this.#commandSequence,
      transactionSequence: this.#transactionSequence,
      journalByteLength: this.#journalByteLength,
      requestSequence: this.#requestSequence,
      durableReceiptCount: this.#receiptBySequence.size,
      retryRequired: this.#retryBarrier !== null,
      disposed: this.#disposed,
    });
  }

  public persist(
    committed: CommittedTileResult | unknown,
    options: StudioEngineTileStoragePersistOptions = {},
  ): Promise<StudioEngineTileStorageDurableReceipt> {
    const run = this.#tail.then(
      () => this.#persistSerial(committed, options),
      () => this.#persistSerial(committed, options),
    );
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      await this.#tail;
      return;
    }
    this.#disposed = true;
    this.#activeAbort?.abort(new Error("Studio engine tile storage bridge disposed."));
    await this.#tail;
    try {
      await this.#transport.dispose?.();
    } catch {
      // Disposal cannot turn an already closed durability boundary back into a usable one.
    }
  }

  async #persistSerial(
    committed: unknown,
    options: StudioEngineTileStoragePersistOptions,
  ): Promise<StudioEngineTileStorageDurableReceipt> {
    if (this.#disposed) {
      fail("disposed", "Studio engine tile storage bridge is disposed.");
    }
    const timeoutMs = normalizeTimeout(options.timeoutMs ?? this.#defaultTimeoutMs);
    const job = startJobAbort(options.signal, timeoutMs);
    this.#activeAbort = job.controller;
    let transportStarted = false;
    let normalized: NormalizedCommit | null = null;
    let prepared: PreparedTransaction | null = null;
    try {
      if (job.signal.aborted) aborted(job);
      normalized = normalizeCommit(
        committed,
        this.#limits.maxTilesPerCommit,
      );
      const receipt = normalized.receipt;
      if (receipt.documentId !== this.documentId) {
        fail("invalid-commit", "Tile commit belongs to a different document.");
      }

      const durable = this.#receiptBySequence.get(receipt.journalSequence);
      if (durable) {
        if (durable.identity !== normalized.transactionIdentity) {
          fail(
            "sequence-conflict",
            "A durable transaction sequence was replayed with different content.",
          );
        }
        return durable.receipt;
      }
      if (
        this.#retryBarrier
        && (
          this.#retryBarrier.transactionSequence !== receipt.journalSequence
          || this.#retryBarrier.transactionIdentity !== normalized.transactionIdentity
        )
      ) {
        fail(
          "retry-required",
          "An ambiguous storage transaction must be replayed exactly before later commits.",
        );
      }
      if (receipt.journalSequence !== this.#transactionSequence + 1) {
        fail("sequence-gap", "Storage transaction sequence is not contiguous.");
      }
      if (receipt.commandSequence !== this.#commandSequence + 1) {
        fail("sequence-gap", "Storage command sequence is not contiguous.");
      }
      if (
        receipt.baseDocumentRevision !== this.#documentRevision
        || receipt.documentRevision !== this.#documentRevision + 1
      ) {
        fail("sequence-gap", "Storage document revision is not contiguous.");
      }
      if (receipt.journalLogicalByteOffset !== this.#journalByteLength) {
        fail("sequence-gap", "Journal logical append offset does not match the durable frontier.");
      }
      if (
        this.#durableRevision >= MAX_SAFE_REVISION
        || this.#requestSequence >= MAX_SAFE_REVISION
      ) {
        fail("sequence-gap", "Storage sequence space is exhausted.");
      }

      if (
        this.#retryBarrier
        && this.#retryBarrier.transactionIdentity === normalized.transactionIdentity
      ) {
        prepared = this.#retryBarrier.prepared;
      } else {
        const retainedTiles: StudioEngineTileStorageTilePayload[] = [];
        let retainedPayloadBytes = BigInt(normalized.journalBytes.byteLength);
        for (let index = 0; index < receipt.tiles.length; index += 1) {
          const expected = receipt.tiles[index]!;
          let sourceValue: unknown;
          try {
            sourceValue = await awaitAbortable(
              this.#payloadSource.readTile(expected, job.signal),
              job,
            );
          } catch (error) {
            if (error instanceof StudioEngineTileStorageBridgeError) throw error;
            fail(
              "payload-source-failed",
              "Authoritative tile payload source failed.",
              error,
            );
          }
          const data = normalizedTilePayload(sourceValue, expected);
          if (!data) {
            fail(
              "invalid-tile-payload",
              "Authoritative tile payload does not match the committed receipt.",
            );
          }
          retainedPayloadBytes += BigInt(data.byteLength);
          if (retainedPayloadBytes > this.#limits.maxPayloadBytes) {
            fail(
              "payload-budget-exceeded",
              "Durable tile transaction exceeds its payload budget.",
            );
          }
          retainedTiles.push(Object.freeze({
            index,
            tileId: expected.tileId,
            column: expected.column,
            row: expected.row,
            layerId: expected.layerId,
            layerIndex: expected.layerIndex,
            logicalTileIndex: expected.logicalTileIndex,
            logicalByteOffset: expected.logicalByteOffset,
            shardIndex: expected.shardIndex,
            shardByteOffset: expected.shardByteOffset,
            baseTileRevision: expected.baseTileRevision,
            tileRevision: expected.tileRevision,
            byteLength: expected.byteLength,
            contentDigest: expected.contentDigest,
            payloadChecksum: expected.contentDigest,
            data,
          }));
        }
        prepared = Object.freeze({
          normalized,
          tiles: Object.freeze(retainedTiles),
          totalPayloadBytes: retainedPayloadBytes,
        });
      }

      const requestSequence = this.#requestSequence + 1;
      this.#requestSequence = requestSequence;
      const requestTiles = prepared.tiles.map((tile) => ({
        ...tile,
        data: copyArrayBuffer(tile.data),
      }));
      const request = freezeRequest({
        kind: STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND,
        version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
        authorityVersion: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
        encoding: STUDIO_ENGINE_TILE_ENCODING,
        requestSequence,
        sessionEpoch: this.sessionEpoch,
        transactionSequence: receipt.journalSequence,
        transactionIdentity: normalized.transactionIdentity,
        expectedDurableRevision: this.#durableRevision,
        documentId: receipt.documentId,
        commandIdentity: receipt.commandIdentity,
        commandSequence: receipt.commandSequence,
        baseDocumentRevision: receipt.baseDocumentRevision,
        documentRevision: receipt.documentRevision,
        writeCount: requestTiles.length + 1,
        totalPayloadBytes: prepared.totalPayloadBytes,
        journal: {
          sequence: receipt.journalSequence,
          logicalByteOffset: receipt.journalLogicalByteOffset,
          byteLength: normalized.journalBytes.byteLength,
          recordDigest: receipt.journalDigest,
          payloadChecksum: normalized.journalPayloadChecksum,
          data: copyBytesBuffer(normalized.journalBytes),
        },
        tiles: Object.freeze(requestTiles),
      });

      let response: unknown;
      transportStarted = true;
      try {
        response = await awaitAbortable(
          this.#transport.commit(request, { signal: job.signal }),
          job,
        );
      } catch (error) {
        if (error instanceof StudioEngineTileStorageBridgeError) throw error;
        fail("transport-failed", "Storage transport failed.", error);
      }
      const validation = validateAck(response, request);
      if (!validation.ok) {
        fail(validation.code, "Storage transport returned a non-exact commit ACK.");
      }
      const ack = validation.ack;
      const durableReceipt = Object.freeze<StudioEngineTileStorageDurableReceipt>({
        kind: "studio-engine-tile-storage-durable-receipt",
        version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
        disposition: ack.disposition,
        requestSequence: ack.requestSequence,
        sessionEpoch: ack.sessionEpoch,
        transactionSequence: ack.transactionSequence,
        transactionIdentity: ack.transactionIdentity,
        durableRevision: ack.durableRevision,
        documentId: ack.documentId,
        commandIdentity: receipt.commandIdentity,
        commandSequence: ack.commandSequence,
        documentRevision: ack.documentRevision,
        journalLogicalByteOffset: ack.journal.logicalByteOffset,
        journalByteLength: ack.journal.byteLength,
        journalPayloadChecksum: ack.journal.payloadChecksum,
        tileCount: ack.tiles.length,
        totalPayloadBytes: ack.totalPayloadBytes,
      });

      this.#durableRevision = ack.durableRevision;
      this.#documentRevision = receipt.documentRevision;
      this.#commandSequence = receipt.commandSequence;
      this.#transactionSequence = receipt.journalSequence;
      this.#journalByteLength =
        receipt.journalLogicalByteOffset + BigInt(receipt.journalByteLength);
      this.#receiptBySequence.set(
        receipt.journalSequence,
        Object.freeze({
          identity: normalized.transactionIdentity,
          receipt: durableReceipt,
        }),
      );
      this.#retryBarrier = null;
      return durableReceipt;
    } catch (error) {
      if (transportStarted && normalized && prepared) {
        this.#retryBarrier = Object.freeze({
          transactionSequence: normalized.receipt.journalSequence,
          transactionIdentity: normalized.transactionIdentity,
          prepared,
        });
      }
      throw error;
    } finally {
      if (this.#activeAbort === job.controller) this.#activeAbort = null;
      job.dispose();
    }
  }
}
