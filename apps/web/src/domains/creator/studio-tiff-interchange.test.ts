import { describe, expect, it } from "vitest";

import {
  assertStudioTiffInputByteLength,
  decodeStudioTiffInterchange,
  encodeStudioTiffInterchange,
  sniffStudioTiffInterchange,
  STUDIO_TIFF_INTERCHANGE_LIMITS,
  StudioTiffInterchangeError,
} from "./studio-tiff-interchange";

const TYPE_SHORT = 3;
const TYPE_LONG = 4;

interface FixtureEntry {
  readonly tag: number;
  readonly type: typeof TYPE_SHORT | typeof TYPE_LONG;
  readonly values: number[];
  externalOffset?: number;
}

interface TiffFixtureOptions {
  readonly littleEndian?: boolean;
  readonly width: number;
  readonly height: number;
  readonly samplesPerPixel: 3 | 4;
  readonly pixels: readonly number[];
  readonly rowsPerStrip?: number;
  readonly compression?: number;
  readonly photometric?: number;
  readonly bitsPerSample?: readonly number[];
  readonly planarConfiguration?: number;
  readonly orientation?: number;
  readonly extraSample?: number | null;
  readonly nextIfdOffset?: number;
}

function align2(value: number): number {
  return value + (value % 2);
}

function writeValues(view: DataView, offset: number, type: number, values: readonly number[], littleEndian: boolean): void {
  const stride = type === TYPE_SHORT ? 2 : 4;
  values.forEach((value, index) => {
    if (type === TYPE_SHORT) view.setUint16(offset + index * stride, value, littleEndian);
    else view.setUint32(offset + index * stride, value, littleEndian);
  });
}

function makeTiffFixture(options: TiffFixtureOptions): Uint8Array {
  const littleEndian = options.littleEndian ?? true;
  const rowsPerStrip = options.rowsPerStrip ?? options.height;
  const planarConfiguration = options.planarConfiguration ?? 1;
  const stripsPerPlane = Math.ceil(options.height / rowsPerStrip);
  const stripCount = planarConfiguration === 2
    ? stripsPerPlane * options.samplesPerPixel
    : stripsPerPlane;
  const stripByteCounts = Array.from({ length: stripCount }, (_, index) => {
    const stripInPlane = planarConfiguration === 2 ? index % stripsPerPlane : index;
    const rows = Math.min(rowsPerStrip, options.height - stripInPlane * rowsPerStrip);
    return rows * options.width * (planarConfiguration === 2 ? 1 : options.samplesPerPixel);
  });
  const entries: FixtureEntry[] = [
    { tag: 256, type: TYPE_LONG, values: [options.width] },
    { tag: 257, type: TYPE_LONG, values: [options.height] },
    { tag: 258, type: TYPE_SHORT, values: [...(options.bitsPerSample ?? Array(options.samplesPerPixel).fill(8))] },
    { tag: 259, type: TYPE_SHORT, values: [options.compression ?? 1] },
    { tag: 262, type: TYPE_SHORT, values: [options.photometric ?? 2] },
    { tag: 273, type: TYPE_LONG, values: Array(stripCount).fill(0) },
    { tag: 274, type: TYPE_SHORT, values: [options.orientation ?? 1] },
    { tag: 277, type: TYPE_SHORT, values: [options.samplesPerPixel] },
    { tag: 278, type: TYPE_LONG, values: [rowsPerStrip] },
    { tag: 279, type: TYPE_LONG, values: stripByteCounts },
    { tag: 284, type: TYPE_SHORT, values: [planarConfiguration] },
  ];
  const extraSample = options.extraSample === undefined
    ? (options.samplesPerPixel === 4 ? 2 : null)
    : options.extraSample;
  if (extraSample !== null) entries.push({ tag: 338, type: TYPE_SHORT, values: [extraSample] });
  entries.sort((left, right) => left.tag - right.tag);

  const ifdOffset = 8;
  const ifdEnd = ifdOffset + 2 + entries.length * 12 + 4;
  let cursor = align2(ifdEnd);
  for (const entry of entries) {
    const valueBytes = entry.values.length * (entry.type === TYPE_SHORT ? 2 : 4);
    if (valueBytes > 4) {
      entry.externalOffset = cursor;
      cursor = align2(cursor + valueBytes);
    }
  }
  const stripOffsets = new Array<number>(stripCount);
  for (let index = 0; index < stripCount; index += 1) {
    stripOffsets[index] = cursor;
    cursor = align2(cursor + stripByteCounts[index]!);
  }
  entries.find((entry) => entry.tag === 273)!.values.splice(0, stripCount, ...stripOffsets);

  const output = new Uint8Array(cursor);
  const view = new DataView(output.buffer);
  output[0] = littleEndian ? 0x49 : 0x4d;
  output[1] = littleEndian ? 0x49 : 0x4d;
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, ifdOffset, littleEndian);
  view.setUint16(ifdOffset, entries.length, littleEndian);
  entries.forEach((entry, index) => {
    const offset = ifdOffset + 2 + index * 12;
    view.setUint16(offset, entry.tag, littleEndian);
    view.setUint16(offset + 2, entry.type, littleEndian);
    view.setUint32(offset + 4, entry.values.length, littleEndian);
    if (entry.externalOffset !== undefined) {
      view.setUint32(offset + 8, entry.externalOffset, littleEndian);
      writeValues(view, entry.externalOffset, entry.type, entry.values, littleEndian);
    } else {
      writeValues(view, offset + 8, entry.type, entry.values, littleEndian);
    }
  });
  view.setUint32(ifdOffset + 2 + entries.length * 12, options.nextIfdOffset ?? 0, littleEndian);

  let sourceOffset = 0;
  stripOffsets.forEach((offset, index) => {
    const byteCount = stripByteCounts[index]!;
    output.set(options.pixels.slice(sourceOffset, sourceOffset + byteCount), offset);
    sourceOffset += byteCount;
  });
  return output;
}

function findEntry(bytes: Uint8Array, tag: number, littleEndian: boolean): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ifdOffset = view.getUint32(4, littleEndian);
  const count = view.getUint16(ifdOffset, littleEndian);
  for (let index = 0; index < count; index += 1) {
    const offset = ifdOffset + 2 + index * 12;
    if (view.getUint16(offset, littleEndian) === tag) return offset;
  }
  throw new Error(`tag ${tag} not found`);
}

function expectTiffError(action: () => unknown, code: StudioTiffInterchangeError["code"]): void {
  try {
    action();
    throw new Error("Expected TIFF error");
  } catch (error) {
    expect(error).toBeInstanceOf(StudioTiffInterchangeError);
    expect((error as StudioTiffInterchangeError).code).toBe(code);
  }
}

const opaqueBitmap = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 12, 34, 56, 255,
  ]),
};

describe("studio TIFF interchange", () => {
  it("little-endian RGB TIFF를 내보내고 불투명 RGBA를 무손실 왕복한다", () => {
    const encoded = encodeStudioTiffInterchange(opaqueBitmap);

    expect([...encoded.bytes.slice(0, 4)]).toEqual([0x49, 0x49, 0x2a, 0]);
    expect(encoded.extension).toBe(".tiff");
    expect(encoded.mimeType).toBe("image/tiff");
    expect(encoded.lossy).toBe(false);
    expect(encoded.warnings.map(({ code }) => code)).toEqual(["opaque-alpha-omitted"]);
    expect(sniffStudioTiffInterchange(encoded.bytes)).toBe(true);

    const decoded = decodeStudioTiffInterchange(encoded.bytes);
    expect(decoded.byteOrder).toBe("little-endian");
    expect(decoded.lossy).toBe(false);
    expect(decoded.warnings.map(({ code }) => code)).toEqual(["alpha-synthesized"]);
    expect([...decoded.bitmap.data]).toEqual([...opaqueBitmap.data]);
  });

  it("투명 RGBA는 unassociated alpha TIFF로 경고 없이 무손실 왕복한다", () => {
    const bitmap = {
      width: 2,
      height: 1,
      data: new Uint8Array([90, 120, 150, 128, 1, 2, 3, 0]),
    };
    const encoded = encodeStudioTiffInterchange(bitmap);
    expect(encoded.warnings).toEqual([]);
    expect(encoded.lossy).toBe(false);

    const decoded = decodeStudioTiffInterchange(encoded.bytes);
    expect(decoded.warnings).toEqual([]);
    expect(decoded.lossy).toBe(false);
    expect([...decoded.bitmap.data]).toEqual([...bitmap.data]);
  });

  it("big-endian RGB와 여러 strip을 행 순서대로 가져온다", () => {
    const pixels = [
      255, 0, 0, 0, 255, 0,
      0, 0, 255, 20, 30, 40,
    ];
    const file = makeTiffFixture({
      littleEndian: false,
      width: 2,
      height: 2,
      samplesPerPixel: 3,
      rowsPerStrip: 1,
      pixels,
    });
    const decoded = decodeStudioTiffInterchange(file);

    expect(decoded.byteOrder).toBe("big-endian");
    expect(decoded.bitmap.width).toBe(2);
    expect(decoded.bitmap.height).toBe(2);
    expect([...decoded.bitmap.data]).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 20, 30, 40, 255,
    ]);
  });

  it("big-endian associated alpha를 straight RGBA로 바꾸고 손실 가능성을 경고한다", () => {
    const file = makeTiffFixture({
      littleEndian: false,
      width: 2,
      height: 1,
      samplesPerPixel: 4,
      extraSample: 1,
      pixels: [50, 25, 10, 128, 0, 0, 0, 0],
    });
    const decoded = decodeStudioTiffInterchange(file);

    expect(decoded.lossy).toBe(true);
    expect(decoded.warnings.map(({ code }) => code)).toEqual(["associated-alpha-converted"]);
    expect([...decoded.bitmap.data]).toEqual([100, 50, 20, 128, 0, 0, 0, 0]);
  });

  it("separated-planar RGBA strip을 chunky RGBA 픽셀로 정상화한다", () => {
    const file = makeTiffFixture({
      littleEndian: false,
      width: 2,
      height: 1,
      samplesPerPixel: 4,
      planarConfiguration: 2,
      pixels: [10, 50, 20, 60, 30, 70, 40, 80],
    });
    const decoded = decodeStudioTiffInterchange(file);

    expect(decoded.lossy).toBe(false);
    expect(decoded.warnings).toEqual([]);
    expect([...decoded.bitmap.data]).toEqual([10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it("헤더 byte order와 magic, 잘린 IFD를 fail-closed한다", () => {
    expect(sniffStudioTiffInterchange(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBe(true);
    expect(sniffStudioTiffInterchange(new Uint8Array([0x49, 0x4d, 0x2a, 0]))).toBe(false);
    expectTiffError(() => decodeStudioTiffInterchange(new Uint8Array([0x49, 0x4d, 0x2a, 0, 8, 0, 0, 0])), "INVALID_HEADER");

    const invalidMagic = encodeStudioTiffInterchange(opaqueBitmap).bytes.slice();
    invalidMagic[2] = 41;
    expectTiffError(() => decodeStudioTiffInterchange(invalidMagic), "INVALID_HEADER");

    const truncated = encodeStudioTiffInterchange(opaqueBitmap).bytes.slice(0, 12);
    expectTiffError(() => decodeStudioTiffInterchange(truncated), "INVALID_IFD");
  });

  it("압축, 비 RGB, 16-bit, planar, 회전 orientation 변형을 거부한다", () => {
    const variants = [
      makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3], compression: 5 }),
      makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3], photometric: 1 }),
      makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3], bitsPerSample: [16, 16, 16] }),
      makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3], planarConfiguration: 3 }),
      makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3], orientation: 6 }),
    ];
    variants.forEach((variant) => {
      expectTiffError(() => decodeStudioTiffInterchange(variant), "UNSUPPORTED_VARIANT");
    });
  });

  it("RGBA ExtraSamples 누락과 연결된 다음 IFD를 거부한다", () => {
    const noAlphaDeclaration = makeTiffFixture({
      width: 1,
      height: 1,
      samplesPerPixel: 4,
      extraSample: null,
      pixels: [1, 2, 3, 4],
    });
    expectTiffError(() => decodeStudioTiffInterchange(noAlphaDeclaration), "INVALID_IFD");

    const linked = makeTiffFixture({
      width: 1,
      height: 1,
      samplesPerPixel: 3,
      pixels: [1, 2, 3],
      nextIfdOffset: 8,
    });
    expectTiffError(() => decodeStudioTiffInterchange(linked), "UNSUPPORTED_VARIANT");
  });

  it("중복 태그와 누락된 필수 태그를 IFD 손상으로 거부한다", () => {
    const duplicate = makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3] });
    new DataView(duplicate.buffer).setUint16(findEntry(duplicate, 274, true), 256, true);
    expectTiffError(() => decodeStudioTiffInterchange(duplicate), "INVALID_IFD");

    const missing = makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3] });
    new DataView(missing.buffer).setUint16(findEntry(missing, 256, true), 65_000, true);
    expectTiffError(() => decodeStudioTiffInterchange(missing), "INVALID_IFD");
  });

  it("IFD 항목 예산을 table 길이 계산 전에 제한한다", () => {
    const file = new Uint8Array(10);
    const view = new DataView(file.buffer);
    file.set([0x49, 0x49]);
    view.setUint16(2, 42, true);
    view.setUint32(4, 8, true);
    view.setUint16(8, STUDIO_TIFF_INTERCHANGE_LIMITS.maxIfdEntries + 1, true);
    expectTiffError(() => decodeStudioTiffInterchange(file), "INVALID_IFD");
  });

  it("입력 byte budget을 파일 할당 전에 검사할 수 있다", () => {
    expect(() => assertStudioTiffInputByteLength(STUDIO_TIFF_INTERCHANGE_LIMITS.maxInputBytes)).not.toThrow();
    expectTiffError(
      () => assertStudioTiffInputByteLength(STUDIO_TIFF_INTERCHANGE_LIMITS.maxInputBytes + 1),
      "INPUT_TOO_LARGE"
    );
  });

  it("픽셀 예산, 출력 버퍼 길이와 안전 차원을 검증한다", () => {
    const huge = makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3] });
    const hugeView = new DataView(huge.buffer);
    hugeView.setUint32(findEntry(huge, 256, true) + 8, 32_768, true);
    hugeView.setUint32(findEntry(huge, 257, true) + 8, 32_768, true);
    expectTiffError(() => decodeStudioTiffInterchange(huge), "INVALID_DIMENSIONS");
    expectTiffError(
      () => encodeStudioTiffInterchange({ width: 2, height: 2, data: new Uint8Array(3) }),
      "INVALID_PIXELS"
    );
  });

  it("strip offset overflow, 잘린 strip, 중첩 strip을 fail-closed한다", () => {
    const offsetOverflow = makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3] });
    const overflowView = new DataView(offsetOverflow.buffer);
    overflowView.setUint32(findEntry(offsetOverflow, 273, true) + 8, 0xffff_fff0, true);
    expectTiffError(() => decodeStudioTiffInterchange(offsetOverflow), "INVALID_STRIPS");

    const truncated = makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3] });
    expectTiffError(() => decodeStudioTiffInterchange(truncated.slice(0, -2)), "INVALID_STRIPS");

    const overlapping = makeTiffFixture({
      width: 1,
      height: 2,
      samplesPerPixel: 3,
      rowsPerStrip: 1,
      pixels: [1, 2, 3, 4, 5, 6],
    });
    const overlapView = new DataView(overlapping.buffer);
    const offsetsEntry = findEntry(overlapping, 273, true);
    const offsetsPointer = overlapView.getUint32(offsetsEntry + 8, true);
    const firstOffset = overlapView.getUint32(offsetsPointer, true);
    overlapView.setUint32(offsetsPointer + 4, firstOffset, true);
    expectTiffError(() => decodeStudioTiffInterchange(overlapping), "INVALID_STRIPS");
  });

  it("외부 BitsPerSample 오프셋과 strip byte count 조작을 거부한다", () => {
    const bitsOverflow = makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3] });
    new DataView(bitsOverflow.buffer).setUint32(findEntry(bitsOverflow, 258, true) + 8, 0xffff_fff0, true);
    expectTiffError(() => decodeStudioTiffInterchange(bitsOverflow), "INVALID_IFD");

    const wrongByteCount = makeTiffFixture({ width: 1, height: 1, samplesPerPixel: 3, pixels: [1, 2, 3] });
    new DataView(wrongByteCount.buffer).setUint32(findEntry(wrongByteCount, 279, true) + 8, 2, true);
    expectTiffError(() => decodeStudioTiffInterchange(wrongByteCount), "INVALID_STRIPS");
  });
});
