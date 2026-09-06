import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY,
  type StudioCreatorInstalledFilterPreset,
  type StudioCreatorPackStorage,
} from "../studio-creator-filter-preset-reader";
import {
  SqliteUnavailableError,
  openStudioLocalDatabase,
  requireStudioFilterLibraryDatabase,
  type StudioLocalDatabase,
  type StudioSqliteApiHandle,
} from "../studio-local-database";

import {
  FILTER_LIBRARY_LEGACY_MIGRATION_KEY,
  FILTER_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
  STUDIO_FILTER_LIBRARY_DATA_POLICY,
  STUDIO_FILTER_LIBRARY_V12_FALLBACK_KEY,
  createSqliteFilterLibraryRepository,
  createV12FallbackFilterLibraryRepository,
  importLegacyFilterLibraryToSqlite,
  openProductFilterLibraryRepository,
  studioFilterPresetToSqlRecord,
  type StudioFilterLibraryPreset,
} from "./studio-filter-library-sqlite-repository";

let sqlite3: StudioSqliteApiHandle;
const opened: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of opened) await database.close();
});

async function database(): Promise<StudioLocalDatabase> {
  const result = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  opened.push(result);
  return result;
}

function storage(initial: Record<string, string> = {}): StudioCreatorPackStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function legacyPreset(index: number): StudioCreatorInstalledFilterPreset {
  return {
    id: `creator-pack:legacy:vignette-${index}`,
    packageId: "legacy",
    entryId: `vignette-${index}`,
    name: `레거시 비네트 ${index}`,
    engine: "vignette",
    values: { darkness: 35, size: 45, roundness: 100, feather: 60 },
    installedAt: index + 1,
    updatedAt: index + 1,
  };
}

function preset(
  index: number,
  overrides: Partial<StudioFilterLibraryPreset> = {},
): StudioFilterLibraryPreset {
  const category = index % 2 === 0 ? "comic" : "photo";
  return {
    ...legacyPreset(index),
    id: `filter-${String(index).padStart(4, "0")}`,
    packageId: `pack-${index % 11}`,
    entryId: `entry-${index}`,
    name: `${category} 작가 프리셋 ${String(index).padStart(4, "0")}`,
    installedAt: index + 1,
    updatedAt: (index + 1) * 2,
    category,
    favorite: index % 7 === 0,
    sortOrder: index % 19,
    packageVersion: "12.0.0",
    packageFingerprint: `fingerprint-${index % 11}`,
    ...overrides,
  };
}

describe("V12 filter-library discard policy", () => {
  it("starts a new SQLite authority empty and never auto-imports the old v1 key", async () => {
    const db = await database();
    const old = storage({
      [STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY]: JSON.stringify([legacyPreset(1)]),
    });
    const product = await openProductFilterLibraryRepository({
      storage: old,
      acquireDatabase: () => Promise.resolve(db),
    });

    expect(product.authority).toBe("sqlite");
    expect(product.legacyDataPolicy).toBe(STUDIO_FILTER_LIBRARY_DATA_POLICY);
    expect((await product.repository.query()).totalCount).toBe(0);
    expect(await db.kvGet(
      FILTER_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
      FILTER_LIBRARY_LEGACY_MIGRATION_KEY,
    )).toBeNull();
    expect(old.values.has(STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY)).toBe(true);
  });

  it("opens a fresh memory session without touching localStorage when SQLite is unavailable", async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem });
    try {
      const product = await openProductFilterLibraryRepository({
        acquireDatabase: () => Promise.reject(new SqliteUnavailableError("forced")),
      });

      expect(product.authority).toBe("memory-session");
      expect((await product.repository.query()).totalCount).toBe(0);
      await product.repository.put(preset(2));
      expect((await product.repository.query()).items.map((item) => item.id)).toEqual([
        preset(2).id,
      ]);
      const compensate = product.compareAndRestoreInstallSnapshot;
      if (!compensate) throw new Error("Expected memory compare-and-restore support");
      const previous = preset(2, { name: "설치 전 필터", updatedAt: 20 });
      const installed = preset(2, { name: "설치 후보", updatedAt: 21 });
      const newer = preset(2, { name: "사용자 후속 편집", updatedAt: 22 });
      const inserted = preset(3, { name: "새 설치 후보", updatedAt: 30 });
      await product.repository.put(previous);
      await product.repository.put(installed);
      await product.repository.put(inserted);
      await product.repository.put(newer);
      await expect(compensate([
        { id: installed.id, expected: installed, restore: previous },
        { id: inserted.id, expected: inserted, restore: null },
      ])).resolves.toEqual({
        restoredIds: [inserted.id],
        conflictIds: [installed.id],
      });
      await expect(product.repository.getById(installed.id)).resolves.toEqual(newer);
      await expect(product.repository.getById(inserted.id)).resolves.toBeNull();
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the retired V12 localStorage key behind an explicit legacy seam", async () => {
    const old = storage({
      [STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY]: JSON.stringify([legacyPreset(1)]),
    });
    const repository = createV12FallbackFilterLibraryRepository(old);

    expect((await repository.query()).totalCount).toBe(0);
    await repository.put(preset(2));
    expect(old.values.has(STUDIO_FILTER_LIBRARY_V12_FALLBACK_KEY)).toBe(true);
    expect(JSON.parse(old.values.get(STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY)!)).toHaveLength(1);
  });

  it("does not downgrade an arbitrary database failure to memory or localStorage", async () => {
    await expect(openProductFilterLibraryRepository({
      storage: storage(),
      acquireDatabase: () => Promise.reject(new Error("migration-corrupt")),
    })).rejects.toThrow("migration-corrupt");
  });

  it("imports old data only through the explicit opt-in API", async () => {
    const db = await database();
    const old = storage({
      [STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY]: JSON.stringify([
        legacyPreset(1),
        legacyPreset(2),
      ]),
    });
    const first = await importLegacyFilterLibraryToSqlite(db, old, {
      explicit: true,
      now: () => 777,
    });
    expect(first).toEqual({ status: "imported", sourceCount: 2, insertedCount: 2 });
    const second = await importLegacyFilterLibraryToSqlite(db, old, { explicit: true });
    expect(second).toEqual({
      status: "already-complete",
      sourceCount: 2,
      insertedCount: 2,
    });
    expect((await createSqliteFilterLibraryRepository(db).query()).totalCount).toBe(2);
  });
});

describe("SQLite filter-library repository", () => {
  it("preserves a newer row while restoring eligible filter rows with one CAS", async () => {
    const db = await database();
    const sql = requireStudioFilterLibraryDatabase(db);
    const previousA = studioFilterPresetToSqlRecord(preset(41, {
      name: "설치 전 A",
      updatedAt: 401,
    }));
    const previousB = studioFilterPresetToSqlRecord(preset(42, {
      name: "설치 전 B",
      updatedAt: 402,
    }));
    const installedA = studioFilterPresetToSqlRecord(preset(41, {
      name: "설치 후보 A",
      updatedAt: 411,
    }));
    const installedB = studioFilterPresetToSqlRecord(preset(42, {
      name: "설치 후보 B",
      updatedAt: 412,
    }));
    const newerA = studioFilterPresetToSqlRecord(preset(41, {
      name: "사용자 후속 편집 A",
      updatedAt: 421,
    }));
    await sql.putFilterLibraryRecords([installedA, installedB]);
    await sql.putFilterLibraryRecord(newerA);

    await expect(sql.compareAndRestoreFilterLibraryRecords([
      { id: installedA.id, expected: installedA, restore: previousA },
      { id: installedB.id, expected: installedB, restore: previousB },
    ])).resolves.toEqual({
      restoredIds: [installedB.id],
      conflictIds: [installedA.id],
    });
    expect(await sql.getFilterLibraryRecord(installedA.id)).toEqual(newerA);
    expect(await sql.getFilterLibraryRecord(installedB.id)).toEqual(previousB);
  });

  it("rolls prior filter restores back when a later CAS write fails in SQLite", async () => {
    const db = await database();
    const sql = requireStudioFilterLibraryDatabase(db);
    const installedA = studioFilterPresetToSqlRecord(preset(51, {
      name: "설치 후보 A",
      updatedAt: 511,
    }));
    const installedB = studioFilterPresetToSqlRecord(preset(52, {
      name: "설치 후보 B",
      updatedAt: 512,
    }));
    const previousA = studioFilterPresetToSqlRecord(preset(51, {
      name: "설치 전 A",
      updatedAt: 501,
    }));
    const invalidPreviousB = {
      ...studioFilterPresetToSqlRecord(preset(52, {
        name: "설치 전 B",
        updatedAt: 502,
      })),
      createdAt: null as unknown as number,
    };
    await sql.putFilterLibraryRecords([installedA, installedB]);

    await expect(sql.compareAndRestoreFilterLibraryRecords([
      { id: installedA.id, expected: installedA, restore: previousA },
      { id: installedB.id, expected: installedB, restore: invalidPreviousB },
    ])).rejects.toThrow(/NOT NULL|constraint/iu);
    expect(await sql.getFilterLibraryRecord(installedA.id)).toEqual(installedA);
    expect(await sql.getFilterLibraryRecord(installedB.id)).toEqual(installedB);
  });

  it("round-trips uncapped deterministic keyset pages without duplicates", async () => {
    const db = await database();
    const repository = createSqliteFilterLibraryRepository(db);
    const source = Array.from({ length: 311 }, (_, index) => preset(index));
    expect(await repository.putMany(source)).toBe(311);

    const ids: string[] = [];
    let cursor = null;
    let hasMore = true;
    while (hasMore) {
      const page = await repository.query({ cursor, limit: 23 });
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }
    expect(ids).toHaveLength(311);
    expect(new Set(ids).size).toBe(311);
    expect(ids.slice(0, 3)).toEqual(["filter-0266", "filter-0133", "filter-0000"]);
  });

  it("searches normalized text and combines category, engine and favorite filters", async () => {
    const db = await database();
    const repository = createSqliteFilterLibraryRepository(db);
    await repository.putMany(Array.from({ length: 120 }, (_, index) => preset(index)));
    const page = await repository.query({
      search: "작가 프리셋",
      category: "ＣＯＭＩＣ",
      engine: "vignette",
      favorite: true,
      limit: 200,
    });
    expect(page.totalCount).toBeGreaterThan(0);
    expect(page.hasMore).toBe(false);
    expect(page.items.every((item) =>
      item.category === "comic" && item.favorite && item.engine === "vignette",
    )).toBe(true);
  });

  it("persists favorite mutations and deletes a package batch atomically", async () => {
    const db = await database();
    const repository = createSqliteFilterLibraryRepository(db);
    await repository.putMany([preset(1), preset(2), preset(3)]);
    expect((await repository.setFavorite("filter-0001", true))?.favorite).toBe(true);
    expect(await repository.deleteMany(["filter-0001", "filter-0003", "missing"])).toBe(2);
    expect((await repository.query({ limit: 10 })).items.map((item) => item.id)).toEqual([
      "filter-0002",
    ]);
  });

  it("rejects an indexed-column/payload mismatch instead of hiding corruption", async () => {
    const db = await database();
    const repository = createSqliteFilterLibraryRepository(db);
    const record = studioFilterPresetToSqlRecord(preset(4));
    await requireStudioFilterLibraryDatabase(db).putFilterLibraryRecord({
      ...record,
      name: "tampered",
    });
    await expect(repository.getById(record.id)).rejects.toMatchObject({ code: "corrupt" });
  });
});
