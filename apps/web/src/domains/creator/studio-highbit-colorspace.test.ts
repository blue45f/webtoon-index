import { describe, expect, it } from "vitest";

import {
  STUDIO_HIGHBIT_DISPLAY_P3_TO_SRGB,
  STUDIO_HIGHBIT_LUMINANCE_WEIGHTS,
  STUDIO_HIGHBIT_SRGB_TO_DISPLAY_P3,
  STUDIO_HIGHBIT_SRGB_TO_XYZ,
  applyStudioHighBitMatrix3,
  clipStudioHighBitToGamut,
  convertStudioHighBitLinearGamut,
  invertStudioHighBitMatrix3,
  isStudioHighBitInGamut,
  multiplyStudioHighBitMatrix3,
  studioHighBitGamutMatrix,
  studioHighBitRelativeLuminance,
  type StudioHighBitRgb,
} from "./studio-highbit-colorspace";

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

describe("원색 행렬", () => {
  it("유도된 sRGB→P3 행렬이 문헌값과 일치한다", () => {
    const expected = [
      0.8224621, 0.1775380, 0.0000000,
      0.0331941, 0.9668058, 0.0000000,
      0.0170827, 0.0723974, 0.9105199,
    ];
    STUDIO_HIGHBIT_SRGB_TO_DISPLAY_P3.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index]!, 6);
    });
  });

  it("유도된 P3→sRGB 행렬이 문헌값과 일치한다", () => {
    const expected = [
      1.2249401, -0.2249404, 0.0000000,
      -0.0420569, 1.0420571, 0.0000000,
      -0.0196376, -0.0786361, 1.0982735,
    ];
    STUDIO_HIGHBIT_DISPLAY_P3_TO_SRGB.forEach((value, index) => {
      expect(value).toBeCloseTo(expected[index]!, 6);
    });
  });

  it("두 행렬의 곱이 단위행렬이다(왕복 정확성)", () => {
    const product = multiplyStudioHighBitMatrix3(
      STUDIO_HIGHBIT_DISPLAY_P3_TO_SRGB,
      STUDIO_HIGHBIT_SRGB_TO_DISPLAY_P3
    );
    product.forEach((value, index) => {
      expect(value).toBeCloseTo(IDENTITY[index]!, 12);
    });
  });

  it("휘도 가중치가 XYZ 행렬의 Y 행과 같다", () => {
    expect(STUDIO_HIGHBIT_LUMINANCE_WEIGHTS[0]).toBe(STUDIO_HIGHBIT_SRGB_TO_XYZ[3]);
    expect(STUDIO_HIGHBIT_LUMINANCE_WEIGHTS[1]).toBe(STUDIO_HIGHBIT_SRGB_TO_XYZ[4]);
    expect(STUDIO_HIGHBIT_LUMINANCE_WEIGHTS[2]).toBe(STUDIO_HIGHBIT_SRGB_TO_XYZ[5]);
    // 흰색의 상대휘도는 정확히 1.
    expect(studioHighBitRelativeLuminance([1, 1, 1])).toBeCloseTo(1, 12);
  });

  it("특이행렬은 역변환을 거부한다", () => {
    expect(invertStudioHighBitMatrix3([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull();
  });

  it("같은 개멋끼리는 단위행렬을 준다", () => {
    expect(studioHighBitGamutMatrix("srgb", "srgb")).toEqual([...IDENTITY]);
    expect(applyStudioHighBitMatrix3(studioHighBitGamutMatrix("display-p3", "display-p3"), [0.3, 0.6, 0.9]))
      .toEqual([0.3, 0.6, 0.9]);
  });
});

describe("sRGB ↔ Display P3 왕복", () => {
  it("256³ 대신 균등 격자에서 왕복 오차가 1e-12 이내다", () => {
    let worst = 0;
    for (let r = 0; r <= 1.0001; r += 0.125) {
      for (let g = 0; g <= 1.0001; g += 0.125) {
        for (let b = 0; b <= 1.0001; b += 0.125) {
          const source: StudioHighBitRgb = [r, g, b];
          const p3 = convertStudioHighBitLinearGamut(source, "srgb", "display-p3");
          const back = convertStudioHighBitLinearGamut(p3, "display-p3", "srgb");
          for (let channel = 0; channel < 3; channel += 1) {
            worst = Math.max(worst, Math.abs(back[channel]! - source[channel]!));
          }
        }
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("무채색은 두 공간에서 동일하다(같은 D65 백색점)", () => {
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const converted = convertStudioHighBitLinearGamut([level, level, level], "srgb", "display-p3");
      expect(converted[0]).toBeCloseTo(level, 12);
      expect(converted[1]).toBeCloseTo(level, 12);
      expect(converted[2]).toBeCloseTo(level, 12);
    }
  });

  it("sRGB 원색은 P3 안쪽에 들어가고, P3 원색은 sRGB 밖으로 나간다", () => {
    const redInP3 = convertStudioHighBitLinearGamut([1, 0, 0], "srgb", "display-p3");
    expect(isStudioHighBitInGamut(redInP3)).toBe(true);
    expect(redInP3[0]).toBeCloseTo(0.8224621, 6);

    const p3GreenInSrgb = convertStudioHighBitLinearGamut([0, 1, 0], "display-p3", "srgb");
    expect(isStudioHighBitInGamut(p3GreenInSrgb)).toBe(false);
    expect(p3GreenInSrgb[0]).toBeLessThan(-0.2);
    expect(p3GreenInSrgb[1]).toBeGreaterThan(1);
  });
});

describe("개멋 밖 클리핑", () => {
  const p3Green = convertStudioHighBitLinearGamut([0, 1, 0], "display-p3", "srgb");

  it("clamp 는 범위 안으로 넣지만 휘도를 밀어 올린다", () => {
    const clamped = clipStudioHighBitToGamut(p3Green, "clamp");
    expect(isStudioHighBitInGamut(clamped)).toBe(true);
    expect(clamped).toEqual([0, 1, 0]);
    const shift = studioHighBitRelativeLuminance(clamped) - studioHighBitRelativeLuminance(p3Green);
    // 채널 절단은 상대휘도를 2% 이상 튀게 만든다 — 그라데이션에서 눈에 띄는 이유.
    expect(shift).toBeGreaterThan(0.02);
  });

  it("desaturate 는 상대휘도를 보존한 채 범위 안으로 넣는다", () => {
    const folded = clipStudioHighBitToGamut(p3Green, "desaturate");
    expect(isStudioHighBitInGamut(folded)).toBe(true);
    expect(studioHighBitRelativeLuminance(folded))
      .toBeCloseTo(studioHighBitRelativeLuminance(p3Green), 12);
    // 무채축 쪽으로만 접히므로 초록이 여전히 지배 채널이다.
    expect(folded[1]).toBeGreaterThan(folded[0]!);
    expect(folded[1]).toBeGreaterThan(folded[2]!);
  });

  it("이미 개멋 안이면 두 모드 모두 값을 바꾸지 않는다", () => {
    const inside: StudioHighBitRgb = [0.2, 0.4, 0.6];
    expect(clipStudioHighBitToGamut(inside, "clamp")).toEqual([0.2, 0.4, 0.6]);
    expect(clipStudioHighBitToGamut(inside, "desaturate")).toEqual([0.2, 0.4, 0.6]);
  });

  it("비유한 채널을 0 으로 접는다", () => {
    expect(clipStudioHighBitToGamut([Number.NaN, 0.5, Number.POSITIVE_INFINITY], "clamp"))
      .toEqual([0, 0.5, 0]);
  });
});
