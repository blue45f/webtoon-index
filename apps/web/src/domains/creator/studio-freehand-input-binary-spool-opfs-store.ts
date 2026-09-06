import {
  StudioOpfsSyncAccessError,
  probeStudioOpfsSyncAccessCapability,
  type StudioOpfsSyncAccessHandleLike,
  type StudioOpfsSyncDirectoryHandleLike,
} from "./studio-opfs-sync-access-store";
import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_FREEHAND_INPUT_CAS_ROOT_NAME =
  "toonspectrum-studio-freehand-input-v1";
export const STUDIO_FREEHAND_INPUT_CAS_MAX_BLOB_BYTES = 8 * 1024 * 1024;
export const STUDIO_FREEHAND_INPUT_CAS_MAX_STAGING_RECORD_BYTES = 64 * 1024;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STROKE_FILE_SAFE = /^[a-zA-Z0-9._-]{1,192}$/u;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export type StudioFreehandInputCasBlobKind = "page" | "index" | "metadata" | "root";

export interface StudioFreehandInputBinaryCasStore {
  readonly kind: "opfs-sync-cas" | "memory-cas";
  putCas(
    kind: StudioFreehandInputCasBlobKind,
    digest: string,
    bytes: Uint8Array,
  ): Promise<void>;
  getCas(
    kind: StudioFreehandInputCasBlobKind,
    digest: string,
  ): Promise<Uint8Array | null>;
  appendStaging(
    strokeId: string,
    expectedByteOffset: bigint,
    bytes: Uint8Array,
  ): Promise<bigint>;
  removeStaging(strokeId: string): Promise<void>;
  close(): Promise<void>;
}

interface StudioFreehandInputCasSyncAccessHandle
  extends StudioOpfsSyncAccessHandleLike {
  getSize(): number;
}

interface StudioFreehandInputCasFileHandleLike {
  createSyncAccessHandle?: () => Promise<StudioFreehandInputCasSyncAccessHandle>;
}

function validDigest(value: string): boolean {
  return SHA256_HEX.test(value);
}

function validateBlob(bytes: Uint8Array, maximum: number, label: string): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength <= 0 || bytes.byteLength > maximum) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      `${label} binary payload is outside its bounded transfer contract.`,
    );
  }
}

function validateCasIdentity(digest: string, bytes: Uint8Array): void {
  if (!validDigest(digest) || sha256HexPortable(bytes) !== digest) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      "Freehand CAS key does not match its canonical SHA-256 payload.",
    );
  }
}

function stagingFileName(strokeId: string): string {
  if (!STROKE_FILE_SAFE.test(strokeId)) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      "Freehand spool stroke id is not OPFS-file-safe.",
    );
  }
  return `${strokeId}.staging`;
}

function casFileName(digest: string): string {
  if (!validDigest(digest)) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      "Freehand CAS digest must be canonical lowercase SHA-256.",
    );
  }
  return `${digest}.bin`;
}

async function openSyncHandle(
  directory: StudioOpfsSyncDirectoryHandleLike,
  fileName: string,
  create: boolean,
): Promise<StudioFreehandInputCasSyncAccessHandle | null> {
  try {
    const file = (await directory.getFileHandle(
      fileName,
      create ? { create: true } : undefined,
    )) as StudioFreehandInputCasFileHandleLike;
    if (typeof file.createSyncAccessHandle !== "function") {
      throw new StudioOpfsSyncAccessError(
        "SYNC_ACCESS_UNAVAILABLE",
        "Freehand CAS requires Dedicated Worker sync-access handles.",
      );
    }
    return await file.createSyncAccessHandle();
  } catch (error) {
    if (
      !create
      && typeof error === "object"
      && error !== null
      && "name" in error
      && (error as { readonly name?: unknown }).name === "NotFoundError"
    ) return null;
    if (error instanceof StudioOpfsSyncAccessError) throw error;
    throw new StudioOpfsSyncAccessError(
      create ? "WRITE_FAILED" : "READ_FAILED",
      `Freehand CAS file ${create ? "open/write" : "read"} failed.`,
      error,
    );
  }
}

function writeAll(
  handle: StudioFreehandInputCasSyncAccessHandle,
  bytes: Uint8Array,
  at: number,
): void {
  let completed = 0;
  while (completed < bytes.byteLength) {
    const written = handle.write(bytes.subarray(completed), { at: at + completed });
    if (
      !Number.isSafeInteger(written)
      || written <= 0
      || written > bytes.byteLength - completed
    ) {
      throw new StudioOpfsSyncAccessError(
        "WRITE_FAILED",
        "Freehand CAS sync write ended before the bounded payload was complete.",
      );
    }
    completed += written;
  }
}

function readAll(
  handle: StudioFreehandInputCasSyncAccessHandle,
  byteLength: number,
): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let completed = 0;
  while (completed < byteLength) {
    const read = handle.read(bytes.subarray(completed), { at: completed });
    if (!Number.isSafeInteger(read) || read <= 0 || read > byteLength - completed) {
      throw new StudioOpfsSyncAccessError(
        "SHORT_READ",
        "Freehand CAS sync read ended before the declared payload was complete.",
      );
    }
    completed += read;
  }
  return bytes;
}

function byteEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    mismatch |= left[index]! ^ right[index]!;
  }
  return mismatch === 0;
}

class StudioFreehandInputOpfsBinaryCasStore
implements StudioFreehandInputBinaryCasStore {
  readonly kind = "opfs-sync-cas" as const;
  readonly #directories: Readonly<Record<StudioFreehandInputCasBlobKind, StudioOpfsSyncDirectoryHandleLike>>;
  readonly #staging: StudioOpfsSyncDirectoryHandleLike;
  #operationTail: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(input: {
    readonly directories: Readonly<Record<StudioFreehandInputCasBlobKind, StudioOpfsSyncDirectoryHandleLike>>;
    readonly staging: StudioOpfsSyncDirectoryHandleLike;
  }) {
    this.#directories = input.directories;
    this.#staging = input.staging;
  }

  putCas(
    kind: StudioFreehandInputCasBlobKind,
    digest: string,
    bytes: Uint8Array,
  ): Promise<void> {
    validateBlob(bytes, STUDIO_FREEHAND_INPUT_CAS_MAX_BLOB_BYTES, `${kind} CAS`);
    validateCasIdentity(digest, bytes);
    const fileName = casFileName(digest);
    return this.#enqueue(async () => {
      const handle = await openSyncHandle(this.#directories[kind], fileName, true);
      if (!handle) throw new Error("unreachable CAS create result");
      try {
        const currentSize = handle.getSize();
        if (currentSize > 0) {
          if (currentSize !== bytes.byteLength) {
            throw new StudioOpfsSyncAccessError(
              "WRITE_FAILED",
              "Freehand CAS is immutable and an existing digest has a different size.",
            );
          }
          const existing = readAll(handle, currentSize);
          if (byteEqual(existing, bytes)) return;
          throw new StudioOpfsSyncAccessError(
            "WRITE_FAILED",
            "Freehand CAS is immutable and an existing digest has different bytes.",
          );
        }
        handle.truncate(0);
        writeAll(handle, bytes, 0);
        handle.truncate(bytes.byteLength);
        handle.flush();
      } finally {
        handle.close();
      }
    });
  }

  getCas(
    kind: StudioFreehandInputCasBlobKind,
    digest: string,
  ): Promise<Uint8Array | null> {
    const fileName = casFileName(digest);
    return this.#enqueue(async () => {
      const handle = await openSyncHandle(this.#directories[kind], fileName, false);
      if (!handle) return null;
      try {
        const size = handle.getSize();
        if (
          !Number.isSafeInteger(size)
          || size <= 0
          || size > STUDIO_FREEHAND_INPUT_CAS_MAX_BLOB_BYTES
        ) {
          throw new StudioOpfsSyncAccessError(
            "READ_FAILED",
            "Freehand CAS blob size is outside the bounded format contract.",
          );
        }
        return readAll(handle, size);
      } finally {
        handle.close();
      }
    });
  }

  appendStaging(
    strokeId: string,
    expectedByteOffset: bigint,
    bytes: Uint8Array,
  ): Promise<bigint> {
    validateBlob(
      bytes,
      STUDIO_FREEHAND_INPUT_CAS_MAX_STAGING_RECORD_BYTES,
      "staging record",
    );
    if (expectedByteOffset < BigInt(0) || expectedByteOffset > MAX_SAFE_BIGINT) {
      return Promise.reject(new StudioOpfsSyncAccessError(
        "INVALID_ARGUMENT",
        "Freehand staging offset exceeds the Number-safe OPFS range.",
      ));
    }
    const fileName = stagingFileName(strokeId);
    return this.#enqueue(async () => {
      const handle = await openSyncHandle(this.#staging, fileName, true);
      if (!handle) throw new Error("unreachable staging create result");
      try {
        const currentSize = handle.getSize();
        if (currentSize !== Number(expectedByteOffset)) {
          throw new StudioOpfsSyncAccessError(
            "WRITE_FAILED",
            "Freehand staging append offset is stale; the batch was not committed.",
          );
        }
        writeAll(handle, bytes, currentSize);
        handle.flush();
        return expectedByteOffset + BigInt(bytes.byteLength);
      } finally {
        handle.close();
      }
    });
  }

  removeStaging(strokeId: string): Promise<void> {
    const fileName = stagingFileName(strokeId);
    return this.#enqueue(async () => {
      try {
        await this.#staging.removeEntry(fileName);
      } catch (error) {
        if (
          typeof error === "object"
          && error !== null
          && "name" in error
          && (error as { readonly name?: unknown }).name === "NotFoundError"
        ) return;
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.#enqueue(async () => {
      this.#closed = true;
    }, true);
  }

  #enqueue<T>(operation: () => Promise<T>, allowClosed = false): Promise<T> {
    const run = async () => {
      if (this.#closed && !allowClosed) {
        throw new StudioOpfsSyncAccessError("STORE_CLOSED", "Freehand CAS store is closed.");
      }
      return operation();
    };
    const result = this.#operationTail.then(run, run);
    this.#operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export interface StudioFreehandInputMemoryBinaryCasState {
  readonly cas: Map<string, Uint8Array>;
  readonly staging: Map<string, Uint8Array>;
  failNextOperation: "get" | "put" | "append" | null;
  readonly rootWriteDigests: string[];
}

export function createStudioFreehandInputMemoryBinaryCasState(): StudioFreehandInputMemoryBinaryCasState {
  return {
    cas: new Map(),
    staging: new Map(),
    failNextOperation: null,
    rootWriteDigests: [],
  };
}

export function createStudioFreehandInputMemoryBinaryCasStore(
  state: StudioFreehandInputMemoryBinaryCasState =
    createStudioFreehandInputMemoryBinaryCasState(),
): StudioFreehandInputBinaryCasStore {
  let closed = false;
  const fail = (operation: "get" | "put" | "append") => {
    if (state.failNextOperation !== operation) return;
    state.failNextOperation = null;
    throw new StudioOpfsSyncAccessError(
      operation === "get" ? "READ_FAILED" : "WRITE_FAILED",
      `Injected freehand ${operation} failure.`,
    );
  };
  const assertOpen = () => {
    if (closed) throw new StudioOpfsSyncAccessError("STORE_CLOSED", "Memory CAS is closed.");
  };
  return {
    kind: "memory-cas",
    async putCas(kind, digest, bytes) {
      assertOpen();
      fail("put");
      validateBlob(bytes, STUDIO_FREEHAND_INPUT_CAS_MAX_BLOB_BYTES, `${kind} CAS`);
      validateCasIdentity(digest, bytes);
      casFileName(digest);
      const key = `${kind}:${digest}`;
      const existing = state.cas.get(key);
      if (existing && !byteEqual(existing, bytes)) {
        throw new StudioOpfsSyncAccessError(
          "WRITE_FAILED",
          "Memory CAS is immutable and an existing digest has different bytes.",
        );
      }
      state.cas.set(key, bytes.slice());
      if (kind === "root") state.rootWriteDigests.push(digest);
    },
    async getCas(kind, digest) {
      assertOpen();
      fail("get");
      casFileName(digest);
      return state.cas.get(`${kind}:${digest}`)?.slice() ?? null;
    },
    async appendStaging(strokeId, expectedByteOffset, bytes) {
      assertOpen();
      fail("append");
      validateBlob(
        bytes,
        STUDIO_FREEHAND_INPUT_CAS_MAX_STAGING_RECORD_BYTES,
        "staging record",
      );
      const key = stagingFileName(strokeId);
      const current = state.staging.get(key) ?? new Uint8Array(0);
      if (BigInt(current.byteLength) !== expectedByteOffset) {
        throw new StudioOpfsSyncAccessError(
          "WRITE_FAILED",
          "Injected memory staging offset mismatch.",
        );
      }
      const next = new Uint8Array(current.byteLength + bytes.byteLength);
      next.set(current);
      next.set(bytes, current.byteLength);
      state.staging.set(key, next);
      return BigInt(next.byteLength);
    },
    async removeStaging(strokeId) {
      assertOpen();
      state.staging.delete(stagingFileName(strokeId));
    },
    async close() {
      closed = true;
    },
  };
}

export async function createStudioFreehandInputOpfsBinaryCasStore(
  scope: unknown = globalThis,
): Promise<StudioFreehandInputBinaryCasStore> {
  const capability = probeStudioOpfsSyncAccessCapability(scope);
  if (!capability.supported) {
    throw new StudioOpfsSyncAccessError(
      capability.reason === "not-dedicated-worker"
        ? "NOT_DEDICATED_WORKER"
        : "OPFS_UNAVAILABLE",
      "Freehand binary CAS requires OPFS sync access in a Dedicated Worker.",
    );
  }
  const opfsRoot = await capability.storageManager.getDirectory();
  const root = await opfsRoot.getDirectoryHandle(STUDIO_FREEHAND_INPUT_CAS_ROOT_NAME, {
    create: true,
  });
  const [page, index, metadata, rootDirectory, staging] = await Promise.all([
    root.getDirectoryHandle("pages", { create: true }),
    root.getDirectoryHandle("indexes", { create: true }),
    root.getDirectoryHandle("metadata", { create: true }),
    root.getDirectoryHandle("roots", { create: true }),
    root.getDirectoryHandle("staging", { create: true }),
  ]);
  return new StudioFreehandInputOpfsBinaryCasStore({
    directories: { page, index, metadata, root: rootDirectory },
    staging,
  });
}
