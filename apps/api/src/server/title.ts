import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { fromDb } from "../../../web/src/shared/lib/api-helpers";
import { similarTitles } from "../../../web/src/shared/lib/recommend";
import { TITLES, getTitle, originalOf, adaptationsOf } from "../../../../packages/core/src/server/catalog-store";
import { db, reviewLikes, reviews, users } from "../db";

import type { SeedReview, Title  } from "../../../web/src/shared/lib/types";


async function getTitleDbReviews(titleId: string): Promise<SeedReview[]> {
  try {
  const rows = await db
    .select({
      id: reviews.id,
      userId: reviews.userId,
      titleId: reviews.titleId,
      rating: reviews.rating,
      text: reviews.text,
      tags: reviews.tags,
      spoiler: reviews.spoiler,
      createdAt: reviews.createdAt,
      author: users.name,
      avatar: users.avatar,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.userId, users.id))
    .where(and(eq(reviews.titleId, titleId)))
    .orderBy(desc(reviews.createdAt));

  const ids = rows.map((r) => r.id);
  const counts = ids.length
    ? await db
        .select({ reviewId: reviewLikes.reviewId, count: sql<number>`count(*)`.as("count") })
        .from(reviewLikes)
        .where(inArray(reviewLikes.reviewId, ids))
        .groupBy(reviewLikes.reviewId)
    : [];
  const likeCounts = new Map(counts.map((row) => [row.reviewId, Number(row.count)]));

  return rows.map((row) => ({
    id: row.id,
    titleId: row.titleId,
    userId: row.userId,
    author: row.author ?? "익명",
    avatar: row.avatar ?? "#7c5cfc",
    rating: fromDb(row.rating),
    text: row.text,
    tags: row.tags ?? [],
    spoiler: !!row.spoiler,
    likes: likeCounts.get(row.id) ?? 0,
    createdAt: new Date(row.createdAt ?? Date.now()).toISOString(),
    progress: "정주행중",
  }));
  } catch {
    // 리뷰 DB(Neon) 불가(쿼터/장애) 시 빈 목록으로 폴백 — 카탈로그 상세/OG 는 정상 동작.
    return [];
  }
}

export function findTitle(identifier: string): Title | null {
  return getTitle(identifier) ?? null;
}

export function getTitleStaticParams() {
  return TITLES.map((t) => ({ slug: t.slug }));
}

export function getTitleSitemapEntries(baseUrl: string) {
  return TITLES.map((t) => ({
    url: `${baseUrl}/title/${t.slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));
}

export async function getTitleDetail(identifier: string) {
  const title = findTitle(identifier);
  if (!title) return null;

  const dbReviews = await getTitleDbReviews(title.id);
  const allReviews = [...dbReviews].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const similar = similarTitles(TITLES, title, 8);
  const original = originalOf(title) ?? title;
  const adaptations = adaptationsOf(original);
  const reviewCount = allReviews.length;
  const reviewAvg = reviewCount > 0 ? allReviews.reduce((s, r) => s + r.rating, 0) / reviewCount : 0;

  return {
    title,
    reviews: allReviews,
    similar,
    original,
    adaptations,
    hasFamily: adaptations.length > 0,
    reviewAvg,
    reviewCount,
    generatedAt: new Date().toISOString(),
    source: "server-catalog",
  };
}
