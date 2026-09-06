import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CreatorMarketplaceResourceRecordSchema,
} from "@/shared/lib/creator-marketplace-resource-contract";


export interface CachedMarketPage {
  readonly savedAt: string;
  readonly items: readonly CreatorMarketplaceResourceRecord[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

const PAGE_KEY_PREFIX = "toonspectrum.market.page.v1:";
const RESOURCE_KEY_PREFIX = "toonspectrum.resource.v1:";
const MAX_STORED_CHARACTERS = 300_000;
export const MARKET_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const MARKET_CACHE_MAX_ENTRIES = 24;
export const MARKET_CACHE_MAX_KEY_CHARACTERS = 2_048;

function isMarketCacheKey(key: string): boolean {
  return key.startsWith(PAGE_KEY_PREFIX) || key.startsWith(RESOURCE_KEY_PREFIX);
}

function readJson(storage: Storage, key: string): unknown | null {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAX_STORED_CHARACTERS) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseSavedAt(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime())
    ? value
    : null;
}

function removeStoredValue(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // 비공개 모드처럼 remove도 실패할 수 있다. 다음 읽기에서도 캐시 부재로 처리하면 충분하다.
  }
}

function marketCacheKeys(storage: Storage): string[] {
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && isMarketCacheKey(key)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

function pruneStoredMarketCache(
  storage: Storage,
  nowMs: number,
  maxEntries = MARKET_CACHE_MAX_ENTRIES
): void {
  if (!Number.isFinite(nowMs)) return;
  const candidates: Array<{ key: string; savedAtMs: number }> = [];

  for (const key of marketCacheKeys(storage)) {
    if (key.length > MARKET_CACHE_MAX_KEY_CHARACTERS) {
      removeStoredValue(storage, key);
      continue;
    }
    const cached = readJson(storage, key);
    const savedAt = cached && typeof cached === "object"
      ? parseSavedAt((cached as { savedAt?: unknown }).savedAt)
      : null;
    const savedAtMs = savedAt ? new Date(savedAt).getTime() : Number.NaN;
    const ageMs = nowMs - savedAtMs;
    if (
      !savedAt
      || !Number.isFinite(savedAtMs)
      || ageMs < 0
      || ageMs > MARKET_CACHE_MAX_AGE_MS
    ) {
      removeStoredValue(storage, key);
      continue;
    }
    candidates.push({ key, savedAtMs });
  }

  candidates.sort((left, right) => {
    if (left.savedAtMs !== right.savedAtMs) return right.savedAtMs - left.savedAtMs;
    if (left.key === right.key) return 0;
    return left.key < right.key ? -1 : 1;
  });
  for (const candidate of candidates.slice(Math.max(0, maxEntries))) {
    removeStoredValue(storage, candidate.key);
  }
}

function prepareMarketCacheWrite(storage: Storage, key: string, nowMs: number): void {
  pruneStoredMarketCache(storage, nowMs);
  try {
    if (storage.getItem(key) === null) {
      // Reserve one slot before setItem so the new successful response always survives a
      // same-millisecond timestamp tie and quota pressure can benefit from the eviction.
      pruneStoredMarketCache(storage, nowMs, MARKET_CACHE_MAX_ENTRIES - 1);
    }
  } catch {
    // setItem below owns failure handling; no unrelated storage is touched here.
  }
}

function readFreshSavedAt(
  storage: Storage,
  key: string,
  value: unknown,
  nowMs: number
): string | null {
  const savedAt = parseSavedAt(value);
  const savedAtMs = savedAt ? new Date(savedAt).getTime() : Number.NaN;
  const ageMs = nowMs - savedAtMs;
  if (
    !savedAt
    || !Number.isFinite(nowMs)
    || ageMs < 0
    || ageMs > MARKET_CACHE_MAX_AGE_MS
  ) {
    removeStoredValue(storage, key);
    return null;
  }
  return savedAt;
}

function parseRecords(value: unknown): CreatorMarketplaceResourceRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = CreatorMarketplaceResourceRecordSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function readCachedMarketPage(
  queryKey: string,
  nowMs = Date.now()
): CachedMarketPage | null {
  if (typeof localStorage === "undefined") return null;
  pruneStoredMarketCache(localStorage, nowMs);
  const key = `${PAGE_KEY_PREFIX}${queryKey}`;
  if (key.length > MARKET_CACHE_MAX_KEY_CHARACTERS) return null;
  const cached = readJson(localStorage, key);
  if (!cached || typeof cached !== "object") return null;
  const savedAt = readFreshSavedAt(
    localStorage,
    key,
    (cached as { savedAt?: unknown }).savedAt,
    nowMs
  );
  const items = parseRecords((cached as { items?: unknown }).items);
  if (!savedAt) return null;
  if (items.length === 0) {
    removeStoredValue(localStorage, key);
    return null;
  }
  const rawCursor = (cached as { nextCursor?: unknown }).nextCursor;
  const parsedCursor = typeof rawCursor === "string" && rawCursor.trim()
    ? rawCursor.trim()
    : null;
  // v1 캐시는 nextCursor를 저장하지 않았다. 그 레코드의 hasMore=true를 그대로 노출하면
  // 누를 수 있지만 아무 동작도 하지 않는 "더 보기"가 생기므로, cursor가 있을 때만 이어간다.
  const nextCursor = (cached as { hasMore?: unknown }).hasMore === true
    ? parsedCursor
    : null;
  const hasMore = nextCursor !== null;
  return { savedAt, items, hasMore, nextCursor };
}

export function writeCachedMarketPage(
  queryKey: string,
  payload: {
    items: readonly CreatorMarketplaceResourceRecord[];
    hasMore: boolean;
    nextCursor: string | null;
  }
): void {
  if (typeof localStorage === "undefined") return;
  const nowMs = Date.now();
  const key = `${PAGE_KEY_PREFIX}${queryKey}`;
  pruneStoredMarketCache(localStorage, nowMs);
  if (key.length > MARKET_CACHE_MAX_KEY_CHARACTERS) return;
  if (payload.items.length === 0) {
    // A successful empty response is authoritative for this exact query. Keeping an older page
    // would resurrect delisted or newly filtered records the next time the network is unavailable.
    removeStoredValue(localStorage, key);
    return;
  }
  try {
    const nextCursor = payload.hasMore && payload.nextCursor?.trim()
      ? payload.nextCursor
      : null;
    const serialized = JSON.stringify({
      savedAt: new Date(nowMs).toISOString(),
      items: payload.items,
      hasMore: nextCursor !== null,
      nextCursor,
    });
    if (serialized.length > MAX_STORED_CHARACTERS) {
      removeStoredValue(localStorage, key);
      pruneStoredMarketCache(localStorage, nowMs);
      return;
    }
    prepareMarketCacheWrite(localStorage, key, nowMs);
    localStorage.setItem(key, serialized);
  } catch {
    // 저장 실패(비공개 모드·quota)는 캐시 부재와 동일하게 취급한다.
  }
}

export function readCachedMarketResource(
  id: string,
  nowMs = Date.now()
): { savedAt: string; record: CreatorMarketplaceResourceRecord } | null {
  if (typeof localStorage === "undefined") return null;
  pruneStoredMarketCache(localStorage, nowMs);
  const key = `${RESOURCE_KEY_PREFIX}${id}`;
  if (key.length > MARKET_CACHE_MAX_KEY_CHARACTERS) return null;
  const cached = readJson(localStorage, key);
  if (!cached || typeof cached !== "object") return null;
  const savedAt = readFreshSavedAt(
    localStorage,
    key,
    (cached as { savedAt?: unknown }).savedAt,
    nowMs
  );
  const [record] = parseRecords([(cached as { record?: unknown }).record]);
  if (!savedAt) return null;
  if (!record) {
    removeStoredValue(localStorage, key);
    return null;
  }
  return { savedAt, record };
}

export function removeCachedMarketResource(id: string): void {
  if (typeof localStorage === "undefined") return;
  removeStoredValue(localStorage, `${RESOURCE_KEY_PREFIX}${id}`);
}

export function writeCachedMarketResource(
  record: CreatorMarketplaceResourceRecord
): void {
  if (typeof localStorage === "undefined") return;
  const nowMs = Date.now();
  const key = `${RESOURCE_KEY_PREFIX}${record.id}`;
  pruneStoredMarketCache(localStorage, nowMs);
  if (key.length > MARKET_CACHE_MAX_KEY_CHARACTERS) return;
  try {
    const serialized = JSON.stringify({
      savedAt: new Date(nowMs).toISOString(),
      record,
    });
    if (serialized.length > MAX_STORED_CHARACTERS) {
      pruneStoredMarketCache(localStorage, nowMs);
      return;
    }
    prepareMarketCacheWrite(localStorage, key, nowMs);
    localStorage.setItem(key, serialized);
  } catch {
    // 저장 실패는 캐시 부재와 동일하게 취급한다.
  }
}
