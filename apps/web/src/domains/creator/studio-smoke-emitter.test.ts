import { describe, expect, it } from "vitest";

import { measureStudioSmokeMass, stepStudioSmoke } from "./studio-smoke-core";
import {
  advanceStudioSmokeFrame,
  applyStudioSmokeEmitter,
  applyStudioSmokeEmitters,
  simulateStudioSmokeFrames,
  studioSmokeEmitterFalloff,
  studioSmokeEmitterJitter,
} from "./studio-smoke-emitter";
import {
  STUDIO_SMOKE_CHIMNEY_BOUNDARY,
  createStudioSmokeState,
  fillStudioSmokeSolidBox,
  studioSmokeCellIndex,
  studioSmokeVIndex,
} from "./studio-smoke-grid";

import type { StudioSmokeStepParams } from "./studio-smoke-core";
import type { StudioSmokeEmitter } from "./studio-smoke-emitter";

const SPHERE: StudioSmokeEmitter = {
  shape: "sphere",
  x: 8,
  y: 4,
  z: 8,
  radius: 3,
  height: 0,
  densityRate: 30,
  temperatureRate: 15,
  velocity: [0, 5, 0],
  jitter: 0,
  seed: 7,
};

const PARAMS: StudioSmokeStepParams = {
  dt: 1 / 30,
  buoyancyAlpha: 0.2,
  buoyancyBeta: 4,
  ambientTemperature: 0,
  vorticityEpsilon: 6,
  densityDissipation: 0.1,
  temperatureDissipation: 0.5,
  pressureIterations: 20,
};

function makeState() {
  return createStudioSmokeState({ nx: 16, ny: 20, nz: 16, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });
}

describe("studio-smoke-emitter: 감쇠 모양", () => {
  it("구는 중심에서 1, 반지름 밖에서 0, 그 사이는 단조 감소", () => {
    expect(studioSmokeEmitterFalloff({ ...SPHERE, x: 8.5, y: 4.5, z: 8.5 }, 8, 4, 8)).toBe(1);
    expect(studioSmokeEmitterFalloff(SPHERE, 15, 19, 15)).toBe(0);
    let previous = Number.POSITIVE_INFINITY;
    for (let i = 8; i <= 12; i += 1) {
      const value = studioSmokeEmitterFalloff({ ...SPHERE, x: 8.5, y: 4.5, z: 8.5 }, i, 4, 8);
      expect(value).toBeLessThanOrEqual(previous);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it("원뿔은 꼭짓점 아래와 높이 위를 0 으로 자르고 옆으로 벌어진다", () => {
    const cone: StudioSmokeEmitter = { ...SPHERE, shape: "cone", x: 8.5, y: 2.5, z: 8.5, radius: 6, height: 8 };
    // 꼭짓점 아래(=음의 dy) 와 높이 초과는 0.
    expect(studioSmokeEmitterFalloff(cone, 8, 1, 8)).toBe(0);
    expect(studioSmokeEmitterFalloff(cone, 8, 12, 8)).toBe(0);
    // 위로 갈수록 허용 반경이 넓어진다 — 축에서 3셀 떨어진 지점은 낮은 높이에선 0,
    // 충분히 높은 곳에선 0 보다 크다.
    expect(studioSmokeEmitterFalloff(cone, 11, 3, 8)).toBe(0);
    expect(studioSmokeEmitterFalloff(cone, 11, 7, 8)).toBeGreaterThan(0);
  });

  it("반지름 0 이나 높이 0 이면 아무것도 방출하지 않는다", () => {
    expect(studioSmokeEmitterFalloff({ ...SPHERE, radius: 0 }, 8, 4, 8)).toBe(0);
    expect(studioSmokeEmitterFalloff({ ...SPHERE, shape: "cone", radius: 5, height: 0 }, 8, 5, 8)).toBe(0);
  });
});

describe("studio-smoke-emitter: 주입", () => {
  it("반경 안에 밀도·온도가 들어가고 밖은 정확히 0 이다", () => {
    const state = makeState();
    const touched = applyStudioSmokeEmitter(state, SPHERE, 1 / 30, 0);
    expect(touched).toBeGreaterThan(0);
    const { spec, fields } = state;
    let inside = 0;
    for (let k = 0; k < spec.nz; k += 1) {
      for (let j = 0; j < spec.ny; j += 1) {
        for (let i = 0; i < spec.nx; i += 1) {
          const cell = studioSmokeCellIndex(spec, i, j, k);
          const falloff = studioSmokeEmitterFalloff(SPHERE, i, j, k);
          if (falloff > 0) {
            expect(fields.density[cell]).toBeGreaterThan(0);
            expect(fields.temperature[cell]).toBeGreaterThan(0);
            inside += 1;
          } else {
            expect(fields.density[cell]).toBe(0);
            expect(fields.temperature[cell]).toBe(0);
          }
        }
      }
    }
    expect(inside).toBe(touched);
  });

  it("주입량은 dt·rate·falloff 에 정확히 비례한다(jitter=0)", () => {
    const state = makeState();
    applyStudioSmokeEmitter(state, SPHERE, 1 / 30, 0);
    const { spec, fields } = state;
    const cell = studioSmokeCellIndex(spec, 8, 4, 8);
    const falloff = studioSmokeEmitterFalloff(SPHERE, 8, 4, 8);
    // 필드가 Float32Array 라 f64 곱을 f32 로 반올림한 값과 **정확히** 같아야 한다.
    expect(fields.density[cell]).toBe(Math.fround((1 / 30) * SPHERE.densityRate * falloff));
    expect(fields.temperature[cell]).toBe(Math.fround((1 / 30) * SPHERE.temperatureRate * falloff));
  });

  it("dt 를 두 배로 주면 주입량도 정확히 두 배다", () => {
    const single = makeState();
    const double = makeState();
    applyStudioSmokeEmitter(single, SPHERE, 1 / 30, 0);
    applyStudioSmokeEmitter(double, SPHERE, 2 / 30, 0);
    expect(measureStudioSmokeMass(double)).toBeCloseTo(measureStudioSmokeMass(single) * 2, 8);
  });

  it("속도는 셀 양쪽 면에 절반씩 들어간다", () => {
    const state = makeState();
    applyStudioSmokeEmitter(state, { ...SPHERE, densityRate: 0, temperatureRate: 0 }, 1 / 30, 0);
    const { spec, fields } = state;
    // 방출은 +y 뿐이라 v 면만 움직이고 u/w 는 정확히 0 이어야 한다.
    expect(Array.from(fields.u).every((value) => value === 0)).toBe(true);
    expect(Array.from(fields.w).every((value) => value === 0)).toBe(true);
    expect(fields.v[studioSmokeVIndex(spec, 8, 4, 8)]).toBeGreaterThan(0);
  });

  it("solid 셀에는 아무것도 주입되지 않는다", () => {
    const state = makeState();
    fillStudioSmokeSolidBox(state, { minX: 6, maxX: 11, minY: 2, maxY: 7, minZ: 6, maxZ: 11 });
    applyStudioSmokeEmitter(state, SPHERE, 1 / 30, 0);
    const { spec, fields } = state;
    for (let cell = 0; cell < fields.solid.length; cell += 1) {
      if (fields.solid[cell] === 0) continue;
      expect(fields.density[cell]).toBe(0);
      expect(fields.temperature[cell]).toBe(0);
    }
    expect(studioSmokeCellIndex(spec, 8, 4, 8)).toBeGreaterThanOrEqual(0);
  });

  it("jitter=0 이면 x축 대칭인 셀 쌍의 주입량이 정확히 같다", () => {
    const state = makeState();
    const centered: StudioSmokeEmitter = { ...SPHERE, x: 8, y: 4.5, z: 8, jitter: 0 };
    applyStudioSmokeEmitter(state, centered, 1 / 30, 0);
    const { spec, fields } = state;
    for (let offset = 1; offset <= 3; offset += 1) {
      const left = fields.density[studioSmokeCellIndex(spec, 8 - offset, 4, 8)];
      const right = fields.density[studioSmokeCellIndex(spec, 7 + offset, 4, 8)];
      expect(left).toBe(right);
    }
  });
});

describe("studio-smoke-emitter: 결정적 지터", () => {
  it("jitter=0 은 정확히 1(항등)", () => {
    expect(studioSmokeEmitterJitter({ ...SPHERE, jitter: 0 }, 123, 4)).toBe(1);
  });

  it("jitter>0 이면 1±jitter 범위 안이고 같은 (cell,frame,seed) 는 항상 같은 값", () => {
    const emitter = { ...SPHERE, jitter: 0.5, seed: 11 };
    const values = new Set<number>();
    for (let cell = 0; cell < 200; cell += 1) {
      const value = studioSmokeEmitterJitter(emitter, cell, 3);
      expect(value).toBeGreaterThanOrEqual(0.5);
      expect(value).toBeLessThanOrEqual(1.5);
      expect(studioSmokeEmitterJitter(emitter, cell, 3)).toBe(value);
      values.add(value);
    }
    // 실제로 흩어져야 한다(상수 함수가 아니다).
    expect(values.size).toBeGreaterThan(150);
  });

  it("프레임/시드가 다르면 지터 패턴이 달라진다", () => {
    const emitter = { ...SPHERE, jitter: 0.4, seed: 11 };
    const frameA = Array.from({ length: 50 }, (_, cell) => studioSmokeEmitterJitter(emitter, cell, 0));
    const frameB = Array.from({ length: 50 }, (_, cell) => studioSmokeEmitterJitter(emitter, cell, 1));
    const otherSeed = Array.from({ length: 50 }, (_, cell) =>
      studioSmokeEmitterJitter({ ...emitter, seed: 12 }, cell, 0),
    );
    expect(frameA).not.toEqual(frameB);
    expect(frameA).not.toEqual(otherSeed);
  });
});

describe("studio-smoke-emitter: 프레임 진행", () => {
  it("여러 이미터는 배열 순서대로 누적된다", () => {
    const single = makeState();
    applyStudioSmokeEmitters(single, [SPHERE], 1 / 30, 0);
    const doubled = makeState();
    applyStudioSmokeEmitters(doubled, [SPHERE, SPHERE], 1 / 30, 0);
    expect(measureStudioSmokeMass(doubled)).toBeCloseTo(measureStudioSmokeMass(single) * 2, 8);
  });

  it("advanceStudioSmokeFrame = 이미터 주입 + stepStudioSmoke", () => {
    const combined = makeState();
    advanceStudioSmokeFrame(combined, PARAMS, [SPHERE], 3);
    const manual = makeState();
    applyStudioSmokeEmitters(manual, [SPHERE], PARAMS.dt, 3);
    stepStudioSmoke(manual, PARAMS);
    expect(Array.from(combined.fields.density)).toEqual(Array.from(manual.fields.density));
    expect(Array.from(combined.fields.v)).toEqual(Array.from(manual.fields.v));
  });

  it("frameIndex 가 다르면 지터가 달라 결과도 달라진다(시간 의존이 명시적이다)", () => {
    const emitter = { ...SPHERE, jitter: 0.6 };
    const a = makeState();
    advanceStudioSmokeFrame(a, PARAMS, [emitter], 0);
    const b = makeState();
    advanceStudioSmokeFrame(b, PARAMS, [emitter], 1);
    expect(Array.from(a.fields.density)).not.toEqual(Array.from(b.fields.density));
  });

  it("simulateStudioSmokeFrames 는 결정적이며 연기를 실제로 쌓는다", () => {
    const run = () => {
      const state = makeState();
      const results = simulateStudioSmokeFrames(state, PARAMS, [{ ...SPHERE, jitter: 0.35 }], 12);
      return { state, results };
    };
    const first = run();
    const second = run();
    expect(first.results.length).toBe(12);
    expect(first.results).toEqual(second.results);
    const left = new Uint8Array(first.state.fields.density.buffer.slice(0));
    const right = new Uint8Array(second.state.fields.density.buffer.slice(0));
    expect(right).toEqual(left);
    expect(measureStudioSmokeMass(first.state)).toBeGreaterThan(0);
  });
});
