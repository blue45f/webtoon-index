import { describe, expect, it } from "vitest";

import {
  CHARACTER_INK_HEX,
  alphaOnly,
  isEmptyPass,
  lumaOf,
  maskMultiply,
  nearBlackAlpha,
  sobelEdgeAlpha,
  subtractClamped,
  unionAlpha,
} from "./character-shaper-image-math";

/** Build an RGBA buffer from `[r, g, b, a]` tuples, one per pixel. */
function rgba(...pixels: readonly (readonly [number, number, number, number])[]): Uint8ClampedArray {
  return new Uint8ClampedArray(pixels.flatMap((pixel) => [...pixel]));
}

function alphaChannel(buffer: Uint8ClampedArray): number[] {
  const out: number[] = [];
  for (let i = 3; i < buffer.length; i += 4) out.push(buffer[i]);
  return out;
}

/** A solid square on a transparent field — the shape a character silhouette has. */
function square(size: number, inset: number, color: readonly [number, number, number]): Uint8ClampedArray {
  const buffer = new Uint8ClampedArray(size * size * 4);
  for (let y = inset; y < size - inset; y += 1) {
    for (let x = inset; x < size - inset; x += 1) {
      const i = (y * size + x) * 4;
      buffer[i] = color[0];
      buffer[i + 1] = color[1];
      buffer[i + 2] = color[2];
      buffer[i + 3] = 255;
    }
  }
  return buffer;
}

describe("character shaper image math — luma", () => {
  it("keeps the VRM texture-analysis weights and the 0–255 range", () => {
    expect(lumaOf(0, 0, 0)).toBe(0);
    expect(lumaOf(255, 255, 255)).toBe(255);
    expect(lumaOf(255, 0, 0)).toBe(54);
    expect(lumaOf(0, 255, 0)).toBe(182);
    expect(lumaOf(0, 0, 255)).toBe(19);
  });
});

describe("character shaper image math — pass difference", () => {
  it("keeps only the positive channel difference and gates it by shared coverage", () => {
    const flat = rgba([200, 180, 160, 255], [100, 100, 100, 255], [10, 10, 10, 0]);
    const beauty = rgba([100, 180, 200, 255], [100, 100, 100, 255], [10, 10, 10, 0]);

    const shadow = subtractClamped(flat, beauty);

    // Pixel 0 darkened by 100 on red: colour carries the difference, alpha carries its strength.
    expect([...shadow.slice(0, 4)]).toEqual([100, 0, 0, 100]);
    // Pixel 1 is identical in both passes — a shadow layer must not paint it at all.
    expect([...shadow.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    // Pixel 2 is outside the silhouette in both passes.
    expect(shadow[11]).toBe(0);
  });

  it("is directional: highlight is the mirror of shadow and neither mutates its inputs", () => {
    const flat = rgba([120, 120, 120, 255]);
    const beauty = rgba([200, 120, 90, 255]);
    const before = { flat: flat.slice(), beauty: beauty.slice() };

    expect([...subtractClamped(beauty, flat)]).toEqual([80, 0, 0, 80]);
    expect([...subtractClamped(flat, beauty)]).toEqual([0, 0, 30, 30]);
    expect([...flat]).toEqual([...before.flat]);
    expect([...beauty]).toEqual([...before.beauty]);
  });

  it("refuses passes of different sizes instead of reading past the end", () => {
    expect(() => subtractClamped(rgba([1, 1, 1, 1]), rgba([1, 1, 1, 1], [2, 2, 2, 2])))
      .toThrow(/크기가 다릅니다/u);
  });
});

describe("character shaper image math — line extraction", () => {
  it("inks the silhouette edge of a flat-coloured subject and leaves the interior clean", () => {
    const size = 8;
    const edges = sobelEdgeAlpha(square(size, 2, [180, 170, 160]), size, size, { threshold: 40 });

    const at = (x: number, y: number) => edges[(y * size + x) * 4 + 3];
    // Just inside the boundary of the 4×4 square (x,y ∈ 2..5) the gradient is strong.
    expect(at(2, 3)).toBeGreaterThan(0);
    expect(at(5, 3)).toBeGreaterThan(0);
    // The middle of the square and the far background have no gradient at all.
    expect(at(3, 3)).toBe(0);
    expect(at(0, 0)).toBe(0);
  });

  it("writes the warm ink colour, not black, and honours a custom ink", () => {
    const size = 6;
    const subject = square(size, 2, [200, 200, 200]);
    const [r, g, b] = [0x1b, 0x17, 0x14];

    const inked = sobelEdgeAlpha(subject, size, size);
    expect([...inked.slice(0, 3)]).toEqual([r, g, b]);
    expect(CHARACTER_INK_HEX).toBe("#1b1714");

    const custom = sobelEdgeAlpha(subject, size, size, { inkColor: "#402010" });
    expect([...custom.slice(0, 3)]).toEqual([0x40, 0x20, 0x10]);
  });

  it("finds a luminance edge that carries no alpha edge", () => {
    const size = 6;
    const buffer = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        const value = x < 3 ? 240 : 30;
        buffer[i] = value;
        buffer[i + 1] = value;
        buffer[i + 2] = value;
        buffer[i + 3] = 255;
      }
    }

    const edges = sobelEdgeAlpha(buffer, size, size, { threshold: 40 });
    expect(edges[(2 * size + 2) * 4 + 3]).toBeGreaterThan(0);
    expect(edges[(2 * size + 0) * 4 + 3]).toBe(0);
  });

  it("rejects a buffer whose length does not match the given size", () => {
    expect(() => sobelEdgeAlpha(rgba([0, 0, 0, 0]), 4, 4)).toThrow(/맞지 않습니다/u);
  });
});

describe("character shaper image math — masks and coverage", () => {
  it("multiplies coverage while keeping the flat colours", () => {
    const flat = rgba([200, 100, 50, 255], [200, 100, 50, 255], [200, 100, 50, 200]);
    const mask = rgba([255, 255, 255, 255], [255, 255, 255, 0], [255, 255, 255, 128]);

    const masked = maskMultiply(flat, mask);

    expect([...masked.slice(0, 4)]).toEqual([200, 100, 50, 255]);
    expect([...masked.slice(4, 8)]).toEqual([200, 100, 50, 0]);
    expect(masked[11]).toBe(100);
  });

  it("also accepts a one-byte-per-pixel coverage plane", () => {
    const flat = rgba([10, 20, 30, 255], [10, 20, 30, 255]);
    const masked = maskMultiply(flat, new Uint8ClampedArray([255, 0]));
    expect(alphaChannel(masked)).toEqual([255, 0]);
  });

  it("rejects a mask that is neither RGBA nor a coverage plane", () => {
    expect(() => maskMultiply(rgba([0, 0, 0, 255]), new Uint8ClampedArray(3)))
      .toThrow(/맞지 않습니다/u);
  });

  it("alphaOnly turns a render into a white silhouette", () => {
    const masked = alphaOnly(rgba([12, 34, 56, 200], [12, 34, 56, 0]));
    expect([...masked]).toEqual([255, 255, 255, 200, 255, 255, 255, 0]);
  });

  it("nearBlackAlpha keeps outline pixels and drops lit ones", () => {
    const flat = rgba([8, 8, 8, 255], [220, 210, 200, 255], [8, 8, 8, 0]);
    const outline = nearBlackAlpha(flat, 48);
    expect(alphaChannel(outline)).toEqual([255, 0, 0]);
    expect([...outline.slice(0, 3)]).toEqual([8, 8, 8]);
  });

  it("unionAlpha folds outline coverage into the ink pass without recolouring it", () => {
    const ink = rgba([27, 23, 20, 0], [27, 23, 20, 255]);
    const outline = rgba([8, 8, 8, 180], [8, 8, 8, 10]);

    const merged = unionAlpha(ink, outline);

    expect(alphaChannel(merged)).toEqual([180, 255]);
    expect([...merged.slice(0, 3)]).toEqual([27, 23, 20]);
  });
});

describe("character shaper image math — emptiness", () => {
  it("detects a fully transparent pass", () => {
    expect(isEmptyPass(new Uint8ClampedArray(16))).toBe(true);
    expect(isEmptyPass(rgba([0, 0, 0, 0], [0, 0, 0, 1]))).toBe(false);
    expect(isEmptyPass(new Uint8ClampedArray(0))).toBe(true);
  });
});
