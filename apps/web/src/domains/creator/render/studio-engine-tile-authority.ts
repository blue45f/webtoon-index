/**
 * Worker-local raster document authority for the browser-native engine.
 *
 * This is deliberately smaller than the legacy `StudioTiledDocumentStore`. The legacy store is a
 * useful RGBA8 copy-on-write implementation, but its fixed four-byte pixels cannot be the durable
 * state for the new linear-light engine. This actor reuses the storage grid/dirty tracker while it
 * owns provider-neutral, fully encoded RGBA16F tiles. A GPU/provider only receives detached inputs
 * and returns detached deltas; no GPU or vendor object is retained in document state, receipts, or
 * journal records.
 *
 * One call is one serial transaction:
 *
 * 1. validate the canonical brush command and exact base revisions;
 * 2. derive the complete dirty-tile set with `StudioTileDocDirtyTracker`;
 * 3. ask the injected provider for one complete delta batch;
 * 4. validate every base tile revision, payload digest, target and batch digest;
 * 5. build replacement maps, receipt and deterministic journal bytes off to the side;
 * 6. swap all state only after every budget and revision check succeeds.
 *
 * OPFS transport is intentionally outside this file. The receipt preserves BigInt logical/shard
 * offsets and `journalRecord()` returns deterministic bytes suitable for a Storage Worker
 * `append-journal` request, but issuing and acknowledging that request is a later integration
 * slice.
 */

import {
  hashStudioCanonicalBrushPlan,
  parseStudioCanonicalBrushPlan,
  type StudioCanonicalBrushPlan,
} from "../studio-canonical-brush-plan";
import {
  canonicalStudioCommandJson,
  studioCommandPayloadChecksum,
  type StudioCommandJsonValue,
} from "../studio-command-journal";

import { studioTileDocDigest } from "./studio-tiledoc-digest";
import {
  StudioTileDocDirtyTracker,
  type StudioTileDocDirtyTile,
} from "./studio-tiledoc-dirty";

export const STUDIO_ENGINE_TILE_AUTHORITY_VERSION = 1 as const;
export const STUDIO_ENGINE_TILE_JOURNAL_FORMAT =
  "toonspectrum:studio-engine-tile-authority-journal" as const;
export const STUDIO_ENGINE_TILE_ENCODING = "linear-rgba16float-le-v1" as const;

const TEXT_ENCODER = new TextEncoder();
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/u;
const MAX_ID_CHARACTERS = 160;
const MAX_LOGICAL_BYTES = (BigInt(1) << BigInt(63)) - BigInt(1);

export interface StudioEngineTileAuthorityLimits {
  readonly maxDirtyTiles: number;
  readonly maxResidentBytes: number;
  readonly maxJournalBytes: number;
  readonly maxCommands: number;
  readonly maxTiles: number;
}

export const DEFAULT_STUDIO_ENGINE_TILE_AUTHORITY_LIMITS:
Readonly<StudioEngineTileAuthorityLimits> = Object.freeze({
  maxDirtyTiles: 4_096,
  maxResidentBytes: 256 * 1024 * 1024,
  maxJournalBytes: 16 * 1024 * 1024,
  maxCommands: 4_096,
  maxTiles: 262_144,
});

export interface StudioEngineTileAuthorityOptions {
  readonly documentId: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly tileSize?: number;
  readonly layerIds: readonly string[];
  readonly sessionEpoch: number;
  readonly strokeEpoch: number;
  readonly shardBytes: bigint;
  readonly provider: StudioEngineTileExecutionProvider;
  readonly limits?: Partial<StudioEngineTileAuthorityLimits>;
}

export interface StudioEngineTileDirtyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StudioEngineTileCommitRequest {
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly layerId: string;
  readonly dirtyRects: readonly StudioEngineTileDirtyRect[];
  /** Untrusted input. It is validated, detached and frozen by the canonical brush parser. */
  readonly brushPlan: unknown;
}

export interface StudioEngineTileAddress {
  readonly tileId: string;
  readonly column: number;
  readonly row: number;
  readonly layerId: string;
  readonly layerIndex: number;
  readonly logicalTileIndex: bigint;
  readonly logicalByteOffset: bigint;
  readonly shardIndex: bigint;
  readonly shardByteOffset: bigint;
}

export interface StudioEngineTileProviderBaseTile {
  readonly address: StudioEngineTileAddress;
  readonly tileRevision: number;
  readonly contentDigest: string | null;
  /**
   * Detached full RGBA16F payload. The provider owns this copy and may transfer or mutate it.
   * `null` is a transparent, never-materialised tile.
   */
  readonly encoded: ArrayBuffer | null;
}

export interface StudioEngineTileProviderInput {
  readonly kind: "studio-engine-tile-provider-input";
  readonly version: typeof STUDIO_ENGINE_TILE_AUTHORITY_VERSION;
  readonly encoding: typeof STUDIO_ENGINE_TILE_ENCODING;
  readonly commandIdentity: string;
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly layerId: string;
  readonly tileSize: number;
  readonly brushPlan: StudioCanonicalBrushPlan;
  readonly targets: readonly StudioEngineTileProviderBaseTile[];
}

export interface StudioEngineTileExecutionProvider {
  render(input: StudioEngineTileProviderInput): Promise<unknown> | unknown;
}

export interface StudioEngineTileProviderDelta {
  readonly index: number;
  readonly tileId: string;
  readonly column: number;
  readonly row: number;
  readonly baseTileRevision: number;
  /** Full little-endian RGBA16F tile: `tileSize * tileSize * 4` uint16 words. */
  readonly encoded: Uint16Array | ArrayBuffer;
  readonly contentDigest: string;
}

export interface StudioEngineTileProviderDeltaBatch {
  readonly kind: "studio-engine-tile-provider-delta";
  readonly version: typeof STUDIO_ENGINE_TILE_AUTHORITY_VERSION;
  readonly commandIdentity: string;
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly complete: true;
  readonly deltaCount: number;
  readonly deltas: readonly StudioEngineTileProviderDelta[];
  readonly batchDigest: string;
}

interface NormalizedProviderDelta {
  readonly index: number;
  readonly tileId: string;
  readonly column: number;
  readonly row: number;
  readonly baseTileRevision: number;
  readonly encoded: Uint16Array;
  readonly contentDigest: string;
}

interface NormalizedProviderBatch {
  readonly commandIdentity: string;
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly complete: true;
  readonly deltaCount: number;
  readonly deltas: readonly NormalizedProviderDelta[];
  readonly batchDigest: string;
}

export interface StudioEngineTileReceiptEntry extends StudioEngineTileAddress {
  readonly baseTileRevision: number;
  readonly tileRevision: number;
  readonly contentDigest: string;
  readonly byteLength: number;
}

export interface StudioEngineTileCommitReceipt {
  readonly kind: "studio-engine-tile-commit-receipt";
  readonly version: typeof STUDIO_ENGINE_TILE_AUTHORITY_VERSION;
  readonly encoding: typeof STUDIO_ENGINE_TILE_ENCODING;
  readonly documentId: string;
  readonly commandIdentity: string;
  readonly commandSequence: number;
  readonly baseDocumentRevision: number;
  readonly documentRevision: number;
  readonly layerId: string;
  readonly baseLayerRevision: number;
  readonly layerRevision: number;
  readonly tiles: readonly StudioEngineTileReceiptEntry[];
  readonly journalSequence: number;
  readonly journalDigest: string;
  readonly journalByteLength: number;
  /** Logical append position expected by the future Storage Worker integration. */
  readonly journalLogicalByteOffset: bigint;
}

export type StudioEngineTileCommitFailureReason =
  | "disposed"
  | "invalid-request"
  | "invalid-brush-command"
  | "unknown-layer"
  | "stale-document-revision"
  | "stale-layer-revision"
  | "command-sequence-conflict"
  | "command-sequence-gap"
  | "dirty-tile-limit"
  | "provider-failed"
  | "partial-provider-delta"
  | "invalid-provider-delta"
  | "tile-limit"
  | "resident-byte-limit"
  | "journal-byte-limit"
  | "revision-exhausted";

export type StudioEngineTileCommitResult =
  | Readonly<{
      status: "committed";
      receipt: StudioEngineTileCommitReceipt;
      /** Defensive copy; mutating it cannot alter the actor's journal. */
      journalBytes: Uint8Array;
    }>
  | Readonly<{
      status: "duplicate";
      receipt: StudioEngineTileCommitReceipt;
    }>
  | Readonly<{
      status: "rejected";
      reason: StudioEngineTileCommitFailureReason;
    }>;

export interface StudioEngineTileReadResult extends StudioEngineTileReceiptEntry {
  /** Defensive copy of the authoritative bytes. */
  readonly encoded: ArrayBuffer;
}

export interface StudioEngineTileJournalDelta {
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
}

export interface StudioEngineTileJournalRecord {
  readonly format: typeof STUDIO_ENGINE_TILE_JOURNAL_FORMAT;
  readonly version: typeof STUDIO_ENGINE_TILE_AUTHORITY_VERSION;
  readonly recordType: "atomic-rgba16float-tile-commit";
  readonly sequence: number;
  readonly previousDigest: string;
  readonly documentId: string;
  readonly encoding: typeof STUDIO_ENGINE_TILE_ENCODING;
  readonly tileSize: number;
  readonly commandIdentity: string;
  readonly commandSequence: number;
  readonly baseDocumentRevision: number;
  readonly documentRevision: number;
  readonly layerId: string;
  readonly layerIndex: number;
  readonly baseLayerRevision: number;
  readonly layerRevision: number;
  readonly brushPlanDigest: string;
  readonly deltas: readonly StudioEngineTileJournalDelta[];
  readonly recordDigest: string;
}

export interface StudioEngineTileAuthorityStats {
  readonly documentRevision: number;
  readonly layerCount: number;
  readonly tileCount: number;
  readonly residentBytes: number;
  readonly journalRecordCount: number;
  readonly journalBytes: number;
  readonly commandCount: number;
}

export interface StudioEngineTileDeviceLossReplaySource {
  readonly kind: "studio-engine-tile-device-loss-replay";
  readonly version: typeof STUDIO_ENGINE_TILE_AUTHORITY_VERSION;
  readonly encoding: typeof STUDIO_ENGINE_TILE_ENCODING;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly layers: readonly {
    readonly layerId: string;
    readonly layerRevision: number;
  }[];
  readonly tiles: readonly StudioEngineTileReadResult[];
  readonly journalHeadDigest: string;
}

interface LayerState {
  readonly id: string;
  readonly index: number;
  readonly revision: number;
}

interface TileState {
  readonly address: StudioEngineTileAddress;
  readonly revision: number;
  readonly contentDigest: string;
  readonly encoded: Uint16Array;
}

interface JournalState {
  readonly record: StudioEngineTileJournalRecord;
  readonly bytes: Uint8Array;
}

interface NormalizedCommitRequest {
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly layerId: string;
  readonly dirtyRects: readonly StudioEngineTileDirtyRect[];
  readonly plan: StudioCanonicalBrushPlan;
  readonly commandIdentity: string;
  readonly commandSequence: number;
}

interface InspectionSuccess {
  readonly ok: true;
  readonly value: Record<string, unknown>;
}

interface InspectionFailure {
  readonly ok: false;
}

type InspectionResult = InspectionSuccess | InspectionFailure;

function isSafeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_ID_CHARACTERS
    && SAFE_ID.test(value);
}

function nonNegativeRevision(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function inspectExactRecord(
  input: unknown,
  keys: readonly string[],
): InspectionResult {
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return { ok: false };
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return { ok: false };
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== keys.length
      || ownKeys.some((key) => typeof key !== "string")
      || keys.some((key) => !Object.hasOwn(descriptors, key))
    ) {
      return { ok: false };
    }
    const value: Record<string, unknown> = {};
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) return { ok: false };
      value[key] = descriptor.value;
    }
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function inspectDenseArray(
  input: unknown,
  maximum: number,
): readonly unknown[] | null {
  try {
    if (!Array.isArray(input)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.length !== length + 1) return null;
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      values.push(descriptor.value);
    }
    return values;
  } catch {
    return null;
  }
}

function finiteRect(value: unknown): StudioEngineTileDirtyRect | null {
  const inspected = inspectExactRecord(value, ["x", "y", "width", "height"]);
  if (!inspected.ok) return null;
  const { x, y, width, height } = inspected.value;
  if (
    typeof x !== "number"
    || !Number.isFinite(x)
    || typeof y !== "number"
    || !Number.isFinite(y)
    || typeof width !== "number"
    || !Number.isFinite(width)
    || width <= 0
    || typeof height !== "number"
    || !Number.isFinite(height)
    || height <= 0
  ) {
    return null;
  }
  return Object.freeze({ x, y, width, height });
}

function normalizeLimit(
  value: unknown,
  fallback: number,
  minimum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError("Studio engine tile authority limit is invalid.");
  }
  return value as number;
}

function normalizeLimits(
  input: Partial<StudioEngineTileAuthorityLimits> | undefined,
): StudioEngineTileAuthorityLimits {
  return Object.freeze({
    maxDirtyTiles: normalizeLimit(
      input?.maxDirtyTiles,
      DEFAULT_STUDIO_ENGINE_TILE_AUTHORITY_LIMITS.maxDirtyTiles,
      1,
    ),
    maxResidentBytes: normalizeLimit(
      input?.maxResidentBytes,
      DEFAULT_STUDIO_ENGINE_TILE_AUTHORITY_LIMITS.maxResidentBytes,
      1,
    ),
    maxJournalBytes: normalizeLimit(
      input?.maxJournalBytes,
      DEFAULT_STUDIO_ENGINE_TILE_AUTHORITY_LIMITS.maxJournalBytes,
      128,
    ),
    maxCommands: normalizeLimit(
      input?.maxCommands,
      DEFAULT_STUDIO_ENGINE_TILE_AUTHORITY_LIMITS.maxCommands,
      1,
    ),
    maxTiles: normalizeLimit(
      input?.maxTiles,
      DEFAULT_STUDIO_ENGINE_TILE_AUTHORITY_LIMITS.maxTiles,
      1,
    ),
  });
}

function nextRevision(value: number): number | null {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : null;
}

function deepFreeze<T>(value: T): T {
  if (
    typeof value !== "object"
    || value === null
    || Object.isFrozen(value)
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function tileKey(layerId: string, tileId: string): string {
  return `${layerId}\u0000${tileId}`;
}

function copyViewBuffer(view: Uint16Array): ArrayBuffer {
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
  );
  return copy;
}

function compareDirtyTiles(
  left: Pick<StudioTileDocDirtyTile, "row" | "column">,
  right: Pick<StudioTileDocDirtyTile, "row" | "column">,
): number {
  return left.row - right.row || left.column - right.column;
}

function canonicalPayload(value: unknown): StudioCommandJsonValue {
  return value as StudioCommandJsonValue;
}

export function studioEngineRgba16FloatTileDigest(
  encoded: Uint16Array | ArrayBuffer,
): string {
  const bytes = encoded instanceof Uint16Array
    ? new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength)
    : new Uint8Array(encoded);
  return `rgba16f-v1:${studioTileDocDigest(bytes)}`;
}

function batchDigestPayload(input: {
  readonly commandIdentity: string;
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly complete: boolean;
  readonly deltaCount: number;
  readonly deltas: readonly {
    readonly index: number;
    readonly tileId: string;
    readonly column: number;
    readonly row: number;
    readonly baseTileRevision: number;
    readonly contentDigest: string;
  }[];
}): StudioCommandJsonValue {
  return canonicalPayload({
    version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
    commandIdentity: input.commandIdentity,
    baseDocumentRevision: input.baseDocumentRevision,
    baseLayerRevision: input.baseLayerRevision,
    complete: input.complete,
    deltaCount: input.deltaCount,
    deltas: input.deltas.map((delta) => ({
      index: delta.index,
      tileId: delta.tileId,
      column: delta.column,
      row: delta.row,
      baseTileRevision: delta.baseTileRevision,
      contentDigest: delta.contentDigest,
    })),
  });
}

/** Deterministic provider framing digest. Providers can use this without importing actor internals. */
export function studioEngineTileProviderBatchDigest(input: {
  readonly commandIdentity: string;
  readonly baseDocumentRevision: number;
  readonly baseLayerRevision: number;
  readonly complete: boolean;
  readonly deltaCount: number;
  readonly deltas: readonly {
    readonly index: number;
    readonly tileId: string;
    readonly column: number;
    readonly row: number;
    readonly baseTileRevision: number;
    readonly contentDigest: string;
  }[];
}): string {
  return studioCommandPayloadChecksum(batchDigestPayload(input));
}

function cloneEncoded(
  value: unknown,
  expectedByteLength: number,
): Uint16Array | null {
  try {
    let source: Uint8Array;
    if (value instanceof Uint16Array) {
      if (
        Object.getPrototypeOf(value) !== Uint16Array.prototype
        || !(value.buffer instanceof ArrayBuffer)
        || value.byteLength !== expectedByteLength
      ) {
        return null;
      }
      source = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else if (value instanceof ArrayBuffer) {
      if (value.byteLength !== expectedByteLength) return null;
      source = new Uint8Array(value);
    } else {
      return null;
    }
    const copy = new Uint8Array(expectedByteLength);
    copy.set(source);
    return new Uint16Array(copy.buffer);
  } catch {
    return null;
  }
}

function journalBody(
  record: Omit<StudioEngineTileJournalRecord, "recordDigest">,
): StudioCommandJsonValue {
  return canonicalPayload(record);
}

function genesisJournalDigest(documentId: string): string {
  return studioCommandPayloadChecksum(canonicalPayload({
    format: STUDIO_ENGINE_TILE_JOURNAL_FORMAT,
    documentId,
    chain: "genesis",
  }));
}

function freezeAddress(address: StudioEngineTileAddress): StudioEngineTileAddress {
  return Object.freeze({ ...address });
}

/**
 * A single-lane actor. Concurrent `commit()` calls are queued in invocation order, so two callers
 * that both claim the same base revision cannot race through provider execution.
 */
export class StudioEngineTileAuthority {
  public readonly documentId: string;
  public readonly documentWidth: number;
  public readonly documentHeight: number;
  public readonly tileSize: number;
  public readonly tileByteLength: number;
  public readonly sessionEpoch: number;
  public readonly strokeEpoch: number;
  public readonly shardBytes: bigint;

  private readonly provider: StudioEngineTileExecutionProvider;
  private readonly limits: StudioEngineTileAuthorityLimits;
  private readonly tileColumns: number;
  private readonly tilesPerLayer: bigint;

  private documentRevision = 0;
  private layers: ReadonlyMap<string, LayerState>;
  private tiles: ReadonlyMap<string, TileState> = new Map();
  private journal: readonly JournalState[] = Object.freeze([]);
  private receiptBySequence: ReadonlyMap<
  number,
  Readonly<{ identity: string; receipt: StudioEngineTileCommitReceipt }>
  > = new Map();
  private lastCommandSequence = 0;
  private residentBytes = 0;
  private journalBytes = 0;
  private disposed = false;
  private tail: Promise<void> = Promise.resolve();

  public constructor(options: StudioEngineTileAuthorityOptions) {
    if (
      !isSafeId(options.documentId)
      || !positiveInteger(options.documentWidth)
      || !positiveInteger(options.documentHeight)
      || !positiveInteger(options.sessionEpoch)
      || !positiveInteger(options.strokeEpoch)
      || typeof options.shardBytes !== "bigint"
      || options.shardBytes <= BigInt(0)
      || options.shardBytes > BigInt(Number.MAX_SAFE_INTEGER)
      || !options.provider
      || typeof options.provider.render !== "function"
    ) {
      throw new TypeError("Studio engine tile authority options are invalid.");
    }
    const tileSize = options.tileSize ?? 512;
    if (!positiveInteger(tileSize)) {
      throw new TypeError("Studio engine tile size is invalid.");
    }
    const tileWords = tileSize * tileSize * 4;
    const tileByteLength = tileWords * Uint16Array.BYTES_PER_ELEMENT;
    if (
      !Number.isSafeInteger(tileWords)
      || !Number.isSafeInteger(tileByteLength)
      || tileByteLength <= 0
    ) {
      throw new TypeError("Studio engine tile payload is too large.");
    }
    const layerIds = inspectDenseArray(options.layerIds, 4_096);
    if (!layerIds || layerIds.length === 0) {
      throw new TypeError("Studio engine tile layers are invalid.");
    }
    const layers = new Map<string, LayerState>();
    for (let index = 0; index < layerIds.length; index += 1) {
      const id = layerIds[index];
      if (!isSafeId(id) || layers.has(id)) {
        throw new TypeError("Studio engine tile layer identity is invalid.");
      }
      layers.set(id, Object.freeze({ id, index, revision: 0 }));
    }

    this.documentId = options.documentId;
    this.documentWidth = options.documentWidth;
    this.documentHeight = options.documentHeight;
    this.tileSize = tileSize;
    this.tileByteLength = tileByteLength;
    this.sessionEpoch = options.sessionEpoch;
    this.strokeEpoch = options.strokeEpoch;
    this.shardBytes = options.shardBytes;
    this.provider = options.provider;
    this.limits = normalizeLimits(options.limits);
    this.tileColumns = Math.ceil(this.documentWidth / this.tileSize);
    this.tilesPerLayer = BigInt(this.tileColumns)
      * BigInt(Math.ceil(this.documentHeight / this.tileSize));
    const logicalBytes = this.tilesPerLayer
      * BigInt(layers.size)
      * BigInt(this.tileByteLength);
    if (logicalBytes > MAX_LOGICAL_BYTES) {
      throw new TypeError("Studio engine logical tile address space is too large.");
    }
    this.layers = layers;
  }

  public stats(): StudioEngineTileAuthorityStats {
    return Object.freeze({
      documentRevision: this.documentRevision,
      layerCount: this.layers.size,
      tileCount: this.tiles.size,
      residentBytes: this.residentBytes,
      journalRecordCount: this.journal.length,
      journalBytes: this.journalBytes,
      commandCount: this.receiptBySequence.size,
    });
  }

  public layerRevision(layerId: string): number | null {
    return this.layers.get(layerId)?.revision ?? null;
  }

  public commit(input: unknown): Promise<StudioEngineTileCommitResult> {
    const run = this.tail.then(
      () => this.commitSerial(input),
      () => this.commitSerial(input),
    );
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public readTile(
    layerId: string,
    column: number,
    row: number,
  ): StudioEngineTileReadResult | null {
    if (
      !isSafeId(layerId)
      || !Number.isSafeInteger(column)
      || !Number.isSafeInteger(row)
    ) {
      return null;
    }
    const tile = this.tiles.get(tileKey(layerId, `${column}:${row}`));
    if (!tile) return null;
    const encoded = copyViewBuffer(tile.encoded);
    return Object.freeze({
      ...tile.address,
      baseTileRevision: Math.max(0, tile.revision - 1),
      tileRevision: tile.revision,
      contentDigest: tile.contentDigest,
      byteLength: tile.encoded.byteLength,
      encoded,
    });
  }

  /** Returns a defensive copy of one deterministic OPFS journal frame. */
  public journalRecord(sequence: number): Uint8Array | null {
    if (!positiveInteger(sequence)) return null;
    const bytes = this.journal[sequence - 1]?.bytes;
    return bytes ? new Uint8Array(bytes) : null;
  }

  /**
   * CPU/Storage-backed source for rebuilding GPU textures after device loss. Every payload is a
   * defensive copy, so a recovery backend cannot mutate document authority.
   */
  public deviceLossReplaySource(): StudioEngineTileDeviceLossReplaySource {
    const layers = [...this.layers.values()]
      .sort((left, right) => left.index - right.index)
      .map((layer) => Object.freeze({
        layerId: layer.id,
        layerRevision: layer.revision,
      }));
    const tiles = [...this.tiles.values()]
      .sort((left, right) => (
        left.address.layerIndex - right.address.layerIndex
        || left.address.row - right.address.row
        || left.address.column - right.address.column
      ))
      .map((tile): StudioEngineTileReadResult => Object.freeze({
        ...tile.address,
        baseTileRevision: Math.max(0, tile.revision - 1),
        tileRevision: tile.revision,
        contentDigest: tile.contentDigest,
        byteLength: tile.encoded.byteLength,
        encoded: copyViewBuffer(tile.encoded),
      }));
    return Object.freeze({
      kind: "studio-engine-tile-device-loss-replay",
      version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
      encoding: STUDIO_ENGINE_TILE_ENCODING,
      documentId: this.documentId,
      documentRevision: this.documentRevision,
      layers: Object.freeze(layers),
      tiles: Object.freeze(tiles),
      journalHeadDigest: this.journal.at(-1)?.record.recordDigest
        ?? genesisJournalDigest(this.documentId),
    });
  }

  public dispose(): void {
    this.disposed = true;
    this.tiles = new Map();
    this.journal = Object.freeze([]);
    this.receiptBySequence = new Map();
    this.residentBytes = 0;
    this.journalBytes = 0;
  }

  private async commitSerial(input: unknown): Promise<StudioEngineTileCommitResult> {
    if (this.disposed) return Object.freeze({ status: "rejected", reason: "disposed" });
    const normalized = this.normalizeCommit(input);
    if ("reason" in normalized) return Object.freeze({ status: "rejected", reason: normalized.reason });

    const seen = this.receiptBySequence.get(normalized.commandSequence);
    if (seen) {
      return seen.identity === normalized.commandIdentity
        ? Object.freeze({ status: "duplicate", receipt: seen.receipt })
        : Object.freeze({ status: "rejected", reason: "command-sequence-conflict" });
    }
    if (normalized.commandSequence !== this.lastCommandSequence + 1) {
      return Object.freeze({ status: "rejected", reason: "command-sequence-gap" });
    }
    if (this.receiptBySequence.size >= this.limits.maxCommands) {
      return Object.freeze({ status: "rejected", reason: "journal-byte-limit" });
    }
    if (normalized.baseDocumentRevision !== this.documentRevision) {
      return Object.freeze({ status: "rejected", reason: "stale-document-revision" });
    }
    const layer = this.layers.get(normalized.layerId);
    if (!layer) return Object.freeze({ status: "rejected", reason: "unknown-layer" });
    if (normalized.baseLayerRevision !== layer.revision) {
      return Object.freeze({ status: "rejected", reason: "stale-layer-revision" });
    }

    const tracker = new StudioTileDocDirtyTracker({
      tileSize: this.tileSize,
      bounds: { width: this.documentWidth, height: this.documentHeight },
      maxTiles: this.limits.maxDirtyTiles,
    });
    for (const rect of normalized.dirtyRects) tracker.addRect(rect);
    const dirty = tracker.take();
    if (
      dirty.overflowed
      || dirty.tiles.length === 0
      || dirty.tiles.length > this.limits.maxDirtyTiles
    ) {
      return Object.freeze({ status: "rejected", reason: "dirty-tile-limit" });
    }
    const dirtyTiles = [...dirty.tiles].sort(compareDirtyTiles);
    const providerInput = this.providerInput(normalized, layer, dirtyTiles);

    let providerValue: unknown;
    try {
      providerValue = await this.provider.render(providerInput);
    } catch {
      return Object.freeze({ status: "rejected", reason: "provider-failed" });
    }
    // `dispose()` is allowed to race an asynchronous GPU/provider submission. A late provider
    // result must never resurrect tiles, receipts, or journal state after the authority closes.
    if (this.disposed) {
      return Object.freeze({ status: "rejected", reason: "disposed" });
    }
    const batch = this.normalizeProviderBatch(providerValue, normalized, dirtyTiles);
    if (batch === "partial") {
      return Object.freeze({ status: "rejected", reason: "partial-provider-delta" });
    }
    if (!batch) {
      return Object.freeze({ status: "rejected", reason: "invalid-provider-delta" });
    }

    const nextDocumentRevision = nextRevision(this.documentRevision);
    const nextLayerRevision = nextRevision(layer.revision);
    if (nextDocumentRevision === null || nextLayerRevision === null) {
      return Object.freeze({ status: "rejected", reason: "revision-exhausted" });
    }

    try {
      const stagedTiles = new Map(this.tiles);
      const receiptTiles: StudioEngineTileReceiptEntry[] = [];
      let stagedResidentBytes = this.residentBytes;
      for (const delta of batch.deltas) {
        const key = tileKey(layer.id, delta.tileId);
        const previous = stagedTiles.get(key);
        if ((previous?.revision ?? 0) !== delta.baseTileRevision) {
          return Object.freeze({ status: "rejected", reason: "invalid-provider-delta" });
        }
        const tileRevision = nextRevision(previous?.revision ?? 0);
        if (tileRevision === null) {
          return Object.freeze({ status: "rejected", reason: "revision-exhausted" });
        }
        const address = this.address(layer, delta.column, delta.row);
        if (!address) {
          return Object.freeze({ status: "rejected", reason: "invalid-provider-delta" });
        }
        if (previous) stagedResidentBytes -= previous.encoded.byteLength;
        stagedResidentBytes += delta.encoded.byteLength;
        const owned = new Uint16Array(delta.encoded);
        stagedTiles.set(key, {
          address,
          revision: tileRevision,
          contentDigest: delta.contentDigest,
          encoded: owned,
        });
        receiptTiles.push(Object.freeze({
          ...address,
          baseTileRevision: delta.baseTileRevision,
          tileRevision,
          contentDigest: delta.contentDigest,
          byteLength: owned.byteLength,
        }));
      }
      if (stagedTiles.size > this.limits.maxTiles) {
        return Object.freeze({ status: "rejected", reason: "tile-limit" });
      }
      if (stagedResidentBytes > this.limits.maxResidentBytes) {
        return Object.freeze({ status: "rejected", reason: "resident-byte-limit" });
      }

      const nextJournalSequence = this.journal.length + 1;
      const journalOffset = BigInt(this.journalBytes);
      const withoutDigest: Omit<StudioEngineTileJournalRecord, "recordDigest"> = {
        format: STUDIO_ENGINE_TILE_JOURNAL_FORMAT,
        version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
        recordType: "atomic-rgba16float-tile-commit",
        sequence: nextJournalSequence,
        previousDigest: this.journal.at(-1)?.record.recordDigest
          ?? genesisJournalDigest(this.documentId),
        documentId: this.documentId,
        encoding: STUDIO_ENGINE_TILE_ENCODING,
        tileSize: this.tileSize,
        commandIdentity: normalized.commandIdentity,
        commandSequence: normalized.commandSequence,
        baseDocumentRevision: this.documentRevision,
        documentRevision: nextDocumentRevision,
        layerId: layer.id,
        layerIndex: layer.index,
        baseLayerRevision: layer.revision,
        layerRevision: nextLayerRevision,
        brushPlanDigest: hashStudioCanonicalBrushPlan(normalized.plan),
        deltas: Object.freeze(receiptTiles.map((tile, index) => Object.freeze({
          index,
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
        }))),
      };
      const recordDigest = studioCommandPayloadChecksum(journalBody(withoutDigest));
      const record = deepFreeze({ ...withoutDigest, recordDigest });
      const encodedJournal = TEXT_ENCODER.encode(
        canonicalStudioCommandJson(canonicalPayload(record)),
      );
      if (this.journalBytes + encodedJournal.byteLength > this.limits.maxJournalBytes) {
        return Object.freeze({ status: "rejected", reason: "journal-byte-limit" });
      }

      const receipt = deepFreeze<StudioEngineTileCommitReceipt>({
        kind: "studio-engine-tile-commit-receipt",
        version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
        encoding: STUDIO_ENGINE_TILE_ENCODING,
        documentId: this.documentId,
        commandIdentity: normalized.commandIdentity,
        commandSequence: normalized.commandSequence,
        baseDocumentRevision: this.documentRevision,
        documentRevision: nextDocumentRevision,
        layerId: layer.id,
        baseLayerRevision: layer.revision,
        layerRevision: nextLayerRevision,
        tiles: Object.freeze(receiptTiles),
        journalSequence: nextJournalSequence,
        journalDigest: recordDigest,
        journalByteLength: encodedJournal.byteLength,
        journalLogicalByteOffset: journalOffset,
      });
      const stagedLayers = new Map(this.layers);
      stagedLayers.set(layer.id, Object.freeze({
        id: layer.id,
        index: layer.index,
        revision: nextLayerRevision,
      }));
      const stagedJournal = Object.freeze([
        ...this.journal,
        Object.freeze({ record, bytes: new Uint8Array(encodedJournal) }),
      ]);
      const stagedReceipts = new Map(this.receiptBySequence);
      stagedReceipts.set(normalized.commandSequence, Object.freeze({
        identity: normalized.commandIdentity,
        receipt,
      }));

      // The only mutation point: everything above was staged and budgeted.
      this.tiles = stagedTiles;
      this.layers = stagedLayers;
      this.journal = stagedJournal;
      this.receiptBySequence = stagedReceipts;
      this.documentRevision = nextDocumentRevision;
      this.lastCommandSequence = normalized.commandSequence;
      this.residentBytes = stagedResidentBytes;
      this.journalBytes += encodedJournal.byteLength;

      return Object.freeze({
        status: "committed",
        receipt,
        journalBytes: new Uint8Array(encodedJournal),
      });
    } catch {
      return Object.freeze({ status: "rejected", reason: "invalid-provider-delta" });
    }
  }

  private normalizeCommit(
    input: unknown,
  ): NormalizedCommitRequest | Readonly<{ reason: StudioEngineTileCommitFailureReason }> {
    const record = inspectExactRecord(input, [
      "baseDocumentRevision",
      "baseLayerRevision",
      "layerId",
      "dirtyRects",
      "brushPlan",
    ]);
    if (!record.ok) return { reason: "invalid-request" };
    const values = record.value;
    if (
      !nonNegativeRevision(values.baseDocumentRevision)
      || !nonNegativeRevision(values.baseLayerRevision)
      || !isSafeId(values.layerId)
    ) {
      return { reason: "invalid-request" };
    }
    const rawRects = inspectDenseArray(values.dirtyRects, this.limits.maxDirtyTiles * 8);
    if (!rawRects || rawRects.length === 0) return { reason: "invalid-request" };
    const dirtyRects: StudioEngineTileDirtyRect[] = [];
    for (const rawRect of rawRects) {
      const rect = finiteRect(rawRect);
      if (!rect) return { reason: "invalid-request" };
      dirtyRects.push(rect);
    }

    const planHeader = inspectExactRecord(values.brushPlan, [
      "kind",
      "version",
      "sessionEpoch",
      "strokeEpoch",
      "commandSequence",
      "strokeId",
      "seed",
      "coordinateSpace",
      "transform",
      "color",
      "composite",
      "recipe",
      "source",
    ]);
    if (!planHeader.ok || !positiveInteger(planHeader.value.commandSequence)) {
      return { reason: "invalid-brush-command" };
    }
    const commandSequence = planHeader.value.commandSequence;
    const parseState = {
      sessionEpoch: this.sessionEpoch,
      strokeEpoch: this.strokeEpoch,
      // Parse independently of actor progress; the actor frontier is checked after identity.
      lastAcceptedCommandSequence: commandSequence - 1,
    };
    const parsed = parseStudioCanonicalBrushPlan(values.brushPlan, parseState);
    if (!parsed.ok) return { reason: "invalid-brush-command" };
    const plan = parsed.value.plan;
    const planDigest = hashStudioCanonicalBrushPlan(plan);
    const commandIdentity = `brush-rgba16f-v1:${studioCommandPayloadChecksum(canonicalPayload({
      layerId: values.layerId,
      planDigest,
      plan,
    }))}`;
    return Object.freeze({
      baseDocumentRevision: values.baseDocumentRevision,
      baseLayerRevision: values.baseLayerRevision,
      layerId: values.layerId,
      dirtyRects: Object.freeze(dirtyRects),
      plan,
      commandIdentity,
      commandSequence,
    });
  }

  private providerInput(
    request: NormalizedCommitRequest,
    layer: LayerState,
    dirtyTiles: readonly StudioTileDocDirtyTile[],
  ): StudioEngineTileProviderInput {
    const targets = dirtyTiles.map((dirty): StudioEngineTileProviderBaseTile => {
      const address = this.address(layer, dirty.column, dirty.row);
      if (!address) throw new RangeError("Dirty tile address is outside the document.");
      const existing = this.tiles.get(tileKey(layer.id, dirty.id));
      return Object.freeze({
        address,
        tileRevision: existing?.revision ?? 0,
        contentDigest: existing?.contentDigest ?? null,
        encoded: existing ? copyViewBuffer(existing.encoded) : null,
      });
    });
    return Object.freeze({
      kind: "studio-engine-tile-provider-input",
      version: STUDIO_ENGINE_TILE_AUTHORITY_VERSION,
      encoding: STUDIO_ENGINE_TILE_ENCODING,
      commandIdentity: request.commandIdentity,
      baseDocumentRevision: this.documentRevision,
      baseLayerRevision: layer.revision,
      layerId: layer.id,
      tileSize: this.tileSize,
      brushPlan: request.plan,
      targets: Object.freeze(targets),
    });
  }

  private normalizeProviderBatch(
    input: unknown,
    request: NormalizedCommitRequest,
    dirtyTiles: readonly StudioTileDocDirtyTile[],
  ): NormalizedProviderBatch | "partial" | null {
    const record = inspectExactRecord(input, [
      "kind",
      "version",
      "commandIdentity",
      "baseDocumentRevision",
      "baseLayerRevision",
      "complete",
      "deltaCount",
      "deltas",
      "batchDigest",
    ]);
    if (!record.ok) return null;
    const value = record.value;
    if (value.complete !== true) return "partial";
    if (
      value.kind !== "studio-engine-tile-provider-delta"
      || value.version !== STUDIO_ENGINE_TILE_AUTHORITY_VERSION
      || value.commandIdentity !== request.commandIdentity
      || value.baseDocumentRevision !== request.baseDocumentRevision
      || value.baseLayerRevision !== request.baseLayerRevision
      || value.deltaCount !== dirtyTiles.length
      || typeof value.batchDigest !== "string"
    ) {
      return null;
    }
    const rawDeltas = inspectDenseArray(value.deltas, this.limits.maxDirtyTiles);
    if (!rawDeltas || rawDeltas.length !== dirtyTiles.length) return "partial";
    const deltas: NormalizedProviderDelta[] = [];
    for (let index = 0; index < rawDeltas.length; index += 1) {
      const raw = inspectExactRecord(rawDeltas[index], [
        "index",
        "tileId",
        "column",
        "row",
        "baseTileRevision",
        "encoded",
        "contentDigest",
      ]);
      if (!raw.ok) return null;
      const delta = raw.value;
      const expected = dirtyTiles[index]!;
      if (
        delta.index !== index
        || delta.tileId !== expected.id
        || delta.column !== expected.column
        || delta.row !== expected.row
        || !nonNegativeRevision(delta.baseTileRevision)
        || typeof delta.contentDigest !== "string"
      ) {
        return null;
      }
      const current = this.tiles.get(tileKey(request.layerId, expected.id));
      if (delta.baseTileRevision !== (current?.revision ?? 0)) return null;
      const encoded = cloneEncoded(delta.encoded, this.tileByteLength);
      if (!encoded) return null;
      const digest = studioEngineRgba16FloatTileDigest(encoded);
      if (digest !== delta.contentDigest) return null;
      deltas.push(Object.freeze({
        index,
        tileId: expected.id,
        column: expected.column,
        row: expected.row,
        baseTileRevision: delta.baseTileRevision,
        encoded,
        contentDigest: digest,
      }));
    }
    const normalized: NormalizedProviderBatch = Object.freeze({
      commandIdentity: request.commandIdentity,
      baseDocumentRevision: request.baseDocumentRevision,
      baseLayerRevision: request.baseLayerRevision,
      complete: true,
      deltaCount: deltas.length,
      deltas: Object.freeze(deltas),
      batchDigest: value.batchDigest,
    });
    const expectedDigest = studioEngineTileProviderBatchDigest(normalized);
    return expectedDigest === normalized.batchDigest ? normalized : null;
  }

  private address(
    layer: LayerState,
    column: number,
    row: number,
  ): StudioEngineTileAddress | null {
    const tileRows = Math.ceil(this.documentHeight / this.tileSize);
    if (
      !Number.isSafeInteger(column)
      || !Number.isSafeInteger(row)
      || column < 0
      || row < 0
      || column >= this.tileColumns
      || row >= tileRows
    ) {
      return null;
    }
    const tileInLayer = BigInt(row) * BigInt(this.tileColumns) + BigInt(column);
    const logicalTileIndex = BigInt(layer.index) * this.tilesPerLayer + tileInLayer;
    const logicalByteOffset = logicalTileIndex * BigInt(this.tileByteLength);
    if (logicalByteOffset > MAX_LOGICAL_BYTES - BigInt(this.tileByteLength)) return null;
    return freezeAddress({
      tileId: `${column}:${row}`,
      column,
      row,
      layerId: layer.id,
      layerIndex: layer.index,
      logicalTileIndex,
      logicalByteOffset,
      shardIndex: logicalByteOffset / this.shardBytes,
      shardByteOffset: logicalByteOffset % this.shardBytes,
    });
  }
}
