import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalizeVrmContentHash,
  ensureStoredVrmContentIdentity,
  getStoredVrmModelByHash,
  hashVrmBlob,
  listStoredVrmModels,
  MAX_VRM_UPLOAD_BYTES,
  saveUploadedVrm,
  saveVerifiedVrmBlob,
  validateVrmGlbBytes,
  VRM_VALIDATION_VERSION,
  type VrmStoredModelRecord,
} from "./vrm-library";

function makeVrmGlb(version: 0 | 1, rootOverrides: Record<string, unknown> = {}): Uint8Array {
  const root = {
    asset: { version: "2.0" },
    extensions: version === 0 ? { VRM: {} } : { VRMC_vrm: { specVersion: "1.0" } },
    ...rootOverrides,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(root));
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  bytes.set(encoded, 20);
  bytes.fill(0x20, 20 + encoded.byteLength);
  return bytes;
}

function copyToOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function vrmBlob(version: 0 | 1): Blob {
  return new Blob([copyToOwnedArrayBuffer(makeVrmGlb(version))], { type: "model/gltf-binary" });
}

function legacyRecord(id: string, blob: Blob, updatedAt = 1): VrmStoredModelRecord {
  return {
    id,
    name: id,
    blob,
    thumbnail: null,
    createdAt: 1,
    updatedAt,
  };
}

interface FakeVrmDbState {
  models: Map<string, VrmStoredModelRecord>;
  thumbnails: Map<string, unknown>;
  requestedVersions: number[];
  transactionModes: IDBTransactionMode[];
  writeCount: number;
  beforeModelBackfillReads?: () => void;
}

class OversizedVrmBlob extends Blob {
  readonly arrayBufferSpy = vi.fn(async () => new ArrayBuffer(0));

  override get size(): number {
    return MAX_VRM_UPLOAD_BYTES + 1;
  }

  override arrayBuffer(): Promise<ArrayBuffer> {
    return this.arrayBufferSpy();
  }
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

  fail(message: string) {
    this.error = new DOMException(message, "UnknownError");
    this.onerror?.call(this as unknown as IDBRequest<T>, new Event("error"));
  }
}

class FakeVrmTransaction {
  error: DOMException | null = null;
  oncomplete: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onerror: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  onabort: ((this: IDBTransaction, event: Event) => unknown) | null = null;
  private pending = 0;
  private complete = false;
  private generation = 0;

  constructor(
    private readonly state: FakeVrmDbState,
    readonly mode: IDBTransactionMode
  ) {}

  objectStore(name: string): IDBObjectStore {
    return new FakeVrmStore(this.state, this, name) as unknown as IDBObjectStore;
  }

  schedule<T>(operation: () => T): IDBRequest<T> {
    const request = new FakeRequest<T>();
    this.pending += 1;
    this.generation += 1;
    queueMicrotask(() => {
      try {
        request.succeed(operation());
      } catch (error) {
        request.fail(error instanceof Error ? error.message : "fake indexedDB failure");
        this.abort(request.error ?? undefined);
        return;
      }
      this.pending -= 1;
      this.scheduleCompletion();
    });
    return request as unknown as IDBRequest<T>;
  }

  private scheduleCompletion() {
    const generation = this.generation;
    queueMicrotask(() => {
      if (this.complete || this.pending > 0 || generation !== this.generation) return;
      this.complete = true;
      this.oncomplete?.call(this as unknown as IDBTransaction, new Event("complete"));
    });
  }

  private abort(error?: DOMException) {
    if (this.complete) return;
    this.complete = true;
    this.error = error ?? new DOMException("transaction aborted", "AbortError");
    this.onabort?.call(this as unknown as IDBTransaction, new Event("abort"));
  }
}

function cloneModel(record: VrmStoredModelRecord): VrmStoredModelRecord {
  return { ...record };
}

class FakeVrmStore {
  constructor(
    private readonly state: FakeVrmDbState,
    private readonly transaction: FakeVrmTransaction,
    private readonly name: string
  ) {}

  getAll(): IDBRequest<unknown[]> {
    return this.transaction.schedule(() =>
      this.name === "models"
        ? Array.from(this.state.models.values(), cloneModel)
        : Array.from(this.state.thumbnails.values())
    );
  }

  get(id: string): IDBRequest<unknown> {
    if (this.name === "models" && this.transaction.mode === "readwrite") {
      this.state.beforeModelBackfillReads?.();
      this.state.beforeModelBackfillReads = undefined;
    }
    return this.transaction.schedule(() => {
      const value = this.name === "models" ? this.state.models.get(id) : this.state.thumbnails.get(id);
      return value && this.name === "models" ? cloneModel(value as VrmStoredModelRecord) : value;
    });
  }

  put(value: VrmStoredModelRecord & { id: string }): IDBRequest<IDBValidKey> {
    return this.transaction.schedule<IDBValidKey>(() => {
      if (this.name === "models") this.state.models.set(value.id, cloneModel(value));
      else this.state.thumbnails.set(value.id, { ...value });
      this.state.writeCount += 1;
      return value.id;
    });
  }

  delete(id: string): IDBRequest<undefined> {
    return this.transaction.schedule(() => {
      if (this.name === "models") this.state.models.delete(id);
      else this.state.thumbnails.delete(id);
      this.state.writeCount += 1;
      return undefined;
    });
  }
}

class FakeVrmDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => name === "models" || name === "thumbnails",
  } as unknown as DOMStringList;

  constructor(private readonly state: FakeVrmDbState) {}

  createObjectStore(name: string): IDBObjectStore {
    return new FakeVrmStore(
      this.state,
      new FakeVrmTransaction(this.state, "versionchange"),
      name
    ) as unknown as IDBObjectStore;
  }

  transaction(_stores: string | string[], mode: IDBTransactionMode = "readonly"): IDBTransaction {
    this.state.transactionModes.push(mode);
    return new FakeVrmTransaction(this.state, mode) as unknown as IDBTransaction;
  }

  close() {
    // DB 상태는 open 호출 사이에도 유지된다.
  }
}

function installFakeIndexedDb(seed: readonly VrmStoredModelRecord[] = []): FakeVrmDbState {
  const state: FakeVrmDbState = {
    models: new Map(seed.map((record) => [record.id, cloneModel(record)])),
    thumbnails: new Map(),
    requestedVersions: [],
    transactionModes: [],
    writeCount: 0,
  };
  const database = new FakeVrmDatabase(state);
  const factory = {
    open: (_name: string, version: number) => {
      state.requestedVersions.push(version);
      const request = new FakeRequest<IDBDatabase>() as FakeRequest<IDBDatabase> & {
        onupgradeneeded: ((this: IDBOpenDBRequest, event: IDBVersionChangeEvent) => unknown) | null;
      };
      request.onupgradeneeded = null;
      queueMicrotask(() => request.succeed(database as unknown as IDBDatabase));
      return request as unknown as IDBOpenDBRequest;
    },
  } as IDBFactory;
  vi.stubGlobal("indexedDB", factory);
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function legacyStorage() {
  return { legacyIndexedDb: globalThis.indexedDB } as const;
}

describe("VRM GLB validation and content identity", () => {
  const helloHash = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

  it("canonicalizes exact SHA-256 identities and hashes actual Blob bytes", async () => {
    expect(canonicalizeVrmContentHash(` SHA256:${"A".repeat(64)} `)).toBe(
      `sha256:${"a".repeat(64)}`
    );
    expect(canonicalizeVrmContentHash(`sha256:${"a".repeat(63)}`)).toBeNull();
    expect(canonicalizeVrmContentHash("a".repeat(64))).toBeNull();
    await expect(hashVrmBlob(new Blob(["hello"]))).resolves.toBe(helloHash);
  });

  it("accepts minimal VRM 0.x and VRM 1.x GLB files", async () => {
    expect(validateVrmGlbBytes(makeVrmGlb(0))).toEqual({ vrmVersion: 0 });
    expect(validateVrmGlbBytes(makeVrmGlb(1))).toEqual({ vrmVersion: 1 });

    const ensured = await ensureStoredVrmContentIdentity(legacyRecord("vrm-1", vrmBlob(1)));
    expect(ensured).toMatchObject({
      byteSize: ensured.blob.size,
      mimeType: "model/gltf-binary",
      validationVersion: VRM_VALIDATION_VERSION,
    });
    expect(ensured.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects invalid headers, versions, declared lengths, HTML, and GLBs without VRM extensions", async () => {
    const badMagic = makeVrmGlb(1);
    badMagic[0] = 0;
    expect(() => validateVrmGlbBytes(badMagic)).toThrow("glTF");

    const badVersion = makeVrmGlb(1);
    new DataView(badVersion.buffer).setUint32(4, 1, true);
    expect(() => validateVrmGlbBytes(badVersion)).toThrow("GLB 2.0");

    const badLength = makeVrmGlb(1);
    new DataView(badLength.buffer).setUint32(8, badLength.byteLength - 4, true);
    expect(() => validateVrmGlbBytes(badLength)).toThrow("길이");

    expect(() => validateVrmGlbBytes(makeVrmGlb(1, { extensions: {} }))).toThrow("VRM 확장");
    await expect(
      saveUploadedVrm(new File(["<html>not a model</html>"], "looks-valid.vrm", { type: "model/gltf-binary" }))
    ).rejects.toThrow("VRM");
  });

  it("rejects oversized blobs before reading or touching IndexedDB", async () => {
    const state = installFakeIndexedDb();
    const oversized = new OversizedVrmBlob([], { type: "application/octet-stream" });

    await expect(saveVerifiedVrmBlob({ name: "too-large.vrm", blob: oversized })).rejects.toThrow("128MB");
    expect(oversized.arrayBufferSpy).not.toHaveBeenCalled();
    expect(state.requestedVersions).toEqual([]);
    expect(state.writeCount).toBe(0);
  });
});

describe("VRM IndexedDB durable identity", () => {
  it("validates before write, deduplicates by hash, and preserves the existing display metadata", async () => {
    const state = installFakeIndexedDb();
    const blob = vrmBlob(1);
    const first = await saveVerifiedVrmBlob(
      { name: "First Hero.vrm", blob },
      legacyStorage(),
    );
    const stored = state.models.get(first.id)!;
    state.models.set(first.id, { ...stored, name: "내가 정한 이름", thumbnail: "data:image/png;base64,thumb" });

    const duplicate = await saveVerifiedVrmBlob(
      { name: "Other Name.vrm", blob: new Blob([blob]) },
      legacyStorage(),
    );

    expect(state.models.size).toBe(1);
    expect(state.writeCount).toBe(1);
    expect(duplicate).toMatchObject({
      id: first.id,
      name: "내가 정한 이름",
      thumbnail: "data:image/png;base64,thumb",
      contentHash: first.contentHash,
    });
    expect(state.requestedVersions.every((version) => version === 1)).toBe(true);
  });

  it("rejects an expected-hash mismatch without any database mutation", async () => {
    const state = installFakeIndexedDb();
    await expect(
      saveVerifiedVrmBlob({
        name: "archive.vrm",
        blob: vrmBlob(0),
        expectedHash: `sha256:${"0".repeat(64)}`,
      }, legacyStorage())
    ).rejects.toThrow("일치하지 않습니다");
    expect(state.requestedVersions).toEqual([]);
    expect(state.writeCount).toBe(0);
  });

  it("backfills valid legacy rows sequentially without one invalid row breaking the list", async () => {
    const valid = legacyRecord("valid", vrmBlob(0), 2);
    const invalid = legacyRecord("invalid", new Blob(["<html>"]), 1);
    const state = installFakeIndexedDb([invalid, valid]);

    const listed = await listStoredVrmModels(legacyStorage());

    expect(listed).toHaveLength(2);
    expect(listed.find(({ id }) => id === "valid")?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(listed.find(({ id }) => id === "invalid")?.contentHash).toBeUndefined();
    expect(state.models.get("valid")).toMatchObject({
      mimeType: "model/gltf-binary",
      validationVersion: VRM_VALIDATION_VERSION,
    });
    expect(state.models.get("invalid")).not.toHaveProperty("contentHash");
    expect(state.writeCount).toBe(1);
  });

  it("does not overwrite a rename/content replacement or resurrect a deletion during lazy backfill", async () => {
    const rename = legacyRecord("rename", vrmBlob(0), 1);
    const replaced = legacyRecord("replaced", vrmBlob(0), 1);
    const deleted = legacyRecord("deleted", vrmBlob(1), 1);
    const state = installFakeIndexedDb([rename, replaced, deleted]);
    const replacementBlob = vrmBlob(1);
    state.beforeModelBackfillReads = () => {
      state.models.set("rename", { ...rename, name: "새 이름", updatedAt: 2 });
      state.models.set("replaced", { ...replaced, blob: replacementBlob, updatedAt: 2 });
      state.models.delete("deleted");
    };

    await expect(listStoredVrmModels(legacyStorage())).resolves.toHaveLength(3);

    expect(state.models.get("rename")).toMatchObject({ name: "새 이름", updatedAt: 2 });
    expect(state.models.get("rename")).not.toHaveProperty("contentHash");
    expect(state.models.get("replaced")?.blob).toBe(replacementBlob);
    expect(state.models.get("replaced")).not.toHaveProperty("contentHash");
    expect(state.models.has("deleted")).toBe(false);
    expect(state.writeCount).toBe(0);
  });

  it("looks up backfilled legacy models by canonical content hash", async () => {
    const state = installFakeIndexedDb([legacyRecord("legacy", vrmBlob(1))]);
    const [listed] = await listStoredVrmModels(legacyStorage());
    if (!listed?.contentHash) throw new Error("Expected a backfilled content hash");
    const found = await getStoredVrmModelByHash(
      listed.contentHash.toUpperCase(),
      legacyStorage(),
    );

    expect(found?.id).toBe("legacy");
    expect(state.models.get("legacy")?.contentHash).toBe(listed.contentHash);
  });
});
