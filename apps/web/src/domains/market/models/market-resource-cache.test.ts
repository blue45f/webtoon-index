import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


import {
  MARKET_CACHE_MAX_AGE_MS,
  MARKET_CACHE_MAX_ENTRIES,
  MARKET_CACHE_MAX_KEY_CHARACTERS,
  readCachedMarketPage,
  readCachedMarketResource,
  removeCachedMarketResource,
  writeCachedMarketPage,
  writeCachedMarketResource,
} from "./market-resource-cache";

import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import {
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "@/shared/lib/creator-marketplace-resource-contract";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

const payload = {
  schemaVersion: 1 as const,
  resourceKind: "palette" as const,
  runtime: "studio-palette-v1" as const,
  definition: { colors: ["#101010", "#fafafa"] },
};
const payloadCanonical = canonicalizeCreatorMarketplaceJson(payload);
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const record = {
  schemaVersion: 1,
  packageId: "seed/test",
  name: "테스트 리소스",
  description: "설명",
  kind: "palette",
  resourceVersion: "1.0.0",
  minimumStudioVersion: "1.0.0",
  tags: ["팔레트"],
  license: "cc0-1.0",
  attributionText: "",
  containsAi: false,
  provenance: { origin: "original", authoredByPublisher: true },
  compatibility: { engines: ["canvas2d"] },
  entries: [
    {
      id: "palette/seed-test",
      kind: "palette",
      name: "테스트",
      delivery: {
        mode: "portable-json",
        mediaType: "application/vnd.toonspectrum.palette+json",
        payload,
        byteSize: creatorMarketplaceJsonByteSize(payload),
        sha256: sha256(payloadCanonical),
      },
    },
  ],
  id: "11111111-2222-4333-8444-555555555555",
  manifestHash: sha256(canonicalizeCreatorMarketplaceJson({
    schemaVersion: 1,
    packageId: "seed/test",
    name: "테스트 리소스",
    description: "설명",
    kind: "palette",
    resourceVersion: "1.0.0",
    minimumStudioVersion: "1.0.0",
    tags: ["팔레트"],
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: [
      {
        id: "palette/seed-test",
        kind: "palette",
        name: "테스트",
        delivery: {
          mode: "portable-json",
          mediaType: "application/vnd.toonspectrum.palette+json",
          payload,
          byteSize: creatorMarketplaceJsonByteSize(payload),
          sha256: sha256(payloadCanonical),
        },
      },
    ],
  })),
  manifestByteSize: 10,
  publisher: { id: "u1", name: "시드", avatar: null },
  createdAt: "2026-08-25T00:00:00.000Z",
  updatedAt: "2026-08-25T00:00:00.000Z",
  isOwner: false,
  access: "free" as const,
} satisfies CreatorMarketplaceResourceRecord;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: memoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("market-resource-cache", () => {
  it("writes and reads back a page roundtrip", () => {
    writeCachedMarketPage('{"limit":8}', {
      items: [record],
      hasMore: true,
      nextCursor: "cursor-2",
    });
    const cached = readCachedMarketPage('{"limit":8}');
    expect(cached).not.toBeNull();
    expect(cached?.items).toHaveLength(1);
    expect(cached?.items[0]?.id).toBe(record.id);
    expect(cached?.hasMore).toBe(true);
    expect(cached?.nextCursor).toBe("cursor-2");
    expect(Number.isFinite(new Date(cached!.savedAt).getTime())).toBe(true);
  });

  it("keeps legacy pages readable without exposing an inert load-more action", () => {
    localStorage.setItem(
      'toonspectrum.market.page.v1:{"limit":8}',
      JSON.stringify({ savedAt: new Date().toISOString(), items: [record], hasMore: true })
    );

    expect(readCachedMarketPage('{"limit":8}')).toMatchObject({
      items: [record],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("normalizes inconsistent pagination metadata before persisting", () => {
    writeCachedMarketPage("inconsistent", {
      items: [record],
      hasMore: true,
      nextCursor: null,
    });

    expect(readCachedMarketPage("inconsistent")).toMatchObject({
      hasMore: false,
      nextCursor: null,
    });
  });

  it("removes an older page when a successful response becomes empty", () => {
    writeCachedMarketPage("delisted", {
      items: [record],
      hasMore: false,
      nextCursor: null,
    });
    expect(readCachedMarketPage("delisted")?.items).toHaveLength(1);

    writeCachedMarketPage("delisted", {
      items: [],
      hasMore: false,
      nextCursor: null,
    });

    expect(readCachedMarketPage("delisted")).toBeNull();
    expect(localStorage.getItem("toonspectrum.market.page.v1:delisted")).toBeNull();
  });

  it("does not revive a stored cursor when the cached page declared no next page", () => {
    localStorage.setItem(
      "toonspectrum.market.page.v1:inconsistent-read",
      JSON.stringify({
        savedAt: new Date().toISOString(),
        items: [record],
        hasMore: false,
        nextCursor: "orphaned-cursor",
      })
    );

    expect(readCachedMarketPage("inconsistent-read")).toMatchObject({
      hasMore: false,
      nextCursor: null,
    });
  });

  it("accepts the 24-hour boundary and evicts an older cached page", () => {
    const nowMs = Date.parse("2026-08-30T12:00:00.000Z");
    const pageKey = "toonspectrum.market.page.v1:age-boundary";
    localStorage.setItem(
      pageKey,
      JSON.stringify({
        savedAt: new Date(nowMs - MARKET_CACHE_MAX_AGE_MS).toISOString(),
        items: [record],
        hasMore: false,
        nextCursor: null,
      })
    );

    expect(readCachedMarketPage("age-boundary", nowMs)?.items).toHaveLength(1);
    expect(readCachedMarketPage("age-boundary", nowMs + 1)).toBeNull();
    expect(localStorage.getItem(pageKey)).toBeNull();
  });

  it("returns null for corrupted JSON", () => {
    localStorage.setItem('toonspectrum.market.page.v1:{"limit":8}', "{broken");
    expect(readCachedMarketPage('{"limit":8}')).toBeNull();
  });

  it("returns null when every record is invalid", () => {
    const key = 'toonspectrum.market.page.v1:{"limit":8}';
    localStorage.setItem(
      key,
      JSON.stringify({ savedAt: new Date().toISOString(), items: [{ garbage: true }], hasMore: false })
    );
    expect(readCachedMarketPage('{"limit":8}')).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("skips writing payloads beyond the size cap", () => {
    const huge = { ...record, name: "x".repeat(400_000) };
    writeCachedMarketPage("huge", { items: [record], hasMore: false, nextCursor: null });
    writeCachedMarketPage("huge", { items: [huge], hasMore: false, nextCursor: null });
    expect(readCachedMarketPage("huge")).toBeNull();
  });

  it("roundtrips a single resource record", () => {
    writeCachedMarketResource(record);
    const cached = readCachedMarketResource(record.id);
    expect(cached?.record.id).toBe(record.id);
    expect(cached?.record.name).toBe(record.name);
  });

  it("returns null for a missing resource entry", () => {
    expect(readCachedMarketResource("nope")).toBeNull();
  });

  it("evicts expired and explicitly removed detail records", () => {
    const nowMs = Date.parse("2026-08-30T12:00:00.000Z");
    const resourceKey = `toonspectrum.resource.v1:${record.id}`;
    localStorage.setItem(
      resourceKey,
      JSON.stringify({
        savedAt: new Date(nowMs - MARKET_CACHE_MAX_AGE_MS - 1).toISOString(),
        record,
      })
    );

    expect(readCachedMarketResource(record.id, nowMs)).toBeNull();
    expect(localStorage.getItem(resourceKey)).toBeNull();

    writeCachedMarketResource(record);
    expect(localStorage.getItem(resourceKey)).not.toBeNull();
    removeCachedMarketResource(record.id);
    expect(localStorage.getItem(resourceKey)).toBeNull();
  });

  it("rejects future-dated entries so a clock-skewed cache cannot remain fresh indefinitely", () => {
    const nowMs = Date.parse("2026-08-30T12:00:00.000Z");
    const resourceKey = `toonspectrum.resource.v1:${record.id}`;
    localStorage.setItem(
      resourceKey,
      JSON.stringify({
        savedAt: new Date(nowMs + 1).toISOString(),
        record,
      })
    );

    expect(readCachedMarketResource(record.id, nowMs)).toBeNull();
    expect(localStorage.getItem(resourceKey)).toBeNull();
  });

  it("sweeps expired, corrupt, and overlong market keys without deleting unrelated storage", () => {
    const nowMs = Date.parse("2026-08-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const expiredPageKey = "toonspectrum.market.page.v1:expired-other-query";
    const corruptResourceKey = "toonspectrum.resource.v1:corrupt";
    const overlongMarketKey = `toonspectrum.market.page.v1:${"x".repeat(
      MARKET_CACHE_MAX_KEY_CHARACTERS
    )}`;
    const unrelatedKey = "toonspectrum.studio.unsaved.v1";
    localStorage.setItem(expiredPageKey, JSON.stringify({
      savedAt: new Date(nowMs - MARKET_CACHE_MAX_AGE_MS - 1).toISOString(),
      items: [record],
    }));
    localStorage.setItem(corruptResourceKey, "{broken");
    localStorage.setItem(overlongMarketKey, JSON.stringify({
      savedAt: new Date(nowMs).toISOString(),
    }));
    localStorage.setItem(unrelatedKey, "keep-me");

    writeCachedMarketPage("fresh-query", {
      items: [record],
      hasMore: false,
      nextCursor: null,
    });

    expect(localStorage.getItem(expiredPageKey)).toBeNull();
    expect(localStorage.getItem(corruptResourceKey)).toBeNull();
    expect(localStorage.getItem(overlongMarketKey)).toBeNull();
    expect(localStorage.getItem(unrelatedKey)).toBe("keep-me");
    expect(readCachedMarketPage("fresh-query", nowMs)?.items).toHaveLength(1);
  });

  it("keeps a deterministic recent-save cap across page and detail cache namespaces", () => {
    const nowMs = Date.parse("2026-08-30T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const oldestKey = "toonspectrum.market.page.v1:page-00";
    localStorage.setItem("unrelated.market.test", "keep-me");

    for (let index = 0; index < MARKET_CACHE_MAX_ENTRIES; index += 1) {
      const prefix = index % 2 === 0
        ? "toonspectrum.market.page.v1:page-"
        : "toonspectrum.resource.v1:resource-";
      localStorage.setItem(
        `${prefix}${String(index).padStart(2, "0")}`,
        JSON.stringify({
          savedAt: new Date(nowMs - (MARKET_CACHE_MAX_ENTRIES - index) * 1_000)
            .toISOString(),
          items: [record],
          record,
          hasMore: false,
          nextCursor: null,
        })
      );
    }

    writeCachedMarketPage("newest", {
      items: [record],
      hasMore: false,
      nextCursor: null,
    });

    const marketKeys = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.key(index)
    ).filter((key): key is string => Boolean(
      key?.startsWith("toonspectrum.market.page.v1:")
      || key?.startsWith("toonspectrum.resource.v1:")
    ));
    expect(marketKeys).toHaveLength(MARKET_CACHE_MAX_ENTRIES);
    expect(localStorage.getItem(oldestKey)).toBeNull();
    expect(localStorage.getItem("toonspectrum.market.page.v1:newest")).not.toBeNull();
    expect(localStorage.getItem("unrelated.market.test")).toBe("keep-me");
  });
});
