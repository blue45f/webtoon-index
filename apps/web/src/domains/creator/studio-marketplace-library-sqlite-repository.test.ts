import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "./studio-local-database";
import {
  createStudioMarketplaceLibrarySqliteRepository,
  STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY,
  STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE,
} from "./studio-marketplace-library-sqlite-repository";
import {
  STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES,
  serializeCanonicalStudioMarketplaceLibrary,
} from "./studio-marketplace-packages";

import type { StudioLocalDatabase } from "./studio-local-database";
import type {
  StudioMarketplaceLibraryEntry,
  StudioMarketplaceLibraryState,
} from "./studio-marketplace-packages";

const databases: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

function entry(id: string, minute = 0): StudioMarketplaceLibraryEntry {
  return {
    packageId: id,
    version: "1.0.0",
    packageFingerprint: `sha256:${id}`,
    addedAt: `2026-08-09T00:${String(minute).padStart(2, "0")}:00.000Z`,
  };
}

function state(...packages: StudioMarketplaceLibraryEntry[]): StudioMarketplaceLibraryState {
  return { version: 1, packages };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("original marketplace SQLite library", () => {
  it("round-trips canonical package metadata through real sqlite-wasm and a reopened repository", async () => {
    const database = await memoryDatabase();
    const first = createStudioMarketplaceLibrarySqliteRepository({
      acquireDatabase: async () => database,
    });
    const authored = state(entry("starter-a"), entry("starter-b", 1));

    await expect(first.list()).resolves.toEqual(state());
    await expect(first.save(authored)).resolves.toEqual(authored);
    await expect(database.kvGet(
      STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY,
    )).resolves.toBe(serializeCanonicalStudioMarketplaceLibrary(authored));

    const reopened = createStudioMarketplaceLibrarySqliteRepository({
      acquireDatabase: async () => database,
    });
    await expect(reopened.list()).resolves.toEqual(authored);
  });

  it("fails the entire read for malformed, duplicate, extra-field, and non-canonical rows", async () => {
    const database = await memoryDatabase();
    const repository = createStudioMarketplaceLibrarySqliteRepository({
      acquireDatabase: async () => database,
    });
    const invalid = [
      "{broken",
      JSON.stringify(state(entry("same"), entry("same", 1))),
      JSON.stringify({ version: 1, packages: [{ ...entry("extra"), future: true }] }),
      JSON.stringify(state(entry("pretty")), null, 2),
    ];

    for (const raw of invalid) {
      await database.kvSet(
        STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE,
        STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY,
        raw,
      );
      await expect(repository.list()).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("merges a concurrent package and preserves explicit removals", async () => {
    const database = await memoryDatabase();
    const first = createStudioMarketplaceLibrarySqliteRepository({
      acquireDatabase: async () => database,
    });
    const second = createStudioMarketplaceLibrarySqliteRepository({
      acquireDatabase: async () => database,
    });
    await first.save(state(entry("pack-a")));
    const stale = await first.list();
    await second.save(state(entry("pack-a"), entry("pack-other", 1)));

    await expect(first.save(stale)).resolves.toEqual(
      state(entry("pack-a"), entry("pack-other", 1)),
    );
    await expect(first.save(state(entry("pack-other", 1)), {
      removedPackageIds: ["pack-a"],
    })).resolves.toEqual(state(entry("pack-other", 1)));
  });

  it("rejects overflow without evicting or rewriting the existing canonical library", async () => {
    const database = await memoryDatabase();
    const repository = createStudioMarketplaceLibrarySqliteRepository({
      acquireDatabase: async () => database,
    });
    const full = state(...Array.from(
      { length: STUDIO_MARKETPLACE_MAX_LIBRARY_PACKAGES },
      (_, index) => entry(`pack-${index}`, index % 60),
    ));
    await database.kvSet(
      STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY,
      serializeCanonicalStudioMarketplaceLibrary(full),
    );
    const before = await database.kvGet(
      STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY,
    );

    await expect(repository.save(state(entry("new")))).rejects.toMatchObject({ code: "limit" });
    await expect(database.kvGet(
      STUDIO_MARKETPLACE_LIBRARY_SQLITE_NAMESPACE,
      STUDIO_MARKETPLACE_LIBRARY_SQLITE_KEY,
    )).resolves.toBe(before);
  });

  it("serializes overlapping writes and notifies only committed mutations", async () => {
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
    const repository = createStudioMarketplaceLibrarySqliteRepository({
      acquireDatabase: async () => delayed,
    });
    const listener = vi.fn();
    repository.subscribe(listener);

    const first = repository.save(state(entry("first")));
    const second = repository.save(state(entry("second", 1)));
    await vi.waitFor(() => expect(writes).toBe(1));
    releaseFirst();
    await Promise.all([first, second]);

    await expect(repository.list()).resolves.toEqual(
      state(entry("second", 1), entry("first")),
    );
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("surfaces SQLite failure without localStorage or memory persistence fallback", async () => {
    const repository = createStudioMarketplaceLibrarySqliteRepository({
      acquireDatabase: async () => {
        throw new Error("OPFS SAH pool denied");
      },
    });
    await expect(repository.list()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("OPFS SAH pool denied"),
    });
  });
});
