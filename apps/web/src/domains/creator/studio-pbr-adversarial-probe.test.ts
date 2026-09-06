/**
 * Studio PBR — 적대적 교차검증 프로브
 *
 * 【이 파일이 존재하는 이유】
 * studio-pbr-brdf.test.ts 의 화이트 퍼니스 단언(보상 ON → 총 에너지 ≈ 1)은 **E 의 정확성을
 * 검증하지 못한다.** whiteFurnaceIntegral 은 single + ∫f_ms = E + (1-E) 를 계산하므로,
 * directionalAlbedoGgx 가 무엇을 돌려주든 합은 항등적으로 1 이다. 즉 D·G·중요도 샘플링
 * 추정량이 통째로 틀려도 그 테스트는 통과한다.
 *
 * 여기서는 GGX 단일산란 방향 알베도를 **중요도 샘플링을 전혀 쓰지 않는 직접 구면 구적**
 * 으로 다시 구현해 대조한다. 참조식은 이 파일 안에서 처음부터 쓴 것이며 studio-pbr-brdf 의
 * D/G/샘플러를 import 하지 않는다. 두 경로가 일치해야 추정량이 실제로 GGX BRDF 다.
 *
 * 나머지 케이스도 같은 성격이다 — 기존 스위트가 형식적으로만 훑고 지나간 경계를 찌른다.
 */
import { describe, expect, it } from "vitest";

import { directionalAlbedoGgx, whiteFurnaceIntegral } from "./studio-pbr-brdf";
import {
  evaluateStudioPbrIrradianceSh9,
  projectStudioPbrIrradianceSh9,
  type StudioPbrEquirectSource,
} from "./studio-pbr-ibl-bake";
import { buildStudioPbrDirectionalShadowMatrix } from "./studio-pbr-shadow";
import { studioPbrNeutral, studioPbrNeutralInverse } from "./studio-pbr-tonemap";

/**
 * 독립 참조 구현: E(μ,α) = ∫ D·G/(4·μ·μi) · μi dωi (F=1) 를 반구 격자로 직접 적분한다.
 * 중요도 샘플링·Hammersley·importanceSampleGgx 를 일절 쓰지 않는다.
 */
function referenceDirectionalAlbedo(mu: number, alpha: number, thetaSteps: number, phiSteps: number): number {
  const vx = Math.sqrt(Math.max(0, 1 - mu * mu));
  const a2 = alpha * alpha;
  // Karis IBL k 재매핑: roughness = sqrt(alpha) 이므로 k = roughness²/2 = alpha/2.
  const k = alpha / 2;
  const g1 = (c: number): number => c / (c * (1 - k) + k);
  const dTheta = Math.PI / 2 / thetaSteps;
  const dPhi = (Math.PI * 2) / phiSteps;
  let sum = 0;
  for (let ti = 0; ti < thetaSteps; ti += 1) {
    const theta = (ti + 0.5) * dTheta;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let pi = 0; pi < phiSteps; pi += 1) {
      const phi = (pi + 0.5) * dPhi;
      const lx = sinTheta * Math.cos(phi);
      const ly = sinTheta * Math.sin(phi);
      const lz = cosTheta;
      const hx = vx + lx;
      const hy = ly;
      const hz = mu + lz;
      const hLength = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (hLength <= 0) continue;
      const nDotH = hz / hLength;
      if (nDotH <= 0) continue;
      const denominator = nDotH * nDotH * (a2 - 1) + 1;
      const d = a2 / (Math.PI * denominator * denominator);
      const brdf = (d * g1(mu) * g1(lz)) / (4 * mu * lz);
      sum += brdf * lz * sinTheta * dTheta * dPhi;
    }
  }
  return sum;
}

describe("studio-pbr 적대적: GGX 방향 알베도 독립 대조", () => {
  it("중요도 샘플링 E(μ,α) 가 직접 구면 구적과 0.5% 이내로 일치한다", () => {
    // 실측 상대오차: 2.8e-5 ~ 2.3e-4. 추정량이 실제로 GGX BRDF 의 반구 적분임을 확증한다.
    for (const [mu, alpha] of [
      [0.5, 0.5],
      [0.8, 0.7],
      [0.3, 0.9],
      [0.9, 0.3],
    ] as [number, number][]) {
      const importance = directionalAlbedoGgx(mu, alpha, 4096);
      const quadrature = referenceDirectionalAlbedo(mu, alpha, 720, 576);
      expect(Math.abs(importance - quadrature) / quadrature).toBeLessThan(5e-3);
    }
  });

  it("화이트 퍼니스 보상 ON 은 구조적 항등식이라 E 를 검증하지 못한다(계약 명시)", () => {
    // 이 단언은 "테스트가 무엇을 검증하지 못하는가"를 코드로 고정한다.
    // total - E 가 항상 1-E 라는 것은 곧 total 이 E 와 무관하게 1 이라는 뜻이다.
    for (const alpha of [0.2, 0.6, 0.95]) {
      for (const nDotV of [0.25, 0.75]) {
        const e = directionalAlbedoGgx(nDotV, alpha, 128);
        const total = whiteFurnaceIntegral(nDotV, alpha, { compensate: true, sampleCount: 128 });
        expect(total - e).toBeCloseTo(1 - e, 2);
        // 실측 스프레드는 1.00003~1.00036 이라 스위트의 [0.97,1.02] 창은 구속력이 없다.
        expect(Math.abs(total - 1)).toBeLessThan(2e-3);
      }
    }
  });
});

describe("studio-pbr 적대적: SH9 델타 광원 응답", () => {
  it("천정 링 광원에서 irradiance 가 코사인 로브를 따라간다", () => {
    const width = 64;
    const height = 32;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    for (let x = 0; x < width; x += 1) {
      const i = x * 4; // 최상단 행 = +Y 천정 근처 링
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
    }
    const sh = projectStudioPbrIrradianceSh9({ width, height, rgba });
    const up = evaluateStudioPbrIrradianceSh9(sh, { x: 0, y: 1, z: 0 })[0];
    const tilt = evaluateStudioPbrIrradianceSh9(sh, { x: 0.7071, y: 0.7071, z: 0 })[0];
    const down = evaluateStudioPbrIrradianceSh9(sh, { x: 0, y: -1, z: 0 })[0];
    expect(up).toBeGreaterThan(0);
    // 45° 기울이면 대략 cos45 ≈ 0.707 배(SH9 2차 근사 오차 감안).
    expect(tilt / up).toBeGreaterThan(0.55);
    expect(tilt / up).toBeLessThan(0.9);
    expect(down).toBeLessThan(up * 0.2);
  });

  it("균일 백색 환경의 irradiance 가 임의 법선에서 π 다", () => {
    const width = 64;
    const height = 32;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
    const source: StudioPbrEquirectSource = { width, height, rgba };
    const sh = projectStudioPbrIrradianceSh9(source);
    const e = evaluateStudioPbrIrradianceSh9(sh, { x: 0.3, y: 0.6, z: -0.7416198487095663 });
    expect(e[0]).toBeCloseTo(Math.PI, 3);
  });
});

describe("studio-pbr 적대적: 톤매핑 역함수 경계 스트레스", () => {
  it("toe/압축 분기점을 정확히 밟는 입력도 왕복한다", () => {
    for (const probe of [
      [0.08, 0.08, 0.08],
      [0.08, 0.5, 0.9],
      [0.0799999, 0.4, 0.76],
      [0.76, 0.76, 0.76],
      [0.7600001, 0.2, 0.05],
      [1e-6, 1e-6, 1e-6],
      [0, 0, 0],
    ] as [number, number, number][]) {
      const back = studioPbrNeutralInverse(studioPbrNeutral(probe));
      for (let c = 0; c < 3; c += 1) expect(back[c]).toBeCloseTo(probe[c], 6);
    }
  });

  it("문서가 경고한 '조건수 악화' 범위 밖에서도 상대오차가 1e-9 이하다", () => {
    // docstring 은 "실용 범위(≤16)에서 1e-6" 이라고 보수적으로 적었지만 실제로는 훨씬 좋다.
    for (const probe of [
      [100, 25, 2],
      [400, 100, 5],
      [5000, 1, 1],
    ] as [number, number, number][]) {
      const back = studioPbrNeutralInverse(studioPbrNeutral(probe));
      expect(Math.abs(back[0] - probe[0]) / probe[0]).toBeLessThan(1e-9);
    }
  });
});

describe("studio-pbr 적대적: 섀도우 텍셀 스냅 강도", () => {
  it("세 축을 동시에 흔들어도 행렬이 계단식으로만 바뀐다", () => {
    // 스위트는 월드 x 한 축만 밀어서 라이트 공간 이동량이 texel·0.2·xAxis.x 로 더 작아진다.
    // 여기서는 x/y/z 를 모두 밀어 라이트 공간 세 성분 전부에 사영시킨다.
    const direction = { x: -0.5, y: -1, z: -0.3 };
    const bounds = { min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 4, z: 5 } };
    const base = buildStudioPbrDirectionalShadowMatrix({ direction, sceneBounds: bounds, mapSize: 512 });
    const texel = base.texelWorldSize;
    const steps = 40;
    let distinct = 0;
    let previous = "";
    for (let i = 0; i < steps; i += 1) {
      const d = (i / steps) * texel * 4;
      const matrix = buildStudioPbrDirectionalShadowMatrix({
        direction,
        sceneBounds: {
          min: { x: bounds.min.x + d, y: bounds.min.y + d * 0.7, z: bounds.min.z - d * 0.4 },
          max: { x: bounds.max.x + d, y: bounds.max.y + d * 0.7, z: bounds.max.z - d * 0.4 },
        },
        mapSize: 512,
      });
      const key = Array.from(matrix.viewProjection).join(",");
      if (key !== previous) distinct += 1;
      previous = key;
    }
    // 스냅이 없으면 40(매 스텝 변화). 실측 9 — 텍셀 격자에 실제로 붙어 있다.
    expect(distinct).toBeGreaterThan(1);
    expect(distinct).toBeLessThan(steps / 2);
  });
});
