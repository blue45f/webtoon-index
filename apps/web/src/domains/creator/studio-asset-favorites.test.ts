import { describe, expect, it } from "vitest";

import {
  createStudioAssetFavoriteId,
  favoriteFirst,
  favoriteOnly,
  isStudioAssetFavorite,
  loadStudioAssetFavoriteState,
  normalizeStudioAssetFavoriteState,
  removeStudioAssetFavorite,
  saveStudioAssetFavoriteState,
  STUDIO_ASSET_FAVORITE_MAX_IDS,
  studioAssetFavoriteStorageKey,
  toggleStudioAssetFavorite,
  type StudioAssetFavoriteState,
} from "./studio-asset-favorites";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const emptyState = (): StudioAssetFavoriteState => ({ version: 1, ids: [] });

describe("studio asset favorite IDs and normalization", () => {
  it("creates namespaced IDs and keeps identical provider IDs independent", () => {
    const local = createStudioAssetFavoriteId("local", "same-id");
    const community = createStudioAssetFavoriteId("community", "same-id");
    const raster = createStudioAssetFavoriteId("raster", "same-id");

    expect(local).toBe("local:same-id");
    expect(new Set([local, community, raster]).size).toBe(3);
  });

  it("rejects empty, unsafe, unknown-namespace, and overlong constructed IDs", () => {
    expect(() => createStudioAssetFavoriteId("local", "   ")).toThrow(TypeError);
    expect(() => createStudioAssetFavoriteId("local", "folder/item")).toThrow(TypeError);
    expect(() =>
      createStudioAssetFavoriteId("unknown" as "local", "asset")
    ).toThrow(TypeError);
    expect(() => createStudioAssetFavoriteId("raster", "x".repeat(160))).toThrow(TypeError);
  });

  it("returns empty state for malformed values, corrupt JSON, and unknown versions", () => {
    expect(normalizeStudioAssetFavoriteState(null)).toEqual(emptyState());
    expect(normalizeStudioAssetFavoriteState("{corrupt")).toEqual(emptyState());
    expect(normalizeStudioAssetFavoriteState([])).toEqual(emptyState());
    expect(normalizeStudioAssetFavoriteState({ version: 2, ids: ["local:a"] })).toEqual(emptyState());
    expect(normalizeStudioAssetFavoriteState({ version: 1, ids: "local:a" })).toEqual(emptyState());
  });

  it("drops duplicates, unknown namespaces, unsafe IDs, empty IDs, and overlong IDs", () => {
    const normalized = normalizeStudioAssetFavoriteState({
      version: 1,
      ids: [
        "local:a",
        "local:a",
        "community:a",
        "unknown:a",
        "local:",
        "local:has space",
        `raster:${"x".repeat(160)}`,
        null,
      ],
    });

    expect(normalized).toEqual({ version: 1, ids: ["local:a", "community:a"] });
  });

  it("caps normalized state at 500 unique IDs", () => {
    const ids = Array.from(
      { length: STUDIO_ASSET_FAVORITE_MAX_IDS + 12 },
      (_, index) => `local:asset-${index}`
    );
    const normalized = normalizeStudioAssetFavoriteState({ version: 1, ids });

    expect(normalized.ids).toHaveLength(STUDIO_ASSET_FAVORITE_MAX_IDS);
    expect(normalized.ids.at(0)).toBe("local:asset-0");
    expect(normalized.ids.at(-1)).toBe("local:asset-499");
  });
});

describe("studio asset favorite state operations", () => {
  it("toggles an ID on and off without mutating the input state", () => {
    const id = createStudioAssetFavoriteId("local", "asset-a");
    const initial = emptyState();
    const favorited = toggleStudioAssetFavorite(initial, id);
    const unfavorited = toggleStudioAssetFavorite(favorited, id);

    expect(initial).toEqual(emptyState());
    expect(favorited).toEqual({ version: 1, ids: [id] });
    expect(isStudioAssetFavorite(favorited, id)).toBe(true);
    expect(unfavorited).toEqual(emptyState());
    expect(isStudioAssetFavorite(unfavorited, id)).toBe(false);
  });

  it("removes only the requested namespace-qualified ID", () => {
    const local = createStudioAssetFavoriteId("local", "same-id");
    const community = createStudioAssetFavoriteId("community", "same-id");
    const state = normalizeStudioAssetFavoriteState({ version: 1, ids: [local, community] });

    expect(removeStudioAssetFavorite(state, local)).toEqual({ version: 1, ids: [community] });
    expect(state.ids).toEqual([local, community]);
  });

  it("orders favorites first stably within both partitions", () => {
    const items = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
    ];
    const keyOf = (item: (typeof items)[number]) => createStudioAssetFavoriteId("local", item.id);
    const state = normalizeStudioAssetFavoriteState({
      version: 1,
      ids: [keyOf(items[3]), keyOf(items[1])],
    });

    expect(favoriteFirst(items, state, keyOf).map((item) => item.id)).toEqual(["b", "d", "a", "c"]);
    expect(items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("filters to favorites while preserving source order", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const keyOf = (item: (typeof items)[number]) => createStudioAssetFavoriteId("raster", item.id);
    const state = normalizeStudioAssetFavoriteState({
      version: 1,
      ids: [keyOf(items[3]), keyOf(items[1])],
    });

    expect(favoriteOnly(items, state, keyOf).map((item) => item.id)).toEqual(["b", "d"]);
  });
});

describe("studio asset favorite persistence", () => {
  it("uses separate bounded keys for guest and every signed-in owner", () => {
    const guestKey = studioAssetFavoriteStorageKey(null);
    const namedGuestKey = studioAssetFavoriteStorageKey("guest");
    const longPrefix = "account-".repeat(30);
    const firstLongKey = studioAssetFavoriteStorageKey(`${longPrefix}a`);
    const secondLongKey = studioAssetFavoriteStorageKey(`${longPrefix}b`);

    expect(guestKey).not.toBe(namedGuestKey);
    expect(studioAssetFavoriteStorageKey("")).toBe(guestKey);
    expect(studioAssetFavoriteStorageKey("user-a")).not.toBe(studioAssetFavoriteStorageKey("user-b"));
    expect(firstLongKey).not.toBe(secondLongKey);
    expect(Math.max(...[guestKey, namedGuestKey, firstLongKey, secondLongKey].map((key) => key.length))).toBeLessThanOrEqual(160);
  });

  it("loads malformed JSON and blocked storage as empty state", () => {
    const userId = "user-a";
    const key = studioAssetFavoriteStorageKey(userId);
    const corrupt = memoryStorage({ [key]: "{bad json" });
    const blocked = { getItem: () => { throw new Error("blocked"); } };

    expect(loadStudioAssetFavoriteState(corrupt, userId)).toEqual(emptyState());
    expect(loadStudioAssetFavoriteState(blocked, userId)).toEqual(emptyState());
    expect(loadStudioAssetFavoriteState(null, userId)).toEqual(emptyState());
  });

  it("saves normalized JSON and safely ignores storage failures", () => {
    const storage = memoryStorage();
    const userId = "user-a";
    const raw = {
      version: 1,
      ids: ["local:a", "local:a", "unknown:a", "raster:b"],
    };
    const saved = saveStudioAssetFavoriteState(storage, userId, raw);
    const persisted = storage.values.get(studioAssetFavoriteStorageKey(userId));

    expect(saved).toEqual({ version: 1, ids: ["local:a", "raster:b"] });
    expect(JSON.parse(persisted ?? "null")).toEqual(saved);
    expect(loadStudioAssetFavoriteState(storage, userId)).toEqual(saved);

    const blocked = { setItem: () => { throw new Error("quota"); } };
    expect(() => saveStudioAssetFavoriteState(blocked, userId, saved)).not.toThrow();
    expect(saveStudioAssetFavoriteState(null, userId, saved)).toEqual(saved);
  });
});
