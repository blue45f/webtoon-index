import { describe, expect, it } from "vitest";

import { stepStudioSmoke } from "./studio-smoke-core";
import { advanceStudioSmokeFrame } from "./studio-smoke-emitter";
import { STUDIO_SMOKE_CHIMNEY_BOUNDARY, createStudioSmokeState } from "./studio-smoke-grid";
import {
  DEFAULT_STUDIO_SMOKE_EMITTER,
  DEFAULT_STUDIO_SMOKE_PARAMS,
  STUDIO_SMOKE_BUOYANCY_BETA_RANGE,
  STUDIO_SMOKE_DISSIPATION_RANGE,
  STUDIO_SMOKE_DT_RANGE,
  STUDIO_SMOKE_EMITTER_JITTER_RANGE,
  STUDIO_SMOKE_EMITTER_RADIUS_RANGE,
  STUDIO_SMOKE_EMITTER_SEED_RANGE,
  STUDIO_SMOKE_PRESETS,
  STUDIO_SMOKE_PRESSURE_ITERATIONS_RANGE,
  STUDIO_SMOKE_VORTICITY_RANGE,
  findStudioSmokePreset,
  normalizeStudioSmokeEmitter,
  normalizeStudioSmokeParams,
} from "./studio-smoke-presets";

describe("studio-smoke-presets: 파라미터 정규화", () => {
  it("빈 입력/null 은 기본값 그대로", () => {
    expect(normalizeStudioSmokeParams()).toEqual(DEFAULT_STUDIO_SMOKE_PARAMS);
    expect(normalizeStudioSmokeParams(null)).toEqual(DEFAULT_STUDIO_SMOKE_PARAMS);
    expect(normalizeStudioSmokeParams({})).toEqual(DEFAULT_STUDIO_SMOKE_PARAMS);
  });

  it("비유한값·타입 오류는 기본값으로 흡수한다", () => {
    const dirty = normalizeStudioSmokeParams({
      dt: Number.NaN,
      buoyancyBeta: Number.POSITIVE_INFINITY,
      vorticityEpsilon: "8" as unknown as number,
      pressureIterations: Number.NEGATIVE_INFINITY,
    });
    expect(dirty.dt).toBe(DEFAULT_STUDIO_SMOKE_PARAMS.dt);
    expect(dirty.buoyancyBeta).toBe(DEFAULT_STUDIO_SMOKE_PARAMS.buoyancyBeta);
    expect(dirty.vorticityEpsilon).toBe(DEFAULT_STUDIO_SMOKE_PARAMS.vorticityEpsilon);
    expect(dirty.pressureIterations).toBe(DEFAULT_STUDIO_SMOKE_PARAMS.pressureIterations);
  });

  it("범위 밖은 각 범위의 끝으로 클램프한다", () => {
    const high = normalizeStudioSmokeParams({
      dt: 99,
      buoyancyBeta: 1e6,
      vorticityEpsilon: 1e6,
      densityDissipation: 1e6,
      pressureIterations: 1e6,
    });
    expect(high.dt).toBe(STUDIO_SMOKE_DT_RANGE.max);
    expect(high.buoyancyBeta).toBe(STUDIO_SMOKE_BUOYANCY_BETA_RANGE.max);
    expect(high.vorticityEpsilon).toBe(STUDIO_SMOKE_VORTICITY_RANGE.max);
    expect(high.densityDissipation).toBe(STUDIO_SMOKE_DISSIPATION_RANGE.max);
    expect(high.pressureIterations).toBe(STUDIO_SMOKE_PRESSURE_ITERATIONS_RANGE.max);

    const low = normalizeStudioSmokeParams({
      dt: -5,
      buoyancyBeta: -5,
      vorticityEpsilon: -5,
      pressureIterations: 0,
    });
    expect(low.dt).toBe(STUDIO_SMOKE_DT_RANGE.min);
    expect(low.buoyancyBeta).toBe(STUDIO_SMOKE_BUOYANCY_BETA_RANGE.min);
    expect(low.vorticityEpsilon).toBe(STUDIO_SMOKE_VORTICITY_RANGE.min);
    expect(low.pressureIterations).toBe(STUDIO_SMOKE_PRESSURE_ITERATIONS_RANGE.min);
  });

  it("pressureIterations 는 항상 정수다", () => {
    expect(normalizeStudioSmokeParams({ pressureIterations: 37.9 }).pressureIterations).toBe(38);
    expect(Number.isInteger(normalizeStudioSmokeParams({ pressureIterations: 12.4 }).pressureIterations)).toBe(
      true,
    );
  });

  it("measureDivergence 는 false 면 키 자체가 없다(직렬화 바이트 안정)", () => {
    expect("measureDivergence" in normalizeStudioSmokeParams({ measureDivergence: false })).toBe(false);
    expect(normalizeStudioSmokeParams({ measureDivergence: true }).measureDivergence).toBe(true);
    expect(JSON.stringify(normalizeStudioSmokeParams({}))).toBe(
      JSON.stringify(normalizeStudioSmokeParams({ measureDivergence: false })),
    );
  });

  it("멱등이다 — 정규화한 값을 다시 정규화해도 같다", () => {
    const once = normalizeStudioSmokeParams({ dt: 0.021, vorticityEpsilon: 13.3, pressureIterations: 55 });
    expect(normalizeStudioSmokeParams(once)).toEqual(once);
  });
});

describe("studio-smoke-presets: 이미터 정규화", () => {
  it("빈 입력은 기본 이미터", () => {
    expect(normalizeStudioSmokeEmitter()).toEqual(DEFAULT_STUDIO_SMOKE_EMITTER);
  });

  it("알 수 없는 shape 는 기본값으로, cone 은 기본 높이를 받는다", () => {
    expect(normalizeStudioSmokeEmitter({ shape: "torus" as never }).shape).toBe("sphere");
    expect(normalizeStudioSmokeEmitter({ shape: "cone" }).height).toBeGreaterThan(0);
  });

  it("velocity 는 3성분으로 정규화되고 범위로 클램프된다", () => {
    const emitter = normalizeStudioSmokeEmitter({ velocity: [1e6, Number.NaN, -1e6] as never });
    expect(emitter.velocity.length).toBe(3);
    expect(emitter.velocity[0]).toBe(50);
    expect(emitter.velocity[1]).toBe(DEFAULT_STUDIO_SMOKE_EMITTER.velocity[1]);
    expect(emitter.velocity[2]).toBe(-50);
    expect(normalizeStudioSmokeEmitter({ velocity: "nope" as never }).velocity).toEqual(
      DEFAULT_STUDIO_SMOKE_EMITTER.velocity,
    );
  });

  it("seed 는 정수로 내려가고 jitter/radius 는 범위 안이다", () => {
    const emitter = normalizeStudioSmokeEmitter({ seed: 123.9, jitter: 5, radius: 1e6 });
    expect(emitter.seed).toBe(123);
    expect(Number.isInteger(emitter.seed)).toBe(true);
    expect(emitter.jitter).toBe(STUDIO_SMOKE_EMITTER_JITTER_RANGE.max);
    expect(emitter.radius).toBe(STUDIO_SMOKE_EMITTER_RADIUS_RANGE.max);
    expect(normalizeStudioSmokeEmitter({ seed: -10 }).seed).toBe(STUDIO_SMOKE_EMITTER_SEED_RANGE.min);
  });

  it("멱등이다", () => {
    const once = normalizeStudioSmokeEmitter({ shape: "cone", radius: 7.5, jitter: 0.33, seed: 42 });
    expect(normalizeStudioSmokeEmitter(once)).toEqual(once);
  });
});

describe("studio-smoke-presets: 프리셋", () => {
  it("id 가 유일하고 한글 라벨/설명이 있다", () => {
    const ids = STUDIO_SMOKE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(4);
    for (const preset of STUDIO_SMOKE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      // 한글 라벨 컨벤션(스튜디오 UI 는 전부 한글).
      expect(/[가-힣]/.test(preset.label)).toBe(true);
    }
  });

  it("모든 프리셋이 정규화를 통과해도 값이 변하지 않는다(이미 유효 범위)", () => {
    for (const preset of STUDIO_SMOKE_PRESETS) {
      expect(normalizeStudioSmokeParams(preset.params)).toEqual(preset.params);
      expect(normalizeStudioSmokeEmitter(preset.emitter)).toEqual(preset.emitter);
    }
  });

  it("각 프리셋이 실제로 연기를 만든다(10프레임 뒤 밀도가 생긴다)", () => {
    for (const preset of STUDIO_SMOKE_PRESETS) {
      const state = createStudioSmokeState({
        nx: 24,
        ny: 24,
        nz: 24,
        boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY,
      });
      // 프리셋 좌표는 48³ 기준이라 절반으로 옮긴다.
      const emitter = {
        ...preset.emitter,
        x: preset.emitter.x / 2,
        y: preset.emitter.y / 2,
        z: preset.emitter.z / 2,
        radius: Math.max(1, preset.emitter.radius / 2),
        height: preset.emitter.height / 2,
      };
      let maxCfl = 0;
      for (let frame = 0; frame < 10; frame += 1) {
        const result = advanceStudioSmokeFrame(state, preset.params, [emitter], frame);
        maxCfl = Math.max(maxCfl, result.maxCfl);
      }
      let mass = 0;
      let finite = true;
      for (let cell = 0; cell < state.fields.density.length; cell += 1) {
        mass += state.fields.density[cell];
        if (!Number.isFinite(state.fields.density[cell])) finite = false;
      }
      expect(finite).toBe(true);
      expect(mass).toBeGreaterThan(0);
      // 프리셋은 발산하지 않아야 한다 — CFL 이 폭주하면 파라미터가 잘못된 것이다.
      expect(maxCfl).toBeLessThan(6);
    }
  });

  it("findStudioSmokePreset 은 없는 id 에 null 을 준다(무음 폴백 없음)", () => {
    expect(findStudioSmokePreset("cigarette")?.id).toBe("cigarette");
    expect(findStudioSmokePreset("does-not-exist")).toBeNull();
  });

  it("기본 파라미터는 그대로 스텝을 돌릴 수 있다", () => {
    const state = createStudioSmokeState({ nx: 12, ny: 12, nz: 12, boundary: STUDIO_SMOKE_CHIMNEY_BOUNDARY });
    const result = stepStudioSmoke(state, DEFAULT_STUDIO_SMOKE_PARAMS);
    expect(result.maxCfl).toBe(0);
    expect(result.cflClamped).toBe(false);
  });
});
