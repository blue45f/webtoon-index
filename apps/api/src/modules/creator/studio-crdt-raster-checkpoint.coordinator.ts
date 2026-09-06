import { createHash, randomUUID } from "node:crypto";

import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import * as Y from "yjs";

import {
  compactStudioRasterOperationLog,
  type StudioRasterCompactionCheckpoint,
  type StudioRasterCompactionOrderKey,
  type StudioRasterCheckpointTile,
} from "../../../../web/src/shared/lib/studio-crdt-raster-compaction";
import {
  STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT,
  STUDIO_CRDT_RASTER_OPERATIONS_ROOT,
  readStudioCrdtRasterDocument,
} from "../../../../web/src/shared/lib/studio-crdt-raster-document-contract";
import {
  STUDIO_RASTER_CRDT_VERSION,
  canonicalStudioRasterJson,
  compareStudioRasterEventOrder,
  createStudioRasterOperationLog,
} from "../../../../web/src/shared/lib/studio-crdt-raster-ops";

import {
  STUDIO_CRDT_RASTER_CHECKPOINT_REPOSITORY,
  StudioCrdtRasterCheckpointLeaseError,
  StudioCrdtRasterCheckpointStorageError,
} from "./studio-crdt-raster-checkpoint.repository";
import { STUDIO_CRDT_REPOSITORY } from "./studio-crdt.repository";

import type {
  StudioCrdtRasterCheckpointJobRecord,
  StudioCrdtRasterCheckpointRepository,
} from "./studio-crdt-raster-checkpoint.repository";
import type {
  StudioCrdtHydrationState,
  StudioCrdtRepository,
} from "./studio-crdt.repository";
import type {
  StudioRasterOperationLog,
} from "../../../../web/src/shared/lib/studio-crdt-raster-ops";

export const STUDIO_CRDT_RASTER_CHECKPOINT_COORDINATOR_OPTIONS = Symbol(
  "STUDIO_CRDT_RASTER_CHECKPOINT_COORDINATOR_OPTIONS"
);

export const STUDIO_CRDT_SERVER_DURABLE_REPLICA_ID = "server-durable-log";
export const STUDIO_CRDT_RASTER_CHECKPOINT_MAX_TILES = 96;
export const STUDIO_CRDT_RASTER_CHECKPOINT_MAX_PER_SURFACE = 8;
const DEFAULT_OPERATION_THRESHOLD = 256;
const DEFAULT_LEASE_MS = 2 * 60_000;
const DEFAULT_BACKOFF_BASE_MS = 5_000;
const DEFAULT_BACKOFF_MAX_MS = 15 * 60_000;
const MAX_SCHEDULING_GATES = 4_096;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface StudioCrdtRasterCheckpointCoordinatorOptions {
  readonly now?: () => Date;
  readonly operationThreshold?: number;
  readonly leaseMs?: number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
}

export interface StudioCrdtRasterCheckpointClaimInput {
  readonly workId: string;
  readonly surfaceId: string;
  readonly coordinatorId: string;
}

export interface StudioCrdtRasterCheckpointLease {
  readonly workId: string;
  readonly surfaceId: string;
  readonly jobId: string;
  readonly proofId: string;
  readonly requestHash: string;
  readonly sourceSequence: string;
  readonly coordinatorId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: string;
  readonly maxTiles: typeof STUDIO_CRDT_RASTER_CHECKPOINT_MAX_TILES;
  readonly through: StudioRasterCompactionOrderKey;
  readonly requiredReplicaIds: readonly [typeof STUDIO_CRDT_SERVER_DURABLE_REPLICA_ID];
  /** Exact stable prefix that the trusted renderer must rasterize. */
  readonly log: StudioRasterOperationLog;
}

export interface StudioCrdtRasterCheckpointCompletionInput {
  readonly workId: string;
  readonly surfaceId: string;
  readonly jobId: string;
  readonly coordinatorId: string;
  readonly leaseToken: string;
  readonly requestHash: string;
  readonly tiles: readonly StudioRasterCheckpointTile[];
}

export interface StudioCrdtRasterCheckpointCompletionResult {
  readonly inserted: boolean;
  readonly checkpointId: string;
  readonly serverSequence: string;
}

export interface StudioCrdtRasterCheckpointPlan {
  readonly surfaceId: string;
  readonly through: StudioRasterCompactionOrderKey;
  readonly requestHash: string;
  readonly operationCount: number;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(value as number)));
}

function assertSafeId(value: string, label: string): void {
  if (value.length < 1 || value.length > 160 || !SAFE_ID_PATTERN.test(value)) {
    throw new StudioCrdtRasterCheckpointLeaseError(`${label} is invalid`);
  }
}

function eventKeys(log: StudioRasterOperationLog): StudioRasterCompactionOrderKey[] {
  return [
    ...log.operations.map((operation) => ({
      ...operation.order,
      eventId: operation.operationId,
    })),
    ...log.undoOperations.map((operation) => ({
      ...operation.order,
      eventId: operation.undoOperationId,
    })),
    ...log.undoAcknowledgements.map((acknowledgement) => ({
      ...acknowledgement.order,
      eventId: acknowledgement.acknowledgementId,
    })),
  ];
}

function operationKey(
  operation: StudioRasterOperationLog["operations"][number]
): StudioRasterCompactionOrderKey {
  return { ...operation.order, eventId: operation.operationId };
}

function undoKey(
  operation: StudioRasterOperationLog["undoOperations"][number]
): StudioRasterCompactionOrderKey {
  return { ...operation.order, eventId: operation.undoOperationId };
}

function acknowledgementKey(
  acknowledgement: StudioRasterOperationLog["undoAcknowledgements"][number]
): StudioRasterCompactionOrderKey {
  return { ...acknowledgement.order, eventId: acknowledgement.acknowledgementId };
}

export function studioCrdtRasterCheckpointPrefix(
  log: StudioRasterOperationLog,
  through: StudioRasterCompactionOrderKey
): StudioRasterOperationLog {
  return createStudioRasterOperationLog({
    version: STUDIO_RASTER_CRDT_VERSION,
    surface: log.surface,
    operations: log.operations.filter((operation) => (
      compareStudioRasterEventOrder(operationKey(operation), through) <= 0
    )),
    undoOperations: log.undoOperations.filter((operation) => (
      compareStudioRasterEventOrder(undoKey(operation), through) <= 0
    )),
    undoAcknowledgements: log.undoAcknowledgements.filter((acknowledgement) => (
      compareStudioRasterEventOrder(acknowledgementKey(acknowledgement), through) <= 0
    )),
  });
}

export function studioCrdtRasterCheckpointRequestHash(
  log: StudioRasterOperationLog,
  through: StudioRasterCompactionOrderKey
): string {
  const prefix = studioCrdtRasterCheckpointPrefix(log, through);
  return createHash("sha256")
    .update(canonicalStudioRasterJson({ through, log: prefix }), "utf8")
    .digest("hex");
}

export function studioCrdtRasterCheckpointTileManifestHash(
  tiles: readonly StudioRasterCheckpointTile[]
): string {
  const sorted = [...tiles].sort((left, right) => (
    left.tileY - right.tileY || left.tileX - right.tileX
  ));
  return createHash("sha256")
    .update(canonicalStudioRasterJson(sorted), "utf8")
    .digest("hex");
}

export function studioCrdtRasterCheckpointResultHash(input: {
  readonly jobId: string;
  readonly requestHash: string;
  readonly tiles: readonly StudioRasterCheckpointTile[];
}): string {
  return createHash("sha256")
    .update(canonicalStudioRasterJson({
      jobId: input.jobId,
      requestHash: input.requestHash,
      tiles: [...input.tiles].sort((left, right) => (
        left.tileY - right.tileY || left.tileX - right.tileX
      )),
    }), "utf8")
    .digest("hex");
}

function latestCheckpoint(
  checkpoints: readonly StudioRasterCompactionCheckpoint[],
  surfaceId: string
): StudioRasterCompactionCheckpoint | null {
  return checkpoints
    .filter((checkpoint) => checkpoint.surface.surfaceId === surfaceId)
    .sort((left, right) => compareStudioRasterEventOrder(left.through, right.through))
    .at(-1) ?? null;
}

export function planStudioCrdtRasterCheckpoint(input: {
  readonly doc: Y.Doc;
  readonly operationThreshold: number;
  readonly surfaceId?: string;
}): StudioCrdtRasterCheckpointPlan | null {
  const snapshot = readStudioCrdtRasterDocument(input.doc);
  const candidates: StudioCrdtRasterCheckpointPlan[] = [];
  for (const [surfaceId, log] of snapshot.logs) {
    if (input.surfaceId && surfaceId !== input.surfaceId) continue;
    const surfaceCheckpoints = snapshot.checkpoints.filter(
      (checkpoint) => checkpoint.surface.surfaceId === surfaceId
    );
    if (surfaceCheckpoints.length >= STUDIO_CRDT_RASTER_CHECKPOINT_MAX_PER_SURFACE) continue;
    const previous = latestCheckpoint(surfaceCheckpoints, surfaceId);
    const operationsAfterPrevious = previous
      ? log.operations.filter((operation) => (
          compareStudioRasterEventOrder(operationKey(operation), previous.through) > 0
        )).length
      : log.operations.length;
    if (operationsAfterPrevious < input.operationThreshold) continue;
    const through = eventKeys(log)
      .sort(compareStudioRasterEventOrder)
      .at(-1);
    if (!through) continue;
    candidates.push({
      surfaceId,
      through,
      requestHash: studioCrdtRasterCheckpointRequestHash(log, through),
      operationCount: log.operations.length,
    });
  }
  return candidates.sort((left, right) => (
    right.operationCount - left.operationCount || left.surfaceId.localeCompare(right.surfaceId)
  ))[0] ?? null;
}

function hydrateStudioCrdtDocument(state: StudioCrdtHydrationState): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  try {
    if (state.snapshot) {
      Y.applyUpdate(doc, state.snapshot.snapshot, "raster-checkpoint-hydrate-snapshot");
    }
    for (const update of state.updates) {
      Y.applyUpdate(doc, update.payload, "raster-checkpoint-hydrate-update");
    }
    readStudioCrdtRasterDocument(doc);
    return doc;
  } catch (error) {
    doc.destroy();
    throw new StudioCrdtRasterCheckpointStorageError(
      error instanceof Error ? error.message : "Checkpoint hydration failed"
    );
  }
}

function studioCrdtHydrationSequence(state: StudioCrdtHydrationState): bigint {
  let sequence = state.snapshot?.compactedSequence ?? 0n;
  for (const update of state.updates) {
    if (update.sequence > sequence) sequence = update.sequence;
  }
  return sequence;
}

function logForJob(doc: Y.Doc, job: StudioCrdtRasterCheckpointJobRecord): StudioRasterOperationLog {
  const log = readStudioCrdtRasterDocument(doc).logs.get(job.surfaceId);
  if (!log) throw new StudioCrdtRasterCheckpointStorageError("Checkpoint surface disappeared");
  if (studioCrdtRasterCheckpointRequestHash(log, job.through) !== job.requestHash) {
    throw new StudioCrdtRasterCheckpointStorageError(
      "Checkpoint stable prefix changed after the job was created"
    );
  }
  return log;
}

function completionInputIsBounded(input: StudioCrdtRasterCheckpointCompletionInput): boolean {
  return UUID_PATTERN.test(input.jobId) &&
    /^[a-f0-9]{64}$/u.test(input.requestHash) &&
    input.tiles.length <= STUDIO_CRDT_RASTER_CHECKPOINT_MAX_TILES;
}

@Injectable()
export class StudioCrdtRasterCheckpointCoordinator {
  private readonly logger = new Logger(StudioCrdtRasterCheckpointCoordinator.name);
  private readonly now: () => Date;
  private readonly operationThreshold: number;
  private readonly leaseMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly nextOperationCountByWork = new Map<string, number>();

  constructor(
    @Inject(STUDIO_CRDT_REPOSITORY)
    private readonly crdtRepository: StudioCrdtRepository,
    @Inject(STUDIO_CRDT_RASTER_CHECKPOINT_REPOSITORY)
    private readonly checkpointRepository: StudioCrdtRasterCheckpointRepository,
    @Optional()
    @Inject(STUDIO_CRDT_RASTER_CHECKPOINT_COORDINATOR_OPTIONS)
    options: StudioCrdtRasterCheckpointCoordinatorOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
    this.operationThreshold = boundedInteger(
      options.operationThreshold,
      DEFAULT_OPERATION_THRESHOLD,
      16,
      4_096
    );
    this.leaseMs = boundedInteger(options.leaseMs, DEFAULT_LEASE_MS, 10_000, 15 * 60_000);
    this.backoffBaseMs = boundedInteger(
      options.backoffBaseMs,
      DEFAULT_BACKOFF_BASE_MS,
      1_000,
      60_000
    );
    this.backoffMaxMs = boundedInteger(
      options.backoffMaxMs,
      DEFAULT_BACKOFF_MAX_MS,
      this.backoffBaseMs,
      24 * 60 * 60_000
    );
  }

  /** Event-driven only: callers invoke this after a committed update; there is no polling timer. */
  async maybeEnqueue(workId: string, doc: Y.Doc, sourceSequence: bigint): Promise<boolean> {
    try {
      if (!doc.share.has(STUDIO_CRDT_RASTER_OPERATIONS_ROOT)) return false;
      // Remote top-level roots can remain an unmaterialized AbstractType until a typed getter
      // claims them. The name already exists, so this does not create document content.
      const operationCount = doc.getMap<unknown>(STUDIO_CRDT_RASTER_OPERATIONS_ROOT).size;
      const nextCount = this.nextOperationCountByWork.get(workId) ?? this.operationThreshold;
      if (operationCount < nextCount) return false;
      const plan = planStudioCrdtRasterCheckpoint({
        doc,
        operationThreshold: this.operationThreshold,
      });
      if (!plan || sourceSequence <= 0n) {
        this.rememberNextOperationCount(workId, operationCount + this.operationThreshold);
        return false;
      }
      const now = this.now();
      const enqueued = await this.checkpointRepository.enqueue({
        workId,
        surfaceId: plan.surfaceId,
        jobId: randomUUID(),
        proofId: randomUUID(),
        requestHash: plan.requestHash,
        sourceSequence,
        through: plan.through,
        now,
      });
      // Advance the cheap parse gate only after the durable repository answered. A transient DB
      // outage must not suppress the next post-commit retry for another full threshold window.
      this.rememberNextOperationCount(workId, operationCount + this.operationThreshold);
      return enqueued;
    } catch (error) {
      this.logger.warn(
        { workId, error: error instanceof Error ? error.message : "unknown" },
        "studio raster checkpoint scheduling deferred"
      );
      return false;
    }
  }

  /** Explicit push/worker handoff. Nothing calls this on an interval. */
  async claim(
    input: StudioCrdtRasterCheckpointClaimInput
  ): Promise<StudioCrdtRasterCheckpointLease | null> {
    assertSafeId(input.coordinatorId, "coordinator id");
    assertSafeId(input.surfaceId, "surface id");
    const now = this.now();
    const leaseToken = randomUUID();
    const job = await this.checkpointRepository.claim({
      ...input,
      leaseToken,
      now,
      leaseExpiresAt: new Date(now.getTime() + this.leaseMs),
    });
    if (!job) return null;
    const state = await this.crdtRepository.loadDocument(input.workId);
    const durableSequence = studioCrdtHydrationSequence(state);
    const doc = hydrateStudioCrdtDocument(state);
    try {
      if (durableSequence < job.sourceSequence) {
        throw new StudioCrdtRasterCheckpointStorageError(
          "Checkpoint source sequence is ahead of durable storage"
        );
      }
      const log = logForJob(doc, job);
      return {
        workId: input.workId,
        surfaceId: input.surfaceId,
        jobId: job.jobId,
        proofId: job.proofId,
        requestHash: job.requestHash,
        sourceSequence: job.sourceSequence.toString(),
        coordinatorId: input.coordinatorId,
        leaseToken,
        leaseExpiresAt: job.leaseExpiresAt!.toISOString(),
        maxTiles: STUDIO_CRDT_RASTER_CHECKPOINT_MAX_TILES,
        through: { ...job.through },
        requiredReplicaIds: [STUDIO_CRDT_SERVER_DURABLE_REPLICA_ID],
        log: studioCrdtRasterCheckpointPrefix(log, job.through),
      };
    } catch (error) {
      const replacement = planStudioCrdtRasterCheckpoint({
        doc,
        operationThreshold: this.operationThreshold,
        surfaceId: job.surfaceId,
      });
      if (replacement && durableSequence > 0n) {
        await this.supersedeJob(
          job,
          replacement,
          durableSequence,
          input.coordinatorId,
          leaseToken,
          now
        );
      } else {
        await this.deferJob(job, input.coordinatorId, leaseToken, now);
      }
      this.logger.warn(
        { workId: input.workId, surfaceId: input.surfaceId, error: error instanceof Error ? error.message : "unknown" },
        "studio raster checkpoint lease deferred because its prefix is stale"
      );
      return null;
    } finally {
      doc.destroy();
    }
  }

  async complete(
    input: StudioCrdtRasterCheckpointCompletionInput
  ): Promise<StudioCrdtRasterCheckpointCompletionResult> {
    assertSafeId(input.coordinatorId, "coordinator id");
    assertSafeId(input.surfaceId, "surface id");
    if (!completionInputIsBounded(input)) {
      throw new StudioCrdtRasterCheckpointStorageError("Checkpoint result exceeds its contract");
    }
    const resultHash = studioCrdtRasterCheckpointResultHash(input);
    const now = this.now();
    const finalized = await this.checkpointRepository.finalize(
      {
        workId: input.workId,
        surfaceId: input.surfaceId,
        jobId: input.jobId,
        coordinatorId: input.coordinatorId,
        leaseToken: input.leaseToken,
        resultHash,
        now,
      },
      async (job, state) => {
        if (job.requestHash !== input.requestHash) {
          throw new StudioCrdtRasterCheckpointLeaseError("Checkpoint request hash changed");
        }
        const doc = hydrateStudioCrdtDocument(state);
        try {
          if (studioCrdtHydrationSequence(state) < job.sourceSequence) {
            throw new StudioCrdtRasterCheckpointStorageError(
              "Checkpoint source sequence is ahead of durable storage"
            );
          }
          const log = logForJob(doc, job);
          const result = compactStudioRasterOperationLog(log, {
            checkpointId: job.jobId,
            through: job.through,
            requiredReplicaIds: [STUDIO_CRDT_SERVER_DURABLE_REPLICA_ID],
            stabilityProof: {
              version: STUDIO_RASTER_CRDT_VERSION,
              proofId: job.proofId,
              undoHorizonClosedThrough: job.through,
              replicaFrontiers: [{
                replicaId: STUDIO_CRDT_SERVER_DURABLE_REPLICA_ID,
                through: job.through,
              }],
            },
            tileManifestSha256: studioCrdtRasterCheckpointTileManifestHash(input.tiles),
            tiles: input.tiles,
          });
          const stateVector = Y.encodeStateVector(doc);
          doc.getMap<string>(STUDIO_CRDT_RASTER_CHECKPOINTS_ROOT).set(
            result.checkpoint.checkpointId,
            canonicalStudioRasterJson(result.checkpoint)
          );
          readStudioCrdtRasterDocument(doc);
          return {
            checkpointId: result.checkpoint.checkpointId,
            payload: Y.encodeStateAsUpdate(doc, stateVector),
            assets: result.checkpoint.tiles.map((tile) => tile.asset),
          };
        } finally {
          doc.destroy();
        }
      }
    );
    return {
      inserted: finalized.inserted,
      checkpointId: finalized.checkpointId,
      serverSequence: finalized.sequence.toString(),
    };
  }

  async defer(input: Omit<StudioCrdtRasterCheckpointCompletionInput, "requestHash" | "tiles">): Promise<boolean> {
    assertSafeId(input.coordinatorId, "coordinator id");
    const now = this.now();
    return this.checkpointRepository.defer({
      ...input,
      now,
      notBefore: new Date(now.getTime() + this.backoffBaseMs),
    });
  }

  private async deferJob(
    job: StudioCrdtRasterCheckpointJobRecord,
    coordinatorId: string,
    leaseToken: string,
    now: Date
  ): Promise<void> {
    const exponent = Math.max(0, Math.min(20, job.attempt - 1));
    const delay = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** exponent);
    await this.checkpointRepository.defer({
      workId: job.workId,
      surfaceId: job.surfaceId,
      jobId: job.jobId,
      coordinatorId,
      leaseToken,
      now,
      notBefore: new Date(now.getTime() + delay),
    });
  }

  private async supersedeJob(
    job: StudioCrdtRasterCheckpointJobRecord,
    replacement: StudioCrdtRasterCheckpointPlan,
    sourceSequence: bigint,
    coordinatorId: string,
    leaseToken: string,
    now: Date
  ): Promise<void> {
    const exponent = Math.max(0, Math.min(20, job.attempt - 1));
    const delay = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** exponent);
    await this.checkpointRepository.supersede({
      workId: job.workId,
      surfaceId: job.surfaceId,
      jobId: job.jobId,
      coordinatorId,
      leaseToken,
      now,
      replacementJobId: randomUUID(),
      replacementProofId: randomUUID(),
      replacementRequestHash: replacement.requestHash,
      replacementSourceSequence: sourceSequence,
      replacementThrough: replacement.through,
      notBefore: new Date(now.getTime() + delay),
    });
  }

  private rememberNextOperationCount(workId: string, operationCount: number): void {
    this.nextOperationCountByWork.delete(workId);
    this.nextOperationCountByWork.set(workId, operationCount);
    while (this.nextOperationCountByWork.size > MAX_SCHEDULING_GATES) {
      const oldest = this.nextOperationCountByWork.keys().next().value;
      if (typeof oldest !== "string") break;
      this.nextOperationCountByWork.delete(oldest);
    }
  }
}
