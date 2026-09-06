import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEAMLESS_FEATHER_PX,
  SEAMLESS_FEATHER_RANGE,
  SEAMLESS_PREVIEW_REPEAT,
  buildSeamlessTilePreview,
  clampSeamlessFeather,
  clampSeamlessRepeat,
  formatSeamScore,
  makeTileSeamless,
  seamVisibilityScore,
  type SeamlessTileImage,
} from "./studio-seamless-tile";

// 합성 타일 팩토리 — 픽셀 함수로 RGBA 버퍼를 결정적으로 채운다.
function makeTile(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number, number]
): SeamlessTileImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { width, height, data };
}

// 좌→우로 밝아지는 8×8 가로 그라데이션 — 좌우 wrap 이음새가 큰 대표 합성 입력.
const xGradient = (): SeamlessTileImage => makeTile(8, 8, (x) => [x * 30, x * 30, x * 30, 255]);

// 두 축 모두 이음새가 있는 8×8 대각 그라데이션.
const xyGradient = (): SeamlessTileImage => makeTile(8, 8, (x, y) => [x * 20 + y * 10, x * 20, y * 10, 255]);

const pixelAt = (image: SeamlessTileImage, x: number, y: number): number[] =>
  Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4));

describe("buildSeamlessTilePreview", () => {
  it("maps every preview pixel to in(x mod w, y mod h) with cols×rows dimensions", () => {
    const tile = makeTile(2, 2, (x, y) => {
      if (x === 0 && y === 0) return [10, 20, 30, 255];
      if (x === 1 && y === 0) return [40, 50, 60, 255];
      if (x === 0 && y === 1) return [70, 80, 90, 255];
      return [100, 110, 120, 200];
    });

    const preview = buildSeamlessTilePreview(tile, { cols: 3, rows: 2 });

    expect(preview.width).toBe(6);
    expect(preview.height).toBe(4);
    expect(preview.data.length).toBe(6 * 4 * 4);
    for (let y = 0; y < preview.height; y += 1) {
      for (let x = 0; x < preview.width; x += 1) {
        expect(pixelAt(preview, x, y)).toEqual(pixelAt(tile, x % 2, y % 2));
      }
    }
  });

  it("clamps repeat counts to integers in [1, 8] and defaults the panel grid to 3×3", () => {
    const tile = makeTile(2, 2, () => [1, 2, 3, 255]);

    expect(buildSeamlessTilePreview(tile, { cols: 0, rows: -4 }).width).toBe(2);
    expect(buildSeamlessTilePreview(tile, { cols: 12.9, rows: 99 }).width).toBe(16);
    expect(buildSeamlessTilePreview(tile, { cols: Number.NaN, rows: 2.7 }).height).toBe(4);
    expect(clampSeamlessRepeat(2.7)).toBe(2);
    expect(SEAMLESS_PREVIEW_REPEAT).toBe(3);
  });
});

describe("makeTileSeamless", () => {
  it("reduces the seam visibility score on synthetic gradient tiles", () => {
    const horizontal = xGradient();
    // 좌우 wrap 픽셀쌍 차이만 존재: (|210−0|×3)/(4×255) 평균을 가로 8쌍 + 세로 8쌍으로 나눈 값.
    const before = seamVisibilityScore(horizontal);
    expect(before).toBeCloseTo(630 / 2040, 5);

    // feather 0 = 순수 반 칸 오프셋 — 가장자리가 원본의 이웃 열이 되어 한 계단(30)만 남는다.
    const offsetOnly = seamVisibilityScore(makeTileSeamless(horizontal, { featherPx: 0 }));
    expect(offsetOnly).toBeCloseTo(90 / 2040, 5);
    expect(offsetOnly).toBeLessThan(before * 0.5);

    const feathered = seamVisibilityScore(makeTileSeamless(horizontal, { featherPx: 3 }));
    expect(feathered).toBeLessThan(before * 0.5);

    const diagonal = xyGradient();
    const diagonalBefore = seamVisibilityScore(diagonal);
    const diagonalAfter = seamVisibilityScore(makeTileSeamless(diagonal, { featherPx: 2 }));
    expect(diagonalBefore).toBeGreaterThan(0.1);
    expect(diagonalAfter).toBeLessThan(diagonalBefore * 0.5);
  });

  it("is deterministic and never mutates its input", () => {
    const tile = xyGradient();
    const inputCopy = Uint8ClampedArray.from(tile.data);

    const first = makeTileSeamless(tile, { featherPx: 3 });
    const second = makeTileSeamless(tile, { featherPx: 3 });

    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    expect(Array.from(tile.data)).toEqual(Array.from(inputCopy));
    expect(first.data).not.toBe(tile.data);
  });

  it("cross-fades the seam interior once feather is positive", () => {
    const tile = xGradient();
    const offsetOnly = makeTileSeamless(tile, { featherPx: 0 });
    const feathered = makeTileSeamless(tile, { featherPx: 3 });

    expect(Array.from(feathered.data)).not.toEqual(Array.from(offsetOnly.data));
    // 이음새 밴드 밖(왼쪽 끝 열)은 두 결과가 동일 — 블렌드가 가장자리를 침범하지 않는다.
    for (let y = 0; y < 8; y += 1) {
      expect(pixelAt(feathered, 0, y)).toEqual(pixelAt(offsetOnly, 0, y));
      expect(pixelAt(feathered, 7, y)).toEqual(pixelAt(offsetOnly, 7, y));
    }
  });

  it("clamps an oversized feather to the tile bound so seams stay hidden", () => {
    const tile = xyGradient();
    // 8×8 타일의 축 상한은 ⌊8/2⌋−1 = 3 — 999는 3과 바이트 단위로 동일해야 한다.
    const clamped = makeTileSeamless(tile, { featherPx: 999 });
    const bounded = makeTileSeamless(tile, { featherPx: 3 });

    expect(Array.from(clamped.data)).toEqual(Array.from(bounded.data));
    expect(seamVisibilityScore(clamped)).toBeLessThan(seamVisibilityScore(tile) * 0.5);

    // 음수 feather는 0(순수 오프셋)으로.
    expect(Array.from(makeTileSeamless(tile, { featherPx: -5 }).data)).toEqual(
      Array.from(makeTileSeamless(tile, { featherPx: 0 }).data)
    );
  });

  it("rejects malformed tile buffers", () => {
    const bad: SeamlessTileImage = { width: 2, height: 2, data: new Uint8ClampedArray(3) };
    expect(() => makeTileSeamless(bad, { featherPx: 2 })).toThrow(/픽셀 버퍼/);
    expect(() => seamVisibilityScore(bad)).toThrow(/픽셀 버퍼/);
    expect(() => buildSeamlessTilePreview(bad, { cols: 2, rows: 2 })).toThrow(/픽셀 버퍼/);

    const empty: SeamlessTileImage = { width: 0, height: 1, data: new Uint8ClampedArray(0) };
    expect(() => makeTileSeamless(empty, { featherPx: 2 })).toThrow(/타일 크기/);
  });
});

describe("clampSeamlessFeather", () => {
  it("clamps to the slider range, tile bound, and defaults non-finite input", () => {
    expect(clampSeamlessFeather(-5)).toBe(SEAMLESS_FEATHER_RANGE.min);
    expect(clampSeamlessFeather(20.4)).toBe(SEAMLESS_FEATHER_RANGE.max);
    expect(clampSeamlessFeather(4.4)).toBe(4);
    expect(clampSeamlessFeather(Number.NaN)).toBe(DEFAULT_SEAMLESS_FEATHER_PX);
    expect(clampSeamlessFeather(16, { width: 8, height: 8 })).toBe(3);
    expect(clampSeamlessFeather(5, { width: 2, height: 2 })).toBe(0);
    expect(clampSeamlessFeather(5, { width: 40, height: 12 })).toBe(5);
  });
});

describe("seamVisibilityScore / formatSeamScore", () => {
  it("scores a wrap-continuous tile as 0 and a hard split high", () => {
    const flat = makeTile(4, 4, () => [128, 64, 32, 255]);
    expect(seamVisibilityScore(flat)).toBe(0);

    // 왼쪽 절반 0, 오른쪽 절반 255 — 좌우 wrap 픽셀쌍이 최대로 어긋난다(알파는 동일).
    const split = makeTile(4, 4, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect(seamVisibilityScore(split)).toBeCloseTo((4 * (765 / 1020)) / 8, 5);
  });

  it("formats scores as clamped one-decimal percentages", () => {
    expect(formatSeamScore(0)).toBe("0.0%");
    expect(formatSeamScore(630 / 2040)).toBe("30.9%");
    expect(formatSeamScore(2)).toBe("100.0%");
    expect(formatSeamScore(-1)).toBe("0.0%");
    expect(formatSeamScore(Number.NaN)).toBe("0.0%");
  });
});
