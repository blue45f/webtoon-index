import { describe, expect, it } from "vitest";

import {
  STUDIO_VOLUME_COMPOSITE_SPEC,
  compositeStudioVolumeImageOver,
  compositeStudioVolumePixelOver,
  encodeStudioVolumeRgba8,
  premultiplyStudioVolumeRgba,
  studioVolumeDistanceFromViewDepth,
  studioVolumeLinearToSrgb,
  unpremultiplyStudioVolumeRgba,
} from "./studio-volume-composite";

describe("studio-volume-composite · 계약 상수", () => {
  it("프리멀티플라이드 · 선형 sRGB · 적분 클립 깊이 정책을 못 박는다", () => {
    expect(STUDIO_VOLUME_COMPOSITE_SPEC).toEqual({
      alphaMode: "premultiplied",
      colorSpace: "linear-srgb",
      channels: 4,
      depthPolicy: "clip-integration-at-background-distance",
    });
    expect(Object.isFrozen(STUDIO_VOLUME_COMPOSITE_SPEC)).toBe(true);
  });
});

describe("studio-volume-composite · over 연산자", () => {
  it("완전 투명 볼륨 위에서는 배경이 그대로 남는다", () => {
    const out = compositeStudioVolumePixelOver(0, 0, 0, 0, 1, 0.2, 0.4, 0.6, 1);
    expect(Array.from(out)).toEqual([0.2, 0.4, 0.6, 1]);
  });

  it("완전 불투명 볼륨은 배경을 완전히 가린다", () => {
    const out = compositeStudioVolumePixelOver(0.5, 0.25, 0.1, 1, 0, 9, 9, 9, 1);
    expect(Array.from(out)).toEqual([0.5, 0.25, 0.1, 1]);
  });

  it("반투명은 T 로 배경을 감쇠해 더한다", () => {
    const out = compositeStudioVolumePixelOver(0.3, 0.3, 0.3, 0.6, 0.4, 1, 0.5, 0, 1);
    expect(out[0]).toBeCloseTo(0.3 + 1 * 0.4, 12);
    expect(out[1]).toBeCloseTo(0.3 + 0.5 * 0.4, 12);
    expect(out[2]).toBeCloseTo(0.3, 12);
    expect(out[3]).toBeCloseTo(0.6 + 0.4, 12);
  });

  it("alpha 대신 실제 T 를 쓴다(조기 종료로 둘이 어긋날 수 있다)", () => {
    // alpha = 0.9 지만 실제 T = 0.05 (0.1 이 아님) 인 상황.
    const out = compositeStudioVolumePixelOver(0, 0, 0, 0.9, 0.05, 1, 1, 1, 1);
    expect(out[0]).toBeCloseTo(0.05, 12);
    expect(out[3]).toBeCloseTo(0.95, 12);
  });

  it("T 는 [0,1] 로 클램프된다", () => {
    expect(compositeStudioVolumePixelOver(0, 0, 0, 0, 5, 1, 1, 1, 1)[0]).toBe(1);
    expect(compositeStudioVolumePixelOver(0, 0, 0, 0, -5, 1, 1, 1, 1)[0]).toBe(0);
  });

  it("이미지 합성은 픽셀 단위 합성과 동일하다", () => {
    const volume = new Float32Array([0.2, 0.1, 0.05, 0.5, 0, 0, 0, 0]);
    const background = new Float32Array([1, 1, 1, 1, 0.3, 0.2, 0.1, 1]);
    const transmittance = new Float32Array([0.5, 1]);
    const out = compositeStudioVolumeImageOver(volume, background, transmittance);
    expect(out[0]).toBeCloseTo(0.2 + 0.5, 6);
    expect(out[3]).toBeCloseTo(1, 6);
    expect(out[4]).toBeCloseTo(0.3, 6);
    expect(out[7]).toBeCloseTo(1, 6);
  });

  it("transmittance 배열이 없으면 1 - alpha 를 쓴다", () => {
    const volume = new Float32Array([0.2, 0, 0, 0.25]);
    const background = new Float32Array([0.8, 0, 0, 1]);
    const out = compositeStudioVolumeImageOver(volume, background);
    expect(out[0]).toBeCloseTo(0.2 + 0.8 * 0.75, 6);
    expect(out[3]).toBeCloseTo(0.25 + 0.75, 6);
  });

  it("결합법칙: (A over B) over C === A over (B over C)", () => {
    const over = (
      s: readonly number[],
      d: readonly number[]
    ): number[] => Array.from(compositeStudioVolumePixelOver(s[0], s[1], s[2], s[3], 1 - s[3], d[0], d[1], d[2], d[3]));
    const a = [0.1, 0.2, 0.3, 0.4];
    const b = [0.2, 0.1, 0.05, 0.5];
    const c = [0.5, 0.5, 0.5, 1];
    const left = over(over(a, b), c);
    const right = over(a, over(b, c));
    for (let i = 0; i < 4; i += 1) expect(left[i]).toBeCloseTo(right[i], 12);
  });
});

describe("studio-volume-composite · 프리멀티플라이 변환", () => {
  it("premultiply → unpremultiply 왕복이 원본을 복원한다", () => {
    const straight = new Float32Array([0.4, 0.6, 0.8, 0.5, 0.1, 0.2, 0.3, 1]);
    const back = unpremultiplyStudioVolumeRgba(premultiplyStudioVolumeRgba(straight));
    for (let i = 0; i < straight.length; i += 1) expect(back[i]).toBeCloseTo(straight[i], 6);
  });

  it("alpha 0 은 색을 0 으로 두고 폭발하지 않는다", () => {
    const out = unpremultiplyStudioVolumeRgba(new Float32Array([0.5, 0.5, 0.5, 0]));
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("studio-volume-composite · 깊이와 색공간", () => {
  it("뷰 깊이 → 레이 거리는 화면 가장자리에서 늘어난다", () => {
    expect(studioVolumeDistanceFromViewDepth(10, 1)).toBe(10);
    expect(studioVolumeDistanceFromViewDepth(10, 0.5)).toBe(20);
    expect(studioVolumeDistanceFromViewDepth(0, 1)).toBe(0);
    expect(studioVolumeDistanceFromViewDepth(10, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it("선형 → sRGB 전달함수는 알려진 지점을 통과한다", () => {
    expect(studioVolumeLinearToSrgb(0)).toBe(0);
    expect(studioVolumeLinearToSrgb(1)).toBeCloseTo(1, 12);
    expect(studioVolumeLinearToSrgb(0.5)).toBeCloseTo(0.7353569830524495, 10);
    expect(studioVolumeLinearToSrgb(0.0031308)).toBeCloseTo(0.04045, 5);
    expect(studioVolumeLinearToSrgb(-1)).toBe(0);
    expect(studioVolumeLinearToSrgb(2)).toBeCloseTo(1, 12);
  });

  it("8비트 인코딩은 프리멀티플라이드를 유지하고 경계에서 검게 죽지 않는다", () => {
    // 알파 0.5 · 스트레이트 흰색 → 프리멀티플라이드 (0.5,0.5,0.5,0.5).
    const rgba = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    const out = encodeStudioVolumeRgba8(rgba);
    expect(out[3]).toBe(128);
    // 올바른 순서: 언프리멀티플라이(→1.0) → sRGB(1.0)=1 → ×alpha → 0.5·255 = 127.5.
    expect(out[0]).toBeGreaterThanOrEqual(127);
    expect(out[0]).toBeLessThanOrEqual(128);
    // 프리멀티플라이드 값을 그대로 sRGB 인코딩했다면 sRGB(0.5)·255 ≈ 187 로 크게 밝아진다.
    expect(Math.round(studioVolumeLinearToSrgb(0.5) * 255)).toBe(188);
    expect(out[0]).toBeLessThan(180);
  });

  it("알파 0 픽셀은 완전히 0 으로 인코딩된다", () => {
    const out = encodeStudioVolumeRgba8(new Float32Array([1, 1, 1, 0]));
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });
});
