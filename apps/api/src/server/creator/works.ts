// 창작 작품(웹툰/컷툰) CRUD — 목록/상세/생성/수정/삭제와 연결 자산 검증.
import { and, asc, desc, eq, gt, inArray, lt, lte, or, sql } from "drizzle-orm";

import {
  assertStudioLinked3dPassAssetRows,
  extractStudioLinked3dPassAssetRequirements,
  type CreatorWorkLinked3dJsonEnvelope,
} from "../../../../web/src/shared/lib/studio-linked-3d-pass-asset-fence";
import {
  creatorChallenges,
  creatorDraftCollaborationRooms,
  creatorFollows,
  creatorSeries,
  creatorWorkAssetStorageReferences,
  creatorWorkAssets,
  creatorWorkComments,
  creatorWorkLikes,
  creatorWorkRevisions,
  creatorWorks,
  db,
  users,
} from "../../db";
import { toPublicCreatorDoc } from "../creator-doc-visibility";
import { assertCreatorDraftCollaborationStatusMutationAllowed } from "../creator-provisional-work-status";
import {
  CREATOR_WORK_REVISION_MAX,
  CreatorWorkRevisionConflictError,
  createCreatorWorkRevisionSnapshot,
  creatorWorkRevisionRetentionCutoff,
  parseCreatorWorkRevision,
} from "../creator-work-revisions";

import { assertJoinableChallenge } from "./challenges";
import { parseSeriesStatus } from "./community-contract";
import { ensureCreatorCommunitySchema } from "./community-schema";
import { getOwnedSeriesOrThrow, nextEpisodeNoOf, touchSeries } from "./series";
import {
  authorOf,
  cleanPages,
  cleanTags,
  clampText,
  excludeTestUserId,
  isTestUserId,
  MAX_DESCRIPTION,
  MAX_TITLE,
  normalizeMultiline,
  parsePages,
  parseRefId,
  parseTagValue,
  safeDate,
  type CreatorCommunityTransaction,
} from "./shared";
import {
  parseCreatorSort,
  parseFormat,
  parseStatus,
  parseTitleId,
  type CreatorEpisodeRef,
  type CreatorWorkDetail,
  type CreatorWorkInput,
  type CreatorWorkMutationResult,
  type CreatorWorkSort,
  type CreatorWorkSummary,
} from "./works-contract";

import type { SQL } from "drizzle-orm";

export async function assertCreatorWorkLinked3dPassAssetsInTransaction(
  transaction: CreatorCommunityTransaction,
  workId: string,
  envelope: CreatorWorkLinked3dJsonEnvelope
): Promise<void> {
  const requirements = extractStudioLinked3dPassAssetRequirements(envelope);
  if (requirements.length === 0) return;
  const rows = await transaction
    .select({
      workId: creatorWorkAssets.workId,
      assetId: creatorWorkAssets.assetId,
      elementType: creatorWorkAssets.elementType,
      mimeType: creatorWorkAssets.mimeType,
      descriptor: creatorWorkAssets.descriptor,
      byteSize: creatorWorkAssets.byteSize,
      sha256: creatorWorkAssets.sha256,
      intrinsicWidth: creatorWorkAssets.intrinsicWidth,
      intrinsicHeight: creatorWorkAssets.intrinsicHeight,
      decodedRgbaBytes: creatorWorkAssets.decodedRgbaBytes,
    })
    .from(creatorWorkAssets)
    .where(
      and(
        eq(creatorWorkAssets.workId, workId),
        inArray(
          creatorWorkAssets.assetId,
          requirements.map(({ assetId }) => assetId)
        )
      )
    );
  assertStudioLinked3dPassAssetRows({ workId, requirements, rows });
}

// ── 목록 ─────────────────────────────────────────────────────────────
export async function listWorks(opts: {
  titleId?: string;
  userId?: string;
  sort?: CreatorWorkSort;
  tag?: string;
  viewerId?: string;
  includeHidden?: boolean;
  // 커뮤니티 확장 필터 — 시리즈 회차 / 챌린지 참여작 / 팔로잉 피드(팔로우한 창작자의 작품)
  seriesId?: string;
  challengeId?: string;
  followedBy?: string;
} = {}): Promise<CreatorWorkSummary[]> {
  try {
    // 새 테이블·컬럼 보장(멱등, 1회). 실패해도 기본 목록은 동작해야 하므로 ready 플래그로 분기.
    const ready = await ensureCreatorCommunitySchema();
    if (!ready && (opts.seriesId || opts.challengeId || opts.followedBy)) return [];
    const sort = parseCreatorSort(opts.sort);
    let where: SQL | undefined;
    const addWhere = (c: SQL | undefined) => {
      if (!c) return;
      where = where ? and(where, c) : c;
    };
    // 소유자가 본인 목록을 조회하면(viewerId === userId) 초안·비공개까지 포함(내 게시물 관리용).
    // 그 외에는 공개(published) + 비노출 제외(관리자 includeHidden 제외).
    const ownerView = !!opts.userId && !!opts.viewerId && opts.viewerId === opts.userId;
    if (!ownerView) {
      addWhere(eq(creatorWorks.status, "published"));
      if (!opts.includeHidden) {
        addWhere(eq(creatorWorks.hidden, false));
        addWhere(excludeTestUserId(users.id));
      }
    }
    if (opts.titleId) addWhere(eq(creatorWorks.titleId, opts.titleId));
    if (opts.userId) addWhere(eq(creatorWorks.userId, opts.userId));
    if (ready && opts.seriesId) addWhere(eq(creatorWorks.seriesId, opts.seriesId));
    if (ready && opts.challengeId) addWhere(eq(creatorWorks.challengeId, opts.challengeId));
    if (ready && opts.followedBy) {
      addWhere(
        sql`${creatorWorks.userId} IN (
          SELECT ${creatorFollows.creatorId} FROM ${creatorFollows}
          WHERE ${creatorFollows.followerId} = ${opts.followedBy}
        )`
      );
    }
    const tag = String(opts.tag ?? "").trim().replace(/^#/, "").toLowerCase();
    if (tag) {
      addWhere(sql`lower(${creatorWorks.tags}::text) LIKE ${`%"${tag.replace(/[%_]/g, "\\$&")}"%`} ESCAPE '\\'`);
    }

    const likeCountExpr = sql<number>`(
      SELECT count(*) FROM ${creatorWorkLikes}
      WHERE ${creatorWorkLikes.workId} = ${creatorWorks.id}
        AND ${excludeTestUserId(creatorWorkLikes.userId)}
    )`;
    const commentCountExpr = sql<number>`(
      SELECT count(*) FROM ${creatorWorkComments}
      WHERE ${creatorWorkComments.workId} = ${creatorWorks.id}
        AND ${creatorWorkComments.hidden} = false
        AND ${excludeTestUserId(creatorWorkComments.userId)}
    )`;

    let q = db
      .select({
        id: creatorWorks.id,
        title: creatorWorks.title,
        description: creatorWorks.description,
        cover: creatorWorks.cover,
        tags: creatorWorks.tags,
        format: creatorWorks.format,
        titleId: creatorWorks.titleId,
        status: creatorWorks.status,
        views: creatorWorks.views,
        createdAt: creatorWorks.createdAt,
        userId: users.id,
        author: users.name,
        avatar: users.avatar,
        likes: likeCountExpr.as("likes"),
        comments: commentCountExpr.as("comments"),
        // 스키마 미준비(ready=false) 시 컬럼 참조 대신 NULL 리터럴 — 구버전 DB에서도 쿼리가 죽지 않는다.
        seriesId: ready ? creatorWorks.seriesId : sql<string | null>`NULL`,
        episodeNo: ready ? creatorWorks.episodeNo : sql<number | null>`NULL`,
        challengeId: ready ? creatorWorks.challengeId : sql<string | null>`NULL`,
        seriesTitle: ready ? creatorSeries.title : sql<string | null>`NULL`,
        challengeTitle: ready ? creatorChallenges.title : sql<string | null>`NULL`,
        remixFromId: ready ? creatorWorks.remixFromId : sql<string | null>`NULL`,
      })
      .from(creatorWorks)
      .innerJoin(users, eq(creatorWorks.userId, users.id))
      .$dynamic();
    if (ready) {
      q = q
        .leftJoin(creatorSeries, eq(creatorWorks.seriesId, creatorSeries.id))
        .leftJoin(creatorChallenges, eq(creatorWorks.challengeId, creatorChallenges.id));
    }
    if (where) q = q.where(where);

    const orderBy =
      ready && opts.seriesId
        ? // 시리즈 회차 목록은 회차 번호 순(미지정 회차는 뒤로)
          [sql`${creatorWorks.episodeNo} ASC NULLS LAST`, asc(creatorWorks.createdAt), asc(creatorWorks.id)]
        : sort === "likes"
          ? [desc(likeCountExpr), desc(creatorWorks.createdAt), desc(creatorWorks.id)]
          : sort === "views"
            ? [desc(creatorWorks.views), desc(creatorWorks.createdAt), desc(creatorWorks.id)]
            : [desc(creatorWorks.createdAt), desc(creatorWorks.id)];
    const rows = await q.orderBy(...orderBy);

    // 뷰어가 좋아요한 작품 집합
    const ids = rows.map((r) => r.id);
    const likedSet = new Set<string>();
    if (opts.viewerId && ids.length) {
      const likedRows = await db
        .select({ workId: creatorWorkLikes.workId })
        .from(creatorWorkLikes)
        .where(eq(creatorWorkLikes.userId, opts.viewerId));
      for (const r of likedRows) likedSet.add(r.workId);
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      cover: r.cover ?? "",
      tags: parseTagValue(r.tags),
      format: parseFormat(r.format),
      titleId: r.titleId ?? null,
      status: parseStatus(r.status),
      author: authorOf(r),
      likes: Number(r.likes ?? 0),
      comments: Number(r.comments ?? 0),
      views: Number(r.views ?? 0),
      liked: likedSet.has(r.id),
      seriesId: r.seriesId ?? null,
      episodeNo: r.episodeNo == null ? null : Number(r.episodeNo),
      seriesTitle: r.seriesTitle ?? null,
      challengeId: r.challengeId ?? null,
      challengeTitle: r.challengeTitle ?? null,
      remixFromId: r.remixFromId ?? null,
      createdAt: safeDate(r.createdAt),
    }));
  } catch {
    return [];
  }
}

// ── 단건 조회(전체) ──────────────────────────────────────────────────
export async function getWork(id: string, viewerId?: string): Promise<CreatorWorkDetail | null> {
  try {
    const ready = await ensureCreatorCommunitySchema();
    const [row] = await db
      .select({
        id: creatorWorks.id,
        title: creatorWorks.title,
        description: creatorWorks.description,
        cover: creatorWorks.cover,
        tags: creatorWorks.tags,
        format: creatorWorks.format,
        titleId: creatorWorks.titleId,
        status: creatorWorks.status,
        hidden: creatorWorks.hidden,
        views: creatorWorks.views,
        pages: creatorWorks.pages,
        doc: creatorWorks.doc,
        revision: creatorWorks.revision,
        createdAt: creatorWorks.createdAt,
        updatedAt: creatorWorks.updatedAt,
        ownerId: creatorWorks.userId,
        userId: users.id,
        author: users.name,
        avatar: users.avatar,
        seriesId: ready ? creatorWorks.seriesId : sql<string | null>`NULL`,
        episodeNo: ready ? creatorWorks.episodeNo : sql<number | null>`NULL`,
        challengeId: ready ? creatorWorks.challengeId : sql<string | null>`NULL`,
        remixFromId: ready ? creatorWorks.remixFromId : sql<string | null>`NULL`,
      })
      .from(creatorWorks)
      .innerJoin(users, eq(creatorWorks.userId, users.id))
      .where(eq(creatorWorks.id, id))
      .limit(1);
    if (!row) return null;
    if (isTestUserId(row.ownerId) && row.ownerId !== viewerId) return null;
    const isOwner = !!viewerId && viewerId === row.ownerId;
    if ((row.hidden || row.status !== "published") && !isOwner) return null;

    const [likeCount] = await db
      .select({ count: sql<number>`count(*)`.as("count") })
      .from(creatorWorkLikes)
      .where(and(eq(creatorWorkLikes.workId, id), excludeTestUserId(creatorWorkLikes.userId)));
    const [commentCount] = await db
      .select({ count: sql<number>`count(*)`.as("count") })
      .from(creatorWorkComments)
      .where(
        and(
          eq(creatorWorkComments.workId, id),
          eq(creatorWorkComments.hidden, false),
          excludeTestUserId(creatorWorkComments.userId)
        )
      );

    let liked = false;
    if (viewerId) {
      const [likedRow] = await db
        .select({ workId: creatorWorkLikes.workId })
        .from(creatorWorkLikes)
        .where(and(eq(creatorWorkLikes.workId, id), eq(creatorWorkLikes.userId, viewerId)))
        .limit(1);
      liked = !!likedRow;
    }

    // 시리즈/챌린지 부가 정보(배지 + 이전화/다음화) — best-effort.
    let series: CreatorWorkDetail["series"] = null;
    let seriesTitle: string | null = null;
    let prevEpisode: CreatorEpisodeRef | null = null;
    let nextEpisode: CreatorEpisodeRef | null = null;
    let challenge: CreatorWorkDetail["challenge"] = null;
    let challengeTitle: string | null = null;
    if (ready && row.seriesId) {
      const [s] = await db
        .select({ id: creatorSeries.id, title: creatorSeries.title, status: creatorSeries.status })
        .from(creatorSeries)
        .where(eq(creatorSeries.id, row.seriesId))
        .limit(1);
      if (s) {
        series = { id: s.id, title: s.title, status: parseSeriesStatus(s.status) };
        seriesTitle = s.title;
      }
      if (row.episodeNo != null) {
        const visible = and(
          eq(creatorWorks.seriesId, row.seriesId),
          eq(creatorWorks.status, "published"),
          eq(creatorWorks.hidden, false),
          excludeTestUserId(creatorWorks.userId)
        );
        const [prev] = await db
          .select({ id: creatorWorks.id, title: creatorWorks.title, episodeNo: creatorWorks.episodeNo })
          .from(creatorWorks)
          .where(and(visible, lt(creatorWorks.episodeNo, row.episodeNo)))
          .orderBy(desc(creatorWorks.episodeNo))
          .limit(1);
        const [next] = await db
          .select({ id: creatorWorks.id, title: creatorWorks.title, episodeNo: creatorWorks.episodeNo })
          .from(creatorWorks)
          .where(and(visible, gt(creatorWorks.episodeNo, row.episodeNo)))
          .orderBy(asc(creatorWorks.episodeNo))
          .limit(1);
        if (prev) prevEpisode = { id: prev.id, title: prev.title, episodeNo: prev.episodeNo ?? null };
        if (next) nextEpisode = { id: next.id, title: next.title, episodeNo: next.episodeNo ?? null };
      }
    }
    if (ready && row.challengeId) {
      const [c] = await db
        .select({
          id: creatorChallenges.id,
          slug: creatorChallenges.slug,
          title: creatorChallenges.title,
          endsAt: creatorChallenges.endsAt,
        })
        .from(creatorChallenges)
        .where(eq(creatorChallenges.id, row.challengeId))
        .limit(1);
      if (c) {
        challenge = { id: c.id, slug: c.slug, title: c.title, endsAt: c.endsAt ? safeDate(c.endsAt) : null };
        challengeTitle = c.title;
      }
    }

    let remixFromTitle: string | null = null;
    let remixedChildren: CreatorWorkDetail["remixedChildren"] = [];
    if (ready) {
      if (row.remixFromId) {
        const [parent] = await db
          .select({ title: creatorWorks.title })
          .from(creatorWorks)
          .where(
            and(
              eq(creatorWorks.id, row.remixFromId),
              eq(creatorWorks.status, "published"),
              eq(creatorWorks.hidden, false),
              excludeTestUserId(creatorWorks.userId)
            )
          )
          .limit(1);
        if (parent) {
          remixFromTitle = parent.title;
        }
      }
      const childrenRows = await db
        .select({
          id: creatorWorks.id,
          title: creatorWorks.title,
          cover: creatorWorks.cover,
          userId: users.id,
          author: users.name,
          avatar: users.avatar,
        })
        .from(creatorWorks)
        .innerJoin(users, eq(creatorWorks.userId, users.id))
        .where(
          and(
            eq(creatorWorks.remixFromId, id),
            eq(creatorWorks.status, "published"),
            eq(creatorWorks.hidden, false),
            excludeTestUserId(users.id)
          )
        )
        .orderBy(desc(creatorWorks.createdAt))
        .limit(10);
      remixedChildren = childrenRows.map((c) => ({
        id: c.id,
        title: c.title,
        cover: c.cover,
        author: { id: c.userId, name: c.author ?? "익명", avatar: c.avatar ?? "#7c5cfc" },
      }));
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      cover: row.cover ?? "",
      tags: parseTagValue(row.tags),
      format: parseFormat(row.format),
      titleId: row.titleId ?? null,
      status: parseStatus(row.status),
      author: authorOf(row),
      likes: Number(likeCount?.count ?? 0),
      comments: Number(commentCount?.count ?? 0),
      views: Number(row.views ?? 0),
      liked,
      seriesId: row.seriesId ?? null,
      episodeNo: row.episodeNo == null ? null : Number(row.episodeNo),
      seriesTitle,
      challengeId: row.challengeId ?? null,
      challengeTitle,
      remixFromId: row.remixFromId ?? null,
      remixFromTitle,
      remixedChildren,
      createdAt: safeDate(row.createdAt),
      updatedAt: safeDate(row.updatedAt),
      pages: parsePages(row.pages),
      doc: isOwner ? row.doc ?? {} : toPublicCreatorDoc(row.doc),
      isOwner,
      ...(isOwner ? { revision: Number(row.revision ?? 1) } : {}),
      series,
      prevEpisode,
      nextEpisode,
      challenge,
    };
  } catch {
    return null;
  }
}

// ── 조회수 증가(best-effort) ─────────────────────────────────────────
export async function bumpViews(id: string): Promise<void> {
  try {
    await db
      .update(creatorWorks)
      .set({ views: sql`${creatorWorks.views} + 1` })
      .where(eq(creatorWorks.id, id));
  } catch {
    // best-effort: 실패해도 무시
  }
}

// ── 생성 ─────────────────────────────────────────────────────────────
export async function createWork(userId: string, input: CreatorWorkInput): Promise<CreatorWorkMutationResult> {
  if (!(await ensureCreatorCommunitySchema())) {
    throw new Error("작품 revision 저장소를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const title = clampText(input.title, MAX_TITLE);
  if (title.length < 1) throw new Error("제목을 입력해 주세요.");
  const description = normalizeMultiline(input.description, MAX_DESCRIPTION);
  const tags = cleanTags(input.tags);
  const format = parseFormat(input.format);
  const titleId = parseTitleId(input.titleId);
  const cover = String(input.cover ?? "");
  const pages = cleanPages(input.pages);
  const doc = input.doc ?? {};
  const status = parseStatus(input.status);

  // A brand-new random work ID cannot already own immutable cloud rows. Linked-pass creation must
  // therefore use the hidden provisional-work flow: provision ID -> upload rows -> locked update.
  const directCreateRequirements = extractStudioLinked3dPassAssetRequirements({
    cover,
    pages,
    doc,
  });
  if (directCreateRequirements.length > 0) {
    assertStudioLinked3dPassAssetRows({
      workId: "direct-create-has-no-work-asset-scope",
      requirements: directCreateRequirements,
      rows: [],
    });
  }

  // 시리즈/챌린지 연결(선택) — 미전달이면 기존 플로우 그대로(새 컬럼을 건드리지 않아 push 전 DB와도 호환).
  const seriesId = parseRefId(input.seriesId);
  const challengeId = parseRefId(input.challengeId);
  let episodeNo: number | null = null;
  let seriesTitle: string | null = null;
  let challengeTitle: string | null = null;
  if (seriesId || challengeId) {
    if (!(await ensureCreatorCommunitySchema())) {
      throw new Error("연재·챌린지 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.");
    }
    if (seriesId) {
      const series = await getOwnedSeriesOrThrow(seriesId, userId);
      seriesTitle = series.title;
      episodeNo = await nextEpisodeNoOf(seriesId); // 시리즈 내 max+1 자동 부여
    }
    if (challengeId) {
      const challenge = await assertJoinableChallenge(challengeId);
      challengeTitle = challenge.title;
    }
  }

  const remixFromId = parseRefId(input.remixFromId);

  const id = crypto.randomUUID();
  const now = new Date();
  const values: typeof creatorWorks.$inferInsert = {
    id,
    userId,
    titleId,
    title,
    description,
    cover,
    tags,
    format,
    pages,
    doc,
    status,
    remixFromId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  if (seriesId) {
    values.seriesId = seriesId;
    values.episodeNo = episodeNo;
  }
  if (challengeId) values.challengeId = challengeId;
  await db.transaction(async (tx) => {
    await tx.insert(creatorWorks).values(values);
    await tx.insert(creatorWorkRevisions).values({
      workId: id,
      revision: 1,
      snapshot: createCreatorWorkRevisionSnapshot(values),
      createdAt: now,
    });
  });
  if (seriesId) await touchSeries(seriesId);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return {
    id,
    title,
    description,
    cover,
    tags,
    format,
    titleId,
    status,
    author: { id: userId, name: user?.name ?? "익명", avatar: user?.avatar ?? "#7c5cfc" },
    likes: 0,
    comments: 0,
    views: 0,
    liked: false,
    seriesId,
    episodeNo,
    seriesTitle,
    challengeId,
    challengeTitle,
    remixFromId,
    revision: 1,
    createdAt: safeDate(now),
  };
}

export const creatorWorkSnapshotSelection = {
  titleId: creatorWorks.titleId,
  title: creatorWorks.title,
  description: creatorWorks.description,
  cover: creatorWorks.cover,
  tags: creatorWorks.tags,
  format: creatorWorks.format,
  pages: creatorWorks.pages,
  doc: creatorWorks.doc,
  status: creatorWorks.status,
  seriesId: creatorWorks.seriesId,
  episodeNo: creatorWorks.episodeNo,
  challengeId: creatorWorks.challengeId,
  remixFromId: creatorWorks.remixFromId,
  revision: creatorWorks.revision,
};

export async function mutationResultForWork(
  userId: string,
  id: string,
  revision: number
): Promise<CreatorWorkMutationResult> {
  const detail = await getWork(id, userId);
  if (!detail) throw new Error("작품을 찾을 수 없습니다.");
  const {
    pages: _pages,
    doc: _doc,
    isOwner: _isOwner,
    revision: _detailRevision,
    updatedAt: _updatedAt,
    series: _series,
    prevEpisode: _prevEpisode,
    nextEpisode: _nextEpisode,
    challenge: _challenge,
    ...summary
  } = detail;
  return { ...summary, revision };
}

// ── 수정(작성자 전용) ────────────────────────────────────────────────
export async function updateWork(
  userId: string,
  id: string,
  patch: CreatorWorkInput
): Promise<CreatorWorkMutationResult> {
  if (!(await ensureCreatorCommunitySchema())) {
    throw new Error("작품 revision 저장소를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  const baseRevision = patch.baseRevision === undefined
    ? undefined
    : parseCreatorWorkRevision(patch.baseRevision, "baseRevision");
  const [existing] = await db
    .select({
      id: creatorWorks.id,
      ownerId: creatorWorks.userId,
      revision: creatorWorks.revision,
      seriesId: creatorWorks.seriesId,
      challengeId: creatorWorks.challengeId,
    })
    .from(creatorWorks)
    .where(eq(creatorWorks.id, id))
    .limit(1);
  if (!existing) throw new Error("작품을 찾을 수 없습니다.");
  if (existing.ownerId !== userId) throw new Error("작성자만 수정할 수 있습니다.");
  if (baseRevision !== undefined && existing.revision !== baseRevision) {
    throw new CreatorWorkRevisionConflictError(existing.revision);
  }
  if (existing.revision >= CREATOR_WORK_REVISION_MAX) {
    throw new Error("작품 revision 상한에 도달해 더 저장할 수 없습니다.");
  }

  const now = new Date();
  const fields: Record<string, unknown> = { updatedAt: now };
  if (patch.title !== undefined) {
    const title = clampText(patch.title, MAX_TITLE);
    if (title.length < 1) throw new Error("제목을 입력해 주세요.");
    fields.title = title;
  }
  if (patch.description !== undefined) fields.description = normalizeMultiline(patch.description, MAX_DESCRIPTION);
  if (patch.tags !== undefined) fields.tags = cleanTags(patch.tags);
  if (patch.cover !== undefined) fields.cover = String(patch.cover ?? "");
  if (patch.pages !== undefined) fields.pages = cleanPages(patch.pages);
  if (patch.doc !== undefined) fields.doc = patch.doc ?? {};
  const requestedStatus = patch.status === undefined ? undefined : parseStatus(patch.status);
  if (requestedStatus !== undefined) fields.status = requestedStatus;
  if (patch.titleId !== undefined) fields.titleId = parseTitleId(patch.titleId);

  // 시리즈/챌린지 연결 변경(선택 필드 — 미전달 시 기존 값 유지).
  let bumpSeriesId: string | null = null;
  if (patch.seriesId !== undefined) {
    const nextSeriesId = parseRefId(patch.seriesId);
    if (nextSeriesId !== (existing.seriesId ?? null)) {
      if (nextSeriesId) {
        await getOwnedSeriesOrThrow(nextSeriesId, userId);
        fields.seriesId = nextSeriesId;
        fields.episodeNo = await nextEpisodeNoOf(nextSeriesId); // 새 시리즈 기준 max+1
        bumpSeriesId = nextSeriesId;
      } else {
        fields.seriesId = null;
        fields.episodeNo = null;
      }
    }
  }
  if (patch.challengeId !== undefined) {
    const nextChallengeId = parseRefId(patch.challengeId);
    if (nextChallengeId !== (existing.challengeId ?? null)) {
      if (nextChallengeId) await assertJoinableChallenge(nextChallengeId);
      fields.challengeId = nextChallengeId;
    }
  }

  const updated = await db.transaction(async (tx) => {
    // This is the same row lock used by immutable work-asset upload/deletion. Keep it ahead of the
    // asset query so the exact candidate JSON and its rows remain one transaction-scoped fact.
    const [locked] = await tx
      .select({
        ...creatorWorkSnapshotSelection,
        ownerId: creatorWorks.userId,
        hidden: creatorWorks.hidden,
      })
      .from(creatorWorks)
      .where(eq(creatorWorks.id, id))
      .limit(1)
      .for("update");
    if (!locked) throw new Error("작품을 찾을 수 없습니다.");
    if (locked.ownerId !== userId) throw new Error("작성자만 수정할 수 있습니다.");
    if (baseRevision !== undefined && locked.revision !== baseRevision) {
      throw new CreatorWorkRevisionConflictError(locked.revision);
    }
    if (locked.revision >= CREATOR_WORK_REVISION_MAX) {
      throw new Error("작품 revision 상한에 도달해 더 저장할 수 없습니다.");
    }
    const [draftCollaborationRoom] = requestedStatus === undefined
      ? []
      : await tx
          .select({ status: creatorDraftCollaborationRooms.status })
          .from(creatorDraftCollaborationRooms)
          .where(
            and(
              eq(creatorDraftCollaborationRooms.workId, id),
              eq(creatorDraftCollaborationRooms.status, "active")
            )
          )
          .limit(1);
    assertCreatorDraftCollaborationStatusMutationAllowed({
      hidden: locked.hidden,
      draftCollaborationStatus: draftCollaborationRoom?.status,
      requestedStatus,
    });
    await assertCreatorWorkLinked3dPassAssetsInTransaction(tx, id, {
      cover: Object.hasOwn(fields, "cover") ? fields.cover : locked.cover,
      pages: Object.hasOwn(fields, "pages") ? fields.pages : locked.pages,
      doc: Object.hasOwn(fields, "doc") ? fields.doc : locked.doc,
    });

    // `baseRevision`을 생략한 레거시 저장도 동시 요청으로 PostgreSQL integer 상한을 넘지 않게
    // write 조건에서 다시 막는다. 사전 조회는 친절한 오류용이며 안전성은 이 조건이 담당한다.
    const conditions = [
      eq(creatorWorks.id, id),
      eq(creatorWorks.userId, userId),
      lt(creatorWorks.revision, CREATOR_WORK_REVISION_MAX),
    ];
    if (baseRevision !== undefined) conditions.push(eq(creatorWorks.revision, baseRevision));
    const [row] = await tx
      .update(creatorWorks)
      .set({ ...fields, revision: sql`${creatorWorks.revision} + 1` })
      .where(and(...conditions))
      .returning(creatorWorkSnapshotSelection);

    if (!row) {
      const [current] = await tx
        .select({ ownerId: creatorWorks.userId, revision: creatorWorks.revision })
        .from(creatorWorks)
        .where(eq(creatorWorks.id, id))
        .limit(1);
      if (!current) throw new Error("작품을 찾을 수 없습니다.");
      if (current.ownerId !== userId) throw new Error("작성자만 수정할 수 있습니다.");
      if (current.revision >= CREATOR_WORK_REVISION_MAX) {
        throw new Error("작품 revision 상한에 도달해 더 저장할 수 없습니다.");
      }
      if (baseRevision !== undefined) throw new CreatorWorkRevisionConflictError(current.revision);
      throw new Error("작품을 수정할 수 없습니다.");
    }

    await tx.insert(creatorWorkRevisions).values({
      workId: id,
      revision: row.revision,
      snapshot: createCreatorWorkRevisionSnapshot(row),
      createdAt: now,
    });
    const cutoff = creatorWorkRevisionRetentionCutoff(row.revision);
    if (cutoff !== null) {
      await tx
        .delete(creatorWorkRevisions)
        .where(and(eq(creatorWorkRevisions.workId, id), lte(creatorWorkRevisions.revision, cutoff)));
    }
    return row;
  });

  if (bumpSeriesId) await touchSeries(bumpSeriesId);
  return mutationResultForWork(userId, id, updated.revision);
}


// ── 삭제(작성자 또는 관리자) ─────────────────────────────────────────
export async function deleteWork(userId: string, id: string, isAdmin: boolean): Promise<{ deleted: boolean }> {
  return db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: creatorWorks.id, ownerId: creatorWorks.userId })
      .from(creatorWorks)
      .where(eq(creatorWorks.id, id))
      .limit(1)
      .for("update");
    if (!existing) return { deleted: false };
    if (existing.ownerId !== userId && !isAdmin) {
      throw new Error("작성자만 삭제할 수 있습니다.");
    }

    const [generatedReference] = await transaction
      .select({ referenceId: creatorWorkAssetStorageReferences.referenceId })
      .from(creatorWorkAssetStorageReferences)
      .where(
        and(
          eq(creatorWorkAssetStorageReferences.workId, id),
          or(
            eq(creatorWorkAssetStorageReferences.purpose, "derived"),
            eq(creatorWorkAssetStorageReferences.purpose, "export"),
          ),
        ),
      )
      .limit(1);
    if (generatedReference) {
      // The FK intentionally cascades source references, but generated objects require the remote
      // last-reference state machine. Never let a racing admission bypass that cleanup boundary.
      throw new Error("생성 에셋 정리가 완료된 뒤 작품을 삭제할 수 있습니다.");
    }

    const deleted = await transaction
      .delete(creatorWorks)
      .where(eq(creatorWorks.id, id))
      .returning({ id: creatorWorks.id });
    return { deleted: deleted.length === 1 };
  });
}

export async function assertPublicCreatorWork(workId: string): Promise<void> {
  const [work] = await db
    .select({ id: creatorWorks.id, status: creatorWorks.status, hidden: creatorWorks.hidden, ownerId: creatorWorks.userId })
    .from(creatorWorks)
    .where(eq(creatorWorks.id, workId))
    .limit(1);
  if (!work || work.hidden || work.status !== "published" || isTestUserId(work.ownerId)) {
    throw new Error("공개된 작품을 찾을 수 없습니다.");
  }
}

