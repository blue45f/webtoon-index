import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRADIENT_MAP,
  GRADIENT_MAP_PRESETS,
  applyGradientMap,
  buildGradientLut,
  flatToGradientMap,
  gradientMapKonvaFilter,
  gradientMapToFlat,
  isDefaultGradientMap,
  normalizeGradientMap,
  type GradientMap,
  type GradientStop,
} from "./studio-gradient-map";

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

/** LUT[i] 색을 [r,g,b]로. */
function lutAt(lut: Uint8ClampedArray, i: number): number[] {
  return [lut[i * 3]!, lut[i * 3 + 1]!, lut[i * 3 + 2]!];
}

describe("DEFAULT_GRADIENT_MAP / isDefaultGradientMap", () => {
  it("기본값은 흑→백 2-스톱 [{0,#000000},{1,#ffffff}]", () => {
    expect(DEFAULT_GRADIENT_MAP).toEqual({
      stops: [
        { pos: 0, color: "#000000" },
        { pos: 1, color: "#ffffff" },
      ],
    });
    expect(isDefaultGradientMap(DEFAULT_GRADIENT_MAP)).toBe(true);
  });

  it("흑→백과 다르면(스톱 수·색·위치) 기본이 아니다", () => {
    expect(isDefaultGradientMap({ stops: [{ pos: 0, color: "#000000" }] })).toBe(false);
    expect(
      isDefaultGradientMap({
        stops: [
          { pos: 0, color: "#000000" },
          { pos: 1, color: "#fffffe" },
        ],
      })
    ).toBe(false);
    expect(
      isDefaultGradientMap({
        stops: [
          { pos: 0, color: "#010000" },
          { pos: 1, color: "#ffffff" },
        ],
      })
    ).toBe(false);
    // 3-스톱은 흑→백 2-스톱이 아니다.
    expect(
      isDefaultGradientMap({
        stops: [
          { pos: 0, color: "#000000" },
          { pos: 0.5, color: "#808080" },
          { pos: 1, color: "#ffffff" },
        ],
      })
    ).toBe(false);
  });

  it("#RGB 단축 표기로 적힌 흑→백도 기본으로 인정", () => {
    expect(isDefaultGradientMap({ stops: [{ pos: 0, color: "#000" }, { pos: 1, color: "#FFF" }] })).toBe(true);
  });
});

describe("normalizeGradientMap", () => {
  it("undefined/null/스톱없음 → 기본(흑→백)", () => {
    expect(normalizeGradientMap()).toEqual(DEFAULT_GRADIENT_MAP);
    expect(normalizeGradientMap(null)).toEqual(DEFAULT_GRADIENT_MAP);
    expect(normalizeGradientMap({})).toEqual(DEFAULT_GRADIENT_MAP);
    expect(normalizeGradientMap({ stops: [] })).toEqual(DEFAULT_GRADIENT_MAP);
  });

  it("유효 스톱이 2개 미만이면 기본으로 폴백", () => {
    expect(normalizeGradientMap({ stops: [{ pos: 0.3, color: "#123456" }] })).toEqual(DEFAULT_GRADIENT_MAP);
    // 한 스톱만 유효(다른 하나는 무효 색) → 2개 미만이라 기본.
    expect(
      normalizeGradientMap({
        stops: [
          { pos: 0.2, color: "#123456" },
          { pos: 0.8, color: "not-a-color" } as unknown as GradientStop,
        ],
      })
    ).toEqual(DEFAULT_GRADIENT_MAP);
  });

  it("pos를 0..1로 클램프한다", () => {
    const out = normalizeGradientMap({
      stops: [
        { pos: -5, color: "#111111" },
        { pos: 9, color: "#eeeeee" },
      ],
    });
    expect(out.stops[0]!.pos).toBe(0);
    expect(out.stops[out.stops.length - 1]!.pos).toBe(1);
  });

  it("pos 오름차순으로 정렬한다(입력 역순)", () => {
    const out = normalizeGradientMap({
      stops: [
        { pos: 0.9, color: "#aaaaaa" },
        { pos: 0.1, color: "#222222" },
        { pos: 0.5, color: "#666666" },
      ],
    });
    const positions = out.stops.map((s) => s.pos);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // 정렬 후 첫 색은 0.1짜리(#222222), 마지막은 0.9짜리(#aaaaaa).
    expect(out.stops[0]!.color).toBe("#222222");
    expect(out.stops[out.stops.length - 1]!.color).toBe("#aaaaaa");
  });

  it("색을 정규화한다(#RGB 확장 + 소문자)", () => {
    const out = normalizeGradientMap({
      stops: [
        { pos: 0, color: "#ABC" },
        { pos: 1, color: "#DDEEFF" },
      ],
    });
    expect(out.stops[0]!.color).toBe("#aabbcc");
    expect(out.stops[1]!.color).toBe("#ddeeff");
  });

  it("양끝 pos를 0/1로 강제한다(가운데에 몰린 스톱도)", () => {
    const out = normalizeGradientMap({
      stops: [
        { pos: 0.3, color: "#111111" },
        { pos: 0.6, color: "#777777" },
      ],
    });
    expect(out.stops[0]!.pos).toBe(0);
    expect(out.stops[out.stops.length - 1]!.pos).toBe(1);
    // 색은 유지, 위치만 당겨진다.
    expect(out.stops[0]!.color).toBe("#111111");
    expect(out.stops[1]!.color).toBe("#777777");
  });

  it("최소 2스톱·양끝 0/1 불변식을 항상 만족", () => {
    const out = normalizeGradientMap({
      stops: [
        { pos: 0.5, color: "#445566" },
        { pos: 0.5, color: "#112233" },
        { pos: 0.5, color: "#778899" },
      ],
    });
    expect(out.stops.length).toBeGreaterThanOrEqual(2);
    expect(out.stops[0]!.pos).toBe(0);
    expect(out.stops[out.stops.length - 1]!.pos).toBe(1);
  });

  it("무효 pos(숫자 아님/NaN/Inf)인 스톱은 버린다", () => {
    const out = normalizeGradientMap({
      stops: [
        { pos: Number.NaN, color: "#000000" } as unknown as GradientStop,
        { pos: 0.4, color: "#404040" },
        { pos: Number.POSITIVE_INFINITY, color: "#ffffff" } as unknown as GradientStop,
        { pos: 0.8, color: "#c0c0c0" },
      ],
    });
    // 유효한 두 스톱(#404040, #c0c0c0)만 남고 양끝 0/1로.
    expect(out.stops.length).toBe(2);
    expect(out.stops[0]!.color).toBe("#404040");
    expect(out.stops[1]!.color).toBe("#c0c0c0");
    expect(out.stops[0]!.pos).toBe(0);
    expect(out.stops[1]!.pos).toBe(1);
  });
});

describe("buildGradientLut", () => {
  it("256*3 길이의 RGB LUT", () => {
    const lut = buildGradientLut(DEFAULT_GRADIENT_MAP);
    expect(lut.length).toBe(256 * 3);
    expect(lut).toBeInstanceOf(Uint8ClampedArray);
  });

  it("LUT[0]=첫 스톱 색, LUT[255]=마지막 스톱 색", () => {
    const g: GradientMap = {
      stops: [
        { pos: 0, color: "#102030" },
        { pos: 1, color: "#a0b0c0" },
      ],
    };
    const lut = buildGradientLut(g);
    expect(lutAt(lut, 0)).toEqual([0x10, 0x20, 0x30]);
    expect(lutAt(lut, 255)).toEqual([0xa0, 0xb0, 0xc0]);
  });

  it("흑→백 LUT는 양끝이 검정/흰색", () => {
    const lut = buildGradientLut(DEFAULT_GRADIENT_MAP);
    expect(lutAt(lut, 0)).toEqual([0, 0, 0]);
    expect(lutAt(lut, 255)).toEqual([255, 255, 255]);
  });

  it("두 스톱 사이 중간점은 선형보간된 색", () => {
    const g: GradientMap = {
      stops: [
        { pos: 0, color: "#000000" },
        { pos: 1, color: "#ffffff" },
      ],
    };
    const lut = buildGradientLut(g);
    // i=128 → t≈0.502 → 약 128 회색(반올림 오차 ±2 허용).
    const mid = lutAt(lut, 128);
    expect(mid[0]).toBeGreaterThanOrEqual(126);
    expect(mid[0]).toBeLessThanOrEqual(130);
    expect(mid[0]).toBe(mid[1]);
    expect(mid[1]).toBe(mid[2]);
  });

  it("3-스톱 중앙 스톱 위치(t=0.5)에서 그 스톱 색이 정확히 나온다", () => {
    const g: GradientMap = {
      stops: [
        { pos: 0, color: "#000000" },
        { pos: 0.5, color: "#3a6b7a" },
        { pos: 1, color: "#ffb066" },
      ],
    };
    const lut = buildGradientLut(g);
    // i≈127.5 → 가장 가까운 정수 인덱스 127,128에서 중앙 스톱 색에 근접.
    const at128 = lutAt(lut, 128); // t≈0.502, 두 번째 구간 진입 직후 → 거의 #3a6b7a
    expect(Math.abs(at128[0]! - 0x3a)).toBeLessThanOrEqual(2);
    expect(Math.abs(at128[1]! - 0x6b)).toBeLessThanOrEqual(2);
    expect(Math.abs(at128[2]! - 0x7a)).toBeLessThanOrEqual(2);
  });
});

describe("applyGradientMap", () => {
  it("검정 픽셀은 첫 스톱 색, 흰 픽셀은 마지막 스톱 색으로", () => {
    const g: GradientMap = {
      stops: [
        { pos: 0, color: "#102030" },
        { pos: 1, color: "#a0b0c0" },
      ],
    };
    const img = makeImage(2, 1, [
      [0, 0, 0, 200],
      [255, 255, 255, 150],
    ]);
    applyGradientMap(img, g);
    expect(pixelAt(img, 0)).toEqual([0x10, 0x20, 0x30, 200]); // 알파 보존
    expect(pixelAt(img, 1)).toEqual([0xa0, 0xb0, 0xc0, 150]);
  });

  it("중간 회색은 중간 보간색으로 매핑된다", () => {
    const g: GradientMap = {
      stops: [
        { pos: 0, color: "#000000" },
        { pos: 1, color: "#ffffff" },
      ],
    };
    // 128 회색 → 휘도 128 → LUT[128] ≈ 128.
    const img = makeImage(1, 1, [[128, 128, 128, 255]]);
    applyGradientMap(img, g);
    const px = pixelAt(img, 0);
    expect(px[0]).toBeGreaterThanOrEqual(126);
    expect(px[0]).toBeLessThanOrEqual(130);
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[3]).toBe(255); // 알파 보존
  });

  it("3-스톱 그라디언트에서 중간 회색은 중앙 스톱 색에 가깝다", () => {
    const g: GradientMap = {
      stops: [
        { pos: 0, color: "#000000" },
        { pos: 0.5, color: "#3a6b7a" },
        { pos: 1, color: "#ffb066" },
      ],
    };
    const img = makeImage(1, 1, [[128, 128, 128, 99]]);
    applyGradientMap(img, g);
    const px = pixelAt(img, 0);
    expect(Math.abs(px[0]! - 0x3a)).toBeLessThanOrEqual(2);
    expect(Math.abs(px[1]! - 0x6b)).toBeLessThanOrEqual(2);
    expect(Math.abs(px[2]! - 0x7a)).toBeLessThanOrEqual(2);
    expect(px[3]).toBe(99); // 알파 보존
  });

  it("항등(흑→백)이어도 흑백화하므로 항상 적용된다(컬러 픽셀 → 회색)", () => {
    // 순빨강(255,0,0): 휘도 ≈ 0.299*255 ≈ 76 → 회색 약 76.
    const img = makeImage(1, 1, [[255, 0, 0, 255]]);
    applyGradientMap(img, DEFAULT_GRADIENT_MAP);
    const px = pixelAt(img, 0);
    expect(px[0]).toBe(px[1]); // 회색(R=G=B)
    expect(px[1]).toBe(px[2]);
    expect(px[0]).toBeGreaterThanOrEqual(74);
    expect(px[0]).toBeLessThanOrEqual(78);
    expect(px[3]).toBe(255); // 알파 보존
  });

  it("같은 휘도의 다른 컬러는 같은 색으로 매핑된다(휘도 기반)", () => {
    const g = DEFAULT_GRADIENT_MAP;
    // 두 픽셀 모두 회색 100 휘도.
    const img = makeImage(2, 1, [
      [100, 100, 100, 255],
      [100, 100, 100, 10],
    ]);
    applyGradientMap(img, g);
    expect(pixelAt(img, 0).slice(0, 3)).toEqual(pixelAt(img, 1).slice(0, 3));
  });
});

describe("세피아 프리셋", () => {
  it("그림자(어두운 픽셀)를 따뜻한 갈색 쪽으로 어둡게 물들인다", () => {
    const sepia = GRADIENT_MAP_PRESETS.find((p) => p.id === "sepia")!;
    // 어두운 회색 픽셀.
    const img = makeImage(1, 1, [[20, 20, 20, 255]]);
    applyGradientMap(img, sepia.map);
    const [r, g, b] = pixelAt(img, 0);
    // 세피아 그림자(#1a0f00 근처): 따뜻함 → R > G > B.
    expect(r!).toBeGreaterThan(g!);
    expect(g!).toBeGreaterThan(b!);
    // 어두운 영역이라 전체적으로 어둡다.
    expect(r!).toBeLessThan(90);
  });

  it("하이라이트(밝은 픽셀)는 따뜻한 크림색으로", () => {
    const sepia = GRADIENT_MAP_PRESETS.find((p) => p.id === "sepia")!;
    const img = makeImage(1, 1, [[245, 245, 245, 255]]);
    applyGradientMap(img, sepia.map);
    const [r, g, b] = pixelAt(img, 0);
    // 크림(#fff1cf 근처): 매우 밝고 R≥G≥B.
    expect(r!).toBeGreaterThanOrEqual(g!);
    expect(g!).toBeGreaterThanOrEqual(b!);
    expect(r!).toBeGreaterThan(230);
  });
});

describe("gradientMapToFlat / flatToGradientMap 라운드트립", () => {
  it("flat은 4의 배수 길이(스톱당 pos,r,g,b)", () => {
    const flat = gradientMapToFlat(DEFAULT_GRADIENT_MAP);
    expect(flat.length % 4).toBe(0);
    expect(flat.length).toBe(8); // 2스톱
    expect(flat).toEqual([0, 0, 0, 0, 1, 255, 255, 255]);
  });

  it("3-스톱은 길이 12의 가변 flat", () => {
    const g: GradientMap = {
      stops: [
        { pos: 0, color: "#102030" },
        { pos: 0.5, color: "#405060" },
        { pos: 1, color: "#708090" },
      ],
    };
    const flat = gradientMapToFlat(g);
    expect(flat.length).toBe(12);
    expect(flat).toEqual([0, 0x10, 0x20, 0x30, 0.5, 0x40, 0x50, 0x60, 1, 0x70, 0x80, 0x90]);
  });

  it("flat → map → flat 왕복이 동일(가변 길이 유지)", () => {
    const g: GradientMap = {
      stops: [
        { pos: 0, color: "#06243a" },
        { pos: 0.5, color: "#3a6b7a" },
        { pos: 1, color: "#ffb066" },
      ],
    };
    const flat = gradientMapToFlat(g);
    const back = flatToGradientMap(flat);
    expect(back.stops).toEqual(g.stops);
    expect(gradientMapToFlat(back)).toEqual(flat);
  });

  it("map → flat → map 왕복이 동일(2스톱)", () => {
    const g = normalizeGradientMap({
      stops: [
        { pos: 0, color: "#1a0f00" },
        { pos: 1, color: "#fff1cf" },
      ],
    });
    const back = flatToGradientMap(gradientMapToFlat(g));
    expect(back).toEqual(g);
  });

  it("flatToGradientMap: 4의 배수가 아닌 꼬리는 버린다", () => {
    // 2스톱(8개) + 꼬리 2개 → 꼬리 무시, 2스톱만.
    const back = flatToGradientMap([0, 0, 0, 0, 1, 255, 255, 255, 0.5, 128]);
    expect(back.stops.length).toBe(2);
    expect(back).toEqual(DEFAULT_GRADIENT_MAP);
  });

  it("flatToGradientMap: 스톱 1개분(4개)만 있으면 기본으로 폴백", () => {
    expect(flatToGradientMap([0.5, 10, 20, 30])).toEqual(DEFAULT_GRADIENT_MAP);
  });

  it("flatToGradientMap: 비배열/빈 배열은 기본", () => {
    expect(flatToGradientMap([])).toEqual(DEFAULT_GRADIENT_MAP);
    expect(flatToGradientMap(null as unknown as number[])).toEqual(DEFAULT_GRADIENT_MAP);
  });
});

describe("GRADIENT_MAP_PRESETS", () => {
  it("첫 항목은 흑백(DEFAULT)", () => {
    const first = GRADIENT_MAP_PRESETS[0]!;
    expect(first.label).toBe("흑백");
    expect(isDefaultGradientMap(first.map)).toBe(true);
  });

  it("프리셋이 8개 내외다", () => {
    expect(GRADIENT_MAP_PRESETS.length).toBeGreaterThanOrEqual(7);
    expect(GRADIENT_MAP_PRESETS.length).toBeLessThanOrEqual(9);
  });

  it("id는 모두 고유하다", () => {
    const ids = GRADIENT_MAP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label/tip은 비어있지 않다", () => {
    for (const p of GRADIENT_MAP_PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tip.length).toBeGreaterThan(0);
    }
  });

  it("모든 map이 normalizeGradientMap과 동일(양끝 0/1·2+스톱·정규화 색)", () => {
    for (const p of GRADIENT_MAP_PRESETS) {
      expect(p.map).toEqual(normalizeGradientMap(p.map));
      expect(p.map.stops.length).toBeGreaterThanOrEqual(2);
      expect(p.map.stops[0]!.pos).toBe(0);
      expect(p.map.stops[p.map.stops.length - 1]!.pos).toBe(1);
      for (const s of p.map.stops) {
        expect(s.pos).toBeGreaterThanOrEqual(0);
        expect(s.pos).toBeLessThanOrEqual(1);
        expect(s.color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("기대한 프리셋(세피아·틸오렌지·사이버펑크·석양·골드·아이스블루·듀오톤핑크)이 존재", () => {
    const labels = GRADIENT_MAP_PRESETS.map((p) => p.label);
    expect(labels).toContain("세피아");
    expect(labels).toContain("시네마 틸오렌지");
    expect(labels).toContain("사이버펑크");
    expect(labels).toContain("석양");
    expect(labels).toContain("골드");
    expect(labels).toContain("아이스블루");
    expect(labels).toContain("듀오톤 핑크");
  });

  it("석양은 4스톱, 틸오렌지/사이버펑크는 3스톱", () => {
    const sunset = GRADIENT_MAP_PRESETS.find((p) => p.id === "sunset")!;
    const teal = GRADIENT_MAP_PRESETS.find((p) => p.id === "teal-orange")!;
    const cyber = GRADIENT_MAP_PRESETS.find((p) => p.id === "cyberpunk")!;
    expect(sunset.map.stops.length).toBe(4);
    expect(teal.map.stops.length).toBe(3);
    expect(cyber.map.stops.length).toBe(3);
  });
});

describe("gradientMapKonvaFilter", () => {
  it("flat attrs(gradientMap)를 읽어 픽셀을 변형한다", () => {
    const img = makeImage(2, 1, [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
    // 흑→백 매핑(같은 회색이지만 검정/흰색).
    const attrs = { gradientMap: [0, 0, 0, 0, 1, 255, 255, 255] };
    gradientMapKonvaFilter.call({ attrs }, img);
    expect(pixelAt(img, 0).slice(0, 3)).toEqual([0, 0, 0]);
    expect(pixelAt(img, 1).slice(0, 3)).toEqual([255, 255, 255]);

    // 직접 applyGradientMap 결과와 동일해야 한다.
    const ref = makeImage(2, 1, [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
    applyGradientMap(ref, flatToGradientMap([0, 0, 0, 0, 1, 255, 255, 255]));
    expect(pixelAt(img, 0)).toEqual(pixelAt(ref, 0));
    expect(pixelAt(img, 1)).toEqual(pixelAt(ref, 1));
  });

  it("컬러 attrs로 휘도 → 색 매핑(빨강 → 첫 스톱 쪽 어두운 색)", () => {
    const img = makeImage(1, 1, [[10, 10, 10, 123]]);
    // 세피아 flat.
    const attrs = { gradientMap: gradientMapToFlat(GRADIENT_MAP_PRESETS.find((p) => p.id === "sepia")!.map) };
    gradientMapKonvaFilter.call({ attrs }, img);
    const [r, g, b, a] = pixelAt(img, 0);
    expect(r!).toBeGreaterThanOrEqual(g!); // 따뜻한 톤
    expect(g!).toBeGreaterThanOrEqual(b!);
    expect(a).toBe(123); // 알파 보존
  });

  it("attrs가 비면 no-op(throw 없음)", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => gradientMapKonvaFilter.call({ attrs: {} }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("this.attrs 자체가 없어도 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => gradientMapKonvaFilter.call({}, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("gradientMap이 배열이 아니면 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 40]]);
    expect(() => gradientMapKonvaFilter.call({ attrs: { gradientMap: "x" } }, img)).not.toThrow();
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 40]);
  });

  it("스톱 2개 미만(유효 숫자 8개 미만)이면 no-op", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 255]]);
    // 스톱 1개분(4개)만 → 적용하지 않음(기본 흑백화도 하지 않는다).
    gradientMapKonvaFilter.call({ attrs: { gradientMap: [0.5, 128, 64, 32] } }, img);
    expect(pixelAt(img, 0)).toEqual([10, 20, 30, 255]);
  });

  it("무효 원소가 섞여 유효 숫자가 8개 미만이 되면 no-op", () => {
    const img = makeImage(1, 1, [[55, 110, 165, 220]]);
    // 무효 원소(NaN/문자열)를 빼면 숫자 4개뿐 → no-op.
    const attrs = { gradientMap: [0, Number.NaN, 0, "x", 0, 1, null, 255] };
    gradientMapKonvaFilter.call({ attrs }, img);
    expect(pixelAt(img, 0)).toEqual([55, 110, 165, 220]);
  });
});

// 미사용 import 방지용 타입 참조.
const _typecheck: GradientMap = DEFAULT_GRADIENT_MAP;
void _typecheck;

describe("gradient map hostile-input bounds", () => {
  it("caps an oversized stop list and never mutates it", () => {
    const stops = Array.from({ length: 20_000 }, (_, index) => ({
      pos: index / 19_999,
      color: index % 2 === 0 ? "#000000" : "#ffffff",
    }));
    const map = { stops };
    const normalized = normalizeGradientMap(map);
    expect(normalized.stops.length).toBeLessThanOrEqual(1024);
    expect(stops).toHaveLength(20_000);
  });

  it("drops a malformed flat tuple without shifting later stop channel boundaries", () => {
    const img = makeImage(1, 1, [[10, 20, 30, 77]]);
    gradientMapKonvaFilter.call({ attrs: {
      gradientMap: [
        0, 0, 0, 0,
        0.5, Number.NaN, 1, 1,
        1, 255, 255, 255,
      ],
    } }, img);
    const [r, g, b, a] = pixelAt(img, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(10);
    expect(a).toBe(77);
  });
});
