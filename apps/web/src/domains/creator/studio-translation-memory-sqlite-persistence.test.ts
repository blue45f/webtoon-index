import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import {
  createStudioTranslationMemoryEntry,
  exportStudioTranslationMemory,
  STUDIO_TRANSLATION_MEMORY_STORAGE_KEY,
  type StudioTranslationMemoryEntry,
} from "./studio-translation-memory";
import {
  createStudioTranslationMemorySqlitePersistence,
  STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
  STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
} from "./studio-translation-memory-sqlite-persistence";

import type { StudioLocalDatabase } from "./studio-local-database";

const opened: StudioLocalDatabase[] = [];

async function openMemoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  opened.push(database);
  return database;
}

function entry(translation: string, now: number): StudioTranslationMemoryEntry {
  const created = createStudioTranslationMemoryEntry({
    workScope: "episode-01",
    sourceText: "안녕",
    speaker: "유나",
    sourceLocale: "ko-KR",
    targetLocale: "en-US",
    sourceRevision: "r1",
    translation,
    now,
  });
  if (!created.ok) throw new Error(created.error);
  return created.entry;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.close()));
});

describe("studio translation-memory SQLite persistence", () => {
  it("round-trips validated TM documents through the shared V12 database", async () => {
    const database = await openMemoryDatabase();
    const persistence = createStudioTranslationMemorySqlitePersistence({
      acquireDatabase: async () => database,
    });
    const authored = entry("Hello", 10);

    await expect(persistence.load()).resolves.toEqual({
      entries: [],
      status: "empty",
    });
    await expect(persistence.save([authored])).resolves.toEqual({ ok: true });
    await expect(persistence.load()).resolves.toEqual({
      entries: [authored],
      status: "ok",
    });
    expect(
      await database.kvGet(
        STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
        STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
      ),
    ).toContain("Hello");
    expect(STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE).toContain("v12");
    expect(STUDIO_TRANSLATION_MEMORY_SQLITE_KEY).not.toBe(
      STUDIO_TRANSLATION_MEMORY_STORAGE_KEY,
    );
  });

  it("fails closed on corrupt SQLite JSON without returning partial entries", async () => {
    const database = await openMemoryDatabase();
    await database.kvSet(
      STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
      STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
      '{"kind":"toonspectrum.translation-memory","version":1,"entries":[{"bad":true}]}',
    );
    const persistence = createStudioTranslationMemorySqlitePersistence({
      acquireDatabase: async () => database,
    });

    await expect(persistence.load()).resolves.toMatchObject({
      entries: [],
      status: "invalid",
      error: expect.any(String),
    });
  });

  it("serializes concurrent writes in invocation order so the newest request wins", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const values = new Map<string, string>();
    const writes: string[] = [];
    const kvSet = vi.fn(async (_namespace: string, _key: string, value: string) => {
      writes.push(value);
      if (writes.length === 1) await firstGate;
      values.set("value", value);
    });
    const database = { kvSet } as unknown as StudioLocalDatabase;
    const persistence = createStudioTranslationMemorySqlitePersistence({
      acquireDatabase: async () => database,
    });

    const first = persistence.save([entry("First", 10)]);
    const second = persistence.save([entry("Second", 20)]);
    await vi.waitFor(() => expect(kvSet).toHaveBeenCalledTimes(1));
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(kvSet).toHaveBeenCalledTimes(2);
    expect(values.get("value")).toContain("Second");
  });

  it("validates before writing and surfaces shared database failures", async () => {
    const persistence = createStudioTranslationMemorySqlitePersistence({
      acquireDatabase: async () => {
        throw new Error("OPFS denied");
      },
    });
    const valid = entry("Hello", 10);
    const invalid = { ...valid, sourceText: "" };

    await expect(persistence.load()).resolves.toMatchObject({
      entries: [],
      status: "unavailable",
      error: expect.stringContaining("OPFS denied"),
    });
    await expect(persistence.save([valid])).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("OPFS denied"),
    });
    await expect(persistence.save([invalid])).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("유효하지 않거나"),
    });
  });

  it("stores the exact engine-neutral export rather than a provider object", async () => {
    const database = await openMemoryDatabase();
    const persistence = createStudioTranslationMemorySqlitePersistence({
      acquireDatabase: async () => database,
    });
    const authored = entry("Hello", 10);
    const exported = exportStudioTranslationMemory([authored]);
    if (!exported.ok) throw new Error(exported.error);

    await persistence.save([authored]);
    await expect(
      database.kvGet(
        STUDIO_TRANSLATION_MEMORY_SQLITE_NAMESPACE,
        STUDIO_TRANSLATION_MEMORY_SQLITE_KEY,
      ),
    ).resolves.toBe(exported.json);
  });
});
