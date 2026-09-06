/**
 * Dependency-free baseline TIFF codec.
 *
 * Import intentionally accepts only uncompressed, chunky 8-bit RGB/RGBA TIFF. The narrow surface
 * keeps arbitrary IFD offsets and strip tables fail-closed until compressed/planar variants have a
 * dedicated decoder. Export writes a single-strip, little-endian TIFF with straight alpha.
 */

export interface StudioTiffRgbaBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

export type StudioTiffWarningCode =
  | "alpha-synthesized"
  | "associated-alpha-converted"
  | "opaque-alpha-omitted";

export interface StudioTiffWarning {
  readonly code: StudioTiffWarningCode;
  readonly message: string;
}

export interface StudioTiffDecoded {
  readonly bitmap: StudioTiffRgbaBitmap;
  readonly byteOrder: "little-endian" | "big-endian";
  readonly warnings: readonly StudioTiffWarning[];
  readonly lossy: boolean;
}

export interface StudioTiffDecodeOptions {
  /** Optional caller-specific ceiling applied before allocating the decoded RGBA buffer. */
  readonly maximumPixels?: number;
}

export interface StudioTiffEncoded {
  readonly bytes: Uint8Array;
  readonly extension: ".tiff";
  readonly mimeType: "image/tiff";
  readonly warnings: readonly StudioTiffWarning[];
  readonly lossy: boolean;
}

export const STUDIO_TIFF_INTERCHANGE_LIMITS = Object.freeze({
  maxWidth: 32_768,
  maxHeight: 32_768,
  maxPixels: 32_000_000,
  maxInputBytes: 192 * 1024 * 1024,
  maxOutputBytes: 256 * 1024 * 1024,
  maxIfdEntries: 256,
  maxStrips: 32_768,
});

export class StudioTiffInterchangeError extends Error {
  constructor(
    readonly code:
      | "INPUT_TOO_LARGE"
      | "INVALID_HEADER"
      | "INVALID_IFD"
      | "INVALID_DIMENSIONS"
      | "INVALID_PIXELS"
      | "INVALID_STRIPS"
      | "UNSUPPORTED_VARIANT"
      | "OUTPUT_TOO_LARGE",
    message: string
  ) {
    super(message);
    this.name = "StudioTiffInterchangeError";
  }
}

const TIFF_MAGIC = 42;
const TIFF_TYPE_SHORT = 3;
const TIFF_TYPE_LONG = 4;

const TAG_IMAGE_WIDTH = 256;
const TAG_IMAGE_LENGTH = 257;
const TAG_BITS_PER_SAMPLE = 258;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC_INTERPRETATION = 262;
const TAG_FILL_ORDER = 266;
const TAG_STRIP_OFFSETS = 273;
const TAG_ORIENTATION = 274;
const TAG_SAMPLES_PER_PIXEL = 277;
const TAG_ROWS_PER_STRIP = 278;
const TAG_STRIP_BYTE_COUNTS = 279;
const TAG_PLANAR_CONFIGURATION = 284;
const TAG_PREDICTOR = 317;
const TAG_EXTRA_SAMPLES = 338;
const TAG_SAMPLE_FORMAT = 339;

const KNOWN_TAGS = new Set([
  TAG_IMAGE_WIDTH,
  TAG_IMAGE_LENGTH,
  TAG_BITS_PER_SAMPLE,
  TAG_COMPRESSION,
  TAG_PHOTOMETRIC_INTERPRETATION,
  TAG_FILL_ORDER,
  TAG_STRIP_OFFSETS,
  TAG_ORIENTATION,
  TAG_SAMPLES_PER_PIXEL,
  TAG_ROWS_PER_STRIP,
  TAG_STRIP_BYTE_COUNTS,
  TAG_PLANAR_CONFIGURATION,
  TAG_PREDICTOR,
  TAG_EXTRA_SAMPLES,
  TAG_SAMPLE_FORMAT,
]);

interface TiffIfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  readonly valueFieldOffset: number;
}

interface ByteRange {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

function fail(code: StudioTiffInterchangeError["code"], message: string): never {
  throw new StudioTiffInterchangeError(code, message);
}

function checkedAdd(
  left: number,
  right: number,
  code: StudioTiffInterchangeError["code"],
  message: string
): number {
  const result = left + right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0 || !Number.isSafeInteger(result)) {
    return fail(code, message);
  }
  return result;
}

function checkedMultiply(
  left: number,
  right: number,
  code: StudioTiffInterchangeError["code"],
  message: string
): number {
  const result = left * right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0 || !Number.isSafeInteger(result)) {
    return fail(code, message);
  }
  return result;
}

function assertRange(
  totalBytes: number,
  offset: number,
  length: number,
  code: StudioTiffInterchangeError["code"],
  message: string
): void {
  const end = checkedAdd(offset, length, code, message);
  if (end > totalBytes) fail(code, message);
}

function rangesOverlap(left: ByteRange, right: ByteRange): boolean {
  return left.start < right.end && right.start < left.end;
}

function assertNoOverlap(
  range: ByteRange,
  protectedRanges: readonly ByteRange[],
  code: "INVALID_IFD" | "INVALID_STRIPS" = "INVALID_IFD"
): void {
  const overlapping = protectedRanges.find((candidate) => rangesOverlap(range, candidate));
  if (overlapping) {
    fail(code, `${range.label}이 ${overlapping.label} 영역과 겹칩니다.`);
  }
}

export function assertStudioTiffInputByteLength(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
    fail("INVALID_HEADER", "빈 파일 또는 유효하지 않은 TIFF 바이트 길이입니다.");
  }
  if (byteLength > STUDIO_TIFF_INTERCHANGE_LIMITS.maxInputBytes) {
    fail("INPUT_TOO_LARGE", "TIFF 입력은 192MB 이하여야 합니다.");
  }
}

function checkedPixelCount(
  width: number,
  height: number,
  maximumPixels: number = STUDIO_TIFF_INTERCHANGE_LIMITS.maxPixels
): number {
  const pixels = checkedMultiply(width, height, "INVALID_DIMENSIONS", "TIFF 픽셀 수가 안전한 정수 범위를 벗어났습니다.");
  if (
    width < 1 ||
    height < 1 ||
    width > STUDIO_TIFF_INTERCHANGE_LIMITS.maxWidth ||
    height > STUDIO_TIFF_INTERCHANGE_LIMITS.maxHeight ||
    pixels > STUDIO_TIFF_INTERCHANGE_LIMITS.maxPixels
  ) {
    fail("INVALID_DIMENSIONS", "TIFF 크기 또는 총 픽셀 수가 안전 한도를 벗어났습니다.");
  }
  if (!Number.isSafeInteger(maximumPixels) || maximumPixels < 1) {
    fail("INVALID_DIMENSIONS", "TIFF 디코드 픽셀 예산이 올바르지 않습니다.");
  }
  if (pixels > maximumPixels) {
    fail("OUTPUT_TOO_LARGE", `TIFF 디코드 크기가 직접 처리 안전 상한(${maximumPixels.toLocaleString("en-US")}픽셀)을 초과합니다.`);
  }
  return pixels;
}

function readIfdEntries(
  bytes: Uint8Array,
  view: DataView,
  ifdOffset: number,
  littleEndian: boolean
): { readonly entries: ReadonlyMap<number, TiffIfdEntry>; readonly ifdRange: ByteRange } {
  if (ifdOffset < 8 || ifdOffset % 2 !== 0) {
    fail("INVALID_IFD", "첫 TIFF IFD 오프셋은 헤더 뒤의 word 경계여야 합니다.");
  }
  assertRange(bytes.byteLength, ifdOffset, 2, "INVALID_IFD", "TIFF IFD 항목 수가 잘렸습니다.");
  const entryCount = view.getUint16(ifdOffset, littleEndian);
  if (entryCount > STUDIO_TIFF_INTERCHANGE_LIMITS.maxIfdEntries) {
    fail("INVALID_IFD", `TIFF IFD는 ${STUDIO_TIFF_INTERCHANGE_LIMITS.maxIfdEntries}개 항목 이하여야 합니다.`);
  }
  const entriesBytes = checkedMultiply(entryCount, 12, "INVALID_IFD", "TIFF IFD 길이가 안전 범위를 벗어났습니다.");
  const tableLength = checkedAdd(checkedAdd(2, entriesBytes, "INVALID_IFD", "TIFF IFD 길이가 안전 범위를 벗어났습니다."), 4, "INVALID_IFD", "TIFF IFD 길이가 안전 범위를 벗어났습니다.");
  assertRange(bytes.byteLength, ifdOffset, tableLength, "INVALID_IFD", "TIFF IFD가 파일 끝에서 잘렸습니다.");

  const entries = new Map<number, TiffIfdEntry>();
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + index * 12;
    const tag = view.getUint16(entryOffset, littleEndian);
    if (!KNOWN_TAGS.has(tag)) continue;
    if (entries.has(tag)) fail("INVALID_IFD", `TIFF 태그 ${tag}가 중복되었습니다.`);
    entries.set(tag, {
      tag,
      type: view.getUint16(entryOffset + 2, littleEndian),
      count: view.getUint32(entryOffset + 4, littleEndian),
      valueFieldOffset: entryOffset + 8,
    });
  }

  const nextIfdOffset = view.getUint32(ifdOffset + 2 + entriesBytes, littleEndian);
  if (nextIfdOffset !== 0) {
    fail("UNSUPPORTED_VARIANT", "여러 페이지 또는 연결된 IFD를 가진 TIFF는 아직 지원하지 않습니다.");
  }
  return {
    entries,
    ifdRange: { start: ifdOffset, end: ifdOffset + tableLength, label: "IFD" },
  };
}

function requireEntry(entries: ReadonlyMap<number, TiffIfdEntry>, tag: number, label: string): TiffIfdEntry {
  const entry = entries.get(tag);
  if (!entry) fail("INVALID_IFD", `필수 TIFF 태그 ${label}(${tag})가 없습니다.`);
  return entry;
}

function readEntryValues(
  bytes: Uint8Array,
  view: DataView,
  littleEndian: boolean,
  entry: TiffIfdEntry,
  allowedTypes: readonly number[],
  maxCount: number,
  protectedRanges: ByteRange[]
): number[] {
  if (!allowedTypes.includes(entry.type)) {
    fail("INVALID_IFD", `TIFF 태그 ${entry.tag}의 값 형식이 지원 범위가 아닙니다.`);
  }
  if (entry.count < 1 || entry.count > maxCount) {
    fail("INVALID_IFD", `TIFF 태그 ${entry.tag}의 값 개수가 안전 한도를 벗어났습니다.`);
  }
  const typeBytes = entry.type === TIFF_TYPE_SHORT ? 2 : 4;
  const valueBytes = checkedMultiply(entry.count, typeBytes, "INVALID_IFD", `TIFF 태그 ${entry.tag} 길이가 잘못되었습니다.`);
  let valueOffset = entry.valueFieldOffset;
  if (valueBytes > 4) {
    valueOffset = view.getUint32(entry.valueFieldOffset, littleEndian);
    if (valueOffset < 8 || valueOffset % 2 !== 0) {
      fail("INVALID_IFD", `TIFF 태그 ${entry.tag}의 외부 값 오프셋이 올바르지 않습니다.`);
    }
    assertRange(bytes.byteLength, valueOffset, valueBytes, "INVALID_IFD", `TIFF 태그 ${entry.tag}의 외부 값이 잘렸습니다.`);
    const range = { start: valueOffset, end: valueOffset + valueBytes, label: `태그 ${entry.tag} 값` };
    assertNoOverlap(range, protectedRanges);
    protectedRanges.push(range);
  }

  const values = new Array<number>(entry.count);
  for (let index = 0; index < entry.count; index += 1) {
    const offset = valueOffset + index * typeBytes;
    values[index] = entry.type === TIFF_TYPE_SHORT
      ? view.getUint16(offset, littleEndian)
      : view.getUint32(offset, littleEndian);
  }
  return values;
}

function readScalar(
  bytes: Uint8Array,
  view: DataView,
  littleEndian: boolean,
  entry: TiffIfdEntry,
  allowedTypes: readonly number[],
  protectedRanges: ByteRange[]
): number {
  if (entry.count !== 1) fail("INVALID_IFD", `TIFF 태그 ${entry.tag}는 단일 값이어야 합니다.`);
  return readEntryValues(bytes, view, littleEndian, entry, allowedTypes, 1, protectedRanges)[0]!;
}

function readOptionalScalar(
  bytes: Uint8Array,
  view: DataView,
  littleEndian: boolean,
  entries: ReadonlyMap<number, TiffIfdEntry>,
  tag: number,
  fallback: number,
  protectedRanges: ByteRange[]
): number {
  const entry = entries.get(tag);
  return entry
    ? readScalar(bytes, view, littleEndian, entry, [TIFF_TYPE_SHORT], protectedRanges)
    : fallback;
}

function warning(code: StudioTiffWarningCode, message: string): StudioTiffWarning {
  return Object.freeze({ code, message });
}

export function sniffStudioTiffInterchange(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return false;
  const little = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && bytes[3] === 0x2a;
  return little || big;
}

export function decodeStudioTiffInterchange(
  bytes: Uint8Array,
  options: StudioTiffDecodeOptions = {}
): StudioTiffDecoded {
  if (!(bytes instanceof Uint8Array)) fail("INVALID_HEADER", "TIFF 입력은 Uint8Array여야 합니다.");
  assertStudioTiffInputByteLength(bytes.byteLength);
  if (bytes.byteLength < 8) fail("INVALID_HEADER", "TIFF 헤더가 잘렸습니다.");

  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!littleEndian && !bigEndian) fail("INVALID_HEADER", "TIFF byte-order 표식은 II 또는 MM이어야 합니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(2, littleEndian) !== TIFF_MAGIC) fail("INVALID_HEADER", "TIFF magic 42가 올바르지 않습니다.");

  const ifdOffset = view.getUint32(4, littleEndian);
  const parsedIfd = readIfdEntries(bytes, view, ifdOffset, littleEndian);
  const protectedRanges: ByteRange[] = [
    { start: 0, end: 8, label: "TIFF 헤더" },
    parsedIfd.ifdRange,
  ];
  const { entries } = parsedIfd;

  const width = readScalar(bytes, view, littleEndian, requireEntry(entries, TAG_IMAGE_WIDTH, "ImageWidth"), [TIFF_TYPE_SHORT, TIFF_TYPE_LONG], protectedRanges);
  const height = readScalar(bytes, view, littleEndian, requireEntry(entries, TAG_IMAGE_LENGTH, "ImageLength"), [TIFF_TYPE_SHORT, TIFF_TYPE_LONG], protectedRanges);
  const pixelCount = checkedPixelCount(width, height, options.maximumPixels);
  const samplesPerPixel = readScalar(bytes, view, littleEndian, requireEntry(entries, TAG_SAMPLES_PER_PIXEL, "SamplesPerPixel"), [TIFF_TYPE_SHORT], protectedRanges);
  if (samplesPerPixel !== 3 && samplesPerPixel !== 4) {
    fail("UNSUPPORTED_VARIANT", "8-bit RGB 또는 RGBA TIFF만 지원합니다.");
  }

  const bitsPerSample = readEntryValues(
    bytes,
    view,
    littleEndian,
    requireEntry(entries, TAG_BITS_PER_SAMPLE, "BitsPerSample"),
    [TIFF_TYPE_SHORT],
    4,
    protectedRanges
  );
  if (bitsPerSample.length !== samplesPerPixel || bitsPerSample.some((bits) => bits !== 8)) {
    fail("UNSUPPORTED_VARIANT", "모든 RGB/RGBA 채널이 8-bit인 TIFF만 지원합니다.");
  }

  const compression = readScalar(bytes, view, littleEndian, requireEntry(entries, TAG_COMPRESSION, "Compression"), [TIFF_TYPE_SHORT], protectedRanges);
  if (compression !== 1) fail("UNSUPPORTED_VARIANT", "압축되지 않은 baseline TIFF만 지원합니다.");
  const photometric = readScalar(bytes, view, littleEndian, requireEntry(entries, TAG_PHOTOMETRIC_INTERPRETATION, "PhotometricInterpretation"), [TIFF_TYPE_SHORT], protectedRanges);
  if (photometric !== 2) fail("UNSUPPORTED_VARIANT", "RGB PhotometricInterpretation TIFF만 지원합니다.");
  if (readOptionalScalar(bytes, view, littleEndian, entries, TAG_FILL_ORDER, 1, protectedRanges) !== 1) {
    fail("UNSUPPORTED_VARIANT", "기본 FillOrder를 사용하는 TIFF만 지원합니다.");
  }
  if (readOptionalScalar(bytes, view, littleEndian, entries, TAG_ORIENTATION, 1, protectedRanges) !== 1) {
    fail("UNSUPPORTED_VARIANT", "top-left Orientation TIFF만 지원합니다.");
  }
  const planarConfiguration = readOptionalScalar(bytes, view, littleEndian, entries, TAG_PLANAR_CONFIGURATION, 1, protectedRanges);
  if (planarConfiguration !== 1 && planarConfiguration !== 2) {
    fail("UNSUPPORTED_VARIANT", "chunky 또는 separated PlanarConfiguration TIFF만 지원합니다.");
  }
  if (readOptionalScalar(bytes, view, littleEndian, entries, TAG_PREDICTOR, 1, protectedRanges) !== 1) {
    fail("UNSUPPORTED_VARIANT", "Predictor가 적용되지 않은 TIFF만 지원합니다.");
  }

  const sampleFormatEntry = entries.get(TAG_SAMPLE_FORMAT);
  if (sampleFormatEntry) {
    const sampleFormats = readEntryValues(bytes, view, littleEndian, sampleFormatEntry, [TIFF_TYPE_SHORT], 4, protectedRanges);
    if (
      (sampleFormats.length !== 1 && sampleFormats.length !== samplesPerPixel) ||
      sampleFormats.some((sampleFormat) => sampleFormat !== 1)
    ) {
      fail("UNSUPPORTED_VARIANT", "unsigned integer SampleFormat TIFF만 지원합니다.");
    }
  }

  let extraSample: 1 | 2 | undefined;
  const extraSamplesEntry = entries.get(TAG_EXTRA_SAMPLES);
  if (samplesPerPixel === 4) {
    if (!extraSamplesEntry) fail("INVALID_IFD", "RGBA TIFF에는 ExtraSamples 태그가 필요합니다.");
    const values = readEntryValues(bytes, view, littleEndian, extraSamplesEntry, [TIFF_TYPE_SHORT], 1, protectedRanges);
    if (values[0] !== 1 && values[0] !== 2) {
      fail("UNSUPPORTED_VARIANT", "associated 또는 unassociated alpha RGBA TIFF만 지원합니다.");
    }
    extraSample = values[0];
  } else if (extraSamplesEntry) {
    fail("INVALID_IFD", "RGB TIFF에 ExtraSamples 태그가 선언되었습니다.");
  }

  const rowsPerStrip = readScalar(bytes, view, littleEndian, requireEntry(entries, TAG_ROWS_PER_STRIP, "RowsPerStrip"), [TIFF_TYPE_SHORT, TIFF_TYPE_LONG], protectedRanges);
  if (rowsPerStrip < 1) fail("INVALID_STRIPS", "RowsPerStrip은 1 이상이어야 합니다.");
  const stripsPerPlane = Math.ceil(height / rowsPerStrip);
  const stripCount = planarConfiguration === 1
    ? stripsPerPlane
    : checkedMultiply(stripsPerPlane, samplesPerPixel, "INVALID_STRIPS", "TIFF separated strip 개수가 안전 범위를 벗어났습니다.");
  if (stripCount < 1 || stripCount > STUDIO_TIFF_INTERCHANGE_LIMITS.maxStrips) {
    fail("INVALID_STRIPS", "TIFF strip 개수가 안전 한도를 벗어났습니다.");
  }
  const stripOffsets = readEntryValues(
    bytes,
    view,
    littleEndian,
    requireEntry(entries, TAG_STRIP_OFFSETS, "StripOffsets"),
    [TIFF_TYPE_SHORT, TIFF_TYPE_LONG],
    STUDIO_TIFF_INTERCHANGE_LIMITS.maxStrips,
    protectedRanges
  );
  const stripByteCounts = readEntryValues(
    bytes,
    view,
    littleEndian,
    requireEntry(entries, TAG_STRIP_BYTE_COUNTS, "StripByteCounts"),
    [TIFF_TYPE_SHORT, TIFF_TYPE_LONG],
    STUDIO_TIFF_INTERCHANGE_LIMITS.maxStrips,
    protectedRanges
  );
  if (stripOffsets.length !== stripCount || stripByteCounts.length !== stripCount) {
    fail("INVALID_STRIPS", "strip offset/count 개수가 RowsPerStrip과 일치하지 않습니다.");
  }

  const sourcePixelBytes = checkedMultiply(pixelCount, samplesPerPixel, "INVALID_PIXELS", "TIFF 픽셀 바이트 수가 안전 범위를 벗어났습니다.");
  if (sourcePixelBytes > STUDIO_TIFF_INTERCHANGE_LIMITS.maxInputBytes) {
    fail("INVALID_PIXELS", "TIFF 픽셀 데이터가 디코드 안전 예산을 벗어났습니다.");
  }
  const stripRanges: ByteRange[] = [];
  let totalStripBytes = 0;
  for (let index = 0; index < stripCount; index += 1) {
    const stripInPlane = planarConfiguration === 1 ? index : index % stripsPerPlane;
    const rowStart = stripInPlane * rowsPerStrip;
    const rows = Math.min(rowsPerStrip, height - rowStart);
    const rowSampleBytes = planarConfiguration === 1 ? samplesPerPixel : 1;
    const expectedBytes = checkedMultiply(checkedMultiply(rows, width, "INVALID_STRIPS", "TIFF strip 크기가 안전 범위를 벗어났습니다."), rowSampleBytes, "INVALID_STRIPS", "TIFF strip 크기가 안전 범위를 벗어났습니다.");
    const byteCount = stripByteCounts[index]!;
    if (byteCount !== expectedBytes) fail("INVALID_STRIPS", `TIFF strip ${index + 1}의 바이트 수가 픽셀 크기와 일치하지 않습니다.`);
    const offset = stripOffsets[index]!;
    assertRange(bytes.byteLength, offset, byteCount, "INVALID_STRIPS", `TIFF strip ${index + 1}이 파일 끝에서 잘렸습니다.`);
    const range = { start: offset, end: offset + byteCount, label: `strip ${index + 1}` };
    assertNoOverlap(range, protectedRanges, "INVALID_STRIPS");
    assertNoOverlap(range, stripRanges, "INVALID_STRIPS");
    stripRanges.push(range);
    totalStripBytes = checkedAdd(totalStripBytes, byteCount, "INVALID_STRIPS", "TIFF strip 총 바이트 수가 안전 범위를 벗어났습니다.");
  }
  if (totalStripBytes !== sourcePixelBytes) fail("INVALID_STRIPS", "TIFF strip 총 바이트 수가 픽셀 크기와 일치하지 않습니다.");

  const outputBytes = checkedMultiply(pixelCount, 4, "INVALID_PIXELS", "TIFF RGBA 출력 크기가 안전 범위를 벗어났습니다.");
  const output = new Uint8ClampedArray(outputBytes);
  if (planarConfiguration === 1) {
    let targetOffset = 0;
    for (const strip of stripRanges) {
      for (let sourceOffset = strip.start; sourceOffset < strip.end; sourceOffset += samplesPerPixel) {
        output[targetOffset] = bytes[sourceOffset]!;
        output[targetOffset + 1] = bytes[sourceOffset + 1]!;
        output[targetOffset + 2] = bytes[sourceOffset + 2]!;
        if (samplesPerPixel === 4) output[targetOffset + 3] = bytes[sourceOffset + 3]!;
        targetOffset += 4;
      }
    }
  } else {
    for (let sample = 0; sample < samplesPerPixel; sample += 1) {
      for (let stripIndex = 0; stripIndex < stripsPerPlane; stripIndex += 1) {
        const strip = stripRanges[sample * stripsPerPlane + stripIndex]!;
        const firstPixel = stripIndex * rowsPerStrip * width;
        for (let sourceOffset = strip.start, pixelOffset = firstPixel; sourceOffset < strip.end; sourceOffset += 1, pixelOffset += 1) {
          output[pixelOffset * 4 + sample] = bytes[sourceOffset]!;
        }
      }
    }
  }

  if (samplesPerPixel === 3) {
    for (let offset = 3; offset < output.byteLength; offset += 4) output[offset] = 255;
  }
  let associatedAlphaWasConverted = false;
  if (extraSample === 1) {
    for (let offset = 0; offset < output.byteLength; offset += 4) {
      const alpha = output[offset + 3]!;
      if (alpha === 255) continue;
      associatedAlphaWasConverted = true;
      if (alpha === 0) {
        output[offset] = 0;
        output[offset + 1] = 0;
        output[offset + 2] = 0;
      } else {
        output[offset] = Math.min(255, Math.round((output[offset]! * 255) / alpha));
        output[offset + 1] = Math.min(255, Math.round((output[offset + 1]! * 255) / alpha));
        output[offset + 2] = Math.min(255, Math.round((output[offset + 2]! * 255) / alpha));
      }
    }
  }

  const warnings: StudioTiffWarning[] = [];
  if (samplesPerPixel === 3) {
    warnings.push(warning("alpha-synthesized", "RGB TIFF에는 알파 채널이 없어 모든 픽셀을 불투명으로 가져왔습니다."));
  }
  if (associatedAlphaWasConverted) {
    warnings.push(warning("associated-alpha-converted", "premultiplied alpha TIFF를 straight RGBA로 변환해 반투명 색에 반올림 손실이 있을 수 있습니다."));
  }
  return {
    bitmap: { width, height, data: output },
    byteOrder: littleEndian ? "little-endian" : "big-endian",
    warnings: Object.freeze(warnings),
    lossy: associatedAlphaWasConverted,
  };
}

function validateBitmap(bitmap: StudioTiffRgbaBitmap): Uint8Array | Uint8ClampedArray {
  const pixelCount = checkedPixelCount(bitmap.width, bitmap.height);
  const expectedBytes = checkedMultiply(pixelCount, 4, "INVALID_PIXELS", "TIFF RGBA 픽셀 길이가 안전 범위를 벗어났습니다.");
  if (!(bitmap.data instanceof Uint8Array) && !(bitmap.data instanceof Uint8ClampedArray)) {
    fail("INVALID_PIXELS", "TIFF RGBA 픽셀 데이터는 8-bit typed array여야 합니다.");
  }
  if (bitmap.data.byteLength !== expectedBytes) {
    fail("INVALID_PIXELS", "TIFF RGBA 픽셀 버퍼 길이가 이미지 크기와 일치하지 않습니다.");
  }
  return bitmap.data;
}

function hasTransparency(pixels: Uint8Array | Uint8ClampedArray): boolean {
  for (let offset = 3; offset < pixels.byteLength; offset += 4) {
    if (pixels[offset] !== 255) return true;
  }
  return false;
}

interface ExportEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  readonly value: number;
}

function writeExportEntry(view: DataView, offset: number, entry: ExportEntry): void {
  view.setUint16(offset, entry.tag, true);
  view.setUint16(offset + 2, entry.type, true);
  view.setUint32(offset + 4, entry.count, true);
  if (entry.type === TIFF_TYPE_SHORT && entry.count === 1) {
    view.setUint16(offset + 8, entry.value, true);
    view.setUint16(offset + 10, 0, true);
  } else {
    view.setUint32(offset + 8, entry.value, true);
  }
}

export function encodeStudioTiffInterchange(bitmap: StudioTiffRgbaBitmap): StudioTiffEncoded {
  const pixels = validateBitmap(bitmap);
  const transparent = hasTransparency(pixels);
  const samplesPerPixel = transparent ? 4 : 3;
  const entryCount = transparent ? 11 : 10;
  const ifdOffset = 8;
  const ifdLength = 2 + entryCount * 12 + 4;
  const bitsOffset = ifdOffset + ifdLength;
  const bitsLength = samplesPerPixel * 2;
  const pixelOffset = bitsOffset + bitsLength + ((bitsOffset + bitsLength) % 2);
  const pixelCount = bitmap.width * bitmap.height;
  const pixelBytes = checkedMultiply(pixelCount, samplesPerPixel, "OUTPUT_TOO_LARGE", "TIFF 출력 픽셀 크기가 안전 범위를 벗어났습니다.");
  const outputBytes = checkedAdd(pixelOffset, pixelBytes, "OUTPUT_TOO_LARGE", "TIFF 출력 크기가 안전 범위를 벗어났습니다.");
  if (outputBytes > STUDIO_TIFF_INTERCHANGE_LIMITS.maxOutputBytes) {
    fail("OUTPUT_TOO_LARGE", "TIFF 출력 크기가 256MB 안전 한도를 벗어났습니다.");
  }

  const output = new Uint8Array(outputBytes);
  const view = new DataView(output.buffer);
  output[0] = 0x49;
  output[1] = 0x49;
  view.setUint16(2, TIFF_MAGIC, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entryCount, true);

  const entries: ExportEntry[] = [
    { tag: TAG_IMAGE_WIDTH, type: TIFF_TYPE_LONG, count: 1, value: bitmap.width },
    { tag: TAG_IMAGE_LENGTH, type: TIFF_TYPE_LONG, count: 1, value: bitmap.height },
    { tag: TAG_BITS_PER_SAMPLE, type: TIFF_TYPE_SHORT, count: samplesPerPixel, value: bitsOffset },
    { tag: TAG_COMPRESSION, type: TIFF_TYPE_SHORT, count: 1, value: 1 },
    { tag: TAG_PHOTOMETRIC_INTERPRETATION, type: TIFF_TYPE_SHORT, count: 1, value: 2 },
    { tag: TAG_STRIP_OFFSETS, type: TIFF_TYPE_LONG, count: 1, value: pixelOffset },
    { tag: TAG_SAMPLES_PER_PIXEL, type: TIFF_TYPE_SHORT, count: 1, value: samplesPerPixel },
    { tag: TAG_ROWS_PER_STRIP, type: TIFF_TYPE_LONG, count: 1, value: bitmap.height },
    { tag: TAG_STRIP_BYTE_COUNTS, type: TIFF_TYPE_LONG, count: 1, value: pixelBytes },
    { tag: TAG_PLANAR_CONFIGURATION, type: TIFF_TYPE_SHORT, count: 1, value: 1 },
  ];
  if (transparent) entries.push({ tag: TAG_EXTRA_SAMPLES, type: TIFF_TYPE_SHORT, count: 1, value: 2 });
  entries.sort((left, right) => left.tag - right.tag);
  entries.forEach((entry, index) => writeExportEntry(view, ifdOffset + 2 + index * 12, entry));
  view.setUint32(ifdOffset + 2 + entryCount * 12, 0, true);
  for (let index = 0; index < samplesPerPixel; index += 1) view.setUint16(bitsOffset + index * 2, 8, true);

  let targetOffset = pixelOffset;
  for (let sourceOffset = 0; sourceOffset < pixels.byteLength; sourceOffset += 4) {
    output[targetOffset] = pixels[sourceOffset]!;
    output[targetOffset + 1] = pixels[sourceOffset + 1]!;
    output[targetOffset + 2] = pixels[sourceOffset + 2]!;
    if (samplesPerPixel === 4) output[targetOffset + 3] = pixels[sourceOffset + 3]!;
    targetOffset += samplesPerPixel;
  }

  const warnings = transparent
    ? []
    : [warning("opaque-alpha-omitted", "모든 픽셀이 불투명하여 중복 알파 채널을 생략한 RGB TIFF로 내보냈습니다.")];
  return {
    bytes: output,
    extension: ".tiff",
    mimeType: "image/tiff",
    warnings: Object.freeze(warnings),
    lossy: false,
  };
}
