/**
 * Studio 3D Feature Pack: Mannequin Head Replace/Hide, Camera Light, Height Fog, Batch Textures
 *
 * CLIP STUDIO PAINT Ver.5.0.0 & Ver.5.1.0 Parity:
 * 1. 3D Mannequin Head Replacement & Hide (3D 데생 인형 머리 교체·숨김):
 *    - Styles: "default", "anime" (faceted stylized anime jaw/chin), "chibi" (cute rounded),
 *      "featureless" (clean smooth egg), "hidden" (hides head primitives for custom facial lineart).
 * 2. Camera-Following Directional Light (카메라 방향을 따르는 조명):
 *    - Automatically aligns the key light direction to track the camera's viewing angle,
 *      eliminating harsh unreadable shadows on character models during camera rotation.
 * 3. Exponential Height Fog (높이 기반 안개):
 *    - Height-attenuated atmospheric ground fog: denser at floor level, dissipating with height.
 * 4. 3D Model Texture Batch Exporter (사용자 3D 모델 텍스처 일괄 출력):
 *    - Collects and packages all material maps (Base Color, Normal, Roughness, Metallic, Emissive).
 *
 * Pure, deterministic, zero-dependency.
 */

import type {
  StudioMannequinPrimitiveSpec,
  StudioMannequinSpec,
} from "./studio-mannequin-model";

// ── 1. 3D 데생 인형 머리 교체 및 숨김 ──────────────────────────────────────────

export type StudioMannequinHeadStyle =
  | "default"
  | "anime"
  | "chibi"
  | "featureless"
  | "hidden";

export const STUDIO_MANNEQUIN_HEAD_STYLES: readonly {
  readonly id: StudioMannequinHeadStyle;
  readonly label: string;
  readonly description: string;
}[] = Object.freeze([
  { id: "default", label: "표준 마네킹", description: "기본 해부학 가이드 구와 이목구비 방향 가이드" },
  { id: "anime", label: "애니메 턱선", description: "날렵한 턱선과 각진 볼 라인의 웹툰 스타일" },
  { id: "chibi", label: "SD 꼬마형", description: "둥글고 볼륨감 있는 데포르메 구체" },
  { id: "featureless", label: "가이드 없음", description: "눈·코 가이드가 없는 매끄러운 타원형 두개골" },
  { id: "hidden", label: "머리 숨김", description: "목 윗부분을 숨겨 직접 얼굴과 헤어를 작화" },
]);

/**
 * Transforms a parametric mannequin spec to apply the desired head style.
 */
export function applyStudioMannequinHeadStyle(
  spec: StudioMannequinSpec,
  style: StudioMannequinHeadStyle,
): StudioMannequinSpec {
  if (style === "default") return spec;

  const hu = spec.headUnit;
  const headLen = hu;

  // Filter out existing head primitives
  const nonHeadPrimitives = spec.primitives.filter((p) => p.jointId !== "head");

  if (style === "hidden") {
    return Object.freeze({
      ...spec,
      primitives: Object.freeze(nonHeadPrimitives),
    });
  }

  const customHeadPrimitives: StudioMannequinPrimitiveSpec[] = [];

  if (style === "featureless") {
    // Single smooth cranial ellipsoid without ear/nose guide
    customHeadPrimitives.push({
      kind: "sphere",
      jointId: "head",
      center: [0, headLen * 0.5, 0],
      radius: headLen * 0.5,
      scale: [0.78, 1, 0.85],
    });
  } else if (style === "chibi") {
    // Oversized round cute sphere
    customHeadPrimitives.push({
      kind: "sphere",
      jointId: "head",
      center: [0, headLen * 0.52, 0.02 * hu],
      radius: headLen * 0.56,
      scale: [0.92, 0.95, 0.92],
    });
  } else if (style === "anime") {
    // Main skull
    customHeadPrimitives.push({
      kind: "sphere",
      jointId: "head",
      center: [0, headLen * 0.56, -0.02 * hu],
      radius: headLen * 0.46,
      scale: [0.76, 0.88, 0.82],
    });
    // Tapered jaw/chin block
    customHeadPrimitives.push({
      kind: "capsule",
      jointId: "head",
      from: [0, headLen * 0.4, 0.05 * hu],
      to: [0, headLen * 0.08, 0.12 * hu],
      radius: 0.18 * hu,
    });
    // Nose ridge indicator
    customHeadPrimitives.push({
      kind: "sphere",
      jointId: "head",
      center: [0, headLen * 0.48, headLen * 0.46],
      radius: 0.045 * hu,
      scale: [0.4, 0.8, 1.2],
    });
  }

  return Object.freeze({
    ...spec,
    primitives: Object.freeze([...nonHeadPrimitives, ...customHeadPrimitives]),
  });
}

// ── 2. 카메라 방향을 따르는 조명 ──────────────────────────────────────────

export interface CameraLightOffset {
  /** Azimuth offset in degrees relative to camera view (-90..+90). Default: 25 */
  readonly azimuthDeg?: number;
  /** Elevation offset in degrees relative to camera view (10..80). Default: 35 */
  readonly elevationDeg?: number;
}

/**
 * Computes directional light direction vector that dynamically follows camera angle.
 * Returns a unit vector pointing from subject toward the light source.
 */
export function computeCameraFollowingLightDirection(
  cameraPos: readonly [number, number, number],
  targetPos: readonly [number, number, number],
  offset: CameraLightOffset = {},
): readonly [number, number, number] {
  // Vector from target to camera (view direction)
  const vx = cameraPos[0] - targetPos[0];
  const vy = cameraPos[1] - targetPos[1];
  const vz = cameraPos[2] - targetPos[2];

  // Base camera angles
  const baseAzimuth = Math.atan2(vx, vz); // radians in XZ plane
  const horizontalDist = Math.hypot(vx, vz) || 1;
  const baseElevation = Math.atan2(vy, horizontalDist);

  // Apply artist offsets (lighting slightly above and to the key side)
  const offsetAz = ((offset.azimuthDeg ?? 25) * Math.PI) / 180;
  const offsetEl = ((offset.elevationDeg ?? 35) * Math.PI) / 180;

  const finalAz = baseAzimuth + offsetAz;
  const finalEl = Math.max(0.1, Math.min(Math.PI * 0.48, baseElevation + offsetEl));

  const lx = Math.cos(finalEl) * Math.sin(finalAz);
  const ly = Math.sin(finalEl);
  const lz = Math.cos(finalEl) * Math.cos(finalAz);

  const len = Math.hypot(lx, ly, lz) || 1;
  return Object.freeze([
    Math.round((lx / len) * 10000) / 10000,
    Math.round((ly / len) * 10000) / 10000,
    Math.round((lz / len) * 10000) / 10000,
  ]);
}

// ── 3. 높이 기반 안개 (Exponential Height Fog) ─────────────────────────────

export interface HeightFogParams {
  readonly enabled: boolean;
  readonly colorHex: string;
  readonly density: number; // 0..1
  readonly baseHeight: number; // floor reference Y in world units
  readonly heightFalloff: number; // rate at which fog thins out with height (0.01..2.0)
  readonly near: number;
  readonly far: number;
}

export const DEFAULT_HEIGHT_FOG_PARAMS: HeightFogParams = Object.freeze({
  enabled: true,
  colorHex: "#e2e8f0",
  density: 0.08,
  baseHeight: 0,
  heightFalloff: 0.25,
  near: 1,
  far: 80,
});

/**
 * Calculates exponential height fog extinction factor for a pixel at worldPosition.
 * Returns a factor between 0.0 (crystal clear) and 1.0 (completely obscured by fog).
 */
export function computeExponentialHeightFogFactor(
  worldPos: readonly [number, number, number],
  cameraPos: readonly [number, number, number],
  params: HeightFogParams = DEFAULT_HEIGHT_FOG_PARAMS,
): number {
  if (!params.enabled || params.density <= 0) return 0;

  const dx = worldPos[0] - cameraPos[0];
  const dy = worldPos[1] - cameraPos[1];
  const dz = worldPos[2] - cameraPos[2];
  const distance = Math.hypot(dx, dy, dz);

  if (distance <= params.near) return 0;

  // Effective distance beyond near plane
  const effectiveDist = Math.min(distance - params.near, params.far - params.near);

  // Height falloff: fog density is maximum at or below baseHeight
  const deltaHeight = Math.max(0, worldPos[1] - params.baseHeight);
  const heightAttenuation = Math.exp(-deltaHeight * params.heightFalloff);

  // Combined distance and height extinction
  const fogOpticalDepth = effectiveDist * params.density * heightAttenuation;
  const fogFactor = 1.0 - Math.exp(-fogOpticalDepth);

  return Math.max(0, Math.min(1, Math.round(fogFactor * 1000) / 1000));
}

// ── 4. 사용자 3D 모델 텍스처 일괄 출력 ──────────────────────────────────────

export interface ModelTextureExportItem {
  readonly textureId: string;
  readonly mapType: "baseColor" | "normal" | "roughness" | "metallic" | "emissive" | "occlusion";
  readonly materialName: string;
  readonly width: number;
  readonly height: number;
  readonly dataUri?: string;
}

export interface ModelTextureBatchManifest {
  readonly modelName: string;
  readonly exportedAt: string;
  readonly totalTextures: number;
  readonly textures: readonly {
    readonly fileName: string;
    readonly mapType: string;
    readonly materialName: string;
    readonly resolution: string;
    readonly dataUri?: string;
  }[];
}

/**
 * Prepares a structured batch manifest for exporting all textures from a 3D model.
 */
export function build3DModelTextureBatchManifest(
  modelName: string,
  textures: readonly ModelTextureExportItem[],
): ModelTextureBatchManifest {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/gu, "_").toLowerCase();
  const safeModelName = sanitize(modelName || "model");

  const entries = textures.map((t, index) => {
    const safeMat = sanitize(t.materialName || "material");
    const fileName = `${safeModelName}_${safeMat}_${t.mapType}_${index + 1}.png`;
    return {
      fileName,
      mapType: t.mapType,
      materialName: t.materialName,
      resolution: `${t.width}x${t.height}`,
      dataUri: t.dataUri,
    };
  });

  return Object.freeze({
    modelName: safeModelName,
    exportedAt: new Date().toISOString(),
    totalTextures: entries.length,
    textures: Object.freeze(entries),
  });
}
