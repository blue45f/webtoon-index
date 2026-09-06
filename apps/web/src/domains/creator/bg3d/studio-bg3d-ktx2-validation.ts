/**
 * Structural, decoder-free validation for the KHR_texture_basisu subset of KTX 2.0.
 *
 * This module deliberately does not transcode BasisLZ/UASTC payloads. It validates every offset and
 * bounded metadata table before a future pinned WASM decoder is allowed to observe the bytes.
 */

const KTX2_IDENTIFIER = [
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;
const KTX2_HEADER_BYTES = 80;
const KTX2_LEVEL_INDEX_ENTRY_BYTES = 24;
const KHR_DF_MODEL_ETC1S = 163;
const KHR_DF_MODEL_UASTC = 166;
const MAX_KVD_BYTES = 1024 * 1024;
const MAX_KVD_ENTRIES = 1024;
const MAX_KVD_KEY_BYTES = 256;
const KNOWN_KTX_METADATA_KEYS = new Set([
  "KTXanimData",
  "KTXcubemapIncomplete",
  "KTXdxgiFormat__",
  "KTXglFormat",
  "KTXmetalPixelFormat",
  "KTXorientation",
  "KTXswizzle",
  "KTXwriter",
  "KTXwriterScParams",
]);

export interface StudioBg3dBasisKtx2Info {
  readonly width: number;
  readonly height: number;
  readonly levelCount: number;
  /** Conservative RGBA8 allocation for every mip level declared by the KTX envelope. */
  readonly estimatedDecodedBytes: number;
  readonly colorModel: "etc1s" | "uastc";
  readonly supercompression: "none" | "basis-lz" | "zstandard";
}

interface ByteRange {
  readonly offset: number;
  readonly byteLength: number;
}

function matchesIdentifier(bytes: Uint8Array): boolean {
  return bytes.byteLength >= KTX2_IDENTIFIER.length &&
    KTX2_IDENTIFIER.every((value, index) => bytes[index] === value);
}

function readUint64(view: DataView, offset: number): number | null {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  if (high > Math.floor(Number.MAX_SAFE_INTEGER / 0x1_0000_0000)) return null;
  const value = high * 0x1_0000_0000 + low;
  return Number.isSafeInteger(value) ? value : null;
}

function rangeWithinFile(range: ByteRange, byteLength: number, alignment = 1): boolean {
  return Number.isSafeInteger(range.offset) && Number.isSafeInteger(range.byteLength) &&
    range.offset >= 0 && range.byteLength >= 0 && range.offset % alignment === 0 &&
    range.offset <= byteLength && range.byteLength <= byteLength - range.offset;
}

function rangesOverlap(left: ByteRange, right: ByteRange): boolean {
  return left.byteLength > 0 && right.byteLength > 0 &&
    left.offset < right.offset + right.byteLength &&
    right.offset < left.offset + left.byteLength;
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function safeAdd(left: number, right: number): number | null {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
}

function safeMultiply(left: number, right: number): number | null {
  const result = left * right;
  return Number.isSafeInteger(result) ? result : null;
}

function bytesAreZero(bytes: Uint8Array, start: number, end: number): boolean {
  if (start < 0 || end < start || end > bytes.byteLength) return false;
  for (let index = start; index < end; index += 1) {
    if (bytes[index] !== 0) return false;
  }
  return true;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isExactNullTerminatedAscii(bytes: Uint8Array, expected: string): boolean {
  if (bytes.byteLength !== expected.length + 1 || bytes[bytes.byteLength - 1] !== 0) return false;
  return Array.from(expected, (character) => character.charCodeAt(0))
    .every((value, index) => bytes[index] === value);
}

function validateKeyValueData(bytes: Uint8Array, range: ByteRange): boolean {
  if (range.byteLength === 0) return range.offset === 0;
  if (range.byteLength > MAX_KVD_BYTES || !rangeWithinFile(range, bytes.byteLength, 4)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = range.offset + range.byteLength;
  const keys = new Set<string>();
  let previousKeyBytes: Uint8Array | null = null;
  let cursor = range.offset;
  let entryCount = 0;
  while (cursor < end) {
    entryCount += 1;
    if (entryCount > MAX_KVD_ENTRIES) return false;
    if (end - cursor < 4) return false;
    const payloadLength = view.getUint32(cursor, true);
    if (payloadLength < 2 || payloadLength > end - cursor - 4) return false;
    const payloadStart = cursor + 4;
    const payloadEnd = payloadStart + payloadLength;
    let keyEnd = payloadStart;
    while (keyEnd < payloadEnd && bytes[keyEnd] !== 0) keyEnd += 1;
    if (keyEnd === payloadStart || keyEnd >= payloadEnd) return false;
    const keyBytes = bytes.subarray(payloadStart, keyEnd);
    if (
      keyBytes.byteLength > MAX_KVD_KEY_BYTES ||
      (keyBytes[0] === 0xef && keyBytes[1] === 0xbb && keyBytes[2] === 0xbf) ||
      (previousKeyBytes && compareBytes(previousKeyBytes, keyBytes) >= 0)
    ) return false;
    const key = decodeText(keyBytes);
    if (!key || keys.has(key)) return false;
    keys.add(key);
    previousKeyBytes = Uint8Array.from(keyBytes);

    const value = bytes.subarray(keyEnd + 1, payloadEnd);
    if ((key.startsWith("KTX") || key.startsWith("ktx")) && !KNOWN_KTX_METADATA_KEYS.has(key)) {
      return false;
    }
    if (key === "KTXanimData" || key === "KTXcubemapIncomplete") return false;
    if (key === "KTXorientation" && !isExactNullTerminatedAscii(value, "rd")) return false;
    if (key === "KTXswizzle" && !isExactNullTerminatedAscii(value, "rgba")) return false;

    const padding = (4 - (payloadLength % 4)) % 4;
    if (padding > end - payloadEnd) return false;
    for (let index = 0; index < padding; index += 1) {
      if (bytes[payloadEnd + index] !== 0) return false;
    }
    cursor = payloadEnd + padding;
  }
  return cursor === end;
}

function validateBasisGlobalData(
  bytes: Uint8Array,
  range: ByteRange,
  levels: readonly ByteRange[],
  sampleCount: number,
): boolean {
  const descriptorBytes = levels.length * 20;
  const fixedBytes = 20 + descriptorBytes;
  if (range.byteLength < fixedBytes || !rangeWithinFile(range, bytes.byteLength, 8)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const endpointsByteLength = view.getUint32(range.offset + 4, true);
  const selectorsByteLength = view.getUint32(range.offset + 8, true);
  const tablesByteLength = view.getUint32(range.offset + 12, true);
  const extendedByteLength = view.getUint32(range.offset + 16, true);
  if (extendedByteLength !== 0) return false;
  const variableBytes = endpointsByteLength + selectorsByteLength + tablesByteLength;
  if (!Number.isSafeInteger(variableBytes) || fixedBytes + variableBytes !== range.byteLength) {
    return false;
  }
  for (let index = 0; index < levels.length; index += 1) {
    const descriptorOffset = range.offset + 20 + index * 20;
    const imageFlags = view.getUint32(descriptorOffset, true);
    const rgbOffset = view.getUint32(descriptorOffset + 4, true);
    const rgbLength = view.getUint32(descriptorOffset + 8, true);
    const alphaOffset = view.getUint32(descriptorOffset + 12, true);
    const alphaLength = view.getUint32(descriptorOffset + 16, true);
    const level = levels[index];
    if (
      !level || rgbLength === 0 || rgbOffset > level.byteLength ||
      rgbLength > level.byteLength - rgbOffset ||
      imageFlags !== 0 ||
      (sampleCount === 1 && (alphaOffset !== 0 || alphaLength !== 0)) ||
      (sampleCount === 2 && alphaLength === 0) ||
      (alphaLength > 0 && (
        alphaOffset > level.byteLength || alphaLength > level.byteLength - alphaOffset ||
        rangesOverlap(
          { offset: rgbOffset, byteLength: rgbLength },
          { offset: alphaOffset, byteLength: alphaLength },
        )
      ))
    ) return false;
  }
  return true;
}

function expectedUastcLevelBytes(width: number, height: number, levelIndex: number): number | null {
  const divisor = 2 ** levelIndex;
  const mipWidth = Math.max(1, Math.floor(width / divisor));
  const mipHeight = Math.max(1, Math.floor(height / divisor));
  const blocksWide = Math.ceil(mipWidth / 4);
  const blocksHigh = Math.ceil(mipHeight / 4);
  const blocks = safeMultiply(blocksWide, blocksHigh);
  return blocks === null ? null : safeMultiply(blocks, 16);
}

function estimatedRgba8MipBytes(width: number, height: number, levelCount: number): number | null {
  let total = 0;
  for (let levelIndex = 0; levelIndex < levelCount; levelIndex += 1) {
    const divisor = 2 ** levelIndex;
    const mipWidth = Math.max(1, Math.floor(width / divisor));
    const mipHeight = Math.max(1, Math.floor(height / divisor));
    const pixels = safeMultiply(mipWidth, mipHeight);
    const bytes = pixels === null ? null : safeMultiply(pixels, 4);
    const next = bytes === null ? null : safeAdd(total, bytes);
    if (next === null) return null;
    total = next;
  }
  return total;
}

function validateBasisDfdSamples(
  bytes: Uint8Array,
  dfdOffset: number,
  colorModel: number,
  sampleCount: number,
): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channelTypes: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const sampleOffset = dfdOffset + 28 + index * 16;
    const bitOffset = view.getUint16(sampleOffset, true);
    const bitLength = bytes[sampleOffset + 2];
    const channelAndQualifiers = bytes[sampleOffset + 3];
    if (
      bitLength === undefined || channelAndQualifiers === undefined ||
      (channelAndQualifiers & 0xf0) !== 0 ||
      !bytesAreZero(bytes, sampleOffset + 4, sampleOffset + 8) ||
      view.getUint32(sampleOffset + 8, true) !== 0 ||
      view.getUint32(sampleOffset + 12, true) !== 0xffff_ffff
    ) return false;
    channelTypes.push(channelAndQualifiers & 0x0f);
    if (colorModel === KHR_DF_MODEL_UASTC) {
      if (sampleCount !== 1 || bitOffset !== 0 || bitLength !== 127) return false;
    } else if (bitOffset !== index * 64 || bitLength !== 63) {
      return false;
    }
  }

  if (colorModel === KHR_DF_MODEL_UASTC) {
    const channelType = channelTypes[0];
    // KHR_texture_basisu narrows core KTX UASTC to RGB, RGBA, RRR, or RG. RRRG (5) is a
    // core-KTX channel layout but is intentionally not portable in the glTF extension.
    return channelType !== undefined && [0, 3, 4, 6].includes(channelType);
  }
  return channelTypes.length === 1
    ? channelTypes[0] === 0 || channelTypes[0] === 3
    : channelTypes.length === 2 && (
        (channelTypes[0] === 0 && channelTypes[1] === 15) ||
        (channelTypes[0] === 3 && channelTypes[1] === 4)
      );
}

function readLittleEndianSafeInteger(
  bytes: Uint8Array,
  offset: number,
  byteLength: number,
): number | null {
  if (byteLength < 0 || byteLength > 8 || offset < 0 || offset + byteLength > bytes.byteLength) {
    return null;
  }
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < byteLength; index += 1) {
    value += (bytes[offset + index] ?? 0) * multiplier;
    if (!Number.isSafeInteger(value)) return null;
    multiplier *= 256;
  }
  return value;
}

/** Decoder-free RFC 8878 frame envelope validation for one independently-compressed KTX mip. */
function validateZstandardFrame(
  bytes: Uint8Array,
  range: ByteRange,
  expectedContentSize: number,
): boolean {
  if (!rangeWithinFile(range, bytes.byteLength) || range.byteLength < 9) return false;
  const end = range.offset + range.byteLength;
  let cursor = range.offset;
  if (
    bytes[cursor] !== 0x28 || bytes[cursor + 1] !== 0xb5 ||
    bytes[cursor + 2] !== 0x2f || bytes[cursor + 3] !== 0xfd
  ) return false;
  cursor += 4;

  const descriptor = bytes[cursor];
  if (descriptor === undefined || (descriptor & 0x18) !== 0) return false;
  cursor += 1;
  const frameContentSizeFlag = descriptor >>> 6;
  const singleSegment = (descriptor & 0x20) !== 0;
  const checksum = (descriptor & 0x04) !== 0;
  const dictionaryIdFlag = descriptor & 0x03;
  if (!singleSegment) {
    if (cursor >= end) return false;
    cursor += 1; // Window_Descriptor; a decoder will enforce the actual allocation window.
  }
  const dictionaryIdLength = dictionaryIdFlag === 0
    ? 0
    : dictionaryIdFlag === 1
      ? 1
      : dictionaryIdFlag === 2
        ? 2
        : 4;
  cursor += dictionaryIdLength;
  const frameContentSizeLength = frameContentSizeFlag === 0
    ? (singleSegment ? 1 : 0)
    : frameContentSizeFlag === 1
      ? 2
      : frameContentSizeFlag === 2
        ? 4
        : 8;
  const encodedContentSize = readLittleEndianSafeInteger(
    bytes,
    cursor,
    frameContentSizeLength,
  );
  if (encodedContentSize === null) return false;
  cursor += frameContentSizeLength;
  if (frameContentSizeLength > 0) {
    const contentSize = frameContentSizeLength === 2
      ? encodedContentSize + 256
      : encodedContentSize;
    if (contentSize !== expectedContentSize) return false;
  }

  let lastBlock = false;
  let knownDecodedBytes = 0;
  let allBlocksHaveKnownSize = true;
  while (!lastBlock) {
    if (cursor + 3 > end) return false;
    const blockHeader = (bytes[cursor] ?? 0) |
      ((bytes[cursor + 1] ?? 0) << 8) |
      ((bytes[cursor + 2] ?? 0) << 16);
    cursor += 3;
    lastBlock = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 0x03;
    const blockSize = blockHeader >>> 3;
    if (blockType === 3) return false;
    const payloadLength = blockType === 1 ? 1 : blockSize;
    if (payloadLength > end - cursor) return false;
    cursor += payloadLength;
    if (blockType === 2) {
      allBlocksHaveKnownSize = false;
    } else {
      knownDecodedBytes += blockSize;
      if (!Number.isSafeInteger(knownDecodedBytes) || knownDecodedBytes > expectedContentSize) {
        return false;
      }
    }
  }
  if (checksum) cursor += 4;
  return cursor === end && (!allBlocksHaveKnownSize || knownDecodedBytes === expectedContentSize);
}

/** Returns immutable dimensions/format metadata only when the full Basis KTX2 envelope is safe. */
export function inspectStudioBg3dBasisKtx2(bytes: Uint8Array): StudioBg3dBasisKtx2Info | null {
  if (bytes.byteLength < KTX2_HEADER_BYTES || !matchesIdentifier(bytes)) return null;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const vkFormat = view.getUint32(12, true);
    const typeSize = view.getUint32(16, true);
    const width = view.getUint32(20, true);
    const height = view.getUint32(24, true);
    const depth = view.getUint32(28, true);
    const layerCount = view.getUint32(32, true);
    const faceCount = view.getUint32(36, true);
    const levelCount = view.getUint32(40, true);
    const supercompressionScheme = view.getUint32(44, true);
    const dfdRange = {
      offset: view.getUint32(48, true),
      byteLength: view.getUint32(52, true),
    };
    const kvdRange = {
      offset: view.getUint32(56, true),
      byteLength: view.getUint32(60, true),
    };
    const sgdOffset = readUint64(view, 64);
    const sgdByteLength = readUint64(view, 72);
    if (sgdOffset === null || sgdByteLength === null) return null;
    const sgdRange = { offset: sgdOffset, byteLength: sgdByteLength };
    const maximumLevelCount = 1 + Math.floor(Math.log2(Math.max(width, height)));
    if (
      vkFormat !== 0 || typeSize !== 1 || width === 0 || height === 0 ||
      width % 4 !== 0 || height % 4 !== 0 || depth !== 0 || layerCount !== 0 ||
      faceCount !== 1 || levelCount === 0 || levelCount > maximumLevelCount ||
      (supercompressionScheme !== 0 && supercompressionScheme !== 1 && supercompressionScheme !== 2)
    ) return null;

    const levelIndexEnd = KTX2_HEADER_BYTES + levelCount * KTX2_LEVEL_INDEX_ENTRY_BYTES;
    if (levelIndexEnd > bytes.byteLength) return null;
    if (
      dfdRange.offset !== levelIndexEnd || dfdRange.byteLength < 44 ||
      !rangeWithinFile(dfdRange, bytes.byteLength, 4) ||
      !validateKeyValueData(bytes, kvdRange) ||
      (kvdRange.byteLength > 0 && dfdRange.offset + dfdRange.byteLength !== kvdRange.offset) ||
      (sgdRange.byteLength === 0 ? sgdRange.offset !== 0 : !rangeWithinFile(sgdRange, bytes.byteLength, 8)) ||
      rangesOverlap(dfdRange, kvdRange) || rangesOverlap(dfdRange, sgdRange) ||
      rangesOverlap(kvdRange, sgdRange)
    ) return null;

    const dfdTotalSize = view.getUint32(dfdRange.offset, true);
    const vendorAndType = view.getUint32(dfdRange.offset + 4, true);
    const versionNumber = view.getUint16(dfdRange.offset + 8, true);
    const descriptorBlockSize = view.getUint16(dfdRange.offset + 10, true);
    const colorModel = bytes[dfdRange.offset + 12];
    const colorPrimaries = bytes[dfdRange.offset + 13];
    const transferFunction = bytes[dfdRange.offset + 14];
    const flags = bytes[dfdRange.offset + 15];
    if (
      dfdTotalSize !== dfdRange.byteLength || vendorAndType !== 0 || versionNumber !== 2 ||
      descriptorBlockSize < 40 || descriptorBlockSize % 4 !== 0 ||
      descriptorBlockSize + 4 !== dfdRange.byteLength ||
      (colorModel !== KHR_DF_MODEL_ETC1S && colorModel !== KHR_DF_MODEL_UASTC) ||
      !(
        (colorPrimaries === 1 && transferFunction === 2) ||
        (colorPrimaries === 0 && transferFunction === 1)
      ) || flags !== 0 ||
      bytes[dfdRange.offset + 16] !== 3 || bytes[dfdRange.offset + 17] !== 3 ||
      bytes[dfdRange.offset + 18] !== 0 || bytes[dfdRange.offset + 19] !== 0
    ) return null;

    const sampleCount = (descriptorBlockSize - 24) / 16;
    if (!validateBasisDfdSamples(bytes, dfdRange.offset, colorModel, sampleCount)) return null;
    const bytesPlanes = bytes.subarray(dfdRange.offset + 20, dfdRange.offset + 28);
    const etcPlanesValid = bytesPlanes.every((value, index) => {
      if (index === 0 || (index === 1 && sampleCount === 2)) return value === 0 || value === 8;
      return value === 0;
    }) && (
      bytesPlanes[0] === 0
        ? bytesPlanes[1] === 0
        : bytesPlanes[0] === 8 && (sampleCount === 1 || bytesPlanes[1] === 8)
    );
    const uastcPlanesValid = (bytesPlanes[0] === 0 || bytesPlanes[0] === 16) &&
      bytesPlanes.subarray(1).every((value) => value === 0);
    if (
      (colorModel === KHR_DF_MODEL_ETC1S && (
        supercompressionScheme !== 1 || !etcPlanesValid
      )) ||
      (colorModel === KHR_DF_MODEL_UASTC && (
        (supercompressionScheme !== 0 && supercompressionScheme !== 2) ||
        !uastcPlanesValid
      ))
    ) return null;

    const levels: ByteRange[] = [];
    const uncompressedLengths: number[] = [];
    for (let index = 0; index < levelCount; index += 1) {
      const entryOffset = KTX2_HEADER_BYTES + index * KTX2_LEVEL_INDEX_ENTRY_BYTES;
      const offset = readUint64(view, entryOffset);
      const byteLength = readUint64(view, entryOffset + 8);
      const uncompressedByteLength = readUint64(view, entryOffset + 16);
      if (
        offset === null || byteLength === null || uncompressedByteLength === null ||
        byteLength === 0 || !rangeWithinFile({ offset, byteLength }, bytes.byteLength)
      ) return null;
      levels.push({ offset, byteLength });
      uncompressedLengths.push(uncompressedByteLength);
    }
    const dfdEnd = dfdRange.offset + dfdRange.byteLength;
    const keyValueEnd = kvdRange.byteLength > 0
      ? kvdRange.offset + kvdRange.byteLength
      : dfdEnd;
    const expectedSgdOffset = alignUp(keyValueEnd, 8);
    if (sgdRange.byteLength > 0 && (
      sgdRange.offset !== expectedSgdOffset || !bytesAreZero(bytes, keyValueEnd, sgdRange.offset)
    )) return null;
    const metadataEnd = sgdRange.byteLength > 0
      ? sgdRange.offset + sgdRange.byteLength
      : keyValueEnd;
    for (let index = 0; index < levels.length; index += 1) {
      const level = levels[index]!;
      const expectedUastcBytes = colorModel === KHR_DF_MODEL_UASTC
        ? expectedUastcLevelBytes(width, height, index)
        : null;
      if (
        level.offset < metadataEnd ||
        (index > 0 && level.offset >= levels[index - 1]!.offset) ||
        levels.some((other, otherIndex) => otherIndex !== index && rangesOverlap(level, other)) ||
        rangesOverlap(level, dfdRange) || rangesOverlap(level, kvdRange) ||
        rangesOverlap(level, sgdRange) ||
        (supercompressionScheme === 0 && (
          expectedUastcBytes === null || level.byteLength !== expectedUastcBytes ||
          uncompressedLengths[index] !== expectedUastcBytes || level.offset % 16 !== 0
        )) ||
        (supercompressionScheme === 1 && uncompressedLengths[index] !== 0) ||
        (supercompressionScheme === 2 && (
          expectedUastcBytes === null || uncompressedLengths[index] !== expectedUastcBytes ||
          !validateZstandardFrame(bytes, level, expectedUastcBytes)
        ))
      ) return null;
    }

    const levelAlignment = supercompressionScheme === 0 ? 16 : 1;
    const smallestLevel = levels[levels.length - 1];
    if (!smallestLevel) return null;
    const expectedSmallestOffset = alignUp(metadataEnd, levelAlignment);
    if (
      smallestLevel.offset !== expectedSmallestOffset ||
      !bytesAreZero(bytes, metadataEnd, smallestLevel.offset)
    ) return null;
    for (let index = levels.length - 1; index > 0; index -= 1) {
      const physicalLevel = levels[index]!;
      const nextPhysicalLevel = levels[index - 1]!;
      const physicalEnd = physicalLevel.offset + physicalLevel.byteLength;
      const expectedNextOffset = alignUp(physicalEnd, levelAlignment);
      if (
        nextPhysicalLevel.offset !== expectedNextOffset ||
        !bytesAreZero(bytes, physicalEnd, nextPhysicalLevel.offset)
      ) return null;
    }
    const baseLevel = levels[0]!;
    if (baseLevel.offset + baseLevel.byteLength !== bytes.byteLength) return null;

    if (
      (supercompressionScheme === 1 && !validateBasisGlobalData(
        bytes,
        sgdRange,
        levels,
        sampleCount,
      )) ||
      (supercompressionScheme !== 1 && (sgdRange.offset !== 0 || sgdRange.byteLength !== 0))
    ) return null;

    const estimatedDecodedBytes = estimatedRgba8MipBytes(width, height, levelCount);
    if (estimatedDecodedBytes === null) return null;

    return Object.freeze({
      width,
      height,
      levelCount,
      estimatedDecodedBytes,
      colorModel: colorModel === KHR_DF_MODEL_ETC1S ? "etc1s" : "uastc",
      supercompression: supercompressionScheme === 0
        ? "none"
        : supercompressionScheme === 1
          ? "basis-lz"
          : "zstandard",
    });
  } catch {
    return null;
  }
}
