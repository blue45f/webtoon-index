import { afterEach, describe, expect, it, vi } from "vitest";

import { openStudioLocalDatabase } from "../studio-local-database";
import { createStudioOpfsAssetStore } from "../studio-opfs-asset-store";
import { createStudioOpfsMemoryFileSystem } from "../studio-opfs-filesystem";

import {
  STUDIO_VRM_ASSET_CAS_OWNER,
  createStudioVrmAssetSqliteOpfsRepository,
  STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
  STUDIO_VRM_MODEL_ASSET_LIMITS,
  STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
  STUDIO_VRM_TEXTURE_ASSET_LIMITS,
  STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
  studioVrmAssetCommitPath,
  type SaveStudioVrmModelAssetInput,
  type StudioVrmAssetHash,
} from "./studio-vrm-asset-sqlite-opfs-repository";
import { createStudioVrmTexturePaintArtifact } from "./studio-vrm-texture-paint-artifact";
import {
  deleteStudioVrmTexturePaintLibraryCreationBatchIfMatches,
  getStudioVrmTexturePaintLibraryArtifact,
  saveStudioVrmTexturePaintLibraryArtifact,
} from "./studio-vrm-texture-paint-library";
import {
  getStoredVrmModel,
  hydrateVrmLibraryThumbnailWindow,
  listVrmLibraryEntries,
  queryUploadedVrmLibraryEntriesPage,
  saveVerifiedVrmBlob,
  saveVerifiedVrmBlobWithDisposition,
} from "./vrm-library";

import type { StudioLocalDatabase } from "../studio-local-database";
import type { StudioOpfsFileSystem } from "../studio-opfs-filesystem";

const opened: StudioLocalDatabase[] = [];

async function memoryDatabase(): Promise<StudioLocalDatabase> {
  const database = await openStudioLocalDatabase({ vfs: "memory" });
  opened.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.close()));
  vi.restoreAllMocks();
});

function concat(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function makeVrmBytes(version: 0 | 1, nonce = "a"): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" },
    extensions: version === 0 ? { VRM: {} } : { VRMC_vrm: { specVersion: "1.0" } },
    extras: { nonce },
  }));
  const paddedLength = Math.ceil(json.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  bytes.fill(0x20, 20 + json.byteLength);
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<StudioVrmAssetHash> {
  const owned = Uint8Array.from(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function modelInput(
  id = "model-alpha",
  nonce = id,
  timestamp = 10,
): Promise<SaveStudioVrmModelAssetInput> {
  const bytes = makeVrmBytes(1, nonce);
  return {
    id,
    name: `Model ${id}`,
    bytes,
    expectedHash: await sha256(bytes),
    validationVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(12 + data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.byteLength, false);
  result.set(Uint8Array.from(type, (character) => character.charCodeAt(0)), 4);
  result.set(data, 8);
  view.setUint32(result.byteLength - 4, crc32(result.subarray(4, -4)), false);
  return result;
}

function png(width = 1, height = 1): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat(
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", Uint8Array.from([0x78, 0x9c, 0x63, 0x60, 0, 2, 0, 0, 5, 0, 1])),
    pngChunk("IEND", new Uint8Array()),
  );
}

async function repositoryFixture(options: {
  readonly fileSystem?: StudioOpfsFileSystem;
  readonly now?: () => number;
  readonly database?: StudioLocalDatabase;
} = {}) {
  const database = options.database ?? await memoryDatabase();
  const fileSystem = options.fileSystem ?? createStudioOpfsMemoryFileSystem();
  const repository = createStudioVrmAssetSqliteOpfsRepository({
    acquireDatabase: async () => database,
    fileSystem,
    ...(options.now ? { now: options.now } : {}),
  });
  return { database, fileSystem, repository };
}

describe("VRM asset SQLite/OPFS repository", () => {
  it("round-trips a VRM through real sqlite-wasm metadata and OPFS CAS bytes", async () => {
    const { database, fileSystem, repository } = await repositoryFixture();
    const input = await modelInput();

    await expect(repository.saveModel(input)).resolves.toMatchObject({
      deduplicated: false,
      metadata: {
        id: input.id,
        contentHash: input.expectedHash,
        byteSize: input.bytes.byteLength,
        hasThumbnail: false,
      },
    });
    const loaded = await repository.getModel(input.id);
    expect(loaded?.bytes).toEqual(input.bytes);
    expect(await repository.getModelByHash(input.expectedHash)).toMatchObject({ id: input.id });

    const raw = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const root = JSON.parse(raw ?? "null") as { pages?: Array<{ key?: string }> } | null;
    const pageKey = root?.pages?.[0]?.key;
    expect(pageKey).toBeTruthy();
    const page = await database.kvGet(STUDIO_VRM_MODEL_SQLITE_NAMESPACE, pageKey!);
    expect(page).toContain(input.expectedHash);
    expect(raw).not.toContain("base64");
    expect(page).not.toContain("base64");
    expect(await fileSystem.list("blobs/")).toHaveLength(1);
    expect(await fileSystem.read(studioVrmAssetCommitPath(input.expectedHash))).not.toBeNull();
  });

  it("compare-deletes only an exact private id + canonical hash compensation receipt", async () => {
    const { repository } = await repositoryFixture();
    const input = await modelInput("archive-created-row", "archive-created-row");
    await repository.saveModel(input);
    const otherHash = `sha256:${"f".repeat(64)}` as const;

    await expect(repository.deleteModelIfIdentityMatches(input.id, otherHash)).resolves.toBe(false);
    await expect(repository.getModel(input.id)).resolves.toMatchObject({ id: input.id });
    await expect(
      repository.deleteModelIfIdentityMatches(input.id, input.expectedHash),
    ).resolves.toBe(true);
    await expect(repository.getModel(input.id)).resolves.toBeNull();
  });

  it("reopens the same SQLite manifest and OPFS root without legacy probing", async () => {
    const fixture = await repositoryFixture();
    const input = await modelInput("model-reopen");
    await fixture.repository.saveModel(input);
    await fixture.repository.close();
    await expect(fixture.repository.getModel(input.id)).rejects.toMatchObject({ code: "closed" });

    const reopened = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => fixture.database,
      fileSystem: fixture.fileSystem,
    });
    await expect(reopened.getModel(input.id)).resolves.toMatchObject({
      id: input.id,
      contentHash: input.expectedHash,
      bytes: input.bytes,
    });
  });

  it("promotes a canonical v1 root to paged v2 on the next mutation", async () => {
    const { database, repository } = await repositoryFixture();
    await database.kvSet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
      JSON.stringify({
        kind: "toonspectrum.studio-vrm-model-asset-manifest",
        version: 1,
        generation: 0,
        models: [],
        sampleThumbnails: [],
      }),
    );
    await repository.saveModel(await modelInput("v1-promoted"));

    const rootRaw = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    expect(JSON.parse(rootRaw ?? "null")).toMatchObject({
      version: 2,
      generation: 1,
      totalModels: 1,
      pages: [{ count: 1 }],
    });
  });

  it("deduplicates exact model bytes without replacing the original display identity", async () => {
    const { repository } = await repositoryFixture();
    const first = await modelInput("model-first", "same");
    const duplicate = { ...await modelInput("model-second", "same"), name: "Other Name" };
    await repository.saveModel(first);

    await expect(repository.saveModel(duplicate)).resolves.toMatchObject({
      deduplicated: true,
      metadata: { id: first.id, name: first.name },
    });
    await expect(repository.listModelMetadata()).resolves.toHaveLength(1);
  });

  it("stores and reopens 513 mixed-punctuation ids across canonical metadata pages", async () => {
    const fixture = await repositoryFixture();
    const ids = [
      ...Array.from(
        { length: STUDIO_VRM_MODEL_ASSET_LIMITS.maxModels - 1 },
        (_, index) => `x_${index.toString().padStart(3, "0")}`,
      ),
      "x~000",
      "x0000",
    ];
    const inputs = await Promise.all(ids.map((id, index) =>
      modelInput(id, `paged-${index}`, index + 1)));
    for (const input of inputs) await fixture.repository.saveModel(input);

    await expect(fixture.repository.listModelMetadata()).resolves.toHaveLength(513);
    const firstPage = await fixture.repository.queryModelMetadataPage();
    expect(firstPage).toMatchObject({ totalCount: 513 });
    expect(firstPage?.items).toHaveLength(512);
    if (!firstPage?.nextCursor) throw new Error("Expected a second VRM model metadata page.");
    const secondPage = await fixture.repository.queryModelMetadataPage({
      cursor: firstPage.nextCursor,
    });
    expect(secondPage?.items).toHaveLength(1);
    expect(secondPage?.items[0]?.id).toBe("x~000");
    expect(secondPage?.nextCursor).toBeNull();

    const rootRaw = await fixture.database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    expect(JSON.parse(rootRaw ?? "null")).toMatchObject({
      version: 2,
      totalModels: 513,
      pages: [{ count: 512 }, { count: 1 }],
    });
    const reopened = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => fixture.database,
      fileSystem: fixture.fileSystem,
    });
    await expect(reopened.getModel("x~000")).resolves.toMatchObject({ id: "x~000" });
    await expect(reopened.getModel("x0000")).resolves.toMatchObject({ id: "x0000" });
    await fixture.repository.saveModel(await modelInput("x~001", "paged-513", 514));
    await expect(fixture.repository.queryModelMetadataPage({
      cursor: firstPage.cursor,
    })).resolves.toBeNull();
    await expect(fixture.database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      firstPage.cursor,
    )).resolves.toBeNull();
  }, 60_000);

  it("stores uploaded and bundled thumbnails as verified CAS blobs, not SQLite base64", async () => {
    const { database, repository } = await repositoryFixture();
    const input = await modelInput("model-thumb");
    await repository.saveModel(input);
    const thumbnail = {
      bytes: Uint8Array.from([1, 2, 3, 4]),
      mimeType: "image/png" as const,
    };
    await repository.saveThumbnail(input.id, thumbnail, 20);
    await repository.saveThumbnail("sample-vrm", thumbnail, 21);

    await expect(repository.getThumbnail(input.id)).resolves.toEqual(thumbnail);
    await expect(repository.getThumbnail("sample-vrm")).resolves.toEqual(thumbnail);
    const raw = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    expect(raw).not.toContain("AQIDBA");
  });

  it("round-trips a verified texture receipt while PNG bytes remain in OPFS", async () => {
    const { database, repository } = await repositoryFixture();
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "material:0/baseColor",
      source: png(2, 3),
      expectedWidth: 2,
      expectedHeight: 3,
    });
    const bytes = new Uint8Array(await artifact.archiveEntry.data.arrayBuffer());

    await expect(repository.saveTexture({ receipt: artifact.metadata, bytes })).resolves
      .toMatchObject({ receipt: artifact.metadata, deduplicated: false });
    await expect(repository.getTexture(artifact.metadata.contentHash)).resolves.toEqual({
      receipt: artifact.metadata,
      bytes,
    });
    const raw = await database.kvGet(
      STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    expect(raw).toContain(artifact.metadata.contentHash);
    expect(raw).not.toContain("iVBOR");
  });

  it("batch-compensates only contiguous texture creations and refuses later/interleaved writes", async () => {
    const firstFixture = await repositoryFixture();
    const createArtifact = async (bindingKey: string, width: number) => {
      const value = await createStudioVrmTexturePaintArtifact({
        bindingKey,
        source: png(width, 1),
        expectedWidth: width,
        expectedHeight: 1,
      });
      return {
        value,
        bytes: new Uint8Array(await value.archiveEntry.data.arrayBuffer()),
      };
    };
    const first = await createArtifact("atomic:first", 2);
    const second = await createArtifact("atomic:second", 3);
    const firstSave = await firstFixture.repository.saveTexture({
      receipt: first.value.metadata,
      bytes: first.bytes,
    });
    const secondSave = await firstFixture.repository.saveTexture({
      receipt: second.value.metadata,
      bytes: second.bytes,
    });
    expect(firstSave).toMatchObject({ created: true, generation: 1 });
    expect(secondSave).toMatchObject({ created: true, generation: 2 });
    await expect(firstFixture.repository.deleteTexturesIfCreationBatchMatches(
      [
        { contentHash: first.value.metadata.contentHash, generation: firstSave.generation },
        { contentHash: second.value.metadata.contentHash, generation: secondSave.generation },
      ],
      [firstSave.generation, secondSave.generation],
    )).resolves.toBe(true);
    await expect(firstFixture.repository.getTexture(first.value.metadata.contentHash)).resolves.toBeNull();
    await expect(firstFixture.repository.getTexture(second.value.metadata.contentHash)).resolves.toBeNull();

    const racedFixture = await repositoryFixture();
    const racedFirst = await racedFixture.repository.saveTexture({
      receipt: first.value.metadata,
      bytes: first.bytes,
    });
    const external = await createArtifact("external", 4);
    await racedFixture.repository.saveTexture({
      receipt: external.value.metadata,
      bytes: external.bytes,
    });
    const racedSecond = await racedFixture.repository.saveTexture({
      receipt: second.value.metadata,
      bytes: second.bytes,
    });
    await expect(racedFixture.repository.deleteTexturesIfCreationBatchMatches(
      [
        { contentHash: first.value.metadata.contentHash, generation: racedFirst.generation },
        { contentHash: second.value.metadata.contentHash, generation: racedSecond.generation },
      ],
      [racedFirst.generation, racedSecond.generation],
    )).resolves.toBe(false);
    await expect(racedFixture.repository.getTexture(first.value.metadata.contentHash))
      .resolves.toMatchObject({ receipt: first.value.metadata });

    const laterWrite = await racedFixture.repository.saveTexture({
      receipt: second.value.metadata,
      bytes: second.bytes,
    });
    expect(laterWrite.created).toBe(false);
    await expect(racedFixture.repository.deleteTextureIfCreationMatches(
      second.value.metadata.contentHash,
      racedSecond.generation,
    )).resolves.toBe(false);
    await expect(racedFixture.repository.getTexture(second.value.metadata.contentHash))
      .resolves.toMatchObject({ receipt: second.value.metadata });
  });

  it("returns and compensates the product creation receipt when abort races after durable texture commit", async () => {
    const database = await memoryDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const controller = new AbortController();
    let abortAfterRoot = true;
    let closeRepository: () => Promise<void> = async () => {};
    const abortingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            if (
              namespace === STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE
              && key === STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY
              && abortAfterRoot
            ) {
              abortAfterRoot = false;
              controller.abort();
              await closeRepository();
            }
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const repository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => abortingDatabase,
      fileSystem,
    });
    closeRepository = () => repository.close();
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "archive:abort-after-root/baseColor",
      source: png(2, 2),
      expectedWidth: 2,
      expectedHeight: 2,
    });

    const saved = await saveStudioVrmTexturePaintLibraryArtifact(artifact, {
      repository,
      signal: controller.signal,
    });
    expect(controller.signal.aborted).toBe(true);
    expect(saved).toMatchObject({
      deduplicated: false,
      creationReceipt: { authority: "sqlite-opfs", generation: 1 },
      mutationGeneration: 1,
    });
    expect(saved.creationReceipt).not.toBeNull();
    const reopened = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
    });
    await expect(deleteStudioVrmTexturePaintLibraryCreationBatchIfMatches(
      [saved.creationReceipt!],
      [saved.mutationGeneration!],
      { repository: reopened },
    )).resolves.toBe(true);
    await expect(reopened.getTexture(artifact.metadata.contentHash)).resolves.toBeNull();
  });

  it("returns a created VRM disposition when close races immediately after durable model commit", async () => {
    const database = await memoryDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    let closeAfterRoot = true;
    let closeRepository: () => Promise<void> = async () => {};
    const closingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            if (
              namespace === STUDIO_VRM_MODEL_SQLITE_NAMESPACE
              && key === STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY
              && closeAfterRoot
            ) {
              closeAfterRoot = false;
              await closeRepository();
            }
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const repository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => closingDatabase,
      fileSystem,
    });
    closeRepository = () => repository.close();
    const input = await modelInput("archive-model-close-after-root");

    const saved = await saveVerifiedVrmBlobWithDisposition({
      name: input.name,
      blob: new Blob([Uint8Array.from(input.bytes).buffer], { type: "model/gltf-binary" }),
      expectedHash: input.expectedHash,
    }, { repository });
    expect(saved).toMatchObject({
      created: true,
      record: { contentHash: input.expectedHash },
    });
    const reopened = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
    });
    await expect(reopened.getModelByHash(input.expectedHash)).resolves.toMatchObject({
      contentHash: input.expectedHash,
    });
    await expect(reopened.deleteModelIfIdentityMatches(
      saved.record.id,
      input.expectedHash,
    )).resolves.toBe(true);
  });

  it("keeps the texture creation disposition when post-root diagnostic reads are unavailable", async () => {
    const database = await memoryDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    let rejectPostRootReads = false;
    const diagnosticFaultDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            if (
              namespace === STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE
              && key === STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY
            ) rejectPostRootReads = true;
          };
        }
        if (property === "kvGet") {
          return (namespace: string, key: string) => {
            if (
              rejectPostRootReads
              && namespace === STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE
              && key === STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY
            ) return Promise.reject(new Error("post-root diagnostic read unavailable"));
            return target.kvGet(namespace, key);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const repository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => diagnosticFaultDatabase,
      fileSystem,
    });
    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "archive:no-post-root-read/baseColor",
      source: png(3, 2),
      expectedWidth: 3,
      expectedHeight: 2,
    });
    const bytes = new Uint8Array(await artifact.archiveEntry.data.arrayBuffer());

    await expect(repository.saveTexture({ receipt: artifact.metadata, bytes })).resolves
      .toMatchObject({ created: true, generation: 1 });
    const reopened = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
    });
    await expect(reopened.getTexture(artifact.metadata.contentHash)).resolves
      .toMatchObject({ receipt: artifact.metadata });
  });

  it("stores 129 texture artifacts across bounded metadata pages", async () => {
    const { database, fileSystem, repository } = await repositoryFixture();
    let lastHash = "";
    for (let index = 0; index < STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifacts + 1; index += 1) {
      const artifact = await createStudioVrmTexturePaintArtifact({
        bindingKey: `material:${index}/baseColor`,
        source: png(index + 1, 1),
        expectedWidth: index + 1,
        expectedHeight: 1,
      });
      const bytes = new Uint8Array(await artifact.archiveEntry.data.arrayBuffer());
      await repository.saveTexture({ receipt: artifact.metadata, bytes });
      lastHash = artifact.metadata.contentHash;
    }

    const firstPage = await repository.queryTextureMetadataPage();
    expect(firstPage).toMatchObject({ totalCount: 129 });
    expect(firstPage?.items).toHaveLength(128);
    if (!firstPage?.nextCursor) throw new Error("Expected a second VRM texture metadata page.");
    const secondPage = await repository.queryTextureMetadataPage({
      cursor: firstPage.nextCursor,
    });
    expect(secondPage?.items).toHaveLength(1);
    expect(secondPage?.nextCursor).toBeNull();
    await expect(repository.getTexture(lastHash)).resolves.toMatchObject({
      receipt: { contentHash: lastHash },
    });

    const reads: Array<{ namespace: string; key: string }> = [];
    const countingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvGet") {
          return (namespace: string, key: string) => {
            reads.push({ namespace, key });
            return target.kvGet(namespace, key);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const reopened = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => countingDatabase,
      fileSystem,
    });
    await expect(reopened.getTexture(lastHash)).resolves.toMatchObject({
      receipt: { contentHash: lastHash },
    });
    expect(reads.filter((read) => read.namespace === STUDIO_VRM_MODEL_SQLITE_NAMESPACE))
      .toEqual([]);
    expect(reads.filter((read) => read.namespace === STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE))
      .toHaveLength(2);
    expect(reads.filter((read) => (
      read.namespace === STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE
      && read.key !== STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY
    ))).toHaveLength(1);
  }, 60_000);

  it("drives both public product library facades without touching an available legacy IDB", async () => {
    const { repository } = await repositoryFixture();
    const indexedDbOpen = vi.fn(() => {
      throw new Error("legacy IndexedDB must not open");
    });
    vi.stubGlobal("indexedDB", { open: indexedDbOpen });
    const modelBytes = makeVrmBytes(1, "facade");
    const modelBlob = new Blob([modelBytes.buffer], { type: "model/gltf-binary" });
    const saved = await saveVerifiedVrmBlob(
      { name: "Facade.vrm", blob: modelBlob },
      { repository },
    );
    await expect(getStoredVrmModel(saved.id, { repository })).resolves.toMatchObject({
      id: saved.id,
      contentHash: saved.contentHash,
    });
    await expect(listVrmLibraryEntries({ repository })).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: saved.id,
        source: "sqlite-opfs",
      })]),
    );
    await expect(queryUploadedVrmLibraryEntriesPage({ repository })).resolves.toMatchObject({
      items: [expect.objectContaining({
        id: saved.id,
        source: "sqlite-opfs",
        thumbnail: null,
      })],
      totalCount: 1,
    });
    await repository.saveThumbnail(saved.id, {
      bytes: Uint8Array.from([1, 2, 3, 4]),
      mimeType: "image/png",
    }, Date.now());
    const thumbnailPage = await queryUploadedVrmLibraryEntriesPage({ repository });
    await expect(hydrateVrmLibraryThumbnailWindow(
      thumbnailPage?.items ?? [],
      { repository },
    )).resolves.toEqual([
      expect.objectContaining({
        id: saved.id,
        thumbnail: "data:image/png;base64,AQIDBA==",
      }),
    ]);
    await expect(hydrateVrmLibraryThumbnailWindow(
      Array.from({ length: 13 }, () => thumbnailPage!.items[0]!),
      { repository },
    )).rejects.toMatchObject({ code: "limit" });

    const artifact = await createStudioVrmTexturePaintArtifact({
      bindingKey: "material:facade/baseColor",
      source: png(),
    });
    await saveStudioVrmTexturePaintLibraryArtifact(artifact, { repository });
    await expect(getStudioVrmTexturePaintLibraryArtifact(
      artifact.metadata.contentHash,
      { repository },
    )).resolves.toMatchObject({ metadata: artifact.metadata });
    expect(indexedDbOpen).not.toHaveBeenCalled();
  });

  it("rejects a blob whose bytes no longer match its content-addressed hash", async () => {
    const { fileSystem, repository } = await repositoryFixture();
    const input = await modelInput("model-corrupt");
    await repository.saveModel(input);
    const [blobPath] = await fileSystem.list("blobs/");
    if (!blobPath) throw new Error("missing blob path");
    await fileSystem.write(blobPath, Uint8Array.from(input.bytes, (byte) => byte ^ 0xff));

    await expect(repository.getModel(input.id)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects corrupt and noncanonical commit markers", async () => {
    const { fileSystem, repository } = await repositoryFixture();
    const input = await modelInput("model-marker");
    await repository.saveModel(input);
    await fileSystem.write(
      studioVrmAssetCommitPath(input.expectedHash),
      new TextEncoder().encode('{"version":2}'),
    );
    await expect(repository.getModel(input.id)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("does not publish a SQLite manifest when the OPFS commit-marker write tears", async () => {
    const database = await memoryDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem({ failWriteAfter: 3 });
    const repository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
      orphanGraceMs: 0,
    });
    const input = await modelInput("model-torn-marker");

    await expect(repository.saveModel(input)).rejects.toBeTruthy();
    await expect(database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    )).resolves.toBeNull();
    expect(await fileSystem.list("blobs/")).toHaveLength(1);

    fileSystem.restart();
    const cleanupRepository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
      orphanGraceMs: 0,
    });
    await expect(cleanupRepository.cleanupOrphans({ maxRemovals: 1, graceMs: 0 }))
      .resolves.toMatchObject({ removedAssets: 1 });
    expect(await fileSystem.list("blobs/")).toEqual([]);
  });

  it("leaves a recoverable orphan when SQLite fails after blob and marker commit", async () => {
    const database = await memoryDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return (namespace: string, key: string, value: string) =>
            key === STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY
              ? Promise.reject(new Error("SQLITE_FULL"))
              : target.kvSet(namespace, key, value);
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const repository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => failingDatabase,
      fileSystem,
      orphanGraceMs: 0,
    });
    const input = await modelInput("model-sql-fail");

    await expect(repository.saveModel(input)).rejects.toBeTruthy();
    expect(await fileSystem.read(studioVrmAssetCommitPath(input.expectedHash))).not.toBeNull();
    await expect(database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    )).resolves.toBeNull();
    const cleanupRepository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
      orphanGraceMs: 0,
    });
    await expect(cleanupRepository.cleanupOrphans({ maxRemovals: 1, graceMs: 0 }))
      .resolves.toMatchObject({ removedAssets: 1 });
  });

  it("acknowledges a root that became durable before SQLite surfaced an I/O failure", async () => {
    const database = await memoryDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    let failAfterDurableRoot = true;
    const ambiguousDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            if (key === STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY && failAfterDurableRoot) {
              failAfterDurableRoot = false;
              throw new Error("SQLITE_IOERR_AFTER_SYNC");
            }
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const repository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => ambiguousDatabase,
      fileSystem,
    });
    const input = await modelInput("durable-root");

    await expect(repository.saveModel(input)).resolves.toMatchObject({
      metadata: { id: input.id },
    });
    await expect(repository.getModel(input.id)).resolves.toMatchObject({
      id: input.id,
      contentHash: input.expectedHash,
    });
  });

  it("preserves first-generation pages and union refs when root durability cannot be read back", async () => {
    const database = await memoryDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    let rejectRootReads = false;
    const ambiguousDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "kvSet") {
          return async (namespace: string, key: string, value: string) => {
            await target.kvSet(namespace, key, value);
            if (key === STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY) {
              rejectRootReads = true;
              throw new Error("SQLITE_IOERR_AFTER_SYNC");
            }
          };
        }
        if (property === "kvGet") {
          return (namespace: string, key: string) => {
            if (key === STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY && rejectRootReads) {
              return Promise.reject(new Error("SQLITE_IOERR_READBACK"));
            }
            return target.kvGet(namespace, key);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const repository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => ambiguousDatabase,
      fileSystem,
    });
    const input = await modelInput("ambiguous-first-root");

    await expect(repository.saveModel(input)).rejects.toThrow("SQLITE_IOERR_AFTER_SYNC");
    const rootRaw = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const root = JSON.parse(rootRaw ?? "null") as { pages?: Array<{ key?: string }> } | null;
    const pageKey = root?.pages?.[0]?.key;
    expect(pageKey).toBeTruthy();
    await expect(database.kvGet(STUDIO_VRM_MODEL_SQLITE_NAMESPACE, pageKey!))
      .resolves.toContain(input.expectedHash);
    await expect(createStudioOpfsAssetStore({ fs: fileSystem }).ownerRefs(
      STUDIO_VRM_ASSET_CAS_OWNER,
    )).resolves.toContain(input.expectedHash);

    const reopened = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
    });
    await expect(reopened.getModel(input.id)).resolves.toMatchObject({
      id: input.id,
      contentHash: input.expectedHash,
    });
  });

  it("rejects corrupt, future, unknown-field, and noncanonical SQLite manifests", async () => {
    const { database, repository } = await repositoryFixture();
    const invalidRows = [
      "{",
      JSON.stringify({
        kind: "toonspectrum.studio-vrm-model-asset-manifest",
        version: 2,
        generation: 0,
        models: [],
        sampleThumbnails: [],
      }),
      JSON.stringify({
        kind: "toonspectrum.studio-vrm-model-asset-manifest",
        version: 1,
        generation: 0,
        models: [],
        sampleThumbnails: [],
        renderer: { scene: "forbidden" },
      }),
      JSON.stringify({
        version: 1,
        kind: "toonspectrum.studio-vrm-model-asset-manifest",
        generation: 0,
        models: [],
        sampleThumbnails: [],
      }, null, 2),
    ];
    for (const row of invalidRows) {
      await database.kvSet(
        STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
        STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
        row,
      );
      await expect(repository.listModelMetadata()).rejects.toMatchObject({ code: "corrupt" });
    }
  });

  it("rejects a missing or checksum-mismatched v2 metadata page", async () => {
    const { database, repository } = await repositoryFixture();
    await repository.saveModel(await modelInput("page-corrupt"));
    const rootRaw = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const root = JSON.parse(rootRaw ?? "null") as { pages?: Array<{ key?: string }> };
    const pageKey = root.pages?.[0]?.key;
    if (!pageKey) throw new Error("Expected a VRM model metadata page.");
    await database.kvSet(STUDIO_VRM_MODEL_SQLITE_NAMESPACE, pageKey, "{}");

    await expect(repository.listModelMetadata()).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects v2 descriptor aliasing and aggregate metadata overflow before page reads", async () => {
    const { database, repository } = await repositoryFixture();
    await repository.saveModel(await modelInput("root-preflight"));
    const rootRaw = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    const root = JSON.parse(rootRaw ?? "null") as {
      generation: number;
      pages: Array<{ key: string; checksum: string; byteLength: number }>;
    };
    const descriptor = root.pages[0]!;
    await database.kvSet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
      JSON.stringify({
        ...root,
        pages: [{
          ...descriptor,
          key: `manifest-v2-model-page-${root.generation + 1}-0-${descriptor.checksum}`,
        }],
      }),
    );
    await expect(repository.queryModelMetadataPage()).rejects.toMatchObject({ code: "corrupt" });

    await database.kvSet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
      JSON.stringify({
        ...root,
        pages: [{
          ...descriptor,
          byteLength: STUDIO_VRM_MODEL_ASSET_LIMITS.maxManifestBytes,
        }],
      }),
    );
    await expect(repository.queryModelMetadataPage()).rejects.toMatchObject({ code: "corrupt" });
  });

  it("rejects an over-budget v1 aggregate before a mutation can promote it to v2", async () => {
    const { database, fileSystem, repository } = await repositoryFixture();
    const models = Array.from({ length: 129 }, (_, index) => {
      const contentHash = `sha256:${(index + 1).toString(16).padStart(64, "0")}`;
      return {
        id: `oversized-${index.toString().padStart(3, "0")}`,
        name: `Oversized ${index}`,
        contentHash,
        byteSize: STUDIO_VRM_MODEL_ASSET_LIMITS.maxModelBytes,
        mimeType: "model/gltf-binary",
        validationVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        blob: {
          hash: contentHash,
          byteLength: STUDIO_VRM_MODEL_ASSET_LIMITS.maxModelBytes,
          mimeType: "model/gltf-binary",
        },
        thumbnail: null,
      };
    });
    await database.kvSet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
      JSON.stringify({
        kind: "toonspectrum.studio-vrm-model-asset-manifest",
        version: 1,
        generation: 0,
        models,
        sampleThumbnails: [],
      }),
    );

    await expect(repository.saveThumbnail("oversized-000", {
      bytes: Uint8Array.from([1]),
      mimeType: "image/png",
    }, 2)).rejects.toMatchObject({ code: "corrupt" });
    expect(await fileSystem.list("blobs/")).toEqual([]);
  });

  it("serializes concurrent repository instances and preserves both manifest generations", async () => {
    const database = await memoryDatabase();
    const fileSystem = createStudioOpfsMemoryFileSystem();
    const first = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
    });
    const second = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: async () => database,
      fileSystem,
    });
    const [firstInput, secondInput] = await Promise.all([
      modelInput("race-first"),
      modelInput("race-second"),
    ]);

    await Promise.all([first.saveModel(firstInput), second.saveModel(secondInput)]);
    await expect(first.listModelMetadata()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "race-first" }),
      expect.objectContaining({ id: "race-second" }),
    ]));
    const raw = await database.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    expect(JSON.parse(raw ?? "null")).toMatchObject({ generation: 2 });
  });

  it("bounds orphan collection instead of deleting an unbounded library in one pass", async () => {
    const { fileSystem, repository } = await repositoryFixture({ now: () => 1_000 });
    const first = await modelInput("orphan-first", "one");
    const second = await modelInput("orphan-second", "two");
    await repository.saveModel(first);
    await repository.saveModel(second);
    await repository.deleteModel(first.id);
    await repository.deleteModel(second.id);

    await expect(repository.cleanupOrphans({ maxRemovals: 1, graceMs: 0 }))
      .resolves.toMatchObject({ removedAssets: 1 });
    expect(await fileSystem.list("blobs/")).toHaveLength(1);
    await expect(repository.cleanupOrphans({ maxRemovals: 1, graceMs: 0 }))
      .resolves.toMatchObject({ removedAssets: 1 });
    expect(await fileSystem.list("blobs/")).toEqual([]);
  });

  it("fails closed when shared SQLite or native OPFS is unavailable", async () => {
    const repository = createStudioVrmAssetSqliteOpfsRepository({
      acquireDatabase: () => Promise.reject(new Error("OPFS unavailable")),
      fileSystem: createStudioOpfsMemoryFileSystem(),
    });
    await expect(repository.listModelMetadata()).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("현재 탭 메모리 임시"),
    });
  });
});
