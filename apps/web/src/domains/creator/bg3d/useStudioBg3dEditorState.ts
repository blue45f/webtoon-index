/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

import type { StudioBg3dKtx2Renderer } from "./studio-bg3d-ktx2-renderer-runtime";

export function useStudioBg3dEditorState(props) {
  const hostRef = R.useRef<Record<string, any> | null>(null);
  if (hostRef.current == null) hostRef.current = {};
  const h = hostRef.current;
  const {
    open, initialDataUrl, initialScene, seedSceneTemplateId = null, seedPrimitiveKind = null,
    onSeedObjectInsertConsumed, sharedSceneSession, sharedStageResolution, sharedStageSessionScopeKey,
    sharedCharactersLinkedToOtherBackgroundCount = 0, operation = "insert", recoveryScope,
    validateRecoveryAccess, onWebXrCleanupPendingChange, onClose, onInsert, onUseAsAiMethodReference,
    documentCanvasSize,
  } = props;
  const {
    useState, useRef, useCallback, useStudioBg3dSharedCharacterStatus,
    StudioBg3dPrimitiveGeometryPool, getProductStudioBg3dLtPresetSqliteRepository,
    EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD, DEFAULT_LT_USER_PRESET_DESCRIPTION,
    DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG, DEFAULT_STUDIO_BG3D_SECTION_PLANE_STATE,
    createStudioBg3dMeasurementDocument, DEFAULT_STUDIO_BG3D_SNAP_SETTINGS,
    copyStudioBg3dBundledEnvironmentLibraryEntries, createStudioBg3dPlacementSession,
    getStudioBg3dRoomPreset, collectDeviceSignals, canonicalSceneDocument,
    DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT, StudioBg3dDestructiveMutationGuard, THREE,
    applyOrDeferStudioBg3dHistoryCamera,
  } = R;
  const [primitiveGeometryPool] = useState(() => new StudioBg3dPrimitiveGeometryPool());
  const [adaptiveDprScale, setAdaptiveDprScale] = useState(1);
  const [engineFrameTimeMs, setEngineFrameTimeMs] = useState<number | null>(null);
  const {
    commitSharedCharacterTransform,
    effectiveSelectedSharedCharacter,
    effectiveSelectedSharedCharacterElementId,
    includeSharedCharactersInCapture,
    mayApplyEmptySharedStageMutation,
    selectSharedStageMutation,
    setSelectedSharedCharacterElementId,
    setSharedStageMaterializationKind,
    setSharedStageMutationKind,
    sharedCharacterCaptureElementIds,
    sharedCharacterCaptureReadiness,
    sharedCharacterGroundings,
    sharedCharacterPreviewOmissionCount,
    sharedCharacterReadyCount,
    sharedCharacterRelationshipLabel,
    sharedCharacterStatuses,
    sharedCharacterUnavailableCount,
    sharedCharacters,
    sharedStageMaterializationKind,
    sharedStageMutationKind,
    shouldStartOnSharedStageLayerTab,
    targetHasLinkedCharacters,
    targetHasSavedSharedScene,
    updateSharedCharacterGrounding,
    updateSharedCharacterStatus,
  } = useStudioBg3dSharedCharacterStatus({
    open,
    scopeKey: sharedStageSessionScopeKey,
    initialDataUrl,
    initialScene,
    operation,
    sceneSession: sharedSceneSession,
    stageResolution: sharedStageResolution,
  });
  const sharedCharacterCaptureAuthorityDraft = {
    includeCharactersInCapture: includeSharedCharactersInCapture,
    readinessPhase: sharedCharacterCaptureReadiness.phase,
    expectedCharacters: sharedCharacters.map((character) => ({
      elementId: character.elementId,
      runtimeKey: character.runtimeKey,
      modelRuntimeKey: character.modelRuntimeKey,
      placementHash: character.placementHash,
      sourceHash: character.sourceHash,
    })),
    capturableElementIds: sharedCharacterCaptureReadiness.capturableElementIds,
    previewOnlyElementIds: sharedCharacterCaptureReadiness.previewOnlyElementIds,
    pendingElementIds: sharedCharacters.flatMap((character) =>
      sharedCharacterStatuses[character.runtimeKey] === "ready"
        ? []
        : sharedCharacterStatuses[character.runtimeKey] === "unavailable"
          ? []
          : [character.elementId],
    ),
    unavailableElementIds: sharedCharacters.flatMap((character) =>
      sharedCharacterStatuses[character.runtimeKey] === "unavailable"
        ? [character.elementId]
        : [],
    ),
  } as const;
  const sharedCharacterCaptureAuthorityPayloadKey = JSON.stringify(
    sharedCharacterCaptureAuthorityDraft,
  );
  const sharedCharacterCaptureAuthorityRef =
    useRef<StudioBg3dSharedCharacterCaptureAuthorityInput | null>(null);
  const sharedCharacterCaptureAuthorityPayloadKeyRef = useRef<string | null>(null);
  const sharedCharacterCaptureAuthorityRevisionRef = useRef(0);
  const sharedCharacterCaptureStatusFenceRef = useRef(sharedCharacterStatuses);



  const [primitives, setPrimitives] = useState<BgPrimitive[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [transformMode, setTransformMode] = useState<TransformModeId>("translate");
  /** Null keeps mode defaults; an explicit transform space is view-only and tool-stable. */
  const [transformSpaceOverride, setTransformSpaceOverride] =
    useState<TransformSpace | null>(null);
  const [lineArtPreview, setLineArtPreview] = useState(false);
  const [magicLayerEnabled, setMagicLayerEnabled] = useState(false);
  const [isTransforming, setIsTransforming] = useState(false);
  const [isQuadView, setIsQuadView] = useState(false);
  const [webXrSupport, setWebXrSupport] =
    useState<StudioWebXrSupportSnapshot | null>(null);
  const [webXrSessionState, setWebXrSessionState] =
    useState<StudioWebXrSessionState>({ status: "idle" });
  const [webXrController, setWebXrController] =
    useState<StudioWebXrSessionController | null>(null);
  const [webXrRendererLifetimeRetained, setWebXrRendererLifetimeRetained] =
    useState(open);
  const [webXrBridgeGeneration, setWebXrBridgeGeneration] = useState(0);
  const [webXrCanvasGeneration, setWebXrCanvasGeneration] = useState(0);
  const [immersiveStagePlan, setImmersiveStagePlan] =
    useState<StudioBg3dImmersiveStageSuccess | null>(null);
  const webXrSessionStateRef = useRef<StudioWebXrSessionState>({ status: "idle" });
  const webXrControllerRef = useRef<StudioWebXrSessionController | null>(null);
  const webXrRestoreCameraRef = useRef<StudioBg3dCameraSettings | null>(null);
  const webXrCleanupPromiseRef = useRef<Promise<void> | null>(null);
  const webXrRendererRecreationPendingRef = useRef(false);
  const webXrCloseRequestedRef = useRef(false);
  const webXrOpenRef = useRef(open);
  const webXrMountedRef = useRef(true);
  webXrOpenRef.current = open;
  const viewTopRef = useRef<HTMLDivElement>(null);
  const viewFrontRef = useRef<HTMLDivElement>(null);
  const viewRightRef = useRef<HTMLDivElement>(null);
  const viewPerspRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePanelTab, setActivePanelTab] = useState<BgPanelTab>(
    shouldStartOnSharedStageLayerTab ? "layers" : "shapes",
  );
  const [modelsPanelActivated, setModelsPanelActivated] = useState(false);
  const [viewEditorSection, setViewEditorSection] = useState<ViewEditorSection>("camera");
  const [babylonDiagnosticState, setBabylonDiagnosticState] =
    useState<StudioBg3dBabylonDiagnosticState>({
      status: "idle",
      backend: null,
    });
  const babylonDiagnosticAbortRef = useRef<AbortController | null>(null);
  const babylonDiagnosticGenerationRef = useRef(0);
  const [physicsPhase, setPhysicsPhase] = useState<StudioBg3dPhysicsPhase>("idle");
  const [physicsDurationSeconds, setPhysicsDurationSeconds] = useState<2 | 4 | 8>(4);
  const [physicsGravityPreset, setPhysicsGravityPreset] =
    useState<StudioBg3dPhysicsGravityPreset>("earth");
  const [physicsGroundEnabled, setPhysicsGroundEnabled] = useState(true);
  const [physicsProgress, setPhysicsProgress] = useState(0);
  const [physicsCurrentSeconds, setPhysicsCurrentSeconds] = useState(0);
  const [physicsError, setPhysicsError] = useState<string | null>(null);
  const [physicsPreviewRevision, setPhysicsPreviewRevision] = useState(0);
  const [ltEditorSection, setLtEditorSection] = useState<LtEditorSection>("line");
  const [ltPresetPanelActivated, setLtPresetPanelActivated] = useState(false);
  const [ltUserPresetRepository] = useState(
    getProductStudioBg3dLtPresetSqliteRepository,
  );
  const ltUserPresetHydrationGenerationRef = useRef(0);
  const ltUserPresetMutationGenerationRef = useRef(0);
  const [ltUserPresetPayload, setLtUserPresetPayload] = useState<StudioBg3dLtPresetPayload>(
    EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD
  );
  const [ltUserPresetLibraryStatus, setLtUserPresetLibraryStatus] =
    useState<LtUserPresetLibraryStatus>("idle");
  const [ltUserPresetNotice, setLtUserPresetNotice] = useState<LtUserPresetNotice | null>(null);
  const [ltPreferredPresetId, setLtPreferredPresetId] = useState<string | null>(null);
  const [ltManagedUserPresetId, setLtManagedUserPresetId] = useState<string | null>(null);
  const [ltDeleteConfirmId, setLtDeleteConfirmId] = useState<string | null>(null);
  const [ltUserPresetName, setLtUserPresetName] = useState("");
  const [ltUserPresetDescription, setLtUserPresetDescription] = useState(
    DEFAULT_LT_USER_PRESET_DESCRIPTION
  );
  const [viewportHinted, setViewportHinted] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [shotNameDraft, setShotNameDraft] = useState("");
  /** Exclusions make newly recorded shots selected by default without effect-driven state repair. */
  const [shotBatchExcludedIds, setShotBatchExcludedIds] = useState<Set<string>>(() => new Set());
  const [shotBatchPasses, setShotBatchPasses] = useState<Set<StudioBg3dShotBatchPass>>(
    () => new Set(["lt-composite"]),
  );
  const [shotBatchIncludeLayeredPsd, setShotBatchIncludeLayeredPsd] = useState(false);
  const [shotBatchIncludeContactSheet, setShotBatchIncludeContactSheet] = useState(true);
  const [shotBatchExportHeight, setShotBatchExportHeight] = useState<"per-shot" | number>("per-shot");
  const [shotBatchProgress, setShotBatchProgress] = useState<{
    readonly stage: "render" | "contact" | "archive";
    readonly completed: number;
    readonly total: number;
    readonly label: string;
  } | null>(null);
  const [shotBatchRecoverySummary, setShotBatchRecoverySummary] = useState<{
    readonly completedShots: number;
    readonly totalShots: number;
    readonly mode: "durable" | "memory";
    readonly downloadRequested?: boolean;
    readonly degradedReason?: string | null;
  } | null>(null);
  const isBatchRenderingShots = shotBatchProgress !== null;
  // 복합 오브젝트 프리셋 그리드 카테고리 필터. null=전체.
  const [compositeCategory, setCompositeCategory] = useState<BgCompositeCategory | null>(null);
  // 씬 템플릿 그리드 카테고리 필터. null=전체. compositeCategory와 동형이지만 별개 상태 —
  // BgSceneTemplateCategory와 BgCompositeCategory는 서로 다른 타입이라 공유할 수 없다("공간 종류" vs
  // "물체 종류"라는 다른 축, studio-background-3d-scene-templates.ts 상단 주석 참고).
  const [sceneTemplateCategory, setSceneTemplateCategory] = useState<BgSceneTemplateCategory | null>(null);
  // 방 만들기(파라메트릭 블로킹) 스펙 — clampStudioBg3dRoomSpec을 통해서만 갱신되는 항상-유효 상태.
  const [roomBuilderSpec, setRoomBuilderSpec] = useState<StudioBg3dRoomSpec>(
    () => getStudioBg3dRoomPreset("studio-flat")!.spec,
  );
  // 태양·시간대 릭 컨트롤 상태 — 문서에는 applyStudioBg3dSunRig의 결과(lighting 등)만 저장된다.
  const [sunRigConfig, setSunRigConfig] = useState<StudioBg3dSunRigConfig>(
    DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG,
  );
  // 단면 컷·스케일 가이드 — 뷰포트 보조물이라 장면 문서에 저장하지 않는다(그리드와 같은 계약).
  const [sectionPlane, setSectionPlane] = useState<StudioBg3dSectionPlaneState>(
    DEFAULT_STUDIO_BG3D_SECTION_PLANE_STATE,
  );
  const [scaleGuideVisible, setScaleGuideVisible] = useState(false);
  // Persistent guides and transient two-point capture intentionally remain outside scene geometry.
  const [measurementDocument, setMeasurementDocument] =
    useState<StudioBg3dMeasurementDocument>(() => createStudioBg3dMeasurementDocument("cm"));
  const [measurementActive, setMeasurementActive] = useState(false);
  const [measurementStartWorld, setMeasurementStartWorld] =
    useState<StudioBg3dMeasurementVec3 | null>(null);
  const [measurementDraft, setMeasurementDraft] =
    useState<StudioBg3dWorldMeasurement | null>(null);
  const [measurementInference, setMeasurementInference] =
    useState<StudioBg3dMeasurementInferenceSuccess | null>(null);
  const [measurementLockedLengthMeters, setMeasurementLockedLengthMeters] =
    useState<number | null>(null);
  const [measurementStatus, setMeasurementStatus] = useState(
    "줄자를 켠 뒤 첫 번째 점을 선택하세요.",
  );
  const measurementActiveRef = useRef(false);
  // CSP-style move/rotate step snap + 레이어 목록 검색.
  const [snapSettings, setSnapSettings] = useState<StudioBg3dSnapSettings>(() => ({
    ...DEFAULT_STUDIO_BG3D_SNAP_SETTINGS,
  }));
  const [surfaceSnapArmed, setSurfaceSnapArmed] = useState(false);
  const [surfaceSnapAlignNormal, setSurfaceSnapAlignNormal] = useState(false);
  const [surfaceSnapStatus, setSurfaceSnapStatus] = useState<{
    readonly tone: "info" | "error" | "success";
    readonly message: string;
  } | null>(null);
  const [layerQuery, setLayerQuery] = useState("");

  // 업로드된 커스텀 3D 모델(§bg3d-model-library.ts)의 씬 배치 인스턴스 + 라이브러리 목록/상태.
  const [customModels, setCustomModels] = useState<BgCustomModelInstance[]>([]);
  const [modelLibrary, setModelLibrary] = useState<Bg3dModelLibraryEntry[]>(
    copyStudioBg3dBundledEnvironmentLibraryEntries,
  );
  const [modelLibraryStatus, setModelLibraryStatus] =
    useState<"idle" | "loading" | "ready" | "degraded" | "error">("idle");
  const [genericModelSourceFormats, setGenericModelSourceFormats] =
    useState<ReadonlyMap<string, StudioGeneric3dSourceFormat>>(() => new Map());
  const [genericModelClassifications, setGenericModelClassifications] =
    useState<ReadonlyMap<string, StudioGeneric3dClassification>>(() => new Map());
  const [genericModelControlMode, setGenericModelControlMode] =
    useState<StudioGeneric3dControlMode>("root");
  const [genericModelSelectedProxyId, setGenericModelSelectedProxyId] =
    useState<string | null>(null);
  const [placementSession, setPlacementSession] = useState<StudioBg3dPlacementSessionState>(
    () => createStudioBg3dPlacementSession(),
  );
  const [placementPreviewAsset, setPlacementPreviewAsset] =
    useState<StudioBg3dPlacementPreviewAsset | null>(null);
  const placementSessionRef = useRef<StudioBg3dPlacementSessionState>(placementSession);
  const placementTokenSequenceRef = useRef(0);
  // The engine-selection policy decides per session which renderer owns the canvas, so this holds
  // whichever one `onCreated` handed back. Typing it as `WebGLRenderer` used to be true and is now
  // a lie that pushes every consumer into a narrowing guard that silently drops a WebGPU session.
  const [modelRenderer, setModelRenderer] = useState<StudioBg3dKtx2Renderer | null>(null);
  const modelRendererRef = useRef<StudioBg3dKtx2Renderer | null>(null);
  const [isUploadingModel, setIsUploadingModel] = useState(false);
  const [modelImportProgress, setModelImportProgress] = useState<StudioBg3dImportProgress | null>(null);
  const modelImportAbortRef = useRef<AbortController | null>(null);
  const modelThumbnailCaptureControllerRef =
    useRef<StudioBg3dModelThumbnailCaptureController | null>(null);
  const modelThumbnailCaptureAbortRef = useRef<AbortController | null>(null);
  const modelThumbnailCaptureEpochRef = useRef(0);
  const modelThumbnailGpuLeaseRef = useRef<ModelThumbnailGpuLease | null>(null);
  const modelAnimationTimeReadersRef = useRef(new Map<string, () => number>());
  const modelRigBakeReadersRef = useRef(new Map<string, StudioBg3dRigBakeReader>());
  // 파일 분할 때 계산 자체가 누락됐던 리더 등록/애니메이션 종료 콜백 3종 — 분할 전
  // StudioBackground3D 원문 그대로 복원(소비처: SceneGraph 의 registerAnimationTime /
  // registerRigBake / onAnimationComplete props).
  const registerModelAnimationTime = useCallback((id: string, reader: (() => number) | null) => {
    if (reader) modelAnimationTimeReadersRef.current.set(id, reader);
    else modelAnimationTimeReadersRef.current.delete(id);
  }, []);
  const registerModelRigBake = useCallback((id: string, reader: StudioBg3dRigBakeReader | null) => {
    if (reader) modelRigBakeReadersRef.current.set(id, reader);
    else modelRigBakeReadersRef.current.delete(id);
  }, []);
  const finishModelAnimation = useCallback((id: string, timeSeconds: number) => {
    setCustomModels((current) => current.map((model) => {
      if (model.id !== id || !model.animation?.playing) return model;
      return {
        ...model,
        animation: { ...model.animation, playing: false, timeSeconds },
      };
    }));
  }, []);
  const [poseJointSelection, setPoseJointSelection] =
    useState<StudioBg3dRigSelectionState | null>(null);
  const [ikEndJointSelection, setIkEndJointSelection] = useState<{
    readonly modelId: string;
    readonly jointKey: string;
  } | null>(null);
  const [morphTargetSelection, setMorphTargetSelection] = useState<{
    readonly modelId: string;
    readonly key: string;
  } | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [isRestoringScene, setIsRestoringScene] = useState(false);
  const sceneRestoreAbortRef = useRef<AbortController | null>(null);
  const [templateLibrary, setTemplateLibrary] = useState<Bg3dTemplateLibraryEntry[]>([]);
  const [templateLibraryStatus, setTemplateLibraryStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);

  
  

    const [sceneRecoveryError, setSceneRecoveryError] = useState<string | null>(null);
  const [failedCloneIds, setFailedCloneIds] = useState<Set<string>>(() => new Set());
  const [readyCloneIds, setReadyCloneIds] = useState<Set<string>>(() => new Set());
  const [unbatchableModelIds, setUnbatchableModelIds] = useState<Set<string>>(() => new Set());
  const [sceneBaseDocument, setSceneBaseDocument] = useState<StudioBg3dSceneDocument>(
    () => canonicalSceneDocument(initialScene) ?? DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT
  );

  const captureRef = useRef<CaptureState>({ adapter: null, camera: null });
  const modalDialogRef = useRef<HTMLDivElement | null>(null);
  const modalRootRef = useRef<HTMLElement | null>(null);
  const viewportApiRef = useRef<BgViewportApi | null>(null);
  const pendingInitialCameraRef = useRef<StudioBg3dCameraSettings | null>(null);
  const cameraLensGestureBeforeViewRef = useRef<StudioBg3dCameraSettings | null>(null);
  const cameraLensGestureLatestViewRef = useRef<StudioBg3dCameraSettings | null>(null);
  const cameraLensGestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewportHostRef = useRef<HTMLDivElement>(null);
  // 세이프 프레임 오버레이는 캡처와 같은 식을 쓰려면 살아 있는 뷰포트 CSS 박스를 알아야 한다.
  const [viewportBoxSize, setViewportBoxSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const primitiveObjectsRef = useRef<Map<string, THREE.Group>>(new Map());
  const surfaceSnapArmedRef = useRef(false);
  const dragInitialSelectedTransformsRef = useRef<Map<string, {
    worldMatrix: THREE.Matrix4;
  }>>(new Map());
  const dragInitialFirstTransformRef = useRef<{
    worldMatrix: THREE.Matrix4;
  } | null>(null);
  const [, setRefTick] = useState(0);
  const panelScrollRef = useRef<HTMLDivElement>(null);
  // storage id는 이 두 Map과 검증 캐시 안에서만 쓰며 Studio 장면 문서에는 절대 직렬화하지 않는다.
  const modelRootCacheRef = useRef<Map<string, ModelRootCacheEntry>>(new Map());
  const modelLoadPendingRef = useRef<Map<string, Promise<ModelRootCacheEntry>>>(new Map());
  const attachmentByStorageModelIdRef = useRef<Map<string, StudioBg3dModelAttachment>>(new Map());
  const storageModelIdByAttachmentIdRef = useRef<Map<string, string>>(new Map());
  const componentActiveRef = useRef(false);
  const modalAssetSessionRef = useRef<StudioBg3dModalSession | null>(null);
  const captureInFlightRef = useRef(false);
  const invalidateModelThumbnailCaptures = useCallback((): Promise<void> | null => {
    const thumbnailLease = modelThumbnailGpuLeaseRef.current;
    modelThumbnailCaptureEpochRef.current += 1;
    modelThumbnailCaptureAbortRef.current?.abort();
    modelThumbnailCaptureAbortRef.current = null;
    modelThumbnailCaptureControllerRef.current?.invalidate();
    // The isolated adapter restores every live renderer property synchronously after submitting
    // readback. An abort may therefore release this UI lease even when the GPU fence settles late;
    // the disposed handle keeps its private graph alive until that fence actually finishes.
    thumbnailLease?.release();
    return thumbnailLease?.released ?? null;
  }, []);
  const ltInsertAbortRef = useRef<AbortController | null>(null);
  const aiMethodReferenceAbortRef = useRef<AbortController | null>(null);
  const ltInsertSceneEpochRef = useRef(0);
  const ltMagicSelectionEpochRef = useRef(0);
  const ltMagicCaptureGenerationRef = useRef(0);
  const ltInsertRestoreLineArtPreviewRef = useRef<boolean | null>(null);
  const destructiveMutationGuardRef = useRef(new StudioBg3dDestructiveMutationGuard());
  const shotBatchAbortRef = useRef<AbortController | null>(null);
  const shotBatchRecoveryRef = useRef<StudioBg3dShotBatchRecoverySession | null>(null);
  const shotBatchRecoveryScopeRef = useRef<{
    readonly controller: AbortController;
    readonly scope: StudioBg3dShotBatchRecoveryScope;
  } | null>(null);
  const shotBatchRecoveryStoreRef = useRef<StudioBg3dShotBatchRecoveryStore | null>(null);
  const shotBatchAuthorizationEpochRef = useRef(0);
  const physicsPhaseRef = useRef<StudioBg3dPhysicsPhase>("idle");
  const physicsAbortRef = useRef<AbortController | null>(null);
  const physicsAnimationFrameRef = useRef<number | null>(null);
  const physicsGenerationRef = useRef(0);
  const physicsPlaybackStartedAtRef = useRef(0);
  const physicsPlaybackOffsetRef = useRef(0);
  const physicsLastUiUpdateRef = useRef(0);
  const physicsLastFrameTimestampRef = useRef(0);
  const latestPhysicsSamplesRef = useRef<readonly StudioBg3dPhysicsTransformSample[]>([]);
  const physicsSessionRef = useRef<StudioBg3dPhysicsSession | null>(null);
  const physicsWorkerSessionRef = useRef<StudioBg3dPhysicsTimelineWorkerSession | null>(null);
  const physicsRuntimeSourceRef = useRef({
    primitives,
    customModels,
    document: sceneBaseDocument,
  });
  physicsRuntimeSourceRef.current = { primitives, customModels, document: sceneBaseDocument };
  const physicsStartButtonRef = useRef<HTMLButtonElement | null>(null);
  const physicsTransportActionRef = useRef<HTMLButtonElement | null>(null);
  const shouldTransferPhysicsFocusRef = useRef(false);







  const handleViewportReady = useCallback((api: BgViewportApi | null) => {
    viewportApiRef.current = api;
    const pendingView = pendingInitialCameraRef.current;
    if (api && pendingView) {
      applyOrDeferStudioBg3dHistoryCamera(api, pendingInitialCameraRef, pendingView);
    }
  }, []);









  const historyRef = useRef<StudioBg3dHistorySnapshot[]>([]);
  const historyIndexRef = useRef(-1);

  Object.assign(h, {
    primitiveGeometryPool,
    adaptiveDprScale,
    setAdaptiveDprScale,
    engineFrameTimeMs,
    setEngineFrameTimeMs,
    sharedCharacterCaptureAuthorityDraft,
    sharedCharacterCaptureAuthorityPayloadKey,
    sharedCharacterCaptureAuthorityRef,
    sharedCharacterCaptureAuthorityPayloadKeyRef,
    sharedCharacterCaptureAuthorityRevisionRef,
    sharedCharacterCaptureStatusFenceRef,
    primitives,
    setPrimitives,
    selectedIds,
    setSelectedIds,
    transformMode,
    setTransformMode,
    transformSpaceOverride,
    setTransformSpaceOverride,
    lineArtPreview,
    setLineArtPreview,
    magicLayerEnabled,
    setMagicLayerEnabled,
    isTransforming,
    setIsTransforming,
    isQuadView,
    setIsQuadView,
    webXrSupport,
    setWebXrSupport,
    webXrSessionState,
    setWebXrSessionState,
    webXrController,
    setWebXrController,
    webXrRendererLifetimeRetained,
    setWebXrRendererLifetimeRetained,
    webXrBridgeGeneration,
    setWebXrBridgeGeneration,
    webXrCanvasGeneration,
    setWebXrCanvasGeneration,
    immersiveStagePlan,
    setImmersiveStagePlan,
    webXrSessionStateRef,
    webXrControllerRef,
    webXrRestoreCameraRef,
    webXrCleanupPromiseRef,
    webXrRendererRecreationPendingRef,
    webXrCloseRequestedRef,
    webXrOpenRef,
    webXrMountedRef,
    viewTopRef,
    viewFrontRef,
    viewRightRef,
    viewPerspRef,
    isCapturing,
    setIsCapturing,
    error,
    setError,
    activePanelTab,
    setActivePanelTab,
    modelsPanelActivated,
    setModelsPanelActivated,
    viewEditorSection,
    setViewEditorSection,
    babylonDiagnosticState,
    setBabylonDiagnosticState,
    babylonDiagnosticAbortRef,
    babylonDiagnosticGenerationRef,
    physicsPhase,
    setPhysicsPhase,
    physicsDurationSeconds,
    setPhysicsDurationSeconds,
    physicsGravityPreset,
    setPhysicsGravityPreset,
    physicsGroundEnabled,
    setPhysicsGroundEnabled,
    physicsProgress,
    setPhysicsProgress,
    physicsCurrentSeconds,
    setPhysicsCurrentSeconds,
    physicsError,
    setPhysicsError,
    physicsPreviewRevision,
    setPhysicsPreviewRevision,
    ltEditorSection,
    setLtEditorSection,
    ltPresetPanelActivated,
    setLtPresetPanelActivated,
    ltUserPresetRepository,
    ltUserPresetHydrationGenerationRef,
    ltUserPresetMutationGenerationRef,
    ltUserPresetPayload,
    setLtUserPresetPayload,
    ltUserPresetLibraryStatus,
    setLtUserPresetLibraryStatus,
    ltUserPresetNotice,
    setLtUserPresetNotice,
    ltPreferredPresetId,
    setLtPreferredPresetId,
    ltManagedUserPresetId,
    setLtManagedUserPresetId,
    ltDeleteConfirmId,
    setLtDeleteConfirmId,
    ltUserPresetName,
    setLtUserPresetName,
    ltUserPresetDescription,
    setLtUserPresetDescription,
    viewportHinted,
    setViewportHinted,
    canUndo,
    setCanUndo,
    canRedo,
    setCanRedo,
    shotNameDraft,
    setShotNameDraft,
    shotBatchExcludedIds,
    setShotBatchExcludedIds,
    shotBatchPasses,
    setShotBatchPasses,
    shotBatchIncludeLayeredPsd,
    setShotBatchIncludeLayeredPsd,
    shotBatchIncludeContactSheet,
    setShotBatchIncludeContactSheet,
    shotBatchExportHeight,
    setShotBatchExportHeight,
    shotBatchProgress,
    setShotBatchProgress,
    shotBatchRecoverySummary,
    setShotBatchRecoverySummary,
    isBatchRenderingShots,
    compositeCategory,
    setCompositeCategory,
    sceneTemplateCategory,
    setSceneTemplateCategory,
    roomBuilderSpec,
    setRoomBuilderSpec,
    sunRigConfig,
    setSunRigConfig,
    sectionPlane,
    setSectionPlane,
    scaleGuideVisible,
    setScaleGuideVisible,
    measurementDocument,
    setMeasurementDocument,
    measurementActive,
    setMeasurementActive,
    measurementStartWorld,
    setMeasurementStartWorld,
    measurementDraft,
    setMeasurementDraft,
    measurementInference,
    setMeasurementInference,
    measurementLockedLengthMeters,
    setMeasurementLockedLengthMeters,
    measurementStatus,
    setMeasurementStatus,
    measurementActiveRef,
    snapSettings,
    setSnapSettings,
    surfaceSnapArmed,
    setSurfaceSnapArmed,
    surfaceSnapAlignNormal,
    setSurfaceSnapAlignNormal,
    surfaceSnapStatus,
    setSurfaceSnapStatus,
    layerQuery,
    setLayerQuery,
    customModels,
    setCustomModels,
    modelLibrary,
    setModelLibrary,
    modelLibraryStatus,
    setModelLibraryStatus,
    genericModelSourceFormats,
    setGenericModelSourceFormats,
    genericModelClassifications,
    setGenericModelClassifications,
    genericModelControlMode,
    setGenericModelControlMode,
    genericModelSelectedProxyId,
    setGenericModelSelectedProxyId,
    placementSession,
    setPlacementSession,
    placementPreviewAsset,
    setPlacementPreviewAsset,
    placementSessionRef,
    placementTokenSequenceRef,
    modelRenderer,
    setModelRenderer,
    modelRendererRef,
    isUploadingModel,
    setIsUploadingModel,
    modelImportProgress,
    setModelImportProgress,
    modelImportAbortRef,
    modelThumbnailCaptureControllerRef,
    modelThumbnailCaptureAbortRef,
    modelThumbnailCaptureEpochRef,
    modelThumbnailGpuLeaseRef,
    modelAnimationTimeReadersRef,
    modelRigBakeReadersRef,
    registerModelAnimationTime,
    registerModelRigBake,
    finishModelAnimation,
    poseJointSelection,
    setPoseJointSelection,
    ikEndJointSelection,
    setIkEndJointSelection,
    morphTargetSelection,
    setMorphTargetSelection,
    deletingModelId,
    setDeletingModelId,
    isRestoringScene,
    setIsRestoringScene,
    sceneRestoreAbortRef,
    templateLibrary,
    setTemplateLibrary,
    templateLibraryStatus,
    setTemplateLibraryStatus,
    isSavingTemplate,
    setIsSavingTemplate,
    applyingTemplateId,
    setApplyingTemplateId,
    sceneRecoveryError,
    setSceneRecoveryError,
    failedCloneIds,
    setFailedCloneIds,
    readyCloneIds,
    setReadyCloneIds,
    unbatchableModelIds,
    setUnbatchableModelIds,
    sceneBaseDocument,
    setSceneBaseDocument,
    captureRef,
    modalDialogRef,
    modalRootRef,
    viewportApiRef,
    pendingInitialCameraRef,
    cameraLensGestureBeforeViewRef,
    cameraLensGestureLatestViewRef,
    cameraLensGestureTimerRef,
    viewportHostRef,
    viewportBoxSize,
    setViewportBoxSize,
    primitiveObjectsRef,
    surfaceSnapArmedRef,
    dragInitialSelectedTransformsRef,
    dragInitialFirstTransformRef,
    panelScrollRef,
    modelRootCacheRef,
    modelLoadPendingRef,
    attachmentByStorageModelIdRef,
    storageModelIdByAttachmentIdRef,
    componentActiveRef,
    modalAssetSessionRef,
    captureInFlightRef,
    invalidateModelThumbnailCaptures,
    // `thumbnailLease` 는 위 invalidateModelThumbnailCaptures 콜백의 지역 변수다 — 추출 때
    // 호스트 백 목록에 잘못 올라와 이 객체 리터럴 평가가 ReferenceError 를 던졌고, BG3D
    // 편집기가 마운트 자체를 못 했다(@ts-nocheck 파일이라 tsc 가 잡지 못한다). 소비자는 없다.
    ltInsertAbortRef,
    aiMethodReferenceAbortRef,
    ltInsertSceneEpochRef,
    ltMagicSelectionEpochRef,
    ltMagicCaptureGenerationRef,
    ltInsertRestoreLineArtPreviewRef,
    destructiveMutationGuardRef,
    shotBatchAbortRef,
    shotBatchRecoveryRef,
    shotBatchRecoveryScopeRef,
    shotBatchRecoveryStoreRef,
    shotBatchAuthorizationEpochRef,
    physicsPhaseRef,
    physicsAbortRef,
    physicsAnimationFrameRef,
    physicsGenerationRef,
    physicsPlaybackStartedAtRef,
    physicsPlaybackOffsetRef,
    physicsLastUiUpdateRef,
    physicsLastFrameTimestampRef,
    latestPhysicsSamplesRef,
    physicsSessionRef,
    physicsWorkerSessionRef,
    physicsRuntimeSourceRef,
    physicsStartButtonRef,
    physicsTransportActionRef,
    shouldTransferPhysicsFocusRef,
    handleViewportReady,
    setRefTick,
    historyRef,
    historyIndexRef,
    commitSharedCharacterTransform,
    effectiveSelectedSharedCharacter,
    effectiveSelectedSharedCharacterElementId,
    includeSharedCharactersInCapture,
    mayApplyEmptySharedStageMutation,
    selectSharedStageMutation,
    setSelectedSharedCharacterElementId,
    setSharedStageMaterializationKind,
    setSharedStageMutationKind,
    sharedCharacterCaptureElementIds,
    sharedCharacterCaptureReadiness,
    sharedCharacterGroundings,
    sharedCharacterPreviewOmissionCount,
    sharedCharacterReadyCount,
    sharedCharacterRelationshipLabel,
    sharedCharacterStatuses,
    sharedCharacterUnavailableCount,
    sharedCharacters,
    sharedStageMaterializationKind,
    sharedStageMutationKind,
    shouldStartOnSharedStageLayerTab,
    targetHasLinkedCharacters,
    targetHasSavedSharedScene,
    updateSharedCharacterGrounding,
    updateSharedCharacterStatus,
    open,
    initialDataUrl,
    initialScene,
    seedSceneTemplateId,
    seedPrimitiveKind,
    onSeedObjectInsertConsumed,
    sharedSceneSession,
    sharedStageResolution,
    sharedStageSessionScopeKey,
    sharedCharactersLinkedToOtherBackgroundCount,
    operation,
    recoveryScope,
    validateRecoveryAccess,
    onWebXrCleanupPendingChange,
    onClose,
    onInsert,
    onUseAsAiMethodReference,
    documentCanvasSize,
  });
  return h;
}
