import {
  CheckCircle2,
  Cpu,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useId } from "react";

import {
  STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
  STUDIO_BG3D_CAMERA_MAX_DUTCH_ROLL_DEGREES,
  STUDIO_BG3D_CAMERA_MAX_NEAR_CLIP,
  STUDIO_BG3D_CAMERA_MIN_DUTCH_ROLL_DEGREES,
  STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP,
  createStudioBg3dCameraUpForDutchRoll,
  readStudioBg3dCameraDutchRollDegrees,
  resolveStudioBg3dCameraNearClip,
} from "./studio-bg3d-camera-orientation";
import {
  STUDIO_BG3D_CONTROL_BUTTON as CONTROL_BUTTON,
  roundStudioBg3dNumber as round,
  studioBg3dClassNames as cx,
} from "./studio-bg3d-editor-ui";
import { StudioBg3dEnginePanel } from "./StudioBg3dEnginePanel";
import { StudioBg3dLightingStudio } from "./StudioBg3dLightingStudio";
import { StudioBg3dProSuitePanel } from "./StudioBg3dProSuitePanel";

import type {
  StudioBg3dEnginePreference,
  StudioBg3dEngineSelectionPlan,
} from "./studio-bg3d-engine-selection";
import type { StudioBg3dInAppBrowserProfile } from "./studio-bg3d-inapp-browser";
import type {
  StudioBg3dPhysicsGravityPreset,
  StudioBg3dPhysicsPhase,
} from "./studio-bg3d-physics-ui";
import type {
  StudioBg3dBackgroundSettings,
  StudioBg3dCameraSettings,
  StudioBg3dLightingSettings,
  StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import type { StudioBg3dSectionPlaneState } from "./studio-bg3d-section-plane";
import type { StudioBg3dShotBatchRecoveryScope } from "./studio-bg3d-shot-batch-plan";
import type { StudioBg3dSunRigConfig } from "./studio-bg3d-sun-rig";
import type { ViewEditorSection } from "./StudioBackground3DTypes";

export type StudioBg3dBabylonDiagnosticBackend = "webgl2" | "webgpu";

export type StudioBg3dBabylonDiagnosticState =
  | {
      readonly status: "idle";
      readonly backend: null;
    }
  | {
      readonly status: "loading";
      readonly backend: StudioBg3dBabylonDiagnosticBackend;
    }
  | {
      readonly status: "success";
      readonly backend: StudioBg3dBabylonDiagnosticBackend;
      readonly durationMs: number;
    }
  | {
      readonly status: "error";
      readonly backend: StudioBg3dBabylonDiagnosticBackend;
      readonly message: string;
    };

interface StudioBg3dViewPanelContext {
  readonly VIEW_EDITOR_SECTIONS: readonly [{ readonly id: "camera"; readonly label: "카메라 · 환경"; }, { readonly id: "physics"; readonly label: "물리 배치"; }];
  readonly viewEditorSection: ViewEditorSection;
  readonly setViewEditorSection: import("react").Dispatch<import("react").SetStateAction<ViewEditorSection>>;
  readonly StudioBg3dPhysicsPanel: typeof import("./StudioBg3dPhysicsControls").StudioBg3dPhysicsPanel;
  readonly physicsStartButtonRef: import("react").RefObject<HTMLButtonElement | null>;
  readonly selectedIds: Set<string>;
  readonly physicsDurationSeconds: 2 | 4 | 8;
  readonly physicsGravityPreset: StudioBg3dPhysicsGravityPreset;
  readonly physicsGroundEnabled: boolean;
  readonly physicsPhase: StudioBg3dPhysicsPhase;
  readonly physicsProgress: number;
  readonly physicsSelectionUnavailableReason: string | null;
  readonly physicsError: string | null;
  readonly setPhysicsDurationSeconds: import("react").Dispatch<import("react").SetStateAction<2 | 4 | 8>>;
  readonly setPhysicsGravityPreset: import("react").Dispatch<import("react").SetStateAction<StudioBg3dPhysicsGravityPreset>>;
  readonly setPhysicsGroundEnabled: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  readonly handleStartPhysicsPreview: () => void;
  readonly Camera: typeof import("lucide-react").Camera;
  readonly sceneBaseDocument: StudioBg3dSceneDocument;
  readonly STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS: number;
  readonly shotNameDraft: string;
  readonly isCapturing: boolean;
  readonly isRestoringScene: boolean;
  readonly physicsInteractionLocked: boolean;
  readonly setShotNameDraft: import("react").Dispatch<import("react").SetStateAction<string>>;
  readonly captureCurrentShot: () => void;
  readonly duplicateActiveShot: () => void;
  readonly Copy: typeof import("lucide-react").Copy;
  readonly shotBatchSelectedIds: string[];
  readonly savedShots: readonly import( "./studio-bg3d-scene-document").StudioBg3dShot[];
  readonly setShotBatchExcludedIds: import("react").Dispatch<import("react").SetStateAction<Set<string>>>;
  readonly shotBatchExportHeight: number | "per-shot";
  readonly setShotBatchExportHeight: import("react").Dispatch<import("react").SetStateAction<number | "per-shot">>;
  readonly LT_EXPORT_HEIGHTS: readonly [640, 1080, 1440, 2160, 4096];
  readonly selectedShotBatchPasses: ("color" | "beauty" | "lt-composite" | "tone" | "texture-line" | "main-line" | "depth")[];
  readonly STUDIO_BG3D_SHOT_BATCH_PASSES: readonly ["beauty", "lt-composite", "color", "tone", "texture-line", "main-line", "depth"];
  readonly shotBatchPasses: Set<"color" | "beauty" | "lt-composite" | "tone" | "texture-line" | "main-line" | "depth">;
  readonly setShotBatchPasses: import("react").Dispatch<import("react").SetStateAction<Set<"color" | "beauty" | "lt-composite" | "tone" | "texture-line" | "main-line" | "depth">>>;
  readonly STUDIO_BG3D_SHOT_BATCH_PASS_LABELS: Readonly<Record<"color" | "beauty" | "lt-composite" | "tone" | "texture-line" | "main-line" | "depth", string>>;
  readonly shotBatchIncludeLayeredPsd: boolean;
  readonly setShotBatchIncludeLayeredPsd: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  readonly shotBatchIncludeContactSheet: boolean;
  readonly setShotBatchIncludeContactSheet: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  readonly recoveryScope: StudioBg3dShotBatchRecoveryScope | null;
  readonly shotBatchBlockedReason: string | null;
  readonly exportSavedShotsAsZip: () => Promise<void>;
  readonly isBatchRenderingShots: boolean;
  readonly Loader2: typeof import("lucide-react").Loader2;
  readonly Save: typeof import("lucide-react").Save;
  readonly shotBatchRecoverySummary: { readonly completedShots: number; readonly totalShots: number; readonly mode: "durable" | "memory"; readonly downloadRequested?: boolean; readonly degradedReason?: string | null; } | null;
  readonly shotBatchProgress: { readonly stage: "render" | "contact" | "archive"; readonly completed: number; readonly total: number; readonly label: string; } | null;
  readonly shotBatchExcludedIds: Set<string>;
  readonly applySavedShot: (shotId: string) => void;
  readonly moveSavedShot: (shotId: string, targetIndex: number) => void;
  readonly removeSavedShot: (shotId: string) => void;
  readonly Trash2: typeof import("lucide-react").Trash2;
  readonly CAMERA_PRESETS: Record<string, { label: string; position: [number, number, number]; target: [number, number, number]; }>;
  readonly applyCameraPreset: (presetId: string) => void;
  readonly zoomCameraBy: (distanceFactor: number) => void;
  readonly ZoomIn: typeof import("lucide-react").ZoomIn;
  readonly ZoomOut: typeof import("lucide-react").ZoomOut;
  readonly Aperture: typeof import("lucide-react").Aperture;
  readonly isMainOrtho: boolean;
  readonly LtRangeControl: typeof import("./studio-bg3d-control-fields").LtRangeControl;
  readonly STUDIO_BG3D_LENS_MIN_FOCAL_MM: number;
  readonly STUDIO_BG3D_LENS_MAX_FOCAL_MM: number;
  readonly currentFocalLengthMm: number;
  readonly updateCameraLens: (patch: (view: StudioBg3dCameraSettings) => Partial<StudioBg3dCameraSettings>) => void;
  readonly previewCameraLens: (patch: (view: StudioBg3dCameraSettings) => Partial<StudioBg3dCameraSettings>) => void;
  readonly finishCameraLensGesture: () => void;
  readonly studioBg3dFocalLengthToFovDegrees: (focalLengthMm: number) => number;
  readonly STUDIO_BG3D_LENS_PRESETS: readonly import("./studio-bg3d-lens").StudioBg3dLensPreset[];
  readonly LtToggleRow: typeof import("./studio-bg3d-control-fields").LtToggleRow;
  readonly twoPointPerspectiveActive: boolean;
  readonly applyTwoPointPerspective: () => void;
  readonly resetTwoPointPerspective: () => void;
  readonly RotateCcw: typeof import("lucide-react").RotateCcw;
  readonly lineArtPreview: boolean;
  readonly setLineArtPreview: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  readonly transparentInsert: boolean;
  readonly updateBackgroundTransparency: (transparent: boolean) => void;
  readonly SunMoon: typeof import("lucide-react").SunMoon;
  readonly STUDIO_BG3D_MOOD_RIGS: readonly import("./studio-bg3d-mood-rigs").StudioBg3dMoodRig[];
  readonly appliedMoodRig: import("./studio-bg3d-mood-rigs").StudioBg3dMoodRig | null;
  readonly applyMoodRig: (rigId: string) => void;
  readonly updateLightingSettings: (patch: Partial<StudioBg3dLightingSettings>) => void;
  readonly updateRenderExposure: (exposure: number) => void;
  readonly sunLightState: import("./studio-bg3d-sun-rig").StudioBg3dSunLightState;
  readonly STUDIO_BG3D_SUN_TIME_PRESETS: readonly import("./studio-bg3d-sun-rig").StudioBg3dSunTimePreset[];
  readonly sunRigConfig: StudioBg3dSunRigConfig;
  readonly applySunRigConfig: (patch: Partial<StudioBg3dSunRigConfig>) => void;
  readonly formatBg3dSunTime: (hours: number) => string;
  readonly Globe: typeof import("lucide-react").Globe;
  readonly BG_SKY_PRESETS: readonly import("../studio-background-3d-sky").BgSkyPreset[];
  readonly skyPresetId: "blank" | "clear_day" | "sunset" | "night";
  readonly updateBackgroundSettings: (patch: Partial<StudioBg3dBackgroundSettings>) => void;
  readonly selectedSky: import("../studio-background-3d-sky").BgSkyPreset;
  readonly panoramaRotation: number;
  readonly normalizePanoramaRotationDegrees: (value: unknown) => number;
  readonly PanoramaRotationNumberField: typeof import("./studio-bg3d-control-fields").PanoramaRotationNumberField;
  readonly CircleDashed: typeof import("lucide-react").CircleDashed;
  readonly STUDIO_BG3D_FOG_PRESETS: readonly [{ readonly id: "air"; readonly label: "공기감"; readonly near: 18; readonly far: 80; }, { readonly id: "depth"; readonly label: "거리감"; readonly near: 8; readonly far: 40; }, { readonly id: "mist"; readonly label: "짙게"; readonly near: 2; readonly far: 22; }];
  readonly getSkyPreset: (id: unknown) => import("../studio-background-3d-sky").BgSkyPreset;
  readonly fogNear: number;
  readonly fogSliderMax: number;
  readonly STUDIO_BG3D_FOG_MIN_GAP: number;
  readonly fogFar: number;
  readonly Scissors: typeof import("lucide-react").Scissors;
  readonly sectionPlane: StudioBg3dSectionPlaneState;
  readonly setSectionPlane: import("react").Dispatch<import("react").SetStateAction<StudioBg3dSectionPlaneState>>;
  readonly STUDIO_BG3D_SECTION_AXES: readonly ["x", "y", "z"];
  readonly STUDIO_BG3D_SECTION_AXIS_LABELS: Record<"x" | "y" | "z", string>;
  readonly STUDIO_BG3D_SECTION_OFFSET_LIMIT: number;
  readonly scaleGuideVisible: boolean;
  readonly setScaleGuideVisible: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  readonly Ruler: typeof import("lucide-react").Ruler;
}

export interface StudioBg3dViewPanelProps {
  readonly hidden: boolean;
  readonly context: StudioBg3dViewPanelContext;
  readonly enginePlan: StudioBg3dEngineSelectionPlan;
  readonly enginePreference: StudioBg3dEnginePreference;
  readonly engineInAppBrowser: StudioBg3dInAppBrowserProfile;
  readonly engineProbing: boolean;
  readonly engineDeviceLostMessage: string | null;
  readonly engineFrameTimeMs: number | null;
  readonly onEnginePreferenceChange: (preference: StudioBg3dEnginePreference) => void;
  readonly babylonDiagnosticState: StudioBg3dBabylonDiagnosticState;
  readonly onRunBabylonDiagnostic: (
    backend: StudioBg3dBabylonDiagnosticBackend,
  ) => void;
  readonly onUseCurrentFrameAsAiReference?: () => void;
  readonly aiReferenceBusy?: boolean;
  readonly aiReferenceDisabled?: boolean;
}

export interface StudioBg3dAiReferenceActionProps {
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onUseCurrentFrameAsAiReference: () => void;
  readonly CameraIcon: typeof import("lucide-react").Camera;
  readonly LoaderIcon: typeof import("lucide-react").Loader2;
}

export function StudioBg3dAiReferenceAction({
  busy = false,
  disabled = false,
  onUseCurrentFrameAsAiReference,
  CameraIcon,
  LoaderIcon,
}: StudioBg3dAiReferenceActionProps) {
  const descriptionId = useId();
  const locked = disabled || busy;
  const description = busy
    ? "현재 프레임을 구도 참조로 보내고 있습니다. 실제 AI 호출은 다음 검토 화면에서 확인을 마친 뒤에만 시작됩니다."
    : disabled
      ? "현재 상태에서는 프레임을 구도 참조로 보낼 수 없습니다. 실제 AI 호출은 다음 검토 화면에서 확인을 마친 뒤에만 시작됩니다."
      : "현재 프레임을 구도 참조로 보냅니다. 실제 AI 호출은 다음 검토 화면에서 확인을 마친 뒤에만 시작됩니다.";

  return (
    <div className="mt-3 border-t border-line/70 pt-3">
      <button
        type="button"
        aria-label={busy ? "현재 샷으로 AI 시안 준비 중" : "현재 샷으로 AI 시안"}
        aria-busy={busy}
        aria-describedby={descriptionId}
        disabled={locked}
        onClick={onUseCurrentFrameAsAiReference}
        className={cx(
          CONTROL_BUTTON,
          "w-full border-cool/50 bg-card text-fg hover:bg-raised hover:text-cool",
        )}
      >
        {busy ? (
          <LoaderIcon
            size={14}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        ) : (
          <CameraIcon size={14} aria-hidden />
        )}
        현재 샷으로 AI 시안
      </button>
      <p
        id={descriptionId}
        className="mt-1.5 text-[0.68rem] leading-relaxed text-fg-3"
      >
        {description}
      </p>
    </div>
  );
}

export interface StudioBg3dBabylonDiagnosticProps {
  readonly state: StudioBg3dBabylonDiagnosticState;
  readonly onRun: (backend: StudioBg3dBabylonDiagnosticBackend) => void;
}

const BABYLON_DIAGNOSTIC_BACKEND_LABELS: Readonly<
  Record<StudioBg3dBabylonDiagnosticBackend, string>
> = Object.freeze({
  webgl2: "WebGL2",
  webgpu: "WebGPU",
});

export function StudioBg3dBabylonDiagnostic({
  state,
  onRun,
}: StudioBg3dBabylonDiagnosticProps) {
  const descriptionId = useId();
  const statusId = useId();
  const running = state.status === "loading";
  const statusBackend =
    state.backend === null ? null : BABYLON_DIAGNOSTIC_BACKEND_LABELS[state.backend];
  const statusText =
    state.status === "idle"
      ? "진단을 실행하기 전에는 Babylon 코드와 GPU 컨텍스트를 불러오지 않습니다."
      : state.status === "loading"
        ? `Babylon ${statusBackend} 진단을 준비하고 있습니다.`
        : state.status === "success"
          ? `Babylon ${statusBackend} 진단 완료 · ${Math.max(1, Math.round(state.durationMs))}ms`
          : state.message;
  const statusTone =
    state.status === "error"
      ? "border-danger/45 bg-danger/10 text-danger"
      : state.status === "success"
        ? "border-accent/45 bg-accent-soft text-accent"
        : "border-line bg-panel/70 text-fg-3";

  return (
    <section
      aria-labelledby={descriptionId}
      className="mt-5 border-t border-line pt-4"
    >
      <div className="rounded-xl border border-line bg-card/70 p-3 shadow-sm">
        <div className="flex items-start gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent-soft text-accent"
            aria-hidden
          >
            <Cpu size={16} />
          </span>
          <div className="min-w-0">
            <h3 id={descriptionId} className="text-xs font-bold text-fg">
              Babylon 렌더 진단
            </h3>
            <p className="mt-1 text-[0.72rem] leading-relaxed text-fg-3">
              분리된 64px 캔버스에서 엔진과 실제 컬러(beauty)·깊이(depth)·
              법선(normal)·객체 ID·재질 ID 패스를 확인합니다. 현재 3D 편집기나 최종
              렌더러를 전환하지 않으며, 선택한 백엔드가 실패해도 다른 백엔드를 자동
              실행하지 않습니다.
            </p>
          </div>
        </div>

        <div
          className="mt-3 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2"
          role="group"
          aria-label="Babylon 진단 백엔드"
          aria-describedby={statusId}
        >
          {(["webgl2", "webgpu"] as const).map((backend) => {
            const backendLabel = BABYLON_DIAGNOSTIC_BACKEND_LABELS[backend];
            const isCurrent = state.backend === backend;
            const isLoading = running && isCurrent;
            const isRetry = state.status === "error" && isCurrent;
            return (
              <button
                key={backend}
                type="button"
                data-testid={`studio-bg3d-babylon-diagnostic-${backend}`}
                aria-label={`Babylon ${backendLabel} 진단 실행`}
                aria-busy={isLoading}
                disabled={running}
                onClick={() => onRun(backend)}
                className={cx(
                  CONTROL_BUTTON,
                  "min-h-11 w-full border-line bg-panel px-3 text-fg-2 hover:border-accent/50 hover:bg-raised hover:text-fg",
                  state.status === "success" &&
                    isCurrent &&
                    "border-accent/45 bg-accent-soft text-accent",
                  isRetry && "border-danger/45 bg-danger/10 text-danger",
                )}
              >
                {isLoading ? (
                  <Loader2
                    size={14}
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                ) : isRetry ? (
                  <RotateCcw size={14} aria-hidden />
                ) : (
                  <Cpu size={14} aria-hidden />
                )}
                {isLoading
                  ? `${backendLabel} 확인 중`
                  : isRetry
                    ? `${backendLabel} 다시 진단`
                    : `${backendLabel} 진단`}
              </button>
            );
          })}
        </div>

        <div
          id={statusId}
          data-testid="studio-bg3d-babylon-diagnostic-status"
          role={state.status === "error" ? "alert" : "status"}
          aria-live={state.status === "error" ? "assertive" : "polite"}
          className={cx(
            "mt-2 flex min-h-11 items-start gap-2 rounded-lg border px-2.5 py-2 text-[0.72rem] leading-relaxed",
            statusTone,
          )}
        >
          {state.status === "success" ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />
          ) : state.status === "error" ? (
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          ) : state.status === "loading" ? (
            <Loader2
              size={14}
              className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : (
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-fg-3" aria-hidden />
          )}
          <span>{statusText}</span>
        </div>
      </div>
    </section>
  );
}

export function StudioBg3dViewPanel({
  hidden,
  context,
  enginePlan,
  enginePreference,
  engineInAppBrowser,
  engineProbing,
  engineDeviceLostMessage,
  engineFrameTimeMs,
  onEnginePreferenceChange,
  babylonDiagnosticState,
  onRunBabylonDiagnostic,
  onUseCurrentFrameAsAiReference,
  aiReferenceBusy = false,
  aiReferenceDisabled = false,
}: StudioBg3dViewPanelProps) {
  const {
    VIEW_EDITOR_SECTIONS,
    viewEditorSection,
    setViewEditorSection,
    StudioBg3dPhysicsPanel,
    physicsStartButtonRef,
    selectedIds,
    physicsDurationSeconds,
    physicsGravityPreset,
    physicsGroundEnabled,
    physicsPhase,
    physicsProgress,
    physicsSelectionUnavailableReason,
    physicsError,
    setPhysicsDurationSeconds,
    setPhysicsGravityPreset,
    setPhysicsGroundEnabled,
    handleStartPhysicsPreview,
    Camera,
    sceneBaseDocument,
    STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS,
    shotNameDraft,
    isCapturing,
    isRestoringScene,
    physicsInteractionLocked,
    setShotNameDraft,
    captureCurrentShot,
    duplicateActiveShot,
    Copy,
    shotBatchSelectedIds,
    savedShots,
    setShotBatchExcludedIds,
    shotBatchExportHeight,
    setShotBatchExportHeight,
    LT_EXPORT_HEIGHTS,
    selectedShotBatchPasses,
    STUDIO_BG3D_SHOT_BATCH_PASSES,
    shotBatchPasses,
    setShotBatchPasses,
    STUDIO_BG3D_SHOT_BATCH_PASS_LABELS,
    shotBatchIncludeLayeredPsd,
    setShotBatchIncludeLayeredPsd,
    shotBatchIncludeContactSheet,
    setShotBatchIncludeContactSheet,
    recoveryScope,
    shotBatchBlockedReason,
    exportSavedShotsAsZip,
    isBatchRenderingShots,
    Loader2,
    Save,
    shotBatchRecoverySummary,
    shotBatchProgress,
    shotBatchExcludedIds,
    applySavedShot,
    moveSavedShot,
    removeSavedShot,
    Trash2,
    CAMERA_PRESETS,
    applyCameraPreset,
    zoomCameraBy,
    ZoomIn,
    ZoomOut,
    Aperture,
    isMainOrtho,
    LtRangeControl,
    STUDIO_BG3D_LENS_MIN_FOCAL_MM,
    STUDIO_BG3D_LENS_MAX_FOCAL_MM,
    currentFocalLengthMm,
    updateCameraLens,
    previewCameraLens,
    finishCameraLensGesture,
    studioBg3dFocalLengthToFovDegrees,
    STUDIO_BG3D_LENS_PRESETS,
    LtToggleRow,
    twoPointPerspectiveActive,
    applyTwoPointPerspective,
    resetTwoPointPerspective,
    RotateCcw,
    lineArtPreview,
    setLineArtPreview,
    transparentInsert,
    updateBackgroundTransparency,
    SunMoon,
    STUDIO_BG3D_MOOD_RIGS,
    appliedMoodRig,
    applyMoodRig,
    updateLightingSettings,
    updateRenderExposure,
    sunLightState,
    STUDIO_BG3D_SUN_TIME_PRESETS,
    sunRigConfig,
    applySunRigConfig,
    formatBg3dSunTime,
    Globe,
    BG_SKY_PRESETS,
    skyPresetId,
    updateBackgroundSettings,
    selectedSky,
    panoramaRotation,
    normalizePanoramaRotationDegrees,
    PanoramaRotationNumberField,
    CircleDashed,
    STUDIO_BG3D_FOG_PRESETS,
    getSkyPreset,
    fogNear,
    fogSliderMax,
    STUDIO_BG3D_FOG_MIN_GAP,
    fogFar,
    Scissors,
    sectionPlane,
    setSectionPlane,
    STUDIO_BG3D_SECTION_AXES,
    STUDIO_BG3D_SECTION_AXIS_LABELS,
    STUDIO_BG3D_SECTION_OFFSET_LIMIT,
    scaleGuideVisible,
    setScaleGuideVisible,
    Ruler,
  } = context;
  const cameraControlsDisabled =
    isCapturing || isBatchRenderingShots || isRestoringScene || physicsInteractionLocked;
  const aiReferenceActionDisabled =
    aiReferenceDisabled || cameraControlsDisabled;
  const currentNearClip = resolveStudioBg3dCameraNearClip(
    sceneBaseDocument.camera.nearClip,
  );
  const currentNearClipLog = Math.log10(currentNearClip);
  const currentDutchRollDegrees = Math.round(
    readStudioBg3dCameraDutchRollDegrees(sceneBaseDocument.camera),
  );

  return (
<section hidden={hidden}>
                <div
                  role="tablist"
                  aria-label="보기 도구"
                  className="mb-4 grid grid-cols-3 gap-1 rounded-xl border border-line bg-card/70 p-1"
                >
                  {VIEW_EDITOR_SECTIONS.map((section, sectionIndex) => {
                    const active = viewEditorSection === section.id;
                    return (
                      <button
                        key={section.id}
                        id={`bg3d-view-tab-${section.id}`}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-controls={`bg3d-view-section-${section.id}`}
                        tabIndex={active ? 0 : -1}
                        onClick={() => setViewEditorSection(section.id)}
                        onKeyDown={(event) => {
                          let nextIndex: number;
                          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                            nextIndex = (sectionIndex + 1) % VIEW_EDITOR_SECTIONS.length;
                          } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                            nextIndex = (sectionIndex - 1 + VIEW_EDITOR_SECTIONS.length) % VIEW_EDITOR_SECTIONS.length;
                          } else if (event.key === "Home") {
                            nextIndex = 0;
                          } else if (event.key === "End") {
                            nextIndex = VIEW_EDITOR_SECTIONS.length - 1;
                          } else {
                            return;
                          }
                          event.preventDefault();
                          const nextSection = VIEW_EDITOR_SECTIONS[nextIndex]!;
                          setViewEditorSection(nextSection.id);
                          requestAnimationFrame(() => {
                            document.getElementById(`bg3d-view-tab-${nextSection.id}`)?.focus();
                          });
                        }}
                        className={cx(
                          "min-h-11 rounded-lg px-2 text-[0.68rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:min-h-9",
                          active
                            ? "bg-accent text-on-accent shadow-sm"
                            : "text-fg-3 hover:bg-raised hover:text-fg",
                        )}
                      >
                        {section.label}
                      </button>
                    );
                  })}
                </div>

                <div
                  id="bg3d-view-section-prosuite"
                  role="tabpanel"
                  aria-labelledby="bg3d-view-tab-prosuite"
                  hidden={viewEditorSection !== "prosuite"}
                >
                  <StudioBg3dProSuitePanel disabled={isCapturing || isRestoringScene} />
                </div>

                <div
                  id="bg3d-view-section-physics"
                  role="tabpanel"
                  aria-labelledby="bg3d-view-tab-physics"
                  hidden={viewEditorSection !== "physics"}
                >
                  <StudioBg3dPhysicsPanel
                    startButtonRef={physicsStartButtonRef}
                    selectedCount={selectedIds.size}
                    durationSeconds={physicsDurationSeconds}
                    gravityPreset={physicsGravityPreset}
                    groundEnabled={physicsGroundEnabled}
                    phase={physicsPhase}
                    progress={physicsProgress}
                    unavailableReason={physicsSelectionUnavailableReason}
                    errorMessage={physicsError}
                    onDurationChange={setPhysicsDurationSeconds}
                    onGravityPresetChange={setPhysicsGravityPreset}
                    onGroundEnabledChange={setPhysicsGroundEnabled}
                    onStart={handleStartPhysicsPreview}
                  />
                </div>

                <div
                  id="bg3d-view-section-camera"
                  role="tabpanel"
                  aria-labelledby="bg3d-view-tab-camera"
                  hidden={viewEditorSection !== "camera"}
                >
                  <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-fg">
                  <Camera size={15} className="text-accent" aria-hidden />
                  카메라
                  </h3>

                <div className="mb-5 rounded-xl border border-line bg-card/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-fg">컷 · 샷 보드</h4>
                      <p className="mt-0.5 text-[0.66rem] leading-relaxed text-fg-3">
                        카메라, 오브젝트 표시, 조명, 배경과 LT 설정을 한 장면 안에 기록합니다.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-line bg-raised px-2 py-1 text-[0.62rem] font-semibold tabular-nums text-fg-3">
                      {sceneBaseDocument.shots?.length ?? 0}/{STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS}
                    </span>
                  </div>

                  <label className="mt-3 block text-[0.68rem] font-semibold text-fg-2">
                    컷 이름
                    <input
                      type="text"
                      value={shotNameDraft}
                      maxLength={80}
                      disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                      placeholder={`컷 ${(sceneBaseDocument.shots?.length ?? 0) + 1}`}
                      onChange={(event) => setShotNameDraft(event.target.value)}
                      className="mt-1 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-xs text-fg placeholder:text-fg-3 focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
                    />
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className={cx(CONTROL_BUTTON, "border-accent bg-accent text-on-accent hover:opacity-90")}
                      disabled={
                        isCapturing ||
                        isRestoringScene ||
                        physicsInteractionLocked ||
                        (sceneBaseDocument.shots?.length ?? 0) >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS
                      }
                      onClick={captureCurrentShot}
                    >
                      <Camera size={14} aria-hidden />
                      현재 컷 기록
                    </button>
                    <button
                      type="button"
                      className={cx(CONTROL_BUTTON, "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
                      disabled={
                        isCapturing ||
                        isRestoringScene ||
                        physicsInteractionLocked ||
                        !sceneBaseDocument.activeShotId ||
                        (sceneBaseDocument.shots?.length ?? 0) >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS
                      }
                      onClick={duplicateActiveShot}
                    >
                      <Copy size={14} aria-hidden />
                      선택 컷 복제
                    </button>
                  </div>
                  {onUseCurrentFrameAsAiReference ? (
                    <StudioBg3dAiReferenceAction
                      busy={aiReferenceBusy}
                      disabled={aiReferenceActionDisabled}
                      onUseCurrentFrameAsAiReference={onUseCurrentFrameAsAiReference}
                      CameraIcon={Camera}
                      LoaderIcon={Loader2}
                    />
                  ) : null}
                  <div className="mt-3 rounded-lg border border-line bg-panel/70 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[0.66rem] font-bold text-fg-2">
                        배치 대상 {shotBatchSelectedIds.length}/{savedShots.length}컷
                      </span>
                      <span className="flex gap-1">
                        <button
                          type="button"
                          className="min-h-11 min-w-11 rounded-md border border-line bg-card px-2 text-[0.62rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 sm:min-h-8 sm:min-w-0"
                          disabled={isCapturing || savedShots.length === 0}
                          onClick={() => setShotBatchExcludedIds(new Set())}
                        >
                          전체
                        </button>
                        <button
                          type="button"
                          className="min-h-11 min-w-11 rounded-md border border-line bg-card px-2 text-[0.62rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40 sm:min-h-8 sm:min-w-0"
                          disabled={isCapturing || savedShots.length === 0}
                          onClick={() => setShotBatchExcludedIds(new Set(savedShots.map(({ id }) => id)))}
                        >
                          해제
                        </button>
                      </span>
                    </div>
                    <label className="mt-2 flex min-h-10 items-center justify-between gap-2 border-t border-line/70 pt-2 text-[0.62rem] font-semibold text-fg-3">
                      배치 출력 최대 높이
                      <select
                        value={String(shotBatchExportHeight)}
                        disabled={isCapturing}
                        onChange={(event) => setShotBatchExportHeight(
                          event.target.value === "per-shot"
                            ? "per-shot"
                            : Number(event.target.value),
                        )}
                        className="min-h-11 rounded-lg border border-line bg-card px-2 text-[0.64rem] text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
                      >
                        <option value="per-shot">컷별 저장 최대값</option>
                        {LT_EXPORT_HEIGHTS.map((height) => (
                          <option key={height} value={height}>{height.toLocaleString()} px 최대</option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="mt-2">
                      <legend className="text-[0.62rem] font-semibold text-fg-3">
                        PNG 렌더 패스 {selectedShotBatchPasses.length}/{STUDIO_BG3D_SHOT_BATCH_PASSES.length}
                      </legend>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {STUDIO_BG3D_SHOT_BATCH_PASSES.map((pass) => (
                          <label
                            key={pass}
                            className={cx(
                              "flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[0.62rem] font-semibold sm:min-h-9",
                              shotBatchPasses.has(pass)
                                ? "border-accent/60 bg-accent-soft text-accent"
                                : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
                              isCapturing && "cursor-not-allowed opacity-45",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={shotBatchPasses.has(pass)}
                              disabled={isCapturing}
                              onChange={(event) => setShotBatchPasses((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(pass);
                                else next.delete(pass);
                                return next;
                              })}
                              className="size-3.5 accent-accent"
                            />
                            {STUDIO_BG3D_SHOT_BATCH_PASS_LABELS[pass]}
                          </label>
                        ))}
                      </div>
                      <label className="mt-2 flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-line bg-card px-2.5 py-2 text-[0.62rem] text-fg-2">
                        <input
                          type="checkbox"
                          checked={shotBatchIncludeLayeredPsd}
                          disabled={isCapturing}
                          onChange={(event) => setShotBatchIncludeLayeredPsd(event.target.checked)}
                          className="mt-0.5 size-3.5 accent-accent"
                        />
                        <span>
                          컷별 레이어 PSD도 포함
                          <span className="mt-0.5 block font-normal leading-relaxed text-fg-3">
                            LT 레이어가 1080p급·합계 8.4Mpx 안일 때 Worker에서 생성합니다. 초과 시 PNG는
                            유지하고 manifest에 예산 fallback을 기록합니다.
                          </span>
                        </span>
                      </label>
                      <label className="mt-2 flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-line bg-card px-2.5 py-2 text-[0.62rem] text-fg-2">
                        <input
                          type="checkbox"
                          checked={shotBatchIncludeContactSheet}
                          disabled={isCapturing}
                          onChange={(event) => setShotBatchIncludeContactSheet(event.target.checked)}
                          className="mt-0.5 size-3.5 accent-accent"
                        />
                        <span>
                          컷 검수용 콘택트 시트 포함
                          <span className="mt-0.5 block font-normal leading-relaxed text-fg-3">
                            컷당 LT 합성·원본·분리 패스 순으로 대표 PNG를 고르고, Worker에서 12컷씩
                            검수 시트를 만듭니다. 미지원 브라우저에서는 PNG 패키지만 유지합니다.
                          </span>
                        </span>
                      </label>
                    </fieldset>
                  </div>
                  <button
                    type="button"
                    className={cx(CONTROL_BUTTON, "mt-2 w-full border-line bg-panel text-fg-2 hover:bg-raised hover:text-fg")}
                    disabled={
                      recoveryScope === null ||
                      shotBatchBlockedReason !== null ||
                      shotBatchSelectedIds.length === 0 ||
                      selectedShotBatchPasses.length === 0
                    }
                    onClick={() => void exportSavedShotsAsZip()}
                  >
                    {isBatchRenderingShots ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <Save size={14} aria-hidden />
                    )}
                    {shotBatchRecoverySummary ? "보존 작업 확인 · " : ""}
                    선택 {shotBatchSelectedIds.length}컷 · {selectedShotBatchPasses.length}패스
                    {shotBatchIncludeContactSheet ? " + 콘택트" : ""}
                    {shotBatchIncludeLayeredPsd ? " + PSD" : ""} ZIP
                  </button>
                  <p className="mt-1.5 text-[0.62rem] leading-relaxed text-fg-3">
                    한 번의 GPU 캡처에서 원본·LT 분리 레이어·깊이를 만들고, 꺼진 레이어는 manifest에
                    생략 사유를 기록합니다. 기기 예산으로 축소되면 artifact에 요청/실제 높이를 함께
                    기록합니다. 최대 64컷·448 PNG·64 PSD·콘택트 6장(장당 12컷)·384 MiB입니다.
                  </p>
                  {shotBatchRecoverySummary ? (
                    <p className="mt-1.5 rounded-lg border border-accent/35 bg-accent-soft px-2.5 py-2 text-[0.62rem] leading-relaxed text-accent">
                      완료된 {shotBatchRecoverySummary.completedShots}/{shotBatchRecoverySummary.totalShots}컷을
                      {shotBatchRecoverySummary.mode === "durable"
                        ? " 브라우저 복구 저장소에"
                        : " 현재 탭 메모리에"} 보존했습니다. 장면·선택·패스·해상도·엔진 및 캡처
                      프로필까지 같아 새 계획의 digest가 일치할 때만 완료 컷을 재사용합니다.
                      {shotBatchRecoverySummary.downloadRequested
                        ? shotBatchRecoverySummary.mode === "durable"
                          ? " 다운로드 요청 뒤에도 이 브라우저에서 최대 24시간 검증된 artifact를 다시 패키징할 수 있습니다."
                          : " 다운로드 요청 뒤 현재 탭을 유지하는 동안 최대 24시간 다시 패키징할 수 있습니다. 새로고침하거나 탭을 닫으면 사라집니다."
                        : ""}
                      {shotBatchRecoverySummary.degradedReason
                        ? ` ${shotBatchRecoverySummary.degradedReason} 새로고침 전에 ZIP을 저장해 주세요.`
                        : ""}
                    </p>
                  ) : null}
                  {shotBatchProgress ? (
                    <div className="mt-2 rounded-lg border border-line bg-panel px-2.5 py-2" role="status" aria-live="polite">
                      <div className="flex items-center justify-between gap-2 text-[0.64rem] text-fg-3">
                        <span className="min-w-0 truncate">
                          {shotBatchProgress.stage === "render"
                            ? "렌더"
                            : shotBatchProgress.stage === "contact"
                              ? "콘택트"
                              : "패키지"} · {shotBatchProgress.label}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {shotBatchProgress.completed}/{shotBatchProgress.total}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                        <div
                          className="h-full rounded-full bg-accent transition-[width]"
                          style={{
                            width: `${Math.round(
                              (shotBatchProgress.completed / Math.max(1, shotBatchProgress.total)) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {(sceneBaseDocument.shots?.length ?? 0) > 0 ? (
                    <ul
                      aria-label="저장된 컷"
                      className="mt-3 max-h-48 space-y-1 overflow-y-auto overscroll-contain pr-1"
                    >
                      {sceneBaseDocument.shots?.map((shot, index) => {
                        const active = sceneBaseDocument.activeShotId === shot.id;
                        return (
                          <li key={shot.id} className="flex items-stretch gap-1">
                            <label className="grid min-h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg border border-transparent hover:border-line hover:bg-raised sm:min-h-9 sm:w-8">
                              <span className="sr-only">{shot.name} 배치 렌더 선택</span>
                              <input
                                type="checkbox"
                                aria-label={`${shot.name} 배치 렌더 선택`}
                                checked={!shotBatchExcludedIds.has(shot.id)}
                                disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                                onChange={(event) => setShotBatchExcludedIds((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.delete(shot.id);
                                  else next.add(shot.id);
                                  return next;
                                })}
                                className="size-4 accent-accent"
                              />
                            </label>
                            <button
                              type="button"
                              aria-current={active ? "true" : undefined}
                              disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                              onClick={() => applySavedShot(shot.id)}
                              className={cx(
                                "flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors sm:min-h-9",
                                active
                                  ? "border-accent/60 bg-accent-soft font-bold text-accent"
                                  : "border-transparent text-fg-2 hover:border-line hover:bg-raised hover:text-fg",
                              )}
                            >
                              <span className="w-5 shrink-0 text-right text-[0.62rem] tabular-nums text-fg-3">
                                {index + 1}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{shot.name}</span>
                              {active ? (
                                <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[0.56rem] font-bold text-on-accent">
                                  마지막 선택
                                </span>
                              ) : null}
                            </button>
                            <div className="flex shrink-0 items-stretch overflow-hidden rounded-lg border border-line bg-card">
                              <button
                                type="button"
                                aria-label={`${shot.name} 위로 이동`}
                                title="위로 이동"
                                disabled={
                                  index === 0 ||
                                  isCapturing ||
                                  isRestoringScene ||
                                  physicsInteractionLocked
                                }
                                onClick={() => moveSavedShot(shot.id, index - 1)}
                                className="grid min-h-11 w-11 place-items-center border-r border-line text-xs font-bold text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-9 sm:w-9"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`${shot.name} 아래로 이동`}
                                title="아래로 이동"
                                disabled={
                                  index === (sceneBaseDocument.shots?.length ?? 0) - 1 ||
                                  isCapturing ||
                                  isRestoringScene ||
                                  physicsInteractionLocked
                                }
                                onClick={() => moveSavedShot(shot.id, index + 1)}
                                className="grid min-h-11 w-11 place-items-center border-r border-line text-xs font-bold text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-9 sm:w-9"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                aria-label={`${shot.name} 삭제`}
                                title="삭제 · 실행 취소 가능"
                                disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                                onClick={() => removeSavedShot(shot.id)}
                                className="grid min-h-11 w-11 place-items-center text-fg-3 hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-35 sm:min-h-9 sm:w-9"
                              >
                                <Trash2 size={13} aria-hidden />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-2.5 text-center text-[0.66rem] leading-relaxed text-fg-3">
                      원하는 구도를 만든 뒤 현재 컷을 기록하세요. 같은 3D 장면에서 여러 웹툰 칸을 빠르게 오갈 수 있습니다.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(CAMERA_PRESETS).map(([id, preset]) => (
                    <button
                      key={id}
                      type="button"
                      className={cx(CONTROL_BUTTON, "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
                      disabled={isCapturing || isBatchRenderingShots || isRestoringScene || physicsInteractionLocked}
                      onClick={() => applyCameraPreset(id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    className={cx(CONTROL_BUTTON, "flex-1 border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
                    disabled={isCapturing || isBatchRenderingShots || isRestoringScene || physicsInteractionLocked}
                    onClick={() => zoomCameraBy(0.82)}
                  >
                    <ZoomIn size={14} aria-hidden />
                    확대
                  </button>
                  <button
                    type="button"
                    className={cx(CONTROL_BUTTON, "flex-1 border-line bg-card text-fg-2 hover:bg-raised hover:text-fg")}
                    disabled={isCapturing || isBatchRenderingShots || isRestoringScene || physicsInteractionLocked}
                    onClick={() => zoomCameraBy(1.22)}
                  >
                    <ZoomOut size={14} aria-hidden />
                    축소
                  </button>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                      <Aperture size={15} className="text-accent" aria-hidden />
                      렌즈 · 투영
                    </h3>
                    <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.62rem] font-semibold text-fg-3">
                      35mm 환산
                    </span>
                  </div>
                  <div
                    className={cx(
                      "rounded-xl border border-line bg-card/70 px-3 py-2",
                      isMainOrtho && "opacity-45",
                    )}
                  >
                    <LtRangeControl
                      id="bg3d-lens-focal"
                      label="초점거리"
                      min={STUDIO_BG3D_LENS_MIN_FOCAL_MM}
                      max={STUDIO_BG3D_LENS_MAX_FOCAL_MM}
                      step={1}
                      value={currentFocalLengthMm}
                      valueText={`${currentFocalLengthMm}mm · ${Math.round(sceneBaseDocument.camera.fovDegrees)}°`}
                      disabled={isCapturing || isBatchRenderingShots || isRestoringScene || physicsInteractionLocked || isMainOrtho}
                      onChange={(focalLengthMm) => previewCameraLens(() => ({
                        fovDegrees: studioBg3dFocalLengthToFovDegrees(focalLengthMm),
                      }))}
                      onChangeEnd={finishCameraLensGesture}
                    />
                    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="렌즈 프리셋">
                      {STUDIO_BG3D_LENS_PRESETS.map((preset) => (
                        <button
                          key={preset.focalLengthMm}
                          type="button"
                          aria-pressed={currentFocalLengthMm === preset.focalLengthMm}
                          disabled={isCapturing || isBatchRenderingShots || isRestoringScene || physicsInteractionLocked || isMainOrtho}
                          className={cx(
                            "rounded-full border border-line bg-card px-2.5 py-1 text-[0.64rem] font-semibold text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                            currentFocalLengthMm === preset.focalLengthMm &&
                              "border-accent/60 bg-accent-soft text-accent",
                          )}
                          onClick={() => updateCameraLens(() => ({
                            fovDegrees: studioBg3dFocalLengthToFovDegrees(preset.focalLengthMm),
                          }))}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <LtToggleRow
                    label="직교 투영(설계도·아이소메트릭)"
                    checked={isMainOrtho}
                    disabled={cameraControlsDisabled}
                    onChange={(orthographic) => updateCameraLens(() => ({
                      projection: orthographic ? "orthographic" : "perspective",
                    }))}
                  />

                  <div className="mt-2 rounded-xl border border-line bg-card/70 px-3 py-2">
                    <LtRangeControl
                      id="bg3d-camera-near-clip"
                      label="근접 절단"
                      min={Math.log10(STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP)}
                      max={Math.log10(STUDIO_BG3D_CAMERA_MAX_NEAR_CLIP)}
                      step={0.01}
                      value={currentNearClipLog}
                      valueText={`${round(currentNearClip, currentNearClip < 1 ? 3 : 2)}m`}
                      disabled={cameraControlsDisabled}
                      onChange={(logValue) => {
                        const nearClip = Math.min(
                          STUDIO_BG3D_CAMERA_MAX_NEAR_CLIP,
                          Math.max(
                            STUDIO_BG3D_CAMERA_MIN_NEAR_CLIP,
                            Number((10 ** logValue).toPrecision(6)),
                          ),
                        );
                        previewCameraLens(() => ({ nearClip }));
                      }}
                      onChangeEnd={finishCameraLensGesture}
                    />
                    <LtRangeControl
                      id="bg3d-camera-dutch-roll"
                      label="더치 앵글"
                      min={STUDIO_BG3D_CAMERA_MIN_DUTCH_ROLL_DEGREES}
                      max={STUDIO_BG3D_CAMERA_MAX_DUTCH_ROLL_DEGREES}
                      step={1}
                      value={currentDutchRollDegrees}
                      valueText={`${currentDutchRollDegrees}°`}
                      disabled={cameraControlsDisabled}
                      onChange={(degrees) => previewCameraLens((view) => {
                        const up = createStudioBg3dCameraUpForDutchRoll(view, degrees);
                        return up ? { up } : {};
                      })}
                      onChangeEnd={finishCameraLensGesture}
                    />
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={
                          cameraControlsDisabled ||
                          currentNearClip === STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP
                        }
                        className={cx(
                          CONTROL_BUTTON,
                          "border-line bg-panel px-2 text-fg-2 hover:bg-raised hover:text-fg",
                        )}
                        onClick={() => updateCameraLens(() => ({
                          nearClip: STUDIO_BG3D_CAMERA_DEFAULT_NEAR_CLIP,
                        }))}
                      >
                        <RotateCcw size={14} aria-hidden />
                        절단 초기화
                      </button>
                      <button
                        type="button"
                        disabled={cameraControlsDisabled || currentDutchRollDegrees === 0}
                        className={cx(
                          CONTROL_BUTTON,
                          "border-line bg-panel px-2 text-fg-2 hover:bg-raised hover:text-fg",
                        )}
                        onClick={() => updateCameraLens((view) => {
                          const up = createStudioBg3dCameraUpForDutchRoll(view, 0);
                          return up ? { up } : {};
                        })}
                      >
                        <RotateCcw size={14} aria-hidden />
                        수평 맞춤
                      </button>
                    </div>
                    <p className="mt-2 text-[0.64rem] leading-relaxed text-fg-3">
                      근접 절단은 카메라 앞의 벽·천장을 잘라 실내 구도를 확보합니다. 더치 앵글은
                      화면만 기울이며 컷 저장·실행 취소·LT 내보내기에 그대로 유지됩니다.
                    </p>
                  </div>

                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <button
                      type="button"
                      aria-pressed={twoPointPerspectiveActive}
                      disabled={isCapturing || isBatchRenderingShots || isRestoringScene || physicsInteractionLocked || isMainOrtho}
                      className={cx(
                        CONTROL_BUTTON,
                        "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                        twoPointPerspectiveActive && "border-accent/60 bg-accent-soft text-accent",
                      )}
                      onClick={applyTwoPointPerspective}
                    >
                      2점 투시 보정
                    </button>
                    <button
                      type="button"
                      disabled={
                        isCapturing || isBatchRenderingShots || isRestoringScene ||
                        physicsInteractionLocked || isMainOrtho || !twoPointPerspectiveActive
                      }
                      className={cx(CONTROL_BUTTON, "border-line bg-panel px-3 text-fg-2 hover:bg-raised hover:text-fg")}
                      onClick={resetTwoPointPerspective}
                    >
                      <RotateCcw size={14} aria-hidden />
                      해제
                    </button>
                  </div>
                  <p className="mt-1.5 text-[0.64rem] leading-relaxed text-fg-3">
                    올려다보거나 내려다보는 구도에서 수직선을 화면과 평행하게 세웁니다(건축 컷).
                    시선은 수평이 되고 원래 구도는 렌즈 시프트로 보존됩니다.
                  </p>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={lineArtPreview}
                      disabled={isCapturing}
                      onChange={(e) => setLineArtPreview(e.target.checked)}
                      className="mt-0.5 size-4 accent-accent"
                    />
                    <span className="block text-xs font-bold text-fg">
                      선화로 보기
                      <span className="mt-0.5 block text-[0.68rem] font-normal leading-relaxed text-fg-3">
                        화면용 선화 미리보기입니다. 실제 추가 시에는 LT 탭 설정으로 톤·재질선·주선을
                        각각 계산해 별도 레이어로 만듭니다.
                      </span>
                    </span>
                  </label>
                  <label className="mt-3 flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={transparentInsert}
                      disabled={isCapturing}
                      onChange={(e) => updateBackgroundTransparency(e.target.checked)}
                      className="mt-0.5 size-4 accent-accent"
                    />
                    <span className="block text-xs font-bold text-fg">
                      오브젝트 바깥을 투명하게 추출
                      <span className="mt-0.5 block text-[0.68rem] font-normal leading-relaxed text-fg-3">
                        하늘색을 LT 입력에서 빼고 건물·나무·도형의 알파 외곽을 또렷하게 잡습니다. 분리된
                        선·톤을 다른 배경 위에 겹칠 때 적합해요.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                      <SunMoon size={15} className="text-accent" aria-hidden />
                      시간대 · 무드 리그
                    </h3>
                    <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.62rem] font-semibold text-fg-3">
                      조명 연동
                    </span>
                  </div>
                  <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                    하늘·안개·키/필 조명·노출을 한 번에 바꿉니다. 버튼을 누를 때만 적용되며 이후 값은
                    개별 조정할 수 있습니다.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {STUDIO_BG3D_MOOD_RIGS.map((rig) => (
                      <button
                        key={rig.id}
                        type="button"
                        aria-pressed={appliedMoodRig?.id === rig.id}
                        disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                        title={rig.description}
                        className={cx(
                          CONTROL_BUTTON,
                          "justify-start gap-2 border-line bg-card text-left text-fg-2 hover:bg-raised hover:text-fg",
                          appliedMoodRig?.id === rig.id &&
                            "border-accent/60 bg-accent-soft text-accent",
                        )}
                        onClick={() => applyMoodRig(rig.id)}
                      >
                        <span
                          className="inline-block size-4 shrink-0 rounded-full border border-line/50 shadow-inner"
                          style={{ backgroundColor: rig.swatch }}
                          aria-hidden
                        />
                        <span className="truncate">{rig.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[0.66rem] leading-relaxed text-fg-3" aria-live="polite">
                    {appliedMoodRig?.description ??
                      "현재 하늘·안개·조명·노출 값은 개별 조정된 사용자 설정입니다."}
                  </p>
                </div>

                <StudioBg3dLightingStudio
                  lighting={sceneBaseDocument.lighting}
                  exposure={sceneBaseDocument.render.exposure}
                  disabled={
                    isCapturing || isBatchRenderingShots || isRestoringScene ||
                    physicsInteractionLocked
                  }
                  onUpdateLighting={updateLightingSettings}
                  onUpdateExposure={updateRenderExposure}
                />

                <div className="mt-5 border-t border-line pt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                      <SunMoon size={15} className="text-accent" aria-hidden />
                      태양 · 시간대 릭
                    </h3>
                    <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.62rem] font-semibold text-fg-3">
                      {sunLightState.mode === "sun" ? "태양광" : "달빛"}
                    </span>
                  </div>
                  <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                    시각과 방위각에서 태양 방향·색온도·하늘을 절차 계산해 조명에 기록합니다.
                    무드 리그와 달리 슬라이더로 연속 조정할 수 있어요.
                  </p>
                  <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="시간대 프리셋">
                    {STUDIO_BG3D_SUN_TIME_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={Math.abs(sunRigConfig.timeOfDayHours - preset.timeOfDayHours) < 0.01}
                        disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                        className={cx(
                          "rounded-full border border-line bg-card px-2.5 py-1 text-[0.64rem] font-semibold text-fg-3 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
                          Math.abs(sunRigConfig.timeOfDayHours - preset.timeOfDayHours) < 0.01 &&
                            "border-accent/60 bg-accent-soft text-accent",
                        )}
                        onClick={() => applySunRigConfig({ timeOfDayHours: preset.timeOfDayHours })}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="rounded-xl border border-line bg-card/70 px-3 py-2">
                    <LtRangeControl
                      id="bg3d-sun-time"
                      label="시각"
                      min={0}
                      max={24}
                      step={0.25}
                      value={sunRigConfig.timeOfDayHours}
                      valueText={formatBg3dSunTime(sunRigConfig.timeOfDayHours)}
                      disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                      onChange={(timeOfDayHours) => applySunRigConfig({ timeOfDayHours })}
                    />
                    <LtRangeControl
                      id="bg3d-sun-azimuth"
                      label="방위각"
                      min={-180}
                      max={180}
                      step={5}
                      value={sunRigConfig.azimuthDeg}
                      valueText={`${sunRigConfig.azimuthDeg}°`}
                      disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                      onChange={(azimuthDeg) => applySunRigConfig({ azimuthDeg })}
                    />
                    <LtToggleRow
                      label="태양 그림자(기기 성능에 따라 자동 제한)"
                      checked={sunRigConfig.shadowsEnabled}
                      disabled={isCapturing || isRestoringScene || physicsInteractionLocked}
                      onChange={(shadowsEnabled) => applySunRigConfig({ shadowsEnabled })}
                    />
                  </div>
                  <p className="mt-1.5 text-[0.64rem] leading-relaxed text-fg-3" aria-live="polite">
                    {sunLightState.mode === "sun"
                      ? `태양 고도 ${Math.round(sunLightState.sunElevationDeg)}° · 색온도 ${Math.round(sunLightState.colorTemperatureK)}K`
                      : "지평선 아래 — 달빛과 야간 하늘로 전환되었습니다."}
                  </p>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                      <Globe size={15} className="text-accent" aria-hidden />
                      360° 환경 배경
                    </h3>
                    <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.62rem] font-semibold text-fg-3">
                      절차적 생성
                    </span>
                  </div>
                  <p className="mb-2.5 text-[0.68rem] leading-relaxed text-fg-3">
                    외부 이미지 없이 생성되어 장면과 함께 안전하게 재현됩니다. 투명 추출에서는 빠지고,
                    불투명 LT 톤에는 현재 보이는 환경이 포함됩니다.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {BG_SKY_PRESETS.map((sky) => (
                      <button
                        key={sky.id}
                        type="button"
                        aria-pressed={skyPresetId === sky.id}
                        disabled={isCapturing}
                        title={sky.description}
                        className={cx(
                          CONTROL_BUTTON,
                          "justify-start gap-2 border-line bg-card text-left text-fg-2 hover:bg-raised hover:text-fg",
                          skyPresetId === sky.id && "border-accent/60 bg-accent-soft text-accent"
                        )}
                        onClick={() => {
                          updateBackgroundSettings({
                            mode: transparentInsert ? "transparent" : "sky-preset",
                            color: sky.clearColor,
                            skyPresetId: sky.id,
                          });
                        }}
                      >
                        <span
                          className="inline-block size-4 shrink-0 rounded-full border border-line/50 shadow-inner"
                          style={{ backgroundColor: sky.clearColor }}
                          aria-hidden
                        />
                        <span className="truncate">{sky.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-[0.66rem] leading-relaxed text-fg-3" aria-live="polite">
                    {selectedSky.description}
                  </p>

                  {selectedSky.kind === "procedural-panorama" ? (
                    <div className="mt-3 rounded-xl border border-line bg-card/70 px-3 py-2">
                      <LtRangeControl
                        id="bg3d-panorama-rotation"
                        label="수평 회전"
                        min={-180}
                        max={180}
                        step={1}
                        value={panoramaRotation}
                        valueText={`${panoramaRotation}°`}
                        disabled={isCapturing}
                        onChange={(value) => updateBackgroundSettings({
                          panoramaRotation: normalizePanoramaRotationDegrees(value),
                        })}
                      />
                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <PanoramaRotationNumberField
                          disabled={isCapturing}
                          value={panoramaRotation}
                          onCommit={(value) => updateBackgroundSettings({ panoramaRotation: value })}
                        />
                        <button
                          type="button"
                          className={cx(
                            CONTROL_BUTTON,
                            "border-line bg-panel px-3 text-fg-2 hover:bg-raised hover:text-fg",
                          )}
                          disabled={isCapturing || panoramaRotation === 0}
                          onClick={() => updateBackgroundSettings({ panoramaRotation: 0 })}
                        >
                          <RotateCcw size={14} aria-hidden />
                          정면 초기화
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                        <CircleDashed size={15} className="text-accent" aria-hidden />
                        공간 안개
                      </h3>
                      <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                        멀어지는 건물과 소품을 대기색에 자연스럽게 섞어 웹툰 배경의 깊이감을 만듭니다.
                      </p>
                    </div>
                    <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-2.5 text-xs font-semibold text-fg-2 sm:min-h-9">
                      <input
                        type="checkbox"
                        aria-label="3D 공간 안개 사용"
                        checked={sceneBaseDocument.background.fogEnabled ?? false}
                        onChange={(event) => updateBackgroundSettings({ fogEnabled: event.target.checked })}
                        className="size-4 accent-accent"
                      />
                      {sceneBaseDocument.background.fogEnabled ? "켜짐" : "꺼짐"}
                    </label>
                  </div>

                  <div
                    className={cx(
                      "mt-3 space-y-3 transition-opacity duration-150 motion-reduce:transition-none",
                      !sceneBaseDocument.background.fogEnabled && "pointer-events-none opacity-45",
                    )}
                    aria-disabled={!sceneBaseDocument.background.fogEnabled}
                  >
                    <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {STUDIO_BG3D_FOG_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={!sceneBaseDocument.background.fogEnabled}
                          className={cx(
                            CONTROL_BUTTON,
                            "min-h-10 shrink-0 border-line bg-card px-3 text-fg-2 hover:bg-raised hover:text-fg sm:min-h-9",
                            sceneBaseDocument.background.fogNear === preset.near &&
                              sceneBaseDocument.background.fogFar === preset.far &&
                              "border-accent/60 bg-accent-soft text-accent",
                          )}
                          onClick={() => updateBackgroundSettings({
                            fogEnabled: true,
                            fogColor: getSkyPreset(skyPresetId).clearColor,
                            fogNear: preset.near,
                            fogFar: preset.far,
                          })}
                        >
                          {preset.label}
                          <span className="text-[0.62rem] font-normal text-fg-3">
                            {preset.near}–{preset.far}
                          </span>
                        </button>
                      ))}
                    </div>

                    <label className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs font-semibold text-fg-2">
                      대기색
                      <input
                        type="color"
                        aria-label="3D 공간 안개 색"
                        value={sceneBaseDocument.background.fogColor ?? sceneBaseDocument.background.color}
                        disabled={!sceneBaseDocument.background.fogEnabled}
                        onChange={(event) => updateBackgroundSettings({ fogColor: event.target.value })}
                        className="size-11 cursor-pointer rounded-lg border border-line bg-transparent p-1 sm:size-9"
                      />
                    </label>

                    <label className="block text-xs font-semibold text-fg-2">
                      <span className="flex items-center justify-between gap-3">
                        시작 거리
                        <output className="tabular-nums text-fg">
                          {round(fogNear, 2)}
                        </output>
                      </span>
                      <input
                        type="range"
                        min="0"
                        max={fogSliderMax}
                        step="0.25"
                        value={fogNear}
                        disabled={!sceneBaseDocument.background.fogEnabled}
                        onChange={(event) => {
                          const fogNear = Number(event.target.value);
                          updateBackgroundSettings({
                            fogNear,
                            fogFar: Math.max(
                              fogNear + STUDIO_BG3D_FOG_MIN_GAP,
                              sceneBaseDocument.background.fogFar ?? 50,
                            ),
                          });
                        }}
                        className="mt-2 w-full accent-accent"
                      />
                    </label>

                    <label className="block text-xs font-semibold text-fg-2">
                      <span className="flex items-center justify-between gap-3">
                        완전 혼합 거리
                        <output className="tabular-nums text-fg">
                          {round(fogFar, 2)}
                        </output>
                      </span>
                      <input
                        type="range"
                        min={fogNear + STUDIO_BG3D_FOG_MIN_GAP}
                        max={fogSliderMax}
                        step="0.25"
                        value={fogFar}
                        disabled={!sceneBaseDocument.background.fogEnabled}
                        onChange={(event) => updateBackgroundSettings({
                          fogFar: Math.max(
                            Number(event.target.value),
                            (sceneBaseDocument.background.fogNear ?? 10) + STUDIO_BG3D_FOG_MIN_GAP,
                          ),
                        })}
                        className="mt-2 w-full accent-accent"
                      />
                    </label>
                    <p className="text-[0.65rem] leading-relaxed text-fg-3">
                      안개는 뷰포트와 컬러·톤 캡처에 함께 반영되며 선화 레이어의 투명 배경은 유지됩니다.
                    </p>
                  </div>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                        <Scissors size={15} className="text-accent" aria-hidden />
                        단면 컷
                      </h3>
                      <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
                        벽이나 천장을 잘라내 바깥에서 실내를 들여다보는 컷을 만듭니다. 잘린 상태
                        그대로 캡처됩니다.
                      </p>
                    </div>
                    <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-2.5 text-xs font-semibold text-fg-2 sm:min-h-9">
                      <input
                        type="checkbox"
                        aria-label="단면 컷 사용"
                        checked={sectionPlane.enabled}
                        onChange={(event) => setSectionPlane((current) => ({
                          ...current,
                          enabled: event.target.checked,
                        }))}
                        className="size-4 accent-accent"
                      />
                      {sectionPlane.enabled ? "켜짐" : "꺼짐"}
                    </label>
                  </div>
                  <div
                    className={cx(
                      "mt-3 space-y-2 transition-opacity duration-150 motion-reduce:transition-none",
                      !sectionPlane.enabled && "pointer-events-none opacity-45",
                    )}
                    aria-disabled={!sectionPlane.enabled}
                  >
                    <div className="flex gap-1.5" role="group" aria-label="단면 축">
                      {STUDIO_BG3D_SECTION_AXES.map((axis) => (
                        <button
                          key={axis}
                          type="button"
                          aria-pressed={sectionPlane.axis === axis}
                          disabled={!sectionPlane.enabled}
                          className={cx(
                            CONTROL_BUTTON,
                            "flex-1 border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                            sectionPlane.axis === axis && "border-accent/60 bg-accent-soft text-accent",
                          )}
                          onClick={() => setSectionPlane((current) => ({ ...current, axis }))}
                        >
                          {STUDIO_BG3D_SECTION_AXIS_LABELS[axis]}
                        </button>
                      ))}
                    </div>
                    <LtRangeControl
                      id="bg3d-section-offset"
                      label="절단 위치"
                      min={-STUDIO_BG3D_SECTION_OFFSET_LIMIT}
                      max={STUDIO_BG3D_SECTION_OFFSET_LIMIT}
                      step={0.1}
                      value={sectionPlane.offset}
                      valueText={`${round(sectionPlane.offset, 1)}m`}
                      disabled={!sectionPlane.enabled}
                      onChange={(offset) => setSectionPlane((current) => ({ ...current, offset }))}
                    />
                    <LtToggleRow
                      label="반대쪽 잘라내기"
                      checked={sectionPlane.flip}
                      disabled={!sectionPlane.enabled}
                      onChange={(flip) => setSectionPlane((current) => ({ ...current, flip }))}
                    />
                  </div>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={scaleGuideVisible}
                      onChange={(event) => setScaleGuideVisible(event.target.checked)}
                      className="mt-0.5 size-4 accent-accent"
                    />
                    <Ruler size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    <span className="block text-xs font-bold text-fg">
                      160cm 인체 스케일 가이드
                      <span className="mt-0.5 block text-[0.68rem] font-normal leading-relaxed text-fg-3">
                        기준 인물 실루엣을 원점에 세워 벽 높이·가구 크기를 즉시 가늠합니다.
                        바닥 그리드 한 칸은 1m이며, 가이드는 캡처 결과물에 포함되지 않습니다.
                      </span>
                    </span>
                  </label>
                </div>
                <StudioBg3dEnginePanel
                  plan={enginePlan}
                  preference={enginePreference}
                  inApp={engineInAppBrowser}
                  probing={engineProbing}
                  deviceLostMessage={engineDeviceLostMessage}
                  frameTimeMs={engineFrameTimeMs}
                  onPreferenceChange={onEnginePreferenceChange}
                />
                <StudioBg3dBabylonDiagnostic
                  state={babylonDiagnosticState}
                  onRun={onRunBabylonDiagnostic}
                />
                </div>
              </section>
  );
}
