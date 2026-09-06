import { describe, expect, it } from "vitest";

import {
  STUDIO_VOLUME_ISOTROPIC_PHASE,
  STUDIO_VOLUME_MAX_ANISOTROPY,
  clampStudioVolumeAnisotropy,
  henyeyGreensteinPhase,
  integrateStudioVolumePhaseOverSphere,
  sampleHenyeyGreensteinCosine,
  sampleStudioVolumePhaseDirection,
  studioVolumeOrthonormalBasis,
} from "./studio-volume-phase";
import { studioVolumeHashFloat } from "./studio-volume-sampler";

describe("studio-volume-phase · 정규화", () => {
  it("∮ p dω = 1 (여러 g 에서 1e-6 이내)", () => {
    for (const g of [-0.8, -0.5, -0.2, 0, 0.2, 0.5, 0.8]) {
      const integral = integrateStudioVolumePhaseOverSphere(g, 40000);
      expect(Math.abs(integral - 1)).toBeLessThan(1e-6);
    }
  });

  it("g = 0 은 모든 각도에서 정확히 등방(1/4π)", () => {
    for (const mu of [-1, -0.5, 0, 0.37, 1]) {
      expect(henyeyGreensteinPhase(0, mu)).toBe(STUDIO_VOLUME_ISOTROPIC_PHASE);
    }
    expect(STUDIO_VOLUME_ISOTROPIC_PHASE).toBeCloseTo(1 / (4 * Math.PI), 15);
  });

  it("g > 0 은 전방(μ=+1)이 후방(μ=-1)보다 크다", () => {
    expect(henyeyGreensteinPhase(0.6, 1)).toBeGreaterThan(henyeyGreensteinPhase(0.6, -1));
    expect(henyeyGreensteinPhase(-0.6, 1)).toBeLessThan(henyeyGreensteinPhase(-0.6, -1));
  });

  it("해석식과 직접 대조한다", () => {
    const g = 0.4;
    const mu = 0.25;
    const expected = (1 - g * g) / (4 * Math.PI * Math.pow(1 + g * g - 2 * g * mu, 1.5));
    expect(henyeyGreensteinPhase(g, mu)).toBeCloseTo(expected, 14);
  });

  it("cosTheta 와 g 는 안전 구간으로 클램프된다", () => {
    expect(henyeyGreensteinPhase(0.5, 5)).toBe(henyeyGreensteinPhase(0.5, 1));
    expect(henyeyGreensteinPhase(2, 0.5)).toBe(
      henyeyGreensteinPhase(STUDIO_VOLUME_MAX_ANISOTROPY, 0.5)
    );
    expect(clampStudioVolumeAnisotropy(Number.NaN)).toBe(0);
    expect(Number.isFinite(henyeyGreensteinPhase(0.995, 1))).toBe(true);
  });
});

describe("studio-volume-phase · 중요도 샘플링", () => {
  it("역변환 끝점: u=0 → μ=-1, u=1 → μ=+1", () => {
    for (const g of [-0.7, -0.3, 0.3, 0.7]) {
      expect(sampleHenyeyGreensteinCosine(g, 0)).toBeCloseTo(-1, 12);
      expect(sampleHenyeyGreensteinCosine(g, 1)).toBeCloseTo(1, 12);
    }
  });

  it("g=0 은 μ 가 [-1,1] 균등(등방)", () => {
    expect(sampleHenyeyGreensteinCosine(0, 0.5)).toBeCloseTo(0, 15);
    expect(sampleHenyeyGreensteinCosine(0, 0.25)).toBeCloseTo(0.5, 15);
  });

  it("르장드르 모멘트: ⟨μ⟩ = g, ⟨μ²⟩ = (2g²+1)/3", () => {
    const samples = 200000;
    for (const g of [-0.5, 0, 0.3, 0.7]) {
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < samples; i += 1) {
        // 계층화된 균등 u — 결정적이고 저분산.
        const u = (i + studioVolumeHashFloat(1234, i, g * 1000)) / samples;
        const mu = sampleHenyeyGreensteinCosine(g, u);
        sum += mu;
        sumSq += mu * mu;
      }
      const meanMu = sum / samples;
      const meanMuSq = sumSq / samples;
      expect(Math.abs(meanMu - g)).toBeLessThan(5e-3);
      expect(Math.abs(meanMuSq - (2 * g * g + 1) / 3)).toBeLessThan(5e-3);
    }
  });

  it("샘플 방향은 단위벡터이고 입사축과의 내적이 샘플된 μ 와 같다", () => {
    const out = new Float64Array(3);
    const wx = 0.6;
    const wy = 0;
    const wz = 0.8;
    for (let i = 0; i < 500; i += 1) {
      const u1 = studioVolumeHashFloat(7, i, 0);
      const u2 = studioVolumeHashFloat(7, i, 1);
      const pdf = sampleStudioVolumePhaseDirection(0.5, wx, wy, wz, u1, u2, out);
      expect(Math.hypot(out[0], out[1], out[2])).toBeCloseTo(1, 10);
      const cosTheta = out[0] * wx + out[1] * wy + out[2] * wz;
      expect(pdf).toBeCloseTo(henyeyGreensteinPhase(0.5, cosTheta), 8);
    }
  });

  it("정규직교기저는 직교·단위이며 w 와도 직교한다", () => {
    const normalize = (v: readonly number[]): number[] => {
      const len = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / len, v[1] / len, v[2] / len];
    };
    for (const raw of [
      [0, 0, 1],
      [0, 0, -1],
      [1, 2, 3],
      [-1, 1, -1],
      [1, 0, -1e-8],
    ]) {
      const w = normalize(raw);
      const basis = studioVolumeOrthonormalBasis(w[0], w[1], w[2]);
      const t0 = [basis[0], basis[1], basis[2]];
      const t1 = [basis[3], basis[4], basis[5]];
      expect(Math.hypot(t0[0], t0[1], t0[2])).toBeCloseTo(1, 9);
      expect(Math.hypot(t1[0], t1[1], t1[2])).toBeCloseTo(1, 9);
      expect(t0[0] * t1[0] + t0[1] * t1[1] + t0[2] * t1[2]).toBeCloseTo(0, 9);
      expect(t0[0] * w[0] + t0[1] * w[1] + t0[2] * w[2]).toBeCloseTo(0, 9);
      expect(t1[0] * w[0] + t1[1] * w[1] + t1[2] * w[2]).toBeCloseTo(0, 9);
    }
  });
});
