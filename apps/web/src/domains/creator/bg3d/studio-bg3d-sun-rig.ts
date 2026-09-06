// 태양/시간대 파라메트릭 라이팅 릭 — Blender의 Sun 라이트 + SketchUp 그림자 스터디를 웹툰
// 배경용으로 옮긴 것. 시간대(0–24h) 슬라이더와 방위각에서 태양 방향·색온도·강도를 결정적으로
// 계산해 기존 lighting/background/render 필드에만 쓴다.
//
// 무드 리그(studio-bg3d-mood-rigs.ts)와의 관계: 무드 리그는 손으로 고른 5개 고정 프리셋이고,
// 이 모듈은 연속 파라미터에서 절차 계산한다. 두 기능 모두 "새 문서 개념 없이 canonical
// SceneDocument 전이 하나"라는 같은 계약을 따른다 — 내보내기·렌더러 어댑터 무변경.
//
// 그림자 계약: config.shadowsEnabled는 lighting.key.castsShadow에만 기록된다. 실제 그림자
// 렌더 여부는 뷰포트가 `deviceQuality.shadows && key.castsShadow`로 결정하므로(기존 코드),
// 저사양 기기 거버너가 끄면 이 릭이 켜 달라고 해도 렌더되지 않는다 — 릭은 의도만 저장한다.

import {
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

import type {
  StudioBg3dLightingSettings,
  StudioBg3dSceneDocument,
  StudioBg3dSkyPresetId,
  StudioBg3dVec3,
} from "./studio-bg3d-scene-document";

export interface StudioBg3dSunRigConfig {
  /** 하루 중 시각(0–24, 소수 허용). 6시 일출·18시 일몰 고정 모델. */
  readonly timeOfDayHours: number;
  /** 태양 방위각(도). 0 = +Z(카메라 기본 정면 반대편), 시계 방향. */
  readonly azimuthDeg: number;
  /** 키 라이트 그림자 의도. 기기 거버너가 우선한다(§상단 주석). */
  readonly shadowsEnabled: boolean;
}

export const DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG: StudioBg3dSunRigConfig = Object.freeze({
  timeOfDayHours: 12,
  azimuthDeg: 35,
  shadowsEnabled: true,
});

export const STUDIO_BG3D_SUNRISE_HOUR = 6;
export const STUDIO_BG3D_SUNSET_HOUR = 18;
/** 정오 최대 고도(도) — 한국 위도권 여름 낮 태양의 근사값. */
export const STUDIO_BG3D_SUN_MAX_ELEVATION_DEG = 66;
/** 이 고도(도) 아래로 내려가면 태양 대신 달빛 모드로 전환한다. */
export const STUDIO_BG3D_SUN_TWILIGHT_ELEVATION_DEG = 4;

export interface StudioBg3dSunTimePreset {
  readonly id: string;
  readonly label: string;
  readonly timeOfDayHours: number;
}

export const STUDIO_BG3D_SUN_TIME_PRESETS: readonly StudioBg3dSunTimePreset[] = Object.freeze([
  { id: "dawn", label: "새벽", timeOfDayHours: 6.3 },
  { id: "morning", label: "아침", timeOfDayHours: 9 },
  { id: "forenoon", label: "오전", timeOfDayHours: 10.5 },
  { id: "noon", label: "정오", timeOfDayHours: 12 },
  { id: "afternoon", label: "오후", timeOfDayHours: 15.5 },
  { id: "sunset", label: "석양", timeOfDayHours: 17.6 },
  { id: "dusk", label: "황혼", timeOfDayHours: 19.5 },
  { id: "night", label: "밤", timeOfDayHours: 22 },
  { id: "midnight", label: "자정", timeOfDayHours: 0 },
]);

function wrapHours(hours: number): number {
  if (!Number.isFinite(hours)) return 12;
  const wrapped = hours % 24;
  return wrapped < 0 ? wrapped + 24 : wrapped;
}

/**
 * 시각 → 기하학적 태양 고도(도). 6–18시 사이는 사인 궤적으로 0→최대→0, 밤에는 같은 사인의
 * 음수 연장(지평선 아래). 결정적 순수 함수 — 위도/절기 파라미터는 의도적으로 넣지 않았다
 * (웹툰 배경 연출 도구이지 일사량 시뮬레이터가 아니므로 조작 축을 시각 하나로 유지).
 */
export function computeStudioBg3dSunElevationDeg(timeOfDayHours: number): number {
  const hours = wrapHours(timeOfDayHours);
  const dayPhase = (hours - STUDIO_BG3D_SUNRISE_HOUR) / (STUDIO_BG3D_SUNSET_HOUR - STUDIO_BG3D_SUNRISE_HOUR);
  return STUDIO_BG3D_SUN_MAX_ELEVATION_DEG * Math.sin(Math.PI * dayPhase);
}

/** 고도·방위각 → "피사체에서 광원을 향하는" 단위 벡터(문서의 direction 계약과 동일). */
export function computeStudioBg3dSunDirection(elevationDeg: number, azimuthDeg: number): StudioBg3dVec3 {
  const elevation = (elevationDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return [
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation),
    Math.cos(azimuth) * horizontal,
  ];
}

/**
 * 색온도(K) → sRGB hex. Tanner Helland 근사식의 결정적 구현 — 흑체 복사의 시각적 근사로
 * 충분하고(연출용), 외부 테이블·난수 없이 항상 같은 입력에 같은 hex를 돌려준다.
 */
export function studioBg3dKelvinToHexColor(kelvin: number): string {
  const clamped = Math.min(12_000, Math.max(1_000, Number.isFinite(kelvin) ? kelvin : 6_500));
  const t = clamped / 100;
  let red: number;
  let green: number;
  let blue: number;
  if (t <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(t) - 161.1195681661;
    blue = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * ((t - 60) ** -0.1332047592);
    green = 288.1221695283 * ((t - 60) ** -0.0755148492);
    blue = 255;
  }
  const toHex = (value: number) => {
    const bounded = Math.round(Math.min(255, Math.max(0, value)));
    return bounded.toString(16).padStart(2, "0");
  };
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

/** 태양 고도(도) → 색온도(K). 낮은 해가 붉게(2200K대), 정오가 주광색(5900K대)이 되는 램프. */
export function computeStudioBg3dSunColorTemperatureK(elevationDeg: number): number {
  const elevation = Math.max(0, Math.min(90, elevationDeg));
  if (elevation <= 15) return 2_200 + (elevation / 15) * (4_300 - 2_200);
  if (elevation <= 40) return 4_300 + ((elevation - 15) / 25) * (5_600 - 4_300);
  return 5_600 + ((elevation - 40) / 50) * (6_000 - 5_600);
}

export interface StudioBg3dSunLightState {
  readonly mode: "sun" | "moon";
  /** 실제 광원 배치에 쓰는 고도(도) — 달빛 모드에서는 달 궤적 값. */
  readonly lightElevationDeg: number;
  /** 기하학적 태양 고도(도) — 지평선 아래면 음수. */
  readonly sunElevationDeg: number;
  readonly colorTemperatureK: number;
  readonly keyIntensity: number;
  readonly skyPresetId: StudioBg3dSkyPresetId;
}

/** 시각 하나에서 낮/밤 모드·고도·색온도·강도·하늘 프리셋을 함께 결정한다. */
export function resolveStudioBg3dSunLightState(timeOfDayHours: number): StudioBg3dSunLightState {
  const hours = wrapHours(timeOfDayHours);
  const sunElevationDeg = computeStudioBg3dSunElevationDeg(hours);
  if (sunElevationDeg >= STUDIO_BG3D_SUN_TWILIGHT_ELEVATION_DEG) {
    const elevationRatio = sunElevationDeg / STUDIO_BG3D_SUN_MAX_ELEVATION_DEG;
    return {
      mode: "sun",
      lightElevationDeg: sunElevationDeg,
      sunElevationDeg,
      colorTemperatureK: computeStudioBg3dSunColorTemperatureK(sunElevationDeg),
      keyIntensity: 0.9 + 0.6 * elevationRatio,
      skyPresetId: sunElevationDeg >= 25 ? "clear_day" : "sunset",
    };
  }
  // 달빛 모드 — 18시 이후를 0으로 하는 야간 위상으로 달 고도를 계산한다(자정 부근 최고).
  const nightPhase = wrapHours(hours - STUDIO_BG3D_SUNSET_HOUR) / 12;
  const moonElevationDeg = 18 + 30 * Math.sin(Math.PI * Math.min(1, Math.max(0, nightPhase)));
  return {
    mode: "moon",
    lightElevationDeg: moonElevationDeg,
    sunElevationDeg,
    colorTemperatureK: 7_800,
    keyIntensity: 0.65,
    skyPresetId: "night",
  };
}

/** 릭 전체가 결정하는 조명 값(문서 lighting 섹션과 동형). */
export function computeStudioBg3dSunLighting(config: StudioBg3dSunRigConfig): StudioBg3dLightingSettings {
  const state = resolveStudioBg3dSunLightState(config.timeOfDayHours);
  const keyDirection = computeStudioBg3dSunDirection(state.lightElevationDeg, config.azimuthDeg);
  // 필 라이트는 반대 방위 30° 고도의 차가운 하늘 반사광 — 실무 3점 조명의 최소형.
  const fillDirection = computeStudioBg3dSunDirection(30, config.azimuthDeg + 180);
  const elevationRatio = Math.max(0, state.sunElevationDeg) / STUDIO_BG3D_SUN_MAX_ELEVATION_DEG;
  return {
    ambientColor: state.mode === "sun" ? "#dbe8f4" : "#7c8fc0",
    ambientIntensity: state.mode === "sun"
      ? Math.round((0.45 + 0.4 * elevationRatio) * 100) / 100
      : 0.22,
    key: {
      color: studioBg3dKelvinToHexColor(state.colorTemperatureK),
      direction: keyDirection,
      intensity: Math.round(state.keyIntensity * 100) / 100,
      castsShadow: config.shadowsEnabled,
    },
    fill: {
      color: state.mode === "sun" ? "#c3d4ee" : "#46538a",
      direction: fillDirection,
      intensity: state.mode === "sun" ? 0.35 : 0.12,
      castsShadow: false,
    },
  };
}

/**
 * 릭을 canonical 문서 전이 하나로 적용한다(무드 리그와 동일 계약). 카메라·출력/LT·품질·예산·
 * 첨부·노드는 그대로 두고, 투명 배경 의도도 보존한다 — 시간대 변경이 컷아웃 내보내기를
 * 불투명하게 만들면 안 된다.
 */
export function applyStudioBg3dSunRig(
  scene: StudioBg3dSceneDocument,
  config: StudioBg3dSunRigConfig,
): StudioBg3dSceneDocument | null {
  const serializedScene = serializeStudioBg3dSceneDocument(scene);
  if (!serializedScene) return null;
  const canonicalScene = parseStudioBg3dSceneDocument(serializedScene);
  if (!canonicalScene) return null;

  const safeConfig: StudioBg3dSunRigConfig = {
    timeOfDayHours: wrapHours(config.timeOfDayHours),
    azimuthDeg: Number.isFinite(config.azimuthDeg)
      ? Math.min(360, Math.max(-360, config.azimuthDeg))
      : DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG.azimuthDeg,
    shadowsEnabled: config.shadowsEnabled === true,
  };
  const state = resolveStudioBg3dSunLightState(safeConfig.timeOfDayHours);
  const transparent =
    canonicalScene.output.transparentBackground || canonicalScene.background.mode === "transparent";
  const candidate: StudioBg3dSceneDocument = {
    ...canonicalScene,
    lighting: computeStudioBg3dSunLighting(safeConfig),
    background: {
      ...canonicalScene.background,
      skyPresetId: state.skyPresetId,
      mode: transparent ? "transparent" : "sky-preset",
    },
    render: {
      ...canonicalScene.render,
      exposure: state.mode === "sun" ? 1 : 0.85,
    },
  };
  const serializedCandidate = serializeStudioBg3dSceneDocument(candidate);
  return serializedCandidate ? parseStudioBg3dSceneDocument(serializedCandidate) : null;
}
