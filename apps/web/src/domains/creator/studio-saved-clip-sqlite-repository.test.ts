import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CLIPS,
  MAX_CLIP_ELEMENTS,
  serializeStudioSavedClipLibrary,
} from "./studio-clips";
import { openStudioLocalDatabase } from "./studio-local-database";
import {
  createStudioSavedClipSqliteRepository,
  STUDIO_SAVED_CLIP_SQLITE_KEY,
  STUDIO_SAVED_CLIP_SQLITE_NAMESPACE,
} from "./studio-saved-clip-sqlite-repository";

import type { StudioClip } from "./studio-clips";
import type { StudioLocalDatabase } from "./studio-local-database";

const databases: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

function clip(id: string, timestamp = 1): StudioClip {
  return {
    id,
    name: `클립 ${id}`,
    createdAt: timestamp,
    els: [{ y: 2, type: "text", text: "대사", x: 1 }],
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("saved clip SQLite repository", () => {
  it("round-trips stable canonical JSON through real sqlite-wasm", async () => {
    const database = await memoryDatabase();
    const repository = createStudioSavedClipSqliteRepository({ acquireDatabase: async () => database });
    const saved = await repository.save(clip("clip-a", 1_000));

    await expect(database.kvGet(
      STUDIO_SAVED_CLIP_SQLITE_NAMESPACE,
      STUDIO_SAVED_CLIP_SQLITE_KEY,
    )).resolves.toBe(serializeStudioSavedClipLibrary(saved));
    await expect(createStudioSavedClipSqliteRepository({
      acquireDatabase: async () => database,
    }).list()).resolves.toEqual(saved);
    expect(Object.keys(saved[0]!.els[0] as Record<string, unknown>)).toEqual([
      "text",
      "type",
      "x",
      "y",
    ]);
  });

  it("fails closed for corrupt, duplicate, non-canonical or lossy element JSON", async () => {
    const database = await memoryDatabase();
    const repository = createStudioSavedClipSqliteRepository({ acquireDatabase: async () => database });
    const duplicate = {
      schema: "toonspectrum.studio.saved-clips",
      version: 1,
      items: [clip("same"), clip("same", 2)],
    };
    const extra = {
      schema: "toonspectrum.studio.saved-clips",
      version: 1,
      items: [{ ...clip("extra"), future: true }],
    };
    for (const raw of ["{broken", JSON.stringify(duplicate), JSON.stringify(extra)]) {
      await database.kvSet(STUDIO_SAVED_CLIP_SQLITE_NAMESPACE, STUDIO_SAVED_CLIP_SQLITE_KEY, raw);
      await expect(repository.list()).rejects.toMatchObject({ code: "invalid" });
    }

    await database.kvDelete(STUDIO_SAVED_CLIP_SQLITE_NAMESPACE, STUDIO_SAVED_CLIP_SQLITE_KEY);
    await expect(repository.save({
      ...clip("undefined"),
      els: [{ type: "text", optional: undefined }],
    })).rejects.toMatchObject({ code: "invalid" });
    await expect(repository.save({
      ...clip("nan"),
      els: [{ type: "text", x: Number.NaN }],
    })).rejects.toMatchObject({ code: "invalid" });
  });

  it("surfaces element and item hard limits without truncation", async () => {
    const database = await memoryDatabase();
    const repository = createStudioSavedClipSqliteRepository({ acquireDatabase: async () => database });
    await expect(repository.save({
      ...clip("too-many-elements"),
      els: Array.from({ length: MAX_CLIP_ELEMENTS + 1 }, () => ({ type: "text" })),
    })).rejects.toMatchObject({ code: "invalid" });

    const full = Array.from({ length: MAX_CLIPS }, (_, index) => clip(`clip-${index}`, index + 1));
    const canonical = serializeStudioSavedClipLibrary(full);
    await database.kvSet(STUDIO_SAVED_CLIP_SQLITE_NAMESPACE, STUDIO_SAVED_CLIP_SQLITE_KEY, canonical);
    await expect(repository.save(clip("overflow", 99))).rejects.toMatchObject({ code: "limit" });
    await expect(database.kvGet(
      STUDIO_SAVED_CLIP_SQLITE_NAMESPACE,
      STUDIO_SAVED_CLIP_SQLITE_KEY,
    )).resolves.toBe(canonical);
  });

  it("queues save/delete and leaves the last invocation authoritative", async () => {
    const database = await memoryDatabase();
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let writes = 0;
    const delayed = {
      kvGet: database.kvGet.bind(database),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        if (++writes === 1) await blocked;
        await database.kvSet(namespace, key, value);
      }),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioSavedClipSqliteRepository({ acquireDatabase: async () => delayed });

    const save = repository.save(clip("queued"));
    const remove = repository.delete("queued");
    await vi.waitFor(() => expect(writes).toBe(1));
    releaseFirst();
    await Promise.all([save, remove]);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("reports unavailable SQLite instead of using a hidden fallback", async () => {
    const repository = createStudioSavedClipSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("Worker VFS failed");
      },
    });
    await expect(repository.list()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("Worker VFS failed"),
    });
  });
});
