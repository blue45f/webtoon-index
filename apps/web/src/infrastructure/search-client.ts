import type { PlatformId, Title } from "@/shared/lib/types";

import { apiPath } from "@/src/infrastructure/api";

export type SearchCatalogMeta = {
  source: string;
  sourceVersion?: string;
  loadedAt: string;
  titleCount: number;
  seedFallback?: boolean;
  platformCoverage: { id: PlatformId; count: number; share: number }[];
  filteredPlatformCoverage: { id: PlatformId; count: number; share: number }[];
};

export interface SearchResponse {
  items: Title[];
  typeCount: { webtoon: number; webnovel: number };
  topTags: string[];
  catalog?: SearchCatalogMeta;
}

const SEARCH_CACHE_TTL_MS = 30_000;
const SEARCH_CACHE_MAX = 32;

type CacheEntry = {
  data: SearchResponse;
  expiresAt: number;
};

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SearchResponse>>();

function normalizeQuery(query: string | URLSearchParams) {
  const raw = typeof query === "string" ? query : query.toString();
  return raw.startsWith("?") ? raw.slice(1) : raw;
}

function remember(key: string, data: SearchResponse) {
  responseCache.set(key, {
    data,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
  });

  while (responseCache.size > SEARCH_CACHE_MAX) {
    const firstKey = responseCache.keys().next().value;
    if (!firstKey) break;
    responseCache.delete(firstKey);
  }
}

function abortError() {
  try {
    return new DOMException("The operation was aborted.", "AbortError");
  } catch {
    const error = new Error("The operation was aborted.");
    error.name = "AbortError";
    return error;
  }
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

export function isSearchAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function fetchSearchResponse(
  query: string | URLSearchParams,
  signal?: AbortSignal
): Promise<SearchResponse> {
  const key = normalizeQuery(query);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let request = inFlight.get(key);
  if (!request) {
    request = fetch(apiPath(`/search?${key}`), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("search_request_failed");
        return response.json() as Promise<SearchResponse>;
      })
      .then((data) => {
        remember(key, data);
        return data;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, request);
  }

  return withAbort(request, signal);
}

export function clearSearchClientCacheForTests() {
  responseCache.clear();
  inFlight.clear();
}
