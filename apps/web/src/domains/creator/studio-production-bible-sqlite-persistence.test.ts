import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openStudioLocalDatabase,
  type StudioLocalDatabase,
} from "./studio-local-database";
import {
  addStudioProductionBibleEntry,
  createEmptyStudioProductionBible,
  serializeStudioProductionBible,
  STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES,
  studioProductionBibleStorageKey,
  type StudioProductionBible,
} from "./studio-production-bible";
import {
  createStudioProductionBibleSqlitePersistence,
  decodeCanonicalStudioProductionBible,
  STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
} from "./studio-production-bible-sqlite-persistence";

const openedDatabases: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  openedDatabases.push(database);
  return database;
}

function fixture(id: string, name: string): StudioProductionBible {
  return addStudioProductionBibleEntry(createEmptyStudioProductionBible(), {
    id,
    kind: "scene",
    name,
  });
}

afterEach(async () => {
  await Promise.all(openedDatabases.splice(0).map((database) => database.close()));
});

describe("Studio Production Bible SQLite persistence", () => {
  it("round-trips canonical metadata through real sqlite-wasm and the V12 KV namespace", async () => {
    const database = await memoryDatabase();
    const persistence = createStudioProductionBibleSqlitePersistence({
      acquireDatabase: async () => database,
    });
    const key = studioProductionBibleStorageKey({
      userId: "artist-a",
      workId: "episode-12",
    });
    const bible = fixture("scene-opening", "오프닝");

    await expect(persistence.load(key)).resolves.toMatchObject({
      bible: createEmptyStudioProductionBible(),
      backend: "sqlite",
      persisted: false,
    });
    await expect(persistence.save(key, bible)).resolves.toMatchObject({
      bible,
      backend: "sqlite",
      persisted: true,
    });
    await expect(persistence.load(key)).resolves.toMatchObject({
      bible,
      backend: "sqlite",
      persisted: true,
    });
    await expect(
      database.kvGet(STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE, key)
    ).resolves.toBe(serializeStudioProductionBible(bible));
    expect(STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE).toContain("v12");
    expect(key).toContain(":v12:");
  });

  it("isolates owner and document scopes in one shared database", async () => {
    const database = await memoryDatabase();
    const persistence = createStudioProductionBibleSqlitePersistence({
      acquireDatabase: async () => database,
    });
    const firstKey = studioProductionBibleStorageKey({ userId: "a", workId: "same" });
    const secondKey = studioProductionBibleStorageKey({ userId: "b", workId: "same" });
    const first = fixture("scene-a", "A 장면");
    const second = fixture("scene-b", "B 장면");

    await persistence.save(firstKey, first);
    await persistence.save(secondKey, second);

    expect((await persistence.load(firstKey)).bible).toEqual(first);
    expect((await persistence.load(secondKey)).bible).toEqual(second);
  });

  it("fails closed on corrupt, oversized, or non-canonical SQLite payloads", async () => {
    const database = await memoryDatabase();
    const persistence = createStudioProductionBibleSqlitePersistence({
      acquireDatabase: async () => database,
    });
    const corruptKey = studioProductionBibleStorageKey({ workId: "corrupt" });
    const nonCanonicalKey = studioProductionBibleStorageKey({ workId: "pretty" });
    await database.kvSet(
      STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
      corruptKey,
      "{broken"
    );
    await database.kvSet(
      STUDIO_PRODUCTION_BIBLE_SQLITE_NAMESPACE,
      nonCanonicalKey,
      serializeStudioProductionBible(fixture("scene-pretty", "Pretty"), true)
    );

    await expect(persistence.load(corruptKey)).resolves.toMatchObject({
      bible: createEmptyStudioProductionBible(),
      backend: "unavailable",
      persisted: false,
      warning: expect.stringContaining("손상"),
    });
    await expect(persistence.load(nonCanonicalKey)).resolves.toMatchObject({
      bible: createEmptyStudioProductionBible(),
      backend: "unavailable",
      persisted: false,
      warning: expect.stringContaining("canonical"),
    });
    expect(
      decodeCanonicalStudioProductionBible(
        "x".repeat(STUDIO_PRODUCTION_BIBLE_MAX_IMPORT_BYTES + 1)
      )
    ).toMatchObject({ ok: false, error: expect.stringContaining("한도") });
  });

  it("serializes overlapping writes so the last invocation remains authoritative", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const values = new Map<string, string>();
    const kvSet = vi.fn(async (_namespace: string, key: string, value: string) => {
      if (kvSet.mock.calls.length === 1) await firstBlocked;
      values.set(key, value);
    });
    const database = {
      kvGet: vi.fn(async (_namespace: string, key: string) => values.get(key) ?? null),
      kvSet,
    } as unknown as StudioLocalDatabase;
    const persistence = createStudioProductionBibleSqlitePersistence({
      acquireDatabase: async () => database,
    });
    const key = studioProductionBibleStorageKey({ workId: "ordered" });
    const first = fixture("scene-first", "첫 저장");
    const second = fixture("scene-second", "마지막 저장");

    const firstSave = persistence.save(key, first);
    const secondSave = persistence.save(key, second);
    await vi.waitFor(() => expect(kvSet).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([firstSave, secondSave]);

    expect(kvSet).toHaveBeenCalledTimes(2);
    expect(values.get(key)).toBe(serializeStudioProductionBible(second));
    await expect(persistence.load(key)).resolves.toMatchObject({ bible: second });
  });

  it("keeps an accepted edit only as explicitly labelled memory recovery when SQLite fails", async () => {
    const persistence = createStudioProductionBibleSqlitePersistence({
      acquireDatabase: async () => {
        throw new Error("OPFS blocked");
      },
    });
    const key = studioProductionBibleStorageKey({ workId: "blocked" });
    const bible = fixture("scene-memory", "세션 복구본");

    await expect(persistence.load(key)).resolves.toMatchObject({
      backend: "unavailable",
      persisted: false,
      warning: expect.stringContaining("OPFS blocked"),
    });
    await expect(persistence.save(key, bible)).resolves.toMatchObject({
      bible,
      backend: "memory",
      persisted: false,
      warning: expect.stringContaining("세션 메모리"),
    });
    await expect(persistence.load(key)).resolves.toMatchObject({
      bible,
      backend: "memory",
      persisted: false,
    });
  });
});
