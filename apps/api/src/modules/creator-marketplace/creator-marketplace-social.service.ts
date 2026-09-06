import { createHash } from "node:crypto";

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";

import {
  CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS,
  creatorMarketplacePackageIdentityPreimage,
} from "../../../../web/src/shared/lib/creator-marketplace-cloud-library-contract";
import {
  CREATOR_MARKETPLACE_SOCIAL_COMMENT_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_SOCIAL_COMMENT_PAGE_SIZE,
  CREATOR_MARKETPLACE_SOCIAL_MAX_TAGS,
  CREATOR_MARKETPLACE_SOCIAL_REVIEW_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_SOCIAL_REVIEW_PAGE_SIZE,
  CREATOR_MARKETPLACE_SOCIAL_REVIEW_TITLE_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_SOCIAL_ROLE_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_SOCIAL_TAG_MAX_CHARACTERS,
  CreatorMarketplaceSocialPageSchema,
} from "../../../../web/src/shared/lib/creator-marketplace-social-contract";
import {
  db,
  reviewLikes,
  reviewReplies,
  reviews,
  users,
} from "../../db";
import { creatorMarketplaceLibraryItems } from "../../db/creator-marketplace-library.schema";
import { isAdminUser } from "../../server/app-config";

import { CreatorMarketplaceService } from "./creator-marketplace.service";

import type { CreatorMarketplaceResourceRecord } from "../../../../web/src/shared/lib/creator-marketplace-resource-contract";
import type {
  CreateCreatorMarketplaceSocialComment,
  CreatorMarketplaceSocialAuthor,
  CreatorMarketplaceSocialAuthorBadge,
  CreatorMarketplaceSocialPage,
  CreatorMarketplaceSocialReviewQualification,
  UpsertCreatorMarketplaceSocialReview,
} from "../../../../web/src/shared/lib/creator-marketplace-social-contract";

const MARKET_SOCIAL_KEY_PREFIX = "toonspectrum:market-package:";
const MARKET_REVIEW_STORAGE_SCHEMA = "toonspectrum.market-review.v2";
const LEGACY_MARKET_REVIEW_STORAGE_SCHEMA = "toonspectrum.market-review.v1";
const STUDIO_CONFIRMABLE_KINDS = new Set<string>(
  CREATOR_MARKETPLACE_STUDIO_CONFIRMABLE_KINDS,
);

interface SocialUserRow {
  readonly userId: string;
  readonly authorName: string | null;
  readonly avatarImage: string | null;
  readonly avatarColor: string | null;
}

interface StoredMarketReviewPayload {
  readonly schema: typeof MARKET_REVIEW_STORAGE_SCHEMA;
  readonly title: string;
  readonly content: string;
  readonly roleTag: string | null;
  readonly qualification: CreatorMarketplaceSocialReviewQualification;
  readonly sourceResourceVersion: string;
  readonly installedResourceVersion: string | null;
}

interface MembershipEvidence {
  readonly membership: "active" | "archived";
  readonly studioInstallVerified: boolean;
  readonly lastConfirmedResourceVersion: string | null;
}

interface ReviewEligibility {
  readonly qualification: CreatorMarketplaceSocialReviewQualification;
  readonly installedResourceVersion: string | null;
}

function studioVerificationSupported(
  resource: CreatorMarketplaceResourceRecord,
): boolean {
  return STUDIO_CONFIRMABLE_KINDS.has(resource.kind);
}

function socialKey(resource: CreatorMarketplaceResourceRecord): string {
  const packageHash = createHash("sha256")
    .update(creatorMarketplacePackageIdentityPreimage(
      resource.publisher.id,
      resource.packageId,
    ))
    .digest("hex");
  return `${MARKET_SOCIAL_KEY_PREFIX}${packageHash}`;
}

function isoDate(value: Date | null | undefined): string {
  return (value ?? new Date()).toISOString();
}

function boundedText(
  value: unknown,
  fallback: string,
  maximum: number,
): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : fallback;
}

function nullableBoundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function normalizedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const tag = candidate.trim().slice(
      0,
      CREATOR_MARKETPLACE_SOCIAL_TAG_MAX_CHARACTERS,
    );
    if (!tag) continue;
    unique.add(tag);
    if (unique.size >= CREATOR_MARKETPLACE_SOCIAL_MAX_TAGS) break;
  }
  return [...unique];
}

function fallbackReviewQualification(
  evidence: MembershipEvidence | undefined,
): ReviewEligibility {
  if (
    evidence?.studioInstallVerified
    && evidence.lastConfirmedResourceVersion
  ) {
    return {
      qualification: "studio",
      installedResourceVersion: evidence.lastConfirmedResourceVersion,
    };
  }
  return {
    qualification: "library",
    installedResourceVersion: null,
  };
}

function serializeReview(
  input: UpsertCreatorMarketplaceSocialReview,
  resource: CreatorMarketplaceResourceRecord,
  eligibility: ReviewEligibility,
): string {
  const payload: StoredMarketReviewPayload = {
    schema: MARKET_REVIEW_STORAGE_SCHEMA,
    title: input.title,
    content: input.content,
    roleTag: input.roleTag || null,
    qualification: eligibility.qualification,
    sourceResourceVersion: resource.resourceVersion,
    installedResourceVersion: eligibility.installedResourceVersion,
  };
  return JSON.stringify(payload);
}

function parseStoredReview(
  value: string,
  resource: CreatorMarketplaceResourceRecord,
  evidence: MembershipEvidence | undefined,
): StoredMarketReviewPayload {
  const fallbackEligibility = fallbackReviewQualification(evidence);
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const title = boundedText(
      parsed.title,
      "Studio 활용 리뷰",
      CREATOR_MARKETPLACE_SOCIAL_REVIEW_TITLE_MAX_CHARACTERS,
    );
    const content = boundedText(
      parsed.content,
      "작성된 리뷰 내용이 없습니다.",
      CREATOR_MARKETPLACE_SOCIAL_REVIEW_MAX_CHARACTERS,
    );
    const roleTag = nullableBoundedText(
      parsed.roleTag,
      CREATOR_MARKETPLACE_SOCIAL_ROLE_MAX_CHARACTERS,
    );

    if (parsed.schema === MARKET_REVIEW_STORAGE_SCHEMA) {
      const qualification = parsed.qualification === "studio"
        && typeof parsed.installedResourceVersion === "string"
        && parsed.installedResourceVersion.trim()
        ? "studio"
        : "library";
      return {
        schema: MARKET_REVIEW_STORAGE_SCHEMA,
        title,
        content,
        roleTag,
        qualification,
        sourceResourceVersion: boundedText(
          parsed.sourceResourceVersion,
          resource.resourceVersion,
          40,
        ),
        installedResourceVersion: qualification === "studio"
          ? boundedText(
              parsed.installedResourceVersion,
              resource.resourceVersion,
              40,
            )
          : null,
      };
    }

    if (parsed.schema === LEGACY_MARKET_REVIEW_STORAGE_SCHEMA) {
      return {
        schema: MARKET_REVIEW_STORAGE_SCHEMA,
        title,
        content,
        roleTag,
        qualification: fallbackEligibility.qualification,
        sourceResourceVersion: resource.resourceVersion,
        installedResourceVersion: fallbackEligibility.installedResourceVersion,
      };
    }
  } catch {
    // Older or malformed rows remain readable as a plain review body.
  }
  return {
    schema: MARKET_REVIEW_STORAGE_SCHEMA,
    title: "Studio 활용 리뷰",
    content: boundedText(
      value,
      "작성된 리뷰 내용이 없습니다.",
      CREATOR_MARKETPLACE_SOCIAL_REVIEW_MAX_CHARACTERS,
    ),
    roleTag: null,
    qualification: fallbackEligibility.qualification,
    sourceResourceVersion: resource.resourceVersion,
    installedResourceVersion: fallbackEligibility.installedResourceVersion,
  };
}

function authorBadge(
  userId: string,
  resource: CreatorMarketplaceResourceRecord,
  evidence: ReadonlyMap<string, MembershipEvidence>,
): CreatorMarketplaceSocialAuthorBadge {
  if (userId === resource.publisher.id) return "publisher";
  const membership = evidence.get(userId);
  if (membership?.studioInstallVerified) return "studio-verified";
  if (membership) return "library-member";
  return "member";
}

function authorFromRow(
  row: SocialUserRow,
  resource: CreatorMarketplaceResourceRecord,
  evidence: ReadonlyMap<string, MembershipEvidence>,
  deleted = false,
): CreatorMarketplaceSocialAuthor {
  if (deleted) {
    return {
      id: "deleted",
      name: "삭제됨",
      avatar: null,
      badge: "member",
    };
  }
  return {
    id: row.userId,
    name: boundedText(row.authorName, "창작자", 80),
    avatar: nullableBoundedText(
      row.avatarImage || row.avatarColor,
      2_048,
    ),
    badge: authorBadge(row.userId, resource, evidence),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

@Injectable()
export class CreatorMarketplaceSocialService {
  constructor(
    @Inject(CreatorMarketplaceService)
    private readonly marketplaceService: CreatorMarketplaceService,
  ) {}

  private async visibleResource(
    resourceId: string,
  ): Promise<CreatorMarketplaceResourceRecord> {
    return this.marketplaceService.getById(resourceId);
  }

  private async membershipEvidence(
    resource: CreatorMarketplaceResourceRecord,
    userIds: readonly string[],
  ): Promise<Map<string, MembershipEvidence>> {
    const uniqueUserIds = uniqueStrings(userIds);
    if (uniqueUserIds.length === 0) return new Map();

    const rows = await db
      .select({
        userId: creatorMarketplaceLibraryItems.userId,
        archivedAt: creatorMarketplaceLibraryItems.archivedAt,
        lastConfirmedAt: creatorMarketplaceLibraryItems.lastConfirmedAt,
        lastConfirmedResourceVersion:
          creatorMarketplaceLibraryItems.lastConfirmedResourceVersion,
      })
      .from(creatorMarketplaceLibraryItems)
      .where(and(
        inArray(creatorMarketplaceLibraryItems.userId, uniqueUserIds),
        eq(creatorMarketplaceLibraryItems.publisherId, resource.publisher.id),
        eq(creatorMarketplaceLibraryItems.packageId, resource.packageId),
      ));

    return new Map(rows.map((row) => [
      row.userId,
      {
        membership: row.archivedAt ? "archived" : "active",
        studioInstallVerified: Boolean(
          row.lastConfirmedAt && row.lastConfirmedResourceVersion,
        ),
        lastConfirmedResourceVersion: row.lastConfirmedResourceVersion,
      } satisfies MembershipEvidence,
    ]));
  }

  private async assertReviewEligible(
    resource: CreatorMarketplaceResourceRecord,
    userId: string,
  ): Promise<ReviewEligibility> {
    if (resource.publisher.id === userId) {
      throw new ForbiddenException(
        "배급자는 자신의 리소스를 평가할 수 없습니다.",
      );
    }
    const evidence = await this.membershipEvidence(resource, [userId]);
    const membership = evidence.get(userId);
    if (!membership) {
      throw new ForbiddenException(
        "계정 라이브러리에 리소스를 추가한 뒤 평가할 수 있습니다.",
      );
    }
    if (membership.studioInstallVerified) {
      return {
        qualification: "studio",
        installedResourceVersion: membership.lastConfirmedResourceVersion,
      };
    }
    if (studioVerificationSupported(resource)) {
      throw new ForbiddenException(
        "Studio에서 설치를 완료한 뒤 평가할 수 있습니다.",
      );
    }
    return {
      qualification: "library",
      installedResourceVersion: null,
    };
  }

  async page(
    resourceId: string,
    viewerId: string | null,
  ): Promise<CreatorMarketplaceSocialPage> {
    const resource = await this.visibleResource(resourceId);
    const key = socialKey(resource);
    const rootLimit = CREATOR_MARKETPLACE_SOCIAL_COMMENT_PAGE_SIZE;
    const replyLimit = rootLimit * 5;
    const reviewLimit = CREATOR_MARKETPLACE_SOCIAL_REVIEW_PAGE_SIZE;

    const commentSelect = {
      id: reviewReplies.id,
      parentId: reviewReplies.parentId,
      text: reviewReplies.text,
      deletedAt: reviewReplies.deletedAt,
      createdAt: reviewReplies.createdAt,
      userId: users.id,
      authorName: users.name,
      avatarImage: users.image,
      avatarColor: users.avatar,
    };
    const reviewSelect = {
      id: reviews.id,
      rating: reviews.rating,
      text: reviews.text,
      tags: reviews.tags,
      createdAt: reviews.createdAt,
      userId: users.id,
      authorName: users.name,
      avatarImage: users.image,
      avatarColor: users.avatar,
    };

    const [
      rootRows,
      reviewRowsWithSentinel,
      myReviewRows,
      commentCountRows,
      statsRows,
    ] = await Promise.all([
      db
        .select(commentSelect)
        .from(reviewReplies)
        .innerJoin(users, eq(reviewReplies.userId, users.id))
        .where(and(
          eq(reviewReplies.reviewId, key),
          isNull(reviewReplies.parentId),
        ))
        .orderBy(desc(reviewReplies.createdAt), desc(reviewReplies.id))
        .limit(rootLimit + 1),
      db
        .select(reviewSelect)
        .from(reviews)
        .innerJoin(users, eq(reviews.userId, users.id))
        .where(and(
          eq(reviews.titleId, key),
          eq(reviews.hidden, false),
        ))
        .orderBy(desc(reviews.createdAt), desc(reviews.id))
        .limit(reviewLimit + 1),
      viewerId
        ? db
            .select(reviewSelect)
            .from(reviews)
            .innerJoin(users, eq(reviews.userId, users.id))
            .where(and(
              eq(reviews.titleId, key),
              eq(reviews.userId, viewerId),
              eq(reviews.hidden, false),
            ))
            .limit(1)
        : Promise.resolve([]),
      db
        .select({ count: sql<number>`count(*)` })
        .from(reviewReplies)
        .where(eq(reviewReplies.reviewId, key)),
      db
        .select({
          total: sql<number>`count(*)`,
          average: sql<number>`coalesce(avg(${reviews.rating}) / 10.0, 0)`,
          recommend: sql<number>`count(*) filter (where ${reviews.rating} >= 40)`,
          one: sql<number>`count(*) filter (where ${reviews.rating} = 10)`,
          two: sql<number>`count(*) filter (where ${reviews.rating} = 20)`,
          three: sql<number>`count(*) filter (where ${reviews.rating} = 30)`,
          four: sql<number>`count(*) filter (where ${reviews.rating} = 40)`,
          five: sql<number>`count(*) filter (where ${reviews.rating} = 50)`,
        })
        .from(reviews)
        .where(and(
          eq(reviews.titleId, key),
          eq(reviews.hidden, false),
        )),
    ]);

    const rootPage = rootRows.slice(0, rootLimit);
    const rootIds = rootPage.map((row) => row.id);
    const replyRows = rootIds.length > 0
      ? await db
          .select(commentSelect)
          .from(reviewReplies)
          .innerJoin(users, eq(reviewReplies.userId, users.id))
          .where(and(
            eq(reviewReplies.reviewId, key),
            inArray(reviewReplies.parentId, rootIds),
          ))
          .orderBy(asc(reviewReplies.createdAt), asc(reviewReplies.id))
          .limit(replyLimit + 1)
      : [];
    const replyPage = replyRows.slice(0, replyLimit);
    const commentRows = [...rootPage, ...replyPage];
    const reviewRows = reviewRowsWithSentinel.slice(0, reviewLimit);
    const myReviewRow = myReviewRows[0];
    if (
      myReviewRow
      && !reviewRows.some((candidate) => candidate.id === myReviewRow.id)
    ) {
      reviewRows.push(myReviewRow);
    }

    const authorIds = uniqueStrings([
      ...commentRows.map((row) => row.userId),
      ...reviewRows.map((row) => row.userId),
      ...(viewerId ? [viewerId] : []),
    ]);
    const evidence = await this.membershipEvidence(resource, authorIds);
    const interactionIds = uniqueStrings([
      ...commentRows.map((row) => row.id),
      ...reviewRows.map((row) => row.id),
    ]);

    const [likeCountRows, viewerLikeRows, viewerIsAdmin] = await Promise.all([
      interactionIds.length > 0
        ? db
            .select({
              interactionId: reviewLikes.reviewId,
              count: sql<number>`count(*)`,
            })
            .from(reviewLikes)
            .where(inArray(reviewLikes.reviewId, interactionIds))
            .groupBy(reviewLikes.reviewId)
        : Promise.resolve([]),
      viewerId && interactionIds.length > 0
        ? db
            .select({ interactionId: reviewLikes.reviewId })
            .from(reviewLikes)
            .where(and(
              eq(reviewLikes.userId, viewerId),
              inArray(reviewLikes.reviewId, interactionIds),
            ))
        : Promise.resolve([]),
      isAdminUser(viewerId),
    ]);
    const likeCounts = new Map(likeCountRows.map((row) => [
      row.interactionId,
      Number(row.count),
    ]));
    const viewerLikes = new Set(
      viewerLikeRows.map((row) => row.interactionId),
    );

    const viewerEvidence = viewerId ? evidence.get(viewerId) : undefined;
    const viewerIsPublisher = viewerId === resource.publisher.id;
    const verificationSupported = studioVerificationSupported(resource);
    const reviewRequirement = !viewerId
      ? "login"
      : viewerIsPublisher
        ? "publisher-cannot-review"
        : !viewerEvidence
          ? "add-to-library"
          : verificationSupported && !viewerEvidence.studioInstallVerified
            ? "open-in-studio"
            : "none";
    const reviewQualification = reviewRequirement !== "none"
      ? "none"
      : viewerEvidence?.studioInstallVerified
        ? "studio"
        : "library";
    const totalReviews = Number(statsRows[0]?.total ?? 0);
    const recommended = Number(statsRows[0]?.recommend ?? 0);
    const totalCommentCount = Number(commentCountRows[0]?.count ?? 0);

    return CreatorMarketplaceSocialPageSchema.parse({
      resourceId,
      publisherId: resource.publisher.id,
      packageId: resource.packageId,
      resourceVersion: resource.resourceVersion,
      comments: commentRows.map((row) => {
        const deleted = Boolean(row.deletedAt);
        return {
          id: row.id,
          resourceId,
          parentId: row.parentId,
          depth: row.parentId ? 1 : 0,
          author: authorFromRow(row, resource, evidence, deleted),
          content: deleted
            ? ""
            : boundedText(
                row.text,
                "",
                CREATOR_MARKETPLACE_SOCIAL_COMMENT_MAX_CHARACTERS,
              ),
          deleted,
          likeCount: deleted ? 0 : (likeCounts.get(row.id) ?? 0),
          likedByViewer: !deleted && viewerLikes.has(row.id),
          canDelete: !deleted && Boolean(
            viewerId && (viewerId === row.userId || viewerIsAdmin),
          ),
          createdAt: isoDate(row.createdAt),
        };
      }),
      reviews: reviewRows.map((row) => {
        const payload = parseStoredReview(
          row.text,
          resource,
          evidence.get(row.userId),
        );
        return {
          id: row.id,
          resourceId,
          author: authorFromRow(row, resource, evidence),
          rating: Math.max(1, Math.min(5, Math.round(row.rating / 10))),
          title: payload.title,
          content: payload.content,
          roleTag: payload.roleTag,
          tags: normalizedTags(row.tags),
          qualification: payload.qualification,
          sourceResourceVersion: payload.sourceResourceVersion,
          installedResourceVersion: payload.installedResourceVersion,
          helpfulCount: likeCounts.get(row.id) ?? 0,
          helpfulByViewer: viewerLikes.has(row.id),
          isMine: row.userId === viewerId,
          canDelete: Boolean(viewerId && viewerId === row.userId),
          createdAt: isoDate(row.createdAt),
        };
      }),
      stats: {
        average: Number(statsRows[0]?.average ?? 0),
        totalCount: totalReviews,
        recommendPercentage: totalReviews > 0
          ? Math.round((recommended / totalReviews) * 100)
          : 0,
        distribution: {
          "1": Number(statsRows[0]?.one ?? 0),
          "2": Number(statsRows[0]?.two ?? 0),
          "3": Number(statsRows[0]?.three ?? 0),
          "4": Number(statsRows[0]?.four ?? 0),
          "5": Number(statsRows[0]?.five ?? 0),
        },
      },
      viewer: {
        authenticated: Boolean(viewerId),
        libraryMembership: viewerEvidence?.membership ?? "none",
        studioVerificationSupported: verificationSupported,
        studioInstallVerified: viewerEvidence?.studioInstallVerified ?? false,
        canComment: Boolean(viewerId),
        canReview: reviewRequirement === "none",
        reviewQualification,
        reviewRequirement,
        myReviewId: myReviewRow?.id ?? null,
      },
      totalCommentCount,
      generatedAt: new Date().toISOString(),
      truncated: {
        comments: rootRows.length > rootLimit
          || replyRows.length > replyLimit
          || totalCommentCount > commentRows.length,
        reviews: reviewRowsWithSentinel.length > reviewLimit,
      },
    });
  }

  async createComment(
    resourceId: string,
    userId: string,
    input: CreateCreatorMarketplaceSocialComment,
  ): Promise<CreatorMarketplaceSocialPage> {
    const resource = await this.visibleResource(resourceId);
    const key = socialKey(resource);
    const parentId = input.parentId ?? null;

    if (parentId) {
      const [parent] = await db
        .select({
          id: reviewReplies.id,
          parentId: reviewReplies.parentId,
          deletedAt: reviewReplies.deletedAt,
        })
        .from(reviewReplies)
        .where(and(
          eq(reviewReplies.id, parentId),
          eq(reviewReplies.reviewId, key),
        ))
        .limit(1);
      if (!parent) {
        throw new NotFoundException("답글 대상 댓글을 찾을 수 없습니다.");
      }
      if (parent.parentId) {
        throw new BadRequestException(
          "답글은 한 단계까지만 작성할 수 있습니다.",
        );
      }
      if (parent.deletedAt) {
        throw new BadRequestException(
          "삭제된 댓글에는 답글을 작성할 수 없습니다.",
        );
      }
    }

    await db.insert(reviewReplies).values({
      id: crypto.randomUUID(),
      reviewId: key,
      parentId,
      userId,
      text: input.content,
      spoiler: false,
    });
    return this.page(resourceId, userId);
  }

  async deleteComment(
    resourceId: string,
    commentId: string,
    userId: string,
  ): Promise<CreatorMarketplaceSocialPage> {
    const resource = await this.visibleResource(resourceId);
    const key = socialKey(resource);
    const [comment] = await db
      .select({
        id: reviewReplies.id,
        ownerId: reviewReplies.userId,
        deletedAt: reviewReplies.deletedAt,
      })
      .from(reviewReplies)
      .where(and(
        eq(reviewReplies.id, commentId),
        eq(reviewReplies.reviewId, key),
      ))
      .limit(1);
    if (!comment) throw new NotFoundException("댓글을 찾을 수 없습니다.");
    if (comment.deletedAt) return this.page(resourceId, userId);
    if (comment.ownerId !== userId && !(await isAdminUser(userId))) {
      throw new ForbiddenException("작성자만 댓글을 삭제할 수 있습니다.");
    }

    await db.transaction(async (transaction) => {
      const [child] = await transaction
        .select({ id: reviewReplies.id })
        .from(reviewReplies)
        .where(and(
          eq(reviewReplies.reviewId, key),
          eq(reviewReplies.parentId, commentId),
        ))
        .limit(1);
      await transaction
        .delete(reviewLikes)
        .where(eq(reviewLikes.reviewId, commentId));
      if (child) {
        await transaction
          .update(reviewReplies)
          .set({ text: "", deletedAt: new Date() })
          .where(eq(reviewReplies.id, commentId));
      } else {
        await transaction
          .delete(reviewReplies)
          .where(eq(reviewReplies.id, commentId));
      }
    });
    return this.page(resourceId, userId);
  }

  async toggleCommentLike(
    resourceId: string,
    commentId: string,
    userId: string,
  ): Promise<CreatorMarketplaceSocialPage> {
    const resource = await this.visibleResource(resourceId);
    const key = socialKey(resource);
    const [comment] = await db
      .select({ id: reviewReplies.id, deletedAt: reviewReplies.deletedAt })
      .from(reviewReplies)
      .where(and(
        eq(reviewReplies.id, commentId),
        eq(reviewReplies.reviewId, key),
      ))
      .limit(1);
    if (!comment || comment.deletedAt) {
      throw new NotFoundException("댓글을 찾을 수 없습니다.");
    }

    await db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ userId: reviewLikes.userId })
        .from(reviewLikes)
        .where(and(
          eq(reviewLikes.userId, userId),
          eq(reviewLikes.reviewId, commentId),
        ))
        .limit(1);
      if (existing) {
        await transaction.delete(reviewLikes).where(and(
          eq(reviewLikes.userId, userId),
          eq(reviewLikes.reviewId, commentId),
        ));
      } else {
        await transaction.insert(reviewLikes).values({
          userId,
          reviewId: commentId,
        }).onConflictDoNothing();
      }
    });
    return this.page(resourceId, userId);
  }

  async upsertReview(
    resourceId: string,
    userId: string,
    input: UpsertCreatorMarketplaceSocialReview,
  ): Promise<CreatorMarketplaceSocialPage> {
    const resource = await this.visibleResource(resourceId);
    const eligibility = await this.assertReviewEligible(resource, userId);
    const key = socialKey(resource);

    await db
      .insert(reviews)
      .values({
        id: crypto.randomUUID(),
        userId,
        titleId: key,
        rating: input.rating * 10,
        text: serializeReview(input, resource, eligibility),
        tags: input.tags,
        spoiler: false,
        hidden: false,
      })
      .onConflictDoUpdate({
        target: [reviews.userId, reviews.titleId],
        set: {
          rating: input.rating * 10,
          text: serializeReview(input, resource, eligibility),
          tags: input.tags,
          spoiler: false,
          hidden: false,
        },
      });
    return this.page(resourceId, userId);
  }

  async deleteReview(
    resourceId: string,
    userId: string,
  ): Promise<CreatorMarketplaceSocialPage> {
    const resource = await this.visibleResource(resourceId);
    const key = socialKey(resource);
    const [review] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(
        eq(reviews.titleId, key),
        eq(reviews.userId, userId),
      ))
      .limit(1);
    if (!review) throw new NotFoundException("내 리뷰를 찾을 수 없습니다.");

    await db.transaction(async (transaction) => {
      await transaction
        .delete(reviewLikes)
        .where(eq(reviewLikes.reviewId, review.id));
      await transaction.delete(reviews).where(eq(reviews.id, review.id));
    });
    return this.page(resourceId, userId);
  }

  async toggleReviewHelpful(
    resourceId: string,
    reviewId: string,
    userId: string,
  ): Promise<CreatorMarketplaceSocialPage> {
    const resource = await this.visibleResource(resourceId);
    const key = socialKey(resource);
    const [review] = await db
      .select({ id: reviews.id, ownerId: reviews.userId })
      .from(reviews)
      .where(and(
        eq(reviews.id, reviewId),
        eq(reviews.titleId, key),
        eq(reviews.hidden, false),
      ))
      .limit(1);
    if (!review) throw new NotFoundException("리뷰를 찾을 수 없습니다.");
    if (review.ownerId === userId) {
      throw new ForbiddenException(
        "자신의 리뷰에는 도움 반응을 남길 수 없습니다.",
      );
    }

    await db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ userId: reviewLikes.userId })
        .from(reviewLikes)
        .where(and(
          eq(reviewLikes.userId, userId),
          eq(reviewLikes.reviewId, reviewId),
        ))
        .limit(1);
      if (existing) {
        await transaction.delete(reviewLikes).where(and(
          eq(reviewLikes.userId, userId),
          eq(reviewLikes.reviewId, reviewId),
        ));
      } else {
        await transaction.insert(reviewLikes).values({
          userId,
          reviewId,
        }).onConflictDoNothing();
      }
    });
    return this.page(resourceId, userId);
  }
}
