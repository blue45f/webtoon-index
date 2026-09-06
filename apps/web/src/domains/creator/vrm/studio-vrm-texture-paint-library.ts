/**
 * Browser-local content-addressed store for verified VRM surface-paint PNG artifacts.
 *
 * Only a canonical artifact receipt and immutable PNG bytes cross the SQLite/OPFS boundary.
 * Canvas pixels, RGBA buffers, object URLs, and data URLs are deliberately unsupported.
 */

import {
  getProductStudioVrmAssetSqliteOpfsRepository,
  StudioVrmAssetRepositoryError,
  type StudioVrmAssetSqliteOpfsRepository,
} from "./studio-vrm-asset-sqlite-opfs-repository";
import {
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
  StudioVrmTexturePaintArtifactError,
  verifyStudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifact,
  type StudioVrmTexturePaintArtifactHash,
  type StudioVrmTexturePaintArtifactLimits,
  type StudioVrmTexturePaintArtifactMetadata,
} from "./studio-vrm-texture-paint-artifact";

export const STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_NAME =
  "toonspectrum-studio-vrm-texture-paint-library";
export const STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_VERSION = 1;
export const STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME = "png-artifacts";

/** Scene-v5 artifact/bundle ceilings. Durable storage itself is not a single-project bundle. */
export const STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS = Object.freeze({
  ...STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_LIMITS,
});

export interface StudioVrmTexturePaintLibraryLimits {
  readonly maxArtifactBytes: number;
  readonly maxAggregateBytes: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly maxPixels: number;
  readonly maxAggregatePixels: number;
  readonly maxBindings: number;
  readonly maxArtifacts: number;
}

export interface StudioVrmTexturePaintLibraryOptions {
  readonly signal?: AbortSignal;
  /** Explicit pre-V12 test/embed seam. Product code never supplies or probes this value. */
  readonly indexedDb?: IDBFactory | null;
  /** Product default; tests can inject an actual SQLite memory DB + fake OPFS repository. */
  readonly repository?: StudioVrmAssetSqliteOpfsRepository;
  /** Callers may lower, but never raise, the scene-v5 browser persistence limits. */
  readonly limits?: Partial<StudioVrmTexturePaintLibraryLimits>;
}

export interface StudioVrmTexturePaintLibrarySaveResult {
  readonly receipt: StudioVrmTexturePaintArtifactMetadata;
  readonly deduplicated: boolean;
  /** Present only when this call created the durable authority row. */
  readonly creationReceipt: StudioVrmTexturePaintLibraryCreationReceipt | null;
  /** Product-authority manifest generation for every write, including a raced reuse/repair. */
  readonly mutationGeneration: number | null;
}

export type StudioVrmTexturePaintLibraryCreationReceipt =
  | {
      readonly schema: "toonspectrum.vrm-texture-paint-library-creation";
      readonly version: 1;
      readonly authority: "sqlite-opfs";
      readonly contentHash: StudioVrmTexturePaintArtifactHash;
      readonly generation: number;
    }
  | {
      readonly schema: "toonspectrum.vrm-texture-paint-library-creation";
      readonly version: 1;
      readonly authority: "legacy-indexeddb";
      readonly contentHash: StudioVrmTexturePaintArtifactHash;
    };

export type StudioVrmTexturePaintLibraryErrorCode =
  | "ABORTED"
  | "ARTIFACT_INVALID"
  | "ARTIFACT_MISSING"
  | "CONTENT_HASH_INVALID"
  | "LIMIT_INVALID"
  | "STORAGE_CORRUPT"
  | "STORAGE_UNAVAILABLE"
  | "TRANSACTION_FAILED";

const ERROR_MESSAGES: Readonly<
  Record<StudioVrmTexturePaintLibraryErrorCode, string>
> = Object.freeze({
  ABORTED: "VRM 표면 페인팅 로컬 저장 작업이 취소되었습니다.",
  ARTIFACT_INVALID: "저장할 VRM 표면 페인팅 PNG artifact가 올바르지 않습니다.",
  ARTIFACT_MISSING: "요청한 VRM 표면 페인팅 PNG가 로컬 저장소에 없습니다.",
  CONTENT_HASH_INVALID: "VRM 표면 페인팅 PNG SHA-256 식별자가 올바르지 않습니다.",
  LIMIT_INVALID: "VRM 표면 페인팅 로컬 저장 안전 한도가 올바르지 않습니다.",
  STORAGE_CORRUPT:
    "로컬에 저장된 VRM 표면 페인팅 PNG 또는 무결성 receipt가 손상되었습니다.",
  STORAGE_UNAVAILABLE:
    "VRM 표면 페인팅 SQLite/OPFS 저장소를 사용할 수 없습니다. 현재 편집은 이 탭 메모리에만 남으며 새로고침하면 사라집니다.",
  TRANSACTION_FAILED: "VRM 표면 페인팅 로컬 저장 트랜잭션을 완료하지 못했습니다.",
});

export class StudioVrmTexturePaintLibraryError extends Error {
  constructor(
    readonly code: StudioVrmTexturePaintLibraryErrorCode,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[code], options);
    this.name = code === "ABORTED"
      ? "AbortError"
      : "StudioVrmTexturePaintLibraryError";
  }
}

interface StoredPaintArtifact {
  readonly contentHash: StudioVrmTexturePaintArtifactHash;
  readonly receipt: StudioVrmTexturePaintArtifactMetadata;
  readonly png: Blob;
}

const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const STORED_RECORD_KEYS = ["contentHash", "png", "receipt"] as const;
const LIVE_CREATION_RECEIPTS = new WeakSet<object>();
const LEGACY_CREATION_RECEIPTS = new WeakMap<
  IDBFactory,
  Map<StudioVrmTexturePaintArtifactHash, StudioVrmTexturePaintLibraryCreationReceipt>
>();

function registerCreationReceipt(
  receipt: StudioVrmTexturePaintLibraryCreationReceipt,
): StudioVrmTexturePaintLibraryCreationReceipt {
  const frozen = Object.freeze(receipt);
  LIVE_CREATION_RECEIPTS.add(frozen);
  return frozen;
}

function legacyCreationReceipts(
  factory: IDBFactory,
): Map<StudioVrmTexturePaintArtifactHash, StudioVrmTexturePaintLibraryCreationReceipt> {
  let receipts = LEGACY_CREATION_RECEIPTS.get(factory);
  if (!receipts) {
    receipts = new Map();
    LEGACY_CREATION_RECEIPTS.set(factory, receipts);
  }
  return receipts;
}

function libraryError(
  code: StudioVrmTexturePaintLibraryErrorCode,
  cause?: unknown,
): StudioVrmTexturePaintLibraryError {
  return new StudioVrmTexturePaintLibraryError(
    code,
    cause === undefined ? undefined : { cause },
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw libraryError("ABORTED", signal.reason);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactDataKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) return false;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return false;
  }
  const actualKeys = Object.keys(descriptors).sort();
  const sortedExpected = [...expectedKeys].sort();
  return actualKeys.length === sortedExpected.length
    && actualKeys.every((key, index) => key === sortedExpected[index])
    && actualKeys.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && "value" in descriptor;
    });
}

function strictContentHash(value: unknown): StudioVrmTexturePaintArtifactHash {
  if (typeof value !== "string" || !CONTENT_HASH_PATTERN.test(value)) {
    throw libraryError("CONTENT_HASH_INVALID");
  }
  return value as StudioVrmTexturePaintArtifactHash;
}

function resolveLimit(
  value: number | undefined,
  maximum: number,
): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw libraryError("LIMIT_INVALID");
  }
  return value;
}

function resolveLimits(
  value: Partial<StudioVrmTexturePaintLibraryLimits> | undefined,
): StudioVrmTexturePaintLibraryLimits {
  if (value !== undefined && !isPlainRecord(value)) {
    throw libraryError("LIMIT_INVALID");
  }
  return Object.freeze({
    maxArtifactBytes: resolveLimit(
      value?.maxArtifactBytes,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS.maxArtifactBytes,
    ),
    maxAggregateBytes: resolveLimit(
      value?.maxAggregateBytes,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS.maxAggregateBytes,
    ),
    maxWidth: resolveLimit(
      value?.maxWidth,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS.maxWidth,
    ),
    maxHeight: resolveLimit(
      value?.maxHeight,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS.maxHeight,
    ),
    maxPixels: resolveLimit(
      value?.maxPixels,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS.maxPixels,
    ),
    maxAggregatePixels: resolveLimit(
      value?.maxAggregatePixels,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS.maxAggregatePixels,
    ),
    maxBindings: resolveLimit(
      value?.maxBindings,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS.maxBindings,
    ),
    maxArtifacts: resolveLimit(
      value?.maxArtifacts,
      STUDIO_VRM_TEXTURE_PAINT_LIBRARY_LIMITS.maxArtifacts,
    ),
  });
}

function artifactLimits(
  limits: StudioVrmTexturePaintLibraryLimits,
): Partial<StudioVrmTexturePaintArtifactLimits> {
  return {
    maxArtifactBytes: limits.maxArtifactBytes,
    maxAggregateBytes: limits.maxAggregateBytes,
    maxWidth: limits.maxWidth,
    maxHeight: limits.maxHeight,
    maxPixels: limits.maxPixels,
    maxAggregatePixels: limits.maxAggregatePixels,
    maxBindings: limits.maxBindings,
    maxArtifacts: limits.maxArtifacts,
  };
}

function resolveIndexedDb(options: StudioVrmTexturePaintLibraryOptions): IDBFactory {
  if (!usesLegacyIndexedDb(options) || !options.indexedDb) {
    throw libraryError("STORAGE_UNAVAILABLE");
  }
  return options.indexedDb;
}

function usesLegacyIndexedDb(options: StudioVrmTexturePaintLibraryOptions): boolean {
  return Object.prototype.hasOwnProperty.call(options, "indexedDb");
}

function repository(
  options: StudioVrmTexturePaintLibraryOptions,
): StudioVrmAssetSqliteOpfsRepository {
  return options.repository ?? getProductStudioVrmAssetSqliteOpfsRepository();
}

function repositoryError(
  cause: unknown,
  signal: AbortSignal | undefined,
): StudioVrmTexturePaintLibraryError {
  if (signal?.aborted || (cause instanceof Error && cause.name === "AbortError")) {
    return libraryError("ABORTED", signal?.reason ?? cause);
  }
  if (cause instanceof StudioVrmAssetRepositoryError) {
    if (cause.code === "missing") return libraryError("ARTIFACT_MISSING", cause);
    if (cause.code === "corrupt" || cause.code === "invalid") {
      return libraryError("STORAGE_CORRUPT", cause);
    }
    if (cause.code === "limit") return libraryError("ARTIFACT_INVALID", cause);
    if (cause.code === "unavailable" || cause.code === "closed") {
      return libraryError("STORAGE_UNAVAILABLE", cause);
    }
  }
  return libraryError("TRANSACTION_FAILED", cause);
}

function openDatabase(
  factory: IDBFactory,
  signal: AbortSignal | undefined,
): Promise<IDBDatabase> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(
        STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_NAME,
        STUDIO_VRM_TEXTURE_PAINT_LIBRARY_DATABASE_VERSION,
      );
    } catch (cause) {
      reject(libraryError("STORAGE_UNAVAILABLE", cause));
      return;
    }

    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const fail = (error: StudioVrmTexturePaintLibraryError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(libraryError("ABORTED", signal?.reason));
    signal?.addEventListener("abort", onAbort, { once: true });

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME)) {
        database.createObjectStore(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME, {
          keyPath: "contentHash",
        });
      }
    };
    request.onblocked = () => fail(libraryError("STORAGE_UNAVAILABLE"));
    request.onerror = () => fail(libraryError("STORAGE_UNAVAILABLE", request.error));
    request.onsuccess = () => {
      const database = request.result;
      if (settled || signal?.aborted) {
        database.close();
        if (!settled) fail(libraryError("ABORTED", signal?.reason));
        return;
      }
      try {
        if (!database.objectStoreNames.contains(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME)) {
          database.close();
          fail(libraryError("STORAGE_UNAVAILABLE"));
          return;
        }
        const transaction = database.transaction(
          STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME,
          "readonly",
        );
        if (
          transaction.objectStore(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME).keyPath
          !== "contentHash"
        ) {
          transaction.abort();
          database.close();
          fail(libraryError("STORAGE_UNAVAILABLE"));
          return;
        }
      } catch (cause) {
        database.close();
        fail(libraryError("STORAGE_UNAVAILABLE", cause));
        return;
      }
      if (settled || signal?.aborted) {
        database.close();
        if (!settled) fail(libraryError("ABORTED", signal?.reason));
        return;
      }
      settled = true;
      cleanup();
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function requestResult<T>(request: IDBRequest<T>, signal: AbortSignal | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      signal?.aborted
        ? libraryError("ABORTED", signal.reason)
        : libraryError("TRANSACTION_FAILED", request.error),
    );
  });
}

function monitorTransaction(
  transaction: IDBTransaction,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = (error?: StudioVrmTexturePaintLibraryError) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be committed; the first terminal event remains authoritative.
      }
      finish(libraryError("ABORTED", signal?.reason));
    };
    transaction.oncomplete = () => finish();
    transaction.onerror = () => finish(
      signal?.aborted
        ? libraryError("ABORTED", signal.reason)
        : libraryError("TRANSACTION_FAILED", transaction.error),
    );
    transaction.onabort = () => finish(
      signal?.aborted
        ? libraryError("ABORTED", signal.reason)
        : libraryError("TRANSACTION_FAILED", transaction.error),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function normalizeOperationError(
  cause: unknown,
  signal: AbortSignal | undefined,
): StudioVrmTexturePaintLibraryError {
  if (cause instanceof StudioVrmTexturePaintLibraryError) return cause;
  if (signal?.aborted || isAbortError(cause)) {
    return libraryError("ABORTED", signal?.reason ?? cause);
  }
  return libraryError("TRANSACTION_FAILED", cause);
}

async function withObjectStore<T>(
  mode: IDBTransactionMode,
  options: StudioVrmTexturePaintLibraryOptions,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  throwIfAborted(options.signal);
  const database = await openDatabase(resolveIndexedDb(options), options.signal);
  try {
    throwIfAborted(options.signal);
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(
        STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME,
        mode,
      );
    } catch (cause) {
      throw libraryError("STORAGE_UNAVAILABLE", cause);
    }
    const completion = monitorTransaction(transaction, options.signal);
    void completion.catch(() => undefined);
    try {
      const result = await operation(
        transaction.objectStore(STUDIO_VRM_TEXTURE_PAINT_LIBRARY_STORE_NAME),
      );
      await completion;
      return result;
    } catch (cause) {
      try {
        transaction.abort();
      } catch {
        // It may already be aborted or committed.
      }
      await completion.catch(() => undefined);
      throw normalizeOperationError(cause, options.signal);
    }
  } finally {
    database.close();
  }
}

function storedRecord(value: unknown): StoredPaintArtifact {
  if (!hasExactDataKeys(value, STORED_RECORD_KEYS)) {
    throw libraryError("STORAGE_CORRUPT");
  }
  const contentHash = strictContentHash(value.contentHash);
  if (
    !isPlainRecord(value.receipt)
    || value.receipt.contentHash !== contentHash
    || !(value.png instanceof Blob)
    || value.png.type !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME
    || value.png.size < 1
  ) {
    throw libraryError("STORAGE_CORRUPT");
  }
  return value as unknown as StoredPaintArtifact;
}

function saveInputBlob(value: unknown): Blob {
  if (
    !isPlainRecord(value)
    || !isPlainRecord(value.archiveEntry)
    || !(value.archiveEntry.data instanceof Blob)
  ) {
    throw libraryError("ARTIFACT_INVALID");
  }
  return value.archiveEntry.data;
}

async function verifiedInputArtifact(
  value: unknown,
  limits: StudioVrmTexturePaintLibraryLimits,
  signal: AbortSignal | undefined,
): Promise<StudioVrmTexturePaintArtifact> {
  const png = saveInputBlob(value);
  const metadata = (value as Readonly<Record<string, unknown>>).metadata;
  try {
    return await verifyStudioVrmTexturePaintArtifact(metadata, png, {
      limits: artifactLimits(limits),
      signal,
    });
  } catch (cause) {
    if (
      signal?.aborted
      || isAbortError(cause)
      || (
        cause instanceof StudioVrmTexturePaintArtifactError
        && cause.code === "ABORTED"
      )
    ) {
      throw libraryError("ABORTED", signal?.reason ?? cause);
    }
    throw libraryError("ARTIFACT_INVALID", cause);
  }
}

async function verifiedStoredArtifact(
  value: unknown,
  contentHash: StudioVrmTexturePaintArtifactHash,
  limits: StudioVrmTexturePaintLibraryLimits,
  signal: AbortSignal | undefined,
): Promise<StudioVrmTexturePaintArtifact> {
  let record: StoredPaintArtifact;
  try {
    record = storedRecord(value);
  } catch (cause) {
    throw cause instanceof StudioVrmTexturePaintLibraryError
      ? cause
      : libraryError("STORAGE_CORRUPT", cause);
  }
  if (record.contentHash !== contentHash) throw libraryError("STORAGE_CORRUPT");
  try {
    return await verifyStudioVrmTexturePaintArtifact(record.receipt, record.png, {
      limits: artifactLimits(limits),
      signal,
    });
  } catch (cause) {
    if (
      signal?.aborted
      || isAbortError(cause)
      || (
        cause instanceof StudioVrmTexturePaintArtifactError
        && cause.code === "ABORTED"
      )
    ) {
      throw libraryError("ABORTED", signal?.reason ?? cause);
    }
    throw libraryError("STORAGE_CORRUPT", cause);
  }
}

/**
 * Verifies the artifact before opening the selected durable authority, then atomically overwrites
 * an existing hash with verified PNG bytes. The overwrite repairs any same-key byte tampering
 * while retaining one content-addressed record. Aggregate project budgets are enforced by the
 * manifest/bundle export boundary, not across unrelated projects sharing this browser cache.
 */
export async function saveStudioVrmTexturePaintLibraryArtifact(
  value: StudioVrmTexturePaintArtifact,
  options: StudioVrmTexturePaintLibraryOptions = {},
): Promise<StudioVrmTexturePaintLibrarySaveResult> {
  const limits = resolveLimits(options.limits);
  const artifact = await verifiedInputArtifact(value, limits, options.signal);
  throwIfAborted(options.signal);
  if (!usesLegacyIndexedDb(options)) {
    try {
      const buffer = await artifact.archiveEntry.data.arrayBuffer();
      throwIfAborted(options.signal);
      const result = await repository(options).saveTexture({
        receipt: artifact.metadata,
        bytes: new Uint8Array(buffer),
        limits: {
          maxArtifacts: limits.maxArtifacts,
          maxArtifactBytes: limits.maxArtifactBytes,
          maxAggregateBytes: limits.maxAggregateBytes,
        },
      }, options.signal);
      return Object.freeze({
        receipt: result.receipt,
        deduplicated: result.deduplicated,
        creationReceipt: result.created
          ? registerCreationReceipt({
              schema: "toonspectrum.vrm-texture-paint-library-creation",
              version: 1,
              authority: "sqlite-opfs",
              contentHash: result.receipt.contentHash,
              generation: result.generation,
            })
          : null,
        mutationGeneration: result.generation,
      });
    } catch (cause) {
      throw repositoryError(cause, options.signal);
    }
  }
  const factory = resolveIndexedDb(options);
  const result = await withObjectStore("readwrite", options, async (store) => {
    const existingValue = await requestResult<unknown>(
      store.get(artifact.metadata.contentHash),
      options.signal,
    );
    const record: StoredPaintArtifact = {
      contentHash: artifact.metadata.contentHash,
      receipt: artifact.metadata,
      png: artifact.archiveEntry.data,
    };
    await requestResult(store.put(record), options.signal);
    return Object.freeze({
      receipt: artifact.metadata,
      // The incoming artifact is already fully verified. Existing bytes are deliberately not
      // parsed before put: a malformed same-key row must remain repairable in this transaction.
      deduplicated: existingValue !== undefined,
    });
  });
  const receipts = legacyCreationReceipts(factory);
  // Any overwrite/reuse makes an older creation receipt unsafe: the row may now be shared.
  receipts.delete(artifact.metadata.contentHash);
  const creationReceipt = result.deduplicated
    ? null
    : registerCreationReceipt({
        schema: "toonspectrum.vrm-texture-paint-library-creation",
        version: 1,
        authority: "legacy-indexeddb",
        contentHash: artifact.metadata.contentHash,
      });
  if (creationReceipt) receipts.set(artifact.metadata.contentHash, creationReceipt);
  return Object.freeze({ ...result, creationReceipt, mutationGeneration: null });
}

/**
 * Failed-import compensation. A forged, replayed, superseded, or cross-authority receipt is a
 * no-op; user-facing deletion continues through its separate durable-delete path.
 */
export async function deleteStudioVrmTexturePaintLibraryArtifactIfCreationMatches(
  receipt: StudioVrmTexturePaintLibraryCreationReceipt,
  options: StudioVrmTexturePaintLibraryOptions = {},
): Promise<boolean> {
  if (!LIVE_CREATION_RECEIPTS.has(receipt)) return false;
  LIVE_CREATION_RECEIPTS.delete(receipt);
  const contentHash = strictContentHash(receipt.contentHash);
  if (!usesLegacyIndexedDb(options)) {
    if (receipt.authority !== "sqlite-opfs") return false;
    try {
      return await repository(options).deleteTextureIfCreationMatches(
        contentHash,
        receipt.generation,
        options.signal,
      );
    } catch (cause) {
      throw repositoryError(cause, options.signal);
    }
  }
  if (receipt.authority !== "legacy-indexeddb") return false;
  const factory = resolveIndexedDb(options);
  const receipts = legacyCreationReceipts(factory);
  if (receipts.get(contentHash) !== receipt) return false;
  const deleted = await withObjectStore("readwrite", options, async (store) => {
    const value = await requestResult<unknown>(store.get(contentHash), options.signal);
    if (value === undefined) return false;
    const record = storedRecord(value);
    if (record.contentHash !== contentHash || record.receipt.contentHash !== contentHash) {
      return false;
    }
    await requestResult(store.delete(contentHash), options.signal);
    return true;
  });
  receipts.delete(contentHash);
  return deleted;
}

/**
 * Compensates one import's contiguous texture-manifest mutations in a single compare-and-delete.
 * This is intentionally stricter than deleting each receipt independently: any interleaved or
 * later manifest write makes the whole operation fail closed and preserves all shared data.
 */
export async function deleteStudioVrmTexturePaintLibraryCreationBatchIfMatches(
  receipts: readonly StudioVrmTexturePaintLibraryCreationReceipt[],
  mutationGenerations: readonly number[],
  options: StudioVrmTexturePaintLibraryOptions = {},
): Promise<boolean> {
  if (receipts.length === 0) return true;
  if (
    receipts.some((receipt) => !LIVE_CREATION_RECEIPTS.has(receipt))
    || new Set(receipts).size !== receipts.length
  ) return false;
  receipts.forEach((receipt) => LIVE_CREATION_RECEIPTS.delete(receipt));
  if (!usesLegacyIndexedDb(options)) {
    if (
      receipts.some((receipt) => receipt.authority !== "sqlite-opfs")
      || mutationGenerations.length < 1
    ) return false;
    try {
      return await repository(options).deleteTexturesIfCreationBatchMatches(
        receipts.map((receipt) => {
          if (receipt.authority !== "sqlite-opfs") throw libraryError("TRANSACTION_FAILED");
          return { contentHash: receipt.contentHash, generation: receipt.generation };
        }),
        mutationGenerations,
        options.signal,
      );
    } catch (cause) {
      throw repositoryError(cause, options.signal);
    }
  }
  if (receipts.some((receipt) => receipt.authority !== "legacy-indexeddb")) return false;
  const factory = resolveIndexedDb(options);
  const live = legacyCreationReceipts(factory);
  if (receipts.some((receipt) => live.get(receipt.contentHash) !== receipt)) return false;
  const hashes = new Set(receipts.map((receipt) => receipt.contentHash));
  const deleted = await withObjectStore("readwrite", options, async (store) => {
    for (const contentHash of hashes) {
      const value = await requestResult<unknown>(store.get(contentHash), options.signal);
      if (value === undefined || storedRecord(value).contentHash !== contentHash) return false;
    }
    for (const contentHash of hashes) {
      await requestResult(store.delete(contentHash), options.signal);
    }
    return true;
  });
  if (deleted) hashes.forEach((contentHash) => live.delete(contentHash));
  return deleted;
}

/**
 * Resolves one strict content hash and revalidates PNG structure, receipt, dimensions, byte count,
 * and SHA-256 after the durable read has completed.
 */
export async function getStudioVrmTexturePaintLibraryArtifact(
  contentHashValue: StudioVrmTexturePaintArtifactHash | string,
  options: StudioVrmTexturePaintLibraryOptions = {},
): Promise<StudioVrmTexturePaintArtifact> {
  const contentHash = strictContentHash(contentHashValue);
  const limits = resolveLimits(options.limits);
  if (!usesLegacyIndexedDb(options)) {
    try {
      const stored = await repository(options).getTexture(contentHash, options.signal);
      if (!stored) throw libraryError("ARTIFACT_MISSING");
      return await verifiedStoredArtifact({
        contentHash,
        receipt: stored.receipt,
        png: new Blob([Uint8Array.from(stored.bytes).buffer], {
          type: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
        }),
      }, contentHash, limits, options.signal);
    } catch (cause) {
      if (cause instanceof StudioVrmTexturePaintLibraryError) throw cause;
      throw repositoryError(cause, options.signal);
    }
  }
  const stored = await withObjectStore("readonly", options, async (store) => {
    const value = await requestResult<unknown>(
      store.get(contentHash),
      options.signal,
    );
    if (value === undefined) throw libraryError("ARTIFACT_MISSING");
    return value;
  });
  return verifiedStoredArtifact(stored, contentHash, limits, options.signal);
}
