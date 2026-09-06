// 공유 에셋(회원이 사이트에 올려 모두가 재사용) — 목록/게시/신고/모더레이션/콘텐츠 제공.
import { and, asc, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";

import {
  assertCreatorAssetListResponseBudget,
  CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE,
  CREATOR_ASSET_LEGACY_FULL_MAX_PAGE_SIZE,
  CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE,
  CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS,
  creatorAssetLicenseOf,
  isCreatorAssetLicenseId,
  isCreatorAssetReportReason,
  normalizeCreatorAssetTags,
  parseCreatorAssetCatalogSort,
} from "../../../../web/src/shared/lib/creator-asset-contract";
import { creatorAssetReports, creatorAssets, db, users } from "../../db";
import {
  assertCreatorAssetPersistedIntegrity,
  inspectCreatorAssetPayload,
  inspectCreatorAssetPreviewDataUrl,
  resolveCreatorAssetPreviewForResponse,
} from "../creator-asset-image";

import {
  authorOf,
  clampText,
  excludeTestUserId,
  normalizeMultiline,
  postgresErrorCode,
  QA_USER_ID_PREFIX,
  safeDate,
} from "./shared";

import type { CreatorAuthor } from "./works-contract";
import type {
  CreatorAssetCatalogSort,
  CreatorAssetLicenseId,
  CreatorAssetModerationStatus,
  CreatorAssetReportReason,
} from "../../../../web/src/shared/lib/creator-asset-contract";
import type { SQL } from "drizzle-orm";

// ── 공유 에셋(회원이 사이트에 올려 모두가 재사용) ──────────────────────
export const MAX_ASSET_NAME = 60;
const MAX_ASSET_DESCRIPTION = 500;
const MAX_ASSET_ATTRIBUTION = 160;
const MAX_ASSET_REPORT_DETAILS = 500;
const MAX_ASSET_MODERATION_NOTE = 500;
const ASSET_KINDS = new Set(["image", "sticker", "vrm_pose"]);

export interface CreatorSharedAssetSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  width: number;
  height: number;
  kind: string;
  license: CreatorAssetLicenseId;
  licenseLabel: string;
  licenseUrl: string | null;
  attributionRequired: boolean;
  commercialUse: boolean;
  attributionText: string;
  containsAi: boolean;
  moderationStatus: CreatorAssetModerationStatus;
  reportCount: number;
  downloads: number;
  author: CreatorAuthor;
  isOwner: boolean;
  createdAt: string;
}

/** Legacy/full-content projection kept for the VRM shared-pose library. */
export interface CreatorSharedAsset extends CreatorSharedAssetSummary {
  dataUrl: string;
}

/** Bounded catalog projection. The original data URL is deliberately absent. */
export interface CreatorSharedAssetCatalogItem extends CreatorSharedAssetSummary {
  previewDataUrl: string;
  previewWidth: number;
  previewHeight: number;
  previewAvailable: boolean;
}

export interface CreatorSharedAssetContent {
  id: string;
  dataUrl: string;
  width: number;
  height: number;
  kind: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
}

export interface CreatorAssetCatalogPage {
  items: CreatorSharedAssetCatalogItem[];
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface CreatorAssetModerationQueueItem {
  reportId: string;
  reason: CreatorAssetReportReason;
  details: string;
  reportStatus: "open" | "resolved" | "dismissed";
  reportedAt: string;
  reporter: CreatorAuthor;
  asset: CreatorSharedAssetCatalogItem;
}


interface SharedAssetListOptions {
  limit?: number;
  offset?: number;
  mineUserId?: string; // 지정 시 해당 회원이 올린 것만(내 공유 목록)
  viewerId?: string;
  search?: string;
  tag?: string;
  license?: string;
  kind?: string;
  sort?: CreatorAssetCatalogSort;
}

function creatorAssetModerationStatusOf(value: unknown): CreatorAssetModerationStatus {
  return value === "published" || value === "rejected" ? value : "under_review";
}

function sharedAssetQueryParts(opts: SharedAssetListOptions): { wheres: SQL[]; order: SQL[] } {
  const wheres: SQL[] = [eq(creatorAssets.hidden, false)];
  if (opts.mineUserId) wheres.push(eq(creatorAssets.userId, opts.mineUserId));
  const ownerView = Boolean(opts.mineUserId && opts.viewerId === opts.mineUserId);
  if (!ownerView) {
    wheres.push(eq(creatorAssets.moderationStatus, "published"));
    wheres.push(isNotNull(creatorAssets.rightsConfirmedAt));
    wheres.push(excludeTestUserId(creatorAssets.userId));
  }
  const search = clampText(opts.search, 80);
  if (search) {
    const pattern = `%${search}%`;
    wheres.push(
      or(
        ilike(creatorAssets.name, pattern),
        ilike(creatorAssets.description, pattern),
        ilike(users.name, pattern),
        sql`${creatorAssets.tags}::text ILIKE ${pattern}`
      )!
    );
  }
  const [tag] = normalizeCreatorAssetTags(opts.tag);
  if (tag) wheres.push(sql`${creatorAssets.tags} @> ${JSON.stringify([tag])}::jsonb`);
  if (isCreatorAssetLicenseId(opts.license)) wheres.push(eq(creatorAssets.license, opts.license));
  if (ASSET_KINDS.has(opts.kind ?? "")) wheres.push(eq(creatorAssets.kind, opts.kind!));
  const sort = parseCreatorAssetCatalogSort(opts.sort);
  const order =
    sort === "popular"
      ? [desc(creatorAssets.downloads), desc(creatorAssets.createdAt)]
      : sort === "name"
        ? [asc(creatorAssets.name), desc(creatorAssets.createdAt)]
        : [desc(creatorAssets.createdAt)];
  return { wheres, order };
}

async function selectSharedAssets(
  opts: SharedAssetListOptions,
  requestedLimit: number
): Promise<CreatorSharedAsset[]> {
  const limit = Math.max(1, Math.min(121, requestedLimit));
  const offset = Math.max(0, opts.offset ?? 0);
  const { wheres, order } = sharedAssetQueryParts(opts);
  const rows = await db
    .select({
      id: creatorAssets.id,
      userId: creatorAssets.userId,
      name: creatorAssets.name,
      description: creatorAssets.description,
      tags: creatorAssets.tags,
      dataUrl: creatorAssets.dataUrl,
      width: creatorAssets.width,
      height: creatorAssets.height,
      kind: creatorAssets.kind,
      mimeType: creatorAssets.mimeType,
      byteSize: creatorAssets.byteSize,
      contentHash: creatorAssets.contentHash,
      license: creatorAssets.license,
      attributionText: creatorAssets.attributionText,
      containsAi: creatorAssets.containsAi,
      moderationStatus: creatorAssets.moderationStatus,
      reportCount: creatorAssets.reportCount,
      downloads: creatorAssets.downloads,
      createdAt: creatorAssets.createdAt,
      author: users.name,
      avatar: users.avatar,
    })
    .from(creatorAssets)
    .leftJoin(users, eq(creatorAssets.userId, users.id))
    .where(wheres.length > 0 ? and(...wheres) : undefined)
    .orderBy(...order)
    .limit(limit)
    .offset(offset);
  return rows.map((row) => {
    const license = creatorAssetLicenseOf(row.license);
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      tags: Array.isArray(row.tags) ? row.tags : [],
      dataUrl: row.dataUrl,
      width: row.width,
      height: row.height,
      kind: row.kind,
      license: license.id,
      licenseLabel: license.shortLabel,
      licenseUrl: license.url,
      attributionRequired: license.attributionRequired,
      commercialUse: license.commercialUse,
      attributionText: row.attributionText ?? "",
      containsAi: row.containsAi ?? false,
      moderationStatus: creatorAssetModerationStatusOf(row.moderationStatus),
      reportCount: row.reportCount ?? 0,
      downloads: row.downloads,
      author: authorOf(row),
      isOwner: !!opts.viewerId && opts.viewerId === row.userId,
      createdAt: safeDate(row.createdAt),
    };
  });
}

async function selectSharedAssetCatalogItems(
  opts: SharedAssetListOptions,
  requestedLimit: number
): Promise<CreatorSharedAssetCatalogItem[]> {
  const limit = Math.max(1, Math.min(CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE + 1, requestedLimit));
  const offset = Math.max(0, opts.offset ?? 0);
  const { wheres, order } = sharedAssetQueryParts(opts);
  const rows = await db
    .select({
      id: creatorAssets.id,
      userId: creatorAssets.userId,
      name: creatorAssets.name,
      description: creatorAssets.description,
      tags: creatorAssets.tags,
      previewDataUrl: sql<string | null>`CASE
        WHEN octet_length(${creatorAssets.previewDataUrl}) BETWEEN 1 AND ${CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS}
        THEN ${creatorAssets.previewDataUrl}
        ELSE NULL
      END`,
      previewWidth: creatorAssets.previewWidth,
      previewHeight: creatorAssets.previewHeight,
      previewMimeType: creatorAssets.previewMimeType,
      previewByteSize: creatorAssets.previewByteSize,
      previewContentHash: creatorAssets.previewContentHash,
      width: creatorAssets.width,
      height: creatorAssets.height,
      kind: creatorAssets.kind,
      license: creatorAssets.license,
      attributionText: creatorAssets.attributionText,
      containsAi: creatorAssets.containsAi,
      moderationStatus: creatorAssets.moderationStatus,
      reportCount: creatorAssets.reportCount,
      downloads: creatorAssets.downloads,
      createdAt: creatorAssets.createdAt,
      author: users.name,
      avatar: users.avatar,
    })
    .from(creatorAssets)
    .leftJoin(users, eq(creatorAssets.userId, users.id))
    .where(and(...wheres))
    .orderBy(...order)
    .limit(limit)
    .offset(offset);
  return rows.map((row) => {
    const license = creatorAssetLicenseOf(row.license);
    const preview = resolveCreatorAssetPreviewForResponse({
      dataUrl: row.previewDataUrl,
      width: row.previewWidth,
      height: row.previewHeight,
      mimeType: row.previewMimeType,
      byteSize: row.previewByteSize,
      contentHash: row.previewContentHash,
    });
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      tags: Array.isArray(row.tags) ? row.tags : [],
      previewDataUrl: preview.dataUrl,
      previewWidth: preview.width,
      previewHeight: preview.height,
      previewAvailable: preview.available,
      width: row.width,
      height: row.height,
      kind: row.kind,
      license: license.id,
      licenseLabel: license.shortLabel,
      licenseUrl: license.url,
      attributionRequired: license.attributionRequired,
      commercialUse: license.commercialUse,
      attributionText: row.attributionText ?? "",
      containsAi: row.containsAi ?? false,
      moderationStatus: creatorAssetModerationStatusOf(row.moderationStatus),
      reportCount: row.reportCount ?? 0,
      downloads: row.downloads,
      author: authorOf(row),
      isOwner: !!opts.viewerId && opts.viewerId === row.userId,
      createdAt: safeDate(row.createdAt),
    };
  });
}

export async function listSharedAssets(opts: SharedAssetListOptions = {}): Promise<CreatorSharedAsset[]> {
  const assets = await selectSharedAssets(
    opts,
    Math.max(1, Math.min(CREATOR_ASSET_LEGACY_FULL_MAX_PAGE_SIZE, opts.limit ?? 1))
  );
  assertCreatorAssetListResponseBudget(assets);
  return assets;
}

export async function listSharedAssetCatalog(
  opts: SharedAssetListOptions = {}
): Promise<CreatorAssetCatalogPage> {
  const limit = Math.max(
    1,
    Math.min(CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE, opts.limit ?? CREATOR_ASSET_CATALOG_MAX_PAGE_SIZE)
  );
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await selectSharedAssetCatalogItems({ ...opts, offset }, limit + 1);
  const hasMore = rows.length > limit;
  const page = {
    items: hasMore ? rows.slice(0, limit) : rows,
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
  assertCreatorAssetListResponseBudget(page);
  return page;
}

export async function publishAsset(
  userId: string,
  input: {
    name?: unknown;
    description?: unknown;
    tags?: unknown;
    dataUrl?: unknown;
    width?: unknown;
    height?: unknown;
    previewDataUrl?: unknown;
    previewWidth?: unknown;
    previewHeight?: unknown;
    kind?: unknown;
    license?: unknown;
    attributionText?: unknown;
    containsAi?: unknown;
    rightsConfirmed?: unknown;
  }
): Promise<CreatorSharedAsset> {
  if (input.rightsConfirmed !== true) {
    throw new Error("직접 제작했거나 공유 권한을 가진 에셋인지 확인해 주세요.");
  }
  const name = clampText(input.name, MAX_ASSET_NAME) || "내 에셋";
  const description = normalizeMultiline(input.description, MAX_ASSET_DESCRIPTION);
  const tags = normalizeCreatorAssetTags(input.tags);
  if (!isCreatorAssetLicenseId(input.license)) throw new Error("에셋 사용권을 선택해 주세요.");
  const license = creatorAssetLicenseOf(input.license);
  const kind = ASSET_KINDS.has(input.kind as string) ? (input.kind as string) : "image";
  const inspected = inspectCreatorAssetPayload(input.dataUrl, kind, input.width, input.height);
  const preview = inspectCreatorAssetPreviewDataUrl(
    input.previewDataUrl,
    input.previewWidth,
    input.previewHeight
  );
  const aspectError = Math.abs(
    preview.width / preview.height - inspected.width / inspected.height
  ) / Math.max(preview.width / preview.height, inspected.width / inspected.height);
  if (
    preview.width > inspected.width ||
    preview.height > inspected.height ||
    !Number.isFinite(aspectError) ||
    aspectError > 0.03
  ) {
    throw new Error("미리보기 크기 비율이 원본 이미지와 일치하지 않습니다.");
  }
  const id = crypto.randomUUID();
  const now = new Date();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const attributionText =
    clampText(input.attributionText, MAX_ASSET_ATTRIBUTION) ||
    (license.attributionRequired ? user?.name || "원저작자" : "");
  try {
    await db.insert(creatorAssets).values({
      id,
      userId,
      name,
      description,
      tags,
      dataUrl: inspected.dataUrl,
      width: inspected.width,
      height: inspected.height,
      kind,
      mimeType: inspected.mimeType,
      byteSize: inspected.byteSize,
      contentHash: inspected.sha256,
      previewDataUrl: preview.dataUrl,
      previewWidth: preview.width,
      previewHeight: preview.height,
      previewMimeType: preview.mimeType,
      previewByteSize: preview.byteSize,
      previewContentHash: preview.sha256,
      license: license.id,
      attributionText,
      containsAi: input.containsAi === true,
      rightsConfirmedAt: now,
      moderationStatus: "published",
      createdAt: now,
    });
  } catch (error) {
    if (postgresErrorCode(error) === "23505") {
      throw new Error("같은 에셋을 이미 공유했습니다.", { cause: error });
    }
    throw error;
  }
  return {
    id,
    name,
    description,
    tags,
    dataUrl: inspected.dataUrl,
    width: inspected.width,
    height: inspected.height,
    kind,
    license: license.id,
    licenseLabel: license.shortLabel,
    licenseUrl: license.url,
    attributionRequired: license.attributionRequired,
    commercialUse: license.commercialUse,
    attributionText,
    containsAi: input.containsAi === true,
    moderationStatus: "published",
    reportCount: 0,
    downloads: 0,
    author: { id: userId, name: user?.name ?? "익명", avatar: user?.avatar ?? "#7c5cfc" },
    isOwner: true,
    createdAt: safeDate(now),
  };
}

export async function deleteSharedAsset(userId: string, id: string, isAdmin: boolean): Promise<{ deleted: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: creatorAssets.id,
        ownerId: creatorAssets.userId,
        reportCount: creatorAssets.reportCount,
        moderationStatus: creatorAssets.moderationStatus,
        reviewedAt: creatorAssets.reviewedAt,
      })
      .from(creatorAssets)
      .where(eq(creatorAssets.id, id))
      .limit(1)
      .for("update");
    if (!existing) return { deleted: false };
    if (existing.ownerId !== userId && !isAdmin) throw new Error("올린 사람만 삭제할 수 있습니다.");

    if (existing.reportCount > 0) {
      const now = new Date();
      let approvedAssetHasOpenReport = false;
      if (
        !isAdmin &&
        existing.moderationStatus === "published" &&
        existing.reviewedAt !== null
      ) {
        const [openReport] = await tx
          .select({ id: creatorAssetReports.id })
          .from(creatorAssetReports)
          .where(
            and(
              eq(creatorAssetReports.assetId, id),
              eq(creatorAssetReports.status, "open")
            )
          )
          .limit(1);
        approvedAssetHasOpenReport = Boolean(openReport);
      }
      const ownerMustPreserveFinalModeration =
        !isAdmin &&
        (existing.moderationStatus === "rejected" ||
          (existing.moderationStatus === "published" &&
            existing.reviewedAt !== null &&
            !approvedAssetHasOpenReport));
      await tx
        .update(creatorAssets)
        .set({
          hidden: true,
          ...(isAdmin
            ? {
                moderationStatus: "rejected" as const,
                moderationNote: "관리자가 신고 증거를 보존한 채 에셋을 비공개 처리했습니다.",
                reviewedBy: userId,
                reviewedAt: now,
              }
            : ownerMustPreserveFinalModeration
              ? {}
              : {
                  moderationStatus: "under_review" as const,
                  moderationNote: "소유자가 신고 검수 중 공유를 철회했습니다.",
                }),
        })
        .where(eq(creatorAssets.id, id));
      return { deleted: true };
    }

    await tx.delete(creatorAssets).where(eq(creatorAssets.id, id));
    return { deleted: true };
  });
}

export async function reportSharedAsset(
  reporterId: string,
  assetId: string,
  input: { reason?: unknown; details?: unknown }
): Promise<{ reported: true; reportCount: number }> {
  if (!isCreatorAssetReportReason(input.reason)) throw new Error("신고 사유를 선택해 주세요.");
  const reportId = crypto.randomUUID();
  const details = normalizeMultiline(input.details, MAX_ASSET_REPORT_DETAILS);
  try {
    const reportCount = await db.transaction(async (tx) => {
      // Serialize reporting, moderation, owner withdrawal, and admin deletion on the asset row.
      // Eligibility must be checked after the lock is acquired so a report cannot slip in after
      // the asset became hidden/rejected, and every caller observes the authoritative counter.
      const [asset] = await tx
        .select({
          ownerId: creatorAssets.userId,
          hidden: creatorAssets.hidden,
          moderationStatus: creatorAssets.moderationStatus,
        })
        .from(creatorAssets)
        .where(eq(creatorAssets.id, assetId))
        .limit(1)
        .for("update");
      if (!asset || asset.hidden || asset.moderationStatus !== "published") {
        throw new Error("신고할 수 있는 공개 에셋을 찾지 못했습니다.");
      }
      if (asset.ownerId === reporterId) {
        throw new Error("자신이 공유한 에셋은 신고할 수 없습니다.");
      }

      await tx.insert(creatorAssetReports).values({
        id: reportId,
        assetId,
        reporterId,
        reason: input.reason as CreatorAssetReportReason,
        details,
      });
      const [updated] = await tx
        .update(creatorAssets)
        .set({ reportCount: sql`${creatorAssets.reportCount} + 1` })
        .where(eq(creatorAssets.id, assetId))
        .returning({ reportCount: creatorAssets.reportCount });
      if (!updated) {
        throw new Error("신고할 수 있는 공개 에셋을 찾지 못했습니다.");
      }
      return updated.reportCount;
    });
    return { reported: true, reportCount };
  } catch (error) {
    if (postgresErrorCode(error) === "23505") {
      throw new Error("이미 이 에셋을 신고했습니다.", { cause: error });
    }
    throw error;
  }
}

function creatorAssetReportStatusOf(value: unknown): "open" | "resolved" | "dismissed" {
  return value === "resolved" || value === "dismissed" ? value : "open";
}

export async function listAssetModerationQueue(opts: {
  limit?: number;
  offset?: number;
  status?: "open" | "resolved" | "dismissed";
} = {}): Promise<CreatorAssetModerationQueueItem[]> {
  const limit = Math.max(
    1,
    Math.min(
      CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE,
      opts.limit ?? CREATOR_ASSET_MODERATION_MAX_PAGE_SIZE
    )
  );
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await db
    .select({
      reportId: creatorAssetReports.id,
      reason: creatorAssetReports.reason,
      details: creatorAssetReports.details,
      reportStatus: creatorAssetReports.status,
      reportedAt: creatorAssetReports.createdAt,
      reporterId: creatorAssetReports.reporterId,
      assetId: creatorAssets.id,
      assetUserId: creatorAssets.userId,
      assetName: creatorAssets.name,
      assetDescription: creatorAssets.description,
      assetTags: creatorAssets.tags,
      assetPreviewDataUrl: sql<string | null>`CASE
        WHEN octet_length(${creatorAssets.previewDataUrl}) BETWEEN 1 AND ${CREATOR_ASSET_PREVIEW_MAX_DATA_URL_CHARACTERS}
        THEN ${creatorAssets.previewDataUrl}
        ELSE NULL
      END`,
      assetPreviewWidth: creatorAssets.previewWidth,
      assetPreviewHeight: creatorAssets.previewHeight,
      assetPreviewMimeType: creatorAssets.previewMimeType,
      assetPreviewByteSize: creatorAssets.previewByteSize,
      assetPreviewContentHash: creatorAssets.previewContentHash,
      assetWidth: creatorAssets.width,
      assetHeight: creatorAssets.height,
      assetKind: creatorAssets.kind,
      assetLicense: creatorAssets.license,
      assetAttributionText: creatorAssets.attributionText,
      assetContainsAi: creatorAssets.containsAi,
      assetModerationStatus: creatorAssets.moderationStatus,
      assetReportCount: creatorAssets.reportCount,
      assetDownloads: creatorAssets.downloads,
      assetCreatedAt: creatorAssets.createdAt,
      assetAuthor: users.name,
      assetAvatar: users.avatar,
    })
    .from(creatorAssetReports)
    .innerJoin(creatorAssets, eq(creatorAssetReports.assetId, creatorAssets.id))
    .leftJoin(users, eq(creatorAssets.userId, users.id))
    .where(eq(creatorAssetReports.status, opts.status ?? "open"))
    .orderBy(desc(creatorAssetReports.createdAt))
    .limit(limit)
    .offset(offset);
  const items = rows.map((row) => {
    const license = creatorAssetLicenseOf(row.assetLicense);
    const preview = resolveCreatorAssetPreviewForResponse({
      dataUrl: row.assetPreviewDataUrl,
      width: row.assetPreviewWidth,
      height: row.assetPreviewHeight,
      mimeType: row.assetPreviewMimeType,
      byteSize: row.assetPreviewByteSize,
      contentHash: row.assetPreviewContentHash,
    });
    return {
      reportId: row.reportId,
      reason: isCreatorAssetReportReason(row.reason) ? row.reason : "other",
      details: row.details,
      reportStatus: creatorAssetReportStatusOf(row.reportStatus),
      reportedAt: safeDate(row.reportedAt),
      reporter: { id: row.reporterId, name: "신고 회원", avatar: "#64748b" },
      asset: {
        id: row.assetId,
        name: row.assetName,
        description: row.assetDescription,
        tags: Array.isArray(row.assetTags) ? row.assetTags : [],
        previewDataUrl: preview.dataUrl,
        previewWidth: preview.width,
        previewHeight: preview.height,
        previewAvailable: preview.available,
        width: row.assetWidth,
        height: row.assetHeight,
        kind: row.assetKind,
        license: license.id,
        licenseLabel: license.shortLabel,
        licenseUrl: license.url,
        attributionRequired: license.attributionRequired,
        commercialUse: license.commercialUse,
        attributionText: row.assetAttributionText,
        containsAi: row.assetContainsAi,
        moderationStatus: creatorAssetModerationStatusOf(row.assetModerationStatus),
        reportCount: row.assetReportCount,
        downloads: row.assetDownloads,
        author: {
          id: row.assetUserId,
          name: row.assetAuthor ?? "익명",
          avatar: row.assetAvatar ?? "#7c5cfc",
        },
        isOwner: false,
        createdAt: safeDate(row.assetCreatedAt),
      },
    };
  });
  assertCreatorAssetListResponseBudget(items);
  return items;
}

export async function moderateSharedAsset(
  reviewerId: string,
  assetId: string,
  input: { status?: unknown; note?: unknown }
): Promise<{ updated: true; status: CreatorAssetModerationStatus }> {
  const status = creatorAssetModerationStatusOf(input.status);
  if (status !== input.status) throw new Error("검수 상태가 올바르지 않습니다.");
  const note = normalizeMultiline(input.note, MAX_ASSET_MODERATION_NOTE);
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(creatorAssets)
      .set({
        moderationStatus: status,
        moderationNote: note,
        reviewedBy: reviewerId,
        reviewedAt: now,
      })
      .where(eq(creatorAssets.id, assetId))
      .returning({ id: creatorAssets.id });
    if (rows.length === 0) return false;
    if (status !== "under_review") {
      await tx
        .update(creatorAssetReports)
        .set({
          status: status === "rejected" ? "resolved" : "dismissed",
          resolutionNote: note,
          reviewedBy: reviewerId,
          reviewedAt: now,
        })
        .where(and(eq(creatorAssetReports.assetId, assetId), eq(creatorAssetReports.status, "open")));
    }
    return true;
  });
  if (!updated) throw new Error("검수할 에셋을 찾지 못했습니다.");
  return { updated: true, status };
}

/**
 * Resolve one original only after applying the same public-catalog visibility rule, while still
 * allowing its owner and an authenticated moderator to inspect a non-public item. This read is
 * deliberately side-effect free: only a successful canvas insertion calls the authenticated
 * `/use` endpoint, so retries and moderation inspection cannot inflate popularity.
 */
export async function getSharedAssetContent(
  id: string,
  viewerId?: string,
  reviewerAccess = false
): Promise<CreatorSharedAssetContent> {
  const [asset] = await db
    .select({
      id: creatorAssets.id,
      ownerId: creatorAssets.userId,
      dataUrl: creatorAssets.dataUrl,
      width: creatorAssets.width,
      height: creatorAssets.height,
      kind: creatorAssets.kind,
      mimeType: creatorAssets.mimeType,
      byteSize: creatorAssets.byteSize,
      contentHash: creatorAssets.contentHash,
      hidden: creatorAssets.hidden,
      moderationStatus: creatorAssets.moderationStatus,
      rightsConfirmedAt: creatorAssets.rightsConfirmedAt,
    })
    .from(creatorAssets)
    .where(eq(creatorAssets.id, id))
    .limit(1);
  const ownerAccess = Boolean(viewerId && viewerId === asset?.ownerId);
  const publicAccess = Boolean(
    asset &&
    !asset.hidden &&
    asset.moderationStatus === "published" &&
    asset.rightsConfirmedAt &&
    !asset.ownerId.startsWith(QA_USER_ID_PREFIX)
  );
  if (!asset || (!ownerAccess && !reviewerAccess && !publicAccess)) {
    throw new Error("사용할 수 있는 공개 에셋을 찾지 못했습니다.");
  }
  // Re-inspect persisted bytes at the response boundary. A legacy row or direct DB mutation with
  // a disguised MIME, corrupt dimensions, or malformed VRM fragment therefore fails closed.
  const inspected = inspectCreatorAssetPayload(
    asset.dataUrl,
    asset.kind,
    asset.width,
    asset.height
  );
  assertCreatorAssetPersistedIntegrity(inspected, {
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    contentHash: asset.contentHash,
  });
  return {
    id: asset.id,
    dataUrl: inspected.dataUrl,
    width: inspected.width,
    height: inspected.height,
    kind: asset.kind,
    mimeType: inspected.mimeType,
    byteSize: inspected.byteSize,
    contentHash: inspected.sha256,
  };
}

export async function bumpAssetDownloads(id: string): Promise<void> {
  await db
    .update(creatorAssets)
    .set({ downloads: sql`${creatorAssets.downloads} + 1` })
    .where(
      and(
        eq(creatorAssets.id, id),
        eq(creatorAssets.hidden, false),
        eq(creatorAssets.moderationStatus, "published"),
        isNotNull(creatorAssets.rightsConfirmedAt),
        excludeTestUserId(creatorAssets.userId)
      )
    );
}

// ═══════════════════════════════════════════════════════════════════
// 연재 시리즈 (코미코 베스트도전 스타일) — 회차는 creator_work.seriesId 로 연결
// ═══════════════════════════════════════════════════════════════════

