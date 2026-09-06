// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMarketResources } from "./use-market-resources";

import {
  creatorMarketplaceJsonByteSize,
  type CreatorMarketplaceResourceListPage,
  type CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";
import { listCreatorMarketplaceResources } from "@/src/domains/market/remotes/market-resource-remote";

vi.mock("@/src/domains/market/remotes/market-resource-remote", () => ({
  listCreatorMarketplaceResources: vi.fn(),
}));

const listResources = vi.mocked(listCreatorMarketplaceResources);
const PUBLISHER_ID = "123e4567-e89b-42d3-a456-426614174000";

function resource(id: string, name = id): CreatorMarketplaceResourceRecord {
  return { id, name } as CreatorMarketplaceResourceRecord;
}

function cachedResource(id: string): CreatorMarketplaceResourceRecord {
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: "brush" as const,
    runtime: "studio-brush-v1" as const,
    definition: {
      snapshot: {
        presetId: "cached-brush",
        renderer: "perfect-freehand",
        settings: { opacity: 1, size: 7 },
      },
    },
  };
  return {
    schemaVersion: 1,
    packageId: `cached/brush/${id}`,
    name: "캐시 브러시",
    description: "오프라인 캐시 경계 테스트",
    kind: "brush",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "1.0.0",
    tags: ["캐시"],
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [{
      id: `brush/${id}`,
      kind: "brush",
      name: "캐시 브러시 항목",
      delivery: {
        mode: "portable-json",
        mediaType: "application/vnd.toonspectrum.brush+json",
        payload,
        byteSize: creatorMarketplaceJsonByteSize(payload),
        sha256: "a".repeat(64),
      },
    }],
    id,
    manifestHash: "b".repeat(64),
    manifestByteSize: 512,
    publisher: { id: "cached-publisher", name: "캐시 작가", avatar: null },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    isOwner: false,
    access: "free",
  };
}

function page(
  items: CreatorMarketplaceResourceRecord[],
  nextCursor: string | null = null
): CreatorMarketplaceResourceListPage {
  return {
    items,
    limit: 12,
    hasMore: nextCursor !== null,
    nextCursor,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useMarketResources", () => {
  it("passes the publisher UUID through the first page and guarded load-more request", async () => {
    listResources
      .mockResolvedValueOnce(page([resource("resource-1")], "cursor-2"))
      .mockResolvedValueOnce(page([resource("resource-2")], null));

    const query = {
      limit: 12,
      publisher: PUBLISHER_ID,
      kind: "brush" as const,
      sort: "newest" as const,
    };
    const { result } = renderHook(() => useMarketResources(query));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(listResources).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        publisher: PUBLISHER_ID,
        kind: "brush",
        limit: 12,
        sort: "newest",
      }),
      expect.any(AbortSignal)
    );
    const cachedPage = JSON.parse(
      localStorage.getItem(`toonspectrum.market.page.v1:${JSON.stringify(query)}`) ?? "null"
    ) as { hasMore?: unknown; nextCursor?: unknown } | null;
    expect(cachedPage).toMatchObject({ hasMore: true, nextCursor: "cursor-2" });

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(listResources).toHaveBeenCalledTimes(2);
    expect(listResources).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        publisher: PUBLISHER_ID,
        cursor: "cursor-2",
        sort: "newest",
      }),
      expect.any(AbortSignal)
    );
    expect(result.current.hasMore).toBe(false);
  });

  it("exposes a retryable load-more error and reuses the same cursor", async () => {
    listResources
      .mockResolvedValueOnce(page([resource("resource-1")], "cursor-2"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page([resource("resource-2")], null));

    const { result } = renderHook(() => useMarketResources({
      limit: 12,
      sort: "newest",
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());
    await waitFor(() => {
      expect(result.current.loadingMore).toBe(false);
      expect(result.current.loadMoreError).toBe("추가 리소스를 불러오지 못했어요.");
    });

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    expect(listResources).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cursor-2" }),
      expect.any(AbortSignal)
    );
    expect(listResources).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ cursor: "cursor-2" }),
      expect.any(AbortSignal)
    );
    expect(result.current.loadMoreError).toBeNull();
  });

  it("aborts and ignores a load-more response from an obsolete query generation", async () => {
    const obsoleteLoadMore = deferred<CreatorMarketplaceResourceListPage>();
    listResources
      .mockResolvedValueOnce(page([resource("old-1")], "old-cursor"))
      .mockReturnValueOnce(obsoleteLoadMore.promise)
      .mockResolvedValueOnce(page([resource("new-1")], null));

    const { result, rerender } = renderHook(
      ({ search }) => useMarketResources({ limit: 12, search, sort: "newest" }),
      { initialProps: { search: "old" } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.loadMore());
    const obsoleteSignal = listResources.mock.calls[1]?.[1];
    expect(obsoleteSignal?.aborted).toBe(false);

    rerender({ search: "new" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(obsoleteSignal?.aborted).toBe(true);

    act(() => obsoleteLoadMore.resolve(page([resource("old-2")], null)));
    await act(async () => {
      await obsoleteLoadMore.promise;
      await Promise.resolve();
    });

    expect(result.current.items.map((item) => item.id)).toEqual(["new-1"]);
    expect(result.current.loadMoreError).toBeNull();
  });

  it("aborts and ignores a slow first page after the query changes", async () => {
    const oldPage = deferred<CreatorMarketplaceResourceListPage>();
    const newPage = deferred<CreatorMarketplaceResourceListPage>();
    listResources
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(newPage.promise);

    const { result, rerender } = renderHook(
      ({ search }) => useMarketResources({ limit: 12, search, sort: "newest" }),
      { initialProps: { search: "old" } }
    );
    const oldSignal = listResources.mock.calls[0]?.[1];

    rerender({ search: "new" });
    expect(oldSignal?.aborted).toBe(true);

    act(() => oldPage.resolve(page([resource("old")], null)));
    act(() => newPage.resolve(page([resource("new")], null)));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.items.map((item) => item.id)).toEqual(["new"]);
  });

  it("keeps newest and relevance pages in separate cache generations", async () => {
    listResources
      .mockResolvedValueOnce(page([resource("newest-result")], null))
      .mockResolvedValueOnce(page([resource("relevance-result")], null));

    const { result, rerender } = renderHook(
      ({ sort }: { sort: "newest" | "relevance" }) => useMarketResources({
        limit: 12,
        search: "ink",
        sort,
      }),
      {
        initialProps: {
          sort: "newest" as "newest" | "relevance",
        },
      }
    );
    await waitFor(() => expect(result.current.items[0]?.id).toBe("newest-result"));

    rerender({ sort: "relevance" });
    await waitFor(() => expect(result.current.items[0]?.id).toBe("relevance-result"));

    expect(localStorage.getItem(
      `toonspectrum.market.page.v1:${JSON.stringify({
        limit: 12,
        search: "ink",
        sort: "newest",
      })}`
    )).not.toBeNull();
    expect(localStorage.getItem(
      `toonspectrum.market.page.v1:${JSON.stringify({
        limit: 12,
        search: "ink",
        sort: "relevance",
      })}`
    )).not.toBeNull();
  });

  it("does not paginate or refresh a stale cached head with a newly fetched tail", async () => {
    const query = { limit: 12, sort: "newest" as const };
    const cacheKey = `toonspectrum.market.page.v1:${JSON.stringify(query)}`;
    const savedAt = new Date().toISOString();
    localStorage.setItem(cacheKey, JSON.stringify({
      savedAt,
      items: [cachedResource("123e4567-e89b-42d3-a456-426614174000")],
      hasMore: true,
      nextCursor: "stale-cursor",
    }));
    listResources.mockRejectedValueOnce(new Error("offline"));

    const { result } = renderHook(() => useMarketResources(query));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.stale).toBe(true);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.items).toHaveLength(1);

    act(() => result.current.loadMore());
    await act(async () => Promise.resolve());

    expect(listResources).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(cacheKey) ?? "null")).toMatchObject({
      savedAt,
      nextCursor: "stale-cursor",
    });
  });

  it("falls back to starter catalog when network fails and no localStorage cache exists", async () => {
    listResources.mockRejectedValueOnce(new Error("503 Service Unavailable"));
    const { result } = renderHook(() => useMarketResources({ limit: 12, sort: "newest" }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.items.length).toBeGreaterThanOrEqual(1);
    expect(result.current.items.some((r) => r.kind === "3d-asset")).toBe(true);
  });
});
