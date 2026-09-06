import { describe, expect, it } from "vitest";

import {
  StudioBg3dBabylonNormalPackingError,
  packStudioBg3dBabylonNormals,
} from "./studio-bg3d-babylon-normal-packing";

function decode(packed: Uint8Array, pixel: number): readonly [number, number, number] {
  let x = (packed[pixel * 2]! / 255) * 2 - 1;
  let y = (packed[pixel * 2 + 1]! / 255) * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const previousX = x;
    x = (1 - Math.abs(y)) * (previousX < 0 ? -1 : 1);
    y = (1 - Math.abs(previousX)) * (y < 0 ? -1 : 1);
  }
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

describe("studio-bg3d-babylon-normal-packing", () => {
  it("packs unsigned RGBA view normals into the canonical octahedral profile", () => {
    const packed = packStudioBg3dBabylonNormals({
      data: new Float32Array([
        0.5, 0.5, 1, 1,
        1, 0.5, 0.5, 1,
        0.5, 1, 0.5, 1,
      ]),
      width: 3,
      height: 1,
      unsigned: true,
      flipY: false,
      swapRedBlue: false,
    });

    expect(decode(packed, 0)).toEqual(expect.arrayContaining([
      expect.closeTo(0, 1),
      expect.closeTo(0, 1),
      expect.closeTo(1, 1),
    ]));
    expect(decode(packed, 1)).toEqual(expect.arrayContaining([
      expect.closeTo(1, 1),
      expect.closeTo(0, 1),
      expect.closeTo(0, 1),
    ]));
    expect(decode(packed, 2)).toEqual(expect.arrayContaining([
      expect.closeTo(0, 1),
      expect.closeTo(1, 1),
      expect.closeTo(0, 1),
    ]));
  });

  it("normalizes byte readback, BGRA channel order, and bottom-up rows", () => {
    const packed = packStudioBg3dBabylonNormals({
      data: new Uint8Array([
        255, 128, 128, 255,
        128, 255, 128, 255,
      ]),
      width: 1,
      height: 2,
      unsigned: true,
      flipY: true,
      swapRedBlue: true,
    });

    const top = decode(packed, 0);
    const bottom = decode(packed, 1);
    expect(top[1]).toBeGreaterThan(0.99);
    expect(bottom[2]).toBeGreaterThan(0.99);
  });

  it("uses deterministic +Z only for the exact clear-depth background", () => {
    const packed = packStudioBg3dBabylonNormals({
      data: new Float32Array([
        1, 0, 0, 1,
        0, 1, 0, 1,
        -1, 0, 0, 1,
      ]),
      width: 3,
      height: 1,
      unsigned: false,
      flipY: false,
      swapRedBlue: false,
      depth: new Float32Array([1, 0.25, 0.9999]),
    });

    expect(decode(packed, 0)[2]).toBeGreaterThan(0.99);
    expect(decode(packed, 1)[1]).toBeGreaterThan(0.99);
    expect(decode(packed, 2)[0]).toBeLessThan(-0.99);
  });

  it("rejects malformed lengths, non-finite components, and out-of-range depth", () => {
    const base = {
      width: 1,
      height: 1,
      unsigned: true,
      flipY: false,
      swapRedBlue: false,
    } as const;

    for (const input of [
      { ...base, data: new Uint8Array(3) },
      { ...base, data: new Float32Array([Number.NaN, 0, 0, 1]) },
      {
        ...base,
        data: new Uint8Array([128, 128, 255, 255]),
        depth: new Float32Array([1.2]),
      },
      {
        ...base,
        data: new Uint8Array([128, 128, 255, 255]),
        unsigned: false,
      },
    ]) {
      expect(() => packStudioBg3dBabylonNormals(input)).toThrowError(
        StudioBg3dBabylonNormalPackingError,
      );
    }
  });

  it("rejects unsafe dimensions before allocating output", () => {
    expect(() => packStudioBg3dBabylonNormals({
      data: new Uint8Array(),
      width: 16_384,
      height: 16_384,
      unsigned: true,
      flipY: false,
      swapRedBlue: false,
    })).toThrowError(
      expect.objectContaining({ code: "invalid-dimensions" }),
    );
  });
});
