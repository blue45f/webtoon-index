import { describe, expect, it } from "vitest";

import {
  SCULPT_FALLOFF_KERNELS,
  normalizeSculptFalloffKernel,
  sculptFalloff,
  sculptFalloffWeight,
} from "./studio-sculpt-falloff";

describe("sculpt falloff — 커널 계약", () => {
  it("모든 커널이 f(0) = 1, f(1) = 0 이다", () => {
    for (const kernel of SCULPT_FALLOFF_KERNELS) {
      expect(sculptFalloff(kernel, 0)).toBe(1);
      expect(sculptFalloff(kernel, 1)).toBe(0);
    }
  });

  it("모든 커널이 [0,1] 구간에서 단조 비증가이고 값이 [0,1] 안이다", () => {
    const samples = 512;
    for (const kernel of SCULPT_FALLOFF_KERNELS) {
      let previous = sculptFalloff(kernel, 0);
      for (let i = 1; i <= samples; i += 1) {
        const value = sculptFalloff(kernel, i / samples);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it("반경 밖(t > 1)과 음수(t < 0)를 클램프한다", () => {
    for (const kernel of SCULPT_FALLOFF_KERNELS) {
      expect(sculptFalloff(kernel, 1.0001)).toBe(0);
      expect(sculptFalloff(kernel, 12)).toBe(0);
      expect(sculptFalloff(kernel, -0.5)).toBe(1);
      expect(sculptFalloff(kernel, Number.NaN)).toBe(0);
    }
  });

  it("각 커널의 중간값이 정의된 수식과 일치한다", () => {
    // smooth = Hann, linear = 원뿔, sharp = 제곱, sphere = 반구, constant = 계단.
    expect(sculptFalloff("smooth", 0.5)).toBeCloseTo(0.5, 12);
    expect(sculptFalloff("smooth", 0.25)).toBeCloseTo(0.5 + 0.5 * Math.cos(Math.PI * 0.25), 12);
    expect(sculptFalloff("linear", 0.25)).toBe(0.75);
    expect(sculptFalloff("sharp", 0.5)).toBe(0.25);
    expect(sculptFalloff("sphere", 0.6)).toBeCloseTo(0.8, 12);
    expect(sculptFalloff("constant", 0.999)).toBe(1);
  });

  it("서로 다른 커널은 실제로 다른 감쇠를 준다(이름만 다른 게 아니다)", () => {
    const at = (t: number): number[] =>
      SCULPT_FALLOFF_KERNELS.map((kernel) => sculptFalloff(kernel, t));
    const values = at(0.3);
    expect(new Set(values).size).toBe(SCULPT_FALLOFF_KERNELS.length);
    // t = 0.5 에서는 smooth 와 linear 가 우연히 같은 값(0.5)을 갖는다 — 그 사실도 못 박는다.
    expect(sculptFalloff("smooth", 0.5)).toBe(sculptFalloff("linear", 0.5));
  });
});

describe("sculpt falloff — 월드 거리 래퍼", () => {
  it("distance / radius 로 정규화한다", () => {
    expect(sculptFalloffWeight("linear", 0.5, 2)).toBe(0.75);
    expect(sculptFalloffWeight("linear", 2, 2)).toBe(0);
    expect(sculptFalloffWeight("linear", 3, 2)).toBe(0);
  });

  it("반경이 0 이하이거나 거리가 음수면 0 이다", () => {
    expect(sculptFalloffWeight("smooth", 0, 0)).toBe(0);
    expect(sculptFalloffWeight("smooth", 0, -1)).toBe(0);
    expect(sculptFalloffWeight("smooth", -1, 1)).toBe(0);
  });
});

describe("sculpt falloff — 정규화", () => {
  it("알 수 없는 값은 기본 커널(smooth)로 폴백한다", () => {
    expect(normalizeSculptFalloffKernel("sphere")).toBe("sphere");
    expect(normalizeSculptFalloffKernel("nope")).toBe("smooth");
    expect(normalizeSculptFalloffKernel(undefined)).toBe("smooth");
    expect(normalizeSculptFalloffKernel(3)).toBe("smooth");
  });
});
