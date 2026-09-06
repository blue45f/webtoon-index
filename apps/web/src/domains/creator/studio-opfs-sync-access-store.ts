import {
  STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES,
  STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES,
  resolveStudioLargeDocumentShardSpan,
} from "./studio-large-document-address-space";

/**
 * High-throughput OPFS range storage for the Studio render/storage worker.
 *
 * `FileSystemSyncAccessHandle` is intentionally isolated behind this module:
 *
 * - it is opened only from a real Dedicated Worker;
 * - logical addresses stay `bigint` until they have been split into a shard and
 *   a Number-safe offset;
 * - missing capabilities fail closed instead of silently falling back to
 *   `createWritable()`;
 * - each shard keeps one cached synchronous access handle, while the public
 *   API serializes asynchronous handle creation and destructive operations.
 *
 * This is the bounded resident-storage side of Memory64. It does not imply that
 * one JavaScript typed array, one WebAssembly memory, or one OPFS file can span
 * the entire logical document.
 */

export const STUDIO_OPFS_SYNC_DEFAULT_ROOT_NAME =
  "toonspectrum-studio-large-documents";
export const STUDIO_OPFS_SYNC_MAX_TRANSFER_BYTES = 64 * 1024 * 1024;

const DOCUMENT_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const SHARD_FILE_RE = /^shard-([0-9]+)\.bin$/u;

export type StudioOpfsSyncAccessErrorCode =
  | "NOT_DEDICATED_WORKER"
  | "OPFS_UNAVAILABLE"
  | "SYNC_ACCESS_UNAVAILABLE"
  | "INVALID_ARGUMENT"
  | "STORE_CLOSED"
  | "READ_FAILED"
  | "SHORT_READ"
  | "WRITE_FAILED"
  | "FLUSH_FAILED"
  | "TRUNCATE_FAILED"
  | "CLOSE_FAILED";

export class StudioOpfsSyncAccessError extends Error {
  public readonly code: StudioOpfsSyncAccessErrorCode;
  public override readonly cause?: unknown;

  public constructor(
    code: StudioOpfsSyncAccessErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "StudioOpfsSyncAccessError";
    this.code = code;
    this.cause = cause;
  }
}

export function isStudioOpfsSyncAccessError(
  value: unknown,
): value is StudioOpfsSyncAccessError {
  return value instanceof StudioOpfsSyncAccessError;
}

export interface StudioOpfsSyncAccessHandleLike {
  read(buffer: Uint8Array, options: { readonly at: number }): number;
  write(buffer: Uint8Array, options: { readonly at: number }): number;
  flush(): void;
  truncate(newSize: number): void;
  close(): void;
}

export interface StudioOpfsSyncFileHandleLike {
  createSyncAccessHandle?: () => Promise<StudioOpfsSyncAccessHandleLike>;
}

export interface StudioOpfsSyncDirectoryHandleLike {
  getDirectoryHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<StudioOpfsSyncDirectoryHandleLike>;
  getFileHandle(
    name: string,
    options?: { readonly create?: boolean },
  ): Promise<StudioOpfsSyncFileHandleLike>;
  removeEntry(
    name: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void>;
  keys(): AsyncIterable<string>;
}

export interface StudioOpfsSyncStorageManagerLike {
  getDirectory(): Promise<StudioOpfsSyncDirectoryHandleLike>;
}

export interface StudioOpfsSyncWorkerScopeLike {
  readonly navigator?: {
    readonly storage?: Partial<StudioOpfsSyncStorageManagerLike>;
  };
  readonly document?: unknown;
}

export type StudioOpfsSyncAccessCapability =
  | {
      readonly supported: true;
      readonly storageManager: StudioOpfsSyncStorageManagerLike;
    }
  | {
      readonly supported: false;
      readonly reason: "not-dedicated-worker" | "opfs-unavailable";
    };

function isDedicatedWorkerScope(scope: unknown): boolean {
  if (typeof scope !== "object" || scope === null) return false;
  const candidate = scope as StudioOpfsSyncWorkerScopeLike & {
    readonly constructor?: { readonly name?: unknown };
  };
  if ("document" in candidate && candidate.document !== undefined) return false;

  const objectTag = Object.prototype.toString.call(scope);
  const constructorName = candidate.constructor?.name;
  return (
    objectTag === "[object DedicatedWorkerGlobalScope]"
    || constructorName === "DedicatedWorkerGlobalScope"
  );
}

/**
 * Performs the cheap, side-effect-free portion of the capability probe.
 *
 * The file-handle-level `createSyncAccessHandle` check happens while opening
 * the native store because the method does not exist on `navigator.storage`.
 */
export function probeStudioOpfsSyncAccessCapability(
  scope: unknown = globalThis,
): StudioOpfsSyncAccessCapability {
  if (!isDedicatedWorkerScope(scope)) {
    return { supported: false, reason: "not-dedicated-worker" };
  }
  const storageManager = (
    scope as StudioOpfsSyncWorkerScopeLike
  ).navigator?.storage;
  if (typeof storageManager?.getDirectory !== "function") {
    return { supported: false, reason: "opfs-unavailable" };
  }
  return {
    supported: true,
    storageManager: storageManager as StudioOpfsSyncStorageManagerLike,
  };
}

export interface StudioOpfsSyncAccessStore {
  readonly kind: "opfs-sync-access" | "memory-sync-access";
  readonly documentId: string;
  readonly shardBytes: bigint;
  read(globalByteOffset: bigint, byteLength: number): Promise<Uint8Array>;
  write(globalByteOffset: bigint, bytes: Uint8Array): Promise<void>;
  flush(): Promise<void>;
  truncate(logicalByteLength: bigint): Promise<void>;
  close(): Promise<void>;
}

export interface StudioOpfsSyncAccessStoreOptions {
  readonly documentId: string;
  readonly shardBytes?: bigint;
  readonly rootName?: string;
  readonly scope?: unknown;
}

interface StudioOpfsSyncRangeSpan {
  readonly shardIndex: bigint;
  readonly shardByteOffset: number;
  readonly byteLength: number;
  readonly transferByteOffset: number;
}

function validName(value: string): boolean {
  return DOCUMENT_ID_RE.test(value);
}

function validateShardBytes(value: bigint): bigint {
  if (
    value <= BigInt(0)
    || value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      "OPFS shard 크기는 Number-safe 양의 정수 범위여야 합니다.",
    );
  }
  return value;
}

function validateGlobalOffset(value: bigint): void {
  if (
    typeof value !== "bigint"
    || value < BigInt(0)
    || value > STUDIO_LARGE_DOCUMENT_MAX_LOGICAL_BYTES
  ) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      "논리 바이트 오프셋이 signed i64 범위를 벗어났습니다.",
    );
  }
}

function planRange(
  globalByteOffset: bigint,
  byteLength: number,
  shardBytes: bigint,
): StudioOpfsSyncRangeSpan[] {
  validateGlobalOffset(globalByteOffset);
  if (
    !Number.isSafeInteger(byteLength)
    || byteLength < 0
    || byteLength > STUDIO_OPFS_SYNC_MAX_TRANSFER_BYTES
  ) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      `한 번의 OPFS 전송은 0~${STUDIO_OPFS_SYNC_MAX_TRANSFER_BYTES}바이트여야 합니다.`,
    );
  }
  if (byteLength === 0) return [];

  const spans: StudioOpfsSyncRangeSpan[] = [];
  let nextGlobalOffset = globalByteOffset;
  let remaining = BigInt(byteLength);
  let transferByteOffset = 0;
  while (remaining > BigInt(0)) {
    const span = resolveStudioLargeDocumentShardSpan({
      globalByteOffset: nextGlobalOffset,
      remainingByteLength: remaining,
      shardBytes,
      maxSpanBytes: STUDIO_OPFS_SYNC_MAX_TRANSFER_BYTES,
    });
    if (span === null) {
      throw new StudioOpfsSyncAccessError(
        "INVALID_ARGUMENT",
        "논리 바이트 범위를 안전한 OPFS shard 범위로 변환할 수 없습니다.",
      );
    }
    spans.push({
      shardIndex: span.shardIndex,
      shardByteOffset: span.shardByteOffset,
      byteLength: span.byteLength,
      transferByteOffset,
    });
    nextGlobalOffset = span.globalByteEndExclusive;
    remaining -= span.byteLengthI64;
    transferByteOffset += span.byteLength;
  }
  return spans;
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

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && "name" in error
    && (error as { readonly name?: unknown }).name === "NotFoundError"
  );
}

class StudioOpfsShardedSyncAccessStore
implements StudioOpfsSyncAccessStore {
  public readonly kind: StudioOpfsSyncAccessStore["kind"];
  public readonly documentId: string;
  public readonly shardBytes: bigint;

  readonly #directory: StudioOpfsSyncDirectoryHandleLike;
  readonly #handles = new Map<string, StudioOpfsSyncAccessHandleLike>();
  #operationTail: Promise<void> = Promise.resolve();
  #closed = false;

  public constructor(input: {
    readonly kind: StudioOpfsSyncAccessStore["kind"];
    readonly documentId: string;
    readonly shardBytes: bigint;
    readonly directory: StudioOpfsSyncDirectoryHandleLike;
  }) {
    this.kind = input.kind;
    this.documentId = input.documentId;
    this.shardBytes = validateShardBytes(input.shardBytes);
    this.#directory = input.directory;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new StudioOpfsSyncAccessError(
        "STORE_CLOSED",
        "이미 닫힌 OPFS sync-access 저장소입니다.",
      );
    }
  }

  async #openHandle(
    shardIndex: bigint,
    create: boolean,
  ): Promise<StudioOpfsSyncAccessHandleLike | null> {
    const fileName = shardFileName(shardIndex);
    const cached = this.#handles.get(fileName);
    if (cached) return cached;

    let fileHandle: StudioOpfsSyncFileHandleLike;
    try {
      fileHandle = await this.#directory.getFileHandle(fileName, { create });
    } catch (error) {
      if (!create && isNotFoundError(error)) return null;
      throw error;
    }
    if (typeof fileHandle.createSyncAccessHandle !== "function") {
      throw new StudioOpfsSyncAccessError(
        "SYNC_ACCESS_UNAVAILABLE",
        "이 실행 환경은 OPFS createSyncAccessHandle을 지원하지 않습니다.",
      );
    }
    const handle = await fileHandle.createSyncAccessHandle();
    this.#handles.set(fileName, handle);
    return handle;
  }

  public read(
    globalByteOffset: bigint,
    byteLength: number,
  ): Promise<Uint8Array> {
    let spans: StudioOpfsSyncRangeSpan[];
    try {
      spans = planRange(globalByteOffset, byteLength, this.shardBytes);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(async () => {
      this.#assertOpen();
      const output = new Uint8Array(byteLength);
      try {
        for (const span of spans) {
          const handle = await this.#openHandle(span.shardIndex, false);
          if (handle === null) {
            throw new StudioOpfsSyncAccessError(
              "SHORT_READ",
              `OPFS shard ${span.shardIndex.toString(10)}가 없어 요청 범위를 읽지 못했습니다.`,
            );
          }
          const target = output.subarray(
            span.transferByteOffset,
            span.transferByteOffset + span.byteLength,
          );
          let completed = 0;
          while (completed < target.byteLength) {
            const read = handle.read(target.subarray(completed), {
              at: span.shardByteOffset + completed,
            });
            if (
              !Number.isSafeInteger(read)
              || read <= 0
              || read > target.byteLength - completed
            ) {
              throw new StudioOpfsSyncAccessError(
                "SHORT_READ",
                "OPFS sync-access 읽기가 요청 길이보다 일찍 끝났습니다.",
              );
            }
            completed += read;
          }
        }
        return output;
      } catch (error) {
        if (isStudioOpfsSyncAccessError(error)) throw error;
        throw new StudioOpfsSyncAccessError(
          "READ_FAILED",
          "OPFS sync-access 범위를 읽지 못했습니다.",
          error,
        );
      }
    });
  }

  public write(
    globalByteOffset: bigint,
    bytes: Uint8Array,
  ): Promise<void> {
    if (!(bytes instanceof Uint8Array)) {
      return Promise.reject(
        new StudioOpfsSyncAccessError(
          "INVALID_ARGUMENT",
          "OPFS sync-access 쓰기 데이터는 Uint8Array여야 합니다.",
        ),
      );
    }
    let spans: StudioOpfsSyncRangeSpan[];
    try {
      spans = planRange(globalByteOffset, bytes.byteLength, this.shardBytes);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(async () => {
      this.#assertOpen();
      try {
        for (const span of spans) {
          const handle = await this.#openHandle(span.shardIndex, true);
          if (handle === null) {
            throw new StudioOpfsSyncAccessError(
              "WRITE_FAILED",
              "OPFS shard 파일을 만들지 못했습니다.",
            );
          }
          const source = bytes.subarray(
            span.transferByteOffset,
            span.transferByteOffset + span.byteLength,
          );
          let completed = 0;
          while (completed < source.byteLength) {
            const written = handle.write(source.subarray(completed), {
              at: span.shardByteOffset + completed,
            });
            if (
              !Number.isSafeInteger(written)
              || written <= 0
              || written > source.byteLength - completed
            ) {
              throw new StudioOpfsSyncAccessError(
                "WRITE_FAILED",
                "OPFS sync-access 쓰기가 요청 길이보다 일찍 끝났습니다.",
              );
            }
            completed += written;
          }
        }
      } catch (error) {
        if (isStudioOpfsSyncAccessError(error)) throw error;
        throw new StudioOpfsSyncAccessError(
          "WRITE_FAILED",
          "OPFS sync-access 범위를 쓰지 못했습니다.",
          error,
        );
      }
    });
  }

  public flush(): Promise<void> {
    return this.#enqueue(async () => {
      this.#assertOpen();
      try {
        for (const [, handle] of this.#sortedHandles()) {
          handle.flush();
        }
      } catch (error) {
        throw new StudioOpfsSyncAccessError(
          "FLUSH_FAILED",
          "OPFS sync-access 변경 사항을 디스크에 반영하지 못했습니다.",
          error,
        );
      }
    });
  }

  public truncate(logicalByteLength: bigint): Promise<void> {
    try {
      validateGlobalOffset(logicalByteLength);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(async () => {
      this.#assertOpen();
      try {
        const lastShardIndex = logicalByteLength === BigInt(0)
          ? null
          : (logicalByteLength - BigInt(1)) / this.shardBytes;
        const lastShardLength = logicalByteLength === BigInt(0)
          ? 0
          : Number(
            ((logicalByteLength - BigInt(1)) % this.shardBytes)
              + BigInt(1),
          );

        const shardEntries: Array<{
          readonly name: string;
          readonly index: bigint;
        }> = [];
        for await (const name of this.#directory.keys()) {
          const index = parseShardFileName(name);
          if (index !== null) shardEntries.push({ name, index });
        }
        shardEntries.sort((left, right) => (
          left.index < right.index ? -1 : left.index > right.index ? 1 : 0
        ));

        for (const entry of shardEntries) {
          if (lastShardIndex !== null && entry.index <= lastShardIndex) continue;
          this.#closeCachedHandle(entry.name);
          await this.#directory.removeEntry(entry.name);
        }

        if (lastShardIndex !== null) {
          const handle = await this.#openHandle(lastShardIndex, true);
          if (handle === null) {
            throw new StudioOpfsSyncAccessError(
              "TRUNCATE_FAILED",
              "마지막 OPFS shard를 열지 못했습니다.",
            );
          }
          handle.truncate(lastShardLength);
        }
      } catch (error) {
        if (isStudioOpfsSyncAccessError(error)) throw error;
        throw new StudioOpfsSyncAccessError(
          "TRUNCATE_FAILED",
          "OPFS sync-access 문서 크기를 변경하지 못했습니다.",
          error,
        );
      }
    });
  }

  public close(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#closed) return;
      const failures: unknown[] = [];
      for (const [fileName, handle] of this.#sortedHandles()) {
        try {
          handle.close();
        } catch (error) {
          failures.push(error);
        } finally {
          this.#handles.delete(fileName);
        }
      }
      this.#closed = true;
      if (failures.length > 0) {
        throw new StudioOpfsSyncAccessError(
          "CLOSE_FAILED",
          "일부 OPFS sync-access handle을 닫지 못했습니다.",
          failures,
        );
      }
    });
  }

  #sortedHandles(): Array<
    readonly [string, StudioOpfsSyncAccessHandleLike]
  > {
    return [...this.#handles.entries()].sort(([left], [right]) => {
      const leftIndex = parseShardFileName(left) ?? BigInt(0);
      const rightIndex = parseShardFileName(right) ?? BigInt(0);
      return leftIndex < rightIndex ? -1 : leftIndex > rightIndex ? 1 : 0;
    });
  }

  #closeCachedHandle(fileName: string): void {
    const handle = this.#handles.get(fileName);
    if (!handle) return;
    handle.close();
    this.#handles.delete(fileName);
  }
}

async function openDocumentDirectory(input: {
  readonly storageManager: StudioOpfsSyncStorageManagerLike;
  readonly rootName: string;
  readonly documentId: string;
}): Promise<StudioOpfsSyncDirectoryHandleLike> {
  const opfsRoot = await input.storageManager.getDirectory();
  const productRoot = await opfsRoot.getDirectoryHandle(input.rootName, {
    create: true,
  });
  return productRoot.getDirectoryHandle(input.documentId, { create: true });
}

async function assertSyncAccessHandleSupport(
  directory: StudioOpfsSyncDirectoryHandleLike,
): Promise<void> {
  const probeName = "sync-access-capability-probe.bin";
  let probeHandle: StudioOpfsSyncAccessHandleLike | null = null;
  try {
    const fileHandle = await directory.getFileHandle(probeName, {
      create: true,
    });
    if (typeof fileHandle.createSyncAccessHandle !== "function") {
      throw new StudioOpfsSyncAccessError(
        "SYNC_ACCESS_UNAVAILABLE",
        "Dedicated Worker에서 OPFS createSyncAccessHandle을 사용할 수 없습니다.",
      );
    }
    probeHandle = await fileHandle.createSyncAccessHandle();
    probeHandle.close();
    probeHandle = null;
  } catch (error) {
    if (isStudioOpfsSyncAccessError(error)) throw error;
    throw new StudioOpfsSyncAccessError(
      "SYNC_ACCESS_UNAVAILABLE",
      "OPFS sync-access handle을 열 수 없습니다.",
      error,
    );
  } finally {
    if (probeHandle) {
      try {
        probeHandle.close();
      } catch {
        // The original capability failure remains authoritative.
      }
    }
    try {
      await directory.removeEntry(probeName);
    } catch {
      // A failed probe is already fail-closed; best-effort cleanup is enough.
    }
  }
}

/**
 * Opens the native high-performance store.
 *
 * Calling this from the Window/main thread always rejects. There is no
 * `createWritable()` fallback in this API.
 */
export async function createStudioOpfsSyncAccessStore(
  options: StudioOpfsSyncAccessStoreOptions,
): Promise<StudioOpfsSyncAccessStore> {
  if (
    !validName(options.documentId)
    || !validName(options.rootName ?? STUDIO_OPFS_SYNC_DEFAULT_ROOT_NAME)
  ) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      "OPFS 문서 또는 루트 이름이 올바르지 않습니다.",
    );
  }
  const capability = probeStudioOpfsSyncAccessCapability(
    options.scope ?? globalThis,
  );
  if (!capability.supported) {
    throw new StudioOpfsSyncAccessError(
      capability.reason === "not-dedicated-worker"
        ? "NOT_DEDICATED_WORKER"
        : "OPFS_UNAVAILABLE",
      capability.reason === "not-dedicated-worker"
        ? "OPFS sync-access 저장소는 Dedicated Worker에서만 열 수 있습니다."
        : "이 Dedicated Worker에서 OPFS를 사용할 수 없습니다.",
    );
  }

  const shardBytes = validateShardBytes(
    options.shardBytes ?? STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES,
  );
  let directory: StudioOpfsSyncDirectoryHandleLike;
  try {
    directory = await openDocumentDirectory({
      storageManager: capability.storageManager,
      rootName: options.rootName ?? STUDIO_OPFS_SYNC_DEFAULT_ROOT_NAME,
      documentId: options.documentId,
    });
  } catch (error) {
    throw new StudioOpfsSyncAccessError(
      "OPFS_UNAVAILABLE",
      "OPFS 대형 문서 저장 디렉터리를 열 수 없습니다.",
      error,
    );
  }
  await assertSyncAccessHandleSupport(directory);
  return new StudioOpfsShardedSyncAccessStore({
    kind: "opfs-sync-access",
    documentId: options.documentId,
    shardBytes,
    directory,
  });
}

interface StudioOpfsMemorySyncFile {
  bytes: Uint8Array;
  locked: boolean;
}

export interface StudioOpfsMemorySyncAccessCounts {
  read: number;
  write: number;
  flush: number;
  truncate: number;
  close: number;
}

export interface StudioOpfsMemorySyncAccessStore
extends StudioOpfsSyncAccessStore {
  readonly kind: "memory-sync-access";
  readonly counts: StudioOpfsMemorySyncAccessCounts;
  snapshot(): ReadonlyMap<string, Uint8Array>;
}

export interface StudioOpfsMemorySyncAccessStoreOptions {
  readonly documentId?: string;
  readonly shardBytes?: bigint;
}

function createMemoryDirectory(
  files: Map<string, StudioOpfsMemorySyncFile>,
  counts: StudioOpfsMemorySyncAccessCounts,
): StudioOpfsSyncDirectoryHandleLike {
  return {
    async getDirectoryHandle() {
      return this;
    },
    async getFileHandle(name, options) {
      let file = files.get(name);
      if (!file && options?.create) {
        file = { bytes: new Uint8Array(0), locked: false };
        files.set(name, file);
      }
      if (!file) {
        const error = new Error(`Missing memory OPFS file: ${name}`);
        error.name = "NotFoundError";
        throw error;
      }
      return {
        async createSyncAccessHandle() {
          if (file.locked) {
            throw new Error(`Memory OPFS file is already locked: ${name}`);
          }
          file.locked = true;
          let closed = false;
          const assertHandleOpen = () => {
            if (closed) throw new Error(`Memory OPFS handle is closed: ${name}`);
          };
          return {
            read(buffer, options) {
              assertHandleOpen();
              counts.read += 1;
              if (
                !Number.isSafeInteger(options.at)
                || options.at < 0
                || options.at >= file.bytes.byteLength
              ) {
                return 0;
              }
              const available = Math.min(
                buffer.byteLength,
                file.bytes.byteLength - options.at,
              );
              buffer.set(
                file.bytes.subarray(options.at, options.at + available),
              );
              return available;
            },
            write(buffer, options) {
              assertHandleOpen();
              counts.write += 1;
              if (!Number.isSafeInteger(options.at) || options.at < 0) {
                return 0;
              }
              const nextLength = options.at + buffer.byteLength;
              if (!Number.isSafeInteger(nextLength)) return 0;
              if (nextLength > file.bytes.byteLength) {
                const expanded = new Uint8Array(nextLength);
                expanded.set(file.bytes);
                file.bytes = expanded;
              }
              file.bytes.set(buffer, options.at);
              return buffer.byteLength;
            },
            flush() {
              assertHandleOpen();
              counts.flush += 1;
            },
            truncate(newSize) {
              assertHandleOpen();
              counts.truncate += 1;
              if (!Number.isSafeInteger(newSize) || newSize < 0) {
                throw new Error(`Invalid memory OPFS size: ${newSize}`);
              }
              const resized = new Uint8Array(newSize);
              resized.set(file.bytes.subarray(0, newSize));
              file.bytes = resized;
            },
            close() {
              assertHandleOpen();
              counts.close += 1;
              closed = true;
              file.locked = false;
            },
          };
        },
      };
    },
    async removeEntry(name) {
      const file = files.get(name);
      if (!file) {
        const error = new Error(`Missing memory OPFS file: ${name}`);
        error.name = "NotFoundError";
        throw error;
      }
      if (file.locked) {
        throw new Error(`Cannot remove locked memory OPFS file: ${name}`);
      }
      files.delete(name);
    },
    async *keys() {
      for (const key of [...files.keys()].sort()) yield key;
    },
  };
}

/**
 * Deterministic in-memory implementation used by range-I/O and crash tests.
 * It exercises the same sharding, offset and serialization logic as OPFS.
 */
export function createStudioOpfsMemorySyncAccessStore(
  options: StudioOpfsMemorySyncAccessStoreOptions = {},
): StudioOpfsMemorySyncAccessStore {
  const documentId = options.documentId ?? "memory-document";
  if (!validName(documentId)) {
    throw new StudioOpfsSyncAccessError(
      "INVALID_ARGUMENT",
      "메모리 OPFS 문서 이름이 올바르지 않습니다.",
    );
  }
  const files = new Map<string, StudioOpfsMemorySyncFile>();
  const counts: StudioOpfsMemorySyncAccessCounts = {
    read: 0,
    write: 0,
    flush: 0,
    truncate: 0,
    close: 0,
  };
  const store = new StudioOpfsShardedSyncAccessStore({
    kind: "memory-sync-access",
    documentId,
    shardBytes:
      options.shardBytes ?? STUDIO_LARGE_DOCUMENT_DEFAULT_SHARD_BYTES,
    directory: createMemoryDirectory(files, counts),
  });
  return Object.assign(store, {
    counts,
    snapshot(): ReadonlyMap<string, Uint8Array> {
      return new Map(
        [...files.entries()].map(([name, file]) => [
          name,
          Uint8Array.from(file.bytes),
        ]),
      );
    },
  }) as StudioOpfsMemorySyncAccessStore;
}
