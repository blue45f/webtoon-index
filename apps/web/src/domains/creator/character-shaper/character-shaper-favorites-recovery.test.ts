import { describe, expect, it, vi } from "vitest";

import {
  CHARACTER_FAVORITES_LIMIT,
  createCharacterFavoriteStore,
  parseCharacterFavorites,
} from "./character-shaper-favorites";

const encode = (ids: readonly string[], version = 1) => JSON.stringify({ version, ids });
function fixture(initial: string | null = null) {
  let raw = initial;
  let failWrite = false;
  const storage = {
    getItem: vi.fn(() => raw),
    setItem: vi.fn((_key: string, next: string) => {
      if (failWrite) throw new Error("quota");
      raw = next;
    }),
  };
  const store = createCharacterFavoriteStore(() => storage);
  store.refresh();
  return { store, storage, read: () => raw, replace: (next: string) => { raw = next; },
    failWrites: (fail: boolean) => { failWrite = fail; } };
}

const longIds = (fill: string) => Array.from({ length: CHARACTER_FAVORITES_LIMIT }, (_, index) =>
  `${index.toString().padStart(3, "0")}:${fill.repeat(156)}`);

describe("favorite round-trip and explicit recovery", () => {
  it.each(["x", "\"", "\\", "\ud800"])("round-trips all 256 maximum-length ids including JSON expansion: %j", (fill) => {
    const ids = longIds(fill);
    const f = fixture(encode(ids.slice(0, -1)));
    f.store.setFavorite(ids[255]!, true);
    expect(f.store.getSnapshot().persistence).toBe("persistent");
    expect(f.store.getSnapshot().hasPendingChanges).toBe(false);
    expect(parseCharacterFavorites(f.read())).toEqual({ ok: true, ids: [...ids].sort() });
    const reopened = createCharacterFavoriteStore(() => f.storage);
    reopened.refresh();
    expect(reopened.getSnapshot().ids).toEqual([...ids].sort());
  });
  it("still rejects oversized external records before accepting their payload", () => {
    const raw = JSON.stringify({ version: 1, ids: ["a"], padding: "x".repeat(300000) });
    expect(parseCharacterFavorites(raw).ok).toBe(false);
  });
  it("recovers valid records written beyond the previous arbitrary 32K threshold", () => {
    const ids = longIds("x");
    expect(encode(ids).length).toBeGreaterThan(32768);
    expect(parseCharacterFavorites(encode(ids))).toEqual({ ok: true, ids });
  });
  it("retries a failed write without another scene or favorite edit", () => {
    const f = fixture(encode(["a"]));
    f.failWrites(true); f.store.setFavorite("b", true);
    expect(f.store.getSnapshot().hasPendingChanges).toBe(true);
    f.failWrites(false); f.store.retrySave();
    expect(f.read()).toBe(encode(["a", "b"]));
    expect(f.store.getSnapshot()).toMatchObject({ persistence: "persistent", notice: null, hasPendingChanges: false });
  });
  it("merges other-tab updates and preserves offline deletes during retry", () => {
    const f = fixture(encode(["a", "b"]));
    f.failWrites(true); f.store.setFavorite("a", false); f.store.setFavorite("local", true);
    f.replace(encode(["a", "b", "external"])); f.failWrites(false); f.store.retrySave();
    expect(f.read()).toBe(encode(["b", "external", "local"]));
  });
  it.each(["{", encode(["future"], 2)])("does not overwrite damaged or newer records when retrying: %s", (raw) => {
    const f = fixture(raw); f.store.setFavorite("local", true); f.store.retrySave();
    expect(f.read()).toBe(raw); expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(f.store.getSnapshot().ids).toEqual(["local"]);
    expect(f.store.getSnapshot().hasPendingChanges).toBe(true);
  });
  it("retains unsaved state when an explicit retry also fails", () => {
    const f = fixture(); f.failWrites(true); f.store.setFavorite("a", true); f.store.retrySave();
    expect(f.store.getSnapshot()).toMatchObject({ ids: ["a"], persistence: "memory", hasPendingChanges: true });
    expect(f.read()).toBeNull();
  });
  it("retains pending changes when no storage provider is available", () => {
    const store = createCharacterFavoriteStore(() => null);
    store.setFavorite("a", true); store.retrySave();
    expect(store.getSnapshot().ids).toEqual(["a"]);
    expect(store.getSnapshot().hasPendingChanges).toBe(true);
  });
  it("does not write or emit a new snapshot when retry has nothing to save", () => {
    const f = fixture(encode(["a"])); const snapshot = f.store.getSnapshot();
    const listener = vi.fn(); f.store.subscribe(listener); f.store.retrySave();
    expect(f.storage.setItem).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled();
    expect(f.store.getSnapshot()).toBe(snapshot);
  });
  it("refuses over-capacity merges without losing pending local edits", () => {
    const f = fixture(); f.failWrites(true); f.store.setFavorite("offline", true);
    const external = encode(Array.from({ length: 256 }, (_, i) => `external:${i}`));
    f.replace(external); f.failWrites(false); f.storage.setItem.mockClear(); f.store.retrySave();
    expect(f.read()).toBe(external); expect(f.storage.setItem).not.toHaveBeenCalled();
    expect(f.store.getSnapshot().ids).toEqual(["offline"]);
    expect(f.store.getSnapshot().hasPendingChanges).toBe(true);
  });
  it("retries only the latest intent when an offline addition was undone", () => {
    const f = fixture(encode(["a"])); f.failWrites(true);
    f.store.setFavorite("b", true); f.store.setFavorite("b", false);
    f.failWrites(false); f.store.retrySave();
    expect(f.read()).toBe(encode(["a"])); expect(f.store.getSnapshot().hasPendingChanges).toBe(false);
  });
  it("can retry again after the stored schema is externally repaired", () => {
    const f = fixture(encode(["future"], 2)); f.store.setFavorite("local", true);
    f.store.retrySave(); f.replace(encode(["external"])); f.store.retrySave();
    expect(f.read()).toBe(encode(["external", "local"]));
    expect(f.store.getSnapshot().hasPendingChanges).toBe(false);
  });
});
