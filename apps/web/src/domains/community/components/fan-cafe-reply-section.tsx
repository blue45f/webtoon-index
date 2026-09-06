import { CornerDownRight, MessageCircle, RefreshCw, Send, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FAN_CAFE_REPLY_MAX_LENGTH, MAX_REPLY_DEPTH } from "./fan-cafe-constants";
import { countReplies, maskReplyNode, removeReplyNode } from "./fan-cafe-tree-utils";

import type { FanCafeReply } from "@/shared/lib/types";

import { withCsrfProtection } from "@/shared/lib/csrf";
import { ensureArray, resolveApiError, safeParseJson } from "@/shared/lib/http-safe";
import { useApp } from "@/shared/lib/store";
import { cn, relativeDate } from "@/shared/lib/utils";
import { useCelebrate } from "@/src/hooks/use-celebrate";

export function FanPostReplySection({
  postId,
  initialReplies,
  onCountChange,
  onReplyDelta,
  className,
}: {
  postId: string;
  initialReplies?: FanCafeReply[];
  /** 로드/작성/삭제 후 전체(마스킹 포함) 답글 수를 알려준다. */
  onCountChange?: (count: number) => void;
  /** 서버 집계 기준 답글 수 변화량(+1 작성, -1 완전 삭제). 소프트 삭제는 0. */
  onReplyDelta?: (delta: number) => void;
  className?: string;
}) {
  const userId = useApp((s) => s.userId);
  const sessionToken = useApp((s) => s.sessionToken);
  const [loaded, setLoaded] = useState(Boolean(initialReplies));
  const [replies, setReplies] = useState<FanCafeReply[]>(initialReplies ?? []);
  const [error, setError] = useState<string | null>(null);
  const [submittingReplies, setSubmittingReplies] = useState<Record<string, boolean>>({});
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({ "__root__": "" });
  const [openComposerFor, setOpenComposerFor] = useState<string | null>(null);
  const [replySyncAt, setReplySyncAt] = useState<string | null>(null);
  const [isLoadingReplies, setIsLoadingReplies] = useState(false);
  const [replyAutoRefreshEnabled, setReplyAutoRefreshEnabled] = useState(false);
  const [replyRefreshTick, setReplyRefreshTick] = useState(0);
  const replyRefreshControllerRef = useRef<AbortController | null>(null);
  const celebrate = useCelebrate();

  function refreshReplies() {
    setReplyRefreshTick((current) => current + 1);
  }

  // 트리가 바뀔 때마다(로드/작성/삭제) 부모에 전체 답글 수를 알린다 — 비동기 핸들러의 stale 트리 의존 제거.
  useEffect(() => {
    if (!loaded) return;
    onCountChange?.(countReplies(replies));
  }, [loaded, onCountChange, replies]);

  useEffect(() => {
    if (!replyAutoRefreshEnabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        refreshReplies();
      }
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [replyAutoRefreshEnabled]);

  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      replyRefreshControllerRef.current?.abort();
      setIsLoadingReplies(true);
      setError(null);
      const controller = new AbortController();
      replyRefreshControllerRef.current = controller;

      fetch(`/api/community/posts/${encodeURIComponent(postId)}/replies`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = await safeParseJson<unknown>(res);
          if (!res.ok) {
            throw new Error(resolveApiError(data, "댓글을 불러오지 못했습니다."));
          }
          if (!data || !Array.isArray(data)) {
            throw new Error("댓글 응답이 유효하지 않습니다.");
          }
          return ensureArray<FanCafeReply>(data);
        })
        .then((nextReplies) => {
          if (controller.signal.aborted) return;
          setReplies(nextReplies);
          setLoaded(true);
          setReplySyncAt(new Date().toISOString());
        })
        .catch((err) => {
          if ((err as Error).name === "AbortError") return;
          setError(err instanceof Error ? err.message : "댓글을 불러오지 못했습니다.");
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoadingReplies(false);
          }
        });
    }, 0);
    return () => {
      globalThis.clearTimeout(timer);
      replyRefreshControllerRef.current?.abort();
    };
    // onCountChange는 부모 setState라 참조 변동이 잦다 — postId/tick 기준으로만 재요청한다.
  }, [postId, replyRefreshTick]);

  function setDraft(id: string, value: string) {
    const next = value.slice(0, FAN_CAFE_REPLY_MAX_LENGTH);
    setReplyDrafts((current) => ({ ...current, [id]: next }));
  }

  function getDraft(id: string) {
    return replyDrafts[id] ?? "";
  }

  function toggleComposer(id: string | null) {
    if (!id) {
      setOpenComposerFor(null);
      return;
    }
    setOpenComposerFor((current) => (current === id ? null : id));
  }

  function insertReply(tree: FanCafeReply[], parentId: string | null, reply: FanCafeReply): FanCafeReply[] {
    if (!parentId) return [...tree, reply];
    let inserted = false;
    const next = tree.map((item) => {
      if (item.id === parentId) {
        inserted = true;
        return { ...item, children: [...(item.children ?? []), reply] };
      }
      if (!item.children || item.children.length === 0) return item;
      const nextChildren = insertReply(item.children, parentId, reply);
      if (nextChildren !== item.children) {
        inserted = true;
        return { ...item, children: nextChildren };
      }
      return item;
    });
    if (!inserted) return [...tree, reply];
    return next;
  }

  async function submitReply(parentId: string | null, sourceEl?: HTMLElement | null) {
    if (!userId) return;
    const draft = getDraft(parentId ?? "__root__").trim();
    if (!draft) return;

    const draftKey = parentId ?? "__root__";
    setSubmittingReplies((current) => ({ ...current, [draftKey]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/community/posts/${encodeURIComponent(postId)}/replies`, withCsrfProtection({
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(sessionToken ? { "x-user-id": sessionToken } : {}) },
        body: JSON.stringify({
          text: draft,
          ...(parentId ? { parentId } : {}),
        }),
      }));

      const data = await safeParseJson<unknown>(res);
      if (!res.ok) {
        setError(resolveApiError(data, "댓글을 저장하지 못했습니다."));
        return;
      }
      if (!data || typeof data !== "object") {
        setError("댓글 응답이 유효하지 않습니다.");
        return;
      }
      const created = data as FanCafeReply;
      // 댓글 등록 축하 — 등록 버튼에서 작게 팡(글 등록보다 한 단계 절제).
      celebrate(sourceEl, { chars: ["🎉", "✨", "💬"], count: 14, spread: 0.9 });
      setReplies((current) => insertReply(current, parentId, created));
      onReplyDelta?.(1);
      setReplySyncAt(new Date().toISOString());
      setDraft(parentId ?? "__root__", "");
      setLoaded(true);
      setOpenComposerFor(null);
    } catch {
      setError("댓글을 저장하지 못했습니다.");
    } finally {
      setSubmittingReplies((current) => ({ ...current, [draftKey]: false }));
    }
  }

  // 본인 답글 삭제 — 하위 답글이 있으면 서버가 소프트 삭제(자리 표시)로 남긴다.
  async function deleteReply(replyId: string) {
    if (!userId) return;
    if (!globalThis.confirm("이 댓글을 삭제할까요?")) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/community/posts/${encodeURIComponent(postId)}/replies/${encodeURIComponent(replyId)}`,
        withCsrfProtection({
          method: "DELETE",
          cache: "no-store",
          headers: sessionToken ? { "x-user-id": sessionToken } : undefined,
        })
      );
      const data = await safeParseJson<unknown>(res);
      if (!res.ok) {
        setError(resolveApiError(data, "댓글을 삭제하지 못했습니다."));
        return;
      }
      const result = (data ?? {}) as { deleted?: boolean; soft?: boolean };
      if (!result.deleted) {
        setError("댓글을 삭제하지 못했습니다.");
        return;
      }
      setReplies((current) => (result.soft ? maskReplyNode(current, replyId) : removeReplyNode(current, replyId)));
      if (!result.soft) onReplyDelta?.(-1);
      setReplySyncAt(new Date().toISOString());
    } catch {
      setError("댓글을 삭제하지 못했습니다.");
    }
  }

  const rootDraft = getDraft("__root__");
  const isRootSubmitting = Boolean(submittingReplies.__root__);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-canvas/25 px-3 py-2 text-[0.68rem] text-fg-3">
        <span>동기화 {replySyncAt ? new Date(replySyncAt).toLocaleTimeString() : "대기 중"}</span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg px-1.5 transition-colors hover:bg-raised/70">
            <input
              type="checkbox"
              checked={replyAutoRefreshEnabled}
              onChange={(event) => setReplyAutoRefreshEnabled(event.target.checked)}
              className="size-3.5"
            />
            30초 갱신
          </label>
          <button
            type="button"
            onClick={refreshReplies}
            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-line bg-raised/50 px-2 text-[0.65rem] font-medium text-fg-3 transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoadingReplies}
          >
            <RefreshCw size={12} className={cn(isLoadingReplies && "animate-spin motion-reduce:animate-none")} />
            {isLoadingReplies ? "동기화 중" : "새로고침"}
          </button>
        </div>
      </div>
      {isLoadingReplies && !loaded ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="skeleton h-14 w-5/6 rounded-xl" />
        </div>
      ) : null}
      {replies.length === 0 && loaded ? (
        <div className="rounded-xl border border-dashed border-line bg-canvas/30 px-3 py-4 text-xs text-fg-3">
          첫 댓글을 남겨 대화를 시작하세요.
        </div>
      ) : (
        <ReplyThread
          items={replies}
          userId={userId}
          onSubmit={submitReply}
          onDelete={deleteReply}
          onToggleComposer={toggleComposer}
          openComposerFor={openComposerFor}
          draftByReplyId={replyDrafts}
          onChangeDraft={setDraft}
          submittingReplies={submittingReplies}
        />
      )}
      {userId ? (
        <div className="rounded-xl border border-line bg-canvas/35 p-3 transition-colors focus-within:border-accent/60">
          <textarea
            value={rootDraft}
            onChange={(event) => setDraft("__root__", event.target.value)}
            maxLength={FAN_CAFE_REPLY_MAX_LENGTH}
            rows={2}
            aria-label="댓글 작성"
            placeholder="댓글 남기기"
            className="min-h-16 w-full resize-none bg-transparent text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3"
          />
          <div className="mt-2 flex items-center justify-between gap-2 text-[0.65rem] text-fg-3">
            <span>{rootDraft.length}/{FAN_CAFE_REPLY_MAX_LENGTH}</span>
            <button
              type="button"
              onClick={(event) => void submitReply(null, event.currentTarget)}
              disabled={!rootDraft.trim() || isRootSubmitting}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Send size={13} />
              {isRootSubmitting ? "등록 중..." : "등록"}
            </button>
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-canvas/25 px-3 py-3 text-xs text-fg-3">
          로그인하면 댓글과 대댓글을 남길 수 있습니다.
        </p>
      )}
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bad/35 bg-bad/10 px-3 py-2 text-xs text-bad">
          <span>{error}</span>
          <button
            type="button"
            onClick={refreshReplies}
            className="rounded-lg border border-bad/30 px-2 py-1 font-medium"
          >
            다시 시도
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ReplyThread({
  items,
  userId,
  onSubmit,
  onDelete,
  onToggleComposer,
  openComposerFor,
  draftByReplyId,
  onChangeDraft,
  submittingReplies,
  depth = 0,
}: {
  items: FanCafeReply[];
  userId: string | null;
  onSubmit: (parentId: string | null, sourceEl?: HTMLElement | null) => Promise<void>;
  onDelete: (replyId: string) => Promise<void>;
  onToggleComposer: (parentId: string | null) => void;
  openComposerFor: string | null;
  draftByReplyId: Record<string, string>;
  onChangeDraft: (id: string, value: string) => void;
  submittingReplies: Record<string, boolean>;
  depth?: number;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {items.map((reply) => (
        <FanPostReplyItem
          key={reply.id}
          reply={reply}
          depth={depth}
          userId={userId}
          canReply={depth < MAX_REPLY_DEPTH - 1}
          onSubmit={onSubmit}
          onDelete={onDelete}
          onToggleComposer={onToggleComposer}
          openComposerFor={openComposerFor}
          draftByReplyId={draftByReplyId}
          onChangeDraft={onChangeDraft}
          submittingReplies={submittingReplies}
          isSubmitting={submittingReplies[reply.id]}
        />
      ))}
    </div>
  );
}

export function FanPostReplyItem({
  reply,
  depth,
  userId,
  canReply,
  onSubmit,
  onDelete,
  onToggleComposer,
  openComposerFor,
  draftByReplyId,
  onChangeDraft,
  submittingReplies,
  isSubmitting = false,
}: {
  reply: FanCafeReply;
  depth: number;
  userId: string | null;
  canReply: boolean;
  onSubmit: (parentId: string | null, sourceEl?: HTMLElement | null) => Promise<void>;
  onDelete: (replyId: string) => Promise<void>;
  onToggleComposer: (parentId: string | null) => void;
  openComposerFor: string | null;
  draftByReplyId: Record<string, string>;
  onChangeDraft: (id: string, value: string) => void;
  submittingReplies: Record<string, boolean>;
  isSubmitting?: boolean;
}) {
  const isOpen = openComposerFor === reply.id;
  const replyKey = reply.id;
  const draft = draftByReplyId[replyKey] ?? "";
  const children = reply.children ?? [];
  const hasChildren = children.length > 0;
  const isDeleted = Boolean(reply.deleted);
  const isOwnReply = !isDeleted && Boolean(userId) && reply.author.id === userId;

  return (
    <article
      className={cn(
        "relative rounded-xl border border-line bg-canvas/35 p-3 transition-colors hover:border-line-strong sm:p-3.5",
        depth > 0 && "ml-4 sm:ml-6"
      )}
    >
      {depth > 0 ? (
        <span className="absolute -left-4 top-5 h-px w-3 bg-line sm:-left-5 sm:w-4" aria-hidden />
      ) : null}
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[0.68rem] text-fg-3">
        {depth > 0 ? <CornerDownRight size={12} className="text-accent/80" aria-hidden /> : null}
        <span className="max-w-[12rem] truncate font-semibold text-fg-2">{reply.author.name}</span>
        <span>{relativeDate(reply.createdAt)}</span>
        {hasChildren ? <span className="text-fg-3">답글 {countReplies(children)}</span> : null}
        {isOwnReply ? (
          <button
            type="button"
            onClick={() => void onDelete(reply.id)}
            aria-label="내 댓글 삭제"
            title="삭제"
            className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-lg px-1.5 text-fg-3 transition-colors hover:bg-raised hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Trash2 size={12} />
            삭제
          </button>
        ) : null}
      </div>
      {isDeleted ? (
        <p className="text-sm italic leading-relaxed text-fg-3">삭제된 댓글입니다.</p>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-2">{reply.text}</p>
      )}
      {!isDeleted && canReply && (
        <button
          type="button"
          onClick={() => onToggleComposer(reply.id)}
          aria-expanded={isOpen}
          className={cn(
            "mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.68rem] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isOpen
              ? "border-accent/45 bg-accent-soft text-accent"
              : "border-line bg-raised/40 text-fg-3 hover:text-fg-2"
          )}
        >
          <MessageCircle size={12} />
          대댓글
        </button>
      )}
      {isOpen && (
        <div className="mt-2">
          {userId ? (
            <div className="rounded-xl border border-line bg-panel/45 p-2.5 transition-colors focus-within:border-accent/60">
              <textarea
                value={draft}
                onChange={(event) => onChangeDraft(replyKey, event.target.value)}
                maxLength={FAN_CAFE_REPLY_MAX_LENGTH}
                rows={2}
                aria-label={`${reply.author.name}에게 대댓글 작성`}
                placeholder={`${reply.author.name}에게 대댓글`}
                className="min-h-14 w-full resize-none bg-transparent text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3"
              />
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[0.65rem] text-fg-3">
                <span>{draft.length}/{FAN_CAFE_REPLY_MAX_LENGTH}</span>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleComposer(reply.id)}
                    className="inline-flex min-h-8 items-center rounded-lg border border-line px-2.5 text-xs text-fg-3 transition-colors hover:text-fg"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    onClick={(event) => void onSubmit(reply.id, event.currentTarget)}
                    disabled={!draft.trim() || isSubmitting}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg bg-accent px-2.5 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Send size={12} />
                    {isSubmitting ? "저장 중..." : "등록"}
                  </button>
                </div>
              </div>
              {depth >= MAX_REPLY_DEPTH - 1 ? (
                <p className="mt-2 rounded-lg bg-raised/50 px-2 py-1.5 text-[0.65rem] text-fg-3">
                  최대 대댓글 깊이에 도달했습니다.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg border border-line bg-panel/45 px-3 py-2 text-xs text-fg-3">
              로그인하면 대댓글을 남길 수 있습니다.
            </p>
          )}
        </div>
      )}
      {children.length > 0 && (
        <div className="relative mt-2">
          <span className="absolute bottom-2 left-3 top-0 w-px bg-line/70" aria-hidden />
          <ReplyThread
            items={children}
            userId={userId}
            onSubmit={onSubmit}
            onDelete={onDelete}
            onToggleComposer={onToggleComposer}
            openComposerFor={openComposerFor}
            draftByReplyId={draftByReplyId}
            onChangeDraft={onChangeDraft}
            submittingReplies={submittingReplies}
            depth={depth + 1}
          />
        </div>
      )}
    </article>
  );
}
