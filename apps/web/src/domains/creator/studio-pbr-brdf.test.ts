import { describe, expect, it } from "vitest";

import {
  STUDIO_PBR_DIELECTRIC_F0,
  averageAlbedoGgx,
  directionalAlbedoGgx,
  distributionGgx,
  evaluateCookTorrance,
  fresnelSchlick,
  fresnelSchlickRoughness,
  geometrySmithSchlickGgx,
  hammersley,
  importanceSampleGgx,
  integrateHemisphereCosine,
  linearToSrgb,
  multiScatterLobeGgx,
  multiScatterCompensationGgx,
  radicalInverseVdC,
  srgbToLinear,
  studioPbrDot,
  studioPbrOrthonormalBasis,
  studioPbrRoughnessToAlpha,
  studioPbrSchlickK,
  visibilitySmithGgxCorrelated,
  whiteFurnaceIntegral,
  type StudioPbrVec3,
} from "./studio-pbr-brdf";

const N: StudioPbrVec3 = { x: 0, y: 0, z: 1 };

describe("studio-pbr-brdf: 색공간 왕복", () => {
  it("srgbToLinear ∘ linearToSrgb 가 분기 경계 밖에서 항등이다", () => {
    const probes = [0, 0.001, 0.0031308, 0.02, 0.05, 0.2, 0.5, 0.8, 1];
    for (const value of probes) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 12);
      expect(srgbToLinear(linearToSrgb(value))).toBeCloseTo(value, 12);
    }
  });

  it("IEC 상수의 반올림 때문에 분기점에 약 3e-8 의 불연속이 있다(정직하게 단언)", () => {
    // 표준의 0.04045 / 0.0031308 은 반올림된 값이라 두 조각이 정확히 만나지 않는다.
    // 이건 구현 버그가 아니라 IEC 61966-2-1 자체의 성질이며, 왕복 오차 상한이 여기서 정해진다.
    const breakpoint = 0.04045;
    const roundTripError = Math.abs(linearToSrgb(srgbToLinear(breakpoint)) - breakpoint);
    expect(roundTripError).toBeGreaterThan(1e-9);
    expect(roundTripError).toBeLessThan(1e-7);
    // 조각 경계에서 두 식의 값 차이 자체를 직접 잰다.
    const linearSide = breakpoint / 12.92;
    const powerSide = Math.pow((breakpoint + 0.055) / 1.055, 2.4);
    expect(Math.abs(linearSide - powerSide)).toBeLessThan(1e-8);
  });

  it("선형 구간은 정확히 1/12.92 기울기다(근사 2.2 감마가 아님)", () => {
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 15);
    // 2.2 감마 근사와는 실제로 다르다 — 같으면 잘못 구현한 것이다.
    expect(Math.abs(srgbToLinear(0.5) - Math.pow(0.5, 2.2))).toBeGreaterThan(1e-3);
  });
});

describe("studio-pbr-brdf: 프레넬 극한", () => {
  it("v·h=1(수직 입사)에서 F 가 정확히 F0 다", () => {
    for (const f0 of [0.02, STUDIO_PBR_DIELECTRIC_F0, 0.5, 0.95, 1]) {
      expect(fresnelSchlick(1, f0)).toBe(f0);
    }
  });

  it("v·h=0(스침각)에서 F 가 정확히 1 이다", () => {
    for (const f0 of [0, 0.02, STUDIO_PBR_DIELECTRIC_F0, 0.5, 0.95]) {
      expect(fresnelSchlick(0, f0)).toBeCloseTo(1, 12);
    }
  });

  it("v·h 에 대해 단조 감소한다(0 에서 1, 1 에서 F0)", () => {
    const f0 = STUDIO_PBR_DIELECTRIC_F0;
    let previous = fresnelSchlick(0, f0);
    for (let i = 1; i <= 40; i += 1) {
      const current = fresnelSchlick(i / 40, f0);
      expect(current).toBeLessThan(previous);
      previous = current;
    }
    expect(previous).toBe(f0);
  });

  it("러프니스 보정판은 상한을 max(1-r, F0) 로 낮춘다", () => {
    const f0 = STUDIO_PBR_DIELECTRIC_F0;
    // 스침각(n·v=0)에서 상한이 정확히 1-roughness 여야 한다.
    expect(fresnelSchlickRoughness(0, f0, 0.3)).toBeCloseTo(0.7, 12);
    expect(fresnelSchlickRoughness(0, f0, 1)).toBeCloseTo(f0, 12);
    // 수직 입사에서는 여전히 정확히 F0.
    expect(fresnelSchlickRoughness(1, f0, 0.6)).toBe(f0);
  });
});

describe("studio-pbr-brdf: D / G 항", () => {
  it("GGX NDF 가 반구에서 1 로 정규화된다 — ∫D(h)(n·h)dω = 1", () => {
    for (const alpha of [0.2, 0.5, 0.9]) {
      const integral = integrateHemisphereCosine((h) => distributionGgx(h.z, alpha), 256, 4);
      expect(integral).toBeCloseTo(1, 2);
    }
  });

  it("Smith k 재매핑이 direct/ibl 에서 서로 다르다", () => {
    expect(studioPbrSchlickK(0.5, "direct")).toBeCloseTo((1.5 * 1.5) / 8, 15);
    expect(studioPbrSchlickK(0.5, "ibl")).toBeCloseTo(0.125, 15);
    expect(studioPbrSchlickK(0.5, "direct")).not.toBeCloseTo(studioPbrSchlickK(0.5, "ibl"), 6);
  });

  it("G 는 [0,1] 이고 스침각에서 0 으로 간다", () => {
    for (const roughness of [0.1, 0.5, 1]) {
      expect(geometrySmithSchlickGgx(0, 0.5, roughness, "direct")).toBe(0);
      const g = geometrySmithSchlickGgx(0.8, 0.8, roughness, "direct");
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(1);
    }
  });

  it("height-correlated 가시항은 G/(4·n·v·n·l) 스케일과 일치한다", () => {
    // 완전 매끈(α→0)에서 V → 1/(4·n·v·n·l) 이 되어야 한다.
    const nDotV = 0.7;
    const nDotL = 0.6;
    const vis = visibilitySmithGgxCorrelated(nDotV, nDotL, 1e-6);
    expect(vis).toBeCloseTo(1 / (4 * nDotV * nDotL), 4);
  });
});

describe("studio-pbr-brdf: 저불일치 수열", () => {
  it("radical inverse 가 알려진 값과 일치한다(비트 반전)", () => {
    expect(radicalInverseVdC(0)).toBe(0);
    expect(radicalInverseVdC(1)).toBeCloseTo(0.5, 12); // 0b1 → 0.1₂
    expect(radicalInverseVdC(2)).toBeCloseTo(0.25, 12); // 0b10 → 0.01₂
    expect(radicalInverseVdC(3)).toBeCloseTo(0.75, 12); // 0b11 → 0.11₂
    expect(radicalInverseVdC(4)).toBeCloseTo(0.125, 12);
  });

  it("Hammersley 는 [0,1)² 안에 있고 중복이 없다", () => {
    const n = 64;
    const seen = new Set<string>();
    for (let i = 0; i < n; i += 1) {
      const [u1, u2] = hammersley(i, n);
      expect(u1).toBeGreaterThanOrEqual(0);
      expect(u1).toBeLessThan(1);
      expect(u2).toBeGreaterThanOrEqual(0);
      expect(u2).toBeLessThan(1);
      seen.add(`${u1}:${u2}`);
    }
    expect(seen.size).toBe(n);
  });

  it("직교 기저가 실제로 정규직교다(n.z 음수 분기 포함)", () => {
    for (const n of [
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
      { x: 0.6, y: 0, z: 0.8 },
      { x: -0.5, y: 0.5, z: -0.7071067811865476 },
    ]) {
      const { tangent, bitangent } = studioPbrOrthonormalBasis(n);
      expect(studioPbrDot(tangent, tangent)).toBeCloseTo(1, 8);
      expect(studioPbrDot(bitangent, bitangent)).toBeCloseTo(1, 8);
      expect(studioPbrDot(tangent, n)).toBeCloseTo(0, 8);
      expect(studioPbrDot(bitangent, n)).toBeCloseTo(0, 8);
      expect(studioPbrDot(tangent, bitangent)).toBeCloseTo(0, 8);
    }
  });

  it("GGX 중요도 샘플은 항상 법선 반구 안이며 α→0 에서 h→n 이다", () => {
    for (let i = 0; i < 32; i += 1) {
      const [u1, u2] = hammersley(i, 32);
      const h = importanceSampleGgx(u1, u2, 0.4, N);
      expect(studioPbrDot(h, N)).toBeGreaterThan(0);
      expect(Math.sqrt(studioPbrDot(h, h))).toBeCloseTo(1, 8);
      const sharp = importanceSampleGgx(u1, u2, 1e-6, N);
      expect(sharp.z).toBeCloseTo(1, 6);
    }
  });
});

describe("studio-pbr-brdf: 에너지 보존(화이트 퍼니스)", () => {
  const alphas = [0.1, 0.3, 0.5, 0.7, 0.9];

  it("보상 ON — 총 에너지가 [0.97, 1.02] 안에 든다", () => {
    for (const alpha of alphas) {
      for (const nDotV of [0.2, 0.5, 0.9]) {
        const energy = whiteFurnaceIntegral(nDotV, alpha, { compensate: true, sampleCount: 128 });
        expect(energy).toBeGreaterThan(0.97);
        expect(energy).toBeLessThan(1.02);
      }
    }
  });

  it("보상 OFF — 단일산란 GGX 는 α 가 커질수록 에너지를 잃는다(숨기지 않는다)", () => {
    const nDotV = 0.5;
    const losses = alphas.map((alpha) => 1 - directionalAlbedoGgx(nDotV, alpha, 256));
    // 손실은 전부 양수이고 α 에 대해 단조 증가한다.
    for (const loss of losses) expect(loss).toBeGreaterThan(0);
    for (let i = 1; i < losses.length; i += 1) {
      expect(losses[i]).toBeGreaterThan(losses[i - 1]);
    }
    // α=0.9 에서의 손실은 실제로 무시할 수 없는 크기다(10% 이상).
    expect(losses[losses.length - 1]).toBeGreaterThan(0.1);
    // 매끈한 표면은 거의 손실이 없다.
    expect(1 - directionalAlbedoGgx(nDotV, 0.01, 256)).toBeLessThan(0.02);
  });

  it("다중산란 로브의 반구 적분이 정확히 손실분(1-E)을 되메운다", () => {
    // 이 단언이 핵심이다: 로브 정규화·Eavg·1/π 중 하나라도 틀리면 여기서 깨진다.
    for (const alpha of [0.4, 0.8]) {
      const eavg = averageAlbedoGgx(alpha, 32, 128);
      for (const nDotV of [0.3, 0.85]) {
        const ev = directionalAlbedoGgx(nDotV, alpha, 128);
        const integral = integrateHemisphereCosine(
          (l) => multiScatterLobeGgx(ev, directionalAlbedoGgx(l.z, alpha, 128), eavg),
          64,
          4,
        );
        expect(integral).toBeCloseTo(1 - ev, 2);
      }
    }
  });

  it("반구 구적법 자체가 정확하다 — Lambert 알베도가 그대로 나온다", () => {
    // 대조군 검증: ∫ (albedo/π)·cosθ dω = albedo.
    for (const albedo of [0.18, 0.5, 1]) {
      expect(integrateHemisphereCosine(() => albedo / Math.PI, 128, 8)).toBeCloseTo(albedo, 4);
    }
  });

  it("Fdez-Agüera IBL 보상항은 F0=1 에서 손실분 전체를 되돌린다", () => {
    // Ess = scale+bias 이므로 F0=1 이면 보상 후 총합이 1 이어야 한다.
    const dfg = { scale: 0.72, bias: 0.05 };
    const ess = dfg.scale + dfg.bias;
    const compensation = multiScatterCompensationGgx(1, dfg);
    expect(ess + compensation).toBeCloseTo(1, 10);
    // 에너지 손실이 없으면(Ess=1) 보상도 0 이다.
    expect(multiScatterCompensationGgx(1, { scale: 1, bias: 0 })).toBe(0);
    // 유전체(F0=0.04)에서는 보상이 작지만 0 은 아니다.
    const dielectric = multiScatterCompensationGgx(0.04, dfg);
    expect(dielectric).toBeGreaterThan(0);
    expect(dielectric).toBeLessThan(compensation);
  });
});

describe("studio-pbr-brdf: Cook-Torrance 평가", () => {
  const view: StudioPbrVec3 = { x: 0, y: 0, z: 1 };

  it("반구 뒤 광원은 정확히 0 을 낸다", () => {
    const result = evaluateCookTorrance({
      normal: N,
      view,
      light: { x: 0, y: 0, z: -1 },
      baseColor: [1, 1, 1],
      metallic: 0,
      roughness: 0.5,
    });
    expect(result.total).toEqual([0, 0, 0]);
    expect(result.nDotL).toBe(0);
  });

  it("금속은 확산이 정확히 0 이고 유전체는 0 이 아니다", () => {
    const common = { normal: N, view, light: N, baseColor: [0.8, 0.6, 0.4] as const, roughness: 0.4 };
    const metal = evaluateCookTorrance({ ...common, metallic: 1 });
    const dielectric = evaluateCookTorrance({ ...common, metallic: 0 });
    expect(metal.diffuse).toEqual([0, 0, 0]);
    for (let c = 0; c < 3; c += 1) expect(dielectric.diffuse[c]).toBeGreaterThan(0);
  });

  it("확산 전용 표면(금속 0·러프 1)은 Lambert 값에 근접한다", () => {
    const albedo = 0.5;
    const result = evaluateCookTorrance({
      normal: N,
      view,
      light: N,
      baseColor: [albedo, albedo, albedo],
      metallic: 0,
      roughness: 1,
    });
    // 정면 입사(n·l=1)에서 확산 = (1-F)·albedo/π, F 는 F0=0.04 (v·h=1).
    expect(result.diffuse[0]).toBeCloseTo(((1 - 0.04) * albedo) / Math.PI, 10);
  });

  it("러프니스가 커질수록 정반사 피크가 낮아진다(에너지가 퍼진다)", () => {
    const peaks = [0.05, 0.2, 0.5, 0.9].map(
      (roughness) =>
        evaluateCookTorrance({
          normal: N,
          view,
          light: N,
          baseColor: [1, 1, 1],
          metallic: 1,
          roughness,
        }).specular[0],
    );
    for (let i = 1; i < peaks.length; i += 1) {
      expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    }
  });

  it("roughness→alpha 재매핑이 제곱이고 하한이 걸린다", () => {
    expect(studioPbrRoughnessToAlpha(0.5)).toBeCloseTo(0.25, 15);
    expect(studioPbrRoughnessToAlpha(0)).toBeGreaterThan(0);
    expect(studioPbrRoughnessToAlpha(1)).toBe(1);
  });
});
