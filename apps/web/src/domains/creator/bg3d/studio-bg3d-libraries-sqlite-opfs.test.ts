import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "../studio-local-database";
import { StudioLocalDatabaseCommitOutcomeUnknownError } from "../studio-local-database-commit-outcome";
import { createStudioOpfsAssetStore } from "../studio-opfs-asset-store";
import { createStudioOpfsMemoryFileSystem } from "../studio-opfs-filesystem";

import {
  compensateImportedBg3dModelsIfCreationMatchesV12,
  deleteStoredBg3dModelV12,
  getBg3dModelDeletionReceiptByHashV12,
  getCachedBg3dModelThumbnailV12,
  getStoredBg3dModelByHashV12,
  importVerifiedBg3dModelsAtomicallyV12,
  importVerifiedBg3dModelsAtomicallyWithDispositionV12,
  listBg3dModelLibraryEntriesV12,
  listStoredBg3dModelsV12,
  saveBg3dModelThumbnailV12,
} from "./bg3d-model-library";
import {
  deleteBg3dTemplateV12,
  listBg3dTemplatesV12,
  saveBg3dTemplateV12,
} from "./bg3d-template-library";
import {
  STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND,
  getStudioBg3dAssetMetadata,
  listStudioBg3dAssetMetadata,
  putStudioBg3dAssetMetadataAtomically,
  updateStudioBg3dAssetFavorite,
} from "./studio-bg3d-asset-metadata-store";
import { STUDIO_BG3D_GLB_MIME_TYPE } from "./studio-bg3d-glb-validation";
import { disposeSharedStudioBg3dValidationWorker } from "./studio-bg3d-glb-validation-worker-client";
import { StudioBg3dValidationWorkerTestFixture } from "./studio-bg3d-glb-validation-worker.test-fixture";
import {
  STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
  STUDIO_BG3D_LIBRARY_MANIFEST_KEYS,
  createStudioBg3dLibrariesAuthority,
  type StudioBg3dLibrariesAuthority,
  type StudioBg3dLibrariesRunExclusive,
} from "./studio-bg3d-libraries-sqlite-opfs-authority";
import { createDefaultStudioBg3dSceneDocument } from "./studio-bg3d-scene-document";

import type {
  StudioLocalDatabase,
  StudioSqliteApiHandle,
} from "../studio-local-database";
import type {
  StudioOpfsAssetStore,
  StudioOpfsContentHash,
} from "../studio-opfs-asset-store";
import type { StudioOpfsMemoryFileSystem } from "../studio-opfs-filesystem";

const JSON_CHUNK = 0x4e4f534a;
const databases = new Set<StudioLocalDatabase>();
let sqliteApiPromise: Promise<StudioSqliteApiHandle> | null = null;

function loadRealSqliteApi(): Promise<StudioSqliteApiHandle> {
  sqliteApiPromise ??= import("@sqlite.org/sqlite-wasm").then(async (module) =>
    (await module.default()) as unknown as StudioSqliteApiHandle);
  return sqliteApiPromise;
}

async function openNamedDatabase(filename = `bg3d-libraries-${crypto.randomUUID()}.sqlite3`) {
  const database = await openStudioLocalDatabase({
    vfs: "memory",
    memoryFilename: filename,
    loadSqlite: loadRealSqliteApi,
  });
  databases.add(database);
  return database;
}

function runExclusive(): StudioBg3dLibrariesRunExclusive {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

function authorityFor(
  database: StudioLocalDatabase,
  fileSystem: StudioOpfsMemoryFileSystem,
  options: {
    readonly assetStore?: StudioOpfsAssetStore;
    readonly now?: () => number;
  } = {},
): StudioBg3dLibrariesAuthority {
  const assets = options.assetStore ?? createStudioOpfsAssetStore({
    fs: fileSystem,
    now: options.now ?? (() => 1_000),
  });
  return createStudioBg3dLibrariesAuthority({
    acquireDatabase: async () => database,
    acquireAssetStore: async () => assets,
    runExclusive: runExclusive(),
    now: options.now ?? (() => 1_000),
    orphanGraceMs: 0,
    allowNonDurableAssetStoreForTests: true,
  });
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function validGlb(marker: string): Uint8Array {
  const encodedJson = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" },
    scenes: [{}],
    extras: { marker },
  }));
  const json = new Uint8Array(Math.ceil(encodedJson.byteLength / 4) * 4);
  json.fill(0x20);
  json.set(encodedJson);
  const bytes = new Uint8Array(12 + 8 + json.byteLength);
  writeUint32(bytes, 0, 0x46546c67);
  writeUint32(bytes, 4, 2);
  writeUint32(bytes, 8, bytes.byteLength);
  writeUint32(bytes, 12, json.byteLength);
  writeUint32(bytes, 16, JSON_CHUNK);
  bytes.set(json, 20);
  return bytes;
}

function glbFile(name: string, marker: string): File {
  return new File([Uint8Array.from(validGlb(marker)).buffer], name, {
    type: STUDIO_BG3D_GLB_MIME_TYPE,
  });
}

function thumbnailPng(): Uint8Array {
  const bytes = new Uint8Array(58);
  const view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 320, false);
  view.setUint32(20, 180, false);
  bytes.set([8, 6, 0, 0, 0], 24);
  view.setUint32(33, 1, false);
  bytes.set([0x49, 0x44, 0x41, 0x54], 37);
  bytes[41] = 0;
  bytes.set([0x49, 0x45, 0x4e, 0x44], 50);
  const crc32 = (start: number, end: number) => {
    let crc = 0xffff_ffff;
    for (let offset = start; offset < end; offset += 1) {
      crc ^= bytes[offset] ?? 0;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb8_8320 : 0);
      }
    }
    return (crc ^ 0xffff_ffff) >>> 0;
  };
  view.setUint32(29, crc32(12, 29), false);
  view.setUint32(42, crc32(37, 42), false);
  view.setUint32(54, crc32(50, 54), false);
  return bytes;
}

function thumbnailDataUrl(): string {
  let binary = "";
  for (const byte of thumbnailPng()) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

function metadata(hash: `sha256:${string}`, now = 10) {
  return {
    version: 2 as const,
    contentHash: hash,
    name: "검증 모델",
    format: "glb" as const,
    createdAt: now,
    updatedAt: now,
    byteSize: 64,
    triangles: 0,
    textures: 0,
    favorite: false,
    collections: [],
    tags: [],
    rights: {
      status: "owned" as const,
      commercialUse: true,
      teamShareAllowed: false,
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("Worker", StudioBg3dValidationWorkerTestFixture);
});

afterEach(async () => {
  disposeSharedStudioBg3dValidationWorker();
  vi.unstubAllGlobals();
  await Promise.all([...databases].map((database) => database.close().catch(() => undefined)));
  databases.clear();
});

describe("BG3D shared SQLite/OPFS product authority", () => {
  it("round-trips model bytes and thumbnail through real sqlite-wasm plus SHA-256 CAS", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const authority = authorityFor(database, fileSystem);
    const [saved] = await importVerifiedBg3dModelsAtomicallyV12(
      [glbFile("hero.glb", "roundtrip")],
      { authority, idFactory: () => "model-hero", now: 10 },
    );
    expect(saved).toBeDefined();
    await saveBg3dModelThumbnailV12("model-hero", thumbnailDataUrl(), {
      authority,
      now: 20,
      captureRevision: 20_000,
    });

    const manifest = await database.kvGet(
      STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
      STUDIO_BG3D_LIBRARY_MANIFEST_KEYS.models,
    );
    expect(manifest).toContain(saved!.contentHash);
    expect(manifest).not.toContain("data:image/");
    expect([...fileSystem.snapshot().keys()].filter((path) => path.startsWith("blobs/")))
      .toHaveLength(2);
    expect((await listBg3dModelLibraryEntriesV12({ authority }))
      .find(({ id }) => id === "model-hero")).toMatchObject({
      id: "model-hero",
      source: "sqlite-opfs",
      status: "verified",
    });
    expect(await getCachedBg3dModelThumbnailV12("model-hero", { authority }))
      .toBe(thumbnailDataUrl());
  });

  it("compensates only exact newly-created model rows and fails closed after a later revision", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const authority = authorityFor(database, fileSystem);
    const created = await importVerifiedBg3dModelsAtomicallyWithDispositionV12(
      [glbFile("created.glb", "created-for-failed-project")],
      { authority, idFactory: () => "created-for-import", now: 10 },
    );
    expect(created.created).toEqual([{
      id: "created-for-import",
      contentHash: created.records[0]!.contentHash,
    }]);
    await expect(compensateImportedBg3dModelsIfCreationMatchesV12(created, { authority }))
      .resolves.toBe(true);
    await expect(listStoredBg3dModelsV12({ authority })).resolves.toEqual([]);
    await expect(compensateImportedBg3dModelsIfCreationMatchesV12(created, { authority }))
      .resolves.toBe(false);

    const deleted = await importVerifiedBg3dModelsAtomicallyV12(
      [glbFile("deleted.glb", "deletion-receipt-restored")],
      { authority, idFactory: () => "deleted-before-import", now: 12 },
    );
    await deleteStoredBg3dModelV12("deleted-before-import", { authority, now: 13 });
    const deletionReceipt = await getBg3dModelDeletionReceiptByHashV12(
      deleted[0]!.contentHash,
      { authority },
    );
    const reimported = await importVerifiedBg3dModelsAtomicallyWithDispositionV12(
      [glbFile("reimported.glb", "deletion-receipt-restored")],
      { authority, idFactory: () => "reimported-for-failed-project", now: 14 },
    );
    expect(reimported.removedDeletions).toEqual([deletionReceipt]);
    await expect(getBg3dModelDeletionReceiptByHashV12(
      deleted[0]!.contentHash,
      { authority },
    )).resolves.toBeNull();
    await expect(compensateImportedBg3dModelsIfCreationMatchesV12(reimported, { authority }))
      .resolves.toBe(true);
    await expect(getStoredBg3dModelByHashV12(deleted[0]!.contentHash, { authority }))
      .resolves.toBeNull();
    await expect(getBg3dModelDeletionReceiptByHashV12(
      deleted[0]!.contentHash,
      { authority },
    )).resolves.toEqual(deletionReceipt);

    const shared = await importVerifiedBg3dModelsAtomicallyV12(
      [glbFile("shared.glb", "shared-before-import")],
      { authority, idFactory: () => "shared-existing", now: 20 },
    );
    const deduplicated = await importVerifiedBg3dModelsAtomicallyWithDispositionV12(
      [glbFile("shared-again.glb", "shared-before-import")],
      { authority, idFactory: () => "must-not-be-used", now: 21 },
    );
    expect(deduplicated.created).toEqual([]);
    await expect(compensateImportedBg3dModelsIfCreationMatchesV12(deduplicated, { authority }))
      .resolves.toBe(true);
    await expect(getStoredBg3dModelByHashV12(shared[0]!.contentHash, { authority }))
      .resolves.toMatchObject({ id: "shared-existing" });

    const fenced = await importVerifiedBg3dModelsAtomicallyWithDispositionV12(
      [glbFile("fenced.glb", "created-before-later-write")],
      { authority, idFactory: () => "fenced-created", now: 30 },
    );
    await importVerifiedBg3dModelsAtomicallyV12(
      [glbFile("later.glb", "later-manifest-write")],
      { authority, idFactory: () => "later-created", now: 31 },
    );
    await expect(compensateImportedBg3dModelsIfCreationMatchesV12(fenced, { authority }))
      .resolves.toBe(false);
    await expect(listStoredBg3dModelsV12({ authority })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "fenced-created" }),
        expect.objectContaining({ id: "later-created" }),
      ]),
    );
  });

  it("survives a real sqlite-wasm close/reopen with identical model hash and bytes", async () => {
    const filename = `bg3d-reopen-${crypto.randomUUID()}.sqlite3`;
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const firstDatabase = await openNamedDatabase(filename);
    const firstAuthority = authorityFor(firstDatabase, fileSystem);
    const [saved] = await importVerifiedBg3dModelsAtomicallyV12(
      [glbFile("reopen.glb", "reopen")],
      { authority: firstAuthority, idFactory: () => "model-reopen", now: 10 },
    );
    await firstDatabase.close();
    databases.delete(firstDatabase);

    const reopenedDatabase = await openNamedDatabase(filename);
    const reopenedAuthority = authorityFor(reopenedDatabase, fileSystem);
    const restored = await getStoredBg3dModelByHashV12(saved!.contentHash, {
      authority: reopenedAuthority,
    });
    expect(restored?.contentHash).toBe(saved!.contentHash);
    expect(new Uint8Array(await restored!.blob.arrayBuffer())).toEqual(validGlb("reopen"));
  });

  it("serializes concurrent model writes without losing either manifest update", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const authority = authorityFor(database, fileSystem);
    await Promise.all([
      importVerifiedBg3dModelsAtomicallyV12([glbFile("a.glb", "a")], {
        authority,
        idFactory: () => "model-a",
        now: 1,
      }),
      importVerifiedBg3dModelsAtomicallyV12([glbFile("b.glb", "b")], {
        authority,
        idFactory: () => "model-b",
        now: 2,
      }),
    ]);
    expect((await listStoredBg3dModelsV12({ authority })).map(({ id }) => id).sort())
      .toEqual(["model-a", "model-b"]);
  });

  it("rejects same-length CAS tampering by rehashing before hydration", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const authority = authorityFor(database, fileSystem);
    const [saved] = await importVerifiedBg3dModelsAtomicallyV12([glbFile("tamper.glb", "tamper")], {
      authority,
      idFactory: () => "model-tamper",
      now: 1,
    });
    const blobPath = [...fileSystem.snapshot().keys()].find((path) =>
      path.includes(saved!.contentHash.slice("sha256:".length)));
    expect(blobPath).toBeDefined();
    const bytes = fileSystem.snapshot().get(blobPath!)!;
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    await fileSystem.write(blobPath!, bytes);
    await expect(getStoredBg3dModelByHashV12(saved!.contentHash, { authority }))
      .rejects.toMatchObject({ code: "corrupt" });
  });

  it("publishes deletion evidence manifest-last and removes model ownership", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const authority = authorityFor(database, fileSystem);
    const [saved] = await importVerifiedBg3dModelsAtomicallyV12([glbFile("delete.glb", "delete")], {
      authority,
      idFactory: () => "model-delete",
      now: 1,
    });
    await deleteStoredBg3dModelV12("model-delete", { authority, now: 3 });
    expect(await getStoredBg3dModelByHashV12(saved!.contentHash, { authority })).toBeNull();
    expect(await getBg3dModelDeletionReceiptByHashV12(saved!.contentHash, { authority }))
      .toMatchObject({ storageModelId: "model-delete", deletedAt: 3 });
  });

  it("restores old owner refs after a forced SQLite manifest fault and permits bounded orphan cleanup", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assets = createStudioOpfsAssetStore({ fs: fileSystem, now: () => 100 });
    const faultingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") return async () => { throw new Error("forced-commit-fault"); };
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const authority = authorityFor(faultingDatabase, fileSystem, { assetStore: assets });
    await expect(authority.mutate("models", () => [], async (context) => {
      const receipt = await context.putBlob(new Uint8Array([1, 2, 3]), "application/octet-stream");
      return { nextRaw: "{}", nextRefs: [receipt.hash], result: undefined };
    })).rejects.toMatchObject({ code: "transaction-failed" });
    expect(await assets.ownerRefs("studio-bg3d-libraries-v12:models")).toEqual([]);
    expect((await assets.sweep({ graceMs: 0 })).removed).toHaveLength(1);
    expect(await database.kvGet(
      STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
      STUDIO_BG3D_LIBRARY_MANIFEST_KEYS.models,
    )).toBeNull();
  });

  it("returns a created-row disposition when reread proves an unknown kvSet committed", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assets = createStudioOpfsAssetStore({ fs: fileSystem, now: () => 100 });
    const committedUnknownDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            throw new StudioLocalDatabaseCommitOutcomeUnknownError(
              "kvSet",
              new Error("response-channel-lost-after-commit"),
            );
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const authority = authorityFor(committedUnknownDatabase, fileSystem, { assetStore: assets });

    const disposition = await importVerifiedBg3dModelsAtomicallyWithDispositionV12(
      [glbFile("committed-unknown.glb", "committed-unknown")],
      { authority, idFactory: () => "committed-unknown", now: 10 },
    );

    expect(disposition.created).toEqual([{
      id: "committed-unknown",
      contentHash: disposition.records[0]!.contentHash,
    }]);
    await expect(listStoredBg3dModelsV12({ authority })).resolves.toMatchObject([{
      id: "committed-unknown",
    }]);
    await expect(compensateImportedBg3dModelsIfCreationMatchesV12(disposition, { authority }))
      .resolves.toBe(true);
    await expect(listStoredBg3dModelsV12({ authority })).resolves.toEqual([]);
  });

  it("returns a created-row disposition after a generic error from a durable kvSet", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assets = createStudioOpfsAssetStore({ fs: fileSystem, now: () => 100 });
    const genericPostCommitDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            throw new Error("generic-error-after-durable-autocommit");
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const authority = authorityFor(genericPostCommitDatabase, fileSystem, { assetStore: assets });

    const disposition = await importVerifiedBg3dModelsAtomicallyWithDispositionV12(
      [glbFile("generic-post-commit.glb", "generic-post-commit")],
      { authority, idFactory: () => "generic-post-commit", now: 11 },
    );

    expect(disposition.created).toEqual([{
      id: "generic-post-commit",
      contentHash: disposition.records[0]!.contentHash,
    }]);
    await expect(listStoredBg3dModelsV12({ authority })).resolves.toMatchObject([{
      id: "generic-post-commit",
    }]);
    await expect(compensateImportedBg3dModelsIfCreationMatchesV12(disposition, { authority }))
      .resolves.toBe(true);
    await expect(listStoredBg3dModelsV12({ authority })).resolves.toEqual([]);
  });

  it("restores old owner refs when reread proves an unknown kvSet did not commit", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assets = createStudioOpfsAssetStore({ fs: fileSystem, now: () => 100 });
    const uncertainDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async () => {
            throw new StudioLocalDatabaseCommitOutcomeUnknownError(
              "kvSet",
              new Error("response-channel-lost"),
            );
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const authority = authorityFor(uncertainDatabase, fileSystem, { assetStore: assets });
    let uncertainHash = "";

    await expect(authority.mutate("models", () => [], async (context) => {
      const receipt = await context.putBlob(new Uint8Array([4, 5, 6]), "application/octet-stream");
      uncertainHash = receipt.hash;
      return { nextRaw: "{}", nextRefs: [receipt.hash], result: undefined };
    })).rejects.toMatchObject({ code: "transaction-failed" });

    expect(await assets.ownerRefs("studio-bg3d-libraries-v12:models"))
      .toEqual([]);
    expect((await assets.sweep({ graceMs: 0 })).removed)
      .toEqual([expect.objectContaining({ hash: uncertainHash })]);
    expect(await database.kvGet(
      STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
      STUDIO_BG3D_LIBRARY_MANIFEST_KEYS.models,
    )).toBeNull();
  });

  it("returns the durable result and preserves the owner union when final contraction fails", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assets = createStudioOpfsAssetStore({ fs: fileSystem, now: () => 100 });
    const baselineAuthority = authorityFor(database, fileSystem, { assetStore: assets });
    let oldHash: StudioOpfsContentHash = `sha256:${"0".repeat(64)}`;
    await baselineAuthority.mutate("models", () => [], async (context) => {
      const receipt = await context.putBlob(
        new Uint8Array([7, 8, 9]),
        "application/octet-stream",
      );
      oldHash = receipt.hash;
      return { nextRaw: '{"state":"old"}', nextRefs: [receipt.hash], result: undefined };
    });

    let candidatePublished = false;
    const noDiagnosticReadDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            candidatePublished = true;
          };
        }
        if (property === "kvGet") {
          return async (namespace: string, key: string) => {
            if (candidatePublished) throw new Error("forced-post-root-diagnostic-read-fault");
            return target.kvGet(namespace, key);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    let ownerPublicationCalls = 0;
    const contractionFaultStore = new Proxy(assets, {
      get(target, property, receiver) {
        if (property === "setOwnerRefs") {
          return async (...args: Parameters<StudioOpfsAssetStore["setOwnerRefs"]>) => {
            ownerPublicationCalls += 1;
            if (ownerPublicationCalls === 2) throw new Error("forced-final-owner-contraction-fault");
            return target.setOwnerRefs(...args);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const authority = authorityFor(
      noDiagnosticReadDatabase,
      fileSystem,
      { assetStore: contractionFaultStore },
    );
    let candidateHash: StudioOpfsContentHash = `sha256:${"0".repeat(64)}`;
    const disposition = await authority.mutate(
      "models",
      (raw) => raw === '{"state":"old"}' ? [oldHash] : [],
      async (context) => {
        const receipt = await context.putBlob(
          new Uint8Array([10, 11, 12]),
          "application/octet-stream",
        );
        candidateHash = receipt.hash;
        return {
          nextRaw: '{"state":"candidate"}',
          nextRefs: [receipt.hash],
          result: Object.freeze({ createdHash: receipt.hash }),
        };
      },
    );

    expect(disposition).toEqual({ createdHash: candidateHash });
    expect(ownerPublicationCalls).toBe(2);
    expect(await database.kvGet(
      STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
      STUDIO_BG3D_LIBRARY_MANIFEST_KEYS.models,
    )).toBe('{"state":"candidate"}');
    expect(await assets.ownerRefs("studio-bg3d-libraries-v12:models"))
      .toEqual([oldHash, candidateHash].sort());
  });

  it("rejects a CAS quota failure without publishing a model manifest", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const backing = createStudioOpfsAssetStore({ fs: fileSystem });
    const quotaStore = new Proxy(backing, {
      get(target, property, receiver) {
        if (property === "put") {
          return async () => {
            throw new DOMException("forced quota", "QuotaExceededError");
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const authority = authorityFor(database, fileSystem, { assetStore: quotaStore });
    await expect(importVerifiedBg3dModelsAtomicallyV12([glbFile("quota.glb", "quota")], {
      authority,
      idFactory: () => "model-quota",
      now: 1,
    })).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(await database.kvGet(
      STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
      STUDIO_BG3D_LIBRARY_MANIFEST_KEYS.models,
    )).toBeNull();
  });

  it("rejects torn and future model manifests instead of partially recovering rows", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const authority = authorityFor(database, fileSystem);
    await database.kvSet(
      STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
      STUDIO_BG3D_LIBRARY_MANIFEST_KEYS.models,
      '{"kind":"toonspectrum-studio-bg3d-model-library-v12"',
    );
    await expect(listStoredBg3dModelsV12({ authority }))
      .rejects.toMatchObject({ code: "stored-metadata-mismatch" });

    await database.kvSet(
      STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
      STUDIO_BG3D_LIBRARY_MANIFEST_KEYS.metadata,
      JSON.stringify({
        kind: STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND,
        version: 99,
        revision: 0,
        updatedAt: 0,
        records: [],
      }),
    );
    await expect(listStudioBg3dAssetMetadata({ authority }))
      .rejects.toMatchObject({ code: "invalid-stored-metadata" });
  });

  it("round-trips canonical templates and rejects automatic legacy IndexedDB reads", async () => {
    const open = vi.fn(() => { throw new Error("legacy-db-must-not-open"); });
    vi.stubGlobal("indexedDB", { open });
    const filename = `bg3d-template-${crypto.randomUUID()}.sqlite3`;
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const firstDatabase = await openNamedDatabase(filename);
    const firstAuthority = authorityFor(firstDatabase, fileSystem);
    const document = createDefaultStudioBg3dSceneDocument();
    await saveBg3dTemplateV12({ id: "template-a", name: "A", createdAt: 1, document }, {
      authority: firstAuthority,
    });
    await firstDatabase.close();
    databases.delete(firstDatabase);
    const reopenedDatabase = await openNamedDatabase(filename);
    const reopenedAuthority = authorityFor(reopenedDatabase, fileSystem);
    expect(await listBg3dTemplatesV12({ authority: reopenedAuthority }))
      .toMatchObject([{ id: "template-a", name: "A" }]);
    expect(await deleteBg3dTemplateV12("template-a", { authority: reopenedAuthority }))
      .toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it("uses the same default V12 manifest authority for strict asset metadata", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const authority = authorityFor(database, fileSystem);
    const hash = `sha256:${"a".repeat(64)}` as const;
    await putStudioBg3dAssetMetadataAtomically([metadata(hash)], { authority });
    expect(await getStudioBg3dAssetMetadata(hash, { authority })).toMatchObject({
      contentHash: hash,
      favorite: false,
    });
    await updateStudioBg3dAssetFavorite(hash, true, { authority, now: 20 });
    expect(await listStudioBg3dAssetMetadata({ authority })).toMatchObject([{
      contentHash: hash,
      favorite: true,
    }]);
    const raw = await database.kvGet(
      STUDIO_BG3D_LIBRARIES_SQLITE_NAMESPACE,
      STUDIO_BG3D_LIBRARY_MANIFEST_KEYS.metadata,
    );
    expect(raw).toContain(STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND);
  });

  it("fails explicitly instead of treating a memory CAS as durable product storage", async () => {
    const database = await openNamedDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const assets = createStudioOpfsAssetStore({ fs: fileSystem });
    const authority = createStudioBg3dLibrariesAuthority({
      acquireDatabase: async () => database,
      acquireAssetStore: async () => assets,
      runExclusive: runExclusive(),
    });
    await expect(authority.readManifest("models")).rejects.toMatchObject({
      code: "storage-unavailable",
    });
  });

  it("keeps product source imports on V12 aliases rather than ambient IndexedDB functions", async () => {
    const { readFile } = await import("node:fs/promises");
    const [studio, project, download, thumbnail, handoff, metadataStore] = await Promise.all([
      "./studio-bg3d-editor-runtime-bindings.ts",
      "./studio-bg3d-project-library.ts",
      "./studio-bg3d-canonical-glb-download.ts",
      "./studio-bg3d-model-thumbnail-capture.ts",
      "../hybrid-dcc/studio-hybrid-dcc-bg3d-handoff.ts",
      "./studio-bg3d-asset-metadata-store.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
    expect(studio).toContain(
      "getStoredBg3dModelByHashV12 as getStoredBg3dModelByHash",
    );
    expect(studio).toContain("listBg3dTemplatesV12 as listBg3dTemplates");
    expect(project).toContain(
      "importVerifiedBg3dModelsAtomicallyV12 as importVerifiedBg3dModelsAtomically",
    );
    expect(download).toContain(
      "getStoredBg3dModelByHashV12 as getStoredBg3dModelByHash",
    );
    expect(thumbnail).toContain(
      "saveBg3dModelThumbnailIfCurrentV12 as saveBg3dModelThumbnailIfCurrent",
    );
    expect(handoff).toContain(
      "importVerifiedBg3dModelsAtomicallyV12 as importVerifiedBg3dModelsAtomically",
    );
    expect(metadataStore).toContain(
      'Object.prototype.hasOwnProperty.call(options, "indexedDb")',
    );
  });
});
