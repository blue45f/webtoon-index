import {
  inspectStrictJpegDimensions,
  inspectStrictStaticWebpDimensions,
} from "@/shared/lib/strict-raster-image-inspector";

export const STUDIO_BG3D_MODEL_THUMBNAIL_MAX_DIMENSION = 512;
export const STUDIO_BG3D_MODEL_THUMBNAIL_MAX_PIXELS = 512 * 512;
/** Covers a worst-case 512px RGBA thumbnail plus bounded PNG/container overhead. */
export const STUDIO_BG3D_MODEL_THUMBNAIL_MAX_BYTES =
  STUDIO_BG3D_MODEL_THUMBNAIL_MAX_PIXELS * 4 + 256 * 1024;
export const STUDIO_BG3D_MODEL_THUMBNAIL_WIDTH = 320;
export const STUDIO_BG3D_MODEL_THUMBNAIL_HEIGHT = 180;

export type StudioBg3dModelThumbnailMime = "image/jpeg" | "image/png" | "image/webp";

export interface StudioBg3dModelThumbnailData {
  readonly dataUrl: string;
  readonly mime: StudioBg3dModelThumbnailMime;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
}

const DATA_URL_PREFIXES: Readonly<Record<StudioBg3dModelThumbnailMime, string>> = Object.freeze({
  "image/jpeg": "data:image/jpeg;base64,",
  "image/png": "data:image/png;base64,",
  "image/webp": "data:image/webp;base64,",
});
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const PNG_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const PNG_MAX_CHUNKS = 1_024;
const CRC32_TABLE = (() => {
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

const BASE64_DECODE = (() => {
  const table = new Uint8Array(128);
  table.fill(0xff);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < alphabet.length; index += 1) {
    table[alphabet.charCodeAt(index)] = index;
  }
  return table;
})();

function decodeCanonicalBase64(payload: string): Uint8Array<ArrayBuffer> | null {
  if (payload.length < 4 || payload.length % 4 !== 0) return null;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const byteLength = payload.length / 4 * 3 - padding;
  if (
    !Number.isSafeInteger(byteLength)
    || byteLength < 12
    || byteLength > STUDIO_BG3D_MODEL_THUMBNAIL_MAX_BYTES
  ) return null;
  const bytes = new Uint8Array(byteLength);
  let output = 0;
  for (let offset = 0; offset < payload.length; offset += 4) {
    const isLast = offset + 4 === payload.length;
    const codes = [
      payload.charCodeAt(offset),
      payload.charCodeAt(offset + 1),
      payload.charCodeAt(offset + 2),
      payload.charCodeAt(offset + 3),
    ] as const;
    if (codes[0] >= 128 || codes[1] >= 128) return null;
    const first = BASE64_DECODE[codes[0]] ?? 0xff;
    const second = BASE64_DECODE[codes[1]] ?? 0xff;
    if (first === 0xff || second === 0xff) return null;
    const thirdPadding = codes[2] === 0x3d;
    const fourthPadding = codes[3] === 0x3d;
    if ((thirdPadding || fourthPadding) && !isLast) return null;
    if (thirdPadding && !fourthPadding) return null;
    if ((thirdPadding ? 2 : fourthPadding ? 1 : 0) !== (isLast ? padding : 0)) return null;
    if ((!thirdPadding && codes[2] >= 128) || (!fourthPadding && codes[3] >= 128)) return null;
    const third = thirdPadding ? 0 : (BASE64_DECODE[codes[2]] ?? 0xff);
    const fourth = fourthPadding ? 0 : (BASE64_DECODE[codes[3]] ?? 0xff);
    if (third === 0xff || fourth === 0xff) return null;
    if ((thirdPadding && (second & 0x0f) !== 0) || (fourthPadding && (third & 0x03) !== 0)) {
      return null;
    }
    if (output < bytes.length) bytes[output++] = first << 2 | second >> 4;
    if (output < bytes.length) bytes[output++] = (second & 0x0f) << 4 | third >> 2;
    if (output < bytes.length) bytes[output++] = (third & 0x03) << 6 | fourth;
  }
  return output === bytes.length ? bytes : null;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return value;
}

function pngChunkCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffff_ffff;
  for (let index = start; index < end; index += 1) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngDimensions(bytes: Uint8Array): { readonly width: number; readonly height: number } | null {
  if (
    bytes.byteLength < 57
    || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = PNG_SIGNATURE.length;
  let chunks = 0;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;
  while (offset < bytes.byteLength) {
    chunks += 1;
    if (chunks > PNG_MAX_CHUNKS || offset + 12 > bytes.byteLength) return null;
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + length;
    const nextOffset = dataEnd + 4;
    if (!Number.isSafeInteger(dataEnd) || nextOffset > bytes.byteLength) return null;
    const type = ascii(bytes, typeOffset, 4);
    if (!/^[A-Za-z]{4}$/u.test(type)) return null;
    if (/^[A-Z]/u.test(type) && !PNG_CRITICAL_CHUNKS.has(type)) return null;
    if (pngChunkCrc32(bytes, typeOffset, dataEnd) !== view.getUint32(dataEnd, false)) return null;
    if (!sawIhdr) {
      if (type !== "IHDR" || length !== 13) return null;
      width = view.getUint32(dataOffset, false);
      height = view.getUint32(dataOffset + 4, false);
      const colorType = bytes[dataOffset + 9];
      if (
        bytes[dataOffset + 8] !== 8
        || (colorType !== 2 && colorType !== 6)
        || bytes[dataOffset + 10] !== 0
        || bytes[dataOffset + 11] !== 0
        || bytes[dataOffset + 12] !== 0
      ) return null;
      sawIhdr = true;
    } else if (type === "IHDR") {
      return null;
    } else if (type === "IDAT") {
      if (endedIdat || length === 0) return null;
      sawIdat = true;
    } else if (type === "IEND") {
      if (!sawIdat || length !== 0 || sawIend || nextOffset !== bytes.byteLength) return null;
      sawIend = true;
    } else if (sawIdat) {
      endedIdat = true;
    }
    offset = nextOffset;
  }
  return sawIhdr && sawIdat && sawIend && offset === bytes.byteLength
    ? { width, height }
    : null;
}

function dimensionsFor(
  mime: StudioBg3dModelThumbnailMime,
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  try {
    if (mime === "image/png") return pngDimensions(bytes);
    if (mime === "image/jpeg") return inspectStrictJpegDimensions(bytes);
    return inspectStrictStaticWebpDimensions(bytes);
  } catch {
    return null;
  }
}

function admittedDimensions(
  dimensions: { readonly width: number; readonly height: number } | null,
): dimensions is { readonly width: number; readonly height: number } {
  if (!dimensions) return false;
  const pixels = dimensions.width * dimensions.height;
  return Number.isSafeInteger(pixels)
    && dimensions.width >= 1
    && dimensions.height >= 1
    && dimensions.width <= STUDIO_BG3D_MODEL_THUMBNAIL_MAX_DIMENSION
    && dimensions.height <= STUDIO_BG3D_MODEL_THUMBNAIL_MAX_DIMENSION
    && pixels <= STUDIO_BG3D_MODEL_THUMBNAIL_MAX_PIXELS;
}

/**
 * Fully decodes the bounded base64 payload before trusting its declared MIME or dimensions.
 * Callers should retain only the returned canonical input string; malformed local DB values are
 * treated exactly like a cache miss and never reach an <img> element.
 */
export function inspectStudioBg3dModelThumbnailDataUrl(
  value: unknown,
): StudioBg3dModelThumbnailData | null {
  if (typeof value !== "string") return null;
  let mime: StudioBg3dModelThumbnailMime | null = null;
  let prefix = "";
  for (const [candidate, candidatePrefix] of Object.entries(DATA_URL_PREFIXES) as readonly (
    readonly [StudioBg3dModelThumbnailMime, string]
  )[]) {
    if (value.startsWith(candidatePrefix)) {
      mime = candidate;
      prefix = candidatePrefix;
      break;
    }
  }
  if (!mime) return null;
  const maximumEncodedLength = Math.ceil(STUDIO_BG3D_MODEL_THUMBNAIL_MAX_BYTES / 3) * 4;
  if (value.length > prefix.length + maximumEncodedLength) return null;
  const payload = value.slice(prefix.length);
  const bytes = decodeCanonicalBase64(payload);
  if (!bytes) return null;
  const dimensions = dimensionsFor(mime, bytes);
  if (!admittedDimensions(dimensions)) return null;
  return Object.freeze({
    dataUrl: value,
    mime,
    byteLength: bytes.byteLength,
    width: dimensions.width,
    height: dimensions.height,
  });
}

export function normalizeStudioBg3dModelThumbnailDataUrl(value: unknown): string | null {
  return inspectStudioBg3dModelThumbnailDataUrl(value)?.dataUrl ?? null;
}
