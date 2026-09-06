import { describe, expect, it } from "vitest";

import {
  accumulateStudioPathtraceSample,
  applyStudioPathtraceToneMap,
  createStudioPathtraceFilm,
  readStudioPathtraceFilmPixel,
  resetStudioPathtraceFilm,
  resolveStudioPathtraceFilm,
  studioPathtraceLinearToSrgb,
  studioPathtraceSrgbToLinear,
  studioPathtraceToneMapAces,
  studioPathtraceToneMapFromBg3d,
  studioPathtraceToneMapReinhard,
} from "./studio-pathtrace-film";

describe("색 변환", () => {
  it("linear→sRGB 왕복이 복원된다", () => {
    for (let i = 0; i <= 100; i += 1) {
      const linear = i / 100;
      const srgb = studioPathtraceLinearToSrgb(linear);
      expect(studioPathtraceSrgbToLinear(srgb)).toBeCloseTo(linear, 10);
    }
  });

  it("전달함수의 두 분기가 상수 0.0031308 에서 이어진다", () => {
    const cut = 0.0031308;
    const below = studioPathtraceLinearToSrgb(cut - 1e-9);
    const above = studioPathtraceLinearToSrgb(cut + 1e-9);
    expect(Math.abs(above - below)).toBeLessThan(1e-6);
    expect(studioPathtraceLinearToSrgb(cut)).toBeCloseTo(cut * 12.92, 9);
  });

  it("정착점과 클램프", () => {
    expect(studioPathtraceLinearToSrgb(0)).toBe(0);
    expect(studioPathtraceLinearToSrgb(-5)).toBe(0);
    expect(studioPathtraceLinearToSrgb(1)).toBe(1);
    expect(studioPathtraceLinearToSrgb(9)).toBe(1);
    expect(studioPathtraceSrgbToLinear(0)).toBe(0);
    expect(studioPathtraceSrgbToLinear(1)).toBe(1);
  });

  it("sRGB 는 단조 증가한다", () => {
    let prev = -1;
    for (let i = 0; i <= 1000; i += 1) {
      const v = studioPathtraceLinearToSrgb(i / 1000);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("중간 회색(0.5 sRGB)의 선형값이 약 0.2140 이다", () => {
    expect(studioPathtraceSrgbToLinear(0.5)).toBeCloseTo(0.21404, 4);
  });
});

describe("톤맵", () => {
  it("reinhard/aces 는 0 을 0 으로 보내고 단조 증가하며 1 을 넘지 않는다", () => {
    for (const map of [studioPathtraceToneMapReinhard, studioPathtraceToneMapAces]) {
      expect(map(0)).toBe(0);
      expect(map(-1)).toBe(0);
      let prev = -1;
      for (let i = 0; i <= 400; i += 1) {
        const v = map(i / 20);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v).toBeLessThanOrEqual(1);
        prev = v;
      }
    }
  });

  it("reinhard 는 x/(1+x) 그대로다", () => {
    expect(studioPathtraceToneMapReinhard(1)).toBeCloseTo(0.5, 12);
    expect(studioPathtraceToneMapReinhard(3)).toBeCloseTo(0.75, 12);
  });

  it("none 은 항등이다", () => {
    expect(applyStudioPathtraceToneMap(2.5, "none")).toBe(2.5);
    expect(applyStudioPathtraceToneMap(2.5, "reinhard")).toBeCloseTo(2.5 / 3.5, 12);
    expect(applyStudioPathtraceToneMap(2.5, "aces")).toBe(studioPathtraceToneMapAces(2.5));
  });

  it("bg3d 톤맵 이름 매핑표", () => {
    expect(studioPathtraceToneMapFromBg3d("none")).toBe("none");
    expect(studioPathtraceToneMapFromBg3d("aces")).toBe("aces");
    // "neutral"(three.js Khronos PBR Neutral)은 미구현이라 reinhard 로 근사한다.
    expect(studioPathtraceToneMapFromBg3d("neutral")).toBe("reinhard");
  });
});

describe("필름 누적", () => {
  it("평균이 누적 샘플의 산술평균이다", () => {
    const film = createStudioPathtraceFilm(2, 2);
    accumulateStudioPathtraceSample(film, 0, 1, 2, 3);
    accumulateStudioPathtraceSample(film, 0, 3, 4, 5);
    const out = [0, 0, 0];
    readStudioPathtraceFilmPixel(film, 0, out);
    expect(out[0]).toBeCloseTo(2, 6);
    expect(out[1]).toBeCloseTo(3, 6);
    expect(out[2]).toBeCloseTo(4, 6);
    expect(film.sampleCount[0]).toBe(2);
    readStudioPathtraceFilmPixel(film, 3, out);
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 0]);
  });

  it("NaN/Infinity 샘플은 0 으로 흡수해 필름을 오염시키지 않는다", () => {
    const film = createStudioPathtraceFilm(1, 1);
    accumulateStudioPathtraceSample(film, 0, Number.NaN, Infinity, -Infinity);
    accumulateStudioPathtraceSample(film, 0, 2, 2, 2);
    const out = [0, 0, 0];
    readStudioPathtraceFilmPixel(film, 0, out);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(1);
    expect(out[2]).toBe(1);
  });

  it("reset 은 누적과 카운트를 모두 지운다", () => {
    const film = createStudioPathtraceFilm(2, 1);
    accumulateStudioPathtraceSample(film, 1, 5, 5, 5);
    resetStudioPathtraceFilm(film);
    expect(film.sampleCount[1]).toBe(0);
    expect(film.accum[3]).toBe(0);
  });

  it("픽셀별 sampleIndex 순서가 같으면 픽셀 순회 순서와 무관하게 바이트 동일하다", () => {
    const a = createStudioPathtraceFilm(4, 4);
    const b = createStudioPathtraceFilm(4, 4);
    const value = (p: number, s: number) => (p * 13 + s * 7) / 31;
    for (let p = 0; p < 16; p += 1) {
      for (let s = 0; s < 5; s += 1) accumulateStudioPathtraceSample(a, p, value(p, s), 0, 0);
    }
    for (let p = 15; p >= 0; p -= 1) {
      for (let s = 0; s < 5; s += 1) accumulateStudioPathtraceSample(b, p, value(p, s), 0, 0);
    }
    expect(new Uint8Array(a.accum.buffer)).toEqual(new Uint8Array(b.accum.buffer));
    expect(new Uint8Array(a.sampleCount.buffer)).toEqual(new Uint8Array(b.sampleCount.buffer));
  });
});

describe("resolve", () => {
  it("노출은 선형이고 톤맵 없이 sRGB 로 양자화한다", () => {
    const film = createStudioPathtraceFilm(1, 1);
    accumulateStudioPathtraceSample(film, 0, 0.25, 0.5, 1);
    const rgba = resolveStudioPathtraceFilm(film, { exposure: 1, toneMap: "none" });
    expect(rgba.length).toBe(4);
    expect(rgba[0]).toBe(Math.round(studioPathtraceLinearToSrgb(0.25) * 255));
    expect(rgba[1]).toBe(Math.round(studioPathtraceLinearToSrgb(0.5) * 255));
    expect(rgba[2]).toBe(255);
    expect(rgba[3]).toBe(255);

    const half = resolveStudioPathtraceFilm(film, { exposure: 0.5, toneMap: "none" });
    expect(half[0]).toBe(Math.round(studioPathtraceLinearToSrgb(0.125) * 255));
    expect(half[1]).toBe(Math.round(studioPathtraceLinearToSrgb(0.25) * 255));
  });

  it("샘플이 없는 픽셀은 검정 불투명으로 남는다", () => {
    const film = createStudioPathtraceFilm(2, 1);
    accumulateStudioPathtraceSample(film, 0, 1, 1, 1);
    const rgba = resolveStudioPathtraceFilm(film);
    expect([rgba[4], rgba[5], rgba[6], rgba[7]]).toEqual([0, 0, 0, 255]);
  });

  it("톤맵이 하이라이트를 실제로 눌러준다", () => {
    const film = createStudioPathtraceFilm(1, 1);
    accumulateStudioPathtraceSample(film, 0, 4, 4, 4);
    const none = resolveStudioPathtraceFilm(film, { toneMap: "none" });
    const reinhard = resolveStudioPathtraceFilm(film, { toneMap: "reinhard" });
    const aces = resolveStudioPathtraceFilm(film, { toneMap: "aces" });
    expect(none[0]).toBe(255);
    expect(reinhard[0]).toBeLessThan(255);
    expect(aces[0]).toBeLessThan(255);
    expect(reinhard[0]).toBeGreaterThan(200);
  });

  it("resolve 는 결정적이다", () => {
    const film = createStudioPathtraceFilm(8, 8);
    for (let p = 0; p < 64; p += 1) {
      accumulateStudioPathtraceSample(film, p, p / 64, (p % 7) / 7, (p % 3) / 3);
    }
    const a = resolveStudioPathtraceFilm(film, { exposure: 1.3, toneMap: "aces" });
    const b = resolveStudioPathtraceFilm(film, { exposure: 1.3, toneMap: "aces" });
    expect(a).toEqual(b);
  });
});
