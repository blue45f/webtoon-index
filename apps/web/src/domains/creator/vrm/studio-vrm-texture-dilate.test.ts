import { describe, expect, it } from "vitest";

import {
  dilateStudioVrmTexture,
  dilateStudioVrmTextureRegion,
} from "./studio-vrm-texture-dilate";
import { createStudioVrmTextureBuffer } from "./studio-vrm-texture-paint-ops";

import type { StudioVrmTextureSize } from "./studio-vrm-texture-uv";

const SIZE: StudioVrmTextureSize = { width: 16, height: 16 };

function buffer(size: StudioVrmTextureSize = SIZE): Uint8ClampedArray {
  const created = createStudioVrmTextureBuffer(size);
  if (!created) throw new Error("buffer");
  return created;
}

function set(
  target: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  x: number,
  y: number,
  rgba: readonly [number, number, number, number],
): void {
  const offset = (y * size.width + x) * 4;
  target[offset] = rgba[0];
  target[offset + 1] = rgba[1];
  target[offset + 2] = rgba[2];
  target[offset + 3] = rgba[3];
}

function get(
  target: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  x: number,
  y: number,
): [number, number, number, number] {
  const offset = (y * size.width + x) * 4;
  return [target[offset]!, target[offset + 1]!, target[offset + 2]!, target[offset + 3]!];
}

describe("studio-vrm-texture-dilate ring growth", () => {
  it("grows exactly one texel ring per pass", () => {
    const source = buffer();
    set(source, SIZE, 8, 8, [200, 100, 50, 255]);

    for (const passes of [1, 2, 3]) {
      const dilated = dilateStudioVrmTexture(source, SIZE, { passes });
      expect(dilated).not.toBeNull();
      // 체비쇼프 거리 <= passes 는 채워지고, passes + 1 은 그대로 비어 있다.
      expect(get(dilated!, SIZE, 8 + passes, 8)[3]).toBe(255);
      expect(get(dilated!, SIZE, 8 + passes, 8 + passes)[3]).toBe(255);
      expect(get(dilated!, SIZE, 8 + passes + 1, 8)[3]).toBe(0);
      expect(get(dilated!, SIZE, 8 + passes + 1, 8 + passes + 1)[3]).toBe(0);
    }
  });

  it("extends the edge colour and opacity instead of fading them", () => {
    const source = buffer();
    set(source, SIZE, 4, 4, [200, 100, 50, 255]);
    const dilated = dilateStudioVrmTexture(source, SIZE, { passes: 3 });
    expect(get(dilated!, SIZE, 7, 4)).toEqual([200, 100, 50, 255]);
    expect(get(dilated!, SIZE, 4, 7)).toEqual([200, 100, 50, 255]);
  });

  it("never touches already-painted texels", () => {
    const source = buffer();
    // 두 색 아일랜드가 붙어 있어도 서로를 덮어쓰지 않는다.
    set(source, SIZE, 5, 5, [255, 0, 0, 255]);
    set(source, SIZE, 6, 5, [0, 0, 255, 120]);
    const dilated = dilateStudioVrmTexture(source, SIZE, { passes: 2 });
    expect(get(dilated!, SIZE, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(get(dilated!, SIZE, 6, 5)).toEqual([0, 0, 255, 120]);
  });

  it("leaves the source buffer untouched", () => {
    const source = buffer();
    set(source, SIZE, 8, 8, [10, 20, 30, 255]);
    const snapshot = source.slice();
    dilateStudioVrmTexture(source, SIZE, { passes: 4 });
    expect(source).toEqual(snapshot);
  });

  it("stops early once nothing else can be filled", () => {
    const source = buffer({ width: 4, height: 4 });
    set(source, { width: 4, height: 4 }, 1, 1, [1, 2, 3, 255]);
    const result = dilateStudioVrmTextureRegion(source, { width: 4, height: 4 }, { passes: 32 });
    expect(result?.passes).toBeLessThan(32);
    expect(result?.filledTexels).toBe(15);
  });
});

describe("studio-vrm-texture-dilate seam gutter", () => {
  it("pads a UV island with an N texel gutter on every side", () => {
    const source = buffer();
    for (let y = 6; y < 10; y += 1) {
      for (let x = 6; x < 10; x += 1) set(source, SIZE, x, y, [0, 128, 255, 255]);
    }
    const passes = 2;
    const dilated = dilateStudioVrmTexture(source, SIZE, { passes });
    expect(dilated).not.toBeNull();

    for (let y = 6 - passes; y < 10 + passes; y += 1) {
      for (let x = 6 - passes; x < 10 + passes; x += 1) {
        expect(get(dilated!, SIZE, x, y)).toEqual([0, 128, 255, 255]);
      }
    }
    // 거터 바로 밖은 여전히 비어 있다(밉 레벨 0 에서는 안 보이는 영역).
    expect(get(dilated!, SIZE, 6 - passes - 1, 8)[3]).toBe(0);
    expect(get(dilated!, SIZE, 10 + passes, 8)[3]).toBe(0);
  });
});

describe("studio-vrm-texture-dilate region + wrap", () => {
  it("only returns the expanded dirty rect", () => {
    const source = buffer();
    set(source, SIZE, 8, 8, [9, 9, 9, 255]);
    const result = dilateStudioVrmTextureRegion(source, SIZE, {
      passes: 2,
      rect: { x: 7, y: 7, width: 3, height: 3 },
    });
    expect(result?.rect).toEqual({ x: 5, y: 5, width: 7, height: 7 });
    expect(result?.data.length).toBe(7 * 7 * 4);
    expect(result?.filledTexels).toBeGreaterThan(0);
  });

  it("does not fill outside the requested region", () => {
    const source = buffer();
    set(source, SIZE, 8, 8, [9, 9, 9, 255]);
    // 대상 rect 를 dab 텍셀 하나로 제한하면 확장 rect(=3 텍셀 여유) 밖은 절대 채워지지 않는다.
    const result = dilateStudioVrmTextureRegion(source, SIZE, {
      passes: 1,
      rect: { x: 8, y: 8, width: 1, height: 1 },
    });
    expect(result?.rect).toEqual({ x: 7, y: 7, width: 3, height: 3 });
  });

  it("wraps across the border when the texture repeats", () => {
    const source = buffer();
    set(source, SIZE, 0, 8, [77, 88, 99, 255]);

    const clamped = dilateStudioVrmTexture(source, SIZE, { passes: 1 });
    expect(get(clamped!, SIZE, SIZE.width - 1, 8)[3]).toBe(0);

    const wrapped = dilateStudioVrmTexture(source, SIZE, { passes: 1, wrapEdges: true });
    expect(get(wrapped!, SIZE, SIZE.width - 1, 8)).toEqual([77, 88, 99, 255]);
  });

  it("guards bad input", () => {
    const source = buffer();
    expect(dilateStudioVrmTextureRegion(source, { width: 0, height: 0 })).toBeNull();
    expect(dilateStudioVrmTextureRegion(new Uint8ClampedArray(8), SIZE)).toBeNull();
    expect(
      dilateStudioVrmTextureRegion(source, SIZE, { rect: { x: 99, y: 99, width: 2, height: 2 } }),
    ).toBeNull();
    // passes 0 은 원본 영역 사본을 그대로 돌려준다.
    const untouched = dilateStudioVrmTextureRegion(source, SIZE, { passes: 0 });
    expect(untouched?.filledTexels).toBe(0);
    expect(untouched?.data.length).toBe(SIZE.width * SIZE.height * 4);
  });
});
