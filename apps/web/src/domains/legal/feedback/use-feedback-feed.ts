import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedbackEntry, FeedbackKind, FeedbackProgress } from "@toonspectrum/core/feedback";

import { assertFeedbackPage } from "@toonspectrum/core/feedback-response";
import { api, getApiErrorMessage } from "@/src/infrastructure/api";

export interface FeedbackFilters { category: FeedbackKind | "all"; progress: FeedbackProgress | "all"; query: string; mine: boolean; tag: string }
interface Snapshot { key: string; items: FeedbackEntry[]; canManage: boolean }

export function useFeedbackFeed(filters: FeedbackFilters, userId: string | null) {
  const { category, progress, query, mine, tag } = filters;
  // A successful list belongs to exactly one filter and identity context. Never show
  // another account's vote/management state while its replacement request is pending.
  const requestKey = JSON.stringify([category, progress, query, mine && !!userId, tag, userId]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [apiReady, setApiReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const moreRequest = useRef<AbortController | null>(null);
  const moreBusy = useRef(false);
  const usedCursors = useRef(new Set<string>());
  const active = snapshot?.key === requestKey;

  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    moreRequest.current?.abort();
    moreBusy.current = false;
    usedCursors.current.clear();
    setLoadingMore(false);
    setLoading(true);
    setApiReady(false);
    setError("");
    setMoreError("");
    setCursor(null);
    api.get<unknown>("/feedback/posts", {
      params: { category, progress, q: query, mine: mine && !!userId, tag, limit: 20 },
      signal: controller.signal, timeout: 20_000, referrerPolicy: "no-referrer",
    }).then((page) => {
      if (controller.signal.aborted || current !== generation.current) return;
      assertFeedbackPage(page);
      setApiReady(true);
      setSnapshot({ key: requestKey, items: page.items, canManage: page.canManage === true });
      setCursor(page.hasMore ? page.nextCursor : null);
    }).catch(async (cause: unknown) => {
      const message = await getApiErrorMessage(cause, "제보 목록을 불러오지 못했어요.");
      if (!controller.signal.aborted && current === generation.current) {
        // Keep the last verified same-context rows mounted, including inline drafts.
        setApiReady(false);
        setError(message);
      }
    }).finally(() => {
      if (!controller.signal.aborted && current === generation.current) setLoading(false);
    });
    return () => { controller.abort(); moreRequest.current?.abort(); };
  }, [category, progress, query, mine, tag, userId, requestKey, tick]);

  const loadMore = useCallback(async () => {
    if (!active || !cursor || loading || moreBusy.current) return;
    moreBusy.current = true;
    const current = generation.current;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await api.get<unknown>("/feedback/posts", {
        params: { category, progress, q: query, mine: mine && !!userId, tag, cursor, limit: 20 },
        signal: controller.signal, timeout: 20_000, referrerPolicy: "no-referrer",
      });
      if (controller.signal.aborted || current !== generation.current) return;
      assertFeedbackPage(page);
      if (page.hasMore && page.nextCursor && (page.nextCursor === cursor || usedCursors.current.has(page.nextCursor))) {
        throw new Error("다음 페이지 정보가 변경되지 않았어요. 목록을 새로고침해 주세요.");
      }
      usedCursors.current.add(cursor);
      setApiReady(true);
      setSnapshot((previous) => previous?.key === requestKey ? {
        key: requestKey,
        items: [...new Map([...previous.items, ...page.items].map((item) => [item.id, item])).values()],
        canManage: page.canManage === true,
      } : previous);
      setCursor(page.hasMore ? page.nextCursor : null);
    } catch (cause) {
      const message = await getApiErrorMessage(cause, "다음 제보를 불러오지 못했어요.");
      if (!controller.signal.aborted && current === generation.current) { setApiReady(false); setMoreError(message); }
    } finally {
      if (current === generation.current && !controller.signal.aborted) { moreBusy.current = false; setLoadingMore(false); }
    }
  }, [active, cursor, loading, category, progress, query, mine, tag, userId, requestKey]);
  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const update = useCallback((id: string, patch: Partial<FeedbackEntry>) => {
    setSnapshot((previous) => previous?.key === requestKey ? {
      ...previous, items: previous.items.map((item) => item.id === id ? { ...item, ...patch } : item),
    } : previous);
  }, [requestKey]);
  return {
    items: active ? snapshot.items : [], apiReady: active && apiReady,
    canManage: active && snapshot.canManage, loading, loadingMore, error, moreError,
    hasMore: active && cursor !== null, loadMore, refresh, update,
  };
}
