import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_STUDIO_BRUSH_SNAPSHOT } from "./brush/studio-brush-library";
import {
  openProductBrushLibraryRepository,
  type ProductBrushLibraryRepository,
} from "./brush/studio-brush-library-sqlite-repository";
import {
  openProductFilterLibraryRepository,
  type ProductFilterLibraryRepository,
} from "./filter/studio-filter-library-sqlite-repository";
import { projectCreatorMarketplaceRecordToStudioPack } from "./studio-community-marketplace";
import {
  STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
  studioCreatorPackReceiptKey,
} from "./studio-community-pack-legacy-migration";
import {
  inspectStudioCreatorPackInstallStateProduct,
  installStudioCreatorPackProduct,
  uninstallStudioCreatorPackProduct,
  type StudioCreatorPackProductRuntimeOptions,
} from "./studio-creator-pack-product-runtime";
import {
  openStudioLocalDatabase,
  type StudioLocalDatabase,
  type StudioSqliteApiHandle,
} from "./studio-local-database";
import {
  createStudioPaletteSqliteRepository,
  type StudioPaletteSqliteRepository,
} from "./studio-palette-sqlite-repository";

import type { StudioCreatorPackDefinition } from "./studio-creator-pack-catalog";
import type {
  CreatorMarketplaceJsonValue,
  CreatorMarketplaceResourceIdentity,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
  type CreatorMarketplaceInstallReceiptStorage,
} from "@/shared/lib/creator-marketplace-install-receipt";
import { creatorMarketplaceJsonByteSize } from "@/shared/lib/creator-marketplace-resource-contract";

type Kind = "brush" | "filter" | "palette";

let sqlite3: StudioSqliteApiHandle;
const opened: StudioLocalDatabase[] = [];

beforeAll(async () => {
  const module = await import("@sqlite.org/sqlite-wasm");
  sqlite3 = (await module.default()) as unknown as StudioSqliteApiHandle;
});

afterAll(async () => {
  for (const database of opened) await database.close();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function openDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    loadSqlite: () => Promise.resolve(sqlite3),
  });
  opened.push(database);
  return database;
}

function definition(kind: Kind, index: number): Record<string, CreatorMarketplaceJsonValue> {
  if (kind === "brush") {
    return {
      snapshot: {
        ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
        strokeWidth: DEFAULT_STUDIO_BRUSH_SNAPSHOT.strokeWidth + index,
      } as unknown as CreatorMarketplaceJsonValue,
    };
  }
  if (kind === "filter") {
    return {
      engine: "vignette",
      values: {
        darkness: 35 + index,
        size: 45,
        roundness: 100,
        feather: 60,
      },
    };
  }
  return { colors: index === 0 ? ["#112233", "#abcdef"] : ["#445566"] };
}

function resource(
  kind: Kind,
  options: {
    readonly id?: string;
    readonly version?: string;
    readonly fingerprint?: string;
    readonly entries?: number;
    readonly packageId?: string;
    readonly publisherId?: string;
  } = {},
): CreatorMarketplaceResourceRecord {
  const runtime = {
    brush: "studio-brush-v1",
    filter: "studio-filter-v1",
    palette: "studio-palette-v1",
  } as const;
  const mediaType = {
    brush: "application/vnd.toonspectrum.brush+json",
    filter: "application/vnd.toonspectrum.filter+json",
    palette: "application/vnd.toonspectrum.palette+json",
  } as const;
  const count = options.entries ?? 1;
  return {
    schemaVersion: 1,
    id: options.id ?? "123e4567-e89b-42d3-a456-426614174000",
    packageId: options.packageId ?? `community/${kind}/migration-fixture`,
    name: `${kind} migration fixture`,
    description: "legacy migration fixture",
    kind,
    resourceVersion: options.version ?? "1.0.0",
    minimumStudioVersion: "1.0.0",
    tags: [kind],
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: ["canvas2d"] },
    entries: Array.from({ length: count }, (_, index) => {
      const payload = {
          schemaVersion: 1,
          resourceKind: kind,
          runtime: runtime[kind],
          definition: definition(kind, index),
      } as const;
      return {
        id: `${kind}/entry-${index + 1}`,
        kind,
        name: `${kind} entry ${index + 1}`,
        delivery: {
          mode: "portable-json" as const,
          mediaType: mediaType[kind],
          payload,
          byteSize: creatorMarketplaceJsonByteSize(payload),
          sha256: (index === 0 ? "a" : "c").repeat(64),
        },
      };
    }),
    manifestHash: options.fingerprint ?? "b".repeat(64),
    manifestByteSize: 500,
    publisher: {
      id: options.publisherId ?? "migration-artist",
      name: "Migration Artist",
      avatar: null,
    },
    createdAt: "2026-07-26T01:00:00.000Z",
    updatedAt: "2026-07-26T01:00:00.000Z",
    isOwner: false,
    access: "free",
  };
}

function identity(
  record: CreatorMarketplaceResourceRecord,
  availability: CreatorMarketplaceResourceIdentity["availability"] = "listed",
): CreatorMarketplaceResourceIdentity {
  return {
    id: record.id,
    publisherId: record.publisher.id,
    packageId: record.packageId,
    kind: record.kind,
    availability,
  };
}

function projected(record: CreatorMarketplaceResourceRecord): StudioCreatorPackDefinition {
  const projection = projectCreatorMarketplaceRecordToStudioPack(record);
  if (projection.status !== "installable") throw new Error(projection.reason);
  return projection.pack;
}

function legacyPack(
  pack: StudioCreatorPackDefinition,
  releaseId = pack.marketplaceSource!.releaseId,
): StudioCreatorPackDefinition {
  return {
    ...pack,
    metadata: { ...pack.metadata, id: `community:${releaseId}` },
  };
}

function receiptStorage(): CreatorMarketplaceInstallReceiptStorage & {
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
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

interface Harness {
  readonly database: StudioLocalDatabase;
  readonly brush: ProductBrushLibraryRepository;
  readonly filter: ProductFilterLibraryRepository;
  readonly palette: StudioPaletteSqliteRepository;
  readonly receipts: ReturnType<typeof receiptStorage>;
  readonly options: StudioCreatorPackProductRuntimeOptions;
}

async function harness(): Promise<Harness> {
  const database = await openDatabase();
  const brush = await openProductBrushLibraryRepository({
    acquireDatabase: () => Promise.resolve(database),
  });
  const filter = await openProductFilterLibraryRepository({
    acquireDatabase: () => Promise.resolve(database),
  });
  const palette = createStudioPaletteSqliteRepository({
    acquireDatabase: () => Promise.resolve(database),
  });
  const receipts = receiptStorage();
  return {
    database,
    brush,
    filter,
    palette,
    receipts,
    options: {
      acquireDatabase: () => Promise.resolve(database),
      acquireBrushRepository: () => Promise.resolve(brush),
      acquireFilterRepository: () => Promise.resolve(filter),
      acquirePaletteRepository: () => Promise.resolve(palette),
      installReceiptStorage: receipts,
      now: () => 10_000,
    },
  };
}

function itemId(packId: string, entryId: string): string {
  return `creator-pack:${packId}:${entryId}`;
}

async function readItem(
  kind: Kind,
  target: Harness,
  id: string,
) {
  if (kind === "brush") return target.brush.repository.getById(id);
  if (kind === "filter") return target.filter.repository.getById(id);
  return (await target.palette.list()).find((entry) => entry.id === id) ?? null;
}

describe("Studio community legacy pack identity migration", () => {
  it.each(["brush", "filter", "palette"] as const)(
    "atomically migrates an exact %s install, publishes the logical receipt, and uninstalls it",
    async (kind) => {
      const target = await harness();
      const record = resource(kind);
      const current = projected(record);
      const legacy = legacyPack(current);
      expect((await installStudioCreatorPackProduct(legacy, target.options)).status)
        .toBe("installed");
      const entryId = current.entries[0]!.id;
      const oldId = itemId(legacy.metadata.id, entryId);
      const newId = itemId(current.metadata.id, entryId);
      expect(await readItem(kind, target, oldId)).not.toBeNull();

      const state = await inspectStudioCreatorPackInstallStateProduct(current, {
        ...target.options,
        loadCreatorMarketplaceResourceIdentity: async () => identity(record),
        loadCreatorMarketplaceResource: async (id) => {
          expect(id).toBe(record.id);
          return record;
        },
      });

      expect(state).toBe("installed");
      expect(await readItem(kind, target, oldId)).toBeNull();
      expect(await readItem(kind, target, newId)).not.toBeNull();
      if (kind === "brush" || kind === "palette") {
        const oldKey = studioCreatorPackReceiptKey(kind, legacy.metadata.id);
        const newKey = studioCreatorPackReceiptKey(kind, current.metadata.id);
        const sidecar = kind === "brush"
          ? {
              read: (key: string) => target.database.kvGet(
                STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
                key,
              ),
            }
          : {
              read: (key: string) => target.palette.readSidecar(
                STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
                key,
              ),
            };
        expect(await sidecar.read(oldKey)).toBeNull();
        expect(await sidecar.read(newKey)).toContain(current.metadata.id);
      }
      expect(target.receipts.values.get(
        CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
      )).toContain(current.metadata.id);

      expect((await uninstallStudioCreatorPackProduct(current, {
        ...target.options,
        loadCreatorMarketplaceResource: async () => record,
      })).status).toBe("uninstalled");
      expect(await readItem(kind, target, newId)).toBeNull();
      expect(target.receipts.values.has(
        CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
      )).toBe(false);
    },
  );

  it("migrates an exact prior UUID release and reports update for the current head", async () => {
    const target = await harness();
    const priorRecord = resource("brush");
    const currentRecord = resource("brush", {
      id: "223e4567-e89b-42d3-a456-426614174000",
      version: "2.0.0",
      fingerprint: "d".repeat(64),
    });
    const prior = projected(priorRecord);
    const current = projected(currentRecord);
    const legacy = legacyPack(prior);
    await installStudioCreatorPackProduct(legacy, target.options);
    const loadResource = vi.fn(async (id: string) => {
      expect(id).toBe(priorRecord.id);
      return priorRecord;
    });

    expect(await inspectStudioCreatorPackInstallStateProduct(current, {
      ...target.options,
      loadCreatorMarketplaceResourceIdentity: async () => identity(priorRecord),
      loadCreatorMarketplaceResource: loadResource,
    })).toBe("update");
    expect(loadResource).toHaveBeenCalledOnce();
    expect(target.receipts.values.get(
      CREATOR_MARKETPLACE_INSTALL_RECEIPT_STORAGE_KEY,
    )).toContain('"packageVersion":"1.0.0"');

    expect((await installStudioCreatorPackProduct(current, {
      ...target.options,
      loadCreatorMarketplaceResource: loadResource,
    })).status).toBe("installed");
    expect(await target.brush.repository.getById(itemId(
      current.metadata.id,
      current.entries[0]!.id,
    ))).not.toBeNull();
  });

  it("fails closed for manifest mismatch, hidden API response, partial rows, and dual ids", async () => {
    const mismatchTarget = await harness();
    const originalRecord = resource("filter");
    const current = projected(originalRecord);
    const legacy = legacyPack(current);
    await installStudioCreatorPackProduct(legacy, mismatchTarget.options);
    const changedRecord = {
      ...originalRecord,
      manifestHash: "e".repeat(64),
    } satisfies CreatorMarketplaceResourceRecord;
    expect(await inspectStudioCreatorPackInstallStateProduct(current, {
      ...mismatchTarget.options,
      loadCreatorMarketplaceResourceIdentity: async () => identity(originalRecord),
      loadCreatorMarketplaceResource: async () => changedRecord,
    })).toBe("conflict");
    expect(await mismatchTarget.filter.repository.getById(itemId(
      legacy.metadata.id,
      legacy.entries[0]!.id,
    ))).not.toBeNull();

    const hiddenTarget = await harness();
    await installStudioCreatorPackProduct(legacy, hiddenTarget.options);
    const hiddenDetail = vi.fn(async () => originalRecord);
    expect(await inspectStudioCreatorPackInstallStateProduct(current, {
      ...hiddenTarget.options,
      loadCreatorMarketplaceResourceIdentity: async () =>
        identity(originalRecord, "moderator-hidden"),
      loadCreatorMarketplaceResource: hiddenDetail,
    })).toBe("repair-required");
    expect(hiddenDetail).not.toHaveBeenCalled();

    const partialTarget = await harness();
    const twoEntryRecord = resource("palette", { entries: 2 });
    const twoEntryCurrent = projected(twoEntryRecord);
    const twoEntryLegacy = legacyPack(twoEntryCurrent);
    await installStudioCreatorPackProduct(twoEntryLegacy, partialTarget.options);
    await partialTarget.palette.delete(itemId(
      twoEntryLegacy.metadata.id,
      twoEntryLegacy.entries[1]!.id,
    ));
    expect(await inspectStudioCreatorPackInstallStateProduct(twoEntryCurrent, {
      ...partialTarget.options,
      loadCreatorMarketplaceResourceIdentity: async () => identity(twoEntryRecord),
      loadCreatorMarketplaceResource: async () => twoEntryRecord,
    })).toBe("repair-required");

    const dualTarget = await harness();
    await installStudioCreatorPackProduct(legacy, dualTarget.options);
    await installStudioCreatorPackProduct({
      ...current,
      marketplaceSource: undefined,
    }, dualTarget.options);
    expect(await inspectStudioCreatorPackInstallStateProduct(current, {
      ...dualTarget.options,
      loadCreatorMarketplaceResourceIdentity: async () => identity(originalRecord),
      loadCreatorMarketplaceResource: async () => originalRecord,
    })).toBe("conflict");
    expect(await dualTarget.filter.repository.getById(itemId(
      legacy.metadata.id,
      legacy.entries[0]!.id,
    ))).not.toBeNull();
    expect(await dualTarget.filter.repository.getById(itemId(
      current.metadata.id,
      current.entries[0]!.id,
    ))).not.toBeNull();
  });

  it("skips an identity-proven unrelated hidden UUID without calling its public 404 detail", async () => {
    const target = await harness();
    const matchingRecord = resource("brush", {
      id: "223e4567-e89b-42d3-a456-426614174010",
    });
    const unrelatedRecord = resource("brush", {
      id: "123e4567-e89b-42d3-a456-426614174010",
      packageId: "community/brush/unrelated-hidden",
      publisherId: "unrelated-publisher",
      fingerprint: "e".repeat(64),
    });
    const current = projected(matchingRecord);
    const matchingLegacy = legacyPack(current);
    const unrelatedLegacy = legacyPack(projected(unrelatedRecord));
    await installStudioCreatorPackProduct(matchingLegacy, target.options);
    await installStudioCreatorPackProduct(unrelatedLegacy, target.options);
    const loadDetail = vi.fn(async (id: string) => {
      if (id === unrelatedRecord.id) throw new Error("not-found");
      return matchingRecord;
    });

    await expect(inspectStudioCreatorPackInstallStateProduct(current, {
      ...target.options,
      loadCreatorMarketplaceResourceIdentity: async (id) =>
        id === unrelatedRecord.id
          ? identity(unrelatedRecord, "moderator-hidden")
          : identity(matchingRecord),
      loadCreatorMarketplaceResource: loadDetail,
    })).resolves.toBe("installed");

    expect(loadDetail).toHaveBeenCalledTimes(1);
    expect(loadDetail).toHaveBeenCalledWith(matchingRecord.id, undefined);
    expect(await target.brush.repository.getById(itemId(
      unrelatedLegacy.metadata.id,
      unrelatedLegacy.entries[0]!.id,
    ))).not.toBeNull();
  });

  it("keeps an unclassifiable exact identity 404 fail-closed", async () => {
    const target = await harness();
    const record = resource("filter");
    const current = projected(record);
    const legacy = legacyPack(current);
    await installStudioCreatorPackProduct(legacy, target.options);
    const loadDetail = vi.fn(async () => record);

    await expect(inspectStudioCreatorPackInstallStateProduct(current, {
      ...target.options,
      loadCreatorMarketplaceResourceIdentity: async () => {
        throw new Error("identity-not-found");
      },
      loadCreatorMarketplaceResource: loadDetail,
    })).resolves.toBe("repair-required");
    expect(loadDetail).not.toHaveBeenCalled();
  });

  it("serializes concurrent inspections so one exact API lookup performs one migration", async () => {
    const target = await harness();
    const record = resource("filter");
    const current = projected(record);
    const legacy = legacyPack(current);
    await installStudioCreatorPackProduct(legacy, target.options);
    const pending = deferred<CreatorMarketplaceResourceRecord>();
    const loadResource = vi.fn(() => pending.promise);
    const options = {
      ...target.options,
      loadCreatorMarketplaceResourceIdentity: async () => identity(record),
      loadCreatorMarketplaceResource: loadResource,
    };

    const first = inspectStudioCreatorPackInstallStateProduct(current, options);
    const second = inspectStudioCreatorPackInstallStateProduct(current, options);
    await vi.waitFor(() => expect(loadResource).toHaveBeenCalledOnce());
    pending.resolve(record);

    await expect(first).resolves.toBe("installed");
    await expect(second).resolves.toBe("installed");
    expect(loadResource).toHaveBeenCalledOnce();
  });

  it("rolls brush target rows back when the new logical receipt write fails", async () => {
    const target = await harness();
    const record = resource("brush");
    const current = projected(record);
    const legacy = legacyPack(current);
    await installStudioCreatorPackProduct(legacy, target.options);
    const newReceiptKey = studioCreatorPackReceiptKey("brush", current.metadata.id);
    const originalCompare = target.brush.compareAndRestoreInstallSnapshot!;
    const faultingBrush: ProductBrushLibraryRepository = {
      ...target.brush,
      compareAndRestoreInstallSnapshot: async (entries, sidecars) => {
        if (sidecars?.some(({ namespace, key, restore }) =>
          namespace === STUDIO_CREATOR_PACK_SQLITE_NAMESPACE
          && key === newReceiptKey
          && restore !== null)) {
          throw new Error("injected logical receipt failure");
        }
        return originalCompare(entries, sidecars);
      },
    };

    await expect(inspectStudioCreatorPackInstallStateProduct(current, {
      ...target.options,
      acquireBrushRepository: () => Promise.resolve(faultingBrush),
      loadCreatorMarketplaceResourceIdentity: async () => identity(record),
      loadCreatorMarketplaceResource: async () => record,
    })).rejects.toThrow("injected logical receipt failure");
    expect(await target.brush.repository.getById(itemId(
      legacy.metadata.id,
      legacy.entries[0]!.id,
    ))).not.toBeNull();
    expect(await target.brush.repository.getById(itemId(
      current.metadata.id,
      current.entries[0]!.id,
    ))).toBeNull();
  });

  it("does not resurrect a legacy brush uninstalled while its exact release is loading", async () => {
    const target = await harness();
    const record = resource("brush");
    const current = projected(record);
    const legacy = legacyPack(current);
    await installStudioCreatorPackProduct(legacy, target.options);
    const oldId = itemId(legacy.metadata.id, legacy.entries[0]!.id);
    const newId = itemId(current.metadata.id, current.entries[0]!.id);

    await expect(inspectStudioCreatorPackInstallStateProduct(current, {
      ...target.options,
      loadCreatorMarketplaceResourceIdentity: async () => identity(record),
      loadCreatorMarketplaceResource: async () => {
        await expect(uninstallStudioCreatorPackProduct(legacy, target.options))
          .resolves.toMatchObject({ status: "uninstalled" });
        return record;
      },
    })).resolves.toBe("repair-required");

    expect(await readItem("brush", target, oldId)).toBeNull();
    expect(await readItem("brush", target, newId)).toBeNull();
    expect(await target.database.kvGet(
      STUDIO_CREATOR_PACK_SQLITE_NAMESPACE,
      studioCreatorPackReceiptKey("brush", current.metadata.id),
    )).toBeNull();
  });

  it("restores partially removed filter rows and removes logical rows on CAS conflict", async () => {
    const target = await harness();
    const record = resource("filter", { entries: 2 });
    const current = projected(record);
    const legacy = legacyPack(current);
    await installStudioCreatorPackProduct(legacy, target.options);
    const originalCompare = target.filter.compareAndRestoreInstallSnapshot!;
    let injected = false;
    const faultingFilter: ProductFilterLibraryRepository = {
      ...target.filter,
      compareAndRestoreInstallSnapshot: async (entries) => {
        if (
          !injected
          && entries.length === 2
          && entries.every((entry) => entry.id.startsWith(
            `creator-pack:${legacy.metadata.id}:`,
          ))
        ) {
          injected = true;
          const partial = await originalCompare([entries[0]!]);
          return {
            restoredIds: partial.restoredIds,
            conflictIds: [entries[1]!.id],
          };
        }
        return originalCompare(entries);
      },
    };

    await expect(inspectStudioCreatorPackInstallStateProduct(current, {
      ...target.options,
      acquireFilterRepository: () => Promise.resolve(faultingFilter),
      loadCreatorMarketplaceResourceIdentity: async () => identity(record),
      loadCreatorMarketplaceResource: async () => record,
    })).rejects.toThrow("이전 중 변경");
    for (const entry of current.entries) {
      expect(await target.filter.repository.getById(itemId(
        legacy.metadata.id,
        entry.id,
      ))).not.toBeNull();
      expect(await target.filter.repository.getById(itemId(
        current.metadata.id,
        entry.id,
      ))).toBeNull();
    }
  });

  it("rolls a committed palette migration back when post-commit verification fails", async () => {
    const target = await harness();
    const record = resource("palette");
    const current = projected(record);
    const legacy = legacyPack(current);
    await installStudioCreatorPackProduct(legacy, target.options);
    let injectAfterCommit = true;
    const faultingPalette: StudioPaletteSqliteRepository = {
      ...target.palette,
      commitBatch: async (input) => {
        const result = await target.palette.commitBatch(input);
        if (injectAfterCommit) {
          injectAfterCommit = false;
          throw new Error("injected post-commit response failure");
        }
        return result;
      },
    };

    await expect(inspectStudioCreatorPackInstallStateProduct(current, {
      ...target.options,
      acquirePaletteRepository: () => Promise.resolve(faultingPalette),
      loadCreatorMarketplaceResourceIdentity: async () => identity(record),
      loadCreatorMarketplaceResource: async () => record,
    })).rejects.toThrow("post-commit");
    expect(await readItem("palette", target, itemId(
      legacy.metadata.id,
      legacy.entries[0]!.id,
    ))).not.toBeNull();
    expect(await readItem("palette", target, itemId(
      current.metadata.id,
      current.entries[0]!.id,
    ))).toBeNull();
  });

  it("preserves a palette edit made while the exact legacy release is loading", async () => {
    const target = await harness();
    const record = resource("palette");
    const current = projected(record);
    const legacy = legacyPack(current);
    await installStudioCreatorPackProduct(legacy, target.options);
    const oldId = itemId(legacy.metadata.id, legacy.entries[0]!.id);
    const newId = itemId(current.metadata.id, current.entries[0]!.id);

    await expect(inspectStudioCreatorPackInstallStateProduct(current, {
      ...target.options,
      loadCreatorMarketplaceResourceIdentity: async () => identity(record),
      loadCreatorMarketplaceResource: async () => {
        await target.palette.rename(oldId, "API 확인 중 사용자가 수정한 팔레트");
        return record;
      },
    })).rejects.toThrow("팔레트 레거시 이전 rollback 실패");

    expect(await readItem("palette", target, oldId)).toMatchObject({
      name: "API 확인 중 사용자가 수정한 팔레트",
    });
    expect(await readItem("palette", target, newId)).toBeNull();
  });
});
