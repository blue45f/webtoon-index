import { describe, expect, it, vi } from "vitest";

import { CHARACTER_FAVORITES_LIMIT, createCharacterFavoriteStore, parseCharacterFavorites } from "./character-shaper-favorites";

function fixture(raw: string | null = null) {
  let value = raw;
  const storage = { getItem: vi.fn(() => value), setItem: vi.fn((_key: string, next: string) => { value = next; }) };
  const store = createCharacterFavoriteStore(() => storage);
  store.refresh();
  return { storage, store, replace: (next: string | null) => { value = next; }, read: () => value };
}
const encode = (ids: readonly string[], version = 1) => JSON.stringify({ version, ids });

describe("character favorites", () => {
  it("deduplicates and sorts version-one records", () => expect(parseCharacterFavorites(encode(["b", "a", "b"]))).toEqual({ ok: true, ids: ["a", "b"] }));
  it.each(["{", "null", "[]", encode(["a"], 2), encode([" a"]), encode(["a\u0000"]), encode(["a".repeat(161)])])("refuses damaged or unsupported stored data: %s", (raw) => expect(parseCharacterFavorites(raw).ok).toBe(false));
  it("persists only ids and schema version", () => {
    const { store, read } = fixture(); store.setFavorite("hair:bob", true);
    expect(JSON.parse(read() ?? "null")).toEqual({ version: 1, ids: ["hair:bob"] });
  });
  it("never replaces future-version data", () => {
    const { store, storage, read } = fixture(encode(["future"], 2)); store.setFavorite("a", true);
    expect(storage.setItem).not.toHaveBeenCalled(); expect(read()).toBe(encode(["future"], 2));
    expect(store.getSnapshot().ids).toEqual(["a"]); expect(store.getSnapshot().persistence).toBe("memory");
  });
  it("returns the same frozen snapshot when nothing changes", () => {
    const { store } = fixture(); const before = store.getSnapshot(); store.refresh();
    expect(store.getSnapshot()).toBe(before); expect(Object.isFrozen(before.ids)).toBe(true);
  });
  it("does not write or notify for a no-op", () => {
    const { store, storage } = fixture(encode(["a"])); const listener = vi.fn(); store.subscribe(listener);
    store.setFavorite("a", true); expect(storage.setItem).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled();
  });
  it("combines the latest external preferences before writing", () => {
    const { store, replace, read } = fixture(encode(["a"])); replace(encode(["a", "external"])); store.setFavorite("b", true);
    expect(JSON.parse(read() ?? "null").ids).toEqual(["a", "b", "external"]);
  });
  it("retains unsaved deletes across a quota failure", () => {
    const { store, storage, read } = fixture(encode(["a", "b"]));
    storage.setItem.mockImplementationOnce(() => { throw new Error("quota"); });
    store.setFavorite("a", false); store.refresh(); expect(store.getSnapshot().ids).toEqual(["b"]);
    store.setFavorite("c", true); expect(JSON.parse(read() ?? "null").ids).toEqual(["b", "c"]);
  });
  it("survives a denied browser storage getter", () => {
    const store = createCharacterFavoriteStore(() => { throw new Error("denied"); });
    store.setFavorite("a", true); expect(store.getSnapshot().persistence).toBe("memory"); expect(store.getSnapshot().ids).toEqual(["a"]);
  });
  it("does not silently drop entries at the limit", () => {
    const { store, storage } = fixture(encode(Array.from({ length: CHARACTER_FAVORITES_LIMIT }, (_, index) => `a${index}`)));
    store.setFavorite("overflow", true); expect(store.getSnapshot().ids).toHaveLength(CHARACTER_FAVORITES_LIMIT); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it("unsubscribes without leaking listeners", () => {
    const { store } = fixture(); const listener = vi.fn(); const dispose = store.subscribe(listener); dispose();
    store.setFavorite("a", true); expect(listener).not.toHaveBeenCalled();
  });
});
