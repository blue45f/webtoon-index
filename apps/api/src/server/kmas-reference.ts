import {
  normalizeReferenceResponse, parseReferenceQuery, REFERENCE_FIELDS,
  REFERENCE_PAGE_SIZE, ReferenceError, referenceSearchParams,
} from "../../../web/src/shared/lib/kmas-reference";

import type { ReferenceResult } from "../../../web/src/shared/lib/kmas-reference";

export const REFERENCE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
interface SearchDependencies {
  env?: Partial<Record<string, string | undefined>>;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** Bounded, per-process cache/coalescing. Not a distributed KMAS daily quota guarantee. */
export function createKmasReferenceSearch(dependencies: SearchDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const fetcher = dependencies.fetcher ?? fetch;
  const now = dependencies.now ?? Date.now;
  const cache = new Map<string, { expires: number; bytes: number; result: ReferenceResult }>();
  const pending = new Map<string, Promise<ReferenceResult>>();
  const controllers = new Set<AbortController>();
  let scope = "";
  let generation = 0;
  let cachedBytes = 0;
  let misses: number[] = [];

  const evict = (cacheKey: string) => {
    cachedBytes -= cache.get(cacheKey)?.bytes ?? 0;
    cache.delete(cacheKey);
  };

  return async (raw: Record<string, unknown>): Promise<ReferenceResult> => {
    const query = parseReferenceQuery(raw);
    const key = env.KMAS_PRV_KEY?.trim() ?? "";
    const baseInput = env.KMAS_BASE_URL || "https://www.kmas.or.kr";
    const nextScope = JSON.stringify([key, baseInput]);
    // Invalidate before checking the key, including removal and A -> B -> A rotation.
    if (scope !== nextScope) {
      scope = nextScope;
      generation++;
      cache.clear();
      cachedBytes = 0;
      pending.clear();
      for (const controller of controllers) controller.abort();
      controllers.clear();
    }
    if (!key) throw new ReferenceError("KMAS_NOT_CONFIGURED", 503);
    let base: URL;
    try { base = new URL(baseInput); } catch { throw new ReferenceError("KMAS_NOT_CONFIGURED", 503); }
    if (base.protocol !== "https:" || !["www.kmas.or.kr", "kmas.or.kr"].includes(base.hostname)
      || base.port || base.username || base.password) throw new ReferenceError("KMAS_NOT_CONFIGURED", 503);
    const epoch = generation;
    const cacheKey = referenceSearchParams(query).toString();
    const timestamp = now();
    for (const [entryKey, entry] of cache) if (entry.expires <= timestamp) evict(entryKey);
    const entry = cache.get(cacheKey);
    if (entry) {
      cache.delete(cacheKey);
      cache.set(cacheKey, entry); // LRU: a hit is the most recently used entry.
      return structuredClone({ ...entry.result, cached: true });
    }
    const underway = pending.get(cacheKey);
    if (underway) return structuredClone(await underway);
    misses = misses.filter((time) => timestamp - time < 60_000);
    if (pending.size >= 4 || misses.length >= 30) throw new ReferenceError("KMAS_RATE_LIMITED", 429);
    misses.push(timestamp);

    const task = (async () => {
      const controller = new AbortController();
      controllers.add(controller);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, dependencies.timeoutMs ?? 8000);
      try {
        const url = new URL("/openapi/search/bookAndWebtoonList", base.origin);
        url.searchParams.set("prvKey", key);
        url.searchParams.set(REFERENCE_FIELDS[query.field], query.q);
        // Preserve the existing KMAS adapter's explicit 1-based page convention.
        url.searchParams.set("pageNo", String(query.page));
        url.searchParams.set("viewItemCnt", String(REFERENCE_PAGE_SIZE));
        const response = await fetcher(url, {
          headers: { Accept: "application/json" }, signal: controller.signal, redirect: "error",
        });
        if (response.status === 429) throw new ReferenceError("KMAS_RATE_LIMITED", 429);
        if (!response.ok) throw new ReferenceError("KMAS_UNAVAILABLE", 502);
        if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
          throw new ReferenceError("KMAS_UNAVAILABLE", 502);
        }
        // Read a bounded stream rather than buffering an arbitrarily large upstream response.
        if (!response.body) throw new ReferenceError("KMAS_UNAVAILABLE", 502);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let body = "";
        let bytes = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new ReferenceError("KMAS_UNAVAILABLE", 502);
            }
            body += decoder.decode(chunk.value, { stream: true });
          }
          body += decoder.decode();
        } finally {
          reader.releaseLock();
        }
        const result = normalizeReferenceResponse(JSON.parse(body) as unknown, query, new Date(now()).toISOString());
        if (generation === epoch) {
          const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
          while (cache.size > 0 && (cache.size >= MAX_CACHE_ENTRIES || cachedBytes + bytes > MAX_CACHE_BYTES)) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) evict(oldest);
          }
          if (bytes <= MAX_CACHE_BYTES) {
            cache.set(cacheKey, { result, bytes, expires: now() + REFERENCE_CACHE_TTL_MS });
            cachedBytes += bytes;
          }
        }
        return result;
      } catch (error) {
        if (error instanceof ReferenceError) throw error;
        throw new ReferenceError(timedOut ? "KMAS_TIMEOUT" : "KMAS_UNAVAILABLE", 502);
      } finally {
        clearTimeout(timer);
        // Also releases unread bodies on HTTP errors and oversized Content-Length.
        controller.abort();
        controllers.delete(controller);
      }
    })();
    pending.set(cacheKey, task);
    try {
      return structuredClone(await task);
    } finally {
      if (pending.get(cacheKey) === task) pending.delete(cacheKey);
    }
  };
}

export const searchKmasReferences = createKmasReferenceSearch();
