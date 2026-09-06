import { describe, expect, it } from "vitest";

import {
  blendExtended,
  EXTENDED_BLEND_MODE_DEFAULT,
  EXTENDED_BLEND_MODES,
  EXTENDED_BLEND_OPACITY_RANGE,
  extendedBlendModeLabel,
  isStudioExtendedBlendModeId,
  type StudioExtendedBlendModeId,
} from "./studio-extended-blend";

import type { StudioImageDataLike } from "./studio-filters";

/** 1×1 RGBA 픽셀 버퍼. */
function pixel(r: number, g: number, b: number, a = 255): StudioImageDataLike {
  return { data: new Uint8ClampedArray([r, g, b, a]), width: 1, height: 1 };
}

/** 단일 픽셀·양쪽 불투명·opacity 1 기준으로 결과 RGB 만 뽑는다(포토샵 레퍼런스 대조용). */
function blendOpaque(
  mode: StudioExtendedBlendModeId,
  base: [number, number, number],
  top: [number, number, number]
): [number, number, number] {
  const out = blendExtended(pixel(...base), pixel(...top), mode, 1);
  return [out.data[0]!, out.data[1]!, out.data[2]!];
}

describe("EXTENDED_BLEND_MODES 카탈로그", () => {
  it("10개 모드가 지정된 한글 라벨로 존재한다", () => {
    expect(EXTENDED_BLEND_MODES.map((mode) => mode.label)).toEqual([
      "선형 닷지(더하기)",
      "선형 번",
      "비비드 라이트",
      "선형 라이트",
      "핀 라이트",
      "하드 믹스",
      "어두운 색상",
      "밝은 색상",
      "빼기",
      "나누기",
    ]);
    expect(new Set(EXTENDED_BLEND_MODES.map((mode) => mode.id)).size).toBe(10);
    for (const mode of EXTENDED_BLEND_MODES) {
      expect(mode.tip.length).toBeGreaterThan(0);
    }
  });

  it("id 가드·라벨 조회·기본값이 카탈로그와 일치한다", () => {
    expect(isStudioExtendedBlendModeId("linear-dodge")).toBe(true);
    expect(isStudioExtendedBlendModeId("multiply")).toBe(false);
    expect(extendedBlendModeLabel("divide")).toBe("나누기");
    expect(extendedBlendModeLabel("unknown-mode")).toBe("unknown-mode");
    expect(isStudioExtendedBlendModeId(EXTENDED_BLEND_MODE_DEFAULT)).toBe(true);
    expect(EXTENDED_BLEND_OPACITY_RANGE.max).toBe(1);
  });
});

describe("blendExtended — 포토샵 레퍼런스 공식(불투명, opacity 1)", () => {
  it("선형 닷지: 더하기 + 255 클램프 (128+128=255)", () => {
    expect(blendOpaque("linear-dodge", [128, 128, 128], [128, 128, 128])).toEqual([255, 255, 255]);
    expect(blendOpaque("linear-dodge", [100, 100, 100], [50, 50, 50])).toEqual([150, 150, 150]);
    expect(blendOpaque("linear-dodge", [0, 0, 0], [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("선형 번: 합 − 255, 0 클램프 (128+128 → 1)", () => {
    expect(blendOpaque("linear-burn", [128, 128, 128], [128, 128, 128])).toEqual([1, 1, 1]);
    expect(blendOpaque("linear-burn", [200, 200, 200], [10, 10, 10])).toEqual([0, 0, 0]);
    expect(blendOpaque("linear-burn", [255, 255, 255], [255, 255, 255])).toEqual([255, 255, 255]);
  });

  it("비비드 라이트: cs≤0.5 색상 번 / cs>0.5 색상 닷지, 특이점 cs=0→0·cs=1→1", () => {
    // cs=51(0.2): 번 → 1 − (1−0.2)/0.4 = −1 → 0 클램프
    expect(blendOpaque("vivid-light", [51, 51, 51], [51, 51, 51])).toEqual([0, 0, 0]);
    // cs=204(0.8): 닷지 → 0.2/(2×0.2) = 0.5 → 128
    expect(blendOpaque("vivid-light", [51, 51, 51], [204, 204, 204])).toEqual([128, 128, 128]);
    // 흰 base 는 번으로도 못 태운다(1 유지)
    expect(blendOpaque("vivid-light", [255, 255, 255], [64, 64, 64])).toEqual([255, 255, 255]);
    expect(blendOpaque("vivid-light", [77, 77, 77], [0, 0, 0])).toEqual([0, 0, 0]);
    expect(blendOpaque("vivid-light", [77, 77, 77], [255, 255, 255])).toEqual([255, 255, 255]);
  });

  it("선형 라이트: cb + 2cs − 1, 양방향 클램프 (128,128 → 129)", () => {
    expect(blendOpaque("linear-light", [128, 128, 128], [128, 128, 128])).toEqual([129, 129, 129]);
    expect(blendOpaque("linear-light", [0, 0, 0], [64, 64, 64])).toEqual([0, 0, 0]);
    expect(blendOpaque("linear-light", [255, 255, 255], [192, 192, 192])).toEqual([255, 255, 255]);
  });

  it("핀 라이트: cs≤0.5 → min(cb,2cs) / cs>0.5 → max(cb,2cs−1)", () => {
    expect(blendOpaque("pin-light", [200, 200, 200], [64, 64, 64])).toEqual([128, 128, 128]);
    expect(blendOpaque("pin-light", [20, 20, 20], [192, 192, 192])).toEqual([129, 129, 129]);
    // 범위 안이면 base 유지
    expect(blendOpaque("pin-light", [200, 200, 200], [128, 128, 128])).toEqual([200, 200, 200]);
  });

  it("하드 믹스: 채널 이진화 — 합이 255 이상이면 255, 아니면 0", () => {
    expect(blendOpaque("hard-mix", [128, 128, 128], [128, 128, 128])).toEqual([255, 255, 255]);
    expect(blendOpaque("hard-mix", [100, 100, 100], [100, 100, 100])).toEqual([0, 0, 0]);
    expect(blendOpaque("hard-mix", [255, 200, 0], [0, 100, 0])).toEqual([255, 255, 0]);
  });

  it("어두운 색상: 광도(0.3R+0.59G+0.11B) 비교로 픽셀 통째 선택 — 채널 혼합 없음", () => {
    // 빨강 lum=0.3 vs 파랑 lum=0.11 → 파랑(top)이 어둡다
    expect(blendOpaque("darker-color", [255, 0, 0], [0, 0, 255])).toEqual([0, 0, 255]);
    // top 이 더 밝으면 base 유지
    expect(blendOpaque("darker-color", [0, 0, 255], [0, 255, 0])).toEqual([0, 0, 255]);
    // 동률이면 base 유지(결정적 타이브레이크)
    expect(blendOpaque("darker-color", [80, 80, 80], [80, 80, 80])).toEqual([80, 80, 80]);
  });

  it("밝은 색상: 광도 비교로 더 밝은 픽셀 통째 선택", () => {
    expect(blendOpaque("lighter-color", [255, 0, 0], [0, 0, 255])).toEqual([255, 0, 0]);
    expect(blendOpaque("lighter-color", [0, 0, 255], [0, 255, 0])).toEqual([0, 255, 0]);
  });

  it("빼기: cb − cs, 0 클램프", () => {
    expect(blendOpaque("subtract", [100, 100, 100], [30, 30, 30])).toEqual([70, 70, 70]);
    expect(blendOpaque("subtract", [30, 30, 30], [100, 100, 100])).toEqual([0, 0, 0]);
  });

  it("나누기: cb/cs 클램프 — 0으로 나누면 255, 같은 색끼리도 255", () => {
    expect(blendOpaque("divide", [50, 50, 50], [200, 200, 200])).toEqual([64, 64, 64]);
    expect(blendOpaque("divide", [120, 120, 120], [0, 0, 0])).toEqual([255, 255, 255]);
    expect(blendOpaque("divide", [0, 0, 0], [0, 0, 0])).toEqual([255, 255, 255]);
    expect(blendOpaque("divide", [128, 128, 128], [64, 64, 64])).toEqual([255, 255, 255]);
    expect(blendOpaque("divide", [77, 77, 77], [77, 77, 77])).toEqual([255, 255, 255]);
  });
});

describe("blendExtended — 알파 합성(CSS Compositing Level 1 source-over)", () => {
  it("top 완전 투명 → base 픽셀 그대로", () => {
    const out = blendExtended(pixel(10, 20, 30, 200), pixel(255, 255, 255, 0), "linear-dodge", 1);
    expect([...out.data]).toEqual([10, 20, 30, 200]);
  });

  it("base 완전 투명 → top 픽셀 그대로(알파에만 opacity 반영)", () => {
    const asIs = blendExtended(pixel(0, 0, 0, 0), pixel(10, 20, 30, 255), "subtract", 1);
    expect([...asIs.data]).toEqual([10, 20, 30, 255]);
    const half = blendExtended(pixel(0, 0, 0, 0), pixel(10, 20, 30, 255), "subtract", 0.5);
    expect([...half.data]).toEqual([10, 20, 30, 128]);
  });

  it("opacity 0 → 결과가 base 와 완전히 동일하다", () => {
    const base = pixel(40, 50, 60, 255);
    const out = blendExtended(base, pixel(200, 200, 200, 255), "linear-dodge", 0);
    expect([...out.data]).toEqual([40, 50, 60, 255]);
  });

  it("반투명 top(α=128) over 불투명 base: co = as·B + (1−as)·cb", () => {
    // B(linear-dodge) = 200/255, co = (128·200 + 127·100)/255² → ×255 = 150.196 → 150
    const out = blendExtended(pixel(100, 100, 100, 255), pixel(100, 100, 100, 128), "linear-dodge", 1);
    expect([...out.data]).toEqual([150, 150, 150, 255]);
  });

  it("opacity 0.4 불투명×불투명: co = 0.4·B + 0.6·cb (선형 닷지 100+200 → 162)", () => {
    const out = blendExtended(pixel(100, 100, 100, 255), pixel(200, 200, 200, 255), "linear-dodge", 0.4);
    expect([...out.data]).toEqual([162, 162, 162, 255]);
  });

  it("반투명×반투명: unpremultiply 와 αo = αs + αb(1−αs) 를 함께 검증", () => {
    // base 검정 α=128, top 흰색 α=128, subtract → B=0
    // co = as(1−ab)·1 = (128·127)/255², αo = (128·255 + 128·127)/255²
    // 색 = co/αo ×255 = 84.78 → 85, 알파 = αo×255 = 191.75 → 192
    const out = blendExtended(pixel(0, 0, 0, 128), pixel(255, 255, 255, 128), "subtract", 1);
    expect([...out.data]).toEqual([85, 85, 85, 192]);
  });
});

describe("blendExtended — 결정성·불변성·방어", () => {
  it("같은 입력이면 항상 같은 출력(결정적)이고 입력을 변형하지 않는다", () => {
    const base: StudioImageDataLike = {
      data: new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 50, 128]),
      width: 2,
      height: 1,
    };
    const top: StudioImageDataLike = {
      data: new Uint8ClampedArray([90, 80, 70, 200, 5, 250, 125, 0]),
      width: 2,
      height: 1,
    };
    const baseSnapshot = [...base.data];
    const topSnapshot = [...top.data];
    const first = blendExtended(base, top, "vivid-light", 0.7);
    const second = blendExtended(base, top, "vivid-light", 0.7);
    expect([...first.data]).toEqual([...second.data]);
    expect(first.data).not.toBe(base.data);
    expect([...base.data]).toEqual(baseSnapshot);
    expect([...top.data]).toEqual(topSnapshot);
    expect(first.width).toBe(2);
    expect(first.height).toBe(1);
  });

  it("모든 모드에서 출력 크기·채널 범위가 유효하다", () => {
    const base = pixel(23, 145, 250, 190);
    const top = pixel(240, 13, 99, 77);
    for (const mode of EXTENDED_BLEND_MODES) {
      const out = blendExtended(base, top, mode.id, 0.85);
      expect(out.data.length).toBe(4);
      for (const byte of out.data) {
        expect(byte).toBeGreaterThanOrEqual(0);
        expect(byte).toBeLessThanOrEqual(255);
        expect(Number.isInteger(byte)).toBe(true);
      }
    }
  });

  it("비유한 opacity 는 1로, 범위 밖 opacity 는 0..1 로 정리한다", () => {
    const base = pixel(100, 100, 100, 255);
    const top = pixel(50, 50, 50, 255);
    const nan = blendExtended(base, top, "linear-dodge", Number.NaN);
    const full = blendExtended(base, top, "linear-dodge", 1);
    expect([...nan.data]).toEqual([...full.data]);
    const over = blendExtended(base, top, "linear-dodge", 5);
    expect([...over.data]).toEqual([...full.data]);
    const under = blendExtended(base, top, "linear-dodge", -3);
    expect([...under.data]).toEqual([...base.data]);
  });

  it("크기가 다르거나 버퍼 길이가 어긋나면 throw", () => {
    const one = pixel(0, 0, 0);
    const wide: StudioImageDataLike = {
      data: new Uint8ClampedArray(8),
      width: 2,
      height: 1,
    };
    expect(() => blendExtended(one, wide, "subtract", 1)).toThrow(/크기가 같아야/);
    const broken: StudioImageDataLike = {
      data: new Uint8ClampedArray(3),
      width: 1,
      height: 1,
    };
    expect(() => blendExtended(broken, one, "subtract", 1)).toThrow(/올바르지 않습니다/);
    expect(() => blendExtended(one, broken, "subtract", 1)).toThrow(/올바르지 않습니다/);
  });
});
