/**
 * Built-in time-of-day and atmosphere rigs for the engine-neutral Studio 3D scene document.
 *
 * A rig links only the existing background, lighting, and render fields. It is not persisted as a
 * new document concept: applying one produces a normal canonical SceneDocument, so exports and
 * every renderer adapter continue to consume the same versioned contract.
 */

import {
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

import type {
  StudioBg3dBackgroundSettings,
  StudioBg3dLightingSettings,
  StudioBg3dRenderSettings,
  StudioBg3dSceneDocument,
  StudioBg3dVec3,
} from "./studio-bg3d-scene-document";

export const STUDIO_BG3D_MOOD_RIG_IDS = [
  "clear-day",
  "golden-hour",
  "blue-night",
  "soft-mist",
  "dramatic-night",
] as const;

export type StudioBg3dMoodRigId = (typeof STUDIO_BG3D_MOOD_RIG_IDS)[number];

type StudioBg3dMoodBackgroundRig = Pick<
  StudioBg3dBackgroundSettings,
  | "color"
  | "skyPresetId"
  | "panoramaRotation"
  | "fogEnabled"
  | "fogColor"
  | "fogNear"
  | "fogFar"
>;

type StudioBg3dMoodRenderRig = Pick<
  StudioBg3dRenderSettings,
  "exposure" | "toneMapping"
>;

export interface StudioBg3dMoodRig {
  readonly id: StudioBg3dMoodRigId;
  readonly label: string;
  readonly description: string;
  readonly swatch: string;
  readonly background: StudioBg3dMoodBackgroundRig;
  readonly lighting: StudioBg3dLightingSettings;
  readonly render: StudioBg3dMoodRenderRig;
}

function unitDirection(x: number, y: number, z: number): StudioBg3dVec3 {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

export const STUDIO_BG3D_MOOD_RIGS: readonly StudioBg3dMoodRig[] = deepFreeze([
  {
    id: "clear-day",
    label: "맑은 낮",
    description: "선명한 주광과 옅은 청색 보조광으로 건물과 소품의 형태를 또렷하게 보여줍니다.",
    swatch: "#bfe3f5",
    background: {
      color: "#bfe3f5",
      skyPresetId: "clear_day",
      panoramaRotation: 0,
      fogEnabled: false,
      fogColor: "#dcecf4",
      fogNear: 18,
      fogFar: 80,
    },
    lighting: {
      ambientColor: "#dbeeff",
      ambientIntensity: 0.8,
      key: {
        color: "#fff4dc",
        direction: unitDirection(4, 6, 3),
        intensity: 1.35,
        castsShadow: true,
      },
      fill: {
        color: "#c8def8",
        direction: unitDirection(-4, 3, -3),
        intensity: 0.45,
        castsShadow: false,
      },
    },
    render: { exposure: 1, toneMapping: "neutral" },
  },
  {
    id: "golden-hour",
    label: "골든아워",
    description: "낮은 주황빛 키라이트와 보랏빛 필라이트, 옅은 대기 원근을 함께 적용합니다.",
    swatch: "#f2b183",
    background: {
      color: "#f2b183",
      skyPresetId: "sunset",
      panoramaRotation: 24,
      fogEnabled: true,
      fogColor: "#e9aa83",
      fogNear: 15,
      fogFar: 70,
    },
    lighting: {
      ambientColor: "#ffd9c4",
      ambientIntensity: 0.55,
      key: {
        color: "#ffb56b",
        direction: unitDirection(5, 2, 2),
        intensity: 1.6,
        castsShadow: true,
      },
      fill: {
        color: "#8f9acb",
        direction: unitDirection(-4, 3, -3),
        intensity: 0.3,
        castsShadow: false,
      },
    },
    render: { exposure: 1.05, toneMapping: "aces" },
  },
  {
    id: "blue-night",
    label: "푸른 밤",
    description: "달빛 중심의 차가운 저조도 조명과 먼 거리 안개로 야간 배경을 빠르게 구성합니다.",
    swatch: "#33496f",
    background: {
      color: "#1c2436",
      skyPresetId: "night",
      panoramaRotation: -28,
      fogEnabled: true,
      fogColor: "#28344f",
      fogNear: 14,
      fogFar: 70,
    },
    lighting: {
      ambientColor: "#7893c9",
      ambientIntensity: 0.25,
      key: {
        color: "#c7d8ff",
        direction: unitDirection(-4, 6, 2),
        intensity: 0.75,
        castsShadow: true,
      },
      fill: {
        color: "#4c5b93",
        direction: unitDirection(4, 2, -3),
        intensity: 0.15,
        castsShadow: false,
      },
    },
    render: { exposure: 0.85, toneMapping: "aces" },
  },
  {
    id: "soft-mist",
    label: "옅은 안개",
    description: "그림자를 부드럽게 열고 가까운 거리부터 안개를 섞어 차분한 공간감을 만듭니다.",
    swatch: "#d8e2e5",
    background: {
      color: "#d8e2e5",
      skyPresetId: "clear_day",
      panoramaRotation: 0,
      fogEnabled: true,
      fogColor: "#d8e2e5",
      fogNear: 2,
      fogFar: 22,
    },
    lighting: {
      ambientColor: "#d9e2e5",
      ambientIntensity: 0.9,
      key: {
        color: "#f4f6f3",
        direction: unitDirection(3, 6, 4),
        intensity: 0.65,
        castsShadow: true,
      },
      fill: {
        color: "#b7c5ca",
        direction: unitDirection(-4, 3, -2),
        intensity: 0.5,
        castsShadow: false,
      },
    },
    render: { exposure: 0.95, toneMapping: "neutral" },
  },
  {
    id: "dramatic-night",
    label: "극적 야경",
    description: "강한 측면 달빛과 최소 필라이트로 스릴러·액션 컷에 어울리는 대비를 만듭니다.",
    swatch: "#182037",
    background: {
      color: "#1c2436",
      skyPresetId: "night",
      panoramaRotation: 52,
      fogEnabled: true,
      fogColor: "#202a42",
      fogNear: 8,
      fogFar: 40,
    },
    lighting: {
      ambientColor: "#40527d",
      ambientIntensity: 0.12,
      key: {
        color: "#d8e4ff",
        direction: unitDirection(6, 4, -2),
        intensity: 1.45,
        castsShadow: true,
      },
      fill: {
        color: "#5e6b9d",
        direction: unitDirection(-5, 2, 3),
        intensity: 0.06,
        castsShadow: false,
      },
    },
    render: { exposure: 0.72, toneMapping: "aces" },
  },
] satisfies StudioBg3dMoodRig[]);

const MOOD_RIG_BY_ID = new Map(
  STUDIO_BG3D_MOOD_RIGS.map((preset) => [preset.id, preset] as const),
);

export function getStudioBg3dMoodRig(id: unknown): StudioBg3dMoodRig | null {
  return typeof id === "string" ? MOOD_RIG_BY_ID.get(id as StudioBg3dMoodRigId) ?? null : null;
}

function moodRigState(scene: StudioBg3dSceneDocument): Omit<StudioBg3dMoodRig, "id" | "label" | "description" | "swatch"> {
  return {
    background: {
      color: scene.background.color,
      skyPresetId: scene.background.skyPresetId,
      panoramaRotation: scene.background.panoramaRotation,
      fogEnabled: scene.background.fogEnabled,
      fogColor: scene.background.fogColor,
      fogNear: scene.background.fogNear,
      fogFar: scene.background.fogFar,
    },
    lighting: scene.lighting,
    render: {
      exposure: scene.render.exposure,
      toneMapping: scene.render.toneMapping,
    },
  };
}

/** Returns the exact linked rig currently represented by the scene, or null after any manual edit. */
export function resolveStudioBg3dAppliedMoodRig(
  scene: StudioBg3dSceneDocument,
): StudioBg3dMoodRig | null {
  const current = JSON.stringify(moodRigState(scene));
  return STUDIO_BG3D_MOOD_RIGS.find((preset) => JSON.stringify({
    background: preset.background,
    lighting: preset.lighting,
    render: preset.render,
  }) === current) ?? null;
}

/**
 * Applies one linked rig as a single canonical document transition. Camera, output/LT, quality,
 * budgets, attachments, and nodes are retained. Existing transparent-output intent is also kept;
 * an explicit mood change must never make a cutout export opaque.
 */
export function applyStudioBg3dMoodRig(
  scene: StudioBg3dSceneDocument,
  rigOrId: StudioBg3dMoodRig | StudioBg3dMoodRigId | string,
): StudioBg3dSceneDocument | null {
  const serializedScene = serializeStudioBg3dSceneDocument(scene);
  if (!serializedScene) return null;
  const canonicalScene = parseStudioBg3dSceneDocument(serializedScene);
  if (!canonicalScene) return null;

  const rig = typeof rigOrId === "string"
    ? getStudioBg3dMoodRig(rigOrId)
    : getStudioBg3dMoodRig(rigOrId.id);
  if (!rig) return null;

  const transparent =
    canonicalScene.output.transparentBackground || canonicalScene.background.mode === "transparent";
  const candidate: StudioBg3dSceneDocument = {
    ...canonicalScene,
    render: { ...canonicalScene.render, ...rig.render },
    background: {
      ...canonicalScene.background,
      ...rig.background,
      mode: transparent ? "transparent" : "sky-preset",
    },
    lighting: rig.lighting,
  };
  const serializedCandidate = serializeStudioBg3dSceneDocument(candidate);
  return serializedCandidate ? parseStudioBg3dSceneDocument(serializedCandidate) : null;
}
