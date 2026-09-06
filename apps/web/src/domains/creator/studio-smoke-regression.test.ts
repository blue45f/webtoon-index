/**
 * Studio Smoke — 적대적 검증에서 드러난 커버리지 구멍을 막는 회귀 테스트.
 *
 * 기존 8개 스위트(144케이스)에 뮤테이션 테스트를 돌렸더니 아래 세 가지가 통과했다.
 * 여기 있는 케이스는 전부 그 뮤턴트를 실제로 죽이도록 만들어졌다.
 *
 *  1. `projectStudioSmoke` 맨 앞의 `applyStudioSmokeBoundaries` 를 지워도 144개가 전부
 *     통과했다. 기존 발산 테스트가 헬퍼에서 경계를 **미리** 적용해 그 호출을 잉여로
 *     만들었고, 스텝 루프는 항상 경계 적용으로 끝나 두 번째 스텝부터는 no-op 이기
 *     때문이다. 실제로는 경계 비정규 초기조건에서 잔차비가 0.044 → 0.185 로 무너진다.
 *  2. 소산(`applyDissipation`)의 감쇠 계수를 1 로 만들어도 전부 통과했다 — 솔버 한
 *     단계 전체가 무커버리지였다. 기본 프리셋이 densityDissipation 0.12 를 쓴다.
 *  3. 폐쇄(순수 Neumann) 도메인에서 Jacobi 는 **수렴하지 않는다**. 체커보드 벡터
 *     s[c]=(−1)^(i+j+k) 는 모든 셀에서 Σ_nb s = −count·s 라 야코비 반복행렬의
 *     고유값이 **정확히 −1** 이고, 그 성분이 영원히 남는다. 잔차 발산이 바닥에서
 *     멈추는 이유는 코어 문서가 적은 "저주파 O(1/K)" 가 아니라 이 최고주파 모드다.
 */

import { describe, expect, it } from "vitest";

import {
  applyStudioSmokeBoundaries,
  measureStudioSmokeDivergence,
  measureStudioSmokeMass,
  projectStudioSmoke,
  stepStudioSmoke,
} from "./studio-smoke-core";
import {
  STUDIO_SMOKE_CHIMNEY_BOUNDARY,
  STUDIO_SMOKE_CLOSED_BOUNDARY,
  createStudioSmokeState,
  studioSmokeCellIndex,
  studioSmokeUIndex,
  studioSmokeVIndex,
  studioSmokeWIndex,
} from "./studio-smoke-grid";

import type { StudioSmokeStepParams } from "./studio-smoke-core";
import type { StudioSmokeState } from "./studio-smoke-grid";

const INERT: StudioSmokeStepParams = {
  dt: 1 / 30,
  buoyancyAlpha: 0,
  buoyancyBeta: 0,
  ambientTemperature: 0,
  vorticityEpsilon: 0,
  densityDissipation: 0,
  temperatureDissipation: 0,
  pressureIterations: 40,
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fillNoiseVelocity(state: StudioSmokeState, seed: number): void {
  const random = mulberry32(seed);
  const { fields } = state;
  for (let i = 0; i < fields.u.length; i += 1) fields.u[i] = random() * 2 - 1;
  for (let i = 0; i < fields.v.length; i += 1) fields.v[i] = random() * 2 - 1;
  for (let i = 0; i < fields.w.length; i += 1) fields.w[i] = random() * 2 - 1;
}

/** 경계를 적용하지 않은 상태의 발산 기준값 — 벽 법선 속도를 0 으로 맞춘 사본에서 잰다. */
function conformedBaseline(seed: number, n: number, boundary = STUDIO_SMOKE_CLOSED_BOUNDARY): number {
  const reference = createStudioSmokeState({ nx: n, ny: n, nz: n, boundary });
  fillNoiseVelocity(reference, seed);
  applyStudioSmokeBoundaries(reference);
  return measureStudioSmokeDivergence(reference).rms;
}

describe("studio-smoke 회귀: 투영은 경계 비정규 입력을 스스로 정규화한다", () => {
  it("경계를 미리 적용하지 않고 projectStudioSmoke 를 직접 불러도 K=40 에서 잔차비 < 0.1", () => {
    // projectStudioSmoke 맨 앞의 applyStudioSmokeBoundaries 가 빠지면 벽 면이 만든
    // 보정 불가능한 발산이 우변에 남아 잔차비가 0.18 근처에서 정체한다(실측).
    for (const n of [16, 32]) {
      const state = createStudioSmokeState({ nx: n, ny: n, nz: n, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
      fillNoiseVelocity(state, 1234);
      const before = conformedBaseline(1234, n);
      projectStudioSmoke(state, { ...INERT, pressureIterations: 40 });
      const after = measureStudioSmokeDivergence(state).rms;
      expect(before).toBeGreaterThan(0);
      expect(after / before).toBeLessThan(0.1);
    }
  });

  it("경계 비정규 입력에서도 K 를 늘리면 잔차가 계속 줄어든다(정체하지 않는다)", () => {
    const before = conformedBaseline(1234, 32);
    const ratios = [40, 160, 640].map((k) => {
      const state = createStudioSmokeState({ nx: 32, ny: 32, nz: 32, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
      fillNoiseVelocity(state, 1234);
      projectStudioSmoke(state, { ...INERT, pressureIterations: k });
      return measureStudioSmokeDivergence(state).rms / before;
    });
    // 경계 적용이 빠지면 이 세 값이 전부 0.18 근처로 붙어버린다.
    expect(ratios[1]).toBeLessThan(ratios[0] * 0.6);
    expect(ratios[2]).toBeLessThan(ratios[1] * 0.6);
  });

  it("원시 노이즈에서 한 스텝만 돌려도 투영이 발산을 한 자릿수 죽인다", () => {
    const state = createStudioSmokeState({ nx: 16, ny: 16, nz: 16, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 99);
    const result = stepStudioSmoke(state, { ...INERT, measureDivergence: true });
    expect(result.divergenceAfter!.rms).toBeLessThan(result.divergenceBefore!.rms * 0.15);
  });
});

describe("studio-smoke 회귀: 소산", () => {
  it("정지 유체에서 밀도가 정확히 (1 − rate·dt)^N 로 줄어든다", () => {
    // 속도가 0 이면 이류는 항등이라 소산만 남는다 — 감쇠 계수를 정확히 검산할 수 있다.
    const state = createStudioSmokeState({ nx: 8, ny: 8, nz: 8, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    const cell = studioSmokeCellIndex(state.spec, 4, 4, 4);
    state.fields.density[cell] = 1;
    state.fields.temperature[cell] = 1;
    const dt = 1 / 30;
    const densityRate = 0.6;
    const temperatureRate = 1.5;
    const steps = 6;
    for (let step = 0; step < steps; step += 1) {
      stepStudioSmoke(state, { ...INERT, dt, densityDissipation: densityRate, temperatureDissipation: temperatureRate });
    }
    let expectedDensity = 1;
    let expectedTemperature = 1;
    for (let step = 0; step < steps; step += 1) {
      expectedDensity = Math.fround(expectedDensity * Math.max(0, 1 - densityRate * dt));
      expectedTemperature = Math.fround(expectedTemperature * Math.max(0, 1 - temperatureRate * dt));
    }
    expect(state.fields.density[cell]).toBeCloseTo(expectedDensity, 6);
    expect(state.fields.temperature[cell]).toBeCloseTo(expectedTemperature, 6);
    // 소산이 무력화되면 1 그대로 남는다 — 그 경우를 확실히 배제한다.
    expect(state.fields.density[cell]).toBeLessThan(0.9);
    expect(state.fields.temperature[cell]).toBeLessThan(0.75);
  });

  it("소산율이 클수록 20스텝 뒤 총질량이 확실히 적다", () => {
    const massAfter = (rate: number): number => {
      const state = createStudioSmokeState({ nx: 16, ny: 16, nz: 16, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
      for (let k = 5; k < 11; k += 1)
        for (let j = 5; j < 11; j += 1)
          for (let i = 5; i < 11; i += 1) state.fields.density[studioSmokeCellIndex(state.spec, i, j, k)] = 1;
      for (let step = 0; step < 20; step += 1) stepStudioSmoke(state, { ...INERT, densityDissipation: rate });
      return measureStudioSmokeMass(state);
    };
    const none = massAfter(0);
    const mild = massAfter(0.3);
    const strong = massAfter(1.5);
    expect(mild).toBeLessThan(none * 0.95);
    expect(strong).toBeLessThan(mild * 0.7);
  });

  it("소산율 0 이면 밀도가 비트 단위로 그대로다(항등)", () => {
    const state = createStudioSmokeState({ nx: 8, ny: 8, nz: 8, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    state.fields.density[studioSmokeCellIndex(state.spec, 4, 4, 4)] = 1;
    const snapshot = Float32Array.from(state.fields.density);
    stepStudioSmoke(state, { ...INERT, densityDissipation: 0 });
    expect(Array.from(state.fields.density)).toEqual(Array.from(snapshot));
  });
});

describe("studio-smoke 회귀: 순수 Neumann Jacobi 의 체커보드 정체", () => {
  /** 셀별 이웃 수(도메인 벽은 solid, 내부 solid 없음). */
  function neighborCount(n: number, i: number, j: number, k: number): number {
    let count = 0;
    if (i > 0) count += 1;
    if (i < n - 1) count += 1;
    if (j > 0) count += 1;
    if (j < n - 1) count += 1;
    if (k > 0) count += 1;
    if (k < n - 1) count += 1;
    return count;
  }

  function residualField(state: StudioSmokeState): number[] {
    const { spec, fields } = state;
    const out: number[] = [];
    for (let k = 0; k < spec.nz; k += 1)
      for (let j = 0; j < spec.ny; j += 1)
        for (let i = 0; i < spec.nx; i += 1) {
          const du = fields.u[studioSmokeUIndex(spec, i + 1, j, k)] - fields.u[studioSmokeUIndex(spec, i, j, k)];
          const dv = fields.v[studioSmokeVIndex(spec, i, j + 1, k)] - fields.v[studioSmokeVIndex(spec, i, j, k)];
          const dw = fields.w[studioSmokeWIndex(spec, i, j, k + 1)] - fields.w[studioSmokeWIndex(spec, i, j, k)];
          out.push(du + dv + dw);
        }
    return out;
  }

  it("폐쇄 상자는 반복수를 아무리 늘려도 잔차가 바닥에서 멈춘다", () => {
    const n = 8;
    const before = conformedBaseline(777, n);
    const ratio = (k: number): number => {
      const state = createStudioSmokeState({ nx: n, ny: n, nz: n, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
      fillNoiseVelocity(state, 777);
      projectStudioSmoke(state, { ...INERT, pressureIterations: k });
      return measureStudioSmokeDivergence(state).rms / before;
    };
    const floor640 = ratio(640);
    const floor10240 = ratio(10240);
    // 16배 더 돌려도 개선이 0.1% 미만 — 수렴이 아니라 정체다.
    expect(Math.abs(floor10240 - floor640) / floor640).toBeLessThan(1e-3);
    expect(floor10240).toBeGreaterThan(1e-2);
  });

  it("남은 잔차는 체커보드 × 이웃수 패턴과 정확히 비례한다(λ=−1 모드)", () => {
    const n = 8;
    const state = createStudioSmokeState({ nx: n, ny: n, nz: n, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 777);
    projectStudioSmoke(state, { ...INERT, pressureIterations: 4000 });
    const residual = residualField(state);
    const pattern: number[] = [];
    for (let k = 0; k < n; k += 1)
      for (let j = 0; j < n; j += 1)
        for (let i = 0; i < n; i += 1) {
          pattern.push(((i + j + k) % 2 === 0 ? 1 : -1) * neighborCount(n, i, j, k));
        }
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    const mr = mean(residual);
    const mp = mean(pattern);
    let num = 0;
    let r2 = 0;
    let p2 = 0;
    for (let index = 0; index < residual.length; index += 1) {
      num += (residual[index] - mr) * (pattern[index] - mp);
      r2 += (residual[index] - mr) ** 2;
      p2 += (pattern[index] - mp) ** 2;
    }
    expect(Math.abs(num / Math.sqrt(r2 * p2))).toBeGreaterThan(0.999);
  });

  it("Dirichlet 면이 하나라도 있으면(굴뚝=기본값) 이 모드가 깨져 기계 0 까지 수렴한다", () => {
    const n = 8;
    const before = conformedBaseline(777, n, STUDIO_SMOKE_CHIMNEY_BOUNDARY);
    const state = createStudioSmokeState({ nx: n, ny: n, nz: n, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });
    fillNoiseVelocity(state, 777);
    projectStudioSmoke(state, { ...INERT, pressureIterations: 10240 });
    expect(measureStudioSmokeDivergence(state).rms / before).toBeLessThan(1e-6);
  });
});
