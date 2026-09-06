/**
 * Bounded, dependency-free ZIP32 reader used by portable Studio interchange formats.
 *
 * This is intentionally stricter than a general unzip utility. It accepts only single-disk
 * archives whose central directory completely describes contiguous local records, rejects
 * ambiguous paths and ZIP features that move trust outside those records, and authenticates
 * every extracted payload with CRC-32. Stored entries and raw-DEFLATE entries are supported.
 */

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_LOCAL_HEADER_BYTES = 30;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const ZIP_EOCD_BYTES = 22;
const ZIP16_MAX = 0xffff;
const ZIP32_MAX = 0xffff_ffff;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_ENCRYPTED_FLAG = 0x0001;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_DEFLATE_OPTION_FLAGS = 0x0006;
const ZIP_STORE_METHOD = 0;
const ZIP_DEFLATE_METHOD = 8;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const UNSAFE_PATH_CHARACTER = /[<>:"|?*\\]/u;
const UNSAFE_BIDI_CHARACTER = /[\u202a-\u202e\u2066-\u2069]/u;

export const STUDIO_ZIP_READER_LIMITS = Object.freeze({
  maxArchiveBytes: 520_000_000,
  maxEntries: 2_048,
  maxEntryCompressedBytes: 256_000_000,
  maxEntryUncompressedBytes: 256_000_000,
  maxTotalUncompressedBytes: 512_000_000,
  maxCentralDirectoryBytes: 16_000_000,
  maxPathBytes: 1_024,
  maxCompressionRatio: 100,
  maxCommentBytes: ZIP16_MAX,
});

export interface StudioZipReaderLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryCompressedBytes: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCentralDirectoryBytes: number;
  maxPathBytes: number;
  maxCompressionRatio: number;
  maxCommentBytes: number;
}

export type StudioZipReaderSource = Blob | Uint8Array | ArrayBuffer;

export interface StudioZipInflateContext {
  path: string;
  expectedBytes: number;
  signal?: AbortSignal;
}

export type StudioZipInflateRawAdapter = (
  compressed: Uint8Array,
  context: StudioZipInflateContext
) => Promise<Uint8Array>;

export interface StudioZipReaderOptions {
  /** Callers may lower, but never raise, the fixed browser-safety limits. */
  limits?: Partial<StudioZipReaderLimits>;
  /** Raw-DEFLATE adapter for runtimes without DecompressionStream("deflate-raw"). */
  inflateRaw?: StudioZipInflateRawAdapter;
  signal?: AbortSignal;
}

export interface StudioZipReadEntryOptions {
  signal?: AbortSignal;
}

export interface StudioZipEntry {
  path: string;
  directory: boolean;
  compressionMethod: 0 | 8;
  compressedBytes: number;
  uncompressedBytes: number;
  crc32: number;
  localHeaderOffset: number;
  dataOffset: number;
}

export interface StudioZipArchive {
  /** Entries in physical local-record order, not attacker-controlled central-directory order. */
  entries: readonly StudioZipEntry[];
  comment: string;
  getEntry(path: string): StudioZipEntry | undefined;
  readEntry(
    entry: StudioZipEntry | string,
    options?: StudioZipReadEntryOptions
  ): Promise<Uint8Array>;
  readEntryBlob(
    entry: StudioZipEntry | string,
    mimeType?: string,
    options?: StudioZipReadEntryOptions
  ): Promise<Blob>;
}

export type StudioZipReaderErrorCode =
  | "ABORTED"
  | "ARCHIVE_SIZE_LIMIT"
  | "CENTRAL_DIRECTORY_INVALID"
  | "COMPRESSION_UNSUPPORTED"
  | "CRC_MISMATCH"
  | "DATA_DESCRIPTOR_UNSUPPORTED"
  | "DECOMPRESSION_FAILED"
  | "DECOMPRESSION_UNAVAILABLE"
  | "ENCRYPTED_UNSUPPORTED"
  | "ENTRY_COUNT_LIMIT"
  | "ENTRY_NOT_FOUND"
  | "ENTRY_SIZE_LIMIT"
  | "LIMIT_INVALID"
  | "LOCAL_HEADER_INVALID"
  | "MULTI_DISK_UNSUPPORTED"
  | "PATH_DUPLICATE"
  | "PATH_INVALID"
  | "SOURCE_INVALID"
  | "TOTAL_SIZE_LIMIT"
  | "ZIP64_UNSUPPORTED"
  | "ZIP_BOMB";

export class StudioZipReaderError extends Error {
  readonly code: StudioZipReaderErrorCode;
  readonly path?: string;

  constructor(code: StudioZipReaderErrorCode, message: string, path?: string) {
    super(message);
    this.name = "StudioZipReaderError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

interface ByteReader {
  size: number;
  read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
}

interface ValidatedPath {
  path: string;
  comparisonKey: string;
  directory: boolean;
}

interface CentralEntry extends StudioZipEntry {
  flags: number;
  versionNeeded: number;
  pathBytes: Uint8Array;
}

interface LocatedEocd {
  offset: number;
  centralOffset: number;
  centralBytes: number;
  entryCount: number;
  comment: string;
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function zipError(
  code: StudioZipReaderErrorCode,
  message: string,
  path?: string
): StudioZipReaderError {
  return new StudioZipReaderError(code, message, path);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw zipError("ABORTED", "ZIP 읽기가 취소되었습니다.");
}

function resolveIntegerLimit(
  value: number | undefined,
  maximum: number,
  key: keyof StudioZipReaderLimits
): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw zipError(
      "LIMIT_INVALID",
      `${key} 한도는 0 이상 ${maximum.toLocaleString("en-US")} 이하의 정수여야 합니다.`
    );
  }
  return value;
}

function resolveRatioLimit(value: number | undefined): number {
  if (value === undefined) return STUDIO_ZIP_READER_LIMITS.maxCompressionRatio;
  if (
    !Number.isFinite(value) ||
    value < 1 ||
    value > STUDIO_ZIP_READER_LIMITS.maxCompressionRatio
  ) {
    throw zipError(
      "LIMIT_INVALID",
      `maxCompressionRatio는 1 이상 ${STUDIO_ZIP_READER_LIMITS.maxCompressionRatio} 이하여야 합니다.`
    );
  }
  return value;
}

function resolveLimits(value?: Partial<StudioZipReaderLimits>): StudioZipReaderLimits {
  return {
    maxArchiveBytes: resolveIntegerLimit(
      value?.maxArchiveBytes,
      STUDIO_ZIP_READER_LIMITS.maxArchiveBytes,
      "maxArchiveBytes"
    ),
    maxEntries: resolveIntegerLimit(
      value?.maxEntries,
      STUDIO_ZIP_READER_LIMITS.maxEntries,
      "maxEntries"
    ),
    maxEntryCompressedBytes: resolveIntegerLimit(
      value?.maxEntryCompressedBytes,
      STUDIO_ZIP_READER_LIMITS.maxEntryCompressedBytes,
      "maxEntryCompressedBytes"
    ),
    maxEntryUncompressedBytes: resolveIntegerLimit(
      value?.maxEntryUncompressedBytes,
      STUDIO_ZIP_READER_LIMITS.maxEntryUncompressedBytes,
      "maxEntryUncompressedBytes"
    ),
    maxTotalUncompressedBytes: resolveIntegerLimit(
      value?.maxTotalUncompressedBytes,
      STUDIO_ZIP_READER_LIMITS.maxTotalUncompressedBytes,
      "maxTotalUncompressedBytes"
    ),
    maxCentralDirectoryBytes: resolveIntegerLimit(
      value?.maxCentralDirectoryBytes,
      STUDIO_ZIP_READER_LIMITS.maxCentralDirectoryBytes,
      "maxCentralDirectoryBytes"
    ),
    maxPathBytes: resolveIntegerLimit(
      value?.maxPathBytes,
      STUDIO_ZIP_READER_LIMITS.maxPathBytes,
      "maxPathBytes"
    ),
    maxCompressionRatio: resolveRatioLimit(value?.maxCompressionRatio),
    maxCommentBytes: resolveIntegerLimit(
      value?.maxCommentBytes,
      STUDIO_ZIP_READER_LIMITS.maxCommentBytes,
      "maxCommentBytes"
    ),
  };
}

function safeRange(offset: number, length: number, size: number, label: string): number {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw zipError("CENTRAL_DIRECTORY_INVALID", `${label} 범위가 올바르지 않습니다.`);
  }
  const end = offset + length;
  if (!Number.isSafeInteger(end) || end > size) {
    throw zipError("CENTRAL_DIRECTORY_INVALID", `${label} 범위가 archive 밖을 가리킵니다.`);
  }
  return end;
}

function createByteReader(source: unknown): ByteReader {
  if (source instanceof Uint8Array) {
    const bytes = source.slice();
    return {
      size: bytes.byteLength,
      async read(offset, length, signal) {
        throwIfAborted(signal);
        safeRange(offset, length, bytes.byteLength, "ZIP byte source");
        return bytes.slice(offset, offset + length);
      },
    };
  }
  if (source instanceof ArrayBuffer) return createByteReader(new Uint8Array(source.slice(0)));
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return {
      size: source.size,
      async read(offset, length, signal) {
        throwIfAborted(signal);
        safeRange(offset, length, source.size, "ZIP Blob source");
        let buffer: ArrayBuffer;
        try {
          buffer = await source.slice(offset, offset + length).arrayBuffer();
        } catch (cause) {
          const detail = cause instanceof Error ? `: ${cause.message}` : "";
          throw zipError("SOURCE_INVALID", `ZIP Blob을 읽지 못했습니다${detail}`);
        }
        throwIfAborted(signal);
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength !== length) {
          throw zipError("SOURCE_INVALID", "ZIP Blob을 읽는 동안 크기가 변경되었습니다.");
        }
        return bytes;
      },
    };
  }
  throw zipError("SOURCE_INVALID", "지원하지 않는 ZIP 데이터 형식입니다.");
}

function uint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
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

function decodeAndValidatePath(bytes: Uint8Array, maxPathBytes: number): ValidatedPath {
  if (bytes.byteLength === 0 || bytes.byteLength > maxPathBytes) {
    throw zipError("PATH_INVALID", "ZIP 경로 길이가 허용 범위를 벗어났습니다.");
  }
  let decoded: string;
  try {
    decoded = textDecoder.decode(bytes);
  } catch {
    throw zipError("PATH_INVALID", "ZIP 경로가 올바른 UTF-8이 아닙니다.");
  }
  if (hasUnpairedSurrogate(decoded) || !equalBytes(textEncoder.encode(decoded), bytes)) {
    throw zipError("PATH_INVALID", "ZIP 경로의 Unicode 인코딩이 정규적이지 않습니다.");
  }
  const normalized = decoded.normalize("NFKC");
  if (normalized !== decoded) {
    throw zipError("PATH_INVALID", "ZIP 경로는 NFKC 정규형이어야 합니다.", decoded);
  }

  const directory = decoded.endsWith("/");
  const pathWithoutDirectorySlash = directory ? decoded.slice(0, -1) : decoded;
  if (
    pathWithoutDirectorySlash.length === 0 ||
    decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    /^[A-Za-z]:/u.test(decoded) ||
    UNSAFE_PATH_CHARACTER.test(decoded) ||
    UNSAFE_BIDI_CHARACTER.test(decoded) ||
    [...decoded].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    throw zipError("PATH_INVALID", "ZIP 경로에 절대 경로 또는 안전하지 않은 문자가 있습니다.", decoded);
  }

  for (const segment of pathWithoutDirectorySlash.split("/")) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.trim() !== segment ||
      /[. ]$/u.test(segment) ||
      WINDOWS_RESERVED_NAME.test(segment)
    ) {
      throw zipError("PATH_INVALID", "ZIP 경로에 안전하지 않은 구간이 있습니다.", decoded);
    }
  }

  return { path: decoded, comparisonKey: decoded.toLowerCase(), directory };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function validateExtraFields(bytes: Uint8Array, path?: string): void {
  let offset = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (offset < bytes.byteLength) {
    if (offset + 4 > bytes.byteLength) {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP extra field가 잘렸습니다.", path);
    }
    const id = uint16(view, offset);
    const length = uint16(view, offset + 2);
    offset += 4;
    if (offset + length > bytes.byteLength) {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP extra field 길이가 올바르지 않습니다.", path);
    }
    if (id === ZIP64_EXTRA_FIELD_ID) {
      throw zipError("ZIP64_UNSUPPORTED", "ZIP64 extra field는 지원하지 않습니다.", path);
    }
    offset += length;
  }
}

function validateFlags(flags: number, method: number, path?: string): void {
  if ((flags & ZIP_ENCRYPTED_FLAG) !== 0) {
    throw zipError("ENCRYPTED_UNSUPPORTED", "암호화된 ZIP 항목은 지원하지 않습니다.", path);
  }
  if ((flags & ZIP_DATA_DESCRIPTOR_FLAG) !== 0) {
    throw zipError(
      "DATA_DESCRIPTOR_UNSUPPORTED",
      "data descriptor를 사용하는 ZIP 항목은 지원하지 않습니다.",
      path
    );
  }
  if ((flags & ZIP_UTF8_FLAG) === 0) {
    throw zipError("PATH_INVALID", "ZIP 항목 경로에는 UTF-8 플래그가 필요합니다.", path);
  }
  const allowed = ZIP_UTF8_FLAG | (method === ZIP_DEFLATE_METHOD ? ZIP_DEFLATE_OPTION_FLAGS : 0);
  if ((flags & ~allowed) !== 0) {
    throw zipError("CENTRAL_DIRECTORY_INVALID", "지원하지 않는 ZIP 플래그가 있습니다.", path);
  }
}

async function locateEocd(
  reader: ByteReader,
  limits: StudioZipReaderLimits,
  signal?: AbortSignal
): Promise<LocatedEocd> {
  if (reader.size < ZIP_EOCD_BYTES) {
    throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP EOCD record가 없습니다.");
  }
  const tailBytes = Math.min(reader.size, ZIP_EOCD_BYTES + limits.maxCommentBytes);
  const tailOffset = reader.size - tailBytes;
  const tail = await reader.read(tailOffset, tailBytes, signal);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let relativeOffset = -1;
  for (let index = tail.byteLength - ZIP_EOCD_BYTES; index >= 0; index -= 1) {
    if (uint32(view, index) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentBytes = uint16(view, index + 20);
    if (index + ZIP_EOCD_BYTES + commentBytes === tail.byteLength) {
      relativeOffset = index;
      break;
    }
  }
  if (relativeOffset < 0) {
    throw zipError("CENTRAL_DIRECTORY_INVALID", "유효한 ZIP EOCD record를 찾지 못했습니다.");
  }

  const offset = tailOffset + relativeOffset;
  const disk = uint16(view, relativeOffset + 4);
  const centralDisk = uint16(view, relativeOffset + 6);
  const diskEntries = uint16(view, relativeOffset + 8);
  const entryCount = uint16(view, relativeOffset + 10);
  const centralBytes = uint32(view, relativeOffset + 12);
  const centralOffset = uint32(view, relativeOffset + 16);
  const commentBytes = uint16(view, relativeOffset + 20);

  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw zipError("MULTI_DISK_UNSUPPORTED", "분할 ZIP archive는 지원하지 않습니다.");
  }
  if (
    entryCount === ZIP16_MAX ||
    centralBytes === ZIP32_MAX ||
    centralOffset === ZIP32_MAX ||
    (relativeOffset >= 20 &&
      uint32(view, relativeOffset - 20) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE)
  ) {
    throw zipError("ZIP64_UNSUPPORTED", "ZIP64 archive는 지원하지 않습니다.");
  }
  if (entryCount > limits.maxEntries) {
    throw zipError("ENTRY_COUNT_LIMIT", "ZIP 항목 수가 안전 한도를 넘었습니다.");
  }
  if (centralBytes > limits.maxCentralDirectoryBytes) {
    throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP 중앙 디렉터리가 안전 한도를 넘었습니다.");
  }
  if (centralOffset + centralBytes !== offset) {
    throw zipError(
      "CENTRAL_DIRECTORY_INVALID",
      "ZIP 중앙 디렉터리가 EOCD와 맞닿아 있지 않습니다. 숨은 데이터가 있을 수 있습니다."
    );
  }
  safeRange(centralOffset, centralBytes, offset, "ZIP central directory");

  const zip64ProbeStart = Math.max(0, relativeOffset - 56);
  for (let index = zip64ProbeStart; index + 4 <= relativeOffset; index += 1) {
    if (uint32(view, index) === ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      throw zipError("ZIP64_UNSUPPORTED", "ZIP64 archive는 지원하지 않습니다.");
    }
  }

  let comment = "";
  if (commentBytes > 0) {
    try {
      comment = textDecoder.decode(
        tail.subarray(relativeOffset + ZIP_EOCD_BYTES, relativeOffset + ZIP_EOCD_BYTES + commentBytes)
      );
    } catch {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP comment가 올바른 UTF-8이 아닙니다.");
    }
  }
  return { offset, centralOffset, centralBytes, entryCount, comment };
}

function assertEntryBudgets(
  entry: Pick<CentralEntry, "compressedBytes" | "uncompressedBytes" | "compressionMethod" | "directory" | "path">,
  limits: StudioZipReaderLimits
): void {
  if (
    entry.compressedBytes > limits.maxEntryCompressedBytes ||
    entry.uncompressedBytes > limits.maxEntryUncompressedBytes
  ) {
    throw zipError("ENTRY_SIZE_LIMIT", "ZIP 항목 크기가 안전 한도를 넘었습니다.", entry.path);
  }
  if (entry.directory) {
    if (entry.compressedBytes !== 0 || entry.uncompressedBytes !== 0) {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP 디렉터리 항목은 비어 있어야 합니다.", entry.path);
    }
    return;
  }
  if (entry.compressionMethod === ZIP_STORE_METHOD) {
    if (entry.compressedBytes !== entry.uncompressedBytes) {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "stored ZIP 항목의 크기가 일치하지 않습니다.", entry.path);
    }
    return;
  }
  if (entry.uncompressedBytes === 0) return;
  if (
    entry.compressedBytes === 0 ||
    entry.uncompressedBytes / entry.compressedBytes > limits.maxCompressionRatio
  ) {
    throw zipError("ZIP_BOMB", "ZIP 항목의 압축률이 안전 한도를 넘었습니다.", entry.path);
  }
}

async function parseCentralDirectory(
  reader: ByteReader,
  eocd: LocatedEocd,
  limits: StudioZipReaderLimits,
  signal?: AbortSignal
): Promise<CentralEntry[]> {
  const bytes = await reader.read(eocd.centralOffset, eocd.centralBytes, signal);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: CentralEntry[] = [];
  const pathKinds = new Map<string, boolean>();
  let offset = 0;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < eocd.entryCount; index += 1) {
    throwIfAborted(signal);
    if (offset + ZIP_CENTRAL_HEADER_BYTES > bytes.byteLength) {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP 중앙 디렉터리 header가 잘렸습니다.");
    }
    if (uint32(view, offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP 중앙 디렉터리 signature가 올바르지 않습니다.");
    }

    const versionNeeded = uint16(view, offset + 6);
    const flags = uint16(view, offset + 8);
    const method = uint16(view, offset + 10);
    const crc32 = uint32(view, offset + 16);
    const compressedBytes = uint32(view, offset + 20);
    const uncompressedBytes = uint32(view, offset + 24);
    const pathBytesLength = uint16(view, offset + 28);
    const extraBytesLength = uint16(view, offset + 30);
    const commentBytesLength = uint16(view, offset + 32);
    const diskStart = uint16(view, offset + 34);
    const localHeaderOffset = uint32(view, offset + 42);

    if (
      versionNeeded >= 45 ||
      compressedBytes === ZIP32_MAX ||
      uncompressedBytes === ZIP32_MAX ||
      localHeaderOffset === ZIP32_MAX
    ) {
      throw zipError("ZIP64_UNSUPPORTED", "ZIP64 항목은 지원하지 않습니다.");
    }
    if (versionNeeded > 20) {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "지원하지 않는 ZIP 버전입니다.");
    }
    if (diskStart !== 0) {
      throw zipError("MULTI_DISK_UNSUPPORTED", "분할 ZIP 항목은 지원하지 않습니다.");
    }
    if (method !== ZIP_STORE_METHOD && method !== ZIP_DEFLATE_METHOD) {
      throw zipError("COMPRESSION_UNSUPPORTED", `ZIP compression method ${method}는 지원하지 않습니다.`);
    }
    validateFlags(flags, method);

    const recordEnd = offset + ZIP_CENTRAL_HEADER_BYTES + pathBytesLength + extraBytesLength + commentBytesLength;
    if (recordEnd > bytes.byteLength) {
      throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP 중앙 디렉터리 record가 잘렸습니다.");
    }
    const pathBytes = bytes.slice(
      offset + ZIP_CENTRAL_HEADER_BYTES,
      offset + ZIP_CENTRAL_HEADER_BYTES + pathBytesLength
    );
    const path = decodeAndValidatePath(pathBytes, limits.maxPathBytes);
    validateFlags(flags, method, path.path);
    const pathKey = path.directory
      ? path.comparisonKey.slice(0, -1)
      : path.comparisonKey;
    if (pathKinds.has(pathKey)) {
      throw zipError("PATH_DUPLICATE", "대소문자·정규화 충돌 ZIP 경로가 있습니다.", path.path);
    }
    const segments = pathKey.split("/");
    for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
      const parentKey = segments.slice(0, segmentIndex).join("/");
      if (pathKinds.get(parentKey) === false) {
        throw zipError("PATH_DUPLICATE", "ZIP 파일 경로가 다른 파일의 하위 경로와 충돌합니다.", path.path);
      }
    }
    if (!path.directory) {
      for (const existingKey of pathKinds.keys()) {
        if (existingKey.startsWith(`${pathKey}/`)) {
          throw zipError("PATH_DUPLICATE", "ZIP 파일 경로가 기존 하위 경로와 충돌합니다.", path.path);
        }
      }
    }
    pathKinds.set(pathKey, path.directory);
    validateExtraFields(
      bytes.subarray(
        offset + ZIP_CENTRAL_HEADER_BYTES + pathBytesLength,
        offset + ZIP_CENTRAL_HEADER_BYTES + pathBytesLength + extraBytesLength
      ),
      path.path
    );

    const entry: CentralEntry = {
      path: path.path,
      directory: path.directory,
      compressionMethod: method,
      compressedBytes,
      uncompressedBytes,
      crc32,
      localHeaderOffset,
      dataOffset: 0,
      flags,
      versionNeeded,
      pathBytes,
    };
    assertEntryBudgets(entry, limits);
    totalUncompressedBytes += uncompressedBytes;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw zipError("TOTAL_SIZE_LIMIT", "ZIP 전체 해제 크기가 안전 한도를 넘었습니다.");
    }
    entries.push(entry);
    offset = recordEnd;
  }
  if (offset !== bytes.byteLength) {
    throw zipError("CENTRAL_DIRECTORY_INVALID", "ZIP 중앙 디렉터리에 설명되지 않은 데이터가 있습니다.");
  }
  return entries;
}

async function validateLocalRecords(
  reader: ByteReader,
  entries: CentralEntry[],
  centralOffset: number,
  signal?: AbortSignal
): Promise<CentralEntry[]> {
  const localEntries = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  let expectedOffset = 0;
  for (const entry of localEntries) {
    throwIfAborted(signal);
    if (entry.localHeaderOffset !== expectedOffset) {
      throw zipError(
        "LOCAL_HEADER_INVALID",
        "ZIP local record 사이에 겹침, 빈 구간 또는 숨은 데이터가 있습니다.",
        entry.path
      );
    }
    if (entry.localHeaderOffset + ZIP_LOCAL_HEADER_BYTES > centralOffset) {
      throw zipError("LOCAL_HEADER_INVALID", "ZIP local header가 중앙 디렉터리를 침범합니다.", entry.path);
    }
    const header = await reader.read(entry.localHeaderOffset, ZIP_LOCAL_HEADER_BYTES, signal);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (uint32(view, 0) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw zipError("LOCAL_HEADER_INVALID", "ZIP local header signature가 올바르지 않습니다.", entry.path);
    }
    const pathBytesLength = uint16(view, 26);
    const extraBytesLength = uint16(view, 28);
    const variableBytes = await reader.read(
      entry.localHeaderOffset + ZIP_LOCAL_HEADER_BYTES,
      pathBytesLength + extraBytesLength,
      signal
    );
    const localPathBytes = variableBytes.subarray(0, pathBytesLength);
    const localExtraBytes = variableBytes.subarray(pathBytesLength);
    validateExtraFields(localExtraBytes, entry.path);

    if (
      uint16(view, 4) !== entry.versionNeeded ||
      uint16(view, 6) !== entry.flags ||
      uint16(view, 8) !== entry.compressionMethod ||
      uint32(view, 14) !== entry.crc32 ||
      uint32(view, 18) !== entry.compressedBytes ||
      uint32(view, 22) !== entry.uncompressedBytes ||
      !equalBytes(localPathBytes, entry.pathBytes)
    ) {
      throw zipError("LOCAL_HEADER_INVALID", "ZIP local header와 중앙 디렉터리가 일치하지 않습니다.", entry.path);
    }
    const dataOffset = entry.localHeaderOffset + ZIP_LOCAL_HEADER_BYTES + pathBytesLength + extraBytesLength;
    const dataEnd = dataOffset + entry.compressedBytes;
    if (!Number.isSafeInteger(dataEnd) || dataEnd > centralOffset) {
      throw zipError("LOCAL_HEADER_INVALID", "ZIP 항목 데이터가 중앙 디렉터리를 침범합니다.", entry.path);
    }
    entry.dataOffset = dataOffset;
    expectedOffset = dataEnd;
  }
  if (expectedOffset !== centralOffset) {
    throw zipError("LOCAL_HEADER_INVALID", "ZIP local record 끝에 설명되지 않은 데이터가 있습니다.");
  }
  return localEntries;
}

function calculateCrc32(bytes: Uint8Array, signal?: AbortSignal): number {
  let crc = 0xffff_ffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if ((index & 0xffff) === 0) throwIfAborted(signal);
    crc = (crc >>> 8) ^ (crc32Table[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function inflateWithDecompressionStream(
  compressed: Uint8Array,
  context: StudioZipInflateContext
): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw zipError(
      "DECOMPRESSION_UNAVAILABLE",
      "이 환경에는 raw-DEFLATE 해제기가 없습니다. inflateRaw adapter를 제공해 주세요.",
      context.path
    );
  }
  let stream: ReadableStream<Uint8Array>;
  try {
    const source = new Blob([compressed.slice().buffer]).stream();
    stream = source.pipeThrough(
      new DecompressionStream("deflate-raw" as CompressionFormat)
    ) as ReadableStream<Uint8Array>;
  } catch (cause) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw zipError(
      "DECOMPRESSION_UNAVAILABLE",
      `raw-DEFLATE 스트림을 만들지 못했습니다${detail}`,
      context.path
    );
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  const streamReader = stream.getReader();
  try {
    for (;;) {
      throwIfAborted(context.signal);
      const result = await streamReader.read();
      if (result.done) break;
      const chunk = result.value;
      size += chunk.byteLength;
      if (size > context.expectedBytes) {
        await streamReader.cancel();
        throw zipError("ZIP_BOMB", "ZIP 항목이 선언한 해제 크기를 넘었습니다.", context.path);
      }
      chunks.push(chunk);
    }
  } catch (cause) {
    if (cause instanceof StudioZipReaderError) throw cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    throw zipError("DECOMPRESSION_FAILED", `ZIP 항목 해제에 실패했습니다${detail}`, context.path);
  } finally {
    streamReader.releaseLock();
  }

  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function resolveArchiveEntry(
  entriesByPath: ReadonlyMap<string, StudioZipEntry>,
  value: StudioZipEntry | string
): StudioZipEntry {
  const path = typeof value === "string" ? value : value.path;
  const entry = entriesByPath.get(path);
  if (!entry) throw zipError("ENTRY_NOT_FOUND", "ZIP 항목을 찾지 못했습니다.", path);
  return entry;
}

/** Parse and validate a ZIP archive without eagerly inflating its entries. */
export async function readStudioZipArchive(
  source: StudioZipReaderSource,
  options: StudioZipReaderOptions = {}
): Promise<StudioZipArchive> {
  const limits = resolveLimits(options.limits);
  throwIfAborted(options.signal);
  const reader = createByteReader(source);
  if (!Number.isSafeInteger(reader.size) || reader.size < 0) {
    throw zipError("SOURCE_INVALID", "ZIP archive 크기가 올바르지 않습니다.");
  }
  if (reader.size > limits.maxArchiveBytes) {
    throw zipError("ARCHIVE_SIZE_LIMIT", "ZIP archive가 안전 한도를 넘었습니다.");
  }

  const eocd = await locateEocd(reader, limits, options.signal);
  const centralEntries = await parseCentralDirectory(reader, eocd, limits, options.signal);
  const localEntries = await validateLocalRecords(
    reader,
    centralEntries,
    eocd.centralOffset,
    options.signal
  );
  const publicEntries = Object.freeze(
    localEntries.map((entry) =>
      Object.freeze({
        path: entry.path,
        directory: entry.directory,
        compressionMethod: entry.compressionMethod,
        compressedBytes: entry.compressedBytes,
        uncompressedBytes: entry.uncompressedBytes,
        crc32: entry.crc32,
        localHeaderOffset: entry.localHeaderOffset,
        dataOffset: entry.dataOffset,
      })
    )
  );
  const entriesByPath = new Map(publicEntries.map((entry) => [entry.path, entry]));

  async function readEntry(
    value: StudioZipEntry | string,
    readOptions: StudioZipReadEntryOptions = {}
  ): Promise<Uint8Array> {
    const entry = resolveArchiveEntry(entriesByPath, value);
    const signal = readOptions.signal ?? options.signal;
    throwIfAborted(signal);
    if (entry.directory) return new Uint8Array();
    const compressed = await reader.read(entry.dataOffset, entry.compressedBytes, signal);
    let bytes: Uint8Array;
    if (entry.compressionMethod === ZIP_STORE_METHOD) {
      bytes = compressed;
    } else {
      const inflate = options.inflateRaw ?? inflateWithDecompressionStream;
      try {
        bytes = await inflate(compressed, {
          path: entry.path,
          expectedBytes: entry.uncompressedBytes,
          signal,
        });
      } catch (cause) {
        if (cause instanceof StudioZipReaderError) throw cause;
        const detail = cause instanceof Error ? `: ${cause.message}` : "";
        throw zipError("DECOMPRESSION_FAILED", `ZIP 항목 해제에 실패했습니다${detail}`, entry.path);
      }
      if (!(bytes instanceof Uint8Array)) {
        throw zipError("DECOMPRESSION_FAILED", "inflateRaw adapter가 Uint8Array를 반환하지 않았습니다.", entry.path);
      }
    }
    throwIfAborted(signal);
    if (bytes.byteLength !== entry.uncompressedBytes) {
      throw zipError("DECOMPRESSION_FAILED", "ZIP 항목의 실제 해제 크기가 선언과 다릅니다.", entry.path);
    }
    if (calculateCrc32(bytes, signal) !== entry.crc32) {
      throw zipError("CRC_MISMATCH", "ZIP 항목 CRC-32가 일치하지 않습니다.", entry.path);
    }
    return bytes.slice();
  }

  return Object.freeze({
    entries: publicEntries,
    comment: eocd.comment,
    getEntry(path: string) {
      return entriesByPath.get(path);
    },
    readEntry,
    async readEntryBlob(
      value: StudioZipEntry | string,
      mimeType = "application/octet-stream",
      readOptions: StudioZipReadEntryOptions = {}
    ) {
      const bytes = await readEntry(value, readOptions);
      const blobBytes = new Uint8Array(bytes.byteLength);
      blobBytes.set(bytes);
      return new Blob([blobBytes.buffer], { type: mimeType });
    },
  });
}
