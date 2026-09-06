import { EyeOff, MessageCircle, Send, AlertTriangle, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";

import type { ReviewReply } from "@/shared/lib/types";

import { withCsrfProtection } from "@/shared/lib/csrf";
import { ensureArray, resolveApiError, safeParseJson } from "@/shared/lib/http-safe";
import { useApp } from "@/shared/lib/store";
import { cn, relativeDate } from "@/shared/lib/utils";

const ROOT_REPLY = "__root__";
const MAX_REPLY_DEPTH = 4;
const MAX_REPLY_LENGTH = 700;

export function ReviewReplies({ reviewId }: { reviewId: string }) {
  const userId = useApp((s) => s.userId);
  const sessionToken = useApp((s) => s.sessionToken);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [replies, setReplies] = useState<ReviewReply[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openComposerFor, setOpenComposerFor] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({ [ROOT_REPLY]: "" });
  const [spoilerDrafts, setSpoilerDrafts] = useState<Record<string, boolean>>({ [ROOT_REPLY]: false });

  function setDraft(id: string, value: string) {
    const next = value.slice(0, MAX_REPLY_LENGTH);
    setDrafts((current) => ({ ...current, [id]: next }));
  }

  function setSpoilerDraft(id: string, value: boolean) {
    setSpoilerDrafts((current) => ({ ...current, [id]: value }));
  }

  function toggleComposer(parentId: string | null) {
    setOpenComposerFor((current) => (current === parentId ? null : parentId));
  }

  function insertReply(
    nodes: ReviewReply[],
    parentId: string | null,
    reply: ReviewReply
  ): ReviewReply[] {
    if (!parentId) return [...nodes, reply];
    const next = nodes.map((node) => {
      if (node.id === parentId) {
        return { ...node, children: [...(node.children ?? []), reply] };
      }
      if (!node.children || node.children.length === 0) return node;
      return { ...node, children: insertReply(node.children, parentId, reply) };
    });
    return next;
  }

  async function load() {
    setOpen(true);
    if (loaded || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/replies`, { cache: "no-store" });
      const data = await safeParseJson<unknown>(res);
      if (!res.ok) {
        setError(resolveApiError(data, `답글 목록을 불러오지 못했습니다. (${res.status})`));
        return;
      }
      setReplies(ensureArray<ReviewReply>(data));
      setLoaded(true);
    } catch {
      setError("답글을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(parentId: string | null = null) {
    const draft = (drafts[parentId ?? ROOT_REPLY] ?? "").trim();
    if (!draft || !userId) return;
    const spoiler = spoilerDrafts[parentId ?? ROOT_REPLY] ?? false;

    const body = {
      text: draft,
      spoiler,
      ...(parentId ? { parentId } : {}),
    };

    setError(null);
    const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/replies`, withCsrfProtection({
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(sessionToken ? { "x-user-id": sessionToken } : {}),
      },
      body: JSON.stringify(body),
    }));

    const data = await safeParseJson<unknown>(res);
    if (!res.ok) {
      setError(resolveApiError(data, `답글을 저장하지 못했습니다. (${res.status})`));
      return;
    }
    if (!data || typeof data !== "object" || !("id" in data)) {
      setError("답글 응답 형식이 유효하지 않습니다.");
      return;
    }

    setReplies((current) => insertReply(current, parentId, data as ReviewReply));
    setDraft(parentId ?? ROOT_REPLY, "");
    setSpoilerDraft(parentId ?? ROOT_REPLY, false);
    setLoaded(true);
    setOpenComposerFor(null);
  }

  // 소프트 삭제 마스킹/제거 — 서버(deleteReviewReply)와 동일하게 하위 답글이 있으면 자리 표시만 남긴다.
  function maskNode(nodes: ReviewReply[], replyId: string): ReviewReply[] {
    return nodes.map((node) => {
      if (node.id === replyId) {
        return { ...node, deleted: true, text: "", author: { name: "삭제됨", avatar: "#5b5751" } };
      }
      if (!node.children || node.children.length === 0) return node;
      return { ...node, children: maskNode(node.children, replyId) };
    });
  }

  function removeNode(nodes: ReviewReply[], replyId: string): ReviewReply[] {
    return nodes
      .filter((node) => node.id !== replyId)
      .map((node) =>
        node.children && node.children.length > 0 ? { ...node, children: removeNode(node.children, replyId) } : node
      );
  }

  async function deleteReply(replyId: string) {
    if (!userId) return;
    if (!globalThis.confirm("이 답글을 삭제할까요?")) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/reviews/${encodeURIComponent(reviewId)}/replies/${encodeURIComponent(replyId)}`,
        withCsrfProtection({
          method: "DELETE",
          cache: "no-store",
          headers: sessionToken ? { "x-user-id": sessionToken } : undefined,
        })
      );
      const data = await safeParseJson<unknown>(res);
      if (!res.ok) {
        setError(resolveApiError(data, "답글을 삭제하지 못했습니다."));
        return;
      }
      const result = (data ?? {}) as { deleted?: boolean; soft?: boolean };
      if (!result.deleted) {
        setError("답글을 삭제하지 못했습니다.");
        return;
      }
      setReplies((current) => (result.soft ? maskNode(current, replyId) : removeNode(current, replyId)));
    } catch {
      setError("답글을 삭제하지 못했습니다.");
    }
  }

  const count = countReplies(replies);

  return (
    <div className="border-t border-line pt-3">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : load())}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-fg-3 transition-colors hover:bg-raised hover:text-fg-2"
      >
        <MessageCircle size={14} />
        {open ? "답글 접기" : `답글 ${loaded ? count : "보기"}`}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {loading && <div className="skeleton h-10 w-full" />}
          {error && (
            <p className="rounded-lg border border-bad/40 bg-[oklch(0.66_0.2_25/0.12)] px-3 py-2 text-xs text-bad">
              {error}
            </p>
          )}
          {replies.length === 0 && !loading ? (
            <p className="rounded-lg border border-dashed border-line bg-canvas/40 px-3 py-3 text-xs text-fg-3">
              첫 답글을 남겨 대화를 이어가세요.
            </p>
          ) : (
            <ReplyThread
              items={replies}
              userId={userId}
              onSubmit={submit}
              onDelete={deleteReply}
              onToggleComposer={toggleComposer}
              openComposerFor={openComposerFor}
              drafts={drafts}
              onChangeDraft={setDraft}
              spoilerByReplyId={spoilerDrafts}
              onChangeSpoilerDraft={setSpoilerDraft}
              depth={0}
            />
          )}

          <div className="rounded-xl border border-line bg-canvas/45 p-3">
            {userId ? (
              <>
                <textarea
                  value={drafts[ROOT_REPLY] ?? ""}
                  onChange={(event) => setDraft(ROOT_REPLY, event.target.value)}
                  maxLength={MAX_REPLY_LENGTH}
                  rows={2}
                  aria-label="리뷰에 답글 남기기"
                  placeholder="리뷰에 답글 남기기"
                  className="w-full resize-none bg-transparent text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs text-fg-3">
                    <input
                      type="checkbox"
                      checked={spoilerDrafts[ROOT_REPLY] ?? false}
                      onChange={(event) => setSpoilerDraft(ROOT_REPLY, event.target.checked)}
                      className="size-3.5 rounded border-line"
                    />
                    <AlertTriangle size={12} />
                    스포일러 답글
                  </label>
                  <span className="text-[0.7rem] text-fg-3">최대 4단계까지 대댓글 지원</span>
                  <span className="text-[0.7rem] text-fg-3">{(drafts[ROOT_REPLY] ?? "").length}/{MAX_REPLY_LENGTH}</span>
                  <button
                    type="button"
                    onClick={() => submit(null)}
                    disabled={!(drafts[ROOT_REPLY]?.trim() ?? "").length}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Send size={13} />
                    등록
                  </button>
                </div>
              </>
            ) : (
              <p className="text-xs text-fg-3">로그인하면 리뷰에 답글을 남길 수 있습니다.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyThread({
  items,
  userId,
  onSubmit,
  onDelete,
  onToggleComposer,
  openComposerFor,
  drafts,
  onChangeDraft,
  spoilerByReplyId,
  onChangeSpoilerDraft,
  depth,
}: {
  items: ReviewReply[];
  userId: string | null;
  onSubmit: (parentId?: string | null) => Promise<void>;
  onDelete: (replyId: string) => Promise<void>;
  onToggleComposer: (parentId: string | null) => void;
  openComposerFor: string | null;
  drafts: Record<string, string>;
  onChangeDraft: (id: string, value: string) => void;
  spoilerByReplyId: Record<string, boolean>;
  onChangeSpoilerDraft: (id: string, value: boolean) => void;
  depth: number;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {items.map((reply) => (
        <ReviewReplyItem
          key={reply.id}
          reply={reply}
          userId={userId}
          canReply={depth < MAX_REPLY_DEPTH}
          depth={depth}
          onSubmit={onSubmit}
              onDelete={onDelete}
              onToggleComposer={onToggleComposer}
              openComposerFor={openComposerFor}
              drafts={drafts}
              onChangeDraft={onChangeDraft}
              spoilerByReplyId={spoilerByReplyId}
              onChangeSpoilerDraft={onChangeSpoilerDraft}
            />
          ))}
        </div>
  );
}

function ReviewReplyItem({
  reply,
  userId,
  canReply,
  depth,
  onSubmit,
  onDelete,
  onToggleComposer,
  openComposerFor,
  drafts,
  onChangeDraft,
  spoilerByReplyId,
  onChangeSpoilerDraft,
}: {
  reply: ReviewReply;
  userId: string | null;
  canReply: boolean;
  depth: number;
  onSubmit: (parentId?: string | null) => Promise<void>;
  onDelete: (replyId: string) => Promise<void>;
  onToggleComposer: (parentId: string | null) => void;
  openComposerFor: string | null;
  drafts: Record<string, string>;
  onChangeDraft: (id: string, value: string) => void;
  spoilerByReplyId: Record<string, boolean>;
  onChangeSpoilerDraft: (id: string, value: boolean) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const children = reply.children ?? [];
  const isDeleted = Boolean(reply.deleted);
  const hasSpoiler = reply.spoiler && !isDeleted;
  const isOpen = openComposerFor === reply.id;
  const draft = drafts[reply.id] ?? "";
  const spoilerDraft = spoilerByReplyId[reply.id] ?? false;
  const hidden = hasSpoiler && !revealed;
  const hasChildren = children.length > 0;
  const isOwnReply = !isDeleted && Boolean(userId) && reply.author.id === userId;

  return (
    <article className={cn("rounded-xl border border-line bg-panel/45 p-3", depth > 0 && "ml-4 border-l-2 border-line")}>
      <div className="mb-2 flex items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-[oklch(0.97_0.012_85)] ring-1 ring-[oklch(0.95_0.01_85/0.14)] shadow-[inset_0_1px_0_oklch(1_0_0/0.12)]"
          style={{ background: `linear-gradient(140deg, ${reply.author.avatar}, oklch(0.3 0.05 60))` }}
        >
          {reply.author.name.charAt(0)}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">{reply.author.name}</span>
        <span className="text-[0.68rem] text-fg-3">{relativeDate(reply.createdAt)}</span>
        {isOwnReply && (
          <button
            type="button"
            onClick={() => void onDelete(reply.id)}
            aria-label="내 답글 삭제"
            title="삭제"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.68rem] text-fg-3 transition-colors hover:bg-raised hover:text-bad"
          >
            <Trash2 size={12} />
            삭제
          </button>
        )}
      </div>
      {isDeleted ? (
        <p className="text-sm italic leading-relaxed text-fg-3">삭제된 답글입니다.</p>
      ) : (
        <div className="relative">
          <p className={cn("text-sm leading-relaxed text-fg-2", hidden && "select-none blur-[5px]")}>{reply.text}</p>
          {hidden && (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="absolute inset-0 flex items-center justify-center text-xs font-medium text-fg-2 hover:text-fg"
            >
              스포일러 답글 보기
            </button>
          )}
        </div>
      )}
        {!isDeleted && canReply && (
          <button
            type="button"
            onClick={() => onToggleComposer(reply.id)}
            className="mt-2 inline-flex items-center gap-1 rounded-md text-[0.68rem] text-fg-3 transition-colors hover:text-fg"
          >
            답글 달기
            {hasSpoiler ? <EyeOff size={12} /> : null}
          </button>
        )}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            className="mt-2 inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[0.65rem] text-fg-3 transition-colors hover:text-fg"
          >
            {collapsed ? "답글 펼치기" : "답글 접기"} ({children.length})
          </button>
          ) : null}
        {!canReply ? <p className="mt-2 text-[0.65rem] text-fg-3">이 단계에서는 더 이상 답글을 달 수 없습니다.</p> : null}

      {isOpen && (
        <div className="mt-2">
          {userId ? (
            <div className="rounded-lg border border-line bg-canvas/35 p-2">
              <textarea
                value={draft}
                onChange={(event) => onChangeDraft(reply.id, event.target.value)}
                maxLength={MAX_REPLY_LENGTH}
                rows={2}
                aria-label="답글 달기"
                placeholder="답글 달기"
                className="w-full resize-none bg-transparent text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3"
              />
                <div className="mt-1 flex items-center justify-between text-[0.65rem] text-fg-3">
                  <span>{draft.length}/{MAX_REPLY_LENGTH}</span>
                  <label className="inline-flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={spoilerDraft}
                      onChange={(event) => onChangeSpoilerDraft(reply.id, event.target.checked)}
                      className="size-3.5 rounded border-line"
                    />
                    <ShieldCheck size={12} />
                    스포일러 답글
                  </label>
                  {!canReply ? <span>최대 대댓글 단계에 도달했습니다.</span> : null}
                </div>
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onToggleComposer(reply.id)}
                  className="inline-flex items-center rounded-md border border-line px-2 py-1 text-xs text-fg-3"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={() => onSubmit(reply.id)}
                  disabled={!draft.trim()}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Send size={12} />
                  저장
                </button>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-line bg-canvas/45 px-3 py-2 text-xs text-fg-3">
              로그인하면 답글을 남길 수 있습니다.
            </p>
          )}
        </div>
      )}

      {!collapsed && children.length > 0 && (
        <div className="mt-2">
          <ReplyThread
            items={children}
            userId={userId}
            onSubmit={onSubmit}
            onDelete={onDelete}
            onToggleComposer={onToggleComposer}
            openComposerFor={openComposerFor}
            drafts={drafts}
            onChangeDraft={onChangeDraft}
            spoilerByReplyId={spoilerByReplyId}
            onChangeSpoilerDraft={onChangeSpoilerDraft}
            depth={depth + 1}
          />
        </div>
      )}
    </article>
  );
}

function countReplies(items: ReviewReply[]): number {
  return items.reduce((count, item) => count + 1 + countReplies(item.children ?? []), 0);
}
