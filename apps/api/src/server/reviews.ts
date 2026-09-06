import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  notLike,
  sql,
  type SQL,
} from "drizzle-orm";

import { fromDb } from "../../../web/src/shared/lib/api-helpers";
import { getTitle } from "../../../../packages/core/src/server/catalog-store";
import { db, reviewLikes, reviews, users } from "../db";

export type ReviewSort = "recent" | "likes" | "high" | "low";

const MARKET_REVIEW_TITLE_PREFIX = "toonspectrum:market-package:";
const NON_MARKET_REVIEW_CONDITION = notLike(
  reviews.titleId,
  `${MARKET_REVIEW_TITLE_PREFIX}%`,
);

export async function getReviewGlobalStats() {
  try {
    const rows = await db
      .select({
        total: sql<number>`count(*)`.as("total"),
        distinctUsers: sql<number>`count(distinct ${reviews.userId})`.as("distinctUsers"),
        distinctTitles: sql<number>`count(distinct ${reviews.titleId})`.as("distinctTitles"),
      })
      .from(reviews)
      .where(NON_MARKET_REVIEW_CONDITION);

    const first = rows[0];
    return {
      total: Number(first?.total ?? 0),
      distinctUsers: Number(first?.distinctUsers ?? 0),
      distinctTitles: Number(first?.distinctTitles ?? 0),
    };
  } catch {
    return {
      total: 0,
      distinctUsers: 0,
      distinctTitles: 0,
    };
  }
}

const SORTS: ReviewSort[] = ["recent", "likes", "high", "low"];

type ReviewWithTitle = {
  id: string;
  titleId: string;
  userId: string;
  author: string;
  avatar: string;
  rating: number;
  text: string;
  tags: string[];
  spoiler: boolean;
  likes: number;
  createdAt: string;
  progress: "완독" | "정주행중" | "하차" | "정주행 예정";
  title: NonNullable<ReturnType<typeof getTitle>>;
};

export function normalizeReviewSort(sort?: string): ReviewSort {
  return SORTS.includes(sort as ReviewSort) ? (sort as ReviewSort) : "recent";
}

function sortReviews<T extends { createdAt: string; likes: number; rating: number }>(
  list: T[],
  sort: ReviewSort,
): T[] {
  const copy = [...list];
  switch (sort) {
    case "likes":
      return copy.sort(
        (a, b) => b.likes - a.likes || b.createdAt.localeCompare(a.createdAt),
      );
    case "high":
      return copy.sort((a, b) => b.rating - a.rating);
    case "low":
      return copy.sort((a, b) => a.rating - b.rating);
    case "recent":
    default:
      return copy.sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      );
  }
}

function buildReviewFeedFromRows(feedRows: ReviewWithTitle[]) {
  const total = feedRows.length;
  const avg = total
    ? feedRows.reduce((sum, review) => sum + review.rating, 0) / total
    : 0;
  const spoilerCount = feedRows.filter((review) => review.spoiler).length;
  const spoilerPct = total ? Math.round((spoilerCount / total) * 100) : 0;
  const distinctTitles = new Set(feedRows.map((review) => review.title.id)).size;

  const byTitle = new Map<string, number>();
  for (const review of feedRows) {
    byTitle.set(review.titleId, (byTitle.get(review.titleId) ?? 0) + 1);
  }
  const topReviewed = Array.from(byTitle.entries())
    .map(([titleId, count]) => ({ title: getTitle(titleId), count }))
    .filter((entry): entry is {
      title: NonNullable<ReturnType<typeof getTitle>>;
      count: number;
    } => Boolean(entry.title))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { total, avg, spoilerPct, distinctTitles, topReviewed };
}

export async function getReviewsData(opts: {
  sort?: string;
  spoiler?: string;
  rating?: string;
  userId?: string;
  includeHidden?: boolean;
}) {
  const sort = normalizeReviewSort(opts.sort);
  const conditions: SQL[] = [NON_MARKET_REVIEW_CONDITION];
  if (opts.userId) conditions.push(eq(reviews.userId, opts.userId));
  if (opts.spoiler === "hide") conditions.push(eq(reviews.spoiler, false));
  if (opts.rating === "high") conditions.push(gte(reviews.rating, 40));
  else if (opts.rating === "low") conditions.push(lte(reviews.rating, 30));
  if (!opts.includeHidden) conditions.push(eq(reviews.hidden, false));

  try {
    const dbRows = await db
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
      .where(and(...conditions))
      .orderBy(desc(reviews.createdAt));

    const reviewIds = dbRows.map((review) => review.id);
    const likeRows = reviewIds.length > 0
      ? await db
          .select({
            reviewId: reviewLikes.reviewId,
            count: sql<number>`count(*)`.as("count"),
          })
          .from(reviewLikes)
          .where(inArray(reviewLikes.reviewId, reviewIds))
          .groupBy(reviewLikes.reviewId)
      : [];
    const likeCount = new Map(
      likeRows.map((row) => [row.reviewId, Number(row.count)]),
    );

    const feedRaw = dbRows
      .map((row) => {
        const title = getTitle(row.titleId);
        if (!title) return null;
        const item: ReviewWithTitle = {
          id: row.id,
          titleId: row.titleId,
          userId: row.userId,
          author: row.author ?? "익명",
          avatar: row.avatar ?? "#7c5cfc",
          rating: fromDb(row.rating),
          text: row.text,
          tags: row.tags ?? [],
          spoiler: Boolean(row.spoiler),
          likes: likeCount.get(row.id) ?? 0,
          createdAt: new Date(row.createdAt ?? Date.now()).toISOString(),
          progress: "정주행중",
          title,
        };
        return item;
      })
      .filter((review): review is ReviewWithTitle => review !== null);

    const feed = sortReviews(feedRaw, sort);
    const { total, avg, spoilerPct, distinctTitles, topReviewed } =
      buildReviewFeedFromRows(feedRaw);

    return {
      sort,
      feed,
      topReviewed,
      stats: { total, avg, spoilerPct, distinctTitles },
      generatedAt: new Date().toISOString(),
      source: "database",
    };
  } catch {
    const feed: ReviewWithTitle[] = [];
    const { total, avg, spoilerPct, distinctTitles, topReviewed } =
      buildReviewFeedFromRows(feed);

    return {
      sort,
      feed,
      topReviewed,
      stats: { total, avg, spoilerPct, distinctTitles },
      generatedAt: new Date().toISOString(),
      source: "database",
    };
  }
}
