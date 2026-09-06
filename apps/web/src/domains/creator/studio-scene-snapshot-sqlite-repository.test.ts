import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import {
  createStudioSceneSnapshot,
  StudioSceneSnapshotLibraryError,
} from "./studio-scene-snapshot-library";
import {
  createStudioSceneSnapshotSqliteRepository,
  STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY,
  STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
} from "./studio-scene-snapshot-sqlite-repository";

import type { StudioLocalDatabase } from "./studio-local-database";
import type { StudioSceneSnapshot } from "./studio-scene-snapshot-library";

const databases: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

function snapshot(
  id: string,
  name: string,
  now: number,
): StudioSceneSnapshot {
  return createStudioSceneSnapshot(
    {
      name,
      tags: ["SQLite"],
      page: {
        id: `page-${id}`,
        name,
        note: "canonical SQLite round-trip",
        elements: [],
        bg: "#ffffff",
        bgGrad: null,
        canvasH: 1_200,
      },
      theme: "classic",
      sourceWorkId: "work-v12",
    },
    { id, now },
  );
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Studio scene snapshot SQLite repository", () => {
  it("round-trips canonical records through real sqlite-wasm without opening legacy IndexedDB", async () => {
    const database = await memoryDatabase();
    const firstRepository = createStudioSceneSnapshotSqliteRepository({
      acquireDatabase: async () => database,
    });
    const authored = snapshot("scene-roundtrip", "라스트 컷", 1_000);

    await expect(firstRepository.list()).resolves.toEqual([]);
    await expect(firstRepository.save(authored)).resolves.toEqual([authored]);

    const reopenedRepository = createStudioSceneSnapshotSqliteRepository({
      acquireDatabase: async () => database,
    });
    await expect(reopenedRepository.list()).resolves.toEqual([authored]);

    const rawIndex = await database.kvGet(
      STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
      STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY,
    );
    expect(rawIndex).toContain("scene-roundtrip");
    expect(STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE).toContain("v12");
  });

  it("duplicates and deletes using an immutable record then canonical index switch", async () => {
    const database = await memoryDatabase();
    const repository = createStudioSceneSnapshotSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 2_000,
      createId: () => "scene-copy",
    });
    await repository.save(snapshot("scene-original", "원본", 1_000));

    const duplicated = await repository.duplicate("scene-original");
    expect(duplicated.map((entry) => entry.id)).toEqual([
      "scene-copy",
      "scene-original",
    ]);
    expect(duplicated[0]).toMatchObject({
      name: "원본 복사본",
      version: 2,
      createdAt: 2_000,
    });

    await expect(repository.delete("scene-original")).resolves.toMatchObject([
      { id: "scene-copy" },
    ]);
    await expect(repository.list()).resolves.toMatchObject([{ id: "scene-copy" }]);
  });

  it("fails closed when the index is corrupt or references a missing record", async () => {
    const database = await memoryDatabase();
    const repository = createStudioSceneSnapshotSqliteRepository({
      acquireDatabase: async () => database,
    });
    await database.kvSet(
      STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
      STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY,
      "{broken",
    );
    await expect(repository.list()).rejects.toMatchObject({ code: "corrupt-data" });

    await database.kvSet(
      STUDIO_SCENE_SNAPSHOT_SQLITE_NAMESPACE,
      STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY,
      JSON.stringify({
        version: 1,
        records: [{ id: "scene-missing", recordKey: "record:scene-missing:1:1" }],
      }),
    );
    await expect(repository.list()).rejects.toMatchObject({ code: "corrupt-data" });
  });

  it("serializes overlapping saves so the later invocation remains authoritative", async () => {
    const database = await memoryDatabase();
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let recordWrites = 0;
    const delayedDatabase = {
      ...database,
      kvGet: database.kvGet.bind(database),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        if (key.startsWith("record:") && ++recordWrites === 1) await firstBlocked;
        await database.kvSet(namespace, key, value);
      }),
      kvDelete: database.kvDelete.bind(database),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioSceneSnapshotSqliteRepository({
      acquireDatabase: async () => delayedDatabase,
    });
    const first = snapshot("scene-ordered", "첫 저장", 1_000);
    const second = {
      ...snapshot("scene-ordered", "마지막 저장", 1_000),
      version: 2,
      updatedAt: 2_000,
    };

    const firstSave = repository.save(first);
    const secondSave = repository.save(second);
    await vi.waitFor(() => expect(recordWrites).toBe(1));
    releaseFirst();
    await Promise.all([firstSave, secondSave]);

    await expect(repository.list()).resolves.toMatchObject([
      { id: "scene-ordered", name: "마지막 저장", version: 2 },
    ]);
  });

  it("keeps the previous record visible when an index switch fails", async () => {
    const database = await memoryDatabase();
    const initialRepository = createStudioSceneSnapshotSqliteRepository({
      acquireDatabase: async () => database,
    });
    const original = snapshot("scene-atomic", "이전 완성본", 1_000);
    await initialRepository.save(original);

    const failingDatabase = {
      kvGet: database.kvGet.bind(database),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        if (key === STUDIO_SCENE_SNAPSHOT_SQLITE_INDEX_KEY) {
          throw new Error("simulated index switch failure");
        }
        await database.kvSet(namespace, key, value);
      }),
      kvDelete: database.kvDelete.bind(database),
    } as unknown as StudioLocalDatabase;
    const failingRepository = createStudioSceneSnapshotSqliteRepository({
      acquireDatabase: async () => failingDatabase,
    });
    const replacement = { ...original, name: "노출되면 안 되는 새 값" };

    await expect(failingRepository.save(replacement)).rejects.toMatchObject({
      code: "storage-unavailable",
    });
    await expect(initialRepository.list()).resolves.toMatchObject([
      { id: "scene-atomic", name: "이전 완성본" },
    ]);
  });

  it("surfaces shared SQLite open failures instead of creating a browser fallback", async () => {
    const repository = createStudioSceneSnapshotSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("OPFS denied");
      },
    });

    await expect(repository.list()).rejects.toBeInstanceOf(
      StudioSceneSnapshotLibraryError,
    );
    await expect(repository.list()).rejects.toMatchObject({
      code: "storage-unavailable",
      message: expect.stringContaining("V12 SQLite"),
    });
  });
});
