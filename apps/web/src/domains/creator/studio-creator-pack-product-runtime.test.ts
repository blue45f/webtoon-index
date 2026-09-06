import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BRUSH_LIBRARY_KEY } from "./brush/studio-brush-library";
import {
  openProductBrushLibraryRepository,
  type ProductBrushLibraryRepository,
} from "./brush/studio-brush-library-sqlite-repository";
import {
  openProductFilterLibraryRepository,
  type ProductFilterLibraryRepository,
} from "./filter/studio-filter-library-sqlite-repository";
import {
  STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY,
  type StudioCreatorPackStorage,
} from "./studio-creator-filter-preset-reader";
import {
  STUDIO_CREATOR_PACK_CATALOG,
  type StudioCreatorPackDefinition,
} from "./studio-creator-pack-catalog";
import {
  STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
  StudioCreatorPackInstallStaleError,
  inspectStudioCreatorPackInstallStateProduct,
  installStudioCreatorPackProduct,
  uninstallStudioCreatorPackProduct,
} from "./studio-creator-pack-product-runtime";
import {
  openStudioLocalDatabase,
  type StudioLocalDatabase,
  type StudioSqliteApiHandle,
} from "./studio-local-database";
import { STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY } from "./studio-marketplace-packages";
import { PALETTE_LIBRARY_KEY } from "./studio-palette-library";
import {
  STUDIO_PALETTE_SQLITE_KEY,
  STUDIO_PALETTE_SQLITE_NAMESPACE,
  createStudioPaletteSqliteRepository,
  type StudioPaletteSqliteRepository,
} from "./studio-palette-sqlite-repository";

import {
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
  type CreatorMarketplaceInstallReceiptStorage,
} from "@/shared/lib/creator-marketplace-install-receipt";

let sqlite3: StudioSqliteApiHandle;
const opened: StudioLocalDatabase[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of opened) await database.close();
});

async function openDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  opened.push(database);
  return database;
}

function storageWithOldData(): StudioCreatorPackStorage & { values: Map<string, string> } {
  const values = new Map<string, string>([
    [
      STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY,
      JSON.stringify([{
        id: "old-do-not-revive",
        packageId: "old",
        entryId: "old",
        name: "폐기 대상",
        engine: "vignette",
        values: { darkness: 35, size: 45, roundness: 100, feather: 60 },
        installedAt: 1,
        updatedAt: 1,
      }]),
    ],
    [BRUSH_LIBRARY_KEY, JSON.stringify({ version: 1, brushes: [] })],
    [PALETTE_LIBRARY_KEY, JSON.stringify([{
      id: "legacy-palette-do-not-import",
      name: "폐기 대상 팔레트",
      createdAt: 1,
      updatedAt: 1,
      colors: ["#000000"],
    }])],
    [STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY, "legacy-marker-must-not-be-authority"],
  ]);
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

function storageThatMustNotBeRead(): StudioCreatorPackStorage {
  return {
    getItem: () => {
      throw new Error("legacy localStorage read");
    },
    setItem: () => {
      throw new Error("legacy localStorage write");
    },
    removeItem: () => {
      throw new Error("legacy localStorage delete");
    },
  };
}

function palettePack() {
  return STUDIO_CREATOR_PACK_CATALOG.find(
    (candidate) => candidate.metadata.kind === "palette",
  )!;
}

function paletteRepository(
  database: StudioLocalDatabase,
): StudioPaletteSqliteRepository {
  return createStudioPaletteSqliteRepository({
    acquireDatabase: () => Promise.resolve(database),
  });
}

function faultingDatabase(
  database: StudioLocalDatabase,
  shouldFail: (operation: "set" | "delete", namespace: string, key: string) => boolean,
): StudioLocalDatabase {
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property === "kvSet") {
        return async (namespace: string, key: string, value: string) => {
          if (shouldFail("set", namespace, key)) throw new Error("injected receipt set failure");
          await target.kvSet(namespace, key, value);
        };
      }
      if (property === "kvDelete") {
        return async (namespace: string, key: string) => {
          if (shouldFail("delete", namespace, key)) {
            throw new Error("injected receipt delete failure");
          }
          await target.kvDelete(namespace, key);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function communityRelease(
  pack: StudioCreatorPackDefinition,
  version = "1.0.0",
  fingerprint = "d".repeat(64),
): StudioCreatorPackDefinition {
  return {
    ...pack,
    metadata: {
      ...pack.metadata,
      id: `community:${"c".repeat(64)}`,
      version,
      packageFingerprint: fingerprint,
    },
  };
}

function tracedInstallReceiptStorage(events: string[]): CreatorMarketplaceInstallReceiptStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      events.push("receipt-write");
      values.set(key, value);
    },
    removeItem: (key) => {
      events.push("receipt-remove");
      values.delete(key);
    },
  };
}

describe("Creator Pack product SQLite authority", () => {
  it("publishes the lightweight Market receipt only after install/update commits and removes it after uninstall", async () => {
    const database = await openDatabase();
    const product = await openProductFilterLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const source = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "filter",
    )!;
    const firstRelease = communityRelease(source);
    const events: string[] = [];
    const installReceiptStorage = tracedInstallReceiptStorage(events);
    const tracedProduct: ProductFilterLibraryRepository = {
      ...product,
      repository: {
        ...product.repository,
        putMany: async (presets) => {
          const result = await product.repository.putMany(presets);
          events.push("product-install-commit");
          return result;
        },
        deleteMany: async (ids) => {
          const result = await product.repository.deleteMany(ids);
          events.push("product-uninstall-commit");
          return result;
        },
      },
    };
    const options = {
      acquireFilterRepository: () => Promise.resolve(tracedProduct),
      installReceiptStorage,
    };

    expect((await installStudioCreatorPackProduct(firstRelease, options)).status)
      .toBe("installed");
    expect(events).toEqual(["product-install-commit", "receipt-write"]);
    expect(installReceiptStorage.values.get(
      CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
    )).toContain('"packageVersion":"1.0.0"');

    events.length = 0;
    const nextRelease = communityRelease(source, "1.1.0", "e".repeat(64));
    expect((await installStudioCreatorPackProduct(nextRelease, options)).status)
      .toBe("installed");
    expect(events).toEqual(["product-install-commit", "receipt-write"]);
    expect(installReceiptStorage.values.get(
      CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
    )).toContain('"packageVersion":"1.1.0"');

    events.length = 0;
    expect((await uninstallStudioCreatorPackProduct(nextRelease, options)).status)
      .toBe("uninstalled");
    expect(events).toEqual(["product-uninstall-commit", "receipt-remove"]);
    expect(installReceiptStorage.values.has(
      CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
    )).toBe(false);
  });

  it("does not publish a Market receipt for failed, conflicting, bundled, or stale installs", async () => {
    const database = await openDatabase();
    const product = await openProductFilterLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const filter = communityRelease(STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "filter",
    )!);
    const events: string[] = [];
    const installReceiptStorage = tracedInstallReceiptStorage(events);

    const failedProduct: ProductFilterLibraryRepository = {
      ...product,
      repository: {
        ...product.repository,
        putMany: async () => {
          throw new Error("injected install rollback");
        },
      },
    };
    expect((await installStudioCreatorPackProduct(filter, {
      acquireFilterRepository: () => Promise.resolve(failedProduct),
      installReceiptStorage,
    })).status).toBe("storage-error");
    expect(events).toEqual([]);

    await expect(installStudioCreatorPackProduct(filter, {
      acquireFilterRepository: () => Promise.resolve(product),
      installReceiptStorage,
      isInstallCurrent: () => false,
    })).rejects.toBeInstanceOf(StudioCreatorPackInstallStaleError);
    expect(events).toEqual([]);

    const bundled = communityRelease(STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.entries.every((entry) => entry.delivery.mode === "builtin-ref"),
    )!);
    expect((await installStudioCreatorPackProduct(bundled, {
      installReceiptStorage,
    })).status).toBe("bundled");
    expect(events).toEqual([]);

    expect((await installStudioCreatorPackProduct(filter, {
      acquireFilterRepository: () => Promise.resolve(product),
      installReceiptStorage: null,
    })).status).toBe("installed");
    const conflicting = communityRelease(filter, "1.0.0", "f".repeat(64));
    expect((await installStudioCreatorPackProduct(conflicting, {
      acquireFilterRepository: () => Promise.resolve(product),
      installReceiptStorage,
    })).status).toBe("conflict");
    expect(events).toEqual([]);
  });

  it("installs and removes brush packs through the uncapped SQLite catalog", async () => {
    const database = await openDatabase();
    const storage = storageWithOldData();
    const product = await openProductBrushLibraryRepository({
      storage,
      acquireDatabase: () => Promise.resolve(database),
    });
    const acquireBrushRepository = (): Promise<ProductBrushLibraryRepository> =>
      Promise.resolve(product);
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush"
        && candidate.entries.every((entry) => entry.delivery.mode === "portable-json"),
    )!;
    const options = {
      storage,
      acquireBrushRepository,
      acquireDatabase: () => Promise.resolve(database),
      now: () => 7_000,
    };

    expect(await inspectStudioCreatorPackInstallStateProduct(pack, options)).toBe("available");
    await database.kvSet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
      JSON.stringify({
        version: 1,
        packageId: pack.metadata.id,
        packageVersion: pack.metadata.version,
        packageFingerprint: pack.metadata.packageFingerprint,
        kind: "brush",
        updatedAt: 6_999,
      }),
    );
    expect(await inspectStudioCreatorPackInstallStateProduct(pack, options))
      .toBe("repair-required");
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const installed = await installStudioCreatorPackProduct(pack, options);
    expect(installed.status).toBe("installed");
    expect(installed.message).toContain("OPFS SQLite");
    const page = await product.repository.query({ limit: 100 });
    expect(page.totalCount).toBe(pack.entries.length);
    expect(page.items.every((brush) => brush.id.startsWith(`creator-pack:${pack.metadata.id}:`)))
      .toBe(true);
    expect(await inspectStudioCreatorPackInstallStateProduct(pack, options)).toBe("installed");

    await database.kvSet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
      "{corrupt",
    );
    await expect(inspectStudioCreatorPackInstallStateProduct(pack, options))
      .rejects.toThrow("receipt is corrupt");
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const repaired = await installStudioCreatorPackProduct(pack, options);
    expect(repaired.status).toBe("installed");

    const removed = await uninstallStudioCreatorPackProduct(pack, options);
    expect(removed.status).toBe("uninstalled");
    expect((await product.repository.query()).totalCount).toBe(0);
    expect(storage.values.has(BRUSH_LIBRARY_KEY)).toBe(true);
  });

  it("uses palette SQLite rows and a receipt as the only product install authority", async () => {
    const database = await openDatabase();
    const storage = storageWithOldData();
    const repository = paletteRepository(database);
    const pack = palettePack();
    const options = {
      storage,
      acquirePaletteRepository: () => repository,
      now: () => 9_000,
    };

    expect(await inspectStudioCreatorPackInstallStateProduct(pack, options)).toBe("available");
    const installed = await installStudioCreatorPackProduct(pack, options);
    expect(installed).toMatchObject({
      status: "installed",
      installedCount: pack.entries.length,
    });
    expect(installed.message).toContain("OPFS SQLite");
    expect((await repository.list()).map((palette) => palette.id)).toEqual(
      pack.entries.map((entry) => `creator-pack:${pack.metadata.id}:${entry.id}`),
    );
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `palette:${pack.metadata.id}`,
    )).toContain('"kind":"palette"');
    expect(await inspectStudioCreatorPackInstallStateProduct(pack, options)).toBe("installed");

    const first = (await repository.list())[0]!;
    await repository.save({ ...first, colors: ["#ffffff"] });
    expect(await inspectStudioCreatorPackInstallStateProduct(pack, options)).toBe("repair-required");
    expect((await installStudioCreatorPackProduct(pack, options)).status).toBe("installed");
    expect(await inspectStudioCreatorPackInstallStateProduct(pack, options)).toBe("installed");

    const removed = await uninstallStudioCreatorPackProduct(pack, options);
    expect(removed).toMatchObject({
      status: "uninstalled",
      installedCount: pack.entries.length,
    });
    expect(await repository.list()).toEqual([]);
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `palette:${pack.metadata.id}`,
    )).toBeNull();
    expect(storage.values.get(PALETTE_LIBRARY_KEY)).toContain("legacy-palette-do-not-import");
    expect(storage.values.get(STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY))
      .toBe("legacy-marker-must-not-be-authority");
  });

  it("never reads a legacy palette or marketplace marker on the product palette path", async () => {
    const database = await openDatabase();
    const repository = paletteRepository(database);
    const pack = palettePack();
    const options = {
      storage: storageThatMustNotBeRead(),
      acquirePaletteRepository: () => repository,
      now: () => 10_000,
    };

    await expect(inspectStudioCreatorPackInstallStateProduct(pack, options))
      .resolves.toBe("available");
    await expect(installStudioCreatorPackProduct(pack, options))
      .resolves.toMatchObject({ status: "installed" });
    await expect(uninstallStudioCreatorPackProduct(pack, options))
      .resolves.toMatchObject({ status: "uninstalled" });
  });

  it("rolls palette rows back when the SQLite receipt write fails", async () => {
    const database = await openDatabase();
    const pack = palettePack();
    let failOnce = true;
    const failing = faultingDatabase(database, (operation, namespace, key) => {
      const matches = operation === "set"
        && namespace === STUDIO_CREATOR_PACK_SQLITE_NAMESPACE
        && key === `palette:${pack.metadata.id}`
        && failOnce;
      if (matches) failOnce = false;
      return matches;
    });
    const repository = paletteRepository(failing);

    const result = await installStudioCreatorPackProduct(pack, {
      storage: storageThatMustNotBeRead(),
      acquirePaletteRepository: () => repository,
      now: () => 11_000,
    });
    expect(result.status).toBe("storage-error");
    expect(await repository.list()).toEqual([]);
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `palette:${pack.metadata.id}`,
    )).toBeNull();
  });

  it("rolls palette rows and receipt back when receipt removal fails", async () => {
    const database = await openDatabase();
    const pack = palettePack();
    const initialRepository = paletteRepository(database);
    await installStudioCreatorPackProduct(pack, {
      acquirePaletteRepository: () => initialRepository,
      now: () => 12_000,
    });
    const before = await initialRepository.list();
    const beforeReceipt = await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `palette:${pack.metadata.id}`,
    );
    let failOnce = true;
    const failing = faultingDatabase(database, (operation, namespace, key) => {
      const matches = operation === "delete"
        && namespace === STUDIO_CREATOR_PACK_SQLITE_NAMESPACE
        && key === `palette:${pack.metadata.id}`
        && failOnce;
      if (matches) failOnce = false;
      return matches;
    });
    const repository = paletteRepository(failing);

    const result = await uninstallStudioCreatorPackProduct(pack, {
      storage: storageThatMustNotBeRead(),
      acquirePaletteRepository: () => repository,
    });
    expect(result.status).toBe("storage-error");
    expect(await repository.list()).toEqual(before);
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `palette:${pack.metadata.id}`,
    )).toBe(beforeReceipt);
  });

  it("installs, inspects and removes filter packs through SQLite without reviving v1 data", async () => {
    const database = await openDatabase();
    const storage = storageWithOldData();
    const product = await openProductFilterLibraryRepository({
      storage,
      acquireDatabase: () => Promise.resolve(database),
    });
    const acquireFilterRepository = () => Promise.resolve(product);
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "filter",
    )!;

    expect(await inspectStudioCreatorPackInstallStateProduct(pack, {
      storage,
      acquireFilterRepository,
    })).toBe("available");
    const installed = await installStudioCreatorPackProduct(pack, {
      storage,
      acquireFilterRepository,
      now: () => 5_000,
    });
    expect(installed.status).toBe("installed");
    expect(installed.message).toContain("OPFS SQLite");
    const page = await product.repository.query({ limit: 100 });
    expect(page.totalCount).toBe(pack.entries.length);
    expect(page.items.some((preset) => preset.id === "old-do-not-revive")).toBe(false);
    expect(page.items.every((preset) =>
      preset.packageVersion === pack.metadata.version
      && preset.packageFingerprint === pack.metadata.packageFingerprint,
    )).toBe(true);
    expect(await inspectStudioCreatorPackInstallStateProduct(pack, {
      storage,
      acquireFilterRepository,
    })).toBe("installed");

    const removed = await uninstallStudioCreatorPackProduct(pack, {
      storage,
      acquireFilterRepository,
    });
    expect(removed.status).toBe("uninstalled");
    expect((await product.repository.query()).totalCount).toBe(0);
    expect(storage.values.has(STUDIO_CREATOR_FILTER_PRESET_LIBRARY_KEY)).toBe(true);
  });

  it("rolls a brush pack back when its SQLite write resolves after the install becomes stale", async () => {
    const database = await openDatabase();
    const product = await openProductBrushLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush"
        && candidate.entries.every((entry) => entry.delivery.mode === "portable-json"),
    )!;
    await installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(database),
      now: () => 12_000,
    });
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const beforePage = await product.repository.query({ limit: 100 });
    const beforeReceipt = await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const writeCommitted = deferred<void>();
    const releaseWrite = deferred<void>();
    let delayFirstWrite = true;
    const delayedProduct: ProductBrushLibraryRepository = {
      ...product,
      repository: {
        ...product.repository,
        putMany: async (brushes) => {
          const result = await product.repository.putMany(brushes);
          if (delayFirstWrite) {
            delayFirstWrite = false;
            writeCommitted.resolve();
            await releaseWrite.promise;
          }
          return result;
        },
      },
    };
    let current = true;

    const installation = installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(delayedProduct),
      acquireDatabase: () => Promise.resolve(database),
      isInstallCurrent: () => current,
      now: () => 13_000,
    });
    await writeCommitted.promise;
    current = false;
    releaseWrite.resolve();

    await expect(installation).rejects.toBeInstanceOf(StudioCreatorPackInstallStaleError);
    expect(await product.repository.query({ limit: 100 })).toEqual(beforePage);
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    )).toBe(beforeReceipt);
  });

  it("rolls brush rows back when the receipt write fails after putMany commits", async () => {
    const database = await openDatabase();
    const product = await openProductBrushLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush"
        && candidate.entries.every((entry) => entry.delivery.mode === "portable-json"),
    )!;
    await installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(database),
      now: () => 12_100,
    });
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const beforePage = await product.repository.query({ limit: 100 });
    let failOnce = true;
    const failingDatabase = faultingDatabase(database, (operation, namespace, key) => {
      const matches = operation === "set"
        && namespace === STUDIO_CREATOR_PACK_SQLITE_NAMESPACE
        && key === `brush:${pack.metadata.id}`
        && failOnce;
      if (matches) failOnce = false;
      return matches;
    });

    const result = await installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(failingDatabase),
      now: () => 12_200,
    });

    expect(result.status).toBe("storage-error");
    expect(result.message).toContain("injected receipt set failure");
    expect(await product.repository.query({ limit: 100 })).toEqual(beforePage);
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    )).toBeNull();
  });

  it("preserves a newer brush edit while compensating a failed receipt write", async () => {
    const database = await openDatabase();
    const product = await openProductBrushLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush"
        && candidate.entries.every((entry) => entry.delivery.mode === "portable-json"),
    )!;
    await installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(database),
      now: () => 12_300,
    });
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const before = await Promise.all(pack.entries.map((entry) =>
      product.repository.getById(`creator-pack:${pack.metadata.id}:${entry.id}`)));
    const editedId = `creator-pack:${pack.metadata.id}:${pack.entries[0]!.id}`;
    let newerBrush = before[0];
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            if (
              namespace === STUDIO_CREATOR_PACK_SQLITE_NAMESPACE
              && key === `brush:${pack.metadata.id}`
            ) {
              const installedCandidate = await product.repository.getById(editedId);
              if (!installedCandidate) throw new Error("Expected the installed brush candidate");
              newerBrush = {
                ...installedCandidate,
                name: `${installedCandidate.name} 영수증 실패 중 사용자 편집`,
                updatedAt: 12_500,
              };
              await product.repository.put(newerBrush);
              throw new Error("injected receipt set failure after user edit");
            }
            await target.kvSet(namespace, key, value);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const result = await installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(failingDatabase),
      now: () => 12_400,
    });

    expect(result.status).toBe("storage-error");
    expect(await product.repository.getById(editedId)).toEqual(newerBrush);
    for (let index = 1; index < pack.entries.length; index += 1) {
      expect(await product.repository.getById(
        `creator-pack:${pack.metadata.id}:${pack.entries[index]!.id}`,
      )).toEqual(before[index]);
    }
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    )).toBeNull();
  });

  it("restores brush rows and receipt in one CAS after the receipt commit becomes stale", async () => {
    const database = await openDatabase();
    const product = await openProductBrushLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush"
        && candidate.entries.every((entry) => entry.delivery.mode === "portable-json"),
    )!;
    await installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(database),
      now: () => 12_500,
    });
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const beforePage = await product.repository.query({ limit: 100 });
    const receiptWriteCommitted = deferred<void>();
    const releaseReceiptWrite = deferred<void>();
    let delayReceiptWrite = true;
    const delayedDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            if (
              delayReceiptWrite
              && namespace === STUDIO_CREATOR_PACK_SQLITE_NAMESPACE
              && key === `brush:${pack.metadata.id}`
            ) {
              delayReceiptWrite = false;
              receiptWriteCommitted.resolve();
              await releaseReceiptWrite.promise;
            }
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let current = true;

    const installation = installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(delayedDatabase),
      isInstallCurrent: () => current,
      now: () => 13_500,
    });
    await receiptWriteCommitted.promise;
    current = false;
    releaseReceiptWrite.resolve();

    await expect(installation).rejects.toBeInstanceOf(StudioCreatorPackInstallStaleError);
    expect(await product.repository.query({ limit: 100 })).toEqual(beforePage);
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    )).toBeNull();
  });

  it("rolls a filter pack back when its SQLite write resolves after the install becomes stale", async () => {
    const database = await openDatabase();
    const product = await openProductFilterLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "filter",
    )!;
    await installStudioCreatorPackProduct(pack, {
      acquireFilterRepository: () => Promise.resolve(product),
      now: () => 13_000,
    });
    await product.repository.delete(
      `creator-pack:${pack.metadata.id}:${pack.entries[0]!.id}`,
    );
    const beforePage = await product.repository.query({ limit: 100 });
    const writeCommitted = deferred<void>();
    const releaseWrite = deferred<void>();
    let delayFirstWrite = true;
    const delayedProduct: ProductFilterLibraryRepository = {
      ...product,
      repository: {
        ...product.repository,
        putMany: async (presets) => {
          const result = await product.repository.putMany(presets);
          if (delayFirstWrite) {
            delayFirstWrite = false;
            writeCommitted.resolve();
            await releaseWrite.promise;
          }
          return result;
        },
      },
    };
    let current = true;

    const installation = installStudioCreatorPackProduct(pack, {
      acquireFilterRepository: () => Promise.resolve(delayedProduct),
      isInstallCurrent: () => current,
      now: () => 14_000,
    });
    await writeCommitted.promise;
    current = false;
    releaseWrite.resolve();

    await expect(installation).rejects.toBeInstanceOf(StudioCreatorPackInstallStaleError);
    expect(await product.repository.query({ limit: 100 })).toEqual(beforePage);
  });

  it("preserves a newer brush edit while compensating a stale in-flight install", async () => {
    const database = await openDatabase();
    const product = await openProductBrushLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush"
        && candidate.entries.every((entry) => entry.delivery.mode === "portable-json"),
    )!;
    await installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(database),
      now: () => 17_000,
    });
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const before = await Promise.all(pack.entries.map((entry) =>
      product.repository.getById(`creator-pack:${pack.metadata.id}:${entry.id}`)));
    const writeCommitted = deferred<void>();
    const releaseWrite = deferred<void>();
    let delayFirstWrite = true;
    const delayedProduct: ProductBrushLibraryRepository = {
      ...product,
      repository: {
        ...product.repository,
        putMany: async (brushes) => {
          const result = await product.repository.putMany(brushes);
          if (delayFirstWrite) {
            delayFirstWrite = false;
            writeCommitted.resolve();
            await releaseWrite.promise;
          }
          return result;
        },
      },
    };
    let current = true;
    const installation = installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(delayedProduct),
      acquireDatabase: () => Promise.resolve(database),
      isInstallCurrent: () => current,
      now: () => 18_000,
    });
    await writeCommitted.promise;
    const editedId = `creator-pack:${pack.metadata.id}:${pack.entries[0]!.id}`;
    const installedCandidate = await product.repository.getById(editedId);
    if (!installedCandidate) throw new Error("Expected the delayed brush candidate");
    const newerBrush = {
      ...installedCandidate,
      name: `${installedCandidate.name} 사용자 편집`,
      updatedAt: 18_500,
    };
    await product.repository.put(newerBrush);
    current = false;
    releaseWrite.resolve();

    await expect(installation).rejects.toBeInstanceOf(StudioCreatorPackInstallStaleError);
    expect(await product.repository.getById(editedId)).toEqual(newerBrush);
    for (let index = 1; index < pack.entries.length; index += 1) {
      expect(await product.repository.getById(
        `creator-pack:${pack.metadata.id}:${pack.entries[index]!.id}`,
      )).toEqual(before[index]);
    }
  });

  it("keeps a brush UI write that is queued after the atomic compensation RPC", async () => {
    const database = await openDatabase();
    const product = await openProductBrushLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const atomicCompensation = product.compareAndRestoreInstallSnapshot;
    if (!atomicCompensation) throw new Error("Expected atomic brush compensation");
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "brush"
        && candidate.entries.every((entry) => entry.delivery.mode === "portable-json"),
    )!;
    await installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(product),
      acquireDatabase: () => Promise.resolve(database),
      now: () => 21_000,
    });
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `brush:${pack.metadata.id}`,
    );
    const before = await Promise.all(pack.entries.map((entry) =>
      product.repository.getById(`creator-pack:${pack.metadata.id}:${entry.id}`)));
    const installWriteCommitted = deferred<void>();
    const releaseInstallWrite = deferred<void>();
    const casCommitted = deferred<void>();
    const releaseCasResponse = deferred<void>();
    let delayFirstWrite = true;
    const delayedProduct: ProductBrushLibraryRepository = {
      ...product,
      repository: {
        ...product.repository,
        putMany: async (brushes) => {
          const result = await product.repository.putMany(brushes);
          if (delayFirstWrite) {
            delayFirstWrite = false;
            installWriteCommitted.resolve();
            await releaseInstallWrite.promise;
          }
          return result;
        },
      },
      compareAndRestoreInstallSnapshot: async (entries, sidecars) => {
        const result = await atomicCompensation(entries, sidecars);
        casCommitted.resolve();
        await releaseCasResponse.promise;
        return result;
      },
    };
    let current = true;
    const installation = installStudioCreatorPackProduct(pack, {
      acquireBrushRepository: () => Promise.resolve(delayedProduct),
      acquireDatabase: () => Promise.resolve(database),
      isInstallCurrent: () => current,
      now: () => 22_000,
    });
    await installWriteCommitted.promise;
    const editedId = `creator-pack:${pack.metadata.id}:${pack.entries[0]!.id}`;
    const installedCandidate = await product.repository.getById(editedId);
    if (!installedCandidate) throw new Error("Expected the delayed brush candidate");
    const queuedUserEdit = {
      ...installedCandidate,
      name: `${installedCandidate.name} CAS 이후 편집`,
      updatedAt: 22_500,
    };

    current = false;
    releaseInstallWrite.resolve();
    await casCommitted.promise;
    await product.repository.put(queuedUserEdit);
    releaseCasResponse.resolve();

    await expect(installation).rejects.toBeInstanceOf(StudioCreatorPackInstallStaleError);
    expect(await product.repository.getById(editedId)).toEqual(queuedUserEdit);
    for (let index = 1; index < pack.entries.length; index += 1) {
      expect(await product.repository.getById(
        `creator-pack:${pack.metadata.id}:${pack.entries[index]!.id}`,
      )).toEqual(before[index]);
    }
  });

  it("preserves a newer filter edit while compensating a stale in-flight install", async () => {
    const database = await openDatabase();
    const product = await openProductFilterLibraryRepository({
      acquireDatabase: () => Promise.resolve(database),
    });
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "filter",
    )!;
    await installStudioCreatorPackProduct(pack, {
      acquireFilterRepository: () => Promise.resolve(product),
      now: () => 19_000,
    });
    const missingId = `creator-pack:${pack.metadata.id}:${pack.entries.at(-1)!.id}`;
    await product.repository.delete(missingId);
    const before = await Promise.all(pack.entries.map((entry) =>
      product.repository.getById(`creator-pack:${pack.metadata.id}:${entry.id}`)));
    const writeCommitted = deferred<void>();
    const releaseWrite = deferred<void>();
    let delayFirstWrite = true;
    const delayedProduct: ProductFilterLibraryRepository = {
      ...product,
      repository: {
        ...product.repository,
        putMany: async (presets) => {
          const result = await product.repository.putMany(presets);
          if (delayFirstWrite) {
            delayFirstWrite = false;
            writeCommitted.resolve();
            await releaseWrite.promise;
          }
          return result;
        },
      },
    };
    let current = true;
    const installation = installStudioCreatorPackProduct(pack, {
      acquireFilterRepository: () => Promise.resolve(delayedProduct),
      isInstallCurrent: () => current,
      now: () => 20_000,
    });
    await writeCommitted.promise;
    const editedId = `creator-pack:${pack.metadata.id}:${pack.entries[0]!.id}`;
    const installedCandidate = await product.repository.getById(editedId);
    if (!installedCandidate) throw new Error("Expected the delayed filter candidate");
    const newerPreset = {
      ...installedCandidate,
      name: `${installedCandidate.name} 사용자 편집`,
      favorite: !installedCandidate.favorite,
      updatedAt: 20_500,
    };
    await product.repository.put(newerPreset);
    current = false;
    releaseWrite.resolve();

    await expect(installation).rejects.toBeInstanceOf(StudioCreatorPackInstallStaleError);
    expect(await product.repository.getById(editedId)).toEqual(newerPreset);
    expect(await product.repository.getById(missingId)).toBeNull();
    for (let index = 1; index < pack.entries.length - 1; index += 1) {
      expect(await product.repository.getById(
        `creator-pack:${pack.metadata.id}:${pack.entries[index]!.id}`,
      )).toEqual(before[index]);
    }
  });

  it("rolls palette rows and their sidecar back when commitBatch becomes stale after its first write", async () => {
    const database = await openDatabase();
    const initialRepository = paletteRepository(database);
    const pack = palettePack();
    await installStudioCreatorPackProduct(pack, {
      acquirePaletteRepository: () => initialRepository,
      now: () => 15_000,
    });
    await database.kvDelete(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `palette:${pack.metadata.id}`,
    );
    const beforeItems = await initialRepository.list();
    const beforeReceipt = await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `palette:${pack.metadata.id}`,
    );
    const writeCommitted = deferred<void>();
    const releaseWrite = deferred<void>();
    let delayNextLibraryWrite = true;
    const delayedDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            if (
              delayNextLibraryWrite
              && namespace === STUDIO_PALETTE_SQLITE_NAMESPACE
              && key === STUDIO_PALETTE_SQLITE_KEY
            ) {
              delayNextLibraryWrite = false;
              writeCommitted.resolve();
              await releaseWrite.promise;
            }
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const delayedRepository = paletteRepository(delayedDatabase);
    let current = true;

    const installation = installStudioCreatorPackProduct(pack, {
      acquirePaletteRepository: () => delayedRepository,
      isInstallCurrent: () => current,
      now: () => 16_000,
    });
    await writeCommitted.promise;
    current = false;
    releaseWrite.resolve();

    await expect(installation).rejects.toBeInstanceOf(StudioCreatorPackInstallStaleError);
    expect(await initialRepository.list()).toEqual(beforeItems);
    expect(await database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      `palette:${pack.metadata.id}`,
    )).toBe(beforeReceipt);
  });

  it("surfaces repository failures as storage errors without invoking another authority", async () => {
    const pack = STUDIO_CREATOR_PACK_CATALOG.find(
      (candidate) => candidate.metadata.kind === "filter",
    )!;
    let acquisitionCount = 0;
    const acquireFilterRepository = async (): Promise<ProductFilterLibraryRepository> => {
      acquisitionCount += 1;
      throw new Error("sqlite-corrupt");
    };
    const result = await installStudioCreatorPackProduct(pack, {
      acquireFilterRepository,
    });
    expect(result.status).toBe("storage-error");
    expect(result.message).toContain("sqlite-corrupt");
    expect(acquisitionCount).toBe(1);
  });
});
