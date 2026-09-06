import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioEmeresSqliteRepository,
  STUDIO_EMERES_SQLITE_KEY,
  STUDIO_EMERES_SQLITE_NAMESPACE,
} from "./studio-emeres-sqlite-repository";
import { openStudioLocalDatabase } from "./studio-local-database";

import type { StudioEmeresLibraryItem } from "./studio-emeres-library";
import type { StudioLocalDatabase } from "./studio-local-database";

const databases: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

function item(
  id: string,
  name: string,
  timestamp: number,
): StudioEmeresLibraryItem {
  return {
    id,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    src: "data:image/png;base64,YQ==",
    width: 320,
    height: 240,
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Studio Emeres SQLite repository", () => {
  it("round-trips canonical image templates through real sqlite-wasm", async () => {
    const database = await memoryDatabase();
    const repository = createStudioEmeresSqliteRepository({
      acquireDatabase: async () => database,
    });
    const authored = item("emeres-a", "액션 밑그림", 1_000);

    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.save(authored)).resolves.toEqual([authored]);

    const reopened = createStudioEmeresSqliteRepository({
      acquireDatabase: async () => database,
    });
    await expect(reopened.list()).resolves.toEqual([authored]);
    await expect(
      database.kvGet(STUDIO_EMERES_SQLITE_NAMESPACE, STUDIO_EMERES_SQLITE_KEY),
    ).resolves.toBe(JSON.stringify([authored]));
    expect(STUDIO_EMERES_SQLITE_NAMESPACE).toContain("v12");
  });

  it("supports rename, category and delete without touching a legacy key", async () => {
    const database = await memoryDatabase();
    const repository = createStudioEmeresSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 2_000,
    });
    await repository.save(item("emeres-a", "초안", 1_000));

    await expect(repository.rename("emeres-a", "완성본")).resolves.toMatchObject([
      { id: "emeres-a", name: "완성본", updatedAt: 2_000 },
    ]);
    await expect(repository.setCategory("emeres-a", "액션")).resolves.toMatchObject([
      { id: "emeres-a", category: "액션" },
    ]);
    await expect(repository.delete("emeres-a")).resolves.toEqual([]);
  });

  it("fails closed on corrupt or non-canonical SQLite values", async () => {
    const database = await memoryDatabase();
    const repository = createStudioEmeresSqliteRepository({
      acquireDatabase: async () => database,
    });
    await database.kvSet(
      STUDIO_EMERES_SQLITE_NAMESPACE,
      STUDIO_EMERES_SQLITE_KEY,
      "{broken",
    );
    await expect(repository.list()).rejects.toMatchObject({ code: "invalid" });

    await database.kvSet(
      STUDIO_EMERES_SQLITE_NAMESPACE,
      STUDIO_EMERES_SQLITE_KEY,
      JSON.stringify([item("duplicate", "첫 항목", 1), item("duplicate", "중복", 2)]),
    );
    await expect(repository.list()).rejects.toMatchObject({ code: "invalid" });
  });

  it("queues overlapping writes so the last invocation wins", async () => {
    const database = await memoryDatabase();
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let writes = 0;
    const delayedDatabase = {
      kvGet: database.kvGet.bind(database),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        if (++writes === 1) await firstBlocked;
        await database.kvSet(namespace, key, value);
      }),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioEmeresSqliteRepository({
      acquireDatabase: async () => delayedDatabase,
    });

    const firstSave = repository.save(item("ordered", "첫 저장", 1_000));
    const secondSave = repository.save(item("ordered", "마지막 저장", 2_000));
    await vi.waitFor(() => expect(writes).toBe(1));
    releaseFirst();
    await Promise.all([firstSave, secondSave]);

    await expect(repository.list()).resolves.toMatchObject([
      { id: "ordered", name: "마지막 저장", updatedAt: 2_000 },
    ]);
  });

  it("reports OPFS/SQLite failure with no localStorage downgrade", async () => {
    const repository = createStudioEmeresSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("SAH pool blocked");
      },
    });

    await expect(repository.list()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("SAH pool blocked"),
    });
  });
});
