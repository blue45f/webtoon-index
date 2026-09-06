import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  CreatorMarketplacePackageModerationStateSchema,
  CreatorMarketplaceResourceKindSchema,
  CreatorMarketplaceResourceReportEvidenceSchema,
} from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";
import { db, users } from "../../db";
import {
  creatorMarketplacePackageModeration,
  creatorMarketplacePackageModerationDecisions,
} from "../../db/creator-marketplace-package-moderation.schema";
import { creatorMarketplaceResourceReports } from "../../db/creator-marketplace-report.schema";
import { creatorMarketplaceResources } from "../../db/creator-marketplace-resource.schema";

import { admitCreatorMarketplaceRelease } from "./creator-marketplace-release";
import {
  CREATOR_MARKETPLACE_REPORT_GATE_CLEANUP_BATCH_SIZE,
  CREATOR_MARKETPLACE_REPORT_GATE_RETENTION_MS,
  CREATOR_MARKETPLACE_REPORT_LIMIT,
  isCreatorMarketplaceReporterKey,
} from "./creator-marketplace-report-gate";
import {
  CREATOR_MARKETPLACE_RESOURCE_REPOSITORY,
  CreatorMarketplaceOrphanReportDismissRejectedError,
  CreatorMarketplaceModerationRejectedError,
  CreatorMarketplaceResourceDuplicateError,
  CreatorMarketplaceResourceReleaseRejectedError,
  CreatorMarketplaceResourceRelistRejectedError,
  CreatorMarketplaceResourceReportRejectedError,
} from "./creator-marketplace.repository-contract";

import type {
  CreatorMarketplaceLifecycleStoredRow,
  CreatorMarketplaceOrphanReportDismissInput,
  CreatorMarketplaceOrphanReportDismissResult,
  CreatorMarketplaceOwnedHeadListInput,
  CreatorMarketplacePackageHistoryInput,
  CreatorMarketplaceRelistResult,
  CreatorMarketplaceResourceIdentityStoredRow,
  CreatorMarketplaceResourceListInput,
  CreatorMarketplaceModerationInput,
  CreatorMarketplaceModerationListInput,
  CreatorMarketplaceModerationResult,
  CreatorMarketplaceModerationStoredRow,
  CreatorMarketplaceResourcePublishInput,
  CreatorMarketplaceResourceReportInput,
  CreatorMarketplaceResourceReportResult,
  CreatorMarketplaceResourceRepository,
  CreatorMarketplaceResourceStoredRow,
} from "./creator-marketplace.repository-contract";
import type { Provider } from "@nestjs/common";
import type { SQL } from "drizzle-orm";

const newerCreatorMarketplaceRelease = alias(
  creatorMarketplaceResources,
  "newer_creator_marketplace_release"
);
const absoluteCreatorMarketplaceHead = alias(
  creatorMarketplaceResources,
  "absolute_creator_marketplace_head"
);
const creatorMarketplaceReporters = alias(users, "creator_marketplace_reporter");
const creatorMarketplacePublishers = alias(users, "creator_marketplace_publisher");
const CREATOR_MARKETPLACE_RELEASE_LOCK_NAMESPACE =
  "toonspectrum:creator-marketplace-release:v1:";
const CREATOR_MARKETPLACE_ORPHAN_DISMISS_LOCK_NAMESPACE =
  "toonspectrum:creator-marketplace:orphan-dismiss:v1:";

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function relevanceScoreExpression(search: string): SQL<number> {
  const escaped = escapeLikePattern(search);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;
  return sql<number>`(
    case when lower(${creatorMarketplaceResources.name}) = lower(${search}) then 1200 else 0 end
    + case when lower(${creatorMarketplaceResources.packageId}) = lower(${search}) then 1000 else 0 end
    + case when exists (
        select 1
        from jsonb_array_elements_text(${creatorMarketplaceResources.tags}) as market_tag(value)
        where lower(market_tag.value) = lower(${search})
      ) then 800 else 0 end
    + case when lower(${creatorMarketplaceResources.name}) like lower(${prefixPattern}) escape '\\' then 600 else 0 end
    + case when lower(${creatorMarketplaceResources.packageId}) like lower(${prefixPattern}) escape '\\' then 500 else 0 end
    + case when lower(${creatorMarketplaceResources.name}) like lower(${containsPattern}) escape '\\' then 400 else 0 end
    + case when lower(${creatorMarketplaceResources.packageId}) like lower(${containsPattern}) escape '\\' then 300 else 0 end
    + case when lower(${creatorMarketplaceResources.description}) like lower(${containsPattern}) escape '\\' then 160 else 0 end
    + case when lower(${creatorMarketplaceResources.tags}::text) like lower(${containsPattern}) escape '\\' then 80 else 0 end
  )`;
}

function newestCursorBoundary(createdAt: Date, id: string): SQL {
  return or(
    lt(creatorMarketplaceResources.createdAt, createdAt),
    and(
      eq(creatorMarketplaceResources.createdAt, createdAt),
      lt(creatorMarketplaceResources.id, id)
    )
  )!;
}

function absolutePackageHeadIsListed(): SQL {
  return sql<boolean>`coalesce((
    select ${absoluteCreatorMarketplaceHead.delistedAt} is null
    from ${creatorMarketplaceResources} as ${sql.identifier("absolute_creator_marketplace_head")}
    where ${absoluteCreatorMarketplaceHead.publisherId}
      = ${creatorMarketplaceResources.publisherId}
      and ${absoluteCreatorMarketplaceHead.packageId}
        = ${creatorMarketplaceResources.packageId}
    order by ${absoluteCreatorMarketplaceHead.releaseOrdinal} desc
    limit 1
  ), false)`;
}

function mapStoredRow(row: {
  id: string;
  publisherId: string;
  publisherName: string | null;
  publisherAvatar: string | null;
  manifest: CreatorMarketplaceResourceStoredRow["manifest"];
  manifestHash: string;
  manifestByteSize: number;
  createdAt: Date;
  updatedAt: Date;
  relevanceScore?: number;
}): CreatorMarketplaceResourceStoredRow {
  return row;
}

function mapLifecycleStoredRow(row: {
  id: string;
  publisherId: string;
  publisherName: string | null;
  publisherAvatar: string | null;
  manifest: CreatorMarketplaceResourceStoredRow["manifest"];
  manifestHash: string;
  manifestByteSize: number;
  releaseOrdinal: number;
  delistedAt: Date | null;
  packageState: string;
  packageRevision: number;
  packageHiddenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  relevanceScore?: number;
}): CreatorMarketplaceLifecycleStoredRow {
  if (row.packageState !== "active" && row.packageState !== "hidden") {
    throw new Error("creator_marketplace_package_moderation_state_invalid");
  }
  return {
    ...row,
    packageState: row.packageState,
    // Kept only for older owned/admin consumers; package state is the sole authority.
    hidden: row.packageState === "hidden",
  };
}

function creatorMarketplaceReleaseLockKey(
  publisherId: string,
  packageId: string
): string {
  return `${CREATOR_MARKETPLACE_RELEASE_LOCK_NAMESPACE}`
    + `${publisherId.length}:${publisherId}`
    + `${packageId.length}:${packageId}`;
}

export class DrizzleCreatorMarketplaceResourceRepository
  implements CreatorMarketplaceResourceRepository
{
  async list(
    input: CreatorMarketplaceResourceListInput
  ): Promise<readonly CreatorMarketplaceResourceStoredRow[]> {
    if (input.sort === "relevance" && !input.search) {
      throw new Error("creator_marketplace_relevance_requires_search");
    }
    if (input.cursor && input.cursor.sort !== input.sort) {
      throw new Error("creator_marketplace_cursor_sort_mismatch");
    }
    const relevanceScore = input.sort === "relevance"
      ? relevanceScoreExpression(input.search!)
      : sql<number>`0`;
    const filters: SQL[] = [
      eq(creatorMarketplacePackageModeration.state, "active"),
      eq(users.status, "active"),
      isNull(creatorMarketplaceResources.delistedAt),
      notExists(
        db
          .select({ id: newerCreatorMarketplaceRelease.id })
          .from(newerCreatorMarketplaceRelease)
          .where(and(
            eq(
              newerCreatorMarketplaceRelease.publisherId,
              creatorMarketplaceResources.publisherId
            ),
            eq(
              newerCreatorMarketplaceRelease.packageId,
              creatorMarketplaceResources.packageId
            ),
            gt(
              newerCreatorMarketplaceRelease.releaseOrdinal,
              creatorMarketplaceResources.releaseOrdinal
            )
          ))
      ),
    ];
    if (input.publisherId) {
      filters.push(eq(creatorMarketplaceResources.publisherId, input.publisherId));
    }
    if (input.kind) filters.push(eq(creatorMarketplaceResources.kind, input.kind));
    if (input.license) filters.push(eq(creatorMarketplaceResources.license, input.license));
    if (input.tag) {
      filters.push(
        sql`${creatorMarketplaceResources.tags} @> ${JSON.stringify([input.tag])}::jsonb`
      );
    }
    if (input.search) {
      const pattern = `%${escapeLikePattern(input.search)}%`;
      filters.push(
        // This expression intentionally mirrors the lower-cased generated searchText column in
        // migration 0022. pg_trgm keeps partial, Korean, tag, and package-id searches indexable.
        sql`${creatorMarketplaceResources.searchText} LIKE lower(${pattern}) ESCAPE '\\'`
      );
    }
    if (input.cursor) {
      const newestBoundary = newestCursorBoundary(input.cursor.createdAt, input.cursor.id);
      filters.push(input.cursor.sort === "relevance"
        ? or(
            lt(relevanceScore, input.cursor.relevanceScore),
            and(
              eq(relevanceScore, input.cursor.relevanceScore),
              newestBoundary
            )
          )!
        : newestBoundary);
    }

    const orderBy = input.sort === "relevance"
      ? [
          desc(relevanceScore),
          desc(creatorMarketplaceResources.createdAt),
          desc(creatorMarketplaceResources.id),
        ]
      : [
          desc(creatorMarketplaceResources.createdAt),
          desc(creatorMarketplaceResources.id),
        ];

    const rows = await db
      .select({
        id: creatorMarketplaceResources.id,
        publisherId: creatorMarketplaceResources.publisherId,
        publisherName: users.name,
        publisherAvatar: users.avatar,
        manifest: creatorMarketplaceResources.manifest,
        manifestHash: creatorMarketplaceResources.manifestHash,
        manifestByteSize: creatorMarketplaceResources.manifestByteSize,
        createdAt: creatorMarketplaceResources.createdAt,
        updatedAt: creatorMarketplaceResources.updatedAt,
        relevanceScore,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId
          )
        )
      )
      .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(input.limit + 1);

    return rows.map(mapStoredRow);
  }

  async listOwnedHeads(
    input: CreatorMarketplaceOwnedHeadListInput
  ): Promise<readonly CreatorMarketplaceLifecycleStoredRow[]> {
    if (input.sort === "relevance" && !input.search) {
      throw new Error("creator_marketplace_relevance_requires_search");
    }
    if (input.cursor && input.cursor.sort !== input.sort) {
      throw new Error("creator_marketplace_cursor_sort_mismatch");
    }
    const relevanceScore = input.sort === "relevance"
      ? relevanceScoreExpression(input.search!)
      : sql<number>`0`;
    const filters: SQL[] = [
      eq(creatorMarketplaceResources.publisherId, input.publisherId),
      // Lifecycle state never causes an older release to masquerade as the package head.
      notExists(
        db
          .select({ id: newerCreatorMarketplaceRelease.id })
          .from(newerCreatorMarketplaceRelease)
          .where(and(
            eq(
              newerCreatorMarketplaceRelease.publisherId,
              creatorMarketplaceResources.publisherId
            ),
            eq(
              newerCreatorMarketplaceRelease.packageId,
              creatorMarketplaceResources.packageId
            ),
            gt(
              newerCreatorMarketplaceRelease.releaseOrdinal,
              creatorMarketplaceResources.releaseOrdinal
            )
          ))
      ),
    ];
    if (input.kind) filters.push(eq(creatorMarketplaceResources.kind, input.kind));
    if (input.license) {
      filters.push(eq(creatorMarketplaceResources.license, input.license));
    }
    if (input.tag) {
      filters.push(
        sql`${creatorMarketplaceResources.tags} @> ${JSON.stringify([input.tag])}::jsonb`
      );
    }
    if (input.search) {
      const pattern = `%${escapeLikePattern(input.search)}%`;
      filters.push(
        sql`${creatorMarketplaceResources.searchText} LIKE lower(${pattern}) ESCAPE '\\'`
      );
    }
    if (input.cursor) {
      const newestBoundary = newestCursorBoundary(input.cursor.createdAt, input.cursor.id);
      filters.push(input.cursor.sort === "relevance"
        ? or(
            lt(relevanceScore, input.cursor.relevanceScore),
            and(
              eq(relevanceScore, input.cursor.relevanceScore),
              newestBoundary
            )
          )!
        : newestBoundary);
    }

    const orderBy = input.sort === "relevance"
      ? [
          desc(relevanceScore),
          desc(creatorMarketplaceResources.createdAt),
          desc(creatorMarketplaceResources.id),
        ]
      : [
          desc(creatorMarketplaceResources.createdAt),
          desc(creatorMarketplaceResources.id),
        ];

    const rows = await db
      .select({
        id: creatorMarketplaceResources.id,
        publisherId: creatorMarketplaceResources.publisherId,
        publisherName: users.name,
        publisherAvatar: users.avatar,
        manifest: creatorMarketplaceResources.manifest,
        manifestHash: creatorMarketplaceResources.manifestHash,
        manifestByteSize: creatorMarketplaceResources.manifestByteSize,
        releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
        delistedAt: creatorMarketplaceResources.delistedAt,
        packageState: creatorMarketplacePackageModeration.state,
        packageRevision: creatorMarketplacePackageModeration.revision,
        packageHiddenAt: creatorMarketplacePackageModeration.hiddenAt,
        createdAt: creatorMarketplaceResources.createdAt,
        updatedAt: creatorMarketplaceResources.updatedAt,
        relevanceScore,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId
          )
        )
      )
      .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(input.limit + 1);

    return rows.map(mapLifecycleStoredRow);
  }

  async findHistoryAnchor(
    id: string
  ): Promise<CreatorMarketplaceLifecycleStoredRow | null> {
    const [row] = await db
      .select({
        id: creatorMarketplaceResources.id,
        publisherId: creatorMarketplaceResources.publisherId,
        publisherName: users.name,
        publisherAvatar: users.avatar,
        manifest: creatorMarketplaceResources.manifest,
        manifestHash: creatorMarketplaceResources.manifestHash,
        manifestByteSize: creatorMarketplaceResources.manifestByteSize,
        releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
        delistedAt: creatorMarketplaceResources.delistedAt,
        packageState: creatorMarketplacePackageModeration.state,
        packageRevision: creatorMarketplacePackageModeration.revision,
        packageHiddenAt: creatorMarketplacePackageModeration.hiddenAt,
        createdAt: creatorMarketplaceResources.createdAt,
        updatedAt: creatorMarketplaceResources.updatedAt,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId
          )
        )
      )
      .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
      .where(and(
        eq(creatorMarketplaceResources.id, id),
        eq(creatorMarketplacePackageModeration.state, "active"),
        eq(users.status, "active"),
        absolutePackageHeadIsListed()
      ))
      .limit(1);
    return row ? mapLifecycleStoredRow(row) : null;
  }

  async listPublicHistory(
    input: CreatorMarketplacePackageHistoryInput
  ): Promise<readonly CreatorMarketplaceLifecycleStoredRow[]> {
    const filters = [
      eq(creatorMarketplaceResources.publisherId, input.publisherId),
      eq(creatorMarketplaceResources.packageId, input.packageId),
      eq(creatorMarketplacePackageModeration.state, "active"),
      eq(users.status, "active"),
      isNull(creatorMarketplaceResources.delistedAt),
      absolutePackageHeadIsListed(),
    ];
    if (input.cursor !== null) {
      filters.push(lt(creatorMarketplaceResources.releaseOrdinal, input.cursor));
    }
    const rows = await db
      .select({
        id: creatorMarketplaceResources.id,
        publisherId: creatorMarketplaceResources.publisherId,
        publisherName: users.name,
        publisherAvatar: users.avatar,
        manifest: creatorMarketplaceResources.manifest,
        manifestHash: creatorMarketplaceResources.manifestHash,
        manifestByteSize: creatorMarketplaceResources.manifestByteSize,
        releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
        delistedAt: creatorMarketplaceResources.delistedAt,
        packageState: creatorMarketplacePackageModeration.state,
        packageRevision: creatorMarketplacePackageModeration.revision,
        packageHiddenAt: creatorMarketplacePackageModeration.hiddenAt,
        createdAt: creatorMarketplaceResources.createdAt,
        updatedAt: creatorMarketplaceResources.updatedAt,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId
          )
        )
      )
      .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
      .where(and(...filters))
      .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
      .limit(input.limit + 1);
    return rows.map(mapLifecycleStoredRow);
  }

  async findOwnedPackageHead(
    publisherId: string,
    packageId: string
  ): Promise<CreatorMarketplaceLifecycleStoredRow | null> {
    const [row] = await db
      .select({
        id: creatorMarketplaceResources.id,
        publisherId: creatorMarketplaceResources.publisherId,
        publisherName: users.name,
        publisherAvatar: users.avatar,
        manifest: creatorMarketplaceResources.manifest,
        manifestHash: creatorMarketplaceResources.manifestHash,
        manifestByteSize: creatorMarketplaceResources.manifestByteSize,
        releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
        delistedAt: creatorMarketplaceResources.delistedAt,
        packageState: creatorMarketplacePackageModeration.state,
        packageRevision: creatorMarketplacePackageModeration.revision,
        packageHiddenAt: creatorMarketplacePackageModeration.hiddenAt,
        createdAt: creatorMarketplaceResources.createdAt,
        updatedAt: creatorMarketplaceResources.updatedAt,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId
          )
        )
      )
      .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
      .where(and(
        eq(creatorMarketplaceResources.publisherId, publisherId),
        eq(creatorMarketplaceResources.packageId, packageId)
      ))
      .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
      .limit(1);
    return row ? mapLifecycleStoredRow(row) : null;
  }

  async listOwnedPackageHistory(
    input: CreatorMarketplacePackageHistoryInput
  ): Promise<readonly CreatorMarketplaceLifecycleStoredRow[]> {
    const filters = [
      eq(creatorMarketplaceResources.publisherId, input.publisherId),
      eq(creatorMarketplaceResources.packageId, input.packageId),
    ];
    if (input.cursor !== null) {
      filters.push(lt(creatorMarketplaceResources.releaseOrdinal, input.cursor));
    }
    const rows = await db
      .select({
        id: creatorMarketplaceResources.id,
        publisherId: creatorMarketplaceResources.publisherId,
        publisherName: users.name,
        publisherAvatar: users.avatar,
        manifest: creatorMarketplaceResources.manifest,
        manifestHash: creatorMarketplaceResources.manifestHash,
        manifestByteSize: creatorMarketplaceResources.manifestByteSize,
        releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
        delistedAt: creatorMarketplaceResources.delistedAt,
        packageState: creatorMarketplacePackageModeration.state,
        packageRevision: creatorMarketplacePackageModeration.revision,
        packageHiddenAt: creatorMarketplacePackageModeration.hiddenAt,
        createdAt: creatorMarketplaceResources.createdAt,
        updatedAt: creatorMarketplaceResources.updatedAt,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId
          )
        )
      )
      .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
      .where(and(...filters))
      .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
      .limit(input.limit + 1);
    return rows.map(mapLifecycleStoredRow);
  }

  async findById(id: string): Promise<CreatorMarketplaceResourceStoredRow | null> {
    const [row] = await db
      .select({
        id: creatorMarketplaceResources.id,
        publisherId: creatorMarketplaceResources.publisherId,
        publisherName: users.name,
        publisherAvatar: users.avatar,
        manifest: creatorMarketplaceResources.manifest,
        manifestHash: creatorMarketplaceResources.manifestHash,
        manifestByteSize: creatorMarketplaceResources.manifestByteSize,
        createdAt: creatorMarketplaceResources.createdAt,
        updatedAt: creatorMarketplaceResources.updatedAt,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId
          )
        )
      )
      .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
      .where(
        and(
          eq(creatorMarketplaceResources.id, id),
          eq(creatorMarketplacePackageModeration.state, "active"),
          eq(users.status, "active"),
          isNull(creatorMarketplaceResources.delistedAt),
          absolutePackageHeadIsListed()
        )
      )
      .limit(1);
    return row ? mapStoredRow(row) : null;
  }

  async findIdentityById(
    id: string
  ): Promise<CreatorMarketplaceResourceIdentityStoredRow | null> {
    // Deliberately select only identity and coarse availability metadata. All existing visibility
    // states take the same single-query path, so this boundary exposes no manifests, rights,
    // notes, versions, or raw account/profile state and has no distinct hidden/delisted error.
    const [row] = await db
      .select({
        id: creatorMarketplaceResources.id,
        publisherId: creatorMarketplaceResources.publisherId,
        packageId: creatorMarketplaceResources.packageId,
        kind: creatorMarketplaceResources.kind,
        releaseDelistedAt: creatorMarketplaceResources.delistedAt,
        currentHeadDelistedAt: sql<Date | null>`(
          select ${absoluteCreatorMarketplaceHead.delistedAt}
          from ${creatorMarketplaceResources} as ${sql.identifier("absolute_creator_marketplace_head")}
          where ${absoluteCreatorMarketplaceHead.publisherId}
            = ${creatorMarketplaceResources.publisherId}
            and ${absoluteCreatorMarketplaceHead.packageId}
              = ${creatorMarketplaceResources.packageId}
          order by ${absoluteCreatorMarketplaceHead.releaseOrdinal} desc
          limit 1
        )`,
        packageState: creatorMarketplacePackageModeration.state,
        publisherStatus: users.status,
      })
      .from(creatorMarketplaceResources)
      .innerJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplaceResources.publisherId
          ),
          eq(
            creatorMarketplacePackageModeration.packageId,
            creatorMarketplaceResources.packageId
          )
        )
      )
      .leftJoin(users, eq(creatorMarketplaceResources.publisherId, users.id))
      .where(eq(creatorMarketplaceResources.id, id))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      kind: CreatorMarketplaceResourceKindSchema.parse(row.kind),
      packageState: CreatorMarketplacePackageModerationStateSchema.parse(
        row.packageState
      ),
    };
  }

  async publish(
    input: CreatorMarketplaceResourcePublishInput
  ): Promise<CreatorMarketplaceResourceStoredRow> {
    return db.transaction(async (transaction) => {
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${creatorMarketplaceReleaseLockKey(
            input.publisherId,
            input.manifest.packageId
          )}, 0)
        )
      `);

      await transaction
        .insert(creatorMarketplacePackageModeration)
        .values({
          publisherId: input.publisherId,
          packageId: input.manifest.packageId,
          state: "active",
          revision: 0,
        })
        .onConflictDoNothing({
          target: [
            creatorMarketplacePackageModeration.publisherId,
            creatorMarketplacePackageModeration.packageId,
          ],
        });

      const [moderation] = await transaction
        .select({ state: creatorMarketplacePackageModeration.state })
        .from(creatorMarketplacePackageModeration)
        .where(and(
          eq(creatorMarketplacePackageModeration.publisherId, input.publisherId),
          eq(
            creatorMarketplacePackageModeration.packageId,
            input.manifest.packageId
          )
        ))
        .limit(1)
        .for("update");

      const [latest] = await transaction
        .select({
          resourceVersion: creatorMarketplaceResources.resourceVersion,
          releaseOrdinal: creatorMarketplaceResources.releaseOrdinal,
        })
        .from(creatorMarketplaceResources)
        .where(and(
          eq(creatorMarketplaceResources.publisherId, input.publisherId),
          eq(creatorMarketplaceResources.packageId, input.manifest.packageId)
        ))
        .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
        .limit(1);
      if (!moderation || moderation.state !== "active") {
        throw new CreatorMarketplaceResourceReleaseRejectedError(
          "moderated",
          latest?.resourceVersion ?? input.manifest.resourceVersion,
        );
      }
      const admission = admitCreatorMarketplaceRelease(
        input.manifest.resourceVersion,
        latest ?? null,
      );
      if (admission.status === "rejected") {
        throw new CreatorMarketplaceResourceReleaseRejectedError(
          admission.reason,
          admission.latestVersion,
        );
      }

      const [inserted] = await transaction
        .insert(creatorMarketplaceResources)
        .values({
          id: input.id,
          publisherId: input.publisherId,
          packageId: input.manifest.packageId,
          name: input.manifest.name,
          description: input.manifest.description,
          tags: input.manifest.tags,
          kind: input.manifest.kind,
          resourceVersion: input.manifest.resourceVersion,
          releaseOrdinal: admission.releaseOrdinal,
          minimumStudioVersion: input.manifest.minimumStudioVersion,
          license: input.manifest.license,
          provenanceOrigin: input.manifest.provenance.origin,
          manifest: input.manifest,
          manifestHash: input.manifestHash,
          manifestByteSize: input.manifestByteSize,
        })
        .onConflictDoNothing()
        .returning({
          id: creatorMarketplaceResources.id,
          publisherId: creatorMarketplaceResources.publisherId,
          manifest: creatorMarketplaceResources.manifest,
          manifestHash: creatorMarketplaceResources.manifestHash,
          manifestByteSize: creatorMarketplaceResources.manifestByteSize,
          createdAt: creatorMarketplaceResources.createdAt,
          updatedAt: creatorMarketplaceResources.updatedAt,
        });
      if (!inserted) throw new CreatorMarketplaceResourceDuplicateError();

      const [publisher] = await transaction
        .select({ name: users.name, avatar: users.avatar })
        .from(users)
        .where(and(eq(users.id, input.publisherId), isNotNull(users.id)))
        .limit(1);

      return mapStoredRow({
        ...inserted,
        publisherName: publisher?.name ?? null,
        publisherAvatar: publisher?.avatar ?? null,
      });
    });
  }

  async report(
    input: CreatorMarketplaceResourceReportInput
  ): Promise<CreatorMarketplaceResourceReportResult> {
    if (!isCreatorMarketplaceReporterKey(input.reporterKeyHash)) {
      throw new TypeError("Creator marketplace reporter key must be a SHA-256 digest.");
    }
    return db.transaction(async (transaction) => {
      const [observed] = await transaction
        .select({
          publisherId: creatorMarketplaceResources.publisherId,
          packageId: creatorMarketplaceResources.packageId,
        })
        .from(creatorMarketplaceResources)
        .where(eq(creatorMarketplaceResources.id, input.resourceId))
        .limit(1);
      if (!observed) {
        throw new CreatorMarketplaceResourceReportRejectedError("not-found");
      }

      // Reporting, publication, owner lifecycle, and moderation all acquire this package lock
      // before state/row locks. Re-read the anchor after locking so a stale observation cannot
      // cross package identity or visibility boundaries.
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${creatorMarketplaceReleaseLockKey(
            observed.publisherId,
            observed.packageId
          )}, 0)
        )
      `);
      const [moderation] = await transaction
        .select({
          state: creatorMarketplacePackageModeration.state,
          revision: creatorMarketplacePackageModeration.revision,
        })
        .from(creatorMarketplacePackageModeration)
        .where(and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            observed.publisherId
          ),
          eq(creatorMarketplacePackageModeration.packageId, observed.packageId)
        ))
        .limit(1)
        .for("update");
      const [resource] = await transaction
        .select({
          id: creatorMarketplaceResources.id,
          publisherId: creatorMarketplaceResources.publisherId,
          packageId: creatorMarketplaceResources.packageId,
          name: creatorMarketplaceResources.name,
          kind: creatorMarketplaceResources.kind,
          resourceVersion: creatorMarketplaceResources.resourceVersion,
          license: creatorMarketplaceResources.license,
          manifestHash: creatorMarketplaceResources.manifestHash,
          manifestByteSize: creatorMarketplaceResources.manifestByteSize,
          createdAt: creatorMarketplaceResources.createdAt,
        })
        .from(creatorMarketplaceResources)
        .where(eq(creatorMarketplaceResources.id, input.resourceId))
        .limit(1)
        .for("update");
      if (
        !resource
        || resource.publisherId !== observed.publisherId
        || resource.packageId !== observed.packageId
        || !moderation
        || moderation.state !== "active"
      ) {
        throw new CreatorMarketplaceResourceReportRejectedError("not-found");
      }
      const [currentHead] = await transaction
        .select({ reportEpoch: creatorMarketplaceResources.releaseOrdinal })
        .from(creatorMarketplaceResources)
        .where(and(
          eq(creatorMarketplaceResources.publisherId, observed.publisherId),
          eq(creatorMarketplaceResources.packageId, observed.packageId)
        ))
        .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
        .limit(1)
        .for("update");
      if (!currentHead) {
        throw new CreatorMarketplaceResourceReportRejectedError("not-found");
      }
      if (resource.publisherId === input.reporterId) {
        throw new CreatorMarketplaceResourceReportRejectedError("self-report");
      }

      const reporterKeyHash = Buffer.from(input.reporterKeyHash);
      const admission = await transaction.execute<{ requestCount: number }>(sql`
        WITH "expiredGateKeys" AS MATERIALIZED (
          SELECT "keyHash"
          FROM "creator_marketplace_resource_report_gate"
          WHERE "expiresAt" <= clock_timestamp()
            AND "keyHash" <> ${reporterKeyHash}::bytea
          ORDER BY "expiresAt"
          LIMIT ${CREATOR_MARKETPLACE_REPORT_GATE_CLEANUP_BATCH_SIZE}::integer
          FOR UPDATE SKIP LOCKED
        ),
        "deletedExpiredGates" AS (
          DELETE FROM "creator_marketplace_resource_report_gate" AS "expiredGate"
          USING "expiredGateKeys"
          WHERE "expiredGate"."keyHash" = "expiredGateKeys"."keyHash"
          RETURNING 1
        ),
        "gateClock" AS MATERIALIZED (
          SELECT
            "capturedClock"."now",
            date_bin(
              interval '1 day',
              "capturedClock"."now",
              timestamptz '1970-01-01 00:00:00+00'
            ) AS "windowStartedAt"
          FROM (SELECT clock_timestamp() AS "now") AS "capturedClock"
        ),
        "admitted" AS (
          INSERT INTO "creator_marketplace_resource_report_gate" (
            "keyHash",
            "windowStartedAt",
            "requestCount",
            "expiresAt",
            "createdAt",
            "updatedAt"
          )
          SELECT
            ${reporterKeyHash}::bytea,
            "gateClock"."windowStartedAt",
            1,
            "gateClock"."windowStartedAt"
              + (${CREATOR_MARKETPLACE_REPORT_GATE_RETENTION_MS}::integer * interval '1 millisecond'),
            "gateClock"."now",
            "gateClock"."now"
          FROM "gateClock"
          ON CONFLICT ("keyHash") DO UPDATE SET
            "windowStartedAt" = CASE
              WHEN "creator_marketplace_resource_report_gate"."windowStartedAt"
                < EXCLUDED."windowStartedAt"
                THEN EXCLUDED."windowStartedAt"
              ELSE "creator_marketplace_resource_report_gate"."windowStartedAt"
            END,
            "requestCount" = CASE
              WHEN "creator_marketplace_resource_report_gate"."windowStartedAt"
                < EXCLUDED."windowStartedAt"
                THEN 1
              ELSE "creator_marketplace_resource_report_gate"."requestCount" + 1
            END,
            "expiresAt" = EXCLUDED."expiresAt",
            "updatedAt" = EXCLUDED."updatedAt"
          WHERE
            "creator_marketplace_resource_report_gate"."windowStartedAt"
              < EXCLUDED."windowStartedAt"
            OR "creator_marketplace_resource_report_gate"."requestCount"
              < ${CREATOR_MARKETPLACE_REPORT_LIMIT}::integer
          RETURNING "requestCount"
        )
        SELECT
          "admitted"."requestCount",
          (SELECT count(*) FROM "deletedExpiredGates") AS "cleanupCount"
        FROM "admitted"
      `);
      if (admission.rows.length !== 1) {
        throw new CreatorMarketplaceResourceReportRejectedError("rate-limited");
      }

      const evidence = CreatorMarketplaceResourceReportEvidenceSchema.parse({
        schemaVersion: 3,
        resourceId: resource.id,
        publisherId: resource.publisherId,
        packageId: resource.packageId,
        packageModerationRevision: moderation.revision,
        packageReportEpoch: currentHead.reportEpoch,
        name: resource.name,
        kind: resource.kind,
        resourceVersion: resource.resourceVersion,
        license: resource.license,
        manifestHash: resource.manifestHash,
        manifestByteSize: resource.manifestByteSize,
        releaseCreatedAt: resource.createdAt.toISOString(),
      });
      const [inserted] = await transaction
        .insert(creatorMarketplaceResourceReports)
        .values({
          id: input.id,
          resourceId: resource.id,
          resourceSnapshotId: resource.id,
          packagePublisherIdSnapshot: resource.publisherId,
          packageIdSnapshot: resource.packageId,
          packageModerationRevision: moderation.revision,
          packageReportEpoch: currentHead.reportEpoch,
          reporterId: input.reporterId,
          reporterKeyHash: input.reporterKeyHash,
          reason: input.reason,
          details: input.details,
          evidence,
        })
        .onConflictDoNothing()
        .returning({
          reportId: creatorMarketplaceResourceReports.id,
          createdAt: creatorMarketplaceResourceReports.createdAt,
        });
      if (!inserted) {
        // Throwing also rolls back the gate increment, so duplicate attempts do not consume the
        // reporter's bounded daily allowance.
        throw new CreatorMarketplaceResourceReportRejectedError("duplicate");
      }
      return inserted;
    });
  }

  async listModeration(
    input: CreatorMarketplaceModerationListInput
  ): Promise<readonly CreatorMarketplaceModerationStoredRow[]> {
    const rows = await db
      .select({
        reportId: creatorMarketplaceResourceReports.id,
        reason: creatorMarketplaceResourceReports.reason,
        details: creatorMarketplaceResourceReports.details,
        status: creatorMarketplaceResourceReports.status,
        resolutionNote: creatorMarketplaceResourceReports.resolutionNote,
        reporterId: creatorMarketplaceResourceReports.reporterId,
        reporterName: creatorMarketplaceReporters.name,
        reviewedBy: creatorMarketplaceResourceReports.reviewedBy,
        reviewedAt: creatorMarketplaceResourceReports.reviewedAt,
        createdAt: creatorMarketplaceResourceReports.createdAt,
        evidence: creatorMarketplaceResourceReports.evidence,
        packagePublisherIdSnapshot:
          creatorMarketplaceResourceReports.packagePublisherIdSnapshot,
        packageIdSnapshot: creatorMarketplaceResourceReports.packageIdSnapshot,
        packageModerationRevision:
          creatorMarketplaceResourceReports.packageModerationRevision,
        packageReportEpoch: creatorMarketplaceResourceReports.packageReportEpoch,
        currentResourceId: creatorMarketplaceResources.id,
        currentResourceDelistedAt: creatorMarketplaceResources.delistedAt,
        currentPackagePublisherId: creatorMarketplacePackageModeration.publisherId,
        currentPackageId: creatorMarketplacePackageModeration.packageId,
        currentPackageState: creatorMarketplacePackageModeration.state,
        currentPackageRevision: creatorMarketplacePackageModeration.revision,
        currentPackageHiddenAt: creatorMarketplacePackageModeration.hiddenAt,
        currentPackageHeadId: sql<string | null>`(
          select "moderationHead"."id"
          from "creator_marketplace_resource" as "moderationHead"
          where "moderationHead"."publisherId" =
            ${creatorMarketplaceResourceReports.packagePublisherIdSnapshot}
            and "moderationHead"."packageId" =
              ${creatorMarketplaceResourceReports.packageIdSnapshot}
          order by "moderationHead"."releaseOrdinal" desc
          limit 1
        )`,
        currentPackageHeadDelistedAt: sql<Date | null>`(
          select "moderationHead"."delistedAt"
          from "creator_marketplace_resource" as "moderationHead"
          where "moderationHead"."publisherId" =
            ${creatorMarketplaceResourceReports.packagePublisherIdSnapshot}
            and "moderationHead"."packageId" =
              ${creatorMarketplaceResourceReports.packageIdSnapshot}
          order by "moderationHead"."releaseOrdinal" desc
          limit 1
        )`,
        currentPackagePublisherStatus: creatorMarketplacePublishers.status,
      })
      .from(creatorMarketplaceResourceReports)
      .leftJoin(
        creatorMarketplaceResources,
        eq(
          creatorMarketplaceResourceReports.resourceId,
          creatorMarketplaceResources.id
        )
      )
      .leftJoin(
        creatorMarketplacePackageModeration,
        and(
          eq(
            creatorMarketplaceResourceReports.packagePublisherIdSnapshot,
            creatorMarketplacePackageModeration.publisherId
          ),
          eq(
            creatorMarketplaceResourceReports.packageIdSnapshot,
            creatorMarketplacePackageModeration.packageId
          )
        )
      )
      .leftJoin(
        creatorMarketplaceReporters,
        eq(creatorMarketplaceResourceReports.reporterId, creatorMarketplaceReporters.id)
      )
      .leftJoin(
        creatorMarketplacePublishers,
        eq(
          creatorMarketplaceResourceReports.packagePublisherIdSnapshot,
          creatorMarketplacePublishers.id
        )
      )
      .where(eq(creatorMarketplaceResourceReports.status, input.status))
      .orderBy(
        desc(creatorMarketplaceResourceReports.createdAt),
        desc(creatorMarketplaceResourceReports.id)
      )
      .limit(input.limit + 1)
      .offset(input.offset);
    return rows.map((row) => ({
      ...row,
      reason: row.reason as CreatorMarketplaceModerationStoredRow["reason"],
      status: row.status as CreatorMarketplaceModerationStoredRow["status"],
      currentPackageState:
        row.currentPackageState as CreatorMarketplaceModerationStoredRow["currentPackageState"],
      currentResourceHidden: row.currentResourceId
        ? row.currentPackageState === "hidden"
        : null,
    }));
  }

  async moderate(
    input: CreatorMarketplaceModerationInput
  ): Promise<CreatorMarketplaceModerationResult | null> {
    return db.transaction(async (transaction) => {
      const [observed] = await transaction
        .select({
          publisherId: creatorMarketplaceResources.publisherId,
          packageId: creatorMarketplaceResources.packageId,
        })
        .from(creatorMarketplaceResources)
        .where(eq(creatorMarketplaceResources.id, input.resourceId))
        .limit(1);
      if (!observed) return null;

      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${creatorMarketplaceReleaseLockKey(
            observed.publisherId,
            observed.packageId
          )}, 0)
        )
      `);

      const [moderation] = await transaction
        .select({
          state: creatorMarketplacePackageModeration.state,
          revision: creatorMarketplacePackageModeration.revision,
          hiddenAt: creatorMarketplacePackageModeration.hiddenAt,
        })
        .from(creatorMarketplacePackageModeration)
        .where(and(
          eq(
            creatorMarketplacePackageModeration.publisherId,
            observed.publisherId
          ),
          eq(creatorMarketplacePackageModeration.packageId, observed.packageId)
        ))
        .limit(1)
        .for("update");
      if (!moderation) return null;

      const [resource] = await transaction
        .select({
          id: creatorMarketplaceResources.id,
          publisherId: creatorMarketplaceResources.publisherId,
          packageId: creatorMarketplaceResources.packageId,
          delistedAt: creatorMarketplaceResources.delistedAt,
        })
        .from(creatorMarketplaceResources)
        .where(eq(creatorMarketplaceResources.id, input.resourceId))
        .limit(1)
        .for("update");
      if (
        !resource
        || resource.publisherId !== observed.publisherId
        || resource.packageId !== observed.packageId
      ) return null;

      // The route UUID is an audit anchor and can refer to any immutable release. Operator-facing
      // lifecycle state must come from the absolute package head, otherwise a report on an older
      // delisted/listed release can misstate whether the package is currently owner-delisted.
      const [currentHead] = await transaction
        .select({ delistedAt: creatorMarketplaceResources.delistedAt })
        .from(creatorMarketplaceResources)
        .where(and(
          eq(creatorMarketplaceResources.publisherId, observed.publisherId),
          eq(creatorMarketplaceResources.packageId, observed.packageId)
        ))
        .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
        .limit(1)
        .for("update");
      if (!currentHead) return null;

      if (input.sourceReportId) {
        const [sourceReport] = await transaction
          .select({ id: creatorMarketplaceResourceReports.id })
          .from(creatorMarketplaceResourceReports)
          .where(and(
            eq(creatorMarketplaceResourceReports.id, input.sourceReportId),
            eq(creatorMarketplaceResourceReports.status, "open"),
            eq(
              creatorMarketplaceResourceReports.packagePublisherIdSnapshot,
              observed.publisherId
            ),
            eq(
              creatorMarketplaceResourceReports.packageIdSnapshot,
              observed.packageId
            )
          ))
          .limit(1)
          .for("update");
        if (!sourceReport) {
          throw new CreatorMarketplaceModerationRejectedError("source-report");
        }
      }

      let packageState = moderation.state as CreatorMarketplaceModerationResult["packageState"];
      let packageRevision = moderation.revision;
      let packageHiddenAt = moderation.hiddenAt;
      let changed = false;
      let decisionId: string | null = null;
      const requestedState = input.action === "hide"
        ? "hidden"
        : input.action === "restore"
          ? "active"
          : null;

      if (requestedState && requestedState !== packageState) {
        decisionId = crypto.randomUUID();
        const nextRevision = packageRevision + 1;
        await transaction
          .insert(creatorMarketplacePackageModerationDecisions)
          .values({
            id: decisionId,
            publisherIdSnapshot: observed.publisherId,
            packageIdSnapshot: observed.packageId,
            revision: nextRevision,
            action: input.action,
            actorKind: "admin",
            reviewerId: input.reviewerId,
            note: input.note,
            sourceResourceSnapshotId: input.resourceId,
            sourceReportId: input.sourceReportId ?? null,
          });
        const [updated] = await transaction
          .update(creatorMarketplacePackageModeration)
          .set({
            state: requestedState,
            revision: nextRevision,
            currentDecisionId: decisionId,
            hiddenAt: requestedState === "hidden" ? sql`clock_timestamp()` : null,
            updatedAt: sql`greatest(
              clock_timestamp(),
              ${creatorMarketplacePackageModeration.updatedAt} + interval '1 millisecond'
            )`,
          })
          .where(and(
            eq(
              creatorMarketplacePackageModeration.publisherId,
              observed.publisherId
            ),
            eq(creatorMarketplacePackageModeration.packageId, observed.packageId),
            eq(creatorMarketplacePackageModeration.revision, packageRevision),
            eq(creatorMarketplacePackageModeration.state, packageState)
          ))
          .returning({
            state: creatorMarketplacePackageModeration.state,
            revision: creatorMarketplacePackageModeration.revision,
            hiddenAt: creatorMarketplacePackageModeration.hiddenAt,
          });
        if (!updated) {
          throw new Error("creator_marketplace_package_moderation_state_changed");
        }
        packageState = updated.state as CreatorMarketplaceModerationResult["packageState"];
        packageRevision = updated.revision;
        packageHiddenAt = updated.hiddenAt;
        changed = true;
      }

      const reviewedReports = await transaction
        .update(creatorMarketplaceResourceReports)
        .set({
          status: input.action === "hide" ? "resolved" : "dismissed",
          resolutionNote: input.note,
          reviewedBy: input.reviewerId,
          reviewedAt: sql`clock_timestamp()`,
        })
        .where(and(
          eq(
            creatorMarketplaceResourceReports.packagePublisherIdSnapshot,
            observed.publisherId
          ),
          eq(
            creatorMarketplaceResourceReports.packageIdSnapshot,
            observed.packageId
          ),
          eq(creatorMarketplaceResourceReports.status, "open")
        ))
        .returning({ id: creatorMarketplaceResourceReports.id });

      return {
        publisherId: observed.publisherId,
        packageId: observed.packageId,
        packageState,
        packageRevision,
        packageHiddenAt,
        changed,
        decisionId,
        hidden: packageState === "hidden",
        // Administrative restoration never relists an owner-delisted absolute head.
        delisted: currentHead.delistedAt !== null,
        reviewedReportCount: reviewedReports.length,
      };
    });
  }

  async dismissOrphanReport(
    input: CreatorMarketplaceOrphanReportDismissInput
  ): Promise<CreatorMarketplaceOrphanReportDismissResult | null> {
    return db.transaction(async (transaction) => {
      const [observed] = await transaction
        .select({
          resourceSnapshotId: creatorMarketplaceResourceReports.resourceSnapshotId,
        })
        .from(creatorMarketplaceResourceReports)
        .where(eq(creatorMarketplaceResourceReports.id, input.reportId))
        .limit(1);
      if (!observed) return null;

      // Two administrators may choose different report IDs from the same orphaned release. Lock
      // the immutable snapshot identity before either report row so both requests serialize as one
      // atomic group decision without acquiring report rows in conflicting orders.
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${
            CREATOR_MARKETPLACE_ORPHAN_DISMISS_LOCK_NAMESPACE
            + observed.resourceSnapshotId
          }, 0)
        )
      `);
      const [report] = await transaction
        .select({
          resourceSnapshotId: creatorMarketplaceResourceReports.resourceSnapshotId,
          resourceId: creatorMarketplaceResourceReports.resourceId,
          status: creatorMarketplaceResourceReports.status,
        })
        .from(creatorMarketplaceResourceReports)
        .where(eq(creatorMarketplaceResourceReports.id, input.reportId))
        .limit(1)
        .for("update");
      if (!report) return null;
      if (report.resourceId !== null) {
        throw new CreatorMarketplaceOrphanReportDismissRejectedError("attached");
      }
      if (report.status !== "open") {
        throw new CreatorMarketplaceOrphanReportDismissRejectedError("closed");
      }

      const dismissed = await transaction
        .update(creatorMarketplaceResourceReports)
        .set({
          status: "dismissed",
          resolutionNote: input.note,
          reviewedBy: input.reviewerId,
          reviewedAt: new Date(),
        })
        .where(and(
          eq(
            creatorMarketplaceResourceReports.resourceSnapshotId,
            report.resourceSnapshotId
          ),
          isNull(creatorMarketplaceResourceReports.resourceId),
          eq(creatorMarketplaceResourceReports.status, "open")
        ))
        .returning({ id: creatorMarketplaceResourceReports.id });
      if (dismissed.length < 1) {
        throw new CreatorMarketplaceOrphanReportDismissRejectedError("closed");
      }
      return {
        reportId: input.reportId,
        dismissedReportCount: dismissed.length,
      };
    });
  }

  async deleteOwned(publisherId: string, id: string): Promise<boolean> {
    return db.transaction(async (transaction) => {
      const [observed] = await transaction
        .select({ packageId: creatorMarketplaceResources.packageId })
        .from(creatorMarketplaceResources)
        .where(and(
          eq(creatorMarketplaceResources.id, id),
          eq(creatorMarketplaceResources.publisherId, publisherId)
        ))
        .limit(1);
      if (!observed) return false;
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${creatorMarketplaceReleaseLockKey(
            publisherId,
            observed.packageId
          )}, 0)
        )
      `);
      const [moderation] = await transaction
        .select({ state: creatorMarketplacePackageModeration.state })
        .from(creatorMarketplacePackageModeration)
        .where(and(
          eq(creatorMarketplacePackageModeration.publisherId, publisherId),
          eq(creatorMarketplacePackageModeration.packageId, observed.packageId)
        ))
        .limit(1)
        .for("update");
      if (!moderation) return false;

      const [head] = await transaction
        .select({ id: creatorMarketplaceResources.id })
        .from(creatorMarketplaceResources)
        .where(and(
          eq(creatorMarketplaceResources.publisherId, publisherId),
          eq(creatorMarketplaceResources.packageId, observed.packageId)
        ))
        .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
        .limit(1)
        .for("update");
      if (!head || head.id !== id) return false;

      const delisted = await transaction
        .update(creatorMarketplaceResources)
        .set({
          delistedAt: sql`clock_timestamp()`,
          updatedAt: sql`greatest(
            clock_timestamp(),
            ${creatorMarketplaceResources.updatedAt} + interval '1 millisecond'
          )`,
        })
        .where(and(
          eq(creatorMarketplaceResources.id, id),
          eq(creatorMarketplaceResources.publisherId, publisherId),
          eq(creatorMarketplaceResources.packageId, observed.packageId),
          isNull(creatorMarketplaceResources.delistedAt)
        ))
        .returning({ id: creatorMarketplaceResources.id });
      return delisted.length === 1;
    });
  }

  async relistOwned(
    publisherId: string,
    id: string
  ): Promise<CreatorMarketplaceRelistResult | null> {
    return db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select({ packageId: creatorMarketplaceResources.packageId })
        .from(creatorMarketplaceResources)
        .where(and(
          eq(creatorMarketplaceResources.id, id),
          eq(creatorMarketplaceResources.publisherId, publisherId)
        ))
        .limit(1);
      if (!candidate) return null;

      // Publishing and relisting share one publisher+package advisory lock. A concurrent publish
      // therefore cannot make this release stale between the head check and lifecycle update.
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${creatorMarketplaceReleaseLockKey(
            publisherId,
            candidate.packageId
          )}, 0)
        )
      `);
      const [moderation] = await transaction
        .select({ state: creatorMarketplacePackageModeration.state })
        .from(creatorMarketplacePackageModeration)
        .where(and(
          eq(creatorMarketplacePackageModeration.publisherId, publisherId),
          eq(creatorMarketplacePackageModeration.packageId, candidate.packageId)
        ))
        .limit(1)
        .for("update");
      if (!moderation) return null;
      if (moderation.state === "hidden") {
        throw new CreatorMarketplaceResourceRelistRejectedError("moderated");
      }
      const [head] = await transaction
        .select({
          id: creatorMarketplaceResources.id,
          delistedAt: creatorMarketplaceResources.delistedAt,
        })
        .from(creatorMarketplaceResources)
        .where(and(
          eq(creatorMarketplaceResources.publisherId, publisherId),
          eq(creatorMarketplaceResources.packageId, candidate.packageId)
        ))
        .orderBy(desc(creatorMarketplaceResources.releaseOrdinal))
        .limit(1)
        .for("update");
      if (!head || head.id !== id) {
        throw new CreatorMarketplaceResourceRelistRejectedError("non-head");
      }
      if (head.delistedAt === null) return { id, changed: false };

      const [updated] = await transaction
        .update(creatorMarketplaceResources)
        .set({
          delistedAt: null,
          updatedAt: sql`greatest(
            clock_timestamp(),
            ${creatorMarketplaceResources.updatedAt} + interval '1 millisecond'
          )`,
        })
        .where(and(
          eq(creatorMarketplaceResources.id, id),
          eq(creatorMarketplaceResources.publisherId, publisherId),
          eq(creatorMarketplaceResources.packageId, candidate.packageId),
          isNotNull(creatorMarketplaceResources.delistedAt)
        ))
        .returning({ id: creatorMarketplaceResources.id });
      if (!updated) {
        // The advisory lock makes this reachable only if the row changed outside the supported
        // lifecycle contract; fail closed instead of claiming a successful relist.
        throw new Error("creator_marketplace_resource_relist_state_changed");
      }
      return { id: updated.id, changed: true };
    });
  }
}

export const creatorMarketplaceResourceRepositoryProvider: Provider = {
  provide: CREATOR_MARKETPLACE_RESOURCE_REPOSITORY,
  useClass: DrizzleCreatorMarketplaceResourceRepository,
};
