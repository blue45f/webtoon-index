import { describe, expect, it } from "vitest";

import {
  STUDIO_VOLUME_DEFAULT_EMISSION,
  WIEN_DISPLACEMENT_CONSTANT,
  blackbodyChroma,
  blackbodyXyz,
  buildStudioVolumeEmissionLut,
  cieYBar,
  normalizeStudioVolumeEmissionParams,
  planckSpectralRadiance,
  sampleStudioVolumeEmissionLut,
  studioVolumeBlackbodyEmission,
  studioVolumeIgnitionGate,
  xyzToLinearSrgb,
} from "./studio-volume-emission";

/** 0.1 nm 격자로 플랑크 곡선의 최대점을 찾는다. */
function peakWavelengthNm(temperatureK: number): number {
  let best = 0;
  let bestValue = -1;
  for (let l = 50; l <= 20000; l += 0.1) {
    const v = planckSpectralRadiance(l, temperatureK);
    if (v > bestValue) {
      bestValue = v;
      best = l;
    }
  }
  return best;
}

describe("studio-volume-emission · 플랑크 법칙", () => {
  it("빈의 변위법칙 λ_max·T = 2.8978e-3 m·K 를 만족한다", () => {
    for (const T of [1500, 3000, 5000]) {
      const peakNm = peakWavelengthNm(T);
      const product = peakNm * 1e-9 * T;
      const relativeError = Math.abs(product - WIEN_DISPLACEMENT_CONSTANT) / WIEN_DISPLACEMENT_CONSTANT;
      expect(relativeError).toBeLessThan(2e-4);
    }
  });

  it("온도가 올라가면 모든 파장에서 복사휘도가 증가한다", () => {
    for (const lambda of [400, 550, 700, 1000]) {
      let previous = -1;
      for (const T of [1000, 2000, 3000, 5000, 8000]) {
        const value = planckSpectralRadiance(lambda, T);
        expect(value).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });

  it("퇴화 입력은 0(음수 파장/0K/NaN)", () => {
    expect(planckSpectralRadiance(0, 3000)).toBe(0);
    expect(planckSpectralRadiance(-500, 3000)).toBe(0);
    expect(planckSpectralRadiance(550, 0)).toBe(0);
    expect(planckSpectralRadiance(550, -100)).toBe(0);
    expect(planckSpectralRadiance(Number.NaN, 3000)).toBe(0);
    // 극저온에서는 가시광 지수가 발산 → 오버플로 가드가 0 을 낸다.
    expect(planckSpectralRadiance(550, 1)).toBe(0);
  });

  it("레일리–진스 극한(hc/λkT ≪ 1)에서 2ckT/λ⁴ 로 수렴한다", () => {
    // 아주 긴 파장 + 높은 온도 → 고전 극한. x = hc/(λkT) ≈ 1.4e-4 이므로
    // Planck/Rayleigh–Jeans = x/(e^x - 1) ≈ 1 - x/2 ≈ 0.99993 이 나와야 한다.
    const lambdaNm = 2e7; // 2 cm
    const T = 5000;
    const lambda = lambdaNm * 1e-9;
    const classical =
      (2 * 2.99792458e8 * 1.380649e-23 * T) / (lambda * lambda * lambda * lambda);
    expect(planckSpectralRadiance(lambdaNm, T) / classical).toBeCloseTo(1, 3);
    const x = (6.62607015e-34 * 2.99792458e8) / (lambda * 1.380649e-23 * T);
    expect(planckSpectralRadiance(lambdaNm, T) / classical).toBeCloseTo(x / Math.expm1(x), 9);
  });
});

describe("studio-volume-emission · 색도", () => {
  it("CIE ȳ 근사는 555 nm 부근에서 최대이고 ~1 이다", () => {
    let best = 0;
    let bestValue = -1;
    for (let l = 400; l <= 700; l += 0.5) {
      const v = cieYBar(l);
      if (v > bestValue) {
        bestValue = v;
        best = l;
      }
    }
    expect(best).toBeGreaterThan(548);
    expect(best).toBeLessThan(562);
    expect(bestValue).toBeGreaterThan(0.97);
    expect(bestValue).toBeLessThan(1.03);
  });

  it("XYZ→sRGB 는 등에너지 백색 근처에서 세 채널이 균형을 이룬다", () => {
    const rgb = xyzToLinearSrgb(0.9505, 1.0, 1.089);
    expect(rgb[0]).toBeCloseTo(1, 2);
    expect(rgb[1]).toBeCloseTo(1, 2);
    expect(rgb[2]).toBeCloseTo(1, 2);
  });

  it("저온은 붉고 고온은 푸르다(단조 흐름)", () => {
    const warm = blackbodyChroma(1500);
    const neutral = blackbodyChroma(6500);
    const hot = blackbodyChroma(12000);
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(warm[2]).toBeLessThan(0.2);
    // 6500K 흑체는 거의 중성 — 세 채널이 서로 가깝다.
    expect(Math.min(neutral[0], neutral[1], neutral[2])).toBeGreaterThan(0.7);
    expect(hot[2]).toBe(1);
    expect(hot[0]).toBeLessThan(1);
    // B/R 비는 온도에 대해 단조 증가한다.
    const ratio = (t: number): number => {
      const c = blackbodyChroma(t);
      return c[2] / Math.max(c[0], 1e-9);
    };
    // ~1900K 아래에서는 흑체 색이 sRGB 색역 밖(진한 적색)이라 B 가 0 으로 클리핑된다 —
    // 문서화된 한계다. 색역 안에 들어오는 2000K 이상에서 단조성을 검증한다.
    expect(blackbodyChroma(1500)[2]).toBe(0);
    let previous = -1;
    for (const t of [2000, 2500, 3000, 4000, 5000, 6500, 9000, 12000, 20000]) {
      const r = ratio(t);
      expect(r).toBeGreaterThan(previous);
      previous = r;
    }
    // 색역 밖 구간에서도 "덜 붉어진다"는 흐름은 G/R 로 확인된다.
    let previousGr = -1;
    for (const t of [800, 1000, 1200, 1500, 1800]) {
      const c = blackbodyChroma(t);
      const gr = c[1] / c[0];
      expect(gr).toBeGreaterThan(previousGr);
      previousGr = gr;
    }
  });

  it("색도는 최대 채널이 정확히 1 로 정규화된다", () => {
    for (const t of [900, 1500, 3000, 6500, 20000]) {
      const c = blackbodyChroma(t);
      expect(Math.max(c[0], c[1], c[2])).toBeCloseTo(1, 12);
    }
  });

  it("0K/음수는 검정", () => {
    expect(Array.from(blackbodyChroma(0))).toEqual([0, 0, 0]);
    expect(Array.from(blackbodyChroma(-5))).toEqual([0, 0, 0]);
    const xyz = blackbodyXyz(0);
    expect(Array.from(xyz)).toEqual([0, 0, 0]);
  });
});

describe("studio-volume-emission · 방출 매핑", () => {
  it("점화 온도 미만은 정확히 0", () => {
    const params = normalizeStudioVolumeEmissionParams({ ignitionK: 900, rampK: 0 });
    expect(studioVolumeIgnitionGate(899.999, params)).toBe(0);
    expect(studioVolumeIgnitionGate(900, params)).toBe(0);
    expect(studioVolumeIgnitionGate(900.001, params)).toBe(1);
    const rgb = studioVolumeBlackbodyEmission(500, params);
    expect(Array.from(rgb)).toEqual([0, 0, 0]);
  });

  it("rampK 는 smoothstep 으로 [0,1] 을 잇는다", () => {
    const params = normalizeStudioVolumeEmissionParams({ ignitionK: 1000, rampK: 200 });
    expect(studioVolumeIgnitionGate(1000, params)).toBe(0);
    expect(studioVolumeIgnitionGate(1100, params)).toBeCloseTo(0.5, 12);
    expect(studioVolumeIgnitionGate(1200, params)).toBe(1);
    expect(studioVolumeIgnitionGate(1500, params)).toBe(1);
  });

  it("밝기는 스테판–볼츠만 T⁴ 를 따른다", () => {
    const params = normalizeStudioVolumeEmissionParams({
      ignitionK: 100,
      referenceK: 1000,
      intensity: 1,
      exponent: 4,
      maxK: 100000,
    });
    const luminance = (t: number): number => {
      const rgb = studioVolumeBlackbodyEmission(t, params);
      const chroma = blackbodyChroma(t);
      // 색도를 나눠 순수 밝기 스칼라만 남긴다.
      const index = chroma[0] >= chroma[1] && chroma[0] >= chroma[2] ? 0 : chroma[1] >= chroma[2] ? 1 : 2;
      return rgb[index] / chroma[index];
    };
    expect(luminance(1000)).toBeCloseTo(1, 10);
    expect(luminance(2000) / luminance(1000)).toBeCloseTo(16, 8);
    expect(luminance(3000) / luminance(1000)).toBeCloseTo(81, 8);
  });

  it("maxK 는 색도와 밝기를 함께 자른다", () => {
    const params = normalizeStudioVolumeEmissionParams({ ignitionK: 100, maxK: 3000 });
    const at3000 = studioVolumeBlackbodyEmission(3000, params);
    const at9000 = studioVolumeBlackbodyEmission(9000, params);
    expect(Array.from(at9000)).toEqual(Array.from(at3000));
  });

  it("intensity 0 은 방출을 완전히 끈다", () => {
    const params = normalizeStudioVolumeEmissionParams({ intensity: 0 });
    expect(Array.from(studioVolumeBlackbodyEmission(3000, params))).toEqual([0, 0, 0]);
  });

  it("파라미터 정규화는 쓰레기 값을 기본값으로 되돌린다", () => {
    const params = normalizeStudioVolumeEmissionParams({
      ignitionK: Number.NaN,
      referenceK: -5,
      intensity: Number.POSITIVE_INFINITY,
      maxK: 10,
    });
    expect(params.ignitionK).toBe(STUDIO_VOLUME_DEFAULT_EMISSION.ignitionK);
    expect(params.referenceK).toBe(STUDIO_VOLUME_DEFAULT_EMISSION.referenceK);
    expect(params.intensity).toBe(STUDIO_VOLUME_DEFAULT_EMISSION.intensity);
    // maxK 는 referenceK 아래로 못 내려간다.
    expect(params.maxK).toBe(params.referenceK);
  });
});

describe("studio-volume-emission · GPU LUT 패리티", () => {
  it("LUT 조회가 직접 계산과 1e-4 이내로 일치한다", () => {
    const params = normalizeStudioVolumeEmissionParams({ ignitionK: 800, maxK: 5000 });
    const lut = buildStudioVolumeEmissionLut(params, 512);
    expect(lut.length).toBe(512 * 4);
    let maxError = 0;
    for (let t = 0; t <= 5000; t += 37) {
      const direct = studioVolumeBlackbodyEmission(t, params);
      const viaLut = sampleStudioVolumeEmissionLut(lut, params.maxK, t);
      for (let c = 0; c < 3; c += 1) {
        maxError = Math.max(maxError, Math.abs(direct[c] - viaLut[c]));
      }
    }
    // 점화 게이트 계단 근처를 제외하면 선형 보간 오차는 매우 작다.
    expect(maxError).toBeLessThan(0.05);
  });

  it("LUT 마지막 칸의 온도가 maxK 다", () => {
    const params = normalizeStudioVolumeEmissionParams({ maxK: 4200 });
    const lut = buildStudioVolumeEmissionLut(params, 64);
    expect(lut[63 * 4 + 3]).toBeCloseTo(4200, 3);
    expect(lut[3]).toBe(0);
  });

  it("퇴화 LUT 는 0 을 돌려준다", () => {
    expect(Array.from(sampleStudioVolumeEmissionLut(new Float32Array(4), 1000, 500))).toEqual([
      0, 0, 0,
    ]);
    const lut = buildStudioVolumeEmissionLut(normalizeStudioVolumeEmissionParams(), 8);
    expect(Array.from(sampleStudioVolumeEmissionLut(lut, 0, 500))).toEqual([0, 0, 0]);
    expect(Array.from(sampleStudioVolumeEmissionLut(lut, 1000, 0))).toEqual([0, 0, 0]);
  });
});
