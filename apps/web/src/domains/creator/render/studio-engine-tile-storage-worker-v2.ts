/**
 * Future-only OPFS transaction authority for Worker-owned linear RGBA16F tiles.
 *
 * This is intentionally not an adapter for the previous storage protocol. One transaction owns a
 * complete WAL frame, every full tile replacement, and one durable commit marker. The only ACK is
 * emitted after the following ordering has completed:
 *
 *   WAL bytes -> WAL flush -> tile writes -> marker write -> document flush -> marker flush -> ACK
 *
 * Logical offsets remain bigint throughout this module. The injected backend receives a bigint
 * shard identity and a proven Number-safe local offset only after the address has been split by
 * `shardBytes`.
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
} from "./studio-engine-tile-authority";
import {
  STUDIO_ENGINE_TILE_STORAGE_ACK_KIND,
  STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
  STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND,
  type StudioEngineTileStorageCommitAck,
  type StudioEngineTileStorageCommitRequest,
  type StudioEngineTileStorageJournalAck,
  type StudioEngineTileStorageTileAck,
  type StudioEngineTileStorageTransport,
} from "./studio-engine-tile-storage-bridge";
import { studioTileDocDigest } from "./studio-tiledoc-digest";

export const STUDIO_ENGINE_TILE_STORAGE_WAL_FORMAT =
  "toonspectrum:studio-engine-tile-storage-wal-v2" as const;
export const STUDIO_ENGINE_TILE_STORAGE_MARKER_FORMAT =
  "toonspectrum:studio-engine-tile-storage-marker-v2" as const;

const WAL_MAGIC = Uint8Array.from([0x54, 0x53, 0x57, 0x41, 0x4c, 0x56, 0x32, 0]);
const MARKER_MAGIC = Uint8Array.from([0x54, 0x53, 0x4d, 0x41, 0x52, 0x4b, 0x32, 0]);
const FRAME_PREFIX_BYTES = 32;
const DEFAULT_WINDOW_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_HEADER_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PAYLOAD_BYTES =
  BigInt(4) * BigInt(1024) * BigInt(1024) * BigInt(1024);
const MAX_U64 = (BigInt(1) << BigInt(64)) - BigInt(1);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

export type StudioEngineTileStorageWorkerV2File =
  | "document"
  | "wal"
  | "markers";

/**
 * A deliberately low-level OPFS boundary. A native implementation maps each `(file, shardIndex)`
 * pair to one `FileSystemSyncAccessHandle`.
 */
export interface StudioEngineTileStorageWorkerV2ShardBackend {
  readonly kind: "opfs-sync-shards" | "memory-sync-shards";
  readonly shardBytes: bigint;
  logicalByteLength(
    file: StudioEngineTileStorageWorkerV2File,
    signal: AbortSignal,
  ): Promise<bigint> | bigint;
  read(
    file: StudioEngineTileStorageWorkerV2File,
    shardIndex: bigint,
    shardByteOffset: number,
    byteLength: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> | Uint8Array;
  write(
    file: StudioEngineTileStorageWorkerV2File,
    shardIndex: bigint,
    shardByteOffset: number,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<void> | void;
  flush(
    file: StudioEngineTileStorageWorkerV2File,
    signal: AbortSignal,
  ): Promise<void> | void;
  truncate(
    file: StudioEngineTileStorageWorkerV2File,
    logicalByteLength: bigint,
    signal: AbortSignal,
  ): Promise<void> | void;
  close?(): Promise<void> | void;
}

export interface StudioEngineTileStorageWorkerV2Lease {
  readonly documentId: string;
  readonly ownerId: string;
  readonly leaseEpoch: number;
  readonly token: string;
}

export interface StudioEngineTileStorageWorkerV2LeasePort {
  acquire(
    input: Readonly<{
      documentId: string;
      ownerId: string;
      leaseEpoch: number;
      signal: AbortSignal;
    }>,
  ):
    | Promise<StudioEngineTileStorageWorkerV2Lease>
    | StudioEngineTileStorageWorkerV2Lease;
  assert(
    lease: StudioEngineTileStorageWorkerV2Lease,
    signal: AbortSignal,
  ): Promise<void> | void;
  release(lease: StudioEngineTileStorageWorkerV2Lease): Promise<void> | void;
}

export type StudioEngineTileStorageWorkerV2FaultStage =
  | "after-wal-write"
  | "after-wal-flush"
  | "after-tile-write"
  | "after-marker-write"
  | "after-document-flush"
  | "after-marker-flush"
  | "before-ack";

export interface StudioEngineTileStorageWorkerV2FaultPoint {
  readonly stage: StudioEngineTileStorageWorkerV2FaultStage;
  readonly transactionIdentity: string;
  readonly tileIndex?: number;
}

export interface StudioEngineTileStorageWorkerV2Options {
  readonly documentId: string;
  readonly ownerId: string;
  readonly sessionEpoch: number;
  readonly leaseEpoch: number;
  readonly backend: StudioEngineTileStorageWorkerV2ShardBackend;
  readonly leasePort: StudioEngineTileStorageWorkerV2LeasePort;
  readonly windowBytes?: number;
  readonly maxHeaderBytes?: number;
  readonly maxPayloadBytes?: bigint;
  readonly faultInjector?: (
    point: StudioEngineTileStorageWorkerV2FaultPoint,
  ) => Promise<void> | void;
}

export interface StudioEngineTileStorageWorkerV2Frontier {
  readonly durableRevision: number;
  readonly documentRevision: number;
  readonly commandSequence: number;
  readonly transactionSequence: number;
  readonly journalByteLength: bigint;
  readonly walByteLength: bigint;
  readonly markerByteLength: bigint;
}

export type StudioEngineTileStorageWorkerV2RecoveryResult =
  | {
      readonly status: "ready";
      readonly recoveredTransactions: number;
      readonly frontier: StudioEngineTileStorageWorkerV2Frontier;
    }
  | {
      readonly status: "retry-required";
      readonly reason:
        | "torn-wal"
        | "corrupt-wal"
        | "torn-marker"
        | "corrupt-marker";
      readonly recoveredTransactions: number;
      readonly frontier: StudioEngineTileStorageWorkerV2Frontier;
    };

export type StudioEngineTileStorageWorkerV2ErrorCode =
  | "invalid-options"
  | "invalid-request"
  | "invalid-payload"
  | "identity-conflict"
  | "sequence-conflict"
  | "lease-lost"
  | "recovery-required"
  | "corrupt-storage"
  | "aborted"
  | "disposed"
  | "backend-failed";

export class StudioEngineTileStorageWorkerV2Error extends Error {
  public readonly code: StudioEngineTileStorageWorkerV2ErrorCode;
  public override readonly cause?: unknown;

  public constructor(
    code: StudioEngineTileStorageWorkerV2ErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "StudioEngineTileStorageWorkerV2Error";
    this.code = code;
    this.cause = cause;
  }
}

interface NormalizedJournal {
  readonly sequence: number;
  readonly logicalByteOffset: bigint;
  readonly byteLength: number;
  readonly recordDigest: string;
  readonly payloadChecksum: string;
  readonly data: Uint8Array;
  readonly layerId: string;
  readonly baseLayerRevision: number;
  readonly layerRevision: number;
}

interface NormalizedTile {
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
  readonly data: Uint8Array;
}

interface NormalizedTransaction {
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
  readonly journal: NormalizedJournal;
  readonly tiles: readonly NormalizedTile[];
  readonly identityChecksum: string;
}

interface WalHeader {
  readonly format: typeof STUDIO_ENGINE_TILE_STORAGE_WAL_FORMAT;
  readonly version: typeof STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION;
  readonly transactionIdentity: string;
  readonly identityChecksum: string;
  readonly expectedDurableRevision: number;
  readonly documentId: string;
  readonly sessionEpoch: number;
  readonly transactionSequence: number;
  readonly commandIdentity: string;
  readonly commandSequence: number;
  readonly baseDocumentRevision: number;
  readonly documentRevision: number;
  readonly totalPayloadBytes: string;
  readonly journal: {
    readonly sequence: number;
    readonly logicalByteOffset: string;
    readonly byteLength: number;
    readonly recordDigest: string;
    readonly payloadChecksum: string;
    readonly payloadOffset: string;
    readonly layerId: string;
    readonly baseLayerRevision: number;
    readonly layerRevision: number;
  };
  readonly tiles: readonly {
    readonly index: number;
    readonly tileId: string;
    readonly column: number;
    readonly row: number;
    readonly layerId: string;
    readonly layerIndex: number;
    readonly logicalTileIndex: string;
    readonly logicalByteOffset: string;
    readonly shardIndex: string;
    readonly shardByteOffset: string;
    readonly baseTileRevision: number;
    readonly tileRevision: number;
    readonly byteLength: number;
    readonly contentDigest: string;
    readonly payloadChecksum: string;
    readonly payloadOffset: string;
  }[];
  readonly frameChecksum: string;
}

interface MarkerBody {
  readonly format: typeof STUDIO_ENGINE_TILE_STORAGE_MARKER_FORMAT;
  readonly version: typeof STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION;
  readonly transactionIdentity: string;
  readonly identityChecksum: string;
  readonly durableRevision: number;
  readonly documentId: string;
  readonly sessionEpoch: number;
  readonly transactionSequence: number;
  readonly commandIdentity: string;
  readonly commandSequence: number;
  readonly documentRevision: number;
  readonly journalLogicalByteOffset: string;
  readonly journalByteLength: number;
  readonly walLogicalByteOffset: string;
  readonly walByteLength: string;
  readonly markerChecksum: string;
}

interface WalRecord {
  readonly offset: bigint;
  readonly byteLength: bigint;
  readonly header: WalHeader;
  readonly transaction: NormalizedTransaction;
}

interface MarkerRecord {
  readonly offset: bigint;
  readonly byteLength: bigint;
  readonly body: MarkerBody;
}

interface DurableTransaction {
  readonly identityChecksum: string;
  readonly transaction: NormalizedTransaction;
  readonly walOffset: bigint;
  readonly walByteLength: bigint;
}

interface FramePrefix {
  readonly headerByteLength: number;
  readonly payloadByteLength: bigint;
  readonly frameByteLength: bigint;
}

interface ScanResult<T> {
  readonly records: readonly T[];
  readonly validByteLength: bigint;
  readonly tail: "none" | "torn" | "corrupt";
}

function fail(
  code: StudioEngineTileStorageWorkerV2ErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StudioEngineTileStorageWorkerV2Error(code, message, cause);
}

function safeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && SAFE_ID.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
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

function nonNegativeBigInt(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= BigInt(0);
}

function positiveBigInt(value: unknown): value is bigint {
  return typeof value === "bigint" && value > BigInt(0);
}

function parseDecimalBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function copyArrayBuffer(value: unknown): Uint8Array | null {
  if (
    !(value instanceof ArrayBuffer)
    || Object.getPrototypeOf(value) !== ArrayBuffer.prototype
  ) {
    return null;
  }
  return Uint8Array.from(new Uint8Array(value));
}

function assertSignal(signal: AbortSignal): void {
  if (signal.aborted) {
    fail("aborted", "Studio engine tile storage operation was aborted.", signal.reason);
  }
}

function json(value: unknown): StudioCommandJsonValue {
  return value as StudioCommandJsonValue;
}

function canonicalBytes(value: StudioCommandJsonValue): Uint8Array {
  return TEXT_ENCODER.encode(canonicalStudioCommandJson(value));
}

function checksumBytes(prefix: string, bytes: Uint8Array): string {
  return `${prefix}:${studioTileDocDigest(bytes)}`;
}

function identityBody(
  transaction: Omit<NormalizedTransaction, "identityChecksum">,
): StudioCommandJsonValue {
  return json({
    authorityVersion: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    encoding: STUDIO_ENGINE_TILE_ENCODING,
    documentId: transaction.documentId,
    commandIdentity: transaction.commandIdentity,
    commandSequence: transaction.commandSequence,
    baseDocumentRevision: transaction.baseDocumentRevision,
    documentRevision: transaction.documentRevision,
    layerId: transaction.journal.layerId,
    baseLayerRevision: transaction.journal.baseLayerRevision,
    layerRevision: transaction.journal.layerRevision,
    transactionSequence: transaction.transactionSequence,
    journal: {
      logicalByteOffset: transaction.journal.logicalByteOffset.toString(),
      byteLength: transaction.journal.byteLength,
      recordDigest: transaction.journal.recordDigest,
      payloadChecksum: transaction.journal.payloadChecksum,
    },
    tiles: transaction.tiles.map((tile) => ({
      index: tile.index,
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
  });
}

function transactionIdentityChecksum(
  transaction: Omit<NormalizedTransaction, "identityChecksum">,
): string {
  return studioCommandPayloadChecksum(identityBody(transaction));
}

function parseJournal(
  request: StudioEngineTileStorageCommitRequest,
  bytes: Uint8Array,
): Pick<NormalizedJournal, "layerId" | "baseLayerRevision" | "layerRevision"> {
  let parsed: unknown;
  try {
    const text = TEXT_DECODER.decode(bytes);
    parsed = JSON.parse(text) as unknown;
    if (canonicalStudioCommandJson(parsed) !== text) {
      fail("invalid-payload", "The engine journal frame is not canonical JSON.");
    }
  } catch (error) {
    if (error instanceof StudioEngineTileStorageWorkerV2Error) throw error;
    fail("invalid-payload", "The engine journal frame is invalid.", error);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("invalid-payload", "The engine journal frame must be an object.");
  }
  const record = parsed as Record<string, unknown>;
  const layerId = record.layerId;
  const baseLayerRevision = record.baseLayerRevision;
  const layerRevision = record.layerRevision;
  const recordDigest = record.recordDigest;
  const { recordDigest: _ignored, ...body } = record;
  if (
    !safeId(layerId)
    || !revision(baseLayerRevision)
    || layerRevision !== baseLayerRevision + 1
    || record.documentId !== request.documentId
    || record.commandIdentity !== request.commandIdentity
    || record.commandSequence !== request.commandSequence
    || record.baseDocumentRevision !== request.baseDocumentRevision
    || record.documentRevision !== request.documentRevision
    || record.sequence !== request.journal.sequence
    || recordDigest !== request.journal.recordDigest
    || studioCommandPayloadChecksum(json(body)) !== request.journal.recordDigest
  ) {
    fail("invalid-payload", "The engine journal frame conflicts with the transaction.");
  }
  return { layerId, baseLayerRevision, layerRevision };
}

function normalizeRequest(
  input: StudioEngineTileStorageCommitRequest | unknown,
  shardBytes: bigint,
  maxPayloadBytes: bigint,
): NormalizedTransaction {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("invalid-request", "Storage v2 request must be an object.");
  }
  const request = input as StudioEngineTileStorageCommitRequest;
  if (
    request.kind !== STUDIO_ENGINE_TILE_STORAGE_REQUEST_KIND
    || request.version !== STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION
    || request.authorityVersion !== STUDIO_ENGINE_TILE_AUTHORITY_VERSION
    || request.encoding !== STUDIO_ENGINE_TILE_ENCODING
    || !positiveSequence(request.requestSequence)
    || !positiveSequence(request.sessionEpoch)
    || !positiveSequence(request.transactionSequence)
    || !digest(request.transactionIdentity)
    || !revision(request.expectedDurableRevision)
    || !safeId(request.documentId)
    || !digest(request.commandIdentity)
    || !positiveSequence(request.commandSequence)
    || !revision(request.baseDocumentRevision)
    || request.documentRevision !== request.baseDocumentRevision + 1
    || !positiveSequence(request.writeCount)
    || !nonNegativeBigInt(request.totalPayloadBytes)
    || request.totalPayloadBytes > maxPayloadBytes
    || !Array.isArray(request.tiles)
    || request.tiles.length === 0
    || request.writeCount !== request.tiles.length + 1
  ) {
    fail("invalid-request", "Storage v2 request framing is invalid.");
  }

  const journalData = copyArrayBuffer(request.journal?.data);
  if (
    !request.journal
    || !positiveSequence(request.journal.sequence)
    || request.journal.sequence !== request.transactionSequence
    || !nonNegativeBigInt(request.journal.logicalByteOffset)
    || !positiveSequence(request.journal.byteLength)
    || !digest(request.journal.recordDigest)
    || !digest(request.journal.payloadChecksum)
    || !journalData
    || journalData.byteLength !== request.journal.byteLength
    || checksumBytes("bytes-v1", journalData) !== request.journal.payloadChecksum
  ) {
    fail("invalid-payload", "Storage v2 journal payload is invalid.");
  }
  const journalFrame = parseJournal(request, journalData);
  const journal: NormalizedJournal = Object.freeze({
    sequence: request.journal.sequence,
    logicalByteOffset: request.journal.logicalByteOffset,
    byteLength: request.journal.byteLength,
    recordDigest: request.journal.recordDigest,
    payloadChecksum: request.journal.payloadChecksum,
    data: journalData,
    ...journalFrame,
  });

  let payloadBytes = BigInt(journalData.byteLength);
  const identities = new Set<string>();
  const tiles: NormalizedTile[] = [];
  for (let index = 0; index < request.tiles.length; index += 1) {
    const source = request.tiles[index];
    const data = copyArrayBuffer(source?.data);
    const logicalByteOffset = source?.logicalByteOffset;
    const shardIndex = source?.shardIndex;
    const shardByteOffset = source?.shardByteOffset;
    if (
      !source
      || source.index !== index
      || !safeId(source.tileId)
      || !revision(source.column)
      || !revision(source.row)
      || !safeId(source.layerId)
      || source.layerId !== journal.layerId
      || !revision(source.layerIndex)
      || !nonNegativeBigInt(source.logicalTileIndex)
      || !nonNegativeBigInt(logicalByteOffset)
      || !nonNegativeBigInt(shardIndex)
      || !nonNegativeBigInt(shardByteOffset)
      || shardIndex !== logicalByteOffset / shardBytes
      || shardByteOffset !== logicalByteOffset % shardBytes
      || shardByteOffset > MAX_SAFE
      || !revision(source.baseTileRevision)
      || source.tileRevision !== source.baseTileRevision + 1
      || !positiveSequence(source.byteLength)
      || !digest(source.contentDigest)
      || !digest(source.payloadChecksum)
      || source.payloadChecksum !== source.contentDigest
      || !data
      || data.byteLength !== source.byteLength
      || studioEngineRgba16FloatTileDigest(data.buffer as ArrayBuffer)
        !== source.contentDigest
    ) {
      fail("invalid-payload", `Storage v2 tile ${index} is invalid.`);
    }
    const identity = `${source.layerId}\u0000${source.tileId}\u0000${source.logicalTileIndex}`;
    if (identities.has(identity)) {
      fail("invalid-payload", "Storage v2 transaction contains a duplicate tile.");
    }
    identities.add(identity);
    payloadBytes += BigInt(data.byteLength);
    if (payloadBytes > maxPayloadBytes) {
      fail("invalid-payload", "Storage v2 transaction exceeds its payload budget.");
    }
    tiles.push(Object.freeze({
      index,
      tileId: source.tileId,
      column: source.column,
      row: source.row,
      layerId: source.layerId,
      layerIndex: source.layerIndex,
      logicalTileIndex: source.logicalTileIndex,
      logicalByteOffset,
      shardIndex,
      shardByteOffset,
      baseTileRevision: source.baseTileRevision,
      tileRevision: source.tileRevision,
      byteLength: source.byteLength,
      contentDigest: source.contentDigest,
      payloadChecksum: source.payloadChecksum,
      data,
    }));
  }
  if (payloadBytes !== request.totalPayloadBytes) {
    fail("invalid-payload", "Storage v2 totalPayloadBytes is not exact.");
  }
  const transactionWithoutChecksum = {
    requestSequence: request.requestSequence,
    sessionEpoch: request.sessionEpoch,
    transactionSequence: request.transactionSequence,
    transactionIdentity: request.transactionIdentity,
    expectedDurableRevision: request.expectedDurableRevision,
    documentId: request.documentId,
    commandIdentity: request.commandIdentity,
    commandSequence: request.commandSequence,
    baseDocumentRevision: request.baseDocumentRevision,
    documentRevision: request.documentRevision,
    writeCount: request.writeCount,
    totalPayloadBytes: request.totalPayloadBytes,
    journal,
    tiles: Object.freeze(tiles),
  } satisfies Omit<NormalizedTransaction, "identityChecksum">;
  const identityChecksum = transactionIdentityChecksum(transactionWithoutChecksum);
  if (
    request.transactionIdentity
    !== `studio-engine-storage-v2:${identityChecksum}`
  ) {
    fail("identity-conflict", "Storage v2 transaction identity is not canonical.");
  }
  return Object.freeze({ ...transactionWithoutChecksum, identityChecksum });
}

function walHeaderBody(
  transaction: NormalizedTransaction,
): Omit<WalHeader, "frameChecksum"> {
  let payloadOffset = BigInt(0);
  const journalOffset = payloadOffset;
  payloadOffset += BigInt(transaction.journal.byteLength);
  const tiles = transaction.tiles.map((tile) => {
    const offset = payloadOffset;
    payloadOffset += BigInt(tile.byteLength);
    return {
      index: tile.index,
      tileId: tile.tileId,
      column: tile.column,
      row: tile.row,
      layerId: tile.layerId,
      layerIndex: tile.layerIndex,
      logicalTileIndex: tile.logicalTileIndex.toString(),
      logicalByteOffset: tile.logicalByteOffset.toString(),
      shardIndex: tile.shardIndex.toString(),
      shardByteOffset: tile.shardByteOffset.toString(),
      baseTileRevision: tile.baseTileRevision,
      tileRevision: tile.tileRevision,
      byteLength: tile.byteLength,
      contentDigest: tile.contentDigest,
      payloadChecksum: tile.payloadChecksum,
      payloadOffset: offset.toString(),
    };
  });
  return {
    format: STUDIO_ENGINE_TILE_STORAGE_WAL_FORMAT,
    version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
    transactionIdentity: transaction.transactionIdentity,
    identityChecksum: transaction.identityChecksum,
    expectedDurableRevision: transaction.expectedDurableRevision,
    documentId: transaction.documentId,
    sessionEpoch: transaction.sessionEpoch,
    transactionSequence: transaction.transactionSequence,
    commandIdentity: transaction.commandIdentity,
    commandSequence: transaction.commandSequence,
    baseDocumentRevision: transaction.baseDocumentRevision,
    documentRevision: transaction.documentRevision,
    totalPayloadBytes: transaction.totalPayloadBytes.toString(),
    journal: {
      sequence: transaction.journal.sequence,
      logicalByteOffset: transaction.journal.logicalByteOffset.toString(),
      byteLength: transaction.journal.byteLength,
      recordDigest: transaction.journal.recordDigest,
      payloadChecksum: transaction.journal.payloadChecksum,
      payloadOffset: journalOffset.toString(),
      layerId: transaction.journal.layerId,
      baseLayerRevision: transaction.journal.baseLayerRevision,
      layerRevision: transaction.journal.layerRevision,
    },
    tiles,
  };
}

function createWalHeader(transaction: NormalizedTransaction): WalHeader {
  const body = walHeaderBody(transaction);
  return Object.freeze({
    ...body,
    frameChecksum: studioCommandPayloadChecksum(json(body)),
  });
}

function markerBody(
  transaction: NormalizedTransaction,
  durableRevision: number,
  walOffset: bigint,
  walByteLength: bigint,
): Omit<MarkerBody, "markerChecksum"> {
  return {
    format: STUDIO_ENGINE_TILE_STORAGE_MARKER_FORMAT,
    version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
    transactionIdentity: transaction.transactionIdentity,
    identityChecksum: transaction.identityChecksum,
    durableRevision,
    documentId: transaction.documentId,
    sessionEpoch: transaction.sessionEpoch,
    transactionSequence: transaction.transactionSequence,
    commandIdentity: transaction.commandIdentity,
    commandSequence: transaction.commandSequence,
    documentRevision: transaction.documentRevision,
    journalLogicalByteOffset: transaction.journal.logicalByteOffset.toString(),
    journalByteLength: transaction.journal.byteLength,
    walLogicalByteOffset: walOffset.toString(),
    walByteLength: walByteLength.toString(),
  };
}

function createMarker(
  transaction: NormalizedTransaction,
  durableRevision: number,
  walOffset: bigint,
  walByteLength: bigint,
): MarkerBody {
  const body = markerBody(
    transaction,
    durableRevision,
    walOffset,
    walByteLength,
  );
  return Object.freeze({
    ...body,
    markerChecksum: studioCommandPayloadChecksum(json(body)),
  });
}

function createPrefix(
  magic: Uint8Array,
  headerByteLength: number,
  payloadByteLength: bigint,
): Uint8Array {
  if (
    !Number.isSafeInteger(headerByteLength)
    || headerByteLength <= 0
    || payloadByteLength < BigInt(0)
    || payloadByteLength > MAX_U64
  ) {
    fail("invalid-payload", "Storage v2 frame length is invalid.");
  }
  const prefix = new Uint8Array(FRAME_PREFIX_BYTES);
  prefix.set(magic, 0);
  const view = new DataView(prefix.buffer);
  view.setUint32(8, STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION, true);
  view.setUint32(12, headerByteLength, true);
  view.setBigUint64(16, payloadByteLength, true);
  view.setBigUint64(
    24,
    BigInt(FRAME_PREFIX_BYTES) + BigInt(headerByteLength) + payloadByteLength,
    true,
  );
  return prefix;
}

function parsePrefix(
  bytes: Uint8Array,
  magic: Uint8Array,
  maxHeaderBytes: number,
  maxPayloadBytes: bigint,
): FramePrefix | null {
  if (bytes.byteLength !== FRAME_PREFIX_BYTES) return null;
  for (let index = 0; index < magic.byteLength; index += 1) {
    if (bytes[index] !== magic[index]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  const headerByteLength = view.getUint32(12, true);
  const payloadByteLength = view.getBigUint64(16, true);
  const frameByteLength = view.getBigUint64(24, true);
  if (
    version !== STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION
    || headerByteLength < 1
    || headerByteLength > maxHeaderBytes
    || payloadByteLength > maxPayloadBytes
    || frameByteLength
      !== BigInt(FRAME_PREFIX_BYTES)
        + BigInt(headerByteLength)
        + payloadByteLength
  ) {
    return null;
  }
  return { headerByteLength, payloadByteLength, frameByteLength };
}

function splitSpan(
  globalByteOffset: bigint,
  remainingByteLength: number,
  shardBytes: bigint,
  windowBytes: number,
): {
  readonly shardIndex: bigint;
  readonly shardByteOffset: number;
  readonly byteLength: number;
} {
  const shardIndex = globalByteOffset / shardBytes;
  const localOffsetBigInt = globalByteOffset % shardBytes;
  if (localOffsetBigInt < BigInt(0) || localOffsetBigInt > MAX_SAFE) {
    fail("backend-failed", "OPFS local shard offset is not Number-safe.");
  }
  const available = shardBytes - localOffsetBigInt;
  const byteLength = Number(
    [
      BigInt(remainingByteLength),
      BigInt(windowBytes),
      available,
    ].reduce((minimum, value) => value < minimum ? value : minimum),
  );
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    fail("backend-failed", "OPFS shard window could not be represented safely.");
  }
  return {
    shardIndex,
    shardByteOffset: Number(localOffsetBigInt),
    byteLength,
  };
}

async function writeRange(
  backend: StudioEngineTileStorageWorkerV2ShardBackend,
  file: StudioEngineTileStorageWorkerV2File,
  globalByteOffset: bigint,
  bytes: Uint8Array,
  windowBytes: number,
  signal: AbortSignal,
): Promise<void> {
  let completed = 0;
  while (completed < bytes.byteLength) {
    assertSignal(signal);
    const span = splitSpan(
      globalByteOffset + BigInt(completed),
      bytes.byteLength - completed,
      backend.shardBytes,
      windowBytes,
    );
    await backend.write(
      file,
      span.shardIndex,
      span.shardByteOffset,
      bytes.subarray(completed, completed + span.byteLength),
      signal,
    );
    completed += span.byteLength;
  }
}

async function readRange(
  backend: StudioEngineTileStorageWorkerV2ShardBackend,
  file: StudioEngineTileStorageWorkerV2File,
  globalByteOffset: bigint,
  byteLength: number,
  windowBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const output = new Uint8Array(byteLength);
  let completed = 0;
  while (completed < byteLength) {
    assertSignal(signal);
    const span = splitSpan(
      globalByteOffset + BigInt(completed),
      byteLength - completed,
      backend.shardBytes,
      windowBytes,
    );
    const bytes = await backend.read(
      file,
      span.shardIndex,
      span.shardByteOffset,
      span.byteLength,
      signal,
    );
    if (
      !(bytes instanceof Uint8Array)
      || bytes.byteLength !== span.byteLength
    ) {
      fail("corrupt-storage", "OPFS shard returned a short range.");
    }
    output.set(bytes, completed);
    completed += span.byteLength;
  }
  return output;
}

function parseCanonicalHeader(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const text = TEXT_DECODER.decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || canonicalStudioCommandJson(parsed) !== text
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function transactionFromWal(
  headerValue: Record<string, unknown>,
  payloads: Readonly<{
    readonly journal: Uint8Array;
    readonly tiles: readonly Uint8Array[];
  }>,
  shardBytes: bigint,
): NormalizedTransaction | null {
  try {
    const frameChecksum = headerValue.frameChecksum;
    const { frameChecksum: _ignored, ...body } = headerValue;
    if (
      headerValue.format !== STUDIO_ENGINE_TILE_STORAGE_WAL_FORMAT
      || headerValue.version !== STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION
      || !digest(frameChecksum)
      || studioCommandPayloadChecksum(json(body)) !== frameChecksum
      || !safeId(headerValue.documentId)
      || !positiveSequence(headerValue.sessionEpoch)
      || !positiveSequence(headerValue.transactionSequence)
      || !digest(headerValue.transactionIdentity)
      || !digest(headerValue.identityChecksum)
      || !revision(headerValue.expectedDurableRevision)
      || !digest(headerValue.commandIdentity)
      || !positiveSequence(headerValue.commandSequence)
      || !revision(headerValue.baseDocumentRevision)
      || headerValue.documentRevision
        !== (headerValue.baseDocumentRevision as number) + 1
    ) {
      return null;
    }
    const totalPayloadBytes = parseDecimalBigInt(headerValue.totalPayloadBytes);
    const journalValue = headerValue.journal;
    const tilesValue = headerValue.tiles;
    if (
      totalPayloadBytes === null
      || !journalValue
      || typeof journalValue !== "object"
      || Array.isArray(journalValue)
      || !Array.isArray(tilesValue)
      || tilesValue.length !== payloads.tiles.length
    ) {
      return null;
    }
    const journalRecord = journalValue as Record<string, unknown>;
    const journalLogicalByteOffset =
      parseDecimalBigInt(journalRecord.logicalByteOffset);
    if (
      !positiveSequence(journalRecord.sequence)
      || !positiveSequence(journalRecord.byteLength)
      || !digest(journalRecord.recordDigest)
      || !digest(journalRecord.payloadChecksum)
      || !safeId(journalRecord.layerId)
      || !revision(journalRecord.baseLayerRevision)
      || journalRecord.layerRevision
        !== (journalRecord.baseLayerRevision as number) + 1
      || journalLogicalByteOffset === null
      || payloads.journal.byteLength !== journalRecord.byteLength
      || checksumBytes("bytes-v1", payloads.journal)
        !== journalRecord.payloadChecksum
    ) {
      return null;
    }
    const journal: NormalizedJournal = {
      sequence: journalRecord.sequence,
      logicalByteOffset: journalLogicalByteOffset,
      byteLength: journalRecord.byteLength,
      recordDigest: journalRecord.recordDigest,
      payloadChecksum: journalRecord.payloadChecksum,
      data: payloads.journal,
      layerId: journalRecord.layerId,
      baseLayerRevision: journalRecord.baseLayerRevision,
      layerRevision: journalRecord.layerRevision as number,
    };
    const tiles: NormalizedTile[] = [];
    let computedTotal = BigInt(journal.byteLength);
    for (let index = 0; index < tilesValue.length; index += 1) {
      const raw = tilesValue[index];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      const value = raw as Record<string, unknown>;
      const data = payloads.tiles[index];
      const logicalTileIndex = parseDecimalBigInt(value.logicalTileIndex);
      const logicalByteOffset = parseDecimalBigInt(value.logicalByteOffset);
      const shardIndex = parseDecimalBigInt(value.shardIndex);
      const shardByteOffset = parseDecimalBigInt(value.shardByteOffset);
      if (
        value.index !== index
        || !safeId(value.tileId)
        || !revision(value.column)
        || !revision(value.row)
        || value.layerId !== journal.layerId
        || !revision(value.layerIndex)
        || logicalTileIndex === null
        || logicalByteOffset === null
        || shardIndex === null
        || shardByteOffset === null
        || shardIndex !== logicalByteOffset / shardBytes
        || shardByteOffset !== logicalByteOffset % shardBytes
        || shardByteOffset > MAX_SAFE
        || !revision(value.baseTileRevision)
        || value.tileRevision !== (value.baseTileRevision as number) + 1
        || !positiveSequence(value.byteLength)
        || !digest(value.contentDigest)
        || value.payloadChecksum !== value.contentDigest
        || !data
        || data.byteLength !== value.byteLength
        || studioEngineRgba16FloatTileDigest(data.buffer as ArrayBuffer)
          !== value.contentDigest
      ) {
        return null;
      }
      computedTotal += BigInt(data.byteLength);
      tiles.push({
        index,
        tileId: value.tileId,
        column: value.column,
        row: value.row,
        layerId: value.layerId,
        layerIndex: value.layerIndex,
        logicalTileIndex,
        logicalByteOffset,
        shardIndex,
        shardByteOffset,
        baseTileRevision: value.baseTileRevision,
        tileRevision: value.tileRevision as number,
        byteLength: value.byteLength,
        contentDigest: value.contentDigest,
        payloadChecksum: value.payloadChecksum,
        data,
      });
    }
    if (computedTotal !== totalPayloadBytes) return null;
    const withoutChecksum = {
      requestSequence: 1,
      sessionEpoch: headerValue.sessionEpoch,
      transactionSequence: headerValue.transactionSequence,
      transactionIdentity: headerValue.transactionIdentity,
      expectedDurableRevision: headerValue.expectedDurableRevision,
      documentId: headerValue.documentId,
      commandIdentity: headerValue.commandIdentity,
      commandSequence: headerValue.commandSequence,
      baseDocumentRevision: headerValue.baseDocumentRevision,
      documentRevision: headerValue.documentRevision as number,
      writeCount: tiles.length + 1,
      totalPayloadBytes,
      journal,
      tiles,
    } satisfies Omit<NormalizedTransaction, "identityChecksum">;
    const identityChecksum = transactionIdentityChecksum(withoutChecksum);
    if (
      identityChecksum !== headerValue.identityChecksum
      || headerValue.transactionIdentity
        !== `studio-engine-storage-v2:${identityChecksum}`
    ) {
      return null;
    }
    return Object.freeze({ ...withoutChecksum, identityChecksum });
  } catch {
    return null;
  }
}

function markerFromHeader(
  value: Record<string, unknown>,
): MarkerBody | null {
  try {
    const markerChecksum = value.markerChecksum;
    const { markerChecksum: _ignored, ...body } = value;
    if (
      value.format !== STUDIO_ENGINE_TILE_STORAGE_MARKER_FORMAT
      || value.version !== STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION
      || !digest(markerChecksum)
      || studioCommandPayloadChecksum(json(body)) !== markerChecksum
      || !digest(value.transactionIdentity)
      || !digest(value.identityChecksum)
      || !positiveSequence(value.durableRevision)
      || !safeId(value.documentId)
      || !positiveSequence(value.sessionEpoch)
      || !positiveSequence(value.transactionSequence)
      || !digest(value.commandIdentity)
      || !positiveSequence(value.commandSequence)
      || !positiveSequence(value.documentRevision)
      || parseDecimalBigInt(value.journalLogicalByteOffset) === null
      || !positiveSequence(value.journalByteLength)
      || parseDecimalBigInt(value.walLogicalByteOffset) === null
      || parseDecimalBigInt(value.walByteLength) === null
    ) {
      return null;
    }
    return Object.freeze(value as unknown as MarkerBody);
  } catch {
    return null;
  }
}

function ackFor(
  transaction: NormalizedTransaction,
  durableRevision: number,
  disposition: StudioEngineTileStorageCommitAck["disposition"],
  requestSequence: number,
): StudioEngineTileStorageCommitAck {
  const journal: StudioEngineTileStorageJournalAck = Object.freeze({
    sequence: transaction.journal.sequence,
    logicalByteOffset: transaction.journal.logicalByteOffset,
    byteLength: transaction.journal.byteLength,
    recordDigest: transaction.journal.recordDigest,
    payloadChecksum: transaction.journal.payloadChecksum,
  });
  const tiles: readonly StudioEngineTileStorageTileAck[] = Object.freeze(
    transaction.tiles.map((tile) => Object.freeze({
      index: tile.index,
      tileId: tile.tileId,
      logicalTileIndex: tile.logicalTileIndex,
      logicalByteOffset: tile.logicalByteOffset,
      shardIndex: tile.shardIndex,
      shardByteOffset: tile.shardByteOffset,
      tileRevision: tile.tileRevision,
      byteLength: tile.byteLength,
      contentDigest: tile.contentDigest,
      payloadChecksum: tile.payloadChecksum,
    })),
  );
  return Object.freeze({
    kind: STUDIO_ENGINE_TILE_STORAGE_ACK_KIND,
    version: STUDIO_ENGINE_TILE_STORAGE_PROTOCOL_VERSION,
    complete: true,
    disposition,
    requestSequence,
    sessionEpoch: transaction.sessionEpoch,
    transactionSequence: transaction.transactionSequence,
    transactionIdentity: transaction.transactionIdentity,
    expectedDurableRevision: transaction.expectedDurableRevision,
    durableRevision,
    documentId: transaction.documentId,
    commandSequence: transaction.commandSequence,
    documentRevision: transaction.documentRevision,
    writeCount: transaction.writeCount,
    totalPayloadBytes: transaction.totalPayloadBytes,
    journal,
    tiles,
  });
}

function sameDurableTransaction(
  left: NormalizedTransaction,
  right: NormalizedTransaction,
): boolean {
  return (
    left.transactionIdentity === right.transactionIdentity
    && left.identityChecksum === right.identityChecksum
    && left.sessionEpoch === right.sessionEpoch
    && left.transactionSequence === right.transactionSequence
    && left.expectedDurableRevision === right.expectedDurableRevision
    && left.documentId === right.documentId
    && left.commandIdentity === right.commandIdentity
    && left.commandSequence === right.commandSequence
    && left.baseDocumentRevision === right.baseDocumentRevision
    && left.documentRevision === right.documentRevision
    && left.writeCount === right.writeCount
    && left.totalPayloadBytes === right.totalPayloadBytes
    && left.journal.logicalByteOffset === right.journal.logicalByteOffset
    && left.journal.byteLength === right.journal.byteLength
    && left.journal.payloadChecksum === right.journal.payloadChecksum
    && left.tiles.length === right.tiles.length
    && left.tiles.every((tile, index) => {
      const other = right.tiles[index];
      return (
        other !== undefined
        && tile.index === other.index
        && tile.tileId === other.tileId
        && tile.logicalTileIndex === other.logicalTileIndex
        && tile.logicalByteOffset === other.logicalByteOffset
        && tile.tileRevision === other.tileRevision
        && tile.byteLength === other.byteLength
        && tile.payloadChecksum === other.payloadChecksum
      );
    })
  );
}

function frozenFrontier(
  input: StudioEngineTileStorageWorkerV2Frontier,
): StudioEngineTileStorageWorkerV2Frontier {
  return Object.freeze({ ...input });
}

export class StudioEngineTileStorageWorkerV2
implements StudioEngineTileStorageTransport {
  public readonly documentId: string;
  public readonly ownerId: string;
  public readonly sessionEpoch: number;
  public readonly leaseEpoch: number;

  readonly #backend: StudioEngineTileStorageWorkerV2ShardBackend;
  readonly #leasePort: StudioEngineTileStorageWorkerV2LeasePort;
  readonly #windowBytes: number;
  readonly #maxHeaderBytes: number;
  readonly #maxPayloadBytes: bigint;
  readonly #faultInjector?: StudioEngineTileStorageWorkerV2Options["faultInjector"];
  readonly #durable = new Map<number, DurableTransaction>();
  #frontier: StudioEngineTileStorageWorkerV2Frontier = frozenFrontier({
    durableRevision: 0,
    documentRevision: 0,
    commandSequence: 0,
    transactionSequence: 0,
    journalByteLength: BigInt(0),
    walByteLength: BigInt(0),
    markerByteLength: BigInt(0),
  });
  #lease: StudioEngineTileStorageWorkerV2Lease | null = null;
  #opened = false;
  #recoveryRequired = false;
  #disposed = false;
  #activeAbort: AbortController | null = null;
  #tail: Promise<void> = Promise.resolve();

  public constructor(options: StudioEngineTileStorageWorkerV2Options) {
    const windowBytes = options.windowBytes ?? DEFAULT_WINDOW_BYTES;
    const maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES;
    const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    if (
      !safeId(options.documentId)
      || !safeId(options.ownerId)
      || !positiveSequence(options.sessionEpoch)
      || !positiveSequence(options.leaseEpoch)
      || !options.backend
      || (
        options.backend.kind !== "opfs-sync-shards"
        && options.backend.kind !== "memory-sync-shards"
      )
      || !positiveBigInt(options.backend.shardBytes)
      || options.backend.shardBytes > MAX_SAFE
      || !options.leasePort
      || !Number.isSafeInteger(windowBytes)
      || windowBytes < 1
      || !Number.isSafeInteger(maxHeaderBytes)
      || maxHeaderBytes < 1
      || !positiveBigInt(maxPayloadBytes)
      || maxPayloadBytes > MAX_U64
    ) {
      fail("invalid-options", "Storage Worker v2 options are invalid.");
    }
    this.documentId = options.documentId;
    this.ownerId = options.ownerId;
    this.sessionEpoch = options.sessionEpoch;
    this.leaseEpoch = options.leaseEpoch;
    this.#backend = options.backend;
    this.#leasePort = options.leasePort;
    this.#windowBytes = Math.min(windowBytes, Number(options.backend.shardBytes));
    this.#maxHeaderBytes = maxHeaderBytes;
    this.#maxPayloadBytes = maxPayloadBytes;
    this.#faultInjector = options.faultInjector;
  }

  public frontier(): StudioEngineTileStorageWorkerV2Frontier {
    return this.#frontier;
  }

  public open(signal: AbortSignal = new AbortController().signal):
  Promise<StudioEngineTileStorageWorkerV2RecoveryResult> {
    return this.#enqueue(() => this.#openSerial(signal));
  }

  public recover(signal: AbortSignal = new AbortController().signal):
  Promise<StudioEngineTileStorageWorkerV2RecoveryResult> {
    return this.#enqueue(async () => {
      await this.#ensureLease(signal);
      return this.#recoverSerial(signal);
    });
  }

  public commit(
    request: StudioEngineTileStorageCommitRequest,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<StudioEngineTileStorageCommitAck> {
    return this.#enqueue(() => this.#commitSerial(request, options.signal));
  }

  public async dispose(): Promise<void> {
    if (this.#disposed) {
      await this.#tail;
      return;
    }
    this.#disposed = true;
    this.#activeAbort?.abort(
      new Error("Studio engine tile storage Worker v2 disposed."),
    );
    await this.#tail;
    const lease = this.#lease;
    this.#lease = null;
    if (lease) {
      try {
        await this.#leasePort.release(lease);
      } catch {
        // A closed authority never becomes reusable because release failed.
      }
    }
    try {
      await this.#backend.close?.();
    } catch {
      // Disposal is terminal.
    }
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(operation, operation);
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #openSerial(
    signal: AbortSignal,
  ): Promise<StudioEngineTileStorageWorkerV2RecoveryResult> {
    if (this.#disposed) fail("disposed", "Storage Worker v2 is disposed.");
    await this.#ensureLease(signal);
    if (this.#opened && !this.#recoveryRequired) {
      return Object.freeze({
        status: "ready",
        recoveredTransactions: 0,
        frontier: this.#frontier,
      });
    }
    return this.#recoverSerial(signal);
  }

  async #ensureLease(signal: AbortSignal): Promise<void> {
    if (this.#disposed) fail("disposed", "Storage Worker v2 is disposed.");
    assertSignal(signal);
    if (!this.#lease) {
      try {
        this.#lease = await this.#leasePort.acquire({
          documentId: this.documentId,
          ownerId: this.ownerId,
          leaseEpoch: this.leaseEpoch,
          signal,
        });
      } catch (error) {
        fail("lease-lost", "Could not acquire the exclusive document lease.", error);
      }
    }
    await this.#assertLease(signal);
  }

  async #assertLease(signal: AbortSignal): Promise<void> {
    assertSignal(signal);
    const lease = this.#lease;
    if (
      !lease
      || lease.documentId !== this.documentId
      || lease.ownerId !== this.ownerId
      || lease.leaseEpoch !== this.leaseEpoch
      || !safeId(lease.token)
    ) {
      fail("lease-lost", "The exclusive document lease identity is invalid.");
    }
    try {
      await this.#leasePort.assert(lease, signal);
    } catch (error) {
      fail("lease-lost", "The exclusive document lease was lost.", error);
    }
  }

  async #fault(
    point: StudioEngineTileStorageWorkerV2FaultPoint,
    signal: AbortSignal,
  ): Promise<void> {
    assertSignal(signal);
    await this.#faultInjector?.(Object.freeze(point));
    assertSignal(signal);
  }

  async #commitSerial(
    input: StudioEngineTileStorageCommitRequest,
    callerSignal: AbortSignal,
  ): Promise<StudioEngineTileStorageCommitAck> {
    if (this.#disposed) fail("disposed", "Storage Worker v2 is disposed.");
    const controller = new AbortController();
    const abort = () => controller.abort(callerSignal.reason);
    if (callerSignal.aborted) abort();
    else callerSignal.addEventListener("abort", abort, { once: true });
    this.#activeAbort = controller;
    let storageStarted = false;
    try {
      await this.#ensureLease(controller.signal);
      if (!this.#opened) {
        const recovery = await this.#recoverSerial(controller.signal);
        if (recovery.status !== "ready") {
          fail("recovery-required", "Storage Worker v2 requires an exact retry.");
        }
      }
      if (this.#recoveryRequired) {
        fail("recovery-required", "Storage Worker v2 recovery must finish first.");
      }
      const transaction = normalizeRequest(
        input,
        this.#backend.shardBytes,
        this.#maxPayloadBytes,
      );
      if (
        transaction.documentId !== this.documentId
        || transaction.sessionEpoch !== this.sessionEpoch
      ) {
        fail("identity-conflict", "Storage request belongs to another document epoch.");
      }
      const existing = this.#durable.get(transaction.transactionSequence);
      if (existing) {
        if (
          existing.identityChecksum !== transaction.identityChecksum
          || !sameDurableTransaction(existing.transaction, transaction)
        ) {
          fail("identity-conflict", "A durable sequence has conflicting content.");
        }
        return ackFor(
          transaction,
          existing.transaction.expectedDurableRevision + 1,
          "idempotent-replay",
          transaction.requestSequence,
        );
      }
      this.#assertNext(transaction);
      const walOffset = this.#frontier.walByteLength;
      storageStarted = true;
      const walByteLength = await this.#appendWal(
        transaction,
        walOffset,
        controller.signal,
      );
      await this.#fault({
        stage: "after-wal-write",
        transactionIdentity: transaction.transactionIdentity,
      }, controller.signal);
      await this.#backend.flush("wal", controller.signal);
      await this.#fault({
        stage: "after-wal-flush",
        transactionIdentity: transaction.transactionIdentity,
      }, controller.signal);
      await this.#completeTransaction(
        transaction,
        walOffset,
        walByteLength,
        controller.signal,
      );
      return ackFor(
        transaction,
        transaction.expectedDurableRevision + 1,
        "committed",
        transaction.requestSequence,
      );
    } catch (error) {
      if (storageStarted) this.#recoveryRequired = true;
      throw error;
    } finally {
      if (this.#activeAbort === controller) this.#activeAbort = null;
      callerSignal.removeEventListener("abort", abort);
    }
  }

  #assertNext(transaction: NormalizedTransaction): void {
    const frontier = this.#frontier;
    if (
      transaction.expectedDurableRevision !== frontier.durableRevision
      || transaction.transactionSequence !== frontier.transactionSequence + 1
      || transaction.commandSequence !== frontier.commandSequence + 1
      || transaction.baseDocumentRevision !== frontier.documentRevision
      || transaction.documentRevision !== frontier.documentRevision + 1
      || transaction.journal.logicalByteOffset !== frontier.journalByteLength
    ) {
      fail("sequence-conflict", "Storage v2 transaction is not contiguous.");
    }
  }

  async #appendWal(
    transaction: NormalizedTransaction,
    walOffset: bigint,
    signal: AbortSignal,
  ): Promise<bigint> {
    const header = createWalHeader(transaction);
    const headerBytes = canonicalBytes(json(header));
    if (headerBytes.byteLength > this.#maxHeaderBytes) {
      fail("invalid-payload", "Storage v2 WAL header exceeds its budget.");
    }
    const prefix = createPrefix(
      WAL_MAGIC,
      headerBytes.byteLength,
      transaction.totalPayloadBytes,
    );
    let cursor = walOffset;
    await writeRange(
      this.#backend,
      "wal",
      cursor,
      prefix,
      this.#windowBytes,
      signal,
    );
    cursor += BigInt(prefix.byteLength);
    await writeRange(
      this.#backend,
      "wal",
      cursor,
      headerBytes,
      this.#windowBytes,
      signal,
    );
    cursor += BigInt(headerBytes.byteLength);
    await writeRange(
      this.#backend,
      "wal",
      cursor,
      transaction.journal.data,
      this.#windowBytes,
      signal,
    );
    cursor += BigInt(transaction.journal.byteLength);
    for (const tile of transaction.tiles) {
      await writeRange(
        this.#backend,
        "wal",
        cursor,
        tile.data,
        this.#windowBytes,
        signal,
      );
      cursor += BigInt(tile.byteLength);
    }
    return cursor - walOffset;
  }

  async #completeTransaction(
    transaction: NormalizedTransaction,
    walOffset: bigint,
    walByteLength: bigint,
    signal: AbortSignal,
  ): Promise<void> {
    this.#assertNext(transaction);
    await this.#assertLease(signal);
    for (const tile of transaction.tiles) {
      await writeRange(
        this.#backend,
        "document",
        tile.logicalByteOffset,
        tile.data,
        this.#windowBytes,
        signal,
      );
      await this.#fault({
        stage: "after-tile-write",
        transactionIdentity: transaction.transactionIdentity,
        tileIndex: tile.index,
      }, signal);
    }
    const durableRevision = this.#frontier.durableRevision + 1;
    const marker = createMarker(
      transaction,
      durableRevision,
      walOffset,
      walByteLength,
    );
    const markerBytes = canonicalBytes(json(marker));
    const prefix = createPrefix(MARKER_MAGIC, markerBytes.byteLength, BigInt(0));
    const markerOffset = this.#frontier.markerByteLength;
    await writeRange(
      this.#backend,
      "markers",
      markerOffset,
      prefix,
      this.#windowBytes,
      signal,
    );
    await writeRange(
      this.#backend,
      "markers",
      markerOffset + BigInt(prefix.byteLength),
      markerBytes,
      this.#windowBytes,
      signal,
    );
    const markerByteLength = BigInt(prefix.byteLength + markerBytes.byteLength);
    await this.#fault({
      stage: "after-marker-write",
      transactionIdentity: transaction.transactionIdentity,
    }, signal);
    await this.#backend.flush("document", signal);
    await this.#fault({
      stage: "after-document-flush",
      transactionIdentity: transaction.transactionIdentity,
    }, signal);
    await this.#backend.flush("markers", signal);
    await this.#fault({
      stage: "after-marker-flush",
      transactionIdentity: transaction.transactionIdentity,
    }, signal);
    this.#frontier = frozenFrontier({
      durableRevision,
      documentRevision: transaction.documentRevision,
      commandSequence: transaction.commandSequence,
      transactionSequence: transaction.transactionSequence,
      journalByteLength:
        transaction.journal.logicalByteOffset
        + BigInt(transaction.journal.byteLength),
      walByteLength: walOffset + walByteLength,
      markerByteLength: markerOffset + markerByteLength,
    });
    this.#durable.set(transaction.transactionSequence, Object.freeze({
      identityChecksum: transaction.identityChecksum,
      transaction,
      walOffset,
      walByteLength,
    }));
    await this.#fault({
      stage: "before-ack",
      transactionIdentity: transaction.transactionIdentity,
    }, signal);
  }

  async #recoverSerial(
    signal: AbortSignal,
  ): Promise<StudioEngineTileStorageWorkerV2RecoveryResult> {
    if (this.#disposed) fail("disposed", "Storage Worker v2 is disposed.");
    await this.#assertLease(signal);
    const walLength = await this.#backend.logicalByteLength("wal", signal);
    const markerLength = await this.#backend.logicalByteLength("markers", signal);
    if (!nonNegativeBigInt(walLength) || !nonNegativeBigInt(markerLength)) {
      fail("corrupt-storage", "OPFS backend returned an invalid logical length.");
    }
    const walScan = await this.#scanWal(walLength, signal);
    const markerScan = await this.#scanMarkers(markerLength, signal);
    if (markerScan.tail !== "none") {
      await this.#backend.truncate(
        "markers",
        markerScan.validByteLength,
        signal,
      );
      await this.#backend.flush("markers", signal);
    }
    this.#durable.clear();
    this.#frontier = frozenFrontier({
      durableRevision: 0,
      documentRevision: 0,
      commandSequence: 0,
      transactionSequence: 0,
      journalByteLength: BigInt(0),
      walByteLength: BigInt(0),
      markerByteLength: BigInt(0),
    });

    for (let index = 0; index < markerScan.records.length; index += 1) {
      const marker = markerScan.records[index]!;
      const wal = walScan.records[index];
      if (!wal || !this.#markerMatches(marker, wal, index + 1)) {
        this.#recoveryRequired = true;
        this.#opened = true;
        return Object.freeze({
          status: "retry-required",
          reason: "corrupt-marker",
          recoveredTransactions: index,
          frontier: this.#frontier,
        });
      }
      this.#adoptDurable(wal, marker);
    }

    let recoveredTransactions = 0;
    for (
      let index = markerScan.records.length;
      index < walScan.records.length;
      index += 1
    ) {
      const wal = walScan.records[index]!;
      this.#assertNext(wal.transaction);
      await this.#completeTransaction(
        wal.transaction,
        wal.offset,
        wal.byteLength,
        signal,
      );
      recoveredTransactions += 1;
    }

    this.#opened = true;
    const walTail = walScan.tail;
    if (walTail !== "none") {
      await this.#backend.truncate("wal", walScan.validByteLength, signal);
      await this.#backend.flush("wal", signal);
      this.#recoveryRequired = true;
      return Object.freeze({
        status: "retry-required",
        reason: walTail === "torn" ? "torn-wal" : "corrupt-wal",
        recoveredTransactions,
        frontier: this.#frontier,
      });
    }
    this.#recoveryRequired = false;
    return Object.freeze({
      status: "ready",
      recoveredTransactions,
      frontier: this.#frontier,
    });
  }

  #adoptDurable(wal: WalRecord, marker: MarkerRecord): void {
    const transaction = wal.transaction;
    this.#assertNext(transaction);
    const durableRevision = this.#frontier.durableRevision + 1;
    this.#frontier = frozenFrontier({
      durableRevision,
      documentRevision: transaction.documentRevision,
      commandSequence: transaction.commandSequence,
      transactionSequence: transaction.transactionSequence,
      journalByteLength:
        transaction.journal.logicalByteOffset
        + BigInt(transaction.journal.byteLength),
      walByteLength: wal.offset + wal.byteLength,
      markerByteLength: marker.offset + marker.byteLength,
    });
    this.#durable.set(transaction.transactionSequence, Object.freeze({
      identityChecksum: transaction.identityChecksum,
      transaction,
      walOffset: wal.offset,
      walByteLength: wal.byteLength,
    }));
  }

  #markerMatches(
    marker: MarkerRecord,
    wal: WalRecord,
    durableRevision: number,
  ): boolean {
    const body = marker.body;
    const transaction = wal.transaction;
    return (
      body.transactionIdentity === transaction.transactionIdentity
      && body.identityChecksum === transaction.identityChecksum
      && body.durableRevision === durableRevision
      && body.documentId === transaction.documentId
      && body.sessionEpoch === transaction.sessionEpoch
      && body.transactionSequence === transaction.transactionSequence
      && body.commandIdentity === transaction.commandIdentity
      && body.commandSequence === transaction.commandSequence
      && body.documentRevision === transaction.documentRevision
      && parseDecimalBigInt(body.journalLogicalByteOffset)
        === transaction.journal.logicalByteOffset
      && body.journalByteLength === transaction.journal.byteLength
      && parseDecimalBigInt(body.walLogicalByteOffset) === wal.offset
      && parseDecimalBigInt(body.walByteLength) === wal.byteLength
    );
  }

  async #scanWal(
    logicalLength: bigint,
    signal: AbortSignal,
  ): Promise<ScanResult<WalRecord>> {
    const records: WalRecord[] = [];
    let offset = BigInt(0);
    while (offset < logicalLength) {
      const remaining = logicalLength - offset;
      if (remaining < BigInt(FRAME_PREFIX_BYTES)) {
        return { records, validByteLength: offset, tail: "torn" };
      }
      const prefixBytes = await readRange(
        this.#backend,
        "wal",
        offset,
        FRAME_PREFIX_BYTES,
        this.#windowBytes,
        signal,
      );
      const prefix = parsePrefix(
        prefixBytes,
        WAL_MAGIC,
        this.#maxHeaderBytes,
        this.#maxPayloadBytes,
      );
      if (!prefix) {
        return { records, validByteLength: offset, tail: "corrupt" };
      }
      if (prefix.frameByteLength > remaining) {
        return { records, validByteLength: offset, tail: "torn" };
      }
      const headerOffset = offset + BigInt(FRAME_PREFIX_BYTES);
      const headerBytes = await readRange(
        this.#backend,
        "wal",
        headerOffset,
        prefix.headerByteLength,
        this.#windowBytes,
        signal,
      );
      const header = parseCanonicalHeader(headerBytes);
      if (!header) {
        return { records, validByteLength: offset, tail: "corrupt" };
      }
      const payloadStart = headerOffset + BigInt(prefix.headerByteLength);
      const journalValue = header.journal;
      const tilesValue = header.tiles;
      if (
        !journalValue
        || typeof journalValue !== "object"
        || Array.isArray(journalValue)
        || !Array.isArray(tilesValue)
      ) {
        return { records, validByteLength: offset, tail: "corrupt" };
      }
      const journalRecord = journalValue as Record<string, unknown>;
      const journalOffset = parseDecimalBigInt(journalRecord.payloadOffset);
      if (
        journalOffset === null
        || journalOffset !== BigInt(0)
        || !positiveSequence(journalRecord.byteLength)
      ) {
        return { records, validByteLength: offset, tail: "corrupt" };
      }
      const journal = await readRange(
        this.#backend,
        "wal",
        payloadStart + journalOffset,
        journalRecord.byteLength,
        this.#windowBytes,
        signal,
      );
      const tiles: Uint8Array[] = [];
      let expectedPayloadOffset = BigInt(journal.byteLength);
      for (const raw of tilesValue) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          return { records, validByteLength: offset, tail: "corrupt" };
        }
        const tile = raw as Record<string, unknown>;
        const tilePayloadOffset = parseDecimalBigInt(tile.payloadOffset);
        if (
          tilePayloadOffset === null
          || tilePayloadOffset !== expectedPayloadOffset
          || !positiveSequence(tile.byteLength)
        ) {
          return { records, validByteLength: offset, tail: "corrupt" };
        }
        const bytes = await readRange(
          this.#backend,
          "wal",
          payloadStart + tilePayloadOffset,
          tile.byteLength,
          this.#windowBytes,
          signal,
        );
        tiles.push(bytes);
        expectedPayloadOffset += BigInt(bytes.byteLength);
      }
      if (expectedPayloadOffset !== prefix.payloadByteLength) {
        return { records, validByteLength: offset, tail: "corrupt" };
      }
      const transaction = transactionFromWal(
        header,
        { journal, tiles },
        this.#backend.shardBytes,
      );
      if (!transaction) {
        return { records, validByteLength: offset, tail: "corrupt" };
      }
      records.push(Object.freeze({
        offset,
        byteLength: prefix.frameByteLength,
        header: header as unknown as WalHeader,
        transaction,
      }));
      offset += prefix.frameByteLength;
    }
    return { records, validByteLength: offset, tail: "none" };
  }

  async #scanMarkers(
    logicalLength: bigint,
    signal: AbortSignal,
  ): Promise<ScanResult<MarkerRecord>> {
    const records: MarkerRecord[] = [];
    let offset = BigInt(0);
    while (offset < logicalLength) {
      const remaining = logicalLength - offset;
      if (remaining < BigInt(FRAME_PREFIX_BYTES)) {
        return { records, validByteLength: offset, tail: "torn" };
      }
      const prefixBytes = await readRange(
        this.#backend,
        "markers",
        offset,
        FRAME_PREFIX_BYTES,
        this.#windowBytes,
        signal,
      );
      const prefix = parsePrefix(
        prefixBytes,
        MARKER_MAGIC,
        this.#maxHeaderBytes,
        BigInt(0),
      );
      if (!prefix) {
        return { records, validByteLength: offset, tail: "corrupt" };
      }
      if (
        prefix.payloadByteLength !== BigInt(0)
        || prefix.frameByteLength > remaining
      ) {
        return {
          records,
          validByteLength: offset,
          tail: prefix.frameByteLength > remaining ? "torn" : "corrupt",
        };
      }
      const headerBytes = await readRange(
        this.#backend,
        "markers",
        offset + BigInt(FRAME_PREFIX_BYTES),
        prefix.headerByteLength,
        this.#windowBytes,
        signal,
      );
      const parsed = parseCanonicalHeader(headerBytes);
      const marker = parsed ? markerFromHeader(parsed) : null;
      if (!marker) {
        return { records, validByteLength: offset, tail: "corrupt" };
      }
      records.push(Object.freeze({
        offset,
        byteLength: prefix.frameByteLength,
        body: marker,
      }));
      offset += prefix.frameByteLength;
    }
    return { records, validByteLength: offset, tail: "none" };
  }
}
