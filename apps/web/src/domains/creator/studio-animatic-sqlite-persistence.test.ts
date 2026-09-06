import { describe, expect, it, vi } from "vitest";

import {
  createStudioAnimaticSqlitePersistence,
  STUDIO_ANIMATIC_SQLITE_NAMESPACE,
} from "./studio-animatic-sqlite-persistence";
import {
  createStudioAnimaticFromPages,
  studioAnimaticStorageKey,
} from "./studio-animatic-timeline";

import type { StudioLocalDatabase } from "./studio-local-database";

function databaseHarness() {
  const values = new Map<string, string>();
  const kvGet = vi.fn(async (namespace: string, key: string) => (
    values.get(`${namespace}\u0000${key}`) ?? null
  ));
  const kvSet = vi.fn(async (namespace: string, key: string, value: string) => {
    values.set(`${namespace}\u0000${key}`, value);
  });
  const database = { kvGet, kvSet } as unknown as StudioLocalDatabase;
  return { database, kvGet, kvSet, values };
}

function authoredDocument(workScope = "episode-12") {
  const result = createStudioAnimaticFromPages([
    { id: "page-1", name: "도입", canvasH: 1_200, elements: [] },
  ], { workScope });
  if (!result.ok) throw new Error(result.error);
  return result.document;
}

describe("studio animatic SQLite persistence", () => {
  it("round-trips validated edit metadata through the V12 SQLite namespace", async () => {
    const harness = databaseHarness();
    const persistence = createStudioAnimaticSqlitePersistence({
      acquireDatabase: async () => harness.database,
    });
    const document = authoredDocument();

    await expect(persistence.load(document.workScope)).resolves.toEqual({
      document: null,
      status: "empty",
    });
    await expect(persistence.save(document)).resolves.toEqual({ ok: true });
    await expect(persistence.load(document.workScope)).resolves.toEqual({
      document,
      status: "ok",
    });
    expect(harness.kvSet).toHaveBeenCalledWith(
      STUDIO_ANIMATIC_SQLITE_NAMESPACE,
      studioAnimaticStorageKey(document.workScope),
      expect.any(String),
    );
    expect(STUDIO_ANIMATIC_SQLITE_NAMESPACE).toContain("v12");
    expect(studioAnimaticStorageKey(document.workScope)).toContain(":v12:");
  });

  it("fails closed on corrupt JSON and never returns a partial document", async () => {
    const harness = databaseHarness();
    const scope = "corrupt-episode";
    harness.values.set(
      `${STUDIO_ANIMATIC_SQLITE_NAMESPACE}\u0000${studioAnimaticStorageKey(scope)}`,
      "{not-json",
    );
    const persistence = createStudioAnimaticSqlitePersistence({
      acquireDatabase: async () => harness.database,
    });

    const loaded = await persistence.load(scope);
    expect(loaded.document).toBeNull();
    expect(loaded.status).toBe("invalid");
    expect(loaded.error).toContain("JSON");
  });

  it("surfaces SQLite failures without silently writing localStorage", async () => {
    const persistence = createStudioAnimaticSqlitePersistence({
      acquireDatabase: async () => {
        throw new Error("OPFS blocked");
      },
    });

    await expect(persistence.load("episode")).resolves.toMatchObject({
      document: null,
      status: "unavailable",
      error: expect.stringContaining("OPFS blocked"),
    });
    await expect(persistence.save(authoredDocument("episode"))).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("OPFS blocked"),
    });
  });
});
