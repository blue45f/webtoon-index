import {
  buildCreatorMarketplaceAuthoringManifest,
  normalizeCreatorMarketplaceAuthoringDraft,
  serializeCreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringDraft,
} from "./creator-marketplace-authoring-workshop";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const MAX_SOURCE_FILES = 64;
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 256;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

export interface CreatorMarketplacePackageInventoryEntry {
  path: string;
  role: "manifest" | "authoring-draft" | "source";
  bytes: number;
  sha256: string;
  mediaType: string;
}

export interface CreatorMarketplaceBuiltPackage {
  file: File;
  inventory: readonly CreatorMarketplacePackageInventoryEntry[];
  manifest: Readonly<Record<string, unknown>>;
}

export class CreatorMarketplacePackageError extends Error {
  readonly code:
    | "file-count"
    | "file-size"
    | "package-size"
    | "unsafe-name"
    | "invalid-archive"
    | "unsupported-compression"
    | "manifest-missing"
    | "manifest-size";

  constructor(code: CreatorMarketplacePackageError["code"], message: string) {
    super(message);
    this.name = "CreatorMarketplacePackageError";
    this.code = code;
  }
}

interface ZipEntryInput {
  path: string;
  role: CreatorMarketplacePackageInventoryEntry["role"];
  bytes: Uint8Array;
  mediaType: string;
}

interface PreparedZipEntry extends ZipEntryInput {
  pathBytes: Uint8Array;
  crc32: number;
  offset: number;
  dosDate: number;
  dosTime: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decode(value: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function header(size: number): { bytes: Uint8Array; view: DataView } {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

function dateToDos(value: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, value.getUTCFullYear()));
  return {
    date: ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate(),
    time: (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | Math.floor(value.getUTCSeconds() / 2),
  };
}

function replaceUnsafeNameCharacters(value: string, forbidden: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || forbidden.includes(character) ? "-" : character;
  }).join("");
}

function safePackageBaseName(value: string): string {
  const normalized = replaceUnsafeNameCharacters(
    value.normalize("NFKC"),
    "\\/:*?\"<>|",
  )
    .replace(/\s+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  return normalized || "marketplace-asset";
}

export function sanitizeCreatorMarketplaceArchivePath(value: string): string {
  const normalized = value.normalize("NFKC").replaceAll("\\", "/");
  const parts = normalized
    .split("/")
    .filter((part) => part.length > 0 && part !== ".")
    .map((part) => replaceUnsafeNameCharacters(part, ":*?\"<>|").slice(0, 120));
  if (parts.some((part) => part === "..") || parts.length === 0) {
    throw new CreatorMarketplacePackageError("unsafe-name", "안전하지 않은 패키지 파일 이름입니다.");
  }
  return parts.join("/");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestInput = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readFileBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function makeStoredZip(entries: readonly ZipEntryInput[]): Uint8Array {
  const prepared: PreparedZipEntry[] = [];
  const localParts: Uint8Array[] = [];
  let offset = 0;
  const now = dateToDos(new Date());

  for (const entry of entries) {
    const pathBytes = encode(entry.path);
    const local = header(30);
    local.view.setUint32(0, ZIP_LOCAL_FILE_HEADER, true);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, ZIP_UTF8_FLAG, true);
    local.view.setUint16(8, ZIP_STORE_METHOD, true);
    local.view.setUint16(10, now.time, true);
    local.view.setUint16(12, now.date, true);
    local.view.setUint32(14, crc32(entry.bytes), true);
    local.view.setUint32(18, entry.bytes.byteLength, true);
    local.view.setUint32(22, entry.bytes.byteLength, true);
    local.view.setUint16(26, pathBytes.byteLength, true);
    local.view.setUint16(28, 0, true);
    localParts.push(local.bytes, pathBytes, entry.bytes);
    prepared.push({
      ...entry,
      pathBytes,
      crc32: crc32(entry.bytes),
      offset,
      dosDate: now.date,
      dosTime: now.time,
    });
    offset += local.bytes.byteLength + pathBytes.byteLength + entry.bytes.byteLength;
  }

  const centralStart = offset;
  const centralParts: Uint8Array[] = [];
  for (const entry of prepared) {
    const central = header(46);
    central.view.setUint32(0, ZIP_CENTRAL_DIRECTORY_HEADER, true);
    central.view.setUint16(4, 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, ZIP_UTF8_FLAG, true);
    central.view.setUint16(10, ZIP_STORE_METHOD, true);
    central.view.setUint16(12, entry.dosTime, true);
    central.view.setUint16(14, entry.dosDate, true);
    central.view.setUint32(16, entry.crc32, true);
    central.view.setUint32(20, entry.bytes.byteLength, true);
    central.view.setUint32(24, entry.bytes.byteLength, true);
    central.view.setUint16(28, entry.pathBytes.byteLength, true);
    central.view.setUint16(30, 0, true);
    central.view.setUint16(32, 0, true);
    central.view.setUint16(34, 0, true);
    central.view.setUint16(36, 0, true);
    central.view.setUint32(38, 0, true);
    central.view.setUint32(42, entry.offset, true);
    centralParts.push(central.bytes, entry.pathBytes);
    offset += central.bytes.byteLength + entry.pathBytes.byteLength;
  }

  const centralSize = offset - centralStart;
  const end = header(22);
  end.view.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY, true);
  end.view.setUint16(4, 0, true);
  end.view.setUint16(6, 0, true);
  end.view.setUint16(8, prepared.length, true);
  end.view.setUint16(10, prepared.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, centralStart, true);
  end.view.setUint16(20, 0, true);
  return concat([...localParts, ...centralParts, end.bytes]);
}

export async function buildCreatorMarketplaceSourcePackage({
  draft: draftInput,
  sourceFiles = [],
}: {
  draft: CreatorMarketplaceAuthoringDraft;
  sourceFiles?: readonly File[];
}): Promise<CreatorMarketplaceBuiltPackage> {
  if (sourceFiles.length > MAX_SOURCE_FILES) {
    throw new CreatorMarketplacePackageError(
      "file-count",
      `원본 파일은 최대 ${MAX_SOURCE_FILES}개까지 묶을 수 있습니다.`,
    );
  }
  const draft = normalizeCreatorMarketplaceAuthoringDraft(draftInput);
  const manifest = buildCreatorMarketplaceAuthoringManifest(draft);
  const draftBytes = encode(serializeCreatorMarketplaceAuthoringDraft(draft));
  const baseManifest = JSON.stringify(manifest, null, 2);
  const entries: ZipEntryInput[] = [
    {
      path: "authoring/draft.json",
      role: "authoring-draft",
      bytes: draftBytes,
      mediaType: "application/json",
    },
  ];

  const usedNames = new Set<string>();
  let projectedBytes = draftBytes.byteLength + encode(baseManifest).byteLength;
  for (const [index, file] of sourceFiles.entries()) {
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      throw new CreatorMarketplacePackageError(
        "file-size",
        `${file.name} 파일이 ${(MAX_SOURCE_FILE_BYTES / 1024 / 1024).toFixed(0)}MB 제한을 초과했습니다.`,
      );
    }
    projectedBytes += file.size;
    if (projectedBytes > MAX_PACKAGE_BYTES) {
      throw new CreatorMarketplacePackageError(
        "package-size",
        `패키지가 ${(MAX_PACKAGE_BYTES / 1024 / 1024).toFixed(0)}MB 제한을 초과했습니다.`,
      );
    }
    const base = sanitizeCreatorMarketplaceArchivePath(file.name || `source-${index + 1}.bin`);
    let path = `source/${base}`;
    let suffix = 2;
    while (usedNames.has(path.toLowerCase())) {
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const extension = dot > 0 ? base.slice(dot) : "";
      path = `source/${stem}-${suffix}${extension}`;
      suffix += 1;
    }
    usedNames.add(path.toLowerCase());
    entries.push({
      path,
      role: "source",
      bytes: await readFileBytes(file),
      mediaType: file.type || "application/octet-stream",
    });
  }

  const inventory: CreatorMarketplacePackageInventoryEntry[] = [];
  for (const entry of entries) {
    inventory.push({
      path: entry.path,
      role: entry.role,
      bytes: entry.bytes.byteLength,
      sha256: await sha256(entry.bytes),
      mediaType: entry.mediaType,
    });
  }
  const manifestWithInventory = {
    ...manifest,
    package: {
      format: "toonspectrum-marketplace-package",
      version: 1,
      archive: "zip-store",
      inventory,
    },
  } as const;
  const manifestBytes = encode(JSON.stringify(manifestWithInventory, null, 2));
  inventory.unshift({
    path: "manifest.json",
    role: "manifest",
    bytes: manifestBytes.byteLength,
    sha256: await sha256(manifestBytes),
    mediaType: "application/json",
  });
  entries.unshift({
    path: "manifest.json",
    role: "manifest",
    bytes: manifestBytes,
    mediaType: "application/json",
  });

  const archive = makeStoredZip(entries);
  if (archive.byteLength > MAX_PACKAGE_BYTES) {
    throw new CreatorMarketplacePackageError(
      "package-size",
      `패키지가 ${(MAX_PACKAGE_BYTES / 1024 / 1024).toFixed(0)}MB 제한을 초과했습니다.`,
    );
  }
  const fileName = `${safePackageBaseName(draft.title)}-${safePackageBaseName(draft.release.version)}.toonmarket.zip`;
  const ownedArchive = Uint8Array.from(archive);
  return {
    file: new File([ownedArchive.buffer], fileName, {
      type: "application/vnd.toonspectrum.marketplace+zip",
    }),
    inventory,
    manifest: manifestWithInventory,
  };
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

export function extractCreatorMarketplaceManifestFromZip(input: ArrayBuffer | Uint8Array): unknown {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_PACKAGE_BYTES) {
    throw new CreatorMarketplacePackageError("package-size", "마켓 패키지가 허용 크기를 초과했습니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(bytes);
  if (end < 0) throw new CreatorMarketplacePackageError("invalid-archive", "ZIP 중앙 디렉터리를 찾지 못했습니다.");
  const entryCount = view.getUint16(end + 10, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (entryCount > MAX_ARCHIVE_ENTRIES || centralOffset >= bytes.byteLength) {
    throw new CreatorMarketplacePackageError("invalid-archive", "ZIP 엔트리 수 또는 오프셋이 잘못되었습니다.");
  }

  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new CreatorMarketplacePackageError("invalid-archive", "ZIP 중앙 디렉터리가 손상되었습니다.");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) {
      throw new CreatorMarketplacePackageError("invalid-archive", "ZIP 파일 이름이 손상되었습니다.");
    }
    const path = sanitizeCreatorMarketplaceArchivePath(decode(bytes.subarray(nameStart, nameEnd)));
    if (path === "manifest.json") {
      if (method !== ZIP_STORE_METHOD) {
        throw new CreatorMarketplacePackageError(
          "unsupported-compression",
          "압축된 manifest는 현재 브라우저 복구 경로에서 지원하지 않습니다.",
        );
      }
      if (uncompressedSize > MAX_MANIFEST_BYTES || compressedSize !== uncompressedSize) {
        throw new CreatorMarketplacePackageError("manifest-size", "manifest 크기가 허용 범위를 초과했습니다.");
      }
      if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE_HEADER) {
        throw new CreatorMarketplacePackageError("invalid-archive", "manifest 로컬 헤더가 손상되었습니다.");
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + uncompressedSize;
      if (dataEnd > bytes.byteLength) {
        throw new CreatorMarketplacePackageError("invalid-archive", "manifest 데이터가 잘렸습니다.");
      }
      return JSON.parse(decode(bytes.subarray(dataStart, dataEnd)));
    }
    cursor = nameEnd + extraLength + commentLength;
  }
  throw new CreatorMarketplacePackageError("manifest-missing", "패키지에 manifest.json이 없습니다.");
}
