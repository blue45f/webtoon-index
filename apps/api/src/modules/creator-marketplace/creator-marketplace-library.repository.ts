import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import {
  creatorMarketplaceLogicalPackIdFromPackageKeyHex,
  creatorMarketplacePackageIdentityPreimage,
} from "../../../../web/src/shared/lib/creator-marketplace-cloud-library-contract";
import {
  CreatorMarketplacePackageModerationStateSchema,
  CreatorMarketplaceResourceKindSchema,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";
import { db, users } from "../../db";
import { creatorMarketplaceLibraryItems } from "../../db/creator-marketplace-library.schema";
import { creatorMarketplacePackageModeration } from "../../db/creator-marketplace-package-moderation.schema";
import { creatorMarketplaceResources } from "../../db/creator-marketplace-resource.schema";

import {
  CREATOR_MARKETPLACE_LIBRARY_REPOSITORY,
  CreatorMarketplaceLibraryAcquisitionRejectedError,
  CreatorMarketplaceLibraryInactiveUserError,
  CreatorMarketplaceLibraryIntegrityError,
  CreatorMarketplaceLibraryReleaseNotFoundError,
  CreatorMarketplaceLibraryUnsupportedKindError,
  mapCreatorMarketplaceLibraryDatabaseError,
} from "./creator-marketplace-library.repository-contract";

import type {
  CreatorMarketplaceCloudLibraryRepository,
  CreatorMarketplaceAcquisitionTargetStoredRow,
  CreatorMarketplaceLibraryCatalogHeadRow,
  CreatorMarketplaceLibraryListInput,
  CreatorMarketplaceLibraryMutationResult,
  CreatorMarketplaceLibraryStoredRow,
} from "./creator-marketplace-library.repository-contract";
import type { Provider } from "@nestjs/common";
import type { SQL } from "drizzle-orm";

const CONFIRMABLE_KINDS = new Set(["brush", "filter", "palette"]);
const RELEASE_LOCK_NAMESPACE = "toonspectrum:creator-marketplace-release:v1:";

interface LockedReleaseRow {
  readonly id: string;
  readonly publisherId: string;
  readonly packageId: string;
  readonly name: string;
  readonly kind: string;
  readonly resourceVersion: string;
  readonly minimumStudioVersion: string;
  readonly releaseOrdinal: number;
  readonly manifestHash: string;
  readonly delistedAt: Date | null;
}

function packageIdentity(release: Pick<LockedReleaseRow, "publisherId" | "packageId">): {
  digest: Uint8Array;
  logicalPackId: string;
} {
  const digestBuffer = createHash("sha256")
    .update(creatorMarketplacePackageIdentityPreimage(
      release.publisherId,
      release.packageId,
    ))
    .digest();
  return {
    digest: new Uint8Array(digestBuffer),
    logicalPackId: creatorMarketplaceLogicalPackIdFromPackageKeyHex(
      digestBuffer.toString("hex"),
    ),
  };
}

function releaseLockKey(
  release: Pick<LockedReleaseRow, "publisherId" | "packageId">,
): string {
  return `${RELEASE_LOCK_NAMESPACE}`
    + `${release.publisherId.length}:${release.publisherId}`
    + `${release.packageId.length}:${release.packageId}`;
}

function mapLibraryRow(
  row: typeof creatorMarketplaceLibraryItems.$inferSelect,
): CreatorMarketplaceLibraryStoredRow {
  return {
    ...row,
    kind: CreatorMarketplaceResourceKindSchema.parse(row.kind),
  };
}

function assertRawPackageIdentity(
  row: CreatorMarketplaceLibraryStoredRow,
  release: LockedReleaseRow,
): void {
  if (
    row.publisherId !== release.publisherId
    || row.packageId !== release.packageId
    || row.kind !== release.kind
  ) {
    throw new CreatorMarketplaceLibraryIntegrityError(
      "package-identity-collision",
    );
  }
}

function freshTimestamp(): SQL<Date> {
  return sql<Date>`greatest(
    statement_timestamp(),
    ${creatorMarketplaceLibraryItems.updatedAt} + interval '1 millisecond'
  )`;
}

export class DrizzleCreatorMarketplaceCloudLibraryRepository
implements CreatorMarketplaceCloudLibraryRepository {
  async resolveAcquisitionTarget(
    userId: string,
    releaseId: string,
  ): Promise<CreatorMarketplaceAcquisitionTargetStoredRow> {
    const [actor] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (actor?.status !== "active") {
      throw new CreatorMarketplaceLibraryInactiveUserError();
    }

    const [anchor] = await db
      .select({
        publisherId: creatorMarketplaceResources.publisherId,
        packageId: creatorMarketplaceResources.packageId,
        kind: creatorMarketplaceResources.kind,
        requestReleaseDelistedAt: creatorMarketplaceResources.delistedAt,
        packageState: creatorMarketplacePackageModeration.state,
        publisherStatus: users.status,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId,
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId,
          ),
        ),
      )
      .leftJoin(users, eq(users.id, creatorMarketplaceResources.publisherId))
      .where(eq(creatorMarketplaceResources.id, releaseId))
      .limit(1);
    if (!anchor) {
      throw new CreatorMarketplaceLibraryAcquisitionRejectedError("not-found");
    }

    // This is a read-only preflight. A publish/delist/moderation race may invalidate it immediately;
    // acquire() remains the package-locked authority and the client must re-resolve after failure.
    const [head] = await db
      .select({
        id: creatorMarketplaceResources.id,
        kind: creatorMarketplaceResources.kind,
        resourceVersion: creatorMarketplaceResources.resourceVersion,
        delistedAt: creatorMarketplaceResources.delistedAt,
      })
      .from(creatorMarketplaceResources)
      .where(and(
        eq(creatorMarketplaceResources.publisherId, anchor.publisherId),
        eq(creatorMarketplaceResources.packageId, anchor.packageId),
      ))
      .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
      .limit(1);
    if (!head) {
      throw new CreatorMarketplaceLibraryAcquisitionRejectedError("not-found");
    }
    return {
      requestReleaseId: releaseId,
      publisherId: anchor.publisherId,
      packageId: anchor.packageId,
      kind: CreatorMarketplaceResourceKindSchema.parse(anchor.kind),
      packageState: CreatorMarketplacePackageModerationStateSchema.parse(
        anchor.packageState,
      ),
      publisherStatus: anchor.publisherStatus,
      requestReleaseDelistedAt: anchor.requestReleaseDelistedAt,
      currentHeadId: head.id,
      currentHeadKind: CreatorMarketplaceResourceKindSchema.parse(head.kind),
      currentHeadResourceVersion: head.resourceVersion,
      currentHeadDelistedAt: head.delistedAt,
    };
  }

  async acquire(
    userId: string,
    releaseId: string,
  ): Promise<CreatorMarketplaceLibraryMutationResult> {
    try {
      return await db.transaction(async (transaction) => {
        const [anchor] = await transaction
          .select({
            publisherId: creatorMarketplaceResources.publisherId,
            packageId: creatorMarketplaceResources.packageId,
          })
          .from(creatorMarketplaceResources)
          .where(eq(creatorMarketplaceResources.id, releaseId))
          .limit(1);
        if (!anchor) {
          throw new CreatorMarketplaceLibraryAcquisitionRejectedError("not-found");
        }
        // Global order: package advisory lock -> account row -> library row. Publication,
        // moderation, acquisition, and confirmation must never invert these locks.
        await transaction.execute(sql`select pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(${releaseLockKey(anchor)}, 0)
        )`);
        const [moderation] = await transaction
          .select({ state: creatorMarketplacePackageModeration.state })
          .from(creatorMarketplacePackageModeration)
          .where(and(
            eq(creatorMarketplacePackageModeration.publisherId, anchor.publisherId),
            eq(creatorMarketplacePackageModeration.packageId, anchor.packageId),
          ))
          .limit(1)
          .for("update");
        if (!moderation || moderation.state !== "active") {
          throw new CreatorMarketplaceLibraryAcquisitionRejectedError("moderated");
        }

        // Buyer and publisher may be each other in crossed acquisitions. Lock both account rows
        // in one stable id order, before a release row, so account deletion cannot invert the
        // user/resource order and A->B plus B->A cannot deadlock.
        const lockedAccounts = await transaction
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(or(eq(users.id, userId), eq(users.id, anchor.publisherId)))
          .orderBy(asc(users.id))
          .for("update");
        const actor = lockedAccounts.find((account) => account.id === userId);
        if (actor?.status !== "active") {
          throw new CreatorMarketplaceLibraryInactiveUserError();
        }
        const publisher = lockedAccounts.find(
          (account) => account.id === anchor.publisherId,
        );
        if (publisher?.status !== "active") {
          throw new CreatorMarketplaceLibraryAcquisitionRejectedError(
            "publisher-unavailable",
          );
        }

        const [release] = await transaction
          .select({
            id: creatorMarketplaceResources.id,
            publisherId: creatorMarketplaceResources.publisherId,
            packageId: creatorMarketplaceResources.packageId,
            name: creatorMarketplaceResources.name,
            kind: creatorMarketplaceResources.kind,
            resourceVersion: creatorMarketplaceResources.resourceVersion,
            minimumStudioVersion: creatorMarketplaceResources.minimumStudioVersion,
            releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
            manifestHash: creatorMarketplaceResources.manifestHash,
            delistedAt: creatorMarketplaceResources.delistedAt,
          })
          .from(creatorMarketplaceResources)
          .where(and(
            eq(creatorMarketplaceResources.publisherId, anchor.publisherId),
            eq(creatorMarketplaceResources.packageId, anchor.packageId),
          ))
          .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
          .limit(1)
          .for("update");
        if (!release) {
          throw new CreatorMarketplaceLibraryAcquisitionRejectedError("not-found");
        }
        if (release.id !== releaseId) {
          throw new CreatorMarketplaceLibraryAcquisitionRejectedError("superseded");
        }
        if (release.delistedAt !== null) {
          throw new CreatorMarketplaceLibraryAcquisitionRejectedError("owner-delisted");
        }

        const identity = packageIdentity(release);
        const [inserted] = await transaction
          .insert(creatorMarketplaceLibraryItems)
          .values({
            id: randomUUID(),
            userId,
            packageKeyHash: identity.digest,
            publisherId: release.publisherId,
            packageId: release.packageId,
            kind: release.kind,
            nameSnapshot: release.name,
            addedFromReleaseId: release.id,
            addedFromResourceVersion: release.resourceVersion,
            addedFromReleaseOrdinal: release.releaseOrdinal,
            addedFromManifestHash: release.manifestHash,
          })
          .onConflictDoNothing({
            target: [
              creatorMarketplaceLibraryItems.userId,
              creatorMarketplaceLibraryItems.packageKeyHash,
            ],
          })
          .returning();
        if (inserted) return { row: mapLibraryRow(inserted), changed: true };

        const [existing] = await transaction
          .select()
          .from(creatorMarketplaceLibraryItems)
          .where(and(
            eq(creatorMarketplaceLibraryItems.userId, userId),
            eq(creatorMarketplaceLibraryItems.packageKeyHash, identity.digest),
          ))
          .limit(1)
          .for("update");
        if (!existing) {
          throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
        }
        const stored = mapLibraryRow(existing);
        // ON CONFLICT is idempotent only for the exact raw identity. Never treat SHA-256 as an
        // authorization proof or silently merge a digest collision/state corruption.
        assertRawPackageIdentity(stored, release);
        if (stored.archivedAt === null) return { row: stored, changed: false };

        const [unarchived] = await transaction
          .update(creatorMarketplaceLibraryItems)
          .set({ archivedAt: null, updatedAt: freshTimestamp() })
          .where(eq(creatorMarketplaceLibraryItems.id, stored.id))
          .returning();
        if (!unarchived) {
          throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
        }
        return { row: mapLibraryRow(unarchived), changed: true };
      });
    } catch (error) {
      return mapCreatorMarketplaceLibraryDatabaseError(error);
    }
  }

  async confirmStudioInstall(
    userId: string,
    releaseId: string,
    input: Parameters<CreatorMarketplaceCloudLibraryRepository["confirmStudioInstall"]>[2],
  ): Promise<CreatorMarketplaceLibraryMutationResult> {
    try {
      return await db.transaction(async (transaction) => {
        // An unavailable package preserves only an exact confirmation fact already recorded for
        // this account. New membership and confirmation advancement remain package-authoritative.
        const [anchor] = await transaction
          .select({
            publisherId: creatorMarketplaceResources.publisherId,
            packageId: creatorMarketplaceResources.packageId,
          })
          .from(creatorMarketplaceResources)
          .where(eq(creatorMarketplaceResources.id, releaseId))
          .limit(1);
        if (!anchor) throw new CreatorMarketplaceLibraryReleaseNotFoundError();
        await transaction.execute(sql`select pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(${releaseLockKey(anchor)}, 0)
        )`);
        const [moderation] = await transaction
          .select({ state: creatorMarketplacePackageModeration.state })
          .from(creatorMarketplacePackageModeration)
          .where(and(
            eq(creatorMarketplacePackageModeration.publisherId, anchor.publisherId),
            eq(creatorMarketplacePackageModeration.packageId, anchor.packageId),
          ))
          .limit(1)
          .for("update");
        if (!moderation) throw new CreatorMarketplaceLibraryReleaseNotFoundError();

        const lockedAccounts = await transaction
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(or(eq(users.id, userId), eq(users.id, anchor.publisherId)))
          .orderBy(asc(users.id))
          .for("update");
        const actor = lockedAccounts.find((account) => account.id === userId);
        if (actor?.status !== "active") {
          throw new CreatorMarketplaceLibraryInactiveUserError();
        }
        const publisher = lockedAccounts.find(
          (account) => account.id === anchor.publisherId,
        );

        const [head] = await transaction
          .select({
            id: creatorMarketplaceResources.id,
            delistedAt: creatorMarketplaceResources.delistedAt,
          })
          .from(creatorMarketplaceResources)
          .where(and(
            eq(creatorMarketplaceResources.publisherId, anchor.publisherId),
            eq(creatorMarketplaceResources.packageId, anchor.packageId),
          ))
          .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
          .limit(1)
          .for("update");
        if (!head) throw new CreatorMarketplaceLibraryReleaseNotFoundError();

        const [release] = await transaction
          .select({
            id: creatorMarketplaceResources.id,
            publisherId: creatorMarketplaceResources.publisherId,
            packageId: creatorMarketplaceResources.packageId,
            name: creatorMarketplaceResources.name,
            kind: creatorMarketplaceResources.kind,
            resourceVersion: creatorMarketplaceResources.resourceVersion,
            minimumStudioVersion: creatorMarketplaceResources.minimumStudioVersion,
            releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
            manifestHash: creatorMarketplaceResources.manifestHash,
            delistedAt: creatorMarketplaceResources.delistedAt,
          })
          .from(creatorMarketplaceResources)
          .where(eq(creatorMarketplaceResources.id, releaseId))
          .limit(1)
          .for("update");
        if (!release) throw new CreatorMarketplaceLibraryReleaseNotFoundError();

        const kind = CreatorMarketplaceResourceKindSchema.parse(release.kind);
        if (!CONFIRMABLE_KINDS.has(kind)) {
          throw new CreatorMarketplaceLibraryUnsupportedKindError(kind);
        }
        const identity = packageIdentity(release);
        if (input.logicalPackId !== identity.logicalPackId) {
          throw new CreatorMarketplaceLibraryIntegrityError(
            "logical-pack-id-mismatch",
          );
        }
        if (input.packageFingerprint !== release.manifestHash) {
          throw new CreatorMarketplaceLibraryIntegrityError("manifest-hash-mismatch");
        }

        // Package withdrawal/moderation may retain an exact already-confirmed private fact, but
        // may not create membership or advance confirmation to a new release/revision.
        const unavailableReason = moderation.state === "hidden"
          ? "moderated"
          : publisher?.status !== "active"
            ? "publisher-unavailable"
            : release.delistedAt !== null || head.delistedAt !== null
              ? "owner-delisted"
              : null;
        if (unavailableReason !== null) {
          const [existing] = await transaction
            .select()
            .from(creatorMarketplaceLibraryItems)
            .where(and(
              eq(creatorMarketplaceLibraryItems.userId, userId),
              eq(creatorMarketplaceLibraryItems.publisherId, release.publisherId),
              eq(creatorMarketplaceLibraryItems.packageId, release.packageId),
            ))
            .limit(1)
            .for("update");
          if (existing) {
            const stored = mapLibraryRow(existing);
            assertRawPackageIdentity(stored, release);
            if (
              stored.lastConfirmedReleaseOrdinal === release.releaseOrdinal
              && stored.lastConfirmedReleaseId === release.id
              && stored.lastConfirmedResourceVersion === release.resourceVersion
              && stored.lastConfirmedManifestHash === release.manifestHash
            ) {
              return { row: stored, changed: false };
            }
          }
          throw new CreatorMarketplaceLibraryAcquisitionRejectedError(
            unavailableReason,
          );
        }

        const [inserted] = await transaction
          .insert(creatorMarketplaceLibraryItems)
          .values({
            id: randomUUID(),
            userId,
            packageKeyHash: identity.digest,
            publisherId: release.publisherId,
            packageId: release.packageId,
            kind: release.kind,
            nameSnapshot: release.name,
            addedFromReleaseId: release.id,
            addedFromResourceVersion: release.resourceVersion,
            addedFromReleaseOrdinal: release.releaseOrdinal,
            addedFromManifestHash: release.manifestHash,
            lastConfirmedReleaseId: release.id,
            lastConfirmedResourceVersion: release.resourceVersion,
            lastConfirmedReleaseOrdinal: release.releaseOrdinal,
            lastConfirmedManifestHash: release.manifestHash,
            firstConfirmedAt: sql`statement_timestamp()`,
            lastConfirmedAt: sql`statement_timestamp()`,
          })
          .onConflictDoNothing({
            target: [
              creatorMarketplaceLibraryItems.userId,
              creatorMarketplaceLibraryItems.packageKeyHash,
            ],
          })
          .returning();
        if (inserted) return { row: mapLibraryRow(inserted), changed: true };

        const [existing] = await transaction
          .select()
          .from(creatorMarketplaceLibraryItems)
          .where(and(
            eq(creatorMarketplaceLibraryItems.userId, userId),
            eq(creatorMarketplaceLibraryItems.packageKeyHash, identity.digest),
          ))
          .limit(1)
          .for("update");
        if (!existing) {
          throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
        }
        const stored = mapLibraryRow(existing);
        assertRawPackageIdentity(stored, release);
        if (
          stored.lastConfirmedReleaseOrdinal !== null
          && release.releaseOrdinal < stored.lastConfirmedReleaseOrdinal
        ) {
          return { row: stored, changed: false };
        }
        if (release.releaseOrdinal === stored.lastConfirmedReleaseOrdinal) {
          if (
            stored.lastConfirmedReleaseId !== release.id
            || stored.lastConfirmedResourceVersion !== release.resourceVersion
            || stored.lastConfirmedManifestHash !== release.manifestHash
          ) {
            throw new CreatorMarketplaceLibraryIntegrityError(
              "confirmation-equivocation",
            );
          }
          return { row: stored, changed: false };
        }

        const nextTimestamp = freshTimestamp();
        const [confirmed] = await transaction
          .update(creatorMarketplaceLibraryItems)
          .set({
            lastConfirmedReleaseId: release.id,
            lastConfirmedResourceVersion: release.resourceVersion,
            lastConfirmedReleaseOrdinal: release.releaseOrdinal,
            lastConfirmedManifestHash: release.manifestHash,
            firstConfirmedAt: stored.firstConfirmedAt ?? nextTimestamp,
            lastConfirmedAt: nextTimestamp,
            updatedAt: nextTimestamp,
            // Confirmation is evidence, not an account library preference. Never unarchive here.
          })
          .where(eq(creatorMarketplaceLibraryItems.id, stored.id))
          .returning();
        if (!confirmed) {
          throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
        }
        return { row: mapLibraryRow(confirmed), changed: true };
      });
    } catch (error) {
      return mapCreatorMarketplaceLibraryDatabaseError(error);
    }
  }

  async setArchived(
    userId: string,
    libraryItemId: string,
    archived: boolean,
  ): Promise<CreatorMarketplaceLibraryMutationResult | null> {
    try {
      return await db.transaction(async (transaction) => {
        const [actor] = await transaction
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
          .for("update");
        if (actor?.status !== "active") {
          throw new CreatorMarketplaceLibraryInactiveUserError();
        }
        const [existing] = await transaction
          .select()
          .from(creatorMarketplaceLibraryItems)
          .where(and(
            eq(creatorMarketplaceLibraryItems.id, libraryItemId),
            eq(creatorMarketplaceLibraryItems.userId, userId),
          ))
          .limit(1)
          .for("update");
        if (!existing) return null;
        const stored = mapLibraryRow(existing);
        if (archived === (stored.archivedAt !== null)) {
          return { row: stored, changed: false };
        }
        const nextTimestamp = freshTimestamp();
        const [updated] = await transaction
          .update(creatorMarketplaceLibraryItems)
          .set({
            archivedAt: archived ? nextTimestamp : null,
            updatedAt: nextTimestamp,
          })
          .where(eq(creatorMarketplaceLibraryItems.id, stored.id))
          .returning();
        if (!updated) {
          throw new CreatorMarketplaceLibraryIntegrityError("stored-state-invalid");
        }
        return { row: mapLibraryRow(updated), changed: true };
      });
    } catch (error) {
      return mapCreatorMarketplaceLibraryDatabaseError(error);
    }
  }

  async list(
    input: CreatorMarketplaceLibraryListInput,
  ): Promise<{
    rows: readonly CreatorMarketplaceLibraryStoredRow[];
    catalogHeads: readonly CreatorMarketplaceLibraryCatalogHeadRow[];
  }> {
    try {
      return await db.transaction(async (transaction) => {
        const [actor] = await transaction
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1)
          .for("update");
        if (actor?.status !== "active") {
          throw new CreatorMarketplaceLibraryInactiveUserError();
        }

        const filters: SQL[] = [
          eq(creatorMarketplaceLibraryItems.userId, input.userId),
        ];
        if (input.view === "active") {
          filters.push(isNull(creatorMarketplaceLibraryItems.archivedAt));
        } else if (input.view === "archived") {
          filters.push(isNotNull(creatorMarketplaceLibraryItems.archivedAt));
        }
        if (input.packageKeyHash) {
          filters.push(eq(
            creatorMarketplaceLibraryItems.packageKeyHash,
            input.packageKeyHash,
          ));
        }
        if (input.cursor) {
          filters.push(or(
            lt(creatorMarketplaceLibraryItems.addedAt, input.cursor.addedAt),
            and(
              eq(creatorMarketplaceLibraryItems.addedAt, input.cursor.addedAt),
              lt(creatorMarketplaceLibraryItems.id, input.cursor.id),
            ),
          )!);
        }

        const rawRows = await transaction
          .select()
          .from(creatorMarketplaceLibraryItems)
          .where(and(...filters))
          .orderBy(
            desc(creatorMarketplaceLibraryItems.addedAt),
            desc(creatorMarketplaceLibraryItems.id),
          )
          .limit(input.limit + 1);
        const rows = rawRows.map(mapLibraryRow);
        const packagePairs = rows
          .filter((row) => row.publisherId !== null)
          .map((row) => and(
            eq(creatorMarketplaceResources.publisherId, row.publisherId!),
            eq(creatorMarketplaceResources.packageId, row.packageId),
          )!);
        if (packagePairs.length === 0) return { rows, catalogHeads: [] };

        // Select the absolute package head first, then project its lifecycle. Do not filter hidden
        // or delisted rows here: that would make an older release masquerade as an update head.
        const rawHeads = await transaction
          .selectDistinctOn(
            [
              creatorMarketplaceResources.publisherId,
              creatorMarketplaceResources.packageId,
            ],
            {
              id: creatorMarketplaceResources.id,
              publisherId: creatorMarketplaceResources.publisherId,
              packageId: creatorMarketplaceResources.packageId,
              name: creatorMarketplaceResources.name,
              kind: creatorMarketplaceResources.kind,
              resourceVersion: creatorMarketplaceResources.resourceVersion,
              minimumStudioVersion: creatorMarketplaceResources.minimumStudioVersion,
              releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
              manifestHash: creatorMarketplaceResources.manifestHash,
              hidden: sql<boolean>`${creatorMarketplacePackageModeration.state} = 'hidden'`,
              delistedAt: creatorMarketplaceResources.delistedAt,
              publisherStatus: users.status,
            },
          )
          .from(creatorMarketplaceResources)
          .innerJoin(
            creatorMarketplacePackageModeration,
            and(
              eq(
                creatorMarketplacePackageModeration.publisherId,
                creatorMarketplaceResources.publisherId,
              ),
              eq(
                creatorMarketplacePackageModeration.packageId,
                creatorMarketplaceResources.packageId,
              ),
            ),
          )
          .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
          .where(or(...packagePairs))
          .orderBy(
            creatorMarketplaceResources.publisherId,
            creatorMarketplaceResources.packageId,
            desc(creatorMarketplaceResources.releaseOrdinal),
          );
        const catalogHeads = rawHeads.map((head) => ({
          ...head,
          kind: CreatorMarketplaceResourceKindSchema.parse(head.kind),
        }));
        return { rows, catalogHeads };
      });
    } catch (error) {
      return mapCreatorMarketplaceLibraryDatabaseError(error);
    }
  }
}

export const CREATOR_MARKETPLACE_LIBRARY_REPOSITORY_PROVIDER: Provider = {
  provide: CREATOR_MARKETPLACE_LIBRARY_REPOSITORY,
  useClass: DrizzleCreatorMarketplaceCloudLibraryRepository,
};
