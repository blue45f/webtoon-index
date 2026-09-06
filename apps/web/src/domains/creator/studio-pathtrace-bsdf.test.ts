import { describe, expect, it } from "vitest";

import {
  STUDIO_PATHTRACE_MIN_ALPHA,
  createStudioPathtraceBsdfSample,
  evalStudioPathtraceBsdf,
  pdfStudioPathtraceBsdf,
  sampleStudioPathtraceBsdf,
  studioPathtraceAlphaFromRoughness,
  studioPathtraceDielectricF0,
  studioPathtraceDistributionGgx,
  studioPathtraceSmithG1,
  studioPathtraceSmithG2,
  studioPathtraceSpecularLobeProbability,
} from "./studio-pathtrace-bsdf";
import { studioPathtraceRandom01 } from "./studio-pathtrace-sampler";
import { createStudioPathtraceMaterial } from "./studio-pathtrace-scene";

import type { StudioPathtraceMaterial } from "./studio-pathtrace-scene";

const LAMBERT_WHITE: StudioPathtraceMaterial = createStudioPathtraceMaterial({
  baseColorLinear: [1, 1, 1],
  roughness: 1,
  metallic: 0,
  ior: 1,
});

function uniformHemisphere(u1: number, u2: number): [number, number, number] {
  const z = u1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const phi = 2 * Math.PI * u2;
  return [r * Math.cos(phi), r * Math.sin(phi), z];
}

/** BSDF 샘플링으로 방향 알베도 ∫ f·cos dω 를 추정한다. */
function directionalAlbedo(
  material: StudioPathtraceMaterial,
  cosThetaO: number,
  samples: number,
  seed: number,
): number {
  const wo: [number, number, number] = [Math.sqrt(1 - cosThetaO * cosThetaO), 0, cosThetaO];
  const sample = createStudioPathtraceBsdfSample();
  let sum = 0;
  for (let i = 0; i < samples; i += 1) {
    const uLobe = studioPathtraceRandom01(i, 0, 0, 0, seed);
    const u1 = studioPathtraceRandom01(i, 0, 0, 1, seed);
    const u2 = studioPathtraceRandom01(i, 0, 0, 2, seed);
    sampleStudioPathtraceBsdf(material, wo[0], wo[1], wo[2], uLobe, u1, u2, sample);
    if (!sample.valid) continue;
    sum += (sample.fR * sample.wiZ) / sample.pdf;
  }
  return sum / samples;
}

describe("GGX 항", () => {
  it("D 는 반구에서 cosθ 가중 적분이 1 이다", () => {
    for (const alpha of [0.1, 0.4, 0.9]) {
      let sum = 0;
      const n = 200000;
      for (let i = 0; i < n; i += 1) {
        const [, , hz] = uniformHemisphere(
          studioPathtraceRandom01(i, 0, 0, 0, 17),
          studioPathtraceRandom01(i, 0, 0, 1, 17),
        );
        sum += studioPathtraceDistributionGgx(hz, alpha) * hz;
      }
      const integral = (sum / n) * 2 * Math.PI;
      expect(Math.abs(integral - 1), `alpha=${alpha}`).toBeLessThan(0.03);
    }
  });

  it("Smith G1/G2 는 [0,1] 이고 G2 ≤ G1 이다", () => {
    for (const alpha of [0.05, 0.3, 1]) {
      for (let i = 1; i <= 20; i += 1) {
        const cosO = i / 20;
        const cosI = ((i * 7) % 20) / 20 + 0.01;
        const g1 = studioPathtraceSmithG1(cosO, alpha);
        const g2 = studioPathtraceSmithG2(cosO, cosI, alpha);
        expect(g1).toBeGreaterThan(0);
        expect(g1).toBeLessThanOrEqual(1 + 1e-12);
        expect(g2).toBeGreaterThanOrEqual(0);
        expect(g2).toBeLessThanOrEqual(g1 + 1e-12);
      }
    }
    expect(studioPathtraceSmithG1(-0.1, 0.5)).toBe(0);
    expect(studioPathtraceSmithG2(0.5, -0.1, 0.5)).toBe(0);
  });

  it("roughness → alpha 는 제곱이고 하한이 있다", () => {
    expect(studioPathtraceAlphaFromRoughness(0.5)).toBeCloseTo(0.25, 12);
    expect(studioPathtraceAlphaFromRoughness(0)).toBe(STUDIO_PATHTRACE_MIN_ALPHA);
    expect(studioPathtraceAlphaFromRoughness(2)).toBe(1);
  });

  it("ior = 1 이면 유전체 F0 = 0 이라 스페큘러 로브가 꺼진다", () => {
    expect(studioPathtraceDielectricF0(1)).toBe(0);
    expect(studioPathtraceDielectricF0(1.5)).toBeCloseTo(0.04, 3);
    expect(studioPathtraceSpecularLobeProbability(LAMBERT_WHITE, 0.5)).toBe(0);
    const metal = createStudioPathtraceMaterial({ metallic: 1, baseColorLinear: [1, 1, 1] });
    expect(studioPathtraceSpecularLobeProbability(metal, 0.5)).toBe(1);
  });
});

describe("BSDF sample / eval / pdf 정합", () => {
  const materials: readonly [string, StudioPathtraceMaterial][] = [
    ["순수 lambert", LAMBERT_WHITE],
    ["유전체 거친", createStudioPathtraceMaterial({ roughness: 0.8, metallic: 0, ior: 1.5 })],
    ["유전체 매끈", createStudioPathtraceMaterial({ roughness: 0.15, metallic: 0, ior: 1.5 })],
    [
      "금속 중간",
      createStudioPathtraceMaterial({ roughness: 0.4, metallic: 1, baseColorLinear: [0.9, 0.7, 0.4] }),
    ],
  ];

  for (const [name, material] of materials) {
    it(`${name}: sample 이 돌려준 f/pdf 가 eval/pdf 함수와 일치한다`, () => {
      const sample = createStudioPathtraceBsdfSample();
      const f = [0, 0, 0];
      const wo: [number, number, number] = [0.4, 0.2, Math.sqrt(1 - 0.16 - 0.04)];
      let valid = 0;
      for (let i = 0; i < 3000; i += 1) {
        const uLobe = studioPathtraceRandom01(i, 1, 0, 0, 5);
        const u1 = studioPathtraceRandom01(i, 1, 0, 1, 5);
        const u2 = studioPathtraceRandom01(i, 1, 0, 2, 5);
        sampleStudioPathtraceBsdf(material, wo[0], wo[1], wo[2], uLobe, u1, u2, sample);
        if (!sample.valid) continue;
        valid += 1;
        expect(Math.abs(Math.hypot(sample.wiX, sample.wiY, sample.wiZ) - 1)).toBeLessThan(1e-6);
        expect(sample.wiZ).toBeGreaterThan(0);
        const pdf = pdfStudioPathtraceBsdf(
          material,
          wo[0],
          wo[1],
          wo[2],
          sample.wiX,
          sample.wiY,
          sample.wiZ,
        );
        expect(pdf).toBeCloseTo(sample.pdf, 12);
        evalStudioPathtraceBsdf(material, wo[0], wo[1], wo[2], sample.wiX, sample.wiY, sample.wiZ, f);
        expect(f[0]).toBeCloseTo(sample.fR, 12);
        expect(f[1]).toBeCloseTo(sample.fG, 12);
        expect(f[2]).toBeCloseTo(sample.fB, 12);
      }
      expect(valid).toBeGreaterThan(2000);
    });

    it(`${name}: pdf 가 반구에서 1 로 적분된다`, () => {
      const wo: [number, number, number] = [0.3, 0, Math.sqrt(1 - 0.09)];
      let sum = 0;
      const n = 200000;
      for (let i = 0; i < n; i += 1) {
        const wi = uniformHemisphere(
          studioPathtraceRandom01(i, 2, 0, 0, 23),
          studioPathtraceRandom01(i, 2, 0, 1, 23),
        );
        sum += pdfStudioPathtraceBsdf(material, wo[0], wo[1], wo[2], wi[0], wi[1], wi[2]);
      }
      const integral = (sum / n) * 2 * Math.PI;
      expect(Math.abs(integral - 1), `${name} pdf 적분 = ${integral}`).toBeLessThan(0.05);
    });

    it(`${name}: BSDF 는 상호성 f(wo,wi) = f(wi,wo) 을 만족한다`, () => {
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      for (let i = 0; i < 200; i += 1) {
        const wo = uniformHemisphere(
          studioPathtraceRandom01(i, 3, 0, 0, 31),
          studioPathtraceRandom01(i, 3, 0, 1, 31),
        );
        const wi = uniformHemisphere(
          studioPathtraceRandom01(i, 3, 0, 2, 31),
          studioPathtraceRandom01(i, 3, 0, 3, 31),
        );
        evalStudioPathtraceBsdf(material, wo[0], wo[1], wo[2], wi[0], wi[1], wi[2], a);
        evalStudioPathtraceBsdf(material, wi[0], wi[1], wi[2], wo[0], wo[1], wo[2], b);
        for (let c = 0; c < 3; c += 1) expect(a[c]).toBeCloseTo(b[c], 10);
      }
    });
  }

  it("반구 밖 방향은 f = 0, pdf = 0", () => {
    const f = [1, 1, 1];
    evalStudioPathtraceBsdf(LAMBERT_WHITE, 0, 0, 1, 0, 0, -1, f);
    expect([f[0], f[1], f[2]]).toEqual([0, 0, 0]);
    expect(pdfStudioPathtraceBsdf(LAMBERT_WHITE, 0, 0, 1, 0, 0, -1)).toBe(0);
    expect(pdfStudioPathtraceBsdf(LAMBERT_WHITE, 0, 0, -1, 0, 0, 1)).toBe(0);
    const sample = createStudioPathtraceBsdfSample();
    sampleStudioPathtraceBsdf(LAMBERT_WHITE, 0, 0, -1, 0.5, 0.5, 0.5, sample);
    expect(sample.valid).toBe(false);
  });
});

describe("furnace — 에너지 보존", () => {
  it("albedo 1 · ior 1 Lambert 는 샘플마다 정확히 1 을 돌려준다", () => {
    const sample = createStudioPathtraceBsdfSample();
    for (let i = 0; i < 2000; i += 1) {
      const uLobe = studioPathtraceRandom01(i, 4, 0, 0, 7);
      const u1 = studioPathtraceRandom01(i, 4, 0, 1, 7);
      const u2 = studioPathtraceRandom01(i, 4, 0, 2, 7);
      sampleStudioPathtraceBsdf(LAMBERT_WHITE, 0.2, 0.1, Math.sqrt(1 - 0.05), uLobe, u1, u2, sample);
      expect(sample.valid).toBe(true);
      const throughput = (sample.fR * sample.wiZ) / sample.pdf;
      // f·cos/pdf = (ρ/π)·cos / (cos/π) = ρ = 1 — 부동소수 오차만 허용한다.
      expect(Math.abs(throughput - 1)).toBeLessThan(1e-9);
    }
  });

  it("albedo 0.5 Lambert 의 방향 알베도는 0.5 다", () => {
    const half = createStudioPathtraceMaterial({
      baseColorLinear: [0.5, 0.5, 0.5],
      roughness: 1,
      metallic: 0,
      ior: 1,
    });
    expect(directionalAlbedo(half, 0.7, 4000, 9)).toBeCloseTo(0.5, 9);
  });

  it("GGX 단일 산란 알베도는 1 을 넘지 않고 roughness 가 커질수록 줄어든다", () => {
    // 흰 금속(F0 = 1)이라 throughput = G2/G1 = 단일 산란 알베도 그 자체다.
    // multiple-scattering 보정이 없으므로 손실이 나는 것이 **정상**이다.
    const roughnesses = [0.05, 0.2, 0.4, 0.6, 0.8, 1];
    const measured = roughnesses.map((roughness) =>
      directionalAlbedo(
        createStudioPathtraceMaterial({ baseColorLinear: [1, 1, 1], metallic: 1, roughness, ior: 1.5 }),
        0.7,
        40000,
        13,
      ),
    );
    for (let i = 0; i < measured.length; i += 1) {
      expect(measured[i], `roughness=${roughnesses[i]}`).toBeLessThanOrEqual(1.0005);
      expect(measured[i], `roughness=${roughnesses[i]}`).toBeGreaterThan(0.25);
    }
    // 단조 감소(측정 노이즈 여유 1%).
    for (let i = 1; i < measured.length; i += 1) {
      expect(measured[i], `roughness ${roughnesses[i]} 가 ${roughnesses[i - 1]} 보다 밝다`)
        .toBeLessThan(measured[i - 1] + 0.01);
    }
    // 실측 곡선(cosθo = 0.7, 40k 샘플): 1.0000 / 0.9973 / 0.9491 / 0.7925 / 0.5803 / 0.3784.
    // alpha = 1 에서 절반 가까운 반사가 지평선 아래로 가 버리는 것이 단일 산란 GGX 의
    // 알려진 거동이다. Blender/Cycles 의 multi-scatter GGX 는 이 손실을 보정하므로
    // 거친 금속이 훨씬 밝게 나온다 — 우리는 그 보정을 구현하지 않았다.
    expect(measured[0]).toBeGreaterThan(0.99);
    expect(measured[2]).toBeGreaterThan(0.9);
    expect(measured[2]).toBeLessThan(0.98);
    expect(measured[measured.length - 1]).toBeGreaterThan(0.3);
    expect(measured[measured.length - 1]).toBeLessThan(0.45);
  });

  it("BSDF 샘플링 추정치가 균등 반구 적분과 일치한다(샘플러↔pdf 독립 검증)", () => {
    // 두 추정기는 서로 다른 분포를 쓰므로, 값이 맞으면 sample 이 pdf 를 실제로 따른다는
    // 뜻이다(pdf 함수만 자기 자신과 일관된 경우를 배제한다).
    for (const material of [
      createStudioPathtraceMaterial({ baseColorLinear: [1, 1, 1], metallic: 1, roughness: 0.4, ior: 1.5 }),
      createStudioPathtraceMaterial({ baseColorLinear: [0.6, 0.6, 0.6], metallic: 0, roughness: 0.3, ior: 1.5 }),
    ]) {
      const cosThetaO = 0.7;
      const wo: [number, number, number] = [Math.sqrt(1 - cosThetaO * cosThetaO), 0, cosThetaO];
      const f = [0, 0, 0];
      let uniformSum = 0;
      const n = 400000;
      for (let i = 0; i < n; i += 1) {
        const wi = uniformHemisphere(
          studioPathtraceRandom01(i, 9, 0, 0, 77),
          studioPathtraceRandom01(i, 9, 0, 1, 77),
        );
        evalStudioPathtraceBsdf(material, wo[0], wo[1], wo[2], wi[0], wi[1], wi[2], f);
        uniformSum += f[0] * wi[2];
      }
      const uniformEstimate = (uniformSum / n) * 2 * Math.PI;
      const sampledEstimate = directionalAlbedo(material, cosThetaO, 200000, 79);
      expect(Math.abs(sampledEstimate - uniformEstimate)).toBeLessThan(0.02);
      expect(sampledEstimate).toBeGreaterThan(0.1);
    }
  });
});
