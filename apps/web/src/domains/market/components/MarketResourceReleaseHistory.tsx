import { useCallback, useEffect, useRef, useState } from "react";

import { formatMarketDate } from "../models/market-kind";

import type {
  CreatorMarketplaceResourceHistoryItem,
  CreatorMarketplaceResourceHistoryPage,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { findStarterMarketplaceResourceById } from "@/shared/lib/creator-marketplace-starter-catalog";
import Link from "@/src/compat/router-link";
import { getCreatorMarketplaceResourceHistory } from "@/src/infrastructure/creator-marketplace-client";

const HISTORY_PAGE_SIZE = 8;

type InitialState =
  | { readonly status: "loading"; readonly page: null; readonly message: null }
  | { readonly status: "error"; readonly page: null; readonly message: string }
  | { readonly status: "ready"; readonly page: CreatorMarketplaceResourceHistoryPage; readonly message: null };

function historyErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "릴리스 이력을 불러오지 못했습니다.";
}

function mergeHistoryItems(
  current: readonly CreatorMarketplaceResourceHistoryItem[],
  incoming: readonly CreatorMarketplaceResourceHistoryItem[],
): CreatorMarketplaceResourceHistoryItem[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

export interface MarketResourceReleaseHistoryProps {
  readonly resourceId: string;
}

/** Public history contains links only for release IDs the public API explicitly made visible. */
export function MarketResourceReleaseHistory({ resourceId }: MarketResourceReleaseHistoryProps) {
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [state, setState] = useState<InitialState>({
    status: "loading",
    page: null,
    message: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    activeControllerRef.current?.abort();
    activeControllerRef.current = controller;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setState({ status: "loading", page: null, message: null });
    setLoadingMore(false);
    setLoadMoreError(null);

    void getCreatorMarketplaceResourceHistory(
      resourceId,
      { limit: HISTORY_PAGE_SIZE },
      controller.signal,
    ).then((page) => {
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      setState({ status: "ready", page, message: null });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      const starter = findStarterMarketplaceResourceById(resourceId);
      if (starter) {
        setState({
          status: "ready",
          page: {
            packageId: starter.packageId,
            anchor: {
              id: starter.id,
              resourceVersion: starter.resourceVersion,
              listed: true,
            },
            items: [
              {
                id: starter.id,
                releaseOrdinal: 1,
                name: starter.name,
                resourceVersion: starter.resourceVersion,
                minimumStudioVersion: starter.minimumStudioVersion,
                manifestHash: starter.manifestHash,
                createdAt: starter.createdAt,
                selected: true,
                releaseNotes: "초기 공식 릴리스",
              },
            ],
            limit: HISTORY_PAGE_SIZE,
            hasMore: false,
            nextCursor: null,
          },
          message: null,
        });
        return;
      }
      setState({ status: "error", page: null, message: historyErrorMessage(error) });
    });

    return () => {
      controller.abort();
      const activeController = activeControllerRef.current;
      activeController?.abort();
      if (activeControllerRef.current === activeController) {
        activeControllerRef.current = null;
      }
      requestGenerationRef.current += 1;
    };
  }, [resourceId, retryGeneration]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.page.hasMore) return;
    const cursor = state.page.nextCursor;
    if (cursor === null) return;
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const currentPage = state.page;
    setLoadingMore(true);
    setLoadMoreError(null);

    void getCreatorMarketplaceResourceHistory(
      resourceId,
      { limit: HISTORY_PAGE_SIZE, cursor },
      controller.signal,
    ).then((nextPage) => {
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      setState({
        status: "ready",
        page: {
          ...nextPage,
          anchor: currentPage.anchor,
          items: mergeHistoryItems(currentPage.items, nextPage.items),
        },
        message: null,
      });
      setLoadingMore(false);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
      setLoadingMore(false);
      setLoadMoreError(historyErrorMessage(error));
    });
  }, [resourceId, state]);

  return (
    <section
      aria-labelledby="market-release-history-heading"
      className="rounded-xl border border-line bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="market-release-history-heading" className="text-sm font-semibold text-fg">
            버전 및 릴리스 노트
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-fg-3">
            현재 공개 상태인 같은 패키지 릴리스만 표시합니다.
          </p>
        </div>
      </div>

      {state.status === "loading" ? (
        <p role="status" className="mt-4 text-sm text-fg-2">릴리스 이력을 불러오는 중…</p>
      ) : null}

      {state.status === "error" ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-fg">
          <p>{state.message}</p>
          <button
            type="button"
            onClick={() => setRetryGeneration((value) => value + 1)}
            className={buttonClass({ variant: "outline", size: "sm", className: "mt-3 min-h-11" })}
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          {!state.page.anchor.listed ? (
            <p role="status" className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-fg-2">
              선택한 v{state.page.anchor.resourceVersion} 릴리스는 현재 목록에서 내려갔습니다.
              아래에는 지금 공개적으로 열 수 있는 릴리스만 표시합니다.
            </p>
          ) : null}

          {state.page.items.length === 0 ? (
            <p className="mt-4 rounded-lg bg-panel p-3 text-sm text-fg-2">
              현재 공개된 이전 릴리스가 없습니다.
            </p>
          ) : (
            <ol className="mt-4 space-y-2">
              {state.page.items.map((item) => (
                <li
                  key={item.id}
                  className={`rounded-lg border p-3 ${item.selected ? "border-accent bg-accent/5" : "border-line bg-panel"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/market/resource/${item.id}`}
                        className="inline-flex min-h-11 items-center font-semibold text-fg underline decoration-line-strong underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80"
                      >
                        v{item.resourceVersion}
                      </Link>
                      {item.selected ? (
                        <span className="rounded bg-accent px-2 py-0.5 text-[0.68rem] font-semibold text-on-accent">
                          선택한 릴리스
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-fg-3">
                      #{item.releaseOrdinal} · <time dateTime={item.createdAt}>{formatMarketDate(item.createdAt)}</time>
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-fg">{item.name}</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-fg-2">
                    {item.releaseNotes ?? "릴리스 노트 없음"}
                  </p>
                  <p className="mt-1 text-[0.68rem] text-fg-3">
                    최소 Studio v{item.minimumStudioVersion}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {loadMoreError ? (
            <p role="alert" className="mt-3 text-xs text-danger">{loadMoreError}</p>
          ) : null}
          {state.page.hasMore ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className={buttonClass({ variant: "outline", size: "sm", className: "mt-3 min-h-11 w-full" })}
            >
              {loadingMore ? "더 불러오는 중…" : loadMoreError ? "다시 불러오기" : "이전 릴리스 더 보기"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
