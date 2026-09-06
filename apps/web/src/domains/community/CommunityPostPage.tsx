import { ArrowLeft, MessageCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { FanCafePost } from "@/shared/lib/types";

import { FanPostImages, FanPostReplySection } from "@/shared/components/fan-cafe-panel";
import { KIND_LABEL } from "@/shared/components/fan-cafe-utils";
import { Container } from "@/shared/components/section";
import { COMMUNITY_SCOPE_LABEL, getCommunityScopeTargetLink } from "@/shared/lib/community-ui";
import { useApp } from "@/shared/lib/store";
import { relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import { useDocumentTitle } from "@/src/hooks/use-document-title";
import { api } from "@/src/infrastructure/api";
import { useApiResource } from "@/src/infrastructure/use-api-resource";


// 토론 스레드 상세 — 목록 카드에서 진입하는 분할 라우트(/community/post/:id).
// 글 전문 + 첨부 + 답글 트리를 한 화면에 모으고, 보드(작품/작가/펜카페/카페)로 돌아가는 길을 연다.
export function CommunityPostPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const userId = useApp((s) => s.userId);
  const sessionToken = useApp((s) => s.sessionToken);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [replyCount, setReplyCount] = useState<number | null>(null);

  const { data: post, loading, error, notFound, reload } = useApiResource<FanCafePost>(
    id ? `/api/community/posts/${encodeURIComponent(id)}` : null,
    "토론 글을 불러오지 못했습니다."
  );

  useDocumentTitle(post ? post.title : notFound ? "토론 글을 찾을 수 없어요" : "커뮤니티 토론");

  if (loading) {
    return (
      <Container size="default" className="py-10">
        <div className="skeleton h-8 w-44 rounded-lg" />
        <div className="skeleton mt-6 h-44 w-full rounded-2xl" />
        <div className="skeleton mt-4 h-28 w-full rounded-2xl" />
      </Container>
    );
  }

  if (notFound || (!post && !error)) {
    return (
      <Container size="default" className="py-16">
        <div className="rounded-3xl border border-dashed border-line bg-card/50 px-6 py-14 text-center">
          <MessageCircle className="mx-auto mb-3 text-fg-3" size={24} />
          <p className="eyebrow text-accent">COMMUNITY THREAD</p>
          <h1 className="mt-2 text-2xl font-bold">토론 글을 찾을 수 없어요</h1>
          <p className="mt-2 text-sm text-fg-3">삭제됐거나 비공개 처리된 글일 수 있습니다.</p>
          <Link
            href="/community"
            className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent"
          >
            <ArrowLeft size={15} />
            커뮤니티로 돌아가기
          </Link>
        </div>
      </Container>
    );
  }

  if (error || !post) {
    return (
      <Container size="default" className="py-16">
        <div className="rounded-3xl border border-bad/35 bg-bad/10 px-6 py-10 text-center">
          <p className="text-sm font-medium text-bad">{error ?? "토론 글을 불러오지 못했습니다."}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-4 rounded-lg border border-bad/35 px-3 py-2 text-xs font-semibold text-bad"
          >
            다시 시도
          </button>
        </div>
      </Container>
    );
  }

  const boardHref = getCommunityScopeTargetLink(post.scope, post.targetId, post.targetLabel);
  const isOwner = Boolean(userId) && post.author.id === userId;
  const displayReplyCount = replyCount ?? post.replyCount;

  async function deletePost() {
    if (!userId || deleting || !post) return;
    if (!globalThis.confirm("이 글을 삭제할까요? 답글도 함께 삭제됩니다.")) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.delete(`/community/posts/${encodeURIComponent(post.id)}`, {
        headers: sessionToken ? { "x-user-id": sessionToken } : undefined,
      });
      navigate(boardHref, { replace: true });
    } catch {
      setDeleteError("글을 삭제하지 못했습니다.");
      setDeleting(false);
    }
  }

  return (
    <Container size="default" className="py-8 lg:py-10">
      <nav aria-label="이동 경로" className="mb-5 flex flex-wrap items-center gap-2 text-xs text-fg-3">
        <Link href="/community" className="transition-colors hover:text-fg">
          커뮤니티
        </Link>
        <span aria-hidden>/</span>
        <Link href={boardHref} className="inline-flex items-center gap-1 transition-colors hover:text-fg">
          {COMMUNITY_SCOPE_LABEL[post.scope]} · {post.targetLabel}
        </Link>
      </nav>

      <article className="rounded-3xl border border-line bg-card p-5 sm:p-7">
        <header className="flex items-start gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold text-[oklch(0.97_0.012_85)] ring-1 ring-[oklch(0.95_0.01_85/0.14)]"
            style={{ background: `linear-gradient(140deg, ${post.author.avatar}, oklch(0.26 0.04 60))` }}
          >
            {post.author.name.charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-accent/35 bg-accent-soft px-1.5 py-0.5 text-[0.72rem] font-semibold text-accent">
                {KIND_LABEL[post.kind]}
              </span>
              <span className="text-[0.68rem] text-fg-3">
                {COMMUNITY_SCOPE_LABEL[post.scope]} · {post.targetLabel}
              </span>
              <span className="text-[0.68rem] text-fg-3">{relativeDate(post.createdAt)}</span>
            </div>
            <h1 className="mt-1.5 [overflow-wrap:anywhere] text-xl font-bold leading-snug text-fg sm:text-2xl">
              {post.title}
            </h1>
            <p className="mt-1 text-xs text-fg-3">{post.author.name}</p>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={() => void deletePost()}
              disabled={deleting}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-fg-3 transition-colors hover:border-bad/45 hover:text-bad disabled:opacity-45"
            >
              <Trash2 size={13} />
              {deleting ? "삭제 중..." : "글 삭제"}
            </button>
          )}
        </header>

        <p className="mt-5 whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-fg-2">{post.text}</p>
        <FanPostImages title={post.title} images={post.images} />
        {post.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-md border border-line bg-raised/70 px-1.5 py-0.5 text-[0.68rem] text-fg-3">
                #{tag}
              </span>
            ))}
          </div>
        )}
        {deleteError && <p className="mt-3 text-xs text-bad">{deleteError}</p>}
      </article>

      <section className="mt-6" aria-label="댓글">
        <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-fg">
          <MessageCircle size={15} className="text-accent" />
          댓글 {displayReplyCount}
        </h2>
        <FanPostReplySection
          key={post.id}
          postId={post.id}
          initialReplies={post.replies}
          onCountChange={setReplyCount}
        />
      </section>
    </Container>
  );
}
