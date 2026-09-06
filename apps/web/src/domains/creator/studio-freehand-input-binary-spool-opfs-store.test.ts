import { describe, expect, it } from "vitest";

import {
  createStudioFreehandInputMemoryBinaryCasState,
  createStudioFreehandInputMemoryBinaryCasStore,
  createStudioFreehandInputOpfsBinaryCasStore,
} from "./studio-freehand-input-binary-spool-opfs-store";
import { StudioOpfsSyncAccessError } from "./studio-opfs-sync-access-store";
import { sha256HexPortable } from "./studio-sha256";

class MemoryFile {
  bytes = new Uint8Array(0);

  async createSyncAccessHandle() {
    let closed = false;
    return {
      getSize: () => this.bytes.byteLength,
      read: (target: Uint8Array, { at }: { readonly at: number }) => {
        if (closed) throw new Error("closed");
        const available = Math.max(0, Math.min(target.byteLength, this.bytes.byteLength - at));
        target.set(this.bytes.subarray(at, at + available));
        return available;
      },
      write: (source: Uint8Array, { at }: { readonly at: number }) => {
        if (closed) throw new Error("closed");
        const nextLength = Math.max(this.bytes.byteLength, at + source.byteLength);
        if (nextLength !== this.bytes.byteLength) {
          const next = new Uint8Array(nextLength);
          next.set(this.bytes);
          this.bytes = next;
        }
        this.bytes.set(source, at);
        return source.byteLength;
      },
      truncate: (nextSize: number) => {
        const next = new Uint8Array(nextSize);
        next.set(this.bytes.subarray(0, nextSize));
        this.bytes = next;
      },
      flush: () => undefined,
      close: () => {
        closed = true;
      },
    };
  }
}

class MemoryDirectory {
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, MemoryFile>();

  async getDirectoryHandle(name: string, options?: { readonly create?: boolean }) {
    const current = this.directories.get(name);
    if (current) return current;
    if (!options?.create) throw new DOMException("missing", "NotFoundError");
    const created = new MemoryDirectory();
    this.directories.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { readonly create?: boolean }) {
    const current = this.files.get(name);
    if (current) return current;
    if (!options?.create) throw new DOMException("missing", "NotFoundError");
    const created = new MemoryFile();
    this.files.set(name, created);
    return created;
  }

  async removeEntry(name: string) {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException("missing", "NotFoundError");
    }
  }

  async *keys(): AsyncIterable<string> {
    yield* this.directories.keys();
    yield* this.files.keys();
  }
}

class DedicatedWorkerGlobalScope {
  readonly navigator: {
    readonly storage: { readonly getDirectory: () => Promise<MemoryDirectory> };
  };

  constructor(root: MemoryDirectory) {
    this.navigator = { storage: { getDirectory: async () => root } };
  }
}

describe("studio freehand input binary CAS store", () => {
  it("copies memory CAS values, enforces atomic staging offsets, and reopens shared state", async () => {
    const state = createStudioFreehandInputMemoryBinaryCasState();
    const first = createStudioFreehandInputMemoryBinaryCasStore(state);
    const original = new Uint8Array([1, 2, 3]);
    const digest = sha256HexPortable(original);
    await first.putCas("page", digest, original);
    original[0] = 99;
    expect(await first.getCas("page", digest)).toEqual(new Uint8Array([1, 2, 3]));
    const read = await first.getCas("page", digest);
    read![1] = 88;
    expect(await first.getCas("page", digest)).toEqual(new Uint8Array([1, 2, 3]));

    expect(await first.appendStaging("stroke-1", BigInt(0), new Uint8Array([4, 5])))
      .toBe(BigInt(2));
    await expect(first.appendStaging("stroke-1", BigInt(0), new Uint8Array([6])))
      .rejects.toMatchObject({ code: "WRITE_FAILED" });
    expect(state.staging.get("stroke-1.staging")).toEqual(new Uint8Array([4, 5]));

    const reopened = createStudioFreehandInputMemoryBinaryCasStore(state);
    expect(await reopened.getCas("page", digest)).toEqual(new Uint8Array([1, 2, 3]));
    await reopened.removeStaging("stroke-1");
    expect(state.staging.size).toBe(0);
    await first.close();
    await expect(first.getCas("page", digest)).rejects.toMatchObject({
      code: "STORE_CLOSED",
    });
  });

  it("injects a failed operation without mutating existing CAS or staging authority", async () => {
    const state = createStudioFreehandInputMemoryBinaryCasState();
    const store = createStudioFreehandInputMemoryBinaryCasStore(state);
    const bytes = new Uint8Array([7, 8]);
    const digest = sha256HexPortable(bytes);
    state.failNextOperation = "put";
    await expect(store.putCas("page", digest, bytes)).rejects.toMatchObject({
      code: "WRITE_FAILED",
    });
    expect(state.cas.size).toBe(0);
    await expect(store.putCas("page", "0".repeat(64), bytes)).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(state.cas.size).toBe(0);

    await store.appendStaging("stroke-2", BigInt(0), new Uint8Array([1]));
    state.failNextOperation = "append";
    await expect(store.appendStaging("stroke-2", BigInt(1), new Uint8Array([2])))
      .rejects.toMatchObject({ code: "WRITE_FAILED" });
    expect(state.staging.get("stroke-2.staging")).toEqual(new Uint8Array([1]));
  });

  it("uses Dedicated Worker sync OPFS handles and preserves data across store instances", async () => {
    const root = new MemoryDirectory();
    const scope = new DedicatedWorkerGlobalScope(root);
    const first = await createStudioFreehandInputOpfsBinaryCasStore(scope);
    const page = new Uint8Array([11, 12, 13, 14]);
    const digest = sha256HexPortable(page);
    await first.putCas("page", digest, page);
    await first.putCas("page", digest, page);
    expect(await first.getCas("page", digest)).toEqual(page);
    await first.appendStaging("stroke-opfs", BigInt(0), new Uint8Array([5, 6]));
    await expect(first.appendStaging("stroke-opfs", BigInt(0), new Uint8Array([7])))
      .rejects.toMatchObject({ code: "WRITE_FAILED" });

    const reopened = await createStudioFreehandInputOpfsBinaryCasStore(scope);
    expect(await reopened.getCas("page", digest)).toEqual(page);
    await reopened.removeStaging("stroke-opfs");
    await first.close();
    await reopened.close();
  });

  it("fails closed outside a Dedicated Worker instead of choosing an async main-thread fallback", async () => {
    await expect(createStudioFreehandInputOpfsBinaryCasStore({
      document: {},
      navigator: { storage: { getDirectory: async () => new MemoryDirectory() } },
    })).rejects.toEqual(expect.objectContaining<Partial<StudioOpfsSyncAccessError>>({
      code: "NOT_DEDICATED_WORKER",
    }));
  });
});
