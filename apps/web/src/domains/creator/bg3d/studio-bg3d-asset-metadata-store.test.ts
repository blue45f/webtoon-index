import {
  IDBFactory,
  IDBObjectStore as FakeIDBObjectStore,
} from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_ASSET_RIGHTS,
  STUDIO_BG3D_ASSET_METADATA_LIMITS,
  normalizeStudioBg3dAssetMetadata,
  type StudioBg3dAssetMetadata,
} from "./studio-bg3d-asset-metadata";
import {
  STUDIO_BG3D_ASSET_METADATA_DATABASE_NAME,
  STUDIO_BG3D_ASSET_METADATA_DATABASE_VERSION,
  STUDIO_BG3D_ASSET_METADATA_STORE_NAME,
  StudioBg3dAssetMetadataStoreError,
  deleteStudioBg3dAssetMetadataAtomically,
  getStudioBg3dAssetMetadata,
  listStudioBg3dAssetMetadata,
  putStudioBg3dAssetMetadataAtomically,
  updateStudioBg3dAssetCollections,
  updateStudioBg3dAssetFavorite,
  updateStudioBg3dAssetRights,
  updateStudioBg3dAssetTags,
} from "./studio-bg3d-asset-metadata-store";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

function metadata(
  contentHash: `sha256:${string}`,
  overrides: Record<string, unknown> = {},
): StudioBg3dAssetMetadata {
  const value = normalizeStudioBg3dAssetMetadata({
    version: 2,
    contentHash,
    name: "기본 모델",
    format: "glb",
    createdAt: 10,
    updatedAt: 10,
    byteSize: 1_000,
    triangles: 100,
    textures: 2,
    favorite: false,
    collections: [],
    tags: [],
    rights: DEFAULT_STUDIO_BG3D_ASSET_RIGHTS,
    ...overrides,
  });
  if (!value) throw new Error("invalid metadata fixture");
  return value;
}

function storeOptions(factory: IDBFactory) {
  return { indexedDb: factory } as const;
}

function delegatedFactory(
  backing: IDBFactory,
  onOpen: () => void,
): IDBFactory {
  return {
    cmp: backing.cmp.bind(backing),
    deleteDatabase: backing.deleteDatabase.bind(backing),
    open(name: string, version?: number) {
      onOpen();
      return version === undefined ? backing.open(name) : backing.open(name, version);
    },
  } as IDBFactory;
}

async function openRawDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(
      STUDIO_BG3D_ASSET_METADATA_DATABASE_NAME,
      STUDIO_BG3D_ASSET_METADATA_DATABASE_VERSION,
    );
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRaw(factory: IDBFactory, hash: string): Promise<unknown> {
  const database = await openRawDatabase(factory);
  try {
    const transaction = database.transaction(STUDIO_BG3D_ASSET_METADATA_STORE_NAME, "readonly");
    const request = transaction.objectStore(STUDIO_BG3D_ASSET_METADATA_STORE_NAME).get(hash);
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function writeRaw(factory: IDBFactory, value: unknown): Promise<void> {
  const database = await openRawDatabase(factory);
  try {
    const transaction = database.transaction(STUDIO_BG3D_ASSET_METADATA_STORE_NAME, "readwrite");
    transaction.objectStore(STUDIO_BG3D_ASSET_METADATA_STORE_NAME).put(value);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("studio BG3D asset metadata IndexedDB store", () => {
  it("creates a versioned contentHash-keyed store and atomically persists canonical V1/V2 rows", async () => {
    const factory = new IDBFactory();
    const legacy = {
      version: 1,
      contentHash: HASH_A.toUpperCase(),
      name: "레거시 교실",
      format: "OBJ",
      createdAt: 20,
      byteSize: 2_000,
      triangleCount: 300,
      textureCount: 3,
      collection: { id: "school", name: "학교" },
      tags: ["교실"],
      rights: {
        status: "licensed",
        commercialUse: true,
        provider: "Model Store",
        license: "Commercial License",
      },
    };
    const modern = metadata(HASH_B, { name: "현대 거리", updatedAt: 30 });

    const saved = await putStudioBg3dAssetMetadataAtomically(
      [legacy, legacy, modern],
      storeOptions(factory),
    );

    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      version: 2,
      contentHash: HASH_A,
      triangles: 300,
      textures: 3,
      rights: { teamShareAllowed: false },
    });
    expect(await getStudioBg3dAssetMetadata("A".repeat(64), storeOptions(factory)))
      .toEqual(saved[0]);
    expect((await listStudioBg3dAssetMetadata(storeOptions(factory))).map(({ contentHash }) => contentHash))
      .toEqual([HASH_B, HASH_A]);

    const database = await openRawDatabase(factory);
    expect(database.version).toBe(STUDIO_BG3D_ASSET_METADATA_DATABASE_VERSION);
    const transaction = database.transaction(STUDIO_BG3D_ASSET_METADATA_STORE_NAME, "readonly");
    expect(transaction.objectStore(STUDIO_BG3D_ASSET_METADATA_STORE_NAME).keyPath).toBe("contentHash");
    database.close();
    expect(await readRaw(factory, HASH_A)).toEqual(saved[0]);
  });

  it("validates the complete batch before opening IndexedDB and distinguishes invalid from conflicting input", async () => {
    const backing = new IDBFactory();
    let opens = 0;
    const factory = delegatedFactory(backing, () => {
      opens += 1;
    });
    const first = metadata(HASH_A, { name: "같은 바이너리" });
    const conflicting = metadata(HASH_A, { name: "다른 권리 주장", favorite: true });

    await expect(putStudioBg3dAssetMetadataAtomically(
      [{ ...first, contentHash: "not-a-hash" }],
      storeOptions(factory),
    )).rejects.toMatchObject({ code: "invalid-metadata" });
    await expect(putStudioBg3dAssetMetadataAtomically(
      [first, conflicting],
      storeOptions(factory),
    )).rejects.toMatchObject({ code: "metadata-conflict" });
    await expect(deleteStudioBg3dAssetMetadataAtomically(
      ["../unsafe"],
      storeOptions(factory),
    )).rejects.toMatchObject({ code: "invalid-content-hash" });
    expect(opens).toBe(0);
  });

  it("checks every existing hash before issuing any put so a late conflict cannot partially write", async () => {
    const factory = new IDBFactory();
    const existing = metadata(HASH_A, { name: "기존" });
    await putStudioBg3dAssetMetadataAtomically([existing], storeOptions(factory));

    const putSpy = vi.spyOn(FakeIDBObjectStore.prototype, "put");
    const fresh = metadata(HASH_B, { name: "새 모델" });
    const conflicting = metadata(HASH_A, { name: "충돌" });
    await expect(putStudioBg3dAssetMetadataAtomically(
      [fresh, conflicting],
      storeOptions(factory),
    )).rejects.toMatchObject({ code: "metadata-conflict" });

    expect(putSpy).not.toHaveBeenCalled();
    expect(await getStudioBg3dAssetMetadata(HASH_B, storeOptions(factory))).toBeNull();
    expect(await getStudioBg3dAssetMetadata(HASH_A, storeOptions(factory))).toEqual(existing);
  });

  it("normalizes favorite, collection, tag, and rights patches before read-modify-write", async () => {
    const factory = new IDBFactory();
    await putStudioBg3dAssetMetadataAtomically(
      [metadata(HASH_A, { name: "한옥 모델" })],
      storeOptions(factory),
    );

    await updateStudioBg3dAssetFavorite(HASH_A, true, { indexedDb: factory, now: 20 });
    await updateStudioBg3dAssetCollections(HASH_A, [
      { id: "architecture", name: "한국 건축" },
    ], { indexedDb: factory, now: 21 });
    await updateStudioBg3dAssetTags(HASH_A, ["한옥", "야간", "한옥"], {
      indexedDb: factory,
      now: 22,
    });
    const updated = await updateStudioBg3dAssetRights(HASH_A, {
      status: "licensed",
      commercialUse: true,
      teamShareAllowed: true,
      provider: "ACON 3D",
      author: "김모델",
      license: "Team Commercial",
      purchaseOrDownloadDate: "2026-07-22",
    }, { indexedDb: factory, now: 23 });

    expect(updated).toMatchObject({
      updatedAt: 23,
      favorite: true,
      collections: [{ id: "architecture", name: "한국 건축" }],
      tags: ["야간", "한옥"],
      rights: {
        status: "licensed",
        commercialUse: true,
        teamShareAllowed: true,
        provider: "ACON 3D",
      },
    });
    expect(Object.isFrozen(updated)).toBe(true);
    expect(await getStudioBg3dAssetMetadata(HASH_A, storeOptions(factory))).toEqual(updated);
  });

  it("downgrades hostile rights receipts and never persists URLs, tokens, or unknown receipt fields", async () => {
    const factory = new IDBFactory();
    await putStudioBg3dAssetMetadataAtomically([metadata(HASH_A)], storeOptions(factory));

    const updated = await updateStudioBg3dAssetRights(HASH_A, {
      status: "licensed",
      commercialUse: true,
      teamShareAllowed: true,
      provider: "Model Store",
      license: "https://assets.invalid/license?access_token=secret",
      purchaseOrDownloadDate: "2026-07-22",
      downloadUrl: "https://assets.invalid/model.glb",
      apiKey: "sk-must-not-be-stored",
    } as never, { indexedDb: factory, now: 20 });

    expect(updated.rights).toEqual(DEFAULT_STUDIO_BG3D_ASSET_RIGHTS);
    const serialized = JSON.stringify(await readRaw(factory, HASH_A));
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("sk-must-not-be-stored");
    expect(serialized).not.toContain("downloadUrl");
  });

  it("rejects invalid update patches before opening storage and preserves the current row", async () => {
    const backing = new IDBFactory();
    const existing = metadata(HASH_A);
    await putStudioBg3dAssetMetadataAtomically([existing], storeOptions(backing));
    let opens = 0;
    const factory = delegatedFactory(backing, () => {
      opens += 1;
    });

    await expect(updateStudioBg3dAssetTags(HASH_A, [
      "태그".repeat(STUDIO_BG3D_ASSET_METADATA_LIMITS.tagCodePoints + 1),
    ], { indexedDb: factory, now: 20 })).rejects.toMatchObject({ code: "invalid-metadata" });
    await expect(updateStudioBg3dAssetCollections(HASH_A, [
      { id: "__proto__", name: "위험" },
    ], { indexedDb: factory, now: 20 })).rejects.toMatchObject({ code: "invalid-metadata" });
    expect(opens).toBe(0);
    expect(await getStudioBg3dAssetMetadata(HASH_A, storeOptions(backing))).toEqual(existing);
  });

  it("deletes a validated hash set atomically and reports only rows that existed", async () => {
    const factory = new IDBFactory();
    await putStudioBg3dAssetMetadataAtomically(
      [metadata(HASH_A), metadata(HASH_B)],
      storeOptions(factory),
    );

    await expect(deleteStudioBg3dAssetMetadataAtomically(
      [HASH_A.toUpperCase(), HASH_A, HASH_C],
      storeOptions(factory),
    )).resolves.toBe(1);
    expect(await getStudioBg3dAssetMetadata(HASH_A, storeOptions(factory))).toBeNull();
    expect(await getStudioBg3dAssetMetadata(HASH_B, storeOptions(factory))).not.toBeNull();
  });

  it("reports explicit SSR/storage-unavailable, not-found, and pre-aborted errors", async () => {
    await expect(listStudioBg3dAssetMetadata({ indexedDb: null }))
      .rejects.toMatchObject({ code: "storage-unavailable" });

    const factory = new IDBFactory();
    await expect(updateStudioBg3dAssetFavorite(HASH_A, true, storeOptions(factory)))
      .rejects.toMatchObject({ code: "not-found" });

    let opens = 0;
    const controller = new AbortController();
    controller.abort("test cancellation");
    await expect(putStudioBg3dAssetMetadataAtomically([metadata(HASH_A)], {
      indexedDb: delegatedFactory(factory, () => {
        opens += 1;
      }),
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });
    expect(opens).toBe(0);
  });

  it("aborts an active IndexedDB transaction when its AbortSignal fires", async () => {
    const factory = new IDBFactory();
    await putStudioBg3dAssetMetadataAtomically([metadata(HASH_A)], storeOptions(factory));
    const controller = new AbortController();
    const originalGetAll = FakeIDBObjectStore.prototype.getAll;
    vi.spyOn(FakeIDBObjectStore.prototype, "getAll").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = originalGetAll.apply(this, args as Parameters<typeof originalGetAll>);
      controller.abort("stop active read");
      return request;
    });

    await expect(listStudioBg3dAssetMetadata({ indexedDb: factory, signal: controller.signal }))
      .rejects.toMatchObject({ code: "aborted" });
  });

  it("fails closed when a stored row cannot be migrated instead of returning partial privileges", async () => {
    const factory = new IDBFactory();
    await putStudioBg3dAssetMetadataAtomically([metadata(HASH_A)], storeOptions(factory));
    await writeRaw(factory, {
      ...metadata(HASH_B),
      version: 99,
      rights: {
        status: "owned",
        commercialUse: true,
        teamShareAllowed: true,
      },
    });

    await expect(getStudioBg3dAssetMetadata(HASH_B, storeOptions(factory)))
      .rejects.toMatchObject({ code: "invalid-stored-metadata" });
    await expect(listStudioBg3dAssetMetadata(storeOptions(factory)))
      .rejects.toMatchObject({ code: "invalid-stored-metadata" });
  });

  it("resolves put only after the encompassing readwrite transaction completes", async () => {
    const factory = new IDBFactory();
    const originalPut = FakeIDBObjectStore.prototype.put;
    let requestSucceeded!: () => void;
    const requestSuccess = new Promise<void>((resolve) => {
      requestSucceeded = resolve;
    });
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = originalPut.apply(this, args as Parameters<typeof originalPut>);
      request.addEventListener("success", () => requestSucceeded(), { once: true });
      return request;
    });

    let settled = false;
    const write = putStudioBg3dAssetMetadataAtomically(
      [metadata(HASH_A)],
      storeOptions(factory),
    ).finally(() => {
      settled = true;
    });
    await requestSuccess;
    expect(settled).toBe(false);
    await expect(write).resolves.toHaveLength(1);
  });

  it("exposes a typed error class without leaking native IndexedDB error details", () => {
    const error = new StudioBg3dAssetMetadataStoreError("storage-unavailable");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("StudioBg3dAssetMetadataStoreError");
    expect(error.code).toBe("storage-unavailable");
    expect(error.message).toContain("저장소");
  });
});
