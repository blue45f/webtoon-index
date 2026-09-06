import { describe, expect, it } from "vitest";

import {
  decodeStudioRasterInterchange,
  encodeStudioRasterInterchange,
  sniffStudioRasterInterchange,
  StudioRasterInterchangeError,
} from "./studio-raster-interchange";

const bitmap = {
  width: 3,
  height: 2,
  data: new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0,
    12, 34, 56, 255, 254, 253, 252, 255, 1, 2, 3, 17,
  ]),
};

function expectSameBitmap(format: "tga" | "pam" | "qoi" | "tiff"): void {
  const encoded = encodeStudioRasterInterchange(format, bitmap);
  expect(encoded.lossy).toBe(false);
  expect(sniffStudioRasterInterchange(encoded.bytes)).toBe(format);
  const decoded = decodeStudioRasterInterchange(encoded.bytes, format);
  expect(decoded.bitmap.width).toBe(bitmap.width);
  expect(decoded.bitmap.height).toBe(bitmap.height);
  expect([...decoded.bitmap.data]).toEqual([...bitmap.data]);
}

describe("studio raster interchange", () => {
  it.each(["tga", "pam", "qoi", "tiff"] as const)("%s는 RGBA 픽셀을 무손실 왕복한다", (format) => {
    expectSameBitmap(format);
  });

  it("QOI는 index/diff/luma/run/RGB/RGBA 조합에서도 왕복한다", () => {
    const data = new Uint8ClampedArray(80 * 4);
    for (let index = 0; index < 80; index += 1) {
      const offset = index * 4;
      data[offset] = index < 62 ? 10 : (index * 7) & 255;
      data[offset + 1] = index < 62 ? 20 : (index * 9) & 255;
      data[offset + 2] = index < 62 ? 30 : (index * 11) & 255;
      data[offset + 3] = index % 9 === 0 ? 128 : 255;
    }
    const encoded = encodeStudioRasterInterchange("qoi", { width: 80, height: 1, data });
    expect([...decodeStudioRasterInterchange(encoded.bytes).bitmap.data]).toEqual([...data]);
  });

  it("24-bit BMP는 행 padding과 bottom-up 순서를 지키며 불투명 픽셀을 왕복한다", () => {
    const opaque = { ...bitmap, data: new Uint8ClampedArray(bitmap.data.map((value, index) => index % 4 === 3 ? 255 : value)) };
    const encoded = encodeStudioRasterInterchange("bmp", opaque);
    expect(encoded.bytes[0]).toBe(0x42);
    expect(encoded.lossy).toBe(false);
    expect([...decodeStudioRasterInterchange(encoded.bytes).bitmap.data]).toEqual([...opaque.data]);
  });

  it("BMP와 PPM은 alpha를 흰색에 합성하고 손실 경고를 반환한다", () => {
    for (const format of ["bmp", "ppm"] as const) {
      const encoded = encodeStudioRasterInterchange(format, bitmap);
      expect(encoded.lossy).toBe(true);
      expect(encoded.warnings.join(" ")).toMatch(/투명|알파/u);
      const decoded = decodeStudioRasterInterchange(encoded.bytes);
      expect(decoded.bitmap.data[7]).toBe(255);
      expect(decoded.bitmap.data[11]).toBe(255);
    }
  });

  it("PPM은 주석이 있는 P6 파일도 읽는다", () => {
    const header = new TextEncoder().encode("P6\n# source\n2 1\n255\n");
    const file = new Uint8Array(header.length + 6);
    file.set(header);
    file.set([1, 2, 3, 4, 5, 6], header.length);
    expect([...decodeStudioRasterInterchange(file).bitmap.data]).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it("TGA bottom-left와 right-origin 입력 좌표를 정상화한다", () => {
    const encoded = encodeStudioRasterInterchange("tga", {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
    });
    encoded.bytes[17] = 0x18; // bottom + right origin, alpha bits preserved
    // Stored sequence is now interpreted right-to-left.
    expect([...decodeStudioRasterInterchange(encoded.bytes).bitmap.data]).toEqual([
      0, 0, 255, 255, 255, 0, 0, 255,
    ]);
  });

  it("magic과 지정 확장자가 다르면 확장자 위장 파일을 거부한다", () => {
    const qoi = encodeStudioRasterInterchange("qoi", bitmap).bytes;
    expect(() => decodeStudioRasterInterchange(qoi, "bmp")).toThrow(/내용은 \.qoi/u);
  });

  it("압축 BMP, RLE TGA, ASCII PPM과 잘린 QOI를 fail-closed한다", () => {
    const bmp = encodeStudioRasterInterchange("bmp", bitmap).bytes.slice();
    new DataView(bmp.buffer).setUint32(30, 1, true);
    expect(() => decodeStudioRasterInterchange(bmp)).toThrow(/압축되지 않은/u);

    const tga = encodeStudioRasterInterchange("tga", bitmap).bytes.slice();
    tga[2] = 10;
    expect(() => decodeStudioRasterInterchange(tga, "tga")).toThrow(StudioRasterInterchangeError);

    expect(() => decodeStudioRasterInterchange(new TextEncoder().encode("P3\n1 1\n255\n0 0 0\n"))).toThrow();

    const qoi = encodeStudioRasterInterchange("qoi", bitmap).bytes;
    expect(() => decodeStudioRasterInterchange(qoi.slice(0, -3))).toThrow(/QOI/u);
  });

  it("픽셀 버퍼 길이와 안전 차원을 검증한다", () => {
    expect(() => encodeStudioRasterInterchange("qoi", { width: 2, height: 2, data: new Uint8Array(3) })).toThrow(
      /버퍼 길이/u
    );
    expect(() => encodeStudioRasterInterchange("qoi", {
      width: 32_768,
      height: 32_768,
      data: new Uint8Array(0),
    })).toThrow(/픽셀 수/u);
  });
});
