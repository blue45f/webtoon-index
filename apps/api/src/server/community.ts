import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

import { validateAttachmentImages } from "../../../web/src/shared/lib/image-attach";
import {
  communityCafeMembers,
  communityCafes,
  db,
  dbClient,
  fanPostReplies,
  fanPosts,
  reviewReplies,
  users,
} from "../db";

import type {
  CommunityCafe,
  FanCafePost,
  FanCafePostKind,
  FanCafeReply,
  FanCafeScope,
  FanCafeScopeFilter,
  FanCafePostList,
  FanCafeBoard,
  ReviewReply,
} from "../../../web/src/shared/lib/types";
import type { SQL } from "drizzle-orm";

export interface ValidatedFanPostInput {
  scope: FanCafeScope;
  targetId: string;
  targetLabel: string;
  kind: FanCafePostKind;
  title: string;
  text: string;
  tags: string[];
  images: string[];
}

const POST_KINDS = new Set<FanCafePostKind>(["talk", "theory", "fanart", "cheer"]);
const POST_SORTS = new Set<"recent" | "popular">(["recent", "popular"]);
const SCOPES = new Set<FanCafeScope>(["title", "author", "pencafe", "cafe"]);
const SCOPE_FILTERS = new Set<FanCafeScopeFilter>(["title", "author", "pencafe", "cafe", "all"]);
const MAX_TAG_FILTER_LENGTH = 30;
const MAX_REPLY_DEPTH = 4;
const MAX_REPLY_TEXT_LENGTH = 700;
const MAX_POST_TEXT_LENGTH = 1200;
const MAX_POST_TITLE_LENGTH = 80;
const COMMUNITY_PAGE_SIZE = 20;
export type CommunityPostSort = "recent" | "popular";

let ensured = false;

async function ensureColumn(tableName: string, columnName: string, columnDef = "TEXT") {
  const info = await dbClient.execute({
    sql: "SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?",
    args: [tableName, columnName],
  });
  const hasColumn = info.rows.length > 0;
  if (!hasColumn) {
    await dbClient.execute({
      sql: `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${columnName}" ${columnDef}`,
      args: [],
    });
  }
}

export async function ensureCommunityTables() {
  if (ensured) return;
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS review_reply (
      id TEXT PRIMARY KEY,
      "reviewId" TEXT NOT NULL,
      "parentId" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      spoiler BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await dbClient.execute('CREATE INDEX IF NOT EXISTS idx_review_reply_review ON review_reply("reviewId", "createdAt")');
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS fan_post (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      "targetId" TEXT NOT NULL,
      "targetLabel" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'talk',
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await dbClient.execute('CREATE INDEX IF NOT EXISTS idx_fan_post_target ON fan_post(scope, "targetId", "createdAt")');
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS fan_post_reply (
      id TEXT PRIMARY KEY,
      "postId" TEXT NOT NULL REFERENCES fan_post(id) ON DELETE CASCADE,
      "parentId" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await dbClient.execute('CREATE INDEX IF NOT EXISTS idx_fan_post_reply_post ON fan_post_reply("postId", "createdAt")');
  await dbClient.execute(
    'CREATE INDEX IF NOT EXISTS idx_fan_post_scope_target_kind_created ON fan_post(scope, "targetId", kind, "createdAt")'
  );
  await ensureColumn("fan_post_reply", "parentId");
  await dbClient.execute(
    'CREATE INDEX IF NOT EXISTS idx_fan_post_reply_parent ON fan_post_reply("parentId", "createdAt")'
  );
  // 라운드2 증분 마이그레이션 — 첨부 이미지·답글 소프트 삭제·숨김 플래그.
  await ensureColumn("fan_post", "images", "JSONB NOT NULL DEFAULT '[]'::jsonb");
  await ensureColumn("fan_post", "hidden", "BOOLEAN NOT NULL DEFAULT false");
  await ensureColumn("fan_post_reply", "deletedAt", "TIMESTAMPTZ");
  await ensureColumn("review_reply", "deletedAt", "TIMESTAMPTZ");
  // 장르 카페(소모임) — 카페 엔티티 + 멤버십. 게시글은 fan_post(scope='cafe', targetId=slug) 재사용.
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS community_cafe (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      "createdBy" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      hidden BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS community_cafe_member (
      "cafeId" TEXT NOT NULL REFERENCES community_cafe(id) ON DELETE CASCADE,
      "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      "joinedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY ("cafeId", "userId")
    )
  `);
  await dbClient.execute('CREATE INDEX IF NOT EXISTS idx_community_cafe_genre ON community_cafe(genre, "createdAt")');
  await dbClient.execute('CREATE INDEX IF NOT EXISTS idx_community_cafe_member_user ON community_cafe_member("userId")');
  ensured = true;
}

function clampId(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function buildReplyTree<T extends { id: string; parentId?: string | null; createdAt: string | number }>(
  rows: T[]
): T[] {
  const nodes = rows.map((row) => ({
    ...row,
    children: [] as T[],
  }));
  const lookup = new Map<string, T & { children: T[] }>(nodes.map((n) => [n.id, n]));
  const roots: T[] = [];
  for (const node of nodes) {
    if (node.parentId) {
      const parent = lookup.get(node.parentId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }
  return roots;
}

function safeDate(value: Date | number | null | undefined): string {
  return new Date(value ?? Date.now()).toISOString();
}

function clampText(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanMultiline(value: unknown, max: number): string {
  return normalizeMultiline(value).slice(0, max);
}

function normalizeMultiline(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeTagFilter(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return normalized.length > MAX_TAG_FILTER_LENGTH ? normalized.slice(0, MAX_TAG_FILTER_LENGTH) : normalized;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((tag) => clampText(tag, 20)).filter(Boolean).slice(0, 5);
}

function parseTagValue(value: unknown): string[] {
  if (Array.isArray(value)) return cleanTags(value);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return cleanTags(parsed);
    } catch {
      return cleanTags(value.split(/[,\n]/));
    }
  }
  return [];
}

// jsonb images 컬럼 → string[] (pg 드라이버는 배열로 주지만 방어적으로 문자열도 처리).
function parseImagesValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
    } catch {
      return [];
    }
  }
  return [];
}

function authorOf(row: { userId?: string | null; author?: string | null; avatar?: string | null }) {
  return {
    id: row.userId ?? undefined,
    name: row.author ?? "익명",
    avatar: row.avatar ?? "#7c5cfc",
  };
}

export function parseCommunityScope(value: string | null): FanCafeScope | null {
  return SCOPES.has(value as FanCafeScope) ? (value as FanCafeScope) : null;
}

export function parseCommunityScopeFilter(value: string | null): FanCafeScopeFilter | null {
  return SCOPE_FILTERS.has(value as FanCafeScopeFilter) ? (value as FanCafeScopeFilter) : null;
}

export function parsePostKind(value: unknown): FanCafePostKind {
  return POST_KINDS.has(value as FanCafePostKind) ? (value as FanCafePostKind) : "talk";
}

export function parsePostKindOrNull(value: unknown): FanCafePostKind | null {
  return POST_KINDS.has(value as FanCafePostKind) ? (value as FanCafePostKind) : null;
}

export function parsePostSort(value: unknown): CommunityPostSort {
  return POST_SORTS.has(value as CommunityPostSort) ? (value as CommunityPostSort) : "recent";
}

function parseSpoiler(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes"].includes(normalized);
  }
  return false;
}

export interface FanCafePostCursor {
  createdAt: number;
  id: string;
  replyCount?: number;
}

export function parseFanPostCursor(value: unknown): FanCafePostCursor | null {
  if (typeof value !== "string") return null;
  const [first, second, third] = value.split(":");
  const isOldCursor = third === undefined;
  const createdAtRaw = isOldCursor ? first : second;
  const idRaw = third ?? second;
  if (!createdAtRaw || !idRaw) return null;
  const createdAt = Number(createdAtRaw);
  if (!Number.isFinite(createdAt) || !idRaw.trim()) return null;
  if (isOldCursor) return { createdAt, id: idRaw };
  const replyCount = Number(first);
  return {
    createdAt,
    id: idRaw,
    replyCount: Number.isFinite(replyCount) ? replyCount : undefined,
  };
}

export function encodeFanPostCursor(cursor: FanCafePostCursor): string {
  if (cursor.replyCount === undefined) return `${cursor.createdAt}:${cursor.id}`;
  return `${cursor.replyCount}:${cursor.createdAt}:${cursor.id}`;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[%_]/g, "\\$&");
}

export function parseReplyParent(value: unknown): string | null {
  const id = clampId(value, 80);
  return id.length > 0 ? id : null;
}

export function validateReplyText(value: unknown): { text?: string; error?: string } {
  const text = cleanMultiline(value, MAX_REPLY_TEXT_LENGTH);
  if (text.length < 1) return { error: "답글 내용을 입력해 주세요." };
  return { text };
}

export function validateReplyPayload(input: unknown) {
  const body = (input ?? {}) as Record<string, unknown>;
  const parsedText = validateReplyText(body.text);
  if (parsedText.error || !parsedText.text) return { error: parsedText.error };
  return {
    text: parsedText.text,
    parentId: parseReplyParent(body.parentId),
    spoiler: parseSpoiler(body.spoiler),
  };
}

function replyDepthErrorMessage(reason: "missing" | "cycle" | "exceed") {
  if (reason === "missing") return "답글의 상위 항목을 찾을 수 없습니다.";
  if (reason === "cycle") return "답글 관계에 순환이 감지되어 처리할 수 없습니다.";
  return "답글은 최대 4단계까지만 작성할 수 있습니다.";
}

function buildTagFilterCondition(tag: string) {
  const normalized = normalizeTagFilter(tag);
  const quotedPattern = `%"${escapeLikePattern(normalized)}"%`;
  const hashtagPattern = `%#${escapeLikePattern(normalized)}%`;
  return or(
    sql`lower(${fanPosts.tags}) LIKE ${quotedPattern} ESCAPE '\\'`,
    sql`lower(${fanPosts.tags}) LIKE ${hashtagPattern} ESCAPE '\\'`
  );
}

async function getReviewReplyDepth(
  reviewId: string,
  parentId: string | null
): Promise<{ ok: true; depth: number } | { ok: false; reason: "missing" | "cycle" | "exceed" }> {
  if (!parentId) return { ok: true, depth: 0 };
  const seen = new Set<string>();
  let current: string | null = parentId;
  let depth = 0;
  while (current) {
    if (depth >= MAX_REPLY_DEPTH) return { ok: false, reason: "exceed" };
    if (seen.has(current)) return { ok: false, reason: "cycle" };
    seen.add(current);
    const parent = await db
      .select({ id: reviewReplies.id, parentId: reviewReplies.parentId })
      .from(reviewReplies)
      .where(and(eq(reviewReplies.id, current), eq(reviewReplies.reviewId, reviewId)))
      .limit(1);
    if (parent.length === 0) return { ok: false, reason: "missing" };
    if (seen.has(parent[0].parentId ?? "")) return { ok: false, reason: "cycle" };
    current = parent[0].parentId;
    depth += 1;
  }
  return { ok: true, depth };
}

async function getFanPostReplyDepth(
  postId: string,
  parentId: string | null
): Promise<{ ok: true; depth: number } | { ok: false; reason: "missing" | "cycle" | "exceed" }> {
  if (!parentId) return { ok: true, depth: 0 };
  const seen = new Set<string>();
  let current: string | null = parentId;
  let depth = 0;
  while (current) {
    if (depth >= MAX_REPLY_DEPTH) return { ok: false, reason: "exceed" };
    if (seen.has(current)) return { ok: false, reason: "cycle" };
    seen.add(current);
    const parent = await db
      .select({ id: fanPostReplies.id, postId: fanPostReplies.postId, parentId: fanPostReplies.parentId })
      .from(fanPostReplies)
      .where(and(eq(fanPostReplies.id, current), eq(fanPostReplies.postId, postId)))
      .limit(1);
    if (parent.length === 0) return { ok: false, reason: "missing" };
    if (seen.has(parent[0].parentId ?? "")) return { ok: false, reason: "cycle" };
    current = parent[0].parentId;
    depth += 1;
  }
  return { ok: true, depth };
}

export function validatePostInput(input: unknown): {
  value?: ValidatedFanPostInput;
  error?: string;
} {
  const body = (input ?? {}) as Record<string, unknown>;
  const scope = parseCommunityScope(String(body.scope ?? ""));
  const targetId = clampText(body.targetId, 160);
  const targetLabel = clampText(body.targetLabel, 120);
  const kind = parsePostKind(body.kind);
  const titleRaw = String(body.title ?? "").trim();
  const textRaw = normalizeMultiline(body.text);
  const title = clampText(titleRaw, MAX_POST_TITLE_LENGTH);
  const text = textRaw.slice(0, MAX_POST_TEXT_LENGTH);
  const tags = cleanTags(body.tags);
  const attachments = validateAttachmentImages(body.images);

  if (!scope) return { error: "팬카페 범위가 올바르지 않아요." };
  if (!targetId || !targetLabel) return { error: "팬카페 대상이 필요해요." };
  if (titleRaw.length > MAX_POST_TITLE_LENGTH) return { error: "제목은 80자 이하로 입력해 주세요." };
  if (textRaw.length > MAX_POST_TEXT_LENGTH) return { error: "본문은 1200자 이하로 입력해 주세요." };
  if (title.length < 2) return { error: "제목은 2자 이상 입력해 주세요." };
  if (text.length < 2) return { error: "본문은 2자 이상 입력해 주세요." };
  if (attachments.error || !attachments.images) return { error: attachments.error ?? "첨부를 확인해 주세요." };

  return { value: { scope, targetId, targetLabel, kind, title, text, tags, images: attachments.images } };
}

// 소프트 삭제된 답글 표시용 마스킹 — 본문·작성자를 비우고 deleted 플래그만 남긴다(스레드 구조 보존).
export function maskDeletedReply<T extends { text: string; author: { id?: string; name: string; avatar: string } }>(
  reply: T,
  deleted: boolean
): T & { deleted: boolean } {
  if (!deleted) return { ...reply, deleted: false };
  return { ...reply, deleted: true, text: "", author: { name: "삭제됨", avatar: "#5b5751" } };
}

export async function listReviewReplies(reviewId: string): Promise<ReviewReply[]> {
  await ensureCommunityTables();
  const rows = await db
    .select({
      id: reviewReplies.id,
      reviewId: reviewReplies.reviewId,
      parentId: reviewReplies.parentId,
      text: reviewReplies.text,
      spoiler: reviewReplies.spoiler,
      deletedAt: reviewReplies.deletedAt,
      createdAt: reviewReplies.createdAt,
      userId: users.id,
      author: users.name,
      avatar: users.avatar,
    })
    .from(reviewReplies)
    .innerJoin(users, eq(reviewReplies.userId, users.id))
    .where(eq(reviewReplies.reviewId, reviewId))
    .orderBy(reviewReplies.createdAt);

  const mapped = rows.map((row) =>
    maskDeletedReply(
      {
        id: row.id,
        reviewId: row.reviewId,
        parentId: row.parentId,
        author: authorOf(row),
        text: row.text,
        spoiler: row.spoiler,
        createdAt: safeDate(row.createdAt),
      },
      Boolean(row.deletedAt)
    )
  );

  return buildReplyTree(mapped);
}

// 답글 삭제(작성자 또는 관리자) — 하위 답글이 있으면 소프트 삭제(자리 표시), 없으면 행 삭제.
export async function deleteReviewReply(
  userId: string,
  reviewId: string,
  replyId: string,
  isAdmin: boolean
): Promise<{ deleted: boolean; soft: boolean }> {
  await ensureCommunityTables();
  const [existing] = await db
    .select({ id: reviewReplies.id, ownerId: reviewReplies.userId, deletedAt: reviewReplies.deletedAt })
    .from(reviewReplies)
    .where(and(eq(reviewReplies.id, replyId), eq(reviewReplies.reviewId, reviewId)))
    .limit(1);
  if (!existing) return { deleted: false, soft: false };
  if (existing.ownerId !== userId && !isAdmin) throw new Error("작성자만 삭제할 수 있습니다.");
  const [child] = await db
    .select({ id: reviewReplies.id })
    .from(reviewReplies)
    .where(eq(reviewReplies.parentId, replyId))
    .limit(1);
  if (child) {
    await db.update(reviewReplies).set({ deletedAt: new Date(), text: "" }).where(eq(reviewReplies.id, replyId));
    return { deleted: true, soft: true };
  }
  await db.delete(reviewReplies).where(eq(reviewReplies.id, replyId));
  return { deleted: true, soft: false };
}

export async function createReviewReply(input: {
  reviewId: string;
  parentId?: string | null;
  userId: string;
  text: string;
  spoiler?: boolean;
}): Promise<ReviewReply> {
  await ensureCommunityTables();
  const depthCheck = await getReviewReplyDepth(input.reviewId, input.parentId ?? null);
  if (!depthCheck.ok) {
    throw new Error(replyDepthErrorMessage(depthCheck.reason));
  }
  const id = crypto.randomUUID();
  await db.insert(reviewReplies).values({
    id,
    reviewId: input.reviewId,
    parentId: input.parentId ?? null,
    userId: input.userId,
    text: input.text,
    spoiler: !!input.spoiler,
  });
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  return {
    id,
    reviewId: input.reviewId,
    parentId: input.parentId ?? null,
    author: { id: input.userId, name: user?.name ?? "익명", avatar: user?.avatar ?? "#7c5cfc" },
    text: input.text,
    spoiler: !!input.spoiler,
    createdAt: new Date().toISOString(),
  };
}

export async function listFanPosts(
  scope: FanCafeScopeFilter,
  targetId: string | null,
  kind?: FanCafePostKind | null,
  query?: string,
  tag?: string,
  sort: CommunityPostSort = "recent",
  cursor: string | null = null,
  limit: number = COMMUNITY_PAGE_SIZE,
  authorId: string | null = null
): Promise<FanCafePostList> {
  await ensureCommunityTables();
  if (scope !== "all" && !targetId) {
    throw new Error("특정 scope에서는 targetId가 필요합니다.");
  }

  const search = String(query ?? "").trim().toLowerCase();
  const normalizedTag = normalizeTagFilter(tag);
  const parsedCursor = parseFanPostCursor(cursor);
  let whereClause: SQL | undefined;

  const addWhere = (condition: SQL | undefined) => {
    if (!condition) return;
    const nextWhere = whereClause ? and(whereClause, condition) : condition;
    if (nextWhere) whereClause = nextWhere;
  };

  if (scope !== "all") {
    addWhere(eq(fanPosts.scope, scope));
    if (targetId) addWhere(eq(fanPosts.targetId, targetId));
  }
  if (authorId) addWhere(eq(fanPosts.userId, authorId));
  addWhere(eq(fanPosts.hidden, false)); // 비노출 처리 글은 공개 목록에서 제외

  if (kind) addWhere(eq(fanPosts.kind, kind));

  if (normalizedTag) addWhere(buildTagFilterCondition(normalizedTag));

  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    addWhere(
      or(
        sql`lower(${fanPosts.title}) LIKE ${pattern} ESCAPE '\\'`,
        sql`lower(${fanPosts.text}) LIKE ${pattern} ESCAPE '\\'`,
        sql`lower(${fanPosts.targetLabel}) LIKE ${pattern} ESCAPE '\\'`
      )
    );
  }

  if (parsedCursor && (sort === "recent" || parsedCursor.replyCount === undefined)) {
    addWhere(
      or(
        sql`${fanPosts.createdAt} < ${parsedCursor.createdAt}`,
        and(sql`${fanPosts.createdAt} = ${parsedCursor.createdAt}`, sql`${fanPosts.id} < ${parsedCursor.id}`)
      )
    );
  }

  const baseSelect = {
    id: fanPosts.id,
    scope: fanPosts.scope,
    targetId: fanPosts.targetId,
    targetLabel: fanPosts.targetLabel,
    kind: fanPosts.kind,
    title: fanPosts.title,
    text: fanPosts.text,
    tags: fanPosts.tags,
    images: fanPosts.images,
    createdAt: fanPosts.createdAt,
    userId: users.id,
    author: users.name,
    avatar: users.avatar,
  };

  const replyCountExpr = sql<number>`coalesce(count(${fanPostReplies.id}), 0)`;

  if (sort === "popular") {
    let postQuery = db
      .select({
        ...baseSelect,
        replyCount: replyCountExpr.as("replyCount"),
      })
      .from(fanPosts)
      .innerJoin(users, eq(fanPosts.userId, users.id))
      .leftJoin(fanPostReplies, eq(fanPosts.id, fanPostReplies.postId))
      .$dynamic();

    if (whereClause) postQuery = postQuery.where(whereClause);

    if (parsedCursor && parsedCursor.replyCount !== undefined) {
      postQuery = postQuery.having(
        sql`(
          ${replyCountExpr} < ${parsedCursor.replyCount}
          OR (
            ${replyCountExpr} = ${parsedCursor.replyCount}
            AND (
              ${fanPosts.createdAt} < ${parsedCursor.createdAt}
              OR (${fanPosts.createdAt} = ${parsedCursor.createdAt} AND ${fanPosts.id} < ${parsedCursor.id})
            )
          )
        )`
      );
    }

    const rows = await postQuery
      .groupBy(
        fanPosts.id,
        fanPosts.scope,
        fanPosts.targetId,
        fanPosts.targetLabel,
        fanPosts.kind,
        fanPosts.title,
        fanPosts.text,
        fanPosts.tags,
        fanPosts.images,
        fanPosts.createdAt,
        users.id,
        users.name,
        users.avatar
      )
      .orderBy(desc(replyCountExpr), desc(fanPosts.createdAt), desc(fanPosts.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const dbPosts: FanCafePost[] = pageRows.map((row) => ({
      id: row.id,
      scope: row.scope as FanCafeScope,
      targetId: row.targetId,
      targetLabel: row.targetLabel,
      kind: row.kind as FanCafePostKind,
      title: row.title,
      text: row.text,
      tags: parseTagValue(row.tags),
      images: parseImagesValue(row.images),
      author: authorOf(row),
      createdAt: safeDate(row.createdAt),
      replyCount: Number(row.replyCount),
    }));

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeFanPostCursor({
            replyCount: Number(last.replyCount),
            createdAt: Number(last.createdAt),
            id: last.id,
          })
        : null;

    return {
      items: dbPosts,
      hasMore,
      nextCursor,
    };
  }

  let postQuery = db
    .select({
      ...baseSelect,
      replyCount: sql<number>`0`.as("replyCount"),
    })
    .from(fanPosts)
    .innerJoin(users, eq(fanPosts.userId, users.id))
    .$dynamic();

  if (whereClause) postQuery = postQuery.where(whereClause);

  const rows = await postQuery.orderBy(desc(fanPosts.createdAt), desc(fanPosts.id)).limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const postIds = pageRows.map((row) => row.id);
  const counts = postIds.length
    ? await db
        .select({ postId: fanPostReplies.postId, count: sql<number>`count(*)`.as("count") })
        .from(fanPostReplies)
        .where(inArray(fanPostReplies.postId, postIds))
        .groupBy(fanPostReplies.postId)
    : [];
  const replyCount = new Map(counts.map((row) => [row.postId, Number(row.count)]));

  const dbPosts: FanCafePost[] = pageRows.map((row) => ({
    id: row.id,
    scope: row.scope as FanCafeScope,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    kind: row.kind as FanCafePostKind,
    title: row.title,
    text: row.text,
    tags: parseTagValue(row.tags),
    images: parseImagesValue(row.images),
    author: authorOf(row),
    createdAt: safeDate(row.createdAt),
    replyCount: replyCount.get(row.id) ?? 0,
  }));

  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last ? encodeFanPostCursor({ createdAt: Number(last.createdAt), id: last.id }) : null;

  return {
    items: dbPosts,
    hasMore,
    nextCursor,
  };
}

export async function listCommunityBoards(
  scope: FanCafeScopeFilter,
  query?: string,
  sort: "recent" | "popular" = "popular",
  limit: number = 30
): Promise<FanCafeBoard[]> {
  await ensureCommunityTables();
  const search = String(query ?? "").trim().toLowerCase();
  let whereClause: SQL | undefined;

  const addWhere = (condition: SQL | undefined) => {
    if (!condition) return;
    const nextWhere = whereClause ? and(whereClause, condition) : condition;
    if (nextWhere) whereClause = nextWhere;
  };

  if (scope !== "all") addWhere(eq(fanPosts.scope, scope));

  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    addWhere(sql`lower(${fanPosts.targetLabel}) LIKE ${pattern} ESCAPE '\\'`);
  }

  const postCountExpr = sql<number>`count(DISTINCT ${fanPosts.id})`;
  const replyCountExpr = sql<number>`coalesce(count(${fanPostReplies.id}), 0)`;
  const latestExpr = sql<number>`max(${fanPosts.createdAt})`;

  let boardQuery = db
    .select({
      scope: fanPosts.scope,
      targetId: fanPosts.targetId,
      targetLabel: fanPosts.targetLabel,
      postCount: postCountExpr.as("postCount"),
      replyCount: replyCountExpr.as("replyCount"),
      latestPostAt: latestExpr.as("latestPostAt"),
    })
    .from(fanPosts)
    .leftJoin(fanPostReplies, eq(fanPosts.id, fanPostReplies.postId))
    .$dynamic();

  if (whereClause) boardQuery = boardQuery.where(whereClause);

  const rows = await boardQuery
    .groupBy(fanPosts.scope, fanPosts.targetId, fanPosts.targetLabel)
    .orderBy(
      ...(sort === "popular"
        ? [desc(replyCountExpr), desc(postCountExpr), desc(latestExpr)]
        : [desc(latestExpr), desc(postCountExpr)])
    )
    .limit(limit);

  return rows.map((row) => ({
    scope: row.scope as FanCafeScope,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    postCount: Number(row.postCount ?? 0),
    replyCount: Number(row.replyCount ?? 0),
    latestPostAt: safeDate(row.latestPostAt as number),
  }));
}

export async function createFanPost(userId: string, input: ValidatedFanPostInput): Promise<FanCafePost> {
  await ensureCommunityTables();
  const id = crypto.randomUUID();
  await db.insert(fanPosts).values({
    id,
    userId,
    scope: input.scope,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    kind: input.kind,
    title: input.title,
    text: input.text,
    tags: input.tags,
    images: input.images,
  });
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return {
    id,
    scope: input.scope,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    kind: input.kind,
    title: input.title,
    text: input.text,
    tags: input.tags,
    images: input.images,
    author: { id: userId, name: user?.name ?? "익명", avatar: user?.avatar ?? "#7c5cfc" },
    createdAt: new Date().toISOString(),
    replyCount: 0,
  };
}

// 토론 스레드 상세 — 단일 게시글(숨김 제외) + 답글 트리.
export async function getFanPost(postId: string): Promise<FanCafePost | null> {
  await ensureCommunityTables();
  const [row] = await db
    .select({
      id: fanPosts.id,
      scope: fanPosts.scope,
      targetId: fanPosts.targetId,
      targetLabel: fanPosts.targetLabel,
      kind: fanPosts.kind,
      title: fanPosts.title,
      text: fanPosts.text,
      tags: fanPosts.tags,
      images: fanPosts.images,
      createdAt: fanPosts.createdAt,
      userId: users.id,
      author: users.name,
      avatar: users.avatar,
    })
    .from(fanPosts)
    .innerJoin(users, eq(fanPosts.userId, users.id))
    .where(and(eq(fanPosts.id, postId), eq(fanPosts.hidden, false)))
    .limit(1);
  if (!row) return null;
  const replies = await listFanPostReplies(postId);
  return {
    id: row.id,
    scope: row.scope as FanCafeScope,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    kind: row.kind as FanCafePostKind,
    title: row.title,
    text: row.text,
    tags: parseTagValue(row.tags),
    images: parseImagesValue(row.images),
    author: authorOf(row),
    createdAt: safeDate(row.createdAt),
    replyCount: countReplyTree(replies),
    replies,
  };
}

function countReplyTree(items: { children?: unknown[] }[]): number {
  return items.reduce(
    (count, item) => count + 1 + countReplyTree((item.children ?? []) as { children?: unknown[] }[]),
    0
  );
}

// 팬카페 글 삭제(작성자 또는 관리자). FK ON DELETE CASCADE로 답글도 함께 정리된다.
export async function deleteFanPost(userId: string, id: string, isAdmin: boolean): Promise<{ deleted: boolean }> {
  await ensureCommunityTables();
  const [existing] = await db
    .select({ id: fanPosts.id, ownerId: fanPosts.userId })
    .from(fanPosts)
    .where(eq(fanPosts.id, id))
    .limit(1);
  if (!existing) return { deleted: false };
  if (existing.ownerId !== userId && !isAdmin) throw new Error("작성자만 삭제할 수 있습니다.");
  await db.delete(fanPosts).where(eq(fanPosts.id, id));
  return { deleted: true };
}

export async function listFanPostReplies(postId: string): Promise<FanCafeReply[]> {
  await ensureCommunityTables();
  const rows = await db
    .select({
      id: fanPostReplies.id,
      postId: fanPostReplies.postId,
      parentId: fanPostReplies.parentId,
      text: fanPostReplies.text,
      deletedAt: fanPostReplies.deletedAt,
      createdAt: fanPostReplies.createdAt,
      userId: users.id,
      author: users.name,
      avatar: users.avatar,
    })
    .from(fanPostReplies)
    .innerJoin(users, eq(fanPostReplies.userId, users.id))
    .where(eq(fanPostReplies.postId, postId))
    .orderBy(fanPostReplies.createdAt);

  const mapped = rows.map((row) =>
    maskDeletedReply(
      {
        id: row.id,
        postId: row.postId,
        parentId: row.parentId,
        author: authorOf(row),
        text: row.text,
        createdAt: safeDate(row.createdAt),
      },
      Boolean(row.deletedAt)
    )
  );
  return buildReplyTree(mapped);
}

// 팬카페 답글 삭제(작성자 또는 관리자) — 하위 답글이 있으면 소프트 삭제(자리 표시), 없으면 행 삭제.
export async function deleteFanPostReply(
  userId: string,
  postId: string,
  replyId: string,
  isAdmin: boolean
): Promise<{ deleted: boolean; soft: boolean }> {
  await ensureCommunityTables();
  const [existing] = await db
    .select({ id: fanPostReplies.id, ownerId: fanPostReplies.userId, deletedAt: fanPostReplies.deletedAt })
    .from(fanPostReplies)
    .where(and(eq(fanPostReplies.id, replyId), eq(fanPostReplies.postId, postId)))
    .limit(1);
  if (!existing) return { deleted: false, soft: false };
  if (existing.ownerId !== userId && !isAdmin) throw new Error("작성자만 삭제할 수 있습니다.");
  const [child] = await db
    .select({ id: fanPostReplies.id })
    .from(fanPostReplies)
    .where(eq(fanPostReplies.parentId, replyId))
    .limit(1);
  if (child) {
    await db.update(fanPostReplies).set({ deletedAt: new Date(), text: "" }).where(eq(fanPostReplies.id, replyId));
    return { deleted: true, soft: true };
  }
  await db.delete(fanPostReplies).where(eq(fanPostReplies.id, replyId));
  return { deleted: true, soft: false };
}

// ── 장르 카페(소모임) — 생성/목록/상세/가입 ──────────────────────────────────────

export const CAFE_NAME_MIN = 2;
export const CAFE_NAME_MAX = 40;
export const CAFE_DESCRIPTION_MAX = 300;

export interface ValidatedCafeInput {
  name: string;
  description: string;
  genre: string;
}

// 카페 이름 → URL slug. 한글은 보존(주소창에서 인코딩), 공백·특수문자만 정리한다.
export function slugifyCafeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function validateCafeInput(input: unknown, allowedGenres: readonly string[]): {
  value?: ValidatedCafeInput;
  error?: string;
} {
  const body = (input ?? {}) as Record<string, unknown>;
  const name = clampText(body.name, CAFE_NAME_MAX);
  const description = cleanMultiline(body.description, CAFE_DESCRIPTION_MAX);
  const genreRaw = clampText(body.genre, 20);
  if (name.length < CAFE_NAME_MIN) return { error: `카페 이름은 ${CAFE_NAME_MIN}자 이상 입력해 주세요.` };
  if (!slugifyCafeName(name)) return { error: "카페 이름에 사용할 수 있는 글자가 없어요." };
  if (description.length < 2) return { error: "카페 소개를 2자 이상 입력해 주세요." };
  if (genreRaw && !allowedGenres.includes(genreRaw)) return { error: "지원하지 않는 장르예요." };
  return { value: { name, description, genre: genreRaw } };
}

interface CafeRowShape {
  id: string;
  slug: string;
  name: string;
  description: string;
  genre: string;
  createdBy: string;
  ownerName: string | null;
  memberCount: unknown;
  postCount: unknown;
  createdAt: Date | null;
}

function mapCafeRow(row: CafeRowShape): CommunityCafe {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    genre: row.genre,
    createdBy: row.createdBy,
    ownerName: row.ownerName ?? "익명",
    memberCount: Number(row.memberCount ?? 0),
    postCount: Number(row.postCount ?? 0),
    createdAt: safeDate(row.createdAt ?? undefined),
  };
}

const cafeMemberCountExpr = sql<number>`(
  SELECT count(*) FROM community_cafe_member m WHERE m."cafeId" = ${communityCafes.id}
)`;
const cafePostCountExpr = sql<number>`(
  SELECT count(*) FROM fan_post p WHERE p.scope = 'cafe' AND p."targetId" = ${communityCafes.slug} AND p.hidden = false
)`;

export async function listCafes(options: {
  genre?: string | null;
  query?: string | null;
  sort?: "recent" | "popular";
  limit?: number;
} = {}): Promise<CommunityCafe[]> {
  await ensureCommunityTables();
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const search = String(options.query ?? "").trim().toLowerCase();
  const genre = String(options.genre ?? "").trim();

  let whereClause: SQL | undefined = eq(communityCafes.hidden, false);
  if (genre) whereClause = and(whereClause, eq(communityCafes.genre, genre));
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    const cond = or(
      sql`lower(${communityCafes.name}) LIKE ${pattern} ESCAPE '\\'`,
      sql`lower(${communityCafes.description}) LIKE ${pattern} ESCAPE '\\'`
    );
    whereClause = and(whereClause, cond);
  }

  let query = db
    .select({
      id: communityCafes.id,
      slug: communityCafes.slug,
      name: communityCafes.name,
      description: communityCafes.description,
      genre: communityCafes.genre,
      createdBy: communityCafes.createdBy,
      ownerName: users.name,
      memberCount: cafeMemberCountExpr.as("memberCount"),
      postCount: cafePostCountExpr.as("postCount"),
      createdAt: communityCafes.createdAt,
    })
    .from(communityCafes)
    .innerJoin(users, eq(communityCafes.createdBy, users.id))
    .$dynamic();
  if (whereClause) query = query.where(whereClause);

  const rows = await query
    .orderBy(
      ...(options.sort === "recent"
        ? [desc(communityCafes.createdAt)]
        : [desc(cafeMemberCountExpr), desc(cafePostCountExpr), desc(communityCafes.createdAt)])
    )
    .limit(limit);
  return rows.map(mapCafeRow);
}

export async function getCafeBySlug(slug: string, viewerId: string | null): Promise<CommunityCafe | null> {
  await ensureCommunityTables();
  const [row] = await db
    .select({
      id: communityCafes.id,
      slug: communityCafes.slug,
      name: communityCafes.name,
      description: communityCafes.description,
      genre: communityCafes.genre,
      createdBy: communityCafes.createdBy,
      ownerName: users.name,
      memberCount: cafeMemberCountExpr.as("memberCount"),
      postCount: cafePostCountExpr.as("postCount"),
      createdAt: communityCafes.createdAt,
    })
    .from(communityCafes)
    .innerJoin(users, eq(communityCafes.createdBy, users.id))
    .where(and(eq(communityCafes.slug, slug), eq(communityCafes.hidden, false)))
    .limit(1);
  if (!row) return null;
  const cafe = mapCafeRow(row);
  if (viewerId) {
    const [membership] = await db
      .select({ role: communityCafeMembers.role })
      .from(communityCafeMembers)
      .where(and(eq(communityCafeMembers.cafeId, row.id), eq(communityCafeMembers.userId, viewerId)))
      .limit(1);
    cafe.viewerIsMember = Boolean(membership);
    cafe.viewerRole = membership ? (membership.role === "owner" ? "owner" : "member") : null;
  } else {
    cafe.viewerIsMember = false;
    cafe.viewerRole = null;
  }
  return cafe;
}

export async function createCafe(userId: string, input: ValidatedCafeInput): Promise<CommunityCafe> {
  await ensureCommunityTables();
  const base = slugifyCafeName(input.name);
  let slug = base;
  // slug 충돌 시 짧은 무작위 접미사 — 손수 데이터 수정 없이 결정적으로 회피.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [existing] = await db
      .select({ id: communityCafes.id })
      .from(communityCafes)
      .where(eq(communityCafes.slug, slug))
      .limit(1);
    if (!existing) break;
    slug = `${base}-${crypto.randomUUID().slice(0, 4)}`;
  }
  const id = crypto.randomUUID();
  await db.insert(communityCafes).values({
    id,
    slug,
    name: input.name,
    description: input.description,
    genre: input.genre,
    createdBy: userId,
  });
  await db.insert(communityCafeMembers).values({ cafeId: id, userId, role: "owner" });
  const created = await getCafeBySlug(slug, userId);
  if (!created) throw new Error("카페를 생성하지 못했습니다.");
  return created;
}

export async function joinCafe(userId: string, slug: string): Promise<CommunityCafe> {
  await ensureCommunityTables();
  const cafe = await getCafeBySlug(slug, userId);
  if (!cafe) throw new Error("카페를 찾을 수 없습니다.");
  if (!cafe.viewerIsMember) {
    await db.insert(communityCafeMembers).values({ cafeId: cafe.id, userId, role: "member" }).onConflictDoNothing();
  }
  const updated = await getCafeBySlug(slug, userId);
  if (!updated) throw new Error("카페를 찾을 수 없습니다.");
  return updated;
}

export async function leaveCafe(userId: string, slug: string): Promise<CommunityCafe> {
  await ensureCommunityTables();
  const cafe = await getCafeBySlug(slug, userId);
  if (!cafe) throw new Error("카페를 찾을 수 없습니다.");
  if (cafe.viewerRole === "owner") throw new Error("카페장은 탈퇴할 수 없어요. 운영팀에 양도를 문의해 주세요.");
  await db
    .delete(communityCafeMembers)
    .where(and(eq(communityCafeMembers.cafeId, cafe.id), eq(communityCafeMembers.userId, userId)));
  const updated = await getCafeBySlug(slug, userId);
  if (!updated) throw new Error("카페를 찾을 수 없습니다.");
  return updated;
}

export async function isCafeMember(userId: string, slug: string): Promise<boolean> {
  await ensureCommunityTables();
  const [row] = await db
    .select({ userId: communityCafeMembers.userId })
    .from(communityCafeMembers)
    .innerJoin(communityCafes, eq(communityCafeMembers.cafeId, communityCafes.id))
    .where(and(eq(communityCafes.slug, slug), eq(communityCafeMembers.userId, userId)))
    .limit(1);
  return Boolean(row);
}

export async function createFanPostReply(input: {
  postId: string;
  parentId?: string | null;
  userId: string;
  text: string;
}): Promise<FanCafeReply> {
  await ensureCommunityTables();
  const [post] = await db.select({ id: fanPosts.id }).from(fanPosts).where(eq(fanPosts.id, input.postId)).limit(1);
  if (!post) {
    throw new Error("댓글을 달 게시글을 찾을 수 없습니다.");
  }
  const depthCheck = await getFanPostReplyDepth(input.postId, input.parentId ?? null);
  if (!depthCheck.ok) {
    throw new Error(replyDepthErrorMessage(depthCheck.reason));
  }
  const id = crypto.randomUUID();
  await db.insert(fanPostReplies).values({
    id,
    postId: input.postId,
    parentId: input.parentId ?? null,
    userId: input.userId,
    text: input.text,
  });
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  return {
    id,
    postId: input.postId,
    parentId: input.parentId ?? null,
    author: { id: input.userId, name: user?.name ?? "익명", avatar: user?.avatar ?? "#7c5cfc" },
    text: input.text,
    createdAt: new Date().toISOString(),
  };
}
