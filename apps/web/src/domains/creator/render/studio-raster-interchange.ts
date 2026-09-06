/**
 * Dependency-free interchange codecs for open, byte-oriented raster formats that browsers cannot
 * reliably encode through Canvas. PNG/JPEG/WebP/AVIF continue to use the browser/Worker pipeline;
 * this module covers BMP, TGA, Netpbm PPM/PAM and QOI with strict memory budgets.
 */

import {
  decodeStudioTiffInterchange,
  encodeStudioTiffInterchange,
  sniffStudioTiffInterchange,
} from "../studio-tiff-interchange";

export type StudioRasterInterchangeFormat = "bmp" | "tga" | "ppm" | "pam" | "qoi" | "tiff";

export interface StudioRgbaBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export interface StudioRasterDecoded {
  readonly bitmap: StudioRgbaBitmap;
  readonly format: StudioRasterInterchangeFormat;
  readonly warnings: readonly string[];
}

export interface StudioRasterEncoded {
  readonly bytes: Uint8Array;
  readonly extension: `.${StudioRasterInterchangeFormat}`;
  readonly mimeType: string;
  readonly warnings: readonly string[];
  readonly lossy: boolean;
}

export interface StudioRasterDecodeOptions {
  /** Optional caller-specific ceiling applied before allocating the decoded RGBA buffer. */
  readonly maximumPixels?: number;
}

export const STUDIO_RASTER_INTERCHANGE_LIMITS = Object.freeze({
  maxWidth: 32_768,
  maxHeight: 32_768,
  maxPixels: 32_000_000,
  maxInputBytes: 192 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
});

export class StudioRasterInterchangeError extends Error {
  constructor(
    readonly code:
      | "INPUT_TOO_LARGE"
      | "INVALID_DIMENSIONS"
      | "INVALID_PIXELS"
      | "INVALID_FORMAT"
      | "UNSUPPORTED_VARIANT"
      | "OUTPUT_TOO_LARGE",
    message: string
  ) {
    super(message);
    this.name = "StudioRasterInterchangeError";
  }
}

const ASCII = new TextEncoder();

function fail(code: StudioRasterInterchangeError["code"], message: string): never {
  throw new StudioRasterInterchangeError(code, message);
}

function checkedPixelBytes(
  width: number,
  height: number,
  maximumPixels: number = STUDIO_RASTER_INTERCHANGE_LIMITS.maxPixels
): number {
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width < 1 || height < 1 ||
    width > STUDIO_RASTER_INTERCHANGE_LIMITS.maxWidth ||
    height > STUDIO_RASTER_INTERCHANGE_LIMITS.maxHeight ||
    !Number.isSafeInteger(pixels) ||
    pixels > STUDIO_RASTER_INTERCHANGE_LIMITS.maxPixels
  ) {
    return fail("INVALID_DIMENSIONS", "래스터 크기 또는 총 픽셀 수가 안전 한도를 벗어났습니다.");
  }
  if (!Number.isSafeInteger(maximumPixels) || maximumPixels < 1) {
    return fail("INVALID_DIMENSIONS", "래스터 디코드 픽셀 예산이 올바르지 않습니다.");
  }
  if (pixels > maximumPixels) {
    return fail("OUTPUT_TOO_LARGE", `래스터 디코드 크기가 직접 처리 안전 상한(${maximumPixels.toLocaleString("en-US")}픽셀)을 초과합니다.`);
  }
  return pixels * 4;
}

function validateBitmap(bitmap: StudioRgbaBitmap): Uint8Array | Uint8ClampedArray {
  const expected = checkedPixelBytes(bitmap.width, bitmap.height);
  if (
    !(bitmap.data instanceof Uint8Array) &&
    !(bitmap.data instanceof Uint8ClampedArray)
  ) {
    return fail("INVALID_PIXELS", "RGBA 픽셀 데이터는 8-bit typed array여야 합니다.");
  }
  if (bitmap.data.byteLength !== expected) {
    return fail("INVALID_PIXELS", "RGBA 픽셀 버퍼 길이가 이미지 크기와 일치하지 않습니다.");
  }
  return bitmap.data;
}

function validateInput(bytes: Uint8Array): void {
  if (bytes.byteLength === 0) fail("INVALID_FORMAT", "빈 래스터 파일입니다.");
  if (bytes.byteLength > STUDIO_RASTER_INTERCHANGE_LIMITS.maxInputBytes) {
    fail("INPUT_TOO_LARGE", "래스터 파일은 192MB 이하여야 합니다.");
  }
}

function checkedOutputSize(size: number): number {
  if (!Number.isSafeInteger(size) || size < 1 || size > STUDIO_RASTER_INTERCHANGE_LIMITS.maxOutputBytes) {
    return fail("OUTPUT_TOO_LARGE", "래스터 출력 크기가 256MB 안전 한도를 벗어났습니다.");
  }
  return size;
}

function writeU32be(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function readU32be(source: Uint8Array, offset: number): number {
  return (
    source[offset]! * 0x100_0000 +
    (source[offset + 1]! << 16) +
    (source[offset + 2]! << 8) +
    source[offset + 3]!
  ) >>> 0;
}

function flattenChannel(channel: number, alpha: number, background: number): number {
  return Math.round((channel * alpha + background * (255 - alpha)) / 255);
}

function hasTransparency(pixels: Uint8Array | Uint8ClampedArray): boolean {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 255) return true;
  }
  return false;
}

function encodeBmp(bitmap: StudioRgbaBitmap): StudioRasterEncoded {
  const pixels = validateBitmap(bitmap);
  const rowBytes = Math.ceil((bitmap.width * 3) / 4) * 4;
  const pixelBytes = rowBytes * bitmap.height;
  const size = checkedOutputSize(54 + pixelBytes);
  const output = new Uint8Array(size);
  const view = new DataView(output.buffer);
  output[0] = 0x42;
  output[1] = 0x4d;
  view.setUint32(2, size, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, bitmap.width, true);
  view.setInt32(22, bitmap.height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, 3_780, true);
  view.setInt32(42, 3_780, true);
  for (let y = 0; y < bitmap.height; y += 1) {
    const sourceY = bitmap.height - y - 1;
    const rowStart = 54 + y * rowBytes;
    for (let x = 0; x < bitmap.width; x += 1) {
      const source = (sourceY * bitmap.width + x) * 4;
      const target = rowStart + x * 3;
      const alpha = pixels[source + 3]!;
      output[target] = flattenChannel(pixels[source + 2]!, alpha, 255);
      output[target + 1] = flattenChannel(pixels[source + 1]!, alpha, 255);
      output[target + 2] = flattenChannel(pixels[source]!, alpha, 255);
    }
  }
  const lossy = hasTransparency(pixels);
  return {
    bytes: output,
    extension: ".bmp",
    mimeType: "image/bmp",
    warnings: lossy ? ["BMP 24-bit 호환 출력을 위해 투명 픽셀을 흰색 배경에 합성했습니다."] : [],
    lossy,
  };
}

function decodeBmp(bytes: Uint8Array, maximumPixels?: number): StudioRasterDecoded {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return fail("INVALID_FORMAT", "BMP 헤더가 올바르지 않습니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelOffset = view.getUint32(10, true);
  const dibSize = view.getUint32(14, true);
  if (dibSize < 40 || pixelOffset < 14 + dibSize || pixelOffset > bytes.length) {
    return fail("UNSUPPORTED_VARIANT", "BITMAPINFOHEADER 이상인 BMP만 지원합니다.");
  }
  const width = view.getInt32(18, true);
  const signedHeight = view.getInt32(22, true);
  const planes = view.getUint16(26, true);
  const bits = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (width <= 0 || signedHeight === 0) fail("INVALID_DIMENSIONS", "BMP 크기가 올바르지 않습니다.");
  if (planes !== 1 || (bits !== 24 && bits !== 32)) {
    fail("UNSUPPORTED_VARIANT", "압축되지 않은 24/32-bit RGB BMP만 지원합니다.");
  }
  // BI_BITFIELDS(3)는 Windows/GIMP가 32-bit BMP를 저장하는 사실상 표준 경로다. 마스크가 정확히
  // 표준 BGRA(V4/V5의 알파 포함 또는 40-byte header의 3-마스크 불투명) 배치일 때만 무압축 32-bit
  // 와 동일하게 디코드하고, 그 외 커스텀 비트필드는 정직하게 거부한다.
  let bitfieldsAlphaMask = 0xff00_0000;
  if (compression === 3) {
    const maskEnd = dibSize >= 56 ? 70 : 66;
    if (bits !== 32 || bytes.length < maskEnd || pixelOffset < maskEnd) {
      fail("UNSUPPORTED_VARIANT", "표준 BGRA 마스크의 32-bit BI_BITFIELDS BMP만 지원합니다.");
    }
    const redMask = view.getUint32(54, true);
    const greenMask = view.getUint32(58, true);
    const blueMask = view.getUint32(62, true);
    bitfieldsAlphaMask = dibSize >= 56 ? view.getUint32(66, true) : 0;
    if (
      redMask !== 0x00ff_0000 || greenMask !== 0x0000_ff00 || blueMask !== 0x0000_00ff ||
      (bitfieldsAlphaMask !== 0 && bitfieldsAlphaMask !== 0xff00_0000)
    ) {
      fail("UNSUPPORTED_VARIANT", "표준 BGRA 마스크의 32-bit BI_BITFIELDS BMP만 지원합니다.");
    }
  } else if (compression !== 0) {
    fail("UNSUPPORTED_VARIANT", "압축되지 않은 24/32-bit RGB BMP만 지원합니다.");
  }
  const height = Math.abs(signedHeight);
  const pixelBytes = checkedPixelBytes(width, height, maximumPixels);
  const rowBytes = Math.ceil((width * (bits / 8)) / 4) * 4;
  if (pixelOffset + rowBytes * height > bytes.length) fail("INVALID_FORMAT", "BMP 픽셀 데이터가 잘렸습니다.");
  const output = new Uint8ClampedArray(pixelBytes);
  const warnings: string[] = [];
  const alphaChannelPresent = bits === 32 && (compression !== 3 || bitfieldsAlphaMask !== 0);
  let nonZeroAlpha = false;
  if (alphaChannelPresent) {
    for (let offset = pixelOffset + 3; offset < pixelOffset + rowBytes * height; offset += 4) {
      nonZeroAlpha ||= bytes[offset] !== 0;
    }
    if (!nonZeroAlpha) warnings.push("32-bit BMP의 알파 바이트가 모두 0이어서 불투명 RGB로 해석했습니다.");
  }
  for (let y = 0; y < height; y += 1) {
    const sourceY = signedHeight < 0 ? y : height - y - 1;
    const sourceRow = pixelOffset + sourceY * rowBytes;
    for (let x = 0; x < width; x += 1) {
      const source = sourceRow + x * (bits / 8);
      const target = (y * width + x) * 4;
      output[target] = bytes[source + 2]!;
      output[target + 1] = bytes[source + 1]!;
      output[target + 2] = bytes[source]!;
      output[target + 3] = alphaChannelPresent && nonZeroAlpha ? bytes[source + 3]! : 255;
    }
  }
  return { bitmap: { width, height, data: output }, format: "bmp", warnings };
}

function encodeTga(bitmap: StudioRgbaBitmap): StudioRasterEncoded {
  const pixels = validateBitmap(bitmap);
  const size = checkedOutputSize(18 + pixels.byteLength);
  const output = new Uint8Array(size);
  const view = new DataView(output.buffer);
  output[2] = 2;
  view.setUint16(12, bitmap.width, true);
  view.setUint16(14, bitmap.height, true);
  output[16] = 32;
  output[17] = 0x28; // top-left origin + eight alpha bits
  for (let source = 0, target = 18; source < pixels.length; source += 4, target += 4) {
    output[target] = pixels[source + 2]!;
    output[target + 1] = pixels[source + 1]!;
    output[target + 2] = pixels[source]!;
    output[target + 3] = pixels[source + 3]!;
  }
  return { bytes: output, extension: ".tga", mimeType: "image/x-tga", warnings: [], lossy: false };
}

function decodeTga(bytes: Uint8Array, maximumPixels?: number): StudioRasterDecoded {
  if (bytes.length < 18) fail("INVALID_FORMAT", "TGA 헤더가 잘렸습니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idLength = bytes[0]!;
  const colorMapType = bytes[1]!;
  const imageType = bytes[2]!;
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const bits = bytes[16]!;
  const descriptor = bytes[17]!;
  if (colorMapType !== 0 || imageType !== 2 || (bits !== 24 && bits !== 32)) {
    fail("UNSUPPORTED_VARIANT", "색상표·압축이 없는 24/32-bit true-color TGA만 지원합니다.");
  }
  const pixelBytes = checkedPixelBytes(width, height, maximumPixels);
  const sourceOffset = 18 + idLength;
  const bytesPerPixel = bits / 8;
  if (sourceOffset + width * height * bytesPerPixel > bytes.length) {
    fail("INVALID_FORMAT", "TGA 픽셀 데이터가 잘렸습니다.");
  }
  const topOrigin = (descriptor & 0x20) !== 0;
  const rightOrigin = (descriptor & 0x10) !== 0;
  const output = new Uint8ClampedArray(pixelBytes);
  for (let sourceIndex = 0; sourceIndex < width * height; sourceIndex += 1) {
    const sourceX = sourceIndex % width;
    const sourceY = Math.floor(sourceIndex / width);
    const x = rightOrigin ? width - sourceX - 1 : sourceX;
    const y = topOrigin ? sourceY : height - sourceY - 1;
    const source = sourceOffset + sourceIndex * bytesPerPixel;
    const target = (y * width + x) * 4;
    output[target] = bytes[source + 2]!;
    output[target + 1] = bytes[source + 1]!;
    output[target + 2] = bytes[source]!;
    output[target + 3] = bits === 32 ? bytes[source + 3]! : 255;
  }
  return { bitmap: { width, height, data: output }, format: "tga", warnings: [] };
}

function encodePpm(bitmap: StudioRgbaBitmap): StudioRasterEncoded {
  const pixels = validateBitmap(bitmap);
  const header = ASCII.encode(`P6\n${bitmap.width} ${bitmap.height}\n255\n`);
  const output = new Uint8Array(checkedOutputSize(header.length + bitmap.width * bitmap.height * 3));
  output.set(header);
  let target = header.length;
  for (let source = 0; source < pixels.length; source += 4) {
    const alpha = pixels[source + 3]!;
    output[target++] = flattenChannel(pixels[source]!, alpha, 255);
    output[target++] = flattenChannel(pixels[source + 1]!, alpha, 255);
    output[target++] = flattenChannel(pixels[source + 2]!, alpha, 255);
  }
  const lossy = hasTransparency(pixels);
  return {
    bytes: output,
    extension: ".ppm",
    mimeType: "image/x-portable-pixmap",
    warnings: lossy ? ["PPM에는 알파 채널이 없어 투명 픽셀을 흰색 배경에 합성했습니다."] : [],
    lossy,
  };
}

function encodePam(bitmap: StudioRgbaBitmap): StudioRasterEncoded {
  const pixels = validateBitmap(bitmap);
  const header = ASCII.encode(
    `P7\nWIDTH ${bitmap.width}\nHEIGHT ${bitmap.height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`
  );
  const output = new Uint8Array(checkedOutputSize(header.length + pixels.byteLength));
  output.set(header);
  output.set(pixels, header.length);
  return { bytes: output, extension: ".pam", mimeType: "image/x-portable-arbitrarymap", warnings: [], lossy: false };
}

interface NetpbmTokenState {
  offset: number;
}

function nextNetpbmToken(bytes: Uint8Array, state: NetpbmTokenState): string {
  while (state.offset < bytes.length) {
    const byte = bytes[state.offset]!;
    if (byte === 0x23) {
      while (state.offset < bytes.length && bytes[state.offset] !== 0x0a) state.offset += 1;
    } else if (byte <= 0x20) {
      state.offset += 1;
    } else {
      break;
    }
  }
  const start = state.offset;
  while (state.offset < bytes.length && bytes[state.offset]! > 0x20 && bytes[state.offset] !== 0x23) {
    state.offset += 1;
  }
  if (start === state.offset) fail("INVALID_FORMAT", "Netpbm 헤더 토큰이 부족합니다.");
  return String.fromCharCode(...bytes.subarray(start, state.offset));
}

function decodePpm(bytes: Uint8Array, maximumPixels?: number): StudioRasterDecoded {
  const state = { offset: 0 };
  if (nextNetpbmToken(bytes, state) !== "P6") {
    fail("UNSUPPORTED_VARIANT", "바이너리 PPM(P6)만 지원합니다.");
  }
  const width = Number(nextNetpbmToken(bytes, state));
  const height = Number(nextNetpbmToken(bytes, state));
  const maximum = Number(nextNetpbmToken(bytes, state));
  if (maximum !== 255) fail("UNSUPPORTED_VARIANT", "8-bit(MAXVAL 255) PPM만 지원합니다.");
  const pixelBytes = checkedPixelBytes(width, height, maximumPixels);
  if (state.offset >= bytes.length || bytes[state.offset]! > 0x20) {
    fail("INVALID_FORMAT", "PPM 헤더와 픽셀 사이의 공백 구분자가 없습니다.");
  }
  if (bytes[state.offset] === 0x0d && bytes[state.offset + 1] === 0x0a) state.offset += 2;
  else state.offset += 1;
  if (state.offset + width * height * 3 !== bytes.length) {
    fail("INVALID_FORMAT", "PPM 픽셀 데이터 길이가 이미지 크기와 일치하지 않습니다.");
  }
  const output = new Uint8ClampedArray(pixelBytes);
  for (let source = state.offset, target = 0; source < bytes.length; source += 3, target += 4) {
    output[target] = bytes[source]!;
    output[target + 1] = bytes[source + 1]!;
    output[target + 2] = bytes[source + 2]!;
    output[target + 3] = 255;
  }
  return { bitmap: { width, height, data: output }, format: "ppm", warnings: [] };
}

function decodePam(bytes: Uint8Array, maximumPixels?: number): StudioRasterDecoded {
  const endMarker = ASCII.encode("ENDHDR\n");
  let end = -1;
  outer: for (let offset = 0; offset <= Math.min(bytes.length - endMarker.length, 4_096); offset += 1) {
    for (let index = 0; index < endMarker.length; index += 1) {
      if (bytes[offset + index] !== endMarker[index]) continue outer;
    }
    end = offset + endMarker.length;
    break;
  }
  if (end < 0) fail("INVALID_FORMAT", "PAM ENDHDR 헤더를 찾지 못했습니다.");
  let header: string;
  try {
    header = new TextDecoder("ascii", { fatal: true }).decode(bytes.subarray(0, end));
  } catch {
    return fail("INVALID_FORMAT", "PAM 헤더가 ASCII 텍스트가 아닙니다.");
  }
  if (!header.startsWith("P7\n")) fail("INVALID_FORMAT", "PAM(P7) 헤더가 아닙니다.");
  const fields = new Map<string, string>();
  for (const line of header.split("\n").slice(1)) {
    const clean = line.replace(/#.*$/u, "").trim();
    if (!clean || clean === "ENDHDR") continue;
    const match = /^(\S+)\s+(.+)$/u.exec(clean);
    if (match) fields.set(match[1]!.toUpperCase(), match[2]!.trim());
  }
  const width = Number(fields.get("WIDTH"));
  const height = Number(fields.get("HEIGHT"));
  const depth = Number(fields.get("DEPTH"));
  const maximum = Number(fields.get("MAXVAL"));
  if (maximum !== 255 || (depth !== 3 && depth !== 4)) {
    fail("UNSUPPORTED_VARIANT", "8-bit RGB/RGBA PAM만 지원합니다.");
  }
  const pixelBytes = checkedPixelBytes(width, height, maximumPixels);
  if (end + width * height * depth !== bytes.length) {
    fail("INVALID_FORMAT", "PAM 픽셀 데이터 길이가 이미지 크기와 일치하지 않습니다.");
  }
  const output = new Uint8ClampedArray(pixelBytes);
  for (let source = end, target = 0; source < bytes.length; source += depth, target += 4) {
    output[target] = bytes[source]!;
    output[target + 1] = bytes[source + 1]!;
    output[target + 2] = bytes[source + 2]!;
    output[target + 3] = depth === 4 ? bytes[source + 3]! : 255;
  }
  return { bitmap: { width, height, data: output }, format: "pam", warnings: [] };
}

function qoiHash(r: number, g: number, b: number, a: number): number {
  return (r * 3 + g * 5 + b * 7 + a * 11) % 64;
}

function encodeQoi(bitmap: StudioRgbaBitmap): StudioRasterEncoded {
  const pixels = validateBitmap(bitmap);
  const maximum = checkedOutputSize(14 + bitmap.width * bitmap.height * 5 + 8);
  const output = new Uint8Array(maximum);
  output.set([0x71, 0x6f, 0x69, 0x66]);
  writeU32be(output, 4, bitmap.width);
  writeU32be(output, 8, bitmap.height);
  output[12] = 4;
  output[13] = 0;
  const index = new Uint8Array(64 * 4);
  let previousR = 0;
  let previousG = 0;
  let previousB = 0;
  let previousA = 255;
  let run = 0;
  let target = 14;
  const flushRun = (): void => {
    if (run > 0) {
      output[target++] = 0xc0 | (run - 1);
      run = 0;
    }
  };
  for (let source = 0; source < pixels.length; source += 4) {
    const r = pixels[source]!;
    const g = pixels[source + 1]!;
    const b = pixels[source + 2]!;
    const a = pixels[source + 3]!;
    if (r === previousR && g === previousG && b === previousB && a === previousA) {
      run += 1;
      if (run === 62 || source + 4 === pixels.length) flushRun();
      continue;
    }
    flushRun();
    const hash = qoiHash(r, g, b, a);
    const hashOffset = hash * 4;
    if (
      index[hashOffset] === r && index[hashOffset + 1] === g &&
      index[hashOffset + 2] === b && index[hashOffset + 3] === a
    ) {
      output[target++] = hash;
    } else {
      index[hashOffset] = r;
      index[hashOffset + 1] = g;
      index[hashOffset + 2] = b;
      index[hashOffset + 3] = a;
      if (a === previousA) {
        const dr = r - previousR;
        const dg = g - previousG;
        const db = b - previousB;
        if (dr >= -2 && dr <= 1 && dg >= -2 && dg <= 1 && db >= -2 && db <= 1) {
          output[target++] = 0x40 | ((dr + 2) << 4) | ((dg + 2) << 2) | (db + 2);
        } else {
          const drdg = dr - dg;
          const dbdg = db - dg;
          if (dg >= -32 && dg <= 31 && drdg >= -8 && drdg <= 7 && dbdg >= -8 && dbdg <= 7) {
            output[target++] = 0x80 | (dg + 32);
            output[target++] = ((drdg + 8) << 4) | (dbdg + 8);
          } else {
            output[target++] = 0xfe;
            output[target++] = r;
            output[target++] = g;
            output[target++] = b;
          }
        }
      } else {
        output[target++] = 0xff;
        output[target++] = r;
        output[target++] = g;
        output[target++] = b;
        output[target++] = a;
      }
    }
    previousR = r;
    previousG = g;
    previousB = b;
    previousA = a;
  }
  output.set([0, 0, 0, 0, 0, 0, 0, 1], target);
  target += 8;
  return {
    bytes: output.slice(0, target),
    extension: ".qoi",
    mimeType: "image/qoi",
    warnings: [],
    lossy: false,
  };
}

function decodeQoi(bytes: Uint8Array, maximumPixels?: number): StudioRasterDecoded {
  if (
    bytes.length < 22 || bytes[0] !== 0x71 || bytes[1] !== 0x6f ||
    bytes[2] !== 0x69 || bytes[3] !== 0x66
  ) {
    return fail("INVALID_FORMAT", "QOI 헤더가 올바르지 않습니다.");
  }
  const width = readU32be(bytes, 4);
  const height = readU32be(bytes, 8);
  const channels = bytes[12]!;
  const colorSpace = bytes[13]!;
  if ((channels !== 3 && channels !== 4) || colorSpace > 1) {
    fail("UNSUPPORTED_VARIANT", "QOI 채널/색 공간 플래그가 올바르지 않습니다.");
  }
  const pixelBytes = checkedPixelBytes(width, height, maximumPixels);
  const output = new Uint8ClampedArray(pixelBytes);
  const index = new Uint8Array(64 * 4);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 255;
  let source = 14;
  let target = 0;
  while (target < output.length) {
    if (source >= bytes.length - 8) fail("INVALID_FORMAT", "QOI 픽셀 스트림이 잘렸습니다.");
    const tag = bytes[source++]!;
    let run = 1;
    if (tag === 0xfe) {
      if (source + 3 > bytes.length - 8) fail("INVALID_FORMAT", "QOI RGB opcode가 잘렸습니다.");
      r = bytes[source++]!;
      g = bytes[source++]!;
      b = bytes[source++]!;
    } else if (tag === 0xff) {
      if (source + 4 > bytes.length - 8) fail("INVALID_FORMAT", "QOI RGBA opcode가 잘렸습니다.");
      r = bytes[source++]!;
      g = bytes[source++]!;
      b = bytes[source++]!;
      a = bytes[source++]!;
    } else {
      const family = tag & 0xc0;
      if (family === 0x00) {
        const offset = (tag & 0x3f) * 4;
        r = index[offset]!;
        g = index[offset + 1]!;
        b = index[offset + 2]!;
        a = index[offset + 3]!;
      } else if (family === 0x40) {
        r = (r + ((tag >>> 4) & 0x03) - 2) & 0xff;
        g = (g + ((tag >>> 2) & 0x03) - 2) & 0xff;
        b = (b + (tag & 0x03) - 2) & 0xff;
      } else if (family === 0x80) {
        if (source >= bytes.length - 8) fail("INVALID_FORMAT", "QOI LUMA opcode가 잘렸습니다.");
        const next = bytes[source++]!;
        const dg = (tag & 0x3f) - 32;
        r = (r + dg + (next >>> 4) - 8) & 0xff;
        g = (g + dg) & 0xff;
        b = (b + dg + (next & 0x0f) - 8) & 0xff;
      } else {
        run = (tag & 0x3f) + 1;
      }
    }
    const hash = qoiHash(r, g, b, a) * 4;
    index[hash] = r;
    index[hash + 1] = g;
    index[hash + 2] = b;
    index[hash + 3] = a;
    if (target + run * 4 > output.length) fail("INVALID_FORMAT", "QOI run이 픽셀 범위를 벗어났습니다.");
    for (let count = 0; count < run; count += 1) {
      output[target++] = r;
      output[target++] = g;
      output[target++] = b;
      output[target++] = a;
    }
  }
  const end = bytes.subarray(source, source + 8);
  if (end.length !== 8 || end.some((value, indexValue) => value !== (indexValue === 7 ? 1 : 0))) {
    fail("INVALID_FORMAT", "QOI 종료 마커가 올바르지 않습니다.");
  }
  if (source + 8 !== bytes.length) fail("INVALID_FORMAT", "QOI 종료 뒤에 예기치 않은 데이터가 있습니다.");
  return {
    bitmap: { width, height, data: output },
    format: "qoi",
    warnings: channels === 3 ? ["QOI가 RGB 채널로 표시되어 모든 픽셀을 불투명으로 해석했습니다."] : [],
  };
}

export function sniffStudioRasterInterchange(bytes: Uint8Array): StudioRasterInterchangeFormat | null {
  validateInput(bytes);
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (bytes[0] === 0x71 && bytes[1] === 0x6f && bytes[2] === 0x69 && bytes[3] === 0x66) return "qoi";
  if (bytes[0] === 0x50 && bytes[1] === 0x36) return "ppm";
  if (bytes[0] === 0x50 && bytes[1] === 0x37) return "pam";
  if (sniffStudioTiffInterchange(bytes)) return "tiff";
  if (bytes.length >= 18 && bytes[1] === 0 && bytes[2] === 2 && (bytes[16] === 24 || bytes[16] === 32)) return "tga";
  return null;
}

export function encodeStudioRasterInterchange(
  format: StudioRasterInterchangeFormat,
  bitmap: StudioRgbaBitmap
): StudioRasterEncoded {
  switch (format) {
    case "bmp": return encodeBmp(bitmap);
    case "tga": return encodeTga(bitmap);
    case "ppm": return encodePpm(bitmap);
    case "pam": return encodePam(bitmap);
    case "qoi": return encodeQoi(bitmap);
    case "tiff": {
      const encoded = encodeStudioTiffInterchange(bitmap);
      return {
        ...encoded,
        warnings: encoded.warnings.map((warning) => warning.message),
      };
    }
  }
}

export function decodeStudioRasterInterchange(
  source: Uint8Array | ArrayBuffer,
  expectedFormat?: StudioRasterInterchangeFormat,
  options: StudioRasterDecodeOptions = {}
): StudioRasterDecoded {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  validateInput(bytes);
  const format = sniffStudioRasterInterchange(bytes);
  if (!format) fail("INVALID_FORMAT", "BMP/TGA/PPM/PAM/QOI/TIFF 파일을 식별하지 못했습니다.");
  if (expectedFormat && expectedFormat !== format) {
    fail("INVALID_FORMAT", `파일 내용은 .${format}인데 .${expectedFormat}로 지정되었습니다.`);
  }
  switch (format) {
    case "bmp": return decodeBmp(bytes, options.maximumPixels);
    case "tga": return decodeTga(bytes, options.maximumPixels);
    case "ppm": return decodePpm(bytes, options.maximumPixels);
    case "pam": return decodePam(bytes, options.maximumPixels);
    case "qoi": return decodeQoi(bytes, options.maximumPixels);
    case "tiff": {
      const decoded = decodeStudioTiffInterchange(bytes, { maximumPixels: options.maximumPixels });
      return {
        bitmap: decoded.bitmap,
        format,
        warnings: decoded.warnings.map((warning) => warning.message),
      };
    }
  }
}
