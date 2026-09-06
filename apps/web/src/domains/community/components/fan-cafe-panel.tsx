import {
  BookOpenText,
  ImagePlus,
  MessageCircle,
  Bell,
  RefreshCw,
  Send,
  Tag,
  Search,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  TAG_CHIP_LIMIT,
  FAN_CAFE_POST_TITLE_MAX_LENGTH,
  FAN_CAFE_POST_TEXT_MAX_LENGTH,
  FAN_CAFE_POST_TAGS_MAX_LENGTH,
  FAN_CAFE_ACTIVITY_STORAGE_KEY,
  KIND_ITEMS,
} from "./fan-cafe-constants";
import FanPostCard from "./fan-cafe-post-card";

import type { FanCafeComposeLock, FanCafeKindFilter } from "./fan-cafe-constants";
import type { FanCafePost, FanCafePostKind, FanCafeScopeFilter } from "@/shared/lib/types";

import {
  COMMUNITY_SORT_OPTIONS,
  COMMUNITY_SORT_LABEL,
  COMMUNITY_SCOPE_LABEL_WITH_ALL,
  FAN_CAFE_SCOPE_COPY,
} from "@/shared/lib/community-ui";
import { withCsrfProtection } from "@/shared/lib/csrf";
import { ensureArray, resolveApiError, safeParseJson } from "@/shared/lib/http-safe";
import {
  ATTACHMENT_MAX_COUNT,
  fileToAttachmentDataUrl,
} from "@/shared/lib/image-attach";
import { useApp } from "@/shared/lib/store";
import { cn } from "@/shared/lib/utils";
import { useCelebrate } from "@/src/hooks/use-celebrate";

export { FanPostImages } from "./fan-cafe-images";
export { FanPostReplySection } from "./fan-cafe-reply-section";
export type { FanCafeComposeLock };

export function FanCafePanel({
  scope,
  targetId,
  targetLabel,
  compact = false,
  composeLock = null,
  onTopLevelReplyDelta,
  onTopLevelPostCreated,
}: {
  scope: FanCafeScopeFilter;
  targetId?: string;
  targetLabel: string;
  compact?: boolean;
  composeLock?: FanCafeComposeLock | null;
  onTopLevelReplyDelta?: (post: FanCafePost, delta: number) => void;
  onTopLevelPostCreated?: (post: FanCafePost) => void;
}) {
  const userId = useApp((s) => s.userId);
  const sessionToken = useApp((s) => s.sessionToken);
  const [posts, setPosts] = useState<FanCafePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterKind, setFilterKind] = useState<FanCafeKindFilter>("all");
  const [composeKind, setComposeKind] = useState<FanCafePostKind>("talk");
  const [sort, setSort] = useState<"popular" | "recent">("recent");
  const [searchText, setSearchText] = useState("");
  const [queryText, setQueryText] = useState("");
  const [selectedTagState, setSelectedTagState] = useState<{ context: string; tag: string | null }>({
    context: "",
    tag: null,
  });
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [showMyPostsOnly, setShowMyPostsOnly] = useState(false);
  const [postPulse, setPostPulse] = useState(0);
  const postsRequestSignatureRef = useRef("");
  const postPulseTimerRef = useRef<number | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const celebrate = useCelebrate();
  const selectedTagContext = `${scope}|${targetId ?? ""}`;

  function applyTopLevelReplyDelta(postItem: FanCafePost, delta: number) {
    if (!Number.isFinite(delta) || delta === 0) return;
    setPosts((current) => {
      const nextPosts = current.map((item) =>
        item.id === postItem.id ? { ...item, replyCount: Math.max(0, item.replyCount + delta) } : item
      );
      const changed = nextPosts.some((post, index) => post !== current[index]);
      if (!changed) return current;
      if (sort !== "popular") return nextPosts;
      return nextPosts
        .slice()
        .sort((a, b) => b.replyCount - a.replyCount || b.createdAt.localeCompare(a.createdAt));
    });
    onTopLevelReplyDelta?.(postItem, delta);
  }

  const postTagSuggests = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of posts) {
      for (const rawTag of post.tags) {
        const tag = String(rawTag ?? "")
          .replace(/^#/, "")
          .trim()
          .toLowerCase();
        if (!tag) continue;
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TAG_CHIP_LIMIT)
      .map(([tag]) => tag);
  }, [posts]);

  const selectedTag =
    selectedTagState.context === selectedTagContext && postTagSuggests.includes(selectedTagState.tag ?? "")
      ? selectedTagState.tag
      : null;
  const showOnlyMine = Boolean(showMyPostsOnly && userId);

  function setSelectedTagFilter(tag: string | null) {
    setLoading(true);
    setError(null);
    setSelectedTagState({ context: selectedTagContext, tag });
  }

  const apiQuery = useMemo(() => {
    const params = new URLSearchParams({ scope, sort });
    if (scope !== "all" && targetId) params.set("targetId", targetId);
    if (filterKind !== "all") params.set("kind", filterKind);
    if (selectedTag) params.set("tag", selectedTag);
    if (showOnlyMine) params.set("mine", "true");
    return params.toString();
  }, [filterKind, scope, selectedTag, showOnlyMine, sort, targetId]);

  const requestSignature = useMemo(
    () => `${scope}|${targetId ?? ""}|${filterKind}|${sort}|${selectedTag ?? ""}|${queryText}|${showOnlyMine}`,
    [filterKind, queryText, scope, selectedTag, showOnlyMine, sort, targetId]
  );

  const canComposePost = scope !== "all" && Boolean(targetId);
  const authHeaders = useMemo(() => (sessionToken ? { "x-user-id": sessionToken } : undefined), [sessionToken]);

  function appendDemoActivity(action: string, label: string, detail?: string) {
    if (typeof window === "undefined") return;
    try {
      const raw = globalThis.localStorage.getItem(FAN_CAFE_ACTIVITY_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const current = Array.isArray(parsed) ? parsed : [];
      const next = [
        ...current,
        {
          id: `fan-cafe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
          at: Date.now(),
          action,
          label,
          detail,
          scope,
          targetLabel,
        },
      ].slice(-20);
      globalThis.localStorage.setItem(FAN_CAFE_ACTIVITY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Demo activity is optional; storage failures should not block the UI.
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      setQueryText(searchText.trim().toLowerCase());
    }, 220);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") {
        setLoading(true);
        setError(null);
        setRefreshTick((current) => current + 1);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    const interval = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [autoRefreshEnabled]);

  useEffect(() => {
    if (!postPulse) return;
    if (postPulseTimerRef.current) {
      globalThis.clearTimeout(postPulseTimerRef.current);
    }
    postPulseTimerRef.current = window.setTimeout(() => setPostPulse(0), 5500);
    return () => {
      if (postPulseTimerRef.current) {
        globalThis.clearTimeout(postPulseTimerRef.current);
        postPulseTimerRef.current = null;
      }
    };
  }, [postPulse]);

  useEffect(() => {
    return () => {
      if (postPulseTimerRef.current) {
        globalThis.clearTimeout(postPulseTimerRef.current);
        postPulseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const isContextChanged = postsRequestSignatureRef.current !== requestSignature;
    postsRequestSignatureRef.current = requestSignature;

    const controller = new AbortController();
    const resetTimer = globalThis.setTimeout(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
      if (isContextChanged) {
        setPostPulse(0);
        setPosts([]);
        setHasMore(false);
        setNextCursor(null);
      }
    }, 0);
    const params = new URLSearchParams(apiQuery);
    if (queryText) params.set("q", queryText);
    params.set("limit", "20");
    fetch(`/api/community/posts?${params.toString()}`, { cache: "no-store", signal: controller.signal, headers: authHeaders })
      .then(async (res) => {
        const payload = await safeParseJson<unknown>(res);
        if (!res.ok) {
          throw new Error(resolveApiError(payload, `posts load failed (${res.status})`));
        }
        if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) {
          throw new Error("invalid payload");
        }
        return payload as { items: unknown[]; nextCursor?: string | null; hasMore?: boolean };
      })
      .then((data) => {
        const nextItems = ensureArray(data.items) as FanCafePost[];
        let incomingPosts = 0;

        setPosts((currentPosts) => {
          if (!isContextChanged && sort === "recent" && currentPosts.length > 0) {
            const currentIdSet = new Set(currentPosts.map((post) => post.id));
            const nextIdSet = new Set(nextItems.map((post) => post.id));
            incomingPosts = nextItems.reduce((count, post) => (currentIdSet.has(post.id) ? count : count + 1), 0);
            const retained = currentPosts.filter((post) => !nextIdSet.has(post.id));
            return [...nextItems, ...retained];
          }
          return nextItems;
        });

        if (!isContextChanged && incomingPosts > 0) {
          setPostPulse(incomingPosts);
        }
        setNextCursor(data.nextCursor ?? null);
        setHasMore(Boolean(data.hasMore));
        setLastSyncedAt(new Date().toISOString());
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError("팬카페 글을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      globalThis.clearTimeout(resetTimer);
      controller.abort();
    };
  }, [apiQuery, authHeaders, queryText, refreshTick, requestSignature, sort]);

  async function loadMore() {
    if (!nextCursor || loadingMore || !hasMore) return;
    setLoadingMore(true);
    setError(null);
    const params = new URLSearchParams(apiQuery);
    if (queryText) params.set("q", queryText);
    params.set("limit", "20");
    params.set("cursor", nextCursor);
    try {
      const res = await fetch(`/api/community/posts?${params.toString()}`, { cache: "no-store", headers: authHeaders });
      const data = await safeParseJson<unknown>(res);
      if (!res.ok) {
        throw new Error(resolveApiError(data, `load more failed (${res.status})`));
      }
      if (!data || typeof data !== "object" || !Array.isArray((data as { items?: unknown }).items)) {
        throw new Error("invalid payload");
      }
      const parsedData = data as { items: unknown[]; nextCursor?: string | null; hasMore?: boolean };
      const nextItems = ensureArray<FanCafePost>(parsedData.items);
      setPosts((current) => [...current, ...nextItems]);
      setNextCursor(parsedData.nextCursor ?? null);
      setHasMore(Boolean(parsedData.hasMore));
    } catch {
      setError("추가 게시글을 불러오지 못했습니다.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function attachFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setAttachBusy(true);
    try {
      const incoming = [...files].slice(0, ATTACHMENT_MAX_COUNT - images.length);
      if (incoming.length === 0) {
        setError(`이미지는 최대 ${ATTACHMENT_MAX_COUNT}장까지 첨부할 수 있어요.`);
        return;
      }
      const converted: string[] = [];
      for (const file of incoming) {
        converted.push(await fileToAttachmentDataUrl(file));
      }
      setImages((current) => [...current, ...converted].slice(0, ATTACHMENT_MAX_COUNT));
    } catch (err) {
      setError(err instanceof Error ? err.message : "이미지를 처리하지 못했어요.");
    } finally {
      setAttachBusy(false);
    }
  }

  async function submit(sourceEl?: HTMLElement | null) {
    if (!userId) return;
    if (!title.trim() || !text.trim()) return;
    if (!canComposePost) {
      setError("팬카페 대상이 지정된 보드에서만 글을 작성할 수 있어요.");
      return;
    }
    setIsSubmittingPost(true);
    setError(null);
    try {
      const res = await fetch("/api/community/posts", withCsrfProtection({
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", ...(authHeaders ?? {}) },
        body: JSON.stringify({
          scope,
          targetId,
          targetLabel,
          kind: composeKind,
          title,
          text,
          images,
          tags: tags
            .split(/[,\s#]+/)
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
        }),
      }));
      const data = await safeParseJson<unknown>(res);
      if (!res.ok) {
        setError(resolveApiError(data, "팬카페 글을 저장하지 못했습니다."));
        return;
      }
      if (!data || typeof data !== "object") {
        setError("팬카페 글 응답이 유효하지 않습니다.");
        return;
      }
      const created = data as FanCafePost;
      // 게시 성공 축하 — 등록 버튼에서 파티클 팡 + success 효과음 + 햅틱(모션 최소화 시 파티클 생략).
      celebrate(sourceEl, { chars: ["🎉", "✨", "💬"], count: 18 });
      onTopLevelPostCreated?.(created);
      const normalizedCreatedTags = created.tags.map((tag) => tag.toLowerCase());
      const tagMatch = !selectedTag || normalizedCreatedTags.includes(selectedTag);
      const shouldInsert =
        (filterKind === "all" || filterKind === created.kind) &&
        tagMatch &&
        (!queryText || `${created.title} ${created.text}`.toLowerCase().includes(queryText));

      if (!shouldInsert) {
        setError("현재 필터/검색 조건과 달라 목록에 바로 반영되지 않습니다.");
      } else {
        setError(null);
        setPosts((current) => {
          const next = [created, ...current];
          if (sort === "popular") {
            return next
              .slice()
              .sort((a, b) => b.replyCount - a.replyCount || b.createdAt.localeCompare(a.createdAt));
          }
          return next;
        });
      }
      setTitle("");
      setText("");
      setTags("");
      setImages([]);
      setRefreshTick((current) => current + 1);
    } catch {
      setError("팬카페 글을 저장하지 못했습니다.");
    } finally {
      setIsSubmittingPost(false);
    }
  }

  function refreshNow() {
    setLoading(true);
    setError(null);
    setRefreshTick((current) => current + 1);
  }

  return (
    <section className="rounded-2xl border border-line bg-panel/45 p-5 surface-hl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-1.5 text-accent">
            <UsersRound size={14} />
            FAN CAFE
          </p>
          <h2 className="mt-2 text-xl font-bold tracking-tight text-fg">{targetLabel} 팬카페</h2>
          {compact && scope !== "all" && (
            <p className="mt-1 text-xs text-fg-3">
              <span className="rounded-full border border-line px-1.5 py-0.5 text-[0.65rem]">{COMMUNITY_SCOPE_LABEL_WITH_ALL[scope]}</span> {targetLabel}
            </p>
          )}
          <p className="mt-1 max-w-xl text-pretty text-sm leading-relaxed text-fg-2">
            {FAN_CAFE_SCOPE_COPY[scope]}
          </p>
        </div>
        <div className="inline-flex shrink-0 items-center gap-2 self-start rounded-xl border border-line bg-canvas/45 px-3 py-2 text-xs text-fg-2">
          <BookOpenText size={14} className="text-accent" />
          게시글 <span className="numeral text-fg">{posts.length}</span>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <p className="text-fg-3">
          마지막 동기화: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : "로딩 전"}
        </p>
        {postPulse > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-accent/35 bg-accent-soft px-2 py-1 text-xs text-accent">
            <Bell size={12} />
            새 글 {postPulse}개 반영
          </span>
        ) : null}
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-canvas/40 px-2 py-1.5">
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={(event) => setAutoRefreshEnabled(event.target.checked)}
              className="size-3.5"
            />
            <span className="text-fg-3">실시간 새로고침(30초)</span>
          </label>
          <button
            type="button"
            onClick={refreshNow}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-raised px-2 py-1.5 text-fg-3 transition-colors hover:bg-canvas/55 hover:text-fg"
          >
            <RefreshCw size={13} />
            새로고침
          </button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex h-10 min-w-0 flex-1 basis-full items-center gap-2 rounded-xl border border-line bg-canvas/40 px-3 text-xs transition-colors focus-within:border-accent/50 sm:basis-56">
          <Search size={14} className="shrink-0 text-fg-3" />
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            maxLength={80}
            aria-label="팬카페 글 검색 (제목·본문 키워드)"
            placeholder="제목·본문 키워드 검색"
            className="h-full w-full min-w-0 border-none bg-transparent text-sm outline-none placeholder:text-fg-3"
          />
        </div>
        <button
          type="button"
          onClick={() => setSelectedTagFilter(null)}
          className={cn(
            "inline-flex h-9 items-center gap-1 rounded-xl border border-line bg-raised/45 px-2.5 text-xs font-medium transition-colors",
            selectedTag === null ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-canvas/55 hover:text-fg"
          )}
        >
          <Tag size={12} />
          태그 전체
        </button>
        <div className="inline-flex h-9 rounded-xl border border-line bg-raised/40">
          {COMMUNITY_SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setSort(option.value);
              }}
              className={cn(
                "px-3 text-xs font-medium transition-colors first:rounded-l-xl last:rounded-r-xl",
                sort === option.value ? "bg-accent text-on-accent" : "text-fg-2 hover:bg-canvas/55 hover:text-fg"
              )}
            >
              {COMMUNITY_SORT_LABEL[option.value]}
            </button>
          ))}
        </div>
      </div>
      {postTagSuggests.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[0.68rem] text-fg-3">태그:</span>
          {postTagSuggests.map((tag) => {
            const active = selectedTag === tag;
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTagFilter(active ? null : tag)}
                className={cn(
                  "rounded-full border px-2 py-1 text-[0.65rem] transition-colors",
                  active
                    ? "border-accent/55 bg-accent-soft text-accent"
                    : "border-line bg-canvas/50 text-fg-3 hover:text-fg"
                )}
              >
                #{tag}
              </button>
            );
          })}
        </div>
      )}

          <div className={cn("grid gap-4", !compact && "lg:grid-cols-[0.9fr_1.1fr]")}>
            <div className="rounded-xl border border-line bg-card p-4">
              {userId ? (
                <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-canvas/40 px-2 py-1.5 text-xs text-fg-3">
                  <input
                    type="checkbox"
                    checked={showOnlyMine}
                    onChange={(event) => {
                      setLoading(true);
                      setError(null);
                      setShowMyPostsOnly(event.target.checked);
                    }}
                    className="size-3.5"
                  />
                  <span>내 글만 보기</span>
                </label>
              ) : null}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {KIND_ITEMS.map((item) => (
                  <button
                key={item.value}
                type="button"
                onClick={() => {
                  setLoading(true);
                  setError(null);
                  setFilterKind(item.value);
                }}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  filterKind === item.value
                    ? "border-accent/55 bg-accent-soft text-accent"
                    : "border-line bg-raised/45 text-fg-3 hover:text-fg"
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          {canComposePost ? (
            composeLock ? (
              <div className="rounded-lg border border-dashed border-line bg-canvas/45 px-4 py-8 text-center">
                <UsersRound className="mx-auto mb-2 text-accent" size={20} />
                <p className="text-sm font-medium text-fg">{composeLock.message}</p>
                <p className="mt-1 text-xs text-fg-3">읽기는 누구에게나 열려 있습니다.</p>
                {composeLock.actionLabel && composeLock.onAction ? (
                  <button
                    type="button"
                    onClick={composeLock.onAction}
                    className="mt-4 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-2"
                  >
                    {composeLock.actionLabel}
                  </button>
                ) : null}
              </div>
            ) : userId ? (
            <div className="flex flex-col gap-3">
                <label className="flex items-center gap-2 text-xs text-fg-3">
                  <span>카테고리</span>
                  <select
                    value={composeKind}
                    onChange={(event) => setComposeKind(event.target.value as FanCafePostKind)}
                    className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-fg outline-none focus:border-accent/60"
                  >
                    {KIND_ITEMS.filter((item) => item.value !== "all").map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value.slice(0, FAN_CAFE_POST_TITLE_MAX_LENGTH))}
                  maxLength={FAN_CAFE_POST_TITLE_MAX_LENGTH}
                  aria-label="팬카페 글 제목"
                  placeholder="팬카페 글 제목"
                  className="h-10 rounded-lg border border-line bg-canvas px-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent/60"
                />
                <div className="text-right text-[0.7rem] text-fg-3">
                  {title.length}/{FAN_CAFE_POST_TITLE_MAX_LENGTH}
                </div>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value.slice(0, FAN_CAFE_POST_TEXT_MAX_LENGTH))}
                  maxLength={FAN_CAFE_POST_TEXT_MAX_LENGTH}
                  rows={5}
                  aria-label="팬카페 글 본문"
                  placeholder="해석, 질문, 응원, 팬아트 메모를 남겨보세요."
                  className="resize-none rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent/60"
                />
                <div className="text-right text-[0.7rem] text-fg-3">
                  {text.length}/{FAN_CAFE_POST_TEXT_MAX_LENGTH}
                </div>
                <input
                  value={tags}
                  onChange={(event) => setTags(event.target.value.slice(0, FAN_CAFE_POST_TAGS_MAX_LENGTH))}
                  maxLength={FAN_CAFE_POST_TAGS_MAX_LENGTH}
                  aria-label="팬카페 글 태그 (선택)"
                  placeholder="#정주행 #해석 처럼 태그 추가"
                  className="h-10 rounded-lg border border-line bg-canvas px-3 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent/60"
                />
                <input
                  ref={attachInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) => {
                    void attachFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => attachInputRef.current?.click()}
                    disabled={attachBusy || images.length >= ATTACHMENT_MAX_COUNT}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-raised/55 px-2.5 text-xs font-medium text-fg-2 transition-colors hover:bg-canvas/55 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <ImagePlus size={14} />
                    {attachBusy ? "이미지 처리 중..." : `이미지 첨부 ${images.length}/${ATTACHMENT_MAX_COUNT}`}
                  </button>
                  <span className="text-[0.65rem] text-fg-3">긴 변 1600px·장당 2MB로 자동 축소</span>
                </div>
                {images.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {images.map((src, index) => (
                      <li key={`${index}-${src.slice(-24)}`} className="relative">
                        <img
                          src={src}
                          alt={`첨부 미리보기 ${index + 1}`}
                          className="size-16 rounded-lg border border-line object-cover"
                        />
                        <button
                          type="button"
                          aria-label={`첨부 이미지 ${index + 1} 제거`}
                          onClick={() => setImages((current) => current.filter((_, i) => i !== index))}
                          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-line bg-canvas text-fg-3 transition-colors hover:text-bad"
                        >
                          <X size={11} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={(event) => void submit(event.currentTarget)}
                  disabled={!title.trim() || !text.trim() || isSubmittingPost || attachBusy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Send size={15} />
                  {isSubmittingPost ? "등록 중..." : "팬카페에 올리기"}
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-canvas/45 px-4 py-8 text-center">
                <Sparkles className="mx-auto mb-2 text-accent" size={20} />
                <p className="text-sm font-medium text-fg">로그인하면 팬카페에 글을 쓸 수 있습니다.</p>
                <p className="mt-1 text-xs text-fg-3">읽기는 누구에게나 열려 있습니다.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => appendDemoActivity("blocked", "로그인 전 작성 차단", "약관 확인 후 로그인 필요")}
                    className="rounded-lg border border-line bg-raised px-3 py-2 text-xs font-semibold text-fg-2 transition-colors hover:border-accent/45 hover:text-fg"
                  >
                    차단 로그 남기기
                  </button>
                  <a className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-on-accent" href="/terms">
                    약관 보기
                  </a>
                </div>
              </div>
            )
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-canvas/45 px-4 py-8 text-center">
              <Sparkles className="mx-auto mb-2 text-accent" size={20} />
              <p className="text-sm font-medium text-fg">현재 통합 피드에서는 작성이 제한돼요.</p>
              <p className="mt-1 text-xs text-fg-3">작품·작가·펜카페 보드로 이동해 작성할 수 있습니다.</p>
              <button
                type="button"
                onClick={() => appendDemoActivity("blocked", "통합 피드 작성 차단", "대상 보드에서 작성 가능")}
                className="mt-4 rounded-lg border border-line bg-raised px-3 py-2 text-xs font-semibold text-fg-2 transition-colors hover:border-accent/45 hover:text-fg"
              >
                작성 제한 로그 남기기
              </button>
            </div>
          )}
          {error && <p className="mt-3 text-xs text-bad">{error}</p>}
        </div>

        <div className="flex flex-col gap-3">
          {loading ? (
            <>
              <div className="skeleton h-28 w-full rounded-xl" />
              <div className="skeleton h-28 w-full rounded-xl" />
            </>
          ) : posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-card/50 px-5 py-12 text-center">
              <MessageCircle className="mx-auto mb-3 text-fg-3" size={22} />
              <p className="text-sm font-medium text-fg">아직 팬카페 글이 없습니다.</p>
              <p className="mt-1 text-xs text-fg-3">첫 해석이나 응원을 남겨보세요.</p>
            </div>
          ) : (
            posts.map((post) => (
              <FanPostCard
                key={post.id}
                post={post}
                compact={compact}
                onReplyCreated={(replyPost, delta) => applyTopLevelReplyDelta(replyPost, delta)}
                onDeleted={(id) => setPosts((current) => current.filter((p) => p.id !== id))}
              />
            ))
          )}
          {loadingMore ? (
            <div className="skeleton h-20 w-full rounded-xl" />
          ) : hasMore ? (
            <button
              type="button"
              onClick={loadMore}
              className="rounded-lg border border-line bg-raised px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-canvas/55"
            >
              더 보기
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
