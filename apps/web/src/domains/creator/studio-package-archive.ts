/**
 * Small, dependency-free ZIP32 writer for local Toon Studio publish packages.
 *
 * The archive uses the portable ZIP "store" method (no compression), UTF-8 file names, CRC-32,
 * local headers, a central directory, and one EOCD record. It deliberately rejects ZIP64-sized
 * inputs, unsafe paths, ambiguous duplicate names, and browser-hostile package sizes.
 */

import {
  createStudioCrc32WorkerSession,
  type StudioCrc32ExecutionMode,
} from "./studio-crc32-worker-client";

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION_20 = 20;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_LOCAL_HEADER_BYTES = 30;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const ZIP_EOCD_BYTES = 22;
const ZIP16_MAX = 0xffff;
const ZIP32_MAX = 0xffff_ffff;
const DOS_EPOCH_MS = Date.UTC(1980, 0, 1, 0, 0, 0, 0);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const UNSAFE_PATH_CHARACTER = /[<>:"|?*\\]/u;
const UNSAFE_BIDI_CHARACTER = /[\u202a-\u202e\u2066-\u2069]/u;

export const STUDIO_PACKAGE_ARCHIVE_LIMITS = Object.freeze({
  maxFiles: 1_100,
  maxEntryBytes: 256_000_000,
  maxTotalBytes: 512_000_000,
  maxArchiveBytes: 520_000_000,
  maxPathBytes: 1_024,
});

export interface StudioPackageArchiveLimits {
  maxFiles: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxArchiveBytes: number;
  maxPathBytes: number;
}

export type StudioPackageArchiveSource = Blob | Uint8Array | ArrayBuffer;

export interface StudioPackageArchiveEntry {
  /** Relative, portable archive path. Directory entries are synthesized by unzip tools. */
  path: string;
  data: StudioPackageArchiveSource;
}

export interface StudioPackageArchiveProgress {
  completedFiles: number;
  totalFiles: number;
  processedBytes: number;
  totalBytes: number;
  path: string;
}

export interface StudioPackageArchiveBuildOptions {
  /**
   * One UTC timestamp for every entry. ZIP stores two-second precision. The DOS epoch is used by
   * default, so identical inputs produce identical bytes without reading the clock.
   */
  modifiedAt?: Date | number | string;
  /** Callers may lower, but never raise, the fixed browser-safety limits. */
  limits?: Partial<StudioPackageArchiveLimits>;
  onProgress?: (progress: StudioPackageArchiveProgress) => void;
  /** Blob output only. Use application/zip or a product-specific +zip media type. */
  mimeType?: string;
  /** Cancels Blob reads between awaits and terminates an in-flight CRC Worker epoch. */
  signal?: AbortSignal;
  /** Fixed before archive construction. Browser product callers select `worker`. */
  crc32ExecutionMode?: StudioCrc32ExecutionMode;
}

export type StudioPackageArchiveErrorCode =
  | "ARCHIVE_SIZE_LIMIT"
  | "ENTRY_COUNT_LIMIT"
  | "ENTRY_SIZE_LIMIT"
  | "LIMIT_INVALID"
  | "PATH_DUPLICATE"
  | "PATH_INVALID"
  | "SOURCE_INVALID"
  | "SOURCE_SIZE_MISMATCH"
  | "TIMESTAMP_INVALID"
  | "TOTAL_SIZE_LIMIT"
  | "ZIP32_OVERFLOW";

export class StudioPackageArchiveError extends Error {
  readonly code: StudioPackageArchiveErrorCode;
  readonly path?: string;

  constructor(code: StudioPackageArchiveErrorCode, message: string, path?: string) {
    super(message);
    this.name = "StudioPackageArchiveError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

interface EncodedPath {
  path: string;
  bytes: Uint8Array;
  comparisonKey: string;
}

interface PreparedEntry extends EncodedPath {
  data: Uint8Array;
  crc32: number;
  localHeaderOffset: number;
}

interface PlannedEntry extends EncodedPath {
  source: StudioPackageArchiveSource;
  size: number;
  localHeaderOffset: number;
}

interface PlannedArchive {
  entries: PlannedEntry[];
  timestamp: DosTimestamp;
  totalBytes: number;
  centralDirectoryOffset: number;
  centralDirectoryBytes: number;
  archiveBytes: number;
}

interface DosTimestamp {
  date: number;
  time: number;
}

const textEncoder = new TextEncoder();

function archiveError(
  code: StudioPackageArchiveErrorCode,
  message: string,
  path?: string
): StudioPackageArchiveError {
  return new StudioPackageArchiveError(code, message, path);
}

function resolveLimit(
  value: number | undefined,
  hardMaximum: number,
  key: keyof StudioPackageArchiveLimits
): number {
  if (value === undefined) return hardMaximum;
  if (!Number.isSafeInteger(value) || value < 0 || value > hardMaximum) {
    throw archiveError(
      "LIMIT_INVALID",
      `${key} 한도는 0 이상 ${hardMaximum.toLocaleString("en-US")} 이하의 정수여야 합니다.`
    );
  }
  return value;
}

function resolveLimits(
  value: Partial<StudioPackageArchiveLimits> | undefined
): StudioPackageArchiveLimits {
  return {
    maxFiles: resolveLimit(value?.maxFiles, STUDIO_PACKAGE_ARCHIVE_LIMITS.maxFiles, "maxFiles"),
    maxEntryBytes: resolveLimit(
      value?.maxEntryBytes,
      STUDIO_PACKAGE_ARCHIVE_LIMITS.maxEntryBytes,
      "maxEntryBytes"
    ),
    maxTotalBytes: resolveLimit(
      value?.maxTotalBytes,
      STUDIO_PACKAGE_ARCHIVE_LIMITS.maxTotalBytes,
      "maxTotalBytes"
    ),
    maxArchiveBytes: resolveLimit(
      value?.maxArchiveBytes,
      STUDIO_PACKAGE_ARCHIVE_LIMITS.maxArchiveBytes,
      "maxArchiveBytes"
    ),
    maxPathBytes: resolveLimit(
      value?.maxPathBytes,
      STUDIO_PACKAGE_ARCHIVE_LIMITS.maxPathBytes,
      "maxPathBytes"
    ),
  };
}

function parseTimestamp(value: StudioPackageArchiveBuildOptions["modifiedAt"]): DosTimestamp {
  let date: Date;
  if (value === undefined) {
    date = new Date(DOS_EPOCH_MS);
  } else if (value instanceof Date) {
    date = new Date(value.getTime());
  } else if (typeof value === "number") {
    date = new Date(value);
  } else if (typeof value === "string") {
    const source = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? `${value}T00:00:00Z` : value;
    if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(source)) {
      throw archiveError(
        "TIMESTAMP_INVALID",
        "결정적 ZIP 시간을 위해 문자열 timestamp에는 Z 또는 UTC 오프셋이 필요합니다."
      );
    }
    date = new Date(source);
  } else {
    throw archiveError("TIMESTAMP_INVALID", "ZIP timestamp 형식이 올바르지 않습니다.");
  }

  const time = date.getTime();
  const year = date.getUTCFullYear();
  if (!Number.isFinite(time) || year < 1980 || year > 2107) {
    throw archiveError(
      "TIMESTAMP_INVALID",
      "ZIP timestamp는 1980-01-01부터 2107-12-31 사이여야 합니다."
    );
  }
  return {
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
  };
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validatePath(value: unknown, maxPathBytes: number): EncodedPath {
  if (typeof value !== "string" || value.length === 0) {
    throw archiveError("PATH_INVALID", "archive 파일 경로가 비어 있습니다.");
  }
  if (hasUnpairedSurrogate(value)) {
    throw archiveError("PATH_INVALID", "archive 파일 경로의 Unicode 문자열이 올바르지 않습니다.", value);
  }
  const path = value.normalize("NFKC");
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.startsWith("//") ||
    /^[A-Za-z]:/u.test(path) ||
    UNSAFE_PATH_CHARACTER.test(path) ||
    [...path].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    }) ||
    UNSAFE_BIDI_CHARACTER.test(path)
  ) {
    throw archiveError("PATH_INVALID", "절대 경로 또는 안전하지 않은 문자가 포함되어 있습니다.", value);
  }

  const segments = path.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.trim() !== segment ||
      /[. ]$/u.test(segment) ||
      WINDOWS_RESERVED_NAME.test(segment)
    ) {
      throw archiveError("PATH_INVALID", "archive 경로에 안전하지 않은 구간이 포함되어 있습니다.", value);
    }
  }

  const bytes = textEncoder.encode(path);
  if (bytes.length === 0 || bytes.length > ZIP16_MAX || bytes.length > maxPathBytes) {
    throw archiveError(
      "PATH_INVALID",
      `archive 파일 경로는 UTF-8 ${Math.min(ZIP16_MAX, maxPathBytes).toLocaleString("en-US")}바이트 이하여야 합니다.`,
      value
    );
  }
  return { path, bytes, comparisonKey: path.toLowerCase() };
}

function sourceSize(source: unknown, path: string): number {
  let size: number;
  if (source instanceof Uint8Array) size = source.byteLength;
  else if (source instanceof ArrayBuffer) size = source.byteLength;
  else if (typeof Blob !== "undefined" && source instanceof Blob) size = source.size;
  else throw archiveError("SOURCE_INVALID", "지원하지 않는 archive 파일 데이터입니다.", path);

  if (!Number.isSafeInteger(size) || size < 0) {
    throw archiveError("SOURCE_INVALID", "archive 파일 크기가 올바르지 않습니다.", path);
  }
  return size;
}

function snapshotSource(source: unknown, path: string): StudioPackageArchiveSource {
  if (source instanceof Uint8Array) return source.slice();
  if (source instanceof ArrayBuffer) return source.slice(0);
  if (typeof Blob !== "undefined" && source instanceof Blob) return source;
  throw archiveError("SOURCE_INVALID", "지원하지 않는 archive 파일 데이터입니다.", path);
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("archive 조립을 취소했습니다.", "AbortError");
  }
  const error = new Error("archive 조립을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

async function readSource(
  source: StudioPackageArchiveSource,
  expectedSize: number,
  path: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  let bytes: Uint8Array;
  // snapshotSource already detached these mutable caller-owned inputs before the first await.
  // Reusing the private snapshot avoids one more full-file copy during CRC preparation.
  if (source instanceof Uint8Array) bytes = source;
  else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
  else {
    try {
      bytes = new Uint8Array(await source.arrayBuffer());
    } catch (cause) {
      const detail = cause instanceof Error ? `: ${cause.message}` : "";
      throw archiveError("SOURCE_INVALID", `Blob 데이터를 읽지 못했습니다${detail}`, path);
    }
  }
  throwIfAborted(signal);
  if (bytes.byteLength !== expectedSize) {
    throw archiveError(
      "SOURCE_SIZE_MISMATCH",
      "archive 파일을 읽는 동안 크기가 변경되었거나 잘못 보고되었습니다.",
      path
    );
  }
  return bytes;
}

function assertZip32(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > ZIP32_MAX) {
    throw archiveError("ZIP32_OVERFLOW", `${label}이 ZIP32 한도를 넘었습니다.`);
  }
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  assertZip32(result, label);
  return result;
}

function setUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function setUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function writeLocalHeader(
  output: Uint8Array,
  offset: number,
  entry: PreparedEntry,
  timestamp: DosTimestamp
): number {
  const view = new DataView(output.buffer, output.byteOffset + offset, ZIP_LOCAL_HEADER_BYTES);
  setUint32(view, 0, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
  setUint16(view, 4, ZIP_VERSION_20);
  setUint16(view, 6, ZIP_UTF8_FLAG);
  setUint16(view, 8, ZIP_STORE_METHOD);
  setUint16(view, 10, timestamp.time);
  setUint16(view, 12, timestamp.date);
  setUint32(view, 14, entry.crc32);
  setUint32(view, 18, entry.data.byteLength);
  setUint32(view, 22, entry.data.byteLength);
  setUint16(view, 26, entry.bytes.byteLength);
  setUint16(view, 28, 0);
  let cursor = offset + ZIP_LOCAL_HEADER_BYTES;
  output.set(entry.bytes, cursor);
  cursor += entry.bytes.byteLength;
  output.set(entry.data, cursor);
  return cursor + entry.data.byteLength;
}

function writeCentralHeader(
  output: Uint8Array,
  offset: number,
  entry: PreparedEntry,
  timestamp: DosTimestamp
): number {
  const view = new DataView(output.buffer, output.byteOffset + offset, ZIP_CENTRAL_HEADER_BYTES);
  setUint32(view, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
  setUint16(view, 4, ZIP_VERSION_20);
  setUint16(view, 6, ZIP_VERSION_20);
  setUint16(view, 8, ZIP_UTF8_FLAG);
  setUint16(view, 10, ZIP_STORE_METHOD);
  setUint16(view, 12, timestamp.time);
  setUint16(view, 14, timestamp.date);
  setUint32(view, 16, entry.crc32);
  setUint32(view, 20, entry.data.byteLength);
  setUint32(view, 24, entry.data.byteLength);
  setUint16(view, 28, entry.bytes.byteLength);
  setUint16(view, 30, 0);
  setUint16(view, 32, 0);
  setUint16(view, 34, 0);
  setUint16(view, 36, 0);
  setUint32(view, 38, 0);
  setUint32(view, 42, entry.localHeaderOffset);
  output.set(entry.bytes, offset + ZIP_CENTRAL_HEADER_BYTES);
  return offset + ZIP_CENTRAL_HEADER_BYTES + entry.bytes.byteLength;
}

function writeEocd(
  output: Uint8Array,
  offset: number,
  entryCount: number,
  centralDirectoryOffset: number,
  centralDirectoryBytes: number
): number {
  const view = new DataView(output.buffer, output.byteOffset + offset, ZIP_EOCD_BYTES);
  setUint32(view, 0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  setUint16(view, 4, 0);
  setUint16(view, 6, 0);
  setUint16(view, 8, entryCount);
  setUint16(view, 10, entryCount);
  setUint32(view, 12, centralDirectoryBytes);
  setUint32(view, 16, centralDirectoryOffset);
  setUint16(view, 20, 0);
  return offset + ZIP_EOCD_BYTES;
}

function planArchive(
  entries: readonly StudioPackageArchiveEntry[],
  options: StudioPackageArchiveBuildOptions
): PlannedArchive {
  if (!Array.isArray(entries)) {
    throw archiveError("SOURCE_INVALID", "archive 파일 목록이 배열이 아닙니다.");
  }
  if (entries.length > ZIP16_MAX) {
    throw archiveError("ZIP32_OVERFLOW", "ZIP32는 최대 65,535개 파일만 포함할 수 있습니다.");
  }
  const limits = resolveLimits(options.limits);
  if (entries.length > limits.maxFiles) {
    throw archiveError(
      "ENTRY_COUNT_LIMIT",
      `archive는 최대 ${limits.maxFiles.toLocaleString("en-US")}개 파일을 포함할 수 있습니다.`
    );
  }
  const timestamp = parseTimestamp(options.modifiedAt);
  const drafts: Array<EncodedPath & { source: StudioPackageArchiveSource; size: number }> = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) {
      throw archiveError("SOURCE_INVALID", "archive 파일 항목이 올바르지 않습니다.");
    }
    const encodedPath = validatePath(entry.path, limits.maxPathBytes);
    if (seen.has(encodedPath.comparisonKey)) {
      throw archiveError("PATH_DUPLICATE", "archive 안에서 파일 경로가 충돌합니다.", encodedPath.path);
    }
    seen.add(encodedPath.comparisonKey);
    const source = snapshotSource(entry.data, encodedPath.path);
    const size = sourceSize(source, encodedPath.path);
    if (size > ZIP32_MAX) {
      throw archiveError("ZIP32_OVERFLOW", "개별 파일이 ZIP32 크기 한도를 넘었습니다.", encodedPath.path);
    }
    if (size > limits.maxEntryBytes) {
      throw archiveError(
        "ENTRY_SIZE_LIMIT",
        `개별 archive 파일은 ${limits.maxEntryBytes.toLocaleString("en-US")}바이트 이하여야 합니다.`,
        encodedPath.path
      );
    }
    totalBytes += size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxTotalBytes) {
      throw archiveError(
        "TOTAL_SIZE_LIMIT",
        `archive 원본 합계는 ${limits.maxTotalBytes.toLocaleString("en-US")}바이트 이하여야 합니다.`
      );
    }
    drafts.push({ ...encodedPath, source, size });
  }

  const plannedEntries: PlannedEntry[] = [];
  let localBytes = 0;
  for (const draft of drafts) {
    plannedEntries.push({ ...draft, localHeaderOffset: localBytes });
    localBytes = safeAdd(localBytes, ZIP_LOCAL_HEADER_BYTES, "local header offset");
    localBytes = safeAdd(localBytes, draft.bytes.byteLength, "local file name offset");
    localBytes = safeAdd(localBytes, draft.size, "local file data offset");
  }
  const centralDirectoryOffset = localBytes;
  let centralDirectoryBytes = 0;
  for (const entry of plannedEntries) {
    centralDirectoryBytes = safeAdd(
      centralDirectoryBytes,
      ZIP_CENTRAL_HEADER_BYTES + entry.bytes.byteLength,
      "central directory size"
    );
  }
  let archiveBytes = safeAdd(
    centralDirectoryOffset,
    centralDirectoryBytes,
    "central directory end offset"
  );
  archiveBytes = safeAdd(archiveBytes, ZIP_EOCD_BYTES, "archive size");
  if (archiveBytes > limits.maxArchiveBytes) {
    throw archiveError(
      "ARCHIVE_SIZE_LIMIT",
      `완성 archive는 ${limits.maxArchiveBytes.toLocaleString("en-US")}바이트 이하여야 합니다.`
    );
  }
  return {
    entries: plannedEntries,
    timestamp,
    totalBytes,
    centralDirectoryOffset,
    centralDirectoryBytes,
    archiveBytes,
  };
}

/** Builds deterministic ZIP32 bytes. Entry order is preserved. */
export async function buildStudioPackageArchiveBytes(
  entries: readonly StudioPackageArchiveEntry[],
  options: StudioPackageArchiveBuildOptions = {}
): Promise<Uint8Array> {
  throwIfAborted(options.signal);
  const plan = planArchive(entries, options);

  const prepared: PreparedEntry[] = [];
  let processedBytes = 0;
  const crc32Session = createStudioCrc32WorkerSession({
    executionMode: options.crc32ExecutionMode ?? "worker",
  });
  try {
    for (let index = 0; index < plan.entries.length; index += 1) {
      const entry = plan.entries[index];
      if (!entry) throw archiveError("SOURCE_INVALID", "archive 파일 준비 상태가 올바르지 않습니다.");
      const sourceData = await readSource(entry.source, entry.size, entry.path, options.signal);
      const { crc32, data } = await crc32Session.run(sourceData, { signal: options.signal });
      processedBytes += data.byteLength;
      prepared.push({
        path: entry.path,
        bytes: entry.bytes,
        comparisonKey: entry.comparisonKey,
        data,
        crc32,
        localHeaderOffset: entry.localHeaderOffset,
      });
      options.onProgress?.({
        completedFiles: index + 1,
        totalFiles: plan.entries.length,
        processedBytes,
        totalBytes: plan.totalBytes,
        path: entry.path,
      });
    }
  } finally {
    crc32Session.dispose();
  }

  throwIfAborted(options.signal);
  let output: Uint8Array;
  try {
    output = new Uint8Array(plan.archiveBytes);
  } catch {
    throw archiveError("ARCHIVE_SIZE_LIMIT", "브라우저가 archive 출력 메모리를 할당하지 못했습니다.");
  }
  let cursor = 0;
  for (const entry of prepared) cursor = writeLocalHeader(output, cursor, entry, plan.timestamp);
  for (const entry of prepared) cursor = writeCentralHeader(output, cursor, entry, plan.timestamp);
  cursor = writeEocd(
    output,
    cursor,
    prepared.length,
    plan.centralDirectoryOffset,
    plan.centralDirectoryBytes
  );
  if (cursor !== output.byteLength) {
    throw archiveError("ZIP32_OVERFLOW", "ZIP32 출력 길이 계산이 일치하지 않습니다.");
  }
  return output;
}

interface BlobHeaderEntry extends EncodedPath {
  size: number;
  crc32: number;
  localHeaderOffset: number;
}

function buildLocalHeaderBytes(entry: BlobHeaderEntry, timestamp: DosTimestamp): Uint8Array {
  const output = new Uint8Array(ZIP_LOCAL_HEADER_BYTES + entry.bytes.byteLength);
  const view = new DataView(output.buffer, 0, ZIP_LOCAL_HEADER_BYTES);
  setUint32(view, 0, ZIP_LOCAL_FILE_HEADER_SIGNATURE);
  setUint16(view, 4, ZIP_VERSION_20);
  setUint16(view, 6, ZIP_UTF8_FLAG);
  setUint16(view, 8, ZIP_STORE_METHOD);
  setUint16(view, 10, timestamp.time);
  setUint16(view, 12, timestamp.date);
  setUint32(view, 14, entry.crc32);
  setUint32(view, 18, entry.size);
  setUint32(view, 22, entry.size);
  setUint16(view, 26, entry.bytes.byteLength);
  setUint16(view, 28, 0);
  output.set(entry.bytes, ZIP_LOCAL_HEADER_BYTES);
  return output;
}

function buildCentralHeaderBytes(entry: BlobHeaderEntry, timestamp: DosTimestamp): Uint8Array {
  const output = new Uint8Array(ZIP_CENTRAL_HEADER_BYTES + entry.bytes.byteLength);
  const view = new DataView(output.buffer, 0, ZIP_CENTRAL_HEADER_BYTES);
  setUint32(view, 0, ZIP_CENTRAL_DIRECTORY_SIGNATURE);
  setUint16(view, 4, ZIP_VERSION_20);
  setUint16(view, 6, ZIP_VERSION_20);
  setUint16(view, 8, ZIP_UTF8_FLAG);
  setUint16(view, 10, ZIP_STORE_METHOD);
  setUint16(view, 12, timestamp.time);
  setUint16(view, 14, timestamp.date);
  setUint32(view, 16, entry.crc32);
  setUint32(view, 20, entry.size);
  setUint32(view, 24, entry.size);
  setUint16(view, 28, entry.bytes.byteLength);
  setUint16(view, 30, 0);
  setUint16(view, 32, 0);
  setUint16(view, 34, 0);
  setUint16(view, 36, 0);
  setUint32(view, 38, 0);
  setUint32(view, 42, entry.localHeaderOffset);
  output.set(entry.bytes, ZIP_CENTRAL_HEADER_BYTES);
  return output;
}

function sourceBlobPart(
  source: StudioPackageArchiveSource,
  returnedData: Uint8Array,
): Blob | ArrayBuffer {
  if (source instanceof Blob) return source;
  const buffer = returnedData.buffer;
  if (
    buffer instanceof ArrayBuffer
    && returnedData.byteOffset === 0
    && returnedData.byteLength === buffer.byteLength
  ) {
    return buffer;
  }
  // Defensive only: the CRC client normally returns a dedicated transferable buffer.
  return returnedData.slice().buffer as ArrayBuffer;
}

/**
 * Builds one downloadable ZIP-compatible Blob. Unlike the byte-array API, this path keeps source
 * Blobs as Blob parts and holds only one source-sized CRC buffer at a time, avoiding a second
 * contiguous package-sized Uint8Array on memory-constrained mobile browsers.
 */
export async function buildStudioPackageArchiveBlob(
  entries: readonly StudioPackageArchiveEntry[],
  options: StudioPackageArchiveBuildOptions = {}
): Promise<Blob> {
  throwIfAborted(options.signal);
  const plan = planArchive(entries, options);
  const localParts: Array<Blob | ArrayBuffer> = [];
  const centralParts: Array<ArrayBuffer> = [];
  let processedBytes = 0;
  const crc32Session = createStudioCrc32WorkerSession({
    executionMode: options.crc32ExecutionMode ?? "worker",
  });
  try {
    for (let index = 0; index < plan.entries.length; index += 1) {
      const entry = plan.entries[index];
      if (!entry) throw archiveError("SOURCE_INVALID", "archive 파일 준비 상태가 올바르지 않습니다.");
      const sourceData = await readSource(entry.source, entry.size, entry.path, options.signal);
      const { crc32, data } = await crc32Session.run(sourceData, { signal: options.signal });
      const headerEntry: BlobHeaderEntry = {
        path: entry.path,
        bytes: entry.bytes,
        comparisonKey: entry.comparisonKey,
        size: entry.size,
        crc32,
        localHeaderOffset: entry.localHeaderOffset,
      };
      const localHeader = buildLocalHeaderBytes(headerEntry, plan.timestamp);
      const centralHeader = buildCentralHeaderBytes(headerEntry, plan.timestamp);
      localParts.push(
        localHeader.buffer as ArrayBuffer,
        sourceBlobPart(entry.source, data),
      );
      centralParts.push(centralHeader.buffer as ArrayBuffer);
      processedBytes += data.byteLength;
      options.onProgress?.({
        completedFiles: index + 1,
        totalFiles: plan.entries.length,
        processedBytes,
        totalBytes: plan.totalBytes,
        path: entry.path,
      });
    }
  } finally {
    crc32Session.dispose();
  }
  throwIfAborted(options.signal);
  const eocd = new Uint8Array(ZIP_EOCD_BYTES);
  const eocdEnd = writeEocd(
    eocd,
    0,
    plan.entries.length,
    plan.centralDirectoryOffset,
    plan.centralDirectoryBytes
  );
  if (eocdEnd !== eocd.byteLength) {
    throw archiveError("ZIP32_OVERFLOW", "ZIP32 출력 길이 계산이 일치하지 않습니다.");
  }
  const mimeType = options.mimeType?.trim() || "application/zip";
  const blob = new Blob(
    [...localParts, ...centralParts, eocd.buffer as ArrayBuffer],
    { type: mimeType }
  );
  if (blob.size !== plan.archiveBytes) {
    throw archiveError("SOURCE_SIZE_MISMATCH", "완성 archive 크기가 계획과 일치하지 않습니다.");
  }
  return blob;
}
