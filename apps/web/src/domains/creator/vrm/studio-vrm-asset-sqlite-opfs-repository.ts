/**
 * V12 durable authority for user VRM binaries, thumbnails, and texture-paint PNG artifacts.
 *
 * Large immutable bytes are content-addressed in a dedicated OPFS root. SQLite stores two strict
 * canonical roots plus immutable, byte-bounded metadata pages. A save is ordered as blob -> OPFS
 * commit marker -> metadata pages -> owner refs -> SQLite root, so the root is always the last
 * durable authority transition. Anything left before that transition is recoverable staging data.
 */

import { acquireStudioLocalDatabase } from "../studio-local-database-runtime";
import {
  createStudioOpfsAssetStore,
  type StudioOpfsAssetStore,
  type StudioOpfsDigest,
  type StudioOpfsPutResult,
} from "../studio-opfs-asset-store";
import {
  createStudioOpfsNativeFileSystem,
  isStudioOpfsError,
  type StudioOpfsFileSystem,
  type StudioOpfsStorageManagerLike,
} from "../studio-opfs-filesystem";

import {
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
  STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
  type StudioVrmTexturePaintArtifactMetadata,
} from "./studio-vrm-texture-paint-artifact";

import type { StudioLocalDatabase } from "../studio-local-database";

export const STUDIO_VRM_ASSET_OPFS_ROOT = "toonspectrum-studio-vrm-assets-v12";
export const STUDIO_VRM_MODEL_SQLITE_NAMESPACE = "studio-vrm-model-assets-v12";
export const STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE = "studio-vrm-texture-paint-assets-v12";
export const STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY = "manifest-v1";
export const STUDIO_VRM_ASSET_CAS_OWNER = "studio-vrm-assets-v12";

export const STUDIO_VRM_MODEL_ASSET_LIMITS = Object.freeze({
  /** Historical total limit; v2 reuses it only as a bounded metadata page size. */
  maxModels: 512,
  maxModelBytes: 128 * 1024 * 1024,
  maxAggregateModelBytes: 16 * 1024 * 1024 * 1024,
  maxThumbnailBytes: 2 * 1024 * 1024,
  maxSampleThumbnails: 512,
  maxManifestBytes: 4 * 1024 * 1024,
});

export const STUDIO_VRM_TEXTURE_ASSET_LIMITS = Object.freeze({
  /** Historical total limit; v2 reuses it only as a bounded metadata page size. */
  maxArtifacts: 128,
  maxArtifactBytes: 96_000_000,
  maxAggregateBytes: 96_000_000,
  maxManifestBytes: 4 * 1024 * 1024,
});

const MODEL_MANIFEST_KIND = "toonspectrum.studio-vrm-model-asset-manifest" as const;
const TEXTURE_MANIFEST_KIND = "toonspectrum.studio-vrm-texture-asset-manifest" as const;
const MODEL_PAGE_KIND = "toonspectrum.studio-vrm-model-asset-page" as const;
const TEXTURE_PAGE_KIND = "toonspectrum.studio-vrm-texture-asset-page" as const;
const COMMIT_KIND = "toonspectrum.studio-vrm-asset-cas-commit" as const;
const MANIFEST_VERSION = 1 as const;
const PAGED_MANIFEST_VERSION = 2 as const;
const PAGED_MANIFEST_MAX_PAGES = 16_384;
const COMMIT_VERSION = 1 as const;
const VRM_MIME = "model/gltf-binary" as const;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;
const SAFE_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const BLOB_PATH_PATTERN = /^blobs\/([0-9a-f]{64})\.(?:bin|dfl|gz)$/u;
const COMMIT_PATH_PATTERN = /^commits\/([0-9a-f]{64})\.json$/u;
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export type StudioVrmAssetHash = `sha256:${string}`;

interface CasDescriptor {
  readonly hash: StudioVrmAssetHash;
  readonly byteLength: number;
  readonly mimeType: string;
}

interface ModelManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly contentHash: StudioVrmAssetHash;
  readonly byteSize: number;
  readonly mimeType: typeof VRM_MIME;
  readonly validationVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly blob: CasDescriptor;
  readonly thumbnail: CasDescriptor | null;
}

interface SampleThumbnailEntry {
  readonly id: string;
  readonly blob: CasDescriptor;
  readonly updatedAt: number;
}

interface ModelManifestV1 {
  readonly kind: typeof MODEL_MANIFEST_KIND;
  readonly version: typeof MANIFEST_VERSION;
  readonly generation: number;
  readonly models: readonly ModelManifestEntry[];
  readonly sampleThumbnails: readonly SampleThumbnailEntry[];
}

interface TextureManifestEntry {
  readonly contentHash: StudioVrmAssetHash;
  readonly receipt: StudioVrmTexturePaintArtifactMetadata;
  readonly blob: CasDescriptor;
}

interface TextureManifestV1 {
  readonly kind: typeof TEXTURE_MANIFEST_KIND;
  readonly version: typeof MANIFEST_VERSION;
  readonly generation: number;
  readonly artifacts: readonly TextureManifestEntry[];
}

interface ManifestPageDescriptor {
  readonly key: string;
  readonly checksum: string;
  readonly byteLength: number;
  readonly assetBytes: number;
  readonly count: number;
  readonly firstKey: string;
  readonly lastKey: string;
}

interface ModelManifestV2 {
  readonly kind: typeof MODEL_MANIFEST_KIND;
  readonly version: typeof PAGED_MANIFEST_VERSION;
  readonly generation: number;
  readonly totalModels: number;
  readonly totalModelBytes: number;
  readonly pages: readonly ManifestPageDescriptor[];
  readonly sampleThumbnails: readonly SampleThumbnailEntry[];
}

interface TextureManifestV2 {
  readonly kind: typeof TEXTURE_MANIFEST_KIND;
  readonly version: typeof PAGED_MANIFEST_VERSION;
  readonly generation: number;
  readonly totalArtifacts: number;
  readonly totalArtifactBytes: number;
  readonly pages: readonly ManifestPageDescriptor[];
}

interface ModelManifestPageV2 {
  readonly kind: typeof MODEL_PAGE_KIND;
  readonly version: typeof PAGED_MANIFEST_VERSION;
  readonly generation: number;
  readonly index: number;
  readonly models: readonly ModelManifestEntry[];
}

interface TextureManifestPageV2 {
  readonly kind: typeof TEXTURE_PAGE_KIND;
  readonly version: typeof PAGED_MANIFEST_VERSION;
  readonly generation: number;
  readonly index: number;
  readonly artifacts: readonly TextureManifestEntry[];
}

interface LoadedModelManifest {
  readonly raw: string | null;
  readonly manifest: ModelManifestV1;
  readonly pageKeys: readonly string[];
}

interface LoadedTextureManifest {
  readonly raw: string | null;
  readonly manifest: TextureManifestV1;
  readonly pageKeys: readonly string[];
}

interface CasCommitV1 {
  readonly kind: typeof COMMIT_KIND;
  readonly version: typeof COMMIT_VERSION;
  readonly hash: StudioVrmAssetHash;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly createdAt: number;
}

export interface StudioVrmModelAssetMetadata {
  readonly id: string;
  readonly name: string;
  readonly contentHash: StudioVrmAssetHash;
  readonly byteSize: number;
  readonly mimeType: typeof VRM_MIME;
  readonly validationVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly hasThumbnail: boolean;
}

export interface StudioVrmModelAsset extends StudioVrmModelAssetMetadata {
  readonly bytes: Uint8Array;
  readonly thumbnail: StudioVrmThumbnailAsset | null;
}

export type StudioVrmAssetPageCursor = string & {
  readonly __studioVrmAssetPageCursor: unique symbol;
};

export interface StudioVrmModelMetadataPage {
  readonly items: readonly StudioVrmModelAssetMetadata[];
  readonly cursor: StudioVrmAssetPageCursor;
  readonly nextCursor: StudioVrmAssetPageCursor | null;
  readonly totalCount: number;
  readonly totalBytes: number;
  readonly generation: number;
}

export interface StudioVrmTextureMetadataPage {
  readonly items: readonly StudioVrmTexturePaintArtifactMetadata[];
  readonly cursor: StudioVrmAssetPageCursor;
  readonly nextCursor: StudioVrmAssetPageCursor | null;
  readonly totalCount: number;
  readonly totalBytes: number;
  readonly generation: number;
}

export interface StudioVrmThumbnailAsset {
  readonly bytes: Uint8Array;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
}

export interface SaveStudioVrmModelAssetInput {
  readonly id: string;
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly expectedHash: StudioVrmAssetHash;
  readonly validationVersion: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SaveStudioVrmModelAssetResult {
  readonly metadata: StudioVrmModelAssetMetadata;
  readonly deduplicated: boolean;
}

export interface SaveStudioVrmTextureAssetInput {
  readonly receipt: StudioVrmTexturePaintArtifactMetadata;
  readonly bytes: Uint8Array;
  readonly limits?: {
    readonly maxArtifacts?: number;
    readonly maxArtifactBytes?: number;
    readonly maxAggregateBytes?: number;
  };
}

export interface SaveStudioVrmTextureAssetResult {
  readonly receipt: StudioVrmTexturePaintArtifactMetadata;
  readonly deduplicated: boolean;
  /** True only when this write added the content hash to the durable texture manifest. */
  readonly created: boolean;
  /** Exact manifest generation produced by this write, used only for failed-import compensation. */
  readonly generation: number;
}

export interface StudioVrmTextureAsset {
  readonly receipt: StudioVrmTexturePaintArtifactMetadata;
  readonly bytes: Uint8Array;
}

export interface StudioVrmAssetCleanupResult {
  readonly removedAssets: number;
  readonly removedPaths: number;
  readonly retainedInGrace: number;
  readonly observedForNextPass: number;
}

export type StudioVrmAssetRepositoryErrorCode =
  | "aborted"
  | "closed"
  | "conflict"
  | "corrupt"
  | "invalid"
  | "limit"
  | "missing"
  | "unavailable";

export class StudioVrmAssetRepositoryError extends Error {
  readonly code: StudioVrmAssetRepositoryErrorCode;

  constructor(
    code: StudioVrmAssetRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code === "aborted" ? "AbortError" : "StudioVrmAssetRepositoryError";
    this.code = code;
  }
}

export interface StudioVrmAssetSqliteOpfsRepository {
  readonly authority: "sqlite-opfs";
  queryModelMetadataPage(options?: {
    readonly cursor?: string | null;
    readonly signal?: AbortSignal;
  }): Promise<StudioVrmModelMetadataPage | null>;
  listModelMetadata(signal?: AbortSignal): Promise<StudioVrmModelAssetMetadata[]>;
  getModel(id: string, signal?: AbortSignal): Promise<StudioVrmModelAsset | null>;
  getModelByHash(hash: string, signal?: AbortSignal): Promise<StudioVrmModelAsset | null>;
  saveModel(
    input: SaveStudioVrmModelAssetInput,
    signal?: AbortSignal,
  ): Promise<SaveStudioVrmModelAssetResult>;
  saveThumbnail(
    id: string,
    thumbnail: StudioVrmThumbnailAsset,
    updatedAt: number,
    signal?: AbortSignal,
  ): Promise<void>;
  getThumbnail(id: string, signal?: AbortSignal): Promise<StudioVrmThumbnailAsset | null>;
  deleteModel(id: string, signal?: AbortSignal): Promise<boolean>;
  /**
   * Compensation-only compare-and-delete. The row is removed only when both its private id and
   * canonical content hash still match the receipt returned by the creating write.
   */
  deleteModelIfIdentityMatches(
    id: string,
    contentHash: StudioVrmAssetHash,
    signal?: AbortSignal,
  ): Promise<boolean>;
  saveTexture(
    input: SaveStudioVrmTextureAssetInput,
    signal?: AbortSignal,
  ): Promise<SaveStudioVrmTextureAssetResult>;
  /** Removes a newly-created texture only if no later texture-manifest write has occurred. */
  deleteTextureIfCreationMatches(
    contentHash: StudioVrmAssetHash,
    generation: number,
    signal?: AbortSignal,
  ): Promise<boolean>;
  /** Batch form used when one archive import created several hashes in contiguous mutations. */
  deleteTexturesIfCreationBatchMatches(
    creations: readonly {
      readonly contentHash: StudioVrmAssetHash;
      readonly generation: number;
    }[],
    mutationGenerations: readonly number[],
    signal?: AbortSignal,
  ): Promise<boolean>;
  queryTextureMetadataPage(options?: {
    readonly cursor?: string | null;
    readonly signal?: AbortSignal;
  }): Promise<StudioVrmTextureMetadataPage | null>;
  getTexture(hash: string, signal?: AbortSignal): Promise<StudioVrmTextureAsset | null>;
  cleanupOrphans(options?: {
    readonly maxRemovals?: number;
    readonly graceMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<StudioVrmAssetCleanupResult>;
  close(): Promise<void>;
}

export interface StudioVrmAssetSqliteOpfsRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly fileSystem?: StudioOpfsFileSystem;
  readonly digest?: StudioOpfsDigest | null;
  readonly now?: () => number;
  readonly orphanGraceMs?: number;
}

const databaseQueues = new WeakMap<
  StudioLocalDatabase,
  Map<string, Promise<unknown>>
>();

function queueForDatabase<T>(
  database: StudioLocalDatabase,
  task: () => Promise<T>,
): Promise<T> {
  let queues = databaseQueues.get(database);
  if (!queues) {
    queues = new Map();
    databaseQueues.set(database, queues);
  }
  const previous = queues.get(STUDIO_VRM_ASSET_CAS_OWNER) ?? Promise.resolve();
  const result = previous.then(task, task);
  queues.set(STUDIO_VRM_ASSET_CAS_OWNER, result.catch(() => undefined));
  return result;
}

function fail(
  code: StudioVrmAssetRepositoryErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StudioVrmAssetRepositoryError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail("aborted", "VRM 자산 저장 작업이 취소되었습니다.", signal.reason);
}

function storageFailure(cause: unknown, operation: string): never {
  if (cause instanceof StudioVrmAssetRepositoryError) throw cause;
  if (isStudioOpfsError(cause)) {
    if (cause.code === "CORRUPT_ENTRY" || cause.code === "INTEGRITY_FAILED") {
      fail("corrupt", `VRM OPFS ${operation} integrity check failed.`, cause);
    }
    if (cause.code === "QUOTA_EXCEEDED") {
      fail("limit", `VRM OPFS ${operation} exceeded the available quota.`, cause);
    }
  }
  fail("unavailable", `VRM SQLite/OPFS ${operation} failed.`, cause);
}

/** Canonical manifests use deterministic UTF-16 code-unit order, matching JSON key routing. */
function compareManifestKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (
      actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])
      || actual.some((key) => {
        const descriptor = descriptors[key];
        return descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable;
      })
    ) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hash(value: unknown): StudioVrmAssetHash | null {
  return typeof value === "string" && HASH_PATTERN.test(value)
    ? value as StudioVrmAssetHash
    : null;
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function validTimestamp(value: unknown): value is number {
  return safeInteger(value, 0);
}

function validMime(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 96
    && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(value);
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (normalized !== value || normalized.length < 1 || normalized.length > 120) return null;
  return Array.from(normalized).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  }) ? null : normalized;
}

function casDescriptor(value: unknown): CasDescriptor | null {
  const record = exactRecord(value, ["byteLength", "hash", "mimeType"]);
  if (!record) return null;
  const contentHash = hash(record.hash);
  if (!contentHash || !safeInteger(record.byteLength, 1) || !validMime(record.mimeType)) return null;
  return {
    hash: contentHash,
    byteLength: record.byteLength,
    mimeType: record.mimeType,
  };
}

function modelEntry(value: unknown): ModelManifestEntry | null {
  const record = exactRecord(value, [
    "blob",
    "byteSize",
    "contentHash",
    "createdAt",
    "id",
    "mimeType",
    "name",
    "thumbnail",
    "updatedAt",
    "validationVersion",
  ]);
  if (!record) return null;
  const contentHash = hash(record.contentHash);
  const blob = casDescriptor(record.blob);
  const name = normalizeName(record.name);
  const thumbnail = record.thumbnail === null ? null : casDescriptor(record.thumbnail);
  if (
    typeof record.id !== "string"
    || !ID_PATTERN.test(record.id)
    || !name
    || !contentHash
    || !blob
    || blob.hash !== contentHash
    || blob.byteLength !== record.byteSize
    || blob.mimeType !== VRM_MIME
    || record.mimeType !== VRM_MIME
    || !safeInteger(record.byteSize, 1)
    || record.byteSize > STUDIO_VRM_MODEL_ASSET_LIMITS.maxModelBytes
    || !safeInteger(record.validationVersion, 1)
    || !validTimestamp(record.createdAt)
    || !validTimestamp(record.updatedAt)
    || record.updatedAt < record.createdAt
    || (record.thumbnail !== null && (!thumbnail || !SAFE_IMAGE_MIMES.has(thumbnail.mimeType)))
    || (thumbnail?.byteLength ?? 0) > STUDIO_VRM_MODEL_ASSET_LIMITS.maxThumbnailBytes
  ) return null;
  return {
    id: record.id,
    name,
    contentHash,
    byteSize: record.byteSize,
    mimeType: VRM_MIME,
    validationVersion: record.validationVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    blob,
    thumbnail,
  };
}

function sampleThumbnailEntry(value: unknown): SampleThumbnailEntry | null {
  const record = exactRecord(value, ["blob", "id", "updatedAt"]);
  const blob = record ? casDescriptor(record.blob) : null;
  if (
    !record
    || typeof record.id !== "string"
    || !ID_PATTERN.test(record.id)
    || !blob
    || !SAFE_IMAGE_MIMES.has(blob.mimeType)
    || blob.byteLength > STUDIO_VRM_MODEL_ASSET_LIMITS.maxThumbnailBytes
    || !validTimestamp(record.updatedAt)
  ) return null;
  return { id: record.id, blob, updatedAt: record.updatedAt };
}

function textureReceipt(value: unknown): StudioVrmTexturePaintArtifactMetadata | null {
  const record = exactRecord(value, [
    "bindingKey",
    "byteLength",
    "contentHash",
    "height",
    "kind",
    "mimeType",
    "schemaVersion",
    "width",
  ]);
  const contentHash = record ? hash(record.contentHash) : null;
  if (
    !record
    || record.schemaVersion !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION
    || record.kind !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND
    || typeof record.bindingKey !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u.test(record.bindingKey)
    || !contentHash
    || record.mimeType !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME
    || !safeInteger(record.byteLength, 1)
    || !safeInteger(record.width, 1)
    || !safeInteger(record.height, 1)
  ) return null;
  return {
    schemaVersion: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_SCHEMA_VERSION,
    kind: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_KIND,
    bindingKey: record.bindingKey,
    contentHash,
    mimeType: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
    byteLength: record.byteLength,
    width: record.width,
    height: record.height,
  };
}

function textureEntry(value: unknown): TextureManifestEntry | null {
  const record = exactRecord(value, ["blob", "contentHash", "receipt"]);
  const contentHash = record ? hash(record.contentHash) : null;
  const receipt = record ? textureReceipt(record.receipt) : null;
  const blob = record ? casDescriptor(record.blob) : null;
  if (
    !contentHash
    || !receipt
    || !blob
    || receipt.contentHash !== contentHash
    || blob.hash !== contentHash
    || blob.byteLength !== receipt.byteLength
    || blob.mimeType !== STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME
  ) return null;
  return { contentHash, receipt, blob };
}

function emptyModelManifest(): ModelManifestV1 {
  return {
    kind: MODEL_MANIFEST_KIND,
    version: MANIFEST_VERSION,
    generation: 0,
    models: [],
    sampleThumbnails: [],
  };
}

function emptyTextureManifest(): TextureManifestV1 {
  return {
    kind: TEXTURE_MANIFEST_KIND,
    version: MANIFEST_VERSION,
    generation: 0,
    artifacts: [],
  };
}

function canonicalModelManifest(value: ModelManifestV1): ModelManifestV1 {
  return {
    kind: MODEL_MANIFEST_KIND,
    version: MANIFEST_VERSION,
    generation: value.generation,
    models: [...value.models].sort((left, right) => compareManifestKeys(left.id, right.id)),
    sampleThumbnails: [...value.sampleThumbnails]
      .sort((left, right) => compareManifestKeys(left.id, right.id)),
  };
}

function canonicalTextureManifest(value: TextureManifestV1): TextureManifestV1 {
  return {
    kind: TEXTURE_MANIFEST_KIND,
    version: MANIFEST_VERSION,
    generation: value.generation,
    artifacts: [...value.artifacts]
      .sort((left, right) => compareManifestKeys(left.contentHash, right.contentHash)),
  };
}

function encodedBytes(value: string): number {
  return UTF8.encode(value).byteLength;
}

function checkedAggregate(
  values: readonly number[],
  maximum: number,
  code: StudioVrmAssetRepositoryErrorCode,
  message: string,
): number {
  let total = 0;
  for (const value of values) {
    if (!safeInteger(value, 0) || value > maximum - total) fail(code, message);
    total += value;
  }
  return total;
}

function nextManifestGeneration(current: number): number {
  if (!safeInteger(current, 0) || current >= Number.MAX_SAFE_INTEGER) {
    fail("limit", "VRM asset manifest generation is exhausted.");
  }
  return current + 1;
}

function parseModelManifest(raw: string | null): ModelManifestV1 {
  if (raw === null) return emptyModelManifest();
  if (encodedBytes(raw) > STUDIO_VRM_MODEL_ASSET_LIMITS.maxManifestBytes) {
    fail("limit", "VRM model SQLite manifest exceeds its byte limit.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (cause) {
    fail("corrupt", "VRM model SQLite manifest JSON is corrupt.", cause);
  }
  const record = exactRecord(decoded, [
    "generation",
    "kind",
    "models",
    "sampleThumbnails",
    "version",
  ]);
  if (
    !record
    || record.kind !== MODEL_MANIFEST_KIND
    || record.version !== MANIFEST_VERSION
    || !safeInteger(record.generation, 0)
    || !Array.isArray(record.models)
    || !Array.isArray(record.sampleThumbnails)
    || record.models.length > STUDIO_VRM_MODEL_ASSET_LIMITS.maxModels
    || record.sampleThumbnails.length > STUDIO_VRM_MODEL_ASSET_LIMITS.maxSampleThumbnails
  ) fail("corrupt", "VRM model SQLite manifest envelope is invalid.");
  const models = record.models.map(modelEntry);
  const thumbnails = record.sampleThumbnails.map(sampleThumbnailEntry);
  if (models.some((entry) => entry === null) || thumbnails.some((entry) => entry === null)) {
    fail("corrupt", "VRM model SQLite manifest contains an invalid entry.");
  }
  const modelIds = new Set(models.map((entry) => entry!.id));
  const hashes = new Set(models.map((entry) => entry!.contentHash));
  const thumbnailIds = new Set(thumbnails.map((entry) => entry!.id));
  if (
    modelIds.size !== models.length
    || hashes.size !== models.length
    || thumbnailIds.size !== thumbnails.length
  ) fail("corrupt", "VRM model SQLite manifest contains duplicate identities.");
  const manifest = canonicalModelManifest({
    kind: MODEL_MANIFEST_KIND,
    version: MANIFEST_VERSION,
    generation: record.generation,
    models: models as ModelManifestEntry[],
    sampleThumbnails: thumbnails as SampleThumbnailEntry[],
  });
  checkedAggregate(
    manifest.models.map((entry) => entry.byteSize),
    STUDIO_VRM_MODEL_ASSET_LIMITS.maxAggregateModelBytes,
    "corrupt",
    "VRM model SQLite manifest exceeds its aggregate model byte limit.",
  );
  if (JSON.stringify(manifest) !== raw) {
    fail("corrupt", "VRM model SQLite manifest is not canonical JSON.");
  }
  return manifest;
}

function parseTextureManifest(raw: string | null): TextureManifestV1 {
  if (raw === null) return emptyTextureManifest();
  if (encodedBytes(raw) > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxManifestBytes) {
    fail("limit", "VRM texture SQLite manifest exceeds its byte limit.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (cause) {
    fail("corrupt", "VRM texture SQLite manifest JSON is corrupt.", cause);
  }
  const record = exactRecord(decoded, ["artifacts", "generation", "kind", "version"]);
  if (
    !record
    || record.kind !== TEXTURE_MANIFEST_KIND
    || record.version !== MANIFEST_VERSION
    || !safeInteger(record.generation, 0)
    || !Array.isArray(record.artifacts)
    || record.artifacts.length > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifacts
  ) fail("corrupt", "VRM texture SQLite manifest envelope is invalid.");
  const artifacts = record.artifacts.map(textureEntry);
  if (artifacts.some((entry) => entry === null)) {
    fail("corrupt", "VRM texture SQLite manifest contains an invalid entry.");
  }
  const hashes = new Set(artifacts.map((entry) => entry!.contentHash));
  if (hashes.size !== artifacts.length) {
    fail("corrupt", "VRM texture SQLite manifest contains duplicate hashes.");
  }
  const manifest = canonicalTextureManifest({
    kind: TEXTURE_MANIFEST_KIND,
    version: MANIFEST_VERSION,
    generation: record.generation,
    artifacts: artifacts as TextureManifestEntry[],
  });
  checkedAggregate(
    manifest.artifacts.map((entry) => entry.receipt.byteLength),
    STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxAggregateBytes,
    "corrupt",
    "VRM texture SQLite manifest exceeds its aggregate artifact byte limit.",
  );
  if (JSON.stringify(manifest) !== raw) {
    fail("corrupt", "VRM texture SQLite manifest is not canonical JSON.");
  }
  return manifest;
}

function manifestChecksum(value: string): string {
  let checksum = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    checksum ^= value.charCodeAt(index);
    checksum = Math.imul(checksum, 0x01000193);
  }
  return (checksum >>> 0).toString(16).padStart(8, "0");
}

function pageDescriptor(
  value: unknown,
  prefix: "model" | "texture",
): ManifestPageDescriptor | null {
  const record = exactRecord(value, [
    "assetBytes",
    "byteLength",
    "checksum",
    "count",
    "firstKey",
    "key",
    "lastKey",
  ]);
  if (
    !record
    || typeof record.key !== "string"
    || !new RegExp(`^manifest-v2-${prefix}-page-[0-9]+-[0-9]+-[a-f0-9]{8}$`, "u")
      .test(record.key)
    || typeof record.checksum !== "string"
    || !/^[a-f0-9]{8}$/u.test(record.checksum)
    || !safeInteger(record.byteLength, 1)
    || !safeInteger(record.assetBytes, 0)
    || !safeInteger(record.count, 1)
    || typeof record.firstKey !== "string"
    || typeof record.lastKey !== "string"
    || record.firstKey.length < 1
    || record.lastKey.length < 1
    || compareManifestKeys(record.firstKey, record.lastKey) > 0
  ) return null;
  return {
    key: record.key,
    checksum: record.checksum,
    byteLength: record.byteLength,
    assetBytes: record.assetBytes,
    count: record.count,
    firstKey: record.firstKey,
    lastKey: record.lastKey,
  };
}

function parseModelManifestV2Root(raw: string): ModelManifestV2 {
  if (encodedBytes(raw) > STUDIO_VRM_MODEL_ASSET_LIMITS.maxManifestBytes) {
    fail("limit", "VRM model paged manifest root exceeds its byte limit.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (cause) {
    fail("corrupt", "VRM model paged manifest JSON is corrupt.", cause);
  }
  const record = exactRecord(decoded, [
    "generation",
    "kind",
    "pages",
    "sampleThumbnails",
    "totalModelBytes",
    "totalModels",
    "version",
  ]);
  if (
    !record
    || record.kind !== MODEL_MANIFEST_KIND
    || record.version !== PAGED_MANIFEST_VERSION
    || !safeInteger(record.generation, 1)
    || !safeInteger(record.totalModels, 0)
    || !safeInteger(record.totalModelBytes, 0)
    || record.totalModelBytes > STUDIO_VRM_MODEL_ASSET_LIMITS.maxAggregateModelBytes
    || !Array.isArray(record.pages)
    || record.pages.length > PAGED_MANIFEST_MAX_PAGES
    || !Array.isArray(record.sampleThumbnails)
    || record.sampleThumbnails.length > STUDIO_VRM_MODEL_ASSET_LIMITS.maxSampleThumbnails
  ) fail("corrupt", "VRM model paged manifest envelope is invalid.");
  const pages = record.pages.map((value) => pageDescriptor(value, "model"));
  const sampleThumbnails = record.sampleThumbnails.map(sampleThumbnailEntry);
  if (pages.some((page) => page === null) || sampleThumbnails.some((entry) => entry === null)) {
    fail("corrupt", "VRM model paged manifest contains an invalid descriptor.");
  }
  const typedPages = pages as ManifestPageDescriptor[];
  const typedThumbnails = sampleThumbnails as SampleThumbnailEntry[];
  const rootBytes = encodedBytes(raw);
  const totalPageBytes = checkedAggregate(
    typedPages.map((page) => page.byteLength),
    STUDIO_VRM_MODEL_ASSET_LIMITS.maxManifestBytes - rootBytes,
    "corrupt",
    "VRM model paged manifest exceeds its aggregate metadata byte limit.",
  );
  const totalModels = checkedAggregate(
    typedPages.map((page) => page.count),
    PAGED_MANIFEST_MAX_PAGES * STUDIO_VRM_MODEL_ASSET_LIMITS.maxModels,
    "corrupt",
    "VRM model paged manifest count overflows its bounded page authority.",
  );
  const totalModelBytes = checkedAggregate(
    typedPages.map((page) => page.assetBytes),
    STUDIO_VRM_MODEL_ASSET_LIMITS.maxAggregateModelBytes,
    "corrupt",
    "VRM model paged manifest exceeds its aggregate model byte limit.",
  );
  if (
    new Set(typedPages.map((page) => page.key)).size !== typedPages.length
    || typedPages.some((page) => page.count > STUDIO_VRM_MODEL_ASSET_LIMITS.maxModels)
    || typedPages.some((page, index) =>
      page.key !== `manifest-v2-model-page-${record.generation}-${index}-${page.checksum}`)
    || typedPages.some((page, index) =>
      index > 0 && compareManifestKeys(typedPages[index - 1]!.lastKey, page.firstKey) >= 0)
    || rootBytes + totalPageBytes > STUDIO_VRM_MODEL_ASSET_LIMITS.maxManifestBytes
    || totalModels !== record.totalModels
    || totalModelBytes !== record.totalModelBytes
    || new Set(typedThumbnails.map((entry) => entry.id)).size !== typedThumbnails.length
  ) fail("corrupt", "VRM model paged manifest totals or identities are invalid.");
  const manifest: ModelManifestV2 = {
    kind: MODEL_MANIFEST_KIND,
    version: PAGED_MANIFEST_VERSION,
    generation: record.generation,
    totalModels: record.totalModels,
    totalModelBytes: record.totalModelBytes,
    pages: typedPages,
    sampleThumbnails: [...typedThumbnails]
      .sort((left, right) => compareManifestKeys(left.id, right.id)),
  };
  if (JSON.stringify(manifest) !== raw) {
    fail("corrupt", "VRM model paged manifest is not canonical JSON.");
  }
  return manifest;
}

function parseTextureManifestV2Root(raw: string): TextureManifestV2 {
  if (encodedBytes(raw) > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxManifestBytes) {
    fail("limit", "VRM texture paged manifest root exceeds its byte limit.");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (cause) {
    fail("corrupt", "VRM texture paged manifest JSON is corrupt.", cause);
  }
  const record = exactRecord(decoded, [
    "generation",
    "kind",
    "pages",
    "totalArtifactBytes",
    "totalArtifacts",
    "version",
  ]);
  if (
    !record
    || record.kind !== TEXTURE_MANIFEST_KIND
    || record.version !== PAGED_MANIFEST_VERSION
    || !safeInteger(record.generation, 1)
    || !safeInteger(record.totalArtifacts, 0)
    || !safeInteger(record.totalArtifactBytes, 0)
    || record.totalArtifactBytes > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxAggregateBytes
    || !Array.isArray(record.pages)
    || record.pages.length > PAGED_MANIFEST_MAX_PAGES
  ) fail("corrupt", "VRM texture paged manifest envelope is invalid.");
  const pages = record.pages.map((value) => pageDescriptor(value, "texture"));
  if (pages.some((page) => page === null)) {
    fail("corrupt", "VRM texture paged manifest contains an invalid descriptor.");
  }
  const typedPages = pages as ManifestPageDescriptor[];
  const rootBytes = encodedBytes(raw);
  const totalPageBytes = checkedAggregate(
    typedPages.map((page) => page.byteLength),
    STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxManifestBytes - rootBytes,
    "corrupt",
    "VRM texture paged manifest exceeds its aggregate metadata byte limit.",
  );
  const totalArtifacts = checkedAggregate(
    typedPages.map((page) => page.count),
    PAGED_MANIFEST_MAX_PAGES * STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifacts,
    "corrupt",
    "VRM texture paged manifest count overflows its bounded page authority.",
  );
  const totalArtifactBytes = checkedAggregate(
    typedPages.map((page) => page.assetBytes),
    STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxAggregateBytes,
    "corrupt",
    "VRM texture paged manifest exceeds its aggregate artifact byte limit.",
  );
  if (
    new Set(typedPages.map((page) => page.key)).size !== typedPages.length
    || typedPages.some((page) => page.count > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifacts)
    || typedPages.some((page, index) =>
      page.key !== `manifest-v2-texture-page-${record.generation}-${index}-${page.checksum}`)
    || typedPages.some((page, index) =>
      index > 0 && compareManifestKeys(typedPages[index - 1]!.lastKey, page.firstKey) >= 0)
    || rootBytes + totalPageBytes > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxManifestBytes
    || totalArtifacts !== record.totalArtifacts
    || totalArtifactBytes !== record.totalArtifactBytes
  ) fail("corrupt", "VRM texture paged manifest totals or identities are invalid.");
  const manifest: TextureManifestV2 = {
    kind: TEXTURE_MANIFEST_KIND,
    version: PAGED_MANIFEST_VERSION,
    generation: record.generation,
    totalArtifacts: record.totalArtifacts,
    totalArtifactBytes: record.totalArtifactBytes,
    pages: typedPages,
  };
  if (JSON.stringify(manifest) !== raw) {
    fail("corrupt", "VRM texture paged manifest is not canonical JSON.");
  }
  return manifest;
}

function parseModelManifestPage(
  raw: string | null,
  descriptor: ManifestPageDescriptor,
  generation: number,
  index: number,
): readonly ModelManifestEntry[] {
  if (
    raw === null
    || encodedBytes(raw) !== descriptor.byteLength
    || manifestChecksum(raw) !== descriptor.checksum
  ) fail("corrupt", "VRM model manifest page is missing or checksum-mismatched.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (cause) {
    fail("corrupt", "VRM model manifest page JSON is corrupt.", cause);
  }
  const record = exactRecord(decoded, ["generation", "index", "kind", "models", "version"]);
  if (
    !record
    || record.kind !== MODEL_PAGE_KIND
    || record.version !== PAGED_MANIFEST_VERSION
    || record.generation !== generation
    || record.index !== index
    || !Array.isArray(record.models)
    || record.models.length !== descriptor.count
    || record.models.length > STUDIO_VRM_MODEL_ASSET_LIMITS.maxModels
  ) fail("corrupt", "VRM model manifest page envelope is invalid.");
  const models = record.models.map(modelEntry);
  if (models.some((entry) => entry === null)) {
    fail("corrupt", "VRM model manifest page contains an invalid entry.");
  }
  const typed = (models as ModelManifestEntry[])
    .sort((left, right) => compareManifestKeys(left.id, right.id));
  if (
    typed[0]?.id !== descriptor.firstKey
    || typed.at(-1)?.id !== descriptor.lastKey
    || typed.reduce((sum, entry) => sum + entry.byteSize, 0) !== descriptor.assetBytes
    || new Set(typed.map((entry) => entry.id)).size !== typed.length
    || new Set(typed.map((entry) => entry.contentHash)).size !== typed.length
  ) fail("corrupt", "VRM model manifest page identities or totals are invalid.");
  const canonical: ModelManifestPageV2 = {
    kind: MODEL_PAGE_KIND,
    version: PAGED_MANIFEST_VERSION,
    generation,
    index,
    models: typed,
  };
  if (JSON.stringify(canonical) !== raw) {
    fail("corrupt", "VRM model manifest page is not canonical JSON.");
  }
  return Object.freeze(typed);
}

function parseTextureManifestPage(
  raw: string | null,
  descriptor: ManifestPageDescriptor,
  generation: number,
  index: number,
): readonly TextureManifestEntry[] {
  if (
    raw === null
    || encodedBytes(raw) !== descriptor.byteLength
    || manifestChecksum(raw) !== descriptor.checksum
  ) fail("corrupt", "VRM texture manifest page is missing or checksum-mismatched.");
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch (cause) {
    fail("corrupt", "VRM texture manifest page JSON is corrupt.", cause);
  }
  const record = exactRecord(decoded, ["artifacts", "generation", "index", "kind", "version"]);
  if (
    !record
    || record.kind !== TEXTURE_PAGE_KIND
    || record.version !== PAGED_MANIFEST_VERSION
    || record.generation !== generation
    || record.index !== index
    || !Array.isArray(record.artifacts)
    || record.artifacts.length !== descriptor.count
    || record.artifacts.length > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifacts
  ) fail("corrupt", "VRM texture manifest page envelope is invalid.");
  const artifacts = record.artifacts.map(textureEntry);
  if (artifacts.some((entry) => entry === null)) {
    fail("corrupt", "VRM texture manifest page contains an invalid entry.");
  }
  const typed = (artifacts as TextureManifestEntry[])
    .sort((left, right) => compareManifestKeys(left.contentHash, right.contentHash));
  if (
    typed[0]?.contentHash !== descriptor.firstKey
    || typed.at(-1)?.contentHash !== descriptor.lastKey
    || typed.reduce((sum, entry) => sum + entry.receipt.byteLength, 0) !== descriptor.assetBytes
    || new Set(typed.map((entry) => entry.contentHash)).size !== typed.length
  ) fail("corrupt", "VRM texture manifest page identities or totals are invalid.");
  const canonical: TextureManifestPageV2 = {
    kind: TEXTURE_PAGE_KIND,
    version: PAGED_MANIFEST_VERSION,
    generation,
    index,
    artifacts: typed,
  };
  if (JSON.stringify(canonical) !== raw) {
    fail("corrupt", "VRM texture manifest page is not canonical JSON.");
  }
  return Object.freeze(typed);
}

interface PreparedManifestPage {
  readonly descriptor: ManifestPageDescriptor;
  readonly raw: string;
}

function prepareModelManifestV2(
  manifest: ModelManifestV1,
): { readonly root: ModelManifestV2; readonly raw: string; readonly pages: readonly PreparedManifestPage[] } {
  const canonical = canonicalModelManifest(manifest);
  if (!safeInteger(canonical.generation, 1)) {
    fail("limit", "VRM model paged manifest generation is invalid.");
  }
  const totalModelBytes = checkedAggregate(
    canonical.models.map((entry) => entry.byteSize),
    STUDIO_VRM_MODEL_ASSET_LIMITS.maxAggregateModelBytes,
    "limit",
    "VRM model library reached its aggregate byte limit.",
  );
  const pages: PreparedManifestPage[] = [];
  for (
    let offset = 0;
    offset < canonical.models.length;
    offset += STUDIO_VRM_MODEL_ASSET_LIMITS.maxModels
  ) {
    const models = canonical.models.slice(offset, offset + STUDIO_VRM_MODEL_ASSET_LIMITS.maxModels);
    const index = pages.length;
    const page: ModelManifestPageV2 = {
      kind: MODEL_PAGE_KIND,
      version: PAGED_MANIFEST_VERSION,
      generation: canonical.generation,
      index,
      models,
    };
    const raw = JSON.stringify(page);
    const checksum = manifestChecksum(raw);
    pages.push({
      raw,
      descriptor: {
        key: `manifest-v2-model-page-${canonical.generation}-${index}-${checksum}`,
        checksum,
        byteLength: encodedBytes(raw),
        assetBytes: models.reduce((sum, entry) => sum + entry.byteSize, 0),
        count: models.length,
        firstKey: models[0]!.id,
        lastKey: models.at(-1)!.id,
      },
    });
  }
  const root: ModelManifestV2 = {
    kind: MODEL_MANIFEST_KIND,
    version: PAGED_MANIFEST_VERSION,
    generation: canonical.generation,
    totalModels: canonical.models.length,
    totalModelBytes,
    pages: pages.map((page) => page.descriptor),
    sampleThumbnails: canonical.sampleThumbnails,
  };
  const raw = JSON.stringify(root);
  const metadataBytes = encodedBytes(raw) + pages.reduce(
    (sum, page) => sum + page.descriptor.byteLength,
    0,
  );
  if (metadataBytes > STUDIO_VRM_MODEL_ASSET_LIMITS.maxManifestBytes) {
    fail("limit", "VRM model paged manifest exceeds its aggregate metadata byte limit.");
  }
  return Object.freeze({ root, raw, pages: Object.freeze(pages) });
}

function prepareTextureManifestV2(
  manifest: TextureManifestV1,
): { readonly root: TextureManifestV2; readonly raw: string; readonly pages: readonly PreparedManifestPage[] } {
  const canonical = canonicalTextureManifest(manifest);
  if (!safeInteger(canonical.generation, 1)) {
    fail("limit", "VRM texture paged manifest generation is invalid.");
  }
  const totalArtifactBytes = checkedAggregate(
    canonical.artifacts.map((entry) => entry.receipt.byteLength),
    STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxAggregateBytes,
    "limit",
    "VRM texture-paint library reached its aggregate byte limit.",
  );
  const pages: PreparedManifestPage[] = [];
  for (
    let offset = 0;
    offset < canonical.artifacts.length;
    offset += STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifacts
  ) {
    const artifacts = canonical.artifacts.slice(
      offset,
      offset + STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifacts,
    );
    const index = pages.length;
    const page: TextureManifestPageV2 = {
      kind: TEXTURE_PAGE_KIND,
      version: PAGED_MANIFEST_VERSION,
      generation: canonical.generation,
      index,
      artifacts,
    };
    const raw = JSON.stringify(page);
    const checksum = manifestChecksum(raw);
    pages.push({
      raw,
      descriptor: {
        key: `manifest-v2-texture-page-${canonical.generation}-${index}-${checksum}`,
        checksum,
        byteLength: encodedBytes(raw),
        assetBytes: artifacts.reduce((sum, entry) => sum + entry.receipt.byteLength, 0),
        count: artifacts.length,
        firstKey: artifacts[0]!.contentHash,
        lastKey: artifacts.at(-1)!.contentHash,
      },
    });
  }
  const root: TextureManifestV2 = {
    kind: TEXTURE_MANIFEST_KIND,
    version: PAGED_MANIFEST_VERSION,
    generation: canonical.generation,
    totalArtifacts: canonical.artifacts.length,
    totalArtifactBytes,
    pages: pages.map((page) => page.descriptor),
  };
  const raw = JSON.stringify(root);
  const metadataBytes = encodedBytes(raw) + pages.reduce(
    (sum, page) => sum + page.descriptor.byteLength,
    0,
  );
  if (metadataBytes > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxManifestBytes) {
    fail("limit", "VRM texture paged manifest exceeds its aggregate metadata byte limit.");
  }
  return Object.freeze({ root, raw, pages: Object.freeze(pages) });
}

function modelMetadata(entry: ModelManifestEntry): StudioVrmModelAssetMetadata {
  return {
    id: entry.id,
    name: entry.name,
    contentHash: entry.contentHash,
    byteSize: entry.byteSize,
    mimeType: VRM_MIME,
    validationVersion: entry.validationVersion,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    hasThumbnail: entry.thumbnail !== null,
  };
}

function commitPath(contentHash: StudioVrmAssetHash): string {
  return `commits/${contentHash.slice("sha256:".length)}.json`;
}

export function studioVrmAssetCommitPath(contentHash: StudioVrmAssetHash): string {
  return commitPath(contentHash);
}

function canonicalCommit(descriptor: CasDescriptor, createdAt: number): CasCommitV1 {
  return {
    kind: COMMIT_KIND,
    version: COMMIT_VERSION,
    hash: descriptor.hash,
    byteLength: descriptor.byteLength,
    mimeType: descriptor.mimeType,
    createdAt,
  };
}

function parseCommit(raw: Uint8Array, expected?: CasDescriptor): CasCommitV1 {
  let text: string;
  let decoded: unknown;
  try {
    text = UTF8_DECODER.decode(raw);
    decoded = JSON.parse(text) as unknown;
  } catch (cause) {
    fail("corrupt", "VRM OPFS commit marker is corrupt.", cause);
  }
  const record = exactRecord(decoded, [
    "byteLength",
    "createdAt",
    "hash",
    "kind",
    "mimeType",
    "version",
  ]);
  const contentHash = record ? hash(record.hash) : null;
  if (
    !record
    || record.kind !== COMMIT_KIND
    || record.version !== COMMIT_VERSION
    || !contentHash
    || !safeInteger(record.byteLength, 1)
    || !validMime(record.mimeType)
    || !validTimestamp(record.createdAt)
  ) fail("corrupt", "VRM OPFS commit marker envelope is invalid.");
  const commit = canonicalCommit({
    hash: contentHash,
    byteLength: record.byteLength,
    mimeType: record.mimeType,
  }, record.createdAt);
  if (JSON.stringify(commit) !== text) {
    fail("corrupt", "VRM OPFS commit marker is not canonical JSON.");
  }
  if (
    expected
    && (
      commit.hash !== expected.hash
      || commit.byteLength !== expected.byteLength
      || commit.mimeType !== expected.mimeType
    )
  ) fail("corrupt", "VRM OPFS commit marker does not match the SQLite manifest.");
  return commit;
}

function uniqueLiveHashes(
  models: ModelManifestV1,
  textures: TextureManifestV1,
): StudioVrmAssetHash[] {
  const hashes = new Set<StudioVrmAssetHash>();
  for (const entry of models.models) {
    hashes.add(entry.blob.hash);
    if (entry.thumbnail) hashes.add(entry.thumbnail.hash);
  }
  for (const entry of models.sampleThumbnails) hashes.add(entry.blob.hash);
  for (const entry of textures.artifacts) hashes.add(entry.blob.hash);
  return [...hashes].sort();
}

function unionLiveHashes(
  previousModels: ModelManifestV1,
  previousTextures: TextureManifestV1,
  nextModels: ModelManifestV1,
  nextTextures: TextureManifestV1,
): StudioVrmAssetHash[] {
  return [...new Set([
    ...uniqueLiveHashes(previousModels, previousTextures),
    ...uniqueLiveHashes(nextModels, nextTextures),
  ])].sort();
}

function resolvedTextureLimit(
  value: number | undefined,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return maximum;
  if (!safeInteger(value, 1) || value > maximum) {
    fail("limit", `${label} exceeds the hard V12 texture asset limit.`);
  }
  return value;
}

function resolveTextureLimits(value: SaveStudioVrmTextureAssetInput["limits"]): {
  maxArtifactBytes: number;
  maxAggregateBytes: number;
} {
  if (value?.maxArtifacts !== undefined) {
    resolvedTextureLimit(
      value.maxArtifacts,
      STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifacts,
      "maxArtifacts",
    );
  }
  return {
    maxArtifactBytes: resolvedTextureLimit(
      value?.maxArtifactBytes,
      STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxArtifactBytes,
      "maxArtifactBytes",
    ),
    maxAggregateBytes: resolvedTextureLimit(
      value?.maxAggregateBytes,
      STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxAggregateBytes,
      "maxAggregateBytes",
    ),
  };
}

function productOpfsFileSystem(): StudioOpfsFileSystem {
  let manager: StudioOpfsStorageManagerLike | null = null;
  try {
    const storage = globalThis.navigator?.storage as unknown as
      | (StudioOpfsStorageManagerLike & { getDirectory?: unknown })
      | undefined;
    if (storage && typeof storage.getDirectory === "function") manager = storage;
  } catch {
    manager = null;
  }
  if (!manager) {
    fail(
      "unavailable",
      "이 환경에서는 VRM 자산용 OPFS를 사용할 수 없습니다. 현재 탭 메모리 임시 상태만 사용할 수 있습니다.",
    );
  }
  return createStudioOpfsNativeFileSystem(manager, STUDIO_VRM_ASSET_OPFS_ROOT);
}

export function createStudioVrmAssetSqliteOpfsRepository(
  options: StudioVrmAssetSqliteOpfsRepositoryOptions = {},
): StudioVrmAssetSqliteOpfsRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const now = options.now ?? Date.now;
  const orphanGraceMs = options.orphanGraceMs ?? 300_000;
  let fileSystem = options.fileSystem ?? null;
  let assetStore: StudioOpfsAssetStore | null = null;
  let closed = false;
  let lifecycleGeneration = 0;
  const observedOrphans = new Set<string>();

  function ensureOpen(generation?: number): void {
    if (closed || (generation !== undefined && generation !== lifecycleGeneration)) {
      fail("closed", "VRM asset repository is closed or superseded.");
    }
  }

  function fs(): StudioOpfsFileSystem {
    ensureOpen();
    fileSystem ??= productOpfsFileSystem();
    return fileSystem;
  }

  function assets(): StudioOpfsAssetStore {
    assetStore ??= createStudioOpfsAssetStore({
      fs: fs(),
      ...(options.digest !== undefined ? { digest: options.digest } : {}),
      now,
      graceMs: orphanGraceMs,
    });
    return assetStore;
  }

  async function database(): Promise<StudioLocalDatabase> {
    ensureOpen();
    try {
      return await acquireDatabase();
    } catch (cause) {
      fail(
        "unavailable",
        "VRM 자산용 shared SQLite/OPFS 권위를 열지 못했습니다. 현재 탭 메모리 임시 상태만 유지됩니다.",
        cause,
      );
    }
  }

  function decodedManifestVersion(raw: string): unknown {
    try {
      const decoded = JSON.parse(raw) as unknown;
      return typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)
        ? (decoded as Record<string, unknown>).version
        : null;
    } catch {
      return null;
    }
  }

  async function readModelManifest(
    databaseHandle: StudioLocalDatabase,
    raw: string | null,
  ): Promise<LoadedModelManifest> {
    if (raw === null || decodedManifestVersion(raw) !== PAGED_MANIFEST_VERSION) {
      return { raw, manifest: parseModelManifest(raw), pageKeys: [] };
    }
    const root = parseModelManifestV2Root(raw);
    const pageRaws = await Promise.all(root.pages.map((page) =>
      databaseHandle.kvGet(STUDIO_VRM_MODEL_SQLITE_NAMESPACE, page.key)));
    const models = root.pages.flatMap((page, index) =>
      parseModelManifestPage(pageRaws[index] ?? null, page, root.generation, index));
    if (
      encodedBytes(raw) + root.pages.reduce((sum, page) => sum + page.byteLength, 0)
        > STUDIO_VRM_MODEL_ASSET_LIMITS.maxManifestBytes
      || models.length !== root.totalModels
      || models.reduce((sum, entry) => sum + entry.byteSize, 0) !== root.totalModelBytes
      || new Set(models.map((entry) => entry.id)).size !== models.length
      || new Set(models.map((entry) => entry.contentHash)).size !== models.length
      || models.some((entry, index) =>
        index > 0 && compareManifestKeys(models[index - 1]!.id, entry.id) >= 0)
    ) fail("corrupt", "VRM model paged manifest pages are inconsistent.");
    return {
      raw,
      manifest: {
        kind: MODEL_MANIFEST_KIND,
        version: MANIFEST_VERSION,
        generation: root.generation,
        models,
        sampleThumbnails: root.sampleThumbnails,
      },
      pageKeys: root.pages.map((page) => page.key),
    };
  }

  async function readTextureManifest(
    databaseHandle: StudioLocalDatabase,
    raw: string | null,
  ): Promise<LoadedTextureManifest> {
    if (raw === null || decodedManifestVersion(raw) !== PAGED_MANIFEST_VERSION) {
      return { raw, manifest: parseTextureManifest(raw), pageKeys: [] };
    }
    const root = parseTextureManifestV2Root(raw);
    const pageRaws = await Promise.all(root.pages.map((page) =>
      databaseHandle.kvGet(STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE, page.key)));
    const artifacts = root.pages.flatMap((page, index) =>
      parseTextureManifestPage(pageRaws[index] ?? null, page, root.generation, index));
    if (
      encodedBytes(raw) + root.pages.reduce((sum, page) => sum + page.byteLength, 0)
        > STUDIO_VRM_TEXTURE_ASSET_LIMITS.maxManifestBytes
      || artifacts.length !== root.totalArtifacts
      || artifacts.reduce((sum, entry) => sum + entry.receipt.byteLength, 0)
        !== root.totalArtifactBytes
      || new Set(artifacts.map((entry) => entry.contentHash)).size !== artifacts.length
      || artifacts.some((entry, index) =>
        index > 0 && compareManifestKeys(
          artifacts[index - 1]!.contentHash,
          entry.contentHash,
        ) >= 0)
    ) fail("corrupt", "VRM texture paged manifest pages are inconsistent.");
    return {
      raw,
      manifest: {
        kind: TEXTURE_MANIFEST_KIND,
        version: MANIFEST_VERSION,
        generation: root.generation,
        artifacts,
      },
      pageKeys: root.pages.map((page) => page.key),
    };
  }

  async function readManifests(databaseHandle: StudioLocalDatabase): Promise<{
    modelRaw: string | null;
    models: ModelManifestV1;
    modelPageKeys: readonly string[];
    textureRaw: string | null;
    textures: TextureManifestV1;
    texturePageKeys: readonly string[];
  }> {
    const [modelRaw, textureRaw] = await Promise.all([
      databaseHandle.kvGet(
        STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
        STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
      ),
      databaseHandle.kvGet(
        STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
        STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
      ),
    ]);
    const [models, textures] = await Promise.all([
      readModelManifest(databaseHandle, modelRaw),
      readTextureManifest(databaseHandle, textureRaw),
    ]);
    return {
      modelRaw,
      models: models.manifest,
      modelPageKeys: models.pageKeys,
      textureRaw,
      textures: textures.manifest,
      texturePageKeys: textures.pageKeys,
    };
  }

  async function findModelEntryById(
    databaseHandle: StudioLocalDatabase,
    id: string,
  ): Promise<{
    readonly model: ModelManifestEntry | null;
    readonly sampleThumbnail: SampleThumbnailEntry | null;
  }> {
    const raw = await databaseHandle.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    if (raw === null || decodedManifestVersion(raw) !== PAGED_MANIFEST_VERSION) {
      const manifest = parseModelManifest(raw);
      return {
        model: manifest.models.find((entry) => entry.id === id) ?? null,
        sampleThumbnail: manifest.sampleThumbnails.find((entry) => entry.id === id) ?? null,
      };
    }
    const root = parseModelManifestV2Root(raw);
    const sampleThumbnail = root.sampleThumbnails.find((entry) => entry.id === id) ?? null;
    const pageIndex = root.pages.findIndex((page) => (
      compareManifestKeys(page.firstKey, id) <= 0
      && compareManifestKeys(id, page.lastKey) <= 0
    ));
    const descriptor = root.pages[pageIndex];
    if (pageIndex < 0 || !descriptor) return { model: null, sampleThumbnail };
    const pageRaw = await databaseHandle.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      descriptor.key,
    );
    const models = parseModelManifestPage(pageRaw, descriptor, root.generation, pageIndex);
    return {
      model: models.find((entry) => entry.id === id) ?? null,
      sampleThumbnail,
    };
  }

  async function findModelEntryByHash(
    databaseHandle: StudioLocalDatabase,
    contentHash: StudioVrmAssetHash,
  ): Promise<ModelManifestEntry | null> {
    const raw = await databaseHandle.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    if (raw === null || decodedManifestVersion(raw) !== PAGED_MANIFEST_VERSION) {
      return parseModelManifest(raw).models.find(
        (entry) => entry.contentHash === contentHash,
      ) ?? null;
    }
    const root = parseModelManifestV2Root(raw);
    for (let index = 0; index < root.pages.length; index += 1) {
      const descriptor = root.pages[index]!;
      const pageRaw = await databaseHandle.kvGet(
        STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
        descriptor.key,
      );
      const model = parseModelManifestPage(
        pageRaw,
        descriptor,
        root.generation,
        index,
      ).find((entry) => entry.contentHash === contentHash);
      if (model) return model;
    }
    return null;
  }

  async function findTextureEntryByHash(
    databaseHandle: StudioLocalDatabase,
    contentHash: StudioVrmAssetHash,
  ): Promise<TextureManifestEntry | null> {
    const raw = await databaseHandle.kvGet(
      STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    if (raw === null || decodedManifestVersion(raw) !== PAGED_MANIFEST_VERSION) {
      return parseTextureManifest(raw).artifacts.find(
        (entry) => entry.contentHash === contentHash,
      ) ?? null;
    }
    const root = parseTextureManifestV2Root(raw);
    const pageIndex = root.pages.findIndex((page) => (
      compareManifestKeys(page.firstKey, contentHash) <= 0
      && compareManifestKeys(contentHash, page.lastKey) <= 0
    ));
    const descriptor = root.pages[pageIndex];
    if (pageIndex < 0 || !descriptor) return null;
    const pageRaw = await databaseHandle.kvGet(
      STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
      descriptor.key,
    );
    return parseTextureManifestPage(
      pageRaw,
      descriptor,
      root.generation,
      pageIndex,
    ).find((entry) => entry.contentHash === contentHash) ?? null;
  }

  async function committedBlob(
    descriptor: CasDescriptor,
    bytes: Uint8Array,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    throwIfAborted(signal);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== descriptor.byteLength) {
      fail("invalid", "VRM CAS byte length does not match its descriptor.");
    }
    let result: StudioOpfsPutResult;
    try {
      result = await assets().put(Uint8Array.from(bytes), {
        mime: descriptor.mimeType,
        codec: "identity",
      });
    } catch (cause) {
      storageFailure(cause, "blob write");
    }
    throwIfAborted(signal);
    if (result.ref.hash !== descriptor.hash || result.ref.bytes !== descriptor.byteLength) {
      fail("invalid", "VRM CAS SHA-256 does not match the expected content identity.");
    }
    let verified: Uint8Array | null;
    try {
      verified = await assets().get(descriptor.hash, { verify: true });
    } catch (cause) {
      storageFailure(cause, "blob write verification");
    }
    if (!verified || verified.byteLength !== descriptor.byteLength) {
      fail("corrupt", "VRM CAS blob could not be verified after write.");
    }
    const markerPath = commitPath(descriptor.hash);
    const existingMarker = await fs().read(markerPath);
    if (existingMarker) {
      parseCommit(existingMarker, descriptor);
    } else {
      const marker = JSON.stringify(canonicalCommit(descriptor, now()));
      await fs().write(markerPath, UTF8.encode(marker));
      const persistedMarker = await fs().read(markerPath);
      if (!persistedMarker) fail("corrupt", "VRM OPFS commit marker disappeared after write.");
      parseCommit(persistedMarker, descriptor);
    }
    return result.deduped;
  }

  async function readCommittedBlob(
    descriptor: CasDescriptor,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    throwIfAborted(signal);
    const marker = await fs().read(commitPath(descriptor.hash));
    if (!marker) fail("corrupt", "VRM OPFS commit marker is missing.");
    parseCommit(marker, descriptor);
    let bytes: Uint8Array | null;
    try {
      bytes = await assets().get(descriptor.hash, { verify: true });
    } catch (cause) {
      storageFailure(cause, "blob read verification");
    }
    throwIfAborted(signal);
    if (!bytes || bytes.byteLength !== descriptor.byteLength) {
      fail("corrupt", "VRM OPFS blob is missing, truncated, or hash-mismatched.");
    }
    return Uint8Array.from(bytes);
  }

  async function commitModelManifest(
    databaseHandle: StudioLocalDatabase,
    baselineRaw: string | null,
    previous: ModelManifestV1,
    next: ModelManifestV1,
    textures: TextureManifestV1,
  ): Promise<void> {
    const currentRaw = await databaseHandle.kvGet(
      STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    if (currentRaw !== baselineRaw) {
      fail("conflict", "VRM model manifest generation changed before commit.");
    }
    const canonical = canonicalModelManifest(next);
    const prepared = prepareModelManifestV2(canonical);
    const priorPageKeys = baselineRaw && decodedManifestVersion(baselineRaw) === PAGED_MANIFEST_VERSION
      ? parseModelManifestV2Root(baselineRaw).pages.map((page) => page.key)
      : [];
    try {
      for (const page of prepared.pages) {
        await databaseHandle.kvSet(
          STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
          page.descriptor.key,
          page.raw,
        );
      }
      await assets().setOwnerRefs(
        STUDIO_VRM_ASSET_CAS_OWNER,
        unionLiveHashes(previous, textures, canonical, textures),
      );
      await databaseHandle.kvSet(
        STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
        STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
        prepared.raw,
      );
    } catch (cause) {
      let persistedRoot: string | null;
      try {
        persistedRoot = await databaseHandle.kvGet(
          STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
          STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
        );
      } catch {
        // The root write may have reached durable storage even though both the write acknowledgement
        // and verification read failed. Preserve the pre-root union refs and every staged page; a
        // later reopen can then resolve the authoritative generation without data loss.
        throw cause;
      }
      if (persistedRoot !== prepared.raw) {
        if (persistedRoot === baselineRaw) {
          try {
            await assets().setOwnerRefs(
              STUDIO_VRM_ASSET_CAS_OWNER,
              uniqueLiveHashes(previous, textures),
            );
          } catch {
            // Preserve the original commit failure; a later bounded collector/retry repairs refs.
          }
          await Promise.all(prepared.pages.map((page) =>
            databaseHandle.kvDelete(
              STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
              page.descriptor.key,
            ).catch(() => undefined)));
        }
        throw cause;
      }
      // SQLite may report an I/O failure after the root became durable. The union owner refs are
      // already safe, so finish as the committed generation instead of inviting a duplicate retry.
    }
    // The root write resolved, or the failure path reread this exact candidate. From here the
    // mutation is durably authoritative. A diagnostic read/close/abort must not discard the
    // creation disposition needed by archive compensation.
    try {
      await assets().setOwnerRefs(
        STUDIO_VRM_ASSET_CAS_OWNER,
        uniqueLiveHashes(canonical, textures),
      );
    } catch {
      // The pre-root union still retains every old and new live blob. Exact ref compaction is a
      // recoverable leak-only optimization; close racing here cannot revoke the committed result.
    }
    await Promise.all(priorPageKeys
      .filter((key) => !prepared.pages.some((page) => page.descriptor.key === key))
      .map((key) => databaseHandle.kvDelete(
        STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
        key,
      ).catch(() => undefined)));
  }

  async function commitTextureManifest(
    databaseHandle: StudioLocalDatabase,
    baselineRaw: string | null,
    models: ModelManifestV1,
    previous: TextureManifestV1,
    next: TextureManifestV1,
  ): Promise<void> {
    const currentRaw = await databaseHandle.kvGet(
      STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
      STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
    );
    if (currentRaw !== baselineRaw) {
      fail("conflict", "VRM texture manifest generation changed before commit.");
    }
    const canonical = canonicalTextureManifest(next);
    const prepared = prepareTextureManifestV2(canonical);
    const priorPageKeys = baselineRaw && decodedManifestVersion(baselineRaw) === PAGED_MANIFEST_VERSION
      ? parseTextureManifestV2Root(baselineRaw).pages.map((page) => page.key)
      : [];
    try {
      for (const page of prepared.pages) {
        await databaseHandle.kvSet(
          STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
          page.descriptor.key,
          page.raw,
        );
      }
      await assets().setOwnerRefs(
        STUDIO_VRM_ASSET_CAS_OWNER,
        unionLiveHashes(models, previous, models, canonical),
      );
      await databaseHandle.kvSet(
        STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
        STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
        prepared.raw,
      );
    } catch (cause) {
      let persistedRoot: string | null;
      try {
        persistedRoot = await databaseHandle.kvGet(
          STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
          STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
        );
      } catch {
        // Ambiguous SQLite durability is not equivalent to a missing root. Keep union ownership and
        // staged pages intact so either durable outcome remains recoverable on the next open.
        throw cause;
      }
      if (persistedRoot !== prepared.raw) {
        if (persistedRoot === baselineRaw) {
          try {
            await assets().setOwnerRefs(
              STUDIO_VRM_ASSET_CAS_OWNER,
              uniqueLiveHashes(models, previous),
            );
          } catch {
            // Preserve the original commit failure; a later bounded collector/retry repairs refs.
          }
          await Promise.all(prepared.pages.map((page) =>
            databaseHandle.kvDelete(
              STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
              page.descriptor.key,
            ).catch(() => undefined)));
        }
        throw cause;
      }
      // Root authority won despite the surfaced SQLite failure; keep the safe union and finish.
    }
    // The root write resolved, or the failure path reread this exact candidate. Post-root reads are
    // diagnostic only; losing one must not turn a committed texture into a receipt-less failure.
    try {
      await assets().setOwnerRefs(
        STUDIO_VRM_ASSET_CAS_OWNER,
        uniqueLiveHashes(models, canonical),
      );
    } catch {
      // The pre-root union remains safe if close or exact post-root compaction races this cleanup.
    }
    await Promise.all(priorPageKeys
      .filter((key) => !prepared.pages.some((page) => page.descriptor.key === key))
      .map((key) => databaseHandle.kvDelete(
        STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
        key,
      ).catch(() => undefined)));
  }

  async function queued<T>(
    signal: AbortSignal | undefined,
    task: (databaseHandle: StudioLocalDatabase, generation: number) => Promise<T>,
  ): Promise<T> {
    throwIfAborted(signal);
    const generation = lifecycleGeneration;
    const databaseHandle = await database();
    return queueForDatabase(databaseHandle, async () => {
      ensureOpen(generation);
      throwIfAborted(signal);
      const result = await task(databaseHandle, generation);
      ensureOpen(generation);
      throwIfAborted(signal);
      return result;
    });
  }

  async function queuedMutation<T>(
    signal: AbortSignal | undefined,
    task: (databaseHandle: StudioLocalDatabase, generation: number) => Promise<T>,
  ): Promise<T> {
    throwIfAborted(signal);
    const generation = lifecycleGeneration;
    const databaseHandle = await database();
    return queueForDatabase(databaseHandle, async () => {
      ensureOpen(generation);
      throwIfAborted(signal);
      // Once a mutation task resolves it may have published a durable root. A close/cancel racing
      // afterward cannot revoke its exact disposition, which higher layers need for compensation.
      return task(databaseHandle, generation);
    });
  }

  async function readThumbnail(
    descriptor: CasDescriptor | null,
    signal: AbortSignal | undefined,
  ): Promise<StudioVrmThumbnailAsset | null> {
    if (!descriptor) return null;
    if (!SAFE_IMAGE_MIMES.has(descriptor.mimeType)) {
      fail("corrupt", "VRM thumbnail manifest MIME is invalid.");
    }
    return {
      bytes: await readCommittedBlob(descriptor, signal),
      mimeType: descriptor.mimeType as StudioVrmThumbnailAsset["mimeType"],
    };
  }

  return {
    authority: "sqlite-opfs",

    queryModelMetadataPage(options = {}) {
      return queued(options.signal, async (databaseHandle) => {
        const raw = await databaseHandle.kvGet(
          STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
          STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
        );
        if (raw === null || decodedManifestVersion(raw) !== PAGED_MANIFEST_VERSION) {
          const manifest = parseModelManifest(raw);
          if (manifest.models.length === 0) return null;
          const cursor = `manifest-v1-model-page-0-${manifestChecksum(raw ?? "")}`;
          if (options.cursor !== undefined && options.cursor !== null && options.cursor !== cursor) {
            return null;
          }
          return Object.freeze({
            items: Object.freeze(manifest.models.map(modelMetadata)),
            cursor: cursor as StudioVrmAssetPageCursor,
            nextCursor: null,
            totalCount: manifest.models.length,
            totalBytes: manifest.models.reduce((sum, entry) => sum + entry.byteSize, 0),
            generation: manifest.generation,
          });
        }
        const root = parseModelManifestV2Root(raw);
        if (root.pages.length === 0) return null;
        const pageIndex = options.cursor === undefined || options.cursor === null
          ? 0
          : root.pages.findIndex((page) => page.key === options.cursor);
        const descriptor = root.pages[pageIndex];
        if (pageIndex < 0 || !descriptor) return null;
        const pageRaw = await databaseHandle.kvGet(
          STUDIO_VRM_MODEL_SQLITE_NAMESPACE,
          descriptor.key,
        );
        const models = parseModelManifestPage(pageRaw, descriptor, root.generation, pageIndex);
        return Object.freeze({
          items: Object.freeze(models.map(modelMetadata)),
          cursor: descriptor.key as StudioVrmAssetPageCursor,
          nextCursor: (root.pages[pageIndex + 1]?.key ?? null) as StudioVrmAssetPageCursor | null,
          totalCount: root.totalModels,
          totalBytes: root.totalModelBytes,
          generation: root.generation,
        });
      });
    },

    listModelMetadata(signal) {
      return queued(signal, async (databaseHandle) => {
        const { models } = await readManifests(databaseHandle);
        return [...models.models]
          .sort((left, right) => (
            right.updatedAt - left.updatedAt || compareManifestKeys(left.id, right.id)
          ))
          .map(modelMetadata);
      });
    },

    getModel(id, signal) {
      return queued(signal, async (databaseHandle) => {
        if (!ID_PATTERN.test(id)) return null;
        const entry = (await findModelEntryById(databaseHandle, id)).model;
        if (!entry) return null;
        return {
          ...modelMetadata(entry),
          bytes: await readCommittedBlob(entry.blob, signal),
          thumbnail: await readThumbnail(entry.thumbnail, signal),
        };
      });
    },

    getModelByHash(value, signal) {
      return queued(signal, async (databaseHandle) => {
        const contentHash = hash(value.toLowerCase());
        if (!contentHash) return null;
        const entry = await findModelEntryByHash(databaseHandle, contentHash);
        if (!entry) return null;
        return {
          ...modelMetadata(entry),
          bytes: await readCommittedBlob(entry.blob, signal),
          thumbnail: await readThumbnail(entry.thumbnail, signal),
        };
      });
    },

    saveModel(input, signal) {
      return queuedMutation(signal, async (databaseHandle) => {
        const name = normalizeName(input.name);
        if (
          !ID_PATTERN.test(input.id)
          || !name
          || !hash(input.expectedHash)
          || !(input.bytes instanceof Uint8Array)
          || input.bytes.byteLength < 1
          || input.bytes.byteLength > STUDIO_VRM_MODEL_ASSET_LIMITS.maxModelBytes
          || !safeInteger(input.validationVersion, 1)
          || !validTimestamp(input.createdAt)
          || !validTimestamp(input.updatedAt)
          || input.updatedAt < input.createdAt
        ) fail("invalid", "VRM model asset input is invalid or noncanonical.");
        const state = await readManifests(databaseHandle);
        const nextGeneration = nextManifestGeneration(state.models.generation);
        const duplicate = state.models.models.find(
          (candidate) => candidate.contentHash === input.expectedHash,
        );
        if (duplicate) {
          await readCommittedBlob(duplicate.blob, signal);
          return { metadata: modelMetadata(duplicate), deduplicated: true };
        }
        const aggregate = state.models.models.reduce((sum, entry) => sum + entry.byteSize, 0);
        if (
          aggregate + input.bytes.byteLength
          > STUDIO_VRM_MODEL_ASSET_LIMITS.maxAggregateModelBytes
        ) fail("limit", "VRM model library reached its aggregate byte limit.");
        if (state.models.models.some((entry) => entry.id === input.id)) {
          fail("conflict", "VRM model id already exists with different content.");
        }
        const descriptor: CasDescriptor = {
          hash: input.expectedHash,
          byteLength: input.bytes.byteLength,
          mimeType: VRM_MIME,
        };
        await committedBlob(descriptor, input.bytes, signal);
        const entry: ModelManifestEntry = {
          id: input.id,
          name,
          contentHash: input.expectedHash,
          byteSize: input.bytes.byteLength,
          mimeType: VRM_MIME,
          validationVersion: input.validationVersion,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          blob: descriptor,
          thumbnail: null,
        };
        const next: ModelManifestV1 = {
          ...state.models,
          generation: nextGeneration,
          models: [...state.models.models, entry],
        };
        await commitModelManifest(
          databaseHandle,
          state.modelRaw,
          state.models,
          next,
          state.textures,
        );
        return { metadata: modelMetadata(entry), deduplicated: false };
      });
    },

    saveThumbnail(id, thumbnail, updatedAt, signal) {
      return queuedMutation(signal, async (databaseHandle) => {
        if (
          !ID_PATTERN.test(id)
          || !SAFE_IMAGE_MIMES.has(thumbnail.mimeType)
          || !(thumbnail.bytes instanceof Uint8Array)
          || thumbnail.bytes.byteLength < 1
          || thumbnail.bytes.byteLength > STUDIO_VRM_MODEL_ASSET_LIMITS.maxThumbnailBytes
          || !validTimestamp(updatedAt)
        ) fail("invalid", "VRM thumbnail input is invalid or exceeds its byte limit.");
        const state = await readManifests(databaseHandle);
        const nextGeneration = nextManifestGeneration(state.models.generation);
        const put = await assets().put(Uint8Array.from(thumbnail.bytes), {
          mime: thumbnail.mimeType,
          codec: "identity",
        });
        const descriptor: CasDescriptor = {
          hash: put.ref.hash,
          byteLength: thumbnail.bytes.byteLength,
          mimeType: thumbnail.mimeType,
        };
        await committedBlob(descriptor, thumbnail.bytes, signal);
        const modelIndex = state.models.models.findIndex((entry) => entry.id === id);
        let next: ModelManifestV1;
        if (modelIndex >= 0) {
          const models = [...state.models.models];
          const current = models[modelIndex]!;
          models[modelIndex] = {
            ...current,
            thumbnail: descriptor,
            updatedAt: Math.max(updatedAt, current.updatedAt),
          };
          next = {
            ...state.models,
            generation: nextGeneration,
            models,
          };
        } else {
          const filtered = state.models.sampleThumbnails.filter((entry) => entry.id !== id);
          if (
            filtered.length >= STUDIO_VRM_MODEL_ASSET_LIMITS.maxSampleThumbnails
          ) fail("limit", "VRM sample thumbnail library reached its entry limit.");
          next = {
            ...state.models,
            generation: nextGeneration,
            sampleThumbnails: [...filtered, { id, blob: descriptor, updatedAt }],
          };
        }
        await commitModelManifest(
          databaseHandle,
          state.modelRaw,
          state.models,
          next,
          state.textures,
        );
      });
    },

    getThumbnail(id, signal) {
      return queued(signal, async (databaseHandle) => {
        if (!ID_PATTERN.test(id)) return null;
        const lookup = await findModelEntryById(databaseHandle, id);
        const descriptor = lookup.model?.thumbnail
          ?? lookup.sampleThumbnail?.blob
          ?? null;
        return readThumbnail(descriptor, signal);
      });
    },

    deleteModel(id, signal) {
      return queuedMutation(signal, async (databaseHandle) => {
        if (!ID_PATTERN.test(id)) return false;
        const state = await readManifests(databaseHandle);
        const models = state.models.models.filter((entry) => entry.id !== id);
        const sampleThumbnails = state.models.sampleThumbnails
          .filter((entry) => entry.id !== id);
        if (
          models.length === state.models.models.length
          && sampleThumbnails.length === state.models.sampleThumbnails.length
        ) return false;
        const next: ModelManifestV1 = {
          ...state.models,
          generation: nextManifestGeneration(state.models.generation),
          models,
          sampleThumbnails,
        };
        await commitModelManifest(
          databaseHandle,
          state.modelRaw,
          state.models,
          next,
          state.textures,
        );
        return true;
      });
    },

    deleteModelIfIdentityMatches(id, value, signal) {
      return queuedMutation(signal, async (databaseHandle) => {
        const contentHash = hash(value.toLowerCase());
        if (!ID_PATTERN.test(id) || !contentHash) return false;
        const state = await readManifests(databaseHandle);
        const matching = state.models.models.find(
          (entry) => entry.id === id && entry.contentHash === contentHash,
        );
        if (!matching) return false;
        const next: ModelManifestV1 = {
          ...state.models,
          generation: nextManifestGeneration(state.models.generation),
          models: state.models.models.filter((entry) => entry.id !== id),
        };
        await commitModelManifest(
          databaseHandle,
          state.modelRaw,
          state.models,
          next,
          state.textures,
        );
        return true;
      });
    },

    saveTexture(input, signal) {
      return queuedMutation(signal, async (databaseHandle) => {
        const receipt = textureReceipt(input.receipt);
        const limits = resolveTextureLimits(input.limits);
        if (
          !receipt
          || !(input.bytes instanceof Uint8Array)
          || input.bytes.byteLength !== receipt.byteLength
          || input.bytes.byteLength > limits.maxArtifactBytes
        ) fail("invalid", "VRM texture-paint asset input is invalid or exceeds its byte limit.");
        const state = await readManifests(databaseHandle);
        const nextGeneration = nextManifestGeneration(state.textures.generation);
        const existingIndex = state.textures.artifacts.findIndex(
          (entry) => entry.contentHash === receipt.contentHash,
        );
        const aggregate = state.textures.artifacts.reduce(
          (sum, entry, index) => sum + (index === existingIndex ? 0 : entry.receipt.byteLength),
          0,
        );
        if (aggregate + receipt.byteLength > limits.maxAggregateBytes) {
          fail("limit", "VRM texture-paint library reached its aggregate byte limit.");
        }
        const descriptor: CasDescriptor = {
          hash: receipt.contentHash,
          byteLength: receipt.byteLength,
          mimeType: STUDIO_VRM_TEXTURE_PAINT_ARTIFACT_MIME,
        };
        const deduplicated = await committedBlob(descriptor, input.bytes, signal);
        const entry: TextureManifestEntry = {
          contentHash: receipt.contentHash,
          receipt,
          blob: descriptor,
        };
        const artifacts = [...state.textures.artifacts];
        if (existingIndex >= 0) artifacts[existingIndex] = entry;
        else artifacts.push(entry);
        const next: TextureManifestV1 = {
          ...state.textures,
          generation: nextGeneration,
          artifacts,
        };
        await commitTextureManifest(
          databaseHandle,
          state.textureRaw,
          state.models,
          state.textures,
          next,
        );
        return {
          receipt,
          deduplicated: existingIndex >= 0 || deduplicated,
          created: existingIndex < 0,
          generation: nextGeneration,
        };
      });
    },

    deleteTextureIfCreationMatches(value, generation, signal) {
      return this.deleteTexturesIfCreationBatchMatches(
        [{ contentHash: value, generation }],
        [generation],
        signal,
      );
    },

    deleteTexturesIfCreationBatchMatches(creations, mutationGenerations, signal) {
      return queuedMutation(signal, async (databaseHandle) => {
        if (creations.length < 1 || mutationGenerations.length < 1) return false;
        const normalized = creations.map((creation) => ({
          contentHash: hash(creation.contentHash.toLowerCase()),
          generation: creation.generation,
        }));
        if (
          normalized.some(({ contentHash, generation }) => !contentHash || !safeInteger(generation, 1))
          || new Set(normalized.map(({ contentHash }) => contentHash)).size !== normalized.length
          || mutationGenerations.some((generation) => !safeInteger(generation, 1))
          || mutationGenerations.some(
            (generation, index) => index > 0 && generation !== mutationGenerations[index - 1]! + 1,
          )
          || normalized.some(({ generation }) => !mutationGenerations.includes(generation))
        ) return false;
        const state = await readManifests(databaseHandle);
        if (state.textures.generation !== mutationGenerations.at(-1)) return false;
        const createdHashes = new Set(normalized.map(({ contentHash }) => contentHash!));
        if (
          normalized.some(({ contentHash }) =>
            !state.textures.artifacts.some((entry) => entry.contentHash === contentHash)
          )
        ) return false;
        const next: TextureManifestV1 = {
          ...state.textures,
          generation: nextManifestGeneration(state.textures.generation),
          artifacts: state.textures.artifacts.filter(
            (entry) => !createdHashes.has(entry.contentHash),
          ),
        };
        await commitTextureManifest(
          databaseHandle,
          state.textureRaw,
          state.models,
          state.textures,
          next,
        );
        return true;
      });
    },

    queryTextureMetadataPage(options = {}) {
      return queued(options.signal, async (databaseHandle) => {
        const raw = await databaseHandle.kvGet(
          STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
          STUDIO_VRM_ASSET_SQLITE_MANIFEST_KEY,
        );
        if (raw === null || decodedManifestVersion(raw) !== PAGED_MANIFEST_VERSION) {
          const manifest = parseTextureManifest(raw);
          if (manifest.artifacts.length === 0) return null;
          const cursor = `manifest-v1-texture-page-0-${manifestChecksum(raw ?? "")}`;
          if (options.cursor !== undefined && options.cursor !== null && options.cursor !== cursor) {
            return null;
          }
          return Object.freeze({
            items: Object.freeze(manifest.artifacts.map((entry) => entry.receipt)),
            cursor: cursor as StudioVrmAssetPageCursor,
            nextCursor: null,
            totalCount: manifest.artifacts.length,
            totalBytes: manifest.artifacts.reduce(
              (sum, entry) => sum + entry.receipt.byteLength,
              0,
            ),
            generation: manifest.generation,
          });
        }
        const root = parseTextureManifestV2Root(raw);
        if (root.pages.length === 0) return null;
        const pageIndex = options.cursor === undefined || options.cursor === null
          ? 0
          : root.pages.findIndex((page) => page.key === options.cursor);
        const descriptor = root.pages[pageIndex];
        if (pageIndex < 0 || !descriptor) return null;
        const pageRaw = await databaseHandle.kvGet(
          STUDIO_VRM_TEXTURE_SQLITE_NAMESPACE,
          descriptor.key,
        );
        const artifacts = parseTextureManifestPage(
          pageRaw,
          descriptor,
          root.generation,
          pageIndex,
        );
        return Object.freeze({
          items: Object.freeze(artifacts.map((entry) => entry.receipt)),
          cursor: descriptor.key as StudioVrmAssetPageCursor,
          nextCursor: (root.pages[pageIndex + 1]?.key ?? null) as StudioVrmAssetPageCursor | null,
          totalCount: root.totalArtifacts,
          totalBytes: root.totalArtifactBytes,
          generation: root.generation,
        });
      });
    },

    getTexture(value, signal) {
      return queued(signal, async (databaseHandle) => {
        const contentHash = hash(value.toLowerCase());
        if (!contentHash) return null;
        const entry = await findTextureEntryByHash(databaseHandle, contentHash);
        if (!entry) return null;
        return {
          receipt: entry.receipt,
          bytes: await readCommittedBlob(entry.blob, signal),
        };
      });
    },

    cleanupOrphans(cleanupOptions = {}) {
      const signal = cleanupOptions.signal;
      return queuedMutation(signal, async (databaseHandle) => {
        const maxRemovals = cleanupOptions.maxRemovals ?? 32;
        const graceMs = cleanupOptions.graceMs ?? orphanGraceMs;
        if (!safeInteger(maxRemovals, 1) || maxRemovals > 256 || !safeInteger(graceMs, 0)) {
          fail("invalid", "VRM orphan cleanup bounds are invalid.");
        }
        const { models, textures } = await readManifests(databaseHandle);
        const live = new Set(uniqueLiveHashes(models, textures));
        const indexed = new Map(
          (await assets().list()).map((entry) => [entry.hash, entry] as const),
        );
        const markerPaths = await fs().list("commits/");
        const blobPaths = await fs().list("blobs/");
        const candidateHashes = new Set<StudioVrmAssetHash>();
        for (const contentHash of indexed.keys()) {
          if (!live.has(contentHash)) candidateHashes.add(contentHash);
        }
        for (const path of markerPaths) {
          const match = COMMIT_PATH_PATTERN.exec(path);
          const contentHash = match ? hash(`sha256:${match[1]}`) : null;
          if (contentHash && !live.has(contentHash)) candidateHashes.add(contentHash);
        }
        for (const path of blobPaths) {
          const match = BLOB_PATH_PATTERN.exec(path);
          const contentHash = match ? hash(`sha256:${match[1]}`) : null;
          if (contentHash && !live.has(contentHash)) candidateHashes.add(contentHash);
        }

        let removedAssets = 0;
        let removedPaths = 0;
        let retainedInGrace = 0;
        const nextObserved = new Set<string>();
        for (const contentHash of [...candidateHashes].sort()) {
          if (removedAssets >= maxRemovals) break;
          throwIfAborted(signal);
          const markerPath = commitPath(contentHash);
          const markerBytes = await fs().read(markerPath);
          const oldEnough = (() => {
            if (!markerBytes) {
              return observedOrphans.has(contentHash) || graceMs === 0;
            }
            try {
              return now() - parseCommit(markerBytes).createdAt >= graceMs;
            } catch {
              return observedOrphans.has(contentHash) || graceMs === 0;
            }
          })();
          if (!oldEnough) {
            retainedInGrace += 1;
            nextObserved.add(contentHash);
            continue;
          }
          if (await assets().delete(contentHash)) removedPaths += 1;
          if (await fs().remove(markerPath)) removedPaths += 1;
          for (const path of blobPaths) {
            const match = BLOB_PATH_PATTERN.exec(path);
            if (match?.[1] === contentHash.slice("sha256:".length)) {
              if (await fs().remove(path)) removedPaths += 1;
            }
          }
          removedAssets += 1;
        }
        observedOrphans.clear();
        for (const contentHash of nextObserved) observedOrphans.add(contentHash);
        return {
          removedAssets,
          removedPaths,
          retainedInGrace,
          observedForNextPass: observedOrphans.size,
        };
      });
    },

    async close() {
      if (closed) return;
      closed = true;
      lifecycleGeneration += 1;
      assetStore = null;
      fileSystem = null;
      observedOrphans.clear();
    },
  };
}

let productRepository: StudioVrmAssetSqliteOpfsRepository | null = null;

export function getProductStudioVrmAssetSqliteOpfsRepository():
StudioVrmAssetSqliteOpfsRepository {
  productRepository ??= createStudioVrmAssetSqliteOpfsRepository();
  return productRepository;
}
