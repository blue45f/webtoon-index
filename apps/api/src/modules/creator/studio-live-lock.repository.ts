import { and, asc, eq, gt, lte, sql } from "drizzle-orm";

import { studioLiveLockResourcesConflict } from "../../../../web/src/shared/lib/studio-live-lock-resource";
import {
  creatorWorkLiveLockClocks,
  creatorWorkLiveLocks,
  db,
} from "../../db";

export const STUDIO_LIVE_LOCK_REPOSITORY = Symbol("STUDIO_LIVE_LOCK_REPOSITORY");
export const STUDIO_LIVE_LOCK_LIMIT_PER_WORK = 200;
export const STUDIO_LIVE_LOCK_ADVISORY_NAMESPACE =
  "toonspectrum:creator-work-live-lock:v1:";
const STUDIO_LIVE_LOCK_EXPIRY_WORK_BATCH_LIMIT = 128;
const STUDIO_LIVE_LOCK_EXPIRY_CONCURRENCY = 4;
const STUDIO_LIVE_LOCK_ACQUISITION_SEPARATOR = ".";

type DrizzleStudioLiveLockTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export interface StudioLiveLockRecord {
  workId: string;
  resourceId: string;
  leaseId: string;
  /** Internal request-correlation + server-nonce fencing token. Never expose the nonce. */
  acquisitionId: string;
  ownerConnectionId: string;
  ownerName: string;
  /** Per-work monotonic mutation order. Release records carry the deletion event revision. */
  revision: bigint;
  expiresAt: Date;
}

export interface StudioLiveLockSnapshot {
  revision: bigint;
  locks: StudioLiveLockRecord[];
}

export interface AcquireStudioLiveLockInput {
  workId: string;
  resourceId: string;
  /** Server-generated public fence used by a fresh lease or a successful v2 renewal. */
  requestedLeaseId: string;
  /** v2 clients rotate the public fence on every successful acquire/renew. */
  rotateLease?: boolean;
  /** Exact lease observed by a renewal heartbeat. Omit only for a fresh acquisition lifecycle. */
  renewLeaseId?: string;
  /** Server-unique token that embeds request correlation and fences authorization rollback. */
  acquisitionId: string;
  ownerConnectionId: string;
  ownerName: string;
  leaseMs: number;
}

export type AcquireStudioLiveLockResult =
  | { status: "acquired"; lock: StudioLiveLockRecord; created: boolean }
  | { status: "conflict"; lock: StudioLiveLockRecord }
  | { status: "stale"; lock?: StudioLiveLockRecord }
  | { status: "limit" };

export interface ReleaseStudioLiveLockInput {
  workId: string;
  resourceId: string;
  leaseId: string;
  ownerConnectionId: string;
}

export interface StudioLiveLockRepository {
  /** Cross-node, per-work critical section for ephemeral collaboration admission decisions. */
  withWorkMutation<T>(workId: string, operation: () => Promise<T>): Promise<T>;
  acquire(input: AcquireStudioLiveLockInput): Promise<AcquireStudioLiveLockResult>;
  release(input: ReleaseStudioLiveLockInput): Promise<StudioLiveLockRecord | null>;
  rollbackAcquire(
    input: ReleaseStudioLiveLockInput & { acquisitionId: string }
  ): Promise<StudioLiveLockRecord | null>;
  releaseConnection(workId: string, ownerConnectionId: string): Promise<StudioLiveLockRecord[]>;
  snapshot(workId: string): Promise<StudioLiveLockSnapshot>;
  list(workId: string): Promise<StudioLiveLockRecord[]>;
  purgeExpired(): Promise<StudioLiveLockRecord[]>;
}

export function studioLiveLockWorkAdvisoryQuery(workId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`${STUDIO_LIVE_LOCK_ADVISORY_NAMESPACE}${workId}`}, 0))`;
}

export function createStudioLiveLockAcquisitionId(requestId: string, nonce: string): string {
  return `${requestId}${STUDIO_LIVE_LOCK_ACQUISITION_SEPARATOR}${nonce}`;
}

/** Old rows contain one UUID; new rows prefix their private nonce with the public request UUID. */
export function studioLiveLockRequestIdFromAcquisitionId(acquisitionId: string): string {
  const separator = acquisitionId.indexOf(STUDIO_LIVE_LOCK_ACQUISITION_SEPARATOR);
  return separator > 0 ? acquisitionId.slice(0, separator) : acquisitionId;
}

export async function withStudioLiveLockWorkMutation<T>(
  transaction: DrizzleStudioLiveLockTransaction,
  workId: string,
  operation: () => Promise<T>
): Promise<T> {
  await transaction.execute(studioLiveLockWorkAdvisoryQuery(workId));
  return operation();
}

async function nextStudioLiveLockRevision(
  transaction: DrizzleStudioLiveLockTransaction,
  workId: string
): Promise<bigint> {
  const [clock] = await transaction
    .insert(creatorWorkLiveLockClocks)
    .values({ workId, revision: 1n, updatedAt: sql`statement_timestamp()` })
    .onConflictDoUpdate({
      target: creatorWorkLiveLockClocks.workId,
      set: {
        revision: sql`${creatorWorkLiveLockClocks.revision} + 1`,
        updatedAt: sql`statement_timestamp()`,
      },
    })
    .returning({ revision: creatorWorkLiveLockClocks.revision });
  if (!clock) throw new Error("studio live lock revision clock did not advance");
  return clock.revision;
}

function toRecord(
  row: typeof creatorWorkLiveLocks.$inferSelect
): StudioLiveLockRecord {
  return {
    workId: row.workId,
    resourceId: row.resourceId,
    leaseId: row.leaseId,
    acquisitionId: row.acquisitionId,
    ownerConnectionId: row.ownerConnectionId,
    ownerName: row.ownerName,
    revision: row.revision,
    expiresAt: row.expiresAt,
  };
}

/**
 * PostgreSQL is the authority for short collaboration leases. Every acquire/release for one work
 * is serialized through the same transaction advisory lock, so separate API instances cannot
 * both observe an absent resource and grant it. Lease timestamps use the database clock to avoid
 * application-node clock skew.
 */
export class DrizzleStudioLiveLockRepository implements StudioLiveLockRepository {
  constructor(private readonly database: typeof db = db) {}

  async withWorkMutation<T>(workId: string, operation: () => Promise<T>): Promise<T> {
    return this.database.transaction(
      (transaction) => withStudioLiveLockWorkMutation(transaction, workId, operation),
      { isolationLevel: "read committed" }
    );
  }

  async acquire(input: AcquireStudioLiveLockInput): Promise<AcquireStudioLiveLockResult> {
    return this.database.transaction(
      (transaction) => withStudioLiveLockWorkMutation(transaction, input.workId, async () => {
        const expired = await transaction
          .delete(creatorWorkLiveLocks)
          .where(
            and(
              eq(creatorWorkLiveLocks.workId, input.workId),
              lte(creatorWorkLiveLocks.expiresAt, sql`statement_timestamp()`)
            )
          )
          .returning({ resourceId: creatorWorkLiveLocks.resourceId });
        // Expiry is a real state transition even when this acquire later returns stale/conflict.
        // It intentionally owns a revision separate from the following acquire so a later JOIN
        // snapshot has a floor newer than every removed fence. No fanout is needed here because
        // those leases are already invalid by their database-authored wall-clock deadline.
        if (expired.length > 0) {
          await nextStudioLiveLockRevision(transaction, input.workId);
        }

        // The per-work advisory lock makes this read/check/write one atomic admission decision
        // across API instances. Read the bounded active set so page/element ancestors participate
        // in the same decision as an exact resource row.
        const activeRows = await transaction
          .select()
          .from(creatorWorkLiveLocks)
          .where(eq(creatorWorkLiveLocks.workId, input.workId))
          .orderBy(asc(creatorWorkLiveLocks.resourceId))
          .limit(STUDIO_LIVE_LOCK_LIMIT_PER_WORK + 1);
        const existing = activeRows.find((row) => row.resourceId === input.resourceId);
        const conflicting = activeRows.find(
          (row) =>
            row.ownerConnectionId !== input.ownerConnectionId &&
            studioLiveLockResourcesConflict(row.resourceId, input.resourceId)
        );
        // A renewal is a compare-and-swap operation, not a new acquisition. If release already
        // removed the observed fence, a newer lifecycle rotated it, or another owner acquired the
        // resource, the delayed heartbeat must fail closed as stale. Evaluate this before ordinary
        // conflicts so a lost owner never mistakes an ownership change for a retryable fresh-lock
        // conflict.
        if (
          input.renewLeaseId !== undefined &&
          (!existing ||
            existing.ownerConnectionId !== input.ownerConnectionId ||
            existing.leaseId !== input.renewLeaseId)
        ) {
          const current = existing ?? conflicting;
          return {
            status: "stale",
            ...(current ? { lock: toRecord(current) } : {}),
          };
        }
        if (conflicting) {
          return { status: "conflict", lock: toRecord(conflicting) };
        }
        // In v2, omission means a fresh lifecycle that expects no row. It must not rotate a newer
        // lifecycle merely because the same socket still owns that resource.
        if (input.rotateLease && input.renewLeaseId === undefined && existing) {
          return { status: "stale", lock: toRecord(existing) };
        }

        if (!existing && activeRows.length >= STUDIO_LIVE_LOCK_LIMIT_PER_WORK) {
          return { status: "limit" };
        }

        // v2 clients receive a new fence on every success. Legacy clients retain the stable lease
        // behavior during the rolling window so a new server cannot strand an old Room on L2 after
        // it already sent release(L1).
        const leaseId = existing && !input.rotateLease
          ? existing.leaseId
          : input.requestedLeaseId;
        const revision = await nextStudioLiveLockRevision(transaction, input.workId);
        const expiresAt = sql`statement_timestamp() + (${input.leaseMs} * interval '1 millisecond')`;
        const [stored] = existing
          ? await transaction
              .update(creatorWorkLiveLocks)
              .set({
                leaseId,
                ownerName: input.ownerName,
                revision,
                acquisitionId: input.acquisitionId,
                expiresAt,
                updatedAt: sql`statement_timestamp()`,
              })
              .where(
                and(
                  eq(creatorWorkLiveLocks.workId, input.workId),
                  eq(creatorWorkLiveLocks.resourceId, input.resourceId),
                  eq(creatorWorkLiveLocks.ownerConnectionId, input.ownerConnectionId),
                  eq(creatorWorkLiveLocks.leaseId, existing.leaseId)
                )
              )
              .returning()
          : await transaction
              .insert(creatorWorkLiveLocks)
              .values({
                workId: input.workId,
                resourceId: input.resourceId,
                leaseId,
                acquisitionId: input.acquisitionId,
                ownerConnectionId: input.ownerConnectionId,
                ownerName: input.ownerName,
                revision,
                expiresAt,
              })
              .returning();
        // Every repository mutation, including the expiry sweep, takes the per-work advisory lock.
        // Keep the fenced predicate as defense in depth; an out-of-band writer that removes the
        // row after our read is surfaced as stale instead of reviving an older lifecycle.
        if (!stored) {
          if (existing) return { status: "stale" };
          throw new Error("studio live lock mutation lost its serialized owner");
        }
        return { status: "acquired", lock: toRecord(stored), created: !existing };
      }),
      { isolationLevel: "read committed" }
    );
  }

  async release(input: ReleaseStudioLiveLockInput): Promise<StudioLiveLockRecord | null> {
    return this.database.transaction(
      (transaction) => withStudioLiveLockWorkMutation(transaction, input.workId, async () => {
        const [released] = await transaction
          .delete(creatorWorkLiveLocks)
          .where(
            and(
              eq(creatorWorkLiveLocks.workId, input.workId),
              eq(creatorWorkLiveLocks.resourceId, input.resourceId),
              eq(creatorWorkLiveLocks.ownerConnectionId, input.ownerConnectionId),
              eq(creatorWorkLiveLocks.leaseId, input.leaseId)
            )
          )
          .returning();
        if (!released) return null;
        const revision = await nextStudioLiveLockRevision(transaction, input.workId);
        return { ...toRecord(released), revision };
      }),
      { isolationLevel: "read committed" }
    );
  }

  async rollbackAcquire(
    input: ReleaseStudioLiveLockInput & { acquisitionId: string }
  ): Promise<StudioLiveLockRecord | null> {
    return this.database.transaction(
      (transaction) => withStudioLiveLockWorkMutation(transaction, input.workId, async () => {
        const [released] = await transaction
          .delete(creatorWorkLiveLocks)
          .where(
            and(
              eq(creatorWorkLiveLocks.workId, input.workId),
              eq(creatorWorkLiveLocks.resourceId, input.resourceId),
              eq(creatorWorkLiveLocks.ownerConnectionId, input.ownerConnectionId),
              eq(creatorWorkLiveLocks.leaseId, input.leaseId),
              eq(creatorWorkLiveLocks.acquisitionId, input.acquisitionId)
            )
          )
          .returning();
        if (!released) return null;
        const revision = await nextStudioLiveLockRevision(transaction, input.workId);
        return { ...toRecord(released), revision };
      }),
      { isolationLevel: "read committed" }
    );
  }

  async releaseConnection(
    workId: string,
    ownerConnectionId: string
  ): Promise<StudioLiveLockRecord[]> {
    return this.database.transaction(
      (transaction) => withStudioLiveLockWorkMutation(transaction, workId, async () => {
        const released = await transaction
          .delete(creatorWorkLiveLocks)
          .where(
            and(
              eq(creatorWorkLiveLocks.workId, workId),
              eq(creatorWorkLiveLocks.ownerConnectionId, ownerConnectionId)
            )
          )
          .returning();
        if (released.length === 0) return [];
        const revision = await nextStudioLiveLockRevision(transaction, workId);
        return released.map((row) => ({ ...toRecord(row), revision }));
      }),
      { isolationLevel: "read committed" }
    );
  }

  async snapshot(workId: string): Promise<StudioLiveLockSnapshot> {
    return this.database.transaction(
      (transaction) => withStudioLiveLockWorkMutation(transaction, workId, async () => {
        // Read the clock first. A creator_work parent deletion does not participate in this
        // advisory namespace; if its cascade commits between these statements, the result is an
        // older valid floor plus an empty lock set rather than rows paired with a vanished clock.
        const [clock] = await transaction
          .select({ revision: creatorWorkLiveLockClocks.revision })
          .from(creatorWorkLiveLockClocks)
          .where(eq(creatorWorkLiveLockClocks.workId, workId))
          .limit(1);
        const rows = await transaction
          .select()
          .from(creatorWorkLiveLocks)
          .where(
            and(
              eq(creatorWorkLiveLocks.workId, workId),
              gt(creatorWorkLiveLocks.expiresAt, sql`statement_timestamp()`)
            )
          )
          .orderBy(asc(creatorWorkLiveLocks.resourceId));
        return { revision: clock?.revision ?? 0n, locks: rows.map(toRecord) };
      }),
      { isolationLevel: "read committed" }
    );
  }

  async list(workId: string): Promise<StudioLiveLockRecord[]> {
    return (await this.snapshot(workId)).locks;
  }

  async purgeExpired(): Promise<StudioLiveLockRecord[]> {
    const works = await this.database
      .selectDistinct({ workId: creatorWorkLiveLocks.workId })
      .from(creatorWorkLiveLocks)
      .where(lte(creatorWorkLiveLocks.expiresAt, sql`statement_timestamp()`))
      .orderBy(asc(creatorWorkLiveLocks.workId))
      .limit(STUDIO_LIVE_LOCK_EXPIRY_WORK_BATCH_LIMIT);
    const purged: StudioLiveLockRecord[] = [];
    for (let index = 0; index < works.length; index += STUDIO_LIVE_LOCK_EXPIRY_CONCURRENCY) {
      const batch = await Promise.all(
        works.slice(index, index + STUDIO_LIVE_LOCK_EXPIRY_CONCURRENCY).map(({ workId }) =>
          this.database.transaction(
            (transaction) => withStudioLiveLockWorkMutation(transaction, workId, async () => {
              const rows = await transaction
                .delete(creatorWorkLiveLocks)
                .where(
                  and(
                    eq(creatorWorkLiveLocks.workId, workId),
                    lte(creatorWorkLiveLocks.expiresAt, sql`statement_timestamp()`)
                  )
                )
                .returning();
              if (rows.length === 0) return [];
              const revision = await nextStudioLiveLockRevision(transaction, workId);
              return rows.map((row) => ({ ...toRecord(row), revision }));
            }),
            { isolationLevel: "read committed" }
          )
        )
      );
      for (const rows of batch) purged.push(...rows);
    }
    return purged;
  }
}

export const studioLiveLockRepositoryProvider = {
  provide: STUDIO_LIVE_LOCK_REPOSITORY,
  useFactory: () => new DrizzleStudioLiveLockRepository(),
};
