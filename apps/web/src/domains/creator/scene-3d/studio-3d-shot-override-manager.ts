/**
 * Studio 3D Multi-Shot Override & Storyboard Director
 *
 * 웹툰 연출을 위한 3D 다중 카메라 컷(Multi-Shot) 관리 및 연속성(Continuity) 검사 엔진입니다.
 * 컷별 독립 카메라 화각, 피사체 가시성, 과장 원근 트랜스폼, 캐릭터 포즈/표정,
 * 조명 분위기 오버라이드 및 180도 축 법칙/소품 연속성 검증을 완벽 지원합니다.
 */

export type ShotType =
  | "establishing-wide"
  | "master-medium"
  | "over-the-shoulder"
  | "close-up"
  | "extreme-close-up"
  | "dutch-angle-action"
  | "low-angle-hero"
  | "bird-eye-top";

export interface CameraTransform {
  position: [number, number, number];
  target: [number, number, number];
  rotation: [number, number, number];
  fov: number;             // 화각 (도)
  focalLengthMm: number;   // 초점거리 (mm, 예: 24mm, 50mm, 85mm)
  dutchAngleDeg: number;   // 센서 틸트 각도
  depthOfFieldEnabled: boolean;
  focusDistance: number;   // 포커스 거리 (m)
  apertureFStop: number;   // 조리개 (f/1.4 ~ f/22)
  near: number;
  far: number;
  projection: "perspective" | "orthographic";
}

export interface NodeOverride {
  nodeId: string;
  visible?: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  materialColor?: string;
  toonOutlineWidth?: number;
  toonShadowBands?: number;
}

export type LightingAtmosphere =
  | "daylight-noon"
  | "morning-dawn"
  | "golden-sunset"
  | "night-moonlight"
  | "cinematic-noir"
  | "cyberpunk-neon";

export interface StudioShotOverride {
  shotId: string;
  name: string;
  shotType: ShotType;
  sequenceIndex: number;
  panelAspectRatio: number; // 폭/높이 비율 (예: 1.0, 1.5, 0.75)
  camera: CameraTransform;
  nodeOverrides: Record<string, NodeOverride>;
  vrmPoseOverrides: Record<string, Record<string, [number, number, number]>>;
  vrmExpressionOverrides: Record<string, Record<string, number>>;
  characterEquippedProps?: Record<string, string[]>; // characterId -> propId[]
  lightOverrides?: {
    atmosphere?: LightingAtmosphere;
    intensity?: number;
    color?: string;
    direction?: [number, number, number];
  };
  notes?: string;
}

export interface Studio3DShotScene {
  activeShotId: string;
  shots: Record<string, StudioShotOverride>;
}

export interface ContinuityWarning {
  fromShotId: string;
  toShotId: string;
  type: "180-rule-violation" | "teleportation" | "prop-inconsistency" | "lighting-flip" | "focal-jump";
  severity: "error" | "warning" | "info";
  message: string;
}

export function createDefaultShotOverride(
  shotId: string,
  name: string,
  shotType: ShotType = "master-medium",
): StudioShotOverride {
  return {
    shotId,
    name,
    shotType,
    sequenceIndex: 0,
    panelAspectRatio: 1.2,
    camera: {
      position: [0, 1.5, 3.5],
      target: [0, 1.2, 0],
      rotation: [0, 0, 0],
      fov: 45,
      focalLengthMm: 50,
      dutchAngleDeg: 0,
      depthOfFieldEnabled: false,
      focusDistance: 3.5,
      apertureFStop: 4.0,
      near: 0.1,
      far: 1000,
      projection: "perspective",
    },
    nodeOverrides: {},
    vrmPoseOverrides: {},
    vrmExpressionOverrides: {},
    characterEquippedProps: {},
    lightOverrides: {
      atmosphere: "daylight-noon",
      intensity: 1.0,
      color: "#ffffff",
      direction: [0.5, 1.0, 0.3],
    },
  };
}

export class Studio3DShotManager {
  private scene: Studio3DShotScene;

  constructor(initialShotId = "shot-1", initialShotName = "Shot 1 (메인 컷)") {
    const defaultShot = createDefaultShotOverride(initialShotId, initialShotName, "establishing-wide");
    this.scene = {
      activeShotId: initialShotId,
      shots: {
        [initialShotId]: defaultShot,
      },
    };
  }

  public getActiveShot(): StudioShotOverride {
    return this.scene.shots[this.scene.activeShotId] ?? createDefaultShotOverride(this.scene.activeShotId, "Active Shot");
  }

  public setActiveShot(shotId: string): StudioShotOverride {
    if (!this.scene.shots[shotId]) {
      this.scene.shots[shotId] = createDefaultShotOverride(shotId, `Shot ${Object.keys(this.scene.shots).length + 1}`);
    }
    this.scene.activeShotId = shotId;
    return this.scene.shots[shotId];
  }

  public addShot(
    shotId: string,
    name: string,
    shotType: ShotType = "master-medium",
    copyFromActive = true,
  ): StudioShotOverride {
    const active = this.getActiveShot();
    const newShot: StudioShotOverride = copyFromActive
      ? {
          ...structuredClone(active),
          shotId,
          name,
          shotType,
          sequenceIndex: Object.keys(this.scene.shots).length,
        }
      : {
          ...createDefaultShotOverride(shotId, name, shotType),
          sequenceIndex: Object.keys(this.scene.shots).length,
        };

    this.scene.shots[shotId] = newShot;
    return newShot;
  }

  public removeShot(shotId: string): boolean {
    const keys = Object.keys(this.scene.shots);
    if (keys.length <= 1) return false; // 최소 1개 컷 유지
    delete this.scene.shots[shotId];
    if (this.scene.activeShotId === shotId) {
      this.scene.activeShotId = Object.keys(this.scene.shots)[0];
    }
    return true;
  }

  public setNodeOverride(shotId: string, nodeId: string, override: Partial<NodeOverride>): void {
    const shot = this.scene.shots[shotId];
    if (!shot) return;
    shot.nodeOverrides[nodeId] = {
      ...(shot.nodeOverrides[nodeId] ?? { nodeId }),
      ...override,
    };
  }

  public setCameraTransform(shotId: string, camera: Partial<CameraTransform>): void {
    const shot = this.scene.shots[shotId];
    if (!shot) return;
    shot.camera = { ...shot.camera, ...camera };
    // FOV <-> 초점거리 연동
    if (camera.focalLengthMm && !camera.fov) {
      shot.camera.fov = Math.round(2 * Math.atan(36 / (2 * camera.focalLengthMm)) * (180 / Math.PI) * 10) / 10;
    }
  }

  public listShots(): StudioShotOverride[] {
    return Object.values(this.scene.shots).sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  }

  /**
   * 컷 간 스토리보드 연속성(Continuity) 자동 검사
   */
  public auditContinuity(): ContinuityWarning[] {
    const warnings: ContinuityWarning[] = [];
    const shotList = this.listShots();

    for (let i = 0; i < shotList.length - 1; i += 1) {
      const shotA = shotList[i];
      const shotB = shotList[i + 1];

      // 1. 180도 축 법칙 (Axis of Action) 검사
      const camVecA = [
        shotA.camera.target[0] - shotA.camera.position[0],
        shotA.camera.target[2] - shotA.camera.position[2],
      ];
      const camVecB = [
        shotB.camera.target[0] - shotB.camera.position[0],
        shotB.camera.target[2] - shotB.camera.position[2],
      ];
      const dot = camVecA[0] * camVecB[0] + camVecA[1] * camVecB[1];
      if (dot < -0.5 && shotA.shotType !== "establishing-wide") {
        warnings.push({
          fromShotId: shotA.shotId,
          toShotId: shotB.shotId,
          type: "180-rule-violation",
          severity: "warning",
          message: `"${shotA.name}"과 "${shotB.name}" 간 카메라 축이 180도 반전되었습니다 (아이콘택트 혼선 주의).`,
        });
      }

      // 2. 급격한 초점거리 점프 (Focal Jump) 검사
      const focalDiff = Math.abs(shotA.camera.focalLengthMm - shotB.camera.focalLengthMm);
      if (focalDiff > 60) {
        warnings.push({
          fromShotId: shotA.shotId,
          toShotId: shotB.shotId,
          type: "focal-jump",
          severity: "info",
          message: `"${shotA.name}"(${shotA.camera.focalLengthMm}mm)에서 "${shotB.name}"(${shotB.camera.focalLengthMm}mm)으로의 급격한 화각 전환입니다.`,
        });
      }

      // 3. 조명 방향 반전 검사
      if (shotA.lightOverrides?.direction && shotB.lightOverrides?.direction) {
        const lA = shotA.lightOverrides.direction;
        const lB = shotB.lightOverrides.direction;
        const lDot = lA[0] * lB[0] + lA[1] * lB[1] + lA[2] * lB[2];
        if (lDot < -0.3) {
          warnings.push({
            fromShotId: shotA.shotId,
            toShotId: shotB.shotId,
            type: "lighting-flip",
            severity: "warning",
            message: `"${shotA.name}"과 "${shotB.name}" 간 주 광원 방향이 크게 달라 그림자 연속성이 깨질 수 있습니다.`,
          });
        }
      }

      // 4. 소품 장착 연속성 검사
      if (shotA.characterEquippedProps && shotB.characterEquippedProps) {
        for (const charId of Object.keys(shotA.characterEquippedProps)) {
          const propsA = shotA.characterEquippedProps[charId] ?? [];
          const propsB = shotB.characterEquippedProps[charId] ?? [];
          const missing = propsA.filter((p) => !propsB.includes(p));
          if (missing.length > 0) {
            warnings.push({
              fromShotId: shotA.shotId,
              toShotId: shotB.shotId,
              type: "prop-inconsistency",
              severity: "warning",
              message: `캐릭터 "${charId}"가 ${shotA.name}에서 쥐고 있던 소품(${missing.join(", ")})이 다음 컷에서 사라졌습니다.`,
            });
          }
        }
      }
    }

    return warnings;
  }

  public serialize(): string {
    return JSON.stringify(this.scene, null, 2);
  }

  public deserialize(json: string): void {
    const parsed = JSON.parse(json) as Studio3DShotScene;
    if (parsed && parsed.shots && parsed.activeShotId) {
      this.scene = parsed;
    }
  }
}
