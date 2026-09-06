/**
 * V12 local authority for user-authored Studio assets.
 *
 * SQLite owns one strict canonical manifest. OPFS owns only content-addressed bytes. A mutation
 * writes and verifies every new blob, protects the union of old/new owner references, and commits
 * the manifest last. Owner contraction and sweep happen after that authority commit, so a crash can
 * leak a recoverable orphan but cannot publish a manifest that points at an unprotected blob.
 */

import {
  canonicalizeStudioAssetContentHash,
  createAssetRecord,
  decodeStudioAssetDataUrl,
  normalizeAssetName,
  STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH,
  STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_CANDIDATES,
  STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_BYTES,
  STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_CHARS,
  STUDIO_ASSET_DATA_URL_MAX_CHARS,
} from "./studio-asset-library";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import {
  createStudioOpfsAssetStore,
  type StudioOpfsAssetStore,
  type StudioOpfsContentHash,
  type StudioOpfsStorageEstimator,
} from "./studio-opfs-asset-store";
import {
  createStudioOpfsNativeFileSystem,
  type StudioOpfsStorageManagerLike,
} from "./studio-opfs-filesystem";

import type {
  StudioAsset,
  StudioAssetContentHash,
  StudioAssetContentIdentityCandidateMap,
  StudioAssetLibraryPort,
  StudioAssetRightsMetadata,
  StudioAssetSaveInput,
  StudioAssetWithContentHash,
} from "./studio-asset-library";
import type { StudioLocalDatabase } from "./studio-local-database";

export const STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE = "studio-asset-library-v12";
export const STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY = "manifest-v1";
export const STUDIO_ASSET_LIBRARY_CAS_OWNER = "studio-asset-library-v12";
export const STUDIO_ASSET_LIBRARY_CAS_ROOT = "toonspectrum-studio-assets";
export const STUDIO_ASSET_LIBRARY_LOCK_NAME = "toonspectrum-studio-asset-library-v12";

export const STUDIO_ASSET_LIBRARY_LIMITS = Object.freeze({
  assets: 1_000,
  individualBytes: 64 * 1024 * 1024,
  logicalBytes: 1024 * 1024 * 1024,
  manifestBytes: 8 * 1024 * 1024,
  idCodePoints: 160,
  nameCodePoints: 160,
  kindCodePoints: 80,
  rightsTextCodePoints: 2_000,
  queryLimit: 200,
  queryTextCodePoints: 160,
} as const);

const MANIFEST_VERSION = 1 as const;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const SOURCE_KINDS = new Set<StudioAssetRightsMetadata["sourceKind"]>([
  "local-upload",
  "ai-generated",
  "3d-generated",
  "imported",
  "unknown",
]);
const UTF8 = new TextEncoder();
const BASE64_CHUNK_BYTES = 24_576;

export type StudioAssetLibraryRepositoryErrorCode =
  | "invalid"
  | "corrupt"
  | "unavailable"
  | "quota-exceeded"
  | "not-found";

export class StudioAssetLibraryRepositoryError extends Error {
  readonly code: StudioAssetLibraryRepositoryErrorCode;

  constructor(
    code: StudioAssetLibraryRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioAssetLibraryRepositoryError";
    this.code = code;
  }
}

export function isStudioAssetLibraryMemoryFallbackError(
  error: unknown,
): error is StudioAssetLibraryRepositoryError {
  return error instanceof StudioAssetLibraryRepositoryError
    && (error.code === "unavailable" || error.code === "quota-exceeded");
}

export interface StudioAssetManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly contentHash: StudioAssetContentHash;
  readonly byteSize: number;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly createdAt: number;
  readonly kind: string | null;
  readonly rights: StudioAssetRightsMetadata;
}

export interface StudioAssetManifestV1 {
  readonly version: typeof MANIFEST_VERSION;
  readonly totalBytes: number;
  readonly entries: readonly StudioAssetManifestEntry[];
}

export interface StudioAssetQueryCursor {
  readonly createdAt: number;
  readonly id: string;
}

export interface StudioAssetQuery {
  readonly search?: string;
  readonly limit?: number;
  readonly after?: StudioAssetQueryCursor | null;
}

export interface StudioAssetQueryPage {
  readonly assets: readonly StudioAsset[];
  readonly hasMore: boolean;
  readonly nextCursor: StudioAssetQueryCursor | null;
  readonly totalCount: number;
}

export interface StudioAssetLibraryRepository extends StudioAssetLibraryPort {
  readonly authority: "sqlite-opfs";
  listReadOnly(): Promise<StudioAsset[]>;
  query(input?: StudioAssetQuery): Promise<StudioAssetQueryPage>;
  cleanupOrphans(): Promise<number>;
}

export type StudioAssetLibraryRunExclusive = <T>(task: () => Promise<T>) => Promise<T>;

export interface StudioAssetLibraryRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly acquireAssetStore?: () => Promise<StudioOpfsAssetStore>;
  readonly runExclusive?: StudioAssetLibraryRunExclusive | null;
  readonly now?: () => number;
  readonly createId?: () => string;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRepositoryError(
  error: unknown,
  operation: string,
): StudioAssetLibraryRepositoryError {
  if (error instanceof StudioAssetLibraryRepositoryError) return error;
  const detail = errorDetail(error);
  const errorCode = typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : null;
  if (errorCode === "QUOTA_EXCEEDED" || /quota|SQLITE_FULL|disk is full|space/i.test(detail)) {
    return new StudioAssetLibraryRepositoryError(
      "quota-exceeded",
      `SQLite/OPFS 에셋 ${operation} 중 저장 공간이 부족합니다.`,
      { cause: error },
    );
  }
  return new StudioAssetLibraryRepositoryError(
    "unavailable",
    `SQLite/OPFS 에셋 ${operation}를 완료하지 못했습니다: ${detail}`,
    { cause: error },
  );
}

function invalid(message: string): never {
  throw new StudioAssetLibraryRepositoryError("invalid", message);
}

function corrupt(message: string, cause?: unknown): never {
  throw new StudioAssetLibraryRepositoryError("corrupt", message, { cause });
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index]);
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function boundedCanonicalText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") invalid(`${label}은 문자열이어야 합니다.`);
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || [...normalized].length > maximum || containsControlCharacter(normalized)) {
    invalid(`${label}의 길이 또는 문자가 허용 범위를 벗어났습니다.`);
  }
  return normalized;
}

function nullableText(
  value: unknown,
  maximum: number,
  label: string,
  options: { readonly allowEmpty?: boolean } = {},
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid(`${label}은 문자열 또는 null이어야 합니다.`);
  const normalized = value.normalize("NFKC").trim();
  if ((!options.allowEmpty && !normalized) || [...normalized].length > maximum) {
    invalid(`${label}의 길이가 허용 범위를 벗어났습니다.`);
  }
  return normalized;
}

function defaultRights(kind: string | undefined): StudioAssetRightsMetadata {
  return {
    sourceKind: kind === "ai"
      ? "ai-generated"
      : kind?.startsWith("bg3d")
        ? "3d-generated"
        : "local-upload",
    sourceId: null,
    licenseId: "unknown",
    licenseLabel: "",
    licenseUrl: null,
    attributionRequired: null,
    attributionText: "",
    rightsConfirmed: false,
  };
}

function normalizeRights(
  value: unknown,
  kind?: string,
): StudioAssetRightsMetadata {
  if (value === undefined) return defaultRights(kind);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("에셋 권리 메타데이터가 올바르지 않습니다.");
  }
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, [
    "sourceKind",
    "sourceId",
    "licenseId",
    "licenseLabel",
    "licenseUrl",
    "attributionRequired",
    "attributionText",
    "rightsConfirmed",
  ])) invalid("에셋 권리 메타데이터에 알 수 없는 필드가 있습니다.");
  if (!SOURCE_KINDS.has(record.sourceKind as StudioAssetRightsMetadata["sourceKind"])) {
    invalid("에셋 권리 sourceKind가 올바르지 않습니다.");
  }
  const sourceId = nullableText(record.sourceId, 512, "권리 sourceId");
  const licenseId = boundedCanonicalText(record.licenseId, 128, "권리 licenseId");
  const licenseLabel = nullableText(
    record.licenseLabel,
    256,
    "권리 licenseLabel",
    { allowEmpty: true },
  ) ?? "";
  const licenseUrl = nullableText(record.licenseUrl, 2_048, "권리 licenseUrl");
  if (licenseUrl !== null) {
    try {
      if (new URL(licenseUrl).protocol !== "https:") invalid("권리 URL은 HTTPS여야 합니다.");
    } catch {
      invalid("권리 URL이 올바르지 않습니다.");
    }
  }
  const attributionRequired = record.attributionRequired;
  if (attributionRequired !== null && typeof attributionRequired !== "boolean") {
    invalid("attributionRequired는 boolean 또는 null이어야 합니다.");
  }
  const attributionText = nullableText(
    record.attributionText,
    STUDIO_ASSET_LIBRARY_LIMITS.rightsTextCodePoints,
    "권리 attributionText",
    { allowEmpty: true },
  ) ?? "";
  if (typeof record.rightsConfirmed !== "boolean") {
    invalid("rightsConfirmed는 boolean이어야 합니다.");
  }
  return {
    sourceKind: record.sourceKind as StudioAssetRightsMetadata["sourceKind"],
    sourceId,
    licenseId,
    licenseLabel,
    licenseUrl,
    attributionRequired,
    attributionText,
    rightsConfirmed: record.rightsConfirmed,
  };
}

function compareEntries(left: StudioAssetManifestEntry, right: StudioAssetManifestEntry): number {
  return right.createdAt - left.createdAt || left.id.localeCompare(right.id, "en");
}

function canonicalEntry(value: unknown): StudioAssetManifestEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("에셋 manifest entry가 객체가 아닙니다.");
  }
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, [
    "id",
    "name",
    "contentHash",
    "byteSize",
    "mimeType",
    "width",
    "height",
    "createdAt",
    "kind",
    "rights",
  ])) invalid("에셋 manifest entry 필드가 올바르지 않습니다.");
  if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)) {
    invalid("에셋 ID가 안전한 canonical 형식이 아닙니다.");
  }
  const name = boundedCanonicalText(
    record.name,
    STUDIO_ASSET_LIBRARY_LIMITS.nameCodePoints,
    "에셋 이름",
  );
  const contentHash = canonicalizeStudioAssetContentHash(record.contentHash);
  if (!contentHash || contentHash !== record.contentHash) invalid("에셋 contentHash가 올바르지 않습니다.");
  const byteSize = record.byteSize;
  if (!Number.isSafeInteger(byteSize) || (byteSize as number) < 1
    || (byteSize as number) > STUDIO_ASSET_LIBRARY_LIMITS.individualBytes) {
    invalid("에셋 byteSize가 허용 범위를 벗어났습니다.");
  }
  const mimeType = typeof record.mimeType === "string" ? record.mimeType : "";
  if (!MIME_PATTERN.test(mimeType) || mimeType !== mimeType.toLowerCase()) {
    invalid("에셋 MIME이 canonical 형식이 아닙니다.");
  }
  for (const dimension of [record.width, record.height]) {
    if (!Number.isSafeInteger(dimension) || (dimension as number) < 1 || (dimension as number) > 1_000_000) {
      invalid("에셋 크기가 허용 범위를 벗어났습니다.");
    }
  }
  if (!Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0) {
    invalid("에셋 createdAt이 올바르지 않습니다.");
  }
  const kind = record.kind === null
    ? null
    : boundedCanonicalText(
        record.kind,
        STUDIO_ASSET_LIBRARY_LIMITS.kindCodePoints,
        "에셋 kind",
      );
  return {
    id: record.id,
    name,
    contentHash,
    byteSize: byteSize as number,
    mimeType,
    width: record.width as number,
    height: record.height as number,
    createdAt: record.createdAt as number,
    kind,
    rights: normalizeRights(record.rights, kind ?? undefined),
  };
}

function buildManifest(entries: readonly StudioAssetManifestEntry[]): StudioAssetManifestV1 {
  if (entries.length > STUDIO_ASSET_LIBRARY_LIMITS.assets) {
    invalid(`에셋 보관함은 최대 ${STUDIO_ASSET_LIBRARY_LIMITS.assets}개까지 저장할 수 있습니다.`);
  }
  const ids = new Set<string>();
  const canonical = entries.map((entry) => canonicalEntry(entry)).sort(compareEntries);
  let totalBytes = 0;
  for (const entry of canonical) {
    if (ids.has(entry.id)) invalid(`중복 에셋 ID가 있습니다: ${entry.id}`);
    ids.add(entry.id);
    totalBytes += entry.byteSize;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > STUDIO_ASSET_LIBRARY_LIMITS.logicalBytes) {
      invalid("에셋 보관함의 총 원본 바이트가 1 GiB 상한을 넘었습니다.");
    }
  }
  return { version: MANIFEST_VERSION, totalBytes, entries: canonical };
}

export function serializeStudioAssetManifest(
  entries: readonly StudioAssetManifestEntry[],
): string {
  const serialized = JSON.stringify(buildManifest(entries));
  if (UTF8.encode(serialized).byteLength > STUDIO_ASSET_LIBRARY_LIMITS.manifestBytes) {
    invalid("에셋 SQLite manifest가 8 MiB 상한을 넘었습니다.");
  }
  return serialized;
}

export function parseStudioAssetManifest(raw: string | null): StudioAssetManifestV1 {
  if (raw === null) return buildManifest([]);
  if (UTF8.encode(raw).byteLength > STUDIO_ASSET_LIBRARY_LIMITS.manifestBytes) {
    corrupt("에셋 SQLite manifest가 크기 상한을 넘었습니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    corrupt("에셋 SQLite manifest JSON이 끊어졌거나 손상되었습니다.", error);
  }
  try {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      invalid("에셋 SQLite manifest가 객체가 아닙니다.");
    }
    const record = parsed as Record<string, unknown>;
    if (!exactKeys(record, ["version", "totalBytes", "entries"])
      || record.version !== MANIFEST_VERSION || !Array.isArray(record.entries)) {
      invalid("에셋 SQLite manifest 버전 또는 필드가 올바르지 않습니다.");
    }
    const manifest = buildManifest(record.entries);
    if (record.totalBytes !== manifest.totalBytes || JSON.stringify(manifest) !== raw) {
      invalid("에셋 SQLite manifest가 canonical 원장과 일치하지 않습니다.");
    }
    return manifest;
  } catch (error) {
    if (error instanceof StudioAssetLibraryRepositoryError && error.code === "corrupt") throw error;
    corrupt("에셋 SQLite manifest가 손상되었습니다.", error);
  }
}

function encodeDataUrl(bytes: Uint8Array, mimeType: string): string {
  let base64 = "";
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    let binary = "";
    for (let index = 0; index < chunk.byteLength; index += 1) {
      binary += String.fromCharCode(chunk[index]!);
    }
    base64 += globalThis.btoa(binary);
  }
  const dataUrl = `data:${mimeType};base64,${base64}`;
  if (dataUrl.length > STUDIO_ASSET_DATA_URL_MAX_CHARS) {
    corrupt("복원한 에셋 data URL이 제품 경계 상한을 넘었습니다.");
  }
  return dataUrl;
}

function entryToAsset(entry: StudioAssetManifestEntry, dataUrl: string): StudioAssetWithContentHash {
  return {
    id: entry.id,
    name: entry.name,
    dataUrl,
    contentHash: entry.contentHash,
    width: entry.width,
    height: entry.height,
    createdAt: entry.createdAt,
    ...(entry.kind ? { kind: entry.kind } : {}),
    rights: entry.rights,
  };
}

async function verifiedBytes(
  store: StudioOpfsAssetStore,
  entry: StudioAssetManifestEntry,
): Promise<Uint8Array> {
  let stat;
  let bytes;
  try {
    stat = await store.stat(entry.contentHash);
    bytes = await store.get(entry.contentHash, { verify: true });
  } catch (error) {
    corrupt(`에셋 CAS 검증에 실패했습니다: ${entry.id}`, error);
  }
  if (!stat || !bytes) corrupt(`에셋 CAS blob이 없습니다: ${entry.id}`);
  if (stat.hash !== entry.contentHash || stat.bytes !== entry.byteSize
    || stat.mime !== entry.mimeType || bytes.byteLength !== entry.byteSize) {
    corrupt(`에셋 CAS hash/size/MIME 원장이 일치하지 않습니다: ${entry.id}`);
  }
  return bytes;
}

async function hydrateEntry(
  store: StudioOpfsAssetStore,
  entry: StudioAssetManifestEntry,
): Promise<StudioAssetWithContentHash> {
  return entryToAsset(entry, encodeDataUrl(await verifiedBytes(store, entry), entry.mimeType));
}

function normalizeSearch(value: string | undefined): string {
  const normalized = (value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ko");
  if ([...normalized].length > STUDIO_ASSET_LIBRARY_LIMITS.queryTextCodePoints) {
    invalid("에셋 검색어가 너무 깁니다.");
  }
  return normalized;
}

function matchesSearch(entry: StudioAssetManifestEntry, search: string): boolean {
  if (!search) return true;
  return [
    entry.name,
    entry.kind ?? "",
    entry.mimeType,
    entry.rights.licenseId,
    entry.rights.licenseLabel,
    entry.rights.attributionText,
  ].some((value) => value.normalize("NFKC").toLocaleLowerCase("ko").includes(search));
}

function afterCursor(entry: StudioAssetManifestEntry, cursor: StudioAssetQueryCursor): boolean {
  return entry.createdAt < cursor.createdAt
    || (entry.createdAt === cursor.createdAt && entry.id.localeCompare(cursor.id, "en") > 0);
}

let productAssetStore: Promise<StudioOpfsAssetStore> | null = null;

export function acquireProductStudioAssetCasStore(): Promise<StudioOpfsAssetStore> {
  productAssetStore ??= Promise.resolve().then(() => {
    const storage = typeof navigator === "undefined" ? null : navigator.storage;
    if (!storage || typeof storage.getDirectory !== "function") {
      throw new StudioAssetLibraryRepositoryError(
        "unavailable",
        "OPFS를 사용할 수 없어 에셋 바이너리 보관함을 열 수 없습니다.",
      );
    }
    const manager = storage as unknown as StudioOpfsStorageManagerLike;
    const estimator = typeof storage.estimate === "function"
      ? storage as StudioOpfsStorageEstimator
      : null;
    return createStudioOpfsAssetStore({
      fs: createStudioOpfsNativeFileSystem(manager, STUDIO_ASSET_LIBRARY_CAS_ROOT),
      estimator,
    });
  });
  return productAssetStore;
}

interface BrowserLockManagerLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

function productRunExclusive(): StudioAssetLibraryRunExclusive | null {
  const locks = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & { locks?: BrowserLockManagerLike }).locks;
  if (!locks || typeof locks.request !== "function") return null;
  return <T>(task: () => Promise<T>) => locks.request(
    STUDIO_ASSET_LIBRARY_LOCK_NAME,
    { mode: "exclusive" },
    task,
  );
}

function uniqueHashes(entries: readonly StudioAssetManifestEntry[]): StudioOpfsContentHash[] {
  return [...new Set(entries.map(({ contentHash }) => contentHash as StudioOpfsContentHash))].sort();
}

export function createStudioAssetLibrarySqliteOpfsRepository(
  options: StudioAssetLibraryRepositoryOptions = {},
): StudioAssetLibraryRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const acquireAssetStore = options.acquireAssetStore ?? acquireProductStudioAssetCasStore;
  const injected = options.acquireDatabase !== undefined || options.acquireAssetStore !== undefined;
  const runExclusive = options.runExclusive === undefined
    ? injected
      ? (<T>(task: () => Promise<T>) => task())
      : productRunExclusive()
    : options.runExclusive;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(work, work);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function resources(): Promise<{
    readonly database: StudioLocalDatabase;
    readonly store: StudioOpfsAssetStore;
  }> {
    try {
      const [database, store] = await Promise.all([acquireDatabase(), acquireAssetStore()]);
      return { database, store };
    } catch (error) {
      throw asRepositoryError(error, "열기");
    }
  }

  async function readManifest(database: StudioLocalDatabase): Promise<StudioAssetManifestV1> {
    let raw: string | null;
    try {
      raw = await database.kvGet(
        STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
        STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
      );
    } catch (error) {
      throw asRepositoryError(error, "manifest 읽기");
    }
    return parseStudioAssetManifest(raw);
  }

  async function assertCasMetadata(
    store: StudioOpfsAssetStore,
    entries: readonly StudioAssetManifestEntry[],
  ): Promise<void> {
    for (const entry of entries) {
      let stat;
      try {
        stat = await store.stat(entry.contentHash);
      } catch (error) {
        corrupt(`에셋 CAS 색인을 읽지 못했습니다: ${entry.id}`, error);
      }
      if (!stat || stat.hash !== entry.contentHash || stat.bytes !== entry.byteSize
        || stat.mime !== entry.mimeType) {
        corrupt(`에셋 CAS manifest 원장이 일치하지 않습니다: ${entry.id}`);
      }
    }
  }

  async function commitManifest(
    database: StudioLocalDatabase,
    store: StudioOpfsAssetStore,
    current: StudioAssetManifestV1,
    nextEntries: readonly StudioAssetManifestEntry[],
  ): Promise<StudioAssetManifestV1> {
    const next = buildManifest(nextEntries);
    await assertCasMetadata(store, next.entries);
    const oldHashes = uniqueHashes(current.entries);
    const nextHashes = uniqueHashes(next.entries);
    const protectedHashes = [...new Set([...oldHashes, ...nextHashes])].sort();
    const oldSerialized = serializeStudioAssetManifest(current.entries);
    const nextSerialized = serializeStudioAssetManifest(next.entries);
    try {
      await store.setOwnerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER, protectedHashes);
      await database.kvSet(
        STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
        STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
        nextSerialized,
      );
    } catch (error) {
      // SQLite statement errors are not guaranteed to keep their typed Worker transport wrapper.
      // Reconcile every publication error against the exact durable old/candidate bytes.
      let observed: string | null;
      try {
        observed = await database.kvGet(
          STUDIO_ASSET_LIBRARY_SQLITE_NAMESPACE,
          STUDIO_ASSET_LIBRARY_SQLITE_MANIFEST_KEY,
        );
      } catch (reconcileCause) {
        throw new AggregateError(
          [error, reconcileCause],
          "SQLite/OPFS 에셋 manifest 커밋 결과를 재확인하지 못했습니다. old/candidate CAS union은 보존됩니다.",
          { cause: reconcileCause },
        );
      }
      // A missing manifest is the exact durable representation of the initial empty ledger.
      const observedOld = observed === oldSerialized
        || (observed === null && current.entries.length === 0);
      if (observed === nextSerialized) {
        // The mutation committed; return the candidate so callers receive and can compensate its
        // exact creation identity instead of losing the receipt with the response channel.
      } else if (observedOld) {
        try {
          await store.setOwnerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER, oldHashes);
        } catch (rollbackCause) {
          throw new AggregateError(
            [error, rollbackCause],
            "SQLite/OPFS 에셋 manifest 미커밋 확인 뒤 owner 참조를 되돌리지 못했습니다.",
            { cause: rollbackCause },
          );
        }
        throw asRepositoryError(error, "manifest 커밋");
      } else {
        throw new StudioAssetLibraryRepositoryError(
          "unavailable",
          "SQLite/OPFS 에셋 manifest가 old/candidate 어느 쪽과도 일치하지 않아 CAS union을 보존한 채 중단했습니다.",
          { cause: error },
        );
      }
    }
    // Manifest is now authoritative. Cleanup is recoverable bookkeeping and cannot roll it back.
    await store.setOwnerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER, nextHashes).catch(() => []);
    await store.sweep().catch(() => undefined);
    return next;
  }

  async function reconcileOwnerAndSweep(
    store: StudioOpfsAssetStore,
    manifest: StudioAssetManifestV1,
  ): Promise<number> {
    await store.setOwnerRefs(STUDIO_ASSET_LIBRARY_CAS_OWNER, uniqueHashes(manifest.entries));
    const swept = await store.sweep();
    return swept.removed.length;
  }

  async function mutation<T>(work: (
    database: StudioLocalDatabase,
    store: StudioOpfsAssetStore,
  ) => Promise<T>): Promise<T> {
    if (!runExclusive) {
      throw new StudioAssetLibraryRepositoryError(
        "unavailable",
        "Web Locks가 없어 여러 탭의 SQLite/OPFS 에셋 쓰기를 안전하게 직렬화할 수 없습니다.",
      );
    }
    return runExclusive(async () => {
      const { database, store } = await resources();
      return work(database, store);
    });
  }

  async function listHydrated(
    store: StudioOpfsAssetStore,
    entries: readonly StudioAssetManifestEntry[],
    signal?: AbortSignal,
  ): Promise<StudioAsset[]> {
    const assets: StudioAsset[] = [];
    for (const entry of entries) {
      if (signal?.aborted) break;
      assets.push(await hydrateEntry(store, entry));
    }
    return assets;
  }

  return {
    authority: "sqlite-opfs",

    save(input: StudioAssetSaveInput) {
      return enqueue(() => mutation(async (database, store) => {
        let decoded;
        try {
          decoded = decodeStudioAssetDataUrl(input.dataUrl);
        } catch (error) {
          throw new StudioAssetLibraryRepositoryError(
            "invalid",
            `에셋 바이트를 해석하지 못했습니다: ${errorDetail(error)}`,
            { cause: error },
          );
        }
        if (decoded.bytes.byteLength < 1
          || decoded.bytes.byteLength > STUDIO_ASSET_LIBRARY_LIMITS.individualBytes) {
          invalid("에셋 원본 바이트가 1 B~64 MiB 범위를 벗어났습니다.");
        }
        const id = createId();
        const record = createAssetRecord(input, id, now());
        const name = boundedCanonicalText(
          normalizeAssetName(record.name),
          STUDIO_ASSET_LIBRARY_LIMITS.nameCodePoints,
          "에셋 이름",
        );
        const kind = record.kind === undefined
          ? null
          : boundedCanonicalText(
              record.kind,
              STUDIO_ASSET_LIBRARY_LIMITS.kindCodePoints,
              "에셋 kind",
            );
        if (!ID_PATTERN.test(record.id)) invalid("생성된 에셋 ID가 안전한 형식이 아닙니다.");
        const current = await readManifest(database);
        if (current.entries.some(({ id: currentId }) => currentId === record.id)) {
          invalid("생성된 에셋 ID가 기존 행과 충돌했습니다.");
        }
        let put;
        try {
          put = await store.put(decoded.bytes, { mime: decoded.mimeType });
        } catch (error) {
          throw asRepositoryError(error, "blob 저장");
        }
        const expectedHash = canonicalizeStudioAssetContentHash(input.contentHash);
        if (input.contentHash !== undefined && (!expectedHash || expectedHash !== put.ref.hash)) {
          invalid("제공된 contentHash가 실제 에셋 바이트 SHA-256과 일치하지 않습니다.");
        }
        if (put.ref.bytes !== decoded.bytes.byteLength || put.ref.mime !== decoded.mimeType
          || put.entry.hash !== put.ref.hash || put.entry.bytes !== decoded.bytes.byteLength
          || put.entry.mime !== decoded.mimeType) {
          corrupt("OPFS CAS 저장 영수증의 hash/size/MIME이 입력과 일치하지 않습니다.");
        }
        const entry = canonicalEntry({
          id: record.id,
          name,
          contentHash: put.ref.hash,
          byteSize: decoded.bytes.byteLength,
          mimeType: decoded.mimeType,
          width: record.width,
          height: record.height,
          createdAt: record.createdAt,
          kind,
          rights: normalizeRights(input.rights, kind ?? undefined),
        });
        await verifiedBytes(store, entry);
        const next = await commitManifest(database, store, current, [
          entry,
          ...current.entries,
        ]);
        const committed = next.entries.find(({ id: currentId }) => currentId === entry.id);
        if (!committed) corrupt("커밋된 manifest에서 신규 에셋을 찾지 못했습니다.");
        return entryToAsset(committed, input.dataUrl);
      }));
    },

    async list() {
      await mutationTail;
      const { database, store } = await resources();
      const manifest = await readManifest(database);
      const assets = await listHydrated(store, manifest.entries);
      await reconcileOwnerAndSweep(store, manifest).catch(() => undefined);
      return assets;
    },

    async listReadOnly() {
      await mutationTail;
      const { database, store } = await resources();
      const manifest = await readManifest(database);
      return listHydrated(store, manifest.entries);
    },

    async query(input = {}) {
      await mutationTail;
      const limit = input.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > STUDIO_ASSET_LIBRARY_LIMITS.queryLimit) {
        invalid(`에셋 page limit은 1~${STUDIO_ASSET_LIBRARY_LIMITS.queryLimit}이어야 합니다.`);
      }
      if (input.after && (!Number.isSafeInteger(input.after.createdAt)
        || input.after.createdAt < 0 || !ID_PATTERN.test(input.after.id))) {
        invalid("에셋 pagination cursor가 올바르지 않습니다.");
      }
      const search = normalizeSearch(input.search);
      const { database, store } = await resources();
      const manifest = await readManifest(database);
      const matched = manifest.entries.filter((entry) => matchesSearch(entry, search));
      const eligible = input.after
        ? matched.filter((entry) => afterCursor(entry, input.after!))
        : matched;
      const pageEntries = eligible.slice(0, limit);
      const assets = await listHydrated(store, pageEntries);
      const last = pageEntries.at(-1);
      return {
        assets,
        hasMore: eligible.length > pageEntries.length,
        nextCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
        totalCount: matched.length,
      };
    },

    async findByContentIdentities(lookups, signal) {
      if (signal?.aborted) return new Map();
      await mutationTail;
      const requested = new Map<StudioAssetContentHash, string[]>();
      for (const lookup of lookups.slice(0, 32)) {
        if (lookup.signal?.aborted) continue;
        const hash = canonicalizeStudioAssetContentHash(lookup.contentHash);
        if (!hash) continue;
        const ids = requested.get(hash) ?? [];
        if (typeof lookup.assetId === "string" && ID_PATTERN.test(lookup.assetId)
          && !ids.includes(lookup.assetId)) ids.push(lookup.assetId);
        requested.set(hash, ids);
      }
      if (requested.size === 0) return new Map();
      const { database, store } = await resources();
      const manifest = await readManifest(database);
      const result = new Map<StudioAssetContentHash, readonly StudioAsset[]>();
      let remainingCandidates = STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_CANDIDATES;
      let remainingChars = STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_CHARS;
      let remainingBytes = STUDIO_ASSET_CONTENT_IDENTITY_MAX_RETURN_DATA_URL_BYTES;
      for (const [hash, ids] of requested) {
        if (signal?.aborted) return new Map();
        const seen = new Set<string>();
        const entries = [
          ...manifest.entries.filter(({ contentHash }) => contentHash === hash),
          ...ids.flatMap((id) => manifest.entries.filter((entry) => entry.id === id)),
        ].filter((entry) => {
          if (seen.has(entry.id)) return false;
          seen.add(entry.id);
          return true;
        }).slice(0, STUDIO_ASSET_CONTENT_IDENTITY_MAX_CANDIDATES_PER_HASH);
        const candidates: StudioAsset[] = [];
        for (const entry of entries) {
          if (remainingCandidates <= 0 || signal?.aborted) break;
          const asset = await hydrateEntry(store, entry);
          const byteLength = UTF8.encode(asset.dataUrl).byteLength;
          if (asset.dataUrl.length > remainingChars || byteLength > remainingBytes) continue;
          candidates.push(asset);
          remainingCandidates -= 1;
          remainingChars -= asset.dataUrl.length;
          remainingBytes -= byteLength;
        }
        result.set(hash, candidates);
      }
      return result as StudioAssetContentIdentityCandidateMap;
    },

    delete(id: string) {
      return enqueue(() => mutation(async (database, store) => {
        if (!ID_PATTERN.test(id)) invalid("삭제할 에셋 ID가 올바르지 않습니다.");
        const current = await readManifest(database);
        if (!current.entries.some((entry) => entry.id === id)) return;
        await commitManifest(
          database,
          store,
          current,
          current.entries.filter((entry) => entry.id !== id),
        );
      }));
    },

    deleteIfIdentityMatches(id: string, value: StudioAssetContentHash) {
      return enqueue(() => mutation(async (database, store) => {
        const contentHash = canonicalizeStudioAssetContentHash(value);
        if (!ID_PATTERN.test(id) || !contentHash) return false;
        const current = await readManifest(database);
        const matching = current.entries.find(
          (entry) => entry.id === id && entry.contentHash === contentHash,
        );
        if (!matching) return false;
        await commitManifest(
          database,
          store,
          current,
          current.entries.filter((entry) => entry.id !== id),
        );
        return true;
      }));
    },

    rename(id: string, newName: string) {
      return enqueue(() => mutation(async (database, store) => {
        if (!ID_PATTERN.test(id)) invalid("이름을 바꿀 에셋 ID가 올바르지 않습니다.");
        const name = boundedCanonicalText(
          normalizeAssetName(newName),
          STUDIO_ASSET_LIBRARY_LIMITS.nameCodePoints,
          "에셋 이름",
        );
        const current = await readManifest(database);
        if (!current.entries.some((entry) => entry.id === id)) {
          throw new StudioAssetLibraryRepositoryError("not-found", "에셋을 찾을 수 없습니다.");
        }
        await commitManifest(
          database,
          store,
          current,
          current.entries.map((entry) => entry.id === id ? { ...entry, name } : entry),
        );
      }));
    },

    cleanupOrphans() {
      return enqueue(() => mutation(async (database, store) => {
        const manifest = await readManifest(database);
        await assertCasMetadata(store, manifest.entries);
        return reconcileOwnerAndSweep(store, manifest);
      }));
    },
  };
}

let productRepository: StudioAssetLibraryRepository | null = null;

export function getProductStudioAssetLibraryRepository(): StudioAssetLibraryRepository {
  productRepository ??= createStudioAssetLibrarySqliteOpfsRepository();
  return productRepository;
}
