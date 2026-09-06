import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHADOW_HIGHLIGHT,
  SHADOW_HIGHLIGHT_AMOUNT_RANGE,
  SHADOW_HIGHLIGHT_MIDTONE_RANGE,
  SHADOW_HIGHLIGHT_PRESETS,
  SHADOW_HIGHLIGHT_WIDTH_RANGE,
  applyShadowHighlight,
  buildShadowHighlightLut,
  isIdentityShadowHighlight,
  normalizeShadowHighlight,
  shadowHighlightKonvaFilter,
  type ShadowHighlight,
} from "./studio-shadow-highlight";

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

/** 가로 한 줄짜리 그레이 이미지 — x별 휘도값 배열을 [v,v,v,alpha]로 펼친다. */
function makeGrayRow(values: number[], alpha = 255): StudioImageDataLike {
  return makeImage(
    values.length,
    1,
    values.map((v) => [v, v, v, alpha])
  );
}

describe("DEFAULT_SHADOW_HIGHLIGHT / isIdentityShadowHighlight", () => {
  it("기본값은 보정량·대비 0(톤 범위 50)인 항등", () => {
    expect(DEFAULT_SHADOW_HIGHLIGHT).toEqual({
      shadows: 0,
      shadowsWidth: 50,
      highlights: 0,
      highlightsWidth: 50,
      midtoneContrast: 0,
    });
    expect(isIdentityShadowHighlight(DEFAULT_SHADOW_HIGHLIGHT)).toBe(true);
  });

  it("보정량·대비 중 하나라도 0이 아니면 항등이 아니다", () => {
    expect(isIdentityShadowHighlight({ ...DEFAULT_SHADOW_HIGHLIGHT, shadows: 1 })).toBe(false);
    expect(isIdentityShadowHighlight({ ...DEFAULT_SHADOW_HIGHLIGHT, highlights: 1 })).toBe(false);
    expect(isIdentityShadowHighlight({ ...DEFAULT_SHADOW_HIGHLIGHT, midtoneContrast: -5 })).toBe(false);
  });

  it("톤 범위만 다른 것은 여전히 항등이다(양이 0이면 효과 없음)", () => {
    expect(
      isIdentityShadowHighlight({ ...DEFAULT_SHADOW_HIGHLIGHT, shadowsWidth: 90, highlightsWidth: 10 })
    ).toBe(true);
  });
});

describe("SHADOW_HIGHLIGHT_*_RANGE", () => {
  it("보정량 범위는 0..100, step 1", () => {
    expect(SHADOW_HIGHLIGHT_AMOUNT_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("톤 범위는 0..100, step 1", () => {
    expect(SHADOW_HIGHLIGHT_WIDTH_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
  it("중간톤 대비 범위는 -50..50, step 1", () => {
    expect(SHADOW_HIGHLIGHT_MIDTONE_RANGE).toEqual({ min: -50, max: 50, step: 1 });
  });
});

describe("normalizeShadowHighlight", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeShadowHighlight()).toEqual(DEFAULT_SHADOW_HIGHLIGHT);
    expect(normalizeShadowHighlight(null)).toEqual(DEFAULT_SHADOW_HIGHLIGHT);
  });

  it("누락 키는 기본값(양·대비 0, 톤 범위 50)으로 채운다", () => {
    expect(normalizeShadowHighlight({ shadows: 30 })).toEqual({
      ...DEFAULT_SHADOW_HIGHLIGHT,
      shadows: 30,
    });
    expect(normalizeShadowHighlight({ highlights: 40, highlightsWidth: 70 })).toEqual({
      ...DEFAULT_SHADOW_HIGHLIGHT,
      highlights: 40,
      highlightsWidth: 70,
    });
  });

  it("범위 밖 숫자는 각 범위로 클램프(양 0..100, 폭 0..100, 대비 -50..50)", () => {
    expect(
      normalizeShadowHighlight({
        shadows: 999,
        shadowsWidth: -999,
        highlights: -1,
        highlightsWidth: 999,
        midtoneContrast: 999,
      })
    ).toEqual({ shadows: 100, shadowsWidth: 0, highlights: 0, highlightsWidth: 100, midtoneContrast: 50 });
    expect(normalizeShadowHighlight({ midtoneContrast: -999 }).midtoneContrast).toBe(-50);
  });

  it("숫자가 아닌 값/NaN/Infinity는 기본값", () => {
    const out = normalizeShadowHighlight({
      shadows: "50" as unknown as number,
      shadowsWidth: Number.NaN,
      highlights: Number.POSITIVE_INFINITY,
      midtoneContrast: "x" as unknown as number,
    });
    expect(out).toEqual(DEFAULT_SHADOW_HIGHLIGHT);
  });
});

describe("applyShadowHighlight — 항등/no-op", () => {
  it("항등(양·대비 0)이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyShadowHighlight(img, DEFAULT_SHADOW_HIGHLIGHT);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });
});

describe("applyShadowHighlight — 섀도우 리프트", () => {
  it("어두운 픽셀이 밝은 픽셀보다 더 많이 밝아진다(섀도 마스크 가중)", () => {
    const before = makeGrayRow([40, 100, 200]);
    const after = makeGrayRow([40, 100, 200]);
    applyShadowHighlight(after, { ...DEFAULT_SHADOW_HIGHLIGHT, shadows: 60 });

    const darkShift = pixelAt(after, 0)[0]! - pixelAt(before, 0)[0]!;
    const midShift = pixelAt(after, 1)[0]! - pixelAt(before, 1)[0]!;
    const brightShift = pixelAt(after, 2)[0]! - pixelAt(before, 2)[0]!;
    expect(darkShift).toBeGreaterThan(0); // 어두운 영역은 확실히 리프트
    expect(darkShift).toBeGreaterThan(midShift); // 어두울수록 더 크게
    expect(brightShift).toBe(0); // 톤 범위(50) 밖 밝은 영역은 불변
  });

  it("섀도우 리프트는 하이라이트를 건드리지 않는다", () => {
    const img = makeGrayRow([250]);
    applyShadowHighlight(img, { ...DEFAULT_SHADOW_HIGHLIGHT, shadows: 100 });
    expect(pixelAt(img, 0)[0]).toBe(250);
  });
});

describe("applyShadowHighlight — 하이라이트 복구", () => {
  it("밝은 픽셀을 어둡게 눌러 되살린다(하이라이트 마스크 가중)", () => {
    const before = makeGrayRow([40, 128, 235]);
    const after = makeGrayRow([40, 128, 235]);
    applyShadowHighlight(after, { ...DEFAULT_SHADOW_HIGHLIGHT, highlights: 60 });

    expect(pixelAt(after, 2)[0]!).toBeLessThan(pixelAt(before, 2)[0]!); // 밝은 픽셀은 어두워진다
    expect(pixelAt(after, 0)[0]).toBe(40); // 섀도는 불변
    expect(pixelAt(after, 1)[0]).toBe(128); // 톤 범위(50) 밖 중간톤도 불변
  });

  it("밝을수록 복구량이 크다", () => {
    const before = makeGrayRow([215, 245]);
    const after = makeGrayRow([215, 245]);
    applyShadowHighlight(after, { ...DEFAULT_SHADOW_HIGHLIGHT, highlights: 70 });
    const nearShift = pixelAt(before, 0)[0]! - pixelAt(after, 0)[0]!;
    const brightShift = pixelAt(before, 1)[0]! - pixelAt(after, 1)[0]!;
    expect(brightShift).toBeGreaterThan(nearShift);
    expect(nearShift).toBeGreaterThan(0);
  });
});

describe("applyShadowHighlight — 톤 범위(tonal width)", () => {
  it("섀도우 톤 범위를 넓히면 같은 중간 어둠 픽셀이 더 많이 밝아진다", () => {
    const narrow = makeGrayRow([110]);
    const wide = makeGrayRow([110]);
    applyShadowHighlight(narrow, { ...DEFAULT_SHADOW_HIGHLIGHT, shadows: 60, shadowsWidth: 30 });
    applyShadowHighlight(wide, { ...DEFAULT_SHADOW_HIGHLIGHT, shadows: 60, shadowsWidth: 90 });
    expect(pixelAt(narrow, 0)[0]).toBe(110); // 좁은 범위(76.5) 밖 — 불변
    expect(pixelAt(wide, 0)[0]!).toBeGreaterThan(110); // 넓은 범위 안 — 리프트
  });

  it("하이라이트 톤 범위를 넓히면 같은 중간 밝음 픽셀이 더 많이 복구된다", () => {
    const narrow = makeGrayRow([160]);
    const wide = makeGrayRow([160]);
    applyShadowHighlight(narrow, { ...DEFAULT_SHADOW_HIGHLIGHT, highlights: 60, highlightsWidth: 30 });
    applyShadowHighlight(wide, { ...DEFAULT_SHADOW_HIGHLIGHT, highlights: 60, highlightsWidth: 90 });
    expect(pixelAt(narrow, 0)[0]).toBe(160); // 좁은 범위 밖 — 불변
    expect(pixelAt(wide, 0)[0]!).toBeLessThan(160); // 넓은 범위 안 — 복구
  });
});

describe("applyShadowHighlight — 중간톤 대비", () => {
  it("양수 대비는 128 중심으로 중간톤을 벌린다", () => {
    const before = makeGrayRow([100, 156]);
    const after = makeGrayRow([100, 156]);
    applyShadowHighlight(after, { ...DEFAULT_SHADOW_HIGHLIGHT, midtoneContrast: 40 });
    const spreadBefore = pixelAt(before, 1)[0]! - pixelAt(before, 0)[0]!;
    const spreadAfter = pixelAt(after, 1)[0]! - pixelAt(after, 0)[0]!;
    expect(spreadAfter).toBeGreaterThan(spreadBefore);
  });

  it("음수 대비는 중간톤을 모아 플랫하게 만든다", () => {
    const before = makeGrayRow([100, 156]);
    const after = makeGrayRow([100, 156]);
    applyShadowHighlight(after, { ...DEFAULT_SHADOW_HIGHLIGHT, midtoneContrast: -40 });
    const spreadBefore = pixelAt(before, 1)[0]! - pixelAt(before, 0)[0]!;
    const spreadAfter = pixelAt(after, 1)[0]! - pixelAt(after, 0)[0]!;
    expect(spreadAfter).toBeLessThan(spreadBefore);
    expect(spreadAfter).toBeGreaterThanOrEqual(0); // 톤이 뒤집히진 않는다
  });
});

describe("applyShadowHighlight — 색상(hue) 보존 / 알파 / 극단값", () => {
  it("RGB를 휘도 비율로 함께 스케일해 채널 비율(hue)을 보존한다", () => {
    const img = makeImage(1, 1, [[90, 60, 30, 255]]);
    applyShadowHighlight(img, { ...DEFAULT_SHADOW_HIGHLIGHT, shadows: 60 });
    const [r, g, b, a] = pixelAt(img, 0) as [number, number, number, number];
    expect(r).toBeGreaterThan(90); // 리프트됨
    // 반올림 오차 안에서 채널 비율 유지(원본 90:60:30 = 3:2:1).
    expect(g / r).toBeCloseTo(60 / 90, 1);
    expect(b / r).toBeCloseTo(30 / 90, 1);
    expect(a).toBe(255);
  });

  it("알파는 어떤 조합에서도 보존된다", () => {
    const alphas = [0, 51, 128, 255];
    const img = makeImage(
      4,
      1,
      alphas.map((a, x) => [40 + x * 60, 40 + x * 50, 40 + x * 40, a])
    );
    applyShadowHighlight(img, {
      shadows: 60,
      shadowsWidth: 70,
      highlights: 60,
      highlightsWidth: 70,
      midtoneContrast: 25,
    });
    alphas.forEach((a, x) => {
      expect(pixelAt(img, x)[3]).toBe(a);
    });
  });

  it("순흑/순백 포함 전체 조합에서 유한 0..255 범위를 벗어나지 않는다", () => {
    const img = makeGrayRow([0, 1, 64, 128, 192, 254, 255]);
    expect(() =>
      applyShadowHighlight(img, {
        shadows: 100,
        shadowsWidth: 100,
        highlights: 100,
        highlightsWidth: 100,
        midtoneContrast: 50,
      })
    ).not.toThrow();
    for (const v of img.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    expect(pixelAt(img, 0).slice(0, 3)).toEqual([0, 0, 0]); // 순흑 유지
  });
});

describe("applyShadowHighlight — 결정성 / LUT", () => {
  it("같은 입력이면 항상 같은 출력(결정적)", () => {
    const params: ShadowHighlight = {
      shadows: 42,
      shadowsWidth: 65,
      highlights: 33,
      highlightsWidth: 45,
      midtoneContrast: 18,
    };
    const a = makeGrayRow([10, 60, 120, 180, 240]);
    const b = makeGrayRow([10, 60, 120, 180, 240]);
    applyShadowHighlight(a, params);
    applyShadowHighlight(b, params);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("LUT는 256칸이고 항등 파라미터에서 항등 매핑이다", () => {
    const lut = buildShadowHighlightLut(DEFAULT_SHADOW_HIGHLIGHT);
    expect(lut).toHaveLength(256);
    for (let l = 0; l < 256; l += 1) expect(lut[l]).toBe(l);
  });

  it("같은 파라미터로 재요청하면 캐시된 동일 LUT를 돌려준다", () => {
    const params = normalizeShadowHighlight({ shadows: 30, highlights: 20 });
    const first = buildShadowHighlightLut(params);
    const second = buildShadowHighlightLut({ ...params });
    expect(second).toBe(first);
  });
});

describe("SHADOW_HIGHLIGHT_PRESETS", () => {
  it("첫 항목은 neutral/기본 항등", () => {
    const first = SHADOW_HIGHLIGHT_PRESETS[0]!;
    expect(first.id).toBe("neutral");
    expect(first.label).toBe("기본");
    expect(isIdentityShadowHighlight(first.value)).toBe(true);
  });

  it("프리셋이 6개 내외다", () => {
    expect(SHADOW_HIGHLIGHT_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("id는 모두 고유하다", () => {
    const ids = SHADOW_HIGHLIGHT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of SHADOW_HIGHLIGHT_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeShadowHighlight와 동일(범위 안)", () => {
    for (const p of SHADOW_HIGHLIGHT_PRESETS) {
      expect(p.value).toEqual(normalizeShadowHighlight(p.value));
    }
  });
});

describe("shadowHighlightKonvaFilter", () => {
  it("flat attrs(sh*)를 읽어 픽셀을 변형한다 — applyShadowHighlight와 동일", () => {
    const img = makeGrayRow([40, 128, 235]);
    shadowHighlightKonvaFilter.call(
      { attrs: { shShadows: 60, shHighlights: 40, shShadowsWidth: 50, shHighlightsWidth: 50 } },
      img
    );

    const ref = makeGrayRow([40, 128, 235]);
    applyShadowHighlight(ref, normalizeShadowHighlight({ shadows: 60, highlights: 40 }));
    expect(Array.from(img.data)).toEqual(Array.from(ref.data));
    expect(pixelAt(img, 0)[0]!).toBeGreaterThan(40);
    expect(pixelAt(img, 2)[0]!).toBeLessThan(235);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => shadowHighlightKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => shadowHighlightKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시되어 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    const attrs = { shShadows: "x", shHighlights: Number.NaN };
    expect(() => shadowHighlightKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });

  it("항등(양·대비 0)으로 정규화되는 attrs는 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    shadowHighlightKonvaFilter.call(
      { attrs: { shShadows: 0, shHighlights: 0, shMidtoneContrast: 0, shShadowsWidth: 80 } },
      img
    );
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: ShadowHighlight = DEFAULT_SHADOW_HIGHLIGHT;
void _typecheck;
