import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_TEXTURE_MAX_DIMENSION,
  computeStudioVrmBarycentric,
  estimateStudioVrmUvTexelDensity,
  isStudioVrmTextureSize,
  normalizeStudioVrmBarycentric,
  resolveStudioVrmTexelIndex,
  resolveStudioVrmTexelPoint,
  resolveStudioVrmTextureHit,
  resolveStudioVrmTriangleUv,
  wrapStudioVrmUv,
  type StudioVrmTriangleUv,
} from "./studio-vrm-texture-uv";

const SIZE = { width: 256, height: 128 } as const;

/** 좌상단(0,0) → 우상단(1,0) → 좌하단(0,1) 로 펼친 UV 삼각형. glTF 규약 그대로. */
const TRIANGLE: StudioVrmTriangleUv = {
  a: { u: 0, v: 0 },
  b: { u: 1, v: 0 },
  c: { u: 0, v: 1 },
};

describe("studio-vrm-texture-uv barycentric", () => {
  it("accepts both {a,b,c} and THREE.Vector3 {x,y,z} shapes", () => {
    expect(normalizeStudioVrmBarycentric({ a: 0.25, b: 0.25, c: 0.5 })).toEqual({
      a: 0.25,
      b: 0.25,
      c: 0.5,
    });
    expect(normalizeStudioVrmBarycentric({ x: 1, y: 0, z: 0 })).toEqual({ a: 1, b: 0, c: 0 });
  });

  it("renormalizes drifted weights and rejects degenerate input", () => {
    const normalized = normalizeStudioVrmBarycentric({ a: 2, b: 1, c: 1 });
    expect(normalized).toEqual({ a: 0.5, b: 0.25, c: 0.25 });
    expect(normalizeStudioVrmBarycentric({ a: 0, b: 0, c: 0 })).toBeNull();
    expect(normalizeStudioVrmBarycentric({ a: Number.NaN, b: 1, c: 0 })).toBeNull();
    expect(normalizeStudioVrmBarycentric(null)).toBeNull();
    expect(normalizeStudioVrmBarycentric([0.5, 0.5, 0])).toBeNull();
  });

  it("computes barycentric weights in three's (a,b,c) component order", () => {
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 1, y: 0, z: 0 };
    const c = { x: 0, y: 1, z: 0 };
    expect(computeStudioVrmBarycentric(b, a, b, c)).toEqual({ a: 0, b: 1, c: 0 });
    expect(computeStudioVrmBarycentric(c, a, b, c)).toEqual({ a: 0, b: 0, c: 1 });

    const centre = computeStudioVrmBarycentric({ x: 1 / 3, y: 1 / 3, z: 0 }, a, b, c);
    expect(centre?.a).toBeCloseTo(1 / 3, 12);
    expect(centre?.b).toBeCloseTo(1 / 3, 12);
    expect(centre?.c).toBeCloseTo(1 / 3, 12);

    // 퇴화(공선) 삼각형은 null.
    expect(computeStudioVrmBarycentric(a, a, a, a)).toBeNull();
  });

  it("interpolates triangle UVs with the resolved weights", () => {
    expect(resolveStudioVrmTriangleUv(TRIANGLE, { x: 0, y: 1, z: 0 })).toEqual({ u: 1, v: 0 });
    expect(resolveStudioVrmTriangleUv(TRIANGLE, { a: 0.5, b: 0.5, c: 0 })).toEqual({
      u: 0.5,
      v: 0,
    });
    expect(resolveStudioVrmTriangleUv(TRIANGLE, { a: 0, b: 0, c: 0 })).toBeNull();
  });
});

describe("studio-vrm-texture-uv wrapping", () => {
  it("clamps, repeats and mirrors like the matching three wrap modes", () => {
    expect(wrapStudioVrmUv(1.25, "clamp")).toBe(1);
    expect(wrapStudioVrmUv(-0.25, "clamp")).toBe(0);

    expect(wrapStudioVrmUv(1.25, "repeat")).toBeCloseTo(0.25, 12);
    expect(wrapStudioVrmUv(-0.25, "repeat")).toBeCloseTo(0.75, 12);
    expect(wrapStudioVrmUv(3, "repeat")).toBe(0);

    // 홀수 타일에서 반전.
    expect(wrapStudioVrmUv(0.25, "mirror")).toBeCloseTo(0.25, 12);
    expect(wrapStudioVrmUv(1.25, "mirror")).toBeCloseTo(0.75, 12);
    expect(wrapStudioVrmUv(2.25, "mirror")).toBeCloseTo(0.25, 12);
    expect(wrapStudioVrmUv(-0.25, "mirror")).toBeCloseTo(0.25, 12);
  });
});

describe("studio-vrm-texture-uv texel resolution", () => {
  it("maps glTF UV directly to canvas pixel space (V down, no flip)", () => {
    // v=0 은 이미지 맨 윗줄. flipY=false 인 glTF/VRM 텍스처의 규약.
    expect(resolveStudioVrmTexelIndex({ u: 0, v: 0 }, SIZE)).toEqual({ x: 0, y: 0, index: 0 });
    expect(resolveStudioVrmTexelIndex({ u: 0.5, v: 0.5 }, SIZE)).toEqual({
      x: 128,
      y: 64,
      index: 64 * 256 + 128,
    });
    // 마지막 텍셀 경계는 클램프된다.
    expect(resolveStudioVrmTexelIndex({ u: 1, v: 1 }, SIZE, { wrapU: "clamp", wrapV: "clamp" }))
      .toEqual({ x: 255, y: 127, index: 127 * 256 + 255 });
  });

  it("flips V only when explicitly asked (three CanvasTexture flipY=true 경로)", () => {
    expect(resolveStudioVrmTexelIndex({ u: 0, v: 0 }, SIZE, { flipV: true })).toEqual({
      x: 0,
      y: 127,
      index: 127 * 256,
    });
    expect(
      resolveStudioVrmTexelIndex({ u: 0, v: 1 }, SIZE, { flipV: true, wrapV: "clamp" }),
    ).toEqual({ x: 0, y: 0, index: 0 });
    // 텍셀 **중심**을 가리키는 UV 라면 flip 여부만 다를 때 정확히 상하 대칭이어야 한다
    // (경계에 정확히 걸친 좌표는 뒤집으면 반대편 텍셀로 떨어지는 게 샘플러의 정상 동작이다).
    const centreV = 32.5 / SIZE.height;
    const upright = resolveStudioVrmTexelIndex({ u: 0.3, v: centreV }, SIZE);
    const flipped = resolveStudioVrmTexelIndex({ u: 0.3, v: centreV }, SIZE, { flipV: true });
    expect(flipped?.y).toBe(SIZE.height - 1 - upright!.y);
    expect(flipped?.x).toBe(upright?.x);
  });

  it("wraps out-of-range UVs before converting to texels", () => {
    expect(resolveStudioVrmTexelIndex({ u: 1.25, v: 0 }, SIZE, { wrapU: "repeat" })?.x).toBe(64);
    expect(resolveStudioVrmTexelIndex({ u: -0.25, v: 0 }, SIZE, { wrapU: "repeat" })?.x).toBe(192);
    expect(resolveStudioVrmTexelIndex({ u: 1.25, v: 0 }, SIZE, { wrapU: "clamp" })?.x).toBe(255);
    // mirror: 1.25 는 홀수 타일이라 0.75 로 반전된다.
    expect(resolveStudioVrmTexelIndex({ u: 1.25, v: 0 }, SIZE, { wrapU: "mirror" })?.x).toBe(192);
  });

  it("returns continuous texel coordinates for stroke walking", () => {
    expect(resolveStudioVrmTexelPoint({ u: 0.5, v: 0.25 }, SIZE)).toEqual({ x: 128, y: 32 });
    expect(resolveStudioVrmTexelPoint({ u: Number.NaN, v: 0 }, SIZE)).toBeNull();
    expect(resolveStudioVrmTexelPoint({ u: 0, v: 0 }, { width: 0, height: 8 })).toBeNull();
  });

  it("rejects sizes outside the paintable budget", () => {
    expect(isStudioVrmTextureSize({ width: 2048, height: 2048 })).toBe(true);
    expect(isStudioVrmTextureSize({ width: STUDIO_VRM_TEXTURE_MAX_DIMENSION + 1, height: 4 })).toBe(
      false,
    );
    expect(isStudioVrmTextureSize({ width: 8.5, height: 8 })).toBe(false);
    expect(isStudioVrmTextureSize(null)).toBe(false);
  });

  it("resolves a full hit into uv, continuous point and texel", () => {
    const hit = resolveStudioVrmTextureHit(
      { triangle: TRIANGLE, barycentric: { x: 0.5, y: 0.5, z: 0 } },
      SIZE,
    );
    expect(hit?.uv).toEqual({ u: 0.5, v: 0 });
    expect(hit?.point).toEqual({ x: 128, y: 0 });
    expect(hit?.texel).toEqual({ x: 128, y: 0, index: 128 });
    expect(
      resolveStudioVrmTextureHit({ triangle: TRIANGLE, barycentric: null }, SIZE),
    ).toBeNull();
  });
});

describe("studio-vrm-texture-uv density", () => {
  it("reports texels per world unit for constant-size brushes", () => {
    const density = estimateStudioVrmUvTexelDensity(
      TRIANGLE,
      { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 }, c: { x: 0, y: 1, z: 0 } },
      { width: 1024, height: 1024 },
    );
    expect(density).toBeCloseTo(1024, 6);
  });

  it("halves when the same UV island covers twice the world size", () => {
    const density = estimateStudioVrmUvTexelDensity(
      TRIANGLE,
      { a: { x: 0, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 }, c: { x: 0, y: 2, z: 0 } },
      { width: 1024, height: 1024 },
    );
    expect(density).toBeCloseTo(512, 6);
  });

  it("returns null for degenerate world or UV triangles", () => {
    expect(
      estimateStudioVrmUvTexelDensity(
        TRIANGLE,
        { a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, c: { x: 0, y: 0, z: 0 } },
        { width: 512, height: 512 },
      ),
    ).toBeNull();
    expect(
      estimateStudioVrmUvTexelDensity(
        { a: { u: 0.5, v: 0.5 }, b: { u: 0.5, v: 0.5 }, c: { u: 0.5, v: 0.5 } },
        { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 }, c: { x: 0, y: 1, z: 0 } },
        { width: 512, height: 512 },
      ),
    ).toBeNull();
  });
});
