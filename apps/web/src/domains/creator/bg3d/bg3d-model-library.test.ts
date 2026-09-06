import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BG3D_MODEL_LEGACY_EXTERNAL_STATUS_MESSAGE,
  BG3D_MODEL_LIBRARY_DB_VERSION,
  BG3D_MODEL_MIN_GLB_BYTES,
  BG3D_MODEL_STORAGE_VERSION,
  BG3D_MODEL_VALIDATION_VERSION,
  Bg3dModelLibraryError,
  legacyAdmitStoredBg3dModelForRendering as admitStoredBg3dModelForRendering,
  canonicalizeBg3dModelHash,
  createBg3dModelThumbnailCaptureRevision,
  createStudioBg3dModelAttachment,
  createUploadedBg3dModelRecord,
  legacyDeleteStoredBg3dModel as deleteStoredBg3dModel,
  detectBg3dModelFormat,
  legacyGetBg3dModelDeletionReceiptByHash as getBg3dModelDeletionReceiptByHash,
  getDeletableModelIds,
  legacyGetCachedBg3dModelThumbnail as getCachedBg3dModelThumbnail,
  legacyGetStoredBg3dModel as getStoredBg3dModel,
  legacyGetStoredBg3dModelByHash as getStoredBg3dModelByHash,
  legacyImportVerifiedBg3dModelsAtomically as importVerifiedBg3dModelsAtomically,
  isVerifiedBg3dModelRecord,
  legacyListBg3dModelLibraryEntries as listBg3dModelLibraryEntries,
  legacyListStoredBg3dModels as listStoredBg3dModels,
  normalizeBg3dModelRights,
  prepareVerifiedBg3dModelRecord,
  revalidateStoredBg3dModelForRendering,
  legacyResolveBg3dModelHash as resolveBg3dModelHash,
  SAMPLE_BG3D_MODEL_ENTRIES,
  SAMPLE_BG3D_MODELS,
  legacySaveUploadedBg3dModel as saveUploadedBg3dModel,
  legacySaveBg3dModelThumbnail as saveBg3dModelThumbnail,
  legacySaveBg3dModelThumbnailIfCurrent as saveBg3dModelThumbnailIfCurrent,
  withDefaultBg3dModelEntry,
  type Bg3dLegacyStoredRecord,
  type Bg3dModelStoredRecord,
  type Bg3dVerifiedStoredRecord,
} from "./bg3d-model-library";
import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  STUDIO_BG3D_GLB_MAX_BYTES,
  STUDIO_BG3D_GLB_MIME_TYPE,
} from "./studio-bg3d-glb-validation";
import { disposeSharedStudioBg3dValidationWorker } from "./studio-bg3d-glb-validation-worker-client";
import { StudioBg3dValidationWorkerTestFixture } from "./studio-bg3d-glb-validation-worker.test-fixture";
import { StudioBg3dModalOperationCoordinator } from "./studio-bg3d-modal-operation-coordinator";
import {
  createDefaultStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

const JSON_CHUNK = 0x4e4f534a;

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true);
}

function validGlb(extras?: Record<string, unknown>): Uint8Array {
  const encodedJson = new TextEncoder().encode(JSON.stringify({
    asset: { version: "2.0" },
    scenes: [{}],
    ...(extras ? { extras } : {}),
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

function glbFile(name = "Commercial Set.glb", bytes = validGlb(), type: string = STUDIO_BG3D_GLB_MIME_TYPE): File {
  return new File([Uint8Array.from(bytes).buffer], name, { type });
}

async function sha256(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes)));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

function thumbnailPng(width = 320, height = 180): Uint8Array {
  const bytes = new Uint8Array(58);
  const view = new DataView(bytes.buffer);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
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

function thumbnailDataUrl(width = 320, height = 180): string {
  let binary = "";
  for (const byte of thumbnailPng(width, height)) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

type StoreName = "deletion-journal" | "models" | "thumbnails";

interface FakeIndexedDbState {
  readonly records: Map<string, unknown>;
  readonly thumbnails: Map<string, unknown>;
  readonly deletionJournal: Map<string, unknown>;
  readonly storeNames: Set<StoreName>;
  readonly transactionModes: IDBTransactionMode[];
  readonly requestedVersions: number[];
  readonly createdIndexes: string[];
  readonly createdStores: StoreName[];
  readonly deletedKeys: string[];
  readonly deletedJournalKeys: string[];
  onDeleteRequest?: () => void;
  onModelHashLookup?: () => void;
  onTransactionCommit?: () => void;
}

class FakeRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;
  onerror: ((this: IDBRequest<T>, event: Event) => unknown) | null = null;

  succeed(result: T): void {
    this.result = result;
    this.onsuccess?.call(this as unknown as IDBRequest<T>, new Event("success"));
  }

  fail(): void {
    this.onerror?.call(this as unknown as IDBRequest<T>, new Event("error"));
  }
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  private pending = 0;
  private completionQueued = false;
  private finished = false;
  private aborting = false;
  private readonly stores = new Map<StoreName, Map<string, unknown>>();
  private readonly deletedKeys: string[] = [];
  private readonly deletedJournalKeys: string[] = [];

  constructor(
    private readonly state: FakeIndexedDbState,
    readonly mode: IDBTransactionMode,
    storeNames: readonly StoreName[],
  ) {
    for (const name of storeNames) {
      this.stores.set(name, new Map(this.stateStore(name)));
    }
    if (mode !== "versionchange") this.queueCompletion();
  }

  objectStore(name: string): IDBObjectStore {
    if (!this.stores.has(name as StoreName)) throw new Error("fake store outside transaction scope");
    return new FakeObjectStore(this.state, this, name as StoreName) as unknown as IDBObjectStore;
  }

  store(name: StoreName): Map<string, unknown> {
    const store = this.stores.get(name);
    if (!store) throw new Error("missing fake transaction store");
    return store;
  }

  recordDelete(name: StoreName, key: string): void {
    if (name === "deletion-journal") this.deletedJournalKeys.push(key);
    else this.deletedKeys.push(key);
  }

  abort(): void {
    if (this.finished) throw new DOMException("Transaction already finished", "InvalidStateError");
    if (this.aborting) return;
    this.aborting = true;
    queueMicrotask(() => {
      if (this.finished) return;
      this.finished = true;
      this.onabort?.call(this as unknown as IDBTransaction, new Event("abort"));
    });
  }

  request<T>(operation: () => T): IDBRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    queueMicrotask(() => {
      if (this.aborting || this.finished) {
        request.fail();
        this.pending -= 1;
        return;
      }
      try {
        request.succeed(operation());
      } catch {
        request.fail();
        this.onerror?.call(this as unknown as IDBTransaction, new Event("error"));
        this.abort();
      } finally {
        this.pending -= 1;
        this.queueCompletion();
      }
    });
    return request as unknown as IDBRequest<T>;
  }

  private queueCompletion(): void {
    if (this.completionQueued || this.finished || this.aborting || this.mode === "versionchange") {
      return;
    }
    this.completionQueued = true;
    queueMicrotask(() => {
      this.completionQueued = false;
      if (this.pending > 0 || this.finished || this.aborting) return;
      this.finished = true;
      if (this.mode === "readwrite") {
        for (const [name, snapshot] of this.stores) {
          const target = this.stateStore(name);
          target.clear();
          for (const [key, value] of snapshot) target.set(key, value);
        }
        this.state.deletedKeys.push(...this.deletedKeys);
        this.state.deletedJournalKeys.push(...this.deletedJournalKeys);
      }
      this.state.onTransactionCommit?.();
      this.oncomplete?.call(this as unknown as IDBTransaction, new Event("complete"));
    });
  }

  private stateStore(name: StoreName): Map<string, unknown> {
    if (name === "models") return this.state.records;
    if (name === "thumbnails") return this.state.thumbnails;
    return this.state.deletionJournal;
  }
}

class FakeObjectStore {
  private readonly indexes = new Set<string>();

  constructor(
    private readonly state: FakeIndexedDbState,
    private readonly transaction: FakeTransaction,
    private readonly name: StoreName,
  ) {
    if (name === "models" && state.createdIndexes.includes("contentHash")) this.indexes.add("contentHash");
  }

  get indexNames(): DOMStringList {
    return { contains: (value: string) => this.indexes.has(value) } as DOMStringList;
  }

  createIndex(name: string): IDBIndex {
    this.indexes.add(name);
    if (!this.state.createdIndexes.includes(name)) this.state.createdIndexes.push(name);
    return this.index(name);
  }

  index(name: string): IDBIndex {
    if (name !== "contentHash") throw new Error("missing fake index");
    return {
      get: (hash: IDBValidKey) =>
        this.transaction.request(() => {
          const result = [...this.transaction.store("models").values()].find(
            (value) =>
              typeof value === "object" &&
              value !== null &&
              "contentHash" in value &&
              value.contentHash === hash,
          );
          this.state.onModelHashLookup?.();
          return result;
        }),
    } as IDBIndex;
  }

  getAll(): IDBRequest<unknown[]> {
    return this.transaction.request(() => [...this.store().values()]);
  }

  get(key: IDBValidKey): IDBRequest<unknown> {
    return this.transaction.request(() => this.store().get(String(key)));
  }

  put(value: unknown): IDBRequest<IDBValidKey> {
    return this.transaction.request<IDBValidKey>(() => {
      if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") {
        throw new Error("invalid fake record");
      }
      this.store().set(value.id, value);
      return value.id;
    });
  }

  add(value: unknown): IDBRequest<IDBValidKey> {
    return this.transaction.request<IDBValidKey>(() => {
      if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") {
        throw new Error("invalid fake record");
      }
      if (this.store().has(value.id)) throw new Error("duplicate fake primary key");
      if (
        "contentHash" in value
        && [...this.store().values()].some((candidate) =>
          typeof candidate === "object"
          && candidate !== null
          && "contentHash" in candidate
          && candidate.contentHash === value.contentHash
        )
      ) {
        throw new Error("duplicate fake content hash");
      }
      this.store().set(value.id, value);
      return value.id;
    });
  }

  delete(key: IDBValidKey): IDBRequest<undefined> {
    const request = this.transaction.request(() => {
      this.store().delete(String(key));
      this.transaction.recordDelete(this.name, String(key));
      return undefined;
    });
    this.state.onDeleteRequest?.();
    return request;
  }

  private store(): Map<string, unknown> {
    return this.transaction.store(this.name);
  }
}

class FakeDatabase {
  readonly objectStoreNames: DOMStringList;

  constructor(private readonly state: FakeIndexedDbState) {
    this.objectStoreNames = {
      contains: (name: string) => state.storeNames.has(name as StoreName),
    } as unknown as DOMStringList;
  }

  createObjectStore(name: string): IDBObjectStore {
    const storeName = name as StoreName;
    this.state.storeNames.add(storeName);
    this.state.createdStores.push(storeName);
    return new FakeObjectStore(
      this.state,
      new FakeTransaction(this.state, "versionchange", [storeName]),
      storeName,
    ) as unknown as IDBObjectStore;
  }

  transaction(stores: string | string[], mode: IDBTransactionMode = "readonly"): IDBTransaction {
    const storeNames = (Array.isArray(stores) ? stores : [stores]) as StoreName[];
    for (const name of storeNames) {
      if (!this.state.storeNames.has(name)) throw new Error(`missing fake store: ${name}`);
    }
    this.state.transactionModes.push(mode);
    return new FakeTransaction(this.state, mode, storeNames) as unknown as IDBTransaction;
  }

  close(): void {
    // In-memory test database intentionally persists between open() calls.
  }
}

function installFakeIndexedDb(seed: readonly Bg3dModelStoredRecord[] = []): FakeIndexedDbState {
  const state: FakeIndexedDbState = {
    records: new Map(seed.map((record) => [record.id, record] as const)),
    thumbnails: new Map(),
    deletionJournal: new Map(),
    storeNames: new Set<StoreName>(["models", "thumbnails"]),
    transactionModes: [],
    requestedVersions: [],
    createdIndexes: [],
    createdStores: [],
    deletedKeys: [],
    deletedJournalKeys: [],
  };
  const database = new FakeDatabase(state);
  let upgraded = false;
  const factory = {
    open: (_name: string, version: number) => {
      state.requestedVersions.push(version);
      const request = new FakeRequest<IDBDatabase>() as FakeRequest<IDBDatabase> & {
        transaction: IDBTransaction | null;
        onupgradeneeded: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
      };
      request.transaction = database.transaction(["models", "thumbnails"], "versionchange");
      request.onupgradeneeded = null;
      queueMicrotask(() => {
        request.result = database as unknown as IDBDatabase;
        if (!upgraded) {
          upgraded = true;
          request.onupgradeneeded?.call(
            request as unknown as IDBOpenDBRequest,
            new Event("upgradeneeded") as IDBVersionChangeEvent,
          );
        }
        request.succeed(database as unknown as IDBDatabase);
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as IDBFactory;
  vi.stubGlobal("indexedDB", factory);
  return state;
}

beforeEach(() => {
  vi.stubGlobal("Worker", StudioBg3dValidationWorkerTestFixture);
});

afterEach(() => {
  disposeSharedStudioBg3dValidationWorker();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bg3d-model-library format and metadata policy", () => {
  it("keeps broad legacy format detection but accepts only GLB on compatibility construction", () => {
    expect(detectBg3dModelFormat("house.GLB")).toBe("glb");
    expect(detectBg3dModelFormat("scene.gltf")).toBe("gltf");
    expect(detectBg3dModelFormat(" prop.OBJ ")).toBe("obj");
    expect(detectBg3dModelFormat("house.glb.exe")).toBeNull();
    expect(detectBg3dModelFormat("model.fbx")).toBeNull();

    expect(createUploadedBg3dModelRecord(glbFile(), "legacy-id", 42)).toMatchObject({
      id: "legacy-id",
      storageVersion: 1,
      name: "Commercial Set",
      format: "glb",
      createdAt: 42,
    });
    expect(() => createUploadedBg3dModelRecord(new File(["obj"], "set.obj"))).toThrowError(
      expect.objectContaining({ code: "unsupported-format" }),
    );
  });

  it("ships only the twelve audited CC0 environment samples as verified insertable entries", () => {
    expect(SAMPLE_BG3D_MODELS).toHaveLength(12);
    expect(SAMPLE_BG3D_MODEL_ENTRIES).toHaveLength(12);
    expect(new Set(SAMPLE_BG3D_MODELS.map((sample) => sample.id)).size).toBe(12);
    expect(SAMPLE_BG3D_MODEL_ENTRIES).toEqual(SAMPLE_BG3D_MODELS.map((sample) =>
      expect.objectContaining({
        id: sample.id,
        source: "sample",
        status: "verified",
        canUse: true,
        commercialUse: true,
        contentHash: sample.contentHash,
        byteSize: sample.byteSize,
      }),
    ));
  });

  it("canonicalizes exact SHA-256 identities and rejects near matches", () => {
    const hex = "a".repeat(64);
    expect(canonicalizeBg3dModelHash(hex.toUpperCase())).toBe(`sha256:${hex}`);
    expect(canonicalizeBg3dModelHash(`sha256:${hex}`)).toBe(`sha256:${hex}`);
    expect(canonicalizeBg3dModelHash(`${hex}0`)).toBeNull();
    expect(canonicalizeBg3dModelHash("sha256:not-a-digest")).toBeNull();
  });

  it("normalizes rights conservatively: unknown can never become commercially cleared", () => {
    expect(normalizeBg3dModelRights()).toEqual({
      status: "unknown",
      commercialUse: false,
      attributionRequired: false,
    });
    expect(normalizeBg3dModelRights({ status: "unknown", commercialUse: true })).toMatchObject({
      status: "unknown",
      commercialUse: false,
    });
    expect(
      normalizeBg3dModelRights({
        status: "licensed",
        commercialUse: true,
        attributionRequired: true,
        attribution: "  Studio Artist  ",
        licenseName: "Commercial license",
      }),
    ).toEqual({
      status: "licensed",
      commercialUse: true,
      attributionRequired: true,
      attribution: "Studio Artist",
      licenseName: "Commercial license",
    });
    expect(
      normalizeBg3dModelRights({
        status: "licensed",
        commercialUse: true,
        attributionRequired: false,
        licenseName: "https://example.invalid/license",
      }),
    ).toEqual({ status: "unknown", commercialUse: false, attributionRequired: false });
    const credentialLikeText = ["api_key", ["s", "k"].join(""), "test-credential"].join(" ");
    expect(
      normalizeBg3dModelRights({
        status: "owned",
        commercialUse: true,
        attributionRequired: true,
        attribution: credentialLikeText,
      }),
    ).toEqual({ status: "unknown", commercialUse: false, attributionRequired: false });
  });
});

describe("verified GLB preparation", () => {
  it("keeps the product Worker failure terminal and permits only a separately selected direct validation", async () => {
    vi.stubGlobal("Worker", undefined);
    const file = glbFile("backend-contract.glb");

    await expect(prepareVerifiedBg3dModelRecord(file)).rejects.toMatchObject({
      code: "worker-failed",
    });
    await expect(prepareVerifiedBg3dModelRecord(file, {
      executionBackend: "direct",
      idFactory: () => "backend-contract",
      now: 1,
    })).resolves.toMatchObject({ id: "backend-contract" });
  });

  it("persists canonical validation metadata and only validator-owned bytes", async () => {
    const source = validGlb();
    const sharedBuffer = Uint8Array.from(source).buffer;
    const record = await prepareVerifiedBg3dModelRecord(
      {
        name: "  City Block.GLB ",
        size: source.byteLength,
        type: "application/octet-stream",
        arrayBuffer: async () => sharedBuffer,
      },
      {
        idFactory: () => "private-storage-id",
        now: 123,
        profile: "mobile",
      },
    );

    new Uint8Array(sharedBuffer).fill(0);
    const storedBytes = new Uint8Array(await record.blob.arrayBuffer());
    expect(storedBytes).toEqual(source);
    expect(record).toMatchObject({
      id: "private-storage-id",
      storageVersion: BG3D_MODEL_STORAGE_VERSION,
      validationVersion: BG3D_MODEL_VALIDATION_VERSION,
      name: "City Block",
      format: "glb",
      byteSize: source.byteLength,
      mime: STUDIO_BG3D_GLB_MIME_TYPE,
      validatorProfile: "mobile",
      validatedAt: 123,
      thumbnail: null,
      rights: { status: "unknown", commercialUse: false, attributionRequired: false },
    });
    expect(record.contentHash).toBe(await sha256(source));
    expect(record.validatorMetrics.byteSize).toBe(source.byteLength);
    expect(record.blob.type).toBe(STUDIO_BG3D_GLB_MIME_TYPE);
    expect(record.blob).not.toBe(sharedBuffer);
    expect(isVerifiedBg3dModelRecord(record)).toBe(true);
    expect(Object.keys(record).join(" ")).not.toMatch(/url|credential|token|secret/iu);
  });

  it("preserves explicit commercial rights without retaining caller object references", async () => {
    const rights = {
      status: "owned" as const,
      commercialUse: true,
      attributionRequired: false,
      licenseName: "In-house asset",
    };
    const record = await prepareVerifiedBg3dModelRecord(
      { file: glbFile(), rights },
      { idFactory: () => "verified-rights", now: 7 },
    );
    rights.licenseName = "changed after validation";

    expect(record.rights).toEqual({
      status: "owned",
      commercialUse: true,
      attributionRequired: false,
      licenseName: "In-house asset",
    });
    expect(record.rights).not.toBe(rights);
  });

  it("rejects hostile extensions, MIME, magic, and manifest hash without touching storage", async () => {
    await expect(prepareVerifiedBg3dModelRecord(null as never)).rejects.toMatchObject({ code: "invalid-file" });
    await expect(prepareVerifiedBg3dModelRecord(glbFile("scene.gltf"))).rejects.toMatchObject({
      code: "unsupported-format",
    });
    await expect(prepareVerifiedBg3dModelRecord(glbFile("scene.glb.exe"))).rejects.toMatchObject({
      code: "unsupported-format",
    });
    await expect(prepareVerifiedBg3dModelRecord(glbFile("scene.glb", validGlb(), "text/html"))).rejects.toMatchObject({
      code: "invalid-mime",
    });

    const invalidMagic = validGlb();
    invalidMagic[0] = 0;
    await expect(prepareVerifiedBg3dModelRecord(glbFile("scene.glb", invalidMagic))).rejects.toMatchObject({
      code: "validation-failed",
      validationCode: "invalid-magic",
    });
    await expect(
      prepareVerifiedBg3dModelRecord({ file: glbFile(), expectedSha256: `sha256:${"0".repeat(64)}` }),
    ).rejects.toMatchObject({ code: "hash-mismatch" });
  });

  it("enforces the 100MiB pre-read guard", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    await expect(
      prepareVerifiedBg3dModelRecord({
        name: "oversized.glb",
        type: STUDIO_BG3D_GLB_MIME_TYPE,
        size: STUDIO_BG3D_GLB_MAX_BYTES + 1,
        arrayBuffer,
      }),
    ).rejects.toMatchObject({ code: "file-too-large" });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("enforces the selected profile byte budget before materializing or hashing the file", async () => {
    const source = validGlb();
    const arrayBuffer = vi.fn(async () => Uint8Array.from(source).buffer);
    const digest = vi.fn(async () => new Uint8Array(32));
    const budgets = {
      ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
      mobile: {
        ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.mobile,
        complexity: {
          ...DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES.mobile.complexity,
          maxModelBytes: source.byteLength - 1,
        },
      },
    };

    await expect(prepareVerifiedBg3dModelRecord({
      name: "profile-budget.glb",
      type: STUDIO_BG3D_GLB_MIME_TYPE,
      size: source.byteLength,
      arrayBuffer,
    }, {
      profile: "mobile",
      budgets,
      digest,
    })).rejects.toMatchObject({
      code: "validation-failed",
      validationCode: "model-byte-budget-exceeded",
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
  });

  it("enforces the cumulative byte budget before materializing or hashing the file", async () => {
    const source = validGlb();
    const arrayBuffer = vi.fn(async () => Uint8Array.from(source).buffer);
    const digest = vi.fn(async () => new Uint8Array(32));

    await expect(prepareVerifiedBg3dModelRecord({
      name: "cumulative-budget.glb",
      type: STUDIO_BG3D_GLB_MIME_TYPE,
      size: source.byteLength,
      arrayBuffer,
    }, {
      cumulativeUsedBytes: 1,
      maximumCumulativeBytes: source.byteLength,
      digest,
    })).rejects.toMatchObject({
      code: "validation-failed",
      validationCode: "cumulative-byte-budget-exceeded",
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(digest).not.toHaveBeenCalled();
  });

  it("rejects explicit storage IDs with invalid length, characters, reserved names, or credential patterns", async () => {
    const credentialLikeId = [["s", "k"].join(""), "abcdefgh"].join("-");
    const invalidIds = ["../storage", "x".repeat(81), "Constructor", credentialLikeId];
    for (const id of invalidIds) {
      await expect(
        prepareVerifiedBg3dModelRecord(glbFile(), {
          idFactory: () => id,
          now: 1,
        }),
      ).rejects.toMatchObject({ code: "invalid-file" });
    }
  });
});

describe("renderer admission revalidation", () => {
  it("returns the actual fresh validation success and its validator-owned bytes", async () => {
    const bytes = validGlb();
    const record = await prepareVerifiedBg3dModelRecord(glbFile("Admission.glb", bytes), {
      idFactory: () => "admission-record",
      now: 8,
    });

    const admitted = await revalidateStoredBg3dModelForRendering(record, { profile: "mobile" });
    expect(admitted).toMatchObject({
      ok: true,
      code: "valid",
      profile: "mobile",
      verifiedSha256: record.contentHash,
      metrics: record.validatorMetrics,
    });
    expect(admitted.verifiedBytes).toEqual(bytes);
    expect(admitted.verifiedBytes).not.toBe(bytes);
    expect("blob" in admitted).toBe(false);
  });

  it("rejects stored bytes whose hash no longer matches the V2 record", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "tampered-record",
      now: 9,
    });
    const tamperedBytes = new Uint8Array(await record.blob.arrayBuffer());
    tamperedBytes[tamperedBytes.length - 1] ^= 1;
    const tamperedRecord: Bg3dVerifiedStoredRecord = {
      ...record,
      blob: new Blob([tamperedBytes.buffer], { type: STUDIO_BG3D_GLB_MIME_TYPE }),
    };
    expect(isVerifiedBg3dModelRecord(tamperedRecord)).toBe(true);

    await expect(revalidateStoredBg3dModelForRendering(tamperedRecord)).rejects.toMatchObject({
      code: "stored-metadata-mismatch",
      validationCode: "hash-mismatch",
    });
  });

  it("rejects a structurally valid V2 record when persisted validator metrics differ", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "metric-mismatch",
      now: 10,
    });
    const mismatchedRecord: Bg3dVerifiedStoredRecord = {
      ...record,
      validatorMetrics: {
        ...record.validatorMetrics,
        nodes: record.validatorMetrics.nodes + 1,
      },
    };
    expect(isVerifiedBg3dModelRecord(mismatchedRecord)).toBe(true);
    await expect(revalidateStoredBg3dModelForRendering(mismatchedRecord)).rejects.toMatchObject({
      code: "stored-metadata-mismatch",
    });
  });

  it("resolves storage privately and admits only a validation success object", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "stored-admission",
      now: 11,
    });
    installFakeIndexedDb([record]);

    const admitted = await admitStoredBg3dModelForRendering(record.id, { profile: "desktop" });
    expect(admitted.ok).toBe(true);
    expect(admitted.verifiedSha256).toBe(record.contentHash);
    expect("id" in admitted).toBe(false);
    expect("blob" in admitted).toBe(false);
  });
});

describe("V3 IndexedDB behavior", () => {
  it("upgrades to DB V3 with hash lookup and a deletion journal without deleting legacy records", async () => {
    const legacy: Bg3dLegacyStoredRecord = {
      id: "legacy-obj",
      name: "Old OBJ",
      format: "obj",
      blob: new Blob(["obj"]),
      thumbnail: null,
      createdAt: 1,
      updatedAt: 2,
    };
    const state = installFakeIndexedDb([legacy]);

    expect(await listStoredBg3dModels()).toEqual([legacy]);
    expect(state.requestedVersions).toEqual([BG3D_MODEL_LIBRARY_DB_VERSION]);
    expect(state.createdIndexes).toContain("contentHash");
    expect(state.createdStores).toEqual(["deletion-journal"]);
    expect(state.deletedKeys).toEqual([]);
    expect(state.records.get("legacy-obj")).toBe(legacy);

    const entry = withDefaultBg3dModelEntry([legacy]).find(({ id }) => id === legacy.id);
    expect(entry).toMatchObject({
      id: "legacy-obj",
      status: "legacy-reimport-required",
      canUse: false,
      contentHash: null,
      commercialUse: false,
      statusMessage: BG3D_MODEL_LEGACY_EXTERNAL_STATUS_MESSAGE,
    });
    expect(await getStoredBg3dModel("legacy-obj")).toBeNull();
    expect(state.records.has("legacy-obj")).toBe(true);
  });

  it("validates a whole batch before its one write transaction and leaves no partial imports", async () => {
    const state = installFakeIndexedDb();
    const invalid = validGlb();
    invalid[0] = 0;

    await expect(
      importVerifiedBg3dModelsAtomically([glbFile("valid.glb"), glbFile("invalid.glb", invalid)], {
        idFactory: () => "batch-id",
        now: 5,
      }),
    ).rejects.toMatchObject({ code: "validation-failed" });
    expect(state.transactionModes).not.toContain("readwrite");
    expect(state.records.size).toBe(0);
  });

  it("honors a late abort immediately before opening the write transaction", async () => {
    const state = installFakeIndexedDb();
    const controller = new AbortController();

    await expect(importVerifiedBg3dModelsAtomically([glbFile("cancelled.glb")], {
      signal: controller.signal,
      idFactory: () => {
        controller.abort();
        return "cancelled-storage";
      },
    })).rejects.toMatchObject({ code: "aborted" });

    expect(state.transactionModes).not.toContain("readwrite");
    expect(state.records.size).toBe(0);
  });

  it("lazily promotes a legacy GLB only after full validation and keeps unknown rights commercial-safe", async () => {
    const bytes = validGlb();
    const legacy: Bg3dLegacyStoredRecord = {
      id: "legacy-glb",
      name: "Legacy Block",
      format: "glb",
      blob: new Blob([Uint8Array.from(bytes).buffer], { type: STUDIO_BG3D_GLB_MIME_TYPE }),
      thumbnail: null,
      createdAt: 3,
      updatedAt: 4,
    };
    const state = installFakeIndexedDb([legacy]);

    const promoted = await getStoredBg3dModel("legacy-glb");
    expect(promoted).toMatchObject({
      id: "legacy-glb",
      storageVersion: BG3D_MODEL_STORAGE_VERSION,
      contentHash: await sha256(bytes),
      rights: { status: "unknown", commercialUse: false, attributionRequired: false },
    });
    expect(isVerifiedBg3dModelRecord(state.records.get("legacy-glb"))).toBe(true);
    expect(state.deletedKeys).toEqual([]);
  });

  it("stores only bounded thumbnails for a verified model and rejects an older capture fence", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "thumbnail-storage",
      now: 1,
    });
    const state = installFakeIndexedDb([record]);
    const first = thumbnailDataUrl(320, 180);
    const newer = thumbnailDataUrl(160, 90);

    expect(await saveBg3dModelThumbnailIfCurrent(record.id, first, {
      captureRevision: 10,
      now: 20,
    })).toBe(true);
    expect(await saveBg3dModelThumbnailIfCurrent(record.id, newer, {
      captureRevision: 9,
      now: 21,
    })).toBe(false);
    expect(await getCachedBg3dModelThumbnail(record.id)).toBe(first);
    expect((await listBg3dModelLibraryEntries()).find(({ id }) => id === record.id)?.thumbnail)
      .toBe(first);
    expect(state.thumbnails.get(record.id)).toMatchObject({
      id: record.id,
      thumbnail: first,
      updatedAt: 20,
      captureRevision: 10,
    });
  });

  it("fails closed before thumbnail writes for unsafe ids, malformed images, and missing models", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "safe-thumbnail-storage",
      now: 1,
    });
    const state = installFakeIndexedDb([record]);
    const valid = thumbnailDataUrl();

    await expect(saveBg3dModelThumbnail("../unsafe", valid)).rejects.toMatchObject({ code: "invalid-file" });
    await expect(saveBg3dModelThumbnail(record.id, "data:image/png;base64,AAAA"))
      .rejects.toMatchObject({ code: "invalid-file" });
    await expect(saveBg3dModelThumbnail("missing-model", valid))
      .rejects.toMatchObject({ code: "invalid-file" });
    expect(state.thumbnails.size).toBe(0);
  });

  it("filters corrupt or oversized persisted thumbnails before list/get presentation", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "corrupt-thumbnail-storage",
      now: 1,
    });
    const state = installFakeIndexedDb([record]);
    state.thumbnails.set(record.id, {
      id: record.id,
      thumbnail: thumbnailDataUrl(513, 1),
      updatedAt: 2,
      captureRevision: 3,
    });

    expect(await getCachedBg3dModelThumbnail(record.id)).toBeNull();
    expect((await listBg3dModelLibraryEntries()).find(({ id }) => id === record.id)?.thumbnail)
      .toBeNull();
    expect(withDefaultBg3dModelEntry(
      [record],
      { [record.id]: "data:image/png;base64,AAAA" },
    ).find(({ id }) => id === record.id)?.thumbnail)
      .toBeNull();
    expect(await getCachedBg3dModelThumbnail("../unsafe")).toBeNull();
  });

  it("allocates monotonic safe capture revisions even when the clock stalls", () => {
    const first = createBg3dModelThumbnailCaptureRevision(100);
    const second = createBg3dModelThumbnailCaptureRevision(100);
    expect(second).toBe(first + 1);
    expect(Number.isSafeInteger(second)).toBe(true);
  });

  it("deduplicates same-byte imports by canonical hash and supports exact hash lookup", async () => {
    const state = installFakeIndexedDb();
    let id = 0;
    const bytes = validGlb();
    const records = await importVerifiedBg3dModelsAtomically(
      [glbFile("first.glb", bytes), glbFile("second.glb", bytes)],
      {
        idFactory: () => `storage-${++id}`,
        now: 11,
        maximumCumulativeBytes: bytes.byteLength,
      },
    );

    expect(records).toHaveLength(1);
    expect(state.records.size).toBe(1);
    expect(state.transactionModes.filter((mode) => mode === "readwrite")).toHaveLength(1);
    const canonicalHash = await sha256(bytes);
    expect((await getStoredBg3dModelByHash(canonicalHash))?.id).toBe("storage-1");
    expect(await getStoredBg3dModelByHash(canonicalHash.slice(0, -1) + "0")).toBeNull();
    expect(await getStoredBg3dModelByHash("not-a-hash")).toBeNull();

    const existingState = installFakeIndexedDb([records[0]!]);
    const duplicateOfExisting = await importVerifiedBg3dModelsAtomically(
      [glbFile("existing-again.glb", bytes)],
      {
        maximumCumulativeBytes: bytes.byteLength,
        idFactory: () => "must-not-be-written",
      },
    );
    expect(duplicateOfExisting).toEqual([records[0]]);
    expect(existingState.transactionModes.filter((mode) => mode === "readwrite")).toHaveLength(1);
  });

  it("does not charge unrelated existing library bytes against the current batch budget", async () => {
    const existingBytes = validGlb({ extras: { project: "unrelated" } });
    const incomingBytes = validGlb({ extras: { project: "current" } });
    const existing = await prepareVerifiedBg3dModelRecord(
      glbFile("unrelated.glb", existingBytes),
      { idFactory: () => "unrelated-storage", now: 1 },
    );
    const state = installFakeIndexedDb([existing]);

    const imported = await importVerifiedBg3dModelsAtomically(
      [glbFile("current.glb", incomingBytes)],
      {
        idFactory: () => "current-storage",
        now: 2,
        cumulativeUsedBytes: 0,
        maximumCumulativeBytes: incomingBytes.byteLength,
      },
    );

    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ id: "current-storage", byteSize: incomingBytes.byteLength });
    expect(state.records.has("unrelated-storage")).toBe(true);
    expect(state.records.has("current-storage")).toBe(true);
  });

  it("counts a referenced existing hash once in the current batch cumulative budget", async () => {
    const existingBytes = validGlb({ extras: { asset: "existing-and-referenced" } });
    const incomingBytes = validGlb({ extras: { asset: "new-and-referenced" } });
    const existing = await prepareVerifiedBg3dModelRecord(
      glbFile("existing.glb", existingBytes),
      { idFactory: () => "existing-storage", now: 1 },
    );
    const maximum = existingBytes.byteLength + incomingBytes.byteLength;
    const state = installFakeIndexedDb([existing]);

    await expect(importVerifiedBg3dModelsAtomically(
      [glbFile("existing-again.glb", existingBytes), glbFile("new.glb", incomingBytes)],
      {
        idFactory: () => "not-committed",
        maximumCumulativeBytes: maximum - 1,
      },
    )).rejects.toMatchObject({
      code: "validation-failed",
      validationCode: "cumulative-byte-budget-exceeded",
    });
    expect(state.transactionModes).not.toContain("readwrite");

    const retryState = installFakeIndexedDb([existing]);
    let id = 0;
    const imported = await importVerifiedBg3dModelsAtomically(
      [
        glbFile("existing-first.glb", existingBytes),
        glbFile("existing-duplicate.glb", existingBytes),
        glbFile("new.glb", incomingBytes),
      ],
      {
        idFactory: () => `batch-storage-${++id}`,
        maximumCumulativeBytes: maximum,
      },
    );

    expect(imported).toHaveLength(2);
    expect(imported[0]?.id).toBe("existing-storage");
    expect(imported[1]?.contentHash).toBe(await sha256(incomingBytes));
    expect(retryState.records.size).toBe(2);
  });

  it("fails closed when a duplicate hash changes rights or different hashes reuse a storage id", async () => {
    const bytes = validGlb();
    const owned = await prepareVerifiedBg3dModelRecord({
      file: glbFile("owned.glb", bytes),
      rights: { status: "owned", commercialUse: true, attributionRequired: false },
    }, { idFactory: () => "owned-record", now: 1 });
    const state = installFakeIndexedDb([owned]);

    await expect(importVerifiedBg3dModelsAtomically([{
      file: glbFile("unknown.glb", bytes),
      rights: { status: "unknown", commercialUse: false, attributionRequired: false },
    }])).rejects.toMatchObject({ code: "rights-conflict" });
    expect(state.transactionModes).not.toContain("readwrite");
    expect(state.records.get("owned-record")).toBe(owned);

    installFakeIndexedDb();
    const secondBytes = validGlb({ extras: { variant: 2 } });
    await expect(importVerifiedBg3dModelsAtomically(
      [glbFile("first-id.glb", bytes), glbFile("second-id.glb", secondBytes)],
      { idFactory: () => "same-storage-id", now: 2 },
    )).rejects.toMatchObject({ code: "storage-id-conflict" });
  });

  it("saveUploadedBg3dModel fails closed for non-GLB before an IndexedDB write", async () => {
    const state = installFakeIndexedDb();
    await expect(saveUploadedBg3dModel(new File(["obj"], "prop.obj"))).rejects.toBeInstanceOf(
      Bg3dModelLibraryError,
    );
    expect(state.transactionModes).not.toContain("readwrite");
  });
});

describe("scene attachment isolation and library presentation", () => {
  it("creates scene-local metadata without leaking or reusing the private storage id", async () => {
    const record = await prepareVerifiedBg3dModelRecord(
      { file: glbFile(), rights: { status: "owned", commercialUse: true, attributionRequired: false } },
      { idFactory: () => "private-storage-key", now: 99 },
    );
    const attachment = createStudioBg3dModelAttachment(record, { attachmentId: "scene-attachment-1" });

    expect(attachment).toEqual({
      id: "scene-attachment-1",
      name: "Commercial Set.glb",
      mime: STUDIO_BG3D_GLB_MIME_TYPE,
      byteSize: record.byteSize,
      hash: record.contentHash,
      rights: record.rights,
      source: "local-library",
    });
    expect(JSON.stringify(attachment)).not.toContain("private-storage-key");
    expect(
      serializeStudioBg3dSceneDocument({
        ...createDefaultStudioBg3dSceneDocument(),
        attachments: [attachment],
      }),
    ).not.toBeNull();
    expect(() => createStudioBg3dModelAttachment(record, { attachmentId: record.id })).toThrowError(
      expect.objectContaining({ code: "invalid-attachment" }),
    );
    expect(() => createStudioBg3dModelAttachment(record, { attachmentId: "../unsafe" })).toThrowError(
      expect.objectContaining({ code: "invalid-attachment" }),
    );
    expect(() => createStudioBg3dModelAttachment(record, { attachmentId: "Constructor" })).toThrowError(
      expect.objectContaining({ code: "invalid-attachment" }),
    );
  });

  it("shows verified and legacy entries distinctly, newest first, and only deletes local rows", async () => {
    const verified = await prepareVerifiedBg3dModelRecord(glbFile("Verified.glb"), {
      idFactory: () => "verified",
      now: 20,
    });
    const legacy: Bg3dLegacyStoredRecord = {
      id: "legacy",
      name: "Legacy",
      format: "gltf",
      blob: new Blob(["gltf"]),
      thumbnail: null,
      createdAt: 1,
      updatedAt: 10,
    };
    const entries = withDefaultBg3dModelEntry([legacy, verified]);

    const localEntries = entries.filter((entry) => entry.source !== "sample");
    expect(localEntries.map((entry) => entry.id)).toEqual(["verified", "legacy"]);
    expect(localEntries[0]).toMatchObject({ status: "verified", canUse: true, contentHash: verified.contentHash });
    expect(localEntries[1]).toMatchObject({ status: "legacy-reimport-required", canUse: false, contentHash: null });
    expect(
      getDeletableModelIds([
        ...entries,
        {
          ...entries[0],
          id: "sample",
          source: "sample",
        },
      ]),
    ).toEqual(["verified", "legacy"]);
  });

  it("does not open or mutate IndexedDB when a persistent delete lease is already revoked", async () => {
    const state = installFakeIndexedDb();
    const controller = new AbortController();
    controller.abort();

    await expect(
      deleteStoredBg3dModel("verified", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(state.transactionModes).toEqual([]);
    expect(state.deletedKeys).toEqual([]);
  });

  it("rolls back every store when a delete lease is revoked before the commit boundary", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "rolled-back",
      now: 1,
    });
    const state = installFakeIndexedDb([record]);
    state.thumbnails.set(record.id, { id: record.id, thumbnail: thumbnailDataUrl(), updatedAt: 1 });
    const controller = new AbortController();
    state.onDeleteRequest = () => controller.abort("deadline-before-commit-boundary");

    await expect(
      deleteStoredBg3dModel(record.id, { signal: controller.signal, now: 77 }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(state.records.get(record.id)).toBe(record);
    expect(state.thumbnails.has(record.id)).toBe(true);
    expect(state.deletedKeys).toEqual([]);
    expect(state.deletionJournal.has(record.contentHash)).toBe(false);
  });

  it("treats IndexedDB completion as authoritative when abort arrives after commit", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "commit-won",
      now: 1,
    });
    const state = installFakeIndexedDb([record]);
    const controller = new AbortController();
    state.onTransactionCommit = () => {
      state.onTransactionCommit = undefined;
      controller.abort("deadline-after-commit-boundary");
    };

    await expect(
      deleteStoredBg3dModel(record.id, { signal: controller.signal, now: 77 }),
    ).resolves.toBeUndefined();
    expect(state.records.has(record.id)).toBe(false);
    expect(state.deletedKeys).toEqual([record.id, record.id]);
    expect(await getBg3dModelDeletionReceiptByHash(record.contentHash)).toEqual({
      id: record.contentHash,
      contentHash: record.contentHash,
      storageModelId: record.id,
      deletedAt: 77,
    });
  });

  it("clears a durable deletion receipt when the same content is intentionally reimported", async () => {
    const source = validGlb();
    const record = await prepareVerifiedBg3dModelRecord(glbFile("deleted.glb", source), {
      idFactory: () => "deleted-record",
      now: 1,
    });
    const state = installFakeIndexedDb([record]);
    await deleteStoredBg3dModel(record.id, { now: 2 });
    expect(await getBg3dModelDeletionReceiptByHash(record.contentHash)).not.toBeNull();

    const [reimported] = await importVerifiedBg3dModelsAtomically(
      [glbFile("reimported.glb", source)],
      { idFactory: () => "reimported-record", now: 3 },
    );

    expect(reimported?.id).toBe("reimported-record");
    expect(await getBg3dModelDeletionReceiptByHash(record.contentHash)).toBeNull();
    expect(state.deletedJournalKeys).toContain(record.contentHash);
  });

  it("reimports from the write-transaction state when delete commits after the initial snapshot", async () => {
    const source = validGlb({ race: "delete-after-list" });
    const existing = await prepareVerifiedBg3dModelRecord(glbFile("existing.glb", source), {
      idFactory: () => "existing-race-record",
      now: 1,
    });
    const state = installFakeIndexedDb([existing]);
    let deletedBetweenSnapshotAndWrite = false;
    const racingFile = {
      name: "intentional-reimport.glb",
      size: source.byteLength,
      type: STUDIO_BG3D_GLB_MIME_TYPE,
      async arrayBuffer(): Promise<ArrayBuffer> {
        await deleteStoredBg3dModel(existing.id, { now: 2 });
        deletedBetweenSnapshotAndWrite = true;
        return Uint8Array.from(source).buffer;
      },
    };

    const imported = await importVerifiedBg3dModelsAtomically([racingFile], {
      idFactory: () => "reimported-after-delete",
      now: 3,
    });

    expect(deletedBetweenSnapshotAndWrite).toBe(true);
    expect(imported).toHaveLength(1);
    expect(imported[0]?.id).toBe("reimported-after-delete");
    expect(state.records.has(existing.id)).toBe(false);
    expect(state.records.get("reimported-after-delete")).toBe(imported[0]);
    expect(await getBg3dModelDeletionReceiptByHash(existing.contentHash)).toBeNull();
  });

  it("resolves the model and deletion receipt from one readonly transaction snapshot", async () => {
    const record = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "snapshot-record",
      now: 1,
    });
    const state = installFakeIndexedDb();
    state.deletionJournal.set(record.contentHash, {
      id: record.contentHash,
      contentHash: record.contentHash,
      storageModelId: record.id,
      deletedAt: 2,
    });
    state.onModelHashLookup = () => {
      state.onModelHashLookup = undefined;
      state.records.set(record.id, record);
      state.deletionJournal.delete(record.contentHash);
    };

    const resolution = await resolveBg3dModelHash(record.contentHash);

    expect(resolution.record).toBeNull();
    expect(resolution.deletionReceipt).toMatchObject({
      contentHash: record.contentHash,
      storageModelId: record.id,
    });
    expect(state.records.get(record.id)).toBe(record);
    expect(state.deletionJournal.has(record.contentHash)).toBe(false);
  });

  it("abandons a never-settling database open and releases the authoritative mutation lane", async () => {
    vi.useFakeTimers();
    const openRequest = new FakeRequest<IDBDatabase>() as FakeRequest<IDBDatabase> & {
      transaction: IDBTransaction | null;
      onupgradeneeded: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
      onblocked: ((this: IDBOpenDBRequest, event: Event) => unknown) | null;
    };
    openRequest.transaction = null;
    openRequest.onupgradeneeded = null;
    openRequest.onblocked = null;
    const close = vi.fn();
    const transaction = vi.fn();
    vi.stubGlobal("indexedDB", {
      open: vi.fn(() => openRequest as unknown as IDBOpenDBRequest),
    } as unknown as IDBFactory);
    const coordinator = new StudioBg3dModalOperationCoordinator();
    const session = coordinator.beginSession();
    const deletion = coordinator.runSceneMutation(
      session,
      (lease) => deleteStoredBg3dModel("never-opened", { signal: lease.signal }),
      vi.fn(),
      { authoritativePersistence: true, timeoutMs: 25 },
    );
    const deletionOutcome = deletion.catch((reason: unknown) => reason);
    const nextCommit = vi.fn();
    const next = coordinator.runSceneMutation(
      session,
      () => "lane-recovered",
      nextCommit,
      { timeoutMs: 25 },
    );

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25);

    expect(await deletionOutcome).toMatchObject({
      code: "operation-lease-timeout",
      scope: "scene-mutation",
    });
    await expect(next).resolves.toEqual({ status: "committed", value: "lane-recovered" });
    expect(nextCommit).toHaveBeenCalledExactlyOnceWith("lane-recovered");
    expect(transaction).not.toHaveBeenCalled();

    openRequest.succeed({
      close,
      transaction,
    } as unknown as IDBDatabase);
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects structurally forged V2 records", async () => {
    const verified = await prepareVerifiedBg3dModelRecord(glbFile(), {
      idFactory: () => "verified",
      now: 1,
    });
    const forged = {
      ...verified,
      byteSize: verified.byteSize + 1,
    } satisfies Bg3dVerifiedStoredRecord;
    expect(isVerifiedBg3dModelRecord(forged)).toBe(false);

    const belowMinimum = BG3D_MODEL_MIN_GLB_BYTES - 1;
    const undersized = {
      ...verified,
      blob: new Blob([new Uint8Array(belowMinimum).buffer], { type: STUDIO_BG3D_GLB_MIME_TYPE }),
      byteSize: belowMinimum,
      validatorMetrics: { ...verified.validatorMetrics, byteSize: belowMinimum },
    } satisfies Bg3dVerifiedStoredRecord;
    expect(isVerifiedBg3dModelRecord(undersized)).toBe(false);
  });
});
