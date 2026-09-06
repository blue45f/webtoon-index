import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BRAND_KIT_FONT,
  MAX_BRAND_KITS,
  serializeStudioBrandKitLibrary,
} from "./studio-brand-kit";
import {
  createStudioBrandKitSqliteRepository,
  STUDIO_BRAND_KIT_SQLITE_KEY,
  STUDIO_BRAND_KIT_SQLITE_NAMESPACE,
} from "./studio-brand-kit-sqlite-repository";
import { openStudioLocalDatabase } from "./studio-local-database";

import type { BrandKit } from "./studio-brand-kit";
import type { StudioLocalDatabase } from "./studio-local-database";

const databases: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  databases.push(database);
  return database;
}

function kit(id: string, timestamp = 1): BrandKit {
  return {
    id,
    name: `브랜드 ${id}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    paletteId: null,
    headingFont: DEFAULT_BRAND_KIT_FONT,
    bodyFont: DEFAULT_BRAND_KIT_FONT,
    logo: null,
  };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Brand Kit SQLite repository", () => {
  it("round-trips canonical metadata and a bounded logo through real sqlite-wasm", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrandKitSqliteRepository({ acquireDatabase: async () => database });
    const authored: BrandKit = {
      ...kit("brand-a", 1_000),
      paletteId: "palette-a",
      logo: { dataUrl: "data:image/webp;base64,YQ==", width: 64, height: 32 },
    };

    await expect(repository.save(authored)).resolves.toEqual([authored]);
    await expect(database.kvGet(
      STUDIO_BRAND_KIT_SQLITE_NAMESPACE,
      STUDIO_BRAND_KIT_SQLITE_KEY,
    )).resolves.toBe(serializeStudioBrandKitLibrary([authored]));
    await expect(createStudioBrandKitSqliteRepository({
      acquireDatabase: async () => database,
    }).list()).resolves.toEqual([authored]);
  });

  it("supports rename and delete with a deterministic timestamp", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrandKitSqliteRepository({
      acquireDatabase: async () => database,
      now: () => 2_000,
    });
    await repository.save(kit("brand-a", 1_000));
    await expect(repository.rename("brand-a", "새 브랜드")).resolves.toMatchObject([
      { id: "brand-a", name: "새 브랜드", updatedAt: 2_000 },
    ]);
    await expect(repository.delete("brand-a")).resolves.toEqual([]);
  });

  it("fails closed for malformed envelopes, duplicate IDs and invalid logo bytes", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrandKitSqliteRepository({ acquireDatabase: async () => database });
    const cases = [
      "{broken",
      JSON.stringify({
        schema: "toonspectrum.studio.brand-kits",
        version: 1,
        items: [kit("same"), kit("same", 2)],
      }),
      JSON.stringify({
        schema: "toonspectrum.studio.brand-kits",
        version: 1,
        items: [{ ...kit("bad-logo"), logo: { dataUrl: "javascript:1", width: 1, height: 1 } }],
      }),
      JSON.stringify({
        schema: "toonspectrum.studio.brand-kits",
        version: 1,
        items: [{ ...kit("extra"), future: true }],
      }),
    ];

    for (const raw of cases) {
      await database.kvSet(STUDIO_BRAND_KIT_SQLITE_NAMESPACE, STUDIO_BRAND_KIT_SQLITE_KEY, raw);
      await expect(repository.list()).rejects.toMatchObject({ code: "invalid" });
    }
  });

  it("rejects the 41st kit without silently evicting an existing kit", async () => {
    const database = await memoryDatabase();
    const repository = createStudioBrandKitSqliteRepository({ acquireDatabase: async () => database });
    const full = Array.from({ length: MAX_BRAND_KITS }, (_, index) => kit(`k-${index}`, index + 1));
    const canonical = serializeStudioBrandKitLibrary(full);
    await database.kvSet(STUDIO_BRAND_KIT_SQLITE_NAMESPACE, STUDIO_BRAND_KIT_SQLITE_KEY, canonical);

    await expect(repository.save(kit("overflow", 99))).rejects.toMatchObject({ code: "limit" });
    await expect(database.kvGet(
      STUDIO_BRAND_KIT_SQLITE_NAMESPACE,
      STUDIO_BRAND_KIT_SQLITE_KEY,
    )).resolves.toBe(canonical);
  });

  it("serializes overlapping saves", async () => {
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
    const repository = createStudioBrandKitSqliteRepository({ acquireDatabase: async () => delayed });

    const first = repository.save(kit("same", 1));
    const second = repository.save({ ...kit("same", 2), name: "마지막" });
    await vi.waitFor(() => expect(writes).toBe(1));
    releaseFirst();
    await Promise.all([first, second]);
    await expect(repository.list()).resolves.toMatchObject([{ id: "same", name: "마지막" }]);
  });

  it("never downgrades repository failure to another browser authority", async () => {
    const repository = createStudioBrandKitSqliteRepository({
      acquireDatabase: async () => {
        throw new Error("OPFS unavailable");
      },
    });
    await expect(repository.list()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("OPFS unavailable"),
    });
  });
});
