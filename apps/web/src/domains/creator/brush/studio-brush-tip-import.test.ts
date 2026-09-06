import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_TIP_IMPORT_LIMITS,
  StudioBrushTipImportError,
  buildStudioBrushTipAlphaMask,
  importStudioBrushTipPng,
  parseStudioBrushTipPngHeader,
} from "./studio-brush-tip-import";
import { decodeStudioBrushTipAlphaMapBase64 } from "./studio-brush-tip-stamp";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function asBlobPart(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function opaquePixels(size: number, value: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index++) {
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return data;
}

describe("studio brush tip PNG validation", () => {
  it("reads bounded IHDR dimensions before decoding", () => {
    expect(parseStudioBrushTipPngHeader(pngHeader(2048, 1024))).toEqual({
      width: 2048,
      height: 1024,
    });
    expect(() => parseStudioBrushTipPngHeader(pngHeader(4097, 24)))
      .toThrowError(StudioBrushTipImportError);
    expect(() => parseStudioBrushTipPngHeader(new Uint8Array(24)))
      .toThrowError("올바른 PNG");
  });

  it("rejects non-PNG MIME and oversized files before image decoding", async () => {
    const wrongType = new File([asBlobPart(pngHeader(16, 16))], "tip.jpg", { type: "image/jpeg" });
    await expect(importStudioBrushTipPng(wrongType)).rejects.toMatchObject({ code: "type" });

    const oversized = new File(
      [new ArrayBuffer(STUDIO_BRUSH_TIP_IMPORT_LIMITS.maxBytes + 1)],
      "huge.png",
      { type: "image/png" }
    );
    await expect(importStudioBrushTipPng(oversized)).rejects.toMatchObject({ code: "size" });
  });
});

describe("studio brush tip alpha extraction", () => {
  it("preserves the alpha channel of transparent PNG pixels", () => {
    const size = 8;
    const data = opaquePixels(size, 20);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const distance = Math.hypot(x - 3.5, y - 3.5);
        data[(y * size + x) * 4 + 3] = Math.max(0, Math.round(255 - distance * 70));
      }
    }
    const mask = buildStudioBrushTipAlphaMask({ width: size, height: size, data });
    expect(mask.source).toBe("alpha");
    expect(mask.bytes[3 * size + 3]).toBeGreaterThan(mask.bytes[0]);
    expect(mask.bytes[3 * size + 3]).toBe(data[(3 * size + 3) * 4 + 3]);
  });

  it("detects a dark brush mark on an opaque light background", () => {
    const size = 8;
    const data = opaquePixels(size, 245);
    for (let y = 2; y <= 5; y++) {
      for (let x = 2; x <= 5; x++) {
        const offset = (y * size + x) * 4;
        data[offset] = 12;
        data[offset + 1] = 12;
        data[offset + 2] = 12;
      }
    }
    const mask = buildStudioBrushTipAlphaMask({ width: size, height: size, data });
    expect(mask.source).toBe("grayscale-dark");
    expect(mask.bytes[3 * size + 3]).toBeGreaterThan(240);
    expect(mask.bytes[0]).toBeLessThan(20);
  });

  it("detects a light brush mark on an opaque dark background", () => {
    const size = 8;
    const data = opaquePixels(size, 9);
    for (let y = 2; y <= 5; y++) {
      for (let x = 2; x <= 5; x++) {
        const offset = (y * size + x) * 4;
        data[offset] = 250;
        data[offset + 1] = 250;
        data[offset + 2] = 250;
      }
    }
    const mask = buildStudioBrushTipAlphaMask({ width: size, height: size, data });
    expect(mask.source).toBe("grayscale-light");
    expect(mask.bytes[3 * size + 3]).toBeGreaterThan(240);
    expect(mask.bytes[0]).toBeLessThan(20);
  });

  it("rejects a uniformly white opaque image with no brush-tip contrast", () => {
    expect(() => buildStudioBrushTipAlphaMask({
      width: 8,
      height: 8,
      data: opaquePixels(8, 255),
    })).toThrowError("펜촉 모양을 찾지 못했습니다");
  });

  it("rejects a uniformly black opaque image with no brush-tip contrast", () => {
    expect(() => buildStudioBrushTipAlphaMask({
      width: 8,
      height: 8,
      data: opaquePixels(8, 0),
    })).toThrowError("펜촉 모양을 찾지 못했습니다");
  });

  it("uses the edge as background when an opaque mark sits off centre", () => {
    const size = 8;
    const data = opaquePixels(size, 248);
    for (const y of [3, 4]) {
      const offset = (y * size + 1) * 4;
      data[offset] = 8;
      data[offset + 1] = 8;
      data[offset + 2] = 8;
    }
    const mask = buildStudioBrushTipAlphaMask({ width: size, height: size, data });
    expect(mask.source).toBe("grayscale-dark");
    expect(mask.bytes[3 * size + 1]).toBeGreaterThan(240);
    expect(mask.bytes[3 * size + 3]).toBeLessThan(20);
  });

  it("ignores transparent letterboxing when deciding grayscale polarity", () => {
    const size = 8;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 2; y < 6; y++) {
      for (let x = 0; x < 8; x++) {
        const offset = (y * size + x) * 4;
        const centre = x >= 2 && x <= 5;
        data[offset] = centre ? 0 : 255;
        data[offset + 1] = centre ? 0 : 255;
        data[offset + 2] = centre ? 0 : 255;
        data[offset + 3] = 255;
      }
    }
    const mask = buildStudioBrushTipAlphaMask({
      width: size,
      height: size,
      data,
      contentRect: { x: 0, y: 2, width: 8, height: 4 },
    });
    expect(mask.source).toBe("grayscale-dark");
    expect(mask.bytes[0]).toBe(0);
    expect(mask.bytes[3 * size + 3]).toBe(255);
  });
});

describe("studio brush tip import pipeline", () => {
  it("resamples to at most 64 square pixels and uses the existing base64 payload", async () => {
    const file = new File([asBlobPart(pngHeader(200, 100))], "charcoal-tip.png", { type: "image/png" });
    const imported = await importStudioBrushTipPng(file, {
      decode: async (_file, header, outputSize) => {
        expect(header).toEqual({ width: 200, height: 100 });
        expect(outputSize).toBe(64);
        const data = new Uint8ClampedArray(outputSize * outputSize * 4);
        for (let y = 16; y < 48; y++) {
          for (let x = 0; x < outputSize; x++) {
            const offset = (y * outputSize + x) * 4;
            const centre = Math.hypot(x - 31.5, y - 31.5) < 18;
            data[offset] = centre ? 0 : 255;
            data[offset + 1] = centre ? 0 : 255;
            data[offset + 2] = centre ? 0 : 255;
            data[offset + 3] = 255;
          }
        }
        return {
          width: outputSize,
          height: outputSize,
          data,
          contentRect: { x: 0, y: 16, width: 64, height: 32 },
        };
      },
    });
    expect(imported).toMatchObject({
      alphaMapSize: 64,
      sourceWidth: 200,
      sourceHeight: 100,
      source: "grayscale-dark",
    });
    expect(decodeStudioBrushTipAlphaMapBase64(imported.alphaMapBase64)?.length).toBe(64 * 64);
  });
});
