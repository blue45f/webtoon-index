import { describe, expect, it } from "vitest";

import {
  CURVE_PRESETS,
  DEFAULT_CURVE,
  STUDIO_CURVE_MAX_CONTROL_POINTS,
  TONE_CHANNELS,
  addCurvePoint,
  applyCurve,
  applyCurveChannels,
  buildCurveChannelLuts,
  buildCurveLut,
  composeLuts,
  curveKonvaFilter,
  curveToFlat,
  flatToCurve,
  isIdentityCurve,
  isIdentityCurveChannels,
  moveCurvePoint,
  normalizeCurve,
  normalizeCurveChannels,
  removeCurvePoint,
  type CurvePoint,
  type CurveRgbChannels,
} from "./studio-curves";

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

describe("DEFAULT_CURVE / isIdentityCurve", () => {
  it("기본 곡선은 (0,0)→(255,255) 항등", () => {
    expect(DEFAULT_CURVE).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);
    expect(isIdentityCurve(DEFAULT_CURVE)).toBe(true);
  });

  it("끝점만 있는 직선이라도 (0,0)/(255,255)면 항등", () => {
    expect(isIdentityCurve(normalizeCurve([{ x: 0, y: 0 }, { x: 255, y: 255 }]))).toBe(true);
  });

  it("중간점을 들어올리면 더 이상 항등이 아니다", () => {
    expect(isIdentityCurve([{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }])).toBe(false);
  });
});

describe("normalizeCurve", () => {
  it("undefined/null/비배열 → 기본 곡선 복제본", () => {
    expect(normalizeCurve()).toEqual(DEFAULT_CURVE);
    expect(normalizeCurve(null)).toEqual(DEFAULT_CURVE);
    expect(normalizeCurve(undefined)).toEqual(DEFAULT_CURVE);
    // 반환값은 공유 상수가 아니라 새 배열(불변 보장).
    expect(normalizeCurve()).not.toBe(DEFAULT_CURVE);
  });

  it("유효 점이 하나도 없으면 기본 곡선", () => {
    expect(
      normalizeCurve([
        { x: Number.NaN, y: 10 },
        { x: "5" as unknown as number, y: 10 },
        { x: 10, y: Number.POSITIVE_INFINITY },
      ])
    ).toEqual(DEFAULT_CURVE);
  });

  it("범위 밖 x·y는 0..255로 클램프(반올림)", () => {
    const out = normalizeCurve([
      { x: -50, y: 300 },
      { x: 127.6, y: 63.4 },
      { x: 999, y: -20 },
    ]);
    // x=-50→0(첫 점), x=127.6→128, x=999→255(마지막 점).
    expect(out[0]).toEqual({ x: 0, y: 255 });
    expect(out).toContainEqual({ x: 128, y: 63 });
    expect(out[out.length - 1]).toEqual({ x: 255, y: 0 });
  });

  it("x 기준 오름차순으로 정렬한다", () => {
    const out = normalizeCurve([
      { x: 200, y: 200 },
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: 255, y: 255 },
    ]);
    const xs = out.map((p) => p.x);
    const sorted = [...xs].sort((a, b) => a - b);
    expect(xs).toEqual(sorted);
    expect(xs).toEqual([0, 100, 200, 255]);
  });

  it("x 중복은 정렬 후 뒤 값이 우선한다", () => {
    const out = normalizeCurve([
      { x: 0, y: 0 },
      { x: 128, y: 10 },
      { x: 128, y: 240 },
      { x: 255, y: 255 },
    ]);
    const mid = out.filter((p) => p.x === 128);
    expect(mid).toHaveLength(1);
    expect(mid[0]!.y).toBe(240);
  });

  it("끝점이 없으면 x=0·x=255를 강제로 채운다", () => {
    const out = normalizeCurve([
      { x: 40, y: 30 },
      { x: 200, y: 210 },
    ]);
    expect(out[0]!.x).toBe(0);
    expect(out[out.length - 1]!.x).toBe(255);
    // 추가된 끝점 y는 가장 가까운 점 y를 따른다.
    expect(out[0]!.y).toBe(30);
    expect(out[out.length - 1]!.y).toBe(210);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it("이미 끝점이 있으면 그대로 보존한다", () => {
    const input = [
      { x: 0, y: 12 },
      { x: 128, y: 128 },
      { x: 255, y: 240 },
    ];
    expect(normalizeCurve(input)).toEqual(input);
  });

  it("결과는 항상 최소 2점이고 끝점은 0·255", () => {
    const out = normalizeCurve([{ x: 128, y: 200 }]);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]!.x).toBe(0);
    expect(out[out.length - 1]!.x).toBe(255);
  });
});

describe("buildCurveLut", () => {
  it("항등 곡선은 LUT[i]===i (길이 256)", () => {
    const lut = buildCurveLut(DEFAULT_CURVE);
    expect(lut.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(i);
    }
  });

  it("Uint8ClampedArray이고 길이 256", () => {
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }]);
    expect(lut).toBeInstanceOf(Uint8ClampedArray);
    expect(lut.length).toBe(256);
  });

  it("밝게 곡선은 중간톤을 끌어올린다(LUT[128]>128)", () => {
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }]);
    expect(lut[128]!).toBe(160);
    expect(lut[128]!).toBeGreaterThan(128);
    // 끝점은 고정.
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });

  it("어둡게 곡선은 중간톤을 끌어내린다(LUT[128]<128)", () => {
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 128, y: 96 }, { x: 255, y: 255 }]);
    expect(lut[128]!).toBe(96);
    expect(lut[128]!).toBeLessThan(128);
  });

  it("네거티브 곡선은 LUT[0]===255, LUT[255]===0", () => {
    const lut = buildCurveLut([{ x: 0, y: 255 }, { x: 255, y: 0 }]);
    expect(lut.length).toBe(256);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
    // 중간은 단조 감소 — 중앙은 대략 127.
    expect(lut[128]!).toBeLessThan(lut[0]!);
    expect(lut[128]!).toBeGreaterThan(lut[255]!);
  });

  it("구간 선형보간 — 두 점 사이 중앙값이 선형으로 맞는다", () => {
    // (0,0)→(100,100)→(255,255)에서 x=50은 y=50.
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 255, y: 255 }]);
    expect(lut[50]).toBe(50);
  });
});

describe("applyCurve", () => {
  it("항등이면 no-op (데이터 불변)", () => {
    const img = makeImage(2, 1, [
      [10, 20, 30, 40],
      [200, 100, 50, 255],
    ]);
    applyCurve(img, DEFAULT_CURVE);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
    expect(pixelAt(img, 1)).toEqual([200, 100, 50, 255]);
  });

  it("밝게 곡선은 픽셀을 LUT 기대값으로 바꾼다 + 알파 보존", () => {
    const points: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }];
    const lut = buildCurveLut(points);
    const img = makeImage(1, 1, [[128, 64, 200, 77]]);
    applyCurve(img, points);
    expect(pixelAt(img, 0)).toEqual([lut[128]!, lut[64]!, lut[200]!, 77]);
    expect(img.data[3]).toBe(77); // 알파는 절대 안 바뀜.
  });

  it("네거티브 곡선은 채널을 반전한다", () => {
    const points: CurvePoint[] = [{ x: 0, y: 255 }, { x: 255, y: 0 }];
    const img = makeImage(1, 1, [[0, 255, 128, 123]]);
    applyCurve(img, points);
    const [r, g, , a] = pixelAt(img, 0);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(a).toBe(123);
  });

  it("채널별 독립 매핑 — 알파는 절대 건드리지 않는다", () => {
    const points: CurvePoint[] = [{ x: 0, y: 20 }, { x: 255, y: 235 }];
    const lut = buildCurveLut(points);
    const img = makeImage(1, 1, [[0, 128, 255, 200]]);
    applyCurve(img, points);
    expect(pixelAt(img, 0)).toEqual([lut[0]!, lut[128]!, lut[255]!, 200]);
  });
});

describe("CURVE_PRESETS", () => {
  it("첫 항목은 linear/기본 항등", () => {
    const first = CURVE_PRESETS[0]!;
    expect(first.id).toBe("linear");
    expect(first.label).toBe("기본");
    expect(isIdentityCurve(first.points)).toBe(true);
  });

  it("프리셋이 8개 내외다", () => {
    expect(CURVE_PRESETS.length).toBeGreaterThanOrEqual(6);
    expect(CURVE_PRESETS.length).toBeLessThanOrEqual(10);
  });

  it("id는 모두 고유하다", () => {
    const ids = CURVE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of CURVE_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 points가 normalizeCurve에 안정적(이미 정규화 상태)", () => {
    for (const p of CURVE_PRESETS) {
      expect(p.points).toEqual(normalizeCurve(p.points));
      expect(p.points[0]!.x).toBe(0);
      expect(p.points[p.points.length - 1]!.x).toBe(255);
    }
  });

  it("네거티브 프리셋은 명암을 반전한다", () => {
    const neg = CURVE_PRESETS.find((p) => p.id === "negative")!;
    const lut = buildCurveLut(neg.points);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
  });
});

describe("addCurvePoint", () => {
  it("정렬 위치에 점을 삽입하고 입력을 변형하지 않는다(불변)", () => {
    const input: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    const frozen = JSON.parse(JSON.stringify(input));
    const out = addCurvePoint(input, 128, 200);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 255 }]);
    expect(input).toEqual(frozen); // 원본 불변.
    expect(out).not.toBe(input);
  });

  it("x·y를 0..255로 클램프한다", () => {
    const out = addCurvePoint(DEFAULT_CURVE, 300, -10);
    // x=300은 255로 클램프 → 마지막 끝점과 겹쳐 끝점 y만 -10→0으로 대체.
    expect(out[out.length - 1]!.x).toBe(255);
    expect(out[out.length - 1]!.y).toBe(0);
  });

  it("거의 같은 x에 점이 있으면 그 점의 y를 대체한다", () => {
    const base: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 100 }, { x: 255, y: 255 }];
    const out = addCurvePoint(base, 129, 220); // 128과 가까움 → 대체.
    const mid = out.filter((p) => p.x >= 120 && p.x <= 135);
    expect(mid).toHaveLength(1);
    expect(mid[0]!.y).toBe(220);
  });

  it("무효 좌표는 정규화본을 그대로 반환", () => {
    const out = addCurvePoint(DEFAULT_CURVE, Number.NaN, 100);
    expect(out).toEqual(normalizeCurve(DEFAULT_CURVE));
  });

  it("공유 가능한 채널 한도에서 새 점을 조용히 잘라내거나 다른 점으로 바꾸지 않는다", () => {
    const full = Array.from({ length: STUDIO_CURVE_MAX_CONTROL_POINTS }, (_, index) => ({
      x: Math.round(index * 255 / (STUDIO_CURVE_MAX_CONTROL_POINTS - 1)),
      y: Math.round(index * 255 / (STUDIO_CURVE_MAX_CONTROL_POINTS - 1)),
    }));
    const normalized = normalizeCurve(full);

    expect(normalized).toHaveLength(STUDIO_CURVE_MAX_CONTROL_POINTS);
    expect(addCurvePoint(normalized, 110, 220)).toEqual(normalized);
  });
});

describe("moveCurvePoint", () => {
  it("끝점은 x를 고정하고 y만 옮긴다(불변)", () => {
    const input: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
    const frozen = JSON.parse(JSON.stringify(input));
    const out = moveCurvePoint(input, 0, 99, 40); // 첫 끝점: x는 0 유지.
    expect(out[0]).toEqual({ x: 0, y: 40 });
    expect(input).toEqual(frozen);

    const out2 = moveCurvePoint(input, 1, 10, 200); // 마지막 끝점: x는 255 유지.
    expect(out2[out2.length - 1]).toEqual({ x: 255, y: 200 });
  });

  it("중간점 x를 양 이웃 사이로 클램프한다", () => {
    const base: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }];
    // x를 999로 밀어도 마지막 점(255) 바로 아래(254)까지만.
    const hi = moveCurvePoint(base, 1, 999, 100);
    expect(hi[1]!.x).toBe(254);
    expect(hi[1]!.y).toBe(100);
    // x를 -50으로 밀어도 첫 점(0) 바로 위(1)까지만.
    const lo = moveCurvePoint(base, 1, -50, 100);
    expect(lo[1]!.x).toBe(1);
  });

  it("중간점 y는 0..255로 클램프한다", () => {
    const base: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }];
    const out = moveCurvePoint(base, 1, 128, 999);
    expect(out[1]!.y).toBe(255);
  });

  it("범위 밖 index·무효 좌표는 정규화본을 그대로 반환", () => {
    const base: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }];
    expect(moveCurvePoint(base, 9, 10, 10)).toEqual(normalizeCurve(base));
    expect(moveCurvePoint(base, -1, 10, 10)).toEqual(normalizeCurve(base));
    expect(moveCurvePoint(base, 1, Number.NaN, 10)).toEqual(normalizeCurve(base));
  });
});

describe("removeCurvePoint", () => {
  it("끝점은 제거할 수 없다(그대로 반환)", () => {
    const base: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }];
    expect(removeCurvePoint(base, 0)).toEqual(normalizeCurve(base));
    expect(removeCurvePoint(base, base.length - 1)).toEqual(normalizeCurve(base));
  });

  it("중간점을 제거하고 입력을 변형하지 않는다(불변)", () => {
    const input: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }];
    const frozen = JSON.parse(JSON.stringify(input));
    const out = removeCurvePoint(input, 1);
    expect(out).toEqual([{ x: 0, y: 0 }, { x: 255, y: 255 }]);
    expect(input).toEqual(frozen);
    expect(out).not.toBe(input);
  });

  it("범위 밖 index는 그대로 반환", () => {
    const base: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }];
    expect(removeCurvePoint(base, 9)).toEqual(normalizeCurve(base));
  });
});

describe("curveToFlat / flatToCurve", () => {
  it("점 배열 → 평탄 배열 [x0,y0,x1,y1,...]", () => {
    expect(curveToFlat([{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }])).toEqual([
      0, 0, 128, 160, 255, 255,
    ]);
  });

  it("평탄 배열 → 점 배열(normalize 적용)", () => {
    expect(flatToCurve([0, 0, 128, 160, 255, 255])).toEqual([
      { x: 0, y: 0 },
      { x: 128, y: 160 },
      { x: 255, y: 255 },
    ]);
  });

  it("정규화된 곡선은 flat↔curve 왕복이 동일하다", () => {
    const curve = normalizeCurve([{ x: 0, y: 10 }, { x: 64, y: 90 }, { x: 200, y: 210 }, { x: 255, y: 245 }]);
    expect(flatToCurve(curveToFlat(curve))).toEqual(curve);
  });

  it("홀수 꼬리는 버리고 나머지를 정규화한다", () => {
    // 마지막 외톨이 7은 짝이 없어 버려진다.
    expect(flatToCurve([0, 0, 255, 255, 7])).toEqual([
      { x: 0, y: 0 },
      { x: 255, y: 255 },
    ]);
  });

  it("비배열 입력은 기본 곡선", () => {
    expect(flatToCurve(null as unknown as number[])).toEqual(DEFAULT_CURVE);
  });
});

describe("curveKonvaFilter", () => {
  it("attrs.curvePoints(flat)를 읽어 픽셀을 변형한다", () => {
    const img = makeImage(1, 1, [[128, 64, 200, 90]]);
    const points: CurvePoint[] = [{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }];
    const attrs = { curvePoints: curveToFlat(points) };
    curveKonvaFilter.call({ attrs }, img);
    const lut = buildCurveLut(points);
    expect(pixelAt(img, 0)).toEqual([lut[128]!, lut[64]!, lut[200]!, 90]);
  });

  it("curvePoints 누락 시 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => curveKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => curveKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("curvePoints가 배열 아님/너무 짧음이면 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    expect(() => curveKonvaFilter.call({ attrs: { curvePoints: "x" } }, img)).not.toThrow();
    expect(() => curveKonvaFilter.call({ attrs: { curvePoints: [5] } }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });

  it("항등으로 변환되는 curvePoints는 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    const attrs = { curvePoints: [0, 0, 255, 255] };
    curveKonvaFilter.call({ attrs }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });

  it("무효 원소가 섞인 curvePoints도 throw 없이 처리", () => {
    const img = makeImage(1, 1, [[128, 128, 128, 255]]);
    // NaN/문자열 원소는 걸러지고 남은 짝수 좌표만 사용.
    const attrs = { curvePoints: [0, 0, 128, 160, 255, 255, Number.NaN] };
    expect(() => curveKonvaFilter.call({ attrs }, img)).not.toThrow();
    const lut = buildCurveLut([{ x: 0, y: 0 }, { x: 128, y: 160 }, { x: 255, y: 255 }]);
    expect(pixelAt(img, 0)).toEqual([lut[128]!, lut[128]!, lut[128]!, 255]);
  });
});

describe("채널 커브(R/G/B)", () => {
  it("TONE_CHANNELS는 master+r/g/b 4종을 순서대로 노출한다", () => {
    expect(TONE_CHANNELS.map((c) => c.id)).toEqual(["master", "r", "g", "b"]);
    for (const ch of TONE_CHANNELS) {
      expect(ch.label.length).toBeGreaterThan(0);
      expect(ch.tip.length).toBeGreaterThan(0);
    }
  });

  it("normalizeCurveChannels는 누락/무효 채널을 항등으로 채운다", () => {
    const ch = normalizeCurveChannels({ r: [{ x: 0, y: 40 }, { x: 255, y: 255 }] });
    expect(ch.r[0]).toEqual({ x: 0, y: 40 });
    expect(isIdentityCurve(ch.g)).toBe(true);
    expect(isIdentityCurve(ch.b)).toBe(true);
    expect(normalizeCurveChannels(null).r).toEqual(DEFAULT_CURVE);
  });

  it("isIdentityCurveChannels는 세 채널 모두 항등일 때만 참", () => {
    expect(isIdentityCurveChannels(null)).toBe(true);
    expect(isIdentityCurveChannels({})).toBe(true);
    const bent: CurveRgbChannels = { b: [{ x: 0, y: 30 }, { x: 255, y: 255 }] };
    expect(isIdentityCurveChannels(bent)).toBe(false);
  });

  it("composeLuts는 두 LUT의 순차 적용과 같다", () => {
    const bright = buildCurveLut([{ x: 0, y: 40 }, { x: 255, y: 255 }]);
    const identity = buildCurveLut(DEFAULT_CURVE);
    const composed = composeLuts(identity, bright);
    expect(composed[0]).toBe(bright[0]!);
    expect(composed[128]).toBe(bright[128]!);
    expect(composed).toHaveLength(256);
  });

  it("buildCurveChannelLuts — 채널 없는 축은 마스터 LUT와 동일, 있는 축은 합성으로 달라진다", () => {
    const master: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 200 }];
    const channels: CurveRgbChannels = { r: [{ x: 0, y: 50 }, { x: 255, y: 255 }] };
    const luts = buildCurveChannelLuts(master, channels);
    const masterLut = buildCurveLut(normalizeCurve(master));
    expect(luts.g[128]).toBe(masterLut[128]!);
    expect(luts.b[200]).toBe(masterLut[200]!);
    expect(luts.r[128]).not.toBe(masterLut[128]!);
  });

  it("applyCurveChannels는 픽셀에 채널별 LUT를 적용한다(알파 보존)", () => {
    const img = makeImage(1, 1, [[100, 100, 100, 255]]);
    applyCurveChannels(img, DEFAULT_CURVE, { r: [{ x: 0, y: 255 }, { x: 255, y: 255 }] });
    expect(pixelAt(img, 0)).toEqual([255, 100, 100, 255]);
  });
});
