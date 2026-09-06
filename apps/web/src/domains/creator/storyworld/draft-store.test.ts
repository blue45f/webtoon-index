import { describe, expect, it, vi } from "vitest";

import { createStoryworldDraftStore, STORYWORLD_DRAFT_NAMESPACE } from "./draft-store";
import { STORYWORLD_DEMO_PROJECT } from "./studio-storyworld-causality";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function database() {
  const rows = new Map<string, string>();
  return {
    rows,
    kvGet: vi.fn(async (namespace: string, key: string) => rows.get(`${namespace}:${key}`) ?? null),
    kvSet: vi.fn(async (namespace: string, key: string, value: string) => { rows.set(`${namespace}:${key}`, value); }),
  };
}
const decode = (raw: string) => JSON.parse(raw) as typeof STORYWORLD_DEMO_PROJECT;

describe("Storyworld shared SQLite draft authority", () => {
  it("round trips complete documents with work/remix isolation", async () => {
    const db = database();
    const store = createStoryworldDraftStore(async () => db);
    expect(await store.load("work:a", decode)).toBeNull();
    await store.save("work:a", STORYWORLD_DEMO_PROJECT);
    expect(await store.load("work:a", decode)).toEqual(STORYWORLD_DEMO_PROJECT);
    expect(await store.load("remix:a", decode)).toBeNull();
    expect(db.kvSet).toHaveBeenCalledWith(STORYWORLD_DRAFT_NAMESPACE, "work:a", expect.any(String));
  });
  it("serializes writes and makes a remount load wait for the final complete document", async () => {
    const db = database();
    const first = deferred<void>();
    const original = db.kvSet.getMockImplementation()!;
    db.kvSet.mockImplementationOnce(async (namespace, key, value) => {
      await first.promise;
      await original(namespace, key, value);
    });
    const store = createStoryworldDraftStore(async () => db);
    const a = store.save("work:a", { ...STORYWORLD_DEMO_PROJECT, title: "first" });
    const b = store.save("work:a", { ...STORYWORLD_DEMO_PROJECT, title: "last" });
    const load = store.load("work:a", decode);
    expect(db.kvGet).not.toHaveBeenCalled();
    first.resolve();
    await Promise.all([a, b]);
    expect((await load)?.title).toBe("last");
    expect(db.kvSet).toHaveBeenCalledTimes(2);
  });
  it("reports a failed write, then permits a later retry", async () => {
    const db = database();
    db.kvSet.mockRejectedValueOnce(new Error("quota"));
    const store = createStoryworldDraftStore(async () => db);
    await expect(store.save("work:a", STORYWORLD_DEMO_PROJECT)).rejects.toThrow("quota");
    await store.save("work:a", STORYWORLD_DEMO_PROJECT);
    expect(await store.load("work:a", decode)).toEqual(STORYWORLD_DEMO_PROJECT);
  });
  it("rejects corrupt, foreign-scope, unsupported and oversized rows without writing", async () => {
    const db = database();
    const store = createStoryworldDraftStore(async () => db);
    for (const raw of ["{bad", JSON.stringify({ version: 2, documentKey: "work:a", project: STORYWORLD_DEMO_PROJECT }), JSON.stringify({ version: 1, documentKey: "work:b", project: STORYWORLD_DEMO_PROJECT }), "x".repeat(1_100_001)]) {
      db.kvGet.mockResolvedValueOnce(raw);
      await expect(store.load("work:a", decode)).rejects.toThrow();
    }
    expect(db.kvSet).not.toHaveBeenCalled();
  });
  it("preserves read and validation failures instead of creating an empty replacement", async () => {
    const db = database();
    const store = createStoryworldDraftStore(async () => db);
    db.kvGet.mockRejectedValueOnce(new Error("unavailable"));
    await expect(store.load("work:a", decode)).rejects.toThrow("unavailable");
    await store.save("work:a", STORYWORLD_DEMO_PROJECT);
    db.kvSet.mockClear();
    await expect(store.load("work:a", () => { throw new Error("invalid project"); })).rejects.toThrow("invalid project");
    expect(db.kvSet).not.toHaveBeenCalled();
  });
  it("refuses oversized writes before opening SQLite and never uses another backend", async () => {
    const acquire = vi.fn(async () => database());
    const store = createStoryworldDraftStore(acquire);
    await expect(store.save("work:a", { ...STORYWORLD_DEMO_PROJECT, title: "가".repeat(400_000) })).rejects.toThrow();
    expect(acquire).not.toHaveBeenCalled();
    const unavailable = createStoryworldDraftStore(async () => { throw new Error("OPFS unavailable"); });
    await expect(unavailable.save("work:a", STORYWORLD_DEMO_PROJECT)).rejects.toThrow("OPFS unavailable");
  });
});
