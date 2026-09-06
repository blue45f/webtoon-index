import { Boxes, Camera, CircleDashed, Cone, Cylinder, Globe, Hexagon, LayoutTemplate, Layers, Move, Pill, Pyramid, RectangleHorizontal, RotateCw, ScanLine, Scaling, Torus as TorusIcon, Triangle, Umbrella } from "lucide-react";



import type { StudioBg3dAiMethodReferenceCapture } from "../scene-3d/studio-3d-ai-reference-handoff";
import type { StudioBackground3DInsertResult } from "../scene-3d/studio-3d-insert-contract";
import type { StudioBg3dThreeJointDescriptor, StudioBg3dThreeMorphDescriptor } from "../studio-background-3d-model";
import type { BgPrimitiveKind } from "../studio-background-3d-primitives";
import type { StudioShared3dSceneSession } from "../studio-shared-3d-scene-bridge";
import type { StudioShared3dStageResolution } from "../studio-shared-3d-stage-document";
import type { StudioToolHintSpec } from "../studio-tool-hints";
import type { StudioBg3dCaptureAdapter } from "./studio-bg3d-capture-adapter";
import type { StudioBg3dPhysicsWorld, StudioBg3dPhysicsTransformSample } from "./studio-bg3d-physics";
import type { StudioBg3dPhysicsTimelineResult } from "./studio-bg3d-physics-timeline";
import type { StudioBg3dRuntimeAdapter } from "./studio-bg3d-runtime-adapter";
import type { StudioBg3dRuntimeCapability } from "./studio-bg3d-runtime-topology";
import type {
  StudioBg3dSceneDocument,
  StudioBg3dToneOutputSettings,
} from "./studio-bg3d-scene-document";
import type {
  StudioBg3dSemanticMaterialSlot,
  StudioBg3dSemanticMaterialConfidence,
} from "./studio-bg3d-semantic-materials";
import type { StudioBg3dShotBatchRecoveryScope } from "./studio-bg3d-shot-batch-plan";
import type { StudioBg3dBabylonDiagnosticBackend } from "./StudioBg3dViewPanel";
import type * as THREE from "three";

export interface StudioBackground3DProps {
  open: boolean;
  initialDataUrl?: string;
  initialScene?: StudioBg3dSceneDocument;
  /**
   * One-shot seed from Elements 3D rail: apply a scene template after open, then call
   * `onSeedObjectInsertConsumed`.
   */
  seedSceneTemplateId?: string | null;
  /** One-shot seed: spawn a primitive kind after open. */
  seedPrimitiveKind?: BgPrimitiveKind | null;
  onSeedObjectInsertConsumed?: () => void;
  /** Runtime-only page composition. Character documents remain owned by their source layers. */
  sharedSceneSession?: StudioShared3dSceneSession;
  /** Page-persistent association state for the exact LT bundle being edited. */
  sharedStageResolution?: StudioShared3dStageResolution;
  /** Page + target-bundle ownership boundary for runtime-only Shared Stage editor state. */
  sharedStageSessionScopeKey: string;
  /** Exact shared VRM sources already used by another background and reusable here. */
  sharedCharactersLinkedToOtherBackgroundCount?: number;
  /** Whether the result creates a new canvas element or replaces an existing one. */
  operation?: "insert" | "update";
  recoveryScope: StudioBg3dShotBatchRecoveryScope | null;
  validateRecoveryAccess: (
    scope: StudioBg3dShotBatchRecoveryScope,
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** Keeps the owning R3F Canvas mounted, but hidden, while a non-cancellable XR attach settles. */
  onWebXrCleanupPendingChange?: (pending: boolean) => void;
  onClose: () => void;
  onInsert: (
    result: StudioBackground3DInsertResult,
  ) => boolean | void | Promise<boolean | void>;
  onUseAsAiMethodReference?: (
    capture: StudioBg3dAiMethodReferenceCapture,
  ) => boolean | void | Promise<boolean | void>;
  /** 편집 중인 문서 캔버스 크기. 주어지면 "문서 캔버스 비율" 캡처 프리셋이 목록에 추가된다. */
  documentCanvasSize?: { readonly width: number; readonly height: number };
}

export type TransformModeId = "translate" | "rotate" | "scale";
export type TransformSpace = "local" | "world";
export type BgPanelTab = "shapes" | "templates" | "layers" | "view" | "lt" | "models";
export type ViewEditorSection = "camera" | "physics" | "prosuite";
export type LtEditorSection = "line" | "tone";

export const VIEW_EDITOR_SECTIONS = [
  { id: "camera", label: "카메라 · 환경" },
  { id: "physics", label: "물리 배치" },
  { id: "prosuite", label: "웹툰 프로 툴" },
] as const satisfies readonly { id: ViewEditorSection; label: string }[];

export type LtUserPresetLibraryStatus =
  | "idle"
  | "ready"
  | "saving"
  | "memory-only";

export type LtUserPresetNoticeTone = "info" | "success" | "error";

export type LtUserPresetNotice = {
  readonly tone: LtUserPresetNoticeTone;
  readonly message: string;
};

/** Couples a capture adapter with the exact live camera whose view window it renders. */
export type CaptureState = {
  adapter: StudioBg3dCaptureAdapter | null;
  camera: THREE.Camera | null;
};

export interface StudioBg3dPhysicsSession {
  readonly document: StudioBg3dSceneDocument;
  readonly world: StudioBg3dPhysicsWorld;
  readonly timeline: StudioBg3dPhysicsTimelineResult;
  readonly initialDynamicSamples: readonly StudioBg3dPhysicsTransformSample[];
  readonly sourceToken: string;
}

export interface ModelThumbnailGpuLease {
  readonly released: Promise<void>;
  release(): void;
}

export type StudioBg3dModelThumbnailCaptureControllerConstructor =
  typeof import("./studio-bg3d-model-thumbnail-capture").StudioBg3dModelThumbnailCaptureController;

export interface StudioBg3dModelThumbnailRuntime {
  readonly CaptureController: StudioBg3dModelThumbnailCaptureControllerConstructor;
  readonly createThreeCapture:
    typeof import("./studio-bg3d-model-thumbnail-three-capture").createStudioBg3dModelThumbnailThreeCapture;
}

let studioBg3dModelThumbnailRuntimePromise: Promise<StudioBg3dModelThumbnailRuntime> | null = null;

export function loadStudioBg3dModelThumbnailRuntime(): Promise<StudioBg3dModelThumbnailRuntime> {
  const existing = studioBg3dModelThumbnailRuntimePromise;
  if (existing) return existing;
  const pending = Promise.all([
    import("./studio-bg3d-model-thumbnail-capture"),
    import("./studio-bg3d-model-thumbnail-three-capture"),
  ]).then(([captureModule, threeCaptureModule]) => Object.freeze({
    CaptureController: captureModule.StudioBg3dModelThumbnailCaptureController,
    createThreeCapture: threeCaptureModule.createStudioBg3dModelThumbnailThreeCapture,
  }));
  studioBg3dModelThumbnailRuntimePromise = pending;
  void pending.catch(() => {
    if (studioBg3dModelThumbnailRuntimePromise === pending) {
      studioBg3dModelThumbnailRuntimePromise = null;
    }
  });
  return pending;
}

export const VIEWPORT_BTN =
  "grid size-11 place-items-center rounded-lg border border-line/70 bg-panel/80 text-fg-2 shadow-sm backdrop-blur transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-9";
export const DEFAULT_LT_USER_PRESET_DESCRIPTION = "현재 장면에서 저장한 LT 선화·톤 설정입니다.";
export const EMPTY_THREE_ANIMATION_CLIPS: readonly THREE.AnimationClip[] = Object.freeze([]);
export const EMPTY_THREE_JOINTS: readonly StudioBg3dThreeJointDescriptor[] = Object.freeze([]);
export const EMPTY_THREE_MORPH_TARGETS: readonly StudioBg3dThreeMorphDescriptor[] = Object.freeze([]);

export const STUDIO_BG3D_LT_INSERT_WORKER_TIMEOUT_MS = 120_000;

export const BG_PANEL_TABS: Array<{ id: BgPanelTab; label: string; icon: typeof Boxes; hint: string }> = [
  { id: "shapes", label: "도형", icon: Boxes, hint: "추가 · 선택한 도형 수치 편집" },
  { id: "templates", label: "템플릿", icon: LayoutTemplate, hint: "교실·거리·카페처럼 완성된 공간을 한 번에 추가" },
  { id: "layers", label: "레이어", icon: Layers, hint: "목록 · 선택 · 복제 · 삭제" },
  { id: "view", label: "보기", icon: Camera, hint: "카메라 프리셋 · 선화 미리보기" },
  { id: "lt", label: "LT", icon: ScanLine, hint: "컬러 · 선화 · 톤 출력 설정" },
  { id: "models", label: "에셋", icon: Hexagon, hint: "캐릭터 · 크리처 · 소품과 범용 3D 모델" },
];

export const TRANSFORM_MODES: Array<{
  id: TransformModeId;
  label: string;
  icon: typeof Move;
  hint: StudioToolHintSpec;
}> = [
  {
    id: "translate",
    label: "이동",
    icon: Move,
    hint: {
      id: "bg3d:transform:translate",
      title: "3D 객체 이동",
      description: "선택한 배경 객체의 축 기즈모를 끌어 장면 안에서 위치를 조정합니다.",
      shortcut: "T",
      preview: "object-translate",
      tip: "스냅을 켜면 현재 이동 간격에 맞춰 정확하게 배치할 수 있어요.",
    },
  },
  {
    id: "rotate",
    label: "회전",
    icon: RotateCw,
    hint: {
      id: "bg3d:transform:rotate",
      title: "3D 객체 회전",
      description: "선택한 배경 객체의 회전 링을 끌어 X·Y·Z축 방향을 조정합니다.",
      shortcut: "R",
      preview: "object-rotate",
      tip: "회전 스냅을 켜면 일정한 각도로 건물과 소품의 방향을 맞출 수 있어요.",
    },
  },
  {
    id: "scale",
    label: "크기",
    icon: Scaling,
    hint: {
      id: "bg3d:transform:scale",
      title: "3D 객체 크기",
      description: "선택한 배경 객체의 스케일 핸들을 끌어 축별 크기를 조정합니다.",
      shortcut: "S",
      preview: "object-scale",
      tip: "형태가 뒤틀리지 않게 하려면 축 중앙의 균일 크기 핸들을 사용하세요.",
    },
  },
];

export const BG3D_VIEWPORT_HINTS = {
  quad: {
    id: "bg3d:view:quad",
    title: "4분할 뷰 열기",
    description: "다음 클릭으로 원근·위·앞·오른쪽 시점을 함께 열어 객체의 깊이와 정렬을 확인합니다.",
    preview: "quad-view",
    previewVariant: "open",
    tip: "정면과 측면을 함께 보면서 배치하면 원근 화면에서 생기는 겹침을 줄일 수 있어요.",
  },
  undo: {
    id: "bg3d:history:undo",
    title: "3D 작업 실행 취소",
    description: "직전에 적용한 3D 장면 편집을 한 단계 되돌립니다.",
    shortcut: "⌘Z",
    preview: "undo",
  },
  redo: {
    id: "bg3d:history:redo",
    title: "3D 작업 다시 실행",
    description: "실행 취소한 3D 장면 편집을 다시 적용합니다.",
    shortcut: "⌘⇧Z",
    preview: "redo",
  },
  snap: {
    id: "bg3d:transform:snap",
    title: "변형 스냅 켜기",
    description: "다음 클릭으로 이동과 회전을 설정한 간격에 맞춰 붙여 배경 구조를 반듯하게 정렬합니다.",
    preview: "object-snap",
    previewVariant: "enable",
    tip: "세부 간격과 적용 축은 도형 패널의 변형 스냅에서 바꿀 수 있어요.",
  },
  ground: {
    id: "bg3d:object:ground",
    title: "바닥에 접지",
    description: "선택한 도형이나 모델의 가장 낮은 지점을 계산해 바닥 높이에 정확히 맞춥니다.",
    preview: "object-ground",
  },
  originGround: {
    id: "bg3d:object:origin-ground",
    title: "원점 · 바닥 정렬",
    description: "선택한 객체의 실제 지오메트리 경계를 XZ 원점 중앙에 놓고 가장 낮은 지점을 Y=0에 맞춥니다.",
    preview: "object-ground",
    tip: "피벗이 모델 밖에 있는 OBJ·GLB도 보이는 지오메트리를 기준으로 정렬합니다.",
  },
  surfaceSnap: {
    id: "bg3d:object:surface-snap",
    title: "표면에 붙이기",
    description: "선택한 객체를 다른 3D 객체의 클릭한 면에 한 번에 배치합니다. 선택과 회전은 그대로 유지됩니다.",
    preview: "object-snap",
    previewVariant: "enable",
    tip: "버튼을 누른 뒤 대상 표면을 클릭하세요. 선택 객체와 그 자식은 대상으로 사용하지 않습니다.",
  },
  focus: {
    id: "bg3d:camera:focus-selection",
    title: "선택 객체 화면 맞춤",
    description: "선택한 객체의 실제 지오메트리 경계를 계산해 현재 원근 또는 직교 화면에 여백과 함께 맞춥니다.",
    preview: "camera-zoom",
  },
  zoomIn: {
    id: "bg3d:camera:zoom-in",
    title: "3D 화면 확대",
    description: "카메라를 장면 안쪽으로 이동해 선택한 배경의 세부를 크게 봅니다.",
    preview: "camera-zoom",
  },
  zoomOut: {
    id: "bg3d:camera:zoom-out",
    title: "3D 화면 축소",
    description: "카메라를 장면 바깥쪽으로 이동해 배경 전체의 구도와 여백을 확인합니다.",
    preview: "camera-zoom",
  },
  resetView: {
    id: "bg3d:camera:reset",
    title: "3D 시점 초기화",
    description: "카메라 위치와 바라보는 지점을 기본 원근 구도로 되돌립니다.",
    preview: "camera-reset",
  },
  linePreview: {
    id: "bg3d:view:line-preview",
    title: "선화 미리보기 켜기",
    description: "다음 클릭으로 재질색 대신 외곽선 중심의 장면을 표시해 웹툰 배경 선화 밀도를 확인합니다.",
    preview: "line-art",
    previewVariant: "enable",
    tip: "최종 레이어 분리는 LT 탭의 선화·컬러·톤 설정을 사용합니다.",
  },
} satisfies Record<string, StudioToolHintSpec>;

export const ADD_BUTTONS: Array<{ kind: BgPrimitiveKind; label: string; icon: typeof Boxes }> = [
  { kind: "box", label: "상자 추가", icon: Boxes },
  { kind: "cylinder", label: "원기둥 추가", icon: Cylinder },
  { kind: "plane", label: "평면 추가", icon: RectangleHorizontal },
  { kind: "sphere", label: "구 추가", icon: Globe },
  { kind: "hemisphere", label: "반구(돔) 추가", icon: Umbrella },
  { kind: "cone", label: "원뿔 추가", icon: Cone },
  { kind: "pyramid", label: "각뿔 추가", icon: Pyramid },
  { kind: "triangularPrism", label: "삼각기둥(지붕) 추가", icon: Triangle },
  { kind: "hexPrism", label: "육각기둥 추가", icon: Hexagon },
  { kind: "torus", label: "고리 추가", icon: TorusIcon },
  { kind: "tube", label: "파이프 추가", icon: CircleDashed },
  { kind: "ring", label: "평면 고리 추가", icon: CircleDashed },
  { kind: "capsule", label: "캡슐 추가", icon: Pill },
];

export const LT_TONE_MODE_LABELS: Record<StudioBg3dToneOutputSettings["mode"], string> = {
  none: "베이스 없음 (선만)",
  flat: "원본 렌더",
  cel: "셀 명암",
  screentone: "스크린톤",
};

export const LT_TONE_TYPE_LABELS: Record<StudioBg3dToneOutputSettings["type"], string> = {
  color: "재질색 보존",
  grayscale: "그레이스케일",
  pattern: "패턴",
};

export const LT_TONE_PATTERN_LABELS: Record<StudioBg3dToneOutputSettings["pattern"], string> = {
  dot: "도트",
  line: "평행선",
  crosshatch: "교차선",
  noise: "노이즈",
};

export const LT_EXPORT_HEIGHTS = [640, 1_080, 1_440, 2_160, 4_096] as const;

export const SEMANTIC_MATERIAL_SLOT_LABELS: Record<StudioBg3dSemanticMaterialSlot, string> = {
  skin: "피부",
  hair: "머리카락",
  eyes: "눈",
  clothes: "의상",
  accessory: "액세서리",
  background: "배경",
  unknown: "검토 필요",
};

export const SEMANTIC_MATERIAL_CONFIDENCE_LABELS: Record<StudioBg3dSemanticMaterialConfidence, string> = {
  none: "근거 없음",
  low: "낮음",
  medium: "보통",
  high: "높음",
  confirmed: "사용자 확인",
};

export interface StudioBg3dBabylonSpecialistEntry {
  readonly createStudioBg3dBabylonSpecialist: (options: {
    readonly canvas: HTMLCanvasElement;
    readonly backend: StudioBg3dBabylonDiagnosticBackend;
    readonly capabilities?: readonly StudioBg3dRuntimeCapability[];
    readonly settings?: {
      readonly failIfMajorPerformanceCaveat?: boolean;
    };
  }) => StudioBg3dRuntimeAdapter;
}

let studioBg3dBabylonSpecialistEntryPromise:
  Promise<StudioBg3dBabylonSpecialistEntry> | null = null;

/** Explicit-action-only Babylon import boundary; rejected chunk loads remain retryable. */
export function loadStudioBg3dBabylonSpecialistEntry():
  Promise<StudioBg3dBabylonSpecialistEntry> {
  const existing = studioBg3dBabylonSpecialistEntryPromise;
  if (existing) return existing;
  const pending = import("./studio-bg3d-babylon-specialist-entry").then((module) =>
    Object.freeze({
      createStudioBg3dBabylonSpecialist:
        module.createStudioBg3dBabylonSpecialist,
    }),
  );
  studioBg3dBabylonSpecialistEntryPromise = pending;
  void pending.catch(() => {
    if (studioBg3dBabylonSpecialistEntryPromise === pending) {
      studioBg3dBabylonSpecialistEntryPromise = null;
    }
  });
  return pending;
}
