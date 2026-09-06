import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";

import { parseCommunitySort } from "../../../../web/src/shared/lib/community-ui";
import { GENRES } from "../../../../web/src/shared/lib/taxonomy";
import {
  createCafe,
  createFanPost,
  deleteFanPost,
  deleteFanPostReply,
  deleteReviewReply,
  createFanPostReply,
  getCafeBySlug,
  getFanPost,
  isCafeMember,
  joinCafe,
  leaveCafe,
  listCafes,
  listCommunityBoards,
  listFanPostReplies,
  listFanPosts,
  parseCommunityScopeFilter,
  parsePostKindOrNull,
  parsePostSort,
  validateCafeInput,
  validatePostInput,
  validateReplyPayload,
  createReviewReply,
  listReviewReplies,
} from "../../server/community";
import { getReviewsData } from "../../server/reviews";

import type { CommunityCafe, FanCafePost, FanCafeReply, ReviewReply } from "../../../../web/src/shared/lib/types";

interface PostQuery {
  scope?: string | null;
  targetId?: string | null;
  kind?: string | null;
  sort?: string | null;
  query?: string | null;
  tag?: string | null;
  cursor?: string | null;
  limit?: number | string | null;
  mineOnly?: boolean;
  requesterId?: string | null;
}

interface PostPayload {
  scope?: unknown;
  targetId?: unknown;
  targetLabel?: unknown;
  kind?: unknown;
  title?: unknown;
  text?: unknown;
  tags?: unknown;
}

interface ReviewPayload {
  sort?: string | null;
  spoiler?: string | null;
  rating?: string | null;
  userId?: string | null;
}

interface ReplyPayload {
  text?: unknown;
  parentId?: unknown;
  spoiler?: unknown;
}

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "on", "yes"].includes(normalized);
  }
  return false;
}

function parseLimit(value: number | string | null | undefined): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return 20;
  return Math.max(1, Math.min(Math.floor(raw), 100));
}

@Injectable()
export class CommunityService {
  async boards(scopeValue: string | null, query: string | null, sortValue: string | null, limitValue: number | null) {
    const scope = parseCommunityScopeFilter(scopeValue) ?? "all";
    const sort = parseCommunitySort(sortValue);
    const safeLimit = parseLimit(limitValue);
    // DB(Neon) 불가 시 빈 목록으로 우아하게 폴백 — 팬카페가 500 대신 빈 디렉토리로 뜬다.
    let boards: Awaited<ReturnType<typeof listCommunityBoards>>;
    try {
      boards = await listCommunityBoards(scope, String(query ?? "").trim(), sort, safeLimit);
    } catch {
      boards = [];
    }
    return {
      items: boards,
      meta: { scope, sort, limit: safeLimit, total: boards.length, generatedAt: new Date().toISOString() },
    };
  }

  async listPosts(query: PostQuery) {
    const scope = parseCommunityScopeFilter(query.scope ?? null) ?? "all";
    const targetId = String(query.targetId ?? "").trim() || null;
    const kind = parsePostKindOrNull(query.kind);
    const sort = parsePostSort(query.sort);
    const safeLimit = parseLimit(query.limit ?? 20);
    const search = String(query.query ?? "").trim();
    const tag = String(query.tag ?? "").trim();
    const cursor = query.cursor ? String(query.cursor) : null;
    const requesterId = parseBool(query.mineOnly) && query.requesterId ? query.requesterId : null;
    if (query.mineOnly && !requesterId) {
      throw new UnauthorizedException("로그인이 필요해요.");
    }
    if (scope !== "all" && !targetId) {
      throw new BadRequestException("scope가 all이 아니면 targetId가 필요합니다.");
    }

    // DB(Neon) 불가 시 빈 피드로 폴백 — 검증 오류(위 throw)는 그대로 두고 DB 호출만 보호.
    try {
      return await listFanPosts(scope, targetId, kind, search, tag, sort, cursor, safeLimit, requesterId);
    } catch {
      return { items: [], hasMore: false, nextCursor: null };
    }
  }

  async createPost(body: PostPayload, userId: string) {
    const parsed = validatePostInput(body);
    if (parsed.error || !parsed.value) {
      throw new BadRequestException(parsed.error ?? "잘못된 요청");
    }
    // 장르 카페 글은 가입 회원만 — 카페 존재·멤버십을 서버에서 강제하고 라벨 스푸핑을 차단.
    if (parsed.value.scope === "cafe") {
      const cafe = await getCafeBySlug(parsed.value.targetId, userId);
      if (!cafe) throw new NotFoundException("카페를 찾을 수 없어요.");
      if (!(await isCafeMember(userId, cafe.slug))) {
        throw new ForbiddenException("카페에 가입한 회원만 글을 쓸 수 있어요.");
      }
      parsed.value.targetLabel = cafe.name;
    }
    return createFanPost(userId, parsed.value);
  }

  // 토론 스레드 상세(답글 트리 포함). 숨김 글은 404.
  async getPost(postId: string): Promise<FanCafePost> {
    if (!postId) throw new BadRequestException("postId 필요");
    let post: FanCafePost | null;
    try {
      post = await getFanPost(postId);
    } catch {
      throw new BadRequestException("토론 글을 불러오지 못했습니다.");
    }
    if (!post) throw new NotFoundException("토론 글을 찾을 수 없어요.");
    return post;
  }

  async deletePost(postId: string, userId: string) {
    if (!postId) throw new BadRequestException("postId 필요");
    try {
      return await deleteFanPost(userId, postId, false);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "글을 삭제하지 못했습니다.");
    }
  }

  async deletePostReply(postId: string, replyId: string, userId: string) {
    if (!postId || !replyId) throw new BadRequestException("postId/replyId 필요");
    try {
      return await deleteFanPostReply(userId, postId, replyId, false);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "답글을 삭제하지 못했습니다.");
    }
  }

  async deleteReviewReply(reviewId: string, replyId: string, userId: string) {
    if (!reviewId || !replyId) throw new BadRequestException("reviewId/replyId 필요");
    try {
      return await deleteReviewReply(userId, reviewId, replyId, false);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "답글을 삭제하지 못했습니다.");
    }
  }

  // ── 장르 카페(소모임) ──────────────────────────────────────────────
  async listCafes(genre: string | null, query: string | null, sortValue: string | null) {
    const sort = parseCommunitySort(sortValue) === "recent" ? ("recent" as const) : ("popular" as const);
    // DB 불가 시 빈 디렉토리로 폴백(500 방지) — 검증 오류는 그대로 던진다.
    let items: CommunityCafe[];
    try {
      items = await listCafes({ genre, query, sort });
    } catch {
      items = [];
    }
    return { items, meta: { sort, total: items.length, generatedAt: new Date().toISOString() } };
  }

  async getCafe(slug: string, viewerId: string | null) {
    if (!slug) throw new BadRequestException("slug 필요");
    let cafe: CommunityCafe | null;
    try {
      cafe = await getCafeBySlug(slug, viewerId);
    } catch {
      throw new BadRequestException("카페 정보를 불러오지 못했습니다.");
    }
    if (!cafe) throw new NotFoundException("카페를 찾을 수 없어요.");
    return cafe;
  }

  async createCafe(body: unknown, userId: string) {
    const parsed = validateCafeInput(body, GENRES);
    if (parsed.error || !parsed.value) throw new BadRequestException(parsed.error ?? "카페 정보를 확인해 주세요.");
    try {
      return await createCafe(userId, parsed.value);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "카페를 만들지 못했습니다.");
    }
  }

  async joinCafe(slug: string, userId: string) {
    if (!slug) throw new BadRequestException("slug 필요");
    try {
      return await joinCafe(userId, slug);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "카페에 가입하지 못했습니다.");
    }
  }

  async leaveCafe(slug: string, userId: string) {
    if (!slug) throw new BadRequestException("slug 필요");
    try {
      return await leaveCafe(userId, slug);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "카페에서 탈퇴하지 못했습니다.");
    }
  }

  async listPostReplies(postId: string): Promise<FanCafeReply[]> {
    if (!postId) throw new BadRequestException("postId 필요");
    try {
      return await listFanPostReplies(postId);
    } catch {
      return [];
    }
  }

  async createPostReply(postId: string, userId: string, body: ReplyPayload) {
    const parsed = validateReplyPayload(body);
    if (parsed.error || !parsed.text) throw new BadRequestException(parsed.error ?? "답글의 상위 항목이 유효하지 않습니다.");
    try {
      return await createFanPostReply({
        postId,
        userId,
        parentId: parsed.parentId,
        text: parsed.text,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException("답글을 저장하지 못했습니다.");
    }
  }

  async listReviewReplies(reviewId: string): Promise<ReviewReply[]> {
    if (!reviewId) throw new BadRequestException("reviewId 필요");
    try {
      return await listReviewReplies(reviewId);
    } catch {
      return [];
    }
  }

  async createReviewReply(reviewId: string, userId: string, body: ReplyPayload) {
    const parsed = validateReplyPayload(body);
    if (parsed.error || !parsed.text) throw new BadRequestException(parsed.error ?? "답글의 상위 항목이 유효하지 않습니다.");
    try {
      return await createReviewReply({
        reviewId,
        parentId: parsed.parentId,
        userId,
        text: parsed.text,
        spoiler: !!body.spoiler,
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      throw new BadRequestException("답글을 저장하지 못했습니다.");
    }
  }

  async getReviewsData(query: ReviewPayload) {
    return getReviewsData({
      sort: query.sort ?? undefined,
      spoiler: query.spoiler ?? undefined,
      rating: query.rating ?? undefined,
      userId: query.userId ?? undefined,
    });
  }
}
