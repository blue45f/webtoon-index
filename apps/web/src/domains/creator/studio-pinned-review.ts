/**
 * Studio Pinned Review Thread System — 원고 컷·레이어·3D 객체·세로 스크롤 좌표에
 * 피드백 핀을 꽂고 스레드 대화 및 Task 승격을 지원하는 전문 검수 코어.
 *
 * 마스터플랜 11.5 (Pinned Review) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 2D 컷 좌표, 레이어 좌표, 3D 객체/월드 좌표, 모바일 세로 스크롤 좌표 핀
 * - 스레드 답글(Replies), 멘션(@User), Before/After 비교 오버레이
 * - 리뷰 댓글을 제작 Task로 원클릭 승격(Promote to Task)
 * - 해결(Resolve), 기각(Dismiss), 승인자/버전/시각 추적
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_PINNED_REVIEW_VERSION = 1 as const;

export const STUDIO_PINNED_REVIEW_LIMITS = Object.freeze({
  maxThreads: 2_048,
  maxRepliesPerThread: 256,
  maxMentionsPerComment: 32,
  maxTextLength: 4_000,
  maxIdLength: 128,
  maxDiagnostics: 256,
});

export type PinnedTargetCoordinate =
  | { readonly kind: "panel"; readonly panelId: string; readonly normalizedX: number; readonly normalizedY: number }
  | { readonly kind: "layer"; readonly layerId: string; readonly localX: number; readonly localY: number }
  | { readonly kind: "3d-object"; readonly sceneId: string; readonly objectId: string; readonly worldPosition: readonly [number, number, number] }
  | { readonly kind: "scroll"; readonly scrollY: number; readonly viewportWidth: number; readonly viewportHeight: number };

export type PinnedThreadStatus = "open" | "in-progress" | "resolved" | "dismissed";

export interface ReviewCommentAuthor {
  readonly userId: string;
  readonly userName: string;
  readonly role: string;
}

export interface PinnedReviewReply {
  readonly id: string;
  readonly author: ReviewCommentAuthor;
  readonly body: string;
  readonly mentions?: readonly string[];
  readonly createdAtMs: number;
}

export interface PinnedReviewThread {
  readonly id: string;
  readonly episodeId: string;
  readonly target: PinnedTargetCoordinate;
  readonly author: ReviewCommentAuthor;
  readonly title: string;
  readonly body: string;
  readonly mentions?: readonly string[];
  readonly beforeAfterOverlayRef?: string;
  readonly status: PinnedThreadStatus;
  readonly replies: readonly PinnedReviewReply[];
  readonly promotedTaskId?: string;
  readonly createdAtMs: number;
  readonly resolvedInfo?: {
    readonly resolvedByUserId: string;
    readonly resolvedAtMs: number;
    readonly note?: string;
  };
}

export interface StudioPinnedReviewBoard {
  readonly version: typeof STUDIO_PINNED_REVIEW_VERSION;
  readonly id: string;
  readonly episodeId: string;
  readonly threads: readonly PinnedReviewThread[];
}

export function createStudioPinnedReviewBoard(params: {
  id: string;
  episodeId: string;
  threads?: readonly PinnedReviewThread[];
}): StudioPinnedReviewBoard {
  return Object.freeze({
    version: STUDIO_PINNED_REVIEW_VERSION,
    id: params.id.trim(),
    episodeId: params.episodeId.trim(),
    threads: Object.freeze([...(params.threads ?? [])]),
  });
}

export function createPinnedReviewThread(
  board: StudioPinnedReviewBoard,
  request: {
    id: string;
    target: PinnedTargetCoordinate;
    author: ReviewCommentAuthor;
    title: string;
    body: string;
    mentions?: readonly string[];
    beforeAfterOverlayRef?: string;
    nowMs: number;
  },
): StudioPinnedReviewBoard {
  if (board.threads.some((t) => t.id === request.id)) {
    throw new Error(`Thread ${request.id} already exists`);
  }
  const newThread: PinnedReviewThread = Object.freeze({
    id: request.id.trim(),
    episodeId: board.episodeId,
    target: Object.freeze({ ...request.target }),
    author: Object.freeze({ ...request.author }),
    title: request.title.trim(),
    body: request.body.trim(),
    mentions: request.mentions ? Object.freeze([...request.mentions]) : undefined,
    beforeAfterOverlayRef: request.beforeAfterOverlayRef?.trim(),
    status: "open",
    replies: Object.freeze([]),
    createdAtMs: request.nowMs,
  });

  return {
    ...board,
    threads: Object.freeze([...board.threads, newThread]),
  };
}

export function addPinnedReviewReply(
  board: StudioPinnedReviewBoard,
  threadId: string,
  reply: {
    id: string;
    author: ReviewCommentAuthor;
    body: string;
    mentions?: readonly string[];
    nowMs: number;
  },
): StudioPinnedReviewBoard {
  const index = board.threads.findIndex((t) => t.id === threadId);
  if (index === -1) {
    throw new Error(`Thread ${threadId} not found`);
  }
  const thread = board.threads[index];
  const newReply: PinnedReviewReply = Object.freeze({
    id: reply.id.trim(),
    author: Object.freeze({ ...reply.author }),
    body: reply.body.trim(),
    mentions: reply.mentions ? Object.freeze([...reply.mentions]) : undefined,
    createdAtMs: reply.nowMs,
  });

  const updatedThread: PinnedReviewThread = {
    ...thread,
    status: thread.status === "open" ? "in-progress" : thread.status,
    replies: Object.freeze([...thread.replies, newReply]),
  };

  const nextThreads = [...board.threads];
  nextThreads[index] = Object.freeze(updatedThread);
  return { ...board, threads: Object.freeze(nextThreads) };
}

export function promotePinnedReviewToTask(
  board: StudioPinnedReviewBoard,
  threadId: string,
  taskId: string,
): { readonly board: StudioPinnedReviewBoard; readonly promotedTaskId: string } {
  const index = board.threads.findIndex((t) => t.id === threadId);
  if (index === -1) {
    throw new Error(`Thread ${threadId} not found`);
  }
  const thread = board.threads[index];
  const updatedThread: PinnedReviewThread = {
    ...thread,
    promotedTaskId: taskId.trim(),
    status: "in-progress",
  };
  const nextThreads = [...board.threads];
  nextThreads[index] = Object.freeze(updatedThread);

  return {
    board: { ...board, threads: Object.freeze(nextThreads) },
    promotedTaskId: taskId.trim(),
  };
}

export function resolvePinnedReviewThread(
  board: StudioPinnedReviewBoard,
  threadId: string,
  resolvedByUserId: string,
  nowMs: number,
  note?: string,
): StudioPinnedReviewBoard {
  const index = board.threads.findIndex((t) => t.id === threadId);
  if (index === -1) {
    throw new Error(`Thread ${threadId} not found`);
  }
  const thread = board.threads[index];
  const updatedThread: PinnedReviewThread = {
    ...thread,
    status: "resolved",
    resolvedInfo: Object.freeze({
      resolvedByUserId: resolvedByUserId.trim(),
      resolvedAtMs: nowMs,
      note: note?.trim(),
    }),
  };
  const nextThreads = [...board.threads];
  nextThreads[index] = Object.freeze(updatedThread);
  return { ...board, threads: Object.freeze(nextThreads) };
}

export function queryPinnedReviewsByPanel(
  board: StudioPinnedReviewBoard,
  panelId: string,
): readonly PinnedReviewThread[] {
  return Object.freeze(
    board.threads.filter((t) => t.target.kind === "panel" && t.target.panelId === panelId),
  );
}

export function queryPinnedReviewsByStatus(
  board: StudioPinnedReviewBoard,
  status: PinnedThreadStatus,
): readonly PinnedReviewThread[] {
  return Object.freeze(board.threads.filter((t) => t.status === status));
}
