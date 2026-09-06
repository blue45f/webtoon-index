/** 브라우저 저장·드래그 경계가 공유하는 data URL 직렬화 상한. */
export const STUDIO_ASSET_DATA_URL_MAX_CHARS = 32 * 1024 * 1024;
export const STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES = 12 * 1024 * 1024;
export const STUDIO_UPLOAD_MAX_SOURCE_BATCH_BYTES = 48 * 1024 * 1024;
export const STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS = 16_777_216;
export const STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS = 8_388_608;

const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type StudioUploadImageFormat = "jpeg" | "png" | "webp";

export interface StudioUploadImageDimensions {
  format: StudioUploadImageFormat;
  width: number;
  height: number;
  pixels: number;
}

export interface StudioUploadSourceFileLike {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export class StudioUploadImageSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudioUploadImageSafetyError";
  }
}

function sourceName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `“${trimmed.slice(0, 120)}”` : "선택한 이미지";
}

function mimeFor(format: StudioUploadImageFormat): string {
  if (format === "jpeg") return "image/jpeg";
  return `image/${format}`;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function dimensions(
  format: StudioUploadImageFormat,
  width: number,
  height: number
): StudioUploadImageDimensions | null {
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(pixels)
  ) {
    return null;
  }
  return { format, width, height, pixels };
}

function parsePng(bytes: Uint8Array): StudioUploadImageDimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dimensions("png", view.getUint32(16), view.getUint32(20));
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpeg(bytes: Uint8Array): StudioUploadImageDimensions | null {
  if (bytes.length < 10 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) return null;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return dimensions("jpeg", width, height);
    }
    offset += segmentLength;
  }
  return null;
}

function parseWebp(bytes: Uint8Array): StudioUploadImageDimensions | null {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP"
  ) {
    return null;
  }
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return dimensions(
      "webp",
      readUint24LittleEndian(bytes, 24) + 1,
      readUint24LittleEndian(bytes, 27) + 1
    );
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return dimensions(
      "webp",
      1 + b0 + ((b1 & 0x3f) << 8),
      1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10))
    );
  }
  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
    return dimensions("webp", width, height);
  }
  return null;
}

export function parseStudioUploadImageDimensions(
  source: ArrayBuffer | Uint8Array
): StudioUploadImageDimensions {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const parsed = parsePng(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
  if (!parsed) {
    throw new StudioUploadImageSafetyError(
      "PNG, JPG, WebP 이미지 헤더를 확인하지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요."
    );
  }
  return parsed;
}

export function selectStudioUploadDecodedPixelLimit({
  coarsePointer,
  deviceMemoryGb,
}: {
  coarsePointer: boolean;
  deviceMemoryGb?: number;
}): number {
  return coarsePointer || (deviceMemoryGb !== undefined && deviceMemoryGb <= 4)
    ? STUDIO_UPLOAD_MOBILE_MAX_DECODED_PIXELS
    : STUDIO_UPLOAD_DESKTOP_MAX_DECODED_PIXELS;
}

export function assertStudioUploadSourceBatch(
  files: readonly Pick<StudioUploadSourceFileLike, "name" | "size" | "type">[]
): number {
  let totalBytes = 0;
  for (const file of files) {
    const label = sourceName(file.name);
    if (!Number.isSafeInteger(file.size) || file.size < 1) {
      throw new StudioUploadImageSafetyError(`${label} 파일이 비어 있거나 크기를 확인할 수 없습니다.`);
    }
    if (file.size > STUDIO_UPLOAD_MAX_SOURCE_FILE_BYTES) {
      throw new StudioUploadImageSafetyError(
        `${label} 원본이 12MB를 초과합니다. 먼저 크기를 줄이거나 여러 페이지로 나눠 주세요.`
      );
    }
    const normalizedType = file.type.trim().toLowerCase();
    if (normalizedType && !SUPPORTED_MIME_TYPES.has(normalizedType)) {
      throw new StudioUploadImageSafetyError(
        `${label} 형식은 지원하지 않습니다. PNG, JPG 또는 WebP로 변환해 주세요.`
      );
    }
    totalBytes += file.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > STUDIO_UPLOAD_MAX_SOURCE_BATCH_BYTES) {
      throw new StudioUploadImageSafetyError(
        "한 번에 선택한 원본 이미지가 48MB를 초과합니다. 모바일 안정성을 위해 나눠서 추가해 주세요."
      );
    }
  }
  return totalBytes;
}

export function assertStudioUploadDecodedPixels(
  image: StudioUploadImageDimensions,
  maximumPixels: number,
  name = "선택한 이미지"
): StudioUploadImageDimensions {
  if (
    !Number.isSafeInteger(maximumPixels) ||
    maximumPixels < 1 ||
    image.pixels > maximumPixels
  ) {
    const megapixels = Math.max(1, Math.floor(maximumPixels / 1_000_000));
    throw new StudioUploadImageSafetyError(
      `${sourceName(name)} 해상도가 안전 한도(${megapixels}MP)를 초과합니다. 긴 원고는 여러 페이지로 나눠 주세요.`
    );
  }
  return image;
}

export async function inspectStudioUploadSourceImage(
  file: StudioUploadSourceFileLike,
  maximumPixels: number
): Promise<StudioUploadImageDimensions> {
  assertStudioUploadSourceBatch([file]);
  const parsed = parseStudioUploadImageDimensions(await file.arrayBuffer());
  const normalizedType = file.type.trim().toLowerCase();
  if (normalizedType && normalizedType !== mimeFor(parsed.format)) {
    throw new StudioUploadImageSafetyError(
      `${sourceName(file.name)} 확장 형식과 실제 이미지 내용이 일치하지 않습니다.`
    );
  }
  return assertStudioUploadDecodedPixels(parsed, maximumPixels, file.name);
}
