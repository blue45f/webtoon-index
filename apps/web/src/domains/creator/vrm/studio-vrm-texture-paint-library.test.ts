import {
  IDBFactory,
  IDBObjectStore as FakeIDBObjectStore,
} from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createStudioVrmTexturePaintArtifact,
  decodeStudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifactHash,
} from "./studio-vrm-texture-paint-artifact";
import {
  STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_NAME,
  STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_VERSION,
  STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS,
  STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME,
  deleteStudioVrmTexturePaintLibraryCreationBatchIfMatches,
  getStudioVrmTexturePaintLibraryArtifact,
  saveStudioVrmTexturePaintLibraryArtifact,
} from "./studio-vrm-texture-paint-library";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

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

function ascii(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function pngChunk(
  type: string,
  data: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(12 + data.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.byteLength, false);
  result.set(ascii(type), 4);
  result.set(data, 8);
  view.setUint32(
    result.byteLength - 4,
    crc32(result.subarray(4, result.byteLength - 4)),
    false,
  );
  return result;
}

function concat(
  ...parts: readonly Uint8Array<ArrayBufferLike>[]
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function png(
  width = 1,
  height = 1,
  idat: Uint8Array<ArrayBufferLike> = Uint8Array.from(
    [0x78, 0x9c, 0x63, 0x60, 0, 2, 0, 0, 5, 0, 1],
  ),
): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return concat(
    Uint8Array.from(PNG_SIGNATURE),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array()),
  );
}

async function artifact(
  bindingKey = "vrm/avatar/material/base",
  source = png(),
): Promise<StudioVrmTexturePaintArtifact> {
  return createStudioVrmTexturePaintArtifact({ bindingKey, source });
}

function options(factory: IDBFactory) {
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
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_NAME,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_VERSION,
    );
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRawRecords(factory: IDBFactory): Promise<unknown[]> {
  const database = await openRawDatabase(factory);
  try {
    const transaction = database.transaction(
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME,
      "readonly",
    );
    const request = transaction
      .objectStore(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME)
      .getAll();
    return await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function writeRawRecord(factory: IDBFactory, value: unknown): Promise<void> {
  const database = await openRawDatabase(factory);
  try {
    const transaction = database.transaction(
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME,
      "readwrite",
    );
    transaction
      .objectStore(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME)
      .put(value);
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

describe("studio VRM texture-paint IndexedDB library", () => {
  it("stores only a canonical receipt and PNG Blob, deduplicates by hash, and revalidates reads", async () => {
    const factory = new IDBFactory();
    const bytes = png(32, 16);
    const first = await artifact("vrm/avatar/material/base", bytes);
    const duplicate = await artifact("vrm/avatar/material/detail", bytes);

    const firstSave = await saveStudioVrmTexturePaintLibraryArtifact(
      first,
      options(factory),
    );
    const duplicateSave = await saveStudioVrmTexturePaintLibraryArtifact(
      duplicate,
      options(factory),
    );

    expect(firstSave).toMatchObject({
      deduplicated: false,
      receipt: { contentHash: first.metadata.contentHash },
    });
    expect(duplicateSave).toMatchObject({
      deduplicated: true,
      receipt: {
        bindingKey: duplicate.metadata.bindingKey,
        contentHash: duplicate.metadata.contentHash,
      },
    });
    const records = await readRawRecords(factory);
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0] as object).sort()).toEqual([
      "contentHash",
      "png",
      "receipt",
    ]);
    expect(records[0]).toMatchObject({
      contentHash: first.metadata.contentHash,
      receipt: duplicate.metadata,
    });
    expect((records[0] as { png: unknown }).png).toBeInstanceOf(Blob);
    expect(JSON.stringify(records[0])).not.toMatch(/(?:blob:|data:|rgba|pixels)/iu);

    const loaded = await getStudioVrmTexturePaintLibraryArtifact(
      first.metadata.contentHash,
      options(factory),
    );
    expect(loaded.metadata).toEqual(duplicate.metadata);
    expect(
      new Uint8Array(await loaded.archiveEntry.data.arrayBuffer()),
    ).toEqual(bytes);
    const database = await openRawDatabase(factory);
    expect(
      database
        .transaction(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME, "readonly")
        .objectStore(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME)
        .keyPath,
    ).toBe("contentHash");
    database.close();
  });

  it("issues one-shot creation receipts and preserves a hash after any later legacy reuse", async () => {
    const factory = new IDBFactory();
    const first = await artifact("creation-receipt", png(2, 2));
    const created = await saveStudioVrmTexturePaintLibraryArtifact(first, options(factory));
    expect(created.creationReceipt).toMatchObject({
      authority: "legacy-indexeddb",
      contentHash: first.metadata.contentHash,
    });
    await expect(deleteStudioVrmTexturePaintLibraryCreationBatchIfMatches(
      [created.creationReceipt!],
      [],
      options(factory),
    )).resolves.toBe(true);
    await expect(getStudioVrmTexturePaintLibraryArtifact(
      first.metadata.contentHash,
      options(factory),
    )).rejects.toMatchObject({ code: "ARTIFACT_MISSING" });

    const recreated = await saveStudioVrmTexturePaintLibraryArtifact(first, options(factory));
    await saveStudioVrmTexturePaintLibraryArtifact(first, options(factory));
    await expect(deleteStudioVrmTexturePaintLibraryCreationBatchIfMatches(
      [recreated.creationReceipt!],
      [],
      options(factory),
    )).resolves.toBe(false);
    await expect(getStudioVrmTexturePaintLibraryArtifact(
      first.metadata.contentHash,
      options(factory),
    )).resolves.toMatchObject({ metadata: first.metadata });
  });

  it("rejects non-canonical hashes, URLs, and raw RGBA before opening IndexedDB", async () => {
    const backing = new IDBFactory();
    let opens = 0;
    const factory = delegatedFactory(backing, () => {
      opens += 1;
    });
    const valid = await artifact();
    const malformedHash = `sha256:${"A".repeat(64)}`;

    await expect(getStudioVrmTexturePaintLibraryArtifact(
      malformedHash,
      options(factory),
    )).rejects.toMatchObject({ code: "CONTENT_HASH_INVALID" });
    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      {
        ...valid,
        archiveEntry: { ...valid.archiveEntry, data: "data:image/png;base64,private" },
      } as unknown as StudioVrmTexturePaintArtifact,
      options(factory),
    )).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      {
        ...valid,
        archiveEntry: { ...valid.archiveEntry, data: new Uint8Array([1, 2, 3, 4]) },
      } as unknown as StudioVrmTexturePaintArtifact,
      options(factory),
    )).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      {
        ...valid,
        archiveEntry: { ...valid.archiveEntry, data: "blob:https://private.invalid/id" },
      } as unknown as StudioVrmTexturePaintArtifact,
      options(factory),
    )).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    expect(opens).toBe(0);
  });

  it("fails closed for missing and byte-tampered records", async () => {
    const factory = new IDBFactory();
    const original = await artifact(
      "vrm/avatar/material/base",
      png(4, 4, Uint8Array.from([0x78, 0x9c, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
    );

    await expect(getStudioVrmTexturePaintLibraryArtifact(
      `sha256:${"0".repeat(64)}`,
      options(factory),
    )).rejects.toMatchObject({ code: "ARTIFACT_MISSING" });
    await saveStudioVrmTexturePaintLibraryArtifact(original, options(factory));
    const tampered = new Blob([
      png(4, 4, Uint8Array.from([0x78, 0x9c, 9, 8, 7, 6, 5, 4, 3, 2, 1])),
    ], { type: "image/png" });
    expect(tampered.size).toBe(original.metadata.byteLength);
    await writeRawRecord(factory, {
      contentHash: original.metadata.contentHash,
      receipt: original.metadata,
      png: tampered,
    });

    await expect(getStudioVrmTexturePaintLibraryArtifact(
      original.metadata.contentHash,
      options(factory),
    )).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
  });

  it("uses scene-v5 artifact ceilings without treating the shared cache as one project bundle", async () => {
    expect(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS).toEqual({
      maxArtifactBytes: 96_000_000,
      maxAggregateBytes: 96_000_000,
      maxWidth: 4_096,
      maxHeight: 4_096,
      maxPixels: 16_777_216,
      maxAggregatePixels: 33_554_432,
      maxBindings: 128,
      maxArtifacts: 128,
    });

    const factory = new IDBFactory();
    const first = await artifact(
      "vrm/avatar/material/a",
      png(1, 1, Uint8Array.from([0x78, 0x9c, 1, 2, 3, 4, 5, 6, 7, 8, 9])),
    );
    const second = await artifact(
      "vrm/avatar/material/b",
      png(1, 1, Uint8Array.from([0x78, 0x9c, 9, 8, 7, 6, 5, 4, 3, 2, 1])),
    );
    const boundedOptions = {
      indexedDb: factory,
      limits: {
        maxAggregateBytes: first.metadata.byteLength,
        maxAggregatePixels: 1,
        maxArtifacts: 1,
        maxBindings: 1,
      },
    } as const;
    await saveStudioVrmTexturePaintLibraryArtifact(first, boundedOptions);
    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      second,
      boundedOptions,
    )).resolves.toMatchObject({ deduplicated: false });
    expect(await readRawRecords(factory)).toHaveLength(2);

    const normal = await artifact("vrm/avatar/material/oversized");
    const oversizedDimension = {
      ...normal,
      metadata: { ...normal.metadata, width: 4_097 },
      archiveEntry: {
        ...normal.archiveEntry,
        width: 4_097,
        data: new Blob([png(4_097, 1)], { type: "image/png" }),
      },
    } as StudioVrmTexturePaintArtifact;
    const unopenedBacking = new IDBFactory();
    let opens = 0;
    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      oversizedDimension,
      {
        indexedDb: delegatedFactory(unopenedBacking, () => {
          opens += 1;
        }),
      },
    )).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    expect(opens).toBe(0);

    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      normal,
      {
        indexedDb: delegatedFactory(unopenedBacking, () => {
          opens += 1;
        }),
        limits: { maxArtifactBytes: normal.metadata.byteLength - 1 },
      },
    )).rejects.toMatchObject({ code: "ARTIFACT_INVALID" });
    expect(opens).toBe(0);
  });

  it("honors abort before storage access and closes the operation without a late write", async () => {
    const backing = new IDBFactory();
    let opens = 0;
    const factory = delegatedFactory(backing, () => {
      opens += 1;
    });
    const controller = new AbortController();
    controller.abort("test");
    const valid = await artifact();

    await expect(getStudioVrmTexturePaintLibraryArtifact(
      valid.metadata.contentHash,
      { indexedDb: factory, signal: controller.signal },
    )).rejects.toMatchObject({ code: "ABORTED" });
    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      valid,
      { indexedDb: factory, signal: controller.signal },
    )).rejects.toMatchObject({ code: "ABORTED" });
    expect(opens).toBe(0);
  });

  it("does not return request data when the readonly transaction aborts after request success", async () => {
    const factory = new IDBFactory();
    const valid = await artifact();
    await saveStudioVrmTexturePaintLibraryArtifact(valid, options(factory));

    const originalGet = FakeIDBObjectStore.prototype.get;
    vi.spyOn(FakeIDBObjectStore.prototype, "get").mockImplementation(function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange,
    ) {
      const request = originalGet.call(this, query);
      request.addEventListener("success", () => {
        this.transaction.abort();
      }, { once: true });
      return request;
    });

    await expect(getStudioVrmTexturePaintLibraryArtifact(
      valid.metadata.contentHash,
      options(factory),
    )).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
  });

  it("does not report a save when the write transaction aborts after put success", async () => {
    const factory = new IDBFactory();
    const valid = await artifact();
    const originalPut = FakeIDBObjectStore.prototype.put;
    vi.spyOn(FakeIDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
      request.addEventListener("success", () => {
        this.transaction.abort();
      }, { once: true });
      return request;
    });

    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      valid,
      options(factory),
    )).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
    vi.restoreAllMocks();
    await expect(getStudioVrmTexturePaintLibraryArtifact(
      valid.metadata.contentHash,
      options(factory),
    )).rejects.toMatchObject({ code: "ARTIFACT_MISSING" });
  });

  it("repairs a structurally valid same-hash row by replacing it with verified bytes", async () => {
    const factory = new IDBFactory();
    const valid = await artifact();
    const wrongBytes = new Blob([
      png(1, 1, Uint8Array.from([0x78, 0x9c, 9, 8, 7, 6, 5, 4, 3, 2, 1])),
    ], { type: "image/png" });
    await saveStudioVrmTexturePaintLibraryArtifact(valid, options(factory));
    await writeRawRecord(factory, {
      contentHash: valid.metadata.contentHash,
      receipt: valid.metadata,
      png: wrongBytes,
    });

    const repaired = await saveStudioVrmTexturePaintLibraryArtifact(
      valid,
      options(factory),
    );
    expect(repaired.deduplicated).toBe(true);
    await expect(getStudioVrmTexturePaintLibraryArtifact(
      valid.metadata.contentHash,
      options(factory),
    )).resolves.toMatchObject({ metadata: valid.metadata });
  });

  it("replaces a structurally corrupt same-key row with a verified incoming artifact", async () => {
    const factory = new IDBFactory();
    const valid = await artifact();
    await saveStudioVrmTexturePaintLibraryArtifact(valid, options(factory));
    await writeRawRecord(factory, {
      contentHash: valid.metadata.contentHash,
      receipt: valid.metadata,
      png: valid.archiveEntry.data,
      unexpected: "corrupt row shape",
    });
    await expect(getStudioVrmTexturePaintLibraryArtifact(
      valid.metadata.contentHash,
      options(factory),
    )).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });

    await expect(saveStudioVrmTexturePaintLibraryArtifact(
      valid,
      options(factory),
    )).resolves.toMatchObject({ deduplicated: true });
    await expect(getStudioVrmTexturePaintLibraryArtifact(
      valid.metadata.contentHash,
      options(factory),
    )).resolves.toMatchObject({ metadata: valid.metadata });
    expect(Object.keys((await readRawRecords(factory))[0] as object).sort()).toEqual([
      "contentHash",
      "png",
      "receipt",
    ]);
  });

  it("does not read and hash a verified library Blob again during decode", async () => {
    const factory = new IDBFactory();
    const valid = await artifact();
    await saveStudioVrmTexturePaintLibraryArtifact(valid, options(factory));
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest");
    const loaded = await getStudioVrmTexturePaintLibraryArtifact(
      valid.metadata.contentHash,
      options(factory),
    );
    expect(digest).toHaveBeenCalledOnce();

    await decodeStudioVrmTexturePaintArtifact(
      loaded.metadata,
      loaded.archiveEntry.data,
      {
        dependencies: {
          decode: () => ({
            width: loaded.metadata.width,
            height: loaded.metadata.height,
            data: new Uint8ClampedArray(
              loaded.metadata.width * loaded.metadata.height * 4,
            ),
          }),
        },
      },
    );
    expect(digest).toHaveBeenCalledOnce();
  });

  it("rejects a stored receipt whose hash does not match its strict IndexedDB key", async () => {
    const factory = new IDBFactory();
    const valid = await artifact();
    await saveStudioVrmTexturePaintLibraryArtifact(valid, options(factory));
    const records = await readRawRecords(factory);
    const raw = records[0] as {
      contentHash: StudioVrmTexturePaintArtifactHash;
      receipt: StudioVrmTexturePaintArtifact["metadata"];
      png: Blob;
    };
    await writeRawRecord(factory, {
      ...raw,
      receipt: {
        ...raw.receipt,
        contentHash: `sha256:${"A".repeat(64)}`,
      },
    });

    await expect(getStudioVrmTexturePaintLibraryArtifact(
      valid.metadata.contentHash,
      options(factory),
    )).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
  });
});
