import { describe, expect, it } from "vitest";

import {
  COLOR_TO_ALPHA_PRESETS,
  COLOR_TO_ALPHA_STRENGTH_RANGE,
  DEFAULT_COLOR_TO_ALPHA,
  applyColorToAlpha,
  colorToAlphaKonvaFilter,
  isIdentityColorToAlpha,
  normalizeColorToAlpha,
  type ColorToAlpha,
} from "./studio-color-to-alpha";

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

describe("DEFAULT_COLOR_TO_ALPHA / isIdentityColorToAlpha", () => {
  it("기본값은 흰 종이 키 색이지만 strength 0이라 항등", () => {
    expect(DEFAULT_COLOR_TO_ALPHA).toEqual({ keyColor: "#ffffff", strength: 0 });
    expect(isIdentityColorToAlpha(DEFAULT_COLOR_TO_ALPHA)).toBe(true);
  });

  it("strength가 0 이하면 항등, 양수면 항등 아님", () => {
    expect(isIdentityColorToAlpha({ keyColor: "#ffffff", strength: 0 })).toBe(true);
    expect(isIdentityColorToAlpha({ keyColor: "#ffffff", strength: -5 })).toBe(true);
    expect(isIdentityColorToAlpha({ keyColor: "#ffffff", strength: 1 })).toBe(false);
  });
});

describe("COLOR_TO_ALPHA_STRENGTH_RANGE", () => {
  it("범위는 0..100, step 1", () => {
    expect(COLOR_TO_ALPHA_STRENGTH_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
});

describe("normalizeColorToAlpha", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeColorToAlpha()).toEqual(DEFAULT_COLOR_TO_ALPHA);
    expect(normalizeColorToAlpha(null)).toEqual(DEFAULT_COLOR_TO_ALPHA);
  });

  it("strength를 0..100으로 클램프", () => {
    expect(normalizeColorToAlpha({ strength: 250 }).strength).toBe(100);
    expect(normalizeColorToAlpha({ strength: -50 }).strength).toBe(0);
    expect(normalizeColorToAlpha({ strength: 42 }).strength).toBe(42);
  });

  it("숫자 아닌/NaN/Infinity strength는 기본값(0)으로", () => {
    expect(normalizeColorToAlpha({ strength: Number.NaN }).strength).toBe(0);
    expect(normalizeColorToAlpha({ strength: "30" as unknown as number }).strength).toBe(0);
    expect(normalizeColorToAlpha({ strength: Number.POSITIVE_INFINITY }).strength).toBe(0);
    expect(normalizeColorToAlpha({ strength: Number.NEGATIVE_INFINITY }).strength).toBe(0);
  });

  it("유효한 #rrggbb 색만 통과, 무효 색은 기본 흰색", () => {
    expect(normalizeColorToAlpha({ keyColor: "#1f8a3a" }).keyColor).toBe("#1f8a3a");
    expect(normalizeColorToAlpha({ keyColor: "#ABC" as string }).keyColor).toBe(DEFAULT_COLOR_TO_ALPHA.keyColor); // 3자리 거부
    expect(normalizeColorToAlpha({ keyColor: "red" }).keyColor).toBe(DEFAULT_COLOR_TO_ALPHA.keyColor);
    expect(normalizeColorToAlpha({ keyColor: 123 as unknown as string }).keyColor).toBe(
      DEFAULT_COLOR_TO_ALPHA.keyColor
    );
  });
});

describe("applyColorToAlpha", () => {
  it("strength 0(항등)이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyColorToAlpha(img, { keyColor: "#ffffff", strength: 0 });
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("픽셀이 키 색과 정확히 같으면 strength 100에서 완전히 투명해지고 색은 그대로", () => {
    const img = makeImage(1, 1, [[255, 255, 255, 255]]);
    applyColorToAlpha(img, { keyColor: "#ffffff", strength: 100 });
    const [r, g, b, a] = pixelAt(img, 0);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
    expect(a).toBe(0);
  });

  it("키 색과 최대로 발산하는 픽셀(검정 잉크 vs 흰 키)은 strength 100에서 불투명·색 유지", () => {
    const img = makeImage(1, 1, [[0, 0, 0, 255]]);
    applyColorToAlpha(img, { keyColor: "#ffffff", strength: 100 });
    const [r, g, b, a] = pixelAt(img, 0);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });

  it("중간 회색 앤티앨리어싱 가장자리는 부분 투명 + 색이 흰 키에서 멀어지는 쪽(검정)으로 언믹스된다", () => {
    // #808080은 흰 키(255)와 검정 잉크(0) 사이 중간값 — 발산도 ~0.498 → 부분 알파.
    const img = makeImage(1, 1, [[128, 128, 128, 255]]);
    applyColorToAlpha(img, { keyColor: "#ffffff", strength: 100 });
    const [r, g, b, a] = pixelAt(img, 0);
    // 알파가 128 부근(완전 불투명도 완전 투명도 아님).
    expect(a).toBeGreaterThan(64);
    expect(a).toBeLessThan(192);
    // 언믹스로 흰 헤일로가 제거되어 원래보다 더 어두운(검정 쪽) 색이 된다.
    expect(r).toBeLessThan(128);
    expect(g).toBeLessThan(128);
    expect(b).toBeLessThan(128);
  });

  it("이미 부분 알파를 가진, 키에서 먼 픽셀은 strength 100에서도 알파가 그대로다(곱셈만, 복원 없음)", () => {
    const img = makeImage(1, 1, [[0, 0, 0, 128]]); // 검정 잉크, 흰 키와 최대 발산 → alpha계산=1
    applyColorToAlpha(img, { keyColor: "#ffffff", strength: 100 });
    const [, , , a] = pixelAt(img, 0);
    expect(a).toBe(128); // origA * (1 - 1*(1-1)) = origA
  });

  it("부분 strength(25/50/75)일수록 키에서 먼 고정 픽셀의 알파가 단조 감소한다", () => {
    // 순수 회색(128,128,128)은 흰 키 기준 발산도 ~0.498 → alpha<1이라 strength가 커질수록 더 줄어든다.
    const alphas = [25, 50, 75].map((strength) => {
      const img = makeImage(1, 1, [[128, 128, 128, 255]]);
      applyColorToAlpha(img, { keyColor: "#ffffff", strength });
      return pixelAt(img, 0)[3]!;
    });
    expect(alphas[0]!).toBeGreaterThan(alphas[1]!);
    expect(alphas[1]!).toBeGreaterThan(alphas[2]!);
  });

  it("중앙(127.5)에서 먼 키 색이어도, 그 방향 경계(0/255)에 닿은 픽셀은 완전히 발산(alpha=1)한 것으로 취급되어 불투명이 유지된다(방향별 분모 — 대칭 분모였다면 과소평가돼 하이라이트가 잘못 지워졌다)", () => {
    // 미색 종이 프리셋 키(#f2ead9, r=242,g=234,b=217) — 순수 흰색(255,255,255)은 세 채널
    // 모두 키보다 밝은 쪽 경계(255)에 이미 닿아 있으므로 발산도가 반드시 1이어야 한다(alpha=1 →
    // "완전히 전경" → 원본 알파 유지). 예전 대칭 분모 max(key,255-key)=242였다면 r 채널이
    // (255-242)/242≈0.05로 계산돼 발산도가 낮게 나와, 실제로는 배경(종이)이 아닌 이 하이라이트가
    // 배경으로 오인되어 82%+ 투명해지는 버그가 있었다(outAFrac=origAFrac*alpha=1*0.175≈0.175).
    const img = makeImage(1, 1, [[255, 255, 255, 255]]);
    applyColorToAlpha(img, { keyColor: "#f2ead9", strength: 100 });
    const [r, g, b, a] = pixelAt(img, 0);
    expect(a).toBe(255); // alpha=1(최대 발산) → 전경으로 유지, 원본 알파 그대로.
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });

  it("같은 키의 어두운 쪽 경계(0)에 닿은 픽셀도 방향별 분모로 발산도 1이 된다(이 방향은 대칭 분모였어도 이미 맞았음 — 회귀 확인용)", () => {
    const img = makeImage(1, 1, [[0, 0, 0, 255]]);
    applyColorToAlpha(img, { keyColor: "#f2ead9", strength: 100 });
    const [, , , a] = pixelAt(img, 0);
    expect(a).toBe(255); // 검정 잉크는 최대 발산 → 불투명 유지
  });

  it("극단 키 색(#000000/#ffffff)에서도 분모가 255라 나눗셈 아티팩트(NaN/Infinity)가 없다", () => {
    const white = makeImage(1, 1, [[10, 20, 30, 255]]);
    applyColorToAlpha(white, { keyColor: "#ffffff", strength: 100 });
    expect(pixelAt(white, 0).every((v) => Number.isFinite(v))).toBe(true);

    const black = makeImage(1, 1, [[10, 20, 30, 255]]);
    applyColorToAlpha(black, { keyColor: "#000000", strength: 100 });
    expect(pixelAt(black, 0).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("1x1 이미지도 최소 크기 제약 없이 동작한다", () => {
    const img = makeImage(1, 1, [[255, 255, 255, 255]]);
    expect(() => applyColorToAlpha(img, { keyColor: "#ffffff", strength: 100 })).not.toThrow();
    expect(pixelAt(img, 0)[3]).toBe(0);
  });
});

describe("COLOR_TO_ALPHA_PRESETS", () => {
  it("첫 항목은 none/없음 항등(strength 0)", () => {
    const first = COLOR_TO_ALPHA_PRESETS[0]!;
    expect(first.id).toBe("none");
    expect(first.label).toBe("없음");
    expect(first.value.strength).toBe(0);
    expect(isIdentityColorToAlpha(first.value)).toBe(true);
  });

  it("id는 모두 고유하다", () => {
    const ids = COLOR_TO_ALPHA_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of COLOR_TO_ALPHA_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeColorToAlpha와 동일(색 #rrggbb, strength 범위 안)", () => {
    for (const p of COLOR_TO_ALPHA_PRESETS) {
      expect(p.value).toEqual(normalizeColorToAlpha(p.value));
      expect(p.value.keyColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.value.strength).toBeGreaterThanOrEqual(COLOR_TO_ALPHA_STRENGTH_RANGE.min);
      expect(p.value.strength).toBeLessThanOrEqual(COLOR_TO_ALPHA_STRENGTH_RANGE.max);
    }
  });
});

describe("colorToAlphaKonvaFilter", () => {
  it("flat attrs(ctaColor/ctaStrength)를 읽어 applyColorToAlpha 직접 호출과 동일한 결과를 낸다", () => {
    const img = makeImage(1, 1, [[128, 128, 128, 255]]);
    const attrs = { ctaColor: "#ffffff", ctaStrength: 100 };
    colorToAlphaKonvaFilter.call({ attrs }, img);

    const ref = makeImage(1, 1, [[128, 128, 128, 255]]);
    applyColorToAlpha(ref, normalizeColorToAlpha({ keyColor: "#ffffff", strength: 100 }));
    expect(pixelAt(img, 0)).toEqual(pixelAt(ref, 0));
  });

  it("this.attrs 자체가 없으면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => colorToAlphaKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("ctaStrength 0(또는 누락)이면 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    colorToAlphaKonvaFilter.call({ attrs: { ctaColor: "#ffffff", ctaStrength: 0 } }, img);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);

    const img2 = makeImage(1, 1, [[10, 20, 30, 40]]);
    colorToAlphaKonvaFilter.call({ attrs: {} }, img2);
    expect(pixelAt(img2, 0)).toEqual([10, 20, 30, 40]);
  });

  it("무효 attrs(숫자/색 아님)는 안전하게 무시되어 no-op(strength가 기본값 0으로 폴백)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    const attrs = { ctaColor: 42, ctaStrength: "x" };
    expect(() => colorToAlphaKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: ColorToAlpha = DEFAULT_COLOR_TO_ALPHA;
void _typecheck;
