/**
 * Studio Smoke Presets — 연기 파라미터 기본값·범위·정규화·한글 프리셋
 *
 * studio-grain.ts 의 관례를 그대로 따른다: `DEFAULT_*` 항등/표준값 + `*_RANGE {min,max,step}`
 * + 한글 라벨 프리셋 배열 + `normalize*()`. 과거 저장본/외부 JSON 이 그대로 들어와도
 * 비유한값·범위 밖·타입 오류를 전부 흡수해 **항상 유효한 파라미터**를 돌려준다.
 *
 * 정규화는 순수 함수다 — 같은 입력이면 같은 출력이고, 시계나 난수를 보지 않는다.
 */

import type { StudioSmokeStepParams } from "./studio-smoke-core";
import type { StudioSmokeEmitter, StudioSmokeEmitterShape } from "./studio-smoke-emitter";

// ---------------------------------------------------------------------------
// 범위
// ---------------------------------------------------------------------------

/** 시간 스텝(초). 1/240 ~ 1/12 — 30fps(0.0333)가 기본. */
export const STUDIO_SMOKE_DT_RANGE = { min: 1 / 240, max: 1 / 12, step: 1 / 240 } as const;
export const STUDIO_SMOKE_BUOYANCY_ALPHA_RANGE = { min: 0, max: 5, step: 0.05 } as const;
export const STUDIO_SMOKE_BUOYANCY_BETA_RANGE = { min: 0, max: 20, step: 0.1 } as const;
export const STUDIO_SMOKE_AMBIENT_TEMPERATURE_RANGE = { min: -1, max: 5, step: 0.05 } as const;
export const STUDIO_SMOKE_VORTICITY_RANGE = { min: 0, max: 40, step: 0.5 } as const;
export const STUDIO_SMOKE_DISSIPATION_RANGE = { min: 0, max: 5, step: 0.05 } as const;
/** Jacobi 반복수 — 40 이 잔차/비용의 무릎(studio-smoke-core 표 참고). */
export const STUDIO_SMOKE_PRESSURE_ITERATIONS_RANGE = { min: 1, max: 200, step: 1 } as const;

export const STUDIO_SMOKE_EMITTER_RADIUS_RANGE = { min: 0.5, max: 32, step: 0.5 } as const;
export const STUDIO_SMOKE_EMITTER_HEIGHT_RANGE = { min: 0, max: 64, step: 0.5 } as const;
export const STUDIO_SMOKE_EMITTER_RATE_RANGE = { min: 0, max: 200, step: 1 } as const;
export const STUDIO_SMOKE_EMITTER_VELOCITY_RANGE = { min: -50, max: 50, step: 0.5 } as const;
export const STUDIO_SMOKE_EMITTER_JITTER_RANGE = { min: 0, max: 1, step: 0.05 } as const;
export const STUDIO_SMOKE_EMITTER_SEED_RANGE = { min: 0, max: 9999, step: 1 } as const;

/** 표준 기본 파라미터 — 표준 48³ 굴뚝 경계에서 곧바로 그럴듯한 연기가 나온다. */
export const DEFAULT_STUDIO_SMOKE_PARAMS: StudioSmokeStepParams = {
  dt: 1 / 30,
  buoyancyAlpha: 0.35,
  buoyancyBeta: 3.2,
  ambientTemperature: 0,
  vorticityEpsilon: 8,
  densityDissipation: 0.12,
  temperatureDissipation: 0.6,
  pressureIterations: 40,
};

/** 기본 이미터 — 격자 크기와 무관한 상대 배치는 호출부가 맞춘다(여긴 48³ 기준). */
export const DEFAULT_STUDIO_SMOKE_EMITTER: StudioSmokeEmitter = {
  shape: "sphere",
  x: 24,
  y: 6,
  z: 24,
  radius: 4,
  height: 0,
  densityRate: 24,
  temperatureRate: 12,
  velocity: [0, 6, 0],
  jitter: 0.25,
  seed: 1,
};

// ---------------------------------------------------------------------------
// 정규화
// ---------------------------------------------------------------------------

function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

const EMITTER_SHAPES = new Set<StudioSmokeEmitterShape>(["sphere", "cone"]);

/**
 * 스텝 파라미터 정규화 — 누락/비유한/범위 밖을 전부 흡수한다.
 * measureDivergence 는 false(기본)면 키를 생략해, 캐시 키 직렬화가
 * 과거 저장본과 바이트 동일하게 유지된다(studio-grain 의 chroma 관례와 동일).
 */
export function normalizeStudioSmokeParams(raw?: Partial<StudioSmokeStepParams> | null): StudioSmokeStepParams {
  const src = raw && typeof raw === "object" ? raw : {};
  const measure = src.measureDivergence === true;
  return {
    dt: clampTo(src.dt, STUDIO_SMOKE_DT_RANGE.min, STUDIO_SMOKE_DT_RANGE.max, DEFAULT_STUDIO_SMOKE_PARAMS.dt),
    buoyancyAlpha: clampTo(
      src.buoyancyAlpha,
      STUDIO_SMOKE_BUOYANCY_ALPHA_RANGE.min,
      STUDIO_SMOKE_BUOYANCY_ALPHA_RANGE.max,
      DEFAULT_STUDIO_SMOKE_PARAMS.buoyancyAlpha,
    ),
    buoyancyBeta: clampTo(
      src.buoyancyBeta,
      STUDIO_SMOKE_BUOYANCY_BETA_RANGE.min,
      STUDIO_SMOKE_BUOYANCY_BETA_RANGE.max,
      DEFAULT_STUDIO_SMOKE_PARAMS.buoyancyBeta,
    ),
    ambientTemperature: clampTo(
      src.ambientTemperature,
      STUDIO_SMOKE_AMBIENT_TEMPERATURE_RANGE.min,
      STUDIO_SMOKE_AMBIENT_TEMPERATURE_RANGE.max,
      DEFAULT_STUDIO_SMOKE_PARAMS.ambientTemperature,
    ),
    vorticityEpsilon: clampTo(
      src.vorticityEpsilon,
      STUDIO_SMOKE_VORTICITY_RANGE.min,
      STUDIO_SMOKE_VORTICITY_RANGE.max,
      DEFAULT_STUDIO_SMOKE_PARAMS.vorticityEpsilon,
    ),
    densityDissipation: clampTo(
      src.densityDissipation,
      STUDIO_SMOKE_DISSIPATION_RANGE.min,
      STUDIO_SMOKE_DISSIPATION_RANGE.max,
      DEFAULT_STUDIO_SMOKE_PARAMS.densityDissipation,
    ),
    temperatureDissipation: clampTo(
      src.temperatureDissipation,
      STUDIO_SMOKE_DISSIPATION_RANGE.min,
      STUDIO_SMOKE_DISSIPATION_RANGE.max,
      DEFAULT_STUDIO_SMOKE_PARAMS.temperatureDissipation,
    ),
    pressureIterations: Math.round(
      clampTo(
        src.pressureIterations,
        STUDIO_SMOKE_PRESSURE_ITERATIONS_RANGE.min,
        STUDIO_SMOKE_PRESSURE_ITERATIONS_RANGE.max,
        DEFAULT_STUDIO_SMOKE_PARAMS.pressureIterations,
      ),
    ),
    ...(measure ? { measureDivergence: true } : {}),
  };
}

/** 이미터 정규화 — 좌표는 격자 밖이어도 허용(부분 노출 이미터가 정당한 연출이다). */
export function normalizeStudioSmokeEmitter(raw?: Partial<StudioSmokeEmitter> | null): StudioSmokeEmitter {
  const src = raw && typeof raw === "object" ? raw : {};
  const shape =
    typeof src.shape === "string" && EMITTER_SHAPES.has(src.shape as StudioSmokeEmitterShape)
      ? (src.shape as StudioSmokeEmitterShape)
      : DEFAULT_STUDIO_SMOKE_EMITTER.shape;
  const velocity = Array.isArray(src.velocity) ? src.velocity : DEFAULT_STUDIO_SMOKE_EMITTER.velocity;
  const axis = (index: number): number =>
    clampTo(
      velocity[index],
      STUDIO_SMOKE_EMITTER_VELOCITY_RANGE.min,
      STUDIO_SMOKE_EMITTER_VELOCITY_RANGE.max,
      DEFAULT_STUDIO_SMOKE_EMITTER.velocity[index],
    );
  return {
    shape,
    x: clampTo(src.x, -1e4, 1e4, DEFAULT_STUDIO_SMOKE_EMITTER.x),
    y: clampTo(src.y, -1e4, 1e4, DEFAULT_STUDIO_SMOKE_EMITTER.y),
    z: clampTo(src.z, -1e4, 1e4, DEFAULT_STUDIO_SMOKE_EMITTER.z),
    radius: clampTo(
      src.radius,
      STUDIO_SMOKE_EMITTER_RADIUS_RANGE.min,
      STUDIO_SMOKE_EMITTER_RADIUS_RANGE.max,
      DEFAULT_STUDIO_SMOKE_EMITTER.radius,
    ),
    height: clampTo(
      src.height,
      STUDIO_SMOKE_EMITTER_HEIGHT_RANGE.min,
      STUDIO_SMOKE_EMITTER_HEIGHT_RANGE.max,
      shape === "cone" ? 12 : DEFAULT_STUDIO_SMOKE_EMITTER.height,
    ),
    densityRate: clampTo(
      src.densityRate,
      STUDIO_SMOKE_EMITTER_RATE_RANGE.min,
      STUDIO_SMOKE_EMITTER_RATE_RANGE.max,
      DEFAULT_STUDIO_SMOKE_EMITTER.densityRate,
    ),
    temperatureRate: clampTo(
      src.temperatureRate,
      STUDIO_SMOKE_EMITTER_RATE_RANGE.min,
      STUDIO_SMOKE_EMITTER_RATE_RANGE.max,
      DEFAULT_STUDIO_SMOKE_EMITTER.temperatureRate,
    ),
    velocity: [axis(0), axis(1), axis(2)],
    jitter: clampTo(
      src.jitter,
      STUDIO_SMOKE_EMITTER_JITTER_RANGE.min,
      STUDIO_SMOKE_EMITTER_JITTER_RANGE.max,
      DEFAULT_STUDIO_SMOKE_EMITTER.jitter,
    ),
    seed: Math.floor(
      clampTo(
        src.seed,
        STUDIO_SMOKE_EMITTER_SEED_RANGE.min,
        STUDIO_SMOKE_EMITTER_SEED_RANGE.max,
        DEFAULT_STUDIO_SMOKE_EMITTER.seed,
      ),
    ),
  };
}

// ---------------------------------------------------------------------------
// 프리셋
// ---------------------------------------------------------------------------

export interface StudioSmokePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly params: StudioSmokeStepParams;
  readonly emitter: StudioSmokeEmitter;
}

/**
 * 한글 라벨 프리셋 — 좌표는 48³(표준) 기준이다. 다른 해상도로 옮길 때는
 * 호출부가 격자 비율로 스케일하면 된다(프리셋 자체는 해상도를 모른다).
 */
export const STUDIO_SMOKE_PRESETS: readonly StudioSmokePreset[] = [
  {
    id: "cigarette",
    label: "담배 연기",
    description: "가늘고 느린 상승, 와도가 강해 리본처럼 꼬인다",
    params: {
      ...DEFAULT_STUDIO_SMOKE_PARAMS,
      buoyancyAlpha: 0.15,
      buoyancyBeta: 1.6,
      vorticityEpsilon: 16,
      densityDissipation: 0.08,
      temperatureDissipation: 0.9,
    },
    emitter: {
      shape: "sphere",
      x: 24,
      y: 5,
      z: 24,
      radius: 1.5,
      height: 0,
      densityRate: 18,
      temperatureRate: 6,
      velocity: [0, 3, 0],
      jitter: 0.3,
      seed: 11,
    },
  },
  {
    id: "steam",
    label: "수증기·김",
    description: "넓게 퍼지며 빨리 식는 흰 김 — 컵/냄비 위",
    params: {
      ...DEFAULT_STUDIO_SMOKE_PARAMS,
      buoyancyAlpha: 0.25,
      buoyancyBeta: 4.5,
      vorticityEpsilon: 6,
      densityDissipation: 0.45,
      temperatureDissipation: 1.8,
    },
    emitter: {
      shape: "cone",
      x: 24,
      y: 4,
      z: 24,
      radius: 6,
      height: 10,
      densityRate: 30,
      temperatureRate: 20,
      velocity: [0, 5, 0],
      jitter: 0.4,
      seed: 23,
    },
  },
  {
    id: "blast-dust",
    label: "폭발 먼지",
    description: "한 번에 큰 덩어리, 무겁게 퍼지다 가라앉는다",
    params: {
      ...DEFAULT_STUDIO_SMOKE_PARAMS,
      buoyancyAlpha: 1.2,
      buoyancyBeta: 6,
      vorticityEpsilon: 22,
      densityDissipation: 0.05,
      temperatureDissipation: 2.5,
    },
    emitter: {
      shape: "sphere",
      x: 24,
      y: 10,
      z: 24,
      radius: 7,
      height: 0,
      densityRate: 120,
      temperatureRate: 60,
      velocity: [0, 14, 0],
      jitter: 0.6,
      seed: 37,
    },
  },
  {
    id: "low-fog",
    label: "낮은 안개",
    description: "거의 뜨지 않고 바닥을 기며 옆으로 흐른다",
    params: {
      ...DEFAULT_STUDIO_SMOKE_PARAMS,
      buoyancyAlpha: 0.9,
      buoyancyBeta: 0.4,
      vorticityEpsilon: 3,
      densityDissipation: 0.02,
      temperatureDissipation: 0.3,
    },
    emitter: {
      shape: "sphere",
      x: 12,
      y: 3,
      z: 24,
      radius: 5,
      height: 0,
      densityRate: 40,
      temperatureRate: 1,
      velocity: [4, 0.5, 0],
      jitter: 0.2,
      seed: 53,
    },
  },
];

/** id 로 프리셋 조회 — 없으면 null(무음 폴백 금지). */
export function findStudioSmokePreset(id: string): StudioSmokePreset | null {
  for (let index = 0; index < STUDIO_SMOKE_PRESETS.length; index += 1) {
    if (STUDIO_SMOKE_PRESETS[index].id === id) return STUDIO_SMOKE_PRESETS[index];
  }
  return null;
}
