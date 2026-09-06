import { describe, expect, it } from "vitest";

import {
  STUDIO_OPFS_SYNC_MAX_TRANSFER_BYTES,
  StudioOpfsSyncAccessError,
  createStudioOpfsMemorySyncAccessStore,
  createStudioOpfsSyncAccessStore,
  probeStudioOpfsSyncAccessCapability,
  type StudioOpfsSyncAccessHandleLike,
  type StudioOpfsSyncDirectoryHandleLike,
} from "./studio-opfs-sync-access-store";

function dedicatedWorkerScope(storage: {
  getDirectory(): Promise<StudioOpfsSyncDirectoryHandleLike>;
}) {
  return {
    [Symbol.toStringTag]: "DedicatedWorkerGlobalScope",
    navigator: { storage },
  };
}

describe("studio-opfs-sync-access-store · capability", () => {
  it("fails closed on Window/main-thread scopes", () => {
    const storage = { getDirectory: async () => fakeDirectory() };
    expect(
      probeStudioOpfsSyncAccessCapability({
        [Symbol.toStringTag]: "Window",
        document: {},
        navigator: { storage },
      }),
    ).toEqual({ supported: false, reason: "not-dedicated-worker" });
  });

  it("requires OPFS in a Dedicated Worker", () => {
    expect(
      probeStudioOpfsSyncAccessCapability({
        [Symbol.toStringTag]: "DedicatedWorkerGlobalScope",
        navigator: {},
      }),
    ).toEqual({ supported: false, reason: "opfs-unavailable" });
  });

  it("never disguises createWritable as the sync performance path", async () => {
    let createWritableCalls = 0;
    const directory = fakeDirectory({
      fileHandle: {
        async createWritable() {
          createWritableCalls += 1;
          return {};
        },
      } as unknown as {
        createSyncAccessHandle?: () => Promise<StudioOpfsSyncAccessHandleLike>;
      },
    });

    await expect(
      createStudioOpfsSyncAccessStore({
        documentId: "doc-1",
        scope: dedicatedWorkerScope({
          getDirectory: async () => directory,
        }),
      }),
    ).rejects.toMatchObject({ code: "SYNC_ACCESS_UNAVAILABLE" });
    expect(createWritableCalls).toBe(0);
  });

  it("opens and cleans a sync-access capability probe before returning", async () => {
    const handle = memoryHandle();
    const removed: string[] = [];
    const directory = fakeDirectory({
      fileHandle: {
        createSyncAccessHandle: async () => handle,
      },
      onRemove: (name) => removed.push(name),
    });
    const store = await createStudioOpfsSyncAccessStore({
      documentId: "doc-2",
      shardBytes: BigInt(16),
      scope: dedicatedWorkerScope({
        getDirectory: async () => directory,
      }),
    });

    expect(store.kind).toBe("opfs-sync-access");
    expect(handle.counts.close).toBe(1);
    expect(removed).toEqual(["sync-access-capability-probe.bin"]);
    await store.close();
  });
});

describe("studio-opfs-sync-access-store · fixed offset I/O", () => {
  it("writes and reads across shard boundaries without changing byte order", async () => {
    const store = createStudioOpfsMemorySyncAccessStore({
      shardBytes: BigInt(8),
    });
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7]);

    await store.write(BigInt(5), bytes);
    await store.flush();

    expect([...await store.read(BigInt(5), bytes.byteLength)]).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect([...store.snapshot().keys()]).toEqual([
      "shard-0.bin",
      "shard-1.bin",
    ]);
    expect(store.snapshot().get("shard-0.bin")).toEqual(
      Uint8Array.from([0, 0, 0, 0, 0, 1, 2, 3]),
    );
    expect(store.snapshot().get("shard-1.bin")).toEqual(
      Uint8Array.from([4, 5, 6, 7]),
    );
    expect(store.counts.flush).toBe(2);
  });

  it("keeps offsets above Number.MAX_SAFE_INTEGER as BigInt shard identities", async () => {
    const shardBytes = BigInt(1024);
    const globalOffset = BigInt(Number.MAX_SAFE_INTEGER) + BigInt(18);
    const store = createStudioOpfsMemorySyncAccessStore({ shardBytes });

    await store.write(globalOffset, Uint8Array.from([91, 92, 93]));
    expect([...await store.read(globalOffset, 3)]).toEqual([91, 92, 93]);

    const expectedShard = globalOffset / shardBytes;
    const localOffset = Number(globalOffset % shardBytes);
    const stored = store.snapshot().get(
      `shard-${expectedShard.toString(10)}.bin`,
    );
    expect(stored?.byteLength).toBe(localOffset + 3);
    expect(stored?.slice(localOffset)).toEqual(Uint8Array.from([91, 92, 93]));
  });

  it("fails closed when a requested range has never been written", async () => {
    const store = createStudioOpfsMemorySyncAccessStore({
      shardBytes: BigInt(16),
    });

    await expect(store.read(BigInt(0), 1)).rejects.toMatchObject({
      code: "SHORT_READ",
    });
  });

  it("rejects overflowing and oversized transfers before touching storage", async () => {
    const store = createStudioOpfsMemorySyncAccessStore();
    await expect(
      store.write(BigInt(-1), Uint8Array.from([1])),
    ).rejects.toBeInstanceOf(StudioOpfsSyncAccessError);
    await expect(
      store.read(BigInt(0), STUDIO_OPFS_SYNC_MAX_TRANSFER_BYTES + 1),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(store.snapshot().size).toBe(0);
  });
});

describe("studio-opfs-sync-access-store · lifecycle", () => {
  it("truncates the last shard and removes every shard after it", async () => {
    const store = createStudioOpfsMemorySyncAccessStore({
      shardBytes: BigInt(4),
    });
    await store.write(
      BigInt(0),
      Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    );

    await store.truncate(BigInt(6));

    expect([...store.snapshot().keys()]).toEqual([
      "shard-0.bin",
      "shard-1.bin",
    ]);
    expect(store.snapshot().get("shard-0.bin")).toEqual(
      Uint8Array.from([1, 2, 3, 4]),
    );
    expect(store.snapshot().get("shard-1.bin")).toEqual(
      Uint8Array.from([5, 6]),
    );
    expect(store.counts.truncate).toBe(1);
    await expect(store.read(BigInt(0), 6)).resolves.toEqual(
      Uint8Array.from([1, 2, 3, 4, 5, 6]),
    );
  });

  it("truncate(0) removes all shards and close is idempotent", async () => {
    const store = createStudioOpfsMemorySyncAccessStore({
      shardBytes: BigInt(4),
    });
    await store.write(BigInt(0), Uint8Array.from([1, 2, 3, 4, 5]));
    await store.truncate(BigInt(0));
    expect(store.snapshot().size).toBe(0);

    await store.close();
    await store.close();
    await expect(
      store.write(BigInt(0), Uint8Array.from([9])),
    ).rejects.toMatchObject({ code: "STORE_CLOSED" });
  });
});

function fakeDirectory(options: {
  fileHandle?: {
    createSyncAccessHandle?: () => Promise<StudioOpfsSyncAccessHandleLike>;
  };
  onRemove?: (name: string) => void;
} = {}): StudioOpfsSyncDirectoryHandleLike {
  const fallbackHandle = memoryHandle();
  const fileHandle = options.fileHandle ?? {
    createSyncAccessHandle: async () => fallbackHandle,
  };
  return {
    async getDirectoryHandle() {
      return this;
    },
    async getFileHandle() {
      return fileHandle;
    },
    async removeEntry(name) {
      options.onRemove?.(name);
    },
    async *keys() {
      // Capability tests do not create document shards.
    },
  };
}

function memoryHandle(): StudioOpfsSyncAccessHandleLike & {
  counts: { close: number };
} {
  let bytes = new Uint8Array(0);
  const counts = { close: 0 };
  return {
    counts,
    read(target, options) {
      if (options.at >= bytes.byteLength) return 0;
      const read = Math.min(target.byteLength, bytes.byteLength - options.at);
      target.set(bytes.subarray(options.at, options.at + read));
      return read;
    },
    write(source, options) {
      const required = options.at + source.byteLength;
      if (required > bytes.byteLength) {
        const expanded = new Uint8Array(required);
        expanded.set(bytes);
        bytes = expanded;
      }
      bytes.set(source, options.at);
      return source.byteLength;
    },
    flush() {},
    truncate(size) {
      bytes = bytes.slice(0, size);
    },
    close() {
      counts.close += 1;
    },
  };
}
