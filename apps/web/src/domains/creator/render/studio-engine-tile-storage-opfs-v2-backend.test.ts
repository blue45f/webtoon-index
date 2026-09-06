import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_ENGINE_TILE_STORAGE_OPFS_V2_ROOT_NAME,
  StudioEngineTileStorageOpfsV2BackendError,
  createStudioEngineTileStorageOpfsV2Backend,
  type StudioEngineTileStorageOpfsV2DirectoryHandleLike,
  type StudioEngineTileStorageOpfsV2FileHandleLike,
  type StudioEngineTileStorageOpfsV2SyncAccessHandleLike,
} from "./studio-engine-tile-storage-opfs-v2-backend";
import {
  StudioEngineTileStorageWorkerV2,
  type StudioEngineTileStorageWorkerV2Lease,
  type StudioEngineTileStorageWorkerV2LeasePort,
} from "./studio-engine-tile-storage-worker-v2";

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

class FakeFile {
  public bytes = new Uint8Array(0);
  public locked = false;
  public maxIoBytes = Number.MAX_SAFE_INTEGER;
  public failFlush = false;
  public openGate: Deferred | null = null;
  public createCalls = 0;
  public readCalls = 0;
  public writeCalls = 0;
  public flushCalls = 0;
  public truncateCalls = 0;
  public closeCalls = 0;

  public constructor(
    public readonly path: string,
    public readonly events: string[],
  ) {}
}

class FakeSyncAccessHandle
implements StudioEngineTileStorageOpfsV2SyncAccessHandleLike {
  #closed = false;

  public constructor(private readonly file: FakeFile) {}

  public getSize(): number {
    this.#assertOpen();
    return this.file.bytes.byteLength;
  }

  public read(
    buffer: Uint8Array,
    options: { readonly at: number },
  ): number {
    this.#assertOpen();
    this.file.readCalls += 1;
    if (
      !Number.isSafeInteger(options.at)
      || options.at < 0
      || options.at >= this.file.bytes.byteLength
    ) {
      return 0;
    }
    const byteLength = Math.min(
      buffer.byteLength,
      this.file.maxIoBytes,
      this.file.bytes.byteLength - options.at,
    );
    buffer.set(
      this.file.bytes.subarray(options.at, options.at + byteLength),
    );
    this.file.events.push(`read:${this.file.path}:${byteLength}`);
    return byteLength;
  }

  public write(
    buffer: Uint8Array,
    options: { readonly at: number },
  ): number {
    this.#assertOpen();
    this.file.writeCalls += 1;
    if (!Number.isSafeInteger(options.at) || options.at < 0) return 0;
    const byteLength = Math.min(buffer.byteLength, this.file.maxIoBytes);
    const nextLength = options.at + byteLength;
    if (!Number.isSafeInteger(nextLength)) return 0;
    if (nextLength > this.file.bytes.byteLength) {
      const expanded = new Uint8Array(nextLength);
      expanded.set(this.file.bytes);
      this.file.bytes = expanded;
    }
    this.file.bytes.set(buffer.subarray(0, byteLength), options.at);
    this.file.events.push(`write:${this.file.path}:${byteLength}`);
    return byteLength;
  }

  public flush(): void {
    this.#assertOpen();
    this.file.flushCalls += 1;
    this.file.events.push(`flush:${this.file.path}`);
    if (this.file.failFlush) throw new Error(`flush failed: ${this.file.path}`);
  }

  public truncate(newSize: number): void {
    this.#assertOpen();
    this.file.truncateCalls += 1;
    this.file.events.push(`truncate:${this.file.path}:${newSize}`);
    const next = new Uint8Array(newSize);
    next.set(this.file.bytes.subarray(0, newSize));
    this.file.bytes = next;
  }

  public close(): void {
    this.#assertOpen();
    this.#closed = true;
    this.file.locked = false;
    this.file.closeCalls += 1;
    this.file.events.push(`close:${this.file.path}`);
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error(`closed handle: ${this.file.path}`);
  }
}

class FakeFileHandle
implements StudioEngineTileStorageOpfsV2FileHandleLike {
  public constructor(private readonly file: FakeFile) {}

  public async createSyncAccessHandle():
  Promise<StudioEngineTileStorageOpfsV2SyncAccessHandleLike> {
    this.file.createCalls += 1;
    this.file.events.push(`open-start:${this.file.path}`);
    const gate = this.file.openGate;
    this.file.openGate = null;
    if (gate) await gate.promise;
    if (this.file.locked) {
      throw new Error(`already locked: ${this.file.path}`);
    }
    this.file.locked = true;
    this.file.events.push(`open:${this.file.path}`);
    return new FakeSyncAccessHandle(this.file);
  }
}

class FakeDirectory
implements StudioEngineTileStorageOpfsV2DirectoryHandleLike {
  public readonly directories = new Map<string, FakeDirectory>();
  public readonly files = new Map<string, FakeFile>();

  public constructor(
    public readonly path: string,
    private readonly events: string[],
  ) {}

  public async getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<FakeDirectory> {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw notFound(name);
    const directory = new FakeDirectory(`${this.path}/${name}`, this.events);
    this.directories.set(name, directory);
    return directory;
  }

  public async getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<FakeFileHandle> {
    let file = this.files.get(name);
    if (!file && options?.create) {
      file = new FakeFile(`${this.path}/${name}`, this.events);
      this.files.set(name, file);
    }
    if (!file) throw notFound(name);
    return new FakeFileHandle(file);
  }

  public async removeEntry(name: string): Promise<void> {
    const file = this.files.get(name);
    if (file) {
      if (file.locked) throw new Error(`locked during remove: ${file.path}`);
      this.events.push(`remove:${file.path}`);
      this.files.delete(name);
      return;
    }
    if (this.directories.delete(name)) return;
    throw notFound(name);
  }

  public async *keys(): AsyncIterable<string> {
    for (const name of [...this.files.keys(), ...this.directories.keys()]) {
      yield name;
    }
  }
}

class FakeOpfs {
  public readonly events: string[] = [];
  public readonly root = new FakeDirectory("", this.events);
  public fallbackCalls = 0;

  public workerScope(): unknown {
    const scope = {
      navigator: {
        storage: {
          getDirectory: async () => this.root,
        },
      },
    };
    Object.defineProperty(scope, "constructor", {
      value: { name: "DedicatedWorkerGlobalScope" },
    });
    return scope;
  }

  public async file(
    documentId: string,
    file: "document" | "wal" | "markers",
    shardIndex: bigint,
  ): Promise<FakeFile> {
    const directory = await this.fileDirectory(documentId, file);
    const value = directory.files.get(`shard-${shardIndex.toString(10)}.bin`);
    if (!value) throw new Error("Missing fake shard.");
    return value;
  }

  public async seed(
    documentId: string,
    file: "document" | "wal" | "markers",
    shardIndex: bigint,
    bytes: Uint8Array,
  ): Promise<FakeFile> {
    const directory = await this.fileDirectory(documentId, file);
    const name = `shard-${shardIndex.toString(10)}.bin`;
    const value = new FakeFile(`${directory.path}/${name}`, this.events);
    value.bytes = Uint8Array.from(bytes);
    directory.files.set(name, value);
    return value;
  }

  public async fileDirectory(
    documentId: string,
    file: "document" | "wal" | "markers",
  ): Promise<FakeDirectory> {
    const product = await this.root.getDirectoryHandle(
      STUDIO_ENGINE_TILE_STORAGE_OPFS_V2_ROOT_NAME,
      { create: true },
    );
    const document = await product.getDirectoryHandle(documentId, {
      create: true,
    });
    return document.getDirectoryHandle(file, { create: true });
  }
}

function notFound(name: string): Error {
  const error = new Error(`Not found: ${name}`);
  error.name = "NotFoundError";
  return error;
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

async function backend(
  opfs: FakeOpfs,
  documentId = "future-doc",
  shardBytes = BigInt(8),
) {
  return createStudioEngineTileStorageOpfsV2Backend({
    documentId,
    shardBytes,
    scope: opfs.workerScope(),
  });
}

function expectBackendError(
  code: StudioEngineTileStorageOpfsV2BackendError["code"],
) {
  return expect.objectContaining({
    name: "StudioEngineTileStorageOpfsV2BackendError",
    code,
  });
}

class LeasePort implements StudioEngineTileStorageWorkerV2LeasePort {
  public acquire(
    input: Readonly<{
      documentId: string;
      ownerId: string;
      leaseEpoch: number;
      signal: AbortSignal;
    }>,
  ): StudioEngineTileStorageWorkerV2Lease {
    if (input.signal.aborted) throw input.signal.reason;
    return Object.freeze({
      documentId: input.documentId,
      ownerId: input.ownerId,
      leaseEpoch: input.leaseEpoch,
      token: "exclusive-test-lease",
    });
  }

  public assert(
    _lease: StudioEngineTileStorageWorkerV2Lease,
    operationSignal: AbortSignal,
  ): void {
    if (operationSignal.aborted) throw operationSignal.reason;
  }

  public release(): void {}
}

describe("StudioEngineTileStorageOpfsV2Backend", () => {
  it("fails closed outside a Dedicated Worker and never chooses a fallback", async () => {
    await expect(createStudioEngineTileStorageOpfsV2Backend({
      documentId: "future-doc",
      scope: {
        document: {},
        navigator: {
          storage: {
            getDirectory: vi.fn(),
          },
        },
      },
    })).rejects.toEqual(expectBackendError("not-dedicated-worker"));

    const worker = {};
    Object.defineProperty(worker, "constructor", {
      value: { name: "DedicatedWorkerGlobalScope" },
    });
    await expect(createStudioEngineTileStorageOpfsV2Backend({
      documentId: "future-doc",
      scope: worker,
    })).rejects.toEqual(expectBackendError("opfs-unavailable"));
  });

  it("rejects files without sync-access support and never calls createWritable", async () => {
    const createWritable = vi.fn();
    const directory: StudioEngineTileStorageOpfsV2DirectoryHandleLike = {
      async getDirectoryHandle() {
        return this;
      },
      async getFileHandle() {
        return {
          createWritable,
        } as StudioEngineTileStorageOpfsV2FileHandleLike;
      },
      async removeEntry() {},
      async *keys() {},
    };
    const scope = {
      navigator: {
        storage: {
          getDirectory: async () => directory,
        },
      },
    };
    Object.defineProperty(scope, "constructor", {
      value: { name: "DedicatedWorkerGlobalScope" },
    });
    const value = await createStudioEngineTileStorageOpfsV2Backend({
      documentId: "future-doc",
      shardBytes: BigInt(8),
      scope,
    });
    await expect(value.write(
      "document",
      BigInt(0),
      0,
      Uint8Array.of(1),
      signal(),
    )).rejects.toEqual(expectBackendError("sync-access-unavailable"));
    expect(createWritable).not.toHaveBeenCalled();
    await value.close();
  });

  it("recovers a bigint logical length after restart and zero-fills sparse shards", async () => {
    const opfs = new FakeOpfs();
    const first = await backend(opfs);
    const largeShard = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1);
    await first.write(
      "document",
      largeShard,
      3,
      Uint8Array.of(7, 8),
      signal(),
    );
    const expectedLength = largeShard * BigInt(8) + BigInt(5);
    expect(await first.logicalByteLength("document", signal()))
      .toBe(expectedLength);
    await first.close();

    const reopened = await backend(opfs);
    expect(await reopened.logicalByteLength("document", signal()))
      .toBe(expectedLength);
    await expect(reopened.read(
      "document",
      BigInt(1),
      0,
      8,
      signal(),
    )).resolves.toEqual(new Uint8Array(8));
    await expect(reopened.read(
      "document",
      largeShard,
      0,
      5,
      signal(),
    )).resolves.toEqual(Uint8Array.of(0, 0, 0, 7, 8));
    await reopened.close();
  });

  it("rejects a torn physical shard larger than the configured shard budget", async () => {
    const opfs = new FakeOpfs();
    await opfs.seed(
      "future-doc",
      "wal",
      BigInt(0),
      new Uint8Array(9),
    );
    const value = await backend(opfs);
    await expect(value.logicalByteLength("wal", signal()))
      .rejects.toEqual(expectBackendError("invalid-shard-size"));
    await value.close();
  });

  it("loops over short native reads and writes without losing bytes", async () => {
    const opfs = new FakeOpfs();
    const value = await backend(opfs);
    const directory = await opfs.fileDirectory("future-doc", "document");
    const seeded = await opfs.seed(
      "future-doc",
      "document",
      BigInt(0),
      new Uint8Array(0),
    );
    seeded.maxIoBytes = 2;
    expect(directory.files.size).toBe(1);

    await value.write(
      "document",
      BigInt(0),
      1,
      Uint8Array.of(1, 2, 3, 4, 5, 6),
      signal(),
    );
    await expect(value.read(
      "document",
      BigInt(0),
      1,
      6,
      signal(),
    )).resolves.toEqual(Uint8Array.of(1, 2, 3, 4, 5, 6));
    expect(seeded.writeCalls).toBe(3);
    expect(seeded.readCalls).toBe(3);
    await value.close();
  });

  it("serializes concurrent opens for one shard and snapshots caller bytes", async () => {
    const opfs = new FakeOpfs();
    const value = await backend(opfs);
    const file = await opfs.seed(
      "future-doc",
      "document",
      BigInt(0),
      new Uint8Array(0),
    );
    const gate = deferred();
    file.openGate = gate;
    const firstBytes = Uint8Array.of(1, 2);
    const first = value.write(
      "document",
      BigInt(0),
      0,
      firstBytes,
      signal(),
    );
    const second = value.write(
      "document",
      BigInt(0),
      2,
      Uint8Array.of(3, 4),
      signal(),
    );
    firstBytes.fill(9);
    await vi.waitFor(() => expect(file.createCalls).toBe(1));
    gate.resolve();
    await Promise.all([first, second]);
    expect(file.createCalls).toBe(1);
    await expect(value.read(
      "document",
      BigInt(0),
      0,
      4,
      signal(),
    )).resolves.toEqual(Uint8Array.of(1, 2, 3, 4));
    await value.close();
  });

  it("flushes cached shards in ascending order and fails at the first error", async () => {
    const opfs = new FakeOpfs();
    const value = await backend(opfs);
    for (const shardIndex of [BigInt(2), BigInt(0), BigInt(1)]) {
      await value.write(
        "document",
        shardIndex,
        0,
        Uint8Array.of(Number(shardIndex)),
        signal(),
      );
    }
    const failing = await opfs.file("future-doc", "document", BigInt(1));
    failing.failFlush = true;
    opfs.events.length = 0;
    await expect(value.flush("document", signal()))
      .rejects.toEqual(expectBackendError("flush-failed"));
    expect(opfs.events.filter(event => event.startsWith("flush:")))
      .toEqual([
        expect.stringContaining("shard-0.bin"),
        expect.stringContaining("shard-1.bin"),
      ]);

    failing.failFlush = false;
    opfs.events.length = 0;
    await value.flush("document", signal());
    expect(opfs.events.filter(event => event.startsWith("flush:")))
      .toEqual([
        expect.stringContaining("shard-0.bin"),
        expect.stringContaining("shard-1.bin"),
        expect.stringContaining("shard-2.bin"),
      ]);
    await value.close();
  });

  it("truncates across shards, deletes excess files after close, and can extend sparsely", async () => {
    const opfs = new FakeOpfs();
    const value = await backend(opfs);
    for (const shardIndex of [BigInt(0), BigInt(1), BigInt(2)]) {
      await value.write(
        "document",
        shardIndex,
        0,
        new Uint8Array(8).fill(Number(shardIndex) + 1),
        signal(),
      );
    }
    opfs.events.length = 0;
    await value.truncate("document", BigInt(10), signal());
    expect(await value.logicalByteLength("document", signal())).toBe(BigInt(10));
    expect((await opfs.file("future-doc", "document", BigInt(1))).bytes)
      .toEqual(Uint8Array.of(2, 2));
    const closeIndex = opfs.events.findIndex(event => (
      event.includes("close:") && event.includes("shard-2.bin")
    ));
    const removeIndex = opfs.events.findIndex(event => (
      event.includes("remove:") && event.includes("shard-2.bin")
    ));
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(removeIndex).toBeGreaterThan(closeIndex);

    await value.truncate("document", BigInt(18), signal());
    expect(await value.logicalByteLength("document", signal())).toBe(BigInt(18));
    await expect(value.read(
      "document",
      BigInt(2),
      0,
      2,
      signal(),
    )).resolves.toEqual(Uint8Array.of(0, 0));

    await value.truncate("document", BigInt(0), signal());
    expect(await value.logicalByteLength("document", signal())).toBe(BigInt(0));
    const directory = await opfs.fileDirectory("future-doc", "document");
    expect([...directory.files.keys()]).toEqual([]);
    await value.close();
  });

  it("closes an asynchronously opened handle when its operation is aborted", async () => {
    const opfs = new FakeOpfs();
    const value = await backend(opfs);
    const file = await opfs.seed(
      "future-doc",
      "wal",
      BigInt(0),
      new Uint8Array(0),
    );
    const gate = deferred();
    file.openGate = gate;
    const controller = new AbortController();
    const write = value.write(
      "wal",
      BigInt(0),
      0,
      Uint8Array.of(1),
      controller.signal,
    );
    await vi.waitFor(() => expect(file.createCalls).toBe(1));
    controller.abort(new Error("test abort"));
    gate.resolve();
    await expect(write).rejects.toEqual(expectBackendError("aborted"));
    expect(file.closeCalls).toBe(1);
    expect(file.locked).toBe(false);
    await value.close();
  });

  it("disposes during async handle creation, suppresses reuse, and closes idempotently", async () => {
    const opfs = new FakeOpfs();
    const value = await backend(opfs);
    const file = await opfs.seed(
      "future-doc",
      "markers",
      BigInt(0),
      new Uint8Array(0),
    );
    const gate = deferred();
    file.openGate = gate;
    const pending = value.write(
      "markers",
      BigInt(0),
      0,
      Uint8Array.of(5),
      signal(),
    );
    await vi.waitFor(() => expect(file.createCalls).toBe(1));
    const firstClose = value.close();
    const secondClose = value.close();
    expect(secondClose).toBe(firstClose);
    gate.resolve();
    await expect(pending).rejects.toEqual(
      expectBackendError("backend-closed"),
    );
    await expect(firstClose).resolves.toBeUndefined();
    expect(file.closeCalls).toBe(1);
    await expect(value.logicalByteLength("markers", signal()))
      .rejects.toEqual(expectBackendError("backend-closed"));
  });

  it("closes files and shards in a stable authority order", async () => {
    const opfs = new FakeOpfs();
    const value = await backend(opfs);
    for (const [file, shardIndex] of [
      ["markers", BigInt(2)],
      ["document", BigInt(1)],
      ["wal", BigInt(0)],
      ["document", BigInt(0)],
    ] as const) {
      await value.write(
        file,
        shardIndex,
        0,
        Uint8Array.of(1),
        signal(),
      );
    }
    opfs.events.length = 0;
    await value.close();
    expect(opfs.events.filter(event => event.startsWith("close:")).map(
      event => event.slice(event.indexOf("future-doc/")),
    )).toEqual([
      "future-doc/document/shard-0.bin",
      "future-doc/document/shard-1.bin",
      "future-doc/wal/shard-0.bin",
      "future-doc/markers/shard-2.bin",
    ]);
  });

  it("composes directly with the v2 storage worker and restores an empty frontier", async () => {
    const opfs = new FakeOpfs();
    const storageBackend = await backend(opfs, "integrated-doc", BigInt(64));
    const worker = new StudioEngineTileStorageWorkerV2({
      documentId: "integrated-doc",
      ownerId: "storage-worker",
      sessionEpoch: 1,
      leaseEpoch: 1,
      backend: storageBackend,
      leasePort: new LeasePort(),
      windowBytes: 32,
    });
    await expect(worker.open(signal())).resolves.toEqual({
      status: "ready",
      recoveredTransactions: 0,
      frontier: {
        durableRevision: 0,
        documentRevision: 0,
        commandSequence: 0,
        transactionSequence: 0,
        journalByteLength: BigInt(0),
        walByteLength: BigInt(0),
        markerByteLength: BigInt(0),
      },
    });
    await worker.dispose();
  });
});
