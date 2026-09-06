/**
 * Native .toon3d Project Archive & Interchange Format
 *
 * ToonSpectrum의 공식 3D 웹툰 저작 프로젝트 포맷(.toon3d)입니다.
 * 3D 장면 그래프, 편집 가능 메시, B-Rep CAD 피처, VRM 캐릭터 포즈,
 * 다중 컷(Multi-Shot) 오버라이드, Live 2D↔3D Linked Ink, Rights BOM 및
 * NPR 툰 렌더 프로필을 완벽히 캡슐화합니다.
 */

import type { LinkedInkStroke } from "./studio-3d-linked-ink-bridge";
import type { ModifierNode, RawMeshData } from "./studio-3d-modifier-dag";
import type { RightsRecord } from "./studio-3d-rights-bom";
import type { RoomBuildingConfig } from "./studio-3d-room-building-kit";
import type { StudioShotOverride } from "./studio-3d-shot-override-manager";
import type { Studio3DToonPipelineProfile } from "./studio-3d-toon-pass-pipeline";

export const CURRENT_TOON3D_FORMAT_VERSION = "2.0.0";

export interface Toon3DManifest {
  format: "toon3d";
  version: string;
  projectName: string;
  creator: string;
  createdAt: string; // ISO date
  modifiedAt: string; // ISO date
  units: "m" | "cm" | "mm";
  upAxis: "Y" | "Z";
  sceneBoundingBox?: {
    min: [number, number, number];
    max: [number, number, number];
  };
  application: {
    name: "ToonSpectrum";
    engine: "Hybrid 3D DCC v2";
  };
}

export interface Toon3DSceneObject {
  id: string;
  name: string;
  type: "mesh" | "room" | "vrm-character" | "prop" | "light" | "camera" | "group";
  transform: {
    position: [number, number, number];
    rotation: [number, number, number, number]; // Quaternion
    scale: [number, number, number];
  };
  visible: boolean;
  parentId?: string;
  childrenIds?: string[];
  materialId?: string;
  meshDataId?: string;
  modifierStack?: ModifierNode[];
}

export interface Toon3DMaterialDef {
  id: string;
  name: string;
  shadingModel: "toon-cel" | "pbr-standard" | "unlit" | "mtoon";
  baseColor: string;
  shadowColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  roughness?: number;
  metallic?: number;
  textureMapUri?: string;
}

export interface Toon3DPackage {
  manifest: Toon3DManifest;
  scene: {
    objects: Toon3DSceneObject[];
    materials: Toon3DMaterialDef[];
    environment: {
      backgroundSkyColor: string;
      sunLight: {
        direction: [number, number, number];
        intensity: number;
        color: string;
      };
      fog: {
        enabled: boolean;
        density: number;
        color: string;
      };
    };
  };
  roomBuildingConfig?: RoomBuildingConfig;
  geometries: Record<string, RawMeshData>;
  storyboard: {
    activeShotId: string;
    shots: Record<string, StudioShotOverride>;
  };
  linkedInk: {
    strokes: LinkedInkStroke[];
  };
  rightsBOM: {
    records: RightsRecord[];
  };
  renderPipeline: Studio3DToonPipelineProfile;
}

export interface Toon3DValidationIssue {
  severity: "error" | "warning";
  field: string;
  message: string;
}

/**
 * 기본 빈 .toon3d 프로젝트 패키지 생성
 */
export function createEmptyToon3DPackage(
  projectName = "새 3D 웹툰 프로젝트",
  creator = "작가",
): Toon3DPackage {
  const now = new Date().toISOString();

  return {
    manifest: {
      format: "toon3d",
      version: CURRENT_TOON3D_FORMAT_VERSION,
      projectName,
      creator,
      createdAt: now,
      modifiedAt: now,
      units: "m",
      upAxis: "Y",
      sceneBoundingBox: {
        min: [-10, 0, -10],
        max: [10, 5, 10],
      },
      application: {
        name: "ToonSpectrum",
        engine: "Hybrid 3D DCC v2",
      },
    },
    scene: {
      objects: [
        {
          id: "root-group",
          name: "Main Scene",
          type: "group",
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1],
          },
          visible: true,
        },
      ],
      materials: [
        {
          id: "mat-default-toon",
          name: "기본 툰 재질",
          shadingModel: "toon-cel",
          baseColor: "#ffffff",
          shadowColor: "#a3b18a",
          outlineColor: "#000000",
          outlineWidth: 1.5,
        },
      ],
      environment: {
        backgroundSkyColor: "#e9ecef",
        sunLight: {
          direction: [0.5, 1.0, 0.3],
          intensity: 1.0,
          color: "#ffffff",
        },
        fog: {
          enabled: false,
          density: 0.02,
          color: "#f8f9fa",
        },
      },
    },
    geometries: {},
    storyboard: {
      activeShotId: "shot-1",
      shots: {
        "shot-1": {
          shotId: "shot-1",
          name: "1화 메인 컷",
          shotType: "establishing-wide",
          sequenceIndex: 0,
          panelAspectRatio: 1.33,
          camera: {
            position: [0, 1.5, 4.0],
            target: [0, 1.0, 0],
            rotation: [0, 0, 0],
            fov: 45,
            focalLengthMm: 50,
            dutchAngleDeg: 0,
            depthOfFieldEnabled: false,
            focusDistance: 4.0,
            apertureFStop: 4.0,
            near: 0.1,
            far: 1000,
            projection: "perspective",
          },
          nodeOverrides: {},
          vrmPoseOverrides: {},
          vrmExpressionOverrides: {},
        },
      },
    },
    linkedInk: {
      strokes: [],
    },
    rightsBOM: {
      records: [],
    },
    renderPipeline: {
      id: "toon-standard",
      name: "웹툰 표준 카툰 렌더 프로필",
      quality: "interactive",
      outlineThickness: 1.5,
      creaseAngleThreshold: 35,
      shadowBands: 2,
      depthFogEnabled: true,
      rimLightIntensity: 0.7,
      screentoneFrequency: 60,
      passes: {
        beauty: { passType: "beauty", enabled: true, resolutionMultiplier: 1, bitDepth: 8, channelName: "RGB Color", blendMode: "normal", opacity: 1.0 },
        "line-art": { passType: "line-art", enabled: true, resolutionMultiplier: 1, bitDepth: 8, channelName: "Line Ink Layer", blendMode: "multiply", opacity: 1.0 },
        screentone: { passType: "screentone", enabled: false, resolutionMultiplier: 1, bitDepth: 8, channelName: "Manga Screentone", blendMode: "multiply", opacity: 0.8 },
        "shadow-ao": { passType: "shadow-ao", enabled: true, resolutionMultiplier: 1, bitDepth: 8, channelName: "Toon Shadow & AO", blendMode: "multiply", opacity: 0.85 },
        depth: { passType: "depth", enabled: true, resolutionMultiplier: 1, bitDepth: 16, channelName: "Linear Depth Map", blendMode: "normal", opacity: 1.0 },
        "object-id": { passType: "object-id", enabled: true, resolutionMultiplier: 1, bitDepth: 8, channelName: "Object Mask ID", blendMode: "normal", opacity: 1.0 },
        normal: { passType: "normal", enabled: false, resolutionMultiplier: 1, bitDepth: 16, channelName: "World Normal", blendMode: "normal", opacity: 1.0 },
        "material-id": { passType: "material-id", enabled: false, resolutionMultiplier: 1, bitDepth: 8, channelName: "Material Mask ID", blendMode: "normal", opacity: 1.0 },
        "rim-light": { passType: "rim-light", enabled: true, resolutionMultiplier: 1, bitDepth: 8, channelName: "Anime Rim Light", blendMode: "screen", opacity: 0.75 },
      },
    },
  };
}

/**
 * .toon3d 패키지 직렬화 (JSON 문자열 변환, TypedArray 인코딩 처리)
 */
export function serializeToon3DPackage(pkg: Toon3DPackage): string {
  const serializable = {
    ...pkg,
    manifest: {
      ...pkg.manifest,
      modifiedAt: new Date().toISOString(),
    },
    geometries: Object.fromEntries(
      Object.entries(pkg.geometries).map(([key, mesh]) => [
        key,
        {
          positions: Array.from(mesh.positions),
          normals: mesh.normals ? Array.from(mesh.normals) : undefined,
          uvs: mesh.uvs ? Array.from(mesh.uvs) : undefined,
          indices: Array.from(mesh.indices),
        },
      ]),
    ),
  };

  return JSON.stringify(serializable, null, 2);
}

/**
 * .toon3d 패키지 역직렬화 (TypedArray 복원)
 */
export function deserializeToon3DPackage(json: string): Toon3DPackage {
  const parsed = JSON.parse(json);

  const geometries: Record<string, RawMeshData> = {};
  if (parsed.geometries && typeof parsed.geometries === "object") {
    for (const [key, meshObj] of Object.entries(parsed.geometries as Record<string, { positions: number[]; normals?: number[]; uvs?: number[]; indices: number[] }>)) {
      geometries[key] = {
        positions: new Float32Array(meshObj.positions ?? []),
        normals: meshObj.normals ? new Float32Array(meshObj.normals) : undefined,
        uvs: meshObj.uvs ? new Float32Array(meshObj.uvs) : undefined,
        indices: new Uint32Array(meshObj.indices ?? []),
      };
    }
  }

  return {
    ...parsed,
    geometries,
  };
}

/**
 * .toon3d 패키지 유효성 검사기
 */
export function validateToon3DPackage(pkg: Toon3DPackage): Toon3DValidationIssue[] {
  const issues: Toon3DValidationIssue[] = [];

  if (!pkg.manifest || pkg.manifest.format !== "toon3d") {
    issues.push({ severity: "error", field: "manifest.format", message: "올바른 .toon3d 패키지 포맷이 아닙니다." });
  }

  if (!pkg.scene || !Array.isArray(pkg.scene.objects)) {
    issues.push({ severity: "error", field: "scene.objects", message: "장면 오브젝트 목록이 누락되었습니다." });
  }

  if (!pkg.storyboard || !pkg.storyboard.shots || Object.keys(pkg.storyboard.shots).length === 0) {
    issues.push({ severity: "warning", field: "storyboard.shots", message: "스토리보드에 컷이 최소 1개 이상 필요합니다." });
  }

  return issues;
}
