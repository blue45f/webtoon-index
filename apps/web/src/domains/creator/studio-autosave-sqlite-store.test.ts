import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  STUDIO_AUTOSAVE_SQLITE_NAMESPACE,
  createStudioAutosaveSqliteStore,
} from "./studio-autosave-sqlite-store";
import {
  openStudioLocalDatabase,
  type StudioLocalDatabase,
} from "./studio-local-database";

import type { StudioAutosavePayload } from "./studio-autosave";

function payload(savedAt: string, id = "stroke-1"): StudioAutosavePayload {
  return {
    version: 2,
    savedAt,
    pagesList: [{
      id: "page-1",
      canvasH: 2_000,
      elements: [{ id, type: "draw" }],
    }],
    currentPageId: "page-1",
  };
}

describe("Studio SQLite autosave store", () => {
  let database: StudioLocalDatabase;

  beforeAll(async () => {
    database = await openStudioLocalDatabase({ vfs: "memory" });
  });

  afterAll(async () => {
    await database.close();
  });

  it("round-trips a normalized Studio snapshot through real sqlite-wasm", async () => {
    const store = createStudioAutosaveSqliteStore(database);
    const next = payload("2026-08-09T01:00:00.000Z", "sqlite-stroke");

    await store.write("project-a", next);

    expect(await store.read("project-a")).toMatchObject({
      state: "snapshot",
      savedAt: next.savedAt,
      payload: { pagesList: [{ elements: [{ id: "sqlite-stroke" }] }] },
    });
  });

  it("keeps a durable clear tombstone instead of deleting the authority row", async () => {
    const store = createStudioAutosaveSqliteStore(database);
    await store.write("project-clear", payload("2026-08-09T01:00:00.000Z"));
    await store.clear("project-clear", "2026-08-09T02:00:00.000Z");

    expect(await store.read("project-clear")).toEqual({
      state: "cleared",
      savedAt: "2026-08-09T02:00:00.000Z",
    });
    expect(
      await database.kvGet(STUDIO_AUTOSAVE_SQLITE_NAMESPACE, "project-clear"),
    ).not.toBeNull();
  });

  it("keeps projects isolated in the SQLite composite key", async () => {
    const store = createStudioAutosaveSqliteStore(database);
    await store.write("project-one", payload("2026-08-09T03:00:00.000Z", "one"));
    await store.write("project-two", payload("2026-08-09T03:00:00.000Z", "two"));

    expect(await store.read("project-one")).toMatchObject({
      payload: { pagesList: [{ elements: [{ id: "one" }] }] },
    });
    expect(await store.read("project-two")).toMatchObject({
      payload: { pagesList: [{ elements: [{ id: "two" }] }] },
    });
  });

  it("fails closed on corrupt rows instead of overwriting them as empty", async () => {
    const store = createStudioAutosaveSqliteStore(database);
    await database.kvSet(STUDIO_AUTOSAVE_SQLITE_NAMESPACE, "corrupt", "{broken");

    await expect(store.read("corrupt")).rejects.toThrow(/손상/u);
    expect(await database.kvGet(STUDIO_AUTOSAVE_SQLITE_NAMESPACE, "corrupt")).toBe(
      "{broken",
    );
  });

  it("rejects empty payloads and mismatched envelope timestamps", async () => {
    const store = createStudioAutosaveSqliteStore(database);
    const empty = {
      ...payload("2026-08-09T04:00:00.000Z"),
      pagesList: [{ id: "page-1", canvasH: 2_000, elements: [] }],
    } satisfies StudioAutosavePayload;
    await expect(store.write("empty", empty)).rejects.toThrow(/내용이 없는/u);

    await database.kvSet(
      STUDIO_AUTOSAVE_SQLITE_NAMESPACE,
      "timestamp-mismatch",
      JSON.stringify({
        kind: "toonspectrum:studio-autosave-sqlite",
        version: 1,
        state: "snapshot",
        savedAt: "2026-08-09T05:00:00.000Z",
        payload: JSON.stringify(payload("2026-08-09T04:00:00.000Z")),
      }),
    );
    await expect(store.read("timestamp-mismatch")).rejects.toThrow(/시각/u);
  });
});
