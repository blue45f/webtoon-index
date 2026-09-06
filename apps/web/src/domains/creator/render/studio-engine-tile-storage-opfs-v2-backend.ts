import {
  STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES,
  STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
} from "../studio-large-document-address-space";

import type {
  StudioEngineTileStorageWorkerV2File,
  StudioEngineTileStorageWorkerV2ShardBackend,
} from "./studio-engine-tile-storage-worker-v2";

/**
 * Native OPFS layout for the v2 tile-storage authority.
 *
 * Every logical file owns a directory of independently locked sync-access shards:
 *
 *   /<root>/<documentId>/{document,wal,markers}/shard-<u64>.bin
 *
 * No writable-stream, IndexedDB, or memory fallback is permitted here. Callers that cannot open
 * this backend must stop before constructing the v2 storage authority.
 */
export const STUDIO_ENGINE_TILE_STORAGE_OPFS_V2_ROOT_NAME =
  "toonspectrum-studio-engine-storage-v2";

const DOCUMENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ROOT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHARD_FILE_RE = /^shard-(0|[1-9][0-9]*)\.bin$/u;
const FILE_ORDER = ["document", "wal", "markers"] as const;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export type StudioEngineTileStorageOpfsV2BackendErrorCode =
  | "not-dedicated-worker"
  | "opfs-unavailable"
  | "sync-access-unavailable"
  | "invalid-argument"
  | "backend-closed"
  | "aborted"
  | "enumerate-failed"
  | "open-failed"
  | "invalid-shard-size"
  | "read-failed"
  | "short-read"
  | "write-failed"
  | "short-write"
  | "flush-failed"
  | "truncate-failed"
  | "remove-failed"
  | "close-failed";

export class StudioEngineTileStorageOpfsV2BackendError extends Error {
  public readonly code: StudioEngineTileStorageOpfsV2BackendErrorCode;
  public override readonly cause?: unknown;

  public constructor(
    code: StudioEngineTileStorageOpfsV2BackendErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "StudioEngineTileStorageOpfsV2BackendError";
    this.code = code;
    this.cause = cause;
  }
}

export interface StudioEngineTileStorageOpfsV2SyncAccessHandleLike {
  getSize(): number;
  read(buffer: Uint8Array, options: { readonly at: number }): number;
  write(buffer: Uint8Array, options: { readonly at: number }): number;
  flush(): void;
  truncate(newSize: number): void;
  close(): void;
}

export interface StudioEngineTileStorageOpfsV2FileHandleLike {
  createSyncAccessHandle?():
  Promise<StudioEngineTileStorageOpfsV2SyncAccessHandleLike>;
}

export interface StudioEngineTileStorageOpfsV2DirectoryHandleLike {
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<StudioEngineTileStorageOpfsV2DirectoryHandleLike>;
  getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<StudioEngineTileStorageOpfsV2FileHandleLike>;
  removeEntry(
    name: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void>;
  keys(): AsyncIterable<string>;
}

export interface StudioEngineTileStorageOpfsV2StorageManagerLike {
  getDirectory(): Promise<StudioEngineTileStorageOpfsV2DirectoryHandleLike>;
}

export interface StudioEngineTileStorageOpfsV2WorkerScopeLike {
  readonly navigator?: {
    readonly storage?: Partial<
      StudioEngineTileStorageOpfsV2StorageManagerLike
    >;
  };
  readonly document?: unknown;
}

export interface StudioEngineTileStorageOpfsV2BackendOptions {
  readonly documentId: string;
  readonly shardBytes?: bigint;
  readonly rootName?: string;
  readonly scope?: unknown;
  readonly signal?: AbortSignal;
}

interface FileState {
  readonly file: StudioEngineTileStorageWorkerV2File;
  readonly directory: StudioEngineTileStorageOpfsV2DirectoryHandleLike;
  readonly handles: Map<
    string,
    StudioEngineTileStorageOpfsV2SyncAccessHandleLike
  >;
  logicalByteLength: bigint | null;
  tail: Promise<void>;
}

interface ShardEntry {
  readonly index: bigint;
  readonly name: string;
}

function fail(
  code: StudioEngineTileStorageOpfsV2BackendErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StudioEngineTileStorageOpfsV2BackendError(
    code,
    message,
    cause,
  );
}

function validName(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function isDedicatedWorkerScope(scope: unknown): boolean {
  if (typeof scope !== "object" || scope === null) return false;
  const candidate = scope as StudioEngineTileStorageOpfsV2WorkerScopeLike & {
    readonly constructor?: { readonly name?: unknown };
  };
  if ("document" in candidate) return false;
  return (
    Object.prototype.toString.call(scope) === "[object DedicatedWorkerGlobalScope]"
    || candidate.constructor?.name === "DedicatedWorkerGlobalScope"
  );
}

function assertSignal(signal: AbortSignal): void {
  if (!signal.aborted) return;
  fail("aborted", "The OPFS shard operation was aborted.", signal.reason);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { readonly name?: unknown }).name === "NotFoundError"
  );
}

function shardFileName(shardIndex: bigint): string {
  return `shard-${shardIndex.toString(10)}.bin`;
}

function parseShardFileName(name: string): bigint | null {
  const match = SHARD_FILE_RE.exec(name);
  if (!match?.[1]) return null;
  try {
    return BigInt(match[1]);
  } catch {
    return null;
  }
}

function compareShardEntries(left: ShardEntry, right: ShardEntry): number {
  return left.index < right.index ? -1 : left.index > right.index ? 1 : 0;
}

function validateShardBytes(value: bigint): bigint {
  if (
    typeof value !== "bigint"
    || value <= BigInt(0)
    || value > MAX_SAFE
  ) {
    fail(
      "invalid-argument",
      "OPFS v2 shardBytes must be a positive Number-safe bigint.",
    );
  }
  return value;
}

function validateShardAddress(
  shardIndex: bigint,
  shardByteOffset: number,
  byteLength: number,
  shardBytes: bigint,
): bigint {
  if (
    typeof shardIndex !== "bigint"
    || shardIndex < BigInt(0)
    || !Number.isSafeInteger(shardByteOffset)
    || shardByteOffset < 0
    || !Number.isSafeInteger(byteLength)
    || byteLength < 0
  ) {
    fail("invalid-argument", "The OPFS v2 shard range is invalid.");
  }
  const localEnd = BigInt(shardByteOffset) + BigInt(byteLength);
  if (localEnd > shardBytes) {
    fail("invalid-argument", "The OPFS v2 shard range crosses a shard boundary.");
  }
  if (
    shardIndex
    > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES / shardBytes
  ) {
    fail("invalid-argument", "The OPFS v2 shard index exceeds the logical budget.");
  }
  const globalEnd = shardIndex * shardBytes + localEnd;
  if (globalEnd > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES) {
    fail("invalid-argument", "The OPFS v2 range exceeds the logical budget.");
  }
  return globalEnd;
}

function validateLogicalByteLength(value: bigint): bigint {
  if (
    typeof value !== "bigint"
    || value < BigInt(0)
    || value > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES
  ) {
    fail("invalid-argument", "The OPFS v2 logical byte length is invalid.");
  }
  return value;
}

function validateNativeSize(size: number, shardBytes: bigint): number {
  if (
    !Number.isSafeInteger(size)
    || size < 0
    || BigInt(size) > shardBytes
  ) {
    fail(
      "invalid-shard-size",
      "An OPFS v2 shard has an unsafe or over-budget physical size.",
    );
  }
  return size;
}

function normalizeError(
  error: unknown,
  code: StudioEngineTileStorageOpfsV2BackendErrorCode,
  message: string,
): never {
  if (error instanceof StudioEngineTileStorageOpfsV2BackendError) throw error;
  fail(code, message, error);
}

/**
 * OPFS implementation of the low-level v2 shard boundary.
 *
 * Operations for one logical file are serialized while document/WAL/marker files may progress
 * independently. This prevents duplicate sync-access locks and preserves per-file flush order.
 */
export class StudioEngineTileStorageOpfsV2Backend
implements StudioEngineTileStorageWorkerV2ShardBackend {
  public readonly kind = "opfs-sync-shards" as const;
  public readonly documentId: string;
  public readonly rootName: string;
  public readonly shardBytes: bigint;

  readonly #states: Readonly<
    Record<StudioEngineTileStorageWorkerV2File, FileState>
  >;
  #lifecycle: "open" | "closing" | "closed" = "open";
  #closePromise: Promise<void> | null = null;

  public constructor(input: Readonly<{
    documentId: string;
    rootName: string;
    shardBytes: bigint;
    directories: Readonly<
      Record<
        StudioEngineTileStorageWorkerV2File,
        StudioEngineTileStorageOpfsV2DirectoryHandleLike
      >
    >;
  }>) {
    this.documentId = input.documentId;
    this.rootName = input.rootName;
    this.shardBytes = validateShardBytes(input.shardBytes);
    this.#states = Object.freeze({
      document: this.#createState("document", input.directories.document),
      wal: this.#createState("wal", input.directories.wal),
      markers: this.#createState("markers", input.directories.markers),
    });
  }

  public logicalByteLength(
    file: StudioEngineTileStorageWorkerV2File,
    signal: AbortSignal,
  ): Promise<bigint> {
    const state = this.#state(file);
    return this.#enqueue(state, async () => {
      this.#assertOpen();
      assertSignal(signal);
      return this.#loadLogicalByteLength(state, signal);
    });
  }

  public read(
    file: StudioEngineTileStorageWorkerV2File,
    shardIndex: bigint,
    shardByteOffset: number,
    byteLength: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const globalEnd = validateShardAddress(
      shardIndex,
      shardByteOffset,
      byteLength,
      this.shardBytes,
    );
    const state = this.#state(file);
    return this.#enqueue(state, async () => {
      this.#assertOpen();
      assertSignal(signal);
      const logicalByteLength = await this.#loadLogicalByteLength(state, signal);
      if (globalEnd > logicalByteLength) {
        fail("short-read", "The OPFS v2 read exceeds the logical file length.");
      }
      const output = new Uint8Array(byteLength);
      if (byteLength === 0) return output;
      try {
        const handle = await this.#openHandle(
          state,
          shardIndex,
          false,
          signal,
        );
        if (handle === null) return output;
        const physicalSize = validateNativeSize(
          handle.getSize(),
          this.shardBytes,
        );
        if (shardByteOffset >= physicalSize) return output;
        const readable = Math.min(
          byteLength,
          physicalSize - shardByteOffset,
        );
        let completed = 0;
        while (completed < readable) {
          assertSignal(signal);
          const read = handle.read(
            output.subarray(completed, readable),
            { at: shardByteOffset + completed },
          );
          if (
            !Number.isSafeInteger(read)
            || read <= 0
            || read > readable - completed
          ) {
            fail(
              "short-read",
              "The OPFS sync-access handle returned a short read.",
            );
          }
          completed += read;
        }
        assertSignal(signal);
        return output;
      } catch (error) {
        normalizeError(error, "read-failed", "The OPFS v2 shard read failed.");
      }
    });
  }

  public write(
    file: StudioEngineTileStorageWorkerV2File,
    shardIndex: bigint,
    shardByteOffset: number,
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<void> {
    if (!(bytes instanceof Uint8Array)) {
      return Promise.reject(new StudioEngineTileStorageOpfsV2BackendError(
        "invalid-argument",
        "OPFS v2 writes require Uint8Array bytes.",
      ));
    }
    const stableBytes = Uint8Array.from(bytes);
    const globalEnd = validateShardAddress(
      shardIndex,
      shardByteOffset,
      stableBytes.byteLength,
      this.shardBytes,
    );
    const state = this.#state(file);
    return this.#enqueue(state, async () => {
      this.#assertOpen();
      assertSignal(signal);
      if (stableBytes.byteLength === 0) return;
      try {
        const previousLength = await this.#loadLogicalByteLength(state, signal);
        const handle = await this.#openHandle(
          state,
          shardIndex,
          true,
          signal,
        );
        if (handle === null) {
          fail("open-failed", "The OPFS v2 shard could not be created.");
        }
        let completed = 0;
        while (completed < stableBytes.byteLength) {
          assertSignal(signal);
          const written = handle.write(stableBytes.subarray(completed), {
            at: shardByteOffset + completed,
          });
          if (
            !Number.isSafeInteger(written)
            || written <= 0
            || written > stableBytes.byteLength - completed
          ) {
            fail(
              "short-write",
              "The OPFS sync-access handle returned a short write.",
            );
          }
          completed += written;
        }
        assertSignal(signal);
        const physicalSize = validateNativeSize(
          handle.getSize(),
          this.shardBytes,
        );
        const physicalEnd =
          shardIndex * this.shardBytes + BigInt(physicalSize);
        if (physicalEnd < globalEnd) {
          fail(
            "short-write",
            "The OPFS shard size did not cover the completed write.",
          );
        }
        state.logicalByteLength =
          physicalEnd > previousLength ? physicalEnd : previousLength;
      } catch (error) {
        state.logicalByteLength = null;
        normalizeError(error, "write-failed", "The OPFS v2 shard write failed.");
      }
    });
  }

  public flush(
    file: StudioEngineTileStorageWorkerV2File,
    signal: AbortSignal,
  ): Promise<void> {
    const state = this.#state(file);
    return this.#enqueue(state, async () => {
      this.#assertOpen();
      assertSignal(signal);
      try {
        for (const [, handle] of this.#sortedHandles(state)) {
          assertSignal(signal);
          handle.flush();
          assertSignal(signal);
        }
      } catch (error) {
        normalizeError(
          error,
          "flush-failed",
          `The OPFS v2 ${file} flush failed.`,
        );
      }
    });
  }

  public truncate(
    file: StudioEngineTileStorageWorkerV2File,
    logicalByteLength: bigint,
    signal: AbortSignal,
  ): Promise<void> {
    const targetLength = validateLogicalByteLength(logicalByteLength);
    const state = this.#state(file);
    return this.#enqueue(state, async () => {
      this.#assertOpen();
      assertSignal(signal);
      state.logicalByteLength = null;
      try {
        const entries = await this.#listShards(state, signal);
        const finalShardIndex = targetLength === BigInt(0)
          ? null
          : (targetLength - BigInt(1)) / this.shardBytes;
        const finalShardSize = finalShardIndex === null
          ? 0
          : Number(
            ((targetLength - BigInt(1)) % this.shardBytes) + BigInt(1),
          );

        for (const entry of entries.toSorted(compareShardEntries).reverse()) {
          if (
            finalShardIndex !== null
            && entry.index <= finalShardIndex
          ) {
            continue;
          }
          await this.#removeShard(state, entry, signal);
        }

        if (finalShardIndex !== null) {
          const handle = await this.#openHandle(
            state,
            finalShardIndex,
            true,
            signal,
          );
          if (handle === null) {
            fail("open-failed", "The final OPFS v2 shard could not be created.");
          }
          handle.truncate(finalShardSize);
          assertSignal(signal);
          const size = validateNativeSize(handle.getSize(), this.shardBytes);
          if (size !== finalShardSize) {
            fail(
              "truncate-failed",
              "The final OPFS v2 shard has an unexpected size after truncate.",
            );
          }
        }
        state.logicalByteLength = targetLength;
      } catch (error) {
        state.logicalByteLength = null;
        normalizeError(
          error,
          "truncate-failed",
          `The OPFS v2 ${file} truncate failed.`,
        );
      }
    });
  }

  public close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#lifecycle = "closing";
    this.#closePromise = this.#closeInternal();
    return this.#closePromise;
  }

  #createState(
    file: StudioEngineTileStorageWorkerV2File,
    directory: StudioEngineTileStorageOpfsV2DirectoryHandleLike,
  ): FileState {
    return {
      file,
      directory,
      handles: new Map(),
      logicalByteLength: null,
      tail: Promise.resolve(),
    };
  }

  #state(file: StudioEngineTileStorageWorkerV2File): FileState {
    if (!FILE_ORDER.includes(file)) {
      fail("invalid-argument", "The OPFS v2 logical file name is invalid.");
    }
    return this.#states[file];
  }

  #enqueue<T>(state: FileState, operation: () => Promise<T>): Promise<T> {
    if (this.#lifecycle !== "open") {
      return Promise.reject(new StudioEngineTileStorageOpfsV2BackendError(
        "backend-closed",
        "The OPFS v2 shard backend is closing or closed.",
      ));
    }
    const result = state.tail.then(operation, operation);
    state.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #assertOpen(): void {
    if (this.#lifecycle !== "open") {
      fail(
        "backend-closed",
        "The OPFS v2 shard backend is closing or closed.",
      );
    }
  }

  async #loadLogicalByteLength(
    state: FileState,
    signal: AbortSignal,
  ): Promise<bigint> {
    if (state.logicalByteLength !== null) return state.logicalByteLength;
    const entries = await this.#listShards(state, signal);
    let logicalByteLength = BigInt(0);
    try {
      for (const entry of entries) {
        assertSignal(signal);
        const handle = await this.#openHandle(
          state,
          entry.index,
          false,
          signal,
        );
        if (handle === null) continue;
        const size = validateNativeSize(handle.getSize(), this.shardBytes);
        if (size === 0) continue;
        const end = entry.index * this.shardBytes + BigInt(size);
        if (end > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES) {
          fail(
            "invalid-shard-size",
            "An OPFS v2 shard exceeds the logical address budget.",
          );
        }
        if (end > logicalByteLength) logicalByteLength = end;
      }
    } catch (error) {
      normalizeError(
        error,
        "invalid-shard-size",
        `The OPFS v2 ${state.file} length could not be recovered.`,
      );
    }
    state.logicalByteLength = logicalByteLength;
    return logicalByteLength;
  }

  async #listShards(
    state: FileState,
    signal: AbortSignal,
  ): Promise<ShardEntry[]> {
    const entries: ShardEntry[] = [];
    try {
      for await (const name of state.directory.keys()) {
        this.#assertOpen();
        assertSignal(signal);
        const index = parseShardFileName(name);
        if (index === null) continue;
        if (
          index
          > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES / this.shardBytes
        ) {
          fail(
            "invalid-shard-size",
            "An OPFS v2 shard name exceeds the logical address budget.",
          );
        }
        entries.push({ index, name });
      }
      entries.sort(compareShardEntries);
      this.#assertOpen();
      assertSignal(signal);
      return entries;
    } catch (error) {
      normalizeError(
        error,
        "enumerate-failed",
        `The OPFS v2 ${state.file} shards could not be enumerated.`,
      );
    }
  }

  async #openHandle(
    state: FileState,
    shardIndex: bigint,
    create: boolean,
    signal: AbortSignal,
  ): Promise<StudioEngineTileStorageOpfsV2SyncAccessHandleLike | null> {
    this.#assertOpen();
    assertSignal(signal);
    const name = shardFileName(shardIndex);
    const cached = state.handles.get(name);
    if (cached) return cached;

    let fileHandle: StudioEngineTileStorageOpfsV2FileHandleLike;
    try {
      fileHandle = await state.directory.getFileHandle(name, { create });
    } catch (error) {
      if (!create && isNotFoundError(error)) return null;
      normalizeError(
        error,
        "open-failed",
        `The OPFS v2 ${state.file} shard file could not be opened.`,
      );
    }
    this.#assertOpenAfterAwait(signal);
    if (typeof fileHandle.createSyncAccessHandle !== "function") {
      fail(
        "sync-access-unavailable",
        "The OPFS file does not expose createSyncAccessHandle().",
      );
    }

    let handle: StudioEngineTileStorageOpfsV2SyncAccessHandleLike | null = null;
    try {
      handle = await fileHandle.createSyncAccessHandle();
      this.#assertOpenAfterAwait(signal);
      const raced = state.handles.get(name);
      if (raced) {
        handle.close();
        return raced;
      }
      state.handles.set(name, handle);
      return handle;
    } catch (error) {
      if (handle) {
        try {
          handle.close();
        } catch {
          // The lifecycle/abort failure remains authoritative.
        }
      }
      normalizeError(
        error,
        this.#lifecycle === "open" ? "open-failed" : "backend-closed",
        `The OPFS v2 ${state.file} sync-access handle could not be opened.`,
      );
    }
  }

  #assertOpenAfterAwait(signal: AbortSignal): void {
    assertSignal(signal);
    this.#assertOpen();
  }

  async #removeShard(
    state: FileState,
    entry: ShardEntry,
    signal: AbortSignal,
  ): Promise<void> {
    assertSignal(signal);
    const cached = state.handles.get(entry.name);
    if (cached) {
      try {
        cached.close();
        state.handles.delete(entry.name);
      } catch (error) {
        normalizeError(
          error,
          "close-failed",
          `The OPFS v2 ${state.file} shard lock could not be released.`,
        );
      }
    }
    try {
      await state.directory.removeEntry(entry.name);
      this.#assertOpenAfterAwait(signal);
    } catch (error) {
      normalizeError(
        error,
        "remove-failed",
        `The excess OPFS v2 ${state.file} shard could not be removed.`,
      );
    }
  }

  #sortedHandles(
    state: FileState,
  ): Array<
    readonly [
      string,
      StudioEngineTileStorageOpfsV2SyncAccessHandleLike,
    ]
  > {
    return [...state.handles.entries()].sort(([left], [right]) => {
      const leftIndex = parseShardFileName(left) ?? BigInt(0);
      const rightIndex = parseShardFileName(right) ?? BigInt(0);
      return leftIndex < rightIndex ? -1 : leftIndex > rightIndex ? 1 : 0;
    });
  }

  async #closeInternal(): Promise<void> {
    const failures: unknown[] = [];
    await Promise.all(FILE_ORDER.map(async file => {
      try {
        await this.#states[file].tail;
      } catch {
        // File tails are normalized to fulfilled promises by #enqueue.
      }
    }));
    for (const file of FILE_ORDER) {
      const state = this.#states[file];
      for (const [name, handle] of this.#sortedHandles(state)) {
        try {
          handle.close();
        } catch (error) {
          failures.push(error);
        } finally {
          state.handles.delete(name);
        }
      }
    }
    this.#lifecycle = "closed";
    if (failures.length > 0) {
      fail(
        "close-failed",
        "One or more OPFS v2 sync-access handles could not be closed.",
        failures,
      );
    }
  }
}

/**
 * Opens the native backend from a Dedicated Worker. The three logical directories are created
 * eagerly, while native shard files and exclusive sync-access handles remain lazy.
 */
export async function createStudioEngineTileStorageOpfsV2Backend(
  options: StudioEngineTileStorageOpfsV2BackendOptions,
): Promise<StudioEngineTileStorageOpfsV2Backend> {
  const rootName =
    options.rootName ?? STUDIO_ENGINE_TILE_STORAGE_OPFS_V2_ROOT_NAME;
  if (
    !validName(options.documentId, DOCUMENT_ID_RE)
    || !validName(rootName, ROOT_NAME_RE)
  ) {
    fail(
      "invalid-argument",
      "The OPFS v2 root or document name is invalid.",
    );
  }
  const shardBytes = validateShardBytes(
    options.shardBytes ?? STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES,
  );
  const signal = options.signal ?? new AbortController().signal;
  assertSignal(signal);
  const scope = options.scope ?? globalThis;
  if (!isDedicatedWorkerScope(scope)) {
    fail(
      "not-dedicated-worker",
      "The OPFS v2 shard backend can only open in a Dedicated Worker.",
    );
  }
  const storage = (
    scope as StudioEngineTileStorageOpfsV2WorkerScopeLike
  ).navigator?.storage;
  if (typeof storage?.getDirectory !== "function") {
    fail(
      "opfs-unavailable",
      "navigator.storage.getDirectory() is unavailable in this Worker.",
    );
  }

  try {
    const opfs = await storage.getDirectory();
    assertSignal(signal);
    const productRoot = await opfs.getDirectoryHandle(rootName, {
      create: true,
    });
    assertSignal(signal);
    const documentRoot = await productRoot.getDirectoryHandle(
      options.documentId,
      { create: true },
    );
    assertSignal(signal);
    const directories = {} as Record<
      StudioEngineTileStorageWorkerV2File,
      StudioEngineTileStorageOpfsV2DirectoryHandleLike
    >;
    for (const file of FILE_ORDER) {
      directories[file] = await documentRoot.getDirectoryHandle(file, {
        create: true,
      });
      assertSignal(signal);
    }
    return new StudioEngineTileStorageOpfsV2Backend({
      documentId: options.documentId,
      rootName,
      shardBytes,
      directories,
    });
  } catch (error) {
    normalizeError(
      error,
      "opfs-unavailable",
      "The OPFS v2 document directories could not be opened.",
    );
  }
}
