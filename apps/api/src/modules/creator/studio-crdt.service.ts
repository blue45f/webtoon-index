import { randomUUID } from "node:crypto";

import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from "@nestjs/common";
import { fromUint8Array, toUint8Array } from "js-base64";
import * as Y from "yjs";

import {
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  appendedStudioCrdtRasterAssetReferences,
  appendsStudioCrdtRasterCheckpoint,
  assertStudioCrdtRasterAppendedEventAdmission,
  assertStudioCrdtRasterAppendedEventsAfterCheckpointHorizon,
  conflictsWithStudioCrdtRasterRootSnapshot,
  preservesStudioCrdtRasterRoots,
  snapshotStudioCrdtRasterRoots,
} from "../../../../web/src/shared/lib/studio-crdt-raster-document-contract";
import {
  STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK,
} from "../../../../web/src/shared/lib/studio-work-asset-contract";

import {
  STUDIO_CRDT_CLUSTER_LOAD_REPOSITORY,
  type StudioCrdtClusterLoadRepository,
} from "./studio-crdt-cluster-load.repository";
import { StudioCrdtRasterCheckpointCoordinator } from "./studio-crdt-raster-checkpoint.coordinator";
import {
  STUDIO_CRDT_UUID_PATTERN as UUID_PATTERN,
  admitsStudioCrdtShared3dStageEvents,
  hasValidStudioCrdtRootSchema,
  isBoundedStudioCrdtId,
  preservesStudioCrdtDeletionRoots,
  preservesStudioCrdtShared3dStageRoots,
  snapshotStudioCrdtR8GrainReferences,
  snapshotStudioCrdtDeletionRoots,
  snapshotStudioCrdtShared3dStageRoots,
  snapshotStudioWorkAssetReferences,
} from "./studio-crdt-root-schema";
import {
  STUDIO_CRDT_REPOSITORY,
  STUDIO_CRDT_SNAPSHOT_MAX_BYTES,
  STUDIO_CRDT_UPDATE_MAX_BYTES,
  studioCrdtPayloadHash,
} from "./studio-crdt.repository";
import { StudioRasterAssetService } from "./studio-raster-asset.service";
import { StudioWorkAssetService } from "./studio-work-asset.service";

import type {
  DrizzleStudioCrdtTransaction,
  StudioCrdtHydrationState,
  StudioCrdtRepository,
  StudioCrdtUpdateRecord,
} from "./studio-crdt.repository";
import type { StudioBrushR8TextureGrainSource } from "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract";
import type {
  StudioRasterAssetReference,
  StudioRasterOperation,
} from "../../../../web/src/shared/lib/studio-crdt-raster-ops";
import type { StudioWorkAssetReference } from "../../../../web/src/shared/lib/studio-work-asset-contract";

export { hasValidStudioCrdtRootSchema };

export interface StudioCrdtRasterAssetAdmission {
  assertReferencesStored(
    actorUserId: string,
    workId: string,
    references: readonly StudioRasterAssetReference[],
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void>;
}

export interface StudioCrdtWorkAssetAdmission {
  assertReferencesStored(
    actorUserId: string,
    workId: string,
    references: readonly StudioWorkAssetReference[],
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void>;
  assertR8GrainReferencesStored(
    actorUserId: string,
    workId: string,
    references: readonly Readonly<StudioBrushR8TextureGrainSource>[],
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void>;
}

export const STUDIO_CRDT_SERVICE_OPTIONS = Symbol("STUDIO_CRDT_SERVICE_OPTIONS");
export const STUDIO_CRDT_STATE_VECTOR_MAX_BYTES = 256 * 1_024;
export const STUDIO_CRDT_SYNC_DIFF_MAX_BYTES = STUDIO_CRDT_SNAPSHOT_MAX_BYTES;
export const STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES = 40 * 1_024;
export const STUDIO_CRDT_ACTIVE_WORK_ASSET_REFERENCE_MAX_COUNT =
  STUDIO_WORK_ASSET_MAX_ASSETS_PER_WORK;

const DEFAULT_COMPACT_UPDATE_COUNT = 512;
const DEFAULT_COMPACT_UPDATE_BYTES = 2 * 1_024 * 1_024;
const DEFAULT_COMPACT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_IDLE_EVICTION_MS = 5 * 60_000;
const DEFAULT_EVICTION_SWEEP_MS = 60_000;
// A queued sync can retain a decoded 256 KiB state vector, so these are intentionally much lower
// than the gateway's identity-bucket cardinality. The normal 40 Hz/batched drawing path stays well
// below the room limit while a stalled database cannot retain an unbounded heap of request bodies.
const DEFAULT_MAX_PENDING_OPERATIONS_PER_WORK = 128;
const DEFAULT_MAX_PENDING_OPERATIONS_TOTAL = 512;
// Cluster-wide extension of the two local caps above. Sampling is active only while this process
// has pending work; an idle API node performs no recurring cluster-load database traffic.
const DEFAULT_CLUSTER_LOAD_HEARTBEAT_MS = 350;
const DEFAULT_CLUSTER_LOAD_STALE_AFTER_MS = 1_500;
const DEFAULT_MAX_CLUSTER_PENDING_OPERATIONS_TOTAL = 2_048;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const STUDIO_CRDT_LAYER_GROUP_ROOT_PREFIX = "layer-group:";

function studioCrdtLayerGroupRootName(pageId: string, layerId: string): string {
  const key = `${pageId.length}:${pageId}${layerId.length}:${layerId}`;
  return `${STUDIO_CRDT_LAYER_GROUP_ROOT_PREFIX}${encodeURIComponent(key)}`;
}

function studioCrdtLayerGroupIsLocked(
  doc: Y.Doc,
  pageId: string,
  layerId: string
): boolean {
  if (layerId === "page-root") return false;
  const record = doc.share.get(studioCrdtLayerGroupRootName(pageId, layerId));
  if (!(record instanceof Y.Map) || record.get("deleted") === true) return false;
  if (record.get("unset:locked") === true) return false;
  const current = record.get("prop:locked");
  if (typeof current === "boolean") return current;
  return record.get("base:locked") === true;
}

function assertStudioCrdtAppendedRasterLayersWritable(
  existingOperationIds: ReadonlyMap<string, unknown> | undefined,
  doc: Y.Doc
): void {
  const root = doc.share.get(STUDIO_CRDT_RASTER_OPERATIONS_ROOT);
  if (!(root instanceof Y.Map)) return;
  for (const [operationId, encoded] of root) {
    if (existingOperationIds?.has(operationId)) continue;
    const operation = (JSON.parse(encoded as string) as { operation: StudioRasterOperation })
      .operation;
    if (studioCrdtLayerGroupIsLocked(doc, operation.pageId, operation.layerId)) {
      throw new StudioCrdtInvalidPayloadError(
        "update cannot append a Studio raster operation to a locked layer"
      );
    }
  }
}

export interface StudioCrdtServiceOptions {
  now?: () => Date;
  stateVectorMaxBytes?: number;
  compactUpdateCount?: number;
  compactUpdateBytes?: number;
  compactIntervalMs?: number;
  idleEvictionMs?: number;
  evictionSweepMs?: number;
  maxPendingOperationsPerWork?: number;
  maxPendingOperationsTotal?: number;
  clusterLoadHeartbeatMs?: number;
  clusterLoadStaleAfterMs?: number;
  maxClusterPendingOperationsTotal?: number;
  nodeId?: string;
  scheduleInterval?: (handler: () => void, delay: number) => ReturnType<typeof setInterval>;
  cancelInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

export interface StudioCrdtSyncResult {
  chunks: string[];
  chunkCount: number;
  totalBytes: number;
  serverStateVector: string;
  serverSequence: string;
}

export interface StudioCrdtBinarySyncResult {
  update: Uint8Array;
  totalBytes: number;
  serverStateVector: Uint8Array;
  serverSequence: string;
}

export interface StudioCrdtApplyUpdateInput {
  workId: string;
  updateId: string;
  actorUserId: string;
  data: string;
}

export interface StudioCrdtApplyBinaryUpdateInput {
  workId: string;
  updateId: string;
  actorUserId: string;
  data: Uint8Array;
}

export interface StudioCrdtApplyUpdateResult {
  duplicate: boolean;
  updateId: string;
  update: string;
  serverStateVector: string;
  serverSequence: string;
}

export interface StudioCrdtApplyBinaryUpdateResult {
  duplicate: boolean;
  updateId: string;
  update: Uint8Array;
  serverStateVector: Uint8Array;
  serverSequence: string;
}

export class StudioCrdtInvalidPayloadError extends Error {
  constructor(message = "Invalid CRDT payload") {
    super(message);
    this.name = "StudioCrdtInvalidPayloadError";
  }
}

export class StudioCrdtUpdateIdConflictError extends Error {
  constructor() {
    super("CRDT update id was already used for different content");
    this.name = "StudioCrdtUpdateIdConflictError";
  }
}

export class StudioCrdtDocumentTooLargeError extends Error {
  constructor() {
    super("CRDT document exceeds the server byte budget");
    this.name = "StudioCrdtDocumentTooLargeError";
  }
}

/**
 * The operation was rejected before execution because this API process already has the bounded
 * amount of CRDT work it can retain safely. Clients may retry the same idempotent request after
 * backoff; no durable mutation has started when this error is raised.
 */
export class StudioCrdtBackpressureError extends Error {
  constructor() {
    super("CRDT operation queue is saturated");
    this.name = "StudioCrdtBackpressureError";
  }
}

export class StudioCrdtStorageCorruptionError extends Error {
  constructor(message = "Stored CRDT state is invalid") {
    super(message);
    this.name = "StudioCrdtStorageCorruptionError";
  }
}

interface CachedStudioCrdtDocument {
  doc: Y.Doc;
  sequence: bigint;
  compactedSequence: bigint;
  uncompactedUpdateCount: number;
  uncompactedUpdateBytes: number;
  lastCompactedAt: number;
  lastAccessedAt: number;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

export function decodeStudioCrdtBase64(
  value: string,
  maximumDecodedBytes: number,
  label: string
): Uint8Array {
  const maximumEncodedLength = Math.ceil(maximumDecodedBytes / 3) * 4;
  if (
    value.length === 0 ||
    value.length > maximumEncodedLength ||
    value.length % 4 !== 0 ||
    !BASE64_PATTERN.test(value)
  ) {
    throw new StudioCrdtInvalidPayloadError(`${label} is not canonical base64`);
  }
  let decoded: Uint8Array;
  try {
    decoded = toUint8Array(value);
  } catch {
    throw new StudioCrdtInvalidPayloadError(`${label} is not valid base64`);
  }
  if (
    decoded.byteLength === 0 ||
    decoded.byteLength > maximumDecodedBytes ||
    fromUint8Array(decoded) !== value
  ) {
    throw new StudioCrdtInvalidPayloadError(`${label} exceeds its decoded byte budget`);
  }
  return decoded;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function chunkStudioCrdtSyncDiff(diff: Uint8Array): string[] {
  const chunks: string[] = [];
  for (let offset = 0; offset < diff.byteLength; offset += STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES) {
    chunks.push(fromUint8Array(diff.subarray(offset, offset + STUDIO_CRDT_SYNC_CHUNK_MAX_BYTES)));
  }
  return chunks;
}

export function encodeStudioCrdtServerStateVector(
  doc: Y.Doc,
  maximumDecodedBytes = STUDIO_CRDT_STATE_VECTOR_MAX_BYTES
): string {
  return fromUint8Array(
    encodeStudioCrdtServerStateVectorBytes(doc, maximumDecodedBytes)
  );
}

export function encodeStudioCrdtServerStateVectorBytes(
  doc: Y.Doc,
  maximumDecodedBytes = STUDIO_CRDT_STATE_VECTOR_MAX_BYTES
): Uint8Array {
  const stateVector = Y.encodeStateVector(doc);
  if (stateVector.byteLength > maximumDecodedBytes) {
    throw new StudioCrdtStorageCorruptionError(
      "Stored CRDT state vector exceeds its byte budget"
    );
  }
  return stateVector;
}

function copyStudioCrdtBytes(
  value: Uint8Array,
  maximumBytes: number,
  label: string
): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximumBytes
  ) {
    throw new StudioCrdtInvalidPayloadError(`${label} exceeds its decoded byte budget`);
  }
  return Uint8Array.from(value);
}

function validateStoredUpdate(update: StudioCrdtUpdateRecord, workId: string): void {
  if (
    update.workId !== workId ||
    typeof update.sequence !== "bigint" ||
    update.sequence <= 0n ||
    !UUID_PATTERN.test(update.updateId) ||
    (update.actorUserId !== null && !isBoundedStudioCrdtId(update.actorUserId)) ||
    !(update.payload instanceof Uint8Array) ||
    update.payload.byteLength === 0 ||
    update.payload.byteLength > STUDIO_CRDT_UPDATE_MAX_BYTES ||
    !(update.createdAt instanceof Date) ||
    !Number.isFinite(update.createdAt.getTime())
  ) {
    throw new StudioCrdtStorageCorruptionError("Stored CRDT update violates its contract");
  }
}

@Injectable()
export class StudioCrdtService implements OnModuleDestroy {
  private readonly logger = new Logger(StudioCrdtService.name);
  private readonly documents = new Map<string, CachedStudioCrdtDocument>();
  private readonly workTails = new Map<string, Promise<void>>();
  private readonly now: () => Date;
  private readonly stateVectorMaxBytes: number;
  private readonly compactUpdateCount: number;
  private readonly compactUpdateBytes: number;
  private readonly compactIntervalMs: number;
  private readonly idleEvictionMs: number;
  private readonly maxPendingOperationsPerWork: number;
  private readonly maxPendingOperationsTotal: number;
  private readonly pendingOperationsByWork = new Map<string, number>();
  private pendingOperationCount = 0;
  private readonly nodeId: string;
  private readonly clusterLoadHeartbeatMs: number;
  private readonly clusterLoadStaleAfterMs: number;
  private readonly maxClusterPendingOperationsTotal: number;
  private cachedClusterPendingOperations = 0;
  private lastClusterLoadSuccessAt = 0;
  private lastReportedPendingOperationCount: number | null = null;
  private clusterLoadReportQueued = false;
  private clusterLoadHeartbeatPromise: Promise<void> | null = null;
  private clusterLoadTimer: ReturnType<typeof setInterval> | null = null;
  private readonly scheduleInterval: (
    handler: () => void,
    delay: number
  ) => ReturnType<typeof setInterval>;
  private readonly cancelInterval: (handle: ReturnType<typeof setInterval>) => void;
  private readonly evictionTimer: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor(
    @Inject(STUDIO_CRDT_REPOSITORY)
    private readonly repository: StudioCrdtRepository,
    @Inject(StudioRasterAssetService)
    private readonly rasterAssetAdmission: StudioCrdtRasterAssetAdmission,
    @Inject(StudioWorkAssetService)
    private readonly workAssetAdmission: StudioCrdtWorkAssetAdmission,
    @Inject(STUDIO_CRDT_CLUSTER_LOAD_REPOSITORY)
    private readonly clusterLoadRepository: StudioCrdtClusterLoadRepository,
    @Optional()
    @Inject(STUDIO_CRDT_SERVICE_OPTIONS)
    options: StudioCrdtServiceOptions = {},
    @Optional()
    @Inject(StudioCrdtRasterCheckpointCoordinator)
    private readonly rasterCheckpointCoordinator?: StudioCrdtRasterCheckpointCoordinator
  ) {
    this.now = options.now ?? (() => new Date());
    this.stateVectorMaxBytes = boundedInteger(
      options.stateVectorMaxBytes,
      STUDIO_CRDT_STATE_VECTOR_MAX_BYTES,
      1,
      STUDIO_CRDT_STATE_VECTOR_MAX_BYTES
    );
    this.compactUpdateCount = boundedInteger(
      options.compactUpdateCount,
      DEFAULT_COMPACT_UPDATE_COUNT,
      2,
      100_000
    );
    this.compactUpdateBytes = boundedInteger(
      options.compactUpdateBytes,
      DEFAULT_COMPACT_UPDATE_BYTES,
      STUDIO_CRDT_UPDATE_MAX_BYTES,
      STUDIO_CRDT_SNAPSHOT_MAX_BYTES
    );
    this.compactIntervalMs = boundedInteger(
      options.compactIntervalMs,
      DEFAULT_COMPACT_INTERVAL_MS,
      1_000,
      24 * 60 * 60_000
    );
    this.idleEvictionMs = boundedInteger(
      options.idleEvictionMs,
      DEFAULT_IDLE_EVICTION_MS,
      1_000,
      24 * 60 * 60_000
    );
    this.maxPendingOperationsPerWork = boundedInteger(
      options.maxPendingOperationsPerWork,
      DEFAULT_MAX_PENDING_OPERATIONS_PER_WORK,
      1,
      100_000
    );
    this.maxPendingOperationsTotal = boundedInteger(
      options.maxPendingOperationsTotal,
      DEFAULT_MAX_PENDING_OPERATIONS_TOTAL,
      1,
      1_000_000
    );
    this.nodeId = options.nodeId ?? randomUUID();
    this.clusterLoadHeartbeatMs = boundedInteger(
      options.clusterLoadHeartbeatMs,
      DEFAULT_CLUSTER_LOAD_HEARTBEAT_MS,
      100,
      5_000
    );
    this.clusterLoadStaleAfterMs = boundedInteger(
      options.clusterLoadStaleAfterMs,
      DEFAULT_CLUSTER_LOAD_STALE_AFTER_MS,
      500,
      30_000
    );
    this.maxClusterPendingOperationsTotal = boundedInteger(
      options.maxClusterPendingOperationsTotal,
      DEFAULT_MAX_CLUSTER_PENDING_OPERATIONS_TOTAL,
      1,
      1_000_000
    );
    this.cancelInterval = options.cancelInterval ?? clearInterval;
    this.scheduleInterval = options.scheduleInterval ?? setInterval;
    this.evictionTimer = this.scheduleInterval(
      () => this.evictIdleDocuments(),
      boundedInteger(
        options.evictionSweepMs,
        DEFAULT_EVICTION_SWEEP_MS,
        1_000,
        60 * 60_000
      )
    );
    this.evictionTimer.unref?.();
  }

  get cachedDocumentCount(): number {
    return this.documents.size;
  }

  async sync(workId: string, stateVectorBase64?: string | null): Promise<StudioCrdtSyncResult> {
    const stateVector =
      stateVectorBase64 == null
        ? null
        : decodeStudioCrdtBase64(
            stateVectorBase64,
            STUDIO_CRDT_STATE_VECTOR_MAX_BYTES,
            "state vector"
          );
    const sync = await this.syncBytes(workId, stateVector);
    const chunks = chunkStudioCrdtSyncDiff(sync.update);
    return {
      chunks,
      chunkCount: chunks.length,
      totalBytes: sync.totalBytes,
      serverStateVector: fromUint8Array(sync.serverStateVector),
      serverSequence: sync.serverSequence,
    };
  }

  async syncBytes(
    workId: string,
    stateVectorValue?: Uint8Array | null
  ): Promise<StudioCrdtBinarySyncResult> {
    const stateVector =
      stateVectorValue == null
        ? null
        : copyStudioCrdtBytes(
            stateVectorValue,
            STUDIO_CRDT_STATE_VECTOR_MAX_BYTES,
            "state vector"
          );
    return this.withWorkLock(workId, async () => {
      const entry = await this.getCaughtUpDocument(workId);
      let diff: Uint8Array;
      try {
        diff = stateVector
          ? Y.encodeStateAsUpdate(entry.doc, stateVector)
          : Y.encodeStateAsUpdate(entry.doc);
      } catch {
        throw new StudioCrdtInvalidPayloadError("state vector is not a valid Yjs state vector");
      }
      if (diff.byteLength > STUDIO_CRDT_SYNC_DIFF_MAX_BYTES) {
        throw new StudioCrdtDocumentTooLargeError();
      }
      entry.lastAccessedAt = this.now().getTime();
      return {
        update: diff,
        totalBytes: diff.byteLength,
        serverStateVector: encodeStudioCrdtServerStateVectorBytes(
          entry.doc,
          this.stateVectorMaxBytes
        ),
        serverSequence: entry.sequence.toString(),
      };
    });
  }

  async applyUpdate(input: StudioCrdtApplyUpdateInput): Promise<StudioCrdtApplyUpdateResult> {
    if (!UUID_PATTERN.test(input.updateId)) {
      throw new StudioCrdtInvalidPayloadError("update id must be a UUID");
    }
    const update = decodeStudioCrdtBase64(input.data, STUDIO_CRDT_UPDATE_MAX_BYTES, "update");
    const applied = await this.applyUpdateBytes({
      workId: input.workId,
      updateId: input.updateId,
      actorUserId: input.actorUserId,
      data: update,
    });
    return {
      ...applied,
      update: fromUint8Array(applied.update),
      serverStateVector: fromUint8Array(applied.serverStateVector),
    };
  }

  async applyUpdateBytes(
    input: StudioCrdtApplyBinaryUpdateInput
  ): Promise<StudioCrdtApplyBinaryUpdateResult> {
    if (!UUID_PATTERN.test(input.updateId)) {
      throw new StudioCrdtInvalidPayloadError("update id must be a UUID");
    }
    const update = copyStudioCrdtBytes(
      input.data,
      STUDIO_CRDT_UPDATE_MAX_BYTES,
      "update"
    );
    return this.withWorkLock(input.workId, async () => {
      const entry = await this.getCaughtUpDocument(input.workId);
      const persisted = await this.repository.appendUpdate(
        {
          workId: input.workId,
          updateId: input.updateId,
          actorUserId: input.actorUserId,
          payload: update,
          createdAt: this.now(),
        },
        (current, transaction) => this.validateUpdateAgainstHydration(
          input.workId,
          current,
          update,
          input.actorUserId,
          transaction
        )
      );
      if (
        persisted.receipt.actorUserId !== input.actorUserId ||
        !bytesEqual(persisted.receipt.payloadHash, studioCrdtPayloadHash(update))
      ) {
        throw new StudioCrdtUpdateIdConflictError();
      }

      // A different API process can commit between the pre-validation catch-up and this insert.
      // Reload from the durable sequence boundary so the cached doc includes both commits.
      await this.catchUpDocument(input.workId, entry);
      entry.lastAccessedAt = this.now().getTime();
      await this.maybeCompact(input.workId, entry);
      await this.rasterCheckpointCoordinator?.maybeEnqueue(
        input.workId,
        entry.doc,
        entry.sequence
      );
      return {
        duplicate: !persisted.inserted,
        updateId: persisted.receipt.updateId,
        update,
        serverStateVector: encodeStudioCrdtServerStateVectorBytes(
          entry.doc,
          this.stateVectorMaxBytes
        ),
        serverSequence: persisted.receipt.sequence.toString(),
      };
    });
  }

  evictIdleDocuments(now = this.now().getTime()): number {
    let evicted = 0;
    for (const [workId, entry] of this.documents) {
      if (
        this.workTails.has(workId) ||
        now - entry.lastAccessedAt < this.idleEvictionMs
      ) {
        continue;
      }
      entry.doc.destroy();
      this.documents.delete(workId);
      evicted += 1;
    }
    return evicted;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelInterval(this.evictionTimer);
    if (this.clusterLoadTimer) this.cancelInterval(this.clusterLoadTimer);
    this.clusterLoadTimer = null;
    // Wait out the active heartbeat control promise. A database driver cannot cancel a query that
    // already lost the bounded timeout race, but that detached query never owns service state (see
    // runClusterLoadHeartbeat), so it cannot mutate admission data after teardown completes.
    await Promise.allSettled([
      ...this.workTails.values(),
      ...(this.clusterLoadHeartbeatPromise ? [this.clusterLoadHeartbeatPromise] : []),
    ]);
    await this.clearReportedClusterLoadOnShutdown();
    for (const entry of this.documents.values()) entry.doc.destroy();
    this.documents.clear();
    this.workTails.clear();
    this.pendingOperationsByWork.clear();
    this.pendingOperationCount = 0;
  }

  private async getCaughtUpDocument(workId: string): Promise<CachedStudioCrdtDocument> {
    let entry = this.documents.get(workId);
    if (!entry) {
      entry = this.createCachedDocument(workId, await this.repository.loadDocument(workId));
      this.documents.set(workId, entry);
    } else {
      await this.catchUpDocument(workId, entry);
    }
    entry.lastAccessedAt = this.now().getTime();
    return entry;
  }

  private createCachedDocument(
    workId: string,
    state: StudioCrdtHydrationState
  ): CachedStudioCrdtDocument {
    const now = this.now().getTime();
    const entry: CachedStudioCrdtDocument = {
      doc: new Y.Doc(),
      sequence: 0n,
      compactedSequence: 0n,
      uncompactedUpdateCount: 0,
      uncompactedUpdateBytes: 0,
      lastCompactedAt: now,
      lastAccessedAt: now,
    };
    try {
      this.applyHydration(workId, entry, state);
      return entry;
    } catch (error) {
      entry.doc.destroy();
      throw error;
    }
  }

  private async catchUpDocument(
    workId: string,
    entry: CachedStudioCrdtDocument
  ): Promise<void> {
    const state = await this.repository.loadCatchUp(workId, entry.sequence);
    this.applyHydration(workId, entry, state);
  }

  private applyHydration(
    workId: string,
    entry: CachedStudioCrdtDocument,
    state: StudioCrdtHydrationState
  ): void {
    if (state.snapshot) {
      if (
        state.snapshot.workId !== workId ||
        typeof state.snapshot.compactedSequence !== "bigint" ||
        !(state.snapshot.snapshot instanceof Uint8Array) ||
        state.snapshot.snapshot.byteLength === 0 ||
        state.snapshot.snapshot.byteLength > STUDIO_CRDT_SNAPSHOT_MAX_BYTES ||
        state.snapshot.compactedSequence <= entry.sequence ||
        !(state.snapshot.updatedAt instanceof Date) ||
        !Number.isFinite(state.snapshot.updatedAt.getTime())
      ) {
        throw new StudioCrdtStorageCorruptionError("Stored CRDT snapshot violates its contract");
      }
    }
    let previousStoredSequence = state.snapshot?.compactedSequence ?? entry.sequence;
    const storedUpdateIds = new Set<string>();
    for (const update of state.updates) {
      validateStoredUpdate(update, workId);
      // Repository reads are an ordered append log. Silently skipping a duplicate/regressing row
      // would let a corrupt or misconfigured repository hide a committed update forever, and a
      // later compaction could then make that omission permanent. Sequence gaps are valid because
      // PostgreSQL identities can be consumed by aborted or unrelated-work transactions.
      if (update.sequence <= previousStoredSequence) {
        throw new StudioCrdtStorageCorruptionError(
          "Stored CRDT updates are not strictly ordered"
        );
      }
      if (storedUpdateIds.has(update.updateId)) {
        throw new StudioCrdtStorageCorruptionError(
          "Stored CRDT updates reuse an idempotency key"
        );
      }
      storedUpdateIds.add(update.updateId);
      previousStoredSequence = update.sequence;
    }
    const prospectiveSequence = state.snapshot?.compactedSequence ?? entry.sequence;
    if (
      !state.snapshot &&
      !state.updates.some((update) => update.sequence > prospectiveSequence)
    ) return;

    const staged = new Y.Doc();
    let ownsStagedDocument = true;
    let sequence = entry.sequence;
    let compactedSequence = entry.compactedSequence;
    let uncompactedUpdateCount = entry.uncompactedUpdateCount;
    let uncompactedUpdateBytes = entry.uncompactedUpdateBytes;
    let lastCompactedAt = entry.lastCompactedAt;
    try {
      try {
        Y.applyUpdate(staged, Y.encodeStateAsUpdate(entry.doc), "server-hydrate-base");
      } catch {
        throw new StudioCrdtStorageCorruptionError("Cached CRDT document cannot be staged");
      }
      if (state.snapshot) {
        const deletionRootsBefore = snapshotStudioCrdtDeletionRoots(staged);
        const rasterRootsBefore = snapshotStudioCrdtRasterRoots(staged);
        const shared3dStageRootsBefore = snapshotStudioCrdtShared3dStageRoots(staged);
        try {
          Y.applyUpdate(staged, state.snapshot.snapshot, "server-hydrate-snapshot");
        } catch {
          throw new StudioCrdtStorageCorruptionError("Stored CRDT snapshot cannot be decoded");
        }
        if (!hasValidStudioCrdtRootSchema(staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT snapshot violates the Studio root schema"
          );
        }
        if (!preservesStudioCrdtDeletionRoots(deletionRootsBefore, staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT snapshot rewrites grow-only deletion history"
          );
        }
        if (!preservesStudioCrdtRasterRoots(rasterRootsBefore, staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT snapshot rewrites grow-only raster history"
          );
        }
        if (!preservesStudioCrdtShared3dStageRoots(shared3dStageRootsBefore, staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT snapshot rewrites Shared Stage ownership history"
          );
        }
        if (!admitsStudioCrdtShared3dStageEvents(shared3dStageRootsBefore, staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT snapshot skips Shared Stage ownership generations"
          );
        }
        sequence = state.snapshot.compactedSequence;
        compactedSequence = state.snapshot.compactedSequence;
        uncompactedUpdateCount = 0;
        uncompactedUpdateBytes = 0;
        lastCompactedAt = state.snapshot.updatedAt.getTime();
      }
      for (const update of state.updates) {
        if (update.sequence <= sequence) continue;
        const deletionRootsBefore = snapshotStudioCrdtDeletionRoots(staged);
        const rasterRootsBefore = snapshotStudioCrdtRasterRoots(staged);
        const shared3dStageRootsBefore = snapshotStudioCrdtShared3dStageRoots(staged);
        try {
          Y.applyUpdate(staged, update.payload, "server-hydrate-update");
        } catch {
          throw new StudioCrdtStorageCorruptionError("Stored CRDT update cannot be decoded");
        }
        if (!hasValidStudioCrdtRootSchema(staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT update violates the Studio root schema"
          );
        }
        if (!preservesStudioCrdtDeletionRoots(deletionRootsBefore, staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT update rewrites grow-only deletion history"
          );
        }
        if (!preservesStudioCrdtRasterRoots(rasterRootsBefore, staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT update rewrites grow-only raster history"
          );
        }
        if (!preservesStudioCrdtShared3dStageRoots(shared3dStageRootsBefore, staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT update rewrites Shared Stage ownership history"
          );
        }
        if (!admitsStudioCrdtShared3dStageEvents(shared3dStageRootsBefore, staged)) {
          throw new StudioCrdtStorageCorruptionError(
            "Stored CRDT update skips Shared Stage ownership generations"
          );
        }
        sequence = update.sequence;
        uncompactedUpdateCount += 1;
        uncompactedUpdateBytes += update.payload.byteLength;
      }
      if (!hasValidStudioCrdtRootSchema(staged)) {
        throw new StudioCrdtStorageCorruptionError("Stored CRDT document violates its root schema");
      }
      if (Y.encodeStateAsUpdate(staged).byteLength > STUDIO_CRDT_SNAPSHOT_MAX_BYTES) {
        throw new StudioCrdtStorageCorruptionError("Stored CRDT document exceeds its byte budget");
      }
      encodeStudioCrdtServerStateVectorBytes(staged, this.stateVectorMaxBytes);

      const previous = entry.doc;
      entry.doc = staged;
      entry.sequence = sequence;
      entry.compactedSequence = compactedSequence;
      entry.uncompactedUpdateCount = uncompactedUpdateCount;
      entry.uncompactedUpdateBytes = uncompactedUpdateBytes;
      entry.lastCompactedAt = lastCompactedAt;
      ownsStagedDocument = false;
      previous.destroy();
    } finally {
      if (ownsStagedDocument) staged.destroy();
    }
  }

  private async validateUpdateAgainstDocument(
    workId: string,
    doc: Y.Doc,
    update: Uint8Array,
    actorUserId: string,
    transaction?: DrizzleStudioCrdtTransaction
  ): Promise<void> {
    const probe = new Y.Doc();
    const candidate = new Y.Doc();
    const deletionRootsBefore = snapshotStudioCrdtDeletionRoots(doc);
    const rasterRootsBefore = snapshotStudioCrdtRasterRoots(doc);
    const shared3dStageRootsBefore = snapshotStudioCrdtShared3dStageRoots(doc);
    const workAssetReferencesBefore = snapshotStudioWorkAssetReferences(doc);
    const r8GrainReferencesBefore = snapshotStudioCrdtR8GrainReferences(doc);
    try {
      Y.applyUpdate(candidate, update, "server-validation-candidate");
      if (conflictsWithStudioCrdtRasterRootSnapshot(rasterRootsBefore, candidate)) {
        throw new StudioCrdtInvalidPayloadError(
          "update reuses an immutable Studio raster identity with different content"
        );
      }
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(doc), "server-validation-base");
      Y.applyUpdate(probe, update, "server-validation-update");
      if (!hasValidStudioCrdtRootSchema(probe)) {
        throw new StudioCrdtInvalidPayloadError("update violates the Studio CRDT root schema");
      }
      if (!preservesStudioCrdtDeletionRoots(deletionRootsBefore, probe)) {
        throw new StudioCrdtInvalidPayloadError(
          "update rewrites grow-only Studio deletion history"
        );
      }
      if (!preservesStudioCrdtRasterRoots(rasterRootsBefore, probe)) {
        throw new StudioCrdtInvalidPayloadError(
          "update rewrites grow-only Studio raster history"
        );
      }
      if (!preservesStudioCrdtShared3dStageRoots(shared3dStageRootsBefore, probe)) {
        throw new StudioCrdtInvalidPayloadError(
          "update rewrites Shared Stage ownership history"
        );
      }
      if (!admitsStudioCrdtShared3dStageEvents(shared3dStageRootsBefore, probe)) {
        throw new StudioCrdtInvalidPayloadError(
          "update skips Shared Stage ownership generations"
        );
      }
      if (appendsStudioCrdtRasterCheckpoint(rasterRootsBefore, probe)) {
        throw new StudioCrdtInvalidPayloadError(
          "client updates cannot publish unverified Studio raster checkpoints"
        );
      }
      assertStudioCrdtRasterAppendedEventAdmission(rasterRootsBefore, probe, actorUserId);
      if ((rasterRootsBefore?.checkpoints.size ?? 0) > 0) {
        assertStudioCrdtRasterAppendedEventsAfterCheckpointHorizon(rasterRootsBefore, probe);
      }
      assertStudioCrdtAppendedRasterLayersWritable(rasterRootsBefore?.operations, probe);
      const workAssetReferences = snapshotStudioWorkAssetReferences(probe);
      const r8GrainReferences = snapshotStudioCrdtR8GrainReferences(probe);
      if (r8GrainReferences.hasConflictingAssetId) {
        throw new StudioCrdtInvalidPayloadError(
          "one Studio R8 grain asset identity cannot bind different content"
        );
      }
      for (const [id, elementType] of workAssetReferencesBefore.identities) {
        if (workAssetReferences.identities.get(id) !== elementType) {
          throw new StudioCrdtInvalidPayloadError(
            "update cannot replace a durable Studio reference identity"
          );
        }
      }
      for (const key of workAssetReferencesBefore.admittedReferences.keys()) {
        if (!workAssetReferences.admittedReferences.has(key)) {
          throw new StudioCrdtInvalidPayloadError(
            "update cannot downgrade a durable admitted Studio reference"
          );
        }
      }
      for (const [strokeId, source] of r8GrainReferencesBefore.byStrokeId) {
        const candidateSource = r8GrainReferences.byStrokeId.get(strokeId);
        if (JSON.stringify(candidateSource) !== JSON.stringify(source)) {
          throw new StudioCrdtInvalidPayloadError(
            "update cannot replace or remove a durable Studio R8 grain identity"
          );
        }
      }
      if (
        workAssetReferences.activeCount >
        STUDIO_CRDT_ACTIVE_WORK_ASSET_REFERENCE_MAX_COUNT
      ) {
        throw new StudioCrdtInvalidPayloadError(
          "update exceeds the active Studio work-asset reference limit"
        );
      }
      const durableWorkAssetIds = new Set([
        ...[...workAssetReferences.admittedReferences.values()]
          .map((reference) => reference.assetId),
        ...r8GrainReferences.byAssetId.keys(),
      ]);
      if (
        durableWorkAssetIds.size >
        STUDIO_CRDT_ACTIVE_WORK_ASSET_REFERENCE_MAX_COUNT
      ) {
        throw new StudioCrdtInvalidPayloadError(
          "update exceeds the combined Studio work-asset reference limit"
        );
      }
      if (Y.encodeStateAsUpdate(probe).byteLength > STUDIO_CRDT_SNAPSHOT_MAX_BYTES) {
        throw new StudioCrdtDocumentTooLargeError();
      }
      if (Y.encodeStateVector(probe).byteLength > this.stateVectorMaxBytes) {
        throw new StudioCrdtDocumentTooLargeError();
      }
      const appendedAssetReferences = appendedStudioCrdtRasterAssetReferences(
        rasterRootsBefore,
        probe
      );
      if (appendedAssetReferences.length > 0) {
        try {
          await this.rasterAssetAdmission.assertReferencesStored(
            actorUserId,
            workId,
            appendedAssetReferences,
            transaction
          );
        } catch {
          throw new StudioCrdtInvalidPayloadError(
            "update references a missing or mismatched Studio raster asset"
          );
        }
      }
      const appendedWorkAssetReferences = [...workAssetReferences.admittedReferences]
        .filter(([key]) => !workAssetReferencesBefore.admittedReferences.has(key))
        .map(([, reference]) => reference);
      if (appendedWorkAssetReferences.length > 0) {
        try {
          await this.workAssetAdmission.assertReferencesStored(
            actorUserId,
            workId,
            appendedWorkAssetReferences,
            transaction
          );
        } catch {
          throw new StudioCrdtInvalidPayloadError(
            "update references a missing or mismatched Studio work asset"
          );
        }
      }
      const appendedR8GrainReferences = [...r8GrainReferences.byAssetId]
        .filter(([assetId]) => !r8GrainReferencesBefore.byAssetId.has(assetId))
        .map(([, source]) => source);
      if (appendedR8GrainReferences.length > 0) {
        try {
          await this.workAssetAdmission.assertR8GrainReferencesStored(
            actorUserId,
            workId,
            appendedR8GrainReferences,
            transaction
          );
        } catch {
          throw new StudioCrdtInvalidPayloadError(
            "update references a missing or mismatched Studio R8 grain asset"
          );
        }
      }
    } catch (error) {
      if (
        error instanceof StudioCrdtDocumentTooLargeError ||
        error instanceof StudioCrdtInvalidPayloadError
      ) throw error;
      throw new StudioCrdtInvalidPayloadError("update is not a valid Yjs update");
    } finally {
      candidate.destroy();
      probe.destroy();
    }
  }

  private async validateUpdateAgainstHydration(
    workId: string,
    current: StudioCrdtHydrationState,
    update: Uint8Array,
    actorUserId: string,
    transaction: DrizzleStudioCrdtTransaction
  ): Promise<void> {
    const durable = this.createCachedDocument(workId, current);
    try {
      await this.validateUpdateAgainstDocument(
        workId,
        durable.doc,
        update,
        actorUserId,
        transaction
      );
    } finally {
      durable.doc.destroy();
    }
  }

  private async maybeCompact(
    workId: string,
    entry: CachedStudioCrdtDocument
  ): Promise<void> {
    if (entry.sequence <= entry.compactedSequence || entry.uncompactedUpdateCount === 0) return;
    const now = this.now();
    if (
      entry.uncompactedUpdateCount < this.compactUpdateCount &&
      entry.uncompactedUpdateBytes < this.compactUpdateBytes &&
      now.getTime() - entry.lastCompactedAt < this.compactIntervalMs
    ) {
      return;
    }
    const snapshot = Y.encodeStateAsUpdate(entry.doc);
    if (snapshot.byteLength > STUDIO_CRDT_SNAPSHOT_MAX_BYTES) {
      throw new StudioCrdtDocumentTooLargeError();
    }
    try {
      const compacted = await this.repository.compact({
        workId,
        snapshot,
        throughSequence: entry.sequence,
        updatedAt: now,
      });
      if (!compacted) return;
      entry.compactedSequence = entry.sequence;
      entry.uncompactedUpdateCount = 0;
      entry.uncompactedUpdateBytes = 0;
      entry.lastCompactedAt = now.getTime();
    } catch (error) {
      this.logger.warn(
        { workId, error: error instanceof Error ? error.message : "unknown" },
        "studio CRDT compaction deferred"
      );
    }
  }

  // Cluster-wide extension of the local admission caps. The first operation wakes sampling and
  // the interval refreshes it only while work remains pending. A cold first operation is still
  // bounded by the strict local caps and never waits on Postgres. The last operation publishes one
  // zero transition, after which an idle node performs no cluster-load I/O at all.
  //
  // Returns the existing in-flight attempt (rather than a fresh resolved promise) when one is
  // already running, so onModuleDestroy can await the SAME promise a caller is holding instead of
  // racing a teardown against a heartbeat still mutating instance state after "destroyed" is set.
  private reportClusterLoad(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    this.clusterLoadReportQueued = true;
    if (this.clusterLoadHeartbeatPromise) return this.clusterLoadHeartbeatPromise;
    const run = (async () => {
      do {
        this.clusterLoadReportQueued = false;
        await this.runClusterLoadHeartbeat();
      } while (this.clusterLoadReportQueued && !this.destroyed);
    })();
    this.clusterLoadHeartbeatPromise = run;
    void run.finally(() => {
      if (this.clusterLoadHeartbeatPromise !== run) return;
      this.clusterLoadHeartbeatPromise = null;
      // A request can arrive after the drain loop's final condition but before this settled
      // promise clears. Preserve that transition instead of losing a final zero report.
      if (this.clusterLoadReportQueued && !this.destroyed) void this.reportClusterLoad();
    });
    return run;
  }

  private startClusterLoadHeartbeat(): void {
    if (this.destroyed || this.clusterLoadTimer) return;
    this.clusterLoadTimer = this.scheduleInterval(
      () => void this.reportClusterLoad(),
      this.clusterLoadHeartbeatMs
    );
    this.clusterLoadTimer.unref?.();
    void this.reportClusterLoad();
  }

  private stopClusterLoadHeartbeat(): void {
    if (this.clusterLoadTimer) this.cancelInterval(this.clusterLoadTimer);
    this.clusterLoadTimer = null;
    void this.reportClusterLoad();
  }

  private async runClusterLoadHeartbeat(): Promise<void> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const now = this.now();
      const pendingOperationCount = this.pendingOperationCount;
      const previouslyReportedPendingOperationCount = this.lastReportedPendingOperationCount;
      const report = await Promise.race([
        (async () => {
          await this.clusterLoadRepository.reportLoad(
            this.nodeId,
            pendingOperationCount,
            now
          );
          if (pendingOperationCount === 0) {
            return { pendingOperationCount, observedClusterLoad: null };
          }
          return {
            pendingOperationCount,
            observedClusterLoad: await this.clusterLoadRepository.readClusterLoad(
              now,
              this.clusterLoadStaleAfterMs
            ),
          };
        })(),
        new Promise<never>((_resolve, reject) => {
          // Bounds how long a single hung Postgres call can keep this node's heartbeat disabled.
          // clusterLoadHeartbeatPromise is cleared in `finally` below regardless of which side of
          // the race wins, so a timeout here always lets the next scheduled tick retry -- this
          // node's own heartbeat can never wedge itself permanently, even though the underlying
          // query may still be running against the shared pool until it eventually settles there.
          timeoutHandle = setTimeout(
            () => reject(new Error("studio CRDT cluster load heartbeat timed out")),
            Math.min(this.clusterLoadHeartbeatMs * 4, 5_000)
          );
          timeoutHandle.unref?.();
        }),
      ]);
      // The repository attempt returns a value instead of assigning service state itself. If it
      // loses the timeout race and completes later, its stale result has no continuation capable
      // of overwriting a newer heartbeat. Teardown likewise prevents the winning result from
      // publishing after the service has been destroyed.
      this.lastReportedPendingOperationCount = report.pendingOperationCount;
      if (this.destroyed) return;
      if (report.observedClusterLoad === null) {
        if (
          previouslyReportedPendingOperationCount !== null &&
          previouslyReportedPendingOperationCount > 0
        ) {
          this.cachedClusterPendingOperations = Math.max(
            0,
            this.cachedClusterPendingOperations - previouslyReportedPendingOperationCount
          );
        }
        return;
      }
      this.cachedClusterPendingOperations = report.observedClusterLoad;
      this.lastClusterLoadSuccessAt = now.getTime();
    } catch (error) {
      this.logger.warn(
        { nodeId: this.nodeId, error: error instanceof Error ? error.message : "unknown" },
        "studio CRDT cluster load heartbeat failed"
      );
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private async clearReportedClusterLoadOnShutdown(): Promise<void> {
    if (
      this.lastReportedPendingOperationCount === null ||
      this.lastReportedPendingOperationCount === 0
    ) return;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const now = this.now();
      await Promise.race([
        this.clusterLoadRepository.reportLoad(this.nodeId, 0, now),
        new Promise<never>((_resolve, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error("studio CRDT final cluster load clear timed out")),
            Math.min(this.clusterLoadHeartbeatMs * 4, 5_000)
          );
          timeoutHandle.unref?.();
        }),
      ]);
      this.lastReportedPendingOperationCount = 0;
    } catch (error) {
      this.logger.warn(
        { nodeId: this.nodeId, error: error instanceof Error ? error.message : "unknown" },
        "studio CRDT final cluster load clear failed"
      );
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private withWorkLock<T>(workId: string, operation: () => Promise<T>): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error("Studio CRDT service is shutting down"));
    const pendingForWork = this.pendingOperationsByWork.get(workId) ?? 0;
    const clusterLoadFresh =
      this.now().getTime() - this.lastClusterLoadSuccessAt <= this.clusterLoadStaleAfterMs;
    const clusterOverBudget =
      clusterLoadFresh && this.cachedClusterPendingOperations >= this.maxClusterPendingOperationsTotal;
    if (
      pendingForWork >= this.maxPendingOperationsPerWork ||
      this.pendingOperationCount >= this.maxPendingOperationsTotal ||
      clusterOverBudget
    ) {
      return Promise.reject(new StudioCrdtBackpressureError());
    }
    // Count both the active operation and waiters. This admission check occurs synchronously before
    // a closure is attached to the work tail, so a stalled database call cannot grow an unbounded
    // promise/payload backlog through many authenticated editors or rooms in this API process.
    this.pendingOperationsByWork.set(workId, pendingForWork + 1);
    this.pendingOperationCount += 1;
    if (this.pendingOperationCount === 1) this.startClusterLoadHeartbeat();
    const previous = this.workTails.get(workId) ?? Promise.resolve();
    const run = previous.then(() => {
      if (this.destroyed) throw new Error("Studio CRDT service is shutting down");
      return operation();
    });
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this.workTails.set(workId, tail);
    void tail.then(() => {
      const remainingForWork = (this.pendingOperationsByWork.get(workId) ?? 1) - 1;
      if (remainingForWork > 0) this.pendingOperationsByWork.set(workId, remainingForWork);
      else this.pendingOperationsByWork.delete(workId);
      this.pendingOperationCount = Math.max(0, this.pendingOperationCount - 1);
      if (this.pendingOperationCount === 0) this.stopClusterLoadHeartbeat();
      if (this.workTails.get(workId) === tail) this.workTails.delete(workId);
    });
    return run;
  }
}
