import { describe, expect, it } from "vitest";

import { StudioOpfsSyncAccessError } from "../studio-opfs-sync-access-store";
import { sha256HexPortable } from "../studio-sha256";

import {
  STUDIO_DRY_MEDIA_UNION_CAS_ROOT_NAME,
  createStudioDryMediaUnionContinuationOpfsCasStore,
} from "./studio-dry-media-union-continuation-opfs-store";

class MemoryFile {
  bytes = new Uint8Array(0);

  constructor(
    private readonly directory: MemoryDirectory,
    private readonly name: string,
  ) {}

  async createSyncAccessHandle() {
    let closed = false;
    return {
      getSize: () => this.bytes.byteLength,
      read: (target: Uint8Array, { at }: { readonly at: number }) => {
        if (closed) throw new Error("closed");
        const available = Math.max(
          0,
          Math.min(target.byteLength, this.bytes.byteLength - at),
        );
        target.set(this.bytes.subarray(at, at + available));
        return available;
      },
      write: (source: Uint8Array, { at }: { readonly at: number }) => {
        if (closed) throw new Error("closed");
        const writeLength = this.directory.consumeWriteLength(this.name, source.byteLength);
        this.directory.events.push(`${this.name}:write:${writeLength}`);
        if (writeLength === 0) return 0;
        const nextLength = Math.max(this.bytes.byteLength, at + writeLength);
        if (nextLength !== this.bytes.byteLength) {
          const next = new Uint8Array(nextLength);
          next.set(this.bytes);
          this.bytes = next;
        }
        this.bytes.set(source.subarray(0, writeLength), at);
        return writeLength;
      },
      truncate: (nextSize: number) => {
        const next = new Uint8Array(nextSize);
        next.set(this.bytes.subarray(0, nextSize));
        this.bytes = next;
      },
      flush: () => {
        this.directory.events.push(`${this.name}:flush`);
        if (this.directory.failNextFlush.delete(this.name)) {
          throw new Error("simulated flush failure");
        }
      },
      close: () => {
        closed = true;
      },
    };
  }
}

class MemoryDirectory {
  readonly directories = new Map<string, MemoryDirectory>();
  readonly files = new Map<string, MemoryFile>();
  readonly events: string[] = [];
  readonly shortWrites = new Map<string, { remainingBeforeStop: number }>();
  readonly failNextFlush = new Set<string>();

  consumeWriteLength(name: string, requested: number): number {
    const fault = this.shortWrites.get(name);
    if (!fault) return requested;
    if (fault.remainingBeforeStop === 0) {
      this.shortWrites.delete(name);
      return 0;
    }
    const accepted = Math.min(requested, fault.remainingBeforeStop);
    fault.remainingBeforeStop -= accepted;
    return accepted;
  }

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
    const created = new MemoryFile(this, name);
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

async function getCasDirectory(
  root: MemoryDirectory,
  name: "pages" | "indexes" | "metadata" | "roots",
): Promise<MemoryDirectory> {
  const casRoot = await root.getDirectoryHandle(STUDIO_DRY_MEDIA_UNION_CAS_ROOT_NAME);
  return casRoot.getDirectoryHandle(name);
}

async function seedFile(
  directory: MemoryDirectory,
  name: string,
  bytes: Uint8Array,
): Promise<void> {
  const file = await directory.getFileHandle(name, { create: true });
  file.bytes = bytes.slice();
}

class DedicatedWorkerGlobalScope {
  readonly navigator: {
    readonly storage: { readonly getDirectory: () => Promise<MemoryDirectory> };
  };

  constructor(root: MemoryDirectory) {
    this.navigator = { storage: { getDirectory: async () => root } };
  }
}

describe("dry-media continuation OPFS CAS", () => {
  it("snapshots caller buffers before queued sync writes and reopens exact bytes", async () => {
    const root = new MemoryDirectory();
    const scope = new DedicatedWorkerGlobalScope(root);
    const first = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    const page = new Uint8Array([11, 12, 13, 14]);
    const expectedPage = page.slice();
    const digest = sha256HexPortable(page);
    const write = first.putCas("page", digest, page);
    page.fill(99);
    await write;
    expect(await first.getCas("page", digest)).toEqual(expectedPage);

    const staging = new Uint8Array([5, 6, 7]);
    const append = first.appendStaging("stroke-opfs", BigInt(0), staging);
    staging.fill(88);
    await expect(append).resolves.toBe(BigInt(3));
    await expect(first.appendStaging(
      "stroke-opfs",
      BigInt(0),
      new Uint8Array([9]),
    )).rejects.toMatchObject({ code: "WRITE_FAILED" });

    const reopened = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    expect(await reopened.getCas("page", digest)).toEqual(expectedPage);
    await reopened.removeStaging("stroke-opfs");
    await first.close();
    await expect(first.getCas("page", digest)).rejects.toMatchObject({
      code: "STORE_CLOSED",
    });
    await reopened.close();
  });

  it("flushes a verified pending blob before final copy and recovers half-written promotion", async () => {
    const root = new MemoryDirectory();
    const scope = new DedicatedWorkerGlobalScope(root);
    const store = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    const pages = await getCasDirectory(root, "pages");
    const bytes = new Uint8Array([41, 42, 43, 44, 45, 46]);
    const digest = sha256HexPortable(bytes);
    pages.shortWrites.set(`${digest}.bin`, { remainingBeforeStop: 2 });

    await expect(store.putCas("page", digest, bytes)).rejects.toMatchObject({
      code: "WRITE_FAILED",
    });
    expect(pages.files.get(`${digest}.pending`)?.bytes).toEqual(bytes);
    expect(pages.files.get(`${digest}.bin`)?.bytes).toEqual(bytes.subarray(0, 2));
    expect(pages.events.indexOf(`${digest}.pending:flush`)).toBeGreaterThanOrEqual(0);
    expect(pages.events.indexOf(`${digest}.bin:write:2`)).toBeGreaterThan(
      pages.events.indexOf(`${digest}.pending:flush`),
    );

    await expect(store.putCas("page", digest, bytes)).resolves.toBeUndefined();
    expect(await store.getCas("page", digest)).toEqual(bytes);
    expect(pages.files.has(`${digest}.pending`)).toBe(false);

    const reopenedBytes = new Uint8Array([51, 52, 53, 54, 55, 56]);
    const reopenedDigest = sha256HexPortable(reopenedBytes);
    pages.shortWrites.set(`${reopenedDigest}.bin`, { remainingBeforeStop: 3 });
    await expect(store.putCas("page", reopenedDigest, reopenedBytes)).rejects.toMatchObject({
      code: "WRITE_FAILED",
    });
    await store.close();

    const reopened = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    expect(await reopened.getCas("page", reopenedDigest)).toEqual(reopenedBytes);
    expect(pages.files.has(`${reopenedDigest}.pending`)).toBe(false);
    await reopened.close();
  });

  it("does not create a final blob when durable staging fails", async () => {
    const root = new MemoryDirectory();
    const scope = new DedicatedWorkerGlobalScope(root);
    const store = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    const pages = await getCasDirectory(root, "pages");
    const bytes = new Uint8Array([71, 72, 73, 74]);
    const digest = sha256HexPortable(bytes);
    pages.failNextFlush.add(`${digest}.pending`);

    await expect(store.putCas("page", digest, bytes)).rejects.toMatchObject({
      code: "FLUSH_FAILED",
    });
    expect(pages.files.has(`${digest}.bin`)).toBe(false);
    expect(pages.files.get(`${digest}.pending`)?.bytes).toEqual(bytes);

    await expect(store.putCas("page", digest, bytes)).resolves.toBeUndefined();
    expect(await store.getCas("page", digest)).toEqual(bytes);
    await store.close();
  });

  it("keeps durable staging until a failed final flush is retried", async () => {
    const root = new MemoryDirectory();
    const scope = new DedicatedWorkerGlobalScope(root);
    const store = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    const pages = await getCasDirectory(root, "pages");
    const bytes = new Uint8Array([81, 82, 83, 84]);
    const digest = sha256HexPortable(bytes);
    pages.failNextFlush.add(`${digest}.bin`);

    await expect(store.putCas("page", digest, bytes)).rejects.toMatchObject({
      code: "FLUSH_FAILED",
    });
    expect(pages.files.get(`${digest}.pending`)?.bytes).toEqual(bytes);
    expect(pages.files.get(`${digest}.bin`)?.bytes).toEqual(bytes);
    await store.close();

    const reopened = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    expect(await reopened.getCas("page", digest)).toEqual(bytes);
    expect(pages.files.has(`${digest}.pending`)).toBe(false);
    await reopened.close();
  });

  it("cleans invalid stale pending files and never exposes an unproven final blob", async () => {
    const root = new MemoryDirectory();
    const scope = new DedicatedWorkerGlobalScope(root);
    const initial = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    const pages = await getCasDirectory(root, "pages");
    const bytes = new Uint8Array([61, 62, 63, 64]);
    const digest = sha256HexPortable(bytes);
    await seedFile(pages, `${digest}.pending`, new Uint8Array([99]));
    await initial.close();

    const cleaned = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    expect(pages.files.has(`${digest}.pending`)).toBe(false);
    await seedFile(pages, `${digest}.bin`, new Uint8Array([7, 7, 7, 7]));
    await expect(cleaned.getCas("page", digest)).rejects.toMatchObject({
      code: "READ_FAILED",
    });
    await expect(cleaned.putCas("page", digest, bytes)).rejects.toMatchObject({
      code: "WRITE_FAILED",
    });
    await cleaned.close();

    await seedFile(pages, `${digest}.pending`, bytes);
    const recovered = await createStudioDryMediaUnionContinuationOpfsCasStore(scope);
    expect(await recovered.getCas("page", digest)).toEqual(bytes);
    expect(pages.files.has(`${digest}.pending`)).toBe(false);
    await recovered.close();
  });

  it("fails closed outside a Dedicated Worker and rejects forged CAS identities", async () => {
    await expect(createStudioDryMediaUnionContinuationOpfsCasStore({
      document: {},
      navigator: { storage: { getDirectory: async () => new MemoryDirectory() } },
    })).rejects.toEqual(expect.objectContaining<Partial<StudioOpfsSyncAccessError>>({
      code: "NOT_DEDICATED_WORKER",
    }));

    const store = await createStudioDryMediaUnionContinuationOpfsCasStore(
      new DedicatedWorkerGlobalScope(new MemoryDirectory()),
    );
    await expect(store.putCas(
      "page",
      "0".repeat(64),
      new Uint8Array([1, 2, 3]),
    )).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await store.close();
  });
});
