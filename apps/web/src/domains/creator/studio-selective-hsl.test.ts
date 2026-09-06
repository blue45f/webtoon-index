import { describe, expect, it } from "vitest";

import {
  DEFAULT_SELECTIVE_HSL,
  HSL_BANDS,
  HSL_BAND_CENTER,
  SELECTIVE_HSL_PRESETS,
  SELECTIVE_HSL_RANGE,
  applySelectiveHsl,
  flatToSelectiveHsl,
  hslToRgb,
  isIdentitySelectiveHsl,
  normalizeSelectiveHsl,
  rgbToHsl,
  selectiveHslKonvaFilter,
  selectiveHslToFlat,
  type BandAdjust,
  type SelectiveHsl,
} from "./studio-selective-hsl";

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

// 한 밴드만 조정한 SelectiveHsl을 만든다(나머지는 0).
function withBand(band: (typeof HSL_BANDS)[number], adj: Partial<BandAdjust>): SelectiveHsl {
  return normalizeSelectiveHsl({ [band]: { hue: 0, sat: 0, lum: 0, ...adj } });
}

// ---------------------------------------------------------------------------

describe("HSL_BANDS / HSL_BAND_CENTER", () => {
  it("8개 밴드가 고정 순서대로다", () => {
    expect(HSL_BANDS).toEqual(["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]);
  });

  it("각 밴드 중심 hue가 명세와 같다", () => {
    expect(HSL_BAND_CENTER).toEqual({
      red: 0,
      orange: 30,
      yellow: 60,
      green: 120,
      aqua: 180,
      blue: 240,
      purple: 280,
      magenta: 320,
    });
  });
});

describe("DEFAULT_SELECTIVE_HSL / isIdentitySelectiveHsl", () => {
  it("기본값은 모든 밴드 {0,0,0} 항등", () => {
    for (const band of HSL_BANDS) {
      expect(DEFAULT_SELECTIVE_HSL[band]).toEqual({ hue: 0, sat: 0, lum: 0 });
    }
    expect(isIdentitySelectiveHsl(DEFAULT_SELECTIVE_HSL)).toBe(true);
  });

  it("어느 한 채널이라도 0이 아니면 항등이 아니다", () => {
    expect(isIdentitySelectiveHsl(withBand("red", { hue: 1 }))).toBe(false);
    expect(isIdentitySelectiveHsl(withBand("blue", { sat: -3 }))).toBe(false);
    expect(isIdentitySelectiveHsl(withBand("green", { lum: 5 }))).toBe(false);
  });
});

describe("SELECTIVE_HSL_RANGE", () => {
  it("범위는 -100..100, step 1", () => {
    expect(SELECTIVE_HSL_RANGE).toEqual({ min: -100, max: 100, step: 1 });
  });
});

describe("normalizeSelectiveHsl", () => {
  it("undefined/null → 기본값(전부 0)", () => {
    expect(normalizeSelectiveHsl()).toEqual(DEFAULT_SELECTIVE_HSL);
    expect(normalizeSelectiveHsl(null)).toEqual(DEFAULT_SELECTIVE_HSL);
  });

  it("누락 밴드는 {0,0,0}으로 채운다", () => {
    const out = normalizeSelectiveHsl({ orange: { hue: 10, sat: 20, lum: 30 } });
    expect(out.orange).toEqual({ hue: 10, sat: 20, lum: 30 });
    expect(out.red).toEqual({ hue: 0, sat: 0, lum: 0 });
    expect(out.magenta).toEqual({ hue: 0, sat: 0, lum: 0 });
    // 8개 밴드 키가 모두 존재한다.
    expect(Object.keys(out).sort()).toEqual([...HSL_BANDS].sort());
  });

  it("누락 채널은 0으로 채운다(부분 밴드)", () => {
    const out = normalizeSelectiveHsl({ blue: { sat: 40 } as Partial<BandAdjust> as BandAdjust });
    expect(out.blue).toEqual({ hue: 0, sat: 40, lum: 0 });
  });

  it("범위 밖 숫자는 -100..100으로 클램프", () => {
    const out = normalizeSelectiveHsl({
      red: { hue: 999, sat: -999, lum: 100 },
      green: { hue: -101, sat: 101, lum: 250 },
    });
    expect(out.red).toEqual({ hue: 100, sat: -100, lum: 100 });
    expect(out.green).toEqual({ hue: -100, sat: 100, lum: 100 });
  });

  it("숫자가 아닌 값은 0", () => {
    const out = normalizeSelectiveHsl({
      red: { hue: "20", sat: Number.NaN, lum: Number.POSITIVE_INFINITY } as unknown as BandAdjust,
      aqua: { hue: null, sat: undefined, lum: {} } as unknown as BandAdjust,
      purple: "nope" as unknown as BandAdjust,
    });
    expect(out.red).toEqual({ hue: 0, sat: 0, lum: 0 });
    expect(out.aqua).toEqual({ hue: 0, sat: 0, lum: 0 });
    expect(out.purple).toEqual({ hue: 0, sat: 0, lum: 0 });
  });

  it("정규화는 안정적이다(정규화의 정규화는 동일)", () => {
    const once = normalizeSelectiveHsl({ orange: { hue: 5, sat: 30, lum: -10 }, blue: { hue: -8, sat: 40, lum: 6 } });
    expect(normalizeSelectiveHsl(once)).toEqual(once);
  });
});

describe("rgbToHsl / hslToRgb", () => {
  it("순색이 정확한 밴드 중심 hue로 매핑된다", () => {
    expect(rgbToHsl(255, 0, 0).h).toBeCloseTo(0, 5);
    expect(rgbToHsl(255, 255, 0).h).toBeCloseTo(60, 5);
    expect(rgbToHsl(0, 255, 0).h).toBeCloseTo(120, 5);
    expect(rgbToHsl(0, 255, 255).h).toBeCloseTo(180, 5);
    expect(rgbToHsl(0, 0, 255).h).toBeCloseTo(240, 5);
  });

  it("무채색은 s=0(h는 0)", () => {
    const gray = rgbToHsl(128, 128, 128);
    expect(gray.s).toBe(0);
    expect(gray.h).toBe(0);
    expect(gray.l).toBeCloseTo(128 / 255, 5);
    expect(rgbToHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
    expect(rgbToHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 1 });
  });

  it("s=0이면 hslToRgb는 회색(l*255 동일 채널)", () => {
    expect(hslToRgb(123, 0, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
    expect(hslToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(hslToRgb(0, 0, 1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("RGB→HSL→RGB 왕복이 오차 ≤1로 복원된다", () => {
    let maxErr = 0;
    for (let r = 0; r <= 255; r += 15) {
      for (let g = 0; g <= 255; g += 15) {
        for (let b = 0; b <= 255; b += 15) {
          const { h, s, l } = rgbToHsl(r, g, b);
          const o = hslToRgb(h, s, l);
          maxErr = Math.max(maxErr, Math.abs(o.r - r), Math.abs(o.g - g), Math.abs(o.b - b));
        }
      }
    }
    expect(maxErr).toBeLessThanOrEqual(1);
  });

  it("hslToRgb는 hue를 0..360으로 감아 처리한다(음수/초과)", () => {
    expect(hslToRgb(-120, 1, 0.5)).toEqual(hslToRgb(240, 1, 0.5));
    expect(hslToRgb(420, 1, 0.5)).toEqual(hslToRgb(60, 1, 0.5));
  });
});

describe("applySelectiveHsl", () => {
  it("항등(전부 0)이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applySelectiveHsl(img, DEFAULT_SELECTIVE_HSL);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("blue +sat는 BLUE 픽셀 채도를 올리지만 RED 픽셀은 건드리지 않는다(밴드 타깃)", () => {
    const s = withBand("blue", { sat: 60 });
    // 둘 다 채도가 1 미만이라 올라갈 여유가 있다. blue는 h≈240, red는 h≈0.
    const bluePx = makeImage(1, 1, [[60, 60, 180, 200]]);
    const redPx = makeImage(1, 1, [[180, 60, 60, 200]]);

    const blueBefore = rgbToHsl(60, 60, 180).s;
    const redBefore = rgbToHsl(180, 60, 60).s;

    applySelectiveHsl(bluePx, s);
    applySelectiveHsl(redPx, s);

    const blueAfter = rgbToHsl(pixelAt(bluePx, 0)[0]!, pixelAt(bluePx, 0)[1]!, pixelAt(bluePx, 0)[2]!).s;
    const redAfter = rgbToHsl(pixelAt(redPx, 0)[0]!, pixelAt(redPx, 0)[1]!, pixelAt(redPx, 0)[2]!).s;

    expect(blueAfter).toBeGreaterThan(blueBefore + 0.05); // BLUE 채도 상승
    expect(redAfter).toBeCloseTo(redBefore, 5); // RED는 그대로
    // RED 픽셀 RGB가 변하지 않았고 알파 보존.
    expect(pixelAt(redPx, 0)).toEqual([180, 60, 60, 200]);
    expect(pixelAt(bluePx, 0)[3]).toBe(200); // BLUE 알파 보존
  });

  it("blue -sat는 BLUE 픽셀 채도를 내린다", () => {
    const s = withBand("blue", { sat: -60 });
    const bluePx = makeImage(1, 1, [[40, 40, 200, 255]]);
    const before = rgbToHsl(40, 40, 200).s;
    applySelectiveHsl(bluePx, s);
    const after = rgbToHsl(pixelAt(bluePx, 0)[0]!, pixelAt(bluePx, 0)[1]!, pixelAt(bluePx, 0)[2]!).s;
    expect(after).toBeLessThan(before);
    expect(pixelAt(bluePx, 0)[3]).toBe(255);
  });

  it("blue +lum은 BLUE 픽셀 휘도를 올린다", () => {
    const s = withBand("blue", { lum: 30 });
    const bluePx = makeImage(1, 1, [[40, 40, 160, 128]]);
    const before = rgbToHsl(40, 40, 160).l;
    applySelectiveHsl(bluePx, s);
    const after = rgbToHsl(pixelAt(bluePx, 0)[0]!, pixelAt(bluePx, 0)[1]!, pixelAt(bluePx, 0)[2]!).l;
    expect(after).toBeGreaterThan(before);
    expect(pixelAt(bluePx, 0)[3]).toBe(128);
  });

  it("red +hue는 RED 픽셀 색조를 회전시킨다(+30°까지)", () => {
    const s = withBand("red", { hue: 100 }); // (100/100)*30 = +30°
    const redPx = makeImage(1, 1, [[200, 40, 40, 255]]);
    // 원본 hue는 ≈0(빨강). 적용 후 +30° 부근(주황 쪽)으로 이동해야 한다.
    applySelectiveHsl(redPx, s);
    const after = rgbToHsl(pixelAt(redPx, 0)[0]!, pixelAt(redPx, 0)[1]!, pixelAt(redPx, 0)[2]!).h;
    // 0°에서 +30° 부근으로 이동(주황 쪽). 왕복 반올림 오차 감안.
    expect(after).toBeGreaterThan(20);
    expect(after).toBeLessThan(40);
    expect(pixelAt(redPx, 0)[3]).toBe(255);
  });

  it("무채색(회색) 픽셀은 hue 조정으로 물들지 않는다(sat=0 가드)", () => {
    // 모든 밴드에 강한 hue 회전을 줘도 회색은 색이 생기지 않아야 한다.
    const s = normalizeSelectiveHsl(
      Object.fromEntries(HSL_BANDS.map((b) => [b, { hue: 100, sat: 0, lum: 0 }])) as Partial<SelectiveHsl>
    );
    const gray = makeImage(1, 1, [[128, 128, 128, 90]]);
    applySelectiveHsl(gray, s);
    const px = pixelAt(gray, 0);
    // R=G=B 유지(채도 0 유지) + 알파 보존.
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[3]).toBe(90);
    // 휘도(밝기)도 거의 그대로(hue/sat만 줬으므로).
    expect(px[0]).toBeCloseTo(128, -1);
  });

  it("무채색 픽셀에 +lum/-lum은 적용된다(밝기만 바뀜, 색은 유지)", () => {
    const s = normalizeSelectiveHsl(
      Object.fromEntries(HSL_BANDS.map((b) => [b, { hue: 0, sat: 0, lum: 25 }])) as Partial<SelectiveHsl>
    );
    const gray = makeImage(1, 1, [[120, 120, 120, 255]]);
    applySelectiveHsl(gray, s);
    const px = pixelAt(gray, 0);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[0]!).toBeGreaterThan(120); // 밝아진다
  });

  it("알파 채널은 보존된다(여러 픽셀)", () => {
    const s = withBand("green", { sat: 40, lum: 10 });
    const img = makeImage(3, 1, [
      [20, 200, 20, 11],
      [40, 180, 40, 222],
      [128, 128, 128, 77],
    ]);
    applySelectiveHsl(img, s);
    expect(pixelAt(img, 0)[3]).toBe(11);
    expect(pixelAt(img, 1)[3]).toBe(222);
    expect(pixelAt(img, 2)[3]).toBe(77);
  });

  it("green 조정은 BLUE 픽셀을 건드리지 않는다(밴드 분리)", () => {
    const s = withBand("green", { sat: 80, lum: 20, hue: 50 });
    const bluePx = makeImage(1, 1, [[0, 0, 255, 255]]); // h=240, green 가중 0
    applySelectiveHsl(bluePx, s);
    expect(pixelAt(bluePx, 0)).toEqual([0, 0, 255, 255]);
  });
});

describe("selectiveHslToFlat / flatToSelectiveHsl", () => {
  it("flat은 8밴드×3 = 24개, 순서 고정([hue,sat,lum] 반복)", () => {
    const s = normalizeSelectiveHsl({
      red: { hue: 1, sat: 2, lum: 3 },
      magenta: { hue: 22, sat: 23, lum: 24 },
    });
    const flat = selectiveHslToFlat(s);
    expect(flat.length).toBe(24);
    expect(flat.slice(0, 3)).toEqual([1, 2, 3]); // red
    expect(flat.slice(21, 24)).toEqual([22, 23, 24]); // magenta(마지막)
  });

  it("객체→flat→객체 왕복이 동일하다", () => {
    const s = normalizeSelectiveHsl({
      orange: { hue: 5, sat: 30, lum: -10 },
      green: { hue: -25, sat: -35, lum: 0 },
      blue: { hue: -8, sat: 40, lum: 6 },
    });
    expect(flatToSelectiveHsl(selectiveHslToFlat(s))).toEqual(s);
  });

  it("flatToSelectiveHsl은 짧은/무효 배열을 안전 처리(0/클램프)", () => {
    expect(flatToSelectiveHsl([])).toEqual(DEFAULT_SELECTIVE_HSL);
    expect(flatToSelectiveHsl(undefined as unknown as number[])).toEqual(DEFAULT_SELECTIVE_HSL);
    // 첫 밴드(red)만 일부 채워진 배열.
    const out = flatToSelectiveHsl([999, -999, 7]);
    expect(out.red).toEqual({ hue: 100, sat: -100, lum: 7 });
    expect(out.orange).toEqual({ hue: 0, sat: 0, lum: 0 });
  });
});

describe("SELECTIVE_HSL_PRESETS", () => {
  it("첫 항목은 none/기본 항등", () => {
    const first = SELECTIVE_HSL_PRESETS[0]!;
    expect(first.id).toBe("none");
    expect(first.label).toBe("기본");
    expect(isIdentitySelectiveHsl(first.value)).toBe(true);
    expect(first.value).toEqual(DEFAULT_SELECTIVE_HSL);
  });

  it("프리셋이 여러 개다(8개 내외)", () => {
    expect(SELECTIVE_HSL_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(SELECTIVE_HSL_PRESETS.length).toBeLessThanOrEqual(10);
  });

  it("id는 모두 고유하다", () => {
    const ids = SELECTIVE_HSL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of SELECTIVE_HSL_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 범위 안이고 normalizeSelectiveHsl와 동일(정규화 안정)", () => {
    for (const p of SELECTIVE_HSL_PRESETS) {
      expect(p.value).toEqual(normalizeSelectiveHsl(p.value));
      for (const band of HSL_BANDS) {
        const adj = p.value[band];
        for (const ch of ["hue", "sat", "lum"] as const) {
          expect(adj[ch]).toBeGreaterThanOrEqual(SELECTIVE_HSL_RANGE.min);
          expect(adj[ch]).toBeLessThanOrEqual(SELECTIVE_HSL_RANGE.max);
        }
      }
    }
  });

  it("none을 제외한 프리셋은 실제로 픽셀을 바꾼다(항등이 아니다)", () => {
    for (const p of SELECTIVE_HSL_PRESETS.slice(1)) {
      expect(isIdentitySelectiveHsl(p.value)).toBe(false);
    }
  });
});

describe("selectiveHslKonvaFilter", () => {
  it("flat attrs(selectiveHsl 24)를 읽어 픽셀을 변형한다", () => {
    const s = withBand("blue", { sat: 60 });
    const flat = selectiveHslToFlat(s);
    const img = makeImage(1, 1, [[60, 60, 180, 200]]);
    selectiveHslKonvaFilter.call({ attrs: { selectiveHsl: flat } }, img);

    // 직접 applySelectiveHsl 결과와 동일해야 한다.
    const ref = makeImage(1, 1, [[60, 60, 180, 200]]);
    applySelectiveHsl(ref, s);
    expect(pixelAt(img, 0)).toEqual(pixelAt(ref, 0));
    expect(pixelAt(img, 0)[3]).toBe(200); // 알파 보존
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => selectiveHslKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => selectiveHslKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("selectiveHsl이 배열이 아니면 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    expect(() => selectiveHslKonvaFilter.call({ attrs: { selectiveHsl: "x" } }, img)).not.toThrow();
    expect(() => selectiveHslKonvaFilter.call({ attrs: { selectiveHsl: 42 } }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });

  it("전부 0으로 정규화되는 flat은 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    const flat = new Array<number>(24).fill(0);
    selectiveHslKonvaFilter.call({ attrs: { selectiveHsl: flat } }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });

  it("무효 값이 섞인 flat은 정규화로 안전 처리(항등이면 no-op)", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    const flat = new Array<number>(24).fill(Number.NaN);
    expect(() => selectiveHslKonvaFilter.call({ attrs: { selectiveHsl: flat } }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: SelectiveHsl = DEFAULT_SELECTIVE_HSL;
void _typecheck;
