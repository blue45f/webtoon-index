import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIBRANCE,
  VIBRANCE_PRESETS,
  VIBRANCE_RANGE,
  applyVibrance,
  isIdentityVibrance,
  normalizeVibrance,
  vibranceKonvaFilter,
  type Vibrance,
} from "./studio-vibrance";

import type { StudioImageDataLike } from "./studio-filters";

// ---- 테스트용 가짜 ImageData 빌더 ----

/** [r,g,b,a] 픽셀 배열로 StudioImageDataLike 생성. */
function makeImage(width: number, height: number, pixels: number[][]): StudioImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return { data, width, height };
}

function pixelAt(img: StudioImageDataLike, index: number): number[] {
  return Array.from(img.data.slice(index * 4, index * 4 + 4));
}

/** 한 픽셀의 채널 폭(max-min) — 채도 변화 측정용. */
function spread(px: number[]): number {
  return Math.max(px[0]!, px[1]!, px[2]!) - Math.min(px[0]!, px[1]!, px[2]!);
}

describe("DEFAULT_VIBRANCE / isIdentityVibrance", () => {
  it("기본값은 둘 다 0인 항등", () => {
    expect(DEFAULT_VIBRANCE).toEqual({ vibrance: 0, saturation: 0 });
    expect(isIdentityVibrance(DEFAULT_VIBRANCE)).toBe(true);
  });

  it("어느 한쪽이라도 0이 아니면 항등이 아니다", () => {
    expect(isIdentityVibrance({ vibrance: 1, saturation: 0 })).toBe(false);
    expect(isIdentityVibrance({ vibrance: 0, saturation: -5 })).toBe(false);
  });
});

describe("VIBRANCE_RANGE", () => {
  it("범위는 -100..100, step 1", () => {
    expect(VIBRANCE_RANGE).toEqual({ min: -100, max: 100, step: 1 });
  });
});

describe("normalizeVibrance", () => {
  it("undefined/null → 기본값(둘 다 0)", () => {
    expect(normalizeVibrance()).toEqual(DEFAULT_VIBRANCE);
    expect(normalizeVibrance(null)).toEqual(DEFAULT_VIBRANCE);
  });

  it("누락 키는 0으로 채운다", () => {
    expect(normalizeVibrance({ vibrance: 25 })).toEqual({ vibrance: 25, saturation: 0 });
    expect(normalizeVibrance({ saturation: -15 })).toEqual({ vibrance: 0, saturation: -15 });
  });

  it("범위 밖 숫자는 -100..100으로 클램프", () => {
    expect(normalizeVibrance({ vibrance: 999, saturation: -999 })).toEqual({
      vibrance: 100,
      saturation: -100,
    });
    expect(normalizeVibrance({ vibrance: 101, saturation: -101 })).toEqual({
      vibrance: 100,
      saturation: -100,
    });
  });

  it("숫자가 아닌 값은 0", () => {
    const out = normalizeVibrance({
      vibrance: "40" as unknown as number,
      saturation: Number.NaN,
    });
    expect(out).toEqual(DEFAULT_VIBRANCE);
    expect(
      normalizeVibrance({
        vibrance: Number.POSITIVE_INFINITY,
        saturation: null as unknown as number,
      })
    ).toEqual(DEFAULT_VIBRANCE);
  });
});

describe("applyVibrance", () => {
  it("항등(둘 다 0)이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyVibrance(img, DEFAULT_VIBRANCE);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("양수 채도는 컬러 픽셀의 채널 폭(max-min)을 넓힌다", () => {
    const before = [150, 110, 70, 200];
    const img = makeImage(1, 1, [before]);
    applyVibrance(img, { vibrance: 0, saturation: 50 });
    const after = pixelAt(img, 0);
    expect(spread(after)).toBeGreaterThan(spread(before)); // 채도 상승
    expect(after[3]).toBe(200); // 알파 보존
  });

  it("음수 채도는 채널 폭을 좁힌다", () => {
    const before = [150, 110, 70, 255];
    const img = makeImage(1, 1, [before]);
    applyVibrance(img, { vibrance: 0, saturation: -50 });
    expect(spread(pixelAt(img, 0))).toBeLessThan(spread(before));
  });

  it("활기는 저채도 픽셀을 고채도 픽셀보다 더 많이 올린다(상대 폭 기준)", () => {
    // 저채도: 폭이 좁은 칙칙한 색. 고채도: 폭이 넓은 쨍한 색.
    // 둘 다 중간 휘도라 클램프 없이 채널 순서가 보존된다.
    const lowBefore = [120, 110, 100, 255]; // 폭 20
    const highBefore = [170, 110, 50, 255]; // 폭 120
    const low = makeImage(1, 1, [lowBefore]);
    const high = makeImage(1, 1, [highBefore]);
    const v: Vibrance = { vibrance: 50, saturation: 0 };
    applyVibrance(low, v);
    applyVibrance(high, v);

    const lowRatio = spread(pixelAt(low, 0)) / spread(lowBefore);
    const highRatio = spread(pixelAt(high, 0)) / spread(highBefore);
    // 두 픽셀 모두 폭이 넓어지지만, 저채도 쪽이 비율로 더 크게 부풀어야 한다.
    expect(lowRatio).toBeGreaterThan(1);
    expect(highRatio).toBeGreaterThan(1);
    expect(lowRatio).toBeGreaterThan(highRatio);
  });

  it("회색(무채색) 픽셀은 거의 변화 없다", () => {
    // R=G=B면 휘도=각 채널이라 c-L=0 → 어떤 스케일에도 불변.
    const img = makeImage(1, 1, [[128, 128, 128, 123]]);
    applyVibrance(img, { vibrance: 100, saturation: 80 });
    const after = pixelAt(img, 0);
    expect(after[0]).toBe(128);
    expect(after[1]).toBe(128);
    expect(after[2]).toBe(128);
    expect(after[3]).toBe(123); // 알파 보존
  });

  it("saturation=-100 → 그레이스케일(R≈G≈B)", () => {
    const img = makeImage(2, 1, [
      [200, 100, 50, 255],
      [40, 180, 220, 128],
    ]);
    applyVibrance(img, { vibrance: 0, saturation: -100 });
    for (const idx of [0, 1]) {
      const [r, g, b] = pixelAt(img, idx);
      // 모든 채널이 휘도로 수렴 — 반올림 오차 ±1 이내.
      expect(Math.abs(r! - g!)).toBeLessThanOrEqual(1);
      expect(Math.abs(g! - b!)).toBeLessThanOrEqual(1);
      expect(Math.abs(r! - b!)).toBeLessThanOrEqual(1);
    }
    expect(pixelAt(img, 0)[3]).toBe(255); // 알파 보존
    expect(pixelAt(img, 1)[3]).toBe(128);
  });

  it("여러 픽셀에서 알파를 보존한다", () => {
    const img = makeImage(3, 1, [
      [200, 100, 50, 11],
      [60, 200, 90, 222],
      [128, 128, 128, 77],
    ]);
    applyVibrance(img, { vibrance: 30, saturation: 20 });
    expect(pixelAt(img, 0)[3]).toBe(11);
    expect(pixelAt(img, 1)[3]).toBe(222);
    expect(pixelAt(img, 2)[3]).toBe(77);
  });
});

describe("VIBRANCE_PRESETS", () => {
  it("첫 항목은 기본 항등", () => {
    const first = VIBRANCE_PRESETS[0]!;
    expect(first.label).toBe("기본");
    expect(isIdentityVibrance(first.value)).toBe(true);
  });

  it("프리셋이 여러 개다", () => {
    expect(VIBRANCE_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it("id는 모두 고유하다", () => {
    const ids = VIBRANCE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of VIBRANCE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeVibrance와 동일(범위 안)", () => {
    for (const p of VIBRANCE_PRESETS) {
      expect(p.value).toEqual(normalizeVibrance(p.value));
      expect(p.value.vibrance).toBeGreaterThanOrEqual(VIBRANCE_RANGE.min);
      expect(p.value.vibrance).toBeLessThanOrEqual(VIBRANCE_RANGE.max);
      expect(p.value.saturation).toBeGreaterThanOrEqual(VIBRANCE_RANGE.min);
      expect(p.value.saturation).toBeLessThanOrEqual(VIBRANCE_RANGE.max);
    }
  });
});

describe("vibranceKonvaFilter", () => {
  it("flat attrs(vibrance/vibranceSat)를 읽어 픽셀을 변형한다", () => {
    const before = [150, 110, 70, 200];
    const img = makeImage(1, 1, [before]);
    vibranceKonvaFilter.call({ attrs: { vibrance: 0, vibranceSat: 50 } }, img);
    expect(spread(pixelAt(img, 0))).toBeGreaterThan(spread(before));

    // 직접 applyVibrance 결과와 동일해야 한다.
    const ref = makeImage(1, 1, [before]);
    applyVibrance(ref, normalizeVibrance({ vibrance: 0, saturation: 50 }));
    expect(pixelAt(img, 0)).toEqual(pixelAt(ref, 0));
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => vibranceKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => vibranceKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시되어 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    const attrs = { vibrance: "x", vibranceSat: Number.NaN };
    expect(() => vibranceKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });

  it("둘 다 0으로 정규화되는 attrs는 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    vibranceKonvaFilter.call({ attrs: { vibrance: 0, vibranceSat: 0 } }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: Vibrance = DEFAULT_VIBRANCE;
void _typecheck;
