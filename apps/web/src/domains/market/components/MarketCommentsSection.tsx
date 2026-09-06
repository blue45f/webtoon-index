import {
  CornerDownRight,
  Heart,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { useMarketSocial } from "../hooks/use-market-social";

import type {
  CreatorMarketplaceSocialComment,
} from "@/shared/lib/creator-marketplace-social-contract";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";
import { useSession } from "@/src/compat/auth-session-store";

interface MarketCommentsSectionProps {
  resourceId: string;
  publisherId?: string;
}

interface CommentNode extends CreatorMarketplaceSocialComment {
  replies: CommentNode[];
}

function formatRelativeTime(dateString: string): string {
  const timestamp = new Date(dateString).getTime();
  if (!Number.isFinite(timestamp)) return "방금 전";
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return dateString.slice(0, 10);
}

function buildCommentTree(
  comments: readonly CreatorMarketplaceSocialComment[],
): CommentNode[] {
  const nodes = new Map<string, CommentNode>(comments.map((comment) => [
    comment.id,
    { ...comment, replies: [] },
  ]));
  const roots: CommentNode[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id);
    if (!node) continue;
    const parent = comment.parentId ? nodes.get(comment.parentId) : null;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  roots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  for (const root of roots) {
    root.replies.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
  return roots;
}

function AuthorBadge({
  badge,
}: {
  badge: CreatorMarketplaceSocialComment["author"]["badge"];
}) {
  if (badge === "publisher") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-accent/15 px-1.5 py-0.5 text-[0.62rem] font-bold text-accent">
        <Sparkles className="size-2.5" aria-hidden="true" />
        배급자
      </span>
    );
  }
  if (badge === "studio-verified") {
    return (
      <span className="inline-flex items-center gap-0.5 rounded bg-good/15 px-1.5 py-0.5 text-[0.62rem] font-semibold text-good">
        <ShieldCheck className="size-2.5" aria-hidden="true" />
        Studio 사용 인증
      </span>
    );
  }
  if (badge === "library-member") {
    return (
      <span className="rounded bg-cool/15 px-1.5 py-0.5 text-[0.62rem] font-medium text-cool">
        보관함 회원
      </span>
    );
  }
  return null;
}

// A fresh `[]` each render hands every memo below a new dependency identity, so they
// recompute every render and memoise nothing. One frozen empty keeps it stable while
// `data` is still loading.
const NO_COMMENTS: readonly CreatorMarketplaceSocialComment[] = Object.freeze([]);

export function MarketCommentsSection({
  resourceId,
}: MarketCommentsSectionProps) {
  const session = useSession();
  const viewerKey = session.status === "authenticated"
    ? session.data.user.id
    : "guest";
  const authenticated = session.status === "authenticated";
  const {
    status,
    data,
    error,
    pendingAction,
    refresh,
    createComment,
    deleteComment,
    toggleCommentLike,
  } = useMarketSocial(resourceId, viewerKey);
  const [commentInput, setCommentInput] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const comments = data?.comments ?? NO_COMMENTS;
  const roots = useMemo(() => buildCommentTree(comments), [comments]);

  useEffect(() => {
    setCommentInput("");
    setReplyingTo(null);
    setReplyInput("");
  }, [resourceId]);

  async function submitComment(event: FormEvent): Promise<void> {
    event.preventDefault();
    const content = commentInput.trim();
    if (!content || !authenticated) return;
    try {
      await createComment({ content, parentId: null });
      setCommentInput("");
    } catch {
      // Shared store exposes the server message in the inline error status.
    }
  }

  async function submitReply(parentId: string): Promise<void> {
    const content = replyInput.trim();
    if (!content || !authenticated) return;
    try {
      await createComment({ content, parentId });
      setReplyInput("");
      setReplyingTo(null);
    } catch {
      // Shared store exposes the server message in the inline error status.
    }
  }

  const loadingInitial = status === "loading" && !data;
  const totalCount = data?.totalCommentCount ?? comments.length;

  return (
    <section
      aria-labelledby="market-comments-heading"
      className="rounded-xl border border-line bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <h2
            id="market-comments-heading"
            className="flex items-center gap-2 text-base font-bold text-fg sm:text-lg"
          >
            <MessageSquare className="size-4 text-accent" aria-hidden="true" />
            <span>Q&A 및 커뮤니티 피드백</span>
            <span className="numeral tnum rounded-full bg-raised px-2 py-0.5 text-xs font-semibold text-accent">
              {totalCount}
            </span>
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-3">
            모든 글은 계정에 귀속되어 다른 기기와 사용자에게 동기화됩니다. 실제 Studio 적용 이력이 있으면 사용 인증 배지가 표시됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={status === "loading"}
          className={buttonClass({
            variant: "ghost",
            size: "sm",
            className: "gap-1.5",
          })}
        >
          <RefreshCw
            className={cn("size-3.5", status === "loading" && "animate-spin")}
            aria-hidden="true"
          />
          새로고침
        </button>
      </div>

      {authenticated ? (
        <form onSubmit={(event) => void submitComment(event)} className="mt-4">
          <label htmlFor="market-comment-input" className="sr-only">
            에셋 질문 또는 피드백
          </label>
          <textarea
            id="market-comment-input"
            rows={3}
            value={commentInput}
            onChange={(event) => setCommentInput(event.target.value)}
            placeholder="호환성, 적용 방법, 라이선스 또는 작업 팁을 질문해 보세요."
            maxLength={700}
            className="w-full rounded-xl border border-line bg-panel p-3 text-xs leading-relaxed text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <div className="mt-1.5 flex items-center justify-between gap-3 px-1">
            <span className="text-[0.68rem] text-fg-3">
              {commentInput.length} / 700자 · 작성자 이름은 로그인 계정을 사용합니다.
            </span>
            <button
              type="submit"
              disabled={!commentInput.trim() || Boolean(pendingAction)}
              className={buttonClass({
                variant: "solid",
                size: "sm",
                className: "gap-1.5 disabled:opacity-40",
              })}
            >
              {pendingAction === "comment:create" ? (
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-3.5" aria-hidden="true" />
              )}
              댓글 등록
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-line bg-panel/50 px-4 py-3 text-xs leading-relaxed text-fg-2">
          댓글과 답글은 공개로 읽을 수 있으며, 작성·좋아요는 로그인 후 사용할 수 있습니다.
        </div>
      )}

      {error ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-fg-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="ml-auto font-semibold text-accent hover:underline"
          >
            다시 시도
          </button>
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        {loadingInitial ? (
          <div role="status" className="space-y-3" aria-label="댓글 불러오는 중">
            {Array.from({ length: 2 }, (_, index) => (
              <div key={index} className="rounded-xl border border-line/60 bg-panel/30 p-4">
                <div className="skeleton h-4 w-36" />
                <div className="skeleton mt-3 h-3 w-full" />
                <div className="skeleton mt-2 h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : roots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-panel/50 py-8 text-center">
            <p className="text-xs font-medium text-fg-2">
              아직 등록된 질문이 없습니다. 첫 번째 활용 질문을 남겨보세요.
            </p>
          </div>
        ) : (
          roots.map((comment) => (
            <article
              key={comment.id}
              className="rounded-xl border border-line/60 bg-panel/30 p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
                    {comment.deleted ? "–" : (comment.author.name[0] ?? "U")}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-bold text-fg">
                        {comment.author.name}
                      </span>
                      <AuthorBadge badge={comment.author.badge} />
                    </div>
                    <time dateTime={comment.createdAt} className="text-[0.65rem] text-fg-3">
                      {formatRelativeTime(comment.createdAt)}
                    </time>
                  </div>
                </div>
                {comment.canDelete ? (
                  <button
                    type="button"
                    onClick={() => void deleteComment(comment.id).catch(() => undefined)}
                    disabled={Boolean(pendingAction)}
                    aria-label="댓글 삭제"
                    className="rounded p-1 text-fg-3 transition-colors hover:bg-warn/10 hover:text-warn disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              <p className={cn(
                "mt-2 whitespace-pre-wrap text-xs leading-relaxed",
                comment.deleted ? "italic text-fg-3" : "text-fg-2",
              )}>
                {comment.deleted ? "삭제된 댓글입니다." : comment.content}
              </p>

              {!comment.deleted ? (
                <div className="mt-3 flex items-center gap-3 border-t border-line/40 pt-2">
                  <button
                    type="button"
                    onClick={() => void toggleCommentLike(comment.id).catch(() => undefined)}
                    disabled={!authenticated || Boolean(pendingAction)}
                    aria-pressed={comment.likedByViewer}
                    title={authenticated ? undefined : "로그인 후 좋아요를 누를 수 있습니다."}
                    className={cn(
                      "inline-flex items-center gap-1 text-[0.7rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      comment.likedByViewer
                        ? "text-warn"
                        : "text-fg-3 hover:text-warn",
                    )}
                  >
                    <Heart
                      className={cn(
                        "size-3.5",
                        comment.likedByViewer && "fill-warn text-warn",
                      )}
                      aria-hidden="true"
                    />
                    좋아요 {comment.likeCount > 0 ? comment.likeCount : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingTo(replyingTo === comment.id ? null : comment.id);
                      setReplyInput("");
                    }}
                    disabled={!authenticated || Boolean(pendingAction)}
                    className="text-[0.7rem] font-medium text-fg-3 transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    답글 달기
                  </button>
                </div>
              ) : null}

              {comment.replies.length > 0 ? (
                <div className="mt-3 space-y-2.5 border-l-2 border-accent/25 pl-3 sm:pl-4">
                  {comment.replies.map((reply) => (
                    <article key={reply.id} className="rounded-lg border border-line/40 bg-card/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <CornerDownRight className="size-3 shrink-0 text-fg-3" aria-hidden="true" />
                          <span className="truncate text-xs font-bold text-fg">
                            {reply.author.name}
                          </span>
                          <AuthorBadge badge={reply.author.badge} />
                          <time dateTime={reply.createdAt} className="shrink-0 text-[0.62rem] text-fg-3">
                            {formatRelativeTime(reply.createdAt)}
                          </time>
                        </div>
                        {reply.canDelete ? (
                          <button
                            type="button"
                            onClick={() => void deleteComment(reply.id).catch(() => undefined)}
                            disabled={Boolean(pendingAction)}
                            aria-label="답글 삭제"
                            className="rounded p-1 text-fg-3 transition-colors hover:bg-warn/10 hover:text-warn disabled:opacity-40"
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                      <p className={cn(
                        "mt-1.5 pl-4 whitespace-pre-wrap text-xs leading-relaxed",
                        reply.deleted ? "italic text-fg-3" : "text-fg-2",
                      )}>
                        {reply.deleted ? "삭제된 답글입니다." : reply.content}
                      </p>
                      {!reply.deleted ? (
                        <button
                          type="button"
                          onClick={() => void toggleCommentLike(reply.id).catch(() => undefined)}
                          disabled={!authenticated || Boolean(pendingAction)}
                          aria-pressed={reply.likedByViewer}
                          className={cn(
                            "mt-2 ml-4 inline-flex items-center gap-1 text-[0.65rem] font-medium transition-colors disabled:opacity-50",
                            reply.likedByViewer ? "text-warn" : "text-fg-3 hover:text-warn",
                          )}
                        >
                          <Heart
                            className={cn(
                              "size-3",
                              reply.likedByViewer && "fill-warn text-warn",
                            )}
                            aria-hidden="true"
                          />
                          좋아요 {reply.likeCount > 0 ? reply.likeCount : ""}
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}

              {replyingTo === comment.id ? (
                <div className="mt-3 rounded-lg border border-accent/35 bg-card p-3">
                  <label htmlFor={`market-reply-${comment.id}`} className="text-xs font-semibold text-accent">
                    @{comment.author.name} 님에게 답글
                  </label>
                  <textarea
                    id={`market-reply-${comment.id}`}
                    rows={2}
                    value={replyInput}
                    onChange={(event) => setReplyInput(event.target.value)}
                    maxLength={700}
                    className="mt-2 w-full rounded-lg border border-line bg-panel p-2.5 text-xs leading-relaxed text-fg focus:border-accent focus:outline-none"
                    placeholder="답글 내용을 입력하세요."
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setReplyingTo(null)}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={() => void submitReply(comment.id)}
                      disabled={!replyInput.trim() || Boolean(pendingAction)}
                      className={buttonClass({
                        variant: "solid",
                        size: "sm",
                        className: "gap-1.5 disabled:opacity-40",
                      })}
                    >
                      <Send className="size-3" aria-hidden="true" />
                      답글 등록
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      {data?.truncated.comments ? (
        <p className="mt-4 text-center text-[0.68rem] text-fg-3">
          대화가 많아 최신 댓글 일부만 표시하고 있습니다.
        </p>
      ) : null}
    </section>
  );
}
