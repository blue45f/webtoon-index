import { createHash, timingSafeEqual } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import { canonicalStudioRasterJson } from "../../../../web/src/shared/lib/studio-crdt-raster-ops";
import {
  creatorWorkCrdtUpdateReceipts,
  creatorWorkCrdtUpdates,
  db,
} from "../../db";
import { creatorWorkCrdtRasterCheckpointJobs } from "../../db/studio-crdt-raster-checkpoint.schema";
import { creatorWorkRasterAssets } from "../../db/studio-raster-asset.schema";

import {
  STUDIO_CRDT_UPDATE_MAX_BYTES,
  loadStudioCrdtDocumentInTransaction,
  studioCrdtPayloadHash,
  withStudioCrdtWorkMutationLock,
} from "./studio-crdt.repository";

import type { DrizzleStudioCrdtTransaction, StudioCrdtHydrationState } from "./studio-crdt.repository";
import type { StudioRasterCompactionOrderKey } from "../../../../web/src/shared/lib/studio-crdt-raster-compaction";
import type { StudioRasterAssetReference } from "../../../../web/src/shared/lib/studio-crdt-raster-ops";

export const STUDIO_CRDT_RASTER_CHECKPOINT_REPOSITORY = Symbol(
  "STUDIO_CRDT_RASTER_CHECKPOINT_REPOSITORY"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CLOCK_PATTERN = /^(?:0|[1-9][0-9]{0,19})$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u;

export type StudioCrdtRasterCheckpointJobStatus = "pending" | "leased" | "completed";

export interface StudioCrdtRasterCheckpointJobRecord {
  readonly workId: string;
  readonly surfaceId: string;
  readonly jobId: string;
  readonly proofId: string;
  readonly requestHash: string;
  readonly sourceSequence: bigint;
  readonly through: StudioRasterCompactionOrderKey;
  readonly status: StudioCrdtRasterCheckpointJobStatus;
  readonly attempt: number;
  readonly notBefore: Date;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
  readonly resultHash: string | null;
  readonly resultCheckpointId: string | null;
  readonly resultSequence: bigint | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface EnqueueStudioCrdtRasterCheckpointJobInput {
  readonly workId: string;
  readonly surfaceId: string;
  readonly jobId: string;
  readonly proofId: string;
  readonly requestHash: string;
  readonly sourceSequence: bigint;
  readonly through: StudioRasterCompactionOrderKey;
  readonly now: Date;
}

export interface ClaimStudioCrdtRasterCheckpointJobInput {
  readonly workId: string;
  readonly surfaceId: string;
  readonly coordinatorId: string;
  readonly leaseToken: string;
  readonly now: Date;
  readonly leaseExpiresAt: Date;
}

export interface MutateStudioCrdtRasterCheckpointLeaseInput {
  readonly workId: string;
  readonly surfaceId: string;
  readonly jobId: string;
  readonly coordinatorId: string;
  readonly leaseToken: string;
  readonly now: Date;
}

export interface DeferStudioCrdtRasterCheckpointJobInput
  extends MutateStudioCrdtRasterCheckpointLeaseInput {
  readonly notBefore: Date;
}

export interface SupersedeStudioCrdtRasterCheckpointJobInput
  extends MutateStudioCrdtRasterCheckpointLeaseInput {
  readonly replacementJobId: string;
  readonly replacementProofId: string;
  readonly replacementRequestHash: string;
  readonly replacementSourceSequence: bigint;
  readonly replacementThrough: StudioRasterCompactionOrderKey;
  readonly notBefore: Date;
}

export interface FinalizeStudioCrdtRasterCheckpointJobInput
  extends MutateStudioCrdtRasterCheckpointLeaseInput {
  readonly resultHash: string;
}

export interface BuiltStudioCrdtRasterCheckpointUpdate {
  readonly payload: Uint8Array;
  readonly checkpointId: string;
  readonly assets: readonly StudioRasterAssetReference[];
}

export interface FinalizeStudioCrdtRasterCheckpointJobResult {
  readonly inserted: boolean;
  readonly checkpointId: string;
  readonly sequence: bigint;
}

export type BuildStudioCrdtRasterCheckpointUpdate = (
  job: StudioCrdtRasterCheckpointJobRecord,
  current: StudioCrdtHydrationState,
  transaction: DrizzleStudioCrdtTransaction
) => Promise<BuiltStudioCrdtRasterCheckpointUpdate>;

export interface StudioCrdtRasterCheckpointRepository {
  enqueue(input: EnqueueStudioCrdtRasterCheckpointJobInput): Promise<boolean>;
  claim(input: ClaimStudioCrdtRasterCheckpointJobInput): Promise<StudioCrdtRasterCheckpointJobRecord | null>;
  defer(input: DeferStudioCrdtRasterCheckpointJobInput): Promise<boolean>;
  supersede(input: SupersedeStudioCrdtRasterCheckpointJobInput): Promise<boolean>;
  finalize(
    input: FinalizeStudioCrdtRasterCheckpointJobInput,
    build: BuildStudioCrdtRasterCheckpointUpdate
  ): Promise<FinalizeStudioCrdtRasterCheckpointJobResult>;
}

export class StudioCrdtRasterCheckpointLeaseError extends Error {
  constructor(message = "Studio raster checkpoint lease is stale") {
    super(message);
    this.name = "StudioCrdtRasterCheckpointLeaseError";
  }
}

export class StudioCrdtRasterCheckpointStorageError extends Error {
  constructor(message = "Stored Studio raster checkpoint job is invalid") {
    super(message);
    this.name = "StudioCrdtRasterCheckpointStorageError";
  }
}

type JobRow = typeof creatorWorkCrdtRasterCheckpointJobs.$inferSelect;

function copyBytes(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value);
}

export function studioCrdtRasterCheckpointLeaseTokenHash(value: string): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(value, "utf8").digest());
}

function equalHashes(left: Uint8Array | null, right: Uint8Array): boolean {
  return Boolean(
    left && left.byteLength === right.byteLength && timingSafeEqual(left, right)
  );
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function jobRecord(row: JobRow): StudioCrdtRasterCheckpointJobRecord {
  const status = row.status as StudioCrdtRasterCheckpointJobStatus;
  const baseValid =
    (status === "pending" || status === "leased" || status === "completed") &&
    UUID_PATTERN.test(row.jobId) &&
    UUID_PATTERN.test(row.proofId) &&
    SHA256_PATTERN.test(row.requestHash) &&
    row.surfaceId.length >= 1 &&
    row.surfaceId.length <= 160 &&
    SAFE_ID_PATTERN.test(row.surfaceId) &&
    row.throughActorId.length >= 1 &&
    row.throughActorId.length <= 160 &&
    SAFE_ID_PATTERN.test(row.throughActorId) &&
    CLOCK_PATTERN.test(row.throughLogicalClock) &&
    UUID_PATTERN.test(row.throughEventId) &&
    typeof row.sourceSequence === "bigint" &&
    row.sourceSequence > 0n &&
    Number.isSafeInteger(row.attempt) &&
    row.attempt >= 0 &&
    row.attempt <= 32 &&
    validDate(row.notBefore) &&
    validDate(row.createdAt) &&
    validDate(row.updatedAt);
  const pendingValid = status !== "pending" || (
    row.leaseOwner === null &&
    row.leaseTokenHash === null &&
    row.leaseExpiresAt === null &&
    row.resultHash === null &&
    row.resultCheckpointId === null &&
    row.resultSequence === null &&
    row.completedAt === null
  );
  const leasedValid = status !== "leased" || (
    typeof row.leaseOwner === "string" &&
    row.leaseOwner.length > 0 &&
    row.leaseOwner.length <= 160 &&
    SAFE_ID_PATTERN.test(row.leaseOwner) &&
    row.leaseTokenHash instanceof Uint8Array &&
    row.leaseTokenHash.byteLength === 32 &&
    validDate(row.leaseExpiresAt) &&
    row.resultHash === null &&
    row.resultCheckpointId === null &&
    row.resultSequence === null &&
    row.completedAt === null
  );
  const completedValid = status !== "completed" || (
    typeof row.leaseOwner === "string" &&
    row.leaseOwner.length > 0 &&
    row.leaseOwner.length <= 160 &&
    SAFE_ID_PATTERN.test(row.leaseOwner) &&
    row.leaseTokenHash instanceof Uint8Array &&
    row.leaseTokenHash.byteLength === 32 &&
    validDate(row.leaseExpiresAt) &&
    typeof row.resultHash === "string" &&
    SHA256_PATTERN.test(row.resultHash) &&
    row.resultCheckpointId === row.jobId &&
    typeof row.resultSequence === "bigint" &&
    row.resultSequence > 0n &&
    validDate(row.completedAt)
  );
  if (!baseValid || !pendingValid || !leasedValid || !completedValid) {
    throw new StudioCrdtRasterCheckpointStorageError();
  }
  return {
    workId: row.workId,
    surfaceId: row.surfaceId,
    jobId: row.jobId,
    proofId: row.proofId,
    requestHash: row.requestHash,
    sourceSequence: row.sourceSequence,
    through: {
      logicalClock: row.throughLogicalClock,
      actorId: row.throughActorId,
      eventId: row.throughEventId,
    },
    status,
    attempt: row.attempt,
    notBefore: new Date(row.notBefore),
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt) : null,
    resultHash: row.resultHash,
    resultCheckpointId: row.resultCheckpointId,
    resultSequence: row.resultSequence,
    completedAt: row.completedAt ? new Date(row.completedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function assertLease(
  row: JobRow,
  input: MutateStudioCrdtRasterCheckpointLeaseInput,
  requireUnexpired: boolean
): void {
  if (
    row.jobId !== input.jobId ||
    row.leaseOwner !== input.coordinatorId ||
    !equalHashes(
      row.leaseTokenHash,
      studioCrdtRasterCheckpointLeaseTokenHash(input.leaseToken)
    ) ||
    (requireUnexpired && (!row.leaseExpiresAt || row.leaseExpiresAt.getTime() <= input.now.getTime()))
  ) {
    throw new StudioCrdtRasterCheckpointLeaseError();
  }
}

async function selectedJob(
  transaction: DrizzleStudioCrdtTransaction,
  workId: string,
  surfaceId: string
): Promise<JobRow | null> {
  const [row] = await transaction
    .select()
    .from(creatorWorkCrdtRasterCheckpointJobs)
    .where(and(
      eq(creatorWorkCrdtRasterCheckpointJobs.workId, workId),
      eq(creatorWorkCrdtRasterCheckpointJobs.surfaceId, surfaceId)
    ))
    .limit(1);
  return row ?? null;
}

async function assertCheckpointAssetsStored(
  transaction: DrizzleStudioCrdtTransaction,
  workId: string,
  references: readonly StudioRasterAssetReference[]
): Promise<void> {
  const expected = new Map(references.map((reference) => [reference.assetId, reference]));
  if (expected.size !== references.length) {
    for (const reference of references) {
      const duplicate = references.find((candidate) => candidate !== reference && candidate.assetId === reference.assetId);
      if (duplicate && canonicalStudioRasterJson(duplicate) !== canonicalStudioRasterJson(reference)) {
        throw new StudioCrdtRasterCheckpointStorageError("Checkpoint assets reuse an id with different metadata");
      }
    }
  }
  if (expected.size === 0) return;
  const rows = await transaction
    .select({
      assetId: creatorWorkRasterAssets.assetId,
      sha256: creatorWorkRasterAssets.sha256,
      byteLength: creatorWorkRasterAssets.byteLength,
      mediaType: creatorWorkRasterAssets.mediaType,
      width: creatorWorkRasterAssets.width,
      height: creatorWorkRasterAssets.height,
    })
    .from(creatorWorkRasterAssets)
    .where(and(
      eq(creatorWorkRasterAssets.workId, workId),
      inArray(creatorWorkRasterAssets.assetId, [...expected.keys()])
    ));
  if (rows.length !== expected.size) {
    throw new StudioCrdtRasterCheckpointStorageError("Checkpoint references a missing raster asset");
  }
  for (const row of rows) {
    const reference = expected.get(row.assetId);
    if (
      !reference ||
      reference.scope !== "work" ||
      reference.assetId !== row.assetId ||
      reference.sha256 !== row.sha256 ||
      reference.byteLength !== row.byteLength ||
      reference.mediaType !== row.mediaType ||
      reference.width !== row.width ||
      reference.height !== row.height
    ) {
      throw new StudioCrdtRasterCheckpointStorageError(
        "Checkpoint raster asset metadata does not match durable storage"
      );
    }
  }
}

export class DrizzleStudioCrdtRasterCheckpointRepository
implements StudioCrdtRasterCheckpointRepository {
  async enqueue(input: EnqueueStudioCrdtRasterCheckpointJobInput): Promise<boolean> {
    return db.transaction((transaction) =>
      withStudioCrdtWorkMutationLock(transaction, input.workId, async () => {
        const existing = await selectedJob(transaction, input.workId, input.surfaceId);
        if (existing) jobRecord(existing);
        if (existing && existing.status !== "completed") return false;
        if (existing?.requestHash === input.requestHash) return false;
        const values = {
          workId: input.workId,
          surfaceId: input.surfaceId,
          jobId: input.jobId,
          proofId: input.proofId,
          requestHash: input.requestHash,
          sourceSequence: input.sourceSequence,
          throughLogicalClock: input.through.logicalClock,
          throughActorId: input.through.actorId,
          throughEventId: input.through.eventId,
          status: "pending",
          attempt: 0,
          notBefore: input.now,
          leaseOwner: null,
          leaseTokenHash: null,
          leaseExpiresAt: null,
          resultHash: null,
          resultCheckpointId: null,
          resultSequence: null,
          completedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        } as const;
        if (!existing) {
          await transaction.insert(creatorWorkCrdtRasterCheckpointJobs).values(values);
          return true;
        } else {
          const [requeued] = await transaction
            .update(creatorWorkCrdtRasterCheckpointJobs)
            .set(values)
            .where(and(
              eq(creatorWorkCrdtRasterCheckpointJobs.workId, input.workId),
              eq(creatorWorkCrdtRasterCheckpointJobs.surfaceId, input.surfaceId),
              eq(creatorWorkCrdtRasterCheckpointJobs.status, "completed")
            ))
            .returning({ jobId: creatorWorkCrdtRasterCheckpointJobs.jobId });
          return Boolean(requeued);
        }
      })
    );
  }

  async claim(
    input: ClaimStudioCrdtRasterCheckpointJobInput
  ): Promise<StudioCrdtRasterCheckpointJobRecord | null> {
    return db.transaction((transaction) =>
      withStudioCrdtWorkMutationLock(transaction, input.workId, async () => {
        const existing = await selectedJob(transaction, input.workId, input.surfaceId);
        if (existing) jobRecord(existing);
        if (!existing || existing.status === "completed") return null;
        const ready = existing.status === "pending"
          ? existing.notBefore.getTime() <= input.now.getTime()
          : Boolean(existing.leaseExpiresAt && existing.leaseExpiresAt.getTime() <= input.now.getTime());
        if (!ready) return null;
        const [claimed] = await transaction
          .update(creatorWorkCrdtRasterCheckpointJobs)
          .set({
            status: "leased",
            attempt: Math.min(32, existing.attempt + 1),
            leaseOwner: input.coordinatorId,
            leaseTokenHash: studioCrdtRasterCheckpointLeaseTokenHash(input.leaseToken),
            leaseExpiresAt: input.leaseExpiresAt,
            updatedAt: input.now,
          })
          .where(and(
            eq(creatorWorkCrdtRasterCheckpointJobs.workId, input.workId),
            eq(creatorWorkCrdtRasterCheckpointJobs.surfaceId, input.surfaceId),
            eq(creatorWorkCrdtRasterCheckpointJobs.jobId, existing.jobId),
            eq(creatorWorkCrdtRasterCheckpointJobs.status, existing.status)
          ))
          .returning();
        return claimed ? jobRecord(claimed) : null;
      })
    );
  }

  async defer(input: DeferStudioCrdtRasterCheckpointJobInput): Promise<boolean> {
    return db.transaction((transaction) =>
      withStudioCrdtWorkMutationLock(transaction, input.workId, async () => {
        const existing = await selectedJob(transaction, input.workId, input.surfaceId);
        if (existing) jobRecord(existing);
        if (!existing || existing.status !== "leased") return false;
        assertLease(existing, input, false);
        const [deferred] = await transaction
          .update(creatorWorkCrdtRasterCheckpointJobs)
          .set({
            status: "pending",
            notBefore: input.notBefore,
            leaseOwner: null,
            leaseTokenHash: null,
            leaseExpiresAt: null,
            updatedAt: input.now,
          })
          .where(and(
            eq(creatorWorkCrdtRasterCheckpointJobs.workId, input.workId),
            eq(creatorWorkCrdtRasterCheckpointJobs.surfaceId, input.surfaceId),
            eq(creatorWorkCrdtRasterCheckpointJobs.jobId, input.jobId),
            eq(creatorWorkCrdtRasterCheckpointJobs.status, "leased")
          ))
          .returning({ jobId: creatorWorkCrdtRasterCheckpointJobs.jobId });
        return Boolean(deferred);
      })
    );
  }

  async supersede(input: SupersedeStudioCrdtRasterCheckpointJobInput): Promise<boolean> {
    return db.transaction((transaction) =>
      withStudioCrdtWorkMutationLock(transaction, input.workId, async () => {
        const existing = await selectedJob(transaction, input.workId, input.surfaceId);
        if (existing) jobRecord(existing);
        if (!existing || existing.status !== "leased") return false;
        assertLease(existing, input, false);
        const [superseded] = await transaction
          .update(creatorWorkCrdtRasterCheckpointJobs)
          .set({
            jobId: input.replacementJobId,
            proofId: input.replacementProofId,
            requestHash: input.replacementRequestHash,
            sourceSequence: input.replacementSourceSequence,
            throughLogicalClock: input.replacementThrough.logicalClock,
            throughActorId: input.replacementThrough.actorId,
            throughEventId: input.replacementThrough.eventId,
            status: "pending",
            notBefore: input.notBefore,
            leaseOwner: null,
            leaseTokenHash: null,
            leaseExpiresAt: null,
            resultHash: null,
            resultCheckpointId: null,
            resultSequence: null,
            completedAt: null,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .where(and(
            eq(creatorWorkCrdtRasterCheckpointJobs.workId, input.workId),
            eq(creatorWorkCrdtRasterCheckpointJobs.surfaceId, input.surfaceId),
            eq(creatorWorkCrdtRasterCheckpointJobs.jobId, input.jobId),
            eq(creatorWorkCrdtRasterCheckpointJobs.status, "leased")
          ))
          .returning({ jobId: creatorWorkCrdtRasterCheckpointJobs.jobId });
        return Boolean(superseded);
      })
    );
  }

  async finalize(
    input: FinalizeStudioCrdtRasterCheckpointJobInput,
    build: BuildStudioCrdtRasterCheckpointUpdate
  ): Promise<FinalizeStudioCrdtRasterCheckpointJobResult> {
    return db.transaction((transaction) =>
      withStudioCrdtWorkMutationLock(transaction, input.workId, async () => {
        const existing = await selectedJob(transaction, input.workId, input.surfaceId);
        if (!existing) throw new StudioCrdtRasterCheckpointLeaseError();
        jobRecord(existing);
        if (existing.status === "completed") {
          assertLease(existing, input, false);
          if (
            existing.resultHash !== input.resultHash ||
            existing.resultCheckpointId !== existing.jobId ||
            existing.resultSequence === null
          ) throw new StudioCrdtRasterCheckpointLeaseError("Checkpoint completion conflicts with its durable result");
          return {
            inserted: false,
            checkpointId: existing.resultCheckpointId,
            sequence: existing.resultSequence,
          };
        }
        if (existing.status !== "leased") throw new StudioCrdtRasterCheckpointLeaseError();
        assertLease(existing, input, true);
        const job = jobRecord(existing);
        const built = await build(
          job,
          await loadStudioCrdtDocumentInTransaction(transaction, input.workId),
          transaction
        );
        if (
          built.checkpointId !== existing.jobId ||
          !(built.payload instanceof Uint8Array) ||
          built.payload.byteLength === 0 ||
          built.payload.byteLength > STUDIO_CRDT_UPDATE_MAX_BYTES
        ) {
          throw new StudioCrdtRasterCheckpointStorageError("Trusted checkpoint update exceeds its durable update contract");
        }
        await assertCheckpointAssetsStored(transaction, input.workId, built.assets);

        const payloadHash = studioCrdtPayloadHash(built.payload);
        const [claimedReceipt] = await transaction
          .insert(creatorWorkCrdtUpdateReceipts)
          .values({
            workId: input.workId,
            updateId: existing.jobId,
            actorUserId: null,
            payloadHash,
            createdAt: input.now,
          })
          .onConflictDoNothing({
            target: [
              creatorWorkCrdtUpdateReceipts.workId,
              creatorWorkCrdtUpdateReceipts.updateId,
            ],
          })
          .returning();
        if (!claimedReceipt) {
          throw new StudioCrdtRasterCheckpointStorageError("Checkpoint update id already has a durable receipt");
        }
        const [inserted] = await transaction
          .insert(creatorWorkCrdtUpdates)
          .values({
            workId: input.workId,
            updateId: existing.jobId,
            actorUserId: null,
            payload: copyBytes(built.payload),
            createdAt: input.now,
          })
          .returning({ sequence: creatorWorkCrdtUpdates.sequence });
        if (!inserted) throw new StudioCrdtRasterCheckpointStorageError("Checkpoint update was not inserted");
        const [completedReceipt] = await transaction
          .update(creatorWorkCrdtUpdateReceipts)
          .set({ sequence: inserted.sequence })
          .where(and(
            eq(creatorWorkCrdtUpdateReceipts.workId, input.workId),
            eq(creatorWorkCrdtUpdateReceipts.updateId, existing.jobId)
          ))
          .returning({ sequence: creatorWorkCrdtUpdateReceipts.sequence });
        if (completedReceipt?.sequence !== inserted.sequence) {
          throw new StudioCrdtRasterCheckpointStorageError("Checkpoint receipt could not be completed");
        }
        const [completed] = await transaction
          .update(creatorWorkCrdtRasterCheckpointJobs)
          .set({
            status: "completed",
            resultHash: input.resultHash,
            resultCheckpointId: existing.jobId,
            resultSequence: inserted.sequence,
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(and(
            eq(creatorWorkCrdtRasterCheckpointJobs.workId, input.workId),
            eq(creatorWorkCrdtRasterCheckpointJobs.surfaceId, input.surfaceId),
            eq(creatorWorkCrdtRasterCheckpointJobs.jobId, existing.jobId),
            eq(creatorWorkCrdtRasterCheckpointJobs.status, "leased")
          ))
          .returning({ jobId: creatorWorkCrdtRasterCheckpointJobs.jobId });
        if (!completed) throw new StudioCrdtRasterCheckpointLeaseError();
        return {
          inserted: true,
          checkpointId: existing.jobId,
          sequence: inserted.sequence,
        };
      })
    );
  }
}

export const studioCrdtRasterCheckpointRepositoryProvider = {
  provide: STUDIO_CRDT_RASTER_CHECKPOINT_REPOSITORY,
  useFactory: (): StudioCrdtRasterCheckpointRepository =>
    new DrizzleStudioCrdtRasterCheckpointRepository(),
};
