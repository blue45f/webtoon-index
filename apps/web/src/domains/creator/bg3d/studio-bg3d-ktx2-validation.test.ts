import { describe, expect, it } from "vitest";

import { inspectStudioBg3dBasisKtx2 } from "./studio-bg3d-ktx2-validation";

const KTX2_IDENTIFIER = [
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;
const KTX2_HEADER_BYTES = 80;
const LEVEL_INDEX_ENTRY_BYTES = 24;
const DFD_BYTE_LENGTH = 44;
const ETC1S_COLOR_MODEL = 163;
const UASTC_COLOR_MODEL = 166;

type BasisColorModel = "etc1s" | "uastc";

interface FixtureOptions {
  readonly model: BasisColorModel;
  readonly width?: number;
  readonly height?: number;
  readonly levelByteLengths?: readonly number[];
  readonly supercompressionScheme?: 0 | 1 | 2;
  readonly keyValueEntries?: readonly (readonly [key: string, value: string])[];
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return dataView(bytes).getUint32(offset, true);
}

function readUint64(bytes: Uint8Array, offset: number): number {
  const view = dataView(bytes);
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * 0x1_0000_0000;
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  dataView(bytes).setUint16(offset, value, true);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  dataView(bytes).setUint32(offset, value, true);
}

function writeUint64(bytes: Uint8Array, offset: number, value: number): void {
  const view = dataView(bytes);
  view.setUint32(offset, value >>> 0, true);
  view.setUint32(offset + 4, Math.floor(value / 0x1_0000_0000), true);
}

function encodeKeyValueData(
  entries: readonly (readonly [key: string, value: string])[],
): Uint8Array {
  const encoder = new TextEncoder();
  const encodedEntries = entries.map(([key, value]) => {
    const keyBytes = encoder.encode(key);
    const valueBytes = encoder.encode(`${value}\0`);
    const payloadLength = keyBytes.byteLength + 1 + valueBytes.byteLength;
    const entry = new Uint8Array(4 + align(payloadLength, 4));
    writeUint32(entry, 0, payloadLength);
    entry.set(keyBytes, 4);
    entry[4 + keyBytes.byteLength] = 0;
    entry.set(valueBytes, 5 + keyBytes.byteLength);
    return entry;
  });
  const bytes = new Uint8Array(encodedEntries.reduce(
    (total, entry) => total + entry.byteLength,
    0,
  ));
  let cursor = 0;
  for (const entry of encodedEntries) {
    bytes.set(entry, cursor);
    cursor += entry.byteLength;
  }
  return bytes;
}

function expectedUastcLevelBytes(
  width: number,
  height: number,
  levelIndex: number,
): number {
  return Math.ceil(Math.max(1, Math.floor(width / 2 ** levelIndex)) / 4) *
    Math.ceil(Math.max(1, Math.floor(height / 2 ** levelIndex)) / 4) * 16;
}

function makeZstandardRawFrame(decodedByteLength: number, fill: number): Uint8Array {
  if (decodedByteLength > 255) throw new Error("test Zstandard fixture exceeds one-byte content size");
  const bytes = new Uint8Array(4 + 1 + 1 + 3 + decodedByteLength);
  bytes.set([0x28, 0xb5, 0x2f, 0xfd]);
  bytes[4] = 0x20; // single segment, one-byte frame content size, no dictionary/checksum
  bytes[5] = decodedByteLength;
  const blockHeader = (decodedByteLength << 3) | 1; // one final raw block
  bytes[6] = blockHeader & 0xff;
  bytes[7] = (blockHeader >>> 8) & 0xff;
  bytes[8] = (blockHeader >>> 16) & 0xff;
  bytes.fill(fill, 9);
  return bytes;
}

function makeBasisKtx2({
  model,
  width = 4,
  height = 4,
  levelByteLengths = [model === "uastc" ? 16 : 8],
  supercompressionScheme = model === "uastc" ? 0 : 1,
  keyValueEntries = [],
}: FixtureOptions): Uint8Array {
  const levelPayloads = levelByteLengths.map((byteLength, index) => {
    if (supercompressionScheme === 2) {
      return makeZstandardRawFrame(expectedUastcLevelBytes(width, height, index), 0xa0 + index);
    }
    const payload = new Uint8Array(byteLength);
    payload.fill(0xa0 + index);
    return payload;
  });
  const physicalLevelByteLengths = levelPayloads.map((payload) => payload.byteLength);
  const levelCount = physicalLevelByteLengths.length;
  const levelIndexEnd = KTX2_HEADER_BYTES + levelCount * LEVEL_INDEX_ENTRY_BYTES;
  const dfdOffset = levelIndexEnd;
  const dfdEnd = dfdOffset + DFD_BYTE_LENGTH;
  const kvd = encodeKeyValueData(keyValueEntries);
  const kvdOffset = kvd.byteLength > 0 ? dfdEnd : 0;
  const kvdEnd = dfdEnd + kvd.byteLength;
  const sgdByteLength = model === "etc1s" ? 20 + levelCount * 20 : 0;
  const sgdOffset = sgdByteLength > 0 ? align(kvdEnd, 8) : 0;
  const metadataEnd = sgdByteLength > 0 ? sgdOffset + sgdByteLength : kvdEnd;
  const levelAlignment = supercompressionScheme === 0 ? 16 : 1;
  let levelCursor = align(metadataEnd, levelAlignment);
  const levelOffsets = new Array<number>(levelCount);
  for (let index = levelCount - 1; index >= 0; index -= 1) {
    levelOffsets[index] = levelCursor;
    levelCursor += physicalLevelByteLengths[index] ?? 0;
    levelCursor = align(levelCursor, levelAlignment);
  }

  const bytes = new Uint8Array(levelCursor);
  bytes.set(KTX2_IDENTIFIER);
  writeUint32(bytes, 12, 0);
  writeUint32(bytes, 16, 1);
  writeUint32(bytes, 20, width);
  writeUint32(bytes, 24, height);
  writeUint32(bytes, 28, 0);
  writeUint32(bytes, 32, 0);
  writeUint32(bytes, 36, 1);
  writeUint32(bytes, 40, levelCount);
  writeUint32(bytes, 44, supercompressionScheme);
  writeUint32(bytes, 48, dfdOffset);
  writeUint32(bytes, 52, DFD_BYTE_LENGTH);
  writeUint32(bytes, 56, kvdOffset);
  writeUint32(bytes, 60, kvd.byteLength);
  writeUint64(bytes, 64, sgdOffset);
  writeUint64(bytes, 72, sgdByteLength);

  for (let index = 0; index < levelCount; index += 1) {
    const entryOffset = KTX2_HEADER_BYTES + index * LEVEL_INDEX_ENTRY_BYTES;
    const byteLength = physicalLevelByteLengths[index] ?? 0;
    writeUint64(bytes, entryOffset, levelOffsets[index] ?? 0);
    writeUint64(bytes, entryOffset + 8, byteLength);
    writeUint64(
      bytes,
      entryOffset + 16,
      supercompressionScheme === 1
        ? 0
        : model === "uastc"
          ? expectedUastcLevelBytes(width, height, index)
          : byteLength,
    );
  }

  writeUint32(bytes, dfdOffset, DFD_BYTE_LENGTH);
  writeUint32(bytes, dfdOffset + 4, 0);
  writeUint16(bytes, dfdOffset + 8, 2);
  writeUint16(bytes, dfdOffset + 10, 40);
  bytes[dfdOffset + 12] = model === "uastc" ? UASTC_COLOR_MODEL : ETC1S_COLOR_MODEL;
  bytes[dfdOffset + 13] = 1;
  bytes[dfdOffset + 14] = 2;
  bytes[dfdOffset + 15] = 0;
  bytes.set([3, 3, 0, 0], dfdOffset + 16);
  bytes[dfdOffset + 20] = model === "uastc" ? 16 : 8;
  bytes[dfdOffset + 30] = model === "uastc" ? 127 : 63;
  bytes[dfdOffset + 31] = 0;
  writeUint32(bytes, dfdOffset + 36, 0);
  writeUint32(bytes, dfdOffset + 40, 0xffff_ffff);

  if (kvd.byteLength > 0) bytes.set(kvd, kvdOffset);
  if (sgdByteLength > 0) {
    for (let index = 0; index < levelCount; index += 1) {
      const descriptorOffset = sgdOffset + 20 + index * 20;
      writeUint32(bytes, descriptorOffset, 0);
      writeUint32(bytes, descriptorOffset + 4, 0);
      writeUint32(bytes, descriptorOffset + 8, physicalLevelByteLengths[index] ?? 0);
      writeUint32(bytes, descriptorOffset + 12, 0);
      writeUint32(bytes, descriptorOffset + 16, 0);
    }
  }
  for (let index = 0; index < levelCount; index += 1) {
    const levelOffset = levelOffsets[index] ?? 0;
    const payload = levelPayloads[index];
    if (payload) bytes.set(payload, levelOffset);
  }
  return bytes;
}

function makeUastc(
  options: Omit<FixtureOptions, "model"> = {},
): Uint8Array {
  return makeBasisKtx2({ model: "uastc", ...options });
}

function makeEtc1s(
  options: Omit<FixtureOptions, "model"> = {},
): Uint8Array {
  return makeBasisKtx2({ model: "etc1s", ...options });
}

function mutate(bytes: Uint8Array, mutation: (copy: Uint8Array) => void): Uint8Array {
  const copy = Uint8Array.from(bytes);
  mutation(copy);
  return copy;
}

function dfdOffset(bytes: Uint8Array): number {
  return readUint32(bytes, 48);
}

function kvdOffset(bytes: Uint8Array): number {
  return readUint32(bytes, 56);
}

function sgdOffset(bytes: Uint8Array): number {
  return readUint64(bytes, 64);
}

describe("inspectStudioBg3dBasisKtx2", () => {
  describe("valid Basis KTX2 envelopes", () => {
    it("accepts an uncompressed UASTC texture without mutating its bytes", () => {
      const bytes = makeUastc();
      const before = Uint8Array.from(bytes);

      const result = inspectStudioBg3dBasisKtx2(bytes);

      expect(result).toEqual({
        width: 4,
        height: 4,
        levelCount: 1,
        estimatedDecodedBytes: 64,
        colorModel: "uastc",
        supercompression: "none",
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(bytes).toEqual(before);
      expect(readUint64(bytes, KTX2_HEADER_BYTES)).toBe(160);
    });

    it("accepts an ETC1S texture with BasisLZ global data", () => {
      const bytes = makeEtc1s();

      expect(inspectStudioBg3dBasisKtx2(bytes)).toEqual({
        width: 4,
        height: 4,
        levelCount: 1,
        estimatedDecodedBytes: 64,
        colorModel: "etc1s",
        supercompression: "basis-lz",
      });
      expect(dfdOffset(bytes)).toBe(104);
      expect(sgdOffset(bytes)).toBe(152);
      expect(readUint64(bytes, KTX2_HEADER_BYTES)).toBe(192);
    });

    it("accepts descending file offsets for multiple mip levels", () => {
      const bytes = makeUastc({
        width: 8,
        height: 8,
        levelByteLengths: [64, 16],
      });

      expect(readUint64(bytes, KTX2_HEADER_BYTES)).toBe(192);
      expect(readUint64(bytes, KTX2_HEADER_BYTES + LEVEL_INDEX_ENTRY_BYTES)).toBe(176);
      expect(inspectStudioBg3dBasisKtx2(bytes)?.levelCount).toBe(2);
    });

    it("honors a non-zero Uint8Array byteOffset", () => {
      const fixture = makeUastc();
      const storage = new Uint8Array(fixture.byteLength + 11);
      storage.set(fixture, 7);

      expect(inspectStudioBg3dBasisKtx2(storage.subarray(7, 7 + fixture.byteLength))).toEqual({
        width: 4,
        height: 4,
        levelCount: 1,
        estimatedDecodedBytes: 64,
        colorModel: "uastc",
        supercompression: "none",
      });
    });
  });

  describe("identifier, header, and uint64 bounds", () => {
    it("rejects truncated files and an invalid identifier", () => {
      const bytes = makeUastc();

      expect(inspectStudioBg3dBasisKtx2(bytes.subarray(0, 79))).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(mutate(bytes, (copy) => {
        copy[0] = 0;
      }))).toBeNull();
    });

    it.each([
      ["vkFormat", 12, 37],
      ["typeSize", 16, 2],
      ["zero width", 20, 0],
      ["non-block-aligned width", 20, 6],
      ["zero height", 24, 0],
      ["3D depth", 28, 1],
      ["array layers", 32, 1],
      ["cubemap faces", 36, 6],
      ["zero levels", 40, 0],
      ["unknown supercompression", 44, 3],
    ] as const)("rejects an unsupported %s header", (_name, offset, value) => {
      const bytes = mutate(makeUastc(), (copy) => writeUint32(copy, offset, value));

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });

    it("rejects uint64 values above Number.MAX_SAFE_INTEGER", () => {
      const unsafeHighWord = 0x20_0000;
      const unsafeSgd = mutate(makeUastc(), (copy) => {
        writeUint32(copy, 64, 0);
        writeUint32(copy, 68, unsafeHighWord);
      });
      const unsafeLevel = mutate(makeUastc(), (copy) => {
        writeUint32(copy, KTX2_HEADER_BYTES, 0);
        writeUint32(copy, KTX2_HEADER_BYTES + 4, unsafeHighWord);
      });

      expect(inspectStudioBg3dBasisKtx2(unsafeSgd)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(unsafeLevel)).toBeNull();
    });

    it("rejects a level range extending beyond the file", () => {
      const bytes = mutate(makeUastc(), (copy) => {
        writeUint64(copy, KTX2_HEADER_BYTES, copy.byteLength - 8);
        writeUint64(copy, KTX2_HEADER_BYTES + 8, 16);
      });

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });
  });

  describe("data format descriptor", () => {
    it.each([
      ["RGB", 0],
      ["RGBA", 3],
      ["RRR", 4],
      ["RG", 6],
    ] as const)("accepts the glTF UASTC %s channel", (_name, channel) => {
      const bytes = mutate(makeUastc(), (copy) => {
        copy[dfdOffset(copy) + 31] = channel;
      });

      expect(inspectStudioBg3dBasisKtx2(bytes)?.colorModel).toBe("uastc");
    });

    it.each([
      ["total size", (bytes: Uint8Array, offset: number) => writeUint32(bytes, offset, 40)],
      ["vendor/type", (bytes: Uint8Array, offset: number) => writeUint32(bytes, offset + 4, 1)],
      ["version", (bytes: Uint8Array, offset: number) => writeUint16(bytes, offset + 8, 1)],
      ["descriptor block size", (bytes: Uint8Array, offset: number) => writeUint16(bytes, offset + 10, 36)],
      ["color model", (bytes: Uint8Array, offset: number) => { bytes[offset + 12] = 1; }],
      ["color space pair", (bytes: Uint8Array, offset: number) => { bytes[offset + 13] = 2; }],
      ["premultiplied alpha flag", (bytes: Uint8Array, offset: number) => { bytes[offset + 15] = 1; }],
      ["texel block dimensions", (bytes: Uint8Array, offset: number) => { bytes[offset + 16] = 2; }],
      ["bytesPlane0", (bytes: Uint8Array, offset: number) => { bytes[offset + 20] = 12; }],
      ["sample bit offset", (bytes: Uint8Array, offset: number) => writeUint16(bytes, offset + 28, 1)],
      ["sample bit length", (bytes: Uint8Array, offset: number) => { bytes[offset + 30] = 126; }],
      ["sample channel", (bytes: Uint8Array, offset: number) => { bytes[offset + 31] = 2; }],
      ["glTF-forbidden UASTC RRRG channel", (bytes: Uint8Array, offset: number) => { bytes[offset + 31] = 5; }],
      ["sample qualifier", (bytes: Uint8Array, offset: number) => { bytes[offset + 31] = 0x10; }],
      ["sample position", (bytes: Uint8Array, offset: number) => { bytes[offset + 32] = 1; }],
      ["sample lower", (bytes: Uint8Array, offset: number) => writeUint32(bytes, offset + 36, 1)],
      ["sample upper", (bytes: Uint8Array, offset: number) => writeUint32(bytes, offset + 40, 0)],
    ] as const)("rejects an invalid DFD %s", (_name, corrupt) => {
      const bytes = mutate(makeUastc(), (copy) => corrupt(copy, dfdOffset(copy)));

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });

    it("rejects a DFD range that overlaps or starts before the level index end", () => {
      const beforeIndexEnd = mutate(makeUastc(), (copy) => writeUint32(copy, 48, 100));
      const overlappingKvd = mutate(makeUastc({
        keyValueEntries: [["KTXorientation", "rd"]],
      }), (copy) => writeUint32(copy, 56, dfdOffset(copy) + 40));

      expect(inspectStudioBg3dBasisKtx2(beforeIndexEnd)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(overlappingKvd)).toBeNull();
    });
  });

  describe("level ordering, overlap, and supercompression", () => {
    it("rejects mip levels whose file offsets do not descend", () => {
      const bytes = mutate(makeUastc({
        width: 8,
        height: 8,
        levelByteLengths: [64, 16],
      }), (copy) => {
        const firstOffset = readUint64(copy, KTX2_HEADER_BYTES);
        const secondEntry = KTX2_HEADER_BYTES + LEVEL_INDEX_ENTRY_BYTES;
        const secondOffset = readUint64(copy, secondEntry);
        writeUint64(copy, KTX2_HEADER_BYTES, secondOffset);
        writeUint64(copy, secondEntry, firstOffset);
      });

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });

    it("rejects overlapping mip level byte ranges", () => {
      const bytes = mutate(makeUastc({
        width: 8,
        height: 8,
        levelByteLengths: [64, 16],
      }), (copy) => {
        const secondEntry = KTX2_HEADER_BYTES + LEVEL_INDEX_ENTRY_BYTES;
        writeUint64(copy, secondEntry, 184);
      });

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });

    it("rejects level payloads overlapping metadata", () => {
      const bytes = mutate(makeUastc(), (copy) => {
        writeUint64(copy, KTX2_HEADER_BYTES, dfdOffset(copy) + DFD_BYTE_LENGTH - 8);
      });

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });

    it("accepts UASTC with Zstandard and rejects invalid model/scheme pairs", () => {
      expect(inspectStudioBg3dBasisKtx2(makeUastc({ supercompressionScheme: 2 })))
        .toMatchObject({ colorModel: "uastc", supercompression: "zstandard" });
      expect(inspectStudioBg3dBasisKtx2(makeUastc({ supercompressionScheme: 1 }))).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(makeEtc1s({ supercompressionScheme: 0 }))).toBeNull();
    });

    it("rejects malformed or size-inconsistent Zstandard frame envelopes", () => {
      const valid = makeUastc({ supercompressionScheme: 2 });
      const levelOffset = readUint64(valid, KTX2_HEADER_BYTES);
      const badMagic = mutate(valid, (copy) => { copy[levelOffset] = 0; });
      const reservedDescriptorBit = mutate(valid, (copy) => { copy[levelOffset + 4] |= 0x08; });
      const wrongContentSize = mutate(valid, (copy) => { copy[levelOffset + 5] = 15; });
      const oversizedRawBlock = mutate(valid, (copy) => {
        const blockHeader = (17 << 3) | 1;
        copy[levelOffset + 6] = blockHeader & 0xff;
        copy[levelOffset + 7] = (blockHeader >>> 8) & 0xff;
        copy[levelOffset + 8] = (blockHeader >>> 16) & 0xff;
      });

      expect(inspectStudioBg3dBasisKtx2(badMagic)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(reservedDescriptorBit)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(wrongContentSize)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(oversizedRawBlock)).toBeNull();
    });

    it("enforces scheme-specific uncompressedByteLength semantics", () => {
      const noneMismatch = mutate(makeUastc(), (copy) => {
        writeUint64(copy, KTX2_HEADER_BYTES + 16, 17);
      });
      const basisMismatch = mutate(makeEtc1s(), (copy) => {
        writeUint64(copy, KTX2_HEADER_BYTES + 16, 1);
      });
      const zstdMissingLength = mutate(
        makeUastc({ supercompressionScheme: 2 }),
        (copy) => writeUint64(copy, KTX2_HEADER_BYTES + 16, 0),
      );

      expect(inspectStudioBg3dBasisKtx2(noneMismatch)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(basisMismatch)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(zstdMissingLength)).toBeNull();
    });
  });

  describe("key/value data", () => {
    it("accepts canonical orientation and swizzle metadata", () => {
      const bytes = makeUastc({
        keyValueEntries: [
          ["KTXorientation", "rd"],
          ["KTXswizzle", "rgba"],
        ],
      });

      expect(inspectStudioBg3dBasisKtx2(bytes)?.colorModel).toBe("uastc");
    });

    it("rejects unsupported orientation and swizzle metadata", () => {
      const orientation = makeUastc({
        keyValueEntries: [["KTXorientation", "ru"]],
      });
      const swizzle = makeUastc({
        keyValueEntries: [["KTXswizzle", "bgra"]],
      });

      expect(inspectStudioBg3dBasisKtx2(orientation)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(swizzle)).toBeNull();
    });

    it("rejects non-zero key/value padding", () => {
      const bytes = mutate(makeUastc({
        keyValueEntries: [["KTXorientation", "rd"]],
      }), (copy) => {
        const offset = kvdOffset(copy);
        const payloadLength = readUint32(copy, offset);
        copy[offset + 4 + payloadLength] = 1;
      });

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });

    it("rejects duplicate, unsorted, and malformed UTF-8 keys", () => {
      const duplicate = makeUastc({
        keyValueEntries: [
          ["KTXorientation", "rd"],
          ["KTXorientation", "rd"],
        ],
      });
      const unsorted = makeUastc({
        keyValueEntries: [
          ["KTXswizzle", "rgba"],
          ["KTXorientation", "rd"],
        ],
      });
      const malformed = mutate(makeUastc({
        keyValueEntries: [["KTXorientation", "rd"]],
      }), (copy) => {
        copy[kvdOffset(copy) + 4] = 0xff;
      });

      expect(inspectStudioBg3dBasisKtx2(duplicate)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(unsorted)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(malformed)).toBeNull();
    });

    it("rejects unsupported reserved metadata and oversized keys", () => {
      const unknownReserved = makeUastc({
        keyValueEntries: [["KTXfutureMetadata", "1"]],
      });
      const animationMetadata = makeUastc({
        keyValueEntries: [["KTXanimData", "1"]],
      });
      const oversizedVendorKey = makeUastc({
        keyValueEntries: [[`vendor.${"x".repeat(257)}`, "1"]],
      });

      expect(inspectStudioBg3dBasisKtx2(unknownReserved)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(animationMetadata)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(oversizedVendorKey)).toBeNull();
    });

    it("requires exact NUL-terminated canonical metadata values", () => {
      const bytes = mutate(makeUastc({
        keyValueEntries: [["KTXorientation", "rd"]],
      }), (copy) => {
        const offset = kvdOffset(copy);
        const payloadLength = readUint32(copy, offset);
        copy[offset + 3 + payloadLength] = 0x78;
      });

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });
  });

  describe("canonical physical layout", () => {
    it("rejects non-zero section padding and trailing payload bytes", () => {
      const nonZeroPadding = mutate(makeUastc(), (copy) => {
        copy[dfdOffset(copy) + DFD_BYTE_LENGTH] = 1;
      });
      const fixture = makeUastc();
      const trailingPayload = new Uint8Array(fixture.byteLength + 1);
      trailingPayload.set(fixture);
      trailingPayload[trailingPayload.byteLength - 1] = 1;

      expect(inspectStudioBg3dBasisKtx2(nonZeroPadding)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(trailingPayload)).toBeNull();
    });
  });

  describe("BasisLZ global data", () => {
    it.each([
      ["empty RGB slice", (bytes: Uint8Array, offset: number) => writeUint32(bytes, offset + 28, 0)],
      ["RGB slice past the level", (bytes: Uint8Array, offset: number) => {
        writeUint32(bytes, offset + 24, 8);
        writeUint32(bytes, offset + 28, 1);
      }],
      ["alpha offset without alpha data", (bytes: Uint8Array, offset: number) => {
        writeUint32(bytes, offset + 32, 1);
      }],
      ["alpha slice past the level", (bytes: Uint8Array, offset: number) => {
        writeUint32(bytes, offset + 32, 7);
        writeUint32(bytes, offset + 36, 2);
      }],
      ["overlapping RGB and alpha slices", (bytes: Uint8Array, offset: number) => {
        writeUint32(bytes, offset + 32, 4);
        writeUint32(bytes, offset + 36, 4);
      }],
    ] as const)("rejects %s in an image descriptor", (_name, corrupt) => {
      const bytes = mutate(makeEtc1s(), (copy) => corrupt(copy, sgdOffset(copy)));

      expect(inspectStudioBg3dBasisKtx2(bytes)).toBeNull();
    });

    it("rejects truncated and internally inconsistent global data", () => {
      const truncated = mutate(makeEtc1s(), (copy) => writeUint64(copy, 72, 39));
      const inconsistent = mutate(makeEtc1s(), (copy) => {
        writeUint32(copy, sgdOffset(copy) + 4, 1);
      });
      const extended = mutate(makeEtc1s(), (copy) => {
        writeUint32(copy, sgdOffset(copy) + 16, 1);
      });

      expect(inspectStudioBg3dBasisKtx2(truncated)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(inconsistent)).toBeNull();
      expect(inspectStudioBg3dBasisKtx2(extended)).toBeNull();
    });
  });
});
