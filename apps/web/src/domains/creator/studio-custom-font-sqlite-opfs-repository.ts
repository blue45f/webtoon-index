/**
 * Durable custom-font authority for the shipped /studio surface.
 *
 * SQLite stores one strict canonical metadata manifest. The shared OPFS asset store owns the
 * original font bytes under their SHA-256 content address. A write verifies the CAS payload,
 * protects old+new owner references, and only then commits the manifest. Thus a crash may leave a
 * reclaimable orphan, but can never publish metadata that points at an unprotected blob.
 */

import { acquireProductStudioAssetCasStore } from "./studio-asset-library-sqlite-opfs-repository";
import {
  deriveCustomFontFamily,
  MAX_CUSTOM_FONT_FILE_BYTES,
  MAX_CUSTOM_FONT_TOTAL_BYTES,
  normalizeStudioCustomFontFamily,
  sniffStudioFontFormat,
  studioCustomFontMime,
  type StudioCustomFont,
  type StudioCustomFontFormat,
} from "./studio-custom-fonts";
import { isStudioLocalDatabaseCommitOutcomeUnknownError } from "./studio-local-database-commit-outcome";
import { acquireStudioLocalDatabase } from "./studio-local-database-runtime";
import { sha256HexPortable } from "./studio-sha256";

import type { StudioLocalDatabase } from "./studio-local-database";
import type { StudioOpfsAssetStore } from "./studio-opfs-asset-store";

export const STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE = "studio-custom-font-library-v12";
export const STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY = "manifest-v1";
export const STUDIO_CUSTOM_FONT_CAS_OWNER = "studio-custom-font-library-v12";
export const STUDIO_CUSTOM_FONT_LOCK_NAME = "toonspectrum-studio-custom-font-library-v12";

export const STUDIO_CUSTOM_FONT_LIMITS = Object.freeze({
  individualBytes: MAX_CUSTOM_FONT_FILE_BYTES,
  logicalBytes: MAX_CUSTOM_FONT_TOTAL_BYTES,
  manifestBytes: 2 * 1024 * 1024,
  idCodePoints: 160,
  familyCodePoints: 64,
  fileNameCodePoints: 512,
} as const);

export const STUDIO_CUSTOM_FONT_DEFAULT_PAGE_SIZE = 32;
export const STUDIO_CUSTOM_FONT_MAX_PAGE_SIZE = 64;
export const STUDIO_CUSTOM_FONT_MAX_PAGE_HYDRATED_BYTES = MAX_CUSTOM_FONT_FILE_BYTES;
export const STUDIO_CUSTOM_FONT_MAX_COMPATIBILITY_ENTRIES = 256;
export const STUDIO_CUSTOM_FONT_MAX_COMPATIBILITY_HYDRATED_BYTES = 256 * 1024 * 1024;

const MANIFEST_VERSION = 1 as const;
const UTF8 = new TextEncoder();
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const FORMATS = new Set<StudioCustomFontFormat>(["ttf", "otf", "ttc", "woff", "woff2"]);

export type StudioCustomFontRepositoryErrorCode =
  | "invalid"
  | "corrupt"
  | "unavailable"
  | "quota-exceeded"
  | "not-found"
  | "invalid-cursor"
  | "invalid-page-size"
  | "aborted"
  | "backpressure";

export class StudioCustomFontRepositoryError extends Error {
  readonly code: StudioCustomFontRepositoryErrorCode;

  constructor(
    code: StudioCustomFontRepositoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioCustomFontRepositoryError";
    this.code = code;
  }
}

export function isStudioCustomFontMemoryFallbackError(
  error: unknown,
): error is StudioCustomFontRepositoryError {
  return error instanceof StudioCustomFontRepositoryError
    && (error.code === "unavailable" || error.code === "quota-exceeded");
}

export interface StudioCustomFontManifestEntry {
  readonly id: string;
  readonly family: string;
  readonly fileName: string;
  readonly format: StudioCustomFontFormat;
  readonly mimeType: string;
  readonly contentHash: `sha256:${string}`;
  readonly byteLength: number;
  readonly createdAt: number;
}

export interface StudioCustomFontManifestV1 {
  readonly version: typeof MANIFEST_VERSION;
  readonly totalBytes: number;
  readonly entries: readonly StudioCustomFontManifestEntry[];
}

export interface StudioCustomFontWithContentHash extends StudioCustomFont {
  readonly contentHash: `sha256:${string}`;
  readonly format: StudioCustomFontFormat;
  readonly createdAt: number;
  readonly verifiedBytes: Uint8Array;
  readonly dataUrl?: undefined;
}

export interface StudioCustomFontSaveInput {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly id?: string;
  readonly contentHash?: string;
}

export interface StudioCustomFontPageRequest {
  readonly pageSize: number;
  readonly cursor?: string | null;
  readonly maxHydratedBytes?: number;
  readonly signal?: AbortSignal;
}

export interface StudioCustomFontPage {
  readonly fonts: readonly StudioCustomFontWithContentHash[];
  readonly nextCursor: string | null;
  readonly totalEntries: number;
  readonly totalBytes: number;
  readonly hydratedBytes: number;
}

export interface StudioCustomFontMaterializationRequest {
  readonly maxEntries: number;
  readonly maxHydratedBytes: number;
  readonly pageSize?: number;
  readonly signal?: AbortSignal;
}

export interface StudioCustomFontMaterializationReceipt {
  readonly fonts: readonly StudioCustomFontWithContentHash[];
  readonly truncated: boolean;
  readonly nextCursor: string | null;
  readonly totalEntries: number;
  readonly totalBytes: number;
  readonly hydratedBytes: number;
}

export interface StudioCustomFontRepository {
  readonly authority: "sqlite-opfs";
  page(request: StudioCustomFontPageRequest): Promise<StudioCustomFontPage>;
  materialize(
    request: StudioCustomFontMaterializationRequest,
  ): Promise<StudioCustomFontMaterializationReceipt>;
  save(input: StudioCustomFontSaveInput): Promise<StudioCustomFontWithContentHash>;
  delete(id: string): Promise<void>;
  cleanupOrphans(): Promise<number>;
}

export type StudioCustomFontRunExclusive = <T>(task: () => Promise<T>) => Promise<T>;

export interface StudioCustomFontRepositoryOptions {
  readonly acquireDatabase?: () => Promise<StudioLocalDatabase>;
  readonly acquireAssetStore?: () => Promise<StudioOpfsAssetStore>;
  readonly runExclusive?: StudioCustomFontRunExclusive | null;
  readonly now?: () => number;
  readonly createId?: () => string;
}

function fail(
  code: StudioCustomFontRepositoryErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new StudioCustomFontRepositoryError(code, message, cause === undefined ? undefined : { cause });
}

function invalid(message: string): never {
  fail("invalid", message);
}

function corrupt(message: string, cause?: unknown): never {
  fail("corrupt", message, cause);
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repositoryError(error: unknown, operation: string): StudioCustomFontRepositoryError {
  if (error instanceof StudioCustomFontRepositoryError) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { readonly code?: unknown }).code
    : null;
  const message = detail(error);
  if (code === "INTEGRITY_FAILED" || code === "CORRUPT_ENTRY") {
    return new StudioCustomFontRepositoryError(
      "corrupt",
      `사용자 글꼴 ${operation} 중 OPFS 무결성 검증에 실패했습니다.`,
      { cause: error },
    );
  }
  if (code === "QUOTA_EXCEEDED" || /quota|SQLITE_FULL|disk is full|space/i.test(message)) {
    return new StudioCustomFontRepositoryError(
      "quota-exceeded",
      `사용자 글꼴 ${operation} 중 기기 저장 공간이 부족합니다.`,
      { cause: error },
    );
  }
  return new StudioCustomFontRepositoryError(
    "unavailable",
    `사용자 글꼴 SQLite/OPFS ${operation}를 완료하지 못했습니다: ${message}`,
    { cause: error },
  );
}

function codePointLength(value: string): number {
  return [...value].length;
}

function exactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function canonicalFileName(value: string): string {
  const leaf = String(value ?? "").split(/[\\/]/u).pop() ?? "";
  let printable = "";
  for (const character of leaf.normalize("NFC")) {
    const code = character.codePointAt(0) ?? 0;
    printable += code < 0x20 || code === 0x7f ? " " : character;
  }
  const cleaned = printable
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) invalid("글꼴 원본 파일명이 비어 있습니다.");
  if (codePointLength(cleaned) > STUDIO_CUSTOM_FONT_LIMITS.fileNameCodePoints) {
    invalid(`글꼴 원본 파일명은 ${STUDIO_CUSTOM_FONT_LIMITS.fileNameCodePoints}자 이하여야 합니다.`);
  }
  return cleaned;
}

function canonicalId(value: string): string {
  if (!ID_PATTERN.test(value)) invalid("사용자 글꼴 ID가 canonical 안전 형식이 아닙니다.");
  return value;
}

function canonicalHash(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    invalid("사용자 글꼴 contentHash가 canonical SHA-256이 아닙니다.");
  }
  return value as `sha256:${string}`;
}

function canonicalEntry(value: unknown): StudioCustomFontManifestEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("사용자 글꼴 manifest entry가 객체가 아닙니다.");
  }
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, [
    "id",
    "family",
    "fileName",
    "format",
    "mimeType",
    "contentHash",
    "byteLength",
    "createdAt",
  ])) {
    invalid("사용자 글꼴 manifest entry에 누락되거나 알 수 없는 필드가 있습니다.");
  }
  if (typeof record.id !== "string") invalid("사용자 글꼴 ID가 문자열이 아닙니다.");
  if (typeof record.family !== "string") invalid("사용자 글꼴 family가 문자열이 아닙니다.");
  if (typeof record.fileName !== "string") invalid("사용자 글꼴 파일명이 문자열이 아닙니다.");
  if (typeof record.format !== "string" || !FORMATS.has(record.format as StudioCustomFontFormat)) {
    invalid("사용자 글꼴 포맷이 지원 목록에 없습니다.");
  }
  const format = record.format as StudioCustomFontFormat;
  const family = normalizeStudioCustomFontFamily(record.family);
  if (!family || family !== record.family
    || codePointLength(family) > STUDIO_CUSTOM_FONT_LIMITS.familyCodePoints) {
    invalid("사용자 글꼴 family가 canonical CSS 안전 형식이 아닙니다.");
  }
  const fileName = canonicalFileName(record.fileName);
  if (fileName !== record.fileName) invalid("사용자 글꼴 파일명이 canonical 형식이 아닙니다.");
  if (record.mimeType !== studioCustomFontMime(format)) {
    invalid("사용자 글꼴 MIME과 포맷이 일치하지 않습니다.");
  }
  if (!Number.isSafeInteger(record.byteLength)
    || (record.byteLength as number) < 1
    || (record.byteLength as number) > STUDIO_CUSTOM_FONT_LIMITS.individualBytes) {
    invalid("사용자 글꼴 바이트 크기가 허용 범위를 벗어났습니다.");
  }
  if (!Number.isSafeInteger(record.createdAt) || (record.createdAt as number) < 0) {
    invalid("사용자 글꼴 생성 시각이 올바르지 않습니다.");
  }
  return {
    id: canonicalId(record.id),
    family,
    fileName,
    format,
    mimeType: studioCustomFontMime(format),
    contentHash: canonicalHash(record.contentHash),
    byteLength: record.byteLength as number,
    createdAt: record.createdAt as number,
  };
}

function buildManifest(
  values: readonly StudioCustomFontManifestEntry[],
): StudioCustomFontManifestV1 {
  const entries = values.map(canonicalEntry).sort((left, right) =>
    left.createdAt - right.createdAt || left.id.localeCompare(right.id, "en"));
  const ids = new Set<string>();
  const families = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    if (ids.has(entry.id)) invalid(`중복 사용자 글꼴 ID입니다: ${entry.id}`);
    if (families.has(entry.family)) invalid(`중복 사용자 글꼴 family입니다: ${entry.family}`);
    ids.add(entry.id);
    families.add(entry.family);
    totalBytes += entry.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > STUDIO_CUSTOM_FONT_LIMITS.logicalBytes) {
      invalid("사용자 글꼴 라이브러리가 2 GiB 논리 상한을 넘었습니다.");
    }
  }
  return { version: MANIFEST_VERSION, totalBytes, entries };
}

export function serializeStudioCustomFontManifest(
  entries: readonly StudioCustomFontManifestEntry[],
): string {
  const serialized = JSON.stringify(buildManifest(entries));
  if (UTF8.encode(serialized).byteLength > STUDIO_CUSTOM_FONT_LIMITS.manifestBytes) {
    invalid("사용자 글꼴 SQLite manifest가 2 MiB 상한을 넘었습니다.");
  }
  return serialized;
}

export function parseStudioCustomFontManifest(raw: string | null): StudioCustomFontManifestV1 {
  if (raw === null) return buildManifest([]);
  if (UTF8.encode(raw).byteLength > STUDIO_CUSTOM_FONT_LIMITS.manifestBytes) {
    corrupt("사용자 글꼴 SQLite manifest가 크기 상한을 넘었습니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    corrupt("사용자 글꼴 SQLite manifest JSON이 끊어졌거나 손상되었습니다.", error);
  }
  try {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      invalid("사용자 글꼴 manifest가 객체가 아닙니다.");
    }
    const record = parsed as Record<string, unknown>;
    if (!exactKeys(record, ["version", "totalBytes", "entries"])
      || record.version !== MANIFEST_VERSION || !Array.isArray(record.entries)) {
      invalid("사용자 글꼴 manifest 버전 또는 필드가 올바르지 않습니다.");
    }
    const manifest = buildManifest(record.entries as StudioCustomFontManifestEntry[]);
    if (record.totalBytes !== manifest.totalBytes || JSON.stringify(manifest) !== raw) {
      invalid("사용자 글꼴 manifest가 canonical 원장과 일치하지 않습니다.");
    }
    return manifest;
  } catch (error) {
    if (error instanceof StudioCustomFontRepositoryError && error.code === "corrupt") throw error;
    corrupt("사용자 글꼴 SQLite manifest가 손상되었습니다.", error);
  }
}

const PAGE_CURSOR_PREFIX = "studio-custom-font-page-v1:";

function manifestDigest(manifest: StudioCustomFontManifestV1): string {
  return sha256HexPortable(UTF8.encode(JSON.stringify(manifest)));
}

function encodePageCursor(digest: string, offset: number): string {
  return `${PAGE_CURSOR_PREFIX}${digest}:${offset.toString(36)}`;
}

function decodePageCursor(
  cursor: string | null | undefined,
  digest: string,
  entryCount: number,
): number {
  if (cursor === null || cursor === undefined) return 0;
  if (typeof cursor !== "string" || cursor.length > 160 || !cursor.startsWith(PAGE_CURSOR_PREFIX)) {
    fail("invalid-cursor", "사용자 글꼴 page cursor 형식이 올바르지 않습니다.");
  }
  const body = cursor.slice(PAGE_CURSOR_PREFIX.length);
  const separator = body.indexOf(":");
  const cursorDigest = body.slice(0, separator);
  const rawOffset = body.slice(separator + 1);
  const offset = Number.parseInt(rawOffset, 36);
  if (
    separator < 1
    || cursorDigest !== digest
    || !Number.isSafeInteger(offset)
    || offset < 1
    || offset >= entryCount
    || offset.toString(36) !== rawOffset
    || encodePageCursor(digest, offset) !== cursor
  ) {
    fail("invalid-cursor", "사용자 글꼴 page cursor가 오래됐거나 위조되었습니다.");
  }
  return offset;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail("aborted", "사용자 글꼴 page 읽기가 취소되었습니다.");
}

function normalizePageRequest(request: StudioCustomFontPageRequest): {
  readonly pageSize: number;
  readonly maxHydratedBytes: number;
} {
  if (
    !Number.isSafeInteger(request.pageSize)
    || request.pageSize < 1
    || request.pageSize > STUDIO_CUSTOM_FONT_MAX_PAGE_SIZE
  ) {
    fail(
      "invalid-page-size",
      `사용자 글꼴 pageSize는 1~${STUDIO_CUSTOM_FONT_MAX_PAGE_SIZE}여야 합니다.`,
    );
  }
  const maxHydratedBytes = request.maxHydratedBytes
    ?? STUDIO_CUSTOM_FONT_MAX_PAGE_HYDRATED_BYTES;
  if (
    !Number.isSafeInteger(maxHydratedBytes)
    || maxHydratedBytes < 1
    || maxHydratedBytes > STUDIO_CUSTOM_FONT_MAX_PAGE_HYDRATED_BYTES
  ) {
    fail(
      "invalid-page-size",
      `사용자 글꼴 page hydration 예산은 1~${STUDIO_CUSTOM_FONT_MAX_PAGE_HYDRATED_BYTES}바이트여야 합니다.`,
    );
  }
  throwIfAborted(request.signal);
  return { pageSize: request.pageSize, maxHydratedBytes };
}

function uniqueHashes(entries: readonly StudioCustomFontManifestEntry[]): string[] {
  return [...new Set(entries.map(({ contentHash }) => contentHash))].sort();
}

async function verifiedFontBytes(
  store: StudioOpfsAssetStore,
  entry: StudioCustomFontManifestEntry,
): Promise<Uint8Array> {
  try {
    const stat = await store.stat(entry.contentHash);
    if (!stat || stat.hash !== entry.contentHash || stat.bytes !== entry.byteLength
      || stat.mime !== entry.mimeType) {
      corrupt(`사용자 글꼴 CAS metadata가 manifest와 일치하지 않습니다: ${entry.id}`);
    }
    const bytes = await store.get(entry.contentHash, { verify: true });
    if (!bytes || bytes.byteLength !== entry.byteLength) {
      corrupt(`사용자 글꼴 CAS blob이 없거나 잘렸습니다: ${entry.id}`);
    }
    if (sniffStudioFontFormat(bytes) !== entry.format) {
      corrupt(`사용자 글꼴 CAS 바이트의 포맷이 manifest와 다릅니다: ${entry.id}`);
    }
    return bytes;
  } catch (error) {
    if (error instanceof StudioCustomFontRepositoryError) throw error;
    throw repositoryError(error, "blob 읽기");
  }
}

function hydratedFont(
  entry: StudioCustomFontManifestEntry,
  bytes: Uint8Array,
): StudioCustomFontWithContentHash {
  return {
    id: entry.id,
    family: entry.family,
    fileName: entry.fileName,
    byteLength: entry.byteLength,
    contentHash: entry.contentHash,
    format: entry.format,
    createdAt: entry.createdAt,
    // Create one caller-owned copy only after all CAS and font-container checks pass. The former
    // verifiedFontBytes + hydration double-copy retained 256 MiB for one legal 128 MiB font.
    verifiedBytes: Uint8Array.from(bytes),
  };
}

interface BrowserLockManagerLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
}

function productRunExclusive(): StudioCustomFontRunExclusive | null {
  const locks = typeof navigator === "undefined"
    ? null
    : (navigator as Navigator & { readonly locks?: BrowserLockManagerLike }).locks;
  if (!locks || typeof locks.request !== "function") return null;
  return <T>(task: () => Promise<T>) => locks.request(
    STUDIO_CUSTOM_FONT_LOCK_NAME,
    { mode: "exclusive" },
    task,
  );
}

export function createStudioCustomFontSqliteOpfsRepository(
  options: StudioCustomFontRepositoryOptions = {},
): StudioCustomFontRepository {
  const acquireDatabase = options.acquireDatabase ?? acquireStudioLocalDatabase;
  const acquireAssetStore = options.acquireAssetStore ?? acquireProductStudioAssetCasStore;
  const runExclusive = options.runExclusive === undefined
    ? productRunExclusive()
    : options.runExclusive;
  const now = options.now ?? (() => Date.now());
  const createId = options.createId ?? (() => crypto.randomUUID());
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = mutationTail.then(task, task);
    mutationTail = run.then(() => undefined, () => undefined);
    return run;
  }

  async function resources(): Promise<{
    database: StudioLocalDatabase;
    store: StudioOpfsAssetStore;
  }> {
    try {
      const [database, store] = await Promise.all([acquireDatabase(), acquireAssetStore()]);
      return { database, store };
    } catch (error) {
      throw repositoryError(error, "저장소 열기");
    }
  }

  async function readManifest(database: StudioLocalDatabase): Promise<StudioCustomFontManifestV1> {
    try {
      return parseStudioCustomFontManifest(await database.kvGet(
        STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
        STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
      ));
    } catch (error) {
      if (error instanceof StudioCustomFontRepositoryError) throw error;
      throw repositoryError(error, "manifest 읽기");
    }
  }

  async function assertOwnerCoverage(
    store: StudioOpfsAssetStore,
    manifest: StudioCustomFontManifestV1,
  ): Promise<void> {
    const ownerRefs = new Set<string>(await store.ownerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER));
    for (const hash of uniqueHashes(manifest.entries)) {
      if (!ownerRefs.has(hash)) corrupt(`사용자 글꼴 CAS owner 원장에 hash가 없습니다: ${hash}`);
    }
  }

  async function readPage(
    database: StudioLocalDatabase,
    store: StudioOpfsAssetStore,
    request: StudioCustomFontPageRequest,
  ): Promise<StudioCustomFontPage> {
    const { pageSize, maxHydratedBytes } = normalizePageRequest(request);
    const manifest = await readManifest(database);
    throwIfAborted(request.signal);
    const digest = manifestDigest(manifest);
    const offset = decodePageCursor(request.cursor, digest, manifest.entries.length);
    if (manifest.entries.length > 0) await assertOwnerCoverage(store, manifest);
    throwIfAborted(request.signal);

    const fonts: StudioCustomFontWithContentHash[] = [];
    let hydratedBytes = 0;
    let position = offset;
    while (position < manifest.entries.length && fonts.length < pageSize) {
      throwIfAborted(request.signal);
      const entry = manifest.entries[position]!;
      if (hydratedBytes + entry.byteLength > maxHydratedBytes) {
        if (fonts.length === 0) {
          fail(
            "backpressure",
            `다음 사용자 글꼴 ${entry.byteLength}바이트가 page hydration 예산 ${maxHydratedBytes}바이트를 넘습니다.`,
          );
        }
        break;
      }
      const bytes = await verifiedFontBytes(store, entry);
      throwIfAborted(request.signal);
      fonts.push(hydratedFont(entry, bytes));
      hydratedBytes += entry.byteLength;
      position += 1;
    }
    return {
      fonts,
      nextCursor: position < manifest.entries.length
        ? encodePageCursor(digest, position)
        : null,
      totalEntries: manifest.entries.length,
      totalBytes: manifest.totalBytes,
      hydratedBytes,
    };
  }

  async function commitManifest(
    database: StudioLocalDatabase,
    store: StudioOpfsAssetStore,
    current: StudioCustomFontManifestV1,
    entries: readonly StudioCustomFontManifestEntry[],
  ): Promise<StudioCustomFontManifestV1> {
    const next = buildManifest(entries);
    const oldHashes = uniqueHashes(current.entries);
    const nextHashes = uniqueHashes(next.entries);
    const protectedHashes = [...new Set([...oldHashes, ...nextHashes])].sort();
    try {
      await store.setOwnerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER, protectedHashes);
      await database.kvSet(
        STUDIO_CUSTOM_FONT_SQLITE_NAMESPACE,
        STUDIO_CUSTOM_FONT_SQLITE_MANIFEST_KEY,
        serializeStudioCustomFontManifest(next.entries),
      );
    } catch (error) {
      if (!isStudioLocalDatabaseCommitOutcomeUnknownError(error)) {
        await store.setOwnerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER, oldHashes).catch(() => []);
      }
      throw repositoryError(error, "manifest 커밋");
    }
    // Manifest is now authoritative. Owner contraction/orphan cleanup is recoverable bookkeeping.
    await store.setOwnerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER, nextHashes).catch(() => []);
    await store.sweep().catch(() => undefined);
    return next;
  }

  async function mutation<T>(task: (
    database: StudioLocalDatabase,
    store: StudioOpfsAssetStore,
  ) => Promise<T>): Promise<T> {
    if (!runExclusive) {
      fail(
        "unavailable",
        "Web Locks가 없어 여러 탭의 사용자 글꼴 쓰기를 안전하게 직렬화할 수 없습니다.",
      );
    }
    return runExclusive(async () => {
      const { database, store } = await resources();
      return task(database, store);
    });
  }

  return {
    authority: "sqlite-opfs",

    async page(request) {
      await mutationTail;
      const { database, store } = await resources();
      return readPage(database, store, request);
    },

    async materialize(request) {
      await mutationTail;
      if (
        !Number.isSafeInteger(request.maxEntries)
        || request.maxEntries < 1
        || request.maxEntries > STUDIO_CUSTOM_FONT_MAX_COMPATIBILITY_ENTRIES
        || !Number.isSafeInteger(request.maxHydratedBytes)
        || request.maxHydratedBytes < 1
        || request.maxHydratedBytes > STUDIO_CUSTOM_FONT_MAX_COMPATIBILITY_HYDRATED_BYTES
      ) {
        fail(
          "invalid-page-size",
          "사용자 글꼴 compatibility materialization 영수증 예산이 허용 범위를 벗어났습니다.",
        );
      }
      const pageSize = request.pageSize ?? STUDIO_CUSTOM_FONT_DEFAULT_PAGE_SIZE;
      normalizePageRequest({ pageSize, signal: request.signal });
      const { database, store } = await resources();
      const fonts: StudioCustomFontWithContentHash[] = [];
      let cursor: string | null = null;
      let totalEntries = 0;
      let totalBytes = 0;
      let hydratedBytes = 0;
      do {
        const remainingEntries = request.maxEntries - fonts.length;
        const remainingBytes = request.maxHydratedBytes - hydratedBytes;
        if (remainingEntries < 1 || remainingBytes < 1) {
          return {
            fonts,
            truncated: cursor !== null || fonts.length < totalEntries,
            nextCursor: cursor,
            totalEntries,
            totalBytes,
            hydratedBytes,
          };
        }
        let page: StudioCustomFontPage;
        try {
          page = await readPage(database, store, {
            pageSize: Math.min(pageSize, remainingEntries),
            cursor,
            maxHydratedBytes: Math.min(
              STUDIO_CUSTOM_FONT_MAX_PAGE_HYDRATED_BYTES,
              remainingBytes,
            ),
            signal: request.signal,
          });
        } catch (error) {
          if (
            error instanceof StudioCustomFontRepositoryError
            && error.code === "backpressure"
            && fonts.length > 0
          ) {
            return {
              fonts,
              truncated: true,
              nextCursor: cursor,
              totalEntries,
              totalBytes,
              hydratedBytes,
            };
          }
          throw error;
        }
        fonts.push(...page.fonts);
        hydratedBytes += page.hydratedBytes;
        totalEntries = page.totalEntries;
        totalBytes = page.totalBytes;
        cursor = page.nextCursor;
        if (fonts.length >= request.maxEntries || hydratedBytes >= request.maxHydratedBytes) {
          return {
            fonts,
            truncated: cursor !== null,
            nextCursor: cursor,
            totalEntries,
            totalBytes,
            hydratedBytes,
          };
        }
      } while (cursor !== null);
      return {
        fonts,
        truncated: false,
        nextCursor: null,
        totalEntries,
        totalBytes,
        hydratedBytes,
      };
    },

    save(input) {
      return enqueue(() => mutation(async (database, store) => {
        if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1) {
          invalid("빈 글꼴 파일은 저장할 수 없습니다.");
        }
        if (input.bytes.byteLength > STUDIO_CUSTOM_FONT_LIMITS.individualBytes) {
          invalid("글꼴 파일이 128 MiB 상한을 넘었습니다.");
        }
        const format = sniffStudioFontFormat(input.bytes);
        if (!format) invalid("TTF·OTF·TTC·WOFF·WOFF2 글꼴 바이트가 아닙니다.");
        const current = await readManifest(database);
        if (current.totalBytes + input.bytes.byteLength > STUDIO_CUSTOM_FONT_LIMITS.logicalBytes) {
          invalid("사용자 글꼴 라이브러리가 2 GiB 논리 상한을 넘습니다.");
        }
        const id = canonicalId(input.id ?? createId());
        if (current.entries.some((entry) => entry.id === id)) invalid(`중복 사용자 글꼴 ID입니다: ${id}`);
        const fileName = canonicalFileName(input.fileName);
        const family = deriveCustomFontFamily(
          fileName,
          current.entries.map((entry) => entry.family),
        );
        const mimeType = studioCustomFontMime(format);
        let put;
        try {
          put = await store.put(input.bytes, { mime: mimeType, codec: "identity" });
        } catch (error) {
          throw repositoryError(error, "blob 저장");
        }
        if (input.contentHash !== undefined && input.contentHash !== put.ref.hash) {
          invalid("제공된 contentHash가 실제 글꼴 바이트 SHA-256과 일치하지 않습니다.");
        }
        if (put.ref.bytes !== input.bytes.byteLength || put.ref.mime !== mimeType
          || put.entry.hash !== put.ref.hash || put.entry.bytes !== input.bytes.byteLength
          || put.entry.mime !== mimeType) {
          corrupt("사용자 글꼴 OPFS CAS 저장 영수증이 입력 hash/size/MIME과 다릅니다.");
        }
        const entry = canonicalEntry({
          id,
          family,
          fileName,
          format,
          mimeType,
          contentHash: put.ref.hash,
          byteLength: input.bytes.byteLength,
          createdAt: now(),
        });
        const verified = await verifiedFontBytes(store, entry);
        const next = await commitManifest(database, store, current, [...current.entries, entry]);
        const committed = next.entries.find((candidate) => candidate.id === id);
        if (!committed) corrupt("커밋된 사용자 글꼴 manifest에서 신규 항목을 찾지 못했습니다.");
        return hydratedFont(committed, verified);
      }));
    },

    delete(id) {
      return enqueue(() => mutation(async (database, store) => {
        canonicalId(id);
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

    cleanupOrphans() {
      return enqueue(() => mutation(async (database, store) => {
        const manifest = await readManifest(database);
        if (manifest.entries.length > 0) await assertOwnerCoverage(store, manifest);
        for (const entry of manifest.entries) await verifiedFontBytes(store, entry);
        await store.setOwnerRefs(STUDIO_CUSTOM_FONT_CAS_OWNER, uniqueHashes(manifest.entries));
        return (await store.sweep()).removed.length;
      }));
    },
  };
}

let productRepository: StudioCustomFontRepository | null = null;

export function getProductStudioCustomFontRepository(): StudioCustomFontRepository {
  productRepository ??= createStudioCustomFontSqliteOpfsRepository();
  return productRepository;
}
