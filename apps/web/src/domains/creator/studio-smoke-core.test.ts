import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  STUDIO_SMOKE_CPU_KERNELS,
  STUDIO_SMOKE_KERNEL_IDS,
  advectStudioSmokeScalar,
  applyStudioSmokeBoundaries,
  computeStudioSmokeDivergence,
  hasStudioSmokeDirichlet,
  measureStudioSmokeCfl,
  measureStudioSmokeDensityCentroid,
  measureStudioSmokeDivergence,
  measureStudioSmokeEnstrophy,
  measureStudioSmokeMass,
  measureStudioSmokeMaxDensity,
  projectStudioSmoke,
  sampleStudioSmokeScalar,
  sampleStudioSmokeU,
  sampleStudioSmokeV,
  sampleStudioSmokeW,
  solveStudioSmokePressureJacobi,
  stepStudioSmoke,
} from "./studio-smoke-core";
import {
  STUDIO_SMOKE_CHIMNEY_BOUNDARY,
  STUDIO_SMOKE_CLOSED_BOUNDARY,
  createStudioSmokeState,
  fillStudioSmokeSolidBox,
  studioSmokeCellIndex,
  studioSmokeUIndex,
  studioSmokeVIndex,
  studioSmokeWIndex,
} from "./studio-smoke-grid";

import type { StudioSmokeStepParams } from "./studio-smoke-core";
import type { StudioSmokeBoundaryModes, StudioSmokeState } from "./studio-smoke-grid";

// 결정적 PRNG — 테스트 입력을 만드는 용도(엔진 코드에는 난수가 없다).
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

function fillNoiseVelocity(state: StudioSmokeState, seed: number, scale = 1): void {
  const random = mulberry32(seed);
  const { fields } = state;
  for (let i = 0; i < fields.u.length; i += 1) fields.u[i] = (random() * 2 - 1) * scale;
  for (let i = 0; i < fields.v.length; i += 1) fields.v[i] = (random() * 2 - 1) * scale;
  for (let i = 0; i < fields.w.length; i += 1) fields.w[i] = (random() * 2 - 1) * scale;
}

function fillBlob(
  state: StudioSmokeState,
  lo: readonly [number, number, number],
  hi: readonly [number, number, number],
  density: number,
  temperature: number,
): void {
  const { spec, fields } = state;
  for (let k = lo[2]; k < hi[2]; k += 1) {
    for (let j = lo[1]; j < hi[1]; j += 1) {
      for (let i = lo[0]; i < hi[0]; i += 1) {
        const cell = studioSmokeCellIndex(spec, i, j, k);
        fields.density[cell] = density;
        fields.temperature[cell] = temperature;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ① 발산 — 투영이 실제로 발산을 줄이는가
// ---------------------------------------------------------------------------

describe("studio-smoke-core: 압력 투영이 발산을 줄인다", () => {
  function projectNoise(n: number, iterations: number): { before: number; after: number; linf: number } {
    const state = createStudioSmokeState({ nx: n, ny: n, nz: n, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 1234);
    // 투영이 처리할 수 있는 형태(벽 법선 속도 0)로 먼저 정규화한 뒤 기준값을 잰다.
    applyStudioSmokeBoundaries(state);
    const before = measureStudioSmokeDivergence(state);
    projectStudioSmoke(state, { ...INERT, pressureIterations: iterations });
    const after = measureStudioSmokeDivergence(state);
    return { before: before.rms, after: after.rms, linf: after.linf / before.linf };
  }

  it("K=40 이면 발산 RMS 가 10분의 1 아래로 떨어진다(실측 32³ 0.043 / 48³ 0.035)", () => {
    for (const n of [32, 48]) {
      const { before, after, linf } = projectNoise(n, 40);
      expect(before).toBeGreaterThan(0);
      expect(after / before).toBeLessThan(0.1);
      expect(linf).toBeLessThan(0.15);
    }
  });

  it("Jacobi 반복수를 늘리면 잔차가 단조 감소한다", () => {
    const ratios = [1, 5, 10, 20, 40, 80, 160].map((k) => {
      const { before, after } = projectNoise(32, k);
      return after / before;
    });
    for (let index = 1; index < ratios.length; index += 1) {
      expect(ratios[index]).toBeLessThan(ratios[index - 1]);
    }
    expect(ratios[0]).toBeLessThan(1);
    // 반복수 160배가 잔차를 20배 넘게 줄이지는 못한다(Jacobi 의 저주파 수렴 한계).
    expect(ratios[ratios.length - 1]).toBeGreaterThan(ratios[0] / 40);
  });

  it("K=0 이면 압력이 전부 0 이라 속도가 (경계 적용 말고는) 바뀌지 않는다", () => {
    const state = createStudioSmokeState({ nx: 8, ny: 8, nz: 8, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 77);
    applyStudioSmokeBoundaries(state);
    const snapshot = Float32Array.from(state.fields.u);
    computeStudioSmokeDivergence(state);
    solveStudioSmokePressureJacobi(state, { ...INERT, pressureIterations: 0 });
    expect(Array.from(state.fields.pressure).every((value) => value === 0)).toBe(true);
    projectStudioSmoke(state, { ...INERT, pressureIterations: 0 });
    expect(Array.from(state.fields.u)).toEqual(Array.from(snapshot));
  });

  it("순수 Neumann(폐쇄 상자)에서는 평균 압력이 0 으로 고정된다", () => {
    const state = createStudioSmokeState({ nx: 10, ny: 10, nz: 10, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    expect(hasStudioSmokeDirichlet(state.spec)).toBe(false);
    fillNoiseVelocity(state, 4242);
    projectStudioSmoke(state, INERT);
    let sum = 0;
    for (let cell = 0; cell < state.fields.pressure.length; cell += 1) sum += state.fields.pressure[cell];
    expect(Math.abs(sum / state.fields.pressure.length)).toBeLessThan(1e-4);
  });
});

// ---------------------------------------------------------------------------
// ② 질량 — 보존이 성립하는 조건에서 tight, 일반 조건에서는 단조 감소
// ---------------------------------------------------------------------------

describe("studio-smoke-core: 이류의 질량 보존과 최대치 원리", () => {
  it("발산 0 균일 속도장 + 벽에서 떨어진 블롭이면 10스텝 뒤 질량 상대오차 < 1e-6", () => {
    const state = createStudioSmokeState({ nx: 24, ny: 24, nz: 24, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    state.fields.u.fill(0.4);
    state.fields.v.fill(0.25);
    state.fields.w.fill(-0.15);
    const { spec, fields } = state;
    for (let k = 8; k < 16; k += 1) {
      for (let j = 8; j < 16; j += 1) {
        for (let i = 8; i < 16; i += 1) fields.density[studioSmokeCellIndex(spec, i, j, k)] = 1 + (i % 3);
      }
    }
    const before = measureStudioSmokeMass(state);
    const maxBefore = measureStudioSmokeMaxDensity(state);
    expect(measureStudioSmokeDivergence(state).linf).toBeLessThan(1e-6);

    for (let step = 0; step < 10; step += 1) {
      fields.density0.set(fields.density);
      advectStudioSmokeScalar(state, fields.density0, fields.density, 1 / 30);
    }
    const after = measureStudioSmokeMass(state);
    expect(Math.abs(after - before) / before).toBeLessThan(1e-6);
    // 삼선형은 볼록결합이라 최대치가 늘 수 없다.
    expect(measureStudioSmokeMaxDensity(state)).toBeLessThanOrEqual(maxBefore + 1e-6);
    expect(measureStudioSmokeMaxDensity(state)).toBeLessThan(maxBefore);
  });

  it("최대치 원리는 모든 스텝에서 성립한다(삼선형 = 볼록결합)", () => {
    // 이것은 **정리**다: 삼선형 보간은 8개 이웃의 볼록결합이라 새 값이 옛 최대를 넘을 수 없다.
    // (질량 총합과 달리 부호가 보장되므로 매 스텝 강하게 단언할 수 있다.)
    const state = createStudioSmokeState({ nx: 16, ny: 16, nz: 16, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillBlob(state, [4, 4, 4], [12, 12, 12], 1, 2);
    fillNoiseVelocity(state, 606, 2);
    const { fields } = state;
    let previousMax = measureStudioSmokeMaxDensity(state);
    for (let step = 0; step < 15; step += 1) {
      fields.density0.set(fields.density);
      advectStudioSmokeScalar(state, fields.density0, fields.density, 1 / 30);
      const max = measureStudioSmokeMaxDensity(state);
      expect(max).toBeLessThanOrEqual(previousMax + 1e-6);
      previousMax = max;
      // 음의 밀도는 어떤 경우에도 생기지 않는다(볼록결합의 하한).
      for (let cell = 0; cell < fields.density.length; cell += 1) {
        expect(fields.density[cell]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("폐쇄 상자에서 질량 표류는 양방향이지만 유계다(semi-Lagrangian 은 보존형이 아니다)", () => {
    // 정직한 계약: 일반 조건에서 질량은 늘 수도 줄 수도 있다(O(dt²) 사상 오차).
    // 보장되는 것은 "벽을 통한 유출이 0 이므로 표류가 유계"라는 것뿐이다.
    const state = createStudioSmokeState({ nx: 16, ny: 16, nz: 16, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillBlob(state, [4, 4, 4], [12, 12, 12], 1, 2);
    const initial = measureStudioSmokeMass(state);
    const params = { ...INERT, buoyancyBeta: 4, vorticityEpsilon: 6 };
    for (let step = 0; step < 20; step += 1) {
      stepStudioSmoke(state, params);
      const mass = measureStudioSmokeMass(state);
      expect(mass).toBeGreaterThan(initial * 0.8);
      expect(mass).toBeLessThan(initial * 1.2);
    }
  });
});

// ---------------------------------------------------------------------------
// ③ 부력 — 뜨거운 셀이 위로 간다
// ---------------------------------------------------------------------------

describe("studio-smoke-core: 부력", () => {
  it("고온 블롭 위쪽 v 면이 양수가 되고 밀도 무게중심이 상승한다", () => {
    const state = createStudioSmokeState({ nx: 16, ny: 24, nz: 16, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });
    fillBlob(state, [6, 4, 6], [10, 8, 10], 1, 3);
    expect(measureStudioSmokeCfl(state, INERT.dt)).toBe(0);
    const before = measureStudioSmokeDensityCentroid(state);

    const params = { ...INERT, buoyancyAlpha: 0.2, buoyancyBeta: 4 };
    for (let step = 0; step < 20; step += 1) stepStudioSmoke(state, params);

    const after = measureStudioSmokeDensityCentroid(state);
    expect(after.y).toBeGreaterThan(before.y);
    expect(state.fields.v[studioSmokeVIndex(state.spec, 8, 9, 8)]).toBeGreaterThan(0);
  });

  it("β=0·α>0(차가운 무거운 연기)이면 무게중심이 내려간다", () => {
    const state = createStudioSmokeState({ nx: 16, ny: 24, nz: 16, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillBlob(state, [6, 12, 6], [10, 16, 10], 1, 0);
    const before = measureStudioSmokeDensityCentroid(state);
    const params = { ...INERT, buoyancyAlpha: 2, buoyancyBeta: 0 };
    for (let step = 0; step < 20; step += 1) stepStudioSmoke(state, params);
    expect(measureStudioSmokeDensityCentroid(state).y).toBeLessThan(before.y);
  });

  it("부력 계수가 전부 0 이면 속도장이 정확히 그대로다(항등)", () => {
    const state = createStudioSmokeState({ nx: 8, ny: 8, nz: 8, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillBlob(state, [2, 2, 2], [6, 6, 6], 1, 5);
    const snapshot = Float32Array.from(state.fields.v);
    stepStudioSmoke(state, { ...INERT, dt: 1 / 30, pressureIterations: 0 });
    expect(Array.from(state.fields.v)).toEqual(Array.from(snapshot));
  });
});

// ---------------------------------------------------------------------------
// ④ 경계 — 새지 않는다
// ---------------------------------------------------------------------------

describe("studio-smoke-core: 경계 처리", () => {
  it("폐쇄 상자에서 도메인 벽 법선 속도는 투영 뒤 정확히 0 이다", () => {
    const state = createStudioSmokeState({ nx: 12, ny: 12, nz: 12, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 555, 3);
    projectStudioSmoke(state, INERT);
    const { spec, fields } = state;
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        expect(fields.u[studioSmokeUIndex(spec, 0, j, k)]).toBe(0);
        expect(fields.u[studioSmokeUIndex(spec, spec.nx, j, k)]).toBe(0);
      }
    }
    for (let k = 0; k < spec.nz; k += 1) {
      for (let i = 0; i < spec.nx; i += 1) {
        expect(fields.v[studioSmokeVIndex(spec, i, 0, k)]).toBe(0);
        expect(fields.v[studioSmokeVIndex(spec, i, spec.ny, k)]).toBe(0);
      }
    }
    for (let j = 0; j < spec.ny; j += 1) {
      for (let i = 0; i < spec.nx; i += 1) {
        expect(fields.w[studioSmokeWIndex(spec, i, j, 0)]).toBe(0);
        expect(fields.w[studioSmokeWIndex(spec, i, j, spec.nz)]).toBe(0);
      }
    }
  });

  it("내부 solid 박스는 밀도가 0 으로 유지되고 접한 면 속도가 0 이다", () => {
    const state = createStudioSmokeState({ nx: 16, ny: 16, nz: 16, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    const touched = fillStudioSmokeSolidBox(state, {
      minX: 6,
      maxX: 10,
      minY: 6,
      maxY: 10,
      minZ: 6,
      maxZ: 10,
    });
    expect(touched).toBeGreaterThan(0);
    fillBlob(state, [2, 2, 2], [14, 14, 14], 1, 3);
    const params = { ...INERT, buoyancyBeta: 5, vorticityEpsilon: 4 };
    for (let step = 0; step < 15; step += 1) stepStudioSmoke(state, params);

    const { spec, fields } = state;
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        for (let i = 0; i < spec.nx; i += 1) {
          const cell = studioSmokeCellIndex(spec, i, j, k);
          if (fields.solid[cell] === 0) continue;
          expect(fields.density[cell]).toBe(0);
          expect(fields.temperature[cell]).toBe(0);
          expect(fields.u[studioSmokeUIndex(spec, i, j, k)]).toBe(0);
          expect(fields.u[studioSmokeUIndex(spec, i + 1, j, k)]).toBe(0);
          expect(fields.v[studioSmokeVIndex(spec, i, j, k)]).toBe(0);
          expect(fields.v[studioSmokeVIndex(spec, i, j + 1, k)]).toBe(0);
          expect(fields.w[studioSmokeWIndex(spec, i, j, k)]).toBe(0);
          expect(fields.w[studioSmokeWIndex(spec, i, j, k + 1)]).toBe(0);
        }
      }
    }
  });

  it("open 경계는 같은 조건의 폐쇄 상자보다 질량을 확실히 더 잃는다", () => {
    // 초기 조건은 완전히 동일하다 — 위로 부는 균일 속도 + 같은 블롭. 다른 것은 경계뿐.
    // 폐쇄 상자는 벽이 상승류를 막아 투영이 그것을 즉시 죽인다(연기가 갇힌다).
    // 상하가 열린 풍동에서는 균일 상승류가 발산 0 이라 그대로 살아남고 연기를 밖으로 뺀다.
    const WIND_TUNNEL: StudioSmokeBoundaryModes = {
      ...STUDIO_SMOKE_CLOSED_BOUNDARY,
      yMin: "open",
      yMax: "open",
    };
    const run = (boundary: StudioSmokeBoundaryModes): { initial: number; final: number } => {
      const state = createStudioSmokeState({ nx: 16, ny: 16, nz: 16, boundary });
      fillBlob(state, [4, 4, 4], [12, 9, 12], 1, 0);
      state.fields.v.fill(8);
      const initial = measureStudioSmokeMass(state);
      for (let step = 0; step < 30; step += 1) stepStudioSmoke(state, INERT);
      return { initial, final: measureStudioSmokeMass(state) };
    };
    const closed = run(STUDIO_SMOKE_CLOSED_BOUNDARY);
    const open = run(WIND_TUNNEL);
    expect(closed.initial).toBe(open.initial);
    // 폐쇄 상자: 벽을 통한 유출이 구조적으로 0 이라 연기가 거의 그대로 남는다
    // (±10% 는 semi-Lagrangian 의 양방향 표류 — 실측 +2%).
    expect(closed.final).toBeGreaterThan(closed.initial * 0.9);
    expect(closed.final).toBeLessThan(closed.initial * 1.1);
    // 풍동: 표류로는 설명 안 되는 크기로 실제 유출이 일어난다(실측 폐쇄 대비 0.69배).
    expect(open.final).toBeLessThan(closed.final * 0.85);
  });

  it("open 면이 하나라도 있으면 Dirichlet 조건이 있다고 본다", () => {
    const closed = createStudioSmokeState({ nx: 4, ny: 4, nz: 4, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    const chimney = createStudioSmokeState({ nx: 4, ny: 4, nz: 4, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });
    expect(hasStudioSmokeDirichlet(closed.spec)).toBe(false);
    expect(hasStudioSmokeDirichlet(chimney.spec)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ⑤ 결정성
// ---------------------------------------------------------------------------

describe("studio-smoke-core: 결정성", () => {
  function run30(): StudioSmokeState {
    const state = createStudioSmokeState({ nx: 14, ny: 14, nz: 14, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });
    fillBlob(state, [5, 2, 5], [9, 5, 9], 1.5, 3);
    const params = { ...INERT, buoyancyAlpha: 0.3, buoyancyBeta: 4, vorticityEpsilon: 8 };
    for (let step = 0; step < 30; step += 1) stepStudioSmoke(state, params);
    return state;
  }

  it("같은 입력으로 30스텝 두 번 돌리면 전 필드가 바이트 단위로 동일하다", () => {
    const a = run30();
    const b = run30();
    const fieldNames = [
      "u",
      "v",
      "w",
      "density",
      "temperature",
      "pressure",
      "divergence",
      "curlX",
      "curlY",
      "curlZ",
      "curlMagnitude",
    ] as const;
    for (const name of fieldNames) {
      const left = new Uint8Array(a.fields[name].buffer, a.fields[name].byteOffset, a.fields[name].byteLength);
      const right = new Uint8Array(b.fields[name].buffer, b.fields[name].byteOffset, b.fields[name].byteLength);
      expect(right).toEqual(left);
    }
  });

  it("스텝 결과 객체(CFL·클램프 수)도 동일하다", () => {
    const measure = (): unknown => {
      const state = createStudioSmokeState({ nx: 10, ny: 10, nz: 10, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
      fillBlob(state, [3, 3, 3], [7, 7, 7], 2, 4);
      const params = { ...INERT, buoyancyBeta: 5, vorticityEpsilon: 10, measureDivergence: true };
      const results = [];
      for (let step = 0; step < 5; step += 1) results.push(stepStudioSmoke(state, params));
      return results;
    };
    expect(measure()).toEqual(measure());
  });

  it("엔진 소스에 Math.random / Date.now / performance.now 가 없다", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(dir).filter(
      (name) => name.startsWith("studio-smoke-") && name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThanOrEqual(8);
    const offenders: string[] = [];
    for (const name of sources) {
      const code = readFileSync(path.join(dir, name), "utf8");
      // 주석에 적힌 "Math.random/Date.now 0건" 문구는 계약 선언이므로 코드 라인만 본다.
      for (const [index, line] of code.split("\n").entries()) {
        const trimmed = line.trim();
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) continue;
        if (/\b(Math\.random|Date\.now|performance\.now)\b/.test(line)) {
          offenders.push(`${name}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 와도 구속 · CFL · 샘플러 계약
// ---------------------------------------------------------------------------

describe("studio-smoke-core: 와도 구속", () => {
  it("ε>0 는 ε=0 보다 엔스트로피를 확실히 키운다(수치 소산 상쇄)", () => {
    const enstrophyFor = (epsilon: number): number => {
      const state = createStudioSmokeState({ nx: 20, ny: 20, nz: 20, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
      fillNoiseVelocity(state, 99, 0.5);
      fillBlob(state, [4, 4, 4], [16, 16, 16], 1, 0);
      for (let step = 0; step < 15; step += 1) stepStudioSmoke(state, { ...INERT, vorticityEpsilon: epsilon });
      return measureStudioSmokeEnstrophy(state);
    };
    const base = enstrophyFor(0);
    const confined = enstrophyFor(10);
    expect(base).toBeGreaterThan(0);
    expect(confined).toBeGreaterThan(base * 2);
  });

  it("ε=0 이면 와도 구속 패스가 속도를 전혀 건드리지 않는다", () => {
    const state = createStudioSmokeState({ nx: 8, ny: 8, nz: 8, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 12);
    applyStudioSmokeBoundaries(state);
    const snapshot = Float32Array.from(state.fields.u);
    STUDIO_SMOKE_CPU_KERNELS.curl(state, INERT);
    STUDIO_SMOKE_CPU_KERNELS.vorticity_force(state, { ...INERT, vorticityEpsilon: 0 });
    STUDIO_SMOKE_CPU_KERNELS.vorticity_apply(state, { ...INERT, vorticityEpsilon: 0 });
    expect(Array.from(state.fields.u)).toEqual(Array.from(snapshot));
  });
});

describe("studio-smoke-core: CFL 보고", () => {
  it("작은 dt 는 클램프가 없고, 큰 dt 는 클램프를 보고한다(무음 아니다)", () => {
    const gentle = createStudioSmokeState({ nx: 12, ny: 12, nz: 12, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    gentle.fields.u.fill(0.5);
    const gentleResult = stepStudioSmoke(gentle, { ...INERT, dt: 1 / 120 });
    expect(gentleResult.maxCfl).toBeCloseTo(0.5 / 120, 10);
    expect(gentleResult.cflClamped).toBe(false);
    expect(gentleResult.clampedSamples).toBe(0);

    const violent = createStudioSmokeState({ nx: 12, ny: 12, nz: 12, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    violent.fields.u.fill(200);
    const violentResult = stepStudioSmoke(violent, { ...INERT, dt: 1 / 30 });
    expect(violentResult.maxCfl).toBeGreaterThan(1);
    expect(violentResult.cflClamped).toBe(true);
    expect(violentResult.clampedSamples).toBeGreaterThan(0);
  });

  it("measureDivergence 를 켜면 투영 전후 발산이 결과에 실린다", () => {
    const state = createStudioSmokeState({ nx: 10, ny: 10, nz: 10, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 31, 2);
    const off = stepStudioSmoke(state, INERT);
    expect(off.divergenceBefore).toBeNull();
    expect(off.divergenceAfter).toBeNull();

    fillNoiseVelocity(state, 31, 2);
    const on = stepStudioSmoke(state, { ...INERT, measureDivergence: true });
    expect(on.divergenceBefore).not.toBeNull();
    expect(on.divergenceAfter!.rms).toBeLessThan(on.divergenceBefore!.rms);
    expect(on.divergenceAfter!.cells).toBe(1000);
  });
});

describe("studio-smoke-core: 샘플러 계약", () => {
  it("면 위에서의 속도 샘플은 배열 직접 읽기와 비트 동일하다", () => {
    const state = createStudioSmokeState({ nx: 6, ny: 6, nz: 6, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 8);
    const { spec, fields } = state;
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        for (let i = 0; i <= spec.nx; i += 1) {
          expect(sampleStudioSmokeU(spec, fields.u, i, j + 0.5, k + 0.5)).toBe(
            fields.u[studioSmokeUIndex(spec, i, j, k)],
          );
        }
      }
    }
  });

  it("셀 중심 속도의 2점 lerp 단축 경로는 일반 샘플러와 비트 동일하다", () => {
    const state = createStudioSmokeState({ nx: 6, ny: 6, nz: 6, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    fillNoiseVelocity(state, 21);
    const { spec, fields } = state;
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        for (let i = 0; i < spec.nx; i += 1) {
          const a = fields.u[studioSmokeUIndex(spec, i, j, k)];
          const b = fields.u[studioSmokeUIndex(spec, i + 1, j, k)];
          expect(sampleStudioSmokeU(spec, fields.u, i + 0.5, j + 0.5, k + 0.5)).toBe(a + (b - a) * 0.5);
          const c = fields.v[studioSmokeVIndex(spec, i, j, k)];
          const d = fields.v[studioSmokeVIndex(spec, i, j + 1, k)];
          expect(sampleStudioSmokeV(spec, fields.v, i + 0.5, j + 0.5, k + 0.5)).toBe(c + (d - c) * 0.5);
          const e = fields.w[studioSmokeWIndex(spec, i, j, k)];
          const f = fields.w[studioSmokeWIndex(spec, i, j, k + 1)];
          expect(sampleStudioSmokeW(spec, fields.w, i + 0.5, j + 0.5, k + 0.5)).toBe(e + (f - e) * 0.5);
        }
      }
    }
  });

  it("스칼라 샘플은 open 밖을 0, solid 밖을 반사로 본다", () => {
    const open = createStudioSmokeState({ nx: 4, ny: 4, nz: 4, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });
    const closed = createStudioSmokeState({ nx: 4, ny: 4, nz: 4, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    for (const state of [open, closed]) state.fields.density.fill(2);
    // yMax 는 open 쪽에서만 열려 있다 — 도메인 위쪽 바깥 지점을 샘플.
    expect(sampleStudioSmokeScalar(open.spec, open.fields.density, 2, 5.5, 2)).toBe(0);
    expect(sampleStudioSmokeScalar(closed.spec, closed.fields.density, 2, 5.5, 2)).toBe(2);
    // 옆면은 둘 다 solid → 반사.
    expect(sampleStudioSmokeScalar(open.spec, open.fields.density, -1.5, 2, 2)).toBe(2);
  });
});

describe("studio-smoke-core: 커널 레지스트리", () => {
  it("id 목록과 CPU 구현 키가 정확히 일치하고 중복이 없다", () => {
    const ids = [...STUDIO_SMOKE_KERNEL_IDS];
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(STUDIO_SMOKE_CPU_KERNELS).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(typeof STUDIO_SMOKE_CPU_KERNELS[id]).toBe("function");
  });

  it("레지스트리 순서대로 커널을 직접 부르면 stepStudioSmoke 와 같은 속도장이 나온다", () => {
    const params = { ...INERT, buoyancyAlpha: 0.2, buoyancyBeta: 3, vorticityEpsilon: 5 };
    const build = (): StudioSmokeState => {
      const state = createStudioSmokeState({ nx: 10, ny: 10, nz: 10, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });
      fillBlob(state, [3, 2, 3], [7, 5, 7], 1.5, 3);
      return state;
    };
    const viaStep = build();
    stepStudioSmoke(viaStep, params);

    const viaKernels = build();
    for (const id of STUDIO_SMOKE_KERNEL_IDS) {
      STUDIO_SMOKE_CPU_KERNELS[id](viaKernels, params);
      // 커널 순서상 divergence 뒤 jacobi 앞에 경계가 이미 적용되어 있어야 한다.
      if (id === "boundary") STUDIO_SMOKE_CPU_KERNELS.divergence(viaKernels, params);
    }
    STUDIO_SMOKE_CPU_KERNELS.boundary(viaKernels, params);

    expect(Array.from(viaKernels.fields.u)).toEqual(Array.from(viaStep.fields.u));
    expect(Array.from(viaKernels.fields.v)).toEqual(Array.from(viaStep.fields.v));
    expect(Array.from(viaKernels.fields.w)).toEqual(Array.from(viaStep.fields.w));
  });
});
