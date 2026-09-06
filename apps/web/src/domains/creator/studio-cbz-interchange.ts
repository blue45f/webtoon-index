import {
  buildStudioPackageArchiveBlob,
  buildStudioPackageArchiveBytes,
  type StudioPackageArchiveEntry,
  type StudioPackageArchiveSource,
} from "./studio-package-archive";
import {
  readStudioZipArchive,
  StudioZipReaderError,
  type StudioZipArchive,
  type StudioZipEntry,
  type StudioZipInflateRawAdapter,
  type StudioZipReaderLimits,
} from "./studio-zip-reader";

import type { StudioCrc32ExecutionMode } from "./studio-crc32-worker-client";

/** Bounded CBZ + ComicInfo.xml interchange for page-oriented webtoon handoff. */

export const STUDIO_CBZ_MIME = "application/vnd.comicbook+zip" as const;
export const STUDIO_CBZ_EXTENSION = ".cbz" as const;

export const STUDIO_CBZ_LIMITS = Object.freeze({
  maxArchiveBytes: 520_000_000,
  maxArchiveEntries: 1_163,
  maxPages: 1_099,
  maxPageBytes: 192_000_000,
  maxTotalPageBytes: 510_000_000,
  maxPageDimension: 131_072,
  maxPagePixels: 67_108_864,
  maxTotalDecodedPixels: 134_217_728,
  maxTotalDecodedBytes: 536_870_912,
  maxCompressionRatio: 100,
  maxComicInfoBytes: 1_000_000,
  maxMetadataCharacters: 100_000,
  maxComicInfoElements: 4_096,
  maxComicInfoDepth: 64,
  maxComicInfoAttributesPerElement: 32,
  maxComicInfoTextCharacters: 200_000,
});

export interface StudioCbzLimits {
  maxArchiveBytes: number;
  maxArchiveEntries: number;
  maxPages: number;
  maxPageBytes: number;
  maxTotalPageBytes: number;
  maxPageDimension: number;
  maxPagePixels: number;
  maxTotalDecodedPixels: number;
  maxTotalDecodedBytes: number;
  maxCompressionRatio: number;
  maxComicInfoBytes: number;
  maxMetadataCharacters: number;
  maxComicInfoElements: number;
  maxComicInfoDepth: number;
  maxComicInfoAttributesPerElement: number;
  maxComicInfoTextCharacters: number;
}

export type StudioCbzPageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

export interface StudioCbzPageInput {
  image: StudioPackageArchiveSource;
}

export interface StudioComicInfoMetadata {
  title?: string;
  series?: string;
  number?: string;
  count?: number;
  volume?: number;
  summary?: string;
  notes?: string;
  year?: number;
  month?: number;
  day?: number;
  writer?: string;
  penciller?: string;
  inker?: string;
  colorist?: string;
  letterer?: string;
  coverArtist?: string;
  editor?: string;
  publisher?: string;
  imprint?: string;
  genre?: readonly string[];
  tags?: readonly string[];
  web?: string;
  languageISO?: string;
  format?: string;
  ageRating?: string;
  blackAndWhite?: boolean;
  manga?: string;
}

export interface StudioCbzExportInput {
  /** Page reading order. Canonical zero-padded paths preserve it across readers. */
  pages: readonly StudioCbzPageInput[];
  metadata?: StudioComicInfoMetadata;
}

export interface StudioCbzExportOptions {
  limits?: Partial<StudioCbzLimits>;
  signal?: AbortSignal;
  /** Fixed before ZIP construction. Browser product callers select `worker`. */
  crc32ExecutionMode?: StudioCrc32ExecutionMode;
}

export interface StudioCbzImportOptions extends StudioCbzExportOptions {
  inflateRaw?: StudioZipInflateRawAdapter;
}

export type StudioCbzWarningCode =
  | "COMICINFO_MISSING"
  | "IGNORED_ENTRY"
  | "PAGE_COUNT_MISMATCH";

export interface StudioCbzWarning {
  code: StudioCbzWarningCode;
  message: string;
  path?: string;
}

export interface StudioCbzBuildBytesResult {
  bytes: Uint8Array;
  warnings: readonly StudioCbzWarning[];
}

export interface StudioCbzBuildBlobResult {
  blob: Blob;
  warnings: readonly StudioCbzWarning[];
}

export interface StudioCbzImportedPage {
  index: number;
  path: string;
  mimeType: StudioCbzPageMimeType;
  byteSize: number;
  /** Header-authenticated dimensions used by page layout before browser decoding. */
  width: number;
  height: number;
  pixelCount: number;
  frameCount: number;
  decodedPixelCount: number;
  /** Conservative RGBA8 working-set estimate, not the encoded Blob size. */
  decodedByteSize: number;
  image: Blob;
}

export interface StudioCbzImportSummary {
  pageCount: number;
  totalEncodedBytes: number;
  totalDecodedPixels: number;
  totalDecodedBytes: number;
  maxWidth: number;
  maxHeight: number;
  hasComicInfo: boolean;
  ignoredEntryCount: number;
}

export interface StudioCbzImportResult {
  pages: readonly StudioCbzImportedPage[];
  metadata: Readonly<StudioComicInfoMetadata>;
  summary: Readonly<StudioCbzImportSummary>;
  warnings: readonly StudioCbzWarning[];
}

export type StudioCbzErrorCode =
  | "ABORTED"
  | "ARCHIVE_INVALID"
  | "COMICINFO_INVALID"
  | "IMAGE_INVALID"
  | "LIMIT_INVALID"
  | "PAGE_COUNT_LIMIT"
  | "SIZE_LIMIT";

export class StudioCbzError extends Error {
  readonly code: StudioCbzErrorCode;
  readonly path?: string;

  constructor(code: StudioCbzErrorCode, message: string, path?: string) {
    super(message);
    this.name = "StudioCbzError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}

interface DetectedPage {
  mimeType: StudioCbzPageMimeType;
  extension: "png" | "jpg" | "webp" | "gif";
  width: number;
  height: number;
  pixelCount: number;
  frameCount: number;
  decodedPixelCount: number;
  decodedByteSize: number;
}

interface PreparedCbz {
  entries: StudioPackageArchiveEntry[];
  warnings: StudioCbzWarning[];
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_CONTAINER_RECORDS = 131_072;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function cbzError(code: StudioCbzErrorCode, message: string, path?: string): StudioCbzError {
  return new StudioCbzError(code, message, path);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cbzError("ABORTED", "CBZ 작업이 취소되었습니다.");
}

function resolveIntegerLimit(
  value: number | undefined,
  maximum: number,
  key: keyof StudioCbzLimits,
  minimum = 0
): number {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw cbzError(
      "LIMIT_INVALID",
      `${key} 한도는 ${minimum.toLocaleString("en-US")} 이상 ${maximum.toLocaleString("en-US")} 이하의 정수여야 합니다.`
    );
  }
  return value;
}

function resolveLimits(value?: Partial<StudioCbzLimits>): StudioCbzLimits {
  return {
    maxArchiveBytes: resolveIntegerLimit(
      value?.maxArchiveBytes,
      STUDIO_CBZ_LIMITS.maxArchiveBytes,
      "maxArchiveBytes"
    ),
    maxArchiveEntries: resolveIntegerLimit(
      value?.maxArchiveEntries,
      STUDIO_CBZ_LIMITS.maxArchiveEntries,
      "maxArchiveEntries"
    ),
    maxPages: resolveIntegerLimit(value?.maxPages, STUDIO_CBZ_LIMITS.maxPages, "maxPages"),
    maxPageBytes: resolveIntegerLimit(
      value?.maxPageBytes,
      STUDIO_CBZ_LIMITS.maxPageBytes,
      "maxPageBytes"
    ),
    maxTotalPageBytes: resolveIntegerLimit(
      value?.maxTotalPageBytes,
      STUDIO_CBZ_LIMITS.maxTotalPageBytes,
      "maxTotalPageBytes"
    ),
    maxPageDimension: resolveIntegerLimit(
      value?.maxPageDimension,
      STUDIO_CBZ_LIMITS.maxPageDimension,
      "maxPageDimension"
    ),
    maxPagePixels: resolveIntegerLimit(
      value?.maxPagePixels,
      STUDIO_CBZ_LIMITS.maxPagePixels,
      "maxPagePixels"
    ),
    maxTotalDecodedPixels: resolveIntegerLimit(
      value?.maxTotalDecodedPixels,
      STUDIO_CBZ_LIMITS.maxTotalDecodedPixels,
      "maxTotalDecodedPixels"
    ),
    maxTotalDecodedBytes: resolveIntegerLimit(
      value?.maxTotalDecodedBytes,
      STUDIO_CBZ_LIMITS.maxTotalDecodedBytes,
      "maxTotalDecodedBytes"
    ),
    maxCompressionRatio: resolveIntegerLimit(
      value?.maxCompressionRatio,
      STUDIO_CBZ_LIMITS.maxCompressionRatio,
      "maxCompressionRatio",
      1
    ),
    maxComicInfoBytes: resolveIntegerLimit(
      value?.maxComicInfoBytes,
      STUDIO_CBZ_LIMITS.maxComicInfoBytes,
      "maxComicInfoBytes"
    ),
    maxMetadataCharacters: resolveIntegerLimit(
      value?.maxMetadataCharacters,
      STUDIO_CBZ_LIMITS.maxMetadataCharacters,
      "maxMetadataCharacters"
    ),
    maxComicInfoElements: resolveIntegerLimit(
      value?.maxComicInfoElements,
      STUDIO_CBZ_LIMITS.maxComicInfoElements,
      "maxComicInfoElements"
    ),
    maxComicInfoDepth: resolveIntegerLimit(
      value?.maxComicInfoDepth,
      STUDIO_CBZ_LIMITS.maxComicInfoDepth,
      "maxComicInfoDepth"
    ),
    maxComicInfoAttributesPerElement: resolveIntegerLimit(
      value?.maxComicInfoAttributesPerElement,
      STUDIO_CBZ_LIMITS.maxComicInfoAttributesPerElement,
      "maxComicInfoAttributesPerElement"
    ),
    maxComicInfoTextCharacters: resolveIntegerLimit(
      value?.maxComicInfoTextCharacters,
      STUDIO_CBZ_LIMITS.maxComicInfoTextCharacters,
      "maxComicInfoTextCharacters"
    ),
  };
}

function snapshotSource(source: unknown, path: string): StudioPackageArchiveSource {
  if (source instanceof Uint8Array) return source.slice();
  if (source instanceof ArrayBuffer) return source.slice(0);
  if (typeof Blob !== "undefined" && source instanceof Blob) return source;
  throw cbzError("IMAGE_INVALID", "지원하지 않는 CBZ 페이지 데이터입니다.", path);
}

function sourceSize(source: StudioPackageArchiveSource): number {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return source.byteLength;
  return source.size;
}

async function sourceBytes(
  source: StudioPackageArchiveSource,
  path: string,
  signal?: AbortSignal
): Promise<Uint8Array> {
  throwIfAborted(signal);
  let bytes: Uint8Array;
  if (source instanceof Uint8Array) bytes = source;
  else if (source instanceof ArrayBuffer) bytes = new Uint8Array(source);
  else {
    try {
      bytes = new Uint8Array(await source.arrayBuffer());
    } catch (cause) {
      const detail = cause instanceof Error ? `: ${cause.message}` : "";
      throw cbzError("IMAGE_INVALID", `CBZ 페이지를 읽지 못했습니다${detail}`, path);
    }
  }
  throwIfAborted(signal);
  return bytes;
}

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  if (bytes.byteLength < signature.byteLength) return false;
  for (let index = 0; index < signature.byteLength; index += 1) {
    if (bytes[index] !== signature[index]) return false;
  }
  return true;
}

function detectedPage(
  mimeType: StudioCbzPageMimeType,
  extension: DetectedPage["extension"],
  width: number,
  height: number,
  frameCount = 1
): DetectedPage | undefined {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(frameCount) ||
    width <= 0 ||
    height <= 0 ||
    frameCount <= 0
  ) {
    return undefined;
  }
  const pixelCount = width * height;
  const decodedPixelCount = pixelCount * frameCount;
  const decodedByteSize = decodedPixelCount * 4;
  if (
    !Number.isSafeInteger(pixelCount) ||
    !Number.isSafeInteger(decodedPixelCount) ||
    !Number.isSafeInteger(decodedByteSize)
  ) {
    return undefined;
  }
  return {
    mimeType,
    extension,
    width,
    height,
    pixelCount,
    frameCount,
    decodedPixelCount,
    decodedByteSize,
  };
}

function ascii4(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0
  );
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function detectPng(bytes: Uint8Array): DetectedPage | undefined {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.byteLength < 45) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.byteLength;
  let dimensions: DetectedPage | undefined;
  let sawImageData = false;
  let sawEnd = false;
  let declaredAnimationFrames: number | undefined;
  let frameControlCount = 0;
  let records = 0;
  while (offset < bytes.byteLength) {
    records += 1;
    if (records > MAX_IMAGE_CONTAINER_RECORDS) return undefined;
    if (offset + 12 > bytes.byteLength) return undefined;
    const length = view.getUint32(offset, false);
    const type = ascii4(bytes, offset + 4);
    if (!/^[A-Za-z]{4}$/u.test(type)) return undefined;
    const dataOffset = offset + 8;
    const end = dataOffset + length + 4;
    if (!Number.isSafeInteger(end) || end > bytes.byteLength) return undefined;
    if (!dimensions) {
      if (type !== "IHDR" || length !== 13) return undefined;
      const width = view.getUint32(dataOffset, false);
      const height = view.getUint32(dataOffset + 4, false);
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      const validBitDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth ?? -1)) ||
        (colorType === 2 && (bitDepth === 8 || bitDepth === 16)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth ?? -1)) ||
        ((colorType === 4 || colorType === 6) && (bitDepth === 8 || bitDepth === 16));
      if (
        !validBitDepth ||
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0 ||
        ![0, 1].includes(bytes[dataOffset + 12] ?? -1)
      ) {
        return undefined;
      }
      dimensions = detectedPage("image/png", "png", width, height);
      if (!dimensions) return undefined;
    } else if (type === "IHDR") {
      return undefined;
    }
    if (type === "acTL") {
      if (declaredAnimationFrames !== undefined || sawImageData || length !== 8) return undefined;
      declaredAnimationFrames = view.getUint32(dataOffset, false);
      if (
        declaredAnimationFrames <= 0 ||
        declaredAnimationFrames > MAX_IMAGE_CONTAINER_RECORDS
      ) {
        return undefined;
      }
    } else if (type === "fcTL") {
      if (declaredAnimationFrames === undefined || length !== 26) return undefined;
      frameControlCount += 1;
    } else if (type === "fdAT") {
      if (declaredAnimationFrames === undefined || length <= 4) return undefined;
    }
    if (type === "IDAT") sawImageData ||= length > 0;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.byteLength) return undefined;
      sawEnd = true;
      break;
    }
    if (/^[A-Z]/u.test(type) && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) {
      return undefined;
    }
    offset = end;
  }
  if (!dimensions || !sawImageData || !sawEnd) return undefined;
  if (
    declaredAnimationFrames !== undefined &&
    frameControlCount !== declaredAnimationFrames
  ) {
    return undefined;
  }
  return detectedPage(
    dimensions.mimeType,
    dimensions.extension,
    dimensions.width,
    dimensions.height,
    declaredAnimationFrames ?? 1
  );
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function detectJpeg(bytes: Uint8Array): DetectedPage | undefined {
  if (
    bytes.byteLength < 16 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let dimensions: DetectedPage | undefined;
  let sawScan = false;
  let records = 0;
  while (offset < bytes.byteLength - 2) {
    records += 1;
    if (records > MAX_IMAGE_CONTAINER_RECORDS) return undefined;
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.byteLength - 2 && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined || marker === 0x00 || marker === 0xd9) return undefined;
    offset += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength - 2) return undefined;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength - 2) return undefined;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (dimensions || segmentLength < 11) return undefined;
      const components = bytes[offset + 7] ?? 0;
      if (components === 0 || segmentLength !== 8 + components * 3) return undefined;
      dimensions = detectedPage(
        "image/jpeg",
        "jpg",
        view.getUint16(offset + 5, false),
        view.getUint16(offset + 3, false)
      );
      if (!dimensions) return undefined;
    }
    if (marker === 0xda) {
      const components = bytes[offset + 2] ?? 0;
      if (components === 0 || segmentLength !== 6 + components * 2 || !dimensions) {
        return undefined;
      }
      sawScan = true;
      break;
    }
    offset += segmentLength;
  }
  return dimensions && sawScan ? dimensions : undefined;
}

function detectWebp(bytes: Uint8Array): DetectedPage | undefined {
  if (
    bytes.byteLength < 26 ||
    ascii4(bytes, 0) !== "RIFF" ||
    ascii4(bytes, 8) !== "WEBP"
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.byteLength) return undefined;
  let offset = 12;
  let canvas: DetectedPage | undefined;
  let payloadDimensions: DetectedPage | undefined;
  let sawPayload = false;
  let animationDeclared = false;
  let sawAnimationHeader = false;
  let animationFrameCount = 0;
  let records = 0;
  while (offset < bytes.byteLength) {
    records += 1;
    if (records > MAX_IMAGE_CONTAINER_RECORDS) return undefined;
    if (offset + 8 > bytes.byteLength) return undefined;
    const type = ascii4(bytes, offset);
    const length = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const paddedEnd = dataEnd + (length & 1);
    if (!Number.isSafeInteger(paddedEnd) || paddedEnd > bytes.byteLength) return undefined;
    if (type === "VP8X") {
      if (canvas || length !== 10 || (bytes[dataOffset] ?? 0) & 0xc1) return undefined;
      if (bytes[dataOffset + 1] !== 0 || bytes[dataOffset + 2] !== 0 || bytes[dataOffset + 3] !== 0) {
        return undefined;
      }
      animationDeclared = (((bytes[dataOffset] ?? 0) & 0x02) !== 0);
      canvas = detectedPage(
        "image/webp",
        "webp",
        uint24LittleEndian(bytes, dataOffset + 4) + 1,
        uint24LittleEndian(bytes, dataOffset + 7) + 1
      );
      if (!canvas) return undefined;
    } else if (type === "VP8 ") {
      if (
        payloadDimensions ||
        length < 10 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        return undefined;
      }
      payloadDimensions = detectedPage(
        "image/webp",
        "webp",
        view.getUint16(dataOffset + 6, true) & 0x3fff,
        view.getUint16(dataOffset + 8, true) & 0x3fff
      );
      if (!payloadDimensions) return undefined;
      sawPayload = true;
    } else if (type === "VP8L") {
      if (payloadDimensions || length < 5 || bytes[dataOffset] !== 0x2f) return undefined;
      const byte1 = bytes[dataOffset + 1] ?? 0;
      const byte2 = bytes[dataOffset + 2] ?? 0;
      const byte3 = bytes[dataOffset + 3] ?? 0;
      const byte4 = bytes[dataOffset + 4] ?? 0;
      if ((byte4 & 0xe0) !== 0) return undefined;
      payloadDimensions = detectedPage(
        "image/webp",
        "webp",
        1 + byte1 + ((byte2 & 0x3f) << 8),
        1 + (byte2 >> 6) + (byte3 << 2) + ((byte4 & 0x0f) << 10)
      );
      if (!payloadDimensions) return undefined;
      sawPayload = true;
    } else if (type === "ANIM") {
      if (length !== 6) return undefined;
      sawAnimationHeader = true;
    } else if (type === "ANMF") {
      if (!canvas || length < 16) return undefined;
      const frameX = uint24LittleEndian(bytes, dataOffset) * 2;
      const frameY = uint24LittleEndian(bytes, dataOffset + 3) * 2;
      const frameWidth = uint24LittleEndian(bytes, dataOffset + 6) + 1;
      const frameHeight = uint24LittleEndian(bytes, dataOffset + 9) + 1;
      if (frameX + frameWidth > canvas.width || frameY + frameHeight > canvas.height) {
        return undefined;
      }
      animationFrameCount += 1;
      sawPayload = true;
    }
    offset = paddedEnd;
  }
  if (offset !== bytes.byteLength || !sawPayload) return undefined;
  if (animationDeclared && (!sawAnimationHeader || animationFrameCount === 0 || payloadDimensions)) {
    return undefined;
  }
  if (!animationDeclared && (sawAnimationHeader || animationFrameCount > 0 || !payloadDimensions)) {
    return undefined;
  }
  if (canvas && payloadDimensions && (
    canvas.width !== payloadDimensions.width || canvas.height !== payloadDimensions.height
  )) {
    return undefined;
  }
  const dimensions = canvas ?? payloadDimensions;
  if (!dimensions) return undefined;
  return detectedPage(
    dimensions.mimeType,
    dimensions.extension,
    dimensions.width,
    dimensions.height,
    animationFrameCount || 1
  );
}

function skipGifSubBlocks(bytes: Uint8Array, initialOffset: number): { end: number; bytes: number } | undefined {
  let offset = initialOffset;
  let payloadBytes = 0;
  let records = 0;
  for (;;) {
    records += 1;
    if (records > MAX_IMAGE_CONTAINER_RECORDS) return undefined;
    const length = bytes[offset];
    if (length === undefined) return undefined;
    offset += 1;
    if (length === 0) return { end: offset, bytes: payloadBytes };
    if (offset + length > bytes.byteLength) return undefined;
    payloadBytes += length;
    offset += length;
  }
}

function detectGif(bytes: Uint8Array): DetectedPage | undefined {
  if (bytes.byteLength < 28) return undefined;
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF87a" && header !== "GIF89a") return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dimensions = detectedPage(
    "image/gif",
    "gif",
    view.getUint16(6, true),
    view.getUint16(8, true)
  );
  if (!dimensions) return undefined;
  const packed = bytes[10] ?? 0;
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * (1 << ((packed & 0x07) + 1));
  if (offset > bytes.byteLength) return undefined;
  let frameCount = 0;
  let records = 0;
  while (offset < bytes.byteLength) {
    records += 1;
    if (records > MAX_IMAGE_CONTAINER_RECORDS) return undefined;
    const marker = bytes[offset];
    if (marker === 0x3b) {
      return frameCount > 0 && offset + 1 === bytes.byteLength
        ? detectedPage(
            dimensions.mimeType,
            dimensions.extension,
            dimensions.width,
            dimensions.height,
            frameCount
          )
        : undefined;
    }
    if (marker === 0x21) {
      if (offset + 2 > bytes.byteLength) return undefined;
      const blocks = skipGifSubBlocks(bytes, offset + 2);
      if (!blocks) return undefined;
      offset = blocks.end;
      continue;
    }
    if (marker !== 0x2c || offset + 10 > bytes.byteLength) return undefined;
    const left = view.getUint16(offset + 1, true);
    const top = view.getUint16(offset + 3, true);
    const width = view.getUint16(offset + 5, true);
    const height = view.getUint16(offset + 7, true);
    if (
      width === 0 ||
      height === 0 ||
      left + width > dimensions.width ||
      top + height > dimensions.height
    ) {
      return undefined;
    }
    const imagePacked = bytes[offset + 9] ?? 0;
    offset += 10;
    if ((imagePacked & 0x80) !== 0) offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    const minimumCodeSize = bytes[offset];
    if (minimumCodeSize === undefined || minimumCodeSize < 2 || minimumCodeSize > 8) {
      return undefined;
    }
    const blocks = skipGifSubBlocks(bytes, offset + 1);
    if (!blocks || blocks.bytes === 0) return undefined;
    offset = blocks.end;
    frameCount += 1;
  }
  return undefined;
}

function detectPage(bytes: Uint8Array): DetectedPage | undefined {
  return detectPng(bytes) ?? detectJpeg(bytes) ?? detectWebp(bytes) ?? detectGif(bytes);
}

function assertDetectedPageBudget(
  page: DetectedPage,
  limits: StudioCbzLimits,
  path: string
): void {
  if (page.width > limits.maxPageDimension || page.height > limits.maxPageDimension) {
    throw cbzError("SIZE_LIMIT", "CBZ 페이지 한 변의 길이가 안전 한도를 넘었습니다.", path);
  }
  if (page.pixelCount > limits.maxPagePixels) {
    throw cbzError("SIZE_LIMIT", "CBZ 페이지의 디코드 픽셀 수가 안전 한도를 넘었습니다.", path);
  }
}

function hasUnsafeXmlControl(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function validateMetadataString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || hasUnsafeXmlControl(value)) {
    throw cbzError("COMICINFO_INVALID", `${label} metadata가 올바른 문자열이 아닙니다.`);
  }
  return value;
}

function validateOptionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw cbzError("COMICINFO_INVALID", `${label} metadata가 안전 범위를 벗어났습니다.`);
  }
  return value as number;
}

function validateStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw cbzError("COMICINFO_INVALID", `${label} metadata는 문자열 목록이어야 합니다.`);
  }
  return value.map((item) => {
    const validated = validateMetadataString(item, label);
    if (validated === undefined) throw cbzError("COMICINFO_INVALID", `${label} 값이 없습니다.`);
    if (validated.includes(",")) {
      throw cbzError("COMICINFO_INVALID", `${label} 항목에는 목록 구분자인 쉼표를 사용할 수 없습니다.`);
    }
    return validated;
  });
}

function normalizeMetadata(metadata: StudioComicInfoMetadata | undefined): StudioComicInfoMetadata {
  if (!metadata) return {};
  if (metadata.blackAndWhite !== undefined && typeof metadata.blackAndWhite !== "boolean") {
    throw cbzError("COMICINFO_INVALID", "BlackAndWhite metadata는 boolean이어야 합니다.");
  }
  return {
    title: validateMetadataString(metadata.title, "Title"),
    series: validateMetadataString(metadata.series, "Series"),
    number: validateMetadataString(metadata.number, "Number"),
    count: validateOptionalInteger(metadata.count, "Count", 0, 1_000_000),
    volume: validateOptionalInteger(metadata.volume, "Volume", 0, 1_000_000),
    summary: validateMetadataString(metadata.summary, "Summary"),
    notes: validateMetadataString(metadata.notes, "Notes"),
    year: validateOptionalInteger(metadata.year, "Year", 0, 9_999),
    month: validateOptionalInteger(metadata.month, "Month", 1, 12),
    day: validateOptionalInteger(metadata.day, "Day", 1, 31),
    writer: validateMetadataString(metadata.writer, "Writer"),
    penciller: validateMetadataString(metadata.penciller, "Penciller"),
    inker: validateMetadataString(metadata.inker, "Inker"),
    colorist: validateMetadataString(metadata.colorist, "Colorist"),
    letterer: validateMetadataString(metadata.letterer, "Letterer"),
    coverArtist: validateMetadataString(metadata.coverArtist, "CoverArtist"),
    editor: validateMetadataString(metadata.editor, "Editor"),
    publisher: validateMetadataString(metadata.publisher, "Publisher"),
    imprint: validateMetadataString(metadata.imprint, "Imprint"),
    genre: validateStringList(metadata.genre, "Genre"),
    tags: validateStringList(metadata.tags, "Tags"),
    web: validateMetadataString(metadata.web, "Web"),
    languageISO: validateMetadataString(metadata.languageISO, "LanguageISO"),
    format: validateMetadataString(metadata.format, "Format"),
    ageRating: validateMetadataString(metadata.ageRating, "AgeRating"),
    blackAndWhite: metadata.blackAndWhite,
    manga: validateMetadataString(metadata.manga, "Manga"),
  };
}

const COMIC_INFO_STRING_FIELDS = [
  ["title", "Title"],
  ["series", "Series"],
  ["number", "Number"],
  ["summary", "Summary"],
  ["notes", "Notes"],
  ["writer", "Writer"],
  ["penciller", "Penciller"],
  ["inker", "Inker"],
  ["colorist", "Colorist"],
  ["letterer", "Letterer"],
  ["coverArtist", "CoverArtist"],
  ["editor", "Editor"],
  ["publisher", "Publisher"],
  ["imprint", "Imprint"],
  ["web", "Web"],
  ["languageISO", "LanguageISO"],
  ["format", "Format"],
  ["ageRating", "AgeRating"],
  ["manga", "Manga"],
] as const satisfies readonly (readonly [keyof StudioComicInfoMetadata, string])[];

const COMIC_INFO_INTEGER_FIELDS = [
  ["count", "Count"],
  ["volume", "Volume"],
  ["year", "Year"],
  ["month", "Month"],
  ["day", "Day"],
] as const satisfies readonly (readonly [keyof StudioComicInfoMetadata, string])[];

function buildComicInfoXml(metadata: StudioComicInfoMetadata, pageCount: number): Uint8Array {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  ];
  for (const [key, tag] of COMIC_INFO_STRING_FIELDS) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0) {
      lines.push(`  <${tag}>${escapeXml(value)}</${tag}>`);
    }
  }
  for (const [key, tag] of COMIC_INFO_INTEGER_FIELDS) {
    const value = metadata[key];
    if (typeof value === "number") lines.push(`  <${tag}>${value}</${tag}>`);
  }
  if (metadata.genre && metadata.genre.length > 0) {
    lines.push(`  <Genre>${escapeXml(metadata.genre.join(", "))}</Genre>`);
  }
  if (metadata.tags && metadata.tags.length > 0) {
    lines.push(`  <Tags>${escapeXml(metadata.tags.join(", "))}</Tags>`);
  }
  if (metadata.blackAndWhite !== undefined) {
    lines.push(`  <BlackAndWhite>${metadata.blackAndWhite ? "Yes" : "No"}</BlackAndWhite>`);
  }
  lines.push(`  <PageCount>${pageCount}</PageCount>`);
  lines.push("  <Pages>");
  for (let index = 0; index < pageCount; index += 1) {
    const type = index === 0 ? ' Type="FrontCover"' : "";
    lines.push(`    <Page Image="${index}"${type}/>`);
  }
  lines.push("  </Pages>", "</ComicInfo>", "");
  return encoder.encode(lines.join("\n"));
}

async function prepareCbz(
  rawInput: StudioCbzExportInput,
  options: StudioCbzExportOptions
): Promise<PreparedCbz> {
  const limits = resolveLimits(options.limits);
  const sources = rawInput.pages.map((page, index) =>
    snapshotSource(page.image, `page ${index + 1}`)
  );
  const metadata = normalizeMetadata(rawInput.metadata);
  throwIfAborted(options.signal);
  if (sources.length === 0 || sources.length > limits.maxPages) {
    throw cbzError("PAGE_COUNT_LIMIT", "CBZ 페이지 수가 안전 범위를 벗어났습니다.");
  }
  if (sources.length + 1 > limits.maxArchiveEntries) {
    throw cbzError("PAGE_COUNT_LIMIT", "CBZ 페이지와 metadata 항목 수가 archive 한도를 넘었습니다.");
  }
  const metadataCharacters = JSON.stringify(metadata).length;
  if (metadataCharacters > limits.maxMetadataCharacters) {
    throw cbzError("COMICINFO_INVALID", "ComicInfo metadata가 안전 한도를 넘었습니다.");
  }

  const digits = Math.max(4, String(sources.length).length);
  const pageEntries: StudioPackageArchiveEntry[] = [];
  let totalPageBytes = 0;
  let totalDecodedPixels = 0;
  let totalDecodedBytes = 0;
  for (let index = 0; index < sources.length; index += 1) {
    throwIfAborted(options.signal);
    const source = sources[index];
    if (!source) continue;
    const size = sourceSize(source);
    if (!Number.isSafeInteger(size) || size <= 0 || size > limits.maxPageBytes) {
      throw cbzError("SIZE_LIMIT", "CBZ 페이지 크기가 안전 한도를 벗어났습니다.", `page ${index + 1}`);
    }
    const bytes = await sourceBytes(source, `page ${index + 1}`, options.signal);
    const detected = detectPage(bytes);
    if (!detected) {
      throw cbzError(
        "IMAGE_INVALID",
        "CBZ 페이지는 구조와 크기 정보가 올바른 PNG, JPEG, WebP, GIF 중 하나여야 합니다.",
        `page ${index + 1}`
      );
    }
    assertDetectedPageBudget(detected, limits, `page ${index + 1}`);
    totalPageBytes += bytes.byteLength;
    if (totalPageBytes > limits.maxTotalPageBytes) {
      throw cbzError("SIZE_LIMIT", "CBZ 전체 페이지 크기가 안전 한도를 넘었습니다.");
    }
    totalDecodedPixels += detected.decodedPixelCount;
    totalDecodedBytes += detected.decodedByteSize;
    if (
      !Number.isSafeInteger(totalDecodedPixels) ||
      totalDecodedPixels > limits.maxTotalDecodedPixels ||
      !Number.isSafeInteger(totalDecodedBytes) ||
      totalDecodedBytes > limits.maxTotalDecodedBytes
    ) {
      throw cbzError("SIZE_LIMIT", "CBZ 전체 페이지의 디코드 메모리 예산을 넘었습니다.");
    }
    pageEntries.push({
      path: `pages/${String(index + 1).padStart(digits, "0")}.${detected.extension}`,
      data: bytes.slice(),
    });
  }
  const comicInfo = buildComicInfoXml(metadata, pageEntries.length);
  if (comicInfo.byteLength > limits.maxComicInfoBytes) {
    throw cbzError("SIZE_LIMIT", "ComicInfo.xml이 안전 한도를 넘었습니다.");
  }
  return {
    warnings: [],
    entries: [{ path: "ComicInfo.xml", data: comicInfo }, ...pageEntries],
  };
}

function writerLimits(limits: StudioCbzLimits) {
  return {
    maxFiles: Math.min(limits.maxPages + 1, limits.maxArchiveEntries),
    maxEntryBytes: Math.max(limits.maxPageBytes, limits.maxComicInfoBytes),
    maxTotalBytes: Math.min(
      512_000_000,
      limits.maxTotalPageBytes + limits.maxComicInfoBytes
    ),
    maxArchiveBytes: limits.maxArchiveBytes,
  };
}

export async function buildStudioCbzBytes(
  input: StudioCbzExportInput,
  options: StudioCbzExportOptions = {}
): Promise<StudioCbzBuildBytesResult> {
  const prepared = await prepareCbz(input, options);
  const bytes = await buildStudioPackageArchiveBytes(
    prepared.entries,
    {
      limits: writerLimits(resolveLimits(options.limits)),
      signal: options.signal,
      crc32ExecutionMode: options.crc32ExecutionMode ?? "worker",
    }
  );
  return { bytes, warnings: Object.freeze([...prepared.warnings]) };
}

export async function buildStudioCbzBlob(
  input: StudioCbzExportInput,
  options: StudioCbzExportOptions = {}
): Promise<StudioCbzBuildBlobResult> {
  const prepared = await prepareCbz(input, options);
  const blob = await buildStudioPackageArchiveBlob(prepared.entries, {
    mimeType: STUDIO_CBZ_MIME,
    limits: writerLimits(resolveLimits(options.limits)),
    signal: options.signal,
    crc32ExecutionMode: options.crc32ExecutionMode ?? "worker",
  });
  return { blob, warnings: Object.freeze([...prepared.warnings]) };
}

function naturalChunks(value: string): string[] {
  return value.match(/\d+|\D+/gu) ?? [];
}

/** Locale-independent natural path order for page names such as 2, 10, 010. */
export function compareStudioCbzPagePaths(left: string, right: string): number {
  const leftChunks = naturalChunks(left.normalize("NFKC").toLowerCase());
  const rightChunks = naturalChunks(right.normalize("NFKC").toLowerCase());
  const count = Math.max(leftChunks.length, rightChunks.length);
  for (let index = 0; index < count; index += 1) {
    const leftChunk = leftChunks[index];
    const rightChunk = rightChunks[index];
    if (leftChunk === undefined) return -1;
    if (rightChunk === undefined) return 1;
    if (leftChunk === rightChunk) continue;
    const leftNumeric = /^\d+$/u.test(leftChunk);
    const rightNumeric = /^\d+$/u.test(rightChunk);
    if (leftNumeric && rightNumeric) {
      const leftCanonical = leftChunk.replace(/^0+(?=\d)/u, "");
      const rightCanonical = rightChunk.replace(/^0+(?=\d)/u, "");
      if (leftCanonical.length !== rightCanonical.length) {
        return leftCanonical.length - rightCanonical.length;
      }
      if (leftCanonical !== rightCanonical) return leftCanonical < rightCanonical ? -1 : 1;
      if (leftChunk.length !== rightChunk.length) return leftChunk.length - rightChunk.length;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else {
      return leftChunk < rightChunk ? -1 : 1;
    }
  }
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function decodeXmlText(value: string): string {
  const entityPattern = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/gu;
  const unescaped = value.replaceAll(entityPattern, "");
  if (unescaped.includes("&") || unescaped.includes("<") || unescaped.includes(">")) {
    throw cbzError("COMICINFO_INVALID", "ComicInfo.xml text가 올바르게 escape되지 않았습니다.");
  }
  return value.replaceAll(entityPattern, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    const hexadecimal = entity.startsWith("&#x");
    const numeric = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
    if (!isValidXmlCodePoint(numeric)) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml 문자 entity가 올바르지 않습니다.");
    }
    return String.fromCodePoint(numeric);
  }).trim();
}

function isValidXmlCodePoint(value: number): boolean {
  return Number.isSafeInteger(value) && (
    value === 9 ||
    value === 10 ||
    value === 13 ||
    (value >= 32 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff)
  );
}

const COMIC_INFO_IMPORTED_FIELDS = new Set([
  ...COMIC_INFO_STRING_FIELDS.map(([, tag]) => tag),
  ...COMIC_INFO_INTEGER_FIELDS.map(([, tag]) => tag),
  "Genre",
  "Tags",
  "BlackAndWhite",
  "PageCount",
]);

interface ComicInfoXmlElement {
  name: string;
  attributeCount: number;
  textParts: string[];
  hasChild: boolean;
}

function findXmlTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ">") return index;
    else if (character === "<") break;
  }
  throw cbzError("COMICINFO_INVALID", "ComicInfo.xml element가 닫히지 않았습니다.");
}

function parseXmlAttributes(source: string, maximum: number): number {
  let offset = 0;
  let count = 0;
  const names = new Set<string>();
  while (offset < source.length) {
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
    if (offset >= source.length) break;
    const match = /^[A-Za-z_][\w:.-]*/u.exec(source.slice(offset));
    const name = match?.[0];
    if (!name) throw cbzError("COMICINFO_INVALID", "ComicInfo.xml attribute 이름이 올바르지 않습니다.");
    offset += name.length;
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
    if (source[offset] !== "=") {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml attribute에 등호가 없습니다.");
    }
    offset += 1;
    while (/\s/u.test(source[offset] ?? "")) offset += 1;
    const quote = source[offset];
    if (quote !== '"' && quote !== "'") {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml attribute 값은 따옴표로 감싸야 합니다.");
    }
    const end = source.indexOf(quote, offset + 1);
    if (end < 0) throw cbzError("COMICINFO_INVALID", "ComicInfo.xml attribute 값이 닫히지 않았습니다.");
    const rawValue = source.slice(offset + 1, end);
    if (rawValue.includes("<")) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml attribute 값에 안전하지 않은 문자가 있습니다.");
    }
    decodeXmlText(rawValue);
    if (names.has(name)) {
      throw cbzError("COMICINFO_INVALID", `ComicInfo.xml에 ${name} attribute가 중복되었습니다.`);
    }
    names.add(name);
    count += 1;
    if (count > maximum) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml element의 attribute가 너무 많습니다.");
    }
    offset = end + 1;
    if (offset < source.length && !/\s/u.test(source[offset] ?? "")) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml attribute 사이에 공백이 없습니다.");
    }
  }
  return count;
}

function finalizeComicInfoElement(
  element: ComicInfoXmlElement,
  parent: ComicInfoXmlElement | undefined,
  fields: Map<string, string>
): void {
  const text = decodeXmlText(element.textParts.join(""));
  if (element.hasChild && text.length > 0) {
    throw cbzError("COMICINFO_INVALID", `ComicInfo.xml ${element.name} element에 혼합 content가 있습니다.`);
  }
  if (parent?.name !== "ComicInfo" || !COMIC_INFO_IMPORTED_FIELDS.has(element.name)) return;
  if (element.attributeCount > 0 || element.hasChild) {
    throw cbzError("COMICINFO_INVALID", `ComicInfo.xml ${element.name} 값의 구조가 올바르지 않습니다.`);
  }
  if (fields.has(element.name)) {
    throw cbzError("COMICINFO_INVALID", `ComicInfo.xml에 ${element.name} tag가 중복되었습니다.`);
  }
  fields.set(element.name, text);
}

function parseComicInfoFields(
  xml: string,
  limits: StudioCbzLimits,
): ReadonlyMap<string, string> {
  let normalizedXml = xml.trim();
  if (normalizedXml.startsWith("<?xml")) {
    const declarationEnd = normalizedXml.indexOf("?>");
    if (declarationEnd < 0) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml 선언이 닫히지 않았습니다.");
    }
    const declaration = normalizedXml.slice(0, declarationEnd + 2);
    if (!/^<\?xml\s+version\s*=\s*(?:"1\.0"|'1\.0')(?:\s+encoding\s*=\s*(?:"UTF-8"|'UTF-8'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/iu.test(declaration)) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml 선언이 지원하는 안전한 형식이 아닙니다.");
    }
    normalizedXml = normalizedXml.slice(declarationEnd + 2).trim();
  }

  const fields = new Map<string, string>();
  const stack: ComicInfoXmlElement[] = [];
  let rootSeen = false;
  let rootClosed = false;
  let offset = 0;
  let elementCount = 0;
  let textCharacterCount = 0;
  while (offset < normalizedXml.length) {
    if (normalizedXml[offset] !== "<") {
      const next = normalizedXml.indexOf("<", offset);
      const end = next < 0 ? normalizedXml.length : next;
      const text = normalizedXml.slice(offset, end);
      const current = stack.at(-1);
      if (!current) {
        if (text.trim().length > 0) {
          throw cbzError("COMICINFO_INVALID", "ComicInfo.xml root 밖에 text가 있습니다.");
        }
      } else {
        textCharacterCount += text.length;
        if (textCharacterCount > limits.maxComicInfoTextCharacters) {
          throw cbzError("COMICINFO_INVALID", "ComicInfo.xml text가 안전한 복잡도 한도를 넘습니다.");
        }
        current.textParts.push(text);
      }
      offset = end;
      continue;
    }
    if (normalizedXml.startsWith("<!--", offset)) {
      const commentEnd = normalizedXml.indexOf("-->", offset + 4);
      if (commentEnd < 0) {
        throw cbzError("COMICINFO_INVALID", "ComicInfo.xml 주석이 닫히지 않았습니다.");
      }
      if (normalizedXml.slice(offset + 4, commentEnd).includes("--")) {
        throw cbzError("COMICINFO_INVALID", "ComicInfo.xml 주석 내용이 올바르지 않습니다.");
      }
      offset = commentEnd + 3;
      continue;
    }
    if (normalizedXml.startsWith("<!", offset) || normalizedXml.startsWith("<?", offset)) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml DTD, CDATA, 처리 지시문은 허용되지 않습니다.");
    }
    const tagEnd = findXmlTagEnd(normalizedXml, offset);
    let body = normalizedXml.slice(offset + 1, tagEnd).trim();
    if (body.startsWith("/")) {
      const closing = body.slice(1).trim();
      if (!/^[A-Za-z_][\w:.-]*$/u.test(closing)) {
        throw cbzError("COMICINFO_INVALID", "ComicInfo.xml 닫는 tag가 올바르지 않습니다.");
      }
      const element = stack.pop();
      if (!element || element.name !== closing) {
        throw cbzError("COMICINFO_INVALID", "ComicInfo.xml tag 중첩이 올바르지 않습니다.");
      }
      const parent = stack.at(-1);
      finalizeComicInfoElement(element, parent, fields);
      if (!parent) rootClosed = true;
      offset = tagEnd + 1;
      continue;
    }

    const selfClosing = /\/\s*$/u.test(body);
    if (selfClosing) body = body.replace(/\/\s*$/u, "").trimEnd();
    const nameMatch = /^[A-Za-z_][\w:.-]*/u.exec(body);
    const name = nameMatch?.[0];
    if (!name) throw cbzError("COMICINFO_INVALID", "ComicInfo.xml 여는 tag가 올바르지 않습니다.");
    const attributesSource = body.slice(name.length);
    if (attributesSource.length > 0 && !/^\s/u.test(attributesSource)) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml tag와 attribute 사이에 공백이 없습니다.");
    }
    const element: ComicInfoXmlElement = {
      name,
      attributeCount: parseXmlAttributes(
        attributesSource,
        limits.maxComicInfoAttributesPerElement,
      ),
      textParts: [],
      hasChild: false,
    };
    const parent = stack.at(-1);
    if (!parent) {
      if (rootSeen || rootClosed || name !== "ComicInfo") {
        throw cbzError("COMICINFO_INVALID", "ComicInfo.xml root가 올바르지 않습니다.");
      }
      rootSeen = true;
    } else {
      parent.hasChild = true;
    }
    elementCount += 1;
    if (elementCount > limits.maxComicInfoElements) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml element 수가 안전한 한도를 넘습니다.");
    }
    if (stack.length + 1 > limits.maxComicInfoDepth) {
      throw cbzError("COMICINFO_INVALID", "ComicInfo.xml 중첩 깊이가 안전한 한도를 넘습니다.");
    }
    if (selfClosing) {
      finalizeComicInfoElement(element, parent, fields);
      if (!parent) rootClosed = true;
    } else {
      stack.push(element);
    }
    offset = tagEnd + 1;
  }
  if (!rootSeen || !rootClosed || stack.length > 0) {
    throw cbzError("COMICINFO_INVALID", "ComicInfo.xml root 또는 tag가 완전히 닫히지 않았습니다.");
  }
  return fields;
}

function parseComicInfoInteger(
  value: string | undefined,
  tag: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) {
    throw cbzError("COMICINFO_INVALID", `ComicInfo.xml ${tag} 값이 정수가 아닙니다.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw cbzError("COMICINFO_INVALID", `ComicInfo.xml ${tag} 값이 안전 범위를 벗어났습니다.`);
  }
  return parsed;
}

function splitMetadataList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseComicInfo(
  bytes: Uint8Array,
  limits: StudioCbzLimits
): { metadata: StudioComicInfoMetadata; declaredPageCount?: number } {
  if (bytes.byteLength === 0 || bytes.byteLength > limits.maxComicInfoBytes) {
    throw cbzError("SIZE_LIMIT", "ComicInfo.xml 크기가 안전 범위를 벗어났습니다.");
  }
  let xml: string;
  try {
    xml = decoder.decode(bytes);
  } catch {
    throw cbzError("COMICINFO_INVALID", "ComicInfo.xml이 올바른 UTF-8이 아닙니다.");
  }
  if (hasUnsafeXmlControl(xml)) {
    throw cbzError("COMICINFO_INVALID", "ComicInfo.xml에 안전하지 않은 제어 문자가 있습니다.");
  }
  const fields = parseComicInfoFields(xml, limits);
  const field = (tag: string) => fields.get(tag);

  const metadata: StudioComicInfoMetadata = {
    title: field("Title"),
    series: field("Series"),
    number: field("Number"),
    count: parseComicInfoInteger(field("Count"), "Count", 0, 1_000_000),
    volume: parseComicInfoInteger(field("Volume"), "Volume", 0, 1_000_000),
    summary: field("Summary"),
    notes: field("Notes"),
    year: parseComicInfoInteger(field("Year"), "Year", 0, 9_999),
    month: parseComicInfoInteger(field("Month"), "Month", 1, 12),
    day: parseComicInfoInteger(field("Day"), "Day", 1, 31),
    writer: field("Writer"),
    penciller: field("Penciller"),
    inker: field("Inker"),
    colorist: field("Colorist"),
    letterer: field("Letterer"),
    coverArtist: field("CoverArtist"),
    editor: field("Editor"),
    publisher: field("Publisher"),
    imprint: field("Imprint"),
    genre: splitMetadataList(field("Genre")),
    tags: splitMetadataList(field("Tags")),
    web: field("Web"),
    languageISO: field("LanguageISO"),
    format: field("Format"),
    ageRating: field("AgeRating"),
    manga: field("Manga"),
  };
  const blackAndWhite = field("BlackAndWhite");
  if (blackAndWhite !== undefined) {
    if (blackAndWhite !== "Yes" && blackAndWhite !== "No") {
      throw cbzError("COMICINFO_INVALID", "BlackAndWhite 값은 Yes 또는 No여야 합니다.");
    }
    metadata.blackAndWhite = blackAndWhite === "Yes";
  }
  if (JSON.stringify(metadata).length > limits.maxMetadataCharacters) {
    throw cbzError("COMICINFO_INVALID", "ComicInfo metadata가 안전 한도를 넘었습니다.");
  }
  return {
    metadata,
    declaredPageCount: parseComicInfoInteger(
      field("PageCount"),
      "PageCount",
      0,
      limits.maxPages
    ),
  };
}

function imageExtensionMatches(path: string, detected: DetectedPage): boolean {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (detected.mimeType === "image/jpeg") return extension === "jpg" || extension === "jpeg";
  return extension === detected.extension;
}

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

function isCbzMetadataJunkPath(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  const leaf = segments.at(-1) ?? "";
  return segments[0] === "__macosx" || leaf.startsWith("._") || leaf === ".ds_store" || leaf === "thumbs.db";
}

function rethrowZipFailure(cause: unknown, signal?: AbortSignal, fallbackPath?: string): never {
  if (signal?.aborted || (cause instanceof StudioZipReaderError && cause.code === "ABORTED")) {
    throw cbzError("ABORTED", "CBZ 작업이 취소되었습니다.", cause instanceof StudioZipReaderError ? cause.path : fallbackPath);
  }
  const detail = cause instanceof Error ? `: ${cause.message}` : "";
  const path = cause instanceof StudioZipReaderError ? cause.path : fallbackPath;
  throw cbzError("ARCHIVE_INVALID", `CBZ ZIP 항목이 올바르지 않습니다${detail}`, path);
}

async function readCbzEntry(
  archive: StudioZipArchive,
  entry: StudioZipEntry,
  signal?: AbortSignal
): Promise<Uint8Array> {
  try {
    return await archive.readEntry(entry, { signal });
  } catch (cause) {
    rethrowZipFailure(cause, signal, entry.path);
  }
}

export async function importStudioCbz(
  source: Blob | Uint8Array | ArrayBuffer,
  options: StudioCbzImportOptions = {}
): Promise<StudioCbzImportResult> {
  const limits = resolveLimits(options.limits);
  throwIfAborted(options.signal);
  const zipLimits: Partial<StudioZipReaderLimits> = {
    maxArchiveBytes: limits.maxArchiveBytes,
    maxEntries: Math.min(limits.maxArchiveEntries, limits.maxPages + 64),
    maxEntryCompressedBytes: Math.max(limits.maxPageBytes, limits.maxComicInfoBytes),
    maxEntryUncompressedBytes: Math.max(limits.maxPageBytes, limits.maxComicInfoBytes),
    maxTotalUncompressedBytes: Math.min(
      512_000_000,
      limits.maxTotalPageBytes + limits.maxComicInfoBytes
    ),
    maxCompressionRatio: limits.maxCompressionRatio,
  };
  let archive: StudioZipArchive;
  try {
    archive = await readStudioZipArchive(source, {
      limits: zipLimits,
      inflateRaw: options.inflateRaw,
      signal: options.signal,
    });
  } catch (cause) {
    rethrowZipFailure(cause, options.signal);
  }

  const warnings: StudioCbzWarning[] = [];
  const comicInfoEntry = archive.entries.find(
    (entry) => !entry.directory && entry.path.toLowerCase() === "comicinfo.xml"
  );
  let metadata: StudioComicInfoMetadata = {};
  let declaredPageCount: number | undefined;
  if (comicInfoEntry) {
    const parsed = parseComicInfo(
      await readCbzEntry(archive, comicInfoEntry, options.signal),
      limits
    );
    metadata = parsed.metadata;
    declaredPageCount = parsed.declaredPageCount;
  } else {
    warnings.push({
      code: "COMICINFO_MISSING",
      message: "ComicInfo.xml이 없어 페이지 이미지만 가져왔습니다.",
    });
  }

  const imageEntries = archive.entries
    .filter((entry) => {
      if (entry.directory || entry === comicInfoEntry) return false;
      const lower = entry.path.toLowerCase();
      if (isCbzMetadataJunkPath(lower)) {
        warnings.push({
          code: "IGNORED_ENTRY",
          path: entry.path,
          message: `CBZ의 운영체제 metadata 항목 '${entry.path}'을 건너뛰었습니다.`,
        });
        return false;
      }
      if (/\.(?:png|jpe?g|webp|gif)$/u.test(lower)) return true;
      warnings.push({
        code: "IGNORED_ENTRY",
        path: entry.path,
        message: `CBZ의 비이미지 항목 '${entry.path}'을 건너뛰었습니다.`,
      });
      return false;
    })
    .sort((left, right) => compareStudioCbzPagePaths(left.path, right.path));
  if (imageEntries.length === 0 || imageEntries.length > limits.maxPages) {
    throw cbzError("PAGE_COUNT_LIMIT", "CBZ 페이지 수가 안전 범위를 벗어났습니다.");
  }

  const pages: StudioCbzImportedPage[] = [];
  let totalPageBytes = 0;
  let totalDecodedPixels = 0;
  let totalDecodedBytes = 0;
  let maxWidth = 0;
  let maxHeight = 0;
  for (let index = 0; index < imageEntries.length; index += 1) {
    throwIfAborted(options.signal);
    const entry = imageEntries[index];
    if (!entry) continue;
    if (entry.uncompressedBytes > limits.maxPageBytes) {
      throw cbzError("SIZE_LIMIT", "CBZ 페이지가 안전 한도를 넘었습니다.", entry.path);
    }
    const bytes = await readCbzEntry(archive, entry, options.signal);
    const detected = detectPage(bytes);
    if (!detected || !imageExtensionMatches(entry.path, detected)) {
      throw cbzError(
        "IMAGE_INVALID",
        "CBZ 페이지의 확장자와 PNG/JPEG/WebP/GIF 구조 및 크기 정보가 일치하지 않습니다.",
        entry.path
      );
    }
    assertDetectedPageBudget(detected, limits, entry.path);
    totalPageBytes += bytes.byteLength;
    if (totalPageBytes > limits.maxTotalPageBytes) {
      throw cbzError("SIZE_LIMIT", "CBZ 전체 페이지 크기가 안전 한도를 넘었습니다.");
    }
    totalDecodedPixels += detected.decodedPixelCount;
    totalDecodedBytes += detected.decodedByteSize;
    if (
      !Number.isSafeInteger(totalDecodedPixels) ||
      totalDecodedPixels > limits.maxTotalDecodedPixels ||
      !Number.isSafeInteger(totalDecodedBytes) ||
      totalDecodedBytes > limits.maxTotalDecodedBytes
    ) {
      throw cbzError("SIZE_LIMIT", "CBZ 전체 페이지의 디코드 메모리 예산을 넘었습니다.");
    }
    maxWidth = Math.max(maxWidth, detected.width);
    maxHeight = Math.max(maxHeight, detected.height);
    pages.push(Object.freeze({
      index,
      path: entry.path,
      mimeType: detected.mimeType,
      byteSize: bytes.byteLength,
      width: detected.width,
      height: detected.height,
      pixelCount: detected.pixelCount,
      frameCount: detected.frameCount,
      decodedPixelCount: detected.decodedPixelCount,
      decodedByteSize: detected.decodedByteSize,
      image: bytesToBlob(bytes, detected.mimeType),
    }));
  }

  if (declaredPageCount !== undefined && declaredPageCount !== pages.length) {
    warnings.push({
      code: "PAGE_COUNT_MISMATCH",
      message: `ComicInfo.xml은 ${declaredPageCount}페이지, archive는 ${pages.length}페이지입니다.`,
    });
  }
  return Object.freeze({
    pages: Object.freeze(pages),
    metadata: Object.freeze({
      ...metadata,
      ...(metadata.genre ? { genre: Object.freeze([...metadata.genre]) } : {}),
      ...(metadata.tags ? { tags: Object.freeze([...metadata.tags]) } : {}),
    }),
    summary: Object.freeze({
      pageCount: pages.length,
      totalEncodedBytes: totalPageBytes,
      totalDecodedPixels,
      totalDecodedBytes,
      maxWidth,
      maxHeight,
      hasComicInfo: comicInfoEntry !== undefined,
      ignoredEntryCount: warnings.filter((warning) => warning.code === "IGNORED_ENTRY").length,
    }),
    warnings: Object.freeze(warnings.map((warning) => Object.freeze({ ...warning }))),
  });
}
