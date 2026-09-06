/** Engine-independent full-file integrity checks shared by recovery and final packaging. */

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IHDR_BYTES = 13;
const PNG_MAX_CHUNKS = 4_096;
const PNG_CHUNK_TYPE_PATTERN = /^[A-Za-z]{4}$/u;
const PNG_KNOWN_CRITICAL_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const PSD_MAX_LAYERS = 4;
const PSD_MAX_CHANNELS = 4;
const PSD_MAX_RESOURCE_BLOCKS = 1_024;
const PSD_LAYER_NAMES = new Set([
  "3D LT · 컬러 렌더",
  "3D LT · 톤",
  "3D LT · 질감선",
  "3D LT · 주선",
]);
const PSD_RGBA_CHANNEL_IDS = new Set([-1, 0, 1, 2]);

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

interface PngIdatRange {
  readonly start: number;
  readonly end: number;
}

interface PngPixelProfile {
  readonly colorType: 2 | 6;
  readonly channels: 3 | 4;
  readonly label: "opaque RGB8" | "RGBA8";
}

const PNG_OPAQUE_RGB8_PROFILE: PngPixelProfile = {
  colorType: 2,
  channels: 3,
  label: "opaque RGB8",
};
const PNG_RGBA8_PROFILE: PngPixelProfile = {
  colorType: 6,
  channels: 4,
  label: "RGBA8",
};

interface PsdLayerChannel {
  readonly id: number;
  readonly byteLength: number;
}

interface PsdLayerDescriptor {
  readonly width: number;
  readonly height: number;
  readonly channels: readonly PsdLayerChannel[];
}

export interface StudioBg3dFileIntegrityOptions {
  readonly expectedWidth: number;
  readonly expectedHeight: number;
  readonly maxBytes: number;
  readonly signal?: AbortSignal;
}

export interface StudioBg3dVerifiedFileIntegrity {
  readonly sha256: string;
  readonly byteSize: number;
}

function integrityError(message: string): Error {
  const error = new Error(message);
  error.name = "DataError";
  return error;
}

function abortError(): DOMException {
  return new DOMException("파일 무결성 검증이 취소되었습니다.", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (cause: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(cause);
      },
    );
  });
}

async function readBlobBytes(
  blob: Blob,
  signal: AbortSignal | undefined,
): Promise<Uint8Array<ArrayBuffer>> {
  throwIfAborted(signal);
  try {
    const bytes = new Uint8Array(await awaitWithAbort(blob.arrayBuffer(), signal));
    throwIfAborted(signal);
    if (bytes.byteLength !== blob.size) {
      throw integrityError("파일 Blob 크기가 읽은 바이트와 일치하지 않습니다.");
    }
    return bytes;
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "DataError")) {
      throw cause;
    }
    throw integrityError("파일 Blob 바이트를 읽지 못했습니다.");
  }
}

async function sha256Bytes(
  bytes: Uint8Array<ArrayBuffer>,
  signal: AbortSignal | undefined,
): Promise<string> {
  throwIfAborted(signal);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw integrityError("파일 SHA-256을 계산할 수 없습니다.");
  }
  let digest: ArrayBuffer;
  try {
    digest = await awaitWithAbort(subtle.digest("SHA-256", bytes), signal);
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    throw integrityError("파일 SHA-256 계산에 실패했습니다.");
  }
  throwIfAborted(signal);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function crc32(
  bytes: Uint8Array,
  start: number,
  end: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  let crc = 0xffff_ffff;
  for (let index = start; index < end; index += 1) {
    if ((index - start & 0xfffff) === 0) {
      throwIfAborted(signal);
      if (index > start) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        throwIfAborted(signal);
      }
    }
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
  }
  throwIfAborted(signal);
  return (crc ^ 0xffff_ffff) >>> 0;
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

async function verifyPngInflate(
  bytes: Uint8Array<ArrayBuffer>,
  idatRanges: readonly PngIdatRange[],
  width: number,
  height: number,
  channels: 3 | 4,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (typeof DecompressionStream !== "function" || typeof ReadableStream !== "function") {
    throw integrityError("이 브라우저에서는 PNG 압축 스트림 무결성을 검증할 수 없습니다.");
  }
  let decompressor: DecompressionStream;
  try {
    decompressor = new DecompressionStream("deflate");
  } catch {
    throw integrityError("이 브라우저에서는 PNG deflate 무결성을 검증할 수 없습니다.");
  }
  const rowBytes = width * channels + 1;
  const expectedBytes = rowBytes * height;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) {
    throw integrityError("PNG scanline 크기가 안전 범위를 벗어났습니다.");
  }
  const compressed = new ReadableStream<BufferSource>({
    start(controller) {
      for (const range of idatRanges) controller.enqueue(bytes.subarray(range.start, range.end));
      controller.close();
    },
  });
  let reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>> | null = null;
  let decodedBytes = 0;
  try {
    reader = compressed.pipeThrough(decompressor).getReader();
    while (true) {
      throwIfAborted(signal);
      const result = await awaitWithAbort(reader.read(), signal);
      if (result.done) break;
      const chunk = result.value;
      if (!(chunk instanceof Uint8Array) || decodedBytes + chunk.byteLength > expectedBytes) {
        throw integrityError("PNG 압축 해제 크기가 고정 해상도와 일치하지 않습니다.");
      }
      const remainder = decodedBytes % rowBytes;
      const firstFilterOffset = remainder === 0 ? 0 : rowBytes - remainder;
      for (let offset = firstFilterOffset; offset < chunk.byteLength; offset += rowBytes) {
        throwIfAborted(signal);
        const filter = chunk[offset];
        if (filter === undefined || filter > 4) {
          throw integrityError("PNG scanline filter가 올바르지 않습니다.");
        }
      }
      decodedBytes += chunk.byteLength;
    }
  } catch (cause) {
    try {
      await reader?.cancel(cause);
    } catch {
      // The primary validation error owns the result.
    }
    if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "DataError")) {
      throw cause;
    }
    throw integrityError("PNG IDAT deflate 스트림이 올바르지 않습니다.");
  } finally {
    try {
      reader?.releaseLock();
    } catch {
      // A failed stream may already have released its reader.
    }
  }
  throwIfAborted(signal);
  if (decodedBytes !== expectedBytes) {
    throw integrityError("PNG scanline 바이트 수가 고정 해상도와 일치하지 않습니다.");
  }
}

async function verifyPngStructure(
  bytes: Uint8Array<ArrayBuffer>,
  expectedWidth: number,
  expectedHeight: number,
  profile: PngPixelProfile,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (
    bytes.byteLength < PNG_SIGNATURE.byteLength + 12 + PNG_IHDR_BYTES + 12 + 1 + 12 ||
    PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)
  ) {
    throw integrityError("PNG signature 또는 전체 구조가 올바르지 않습니다.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idatRanges: PngIdatRange[] = [];
  let offset = PNG_SIGNATURE.byteLength;
  let chunkCount = 0;
  let sawIhdr = false;
  let sawPlte = false;
  let sawIdat = false;
  let endedIdat = false;
  let sawIend = false;
  let totalIdatBytes = 0;
  while (offset < bytes.byteLength) {
    throwIfAborted(signal);
    chunkCount += 1;
    if (chunkCount > PNG_MAX_CHUNKS || offset + 12 > bytes.byteLength) {
      throw integrityError("PNG chunk 수 또는 경계가 안전 범위를 벗어났습니다.");
    }
    const length = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const dataEnd = dataOffset + length;
    const crcOffset = dataEnd;
    const nextOffset = crcOffset + 4;
    if (!Number.isSafeInteger(dataEnd) || nextOffset > bytes.byteLength) {
      throw integrityError("PNG chunk 길이가 파일 경계를 벗어났습니다.");
    }
    const type = chunkType(bytes, typeOffset);
    if (!PNG_CHUNK_TYPE_PATTERN.test(type) || type.charCodeAt(2) < 0x41 || type.charCodeAt(2) > 0x5a) {
      throw integrityError("PNG chunk type이 올바르지 않습니다.");
    }
    if (type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a &&
      !PNG_KNOWN_CRITICAL_CHUNKS.has(type)) {
      throw integrityError("PNG에 지원하지 않는 critical chunk가 있습니다.");
    }
    if (await crc32(bytes, typeOffset, dataEnd, signal) !== view.getUint32(crcOffset, false)) {
      throw integrityError("PNG chunk CRC가 올바르지 않습니다.");
    }
    if (!sawIhdr) {
      if (type !== "IHDR" || length !== PNG_IHDR_BYTES) {
        throw integrityError("PNG의 첫 chunk가 단일 IHDR 13바이트가 아닙니다.");
      }
      if (
        view.getUint32(dataOffset, false) !== expectedWidth ||
        view.getUint32(dataOffset + 4, false) !== expectedHeight ||
        bytes[dataOffset + 8] !== 8 || bytes[dataOffset + 9] !== profile.colorType ||
        bytes[dataOffset + 10] !== 0 || bytes[dataOffset + 11] !== 0 || bytes[dataOffset + 12] !== 0
      ) {
        throw integrityError(`PNG IHDR 해상도가 고정 ${profile.label} non-interlaced profile과 일치하지 않습니다.`);
      }
      sawIhdr = true;
    } else if (type === "IHDR") {
      throw integrityError("PNG에 IHDR chunk가 중복되었습니다.");
    } else if (type === "PLTE") {
      if (sawPlte || sawIdat || length < 3 || length > 768 || length % 3 !== 0) {
        throw integrityError("PNG PLTE chunk의 순서 또는 길이가 올바르지 않습니다.");
      }
      sawPlte = true;
    } else if (type === "tRNS") {
      throw integrityError(`${profile.label} PNG에는 tRNS chunk를 포함할 수 없습니다.`);
    } else if (type === "IDAT") {
      if (endedIdat || length === 0) {
        throw integrityError("PNG IDAT chunk가 비었거나 연속 순서를 벗어났습니다.");
      }
      sawIdat = true;
      totalIdatBytes += length;
      if (!Number.isSafeInteger(totalIdatBytes) || totalIdatBytes > bytes.byteLength) {
        throw integrityError("PNG IDAT 합계가 안전 범위를 벗어났습니다.");
      }
      idatRanges.push({ start: dataOffset, end: dataEnd });
    } else if (type === "IEND") {
      if (!sawIdat || length !== 0 || sawIend || nextOffset !== bytes.byteLength) {
        throw integrityError("PNG IEND 또는 trailing bytes가 올바르지 않습니다.");
      }
      sawIend = true;
    } else if (sawIdat) {
      endedIdat = true;
    }
    offset = nextOffset;
  }
  if (!sawIhdr || !sawIdat || !sawIend || totalIdatBytes < 1 || offset !== bytes.byteLength) {
    throw integrityError("PNG에 완전한 IHDR/IDAT/IEND 구조가 없습니다.");
  }
  await verifyPngInflate(
    bytes,
    idatRanges,
    expectedWidth,
    expectedHeight,
    profile.channels,
    signal,
  );
}

function readPsdSectionEnd(view: DataView, offset: number, totalBytes: number): number {
  if (offset + 4 > totalBytes) throw integrityError("PSD section 길이 필드가 잘렸습니다.");
  const length = view.getUint32(offset, false);
  const end = offset + 4 + length;
  if (!Number.isSafeInteger(end) || end > totalBytes) {
    throw integrityError("PSD section 길이가 파일 경계를 벗어났습니다.");
  }
  return end;
}

function verifyPsdRleRow(
  bytes: Uint8Array,
  start: number,
  end: number,
  width: number,
  signal: AbortSignal | undefined,
): void {
  let sourceOffset = start;
  let decoded = 0;
  while (sourceOffset < end) {
    throwIfAborted(signal);
    const header = bytes[sourceOffset];
    if (header === undefined) throw integrityError("PSD RLE row가 잘렸습니다.");
    sourceOffset += 1;
    if (header <= 127) {
      const literalBytes = header + 1;
      if (sourceOffset + literalBytes > end) {
        throw integrityError("PSD RLE literal이 row 경계를 벗어났습니다.");
      }
      sourceOffset += literalBytes;
      decoded += literalBytes;
    } else if (header >= 129) {
      if (sourceOffset >= end) throw integrityError("PSD RLE repeat 값이 없습니다.");
      sourceOffset += 1;
      decoded += 257 - header;
    }
    if (decoded > width) throw integrityError("PSD RLE row가 canvas 폭을 넘습니다.");
  }
  if (sourceOffset !== end || decoded !== width) {
    throw integrityError("PSD RLE row의 decoded 폭이 canvas와 일치하지 않습니다.");
  }
}

function verifyPsdRleChannel(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  width: number,
  height: number,
  signal: AbortSignal | undefined,
): void {
  const tableBytes = height * 2;
  if (!Number.isSafeInteger(tableBytes) || start + tableBytes > end) {
    throw integrityError("PSD RLE row-length table이 잘렸습니다.");
  }
  let dataOffset = start + tableBytes;
  for (let row = 0; row < height; row += 1) {
    throwIfAborted(signal);
    const length = view.getUint16(start + row * 2, false);
    if (length < 1 || dataOffset + length > end) {
      throw integrityError("PSD RLE row 길이가 channel 경계를 벗어났습니다.");
    }
    verifyPsdRleRow(bytes, dataOffset, dataOffset + length, width, signal);
    dataOffset += length;
  }
  if (dataOffset !== end) throw integrityError("PSD RLE channel에 trailing bytes가 있습니다.");
}

function verifyPsdImageResources(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  signal: AbortSignal | undefined,
): void {
  let offset = start;
  let blocks = 0;
  while (offset < end) {
    throwIfAborted(signal);
    blocks += 1;
    if (blocks > PSD_MAX_RESOURCE_BLOCKS || offset + 11 > end || chunkType(bytes, offset) !== "8BIM") {
      throw integrityError("PSD image resource block이 손상되었습니다.");
    }
    offset += 6;
    const nameLength = bytes[offset] ?? 0;
    const nameFieldBytes = 1 + nameLength;
    offset += nameFieldBytes + (nameFieldBytes % 2);
    if (offset + 4 > end) throw integrityError("PSD image resource 이름이 잘렸습니다.");
    const dataLength = view.getUint32(offset, false);
    offset += 4;
    const paddedLength = dataLength + (dataLength % 2);
    if (!Number.isSafeInteger(offset + paddedLength) || offset + paddedLength > end) {
      throw integrityError("PSD image resource data가 잘렸습니다.");
    }
    offset += paddedLength;
  }
  if (offset !== end) throw integrityError("PSD image resource 경계가 손상되었습니다.");
}

function readUnicodeLayerName(bytes: Uint8Array, view: DataView, start: number, length: number): string {
  if (length < 4) throw integrityError("PSD Unicode layer 이름이 잘렸습니다.");
  const characters = view.getUint32(start, false);
  const byteLength = characters * 2;
  const contentLength = 4 + byteLength;
  if (!Number.isSafeInteger(byteLength) || contentLength > length || length - contentLength > 3) {
    throw integrityError("PSD Unicode layer 이름 길이가 올바르지 않습니다.");
  }
  for (let offset = start + contentLength; offset < start + length; offset += 1) {
    if (bytes[offset] !== 0) throw integrityError("PSD Unicode layer 이름 padding이 올바르지 않습니다.");
  }
  let name = "";
  for (let offset = start + 4; offset < start + 4 + byteLength; offset += 2) {
    name += String.fromCharCode(view.getUint16(offset, false));
  }
  return name;
}

function verifyPsdLayerMaskSection(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
  expectedWidth: number,
  expectedHeight: number,
  signal: AbortSignal | undefined,
): void {
  if (start + 6 > end) throw integrityError("PSD layer/mask section이 비었습니다.");
  const layerInfoEnd = readPsdSectionEnd(view, start, end);
  const layerInfoStart = start + 4;
  if (layerInfoStart + 2 > layerInfoEnd) throw integrityError("PSD layer info가 비었습니다.");
  const signedLayerCount = view.getInt16(layerInfoStart, false);
  const layerCount = Math.abs(signedLayerCount);
  if (layerCount < 1 || layerCount > PSD_MAX_LAYERS) {
    throw integrityError("PSD layer 수가 1~4 범위와 일치하지 않습니다.");
  }
  let offset = layerInfoStart + 2;
  const descriptors: PsdLayerDescriptor[] = [];
  const layerNames = new Set<string>();
  for (let layer = 0; layer < layerCount; layer += 1) {
    throwIfAborted(signal);
    if (offset + 18 > layerInfoEnd) throw integrityError("PSD layer record가 잘렸습니다.");
    const top = view.getInt32(offset, false);
    const left = view.getInt32(offset + 4, false);
    const bottom = view.getInt32(offset + 8, false);
    const right = view.getInt32(offset + 12, false);
    const channelCount = view.getUint16(offset + 16, false);
    if (top !== 0 || left !== 0 || bottom !== expectedHeight || right !== expectedWidth ||
      channelCount !== PSD_MAX_CHANNELS) {
      throw integrityError("PSD layer rectangle 또는 RGBA channel 수가 고정 profile과 다릅니다.");
    }
    offset += 18;
    const channels: PsdLayerChannel[] = [];
    const channelIds = new Set<number>();
    for (let channel = 0; channel < channelCount; channel += 1) {
      if (offset + 6 > layerInfoEnd) throw integrityError("PSD layer channel descriptor가 잘렸습니다.");
      const id = view.getInt16(offset, false);
      const byteLength = view.getUint32(offset + 2, false);
      if (!PSD_RGBA_CHANNEL_IDS.has(id) || channelIds.has(id) || byteLength < 3) {
        throw integrityError("PSD layer channel ID 또는 길이가 RGBA profile과 다릅니다.");
      }
      channelIds.add(id);
      channels.push({ id, byteLength });
      offset += 6;
    }
    if (offset + 16 > layerInfoEnd || chunkType(bytes, offset) !== "8BIM" ||
      chunkType(bytes, offset + 4) !== "norm") {
      throw integrityError("PSD layer blend record가 고정 normal profile과 다릅니다.");
    }
    if (bytes[offset + 8] !== 255 || bytes[offset + 9] !== 0 || bytes[offset + 11] !== 0) {
      throw integrityError("PSD layer opacity/clipping/filler가 고정 profile과 다릅니다.");
    }
    offset += 12;
    const extraEnd = readPsdSectionEnd(view, offset, layerInfoEnd);
    offset += 4;
    const maskEnd = readPsdSectionEnd(view, offset, extraEnd);
    if (maskEnd !== offset + 4) throw integrityError("PSD layer mask가 예상치 않게 포함되었습니다.");
    offset = maskEnd;
    const blendingEnd = readPsdSectionEnd(view, offset, extraEnd);
    if (blendingEnd !== offset + 4) throw integrityError("PSD blending ranges가 예상치 않게 포함되었습니다.");
    offset = blendingEnd;
    if (offset >= extraEnd) throw integrityError("PSD Pascal layer 이름이 없습니다.");
    const pascalStart = offset;
    const pascalLength = bytes[offset] ?? 0;
    offset += 1 + pascalLength;
    while ((offset - pascalStart) % 4 !== 0) offset += 1;
    if (offset > extraEnd) throw integrityError("PSD Pascal layer 이름이 잘렸습니다.");
    let unicodeName: string | null = null;
    while (offset < extraEnd) {
      throwIfAborted(signal);
      if (offset + 12 > extraEnd || chunkType(bytes, offset) !== "8BIM") {
        throw integrityError("PSD additional layer info가 잘렸습니다.");
      }
      const key = chunkType(bytes, offset + 4);
      const dataLength = view.getUint32(offset + 8, false);
      const dataStart = offset + 12;
      const dataEnd = dataStart + dataLength;
      const paddedEnd = dataEnd + (dataLength % 2);
      if (!Number.isSafeInteger(paddedEnd) || paddedEnd > extraEnd) {
        throw integrityError("PSD additional layer data가 잘렸습니다.");
      }
      if (key === "luni") {
        if (unicodeName !== null) throw integrityError("PSD Unicode layer 이름이 중복되었습니다.");
        unicodeName = readUnicodeLayerName(bytes, view, dataStart, dataLength);
      }
      offset = paddedEnd;
    }
    if (offset !== extraEnd || unicodeName === null || !PSD_LAYER_NAMES.has(unicodeName) ||
      layerNames.has(unicodeName)) {
      throw integrityError("PSD layer 이름이 고정 LT profile과 다르거나 중복되었습니다.");
    }
    layerNames.add(unicodeName);
    descriptors.push({ width: expectedWidth, height: expectedHeight, channels });
  }
  for (const descriptor of descriptors) {
    for (const channel of descriptor.channels) {
      throwIfAborted(signal);
      const channelEnd = offset + channel.byteLength;
      if (!Number.isSafeInteger(channelEnd) || channelEnd > layerInfoEnd) {
        throw integrityError("PSD layer channel data가 layer info 경계를 벗어났습니다.");
      }
      const compression = view.getUint16(offset, false);
      const dataStart = offset + 2;
      if (compression === 0) {
        if (channelEnd - dataStart !== descriptor.width * descriptor.height) {
          throw integrityError("PSD raw layer channel 크기가 rectangle과 다릅니다.");
        }
      } else if (compression === 1) {
        verifyPsdRleChannel(
          bytes,
          view,
          dataStart,
          channelEnd,
          descriptor.width,
          descriptor.height,
          signal,
        );
      } else {
        throw integrityError("PSD layer channel 압축은 raw 또는 RLE만 지원합니다.");
      }
      offset = channelEnd;
    }
  }
  while (offset < layerInfoEnd && bytes[offset] === 0 && layerInfoEnd - offset <= 3) offset += 1;
  if (offset !== layerInfoEnd) throw integrityError("PSD layer info에 trailing bytes가 있습니다.");
  offset = layerInfoEnd;
  const globalMaskEnd = readPsdSectionEnd(view, offset, end);
  if (globalMaskEnd !== offset + 4 || globalMaskEnd !== end) {
    throw integrityError("PSD global layer mask 또는 trailing layer data가 고정 profile과 다릅니다.");
  }
}

function verifyPsdComposite(
  bytes: Uint8Array,
  view: DataView,
  offset: number,
  width: number,
  height: number,
  channels: number,
  signal: AbortSignal | undefined,
): void {
  if (offset + 2 > bytes.byteLength) throw integrityError("PSD composite image data가 없습니다.");
  const compression = view.getUint16(offset, false);
  offset += 2;
  const rawBytes = width * height * channels;
  if (!Number.isSafeInteger(rawBytes)) throw integrityError("PSD composite 바이트 수가 안전 범위를 벗어났습니다.");
  if (compression === 0) {
    if (bytes.byteLength - offset !== rawBytes) {
      throw integrityError("PSD raw composite 크기가 canvas와 일치하지 않습니다.");
    }
    return;
  }
  if (compression !== 1) throw integrityError("PSD composite 압축은 raw 또는 RLE만 지원합니다.");
  const rowCount = height * channels;
  const tableBytes = rowCount * 2;
  if (!Number.isSafeInteger(tableBytes) || offset + tableBytes > bytes.byteLength) {
    throw integrityError("PSD composite RLE row-length table이 잘렸습니다.");
  }
  let dataOffset = offset + tableBytes;
  for (let row = 0; row < rowCount; row += 1) {
    throwIfAborted(signal);
    const length = view.getUint16(offset + row * 2, false);
    if (length < 1 || dataOffset + length > bytes.byteLength) {
      throw integrityError("PSD composite RLE row 길이가 파일 경계를 벗어났습니다.");
    }
    verifyPsdRleRow(bytes, dataOffset, dataOffset + length, width, signal);
    dataOffset += length;
  }
  if (dataOffset !== bytes.byteLength) throw integrityError("PSD composite에 trailing bytes가 있습니다.");
}

function verifyPsdStructure(
  bytes: Uint8Array<ArrayBuffer>,
  expectedWidth: number,
  expectedHeight: number,
  signal: AbortSignal | undefined,
): void {
  throwIfAborted(signal);
  if (bytes.byteLength < 40) throw integrityError("PSD signature 또는 전체 구조가 잘렸습니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(12, false);
  if (
    bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53 ||
    bytes[4] !== 0 || bytes[5] !== 1 || bytes.slice(6, 12).some((byte) => byte !== 0) ||
    (channels !== 3 && channels !== 4) ||
    view.getUint32(14, false) !== expectedHeight || view.getUint32(18, false) !== expectedWidth ||
    view.getUint16(22, false) !== 8 || view.getUint16(24, false) !== 3
  ) {
    throw integrityError("PSD header가 layered RGBA8 RGB profile 또는 canvas와 일치하지 않습니다.");
  }
  let offset = 26;
  const colorModeEnd = readPsdSectionEnd(view, offset, bytes.byteLength);
  if (colorModeEnd !== offset + 4) throw integrityError("RGB PSD color-mode data는 비어 있어야 합니다.");
  offset = colorModeEnd;
  const resourcesEnd = readPsdSectionEnd(view, offset, bytes.byteLength);
  verifyPsdImageResources(bytes, view, offset + 4, resourcesEnd, signal);
  offset = resourcesEnd;
  const layerMaskEnd = readPsdSectionEnd(view, offset, bytes.byteLength);
  verifyPsdLayerMaskSection(
    bytes,
    view,
    offset + 4,
    layerMaskEnd,
    expectedWidth,
    expectedHeight,
    signal,
  );
  offset = layerMaskEnd;
  verifyPsdComposite(bytes, view, offset, expectedWidth, expectedHeight, channels, signal);
  throwIfAborted(signal);
}

function assertInput(
  blob: Blob,
  expectedMime: string,
  options: StudioBg3dFileIntegrityOptions,
): void {
  if (!(blob instanceof Blob) || blob.type !== expectedMime || blob.size < 24 ||
    !Number.isSafeInteger(options.expectedWidth) || options.expectedWidth < 1 ||
    !Number.isSafeInteger(options.expectedHeight) || options.expectedHeight < 1 ||
    !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 24 || blob.size > options.maxBytes) {
    throw integrityError("파일 artifact가 MIME, 해상도 또는 안전 예산과 일치하지 않습니다.");
  }
  throwIfAborted(options.signal);
}

async function verifyPngFile(
  blob: Blob,
  options: StudioBg3dFileIntegrityOptions,
  profile: PngPixelProfile,
): Promise<StudioBg3dVerifiedFileIntegrity> {
  assertInput(blob, "image/png", options);
  const bytes = await readBlobBytes(blob, options.signal);
  await verifyPngStructure(
    bytes,
    options.expectedWidth,
    options.expectedHeight,
    profile,
    options.signal,
  );
  throwIfAborted(options.signal);
  return Object.freeze({
    sha256: await sha256Bytes(bytes, options.signal),
    byteSize: bytes.byteLength,
  });
}

export function verifyStudioBg3dRgba8PngFile(
  blob: Blob,
  options: StudioBg3dFileIntegrityOptions,
): Promise<StudioBg3dVerifiedFileIntegrity> {
  return verifyPngFile(blob, options, PNG_RGBA8_PROFILE);
}

/** Contact sheets use an opaque Canvas and Chromium truthfully encodes them as PNG color type 2. */
export function verifyStudioBg3dOpaqueRgb8PngFile(
  blob: Blob,
  options: StudioBg3dFileIntegrityOptions,
): Promise<StudioBg3dVerifiedFileIntegrity> {
  return verifyPngFile(blob, options, PNG_OPAQUE_RGB8_PROFILE);
}

export async function verifyStudioBg3dLayeredPsdFile(
  blob: Blob,
  options: StudioBg3dFileIntegrityOptions,
): Promise<StudioBg3dVerifiedFileIntegrity> {
  assertInput(blob, "image/vnd.adobe.photoshop", options);
  const bytes = await readBlobBytes(blob, options.signal);
  verifyPsdStructure(bytes, options.expectedWidth, options.expectedHeight, options.signal);
  throwIfAborted(options.signal);
  return Object.freeze({
    sha256: await sha256Bytes(bytes, options.signal),
    byteSize: bytes.byteLength,
  });
}
