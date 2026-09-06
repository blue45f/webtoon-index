import { describe, expect, it } from "vitest";

import {
  STUDIO_HIGHBIT_BYTE_TO_LINEAR,
  STUDIO_HIGHBIT_MIN_LINEAR_STEP_PER_BYTE_CODE,
  clampStudioHighBitUnit,
  studioHighBitByteToLinear,
  studioHighBitLinearToByte,
  studioHighBitLinearToSrgb,
  studioHighBitSrgbToLinear,
} from "./studio-highbit-transfer";

describe("sRGB 전달 함수", () => {
  it("표준 고정점을 정확히 재현한다", () => {
    expect(studioHighBitSrgbToLinear(0)).toBe(0);
    expect(studioHighBitSrgbToLinear(1)).toBeCloseTo(1, 12);
    expect(studioHighBitLinearToSrgb(0)).toBe(0);
    expect(studioHighBitLinearToSrgb(1)).toBeCloseTo(1, 12);
    // 8비트 중간 코드 128 의 선형광 — 널리 인용되는 0.2158605 값.
    expect(studioHighBitSrgbToLinear(128 / 255)).toBeCloseTo(0.21586050011, 10);
    // 18% 그레이카드의 부호화값.
    expect(studioHighBitLinearToSrgb(0.18)).toBeCloseTo(0.4613561295, 9);
  });

  it("조각별 정의의 이음매가 연속이다", () => {
    const threshold = 0.04045;
    const below = studioHighBitSrgbToLinear(threshold - 1e-9);
    const above = studioHighBitSrgbToLinear(threshold + 1e-9);
    expect(Math.abs(above - below)).toBeLessThan(1e-7);
  });

  it("EOTF↔OETF 왕복이 256 코드 전부에서 무손실이다", () => {
    for (let code = 0; code < 256; code += 1) {
      const encoded = code / 255;
      expect(studioHighBitLinearToSrgb(studioHighBitSrgbToLinear(encoded))).toBeCloseTo(encoded, 12);
      expect(studioHighBitLinearToByte(studioHighBitByteToLinear(code))).toBe(code);
    }
  });

  it("근사 감마 2.2 로 대체하면 어두운 구간에서 오차가 크다(근사 금지 근거)", () => {
    let worst = 0;
    for (let code = 0; code < 256; code += 1) {
      const encoded = code / 255;
      const approximate = Math.pow(encoded, 2.2);
      const exact = studioHighBitSrgbToLinear(encoded);
      worst = Math.max(worst, Math.abs(studioHighBitLinearToSrgb(approximate) - studioHighBitLinearToSrgb(exact)) * 255);
    }
    // 근사와 정확 정의는 최소 1코드 이상 벌어진다 — 밴딩이 보이는 그 구간에서.
    expect(worst).toBeGreaterThan(1);
  });

  it("부호를 보존해 [0,1] 밖 중간값을 살린다(개멋 변환 전제)", () => {
    expect(studioHighBitSrgbToLinear(-0.5)).toBeCloseTo(-studioHighBitSrgbToLinear(0.5), 15);
    expect(studioHighBitLinearToSrgb(-0.5)).toBeCloseTo(-studioHighBitLinearToSrgb(0.5), 15);
  });

  it("비유한 입력을 0 으로 접는다", () => {
    expect(studioHighBitSrgbToLinear(Number.NaN)).toBe(0);
    expect(studioHighBitLinearToSrgb(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampStudioHighBitUnit(Number.NaN)).toBe(0);
    expect(clampStudioHighBitUnit(-3)).toBe(0);
    expect(clampStudioHighBitUnit(3)).toBe(1);
  });

  it("룩업 테이블이 계산 경로와 비트 동일하다", () => {
    expect(STUDIO_HIGHBIT_BYTE_TO_LINEAR).toHaveLength(256);
    for (let code = 0; code < 256; code += 1) {
      expect(STUDIO_HIGHBIT_BYTE_TO_LINEAR[code]).toBe(studioHighBitSrgbToLinear(code / 255));
    }
  });
});

describe("uint16 선형 고정소수점의 정밀도 마진", () => {
  it("8비트 코드 하나를 최소 19 조각 이상으로 쪼갠다", () => {
    // 가장 촘촘한 구간은 EOTF 의 선형 구간: Δlinear = (1/255)/12.92.
    expect(STUDIO_HIGHBIT_MIN_LINEAR_STEP_PER_BYTE_CODE).toBeCloseTo((1 / 255) / 12.92, 12);
    const subSteps = STUDIO_HIGHBIT_MIN_LINEAR_STEP_PER_BYTE_CODE * 65535;
    expect(subSteps).toBeGreaterThan(19);
    expect(subSteps).toBeLessThan(20);
  });
});
