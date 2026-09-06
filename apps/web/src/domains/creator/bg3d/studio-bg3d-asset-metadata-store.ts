import {
  STUDIO_BG3D_ASSET_METADATA_LIMITS,
  canonicalizeStudioBg3dAssetContentHash,
  migrateStudioBg3dAssetMetadata,
  normalizeStudioBg3dAssetMetadata,
  sortStudioBg3dAssetMetadata,
  type StudioBg3dAssetCollection,
  type StudioBg3dAssetMetadata,
  type StudioBg3dAssetRightsReceipt,
} from "./studio-bg3d-asset-metadata";
import {
  getStudioBg3dLibrariesAuthority,
  StudioBg3dLibrariesAuthorityError,
} from "./studio-bg3d-libraries-sqlite-opfs-authority";

import type { StudioBg3dLibrariesAuthority } from "./studio-bg3d-libraries-sqlite-opfs-authority";

export const STUDIO_BG3D_ASSET_METADATA_DATABASE_NAME =
  "toonspectrum-studio-bg3d-asset-metadata";
export const STUDIO_BG3D_ASSET_METADATA_DATABASE_VERSION = 1;
export const STUDIO_BG3D_ASSET_METADATA_STORE_NAME = "metadata";

export type StudioBg3dAssetMetadataStoreErrorCode =
  | "aborted"
  | "invalid-content-hash"
  | "invalid-metadata"
  | "invalid-stored-metadata"
  | "metadata-conflict"
  | "not-found"
  | "storage-unavailable"
  | "transaction-failed";

const ERROR_MESSAGES: Readonly<Record<StudioBg3dAssetMetadataStoreErrorCode, string>> = Object.freeze({
  aborted: "3D 자산 메타데이터 작업이 취소되었습니다.",
  "invalid-content-hash": "3D 자산의 SHA-256 식별자가 올바르지 않습니다.",
  "invalid-metadata": "3D 자산 메타데이터가 안전한 저장 형식이 아닙니다.",
  "invalid-stored-metadata": "저장된 3D 자산 메타데이터가 손상되어 사용할 수 없습니다.",
  "metadata-conflict": "같은 3D 자산에 서로 다른 메타데이터가 존재합니다.",
  "not-found": "업데이트할 3D 자산 메타데이터를 찾을 수 없습니다.",
  "storage-unavailable": "이 환경에서는 로컬 3D 자산 메타데이터 저장소를 사용할 수 없습니다.",
  "transaction-failed": "로컬 3D 자산 메타데이터 저장 작업을 완료하지 못했습니다.",
});

export class StudioBg3dAssetMetadataStoreError extends Error {
  readonly code: StudioBg3dAssetMetadataStoreErrorCode;

  constructor(code: StudioBg3dAssetMetadataStoreErrorCode, options?: ErrorOptions) {
    super(ERROR_MESSAGES[code], options);
    this.name = "StudioBg3dAssetMetadataStoreError";
    this.code = code;
  }
}

export interface StudioBg3dAssetMetadataStoreOptions {
  readonly signal?: AbortSignal;
  /** Explicit legacy import/test seam. Product defaults never inspect ambient IndexedDB. */
  readonly indexedDb?: IDBFactory | null;
  /** V12 SQLite/OPFS authority injection for deterministic tests. */
  readonly authority?: StudioBg3dLibrariesAuthority;
}

export interface StudioBg3dAssetMetadataMutationOptions
  extends StudioBg3dAssetMetadataStoreOptions {
  /** Deterministic clock injection. Updates never move updatedAt backwards. */
  readonly now?: number;
}

const PATCH_VALIDATION_HASH = `sha256:${"0".repeat(64)}` as const;

function storeError(
  code: StudioBg3dAssetMetadataStoreErrorCode,
  cause?: unknown,
): StudioBg3dAssetMetadataStoreError {
  return new StudioBg3dAssetMetadataStoreError(code, cause === undefined ? undefined : { cause });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw storeError("aborted", signal.reason);
}

function resolveIndexedDb(options: StudioBg3dAssetMetadataStoreOptions): IDBFactory {
  if (options.indexedDb !== undefined) {
    if (options.indexedDb === null) throw storeError("storage-unavailable");
    return options.indexedDb;
  }
  try {
    if (typeof globalThis.indexedDB !== "undefined") return globalThis.indexedDB;
  } catch {
    // Access can throw in privacy-restricted browser contexts.
  }
  throw storeError("storage-unavailable");
}

function openDatabase(
  factory: IDBFactory,
  signal?: AbortSignal,
): Promise<IDBDatabase> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(
        STUDIO_BG3D_ASSET_METADATA_DATABASE_NAME,
        STUDIO_BG3D_ASSET_METADATA_DATABASE_VERSION,
      );
    } catch (error) {
      reject(storeError("storage-unavailable", error));
      return;
    }

    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const fail = (error: StudioBg3dAssetMetadataStoreError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(storeError("aborted", signal?.reason));
    signal?.addEventListener("abort", onAbort, { once: true });

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STUDIO_BG3D_ASSET_METADATA_STORE_NAME)) {
        database.createObjectStore(STUDIO_BG3D_ASSET_METADATA_STORE_NAME, {
          keyPath: "contentHash",
        });
      }
    };
    request.onblocked = () => fail(storeError("storage-unavailable"));
    request.onerror = () => fail(storeError("storage-unavailable", request.error));
    request.onsuccess = () => {
      const database = request.result;
      if (settled || signal?.aborted) {
        database.close();
        if (!settled) fail(storeError("aborted", signal?.reason));
        return;
      }
      try {
        if (!database.objectStoreNames.contains(STUDIO_BG3D_ASSET_METADATA_STORE_NAME)) {
          database.close();
          fail(storeError("storage-unavailable"));
          return;
        }
        const transaction = database.transaction(STUDIO_BG3D_ASSET_METADATA_STORE_NAME, "readonly");
        if (transaction.objectStore(STUDIO_BG3D_ASSET_METADATA_STORE_NAME).keyPath !== "contentHash") {
          transaction.abort();
          database.close();
          fail(storeError("storage-unavailable"));
          return;
        }
      } catch (error) {
        database.close();
        fail(storeError("storage-unavailable", error));
        return;
      }

      if (settled || signal?.aborted) {
        database.close();
        if (!settled) fail(storeError("aborted", signal?.reason));
        return;
      }

      settled = true;
      cleanup();
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function requestResult<T>(request: IDBRequest<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(
      signal?.aborted
        ? storeError("aborted", signal.reason)
        : storeError("transaction-failed", request.error),
    );
  });
}

function monitorTransaction(
  transaction: IDBTransaction,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = (error?: StudioBg3dAssetMetadataStoreError) => {
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
        // The transaction may have committed in the same turn; the completion handler wins.
      }
      finish(storeError("aborted", signal?.reason));
    };

    transaction.oncomplete = () => finish();
    transaction.onerror = () => finish(
      signal?.aborted
        ? storeError("aborted", signal.reason)
        : storeError("transaction-failed", transaction.error),
    );
    transaction.onabort = () => finish(
      signal?.aborted
        ? storeError("aborted", signal.reason)
        : storeError("transaction-failed", transaction.error),
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function normalizeOperationError(
  error: unknown,
  signal: AbortSignal | undefined,
  fallback: StudioBg3dAssetMetadataStoreErrorCode,
): StudioBg3dAssetMetadataStoreError {
  if (error instanceof StudioBg3dAssetMetadataStoreError) return error;
  if (
    signal?.aborted ||
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
  ) {
    return storeError("aborted", signal?.reason ?? error);
  }
  return storeError(fallback, error);
}

async function withObjectStore<T>(
  mode: IDBTransactionMode,
  options: StudioBg3dAssetMetadataStoreOptions,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  throwIfAborted(options.signal);
  const database = await openDatabase(resolveIndexedDb(options), options.signal);
  try {
    throwIfAborted(options.signal);
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(STUDIO_BG3D_ASSET_METADATA_STORE_NAME, mode);
    } catch (error) {
      throw storeError("storage-unavailable", error);
    }

    const completion = monitorTransaction(transaction, options.signal);
    void completion.catch(() => undefined);
    try {
      const result = await operation(transaction.objectStore(STUDIO_BG3D_ASSET_METADATA_STORE_NAME));
      await completion;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // It may already be aborted or committed.
      }
      await completion.catch(() => undefined);
      throw normalizeOperationError(error, options.signal, "transaction-failed");
    }
  } finally {
    database.close();
  }
}

function canonicalHash(value: unknown): `sha256:${string}` {
  const normalized = canonicalizeStudioBg3dAssetContentHash(value);
  if (!normalized) throw storeError("invalid-content-hash");
  return normalized;
}

function normalizedStoredMetadata(value: unknown): StudioBg3dAssetMetadata {
  const metadata = migrateStudioBg3dAssetMetadata(value);
  if (!metadata) throw storeError("invalid-stored-metadata");
  return metadata;
}

function metadataFingerprint(metadata: StudioBg3dAssetMetadata): string {
  return JSON.stringify(metadata);
}

function preparePutBatch(values: readonly unknown[]): readonly StudioBg3dAssetMetadata[] {
  if (
    !Array.isArray(values) ||
    values.length > STUDIO_BG3D_ASSET_METADATA_LIMITS.assetsPerQuery
  ) {
    throw storeError("invalid-metadata");
  }

  const byHash = new Map<string, { metadata: StudioBg3dAssetMetadata; fingerprint: string }>();
  const order: string[] = [];
  for (const value of values) {
    const metadata = migrateStudioBg3dAssetMetadata(value);
    if (!metadata) throw storeError("invalid-metadata");
    const fingerprint = metadataFingerprint(metadata);
    const previous = byHash.get(metadata.contentHash);
    if (previous && previous.fingerprint !== fingerprint) throw storeError("metadata-conflict");
    if (!previous) {
      order.push(metadata.contentHash);
      byHash.set(metadata.contentHash, { metadata, fingerprint });
    }
  }

  return Object.freeze(order.map((hash) => byHash.get(hash)!.metadata));
}

function prepareDeleteHashes(values: readonly unknown[]): readonly `sha256:${string}`[] {
  if (
    !Array.isArray(values) ||
    values.length > STUDIO_BG3D_ASSET_METADATA_LIMITS.assetsPerQuery
  ) {
    throw storeError("invalid-content-hash");
  }
  return Object.freeze([...new Set(values.map(canonicalHash))]);
}

function validateMutationNow(options: StudioBg3dAssetMetadataMutationOptions): number {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0) throw storeError("invalid-metadata");
  return now;
}

function validationFixture(patch: Record<string, unknown>): StudioBg3dAssetMetadata {
  const metadata = normalizeStudioBg3dAssetMetadata({
    version: 2,
    contentHash: PATCH_VALIDATION_HASH,
    name: "패치 검증",
    format: "glb",
    createdAt: 0,
    updatedAt: 0,
    byteSize: 0,
    triangles: null,
    textures: null,
    favorite: false,
    collections: [],
    tags: [],
    rights: undefined,
    ...patch,
  });
  if (!metadata) throw storeError("invalid-metadata");
  return metadata;
}

export const STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND =
  "toonspectrum-studio-bg3d-asset-metadata-v12";
export const STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_VERSION = 1 as const;
export const STUDIO_BG3D_ASSET_METADATA_V12_MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

const METADATA_V12_MANIFEST_KEYS = [
  "kind",
  "version",
  "revision",
  "updatedAt",
  "records",
] as const;

interface StudioBg3dAssetMetadataV12Manifest {
  readonly kind: typeof STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND;
  readonly version: typeof STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_VERSION;
  readonly revision: number;
  readonly updatedAt: number;
  readonly records: readonly StudioBg3dAssetMetadata[];
}

function usesExplicitLegacyIndexedDb(options: StudioBg3dAssetMetadataStoreOptions): boolean {
  return Object.prototype.hasOwnProperty.call(options, "indexedDb");
}

function v12MetadataAuthority(
  options: StudioBg3dAssetMetadataStoreOptions,
): StudioBg3dLibrariesAuthority {
  return options.authority ?? getStudioBg3dLibrariesAuthority();
}

function metadataV12Error(
  cause: unknown,
  fallback: StudioBg3dAssetMetadataStoreErrorCode = "transaction-failed",
): StudioBg3dAssetMetadataStoreError {
  if (cause instanceof StudioBg3dAssetMetadataStoreError) return cause;
  if (cause instanceof StudioBg3dLibrariesAuthorityError) {
    if (cause.code === "aborted") return storeError("aborted", cause);
    if (cause.code === "corrupt") return storeError("invalid-stored-metadata", cause);
    return storeError("storage-unavailable", cause);
  }
  return storeError(fallback, cause);
}

function exactMetadataV12Manifest(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Object.keys(raw);
  if (
    keys.length !== METADATA_V12_MANIFEST_KEYS.length ||
    keys.some((key) => !METADATA_V12_MANIFEST_KEYS.includes(
      key as (typeof METADATA_V12_MANIFEST_KEYS)[number],
    ))
  ) return null;
  return raw as Record<string, unknown>;
}

function canonicalMetadataV12Manifest(
  manifest: StudioBg3dAssetMetadataV12Manifest,
): StudioBg3dAssetMetadataV12Manifest {
  return {
    kind: STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND,
    version: STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_VERSION,
    revision: manifest.revision,
    updatedAt: manifest.updatedAt,
    records: [...manifest.records].sort((left, right) =>
      left.contentHash.localeCompare(right.contentHash)),
  };
}

function emptyMetadataV12Manifest(): StudioBg3dAssetMetadataV12Manifest {
  return canonicalMetadataV12Manifest({
    kind: STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND,
    version: STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_VERSION,
    revision: 0,
    updatedAt: 0,
    records: [],
  });
}

function parseMetadataV12Manifest(raw: string | null): StudioBg3dAssetMetadataV12Manifest {
  if (raw === null) return emptyMetadataV12Manifest();
  if (new TextEncoder().encode(raw).byteLength >
    STUDIO_BG3D_ASSET_METADATA_V12_MAX_MANIFEST_BYTES) {
    throw storeError("invalid-stored-metadata");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw storeError("invalid-stored-metadata", cause);
  }
  const value = exactMetadataV12Manifest(parsed);
  if (
    !value ||
    value.kind !== STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND ||
    value.version !== STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_VERSION ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Number.isSafeInteger(value.updatedAt) ||
    (value.updatedAt as number) < 0 ||
    !Array.isArray(value.records) ||
    value.records.length > STUDIO_BG3D_ASSET_METADATA_LIMITS.assetsPerQuery
  ) throw storeError("invalid-stored-metadata");
  const records: StudioBg3dAssetMetadata[] = [];
  for (const candidate of value.records) {
    const metadata = normalizeStudioBg3dAssetMetadata(candidate);
    if (!metadata || JSON.stringify(metadata) !== JSON.stringify(candidate)) {
      throw storeError("invalid-stored-metadata");
    }
    records.push(metadata);
  }
  if (new Set(records.map(({ contentHash }) => contentHash)).size !== records.length) {
    throw storeError("invalid-stored-metadata");
  }
  const manifest = canonicalMetadataV12Manifest({
    kind: STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_KIND,
    version: STUDIO_BG3D_ASSET_METADATA_V12_MANIFEST_VERSION,
    revision: value.revision as number,
    updatedAt: value.updatedAt as number,
    records,
  });
  if (JSON.stringify(manifest) !== raw) throw storeError("invalid-stored-metadata");
  return manifest;
}

function serializeMetadataV12Manifest(manifest: StudioBg3dAssetMetadataV12Manifest): string {
  const raw = JSON.stringify(canonicalMetadataV12Manifest(manifest));
  if (new TextEncoder().encode(raw).byteLength >
    STUDIO_BG3D_ASSET_METADATA_V12_MAX_MANIFEST_BYTES) {
    throw storeError("invalid-metadata");
  }
  return raw;
}

async function listStudioBg3dAssetMetadataV12(
  options: StudioBg3dAssetMetadataStoreOptions,
): Promise<readonly StudioBg3dAssetMetadata[]> {
  throwIfAborted(options.signal);
  try {
    const manifest = parseMetadataV12Manifest(
      await v12MetadataAuthority(options).readManifest("metadata"),
    );
    throwIfAborted(options.signal);
    return sortStudioBg3dAssetMetadata(manifest.records, "recent");
  } catch (cause) {
    throw metadataV12Error(cause);
  }
}

async function getStudioBg3dAssetMetadataV12(
  contentHash: unknown,
  options: StudioBg3dAssetMetadataStoreOptions,
): Promise<StudioBg3dAssetMetadata | null> {
  throwIfAborted(options.signal);
  const hash = canonicalHash(contentHash);
  try {
    const manifest = parseMetadataV12Manifest(
      await v12MetadataAuthority(options).readManifest("metadata"),
    );
    throwIfAborted(options.signal);
    return manifest.records.find((record) => record.contentHash === hash) ?? null;
  } catch (cause) {
    throw metadataV12Error(cause);
  }
}

async function putStudioBg3dAssetMetadataV12(
  values: readonly unknown[],
  options: StudioBg3dAssetMetadataStoreOptions,
): Promise<readonly StudioBg3dAssetMetadata[]> {
  throwIfAborted(options.signal);
  const metadata = preparePutBatch(values);
  if (metadata.length === 0) return Object.freeze([]);
  try {
    return await v12MetadataAuthority(options).mutate("metadata", () => [], async (context) => {
      const current = parseMetadataV12Manifest(context.currentRaw);
      const byHash = new Map(current.records.map((record) => [record.contentHash, record]));
      for (const candidate of metadata) {
        const existing = byHash.get(candidate.contentHash);
        if (existing && metadataFingerprint(existing) !== metadataFingerprint(candidate)) {
          throw storeError("metadata-conflict");
        }
        byHash.set(candidate.contentHash, candidate);
      }
      if (byHash.size > STUDIO_BG3D_ASSET_METADATA_LIMITS.assetsPerQuery) {
        throw storeError("invalid-metadata");
      }
      const next = canonicalMetadataV12Manifest({
        ...current,
        revision: current.revision + 1,
        updatedAt: context.now,
        records: [...byHash.values()],
      });
      return {
        nextRaw: serializeMetadataV12Manifest(next),
        nextRefs: [],
        result: metadata,
      };
    }, options.signal);
  } catch (cause) {
    throw metadataV12Error(cause);
  }
}

async function deleteStudioBg3dAssetMetadataV12(
  contentHashes: readonly unknown[],
  options: StudioBg3dAssetMetadataStoreOptions,
): Promise<number> {
  throwIfAborted(options.signal);
  const hashes = prepareDeleteHashes(contentHashes);
  if (hashes.length === 0) return 0;
  try {
    return await v12MetadataAuthority(options).mutate("metadata", () => [], async (context) => {
      const current = parseMetadataV12Manifest(context.currentRaw);
      const selected = new Set(hashes);
      const records = current.records.filter(({ contentHash }) => !selected.has(contentHash));
      const next = canonicalMetadataV12Manifest({
        ...current,
        revision: current.revision + 1,
        updatedAt: context.now,
        records,
      });
      return {
        nextRaw: serializeMetadataV12Manifest(next),
        nextRefs: [],
        result: current.records.length - records.length,
      };
    }, options.signal);
  } catch (cause) {
    throw metadataV12Error(cause);
  }
}

async function updateMetadataV12(
  contentHash: unknown,
  patchKey: "favorite" | "collections" | "tags" | "rights",
  patchValue: unknown,
  options: StudioBg3dAssetMetadataMutationOptions,
): Promise<StudioBg3dAssetMetadata> {
  throwIfAborted(options.signal);
  const hash = canonicalHash(contentHash);
  const now = validateMutationNow(options);
  const validatedPatch = validationFixture({ [patchKey]: patchValue });
  try {
    return await v12MetadataAuthority(options).mutate("metadata", () => [], async (context) => {
      const current = parseMetadataV12Manifest(context.currentRaw);
      const existing = current.records.find((record) => record.contentHash === hash);
      if (!existing) throw storeError("not-found");
      const nextRecord = normalizeStudioBg3dAssetMetadata({
        ...existing,
        updatedAt: Math.max(existing.updatedAt, now),
        [patchKey]: validatedPatch[patchKey],
      });
      if (!nextRecord || nextRecord.contentHash !== hash) throw storeError("invalid-metadata");
      const next = canonicalMetadataV12Manifest({
        ...current,
        revision: current.revision + 1,
        updatedAt: context.now,
        records: current.records.map((record) =>
          record.contentHash === hash ? nextRecord : record),
      });
      return {
        nextRaw: serializeMetadataV12Manifest(next),
        nextRefs: [],
        result: nextRecord,
      };
    }, options.signal);
  } catch (cause) {
    throw metadataV12Error(cause);
  }
}

async function updateMetadata(
  contentHash: unknown,
  patchKey: "favorite" | "collections" | "tags" | "rights",
  patchValue: unknown,
  options: StudioBg3dAssetMetadataMutationOptions,
): Promise<StudioBg3dAssetMetadata> {
  throwIfAborted(options.signal);
  const hash = canonicalHash(contentHash);
  const now = validateMutationNow(options);
  const validatedPatch = validationFixture({ [patchKey]: patchValue });
  const safeValue = validatedPatch[patchKey];
  throwIfAborted(options.signal);

  return withObjectStore("readwrite", options, async (store) => {
    const raw = await requestResult(store.get(hash), options.signal);
    if (raw === undefined) throw storeError("not-found");
    const current = normalizedStoredMetadata(raw);
    const next = normalizeStudioBg3dAssetMetadata({
      ...current,
      updatedAt: Math.max(current.updatedAt, now),
      [patchKey]: safeValue,
    });
    if (!next || next.contentHash !== hash) throw storeError("invalid-metadata");
    await requestResult(store.put(next), options.signal);
    return next;
  });
}

export async function listStudioBg3dAssetMetadata(
  options: StudioBg3dAssetMetadataStoreOptions = {},
): Promise<readonly StudioBg3dAssetMetadata[]> {
  if (!usesExplicitLegacyIndexedDb(options)) {
    return listStudioBg3dAssetMetadataV12(options);
  }
  return withObjectStore("readonly", options, async (store) => {
    const raw = await requestResult(store.getAll(), options.signal);
    if (raw.length > STUDIO_BG3D_ASSET_METADATA_LIMITS.assetsPerQuery) {
      throw storeError("invalid-stored-metadata");
    }
    const normalized = raw.map(normalizedStoredMetadata);
    return sortStudioBg3dAssetMetadata(normalized, "recent");
  });
}

export async function getStudioBg3dAssetMetadata(
  contentHash: unknown,
  options: StudioBg3dAssetMetadataStoreOptions = {},
): Promise<StudioBg3dAssetMetadata | null> {
  if (!usesExplicitLegacyIndexedDb(options)) {
    return getStudioBg3dAssetMetadataV12(contentHash, options);
  }
  throwIfAborted(options.signal);
  const hash = canonicalHash(contentHash);
  return withObjectStore("readonly", options, async (store) => {
    const raw = await requestResult(store.get(hash), options.signal);
    if (raw === undefined) return null;
    const metadata = normalizedStoredMetadata(raw);
    if (metadata.contentHash !== hash) throw storeError("invalid-stored-metadata");
    return metadata;
  });
}

/** Validates and de-duplicates the complete batch before opening its single write transaction. */
export async function putStudioBg3dAssetMetadataAtomically(
  values: readonly unknown[],
  options: StudioBg3dAssetMetadataStoreOptions = {},
): Promise<readonly StudioBg3dAssetMetadata[]> {
  if (!usesExplicitLegacyIndexedDb(options)) {
    return putStudioBg3dAssetMetadataV12(values, options);
  }
  throwIfAborted(options.signal);
  const metadata = preparePutBatch(values);
  throwIfAborted(options.signal);
  if (metadata.length === 0) return Object.freeze([]);

  return withObjectStore("readwrite", options, async (store) => {
    const pendingWrites: StudioBg3dAssetMetadata[] = [];
    for (const candidate of metadata) {
      const raw = await requestResult(store.get(candidate.contentHash), options.signal);
      if (raw === undefined) {
        pendingWrites.push(candidate);
        continue;
      }
      const current = normalizedStoredMetadata(raw);
      if (metadataFingerprint(current) !== metadataFingerprint(candidate)) {
        throw storeError("metadata-conflict");
      }
    }

    for (const candidate of pendingWrites) {
      await requestResult(store.put(candidate), options.signal);
    }
    return metadata;
  });
}

export async function deleteStudioBg3dAssetMetadataAtomically(
  contentHashes: readonly unknown[],
  options: StudioBg3dAssetMetadataStoreOptions = {},
): Promise<number> {
  if (!usesExplicitLegacyIndexedDb(options)) {
    return deleteStudioBg3dAssetMetadataV12(contentHashes, options);
  }
  throwIfAborted(options.signal);
  const hashes = prepareDeleteHashes(contentHashes);
  throwIfAborted(options.signal);
  if (hashes.length === 0) return 0;

  return withObjectStore("readwrite", options, async (store) => {
    let deleted = 0;
    for (const hash of hashes) {
      if (await requestResult(store.getKey(hash), options.signal) !== undefined) deleted += 1;
    }
    for (const hash of hashes) await requestResult(store.delete(hash), options.signal);
    return deleted;
  });
}

export function updateStudioBg3dAssetFavorite(
  contentHash: unknown,
  favorite: boolean,
  options: StudioBg3dAssetMetadataMutationOptions = {},
): Promise<StudioBg3dAssetMetadata> {
  if (typeof favorite !== "boolean") return Promise.reject(storeError("invalid-metadata"));
  if (!usesExplicitLegacyIndexedDb(options)) {
    return updateMetadataV12(contentHash, "favorite", favorite, options);
  }
  return updateMetadata(contentHash, "favorite", favorite, options);
}

export function updateStudioBg3dAssetCollections(
  contentHash: unknown,
  collections: readonly StudioBg3dAssetCollection[],
  options: StudioBg3dAssetMetadataMutationOptions = {},
): Promise<StudioBg3dAssetMetadata> {
  if (!usesExplicitLegacyIndexedDb(options)) {
    return updateMetadataV12(contentHash, "collections", collections, options);
  }
  return updateMetadata(contentHash, "collections", collections, options);
}

export function updateStudioBg3dAssetTags(
  contentHash: unknown,
  tags: readonly string[],
  options: StudioBg3dAssetMetadataMutationOptions = {},
): Promise<StudioBg3dAssetMetadata> {
  if (!usesExplicitLegacyIndexedDb(options)) {
    return updateMetadataV12(contentHash, "tags", tags, options);
  }
  return updateMetadata(contentHash, "tags", tags, options);
}

export function updateStudioBg3dAssetRights(
  contentHash: unknown,
  rights: StudioBg3dAssetRightsReceipt,
  options: StudioBg3dAssetMetadataMutationOptions = {},
): Promise<StudioBg3dAssetMetadata> {
  if (!usesExplicitLegacyIndexedDb(options)) {
    return updateMetadataV12(contentHash, "rights", rights, options);
  }
  return updateMetadata(contentHash, "rights", rights, options);
}
