import { useCallback, useEffect, useRef, useState } from "react";

import { getCustomPublishedResources } from "../models/market-custom-registry";
import { readCachedMarketPage, writeCachedMarketPage } from "../models/market-resource-cache";
import { listCreatorMarketplaceResources } from "../remotes/market-resource-remote";

import type {
  CreatorMarketplaceResourceLicense,
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceRecord,
  CreatorMarketplaceResourceSort,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { filterStarterMarketplaceResources } from "@/shared/lib/creator-marketplace-starter-catalog";



export interface MarketResourceQuery {
  readonly search?: string;
  readonly kind?: CreatorMarketplaceResourceKind;
  readonly license?: CreatorMarketplaceResourceLicense;
  readonly tag?: string;
  readonly publisher?: string;
  readonly sort: CreatorMarketplaceResourceSort;
  readonly limit: number;
}

export interface MarketResourcesPage {
  readonly items: readonly CreatorMarketplaceResourceRecord[];
  /** 첫 페이지 로딩. 커서 "더 보기" 로딩은 loadingMore로 구분한다. */
  readonly loading: boolean;
  readonly loadingMore: boolean;
  readonly error: string | null;
  readonly loadMoreError: string | null;
  readonly hasMore: boolean;
  /** 네트워크 실패로 저장된 목록을 보여주는 저하 상태. */
  readonly stale: boolean;
  readonly staleSavedAt: string | null;
  readonly loadMore: () => void;
  readonly reload: () => void;
}

const MARKET_RETRY_HINT = "일시적인 장애일 수 있어요. 잠시 후 다시 시도해 주세요.";
const MARKET_LOAD_MORE_RETRY_HINT = "추가 리소스를 불러오지 못했어요.";

function matchesMarketQuery(
  item: CreatorMarketplaceResourceRecord,
  query: MarketResourceQuery,
): boolean {
  if (query.kind && item.kind !== query.kind) return false;
  if (query.license && item.license !== query.license) return false;
  if (query.publisher && item.publisher.id !== query.publisher) return false;
  if (query.tag && !item.tags.some((t) => t.toLowerCase() === query.tag!.toLowerCase())) return false;
  if (query.search) {
    const q = query.search.toLowerCase().trim();
    const match =
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q));
    if (!match) return false;
  }
  return true;
}

/**
 * creator-marketplace list API를 커서 페이지네이션과 함께 래핑한다.
 * query가 null이면 비활성화(요청 없음)하고, 바뀌면 상태를 초기화해 첫 페이지부터 다시 불러온다.
 * 네트워크 실패 시 localStorage의 마지막 성공 페이지를 보여주는 저하 모드로 전환한다.
 */
export function useMarketResources(query: MarketResourceQuery | null): MarketResourcesPage {
  const [items, setItems] = useState<readonly CreatorMarketplaceResourceRecord[]>([]);
  const [loading, setLoading] = useState(Boolean(query));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [stale, setStale] = useState(false);
  const [staleSavedAt, setStaleSavedAt] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const activeQueryKeyRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const queryKey = query ? JSON.stringify(query) : null;

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    activeQueryKeyRef.current = queryKey;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    loadingMoreRef.current = false;

    if (!queryKey) {
      cursorRef.current = null;
      setItems([]);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      setLoadMoreError(null);
      setHasMore(false);
      setStale(false);
      setStaleSavedAt(null);
      return;
    }
    const parsedQuery = JSON.parse(queryKey) as MarketResourceQuery;
    const controller = new AbortController();
    cursorRef.current = null;
    setItems([]);
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setLoadMoreError(null);
    setHasMore(false);
    setStale(false);
    setStaleSavedAt(null);

    listCreatorMarketplaceResources(
      {
        limit: parsedQuery.limit,
        search: parsedQuery.search,
        kind: parsedQuery.kind,
        license: parsedQuery.license,
        tag: parsedQuery.tag,
        publisher: parsedQuery.publisher,
        sort: parsedQuery.sort,
      },
      controller.signal
    )
      .then((page) => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        let finalItems = page.items;
        let finalHasMore = page.hasMore;
        let nextCursor = page.hasMore ? page.nextCursor : null;

        if (finalItems.length === 0 && !parsedQuery.search && !parsedQuery.publisher) {
          const starter = filterStarterMarketplaceResources({
            limit: parsedQuery.limit,
            search: parsedQuery.search,
            kind: parsedQuery.kind,
            license: parsedQuery.license,
            tag: parsedQuery.tag,
            sort: parsedQuery.sort,
          });
          if (starter.items.length > 0) {
            finalItems = starter.items;
            finalHasMore = starter.hasMore;
            nextCursor = null;
          }
        }

        const matchingCustoms = getCustomPublishedResources().filter((r) =>
          matchesMarketQuery(r, parsedQuery)
        );
        if (matchingCustoms.length > 0) {
          const itemMap = new Map<string, CreatorMarketplaceResourceRecord>();
          for (const item of matchingCustoms) itemMap.set(item.id, item);
          for (const item of finalItems) {
            if (!itemMap.has(item.id)) itemMap.set(item.id, item);
          }
          finalItems = [...itemMap.values()];
        }

        const pageHasMore = nextCursor !== null && finalHasMore;
        setItems(finalItems);
        cursorRef.current = nextCursor;
        setHasMore(pageHasMore);
        setLoading(false);
        writeCachedMarketPage(queryKey, {
          items: finalItems,
          hasMore: pageHasMore,
          nextCursor,
        });
      })
      .catch(() => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        const matchingCustoms = getCustomPublishedResources().filter((r) =>
          matchesMarketQuery(r, parsedQuery)
        );
        const cached = readCachedMarketPage(queryKey);
        if (cached) {
          let mergedCached = cached.items;
          if (matchingCustoms.length > 0) {
            const itemMap = new Map<string, CreatorMarketplaceResourceRecord>();
            for (const item of matchingCustoms) itemMap.set(item.id, item);
            for (const item of cached.items) {
              if (!itemMap.has(item.id)) itemMap.set(item.id, item);
            }
            mergedCached = [...itemMap.values()];
          }
          setItems(mergedCached);
          setHasMore(false);
          cursorRef.current = null;
          setStale(true);
          setStaleSavedAt(cached.savedAt);
          setLoading(false);
          return;
        }
        const starter = filterStarterMarketplaceResources({
          limit: parsedQuery.limit,
          search: parsedQuery.search,
          kind: parsedQuery.kind,
          license: parsedQuery.license,
          tag: parsedQuery.tag,
          publisher: parsedQuery.publisher,
          sort: parsedQuery.sort,
        });
        if (starter.items.length > 0 || matchingCustoms.length > 0) {
          const itemMap = new Map<string, CreatorMarketplaceResourceRecord>();
          for (const item of matchingCustoms) itemMap.set(item.id, item);
          for (const item of starter.items) {
            if (!itemMap.has(item.id)) itemMap.set(item.id, item);
          }
          const mergedStarter = [...itemMap.values()];
          setItems(mergedStarter);
          setHasMore(starter.hasMore);
          cursorRef.current = null;
          setError(null);
          setLoading(false);
          return;
        }
        setError(MARKET_RETRY_HINT);
        setLoading(false);
      });

    return () => {
      controller.abort();
      loadMoreControllerRef.current?.abort();
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
        activeQueryKeyRef.current = null;
        loadMoreControllerRef.current = null;
        loadingMoreRef.current = false;
      }
    };
  }, [queryKey, refreshToken]);

  const loadMore = useCallback(() => {
    if (
      !queryKey
      || activeQueryKeyRef.current !== queryKey
      || loadingMoreRef.current
      || !cursorRef.current
    ) return;
    const parsedQuery = JSON.parse(queryKey) as MarketResourceQuery;
    const cursor = cursorRef.current;
    const generation = requestGenerationRef.current;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    listCreatorMarketplaceResources(
      {
        limit: parsedQuery.limit,
        search: parsedQuery.search,
        kind: parsedQuery.kind,
        license: parsedQuery.license,
        tag: parsedQuery.tag,
        publisher: parsedQuery.publisher,
        sort: parsedQuery.sort,
        cursor,
      },
      controller.signal
    )
      .then((page) => {
        if (
          controller.signal.aborted
          || requestGenerationRef.current !== generation
          || activeQueryKeyRef.current !== queryKey
        ) return;
        const nextCursor = page.hasMore ? page.nextCursor : null;
        const pageHasMore = nextCursor !== null;
        setItems((previous) => {
          if (
            requestGenerationRef.current !== generation
            || activeQueryKeyRef.current !== queryKey
          ) return previous;
          const seen = new Set(previous.map((record) => record.id));
          const merged = [...previous, ...page.items.filter((record) => !seen.has(record.id))];
          writeCachedMarketPage(queryKey, {
            items: merged,
            hasMore: pageHasMore,
            nextCursor,
          });
          return merged;
        });
        cursorRef.current = nextCursor;
        setHasMore(pageHasMore);
      })
      .catch(() => {
        if (
          controller.signal.aborted
          || requestGenerationRef.current !== generation
          || activeQueryKeyRef.current !== queryKey
        ) return;
        setLoadMoreError(MARKET_LOAD_MORE_RETRY_HINT);
      })
      .finally(() => {
        if (
          requestGenerationRef.current !== generation
          || activeQueryKeyRef.current !== queryKey
          || loadMoreControllerRef.current !== controller
        ) return;
        loadMoreControllerRef.current = null;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [queryKey]);
  const reload = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  return {
    items,
    loading,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    stale,
    staleSavedAt,
    loadMore,
    reload,
  };
}
