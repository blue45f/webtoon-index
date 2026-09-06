import { MessageCircle, Trash2 } from "lucide-react";
import { useState } from "react";

import { FanPostImages } from "./fan-cafe-images";
import { FanPostReplySection } from "./fan-cafe-reply-section";
import { countReplies } from "./fan-cafe-tree-utils";
import { KIND_LABEL } from "./fan-cafe-utils";

import type { FanCafePost } from "@/shared/lib/types";

import { Card3D } from "@/shared/components/ui/card-3d";
import { COMMUNITY_SCOPE_LABEL } from "@/shared/lib/community-ui";
import { withCsrfProtection } from "@/shared/lib/csrf";
import { useApp } from "@/shared/lib/store";
import { cn, relativeDate } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";

export default function FanPostCard({
  post,
  compact,
  onReplyCreated,
  onDeleted,
}: {
  post: FanCafePost;
  compact?: boolean;
  onReplyCreated?: (post: FanCafePost, delta: number) => void;
  onDeleted?: (id: string) => void;
}) {
  const userId = useApp((s) => s.userId);
  const sessionToken = useApp((s) => s.sessionToken);
  const isOwner = !!userId && post.author?.id === userId;
  const [deleting, setDeleting] = useState(false);
  async function handleDelete() {
    if (!userId || deleting) return;
    if (!globalThis.confirm("이 글을 삭제할까요? 답글도 함께 삭제됩니다.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/community/posts/${encodeURIComponent(post.id)}`, withCsrfProtection({
        method: "DELETE",
        headers: sessionToken ? { "x-user-id": sessionToken } : undefined,
      }));
      if (res.ok) onDeleted?.(post.id);
      else setDeleting(false);
    } catch {
      setDeleting(false);
    }
  }
  const [open, setOpen] = useState(false);
  const [loadedCount, setLoadedCount] = useState<number | null>(
    post.replies ? countReplies(post.replies) : null
  );
  const displayReplyCount = loadedCount ?? post.replyCount;

  return (
    <Card3D maxTilt={7} scale={1.01}>
      <article className="group rounded-2xl border border-line bg-card p-4 transition-[border-color,background-color,transform] duration-200 hover:border-line-strong hover:bg-raised/30 sm:p-5 shadow-sm">
        <header className="mb-3 flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold text-[oklch(0.97_0.012_85)] ring-1 ring-[oklch(0.95_0.01_85/0.14)] shadow-[inset_0_1px_0_oklch(1_0_0/0.12)]"
          style={{ background: `linear-gradient(140deg, ${post.author.avatar}, oklch(0.26 0.04 60))` }}
        >
          {post.author.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-accent/35 bg-accent-soft px-1.5 py-0.5 text-[0.65rem] font-semibold text-accent">
              {KIND_LABEL[post.kind]}
            </span>
            <span className="text-[0.68rem] text-fg-3">{relativeDate(post.createdAt)}</span>
          </div>
          {compact ? (
            <p className="mt-0.5 text-[0.68rem] text-fg-3">
              {COMMUNITY_SCOPE_LABEL[post.scope]} · {post.targetLabel}
            </p>
          ) : null}
          <h3 className="mt-1 line-clamp-2 [overflow-wrap:anywhere] text-sm font-bold leading-snug text-fg">
            <Link
              href={`/community/post/${encodeURIComponent(post.id)}`}
              className="rounded-sm transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {post.title}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-fg-3">{post.author.name}</p>
        </div>
        {isOwner && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="내 글 삭제"
            title="삭제"
            className="shrink-0 rounded-lg p-1.5 text-fg-3 opacity-0 transition-colors hover:bg-raised hover:text-bad focus-visible:opacity-100 disabled:opacity-40 group-hover:opacity-100"
          >
            <Trash2 size={15} />
          </button>
        )}
      </header>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-2">{post.text}</p>
      <FanPostImages title={post.title} images={post.images} />
      {post.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {post.tags.map((tag) => (
            <span key={tag} className="rounded-md border border-line bg-raised/70 px-1.5 py-0.5 text-[0.68rem] text-fg-3">
              #{tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-4 border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              const nextOpen = !open;
              setOpen(nextOpen);
            }}
            className={cn(
              "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              open
                ? "border-accent/45 bg-accent-soft text-accent"
                : "border-line bg-raised/55 text-fg-2 hover:bg-canvas/55"
            )}
          >
            <MessageCircle size={15} />
            댓글 {displayReplyCount}
          </button>
          {loadedCount !== null && displayReplyCount > 0 ? (
            <span className="text-[0.68rem] text-fg-3">대화 {displayReplyCount}개</span>
          ) : null}
        </div>
        {open && (
          <FanPostReplySection
            postId={post.id}
            initialReplies={post.replies}
            onCountChange={setLoadedCount}
            onReplyDelta={(delta) => onReplyCreated?.(post, delta)}
            className="mt-4"
          />
        )}
      </div>
    </article>
  </Card3D>
  );
}

// 첨부 이미지 그리드 — 서버 검증을 거치지만 레거시/손상 행도 방어적으로 다시 거른다.
