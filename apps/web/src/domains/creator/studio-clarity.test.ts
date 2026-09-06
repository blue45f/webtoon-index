import { describe, expect, it } from "vitest";

import {
  CLARITY_PRESETS,
  CLARITY_RANGE,
  DEFAULT_CLARITY,
  DEHAZE_RANGE,
  applyClarity,
  clarityKonvaFilter,
  isIdentityClarity,
  normalizeClarity,
  type Clarity,
} from "./studio-clarity";

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

describe("DEFAULT_CLARITY / isIdentityClarity", () => {
  it("기본값은 둘 다 0인 항등", () => {
    expect(DEFAULT_CLARITY).toEqual({ clarity: 0, dehaze: 0 });
    expect(isIdentityClarity(DEFAULT_CLARITY)).toBe(true);
  });

  it("어느 한 값이라도 0이 아니면 항등이 아니다", () => {
    expect(isIdentityClarity({ clarity: 1, dehaze: 0 })).toBe(false);
    expect(isIdentityClarity({ clarity: 0, dehaze: 1 })).toBe(false);
    expect(isIdentityClarity({ clarity: -10, dehaze: 20 })).toBe(false);
  });
});

describe("CLARITY_RANGE / DEHAZE_RANGE", () => {
  it("선명도 범위는 -100..100, step 1", () => {
    expect(CLARITY_RANGE).toEqual({ min: -100, max: 100, step: 1 });
  });
  it("디헤이즈 범위는 0..100, step 1", () => {
    expect(DEHAZE_RANGE).toEqual({ min: 0, max: 100, step: 1 });
  });
});

describe("normalizeClarity", () => {
  it("undefined/null → 기본값(둘 다 0)", () => {
    expect(normalizeClarity()).toEqual(DEFAULT_CLARITY);
    expect(normalizeClarity(null)).toEqual(DEFAULT_CLARITY);
  });

  it("누락 키는 0으로 채운다", () => {
    expect(normalizeClarity({ clarity: 30 })).toEqual({ clarity: 30, dehaze: 0 });
    expect(normalizeClarity({ dehaze: 40 })).toEqual({ clarity: 0, dehaze: 40 });
  });

  it("범위 밖 숫자는 각 범위로 클램프(clarity -100..100, dehaze 0..100)", () => {
    expect(normalizeClarity({ clarity: 999, dehaze: 999 })).toEqual({ clarity: 100, dehaze: 100 });
    expect(normalizeClarity({ clarity: -999, dehaze: -999 })).toEqual({ clarity: -100, dehaze: 0 });
  });

  it("숫자가 아닌 값/NaN/Infinity는 0", () => {
    const out = normalizeClarity({
      clarity: "50" as unknown as number,
      dehaze: Number.NaN,
    });
    expect(out).toEqual({ clarity: 0, dehaze: 0 });
    expect(normalizeClarity({ clarity: Number.POSITIVE_INFINITY, dehaze: 30 })).toEqual({ clarity: 0, dehaze: 30 });
  });
});

describe("applyClarity — 항등/no-op", () => {
  it("항등(둘 다 0)이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyClarity(img, DEFAULT_CLARITY);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });
});

describe("applyClarity — 선명도(로컬 대비)", () => {
  it("양수 선명도는 중간톤 엣지의 로컬 대비를 키운다", () => {
    // 가로 16px 스텝 엣지: 왼쪽 100(중간 어둠) → 오른쪽 156(중간 밝음).
    const values = Array.from({ length: 16 }, (_, x) => (x < 8 ? 100 : 156));
    const before = makeGrayRow(values);
    const after = makeGrayRow(values);
    applyClarity(after, { clarity: 60, dehaze: 0 });

    // 경계 픽셀(7=어두운 끝, 8=밝은 끝)의 대비가 커진다.
    const edgeBefore = pixelAt(before, 8)[0]! - pixelAt(before, 7)[0]!;
    const edgeAfter = pixelAt(after, 8)[0]! - pixelAt(after, 7)[0]!;
    expect(edgeAfter).toBeGreaterThan(edgeBefore);
    // 어두운 쪽은 더 어둡게, 밝은 쪽은 더 밝게(언샤프).
    expect(pixelAt(after, 7)[0]!).toBeLessThan(100);
    expect(pixelAt(after, 8)[0]!).toBeGreaterThan(156);
  });

  it("엣지에서 먼 평탄한 영역은 거의 변하지 않는다(로컬 평균≈자기 자신)", () => {
    const values = Array.from({ length: 16 }, (_, x) => (x < 8 ? 100 : 156));
    const after = makeGrayRow(values);
    applyClarity(after, { clarity: 60, dehaze: 0 });
    // 양 끝(x=0, x=15)은 주변이 균일해 detail≈0.
    expect(pixelAt(after, 0)[0]).toBe(100);
    expect(pixelAt(after, 15)[0]).toBe(156);
  });

  it("섀도/하이라이트는 보호되어 심하게 뭉개지지 않는다(midWeight≈0)", () => {
    // 섀도(5) | 중간(128) | 하이라이트(250) 세 구간.
    const values = Array.from({ length: 16 }, (_, x) => (x < 5 ? 5 : x < 10 ? 128 : 250));
    const before = makeGrayRow(values);
    const after = makeGrayRow(values);
    applyClarity(after, { clarity: 80, dehaze: 0 });

    // 순수 섀도/하이라이트 구간의 내부 픽셀은 그대로(중간톤 가중≈0).
    expect(pixelAt(after, 0)[0]).toBe(pixelAt(before, 0)[0]); // 섀도
    expect(pixelAt(after, 15)[0]).toBe(pixelAt(before, 15)[0]); // 하이라이트
    // 섀도-중간 경계에서 어두운 쪽 이동량은 작고, 중간 쪽 이동량은 크다(섀도 보호).
    const darkShift = Math.abs(pixelAt(after, 4)[0]! - pixelAt(before, 4)[0]!);
    const midShift = Math.abs(pixelAt(after, 5)[0]! - pixelAt(before, 5)[0]!);
    expect(darkShift).toBeLessThan(midShift);
    expect(darkShift).toBeLessThanOrEqual(5);
  });

  it("음수 선명도는 엣지의 로컬 대비를 눌러 부드럽게 한다", () => {
    const values = Array.from({ length: 16 }, (_, x) => (x < 8 ? 100 : 156));
    const before = makeGrayRow(values);
    const after = makeGrayRow(values);
    applyClarity(after, { clarity: -60, dehaze: 0 });

    const edgeBefore = pixelAt(before, 8)[0]! - pixelAt(before, 7)[0]!;
    const edgeAfter = pixelAt(after, 8)[0]! - pixelAt(after, 7)[0]!;
    expect(edgeAfter).toBeLessThan(edgeBefore);
    expect(edgeAfter).toBeGreaterThanOrEqual(0); // 엣지가 뒤집히진 않는다
  });
});

describe("applyClarity — 디헤이즈(전역 대비·채도)", () => {
  it("디헤이즈는 전역 대비(밝기 폭)를 넓힌다", () => {
    // 저대비 그레이 2픽셀(110, 146) — 128 중심에서 양쪽으로 벌어진다.
    const before = makeGrayRow([110, 146]);
    const after = makeGrayRow([110, 146]);
    applyClarity(after, { clarity: 0, dehaze: 60 });

    const spreadBefore = pixelAt(before, 1)[0]! - pixelAt(before, 0)[0]!;
    const spreadAfter = pixelAt(after, 1)[0]! - pixelAt(after, 0)[0]!;
    expect(spreadAfter).toBeGreaterThan(spreadBefore);
    // 어두운 쪽은 더 어둡게(<110), 밝은 쪽은 더 밝게(>146).
    expect(pixelAt(after, 0)[0]!).toBeLessThan(110);
    expect(pixelAt(after, 1)[0]!).toBeGreaterThan(146);
  });

  it("디헤이즈는 채도를 약간 올린다(휘도에서 멀어지게)", () => {
    // 채도가 있는 단일 픽셀: R 우세. 디헤이즈 후 R-G 격차가 벌어진다.
    const before = makeImage(1, 1, [[180, 120, 120, 255]]);
    const after = makeImage(1, 1, [[180, 120, 120, 255]]);
    applyClarity(after, { clarity: 0, dehaze: 80 });
    const gapBefore = pixelAt(before, 0)[0]! - pixelAt(before, 0)[1]!;
    const gapAfter = pixelAt(after, 0)[0]! - pixelAt(after, 0)[1]!;
    expect(gapAfter).toBeGreaterThan(gapBefore);
    expect(pixelAt(after, 0)[3]).toBe(255); // 알파 보존
  });
});

describe("applyClarity — 알파 보존 / 작은 이미지", () => {
  it("clarity+dehaze 동시 적용해도 알파는 그대로 보존된다", () => {
    const values = Array.from({ length: 16 }, (_, x) => (x < 8 ? 100 : 156));
    const alphas = Array.from({ length: 16 }, (_, x) => (x * 7) % 256);
    const img = makeImage(
      16,
      1,
      values.map((v, x) => [v, v, v, alphas[x]!])
    );
    applyClarity(img, { clarity: 50, dehaze: 40 });
    for (let x = 0; x < 16; x++) {
      expect(pixelAt(img, x)[3]).toBe(alphas[x]);
    }
  });

  it("반경보다 작은 2x2 이미지에서도 throw 없이 동작한다", () => {
    const img = makeImage(2, 2, [
      [100, 100, 100, 255],
      [120, 100, 100, 255],
      [140, 100, 100, 255],
      [160, 100, 100, 255],
    ]);
    expect(() => applyClarity(img, { clarity: 70, dehaze: 50 })).not.toThrow();
    // 모든 채널이 유한 0..255 범위.
    for (const v of img.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("1x1 이미지(가장 작은 케이스)도 안전하다", () => {
    const img = makeImage(1, 1, [[130, 90, 60, 200]]);
    expect(() => applyClarity(img, { clarity: 80, dehaze: 60 })).not.toThrow();
    expect(pixelAt(img, 0)[3]).toBe(200);
  });
});

describe("CLARITY_PRESETS", () => {
  it("첫 항목은 neutral/기본 항등", () => {
    const first = CLARITY_PRESETS[0]!;
    expect(first.id).toBe("neutral");
    expect(first.label).toBe("기본");
    expect(isIdentityClarity(first.value)).toBe(true);
  });

  it("프리셋이 6개 내외다", () => {
    expect(CLARITY_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("id는 모두 고유하다", () => {
    const ids = CLARITY_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of CLARITY_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 value가 normalizeClarity와 동일(범위 안)", () => {
    for (const p of CLARITY_PRESETS) {
      expect(p.value).toEqual(normalizeClarity(p.value));
      expect(p.value.clarity).toBeGreaterThanOrEqual(CLARITY_RANGE.min);
      expect(p.value.clarity).toBeLessThanOrEqual(CLARITY_RANGE.max);
      expect(p.value.dehaze).toBeGreaterThanOrEqual(DEHAZE_RANGE.min);
      expect(p.value.dehaze).toBeLessThanOrEqual(DEHAZE_RANGE.max);
    }
  });

  it("명세된 대표 프리셋 값을 담고 있다", () => {
    const byId = new Map(CLARITY_PRESETS.map((p) => [p.id, p.value]));
    expect(byId.get("crisp")).toEqual({ clarity: 40, dehaze: 0 });
    expect(byId.get("punch")).toEqual({ clarity: 70, dehaze: 0 });
    expect(byId.get("soft")).toEqual({ clarity: -40, dehaze: 0 });
    expect(byId.get("dehaze")).toEqual({ clarity: 0, dehaze: 50 });
    expect(byId.get("dramatic")).toEqual({ clarity: 50, dehaze: 30 });
  });
});

describe("clarityKonvaFilter", () => {
  it("flat attrs(clarity/dehaze)를 읽어 픽셀을 변형한다", () => {
    const values = Array.from({ length: 16 }, (_, x) => (x < 8 ? 100 : 156));
    const img = makeGrayRow(values);
    clarityKonvaFilter.call({ attrs: { clarity: 60, dehaze: 0 } }, img);

    // 엣지(7/8) 대비가 커진다 — applyClarity 직접 호출과 동일해야 한다.
    const ref = makeGrayRow(values);
    applyClarity(ref, normalizeClarity({ clarity: 60 }));
    expect(pixelAt(img, 7)).toEqual(pixelAt(ref, 7));
    expect(pixelAt(img, 8)).toEqual(pixelAt(ref, 8));
    expect(pixelAt(img, 8)[0]!).toBeGreaterThan(156);
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => clarityKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => clarityKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("무효 attrs(숫자 아님)는 안전하게 무시되어 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    const attrs = { clarity: "x", dehaze: Number.NaN };
    expect(() => clarityKonvaFilter.call({ attrs }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });

  it("항등(둘 다 0)으로 정규화되는 attrs는 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    clarityKonvaFilter.call({ attrs: { clarity: 0, dehaze: 0 } }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: Clarity = DEFAULT_CLARITY;
void _typecheck;
