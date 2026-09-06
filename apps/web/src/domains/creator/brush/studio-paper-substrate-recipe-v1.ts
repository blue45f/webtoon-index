/**
 * 종이 21종 → 절차적 4채널 서페이스 **레시피** 매핑 (2026-08-21 paper substrate wave, 2단계).
 *
 * `studio-procedural-media-surface-provider.ts`(1,905줄)는 완성돼 있으면서 소비자가 0이었다.
 * 이 모듈이 그 유일한 진입 램프다 — 저장소가 이미 선언한 종이 수치
 * (`PAPER_TEXTURE_PRESETS` / `PAPER_PHYSICS_PROFILES`)를 프로바이더의 recipe 계약으로 옮긴다.
 *
 * 왜 레시피인가.
 * - 배포되는 것은 **숫자 수십 개**지 높이맵이 아니다. 256² R8 타일 하나가 65,536바이트인데
 *   레시피 한 장은 JSON으로 1KB 미만이고, 소스 상수로는 프리셋당 12개 숫자다. 타일은
 *   런타임에 굽는다 → 번들 증가 ~0, 네트워크 0, Service Worker 변경 0.
 * - 레시피는 결정적이다. 같은 (kind, seed, worldScale)은 항상 같은 fingerprint를 낸다.
 *
 * 계약.
 * - **높이는 스팬 표준화된다.** `relief.amplitude = 1`, `contrast`는 전 프리셋 공통이라
 *   tanh 출력이 모든 종이에서 같은 정규 범위를 쓴다. 종이별 거칠기는 소비자가
 *   `PAPER_TEXTURE_PRESETS[kind].amplitude`(선언된 진폭)와 `toothGain`으로 곱해 넣는다.
 *   1단계가 `createPaperHeightField`의 `contrast: "shaped-v2"`에서 내린 것과 같은 판단이다.
 * - **주파수 단위는 문서 px당 사이클**이다. 미세구조 셀 수는 `PAPER_REFERENCE_TILE`(128 doc px)
 *   기준이라 타일 크기를 바꿔도 결의 물리적 파장이 유지된다. (기존
 *   `specialtyMicrostructure`는 실제 타일 크기 기준이라 타일을 키우면 결이 같이 커졌다 —
 *   이 모듈은 그 불일치를 고친 쪽이다.)
 * - 이 모듈은 어떤 기본값도 바꾸지 않는다. 순수 함수 + 상수 테이블뿐이다.
 */

import {
  createStudioProceduralMediaSurfaceRecipe,
  type StudioProceduralMediaSurfaceRecipe,
  type StudioProceduralMediaSurfaceRecipeInput,
} from "../studio-procedural-media-surface-provider";

import {
  PAPER_PHYSICS_PROFILES,
  PAPER_REFERENCE_TILE,
  PAPER_TEXTURE_PRESETS,
  type PaperGrainKind,
} from "./studio-paper-texture";

export const STUDIO_PAPER_SUBSTRATE_RECIPE_VERSION_V1 = 1 as const;

/**
 * 종이 한 장의 미세구조 — fBm 위에 얹히는 구조항.
 * 셀 수는 전부 `PAPER_REFERENCE_TILE`(128 doc px)당 개수다.
 * 값은 `studio-paper-texture.ts`의 `specialtyMicrostructure` 분기를 그대로 옮긴 것이고
 * 새로 지어낸 수치가 아니다 — 직조/장섬유/공극/반점 넷 중 해당하는 것만 0이 아니다.
 */
export interface StudioPaperSubstrateMicrostructureV1 {
  /** 씨실·날실 셀 수(0이면 직조 없음). */
  readonly weaveWarpCells: number;
  readonly weaveWeftCells: number;
  readonly weaveAmplitude: number;
  /** 0=weft만, 1=warp만. 균형 직조는 0.5. */
  readonly weaveBalance: number;
  /** 장섬유 셀 수(결 방향 가로). 0이면 섬유 능선 없음. */
  readonly fiberCells: number;
  readonly fiberAmplitude: number;
  /** 공극 베드 — 건식 매체가 박히는 깊은 골. */
  readonly poreCells: number;
  readonly poreDensity: number;
  readonly poreAmplitude: number;
  /** 반점/그릿 — 재생 섬유 플렉, 사포 입자. */
  readonly speckleCells: number;
  readonly speckleDensity: number;
  readonly speckleAmplitude: number;
}

const NO_STRUCTURE = Object.freeze({
  weaveWarpCells: 0,
  weaveWeftCells: 0,
  weaveAmplitude: 0,
  weaveBalance: 0.5,
  fiberCells: 0,
  fiberAmplitude: 0,
  poreCells: 0,
  poreDensity: 0,
  poreAmplitude: 0,
  speckleCells: 0,
  speckleDensity: 0,
  speckleAmplitude: 0,
}) satisfies StudioPaperSubstrateMicrostructureV1;

function structure(
  patch: Partial<StudioPaperSubstrateMicrostructureV1>,
): StudioPaperSubstrateMicrostructureV1 {
  return Object.freeze({ ...NO_STRUCTURE, ...patch });
}

/**
 * 21종 미세구조 테이블 — 프리셋당 숫자 12개. 이것이 "배포되는 종이"의 전부다.
 * 주파수는 `specialtyMicrostructure`의 cells 인자를, 진폭은 같은 함수의 혼합 계수를 옮겼다.
 */
export const STUDIO_PAPER_SUBSTRATE_MICROSTRUCTURE_V1: Readonly<
  Record<PaperGrainKind, StudioPaperSubstrateMicrostructureV1>
> = Object.freeze({
  // 평판 마감 — 미세 폴리시 자국뿐.
  "hot-press": structure({ speckleCells: 56, speckleDensity: 0.5, speckleAmplitude: 0.08 }),
  bristol: structure({ speckleCells: 56, speckleDensity: 0.5, speckleAmplitude: 0.16 }),
  "marker-pad": structure({ speckleCells: 64, speckleDensity: 0.5, speckleAmplitude: 0.1 }),
  vellum: structure({ speckleCells: 40, speckleDensity: 0.5, speckleAmplitude: 0.2 }),
  "manga-paper": structure({
    speckleCells: 52,
    speckleDensity: 0.5,
    speckleAmplitude: 0.28,
    fiberCells: 70,
    fiberAmplitude: 0.12,
  }),
  // 펠트 압인 계열 — 공극이 얕게 깔린다.
  "cold-press": structure({ poreCells: 26, poreDensity: 0.35, poreAmplitude: 0.16 }),
  "watercolor-block": structure({ poreCells: 28, poreDensity: 0.3, poreAmplitude: 0.14 }),
  rough: structure({ poreCells: 20, poreDensity: 0.5, poreAmplitude: 0.42 }),
  "cotton-rag": structure({ poreCells: 12, poreDensity: 0.34, poreAmplitude: 0.28 }),
  "pastel-board": structure({ poreCells: 16, poreDensity: 0.38, poreAmplitude: 0.24 }),
  newsprint: structure({
    fiberCells: 64,
    fiberAmplitude: 0.18,
    poreCells: 48,
    poreDensity: 0.3,
    poreAmplitude: 0.1,
  }),
  // 직조 — 씨실·날실 격자.
  canvas: structure({
    weaveWarpCells: 18,
    weaveWeftCells: 18,
    weaveAmplitude: 0.56,
    weaveBalance: 0.5,
    fiberCells: 36,
    fiberAmplitude: 0.12,
  }),
  "linen-canvas": structure({
    weaveWarpCells: 26,
    weaveWeftCells: 26,
    weaveAmplitude: 0.48,
    weaveBalance: 0.5,
    fiberCells: 48,
    fiberAmplitude: 0.1,
  }),
  // 장섬유 한지 계열 — 능선 + 교차 마디.
  washi: structure({
    fiberCells: 48,
    fiberAmplitude: 0.55,
    poreCells: 14,
    poreDensity: 0.2,
    poreAmplitude: 0.12,
  }),
  "rice-paper": structure({
    fiberCells: 56,
    fiberAmplitude: 0.5,
    poreCells: 22,
    poreDensity: 0.15,
    poreAmplitude: 0.1,
  }),
  mulberry: structure({
    fiberCells: 44,
    fiberAmplitude: 0.58,
    poreCells: 11,
    poreDensity: 0.38,
    poreAmplitude: 0.35,
  }),
  // 강 이빨 — 깊은 공극 / 사포 그릿.
  charcoal: structure({
    poreCells: 10,
    poreDensity: 0.55,
    poreAmplitude: 0.7,
    speckleCells: 28,
    speckleDensity: 0.4,
    speckleAmplitude: 0.18,
  }),
  "sanded-pastel": structure({
    speckleCells: 32,
    speckleDensity: 0.6,
    speckleAmplitude: 0.78,
    poreCells: 8,
    poreDensity: 0.3,
    poreAmplitude: 0.14,
  }),
  // 재생/톤 계열 — 플렉 반점.
  kraft: structure({
    speckleCells: 40,
    speckleDensity: 0.18,
    speckleAmplitude: 0.45,
    poreCells: 9,
    poreDensity: 0.3,
    poreAmplitude: 0.16,
  }),
  "toned-tan": structure({
    speckleCells: 38,
    speckleDensity: 0.22,
    speckleAmplitude: 0.3,
    poreCells: 24,
    poreDensity: 0.3,
    poreAmplitude: 0.14,
  }),
  "toned-gray": structure({
    speckleCells: 38,
    speckleDensity: 0.22,
    speckleAmplitude: 0.3,
    poreCells: 24,
    poreDensity: 0.3,
    poreAmplitude: 0.14,
  }),
});

/**
 * 전 프리셋 공통 tanh 대비 계수.
 *
 * 1단계가 `createPaperHeightField({ contrast: "shaped-v2" })`에서 쓴 것과 같은 1.1이다.
 * 높이를 스팬 표준화해 두어야 매체별 접촉 임계값(0..1 기준으로 보정된 값)이 매끈한 종이에서도
 * 동작한다. 종이별 거칠기는 여기가 아니라 선언 진폭 × toothGain 축으로 나간다.
 */
export const STUDIO_PAPER_SUBSTRATE_CONTRAST_V1 = 1.1;

export interface StudioPaperSubstrateRecipeOptionsV1 {
  /**
   * 문서 px 당 텍셀 배수. 1이면 프리셋의 선언 파장이 그대로 문서 px에 대응한다.
   * 아티스트가 종이를 확대/축소할 때 쓰는 축(문서 소유 `scale`).
   */
  readonly documentScale?: number;
  /** 종이 결 회전(라디안) — 초지기 발 방향 / 직조 축. */
  readonly rotationRadians?: number;
  /**
   * 이 값이 주어지면 정수 푸리에 토러스로 **이음매 없는 주기 필드**가 된다(타일 굽기용).
   * null/미지정이면 비주기 월드 필드다(반복 없음).
   */
  readonly seamlessPeriod?: number | null;
}

function clampRange(value: number, low: number, high: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return value < low ? low : value > high ? high : value;
}

/**
 * 종이 한 장 → 프로바이더 recipe 입력. 순수·결정적이다.
 *
 * `worldScale`은 항상 1로 두고 주파수 쪽에 `documentScale`을 곱한다 — recipe 좌표계를 문서 px과
 * 1:1로 유지해야 seamlessPeriod(문서 px 단위 타일 변)와 flow.gradientStep(문서 px)이 같은
 * 단위에서 읽힌다.
 */
export function studioPaperSubstrateRecipeInputV1(
  kind: PaperGrainKind,
  seed: number,
  options: StudioPaperSubstrateRecipeOptionsV1 = {},
): StudioProceduralMediaSurfaceRecipeInput {
  const preset = PAPER_TEXTURE_PRESETS[kind];
  const physics = PAPER_PHYSICS_PROFILES[kind];
  const micro = STUDIO_PAPER_SUBSTRATE_MICROSTRUCTURE_V1[kind];
  const documentScale = clampRange(options.documentScale ?? 1, 0.125, 8, 1);
  // 프리셋의 scaleMul(문서 px당 종이 텍셀 배수)이 여기서 한 번만 반영된다.
  const cellsToFrequency = (cells: number): number =>
    Math.max(
      0.000_001,
      (cells / PAPER_REFERENCE_TILE) * physics.scaleMul * documentScale,
    );
  const reliefFrequency = cellsToFrequency(preset.baseCells);
  // fibreAnisotropy > 1 = 결이 가로로 늘어난다 = 가로 방향 섬유 능선이 강해진다.
  const anisotropyGain = Math.max(0, preset.fibreAnisotropy - 1) * 0.32;
  const fiberAmplitude = clampRange(
    micro.fiberAmplitude + anisotropyGain,
    0,
    8,
    micro.fiberAmplitude,
  );
  const fiberFrequency = cellsToFrequency(
    micro.fiberCells > 0 ? micro.fiberCells : preset.baseCells * 2,
  );
  return Object.freeze({
    seed: seed >>> 0,
    worldScale: 1,
    rotationRadians: clampRange(
      options.rotationRadians ?? 0,
      -Math.PI * 2,
      Math.PI * 2,
      0,
    ),
    offset: Object.freeze([0, 0]) as readonly [number, number],
    contrast: STUDIO_PAPER_SUBSTRATE_CONTRAST_V1,
    seamlessPeriod:
      options.seamlessPeriod === undefined || options.seamlessPeriod === null
        ? null
        : (Object.freeze([
            clampRange(options.seamlessPeriod, 1, 100_000_000, 512),
            clampRange(options.seamlessPeriod, 1, 100_000_000, 512),
          ]) as readonly [number, number]),
    relief: Object.freeze({
      frequency: reliefFrequency,
      octaves: Math.max(1, Math.min(12, Math.round(preset.octaves))),
      lacunarity: clampRange(preset.lacunarity, 1, 4, 2),
      // toothBias > 1 이면 골이 넓어진다 → 고주파 비중을 낮춰 큰 골을 살린다.
      gain: clampRange(preset.persistence / Math.max(0.5, preset.toothBias), 0, 1, 0.5),
      amplitude: 1,
    }),
    fibers: Object.freeze({
      frequency: fiberFrequency,
      amplitude: fiberAmplitude,
      // 초지기 발 방향 = 가로. 회전은 recipe.rotationRadians가 전역으로 건다.
      directionRadians: 0,
      irregularity: clampRange(0.25 + physics.contactFriction * 0.6, 0, 4, 0.5),
    }),
    weave: Object.freeze({
      warpFrequency: cellsToFrequency(Math.max(micro.weaveWarpCells, 0.000_1)),
      weftFrequency: cellsToFrequency(Math.max(micro.weaveWeftCells, 0.000_1)),
      amplitude: clampRange(micro.weaveAmplitude, 0, 8, 0),
      balance: clampRange(micro.weaveBalance, 0, 1, 0.5),
    }),
    pores: Object.freeze({
      frequency: cellsToFrequency(Math.max(micro.poreCells, 0.000_1)),
      density: clampRange(micro.poreDensity, 0, 1, 0),
      amplitude: clampRange(micro.poreAmplitude, 0, 8, 0),
    }),
    speckles: Object.freeze({
      frequency: cellsToFrequency(Math.max(micro.speckleCells, 0.000_1)),
      density: clampRange(micro.speckleDensity, 0, 1, 0),
      amplitude: clampRange(micro.speckleAmplitude, 0, 8, 0),
    }),
    channels: Object.freeze({
      // 흡수 = 사이징의 역수. sizingGain이 클수록 잉크가 덜 스민다.
      absorbencyBase: clampRange(physics.absorbency, 0, 1, 0.5),
      // 골(-height)이 깊을수록 물이 고인다 — 수채 valley-settle 채널.
      reliefToAbsorbency: clampRange(physics.bleedBias * 0.45, -8, 8, 0.2),
      poreToAbsorbency: clampRange(physics.absorbency * 0.5, -8, 8, 0.25),
      speckleToAbsorbency: clampRange(-physics.sizingGain * 0.12, -8, 8, -0.1),
      // 건식 접촉 계수 — 이빨이 얼마나 무는가.
      grainBase: clampRange(0.22 + physics.contactFriction * 0.3, 0, 1, 0.3),
      reliefToGrain: clampRange(physics.toothGain * 0.5, -8, 8, 0.5),
      fiberToGrain: clampRange(micro.fiberAmplitude * 0.6, -8, 8, 0),
      weaveToGrain: clampRange(micro.weaveAmplitude * 0.5, -8, 8, 0),
      speckleToGrain: clampRange(micro.speckleAmplitude * 0.55, -8, 8, 0),
    }),
    flow: Object.freeze({
      // 문서 px 단위 중앙차분 폭. 결의 최고주파 파장보다 작아야 기울기가 살아난다.
      gradientStep: clampRange(
        0.5 / Math.max(reliefFrequency, 0.001) * 0.25,
        0.03125,
        1_024,
        1,
      ),
      downhillWeight: clampRange(0.35 + physics.absorbency * 0.5, 0, 8, 0.6),
      tangentWeight: clampRange(physics.bleedBias * 0.4, -8, 8, 0.2),
      gravity: Object.freeze([0, 0]) as readonly [number, number],
      wind: Object.freeze([0, 0]) as readonly [number, number],
    }),
  }) as StudioProceduralMediaSurfaceRecipeInput;
}

/**
 * 종이 한 장 → 검증·지문화된 recipe. 입력이 계약을 어기면 null(호출자가 열화 경로를 고른다).
 */
export function createStudioPaperSubstrateRecipeV1(
  kind: PaperGrainKind,
  seed: number,
  options: StudioPaperSubstrateRecipeOptionsV1 = {},
): StudioProceduralMediaSurfaceRecipe | null {
  const result = createStudioProceduralMediaSurfaceRecipe(
    studioPaperSubstrateRecipeInputV1(kind, seed, options),
  );
  return result.status === "ready" ? result.recipe : null;
}
