import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import { MAX_PALETTES, serializeStudioPaletteLibrary } from "./studio-palette-library";
import {
  createStudioPaletteSqliteRepository,
  STUDIO_PALETTE_SQLITE_KEY,
  STUDIO_PALETTE_SQLITE_NAMESPACE,
} from "./studio-palette-sqlite-repository";

import type { StudioLocalDatabase } from "./studio-local-database";
import type { StudioNamedPalette } from "./studio-palette-library";

const databases: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

function palette(id: string, timestamp = 1): StudioNamedPalette {
  return {
    id,
    name: `팔레트 ${id}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    colors: ["#112233", "#abcdef"],
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("named palette SQLite repository", () => {
  it("round-trips the canonical envelope through real sqlite-wasm", async () => {
    const database = await memoryDatabase();
    const repository = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => database,
    });
    const authored = palette("palette-a", 1_000);

    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.save(authored)).resolves.toEqual([authored]);
    await expect(database.kvGet(
      STUDIO_PALETTE_SQLITE_NAMESPACE,
      STUDIO_PALETTE_SQLITE_KEY,
    )).resolves.toBe(serializeStudioPaletteLibrary([authored]));

    const reopened = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => database,
    });
    await expect(reopened.list()).resolves.toEqual([authored]);
  });

  it("commits a deterministic palette batch and SQLite receipt under one mutation queue", async () => {
    const database = await memoryDatabase();
    const repository = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => database,
    });
    const changed = vi.fn();
    repository.subscribe(changed);

    await expect(repository.commitBatch({
      upsert: [palette("first"), palette("second", 2)],
      sidecars: [{
        namespace: "studio-creator-pack-v12",
        key: "palette:pack-a",
        value: '{"version":1}',
      }],
    })).resolves.toMatchObject({
      upsertedCount: 2,
      deletedCount: 0,
      items: [{ id: "first" }, { id: "second" }],
    });
    await expect(repository.readSidecar(
      "studio-creator-pack-v12",
      "palette:pack-a",
    )).resolves.toBe('{"version":1}');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("restores the exact palette envelope and receipt when a sidecar write fails", async () => {
    const database = await memoryDatabase();
    const beforeItems = [palette("existing", 1)];
    const beforeRaw = serializeStudioPaletteLibrary(beforeItems);
    await database.kvSet(
      STUDIO_PALETTE_SQLITE_NAMESPACE,
      STUDIO_PALETTE_SQLITE_KEY,
      beforeRaw,
    );
    await database.kvSet("studio-creator-pack-v12", "palette:pack-a", "old-receipt");
    const faulting = {
      kvGet: database.kvGet.bind(database),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        if (
          namespace === "studio-creator-pack-v12"
          && key === "palette:pack-a"
          && value === "new-receipt"
        ) {
          throw new Error("receipt write denied");
        }
        await database.kvSet(namespace, key, value);
      }),
      kvDelete: database.kvDelete.bind(database),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => faulting,
    });
    const changed = vi.fn();
    repository.subscribe(changed);

    await expect(repository.commitBatch({
      upsert: [palette("incoming", 2)],
      sidecars: [{
        namespace: "studio-creator-pack-v12",
        key: "palette:pack-a",
        value: "new-receipt",
      }],
    })).rejects.toMatchObject({ code: "unavailable" });
    await expect(database.kvGet(
      STUDIO_PALETTE_SQLITE_NAMESPACE,
      STUDIO_PALETTE_SQLITE_KEY,
    )).resolves.toBe(beforeRaw);
    await expect(database.kvGet(
      "studio-creator-pack-v12",
      "palette:pack-a",
    )).resolves.toBe("old-receipt");
    expect(changed).not.toHaveBeenCalled();
  });

  it("renames and deletes without touching a legacy key", async () => {
    const database = await memoryDatabase();
    const repository = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 2_000,
    });
    await repository.save(palette("palette-a", 1_000));

    await expect(repository.rename("palette-a", "완성 팔레트")).resolves.toMatchObject([
      { id: "palette-a", name: "완성 팔레트", updatedAt: 2_000 },
    ]);
    await expect(repository.delete("palette-a")).resolves.toEqual([]);
  });

  it("fails the whole read for corrupt, duplicate, extra-field or non-canonical data", async () => {
    const database = await memoryDatabase();
    const repository = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => database,
    });
    const cases = [
      "{broken",
      JSON.stringify({
        schema: "toonspectrum.studio.named-palettes",
        version: 1,
        items: [palette("duplicate"), palette("duplicate", 2)],
      }),
      JSON.stringify({
        schema: "toonspectrum.studio.named-palettes",
        version: 1,
        items: [{ ...palette("extra"), future: true }],
      }),
      JSON.stringify({
        schema: "toonspectrum.studio.named-palettes",
        version: 1,
        items: [{ ...palette("upper"), colors: ["#ABCDEF"] }],
      }),
      JSON.stringify(JSON.parse(serializeStudioPaletteLibrary([palette("order")])), null, 2),
    ];

    for (const raw of cases) {
      await database.kvSet(STUDIO_PALETTE_SQLITE_NAMESPACE, STUDIO_PALETTE_SQLITE_KEY, raw);
      await expect(repository.list()).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("rejects item overflow without truncating or replacing the prior canonical library", async () => {
    const database = await memoryDatabase();
    const repository = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => database,
    });
    const full = Array.from({ length: MAX_PALETTES }, (_, index) => palette(`p-${index}`, index + 1));
    await database.kvSet(
      STUDIO_PALETTE_SQLITE_NAMESPACE,
      STUDIO_PALETTE_SQLITE_KEY,
      serializeStudioPaletteLibrary(full),
    );
    const before = await database.kvGet(STUDIO_PALETTE_SQLITE_NAMESPACE, STUDIO_PALETTE_SQLITE_KEY);

    await expect(repository.save(palette("overflow", 99))).rejects.toMatchObject({ code: "limit" });
    await expect(database.kvGet(
      STUDIO_PALETTE_SQLITE_NAMESPACE,
      STUDIO_PALETTE_SQLITE_KEY,
    )).resolves.toBe(before);
  });

  it("queues overlapping writes so invocation order is authoritative", async () => {
    const database = await memoryDatabase();
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let writes = 0;
    const delayed = {
      kvGet: database.kvGet.bind(database),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        if (++writes === 1) await firstBlocked;
        await database.kvSet(namespace, key, value);
      }),
    } as unknown as StudioLocalDatabase;
    const repository = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => delayed,
    });

    const first = repository.save(palette("same", 1));
    const second = repository.save({ ...palette("same", 2), name: "마지막" });
    await vi.waitFor(() => expect(writes).toBe(1));
    releaseFirst();
    await Promise.all([first, second]);
    await expect(repository.list()).resolves.toMatchObject([
      { id: "same", name: "마지막", updatedAt: 2 },
    ]);
  });

  it("surfaces SQLite unavailability with no hidden browser-storage downgrade", async () => {
    const repository = createStudioPaletteSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("SAH pool denied");
      },
    });
    await expect(repository.list()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("SAH pool denied"),
    });
  });
});
