import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEVELS,
  LEVELS_PRESETS,
  LEVELS_RANGES,
  applyLevels,
  buildLevelsLut,
  isIdentityLevels,
  levelsKonvaFilter,
  normalizeLevels,
  type LevelsParams,
} from "./studio-levels";

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

describe("DEFAULT_LEVELS / isIdentityLevels", () => {
  it("기본값은 입력 0..255·감마 1·출력 0..255 항등", () => {
    expect(DEFAULT_LEVELS).toEqual({ blackPoint: 0, whitePoint: 255, gamma: 1, outBlack: 0, outWhite: 255 });
    expect(isIdentityLevels(DEFAULT_LEVELS)).toBe(true);
  });

  it("어느 한 값이라도 다르면 항등이 아니다", () => {
    expect(isIdentityLevels({ ...DEFAULT_LEVELS, blackPoint: 10 })).toBe(false);
    expect(isIdentityLevels({ ...DEFAULT_LEVELS, whitePoint: 200 })).toBe(false);
    expect(isIdentityLevels({ ...DEFAULT_LEVELS, gamma: 1.2 })).toBe(false);
    expect(isIdentityLevels({ ...DEFAULT_LEVELS, outBlack: 5 })).toBe(false);
    expect(isIdentityLevels({ ...DEFAULT_LEVELS, outWhite: 250 })).toBe(false);
  });
});

describe("normalizeLevels", () => {
  it("undefined/null → 기본값", () => {
    expect(normalizeLevels()).toEqual(DEFAULT_LEVELS);
    expect(normalizeLevels(null)).toEqual(DEFAULT_LEVELS);
  });

  it("누락 키는 기본값으로 채운다", () => {
    expect(normalizeLevels({ blackPoint: 20 })).toEqual({ ...DEFAULT_LEVELS, blackPoint: 20 });
  });

  it("범위 밖 숫자는 LEVELS_RANGES로 클램프", () => {
    const out = normalizeLevels({
      blackPoint: -50,
      whitePoint: 9999,
      gamma: 99,
      outBlack: -10,
      outWhite: 9999,
    });
    expect(out.blackPoint).toBe(LEVELS_RANGES.blackPoint.min);
    expect(out.whitePoint).toBe(LEVELS_RANGES.whitePoint.max);
    expect(out.gamma).toBe(LEVELS_RANGES.gamma.max);
    expect(out.outBlack).toBe(LEVELS_RANGES.outBlack.min);
    expect(out.outWhite).toBe(LEVELS_RANGES.outWhite.max);
  });

  it("작은 감마도 하한으로 클램프", () => {
    expect(normalizeLevels({ gamma: 0.001 }).gamma).toBe(LEVELS_RANGES.gamma.min);
  });

  it("whitePoint<=blackPoint면 입력 한 쌍을 항등(0/255)으로 복원", () => {
    const equal = normalizeLevels({ blackPoint: 100, whitePoint: 100 });
    expect(equal.blackPoint).toBe(0);
    expect(equal.whitePoint).toBe(255);

    const inverted = normalizeLevels({ blackPoint: 200, whitePoint: 50 });
    expect(inverted.blackPoint).toBe(0);
    expect(inverted.whitePoint).toBe(255);
    // 흰점이 검정점보다 위라는 불변식은 항상 성립.
    expect(inverted.whitePoint).toBeGreaterThan(inverted.blackPoint);
  });

  it("정상 범위는 흰점>검정점을 보존한다", () => {
    const ok = normalizeLevels({ blackPoint: 30, whitePoint: 220 });
    expect(ok.blackPoint).toBe(30);
    expect(ok.whitePoint).toBe(220);
  });

  it("숫자가 아닌 값은 기본값", () => {
    const out = normalizeLevels({
      blackPoint: "20" as unknown as number,
      whitePoint: Number.NaN,
      gamma: Number.POSITIVE_INFINITY,
      outBlack: null as unknown as number,
      outWhite: undefined,
    });
    expect(out).toEqual(DEFAULT_LEVELS);
  });
});

describe("buildLevelsLut", () => {
  it("항등 설정은 LUT[i]===i (길이 256)", () => {
    const lut = buildLevelsLut(DEFAULT_LEVELS);
    expect(lut.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(i);
    }
  });

  it("blackPoint=128이면 128 미만 입력은 0으로", () => {
    const lut = buildLevelsLut({ ...DEFAULT_LEVELS, blackPoint: 128 });
    expect(lut[0]).toBe(0);
    expect(lut[127]).toBe(0);
    expect(lut[128]).toBe(0); // 정확히 검정점이면 t=0
    expect(lut[255]).toBe(255);
  });

  it("감마 2는 중간톤을 밝게 끌어올린다(LUT[128]>128)", () => {
    const lut = buildLevelsLut({ ...DEFAULT_LEVELS, gamma: 2 });
    expect(lut[128]!).toBeGreaterThan(128);
    // 끝점은 고정.
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });

  it("outBlack=50이면 LUT[0]===50, outWhite는 상한", () => {
    const lut = buildLevelsLut({ ...DEFAULT_LEVELS, outBlack: 50 });
    expect(lut[0]).toBe(50);
    expect(lut[255]).toBe(255);
  });

  it("출력 폭을 좁히면 끝점이 outBlack/outWhite로 매핑", () => {
    const lut = buildLevelsLut({ ...DEFAULT_LEVELS, outBlack: 25, outWhite: 230 });
    expect(lut[0]).toBe(25);
    expect(lut[255]).toBe(230);
  });
});

describe("applyLevels", () => {
  it("항등이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyLevels(img, DEFAULT_LEVELS);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("대비 강화(20..235)는 회색을 LUT 기대값으로 민다 + 알파 보존", () => {
    const params = normalizeLevels({ blackPoint: 20, whitePoint: 235 });
    const lut = buildLevelsLut(params);
    const img = makeImage(1, 1, [[64, 64, 64, 77]]);
    applyLevels(img, params);
    const expected = lut[64]!;
    expect(pixelAt(img, 0)).toEqual([expected, expected, expected, 77]);
    // 어두운 회색은 검정점 쪽으로 더 눌려 원본보다 어두워진다(대비 증가).
    expect(expected).toBeLessThan(64);
  });

  it("채널별로 독립 매핑하고 알파는 절대 건드리지 않는다", () => {
    const params = normalizeLevels({ outBlack: 50 });
    const lut = buildLevelsLut(params);
    const img = makeImage(1, 1, [[0, 128, 255, 123]]);
    applyLevels(img, params);
    expect(pixelAt(img, 0)).toEqual([lut[0]!, lut[128]!, lut[255]!, 123]);
    expect(lut[0]).toBe(50);
  });
});

describe("LEVELS_PRESETS", () => {
  it("첫 항목은 identity/기본 항등", () => {
    const first = LEVELS_PRESETS[0]!;
    expect(first.id).toBe("identity");
    expect(first.label).toBe("기본");
    expect(isIdentityLevels(first.params)).toBe(true);
  });

  it("프리셋이 9개 이상이다", () => {
    expect(LEVELS_PRESETS.length).toBeGreaterThanOrEqual(9);
  });

  it("id는 모두 고유하다", () => {
    const ids = LEVELS_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of LEVELS_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 params가 normalizeLevels와 동일(범위 안·흰점>검정점)", () => {
    for (const p of LEVELS_PRESETS) {
      expect(p.params).toEqual(normalizeLevels(p.params));
      expect(p.params.whitePoint).toBeGreaterThan(p.params.blackPoint);
    }
  });
});

describe("levelsKonvaFilter", () => {
  it("attrs에서 5개 값을 읽어 픽셀을 변형한다", () => {
    const img = makeImage(1, 1, [[128, 128, 128, 90]]);
    const attrs = {
      levelsBlack: 30,
      levelsWhite: 220,
      levelsGamma: 1,
      levelsOutBlack: 0,
      levelsOutWhite: 255,
    };
    levelsKonvaFilter.call({ attrs }, img);
    const lut = buildLevelsLut(normalizeLevels({ blackPoint: 30, whitePoint: 220 }));
    const expected = lut[128]!;
    expect(pixelAt(img, 0)).toEqual([expected, expected, expected, 90]);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => levelsKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => levelsKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("항등으로 정규화되는 attrs는 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    const attrs = {
      levelsBlack: 0,
      levelsWhite: 255,
      levelsGamma: 1,
      levelsOutBlack: 0,
      levelsOutWhite: 255,
    };
    levelsKonvaFilter.call({ attrs }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시되어 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    const attrs = {
      levelsBlack: "x" as unknown as number,
      levelsWhite: Number.NaN,
      levelsGamma: null,
    };
    expect(() => levelsKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: LevelsParams = DEFAULT_LEVELS;
void _typecheck;

describe("levels hostile direct-call safety", () => {
  it("apply/build normalize NaN and huge values without mutating caller params", () => {
    const params = Object.freeze({
      blackPoint: Number.NaN,
      whitePoint: Number.POSITIVE_INFINITY,
      gamma: Number.NaN,
      outBlack: -1e12,
      outWhite: 1e12,
    }) as LevelsParams;
    const img = makeImage(1, 1, [[10, 20, 30, 77]]);
    expect(() => applyLevels(img, params)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 77]);
    expect(() => buildLevelsLut(params)).not.toThrow();
    expect(params.gamma).toBeNaN();
  });
});
