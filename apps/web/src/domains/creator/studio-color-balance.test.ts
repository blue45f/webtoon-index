import { describe, expect, it } from "vitest";

import {
  COLOR_BALANCE_PRESETS,
  COLOR_BALANCE_RANGE,
  DEFAULT_COLOR_BALANCE,
  applyColorBalance,
  colorBalanceKonvaFilter,
  isIdentityColorBalance,
  normalizeColorBalance,
  type ColorBalance,
  type RgbShift,
} from "./studio-color-balance";

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

describe("DEFAULT_COLOR_BALANCE / isIdentityColorBalance", () => {
  it("기본값은 세 영역 전부 [0,0,0] 항등", () => {
    expect(DEFAULT_COLOR_BALANCE).toEqual({
      shadows: [0, 0, 0],
      midtones: [0, 0, 0],
      highlights: [0, 0, 0],
    });
    expect(isIdentityColorBalance(DEFAULT_COLOR_BALANCE)).toBe(true);
  });

  it("어느 한 채널이라도 0이 아니면 항등이 아니다", () => {
    expect(isIdentityColorBalance({ ...DEFAULT_COLOR_BALANCE, shadows: [1, 0, 0] })).toBe(false);
    expect(isIdentityColorBalance({ ...DEFAULT_COLOR_BALANCE, midtones: [0, -3, 0] })).toBe(false);
    expect(isIdentityColorBalance({ ...DEFAULT_COLOR_BALANCE, highlights: [0, 0, 5] })).toBe(false);
  });
});

describe("COLOR_BALANCE_RANGE", () => {
  it("범위는 -100..100, step 1", () => {
    expect(COLOR_BALANCE_RANGE).toEqual({ min: -100, max: 100, step: 1 });
  });
});

describe("normalizeColorBalance", () => {
  it("undefined/null → 기본값(전부 0)", () => {
    expect(normalizeColorBalance()).toEqual(DEFAULT_COLOR_BALANCE);
    expect(normalizeColorBalance(null)).toEqual(DEFAULT_COLOR_BALANCE);
  });

  it("누락 영역은 [0,0,0]으로 채운다", () => {
    expect(normalizeColorBalance({ shadows: [10, 20, 30] })).toEqual({
      shadows: [10, 20, 30],
      midtones: [0, 0, 0],
      highlights: [0, 0, 0],
    });
  });

  it("누락 채널은 0으로 채운다(짧은 배열)", () => {
    expect(normalizeColorBalance({ midtones: [5] as unknown as RgbShift })).toEqual({
      shadows: [0, 0, 0],
      midtones: [5, 0, 0],
      highlights: [0, 0, 0],
    });
  });

  it("범위 밖 숫자는 -100..100으로 클램프", () => {
    const out = normalizeColorBalance({
      shadows: [999, -999, 100],
      midtones: [-100, 250, -250],
      highlights: [101, -101, 0],
    });
    expect(out.shadows).toEqual([100, -100, 100]);
    expect(out.midtones).toEqual([-100, 100, -100]);
    expect(out.highlights).toEqual([100, -100, 0]);
  });

  it("숫자가 아닌 값은 0", () => {
    const out = normalizeColorBalance({
      shadows: ["20", Number.NaN, Number.POSITIVE_INFINITY] as unknown as RgbShift,
      midtones: [null, undefined, {}] as unknown as RgbShift,
      highlights: "nope" as unknown as RgbShift,
    });
    expect(out).toEqual(DEFAULT_COLOR_BALANCE);
  });
});

describe("applyColorBalance", () => {
  it("항등(전부 0)이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyColorBalance(img, DEFAULT_COLOR_BALANCE);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("그림자 +R 쉬프트는 밝은 픽셀보다 어두운 픽셀의 R을 더 많이 올린다(휘도 가중)", () => {
    const cb: ColorBalance = { ...DEFAULT_COLOR_BALANCE, shadows: [60, 0, 0] };
    // 같은 회색이지만 한쪽은 어둡고 한쪽은 밝다. (B에 여유를 둬 클램프 마스킹 방지)
    const dark = makeImage(1, 1, [[30, 30, 30, 128]]);
    const bright = makeImage(1, 1, [[225, 225, 225, 200]]);
    applyColorBalance(dark, cb);
    applyColorBalance(bright, cb);

    const darkDelta = pixelAt(dark, 0)[0]! - 30;
    const brightDelta = pixelAt(bright, 0)[0]! - 225;
    expect(darkDelta).toBeGreaterThan(0); // 어두운 픽셀 R은 확실히 상승
    expect(darkDelta).toBeGreaterThan(brightDelta); // 가중치가 그림자 쪽에 더 실린다
    // G/B는 그대로, 알파 보존.
    expect(pixelAt(dark, 0)[1]).toBe(30);
    expect(pixelAt(dark, 0)[2]).toBe(30);
    expect(pixelAt(dark, 0)[3]).toBe(128);
  });

  it("하이라이트 +B 쉬프트는 어두운 픽셀보다 밝은 픽셀의 B를 더 많이 올린다", () => {
    const cb: ColorBalance = { ...DEFAULT_COLOR_BALANCE, highlights: [0, 0, 60] };
    // B에 여유를 두기 위해 B는 낮게(40) 두고 휘도만 어둡게/밝게 만든다.
    const dark = makeImage(1, 1, [[30, 30, 40, 90]]);
    const bright = makeImage(1, 1, [[210, 210, 40, 255]]);
    applyColorBalance(dark, cb);
    applyColorBalance(bright, cb);

    const darkDelta = pixelAt(dark, 0)[2]! - 40;
    const brightDelta = pixelAt(bright, 0)[2]! - 40;
    expect(brightDelta).toBeGreaterThan(0); // 밝은 픽셀 B는 확실히 상승
    expect(brightDelta).toBeGreaterThan(darkDelta); // 가중치가 하이라이트 쪽에 더 실린다
    // R/G는 그대로, 알파 보존.
    expect(pixelAt(bright, 0)[0]).toBe(210);
    expect(pixelAt(bright, 0)[1]).toBe(210);
    expect(pixelAt(bright, 0)[3]).toBe(255);
  });

  it("음수 쉬프트는 채널을 내린다(하이라이트 -B)", () => {
    const cb: ColorBalance = { ...DEFAULT_COLOR_BALANCE, highlights: [0, 0, -60] };
    const bright = makeImage(1, 1, [[220, 220, 200, 255]]);
    applyColorBalance(bright, cb);
    expect(pixelAt(bright, 0)[2]!).toBeLessThan(200);
    expect(pixelAt(bright, 0)[3]).toBe(255); // 알파 보존
  });

  it("2x1 가짜 데이터에서 채널별 독립 적용 + 알파 보존", () => {
    const cb: ColorBalance = { shadows: [0, 40, 0], midtones: [0, 0, 0], highlights: [0, 40, 0] };
    const img = makeImage(2, 1, [
      [20, 100, 20, 11],
      [230, 100, 230, 222],
    ]);
    applyColorBalance(img, cb);
    // 두 픽셀 모두 G가 오르고(그림자/하이라이트 +G), R/B와 알파는 그대로.
    expect(pixelAt(img, 0)[1]!).toBeGreaterThan(100);
    expect(pixelAt(img, 1)[1]!).toBeGreaterThan(100);
    expect(pixelAt(img, 0)[0]).toBe(20);
    expect(pixelAt(img, 0)[2]).toBe(20);
    expect(pixelAt(img, 0)[3]).toBe(11);
    expect(pixelAt(img, 1)[0]).toBe(230);
    expect(pixelAt(img, 1)[2]).toBe(230);
    expect(pixelAt(img, 1)[3]).toBe(222);
  });
});

describe("COLOR_BALANCE_PRESETS", () => {
  it("첫 항목은 neutral/기본 항등", () => {
    const first = COLOR_BALANCE_PRESETS[0]!;
    expect(first.id).toBe("neutral");
    expect(first.label).toBe("기본");
    expect(isIdentityColorBalance(first.balance)).toBe(true);
  });

  it("프리셋이 여러 개다", () => {
    expect(COLOR_BALANCE_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("id는 모두 고유하다", () => {
    const ids = COLOR_BALANCE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of COLOR_BALANCE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 balance가 normalizeColorBalance와 동일(범위 안)", () => {
    for (const p of COLOR_BALANCE_PRESETS) {
      expect(p.balance).toEqual(normalizeColorBalance(p.balance));
      for (const zone of ["shadows", "midtones", "highlights"] as const) {
        for (const v of p.balance[zone]) {
          expect(v).toBeGreaterThanOrEqual(COLOR_BALANCE_RANGE.min);
          expect(v).toBeLessThanOrEqual(COLOR_BALANCE_RANGE.max);
        }
      }
    }
  });
});

describe("colorBalanceKonvaFilter", () => {
  it("flat attrs(cbShadows/cbMidtones/cbHighlights)를 읽어 픽셀을 변형한다", () => {
    const img = makeImage(1, 1, [[30, 30, 30, 77]]);
    const attrs = {
      cbShadows: [60, 0, 0],
      cbMidtones: [0, 0, 0],
      cbHighlights: [0, 0, 0],
    };
    colorBalanceKonvaFilter.call({ attrs }, img);
    // 어두운 픽셀 + 그림자 +R → R 상승, G/B/알파 보존.
    expect(pixelAt(img, 0)[0]!).toBeGreaterThan(30);
    expect(pixelAt(img, 0)[1]).toBe(30);
    expect(pixelAt(img, 0)[2]).toBe(30);
    expect(pixelAt(img, 0)[3]).toBe(77);

    // 직접 applyColorBalance 결과와 동일해야 한다.
    const ref = makeImage(1, 1, [[30, 30, 30, 77]]);
    applyColorBalance(ref, normalizeColorBalance({ shadows: [60, 0, 0] }));
    expect(pixelAt(img, 0)).toEqual(pixelAt(ref, 0));
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => colorBalanceKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => colorBalanceKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시되어 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    const attrs = {
      cbShadows: "x",
      cbMidtones: [Number.NaN, null, undefined],
      cbHighlights: 42,
    };
    expect(() => colorBalanceKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });

  it("전부 0으로 정규화되는 attrs는 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    const attrs = {
      cbShadows: [0, 0, 0],
      cbMidtones: [0, 0, 0],
      cbHighlights: [0, 0, 0],
    };
    colorBalanceKonvaFilter.call({ attrs }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: ColorBalance = DEFAULT_COLOR_BALANCE;
void _typecheck;

describe("color balance hostile direct-call safety", () => {
  it("NaN/Infinity input normalizes to a no-op and leaves caller tuples untouched", () => {
    const balance = Object.freeze({
      shadows: Object.freeze([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]),
      midtones: Object.freeze([0, 0, 0]),
      highlights: Object.freeze([0, 0, 0]),
    }) as unknown as ColorBalance;
    const img = makeImage(1, 1, [[10, 20, 30, 77]]);
    expect(() => applyColorBalance(img, balance)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 77]);
    expect(balance.shadows[0]).toBeNaN();
  });
});
