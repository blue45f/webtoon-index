import { describe, expect, it } from "vitest";

import { applyStudioCatalogPreference, createStudioCatalogPreferencesRepository, normalizeStudioCatalogPreferences } from "./studio-catalog-preferences";

function harness() {
  const values = new Map<string, string>();
  let fail = false;
  const repository = createStudioCatalogPreferencesRepository({
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { if (fail) throw new Error("offline"); values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  });
  return { values, repository, fail: (value: boolean) => { fail = value; } };
}
describe("catalog shared-SQLite preferences", () => {
  it("rejects foreign schema and malformed IDs", () => {
    expect(normalizeStudioCatalogPreferences({ version: 2, favoriteIds: ["one"] }).favoriteIds).toEqual([]);
    expect(normalizeStudioCatalogPreferences({ version: 1, favoriteIds: ["one", "one", "../bad", null, 5] }).favoriteIds).toEqual(["one"]);
  });
  it("bounds recent and favorite storage", () => {
    const ids = Array.from({ length: 800 }, (_, i) => `asset-${i}`);
    const value = normalizeStudioCatalogPreferences({ version: 1, favoriteIds: ids, recentIds: ids });
    expect(value.favoriteIds).toHaveLength(500); expect(value.recentIds).toHaveLength(30);
  });
  it("applies explicit favorite intent idempotently and does not mutate state", () => {
    const initial = normalizeStudioCatalogPreferences(null);
    const added = applyStudioCatalogPreference(initial, { kind: "favorite", id: "one", value: true });
    expect(applyStudioCatalogPreference(added, { kind: "favorite", id: "one", value: true }).favoriteIds).toEqual(["one"]);
    expect(initial.favoriteIds).toEqual([]);
  });
  it("serializes overlapping writes so view and favorites cannot clobber each other", async () => {
    const { repository } = harness();
    await Promise.all([
      repository.update("elements", { kind: "favorite", id: "a", value: true }),
      repository.update("elements", { kind: "view", value: "list" }),
      repository.update("elements", { kind: "favorite", id: "b", value: true }),
    ]);
    expect(await repository.load("elements")).toMatchObject({ view: "list", favoriteIds: ["b", "a"] });
    expect((await repository.load("scenes")).favoriteIds).toEqual([]);
  });
  it("reports a failed write then recovers without poisoning the queue", async () => {
    const h = harness(); h.fail(true);
    await expect(h.repository.update("scenes", { kind: "recent", id: "one" })).rejects.toThrow("offline");
    h.fail(false);
    await h.repository.update("scenes", { kind: "recent", id: "two" });
    expect((await h.repository.load("scenes")).recentIds).toEqual(["two"]);
  });
  it("normalizes corrupted JSON and restores an ordered MRU", async () => {
    const h = harness(); h.values.set("scenes", "{bad");
    expect((await h.repository.load("scenes")).view).toBe("comfortable");
    for (const id of ["one", "two", "one"]) await h.repository.update("scenes", { kind: "recent", id });
    expect((await h.repository.load("scenes")).recentIds).toEqual(["one", "two"]);
  });
});
