import { describe, expect, it } from "vitest";

import {
  applyStudioVrmTexturePaintOp,
  applyStudioVrmTexturePaintOps,
  blendStudioVrmTexel,
  clipStudioVrmTextureRect,
  createStudioVrmTextureBuffer,
  parseStudioVrmTextureColor,
  readStudioVrmTextureRegion,
  studioVrmDabCoverage,
  studioVrmTexturePaintOpRects,
  studioVrmTexturePaintOpsBounds,
  unionStudioVrmTextureRect,
  writeStudioVrmTextureRegion,
  type StudioVrmTexturePaintOp,
} from "./studio-vrm-texture-paint-ops";

import type { StudioVrmTextureSize } from "./studio-vrm-texture-uv";

const SIZE: StudioVrmTextureSize = { width: 16, height: 16 };

function buffer(size: StudioVrmTextureSize = SIZE): Uint8ClampedArray {
  const created = createStudioVrmTextureBuffer(size);
  if (!created) throw new Error("buffer");
  return created;
}

function fill(target: Uint8ClampedArray, r: number, g: number, b: number, a: number): void {
  for (let index = 0; index < target.length; index += 4) {
    target[index] = r;
    target[index + 1] = g;
    target[index + 2] = b;
    target[index + 3] = a;
  }
}

function texel(
  target: Uint8ClampedArray,
  size: StudioVrmTextureSize,
  x: number,
  y: number,
): [number, number, number, number] {
  const offset = (y * size.width + x) * 4;
  return [target[offset]!, target[offset + 1]!, target[offset + 2]!, target[offset + 3]!];
}

const DAB: StudioVrmTexturePaintOp = {
  x: 8,
  y: 8,
  radius: 3,
  hardness: 1,
  color: "#ff0000",
  opacity: 1,
  blend: "normal",
};

describe("studio-vrm-texture-paint-ops colour + coverage", () => {
  it("only accepts #rrggbb", () => {
    expect(parseStudioVrmTextureColor("#3366CC")).toEqual({ r: 0x33, g: 0x66, b: 0xcc, a: 255 });
    expect(parseStudioVrmTextureColor("#fff")).toBeNull();
    expect(parseStudioVrmTextureColor("red")).toBeNull();
    expect(parseStudioVrmTextureColor(null)).toBeNull();
  });

  it("falls to zero at the dab edge and stays monotone", () => {
    expect(studioVrmDabCoverage(0, 10, 1)).toBe(1);
    expect(studioVrmDabCoverage(10, 10, 1)).toBe(0);
    expect(studioVrmDabCoverage(11, 10, 1)).toBe(0);
    expect(studioVrmDabCoverage(5, 0, 1)).toBe(0);

    let previous = 1;
    for (let step = 0; step <= 20; step += 1) {
      const coverage = studioVrmDabCoverage((step / 20) * 10, 10, 0.4);
      expect(coverage).toBeLessThanOrEqual(previous + 1e-12);
      previous = coverage;
    }
  });

  it("makes harder brushes cover more at the same distance", () => {
    const soft = studioVrmDabCoverage(6, 10, 0.1);
    const hard = studioVrmDabCoverage(6, 10, 0.9);
    expect(hard).toBeGreaterThan(soft);
    expect(hard).toBeCloseTo(1, 6);
  });
});

describe("studio-vrm-texture-paint-ops blending", () => {
  const opaqueWhite = { r: 1, g: 1, b: 1, a: 1 };
  const opaqueGrey = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

  it("normal replaces at full alpha and interpolates at partial alpha", () => {
    expect(blendStudioVrmTexel("normal", { r: 0, g: 0, b: 0, a: 1 }, opaqueWhite)).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    });
    const half = blendStudioVrmTexel("normal", { r: 0, g: 0, b: 0, a: 0.5 }, opaqueWhite);
    expect(half.r).toBeCloseTo(0.5, 12);
    expect(half.a).toBe(1);
  });

  it("multiply darkens, screen brightens, overlay pivots at the mid tone", () => {
    expect(blendStudioVrmTexel("multiply", opaqueGrey, opaqueGrey).r).toBeCloseTo(0.25, 12);
    expect(blendStudioVrmTexel("screen", opaqueGrey, opaqueGrey).r).toBeCloseTo(0.75, 12);
    // overlay: dst<=0.5 → 2*src*dst, dst>0.5 → 1-2*(1-src)*(1-dst)
    expect(blendStudioVrmTexel("overlay", opaqueGrey, { r: 0.25, g: 0, b: 0, a: 1 }).r).toBeCloseTo(
      0.25,
      12,
    );
    expect(blendStudioVrmTexel("overlay", opaqueGrey, { r: 0.75, g: 0, b: 0, a: 1 }).r).toBeCloseTo(
      0.75,
      12,
    );
  });

  it("behaves like normal over a fully transparent destination for every mode", () => {
    const empty = { r: 0, g: 0, b: 0, a: 0 };
    const source = { r: 0.2, g: 0.4, b: 0.6, a: 0.5 };
    for (const mode of ["normal", "multiply", "screen", "overlay"] as const) {
      const result = blendStudioVrmTexel(mode, source, empty);
      expect(result.r).toBeCloseTo(0.2, 12);
      expect(result.g).toBeCloseTo(0.4, 12);
      expect(result.b).toBeCloseTo(0.6, 12);
      expect(result.a).toBeCloseTo(0.5, 12);
    }
  });

  it("erase removes destination alpha without touching its colour", () => {
    const result = blendStudioVrmTexel("erase", { r: 1, g: 1, b: 1, a: 0.25 }, opaqueGrey);
    expect(result.a).toBeCloseTo(0.75, 12);
    expect(result.r).toBeCloseTo(0.5, 12);
    expect(blendStudioVrmTexel("erase", { r: 0, g: 0, b: 0, a: 1 }, opaqueGrey)).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });
});

describe("studio-vrm-texture-paint-ops rects", () => {
  it("clips and unions integer rects", () => {
    expect(clipStudioVrmTextureRect({ x: -4, y: -4, width: 8, height: 8 }, SIZE)).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    });
    expect(clipStudioVrmTextureRect({ x: 100, y: 0, width: 4, height: 4 }, SIZE)).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(
      unionStudioVrmTextureRect(
        { x: 1, y: 1, width: 2, height: 2 },
        { x: 6, y: 5, width: 1, height: 1 },
      ),
    ).toEqual({ x: 1, y: 1, width: 6, height: 5 });
  });

  it("reports one clipped rect for clamp and wrapped pieces for repeat", () => {
    const edge: StudioVrmTexturePaintOp = { ...DAB, x: 0.5, y: 8 };
    const clamped = studioVrmTexturePaintOpRects(edge, SIZE, { wrap: "clamp" });
    expect(clamped).toHaveLength(1);
    expect(clamped[0]!.x).toBe(0);

    const repeated = studioVrmTexturePaintOpRects(edge, SIZE, { wrap: "repeat" });
    expect(repeated.length).toBeGreaterThan(1);
    const columns = new Set(repeated.map((rect) => rect.x));
    expect(columns.has(0)).toBe(true);
    // 왼쪽으로 삐져나간 부분은 오른쪽 끝으로 감긴다.
    expect(repeated.some((rect) => rect.x + rect.width === SIZE.width)).toBe(true);
  });

  it("preserves independent sampler modes for U and V, including mirrored repeat", () => {
    const corner: StudioVrmTexturePaintOp = { ...DAB, x: 0.5, y: 0.5 };
    const mixed = studioVrmTexturePaintOpRects(corner, SIZE, {
      wrapU: "repeat",
      wrapV: "clamp",
    });
    expect(mixed.some((rect) => rect.x + rect.width === SIZE.width)).toBe(true);
    expect(mixed.every((rect) => rect.y === 0)).toBe(true);

    const mirrored = studioVrmTexturePaintOpRects(corner, SIZE, {
      wrapU: "mirror",
      wrapV: "mirror",
    });
    expect(mirrored.every((rect) => rect.x < SIZE.width / 2)).toBe(true);
    expect(mirrored.every((rect) => rect.y < SIZE.height / 2)).toBe(true);
  });

  it("covers every texel the dab actually touches", () => {
    const target = buffer();
    applyStudioVrmTexturePaintOp(target, SIZE, DAB);
    const rects = studioVrmTexturePaintOpRects(DAB, SIZE);
    for (let y = 0; y < SIZE.height; y += 1) {
      for (let x = 0; x < SIZE.width; x += 1) {
        if (texel(target, SIZE, x, y)[3] === 0) continue;
        const covered = rects.some(
          (rect) =>
            x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height,
        );
        expect(covered).toBe(true);
      }
    }
  });
});

describe("studio-vrm-texture-paint-ops application", () => {
  it("paints an antialiased disc centred on the op", () => {
    const target = buffer();
    const touched = applyStudioVrmTexturePaintOp(target, SIZE, DAB);
    expect(touched).toBeGreaterThan(0);
    expect(texel(target, SIZE, 8, 8)).toEqual([255, 0, 0, 255]);
    // 반지름 밖은 손대지 않는다.
    expect(texel(target, SIZE, 12, 8)).toEqual([0, 0, 0, 0]);
    expect(texel(target, SIZE, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("multiply over an opaque base darkens without changing alpha", () => {
    const target = buffer();
    fill(target, 255, 255, 255, 255);
    applyStudioVrmTexturePaintOp(target, SIZE, { ...DAB, color: "#808080", blend: "multiply" });
    const centre = texel(target, SIZE, 8, 8);
    expect(centre[0]).toBe(128);
    expect(centre[3]).toBe(255);
  });

  it("erase clears alpha", () => {
    const target = buffer();
    fill(target, 10, 20, 30, 255);
    applyStudioVrmTexturePaintOp(target, SIZE, { ...DAB, blend: "erase" });
    expect(texel(target, SIZE, 8, 8)[3]).toBe(0);
    expect(texel(target, SIZE, 0, 0)[3]).toBe(255);
  });

  it("restores an opaque painted texel partially and fully from a safe original buffer", () => {
    const originalPixels = buffer();
    fill(originalPixels, 20, 100, 180, 255);
    const target = originalPixels.slice();

    applyStudioVrmTexturePaintOp(target, SIZE, DAB);
    expect(texel(target, SIZE, 8, 8)).toEqual([255, 0, 0, 255]);

    applyStudioVrmTexturePaintOp(
      target,
      SIZE,
      { ...DAB, opacity: 0.25, blend: "erase" },
      { originalPixels },
    );
    expect(texel(target, SIZE, 8, 8)).toEqual([196, 25, 45, 255]);

    applyStudioVrmTexturePaintOp(
      target,
      SIZE,
      { ...DAB, blend: "erase" },
      { originalPixels },
    );
    expect(texel(target, SIZE, 8, 8)).toEqual([20, 100, 180, 255]);
    expect(texel(target, SIZE, 0, 0)).toEqual([20, 100, 180, 255]);
  });

  it("falls back to destination-out when the optional original buffer is malformed or aliased", () => {
    const malformedTarget = buffer();
    fill(malformedTarget, 10, 20, 30, 255);
    applyStudioVrmTexturePaintOp(
      malformedTarget,
      SIZE,
      { ...DAB, blend: "erase" },
      { originalPixels: new Uint8ClampedArray(4) },
    );
    expect(texel(malformedTarget, SIZE, 8, 8)).toEqual([0, 0, 0, 0]);

    const aliasedTarget = buffer();
    fill(aliasedTarget, 10, 20, 30, 255);
    applyStudioVrmTexturePaintOp(
      aliasedTarget,
      SIZE,
      { ...DAB, blend: "erase" },
      { originalPixels: aliasedTarget },
    );
    expect(texel(aliasedTarget, SIZE, 8, 8)).toEqual([0, 0, 0, 0]);
  });

  it("clamps at the border but wraps with repeat", () => {
    const clampTarget = buffer();
    applyStudioVrmTexturePaintOp(clampTarget, SIZE, { ...DAB, x: 0.5 }, { wrap: "clamp" });
    expect(texel(clampTarget, SIZE, 0, 8)[3]).toBeGreaterThan(0);
    expect(texel(clampTarget, SIZE, SIZE.width - 1, 8)[3]).toBe(0);

    const repeatTarget = buffer();
    applyStudioVrmTexturePaintOp(repeatTarget, SIZE, { ...DAB, x: 0.5 }, { wrap: "repeat" });
    expect(texel(repeatTarget, SIZE, 0, 8)[3]).toBeGreaterThan(0);
    expect(texel(repeatTarget, SIZE, SIZE.width - 1, 8)[3]).toBeGreaterThan(0);
  });

  it("applies repeat, clamp, and mirror independently on each axis", () => {
    const mixed = buffer();
    applyStudioVrmTexturePaintOp(
      mixed,
      SIZE,
      { ...DAB, x: 0.5, y: 0.5 },
      { wrapU: "repeat", wrapV: "clamp" },
    );
    expect(texel(mixed, SIZE, SIZE.width - 1, 0)[3]).toBeGreaterThan(0);
    expect(texel(mixed, SIZE, 0, SIZE.height - 1)[3]).toBe(0);

    const mirrored = buffer();
    applyStudioVrmTexturePaintOp(
      mirrored,
      SIZE,
      { ...DAB, x: 0.5, y: 8 },
      { wrapU: "mirror", wrapV: "clamp" },
    );
    expect(texel(mirrored, SIZE, 0, 8)[3]).toBeGreaterThan(0);
    expect(texel(mirrored, SIZE, SIZE.width - 1, 8)[3]).toBe(0);
  });

  it("restores from the mapped original texel with independent U and V wrapping", () => {
    const originalPixels = buffer();
    fill(originalPixels, 20, 100, 180, 255);

    const repeatU = buffer();
    fill(repeatU, 255, 0, 0, 255);
    applyStudioVrmTexturePaintOp(
      repeatU,
      SIZE,
      { ...DAB, x: 0.5, y: 1.5, radius: 2, blend: "erase" },
      { wrapU: "repeat", wrapV: "clamp", originalPixels },
    );
    expect(texel(repeatU, SIZE, SIZE.width - 1, 1)).toEqual([20, 100, 180, 255]);
    expect(texel(repeatU, SIZE, 0, SIZE.height - 1)).toEqual([255, 0, 0, 255]);

    const repeatV = buffer();
    fill(repeatV, 255, 0, 0, 255);
    applyStudioVrmTexturePaintOp(
      repeatV,
      SIZE,
      { ...DAB, x: 1.5, y: 0.5, radius: 2, blend: "erase" },
      { wrapU: "clamp", wrapV: "repeat", originalPixels },
    );
    expect(texel(repeatV, SIZE, 1, SIZE.height - 1)).toEqual([20, 100, 180, 255]);
    expect(texel(repeatV, SIZE, SIZE.width - 1, 0)).toEqual([255, 0, 0, 255]);
  });

  it("rejects malformed ops and buffers instead of corrupting pixels", () => {
    const target = buffer();
    expect(applyStudioVrmTexturePaintOp(target, SIZE, { ...DAB, radius: 0 })).toBe(0);
    expect(applyStudioVrmTexturePaintOp(target, SIZE, { ...DAB, x: Number.NaN })).toBe(0);
    expect(applyStudioVrmTexturePaintOp(target, SIZE, { ...DAB, color: "rgb(1,2,3)" })).toBe(0);
    expect(applyStudioVrmTexturePaintOp(target, SIZE, { ...DAB, opacity: 0 })).toBe(0);
    expect(applyStudioVrmTexturePaintOp(new Uint8ClampedArray(8), SIZE, DAB)).toBe(0);
    expect(target.every((value) => value === 0)).toBe(true);
  });

  it("accumulates ops and reports their union bounds", () => {
    const target = buffer();
    const ops: StudioVrmTexturePaintOp[] = [
      { ...DAB, x: 3, y: 3, radius: 1 },
      { ...DAB, x: 12, y: 11, radius: 1 },
    ];
    expect(applyStudioVrmTexturePaintOps(target, SIZE, ops)).toBeGreaterThan(0);
    const bounds = studioVrmTexturePaintOpsBounds(ops, SIZE);
    expect(bounds.x).toBeLessThanOrEqual(2);
    expect(bounds.y).toBeLessThanOrEqual(2);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(14);
    expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(13);
  });
});

describe("studio-vrm-texture-paint-ops regions", () => {
  it("round-trips a region read/write exactly", () => {
    const target = buffer();
    applyStudioVrmTexturePaintOp(target, SIZE, DAB);
    const rect = { x: 4, y: 4, width: 8, height: 8 };
    const region = readStudioVrmTextureRegion(target, SIZE, rect);
    expect(region).not.toBeNull();

    const restored = buffer();
    expect(writeStudioVrmTextureRegion(restored, SIZE, rect, region!)).toBe(true);
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        expect(texel(restored, SIZE, x, y)).toEqual(texel(target, SIZE, x, y));
      }
    }
  });

  it("refuses out-of-bounds or mis-sized regions", () => {
    const target = buffer();
    expect(readStudioVrmTextureRegion(target, SIZE, { x: 12, y: 0, width: 8, height: 2 })).toBeNull();
    expect(
      writeStudioVrmTextureRegion(target, SIZE, { x: 0, y: 0, width: 2, height: 2 }, new Uint8ClampedArray(4)),
    ).toBe(false);
  });
});
