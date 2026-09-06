import { studioBg3dLightAnglesToDirection } from "./studio-bg3d-light-direction";

import type {
  StudioBg3dDirectionalLightSettings,
  StudioBg3dLightingSettings,
} from "./studio-bg3d-scene-document";

const VALUE_EPSILON = 1e-4;

export interface StudioBg3dLightingStudioPreset {
  readonly id:
    | "balanced"
    | "portrait-soft"
    | "action-rim"
    | "lineart-flat"
    | "cinematic-3point"
    | "sunset-golden"
    | "cyberpunk-neon"
    | "midnight-noir";
  readonly label: string;
  readonly description: string;
  readonly lighting: StudioBg3dLightingSettings;
  readonly exposure: number;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export const STUDIO_BG3D_LIGHTING_STUDIO_PRESETS:
readonly StudioBg3dLightingStudioPreset[] = deepFreeze([
  {
    id: "cinematic-3point",
    label: "시네마틱 3점",
    description: "따뜻한 키와 차가운 필, 낮은 환경광으로 인물 실루엣을 또렷하게 분리",
    exposure: 1.12,
    lighting: {
      ambientColor: "#222a36",
      ambientIntensity: 0.42,
      key: {
        color: "#ffdfa0",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 45,
          elevationDeg: 45,
        }),
        intensity: 1.65,
        castsShadow: true,
      },
      fill: {
        color: "#60a5fa",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -135,
          elevationDeg: 25,
        }),
        intensity: 0.45,
        castsShadow: false,
      },
    },
  },
  {
    id: "balanced",
    label: "균형 3점",
    description: "형태와 재질을 고르게 읽는 웹툰 제작 기본광",
    exposure: 1,
    lighting: {
      ambientColor: "#dbe5f0",
      ambientIntensity: 0.58,
      key: {
        color: "#fff0d2",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 38,
          elevationDeg: 48,
        }),
        intensity: 1.25,
        castsShadow: true,
      },
      fill: {
        color: "#b9cfee",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -132,
          elevationDeg: 28,
        }),
        intensity: 0.38,
        castsShadow: false,
      },
    },
  },
  {
    id: "portrait-soft",
    label: "인물 소프트",
    description: "얼굴 명암을 열고 피부와 의상 색을 부드럽게 유지",
    exposure: 1.05,
    lighting: {
      ambientColor: "#eee4df",
      ambientIntensity: 0.82,
      key: {
        color: "#ffe8d1",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -32,
          elevationDeg: 56,
        }),
        intensity: 0.92,
        castsShadow: true,
      },
      fill: {
        color: "#d2e3ff",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 118,
          elevationDeg: 34,
        }),
        intensity: 0.56,
        castsShadow: false,
      },
    },
  },
  {
    id: "action-rim",
    label: "액션 림",
    description: "강한 측후면 키와 절제된 필로 실루엣을 분리",
    exposure: 0.9,
    lighting: {
      ambientColor: "#53627b",
      ambientIntensity: 0.2,
      key: {
        color: "#ffd0a4",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 122,
          elevationDeg: 30,
        }),
        intensity: 1.82,
        castsShadow: true,
      },
      fill: {
        color: "#7898d8",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -68,
          elevationDeg: 18,
        }),
        intensity: 0.16,
        castsShadow: false,
      },
    },
  },
  {
    id: "lineart-flat",
    label: "선화 균일",
    description: "LT·선화 추출 전 면의 과한 명암을 줄이는 평탄광",
    exposure: 1.08,
    lighting: {
      ambientColor: "#e7e7e2",
      ambientIntensity: 1.04,
      key: {
        color: "#fff4df",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 24,
          elevationDeg: 68,
        }),
        intensity: 0.58,
        castsShadow: false,
      },
      fill: {
        color: "#dfe8f2",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -156,
          elevationDeg: 52,
        }),
        intensity: 0.46,
        castsShadow: false,
      },
    },
  },
  {
    id: "sunset-golden",
    label: "황혼 노을",
    description: "따뜻한 골든아워 주광과 짙은 보랏빛 역광으로 서정적인 석양 연출",
    exposure: 1.15,
    lighting: {
      ambientColor: "#451a2d",
      ambientIntensity: 0.45,
      key: {
        color: "#ff8c38",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -70,
          elevationDeg: 22,
        }),
        intensity: 1.95,
        castsShadow: true,
      },
      fill: {
        color: "#c084fc",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 110,
          elevationDeg: 35,
        }),
        intensity: 0.52,
        castsShadow: false,
      },
    },
  },
  {
    id: "cyberpunk-neon",
    label: "사이버펑크 네온",
    description: "시안 메인광과 마젠타 림라이트의 강렬한 네온 무드",
    exposure: 1.2,
    lighting: {
      ambientColor: "#090d16",
      ambientIntensity: 0.32,
      key: {
        color: "#06b6d4",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 55,
          elevationDeg: 38,
        }),
        intensity: 1.75,
        castsShadow: true,
      },
      fill: {
        color: "#f43f5e",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -125,
          elevationDeg: 42,
        }),
        intensity: 0.88,
        castsShadow: true,
      },
    },
  },
  {
    id: "midnight-noir",
    label: "심야 느와르",
    description: "차가운 달빛과 짙은 명암 대비로 긴장감 있는 밤 씬 연출",
    exposure: 0.88,
    lighting: {
      ambientColor: "#0b1220",
      ambientIntensity: 0.22,
      key: {
        color: "#bfdbfe",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: 135,
          elevationDeg: 62,
        }),
        intensity: 1.45,
        castsShadow: true,
      },
      fill: {
        color: "#1e3a8a",
        direction: studioBg3dLightAnglesToDirection({
          azimuthDeg: -45,
          elevationDeg: 20,
        }),
        intensity: 0.28,
        castsShadow: false,
      },
    },
  },
] satisfies StudioBg3dLightingStudioPreset[]);

function valuesMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= VALUE_EPSILON;
}

function directionsMatch(
  left: StudioBg3dDirectionalLightSettings["direction"],
  right: StudioBg3dDirectionalLightSettings["direction"],
): boolean {
  return left.every((value, index) => valuesMatch(value, right[index] ?? Number.NaN));
}

function directionalLightsMatch(
  left: StudioBg3dDirectionalLightSettings,
  right: StudioBg3dDirectionalLightSettings,
): boolean {
  return left.color.toLowerCase() === right.color.toLowerCase()
    && valuesMatch(left.intensity, right.intensity)
    && left.castsShadow === right.castsShadow
    && directionsMatch(left.direction, right.direction);
}

export function resolveStudioBg3dLightingStudioPreset(
  lighting: StudioBg3dLightingSettings,
  exposure: number,
): StudioBg3dLightingStudioPreset | null {
  return STUDIO_BG3D_LIGHTING_STUDIO_PRESETS.find((preset) =>
    preset.lighting.ambientColor.toLowerCase() === lighting.ambientColor.toLowerCase()
      && valuesMatch(preset.lighting.ambientIntensity, lighting.ambientIntensity)
      && directionalLightsMatch(preset.lighting.key, lighting.key)
      && directionalLightsMatch(preset.lighting.fill, lighting.fill)
      && valuesMatch(preset.exposure, exposure)
  ) ?? null;
}
