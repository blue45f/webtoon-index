import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  SqliteUnavailableError,
  openStudioLocalDatabase,
  requireStudioBrushLibraryDatabase,
  type StudioLocalDatabase,
  type StudioSqliteApiHandle,
} from "../studio-local-database";

import {
  BRUSH_LIBRARY_KEY,
  BRUSH_LIBRARY_STORAGE_VERSION,
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  compareBrushesForLibrary,
  type BrushLibraryStorage,
  type StudioSavedBrush,
} from "./studio-brush-library";
import {
  BRUSH_LIBRARY_LEGACY_MIGRATION_KEY,
  BRUSH_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
  BRUSH_LIBRARY_V12_FALLBACK_KEY,
  createLegacyV12FallbackBrushLibraryRepository,
  createSqliteBrushLibraryRepository,
  migrateLegacyBrushLibraryToSqlite,
  openProductBrushLibraryRepository,
  readAllBrushesFromRepository,
  resetProductBrushLibraryRepositoryRuntime,
  studioBrushToSqlRecord,
} from "./studio-brush-library-sqlite-repository";

const localDatabaseRuntime = vi.hoisted(() => ({
  acquire: vi.fn<() => Promise<StudioLocalDatabase>>(),
}));

vi.mock("../studio-local-database-runtime", () => ({
  acquireStudioLocalDatabase: localDatabaseRuntime.acquire,
}));

let sqlite3: StudioSqliteApiHandle;
const opened: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of opened) await database.close();
});

afterEach(() => {
  resetProductBrushLibraryRepositoryRuntime();
  localDatabaseRuntime.acquire.mockReset();
});

async function openMemoryDatabase(options: {
  readonly now?: () => number;
  readonly memoryFilename?: string;
  readonly tracked?: boolean;
} = {}): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
    ...(options.now ? { now: options.now } : {}),
    ...(options.memoryFilename ? { memoryFilename: options.memoryFilename } : {}),
  });
  if (options.tracked !== false) opened.push(database);
  return database;
}

function brush(
  index: number,
  overrides: Partial<StudioSavedBrush> = {},
): StudioSavedBrush {
  const stamp = index + 1;
  return {
    ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
    id: `brush-${String(index).padStart(5, "0")}`,
    name: `작가 브러시 ${String(index).padStart(5, "0")}`,
    createdAt: stamp,
    updatedAt: stamp * 2,
    pinned: index % 11 === 0,
    lastUsedAt: index % 3 === 0 ? stamp * 3 : null,
    ...overrides,
  };
}

function storageWith(brushes: readonly StudioSavedBrush[]): BrushLibraryStorage {
  const values = new Map<string, string>([
    [
      BRUSH_LIBRARY_KEY,
      JSON.stringify({ version: BRUSH_LIBRARY_STORAGE_VERSION, brushes }),
    ],
  ]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("SQLite unlimited brush repository", () => {
  it("stores and keyset-pages 4,097 brushes with no fixed cap, duplicates, or omissions", async () => {
    const database = await openMemoryDatabase();
    const repository = createSqliteBrushLibraryRepository(database);
    const source = Array.from({ length: 4_097 }, (_, index) => brush(index));
    const startedAt = performance.now();
    const summary = await repository.putMany(source);
    const writeMs = performance.now() - startedAt;

    expect(summary).toEqual({ savedCount: 4_097, skippedDuplicateCount: 0 });
    const ids = new Set<string>();
    const loaded: StudioSavedBrush[] = [];
    let cursor: string | null = null;
    let pages = 0;
    let hasMore = true;
    while (hasMore) {
      const page = await repository.query({ cursor, limit: 257 });
      expect(page.totalCount).toBe(4_097);
      for (const item of page.items) {
        expect(ids.has(item.id)).toBe(false);
        ids.add(item.id);
        loaded.push(item);
      }
      pages += 1;
      cursor = page.nextCursor;
      hasMore = page.hasMore;
      if (!hasMore) break;
      expect(cursor).not.toBeNull();
    }

    expect(pages).toBe(16);
    expect(loaded).toHaveLength(4_097);
    expect(loaded).toEqual([...source].sort(compareBrushesForLibrary));
    expect(writeMs).toBeLessThan(10_000);
  }, 20_000);

  it("pushes NFKC search, render-family, pinned, and keyset filters into SQLite", async () => {
    const database = await openMemoryDatabase();
    const repository = createSqliteBrushLibraryRepository(database);
    await repository.putMany([
      brush(1, { name: "수채 번짐", brushId: "watercolor", pinned: true }),
      brush(2, { name: "ＳＯＦＴ Wash", brushId: "watercolor", pinned: true }),
      brush(3, { name: "Soft Pen", brushId: "pen", pinned: true }),
      brush(4, { name: "수채 평붓", brushId: "watercolor", pinned: false }),
    ]);

    const first = await repository.query({
      search: "soft",
      category: "watercolor",
      pinned: true,
      limit: 1,
    });
    expect(first.items.map((item) => item.name)).toEqual(["ＳＯＦＴ Wash"]);
    expect(first.totalCount).toBe(1);
    expect(first.hasMore).toBe(false);

    const watercolor = await repository.query({ category: "watercolor", limit: 2 });
    expect(watercolor.items.every((item) => item.brushId === "watercolor")).toBe(true);
    expect(watercolor.totalCount).toBe(3);
    expect(watercolor.hasMore).toBe(true);
    const second = await repository.query({
      category: "watercolor",
      cursor: watercolor.nextCursor,
      limit: 2,
    });
    expect(second.items).toHaveLength(1);
  });

  it("upserts, deletes with the original order index, restores, and duplicates", async () => {
    const database = await openMemoryDatabase();
    const repository = createSqliteBrushLibraryRepository(database, {
      now: () => 9_999,
      uuid: () => "duplicate-id",
    });
    const original = brush(10, { name: "주력 펜", pinned: true });
    const neighbor = brush(20, { name: "다른 펜", pinned: false });
    await repository.putMany([original, neighbor]);
    await repository.put({ ...original, name: "고친 주력 펜", updatedAt: 999 });
    expect((await repository.getById(original.id))?.name).toBe("고친 주력 펜");

    const duplicated = await repository.duplicate(original.id);
    expect(duplicated).toMatchObject({
      id: "duplicate-id",
      name: "고친 주력 펜 2",
      createdAt: 9_999,
      updatedAt: 9_999,
      pinned: false,
      lastUsedAt: null,
    });

    const deleted = await repository.delete(original.id);
    expect(deleted?.brush.name).toBe("고친 주력 펜");
    expect(deleted?.index).toBe(0);
    expect(await repository.getById(original.id)).toBeNull();
    await repository.restore(deleted!);
    expect((await repository.getById(original.id))?.name).toBe("고친 주력 펜");
  });

  it("rolls back a multi-row SQL transaction when any indexed record violates the schema", async () => {
    const database = await openMemoryDatabase();
    const sql = requireStudioBrushLibraryDatabase(database);
    const valid = studioBrushToSqlRecord(brush(1));
    const invalid = {
      ...studioBrushToSqlRecord(brush(2)),
      activityAt: 123,
      lastUsedAt: null,
      updatedAt: 456,
    };
    await expect(sql.putBrushLibraryRecords([valid, invalid])).rejects.toThrow(
      /CHECK|constraint/i,
    );
    expect((await sql.queryBrushLibraryRecords({
      limit: 10,
      search: "",
      category: null,
      pinned: null,
      after: null,
    })).records).toEqual([]);
  });

  it("fails closed when payload JSON or indexed columns are corrupted", async () => {
    const database = await openMemoryDatabase();
    const sql = requireStudioBrushLibraryDatabase(database);
    const record = studioBrushToSqlRecord(brush(7));
    await sql.putBrushLibraryRecord({ ...record, name: "index disagrees" });
    const repository = createSqliteBrushLibraryRepository(database);
    await expect(repository.getById(record.id)).rejects.toMatchObject({ code: "corrupt" });

    await sql.putBrushLibraryRecord({ ...record, payload: "{torn" });
    await expect(repository.getById(record.id)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("compares rows and a receipt inside one transaction while preserving newer edits", async () => {
    const database = await openMemoryDatabase();
    const sql = requireStudioBrushLibraryDatabase(database);
    const namespace = "creator-pack-cas-test";
    const receiptKey = "brush:pack-a";
    const receiptIdentity = `${namespace}\u0000${receiptKey}`;
    const previous = studioBrushToSqlRecord(brush(31, { name: "설치 전" }));
    const installed = studioBrushToSqlRecord(brush(31, { name: "설치 후보", updatedAt: 310 }));
    const inserted = studioBrushToSqlRecord(brush(32, { name: "새 설치 후보", updatedAt: 320 }));
    const newer = studioBrushToSqlRecord(brush(31, { name: "사용자 편집", updatedAt: 311 }));
    const entries = [
      { id: installed.id, expected: installed, restore: previous },
      { id: inserted.id, expected: inserted, restore: null },
    ] as const;
    const sidecars = [{
      namespace,
      key: receiptKey,
      expected: "installed-receipt",
      restore: "previous-receipt",
    }] as const;
    await sql.putBrushLibraryRecords([installed, inserted]);
    await database.kvSet(namespace, receiptKey, "newer-pack-receipt");

    await expect(sql.compareAndRestoreBrushLibraryRecords(entries, sidecars)).resolves.toEqual({
      restoredIds: [],
      conflictIds: [receiptIdentity],
    });
    expect(await sql.getBrushLibraryRecord(installed.id)).toEqual(installed);
    expect(await sql.getBrushLibraryRecord(inserted.id)).toEqual(inserted);

    await sql.putBrushLibraryRecord(newer);
    await database.kvSet(namespace, receiptKey, "installed-receipt");
    await expect(sql.compareAndRestoreBrushLibraryRecords(entries, sidecars)).resolves.toEqual({
      restoredIds: [inserted.id, receiptIdentity],
      conflictIds: [installed.id],
    });
    expect(await sql.getBrushLibraryRecord(installed.id)).toEqual(newer);
    expect(await sql.getBrushLibraryRecord(inserted.id)).toBeNull();
    expect(await database.kvGet(namespace, receiptKey)).toBe("previous-receipt");
  });

  it("rolls every CAS restore back when a later restore violates SQLite", async () => {
    const database = await openMemoryDatabase();
    const sql = requireStudioBrushLibraryDatabase(database);
    const installedA = studioBrushToSqlRecord(brush(41, { name: "설치 A", updatedAt: 410 }));
    const installedB = studioBrushToSqlRecord(brush(42, { name: "설치 B", updatedAt: 420 }));
    const previousA = studioBrushToSqlRecord(brush(41, { name: "이전 A" }));
    const previousB = studioBrushToSqlRecord(brush(42, { name: "이전 B" }));
    const invalidPreviousB = {
      ...previousB,
      activityAt: previousB.updatedAt + 1,
      lastUsedAt: null,
    };
    await sql.putBrushLibraryRecords([installedA, installedB]);

    await expect(sql.compareAndRestoreBrushLibraryRecords([
      { id: installedA.id, expected: installedA, restore: previousA },
      { id: installedB.id, expected: installedB, restore: invalidPreviousB },
    ])).rejects.toThrow(/CHECK|constraint/iu);
    expect(await sql.getBrushLibraryRecord(installedA.id)).toEqual(installedA);
    expect(await sql.getBrushLibraryRecord(installedB.id)).toEqual(installedB);
  });

  it("keeps SQLite disk-full/quota failures distinct from generic write failures", async () => {
    const database = await openMemoryDatabase();
    const sql = requireStudioBrushLibraryDatabase(database);
    const put = vi.spyOn(sql, "putBrushLibraryRecord").mockRejectedValueOnce(
      new Error("SQLITE_FULL: database or disk is full"),
    );
    const repository = createSqliteBrushLibraryRepository(database);
    await expect(repository.put(brush(9))).rejects.toMatchObject({
      code: "quota-exceeded",
    });

    put.mockRejectedValueOnce(
      new Error("forced I/O failure"),
    );
    await expect(repository.put(brush(10))).rejects.toMatchObject({
      code: "write-error",
    });
  });

  it("persists records across a real wasm-VFS close and reopen", async () => {
    const filename = `brush-reopen-${crypto.randomUUID()}.sqlite3`;
    const first = await openMemoryDatabase({ memoryFilename: filename, tracked: false });
    const firstRepository = createSqliteBrushLibraryRepository(first);
    await firstRepository.put(brush(42, { name: "재개방 브러시" }));
    await first.close();

    const reopened = await openMemoryDatabase({ memoryFilename: filename });
    const reopenedRepository = createSqliteBrushLibraryRepository(reopened);
    expect(await reopenedRepository.getById("brush-00042")).toMatchObject({
      name: "재개방 브러시",
    });
  });
});

describe("legacy localStorage migration and product memory session", () => {
  it("coalesces product consumers onto one app-lifetime SQLite repository", async () => {
    const database = await openMemoryDatabase();
    localDatabaseRuntime.acquire.mockResolvedValue(database);

    const [page, inspector, mobile] = await Promise.all([
      openProductBrushLibraryRepository(),
      openProductBrushLibraryRepository(),
      openProductBrushLibraryRepository(),
    ]);

    expect(page).toBe(inspector);
    expect(inspector).toBe(mobile);
    expect(localDatabaseRuntime.acquire).toHaveBeenCalledOnce();
    await page.repository.put(brush(9, { name: "공유 카탈로그" }));
    await expect(mobile.repository.getById("brush-00009")).resolves.toMatchObject({
      name: "공유 카탈로그",
    });
  });

  it("keeps one shared memory catalog when the product OPFS authority is unavailable", async () => {
    localDatabaseRuntime.acquire.mockRejectedValue(
      new SqliteUnavailableError("Studio OPFS is already owned by another page"),
    );

    const first = await openProductBrushLibraryRepository();
    const second = await openProductBrushLibraryRepository();

    expect(first).toBe(second);
    expect(first.authority).toBe("memory-session");
    expect(localDatabaseRuntime.acquire).toHaveBeenCalledOnce();
    await first.repository.put(brush(7, { name: "현재 탭 공유 브러시" }));
    await expect(second.repository.getById("brush-00007")).resolves.toMatchObject({
      name: "현재 탭 공유 브러시",
    });

    const compensate = first.compareAndRestoreInstallSnapshot;
    if (!compensate) throw new Error("Expected memory compare-and-restore support");
    const previous = brush(7, { name: "설치 전 브러시", updatedAt: 70 });
    const installed = brush(7, { name: "설치 후보", updatedAt: 71 });
    const newer = brush(7, { name: "사용자 후속 편집", updatedAt: 72 });
    const inserted = brush(8, { name: "새 설치 후보", updatedAt: 80 });
    await first.repository.put(previous);
    await first.repository.put(installed);
    await first.repository.put(inserted);
    await first.repository.put(newer);

    await expect(compensate([
      { id: installed.id, expected: installed, restore: previous },
      { id: inserted.id, expected: inserted, restore: null },
    ])).resolves.toEqual({
      restoredIds: [inserted.id],
      conflictIds: [installed.id],
    });
    await expect(first.repository.getById(installed.id)).resolves.toEqual(newer);
    await expect(first.repository.getById(inserted.id)).resolves.toBeNull();

    await first.repository.put(installed);
    await expect(compensate(
      [{ id: installed.id, expected: installed, restore: previous }],
      [{
        namespace: "creator-pack-receipts",
        key: "brush:pack-1",
        expected: "installed-receipt",
        restore: "previous-receipt",
      }],
    )).resolves.toEqual({
      restoredIds: [],
      conflictIds: ["creator-pack-receipts\u0000brush:pack-1"],
    });
    await expect(first.repository.getById(installed.id)).resolves.toEqual(installed);

    await first.repository.put(previous);
    await expect(compensate([
      { id: installed.id, expected: installed, restore: previous },
    ])).resolves.toEqual({
      restoredIds: [],
      conflictIds: [],
    });
    await expect(first.repository.getById(installed.id)).resolves.toEqual(previous);
  });

  it("retries a failed product open instead of retaining an arbitrary rejection", async () => {
    const database = await openMemoryDatabase();
    localDatabaseRuntime.acquire
      .mockRejectedValueOnce(new Error("worker bootstrap failed"))
      .mockResolvedValueOnce(database);

    await expect(openProductBrushLibraryRepository()).rejects.toThrow(
      "worker bootstrap failed",
    );
    await expect(openProductBrushLibraryRepository()).resolves.toMatchObject({
      authority: "sqlite",
    });
    expect(localDatabaseRuntime.acquire).toHaveBeenCalledTimes(2);
  });

  it("does not let an obsolete failed generation clear a newer product open", async () => {
    const database = await openMemoryDatabase();
    let rejectObsolete!: (reason: unknown) => void;
    localDatabaseRuntime.acquire
      .mockImplementationOnce(() => new Promise<StudioLocalDatabase>((_resolve, reject) => {
        rejectObsolete = reject;
      }))
      .mockResolvedValueOnce(database);

    const obsolete = openProductBrushLibraryRepository();
    resetProductBrushLibraryRepositoryRuntime();
    const current = openProductBrushLibraryRepository();
    rejectObsolete(new Error("obsolete worker failed"));

    await expect(obsolete).rejects.toThrow("obsolete worker failed");
    await expect(current).resolves.toMatchObject({ authority: "sqlite" });
    expect(openProductBrushLibraryRepository()).toBe(current);
    expect(localDatabaseRuntime.acquire).toHaveBeenCalledTimes(2);
  });

  it("discards the legacy envelope by default and leaves no migration marker", async () => {
    const database = await openMemoryDatabase();
    const storage = storageWith([brush(1, { name: "폐기할 내부 데이터" })]);
    const product = await openProductBrushLibraryRepository({
      storage,
      acquireDatabase: async () => database,
    });

    expect(product.authority).toBe("sqlite");
    expect(product.migration).toBeNull();
    expect((await product.repository.query()).items).toEqual([]);
    expect(await database.kvGet(
      BRUSH_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
      BRUSH_LIBRARY_LEGACY_MIGRATION_KEY,
    )).toBeNull();
  });

  it("imports only with explicit developer policy and never overwrites a newer SQLite row", async () => {
    const database = await openMemoryDatabase();
    const legacy = brush(1, { name: "레거시 이름" });
    const storage = storageWith([legacy, brush(2)]);
    const product = await openProductBrushLibraryRepository({
      storage,
      acquireDatabase: async () => database,
      legacyDataPolicy: "import-explicit",
      now: () => 123,
    });
    expect(product.authority).toBe("sqlite");
    expect(product.migration).toEqual({
      status: "imported",
      sourceCount: 2,
      insertedCount: 2,
    });
    await product.repository.put({ ...legacy, name: "SQL 최신 이름", updatedAt: 500 });

    const repeated = await migrateLegacyBrushLibraryToSqlite(database, storage, () => 999);
    expect(repeated.status).toBe("already-complete");
    expect((await product.repository.getById(legacy.id))?.name).toBe("SQL 최신 이름");
    expect(await database.kvGet(
      BRUSH_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
      BRUSH_LIBRARY_LEGACY_MIGRATION_KEY,
    )).not.toBeNull();
  });

  it("merges a retried import with insert-if-absent semantics before the marker exists", async () => {
    const database = await openMemoryDatabase();
    const legacy = brush(1, { name: "레거시" });
    const repository = createSqliteBrushLibraryRepository(database);
    await repository.put({ ...legacy, name: "이미 SQL에서 수정", updatedAt: 900 });

    const result = await migrateLegacyBrushLibraryToSqlite(
      database,
      storageWith([legacy, brush(2)]),
      () => 10,
    );
    expect(result).toMatchObject({ sourceCount: 2, insertedCount: 1 });
    expect((await repository.getById(legacy.id))?.name).toBe("이미 SQL에서 수정");
    expect(await repository.getById("brush-00002")).not.toBeNull();
  });

  it("does not mark or overwrite a corrupt or unreadable legacy envelope", async () => {
    const database = await openMemoryDatabase();
    const corrupt: BrushLibraryStorage = {
      getItem: () => "{not-json",
      setItem: vi.fn(),
    };
    await expect(openProductBrushLibraryRepository({
      storage: corrupt,
      acquireDatabase: async () => database,
      legacyDataPolicy: "import-explicit",
    })).rejects.toMatchObject({ code: "corrupt" });
    expect(await database.kvGet(
      BRUSH_LIBRARY_LEGACY_MIGRATION_NAMESPACE,
      BRUSH_LIBRARY_LEGACY_MIGRATION_KEY,
    )).toBeNull();
    expect(await readAllBrushesFromRepository(
      createSqliteBrushLibraryRepository(database),
      32,
    )).toEqual([]);

    const unreadable: BrushLibraryStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: vi.fn(),
    };
    await expect(migrateLegacyBrushLibraryToSqlite(database, unreadable)).rejects
      .toMatchObject({ code: "read-error" });
  });

  it("keeps injected memory-session seams isolated and never touches localStorage", async () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem });
    try {
      const acquireDatabase = vi.fn(
        () => Promise.reject(new SqliteUnavailableError("no OPFS")),
      );
      const product = await openProductBrushLibraryRepository({ acquireDatabase });
      const isolated = await openProductBrushLibraryRepository({ acquireDatabase });

      expect(product.authority).toBe("memory-session");
      expect(isolated).not.toBe(product);
      expect(acquireDatabase).toHaveBeenCalledTimes(2);
      expect((await product.repository.query()).items).toEqual([]);
      await product.repository.put(brush(4, { name: "현재 세션 브러시" }));
      expect((await product.repository.query()).items.map((item) => item.name)).toEqual([
        "현재 세션 브러시",
      ]);
      expect((await isolated.repository.query()).items).toEqual([]);
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the retired V12 localStorage namespace behind an explicit legacy seam", async () => {
    const values = new Map<string, string>([
      [
        BRUSH_LIBRARY_KEY,
        JSON.stringify({
          version: BRUSH_LIBRARY_STORAGE_VERSION,
          brushes: [brush(1, { name: "폐기 대상 레거시" })],
        }),
      ],
      [
        BRUSH_LIBRARY_V12_FALLBACK_KEY,
        JSON.stringify({
          version: BRUSH_LIBRARY_STORAGE_VERSION,
          brushes: [brush(3, { name: "V12 비상 저장" })],
        }),
      ],
    ]);
    const writes: string[] = [];
    const storage: BrushLibraryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        writes.push(key);
        values.set(key, value);
      },
    };
    const fallback = createLegacyV12FallbackBrushLibraryRepository(storage);
    expect((await fallback.query()).items.map((item) => item.name)).toEqual([
      "V12 비상 저장",
    ]);
    await fallback.put(brush(4, { name: "V12 추가" }));
    expect(writes).toEqual([BRUSH_LIBRARY_V12_FALLBACK_KEY]);
    expect(values.get(BRUSH_LIBRARY_KEY)).toContain("폐기 대상 레거시");
    expect(values.get(BRUSH_LIBRARY_V12_FALLBACK_KEY)).toContain("V12 추가");
  });

  it("does not downgrade an arbitrary database failure to memory or localStorage", async () => {
    await expect(openProductBrushLibraryRepository({
      acquireDatabase: () => Promise.reject(new Error("migration exploded")),
    })).rejects.toThrow("migration exploded");
  });
});
