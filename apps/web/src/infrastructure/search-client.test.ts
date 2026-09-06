import { afterEach, describe, expect, it, vi } from "vitest";

import { clearSearchClientCacheForTests, fetchSearchResponse } from "./search-client";

describe("search-client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearSearchClientCacheForTests();
    vi.restoreAllMocks();
  });

  it("requests /api/search with no-store and parses the response", async () => {
    const payload = {
      items: [],
      typeCount: { webtoon: 0, webnovel: 0 },
      topTags: [],
    };
    const mockFetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await expect(fetchSearchResponse("sort=relevance&q=test")).resolves.toEqual(payload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [input, init] = mockFetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(input).toBe("/api/search?sort=relevance&q=test");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("dedupes identical in-flight search requests", async () => {
    const payload = {
      items: [],
      typeCount: { webtoon: 0, webnovel: 0 },
      topTags: [],
    };
    let resolveResponse!: (response: Response) => void;
    const mockFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const first = fetchSearchResponse("sort=relevance&q=dedupe");
    const second = fetchSearchResponse("sort=relevance&q=dedupe");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    resolveResponse(new Response(JSON.stringify(payload), { status: 200 }));

    await expect(Promise.all([first, second])).resolves.toEqual([payload, payload]);
  });

  it("serves repeated completed searches from the short-lived cache", async () => {
    const payload = {
      items: [],
      typeCount: { webtoon: 0, webnovel: 0 },
      topTags: [],
    };
    const mockFetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await fetchSearchResponse("sort=relevance&q=cached");
    await fetchSearchResponse("sort=relevance&q=cached");

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("lets callers abandon stale searches without failing the shared request", async () => {
    let resolveResponse!: (response: Response) => void;
    const mockFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        })
    );
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    const controller = new AbortController();

    const abandoned = fetchSearchResponse("sort=relevance&q=abort", controller.signal);
    controller.abort();

    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveResponse(
      new Response(JSON.stringify({ items: [], typeCount: { webtoon: 0, webnovel: 0 }, topTags: [] }), { status: 200 })
    );
    await expect(fetchSearchResponse("sort=relevance&q=abort")).resolves.toMatchObject({ items: [] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
