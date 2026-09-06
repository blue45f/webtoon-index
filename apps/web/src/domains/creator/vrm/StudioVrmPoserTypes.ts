import * as THREE from "three";

import { STUDIO_STAMP_BRUSH_DEFAULTS } from "../brush/studio-brush-stamp-engine";

import type { StudioVrmPoserInsertResult } from "../scene-3d/studio-3d-insert-contract";
import type { StudioToolHintSpec } from "../studio-tool-hints";
import type {
  StudioVrmCreativeSqliteRepository,
  StudioVrmCustomPose,
} from "./studio-vrm-creative-sqlite-repository";
import type { StudioVrmFullBodyIkResult } from "./studio-vrm-full-body-ik";
import type { CameraPreset } from "./studio-vrm-poser-catalogs";
import type { FullVrmState, PoseBoneMap } from "./studio-vrm-poser-utils";
import type {
  StudioVrmCameraSettings,
  StudioVrmPoseTranslations,
  StudioVrmSceneDocument,
} from "./studio-vrm-scene-document";
import type { StudioVrmTexturePaintEnvironmentSignals } from "./studio-vrm-texture-paint-device-tier";
import type { StudioVrmTrackingCalibrationRepository } from "./studio-vrm-tracking-calibration-sqlite-repository";
import type { StudioVrmUserIkResult } from "./studio-vrm-user-ik";
import type { StudioVrmIkEffectorBone, StudioVrmIkHandleControl } from "./StudioVrmJointHandles";
import type { StudioVrmTexturePaintPanelSettings } from "./StudioVrmTexturePaintPanel";
import type { SharedAssetCatalogPage } from "@/src/infrastructure/creator-client";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

export type StudioVrmPoserProps = {
  open: boolean;
  onClose: () => void;
  onInsert: (result: StudioVrmPoserInsertResult) => boolean | void | Promise<boolean | void>;
  initialDataUrl?: string;
  initialScene?: StudioVrmSceneDocument;
  /**
   * One-shot seed from Elements 3D rail: spawn a VRM prop after open, then call
   * `onSeedObjectInsertConsumed`.
   */
  seedPropId?: string | null;
  onSeedObjectInsertConsumed?: () => void;
  /** Async test seam. Product defaults to the shared studio-local-v12.db authority. */
  creativeRepository?: StudioVrmCreativeSqliteRepository;
  /** Async test seam. Product defaults to a dedicated namespace in studio-local-v12.db. */
  trackingCalibrationRepository?: StudioVrmTrackingCalibrationRepository;
};

export type LoadStatus = "empty" | "loading" | "ready" | "error";
export type LibraryStatus = "loading" | "ready" | "error";
export type TexturePaintPersistenceStatus = "idle" | "restoring" | "ready" | "error";
export type VrmCreativePersistenceStatus =
  | "hydrating"
  | "sqlite"
  | "saving"
  | "memory"
  | "read-error";

export type CaptureState = {
  gl: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.Camera | null;
};

export type CustomPose = StudioVrmCustomPose;

export const STUDIO_VRM_CAPTURE_PNG_TIMEOUT_MS = 20_000;
export const STUDIO_VRM_SHARE_TIMEOUT_MS = 30_000;
export const DEFAULT_VRM_CUSTOM_COLORS: Record<string, string> = {};

// 웹캠 트래킹에서 quaternion 슬러프 스무딩을 적용할 본(팔/다리/발/손 + 척추/가슴).
// 머리·목은 이미 얼굴 채널에서 EMA 스무딩되므로 제외.
export const LIMB_BONE_RE = /Arm|Leg|Foot|Hand|[Ss]pine|[Cc]hest/;

// 솔버가 생성할 수 있는 팔다리 본 — 추적이 끊긴 본을 rest 로 페이드할 때 순회 대상.
export const CANONICAL_LIMB_BONES = [
  "leftUpperArm",
  "leftLowerArm",
  "rightUpperArm",
  "rightLowerArm",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
] as const;

export const ZERO_EULER = [0, 0, 0] as const;

// 추적 끊김 시 rest 복귀 속도(half-life, 초). 짧은 깜빡임엔 거의 흔들리지 않게 충분히 길게.
export const LIMB_FADE_HALF_LIFE = 0.5;

// vrm.lookAt 직접 구동 시 이중 적용을 막을 시선 표정 이름(lookAt 부재 모델 폴백용).
export const LOOK_EXPRESSION_NAMES = new Set(["lookUp", "lookDown", "lookLeft", "lookRight"]);

export const CONTROL_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45";
export const ICON_BUTTON =
  "inline-grid size-11 place-items-center rounded-lg border border-line bg-card text-fg-3 transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
export const VIEWPORT_BTN =
  "grid size-11 place-items-center rounded-lg border border-line/70 bg-panel/80 text-fg-2 shadow-sm backdrop-blur transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-9";

export const VRM_VIEWPORT_HINTS = {
  undo: {
    id: "vrm:history:undo",
    title: "캐릭터 작업 실행 취소",
    description: "직전에 적용한 포즈·표정·조형 또는 장면 설정을 한 단계 되돌립니다.",
    shortcut: "⌘Z",
    preview: "undo",
  },
  redo: {
    id: "vrm:history:redo",
    title: "캐릭터 작업 다시 실행",
    description: "실행 취소한 캐릭터 편집을 다시 적용합니다.",
    shortcut: "⌘⇧Z",
    preview: "redo",
  },
  zoomIn: {
    id: "vrm:camera:zoom-in",
    title: "캐릭터 화면 확대",
    description: "카메라를 캐릭터 쪽으로 이동해 얼굴, 손과 의상 디테일을 크게 확인합니다.",
    preview: "camera-zoom",
  },
  zoomOut: {
    id: "vrm:camera:zoom-out",
    title: "캐릭터 화면 축소",
    description: "카메라를 뒤로 이동해 전신 포즈와 소품이 프레임 안에 들어오는지 확인합니다.",
    preview: "camera-zoom",
  },
  resetView: {
    id: "vrm:camera:reset",
    title: "캐릭터 시점 초기화",
    description: "카메라의 회전과 거리를 선택한 구도 프리셋의 기본 시점으로 되돌립니다.",
    preview: "camera-reset",
  },
  turntable: {
    id: "vrm:camera:turntable",
    title: "턴테이블 회전 시작",
    description: "다음 클릭으로 카메라가 캐릭터 주위를 자동으로 돌며 포즈와 소품 결합을 모든 방향에서 보여줍니다.",
    preview: "camera-orbit",
    previewVariant: "start",
    tip: "의상 관통이나 뒤쪽 소품 정렬을 빠르게 점검할 때 사용하세요.",
  },
} satisfies Record<string, StudioToolHintSpec>;

export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export const STUDIO_VRM_SURFACE_BRUSH_UNAVAILABLE_REASON =
  "검증된 round 촉 기반 3D 표면 브러시입니다. 필압·크기·불투명도·경도는 로컬 UV atlas에 반영되며, stamp/image 촉과 wet/smudge 혼색은 아직 지원하지 않습니다.";

export function isStudioVrmTexturePaintBrushProductBlocked(
  tool: StudioVrmTexturePaintPanelSettings["tool"],
): boolean {
  // The measured round surface provider is admitted; only the legacy stamp-brush state remains.
  return tool === "brush";
}

export const DEFAULT_STUDIO_VRM_TEXTURE_PAINT_SETTINGS: StudioVrmTexturePaintPanelSettings = {
  tool: "fill",
  brushKind: "ink",
  color: "#d85f48",
  sizeTexels: 48,
  opacity: 1,
  blend: "normal",
  fillScope: "contiguous",
  fillTolerance: 24,
  tuning: {
    flow: STUDIO_STAMP_BRUSH_DEFAULTS.ink.flow,
    hardness: STUDIO_STAMP_BRUSH_DEFAULTS.ink.hardness,
    minSize: STUDIO_STAMP_BRUSH_DEFAULTS.ink.minSizeRatio,
  },
};

export type StudioVrmTexturePaintSettingsUpdate =
  Partial<Omit<StudioVrmTexturePaintPanelSettings, "tuning">> & {
    readonly tuning?: Partial<StudioVrmTexturePaintPanelSettings["tuning"]>;
  };

export function readStudioVrmTexturePaintEnvironmentSignals(): StudioVrmTexturePaintEnvironmentSignals {
  if (typeof window === "undefined") {
    return {
      coarsePointer: false,
      viewportWidthCssPixels: null,
      deviceMemoryGb: null,
    };
  }
  const navigatorWithDeviceMemory = window.navigator as Navigator & {
    readonly deviceMemory?: number;
  };
  const deviceMemory = navigatorWithDeviceMemory.deviceMemory;
  return {
    coarsePointer:
      typeof window.matchMedia === "function"
      && window.matchMedia("(pointer: coarse)").matches,
    viewportWidthCssPixels:
      Number.isFinite(window.innerWidth) && window.innerWidth > 0
        ? window.innerWidth
        : null,
    deviceMemoryGb:
      typeof deviceMemory === "number" && Number.isFinite(deviceMemory)
        ? deviceMemory
        : null,
  };
}

export const VIEWPORT_POSE_BONES: readonly VRMHumanBoneName[] = Object.freeze([
  "hips", "spine", "chest", "neck", "head",
  "leftUpperArm", "leftLowerArm", "leftHand",
  "rightUpperArm", "rightLowerArm", "rightHand",
  "leftUpperLeg", "leftLowerLeg", "leftFoot",
  "rightUpperLeg", "rightLowerLeg", "rightFoot",
]);

export type StudioVrmIkTransaction = {
  vrm: VRM;
  coordinateScene: THREE.Scene;
  effector: StudioVrmIkEffectorBone;
  control: StudioVrmIkHandleControl;
  revision: number;
  /** React-side pose/config snapshot that owns this pointer transaction. */
  authoritativeSignature: string;
  baseline: {
    bones: PoseBoneMap;
    yOffset: number;
    translations: StudioVrmPoseTranslations;
  };
  targetWorld: THREE.Vector3;
  poleWorld?: THREE.Vector3;
  latest: StudioVrmUserIkResult | StudioVrmFullBodyIkResult | null;
};

export type PendingStudioVrmPersistentIkCommand = {
  before: FullVrmState;
  candidateAfter: FullVrmState;
  inputSignature: string;
  historyGeneration: number;
};

export function applyCameraPreset(camera: THREE.Camera, preset: CameraPreset, invalidate: () => void) {
  camera.position.set(preset.position[0], preset.position[1], preset.position[2]);
  camera.lookAt(preset.target[0], preset.target[1], preset.target[2]);

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.fov = preset.fov;
    camera.updateProjectionMatrix();
  }

  camera.updateMatrixWorld();
  invalidate();
}

export type OrbitLike = {
  target?: THREE.Vector3;
  minDistance?: number;
  maxDistance?: number;
  update?: () => void;
} | null;

export function restorePerspectiveCamera(
  camera: THREE.Camera,
  controls: OrbitLike,
  settings: StudioVrmCameraSettings,
  invalidate: () => void
): void {
  if (camera.type !== "PerspectiveCamera") return;
  const perspective = camera as THREE.PerspectiveCamera;
  perspective.position.set(settings.position[0], settings.position[1], settings.position[2]);
  perspective.up.set(settings.up[0], settings.up[1], settings.up[2]).normalize();
  perspective.fov = settings.fovDegrees;
  perspective.near = settings.near;
  perspective.far = settings.far;
  perspective.lookAt(settings.target[0], settings.target[1], settings.target[2]);
  perspective.updateProjectionMatrix();
  perspective.updateMatrixWorld();
  if (controls?.target) {
    controls.target.set(settings.target[0], settings.target[1], settings.target[2]);
  }
  controls?.update?.();
  invalidate();
}

export type ViewportApi = {
  zoomBy: (factor: number) => void;
  readCamera: () => StudioVrmCameraSettings | null;
  restoreCamera: (settings: StudioVrmCameraSettings) => void;
};

export type StudioVrmBroadcastCameraLease = Readonly<{
  settings: StudioVrmCameraSettings;
  restoreCamera: ViewportApi["restoreCamera"];
}>;

export function restoreStudioVrmBroadcastImperativeState(input: Readonly<{
  cameraLeaseRef: { current: StudioVrmBroadcastCameraLease | null };
  mutationLockSnapshotRef: {
    current: Readonly<{ texturePaint: boolean; wardrobe: boolean }> | null;
  };
  texturePaintMutationBlockedRef: { current: boolean };
  wardrobeMutationBlockedRef: { current: boolean };
}>): boolean {
  const cameraLease = input.cameraLeaseRef.current;
  input.cameraLeaseRef.current = null;
  const mutationSnapshot = input.mutationLockSnapshotRef.current;
  input.mutationLockSnapshotRef.current = null;
  let cameraRestored = true;
  try {
    if (cameraLease) cameraLease.restoreCamera(cameraLease.settings);
  } catch {
    cameraRestored = false;
  } finally {
    if (mutationSnapshot) {
      input.texturePaintMutationBlockedRef.current = mutationSnapshot.texturePaint;
      input.wardrobeMutationBlockedRef.current = mutationSnapshot.wardrobe;
    }
  }
  return cameraRestored;
}

export function normalizeCatalogNextOffset(currentOffset: number, page: SharedAssetCatalogPage): number | null {
  if (!page.hasMore || page.nextOffset === null) return null;
  if (typeof page.nextOffset !== "number" || !Number.isInteger(page.nextOffset)) return null;
  if (page.nextOffset < currentOffset + 1) return null;
  return page.nextOffset;
}

export type StudioVrmCaptureVisualAuthority = Readonly<{
  identity: string;
  fullState: FullVrmState;
}>;
