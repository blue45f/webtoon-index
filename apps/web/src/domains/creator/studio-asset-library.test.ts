import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalizeStudioAssetContentHash,
  createAssetRecord,
  createLegacyIndexedDbStudioAssetLibrary,
  ensureStudioAssetContentHash,
  findStudioAssetCandidatesByContentIdentities,
  findStudioAssetCandidatesByContentIdentity,
  hashStudioAssetDataUrl,
  installStudioAssetLibraryPortForTest,
  listAssets,
  normalizeAssetName,
  STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH,
  STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_BYTES,
  STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_CHARS,
  saveAsset,
  STUDIO_ASSET_DATA_URL_MAX_CHARS,
  STUDIO_ASSET_LIBRARY_DB_VERSION,
  type StudioAsset,
} from "./studio-asset-library";

interface FakeAssetDbState {
  records: Map<string, unknown>;
  requestedVersions: number[];
  transactionModes: IDBTransactionMode[];
  getAllCount: number;
  getAllKeysCount: number;
  getCount: number;
  indexGetCount: number;
  indexCreateCount: number;
  writeCount: number;
  failWrites: boolean;
  failIndexCreation: boolean;
  failIndexReads: boolean;
  onIndexRead: (() => void) | null;
  blocked: boolean;
  currentVersion: number;
  hasStore: boolean;
  hasContentHashIndex: boolean;
  closeCount: number;
  triggerVersionChange: () => void;
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;
  onerror: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;

  succeed(result: T) {
    this.result = result;
    this.onsuccess?.call(this as unknown as IDBRequest<T>, new Event("success"));
  }

  fail(message = "fake indexedDB failure") {
    this.error = new DOMException(message, "UnknownError");
    this.onerror?.call(this as unknown as IDBRequest<T>, new Event("error"));
  }
}

class FakeAssetTransaction {
  error: DOMException | null = null;
  oncomplete: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  private pending = 0;
  private completed = false;
  private completionGeneration = 0;
  private aborted = false;

  constructor(
    private readonly state: FakeAssetDbState,
    readonly mode: IDBTransactionMode
  ) {}

  objectStore(): IDBObjectStore {
    return new FakeAssetStore(this.state, this) as unknown as IDBObjectStore;
  }

  abort(): void {
    this.aborted = true;
    this.abortWithError(new DOMException("upgrade aborted", "AbortError"));
  }

  get wasAborted(): boolean {
    return this.aborted;
  }

  schedule<T>(operation: () => T, write = false): IDBRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    this.completionGeneration += 1;
    queueMicrotask(() => {
      if (write && this.state.failWrites) {
        request.fail("write failed");
        this.abortWithError(request.error ?? undefined);
        return;
      }
      try {
        request.succeed(operation());
      } catch (error) {
        request.fail(error instanceof Error ? error.message : undefined);
        this.abortWithError(request.error ?? undefined);
        return;
      }
      this.pending -= 1;
      this.scheduleCompletionCheck();
    });
    return request as unknown as IDBRequest<T>;
  }

  private scheduleCompletionCheck() {
    const generation = this.completionGeneration;
    queueMicrotask(() => {
      if (this.completed || this.pending > 0 || generation !== this.completionGeneration) return;
      this.completed = true;
      this.oncomplete?.call(this as unknown as IDBTransaction, new Event("complete"));
    });
  }

  private abortWithError(error?: DOMException) {
    if (this.completed) return;
    this.completed = true;
    this.error = error ?? new DOMException("transaction aborted", "AbortError");
    this.onabort?.call(this as unknown as IDBTransaction, new Event("abort"));
  }
}

class FakeAssetStore {
  constructor(
    private readonly state: FakeAssetDbState,
    private readonly transaction: FakeAssetTransaction
  ) {}

  readonly indexNames = {
    contains: (name: string) => name === "contentHash" && this.state.hasContentHashIndex,
  } as unknown as DOMStringList;

  createIndex(name: string): IDBIndex {
    if (name !== "contentHash" || this.state.failIndexCreation) {
      throw new DOMException("index creation failed", "ConstraintError");
    }
    this.state.hasContentHashIndex = true;
    this.state.indexCreateCount += 1;
    return new FakeAssetIndex(this.state, this.transaction) as unknown as IDBIndex;
  }

  index(name: string): IDBIndex {
    if (name !== "contentHash" || !this.state.hasContentHashIndex) {
      throw new DOMException("index missing", "NotFoundError");
    }
    return new FakeAssetIndex(this.state, this.transaction) as unknown as IDBIndex;
  }

  getAll(): IDBRequest<unknown[]> {
    return this.transaction.schedule(() => {
      this.state.getAllCount += 1;
      return Array.from(this.state.records.values());
    });
  }

  get(id: string): IDBRequest<unknown> {
    return this.transaction.schedule(() => {
      this.state.getCount += 1;
      return this.state.records.get(id);
    });
  }

  getAllKeys(_query?: IDBValidKey | IDBKeyRange | null, count?: number): IDBRequest<IDBValidKey[]> {
    return this.transaction.schedule<IDBValidKey[]>(() => {
      this.state.getAllKeysCount += 1;
      return Array.from(this.state.records.keys()).slice(0, count) as IDBValidKey[];
    });
  }

  put(value: StudioAsset): IDBRequest<IDBValidKey> {
    return this.transaction.schedule<IDBValidKey>(() => {
      this.state.records.set(value.id, { ...value });
      this.state.writeCount += 1;
      return value.id;
    }, true);
  }

  delete(id: string): IDBRequest<undefined> {
    return this.transaction.schedule(() => {
      this.state.records.delete(id);
      this.state.writeCount += 1;
      return undefined;
    }, true);
  }
}

class FakeAssetIndex {
  constructor(
    private readonly state: FakeAssetDbState,
    private readonly transaction: FakeAssetTransaction
  ) {}

  get(contentHash: string): IDBRequest<unknown> {
    return this.transaction.schedule(() => {
      this.state.indexGetCount += 1;
      return Array.from(this.state.records.values()).find((candidate) => (
        candidate
        && typeof candidate === "object"
        && (candidate as { contentHash?: unknown }).contentHash === contentHash
      ));
    });
  }

  getAll(contentHash: string, count?: number): IDBRequest<unknown[]> {
    return this.transaction.schedule(() => {
      this.state.indexGetCount += 1;
      this.state.onIndexRead?.();
      if (this.state.failIndexReads) {
        throw new DOMException("index read failed", "UnknownError");
      }
      return Array.from(this.state.records.values()).filter((candidate) => (
        candidate
        && typeof candidate === "object"
        && (candidate as { contentHash?: unknown }).contentHash === contentHash
      )).slice(0, count);
    });
  }
}

class FakeAssetDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => name === "assets" && this.state.hasStore,
  } as unknown as DOMStringList;
  onversionchange: ((this: IDBDatabase, event: IDBVersionChangeEvent) => unknown) | null = null;

  constructor(private readonly state: FakeAssetDbState) {}

  createObjectStore(): IDBObjectStore {
    this.state.hasStore = true;
    return new FakeAssetStore(
      this.state,
      new FakeAssetTransaction(this.state, "versionchange")
    ) as unknown as IDBObjectStore;
  }

  transaction(_store: string, mode: IDBTransactionMode = "readonly"): IDBTransaction {
    this.state.transactionModes.push(mode);
    return new FakeAssetTransaction(this.state, mode) as unknown as IDBTransaction;
  }

  close() {
    this.state.closeCount += 1;
  }
}

function installFakeIndexedDb(
  seed: readonly StudioAsset[] = [],
  options: {
    failWrites?: boolean;
    failIndexCreation?: boolean;
    failIndexReads?: boolean;
    onIndexRead?: () => void;
    blocked?: boolean;
    currentVersion?: number;
    hasStore?: boolean;
    hasContentHashIndex?: boolean;
  } = {}
): FakeAssetDbState {
  const state: FakeAssetDbState = {
    records: new Map(seed.map((asset) => [asset.id, { ...asset }])),
    requestedVersions: [],
    transactionModes: [],
    getAllCount: 0,
    getAllKeysCount: 0,
    getCount: 0,
    indexGetCount: 0,
    indexCreateCount: 0,
    writeCount: 0,
    failWrites: options.failWrites ?? false,
    failIndexCreation: options.failIndexCreation ?? false,
    failIndexReads: options.failIndexReads ?? false,
    onIndexRead: options.onIndexRead ?? null,
    blocked: options.blocked ?? false,
    currentVersion: options.currentVersion ?? STUDIO_ASSET_LIBRARY_DB_VERSION,
    hasStore: options.hasStore ?? true,
    hasContentHashIndex: options.hasContentHashIndex ?? true,
    closeCount: 0,
    triggerVersionChange: () => undefined,
  };
  const database = new FakeAssetDatabase(state);
  state.triggerVersionChange = () => database.onversionchange?.call(
    database as unknown as IDBDatabase,
    new Event("versionchange") as IDBVersionChangeEvent
  );
  const factory = {
    open: (_name: string, version: number) => {
      state.requestedVersions.push(version);
      const request = new FakeRequest<IDBDatabase>() as FakeRequest<IDBDatabase> & {
        onupgradeneeded: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
        onblocked: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
        transaction: IDBTransaction | null;
      };
      request.onupgradeneeded = null;
      request.onblocked = null;
      request.transaction = null;
      queueMicrotask(() => {
        request.result = database as unknown as IDBDatabase;
        if (state.blocked) {
          request.onblocked?.call(
            request as unknown as IDBOpenDBRequest,
            new Event("blocked") as IDBVersionChangeEvent
          );
          return;
        }
        if (version > state.currentVersion) {
          const upgrade = new FakeAssetTransaction(state, "versionchange");
          request.transaction = upgrade as unknown as IDBTransaction;
          request.onupgradeneeded?.call(
            request as unknown as IDBOpenDBRequest,
            new Event("upgradeneeded") as IDBVersionChangeEvent
          );
          if (upgrade.wasAborted) {
            request.fail("upgrade aborted");
            return;
          }
          state.currentVersion = version;
          request.transaction = null;
        }
        request.succeed(database as unknown as IDBDatabase);
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as IDBFactory;
  vi.stubGlobal("indexedDB", factory);
  installStudioAssetLibraryPortForTest(
    createLegacyIndexedDbStudioAssetLibrary({ indexedDB: factory }),
  );
  return state;
}

afterEach(() => {
  installStudioAssetLibraryPortForTest(null);
  vi.unstubAllGlobals();
});

describe("studio-asset-library pure helpers", () => {
  describe("normalizeAssetName", () => {
    it("should strip common image extensions case-insensitively", () => {
      expect(normalizeAssetName("my-cat.png")).toBe("my-cat");
      expect(normalizeAssetName("sunset.JPEG")).toBe("sunset");
      expect(normalizeAssetName("animation.gif")).toBe("animation");
      expect(normalizeAssetName("vector.svg")).toBe("vector");
      expect(normalizeAssetName("photo.webp")).toBe("photo");
      expect(normalizeAssetName("image.avif")).toBe("image");
    });

    it("should handle names without extensions", () => {
      expect(normalizeAssetName("my-cool-asset")).toBe("my-cool-asset");
    });

    it("should fallback to '내 에셋' if name becomes empty after stripping", () => {
      expect(normalizeAssetName(".png")).toBe("내 에셋");
      expect(normalizeAssetName("   ")).toBe("내 에셋");
    });
  });

  describe("createAssetRecord", () => {
    it("should round dimensions and enforce a minimum of 1", () => {
      const record = createAssetRecord({
        name: "test.png",
        dataUrl: "data:image/png;base64,abc",
        width: 100.4,
        height: 200.6,
      });

      expect(record.name).toBe("test");
      expect(record.dataUrl).toBe("data:image/png;base64,abc");
      expect(record.width).toBe(100);
      expect(record.height).toBe(201);
      expect(record.id).toBeDefined();
      expect(record.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("should enforce a minimum dimension of 1", () => {
      const record = createAssetRecord({
        name: "test.png",
        dataUrl: "data:image/png;base64,abc",
        width: -5,
        height: 0.1,
      });

      expect(record.width).toBe(1);
      expect(record.height).toBe(1);
    });

    it("should carry kind='ai' for generative-AI outputs (label/badge) and omit it otherwise", () => {
      const ai = createAssetRecord({
        name: "magic.webp",
        dataUrl: "data:image/webp;base64,abc",
        width: 1024,
        height: 1024,
        kind: "ai",
      });
      expect(ai.kind).toBe("ai");

      const upload = createAssetRecord({
        name: "upload.png",
        dataUrl: "data:image/png;base64,abc",
        width: 64,
        height: 64,
      });
      expect(upload.kind).toBeUndefined();
    });

    it("should allow overriding id and now", () => {
      const mockId = "custom-id";
      const mockNow = 1234567890;
      const record = createAssetRecord(
        {
          name: "test.png",
          dataUrl: "data:image/png;base64,abc",
          width: 100,
          height: 100,
        },
        mockId,
        mockNow
      );

      expect(record.id).toBe(mockId);
      expect(record.createdAt).toBe(mockNow);
    });
  });
});

describe("studio asset durable content identity", () => {
  const helloHash = `sha256:${"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}` as const;

  it("canonicalizes only exact SHA-256 identities", () => {
    const uppercaseHex = "A".repeat(64);
    expect(canonicalizeStudioAssetContentHash(` SHA256:${uppercaseHex} `)).toBe(
      `sha256:${"a".repeat(64)}`
    );
    expect(canonicalizeStudioAssetContentHash(uppercaseHex)).toBeNull();
    expect(canonicalizeStudioAssetContentHash(`sha256:${"a".repeat(63)}`)).toBeNull();
    expect(canonicalizeStudioAssetContentHash("sha256:not-a-digest")).toBeNull();
  });

  it("hashes decoded bytes so equivalent base64 and percent payloads share identity", async () => {
    await expect(hashStudioAssetDataUrl("data:text/plain,hello")).resolves.toBe(helloHash);
    await expect(hashStudioAssetDataUrl("data:application/octet-stream;base64,aGVsbG8=")).resolves.toBe(
      helloHash
    );
    await expect(hashStudioAssetDataUrl("data:application/octet-stream;base64,aGVs%62G8=")).resolves.toBe(
      helloHash
    );

    const rawByteHash = await hashStudioAssetDataUrl("data:application/octet-stream,%FF");
    await expect(hashStudioAssetDataUrl("data:application/octet-stream;base64,/w==")).resolves.toBe(
      rawByteHash
    );
  });

  it("rejects malformed and non-data URLs without producing an identity", async () => {
    await expect(hashStudioAssetDataUrl("https://example.test/image.png")).rejects.toThrow(
      "데이터 URL"
    );
    await expect(hashStudioAssetDataUrl("data:image/png;base64,%%%")).rejects.toThrow("Base64");
    await expect(hashStudioAssetDataUrl("data:text/plain,bad%2")).rejects.toThrow("퍼센트");
  });

  it("rejects oversized raw, percent, and base64 data URLs before decoding", async () => {
    const oversizedPayload = "A".repeat(STUDIO_ASSET_DATA_URL_MAX_CHARS);

    await expect(hashStudioAssetDataUrl(`data:text/plain,${oversizedPayload}`))
      .rejects.toThrow("크기가 제한");
    await expect(hashStudioAssetDataUrl(`data:text/plain,%41${oversizedPayload}`))
      .rejects.toThrow("크기가 제한");
    await expect(hashStudioAssetDataUrl(`data:application/octet-stream;base64,${oversizedPayload}`))
      .rejects.toThrow("크기가 제한");
  });

  it("reuses and canonicalizes an existing hash without mutating the source record", async () => {
    const source = createAssetRecord(
      {
        name: "legacy.png",
        dataUrl: "not-needed-when-hash-exists",
        width: 10,
        height: 10,
        contentHash: `SHA256:${"A".repeat(64)}`,
      },
      "asset-existing",
      1
    );
    const ensured = await ensureStudioAssetContentHash(source);

    expect(ensured.contentHash).toBe(`sha256:${"a".repeat(64)}`);
    expect(source.contentHash).toBe(`sha256:${"a".repeat(64)}`);
    expect(ensured).toBe(source);
  });

  it("migrates DB v1 to v2 in place, preserves rows, and queries the new hash index", async () => {
    const portable = createAssetRecord({
      name: "portable.png",
      dataUrl: "data:text/plain,hello",
      width: 20,
      height: 20,
      contentHash: helloHash,
    }, "portable-v1", 7);
    const state = installFakeIndexedDb([portable], {
      currentVersion: 1,
      hasContentHashIndex: false,
    });

    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
    })).resolves.toEqual([portable]);

    expect(state.requestedVersions).toEqual([STUDIO_ASSET_LIBRARY_DB_VERSION]);
    expect(state.currentVersion).toBe(STUDIO_ASSET_LIBRARY_DB_VERSION);
    expect(state.hasContentHashIndex).toBe(true);
    expect(state.indexCreateCount).toBe(1);
    expect(state.records.get(portable.id)).toEqual(portable);
    expect(state.writeCount).toBe(0);
    expect(state.indexGetCount).toBe(1);
    expect(state.getAllCount).toBe(0);
  });

  it("fails closed and preserves DB v1 data when hash-index migration fails", async () => {
    const portable = createAssetRecord({
      name: "portable.png",
      dataUrl: "data:text/plain,hello",
      width: 20,
      height: 20,
      contentHash: helloHash,
    }, "portable-v1", 7);
    const state = installFakeIndexedDb([portable], {
      currentVersion: 1,
      hasContentHashIndex: false,
      failIndexCreation: true,
    });

    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
    })).rejects.toThrow("index creation failed");

    expect(state.currentVersion).toBe(1);
    expect(state.hasContentHashIndex).toBe(false);
    expect(state.records.get(portable.id)).toEqual(portable);
    expect(state.transactionModes).toEqual([]);
    expect(state.getAllCount).toBe(0);
    expect(state.indexGetCount).toBe(0);
  });

  it("fails closed without reading rows when a DB upgrade is blocked by another tab", async () => {
    const state = installFakeIndexedDb([], {
      blocked: true,
      currentVersion: 1,
      hasContentHashIndex: false,
    });

    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
    })).rejects.toThrow("차단");

    expect(state.currentVersion).toBe(1);
    expect(state.transactionModes).toEqual([]);
    expect(state.getAllCount).toBe(0);
    expect(state.getCount).toBe(0);
    expect(state.indexGetCount).toBe(0);
  });

  it("closes an opened connection when another tab requests a version change", async () => {
    const state = installFakeIndexedDb();
    await saveAsset({
      name: "hello.png",
      dataUrl: "data:text/plain,hello",
      width: 1,
      height: 1,
    });
    expect(state.closeCount).toBe(1);

    state.triggerVersionChange();

    expect(state.closeCount).toBe(2);
  });

  it("requires a computed content hash for every new save in DB v2", async () => {
    const state = installFakeIndexedDb();
    const saved = await saveAsset({
      name: "hello.png",
      dataUrl: "data:text/plain;base64,aGVsbG8=",
      width: 32,
      height: 16,
    });

    expect(saved.contentHash).toBe(helloHash);
    expect(state.records.get(saved.id)).toMatchObject({ contentHash: helloHash });
    expect(state.requestedVersions).toEqual([STUDIO_ASSET_LIBRARY_DB_VERSION]);
    expect(state.transactionModes).toEqual(["readwrite"]);
  });

  it("accepts a previously verified SHA-256 so remote imports do not decode and hash the same bytes twice", async () => {
    const state = installFakeIndexedDb();
    const verifiedHash = `sha256:${"d".repeat(64)}` as const;
    const saved = await saveAsset({
      name: "verified.png",
      dataUrl: "data:image/png;base64,AQID",
      width: 1,
      height: 1,
      contentHash: verifiedHash,
    });

    expect(saved.contentHash).toBe(verifiedHash);
    expect(state.records.get(saved.id)).toMatchObject({ contentHash: verifiedHash });
  });

  it("backfills valid legacy rows without allowing an unhashable row to break the list", async () => {
    const legacyValid = createAssetRecord(
      {
        name: "valid.png",
        dataUrl: "data:text/plain,hello",
        width: 20,
        height: 20,
      },
      "valid",
      20
    );
    const legacyCorrupt = createAssetRecord(
      {
        name: "corrupt.png",
        dataUrl: "not-a-data-url",
        width: 20,
        height: 20,
      },
      "corrupt",
      10
    );
    const state = installFakeIndexedDb([legacyCorrupt, legacyValid]);

    const listed = await listAssets();

    expect(listed.map(({ id }) => id)).toEqual(["valid", "corrupt"]);
    expect(listed[0].contentHash).toBe(helloHash);
    expect(listed[1].contentHash).toBeUndefined();
    expect(state.records.get("valid")).toMatchObject({ contentHash: helloHash });
    expect(state.records.get("corrupt")).not.toHaveProperty("contentHash");
    expect(state.transactionModes).toEqual(["readonly", "readwrite"]);
    expect(state.writeCount).toBe(1);

    await listAssets();
    expect(state.transactionModes).toEqual(["readonly", "readwrite", "readonly"]);
    expect(state.writeCount).toBe(1);
  });

  it("returns backfilled hashes even when opportunistic persistence fails", async () => {
    const legacy = createAssetRecord(
      {
        name: "legacy.png",
        dataUrl: "data:text/plain,hello",
        width: 20,
        height: 20,
      },
      "legacy",
      1
    );
    const state = installFakeIndexedDb([legacy], { failWrites: true });

    await expect(listAssets()).resolves.toMatchObject([{ id: "legacy", contentHash: helloHash }]);
    expect(state.records.get("legacy")).not.toHaveProperty("contentHash");
  });

  it("resolves one bounded hash row and one exact id row without cloning the library", async () => {
    const hashMatch = createAssetRecord(
      {
        name: "hash.png",
        dataUrl: "data:image/png;base64,aGFzaA==",
        width: 10,
        height: 10,
        contentHash: helloHash,
      },
      "hash-match",
      2
    );
    const idFallback = createAssetRecord(
      {
        name: "legacy.png",
        dataUrl: "data:image/png;base64,bGVnYWN5",
        width: 10,
        height: 10,
      },
      "legacy-id",
      1
    );
    const unrelated = Array.from({ length: 100 }, (_, index) => createAssetRecord(
      {
        name: `unrelated-${index}.png`,
        dataUrl: `data:image/png;base64,dW5yZWxhdGVkL${index}`,
        width: 10,
        height: 10,
        contentHash: `sha256:${String(index).padStart(64, "0")}`,
      },
      `unrelated-${index}`,
      index + 10
    ));
    const state = installFakeIndexedDb([hashMatch, idFallback, ...unrelated]);

    const candidates = await findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
      assetId: idFallback.id,
    });

    expect(candidates.map(({ id }) => id)).toEqual([hashMatch.id, idFallback.id]);
    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.getCount).toBe(1);
    expect(state.indexGetCount).toBe(1);
    expect(state.transactionModes).toEqual(["readonly", "readonly"]);
  });

  it("returns later exact-key duplicates after a stale first row so byte verification can recover", async () => {
    const stale = createAssetRecord({
      name: "stale.png",
      dataUrl: "data:text/plain,stale",
      width: 1,
      height: 1,
      contentHash: helloHash,
    }, "a-stale", 1);
    const valid = createAssetRecord({
      name: "valid.png",
      dataUrl: "data:text/plain,hello",
      width: 1,
      height: 1,
      contentHash: helloHash,
    }, "b-valid", 2);
    const state = installFakeIndexedDb([stale, valid]);

    const candidates = await findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
    });
    const verifiedIds: string[] = [];
    for (const candidate of candidates) {
      if (await hashStudioAssetDataUrl(candidate.dataUrl) === helloHash) {
        verifiedIds.push(candidate.id);
      }
    }

    expect(candidates.map(({ id }) => id)).toEqual([stale.id, valid.id]);
    expect(verifiedIds).toEqual([valid.id]);
    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.indexGetCount).toBe(1);
  });

  it("keeps DB v1 legacy rows available through the exact id fallback and deduplicates matches", async () => {
    const legacy = createAssetRecord(
      {
        name: "legacy.png",
        dataUrl: "data:image/png;base64,bGVnYWN5",
        width: 10,
        height: 10,
      },
      "legacy-id",
      1
    );
    const indexed = { ...legacy, contentHash: helloHash } satisfies StudioAsset;

    const legacyState = installFakeIndexedDb([legacy]);
    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
      assetId: legacy.id,
    })).resolves.toEqual([legacy]);
    expect(legacyState.getAllCount).toBe(0);
    expect(legacyState.getAllKeysCount).toBe(0);
    expect(legacyState.getCount).toBe(1);
    expect(legacyState.indexGetCount).toBe(1);

    const indexedState = installFakeIndexedDb([indexed]);
    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
      assetId: indexed.id,
    })).resolves.toEqual([indexed]);
    expect(indexedState.getCount).toBe(1);
    expect(indexedState.getAllCount).toBe(0);
    expect(indexedState.getAllKeysCount).toBe(0);
    expect(indexedState.indexGetCount).toBe(1);
  });

  it("does not scan legacy unhashed rows without an exact id", async () => {
    const missingHash = `sha256:${"f".repeat(64)}`;
    const unrelated = Array.from({ length: 600 }, (_, index) => createAssetRecord(
      {
        name: `unrelated-${index}.png`,
        dataUrl: "data:image/png;base64,dW5yZWxhdGVk",
        width: 10,
        height: 10,
      },
      `unrelated-${index}`,
      index
    ));
    const state = installFakeIndexedDb(unrelated);

    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: missingHash,
    })).resolves.toEqual([]);

    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.getCount).toBe(0);
    expect(state.indexGetCount).toBe(1);
  });

  it("recovers indexed hashes after the 513th row without scanning the object store", async () => {
    const hashB = `sha256:${"b".repeat(64)}` as const;
    const unrelated = Array.from({ length: 513 }, (_, index) => createAssetRecord(
      {
        name: `unrelated-${index}.png`,
        dataUrl: "data:image/png;base64,dW5yZWxhdGVk",
        width: 10,
        height: 10,
        contentHash: `sha256:${String(index).padStart(64, "0")}`,
      },
      `unrelated-${index}`,
      index
    ));
    const targetA = createAssetRecord({
      name: "target-a.png",
      dataUrl: "data:image/png;base64,YQ==",
      width: 1,
      height: 1,
      contentHash: helloHash,
    }, "target-a", 514);
    const middle = Array.from({ length: 17 }, (_, index) => createAssetRecord(
      {
        name: `middle-${index}.png`,
        dataUrl: "data:image/png;base64,bWlkZGxl",
        width: 1,
        height: 1,
      },
      `middle-${index}`,
      515 + index
    ));
    const targetB = createAssetRecord({
      name: "target-b.png",
      dataUrl: "data:image/png;base64,Yg==",
      width: 1,
      height: 1,
      contentHash: hashB,
    }, "target-b", 532);
    const state = installFakeIndexedDb([...unrelated, targetA, ...middle, targetB]);

    const candidates = await findStudioAssetCandidatesByContentIdentities([
      { contentHash: helloHash },
      { contentHash: hashB },
    ]);

    expect(candidates.get(helloHash)?.map(({ id }) => id)).toEqual([targetA.id]);
    expect(candidates.get(hashB)?.map(({ id }) => id)).toEqual([targetB.id]);
    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.getCount).toBe(0);
    expect(state.indexGetCount).toBe(2);
    expect(state.transactionModes).toEqual(["readonly"]);
  });

  it("bounds duplicate exact-key candidates and deduplicates an exact-id row", async () => {
    const duplicates = Array.from(
      { length: STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH + 3 },
      (_, index) => createAssetRecord({
        name: `duplicate-${index}.png`,
        dataUrl: `data:image/png;base64,ZHVwbGljYXRlL${index}`,
        width: 1,
        height: 1,
        contentHash: helloHash,
      }, `duplicate-${index}`, index)
    );
    const state = installFakeIndexedDb(duplicates);

    const candidates = await findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
      assetId: duplicates[0]?.id,
    });

    expect(candidates).toHaveLength(STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH);
    expect(candidates.map(({ id }) => id)).toEqual(
      duplicates
        .slice(0, STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH)
        .map(({ id }) => id)
    );
    expect(new Set(candidates.map(({ id }) => id)).size).toBe(candidates.length);
    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.indexGetCount).toBe(1);
  });

  it("caps aggregate returned data URL characters and UTF-8 bytes without a store scan", async () => {
    const prefix = "data:image/png;base64,";
    const largeDataUrl = prefix + "A".repeat(STUDIO_ASSET_DATA_URL_MAX_CHARS - prefix.length);
    const duplicates = Array.from({ length: 3 }, (_, index) => createAssetRecord({
      name: `large-${index}.png`,
      dataUrl: largeDataUrl,
      width: 1,
      height: 1,
      contentHash: helloHash,
    }, `large-${index}`, index));
    const state = installFakeIndexedDb(duplicates);

    const candidates = await findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
    });

    expect(STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_CHARS).toBe(
      STUDIO_ASSET_DATA_URL_MAX_CHARS * 2
    );
    expect(STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_BYTES).toBe(
      STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_CHARS
    );
    expect(candidates.map(({ id }) => id)).toEqual(["large-0", "large-1"]);
    expect(candidates.reduce((total, candidate) => total + candidate.dataUrl.length, 0)).toBe(
      STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_CHARS
    );
    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.indexGetCount).toBe(1);
  });

  it("keeps every distinct exact-id fallback for one hash so callers can verify legacy bytes", async () => {
    const stale = createAssetRecord({
      name: "stale.png",
      dataUrl: "data:image/png;base64,c3RhbGU=",
      width: 1,
      height: 1,
    }, "stale-id", 1);
    const valid = createAssetRecord({
      name: "valid.png",
      dataUrl: "data:image/png;base64,dmFsaWQ=",
      width: 1,
      height: 1,
    }, "valid-id", 2);
    const state = installFakeIndexedDb([stale, valid]);

    const candidates = await findStudioAssetCandidatesByContentIdentities([
      { contentHash: helloHash, assetId: stale.id },
      { contentHash: helloHash, assetId: valid.id },
    ]);

    expect(candidates.get(helloHash)?.map(({ id }) => id)).toEqual([stale.id, valid.id]);
    expect(state.getCount).toBe(2);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.indexGetCount).toBe(1);
  });

  it("fails closed before opening IndexedDB for a malformed content identity", async () => {
    const state = installFakeIndexedDb();

    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: "sha256:not-a-hash",
      assetId: "legacy-id",
    })).resolves.toEqual([]);

    expect(state.requestedVersions).toEqual([]);
    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.getCount).toBe(0);
  });

  it("does not start a targeted lookup after its caller aborts", async () => {
    const state = installFakeIndexedDb();
    const controller = new AbortController();
    controller.abort();

    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
      assetId: "legacy-id",
      signal: controller.signal,
    })).resolves.toEqual([]);

    expect(state.requestedVersions).toEqual([]);
    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.getCount).toBe(0);
  });

  it("drops every candidate when the caller aborts during the exact-key index read", async () => {
    const controller = new AbortController();
    const indexed = createAssetRecord({
      name: "indexed.png",
      dataUrl: "data:text/plain,hello",
      width: 1,
      height: 1,
      contentHash: helloHash,
    }, "indexed", 1);
    const state = installFakeIndexedDb([indexed], {
      onIndexRead: () => controller.abort(),
    });

    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
      signal: controller.signal,
    })).resolves.toEqual([]);

    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.indexGetCount).toBe(1);
  });

  it("fails closed to the exact-id fallback when the content-hash index read fails", async () => {
    const legacy = createAssetRecord({
      name: "legacy.png",
      dataUrl: "data:text/plain,hello",
      width: 1,
      height: 1,
    }, "legacy", 1);
    const state = installFakeIndexedDb([legacy], { failIndexReads: true });

    await expect(findStudioAssetCandidatesByContentIdentity({
      contentHash: helloHash,
      assetId: legacy.id,
    })).resolves.toEqual([legacy]);

    expect(state.getAllCount).toBe(0);
    expect(state.getAllKeysCount).toBe(0);
    expect(state.getCount).toBe(1);
    expect(state.indexGetCount).toBe(1);
  });
});
