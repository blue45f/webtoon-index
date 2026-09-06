import { describe, expect, it } from "vitest";

import { STUDIO_BG3D_LT_RENDER_MAX_PIXELS } from "./studio-bg3d-lt-render";
import { normalizeStudioBg3dRgbaReadback } from "./studio-bg3d-readback-normalize";

function webgpuRows(width: number, height: number): Uint8Array {
  const tightRowBytes = width * 4;
  const stride = Math.ceil(tightRowBytes / 256) * 256;
  const bytes = new Uint8Array((height - 1) * stride + tightRowBytes);
  for (let y = 0; y < height; y += 1) {
    bytes.fill(y + 1, y * stride, y * stride + tightRowBytes);
    if (y < height - 1) bytes.fill(0xee, y * stride + tightRowBytes, (y + 1) * stride);
  }
  return bytes;
}

describe("normalizeStudioBg3dRgbaReadback", () => {
  it.each([63, 64, 65, 257, 375])(
    "removes WebGPU row padding at the %ipx regression width",
    (width) => {
      const height = 3;
      const result = normalizeStudioBg3dRgbaReadback({
        width,
        height,
        rgba: webgpuRows(width, height),
      });
      const rowBytes = width * 4;

      expect(result).toHaveLength(width * height * 4);
      expect(new Set(result.subarray(0, rowBytes))).toEqual(new Set([1]));
      expect(new Set(result.subarray(rowBytes, rowBytes * 2))).toEqual(new Set([2]));
      expect(new Set(result.subarray(rowBytes * 2))).toEqual(new Set([3]));
      expect(result).not.toContain(0xee);
    }
  );

  it("normalizes bottom-up WebGL rows to the same top-down contract", () => {
    const bottomUp = Uint8Array.from([
      0, 0, 255, 255,
      255, 0, 0, 255,
    ]);

    expect(
      normalizeStudioBg3dRgbaReadback({ width: 1, height: 2, rgba: bottomUp, flipY: true })
    ).toEqual(Uint8ClampedArray.from([
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]));
  });

  it("always returns a fresh tightly packed clamped array", () => {
    const source = new Uint8ClampedArray([1, 2, 3, 4]);
    const result = normalizeStudioBg3dRgbaReadback({ width: 1, height: 1, rgba: source });

    expect(result).toEqual(source);
    expect(result).not.toBe(source);
    result[0] = 255;
    expect(source[0]).toBe(1);
  });

  it("accepts an explicit valid row stride", () => {
    const source = Uint8Array.from([
      1, 2, 3, 4, 99, 99, 99, 99,
      5, 6, 7, 8,
    ]);

    expect(
      normalizeStudioBg3dRgbaReadback({
        width: 1,
        height: 2,
        rgba: source,
        rowStrideBytes: 8,
      })
    ).toEqual(Uint8ClampedArray.from([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it.each([
    { width: 0, height: 1, rgba: new Uint8Array(4) },
    { width: 1, height: 1.5, rgba: new Uint8Array(4) },
    { width: 1, height: 1, rgba: new Uint16Array(4) },
    { width: 1, height: 2, rgba: new Uint8Array(7) },
    { width: 2, height: 1, rgba: new Uint8Array(8), rowStrideBytes: 4 },
    { width: 1, height: 1, rgba: new Uint8Array(4), flipY: "yes" },
    {
      width: STUDIO_BG3D_LT_RENDER_MAX_PIXELS + 1,
      height: 1,
      rgba: new Uint8Array(),
    },
  ])("rejects malformed or over-budget layouts: %#", (input) => {
    expect(() =>
      normalizeStudioBg3dRgbaReadback(
        input as Parameters<typeof normalizeStudioBg3dRgbaReadback>[0]
      )
    ).toThrow();
  });
});
