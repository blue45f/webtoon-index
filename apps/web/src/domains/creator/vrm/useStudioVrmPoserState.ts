/**
 * Studio VRM poser runtime slice extracted from `StudioVrmPoser.tsx` (behavior unchanged).
 * The caller passes one host object; this hook destructures the original local names.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as THREE from "three";

import {
  createAvatarForgeState,
  serializeAvatarForgeState,
  type AvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  createStudioVrmAvatarForgeFaceController,
} from "./studio-vrm-avatar-forge-face-controller";
import {
  BlinkStabilizer,
} from "./studio-vrm-blink-stabilizer";
import {
  STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_DPR,
  type StudioVrmBroadcastBackgroundId,
  type StudioVrmBroadcastPreviewReceipt,
} from "./studio-vrm-broadcast-preview";
import type {
  CostumeState,
} from "./studio-vrm-costume";
import type {
  StudioVrmCostumeMeshEntry,
} from "./studio-vrm-costume-runtime";
import {
  createStudioVrmCreativeSqliteRepository,
  type StudioVrmCreativeSqliteRepository,
} from "./studio-vrm-creative-sqlite-repository";
import {
  inspectStudioVrmGarmentFit,
  type StudioVrmGarmentEvaluationReceipt,
} from "./studio-vrm-garment-fit";
import {
  DEFAULT_VRM_PHYSICS,
  type VrmPhysicsSettings,
} from "./studio-vrm-physics";
import {
  EMPTY_STUDIO_VRM_POSE_TRANSLATIONS,
  cloneStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";
import type {
  CharacterPanelSection,
  PanelTab,
} from "./studio-vrm-poser-catalogs";
import {
  studioVrmTexturePaintSceneIdentity,
} from "./studio-vrm-poser-helpers";
import {
  createStudioVrmPoserPreferencesRuntime,
} from "./studio-vrm-poser-preferences-sqlite";
import {
  POSE_PRESETS,
  DEFAULT_VRM_MATERIAL_FX,
  type PoseBoneMap,
  type FingerRotationMap,
  type BodyScale,
  type LightingParams,
  type EnvVariant,
  type FullVrmState,
  type VrmMaterialFx,
} from "./studio-vrm-poser-utils";
import type {
  StudioVrmPoseBucketId,
} from "./studio-vrm-poser-ux";
import {
  DEFAULT_VRM_PROP_RIG_METRICS,
  scaleVrmPropRigMetrics,
  type VrmPropRigMetrics,
} from "./studio-vrm-prop-rig";
import type {
  StudioVrmProportionRigReceipt,
  StudioVrmProportionRigRuntime,
} from "./studio-vrm-proportion-rig-runtime";
import type {
  StudioVrmProportionHeadMeasurementReceipt,
} from "./studio-vrm-proportion-vrm-adapter";
import type {
  PropInstance,
} from "./studio-vrm-props";
import type {
  StudioVrmRigProfileId,
} from "./studio-vrm-rig-profile";
import type {
  StudioVrmCameraSettings,
  StudioVrmIkConstraint,
  StudioVrmPoseTranslations,
} from "./studio-vrm-scene-document";
import type {
  ScenePropAttachmentConfig as PropAttachmentConfig,
} from "./studio-vrm-scene-props";
import {
  createStudioVrmFullStateHistory,
} from "./studio-vrm-state-history";
import type {
  StudioVrmSurfacePaintToolSnapshot,
} from "./studio-vrm-surface-paint-tool";
import {
  planStudioVrmTexturePaintDeviceTier,
} from "./studio-vrm-texture-paint-device-tier";
import type {
  StudioVrmTexturePaintRuntime,
  StudioVrmTexturePaintRuntimeSnapshot,
} from "./studio-vrm-texture-paint-runtime";
import {
  CalibrationSampler,
  type TrackingCalibration,
} from "./studio-vrm-tracking-calibration";
import {
  createStudioVrmTrackingCalibrationSqliteRepository,
  type StudioVrmTrackingCalibrationRepository,
} from "./studio-vrm-tracking-calibration-sqlite-repository";
import {
  AdaptiveQualityController,
} from "./studio-vrm-tracking-quality";
import {
  serializeWardrobe,
  type WardrobeMetrics,
  type WardrobeSlot,
  type WardrobeState,
} from "./studio-vrm-wardrobe";
import {
  createChannelSmoother,
  DEFAULT_TRACKING_OPTIONS,
  type TrackingOptions,
  type TrackingChannels,
  type VrmTrackingData,
} from "./studio-vrm-webcam-tracking";
import {
  countDetectedVrmHairMeshes,
} from "./StudioVrmAvatarForge";
import type {
  StudioVrmIkAxisLock,
  StudioVrmIkDragMode,
  StudioVrmIkEffectorBone,
  StudioVrmJointHandleBone,
} from "./StudioVrmJointHandles";
import type {
  LightingTone,
} from "./StudioVrmLighting";
import {
  DEFAULT_STUDIO_VRM_TEXTURE_PAINT_SETTINGS,
  readStudioVrmTexturePaintEnvironmentSignals,
  VRM_VIEWPORT_HINTS,
  type CaptureState,
  type CustomPose,
  type LibraryStatus,
  type LoadStatus,
  DEFAULT_VRM_CUSTOM_COLORS,
  type PendingStudioVrmPersistentIkCommand,
  type StudioVrmBroadcastCameraLease,
  type StudioVrmCaptureVisualAuthority,
  type StudioVrmIkTransaction,
  type StudioVrmPoserProps,
  type TexturePaintPersistenceStatus,
  type ViewportApi,
  type VrmCreativePersistenceStatus,
} from "./StudioVrmPoserTypes";
import type {
  StudioVrmTexturePaintPanelSettings,
} from "./StudioVrmTexturePaintPanel";
import type {
  StudioVrmWardrobeCaptureSync,
  StudioVrmWardrobeSurfaceReceipt,
} from "./StudioVrmWardrobePropsProjection";
import {
  useStudioVrmAvatarReferenceCatalogue,
} from "./useStudioVrmAvatarReferenceCatalogue";
import {
  SAMPLE_VRM_ID,
  SAMPLE_VRM_ENTRIES,
  type VrmLibraryEntry,
  type VrmStoredModelWithContentIdentity,
} from "./vrm-library";

import type {
  StudioToolHintSpec,
} from "../studio-tool-hints";
import type { StudioVrmPoserHost } from "./StudioVrmPoserHost";
import type {
  FaceLandmarker,
  HandLandmarker,
  PoseLandmarker,
} from "@mediapipe/tasks-vision";
import type {
  VRM,
  VRMHumanBoneName,
} from "@pixiv/three-vrm";

import type {
  SharedAssetCatalogItem,
} from "@/src/infrastructure/creator-client";

export function useStudioVrmPoserState({
  open,
  onClose,
  onInsert,
  initialDataUrl,
  initialScene,
  seedPropId = null,
  onSeedObjectInsertConsumed,
  creativeRepository: creativeRepositoryOverride,
  trackingCalibrationRepository: trackingCalibrationRepositoryOverride,
}: StudioVrmPoserProps): StudioVrmPoserHost {
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const viewportInstructionsId = useId();
  const objectInsertSeedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Clipboard payloads can contain full pose/expression state. Do not retain or
    // migrate the former persistent browser copies across sessions.
    try {
      localStorage.removeItem("studio_pose_clipboard");
      localStorage.removeItem("studio_vrm_full_clip");
    } catch {
      // Storage denial does not affect the in-memory/session clipboard.
    }
  }, []);
  const texturePaintSceneIdentity = studioVrmTexturePaintSceneIdentity(initialScene);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [status, setStatus] = useState<LoadStatus>("empty");
  const [error, setError] = useState("");
  const [modelName, setModelName] = useState("");
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [activePoseId, setActivePoseId] = useState("default");
  const [customBones, setCustomBones] = useState<PoseBoneMap>(POSE_PRESETS[0].bones);
  const [customYOffset, setCustomYOffset] = useState<number>(POSE_PRESETS[0].yOffset ?? 0);
  const [poseTranslations, setPoseTranslations] = useState<StudioVrmPoseTranslations>(() =>
    cloneStudioVrmPoseTranslations(EMPTY_STUDIO_VRM_POSE_TRANSLATIONS)
  );
  const [ikConstraints, setIkConstraints] = useState<StudioVrmIkConstraint[]>([]);
  const [activeCategory, setActiveCategory] = useState("head");
  const [jointLimitsEnabled, setJointLimitsEnabled] = useState(true);
  const [rigJointProfile, setRigJointProfile] = useState<StudioVrmRigProfileId>("neutral");
  const [fullBodyIkEnabled, setFullBodyIkEnabled] = useState(false);
  const [footPlantEnabled, setFootPlantEnabled] = useState(false);
  const [rigFloorHeight, setRigFloorHeight] = useState(0);
  const [lockedPoseBones, setLockedPoseBones] = useState<VRMHumanBoneName[]>([]);
  const [showPoseBoneOverlay, setShowPoseBoneOverlay] = useState(false);
  const [selectedViewportPoseBone, setSelectedViewportPoseBone] =
    useState<VRMHumanBoneName | null>(null);
  const [viewportHandIkEnabled, setViewportHandIkEnabled] = useState(false);
  const [isViewportHandIkDragging, setIsViewportHandIkDragging] = useState(false);
  const [activeExpressionId, setActiveExpressionId] = useState("neutral");
  const [expressionWeights, setExpressionWeights] = useState<Record<string, number>>({});
  const [activeExpressionCategory, setActiveExpressionCategory] = useState<string>("emotion");
  const [activeCameraId, setActiveCameraId] = useState("front");
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>("character");
  const [activeCharacterSection, setActiveCharacterSection] = useState<CharacterPanelSection>("library");
  const avatarForgeReferenceSurfaceActive =
    open && activePanelTab === "character" && activeCharacterSection === "forge";
  const avatarForgeReferenceCatalogue = useStudioVrmAvatarReferenceCatalogue({
    active: avatarForgeReferenceSurfaceActive,
  });
  const [texturePaintSettings, setTexturePaintSettings] =
    useState<StudioVrmTexturePaintPanelSettings>(DEFAULT_STUDIO_VRM_TEXTURE_PAINT_SETTINGS);
  const [texturePaintEyedropperActive, setTexturePaintEyedropperActive] = useState(false);
  const [texturePaintRuntime, setTexturePaintRuntime] =
    useState<StudioVrmTexturePaintRuntime | null>(null);
  const [texturePaintRuntimeSceneIdentity, setTexturePaintRuntimeSceneIdentity] =
    useState<string | null>(null);
  const [texturePaintSnapshot, setTexturePaintSnapshot] =
    useState<StudioVrmTexturePaintRuntimeSnapshot | null>(null);
  const [texturePaintSurfaceToolSnapshot, setTexturePaintSurfaceToolSnapshot] =
    useState<StudioVrmSurfacePaintToolSnapshot | null>(null);
  const [texturePaintPersistenceStatus, setTexturePaintPersistenceStatus] =
    useState<TexturePaintPersistenceStatus>("idle");
  const [texturePaintPersistenceError, setTexturePaintPersistenceError] = useState("");
  const [texturePaintRestoreRetryToken, setTexturePaintRestoreRetryToken] = useState(0);
  const [texturePaintDevicePlan] = useState(() =>
    planStudioVrmTexturePaintDeviceTier(readStudioVrmTexturePaintEnvironmentSignals()));
  const [poseQuery, setPoseQuery] = useState("");
  const [poseBucket, setPoseBucket] = useState<StudioVrmPoseBucketId>("all");
  const [recentPreferencesRuntime] = useState(() =>
    createStudioVrmPoserPreferencesRuntime());
  const recentPreferencesSnapshot = useSyncExternalStore(
    recentPreferencesRuntime.subscribe,
    recentPreferencesRuntime.getSnapshot,
    recentPreferencesRuntime.getSnapshot,
  );
  const recentPoseState = recentPreferencesSnapshot.recentPoses;
  const recentCharacterState = recentPreferencesSnapshot.recentCharacters;
  useEffect(() => {
    if (open) void recentPreferencesRuntime.hydrate();
  }, [open, recentPreferencesRuntime]);
  const [bodyRotation, setBodyRotation] = useState(0);
  const [mannequinMode, setMannequinMode] = useState(false);
  const [jointHandlesVisible, setJointHandlesVisible] = useState(true);
  const [selectedJointHandle, setSelectedJointHandle] = useState<StudioVrmJointHandleBone | null>(null);
  const [selectedIkPole, setSelectedIkPole] = useState<StudioVrmIkEffectorBone | null>(null);
  const [ikHandleDragMode, setIkHandleDragMode] = useState<StudioVrmIkDragMode>("screen");
  const [ikHandleAxisLock, setIkHandleAxisLock] = useState<StudioVrmIkAxisLock>("free");
  const [jointHandleInteracting, setJointHandleInteracting] = useState(false);
  const [jointHandleSessionGeneration, setJointHandleSessionGeneration] = useState(0);
  const [jointHandleStatus, setJointHandleStatus] = useState("");
  // 뷰포트 오버레이 컨트롤 — 줌/시점초기화/턴테이블/드래그 힌트.
  const [turntable, setTurntable] = useState(false);
  const [broadcastBackgroundId, setBroadcastBackgroundId] =
    useState<StudioVrmBroadcastBackgroundId>("green");
  const [broadcastPreviewReceipt, setBroadcastPreviewReceipt] =
    useState<StudioVrmBroadcastPreviewReceipt | null>(null);
  const [broadcastPreviewError, setBroadcastPreviewError] = useState("");
  const [broadcastCanvasDpr, setBroadcastCanvasDpr] = useState(
    STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_DPR,
  );
  const broadcastPreviewActive = broadcastPreviewReceipt !== null;
  const turntableHint: StudioToolHintSpec = turntable
    ? {
        ...VRM_VIEWPORT_HINTS.turntable,
        title: "턴테이블 회전 중지",
        description: "다음 클릭으로 캐릭터 주위를 도는 자동 카메라를 멈추고 현재 시점에서 수동 조작을 이어갑니다.",
        preview: "camera-orbit",
        previewVariant: "stop",
        tip: "필요할 때 같은 버튼으로 현재 시점부터 자동 회전을 다시 시작할 수 있어요.",
      }
    : VRM_VIEWPORT_HINTS.turntable;
  const [viewResetNonce, setViewResetNonce] = useState(0);
  const [viewportHinted, setViewportHinted] = useState(false);
  const viewportApiRef = useRef<ViewportApi | null>(null);
  const broadcastViewportHostRef = useRef<HTMLDivElement | null>(null);
  const broadcastExitButtonRef = useRef<HTMLButtonElement | null>(null);
  const broadcastPreviousFocusRef = useRef<HTMLElement | null>(null);
  const broadcastCameraLeaseRef = useRef<StudioVrmBroadcastCameraLease | null>(null);
  const broadcastFocusFrameRef = useRef<number | null>(null);
  const broadcastMutationLockSnapshotRef = useRef<Readonly<{
    texturePaint: boolean;
    wardrobe: boolean;
  }> | null>(null);
  // 편집 되돌리기/다시실행 — 전체 포저 상태 스냅샷 히스토리(직렬화 재사용).
  const fullStateHistoryRef = useRef(createStudioVrmFullStateHistory());
  const isRestoringRef = useRef(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isThumbnailCapturing, setIsThumbnailCapturing] = useState(false);
  const [libraryEntries, setLibraryEntries] = useState<VrmLibraryEntry[]>(SAMPLE_VRM_ENTRIES);
  const libraryEntriesRef = useRef(libraryEntries);
  libraryEntriesRef.current = libraryEntries;
  const [libraryNextCursor, setLibraryNextCursor] = useState<string | null>(null);
  const [isLoadingLibraryPage, setIsLoadingLibraryPage] = useState(false);
  const memoryVrmModelsRef = useRef(new Map<string, VrmStoredModelWithContentIdentity>());
  const thumbnailWindowKeyRef = useRef("");
  const thumbnailWindowAbortRef = useRef<AbortController | null>(null);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("loading");
  const [libraryError, setLibraryError] = useState("");
  const [activeModelId, setActiveModelId] = useState(SAMPLE_VRM_ID);
  const [installedModelId, setInstalledModelId] = useState<string | null>(null);
  const activeModelIdRef = useRef(activeModelId);
  activeModelIdRef.current = activeModelId;
  const modelLoadTargetIdRef = useRef<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);

  // early decl for new features used in effects
  const [bodyScale, setBodyScale] = useState<BodyScale>({ height: 1, width: 1 });
  const [avatarForgeState, setAvatarForgeState] = useState<AvatarForgeState>(() => createAvatarForgeState());
  const [avatarForgeReferencePreview, setAvatarForgeReferencePreview] = useState<Readonly<{
    modelId: string;
    authorityIdentity: string;
    catalogueRevision: string;
    presetId: string;
    state: AvatarForgeState;
  }> | null>(null);
  const avatarForgeReferenceAuthorityIdentity = JSON.stringify(
    serializeAvatarForgeState(avatarForgeState),
  );
  const avatarForgeReferencePreviewActive =
    avatarForgeReferencePreview
    && avatarForgeReferencePreview.modelId === activeModelId
    && avatarForgeReferencePreview.authorityIdentity === avatarForgeReferenceAuthorityIdentity
    && avatarForgeReferenceCatalogue.status === "ready"
    && avatarForgeReferencePreview.catalogueRevision
      === avatarForgeReferenceCatalogue.catalogueRevision
    && avatarForgeReferenceSurfaceActive
    && !broadcastPreviewActive
      ? avatarForgeReferencePreview
      : null;
  const [avatarForgeFaceController] = useState(createStudioVrmAvatarForgeFaceController);
  const [proportionRigStatus, setProportionRigStatus] = useState<
    "empty" | "ready" | "applying" | "unavailable" | "reload-required"
  >("empty");
  const [proportionRigMessage, setProportionRigMessage] = useState("");
  const [proportionRigReceipt, setProportionRigReceipt] =
    useState<StudioVrmProportionRigReceipt | null>(null);
  const [proportionRigRevision, setProportionRigRevision] = useState(0);
  const [proportionHeadMeasurement, setProportionHeadMeasurement] =
    useState<StudioVrmProportionHeadMeasurementReceipt | null>(null);
  const detectedOriginalHairCount = useMemo(() => countDetectedVrmHairMeshes(vrm), [vrm]);
  const [fingerEdits, setFingerEdits] = useState<FingerRotationMap>({});
  const [lighting, setLighting] = useState<LightingParams>({ intensity: 1.2, colorTemp: 0.5, directionDeg: 45 });
  const [envVariant, setEnvVariant] = useState<EnvVariant>("none");
  /** Insert cutout: transparent subject-only PNG (default). Off = solid backgroundColor clear. */
  const [transparentBackground, setTransparentBackground] = useState(true);
  const [insertBackgroundColor, setInsertBackgroundColor] = useState("#ffffff");
  const [fullStateName, setFullStateName] = useState("");
  const [savedFullStates, setSavedFullStates] = useState<Record<string, FullVrmState>>({});
  const [customColors, setCustomColors] = useState<Record<string, string>>({ ...DEFAULT_VRM_CUSTOM_COLORS });
  const [materialFx, setMaterialFx] = useState<VrmMaterialFx>(DEFAULT_VRM_MATERIAL_FX);
  const [isSharingPose, setIsSharingPose] = useState(false);
  const [sharedPoses, setSharedPoses] = useState<SharedAssetCatalogItem[]>([]);
  const [sharedPosesStatus, setSharedPosesStatus] = useState<"idle" | "loading" | "error">("idle");
  const [sharedPoseLibraryOpen, setSharedPoseLibraryOpen] = useState(false);
  const [sharedPoseReloadToken, setSharedPoseReloadToken] = useState(0);
  const [sharedPoseNextOffset, setSharedPoseNextOffset] = useState<number | null>(null);
  const [sharedPoseHasMore, setSharedPoseHasMore] = useState(false);
  const [sharedPoseSelectionAssetId, setSharedPoseSelectionAssetId] = useState<string | null>(null);
  const [lightingTone, setLightingTone] = useState<LightingTone>("morning");
  const [activeProps, setActiveProps] = useState<string[]>([]);
  const [propAttachments, setPropAttachments] = useState<Record<string, PropAttachmentConfig>>({});
  const [selectedPropId, setSelectedPropId] = useState<string | null>(null);
  const [savedPoses, setSavedPoses] = useState<CustomPose[]>([]);
  const [creativeRepository] = useState<StudioVrmCreativeSqliteRepository>(() =>
    creativeRepositoryOverride ?? createStudioVrmCreativeSqliteRepository()
  );
  const [trackingCalibrationRepository] = useState<StudioVrmTrackingCalibrationRepository>(() =>
    trackingCalibrationRepositoryOverride
      ?? createStudioVrmTrackingCalibrationSqliteRepository()
  );
  const [vrmCreativePersistenceStatus, setVrmCreativePersistenceStatus] =
    useState<VrmCreativePersistenceStatus>("hydrating");
  const [vrmCreativePersistenceMessage, setVrmCreativePersistenceMessage] = useState(
    "SQLite/OPFS 포즈 라이브러리를 불러오는 중입니다.",
  );
  const vrmCreativeMountedRef = useRef(false);
  const vrmCreativeMutationGenerationRef = useRef(0);
  const vrmCreativeMutationTailRef = useRef<Promise<void>>(Promise.resolve());
  const vrmCreativeDirtyAuthoritiesRef = useRef(new Set<"poses" | "full-states">());
  const savedPosesRef = useRef<CustomPose[]>(savedPoses);
  const savedFullStatesRef = useRef<Record<string, FullVrmState>>(savedFullStates);
  savedPosesRef.current = savedPoses;
  savedFullStatesRef.current = savedFullStates;
  const [preserveExpression, setPreserveExpression] = useState(true);
  // 본 부착 소품(studio-vrm-props) — 복수 부착 인스턴스.
  const [vrmPropItems, setVrmPropItems] = useState<PropInstance[]>([]);
  const [selectedVrmPropUid, setSelectedVrmPropUid] = useState<string | null>(null);
  // 의상(studio-vrm-costume) — 토글/리컬러 상태 + 수집된 메시 목록.
  const [costumeState, setCostumeState] = useState<CostumeState>({ hidden: [], recolor: {} });
  const [costumeMeshes, setCostumeMeshes] = useState<StudioVrmCostumeMeshEntry[]>([]);
  const [selectedCostumeKey, setSelectedCostumeKey] = useState<string | null>(null);
  // 실장착 워드로브(studio-vrm-wardrobe) — 슬롯별 장착 + 모델 실측 치수.
  const [wardrobeState, setWardrobeState] = useState<WardrobeState>({});
  const [wardrobeMetrics, setWardrobeMetrics] = useState<WardrobeMetrics | null>(null);
  const [wardrobeSurfaceReceipts, setWardrobeSurfaceReceipts] =
    useState<Partial<Record<WardrobeSlot, StudioVrmWardrobeSurfaceReceipt>>>({});
  const [propRigMetrics, setPropRigMetrics] = useState<VrmPropRigMetrics>(DEFAULT_VRM_PROP_RIG_METRICS);
  const effectivePropRigMetrics = scaleVrmPropRigMetrics(propRigMetrics, bodyScale);
  const [wardrobeAutoHide, setWardrobeAutoHide] = useState(true);
  const wardrobeFitReport = inspectStudioVrmGarmentFit(wardrobeState, wardrobeMetrics);
  const wardrobeAuthoredIdentity = JSON.stringify(
    serializeWardrobe(wardrobeState, { autoHideOriginal: wardrobeAutoHide }) ?? null,
  );
  const wardrobeInteractionLocked = isCapturing || broadcastPreviewActive;

  // Wardrobe/prop measurements are committed by the proportion-rig lifecycle while the rebuilt
  // humanoid is in rest pose. Measuring one animation frame after a React effect can mix two rig
  // generations and is therefore intentionally not used here.
  // 물리(studio-vrm-physics) — 스프링본 설정 + 미리보기/조인트 수.
  const [vrmPhysics, setVrmPhysics] = useState<VrmPhysicsSettings>(DEFAULT_VRM_PHYSICS);
  const [physicsPreview, setPhysicsPreview] = useState(false);
  const [springJointCount, setSpringJointCount] = useState(0);
  // 대기 애니메이션 (숨쉬기 및 자동 깜빡임)
  const [idleAnimation, setIdleAnimation] = useState(false);
  // 웹캠 페이스 트래킹 (studio-vrm-webcam-tracking)
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamLoading, setWebcamLoading] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [webcamErrorStage, setWebcamErrorStage] = useState<"camera" | "engine" | null>(null);
  const [showConsent, setShowConsent] = useState(false);
  const [webcamConsentGranted, setWebcamConsentGranted] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [trackingOptions, setTrackingOptions] = useState<TrackingOptions>(DEFAULT_TRACKING_OPTIONS);
  // 표정 충돌 해소는 **이 모델이 실제로 가진 표정**만 대상으로 삼아야 한다. VRM 마다 선택
  // 프리셋(surprised/angry/sad …)이 빠져 있을 수 있고, 적용 단계(StudioVrmActor)는 모델에
  // 없는 이름을 그냥 버린다. 없는 이름이 지배 표정으로 뽑히면 지원되는 표정만 깎이고 정작
  // 그 표정은 나타나지 않는다.
  const trackingOptionsForSession = useMemo<TrackingOptions>(
    () => ({
      ...trackingOptions,
      availableExpressions: vrm?.expressionManager
        ? Object.keys(vrm.expressionManager.expressionMap)
        : undefined,
    }),
    [trackingOptions, vrm],
  );
  const [browserPermissionState, setBrowserPermissionState] = useState<"granted" | "denied" | "prompt" | "unsupported">("prompt");
  // 정면 캘리브레이션 UI 상태(studio-vrm-tracking-calibration).
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationCountdown, setCalibrationCountdown] = useState(0);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrated, setCalibrated] = useState(false);
  const [calibrationPersistenceStatus, setCalibrationPersistenceStatus] = useState<
    "loading" | "sqlite" | "saving" | "memory" | "read-error"
  >("loading");
  const [calibrationPersistenceMessage, setCalibrationPersistenceMessage] = useState("");
  // 얼굴 미검출 장기화(~5초) 힌트 배지.
  const [faceLostLong, setFaceLostLong] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  // 트래킹 루프 상태 — 전부 ref(렌더 경로에서 변이 금지, 루프/effect 내부에서만 변이).
  const channelSmootherRef = useRef(createChannelSmoother());
  const blinkStabilizerRef = useRef(new BlinkStabilizer());
  const qualityRef = useRef<AdaptiveQualityController | null>(null);
  const calibrationRef = useRef<TrackingCalibration | null>(null);
  const calibrationSamplerRef = useRef<CalibrationSampler | null>(null);
  const calibrationPersistenceMountedRef = useRef(false);
  const calibrationPersistenceGenerationRef = useRef(0);
  const faceLostFramesRef = useRef(0);
  const faceLostLongRef = useRef(false);
  const lastChannelsRef = useRef<TrackingChannels | null>(null);
  const lastPoseBonesRef = useRef<Record<string, readonly [number, number, number]>>({});
  const lastFingersRef = useRef<Record<string, readonly [number, number, number]> | null>(null);
  const frameIndexRef = useRef(0);
  const webcamActiveRef = useRef(false);
  const idleAnimationRef = useRef(false);
  const dynamicPoseGenerationRef = useRef(0);
  const dynamicPoseStateRef = useRef({ webcamActive: false, idleAnimation: false });
  const trackingDataRef = useRef<VrmTrackingData | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const vrmInstallGenerationRef = useRef(0);
  const proportionRigRuntimeRef = useRef<StudioVrmProportionRigRuntime | null>(null);
  const proportionRigReceiptRef = useRef<StudioVrmProportionRigReceipt | null>(null);
  const proportionHeadMeasurementRef =
    useRef<StudioVrmProportionHeadMeasurementReceipt | null>(null);
  const proportionPoseReapplyRef = useRef<(() => boolean | void) | null>(null);
  const avatarForgeCommittedStateRef = useRef(avatarForgeState);
  const avatarForgeAuthorityIdentityRef = useRef(
    JSON.stringify(serializeAvatarForgeState(avatarForgeState)),
  );
  const proportionRigRevisionRef = useRef(proportionRigRevision);
  const captureVisualAuthorityRef = useRef<StudioVrmCaptureVisualAuthority | null>(null);
  useLayoutEffect(() => {
    avatarForgeCommittedStateRef.current = avatarForgeState;
    avatarForgeAuthorityIdentityRef.current = JSON.stringify(
      serializeAvatarForgeState(avatarForgeState),
    );
    proportionRigRevisionRef.current = proportionRigRevision;
  }, [avatarForgeState, proportionRigRevision]);
  const texturePaintRuntimeRef = useRef<StudioVrmTexturePaintRuntime | null>(null);
  const texturePaintSnapshotRef = useRef<StudioVrmTexturePaintRuntimeSnapshot | null>(null);
  const texturePaintInvalidateRef = useRef<(() => void) | null>(null);
  const texturePaintRestoreGenerationRef = useRef(0);
  const texturePaintRestoreAbortRef = useRef<AbortController | null>(null);
  const texturePaintMutationBlockedRef = useRef(false);
  const wardrobeMutationBlockedRef = useRef(false);
  const wardrobeAuthoredIdentityRef = useRef(wardrobeAuthoredIdentity);
  const wardrobeXpbdCaptureSyncRef =
    useRef(new Map<WardrobeSlot, StudioVrmWardrobeCaptureSync>());
  const loadRequestRef = useRef(0);
  const thumbnailRequestRef = useRef(0);
  const insertCaptureGenerationRef = useRef(0);
  const insertCaptureFrameRef = useRef<number | null>(null);
  const insertCaptureAbortRef = useRef<AbortController | null>(null);
  const sharePoseAbortRef = useRef<AbortController | null>(null);
  const captureOperationRef = useRef<"insert" | "thumbnail" | "share" | null>(null);
  const sharedPoseListRequestRef = useRef(0);
  const sharedPoseSelectionRequestRef = useRef(0);
  const sharedPoseCatalogAbortRef = useRef<AbortController | null>(null);
  const sharedPoseSelectAbortRef = useRef<AbortController | null>(null);
  const captureRef = useRef<CaptureState>({ camera: null, gl: null, scene: null });
  const captureRequestRef = useRef(0);
  const pendingCameraRestoreRef = useRef<StudioVrmCameraSettings | null>(null);
  const pendingCameraRestoreFrameRef = useRef<number | null>(null);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const manualPoseDetailsRef = useRef<HTMLDetailsElement>(null);
  const jointIkTransactionRef = useRef<StudioVrmIkTransaction | null>(null);
  const jointIkRevisionRef = useRef(0);
  const persistentIkReconcileRevisionRef = useRef(0);
  const persistentIkResolvedSignatureRef = useRef("");
  const persistentIkCurrentSignatureRef = useRef("");
  const garmentEvaluationGenerationRef = useRef(0);
  const garmentEvaluationReceiptRef = useRef<StudioVrmGarmentEvaluationReceipt | null>(null);
  const pendingPersistentIkCommandRef = useRef<PendingStudioVrmPersistentIkCommand | null>(null);
  const [persistentIkReconciling, setPersistentIkReconciling] = useState(false);
  const [captureSceneGeneration, setCaptureSceneGeneration] = useState(0);
  // 캡처(투명 PNG 삽입) 순간에만 발밑 타원 그림자·배경 환경을 꺼서 캐릭터만 남긴다 — React state가
  // 아니라 three.js 객체를 직접 명령형으로 토글해야 gl.render() 호출 전에 확실히 반영된다(state
  // 갱신은 다음 R3F 커밋을 기다려야 해서 같은 프레임 안에서 타이밍을 보장할 수 없다).
  const groundShadowRef = useRef<THREE.Mesh>(null);
  const envRootRef = useRef<THREE.Group | null>(null);
  const captureHelperLeaseCountRef = useRef(0);


  const h: StudioVrmPoserHost = {};
  Object.assign(h, {
    dialogTitleId,
    dialogDescriptionId,
    viewportInstructionsId,
    objectInsertSeedKeyRef,
    texturePaintSceneIdentity,
    dialogRef,
    closeButtonRef,
    status,
    setStatus,
    error,
    setError,
    modelName,
    setModelName,
    vrm,
    setVrm,
    activePoseId,
    setActivePoseId,
    customBones,
    setCustomBones,
    customYOffset,
    setCustomYOffset,
    poseTranslations,
    setPoseTranslations,
    ikConstraints,
    setIkConstraints,
    activeCategory,
    setActiveCategory,
    jointLimitsEnabled,
    setJointLimitsEnabled,
    rigJointProfile,
    setRigJointProfile,
    fullBodyIkEnabled,
    setFullBodyIkEnabled,
    footPlantEnabled,
    setFootPlantEnabled,
    rigFloorHeight,
    setRigFloorHeight,
    lockedPoseBones,
    setLockedPoseBones,
    showPoseBoneOverlay,
    setShowPoseBoneOverlay,
    selectedViewportPoseBone,
    setSelectedViewportPoseBone,
    viewportHandIkEnabled,
    setViewportHandIkEnabled,
    isViewportHandIkDragging,
    setIsViewportHandIkDragging,
    activeExpressionId,
    setActiveExpressionId,
    expressionWeights,
    setExpressionWeights,
    activeExpressionCategory,
    setActiveExpressionCategory,
    activeCameraId,
    setActiveCameraId,
    activePanelTab,
    setActivePanelTab,
    activeCharacterSection,
    setActiveCharacterSection,
    avatarForgeReferenceSurfaceActive,
    avatarForgeReferenceCatalogue,
    texturePaintSettings,
    setTexturePaintSettings,
    texturePaintEyedropperActive,
    setTexturePaintEyedropperActive,
    texturePaintRuntime,
    setTexturePaintRuntime,
    texturePaintRuntimeSceneIdentity,
    setTexturePaintRuntimeSceneIdentity,
    texturePaintSnapshot,
    setTexturePaintSnapshot,
    texturePaintSurfaceToolSnapshot,
    setTexturePaintSurfaceToolSnapshot,
    texturePaintPersistenceStatus,
    setTexturePaintPersistenceStatus,
    texturePaintPersistenceError,
    setTexturePaintPersistenceError,
    texturePaintRestoreRetryToken,
    setTexturePaintRestoreRetryToken,
    texturePaintDevicePlan,
    poseQuery,
    setPoseQuery,
    poseBucket,
    setPoseBucket,
    recentPreferencesRuntime,
    recentPreferencesSnapshot,
    recentPoseState,
    recentCharacterState,
    bodyRotation,
    setBodyRotation,
    mannequinMode,
    setMannequinMode,
    jointHandlesVisible,
    setJointHandlesVisible,
    selectedJointHandle,
    setSelectedJointHandle,
    selectedIkPole,
    setSelectedIkPole,
    ikHandleDragMode,
    setIkHandleDragMode,
    ikHandleAxisLock,
    setIkHandleAxisLock,
    jointHandleInteracting,
    setJointHandleInteracting,
    jointHandleSessionGeneration,
    setJointHandleSessionGeneration,
    jointHandleStatus,
    setJointHandleStatus,
    turntable,
    setTurntable,
    broadcastBackgroundId,
    setBroadcastBackgroundId,
    broadcastPreviewReceipt,
    setBroadcastPreviewReceipt,
    broadcastPreviewError,
    setBroadcastPreviewError,
    broadcastCanvasDpr,
    setBroadcastCanvasDpr,
    broadcastPreviewActive,
    turntableHint,
    viewResetNonce,
    setViewResetNonce,
    viewportHinted,
    setViewportHinted,
    viewportApiRef,
    broadcastViewportHostRef,
    broadcastExitButtonRef,
    broadcastPreviousFocusRef,
    broadcastCameraLeaseRef,
    broadcastFocusFrameRef,
    broadcastMutationLockSnapshotRef,
    fullStateHistoryRef,
    isRestoringRef,
    canUndo,
    setCanUndo,
    canRedo,
    setCanRedo,
    isCapturing,
    setIsCapturing,
    isThumbnailCapturing,
    setIsThumbnailCapturing,
    libraryEntries,
    setLibraryEntries,
    libraryEntriesRef,
    libraryNextCursor,
    setLibraryNextCursor,
    isLoadingLibraryPage,
    setIsLoadingLibraryPage,
    memoryVrmModelsRef,
    thumbnailWindowKeyRef,
    thumbnailWindowAbortRef,
    libraryStatus,
    setLibraryStatus,
    libraryError,
    setLibraryError,
    activeModelId,
    setActiveModelId,
    installedModelId,
    setInstalledModelId,
    activeModelIdRef,
    modelLoadTargetIdRef,
    isUploading,
    setIsUploading,
    deletingModelId,
    setDeletingModelId,
    bodyScale,
    setBodyScale,
    avatarForgeState,
    setAvatarForgeState,
    avatarForgeReferencePreview,
    setAvatarForgeReferencePreview,
    avatarForgeReferenceAuthorityIdentity,
    avatarForgeReferencePreviewActive,
    avatarForgeFaceController,
    proportionRigStatus,
    setProportionRigStatus,
    proportionRigMessage,
    setProportionRigMessage,
    proportionRigReceipt,
    setProportionRigReceipt,
    proportionRigRevision,
    setProportionRigRevision,
    proportionHeadMeasurement,
    setProportionHeadMeasurement,
    detectedOriginalHairCount,
    fingerEdits,
    setFingerEdits,
    lighting,
    setLighting,
    envVariant,
    setEnvVariant,
    transparentBackground,
    setTransparentBackground,
    insertBackgroundColor,
    setInsertBackgroundColor,
    fullStateName,
    setFullStateName,
    savedFullStates,
    setSavedFullStates,
    customColors,
    setCustomColors,
    materialFx,
    setMaterialFx,
    isSharingPose,
    setIsSharingPose,
    sharedPoses,
    setSharedPoses,
    sharedPosesStatus,
    setSharedPosesStatus,
    sharedPoseLibraryOpen,
    setSharedPoseLibraryOpen,
    sharedPoseReloadToken,
    setSharedPoseReloadToken,
    sharedPoseNextOffset,
    setSharedPoseNextOffset,
    sharedPoseHasMore,
    setSharedPoseHasMore,
    sharedPoseSelectionAssetId,
    setSharedPoseSelectionAssetId,
    lightingTone,
    setLightingTone,
    activeProps,
    setActiveProps,
    propAttachments,
    setPropAttachments,
    selectedPropId,
    setSelectedPropId,
    savedPoses,
    setSavedPoses,
    creativeRepository,
    trackingCalibrationRepository,
    vrmCreativePersistenceStatus,
    setVrmCreativePersistenceStatus,
    vrmCreativePersistenceMessage,
    setVrmCreativePersistenceMessage,
    vrmCreativeMountedRef,
    vrmCreativeMutationGenerationRef,
    vrmCreativeMutationTailRef,
    vrmCreativeDirtyAuthoritiesRef,
    savedPosesRef,
    savedFullStatesRef,
    preserveExpression,
    setPreserveExpression,
    vrmPropItems,
    setVrmPropItems,
    selectedVrmPropUid,
    setSelectedVrmPropUid,
    costumeState,
    setCostumeState,
    costumeMeshes,
    setCostumeMeshes,
    selectedCostumeKey,
    setSelectedCostumeKey,
    wardrobeState,
    setWardrobeState,
    wardrobeMetrics,
    setWardrobeMetrics,
    wardrobeSurfaceReceipts,
    setWardrobeSurfaceReceipts,
    propRigMetrics,
    setPropRigMetrics,
    effectivePropRigMetrics,
    wardrobeAutoHide,
    setWardrobeAutoHide,
    wardrobeFitReport,
    wardrobeAuthoredIdentity,
    wardrobeInteractionLocked,
    vrmPhysics,
    setVrmPhysics,
    physicsPreview,
    setPhysicsPreview,
    springJointCount,
    setSpringJointCount,
    idleAnimation,
    setIdleAnimation,
    webcamActive,
    setWebcamActive,
    webcamLoading,
    setWebcamLoading,
    webcamError,
    setWebcamError,
    webcamErrorStage,
    setWebcamErrorStage,
    showConsent,
    setShowConsent,
    webcamConsentGranted,
    setWebcamConsentGranted,
    faceDetected,
    setFaceDetected,
    trackingOptions: trackingOptionsForSession,
    setTrackingOptions,
    browserPermissionState,
    setBrowserPermissionState,
    calibrating,
    setCalibrating,
    calibrationCountdown,
    setCalibrationCountdown,
    calibrationProgress,
    setCalibrationProgress,
    calibrated,
    setCalibrated,
    calibrationPersistenceStatus,
    setCalibrationPersistenceStatus,
    calibrationPersistenceMessage,
    setCalibrationPersistenceMessage,
    faceLostLong,
    setFaceLostLong,
    videoRef,
    streamRef,
    landmarkerRef,
    poseLandmarkerRef,
    handLandmarkerRef,
    channelSmootherRef,
    blinkStabilizerRef,
    qualityRef,
    calibrationRef,
    calibrationSamplerRef,
    calibrationPersistenceMountedRef,
    calibrationPersistenceGenerationRef,
    faceLostFramesRef,
    faceLostLongRef,
    lastChannelsRef,
    lastPoseBonesRef,
    lastFingersRef,
    frameIndexRef,
    webcamActiveRef,
    idleAnimationRef,
    dynamicPoseGenerationRef,
    dynamicPoseStateRef,
    trackingDataRef,
    vrmRef,
    vrmInstallGenerationRef,
    proportionRigRuntimeRef,
    proportionRigReceiptRef,
    proportionHeadMeasurementRef,
    proportionPoseReapplyRef,
    avatarForgeCommittedStateRef,
    avatarForgeAuthorityIdentityRef,
    proportionRigRevisionRef,
    captureVisualAuthorityRef,
    texturePaintRuntimeRef,
    texturePaintSnapshotRef,
    texturePaintInvalidateRef,
    texturePaintRestoreGenerationRef,
    texturePaintRestoreAbortRef,
    texturePaintMutationBlockedRef,
    wardrobeMutationBlockedRef,
    wardrobeAuthoredIdentityRef,
    wardrobeXpbdCaptureSyncRef,
    loadRequestRef,
    thumbnailRequestRef,
    insertCaptureGenerationRef,
    insertCaptureFrameRef,
    insertCaptureAbortRef,
    sharePoseAbortRef,
    captureOperationRef,
    sharedPoseListRequestRef,
    sharedPoseSelectionRequestRef,
    sharedPoseCatalogAbortRef,
    sharedPoseSelectAbortRef,
    captureRef,
    captureRequestRef,
    pendingCameraRestoreRef,
    pendingCameraRestoreFrameRef,
    panelScrollRef,
    manualPoseDetailsRef,
    jointIkTransactionRef,
    jointIkRevisionRef,
    persistentIkReconcileRevisionRef,
    persistentIkResolvedSignatureRef,
    persistentIkCurrentSignatureRef,
    garmentEvaluationGenerationRef,
    garmentEvaluationReceiptRef,
    pendingPersistentIkCommandRef,
    persistentIkReconciling,
    setPersistentIkReconciling,
    captureSceneGeneration,
    setCaptureSceneGeneration,
    groundShadowRef,
    envRootRef,
    captureHelperLeaseCountRef,
    open,
    onClose,
    onInsert,
    initialDataUrl,
    initialScene,
    seedPropId,
    onSeedObjectInsertConsumed,
    creativeRepositoryOverride,
    trackingCalibrationRepositoryOverride,
  });
  return h;
}
