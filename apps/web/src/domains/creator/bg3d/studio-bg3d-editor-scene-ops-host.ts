/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";
import {
  allocateStudioBg3dTemplateInstanceNodeIds,
  collectStudioBg3dTemplateInstances,
  orderStudioBg3dHierarchySelectionRootsFirst,
  resolveStudioBg3dDuplicateHierarchyPatch,
  resolveStudioBg3dTemplateSourceByKey,
} from "./studio-bg3d-template-instance";
import { readStudioBg3dTemplateStaticModelWorldBounds } from "./studio-bg3d-template-organizer-bounds";

export function attachStudioBg3dEditorSceneOpsHost(h) {
  const {
    THREE, OrbitControls, OrthographicCamera, PerspectiveCamera,
    TransformControls, View, Canvas, useThree,
    Aperture, Boxes, Camera, ChevronDown,
    CircleDashed, Copy, Crosshair, Eye,
    EyeOff, Globe, Hexagon, Home,
    Layers, LayoutTemplate, Loader2, LocateFixed,
    Lock, Magnet, Maximize2, Move,
    MoveDown, PencilLine, Redo2, RotateCcw,
    RotateCw, Ruler, Save, ScanLine,
    Scissors, Trash2, SunMoon, Undo2,
    Unlock, Upload, WandSparkles, X,
    ZoomIn, ZoomOut, Suspense, useEffect,
    useEffectEvent, useCallback, useLayoutEffect, useRef,
    useState, Fragment, lazy, createPortal,
    flushSync, createStudioBg3dAiMethodReferenceCapture, COMPOSITE_CATEGORIES, COMPOSITE_CATEGORY_LABELS,
    COMPOSITE_PRESETS, instantiateCompositePreset, cloneBgCustomModelInstances, createBgCustomModelInstance,
    duplicateBgCustomModelInstance, isStudioBg3dThreeTwoBoneIkChainSupported, measureBg3dObjectSize, parseBg3dSceneWithModelsFromDataUrl,
    StudioBg3dThreeOperationError, clonePrimitives, createPrimitive, duplicatePrimitive,
    PRIMITIVE_DEFS, BG_SCENE_TEMPLATES, instantiateSceneTemplate, BG_SKY_PRESETS,
    getSkyPreset, normalizePanoramaRotationDegrees, createStudioGeneric3dRightsFromAttachment, createStudioGeneric3dVerifiedManifest,
    createStudioGeneric3dPoseProxies, mergeStudioGeneric3dWorkflowMaps, normalizeStudioGeneric3dClassification, normalizeStudioGeneric3dSourceFormat,
    parseStudioGeneric3dWorkflowMetadata, createTwoBoneDefaultPoleTarget, createStudioShared3dCharacterShadowEntity, StudioGeneric3dModelModePanel,
    StudioToolHintTarget, useStudioBg3dSharedCharacterStatus, useStudioModalSheet, snapshotStudioBg3dLiveAnimationPlayback,
    STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION, STUDIO_BG3D_BEAUTY_RGBA8_PROFILE, STUDIO_BG3D_DEPTH_FLOAT32_PROFILE, STUDIO_BG3D_NORMAL_PROFILE,
    STUDIO_BG3D_STABLE_ID_PROFILE, normalizeStudioBg3dArtifactCaptureResultV2, copyStudioBg3dBundledEnvironmentLibraryEntries, isStudioBg3dViewportControlTarget,
    readStudioBg3dObjectWorldBounds, readStudioBg3dWorldSurfaceHit, fitStudioBg3dCameraToBounds, applyOrDeferStudioBg3dHistoryCamera,
    resolveStudioBg3dCameraGestureCommitView, createStudioBg3dCameraUpForDutchRoll, readStudioBg3dCameraDutchRollDegrees, resolveStudioBg3dCameraDistanceLimits,
    resolveStudioBg3dCameraNearClip, resolveStudioBg3dCameraUpVector, createStudioBg3dCaptureBackgroundSnapshot, studioBg3dCaptureBackgroundRequestFromSnapshot,
    registerStudioBg3dCaptureExcludedObject, STUDIO_BG3D_CAPTURE_ASPECT_PRESETS, createStudioBg3dDocumentCaptureAspectPreset, matchStudioBg3dCaptureAspectPreset,
    normalizeStudioBg3dCaptureAspectRatio, resolveStudioBg3dCaptureFrame, resolveStudioBg3dCaptureFrameCameraSettings, applyStudioBg3dCaptureFrameViewOffset,
    BgAnimationPlayhead, LtRangeControl, LtToggleRow, PanoramaRotationNumberField,
    Vec3Field, StudioBg3dDestructiveMutationGuard, deriveStudioBg3dGlbValidationPolicy, resolveStudioBg3dDeviceQuality,
    acquireStudioBg3dCaptureAdapterAfterViewTransition, CAMERA_PRESETS, canonicalSceneDocument, captureStudioBg3dRaster,
    collectDeviceSignals, createStudioBg3dHistorySnapshot, createStudioBg3dShotId, degToRad,
    describeStudioBg3dPhysicsStatus, eulerDegreesToQuaternion, formatBg3dSunTime, generateLtUserPresetId,
    getStudioBg3dCaptureSourceSize, loadStudioBg3dThreeWebglCaptureRuntime, ltTonePreviewStyle, ltUserPresetFailureMessage,
    matchingLtPreset, quaternionToEulerDegrees, radToDeg, resolveDeviceQuality,
    SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE, studioBg3dHistoryDocumentAtView, studioBg3dMagicCaptureCompatibilityMessage, waitForStudioBg3dPaintFrame,
    createStudioBg3dModelImportActions, CONTROL_BUTTON, ICON_BUTTON, cx,
    canSetStudioBg3dParent, collectStudioBg3dEffectivelyVisibleEntityIds, resolveStudioBg3dHierarchy, planStudioBg3dImmersiveStage,
    studioBg3dImmersiveStageFailureMessage, resolveStudioBg3dInsertBackgroundFromDocument, resolveStudioBg3dInsertBackgroundMode, STUDIO_BG3D_LENS_MAX_FOCAL_MM,
    STUDIO_BG3D_LENS_MIN_FOCAL_MM, STUDIO_BG3D_LENS_PRESETS, computeStudioBg3dTwoPointPerspective, isStudioBg3dTwoPointPerspectiveActive,
    studioBg3dFocalLengthToFovDegrees, studioBg3dFovDegreesToFocalLength, resolveStudioBg3dLtCaptureSize, encodeStudioBg3dLtLayers,
    EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD, createStudioBg3dLtUserPreset, deleteStudioBg3dLtUserPreset, renameStudioBg3dLtUserPreset,
    upsertStudioBg3dLtUserPreset, getProductStudioBg3dLtPresetSqliteRepository, STUDIO_BG3D_LT_BUILT_IN_PRESETS, STUDIO_BG3D_LT_PRESET_MAX_COUNT,
    STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH, STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH, applyStudioBg3dLtPreset, renderStudioBg3dLtLayers,
    STUDIO_BG3D_LT_RENDER_MAX_PIXELS, renderStudioBg3dLtLayersInWorker, StudioBg3dLtRenderWorkerError, buildStudioBg3dMagicFilterMask,
    encodeStudioBg3dMagicMaskPngDataUrl, captureStudioBg3dMagicObjectIds, STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES, resolveStudioBg3dMagicSelection,
    STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES, classifyStudioBg3dMeasurementInference, createStudioBg3dMeasurementDocument, formatStudioBg3dMeasurementLength,
    lockStudioBg3dMeasurementLength, measureStudioBg3dWorldPoints, resolveStudioBg3dMeasurementGuide, readStudioBg3dMeasurementPointFromThreeEvent,
    StudioBg3dStaleModalOperationError, studioBg3dModalOperationCoordinator, createStudioBg3dModelAttachment, getStoredBg3dModel,
    getStoredBg3dModelByHash, listBg3dModelLibraryEntries, resolveBg3dModelHash, assertStudioBg3dModelAttachmentAdmission,
    calculateStudioBg3dPlacedModelBytes, StudioBg3dModelPlacementAdmissionError, totalStudioBg3dModelAttachmentBytes, admitAndCacheModel,
    attachmentMatchesRecord, bindModelAttachment, disposeModelCache, readGenericWorkflowMapsFromAttachments,
    withStudioGeneric3dWorkflowMetadata, encodeStudioBg3dModelThumbnailPng, applyStudioBg3dMoodRig, resolveStudioBg3dAppliedMoodRig,
    STUDIO_BG3D_MOOD_RIGS, applyStudioBg3dSnapToTransform, DEFAULT_STUDIO_BG3D_SNAP_SETTINGS, filterStudioBg3dLayerItems,
    groundModelTransform, groundPrimitiveTransform, isBgObjectLocked, isBgObjectTransformBlocked,
    isBgObjectVisible, normalizeStudioBg3dSnapSettings, STUDIO_BG3D_ROTATE_STEP_OPTIONS_DEG, STUDIO_BG3D_TRANSLATE_STEP_OPTIONS,
    studioBg3dSnapSettingsSummary, deriveStudioBg3dVanishingPoints, applyStudioBg3dPhysicsTransforms, createStudioBg3dPhysicsWorld,
    STUDIO_BG3D_PHYSICS_MAX_DYNAMIC_BODIES, createStudioBg3dPhysicsSessionSourceToken, isStudioBg3dPhysicsSessionSourceCurrent, createStudioBg3dPhysicsThreeJob,
    measureStudioBg3dPhysicsModelLocalBounds, projectStudioBg3dPhysicsSamples, STUDIO_BG3D_PHYSICS_PROJECTION_ROOT_USER_DATA_KEY, sampleStudioBg3dPhysicsTimeline,
    isStudioBg3dPhysicsTransientPhase, STUDIO_BG3D_PHYSICS_GRAVITY, planStudioBg3dModelPlacementRecipe, createStudioBg3dPlacementSession,
    transitionStudioBg3dPlacementSession, calculateStudioBg3dProceduralSceneUsage, getStudioBg3dProceduralStarterAsset, planStudioBg3dProceduralStarterInsertion,
    StudioBg3dPrimitiveGeometryPool, resolveStudioBg3dFrameLoop, resolveStudioBg3dReturnFocus, createStudioBg3dRigPoseBakeHistoryTransition,
    mutateStudioBg3dAimConstraint, mutateStudioBg3dPoseOverride, mutateStudioBg3dTwoBoneIkConstraint, resolveStudioBg3dRigSelection,
    clampStudioBg3dRoomSpec, getStudioBg3dRoomPreset, instantiateStudioBg3dRoomBuild, createStudioBg3dRuntimeSnapshot,
    DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK, DEFAULT_STUDIO_BG3D_CONSTRAINT_LAYER, DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE, DEFAULT_STUDIO_BG3D_POSE_LAYER,
    DEFAULT_STUDIO_BG3D_MORPH_LAYER, DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT, STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS, STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
    STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS, STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS, applyStudioBg3dShot, captureStudioBg3dShot,
    duplicateStudioBg3dShot, moveStudioBg3dShot, normalizeStudioBg3dSceneDocument, removeStudioBg3dShot,
    STUDIO_BG3D_FOG_MIN_GAP, STUDIO_BG3D_FOG_PRESETS, planStudioBg3dDeletedAttachmentReconciliation, planStudioBg3dSceneEntityRemoval,
    hydrateStudioBg3dDocumentToRuntime, tryAdaptStudioBg3dRuntimeToDocument, DEFAULT_STUDIO_BG3D_SECTION_PLANE_STATE, STUDIO_BG3D_SECTION_AXES,
    STUDIO_BG3D_SECTION_AXIS_LABELS, STUDIO_BG3D_SECTION_OFFSET_LIMIT, createStudioBg3dSemanticRenderPassPlan, collectStudioBg3dShadowSceneBounds,
    fitStudioBg3dDirectionalShadowFrustum, readStudioBg3dShadowGeometryLocalBounds, readStudioBg3dShadowModelLocalBounds, acquireStudioBg3dSharedCharacterCaptureAuthorityLease,
    verifyStudioBg3dSharedCharacterCaptureAuthorityLease, createStudioBg3dLinkedCharacterCapture, createStudioBg3dSharedCharacterGroundSurfaceRevision, resolveStudioBg3dSharedStageMutationBlockedReason,
    createStudioBg3dShotBatchExportRunner, STUDIO_BG3D_SHOT_BATCH_PASSES, STUDIO_BG3D_SHOT_BATCH_PASS_LABELS, projectStudioBg3dShotVisibilityToRuntime,
    createStudioBg3dBabylonDiagnosticDocument, hasStudioBg3dBabylonDiagnosticBeautyVariation, hasStudioBg3dBabylonDiagnosticDepthVariation, hasStudioBg3dBabylonDiagnosticNormalVariation,
    hasStudioBg3dBabylonDiagnosticStableIds, studioBg3dBabylonDiagnosticErrorMessage, DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG, STUDIO_BG3D_SUN_TIME_PRESETS,
    applyStudioBg3dSunRig, resolveStudioBg3dSunLightState, buildStudioBg3dSurfacePresetOverride, STUDIO_BG3D_SURFACE_PRESETS,
    collectStudioBg3dSurfaceSelectionSubtreeIds, collectStudioBg3dSurfaceTargetPathIds, planStudioBg3dMultiSurfaceSnap, STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS,
    deleteBg3dTemplate, instantiateBg3dTemplateDocument, listBg3dTemplates, saveBg3dTemplate,
    calculateStudioBg3dThreeReparentTransform, calculateStudioBg3dThreeWorldMatrix, calculateStudioBg3dThreeWorldDeltaTransform, resolveStudioBg3dThreeCenterGroundLocalPosition,
    applyStudioBg3dThreeWebglRenderSettings, ADD_BUTTONS, BG_PANEL_TABS, BG3D_VIEWPORT_HINTS,
    DEFAULT_LT_USER_PRESET_DESCRIPTION, EMPTY_THREE_ANIMATION_CLIPS, EMPTY_THREE_JOINTS, EMPTY_THREE_MORPH_TARGETS,
    loadStudioBg3dBabylonSpecialistEntry, loadStudioBg3dModelThumbnailRuntime, LT_EXPORT_HEIGHTS, LT_TONE_MODE_LABELS,
    LT_TONE_PATTERN_LABELS, LT_TONE_TYPE_LABELS, SEMANTIC_MATERIAL_CONFIDENCE_LABELS, SEMANTIC_MATERIAL_SLOT_LABELS,
    STUDIO_BG3D_LT_INSERT_WORKER_TIMEOUT_MS, TRANSFORM_MODES, VIEW_EDITOR_SECTIONS,
    VIEWPORT_BTN, StudioBg3dActionFooter, StudioBg3dDirectionalShadowLight, StudioBg3dImmersivePanel,
    StudioBg3dLtPanel, StudioBg3dMeasurementPanel, StudioBg3dMeasurementViewport, StudioBg3dPhysicsPanel,
    StudioBg3dPhysicsTransport, StudioBg3dPlacementPointerController, StudioBg3dRoomBuilderPanel, StudioBg3dSceneFog,
    BgAdaptiveDprController, BgCustomModelInstanceBatch, BgCustomModelMesh, BgGroundHelper,
    BgPlacementPreview, BgPrimitiveMesh, BgScaleGuide, BgSectionPlaneController,
    BgViewportController, SkyClearColorController, StudioBg3dThreeRenderSettingsController, StudioBg3dScenePanorama,
    StudioBg3dSceneTemplatePanel, StudioBg3dShapesPanel, StudioBg3dSharedCharacterSceneContent, StudioBg3dSharedCharacterStatusOverlay,
    StudioBg3dSharedStagePanel, StudioBg3dViewPanel, StudioBg3dImmersiveRenderBridge, StudioBg3dWebXrSessionBridge,
    StudioBg3dCaptureAdapter, StudioBg3dCaptureRequest, StudioBg3dImmersiveStagePlan, StudioBg3dImportProgress,
    StudioBg3dModelThumbnailCaptureController, StudioBg3dModelThumbnailThreeCaptureHandle, StudioBg3dPhysicsTimelineWorkerSession, StudioBg3dShotBatchPass,
    StudioBg3dShotBatchRecoveryScope, StudioBg3dShotBatchRecoverySession, StudioBg3dShotBatchRecoveryStore, StudioBackground3DInsertResult,
    StudioToolHintSpec, StudioWebXrMode, StudioWebXrSessionController, StudioWebXrSessionState,
    StudioWebXrSupportSnapshot, open, initialDataUrl, initialScene,
    seedSceneTemplateId, seedPrimitiveKind, onSeedObjectInsertConsumed, sharedSceneSession,
    sharedStageResolution, sharedStageSessionScopeKey, sharedCharactersLinkedToOtherBackgroundCount, operation,
    recoveryScope, validateRecoveryAccess, onWebXrCleanupPendingChange, onClose,
    onInsert, onUseAsAiMethodReference, documentCanvasSize, primitiveGeometryPool,
    adaptiveDprScale, setAdaptiveDprScale, sharedCharacterCaptureAuthorityDraft, sharedCharacterCaptureAuthorityPayloadKey,
    readSharedCharacterCaptureAuthorityDraft, sharedCharacterCaptureAuthorityPayloadKeyRef, sharedCharacterCaptureAuthorityRevisionRef, sharedCharacterCaptureStatusFenceRef,
    updateSharedCharacterStatusWithCaptureFence, acquireSharedCharacterCaptureAuthority, verifySharedCharacterCaptureAuthority, primitives,
    setPrimitives, selectedIds, setSelectedIds, transformMode,
    setTransformMode, lineArtPreview, setLineArtPreview, magicLayerEnabled,
    setMagicLayerEnabled, isTransforming, setIsTransforming, isQuadView,
    setIsQuadView, webXrBridgeGeneration, setWebXrBridgeGeneration, webXrCanvasGeneration,
    setWebXrCanvasGeneration, webXrSessionStateRef, webXrControllerRef, webXrRestoreCameraRef,
    webXrCleanupPromiseRef, webXrRendererRecreationPendingRef, webXrCloseRequestedRef, webXrOpenRef,
    webXrMountedRef, viewTopRef, viewFrontRef, viewRightRef,
    viewPerspRef, isCapturing, setIsCapturing, error,
    setError, activePanelTab, setActivePanelTab, modelsPanelActivated,
    setModelsPanelActivated, viewEditorSection, setViewEditorSection, babylonDiagnosticAbortRef,
    babylonDiagnosticGenerationRef, physicsPhase, setPhysicsPhase, physicsDurationSeconds,
    setPhysicsDurationSeconds, physicsGroundEnabled, setPhysicsGroundEnabled, physicsProgress,
    setPhysicsProgress, physicsCurrentSeconds, setPhysicsCurrentSeconds, physicsError,
    setPhysicsError, physicsPreviewRevision, setPhysicsPreviewRevision, ltEditorSection,
    setLtEditorSection, ltPresetPanelActivated, setLtPresetPanelActivated, ltUserPresetRepository,
    ltUserPresetHydrationGenerationRef, ltUserPresetMutationGenerationRef, ltUserPresetPayload, setLtUserPresetPayload,
    ltUserPresetNotice, setLtUserPresetNotice, ltPreferredPresetId, setLtPreferredPresetId,
    ltManagedUserPresetId, setLtManagedUserPresetId, ltDeleteConfirmId, setLtDeleteConfirmId,
    ltUserPresetName, setLtUserPresetName, ltUserPresetDescription, setLtUserPresetDescription,
    viewportHinted, setViewportHinted, canUndo, setCanUndo,
    canRedo, setCanRedo, shotNameDraft, setShotNameDraft,
    shotBatchExcludedIds, setShotBatchExcludedIds, shotBatchPasses, setShotBatchPasses,
    shotBatchIncludeLayeredPsd, setShotBatchIncludeLayeredPsd, shotBatchIncludeContactSheet, setShotBatchIncludeContactSheet,
    shotBatchExportHeight, setShotBatchExportHeight, shotBatchProgress, setShotBatchProgress,
    shotBatchRecoverySummary, setShotBatchRecoverySummary, isBatchRenderingShots, compositeCategory,
    setCompositeCategory, sceneTemplateCategory, setSceneTemplateCategory, roomBuilderSpec,
    setRoomBuilderSpec, sunRigConfig, setSunRigConfig, sectionPlane,
    setSectionPlane, scaleGuideVisible, setScaleGuideVisible, measurementActive,
    setMeasurementActive, measurementStatus, setMeasurementStatus, measurementActiveRef,
    snapSettings, setSnapSettings, surfaceSnapArmed, setSurfaceSnapArmed,
    surfaceSnapAlignNormal, setSurfaceSnapAlignNormal, surfaceSnapStatus, setSurfaceSnapStatus,
    layerQuery, setLayerQuery, customModels, setCustomModels,
    modelLibrary, setModelLibrary, placementSession, setPlacementSession,
    placementSessionRef, placementTokenSequenceRef, modelRenderer, setModelRenderer,
    modelRendererRef, isUploadingModel, setIsUploadingModel, modelImportProgress,
    setModelImportProgress, modelImportAbortRef, modelThumbnailCaptureAbortRef, modelThumbnailCaptureEpochRef,
    modelThumbnailGpuLeaseRef, modelAnimationTimeReadersRef, modelRigBakeReadersRef, ikEndJointSelection,
    setIkEndJointSelection, morphTargetSelection, setMorphTargetSelection, deletingModelId,
    setDeletingModelId, isRestoringScene, setIsRestoringScene, sceneRestoreAbortRef,
    templateLibrary, setTemplateLibrary, templateLibraryStatus, setTemplateLibraryStatus,
    isSavingTemplate, setIsSavingTemplate, applyingTemplateId, setApplyingTemplateId,
    failedCloneIds, setFailedCloneIds, readyCloneIds, setReadyCloneIds,
    unbatchableModelIds, setUnbatchableModelIds, sceneBaseDocument, setSceneBaseDocument,
    savedShots, shotBatchSelectedIds, selectedShotBatchPasses, deviceSignals,
    setDeviceSignals, skyPresetId, insertBackgroundIntent, transparentInsert,
    captureRef, modalDialogRef, modalRootRef, viewportApiRef,
    pendingInitialCameraRef, cameraLensGestureBeforeViewRef, cameraLensGestureLatestViewRef, cameraLensGestureTimerRef,
    viewportHostRef, viewportBoxSize, setViewportBoxSize, primitiveObjectsRef,
    surfaceSnapArmedRef, dragInitialSelectedTransformsRef, dragInitialFirstTransformRef, panelScrollRef,
    modelRootCacheRef, modelLoadPendingRef, attachmentByStorageModelIdRef, storageModelIdByAttachmentIdRef,
    componentActiveRef, modalAssetSessionRef, captureInFlightRef, invalidateModelThumbnailCaptures,
    ltInsertAbortRef, aiMethodReferenceAbortRef, ltInsertSceneEpochRef, ltMagicSelectionEpochRef,
    ltMagicCaptureGenerationRef, ltInsertRestoreLineArtPreviewRef, destructiveMutationGuardRef, shotBatchAbortRef,
    shotBatchRecoveryRef, shotBatchRecoveryScopeRef, shotBatchRecoveryStoreRef, shotBatchAuthorizationEpochRef,
    physicsPhaseRef, physicsAbortRef, physicsAnimationFrameRef, physicsGenerationRef,
    physicsPlaybackStartedAtRef, physicsPlaybackOffsetRef, physicsLastUiUpdateRef, physicsLastFrameTimestampRef,
    latestPhysicsSamplesRef, physicsSessionRef, physicsWorkerSessionRef, physicsRuntimeSourceRef,
    physicsStartButtonRef, physicsTransportActionRef, shouldTransferPhysicsFocusRef, isModalAssetSessionCurrent,
    getModelThumbnailCaptureController, acquireModelThumbnailGpuLease, startModelThumbnailCaptureBatch, invalidateModalAssetSession,
    cancelSurfaceSnap, handleViewportReady, resetWebXrPresentationUi, finishWebXrControllerCleanup,
    disposeCurrentWebXrControllerGeneration, disposeWebXrControllerForOpenChange, handleWebXrControllerReady, handleWebXrSessionStateChange,
    historyRef, historyIndexRef, deviceQuality, hasCloneFailure,
    hasPendingClone, hasPendingSharedCharacter, hasUnavailableSharedCharacter, physicsInteractionLocked,
    insertBlocked, magicLayerSelectedPrimitive, magicLayerLensShift, magicLayerUnavailableReason,
    shotBatchBlockedReason, transitionPhysicsPhase, proceduralStarterDisabledReason, objectInsertSeedKeyRef,
    applyMultiSelectDelta, updateTransform, updateCustomModelTransform, updateCustomModelMaterial,
    updateCustomModelAnimation, updateCustomModelPose, updateCustomModelMorph, updateCustomModelConstraints,
    reparentSceneEntity, registerModelAnimationTime, registerModelRigBake, bakeCustomModelRigConstraints,
    finishModelAnimation, updateColor, applySurfacePreset, togglePrimitiveFlag,
    toggleCustomModelFlag, renameBgObject, groundSelectedEntity, placeSelectedModelRecipe,
    centerAndGroundSelectedEntity, commitCameraViewCommand, zoomCameraBy, applyCameraPreset,
    focusSelectedEntity, registerPrimitiveRef, ensureModelRootCached, publishPlacementSession,
    cancelCustomModelPlacement, moveCustomModelPlacement, rotateCustomModelPlacement, commitCustomModelPlacement,
    addCustomModelToScene, applyUserTemplate, handlePanelTabChange, reportLtUserPresetMutationFailure,
    persistLtUserPresetMutation, currentLtUserPresetDraft, saveCurrentLtAsUserPreset, updateManagedLtUserPreset,
    renameManagedLtUserPreset, deleteManagedLtUserPreset, applyLtPreset, updateLtLineSettings,
    updateLtToneSettings, updateLtExportHeight, updateLtExportAspectRatio, updateBackgroundSettings,
    updateLightingSettings, updateRenderExposure, applyMoodRig, applySunRigConfig,
    cameraLensInteractionLocked, commitCameraLensView, finishCameraLensGesture, previewCameraLens,
    updateCameraLens, applyTwoPointPerspective, resetTwoPointPerspective, readCurrentCanonicalSceneForShot,
    commitAppliedShot, captureCurrentShot, applySavedShot, duplicateActiveShot,
    moveSavedShot, removeSavedShot, exportSavedShotsAsZip, updateBackgroundTransparency,
    onCaptureUpdate, requestModalDismiss, requestUserClose, handleSaveToLibrary,
    handleUseAsAiMethodReference, handleInsert, firstSelectedId, selectedPrimitive,
    selectedCustomModel, selectedEntity, selectedModelCacheEntry, selectedSemanticMaterials,
    selectedSemanticAssignments, selectedCharacterPassPlan, selectedBackgroundPassPlan, selectedModelAnimations,
    selectedModelJoints, selectedGenericModelManifest, selectedGenericModelProxies, effectiveGenericModelProxyId,
    changeSelectedGenericModelClassification, changeGenericModelControlMode, selectGenericModelProxy, selectedJointByKey,
    selectedPoseRigSelection, selectedPoseJointKey, selectedPoseCanonicalKey, selectedPoseJoint,
    selectedHasEffectiveRigConstraint, selectedRigBakeDisabledReason, selectedAimConstraint, selectedIkProtectedJointKeys,
    selectedAimSuppressedByIk, selectedIkEndCandidates, savedIkEndJointKey, requestedIkEndJointKey,
    selectedIkEndJointKey, selectedIkRigSelection, selectedIkEndJoint, selectedIkMiddleJoint,
    selectedIkUpperJoint, selectedTwoBoneIkConstraint, selectedIkChainKeys, selectedIkHasOverlap,
    selectedIkLimitReached, selectedIkWorldMatrix, selectedIkSourceRoot, selectedIkTransformSupported,
    selectedPoseEulerDegrees, selectedModelMorphTargets, selectedMorphTargetCandidateKey, selectedMorphTargetKey,
    selectedMorphOverride, selectedAnimationClip, selectedAnimationDuration, commitSelectedPoseOverride,
    commitSelectedAimConstraint, commitSelectedTwoBoneIkConstraint, selectedIsLocked, selectedEntities,
    canGroundSelection, selectedPlaceableModels, snapSettingsSummary, sceneHierarchy,
    effectivelyVisibleLayerIds, surfaceSnapDisabledReason, measurementDisabledReason, focusSelectionDisabledReason,
    cancelMeasurement, measurementInferenceReferences, resolveMeasurementCandidate, updateMeasurementPreview,
    pickMeasurementPoint, handleMeasurementSurfacePreview, handleMeasurementLengthLockChange, toggleMeasurement,
    toggleSurfaceSnap, handleSurfaceSnapPick, physicsSelectionUnavailableReason, filteredLayerItems,
    ltLineSettings, ltToneSettings, hasFilledOutput, appliedLtPreset,
    appliedLtPresetId, appliedMoodRig, managedLtUserPreset, ltExportAspectRatio,
    ltCaptureSafeFrame, ltCaptureSizePreview, ltDocumentAspectPreset, ltCaptureAspectPresets,
    ltCaptureAspectPresetId, ltCaptureAspectLabel, hideOnTab, cancelPhysicsAnimationFrame,
    updatePhysicsProgress, restorePhysicsInitialPose, resetPhysicsPreview, failPhysicsPreview,
    physicsPlaybackFrame, startPhysicsPlayback, pausePhysicsPreview, resumePhysicsPreview,
    startPhysicsPreview, handleStartPhysicsPreview, bakePhysicsPreview, runBabylonDiagnostic,
    pausePhysicsWhenHidden, immersiveSceneActive, immersiveTransitionActive, effectiveIsQuadView,
    mainViewTrackRef, bg3dFrameLoop, isMainOrtho, currentFocalLengthMm,
    sunLightState, selectedSky, panoramaRotation, renderedSkyPresetId,
    fogNear, fogFar, fogSliderMax, selectSceneEntity,
    updateModelCloneStatuses, primitiveById, customModelById, batchCandidatesByModelId,
    batchedNodeIds, renderSceneEntity, sharedCharacterSceneContent, shadowSceneBounds,
    shadowMapSize, keyShadowFit, fillShadowFit, webXrDisabledReason,
    startStudioBg3dWebXr, endStudioBg3dWebXr, sceneContent, mainCameraNearClip,
    mainCameraUp, applyLensShift, mainCameraNode, immersiveCameraNode,
    mainScenePresentationNode, commonOrbitControls, commitSharedCharacterTransform, effectiveSelectedSharedCharacter,
    effectiveSelectedSharedCharacterElementId, includeSharedCharactersInCapture, mayApplyEmptySharedStageMutation, selectSharedStageMutation,
    setSelectedSharedCharacterElementId, setSharedStageMaterializationKind, setSharedStageMutationKind, sharedCharacterCaptureElementIds,
    sharedCharacterCaptureReadiness, sharedCharacterGroundings, sharedCharacterPreviewOmissionCount, sharedCharacterReadyCount,
    sharedCharacterRelationshipLabel, sharedCharacterStatuses, sharedCharacterUnavailableCount, sharedCharacters,
    sharedStageMaterializationKind, sharedStageMutationKind, shouldStartOnSharedStageLayerTab, targetHasLinkedCharacters,
    targetHasSavedSharedScene, updateSharedCharacterGrounding, updateSharedCharacterStatus, handleUploadModelFiles,
    handleDeleteModelFromLibrary, placementActive, twoPointPerspectiveActive, renderedPanoramaRotation,
    renderedBackgroundSettings, sharedCharacterGroundSurfaceRevision, staticModelBatches, mainCameraFarClip,
    mainCameraMaxOrbitDistance, quadViewHint, snapToggleHint, lineArtPreviewHint,
    surfaceSnapHint,
  } = { ...R, ...h };

  const generateId = () => "template-" + Math.random().toString(36).substring(2, 15);

  h.generateId = generateId;
  const handleSaveSceneAsTemplate = async () => {
    if (
      primitives.length === 0 && customModels.length === 0 ||
      applyingTemplateId !== null ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) return;
    const session = modalAssetSessionRef.current;
    if (!session || !isModalAssetSessionCurrent(session)) return;
    const currentView = viewportApiRef.current?.readView() ?? sceneBaseDocument.camera;
    const adaptation = tryAdaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels,
      attachmentByStorageModelId: attachmentByStorageModelIdRef.current,
      baseDocument: { ...sceneBaseDocument, camera: currentView },
    });
    if (!adaptation.ok) {
      setError("현재 장면이 안전 예산을 초과해 템플릿 저장을 시작하지 않았습니다. 장면을 나누거나 일부 오브젝트를 정리해 주세요.");
      return;
    }
    const adapted = adaptation.value;
    if (
      adapted.diagnostics.length > 0 ||
      adapted.omittedDiagnosticCount > 0 ||
      adapted.counts.droppedPrimitives > 0 ||
      adapted.counts.droppedCustomModels > 0 ||
      adapted.counts.emittedPrimitives !== primitives.length ||
      adapted.counts.emittedCustomModels !== customModels.length
    ) {
      setError("현재 장면을 손실 없는 템플릿 원본으로 만들 수 없습니다. 문제가 있는 도형이나 모델을 확인해 주세요.");
      return;
    }
    setIsSavingTemplate(true);
    try {
      const templateName = `내 소재 ${new Date().toLocaleDateString()}`;
      const entries = await saveBg3dTemplate({
        id: generateId(),
        name: templateName,
        createdAt: Date.now(),
        document: adapted.document,
      });
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setTemplateLibrary(entries);
        setTemplateLibraryStatus("ready");
        setError(null);
      });
    } catch (err) {
      console.error(err);
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setError("현재 장면 템플릿을 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.");
      });
    } finally {
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setIsSavingTemplate(false);
      });
    }
  };
  h.handleSaveSceneAsTemplate = handleSaveSceneAsTemplate;
  const handleDeleteTemplate = async (id: string) => {
    const session = modalAssetSessionRef.current;
    if (!session || !isModalAssetSessionCurrent(session)) return;
    try {
      const entries = await deleteBg3dTemplate(id);
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setTemplateLibrary(entries);
        setTemplateLibraryStatus("ready");
      });
    } catch (err) {
      console.error(err);
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setError("템플릿을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      });
    }
  };
  h.handleDeleteTemplate = handleDeleteTemplate;
  function commitImmediateHistoryTransition(
    nextPrimitives: readonly BgPrimitive[],
    nextCustomModels: readonly BgCustomModelInstance[],
    nextDocument: StudioBg3dSceneDocument,
    beforeOverride?: StudioBg3dHistorySnapshot,
    options: { readonly preserveBeforeCamera?: boolean } = {},
  ): void {
    const liveView = viewportApiRef.current?.readView() ?? sceneBaseDocument.camera;
    const rawBefore = beforeOverride ?? createStudioBg3dHistorySnapshot({
      primitives,
      customModels,
      document: sceneBaseDocument,
    });
    const before: StudioBg3dHistorySnapshot = {
      ...rawBefore,
      document: options.preserveBeforeCamera
        ? rawBefore.document
        : studioBg3dHistoryDocumentAtView(rawBefore.document, liveView),
    };
    const commandChangesCamera = options.preserveBeforeCamera || JSON.stringify(nextDocument.camera) !==
      JSON.stringify(sceneBaseDocument.camera);
    const after = createStudioBg3dHistorySnapshot({
      primitives: nextPrimitives,
      customModels: nextCustomModels,
      document: commandChangesCamera
        ? nextDocument
        : studioBg3dHistoryDocumentAtView(nextDocument, liveView),
    });
    const base = historyRef.current.slice(0, historyIndexRef.current + 1);
    const appendIfChanged = (snapshot: StudioBg3dHistorySnapshot) => {
      const last = base[base.length - 1];
      if (!last || JSON.stringify(last) !== JSON.stringify(snapshot)) base.push(snapshot);
    };
    // Preserve edits made inside the 400ms debounce window, then append the command result. Undo is
    // immediately available and returns to the exact pre-command constraint/physics state.
    appendIfChanged(before);
    appendIfChanged(after);
    while (base.length > 60) base.shift();
    historyRef.current = base;
    historyIndexRef.current = base.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }
  h.commitImmediateHistoryTransition = commitImmediateHistoryTransition;
  const doUndo = () => {
    if (isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)) return;
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snap = historyRef.current[historyIndexRef.current];
    const nextPrimitives = clonePrimitives(snap.primitives);
    const nextCustomModels = cloneBgCustomModelInstances(snap.customModels);
    physicsRuntimeSourceRef.current = {
      primitives: nextPrimitives,
      customModels: nextCustomModels,
      document: snap.document,
    };
    setPrimitives(nextPrimitives);
    setCustomModels(nextCustomModels);
    setSceneBaseDocument(snap.document);
    applyOrDeferStudioBg3dHistoryCamera(
      viewportApiRef.current,
      pendingInitialCameraRef,
      snap.document.camera,
    );
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };
  h.doUndo = doUndo;
  const doRedo = () => {
    if (isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)) return;
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snap = historyRef.current[historyIndexRef.current];
    const nextPrimitives = clonePrimitives(snap.primitives);
    const nextCustomModels = cloneBgCustomModelInstances(snap.customModels);
    physicsRuntimeSourceRef.current = {
      primitives: nextPrimitives,
      customModels: nextCustomModels,
      document: snap.document,
    };
    setPrimitives(nextPrimitives);
    setCustomModels(nextCustomModels);
    setSceneBaseDocument(snap.document);
    applyOrDeferStudioBg3dHistoryCamera(
      viewportApiRef.current,
      pendingInitialCameraRef,
      snap.document.camera,
    );
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };
  h.doRedo = doRedo;
  const canAdmitSceneNodes = (additionalNodeCount: number): boolean => {
    const live = physicsRuntimeSourceRef.current;
    const nodeLimit = Math.min(
      STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
      live.document.budgets.complexity.maxNodes,
    );
    if (
      !Number.isSafeInteger(additionalNodeCount) ||
      additionalNodeCount < 0 ||
      live.primitives.length + live.customModels.length > nodeLimit - additionalNodeCount
    ) {
      setError(`이 장면에는 오브젝트를 최대 ${nodeLimit.toLocaleString()}개까지 둘 수 있습니다. 장면을 나누거나 기존 오브젝트를 정리해 주세요.`);
      return false;
    }
    return true;
  };
  h.canAdmitSceneNodes = canAdmitSceneNodes;
  const addPrimitive = (kind: BgPrimitiveKind) => {
    if (!canAdmitSceneNodes(1)) return;
    const live = physicsRuntimeSourceRef.current;
    const next = createPrimitive(kind, live.primitives.length);
    const nextPrimitives = [...live.primitives, next];
    physicsRuntimeSourceRef.current = { ...live, primitives: nextPrimitives };
    setPrimitives(nextPrimitives);
    setSelectedIds(new Set([next.id]));
  };
  h.addPrimitive = addPrimitive;
  const addComposite = (presetId: string) => {
    const preset = COMPOSITE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const live = physicsRuntimeSourceRef.current;
    const parts = instantiateCompositePreset(preset, live.primitives.length);
    if (parts.length === 0 || !canAdmitSceneNodes(parts.length)) return;
    const nextPrimitives = [...live.primitives, ...parts];
    physicsRuntimeSourceRef.current = { ...live, primitives: nextPrimitives };
    setPrimitives(nextPrimitives);
    setSelectedIds(new Set([parts[0].id]));
  };
  h.addComposite = addComposite;
  const addProceduralStarterAsset = (
    assetId: string,
  ): StudioBg3dProceduralInsertionPlan => {
    if (proceduralStarterDisabledReason) {
      return { ok: false, reason: "invalid-budget" };
    }
    const live = physicsRuntimeSourceRef.current;
    const currentUsage = calculateStudioBg3dProceduralSceneUsage(
      live.primitives,
      live.customModels,
      (modelId) => modelRootCacheRef.current.get(modelId)?.metrics ?? null,
    );
    if (!currentUsage) return { ok: false, reason: "invalid-budget" };

    const asset = getStudioBg3dProceduralStarterAsset(assetId);
    const policy = deriveStudioBg3dGlbValidationPolicy(live.document, deviceQuality);
    const limits = policy.budgets[policy.profile].complexity;
    const placementOrdinal = live.primitives.length + live.customModels.length;
    const column = placementOrdinal % 3;
    const row = Math.floor(placementOrdinal / 3) % 3;
    const plan = planStudioBg3dProceduralStarterInsertion({
      assetId,
      occupiedNodeIds: [
        ...live.primitives.map((primitive) => primitive.id),
        ...live.customModels.map((model) => model.id),
      ],
      currentUsage,
      limits,
      origin: asset
        ? [
            column * (asset.bounds.width + 0.75),
            0,
            -row * (asset.bounds.depth + 0.75),
          ]
        : [0, 0, 0],
    });
    if (!plan.ok) return plan;

    const nextPrimitives = [...live.primitives, ...plan.primitives];
    physicsRuntimeSourceRef.current = { ...live, primitives: nextPrimitives };
    setPrimitives(nextPrimitives);
    setSelectedIds(new Set([plan.primitives[0].id]));
    return plan;
  };
  h.addProceduralStarterAsset = addProceduralStarterAsset;
  const addSceneTemplate = (templateId: string) => {
    const template = BG_SCENE_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const live = physicsRuntimeSourceRef.current;
    const rawParts = instantiateSceneTemplate(template, live.primitives.length);
    if (rawParts.length === 0 || !canAdmitSceneNodes(rawParts.length)) return;
    const allocation = allocateStudioBg3dTemplateInstanceNodeIds({
      sourceKind: "catalog",
      sourceId: template.id,
      insertionOffset: live.primitives.length,
      nodeCount: rawParts.length,
      occupiedNodeIds: new Set([
        ...live.primitives.map((primitive) => primitive.id),
        ...live.customModels.map((model) => model.id),
      ]),
      createSeed: () => generateId(),
    });
    if (!allocation) {
      setError("템플릿을 한 묶음으로 추적할 안전한 식별자를 만들지 못해 장면을 변경하지 않았습니다.");
      return;
    }
    const parts = rawParts.map((part, index) => ({
      ...part,
      id: allocation.nodeIds[index],
    }));
    const nextPrimitives = [...live.primitives, ...parts];
    physicsRuntimeSourceRef.current = { ...live, primitives: nextPrimitives };
    setPrimitives(nextPrimitives);
    setSelectedIds(new Set(allocation.nodeIds));
    setError(null);
  };
  h.addSceneTemplate = addSceneTemplate;
  const addRoomBuild = () => {
    const live = physicsRuntimeSourceRef.current;
    const parts = instantiateStudioBg3dRoomBuild(roomBuilderSpec, live.primitives.length);
    if (parts.length === 0 || !canAdmitSceneNodes(parts.length)) return;
    const nextPrimitives = [...live.primitives, ...parts];
    physicsRuntimeSourceRef.current = { ...live, primitives: nextPrimitives };
    setPrimitives(nextPrimitives);
    setSelectedIds(new Set([parts[0].id]));
  };
  h.addRoomBuild = addRoomBuild;
  const applyRoomBuilderPreset = (presetId: string) => {
    const preset = getStudioBg3dRoomPreset(presetId);
    if (preset) setRoomBuilderSpec(preset.spec);
  };
  h.applyRoomBuilderPreset = applyRoomBuilderPreset;
  const handleRoomBuilderSpecChange = (next: StudioBg3dRoomSpec) => {
    setRoomBuilderSpec(clampStudioBg3dRoomSpec(next));
  };
  h.handleRoomBuilderSpecChange = handleRoomBuilderSpecChange;
  const commitSceneEntityRemoval = (
    plan: StudioBg3dSceneRemovalSuccess,
    options: { readonly resetHistory?: boolean } = {},
  ): void => {
    const next = plan.snapshot;
    // This ref is the scene-mutation authority between an event and React's next render. Advance it
    // first so a queued add/template can never observe and resurrect the just-removed instances.
    physicsRuntimeSourceRef.current = {
      primitives: next.primitives,
      customModels: next.customModels,
      document: next.document,
    };
    setPrimitives(next.primitives);
    setCustomModels(next.customModels);
    setSceneBaseDocument(next.document);
    if (options.resetHistory) {
      // Deleting the backing IndexedDB bytes is intentionally irreversible. Retaining older
      // snapshots would let Undo resurrect an instance whose attachment and cache no longer exist.
      historyRef.current = [createStudioBg3dHistorySnapshot(next)];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    }
  };
  h.commitSceneEntityRemoval = commitSceneEntityRemoval;
  const removeSceneEntities = (ids: ReadonlySet<string>): boolean => {
    if (ids.size === 0) return false;
    const plan = planStudioBg3dSceneEntityRemoval({
      snapshot: physicsRuntimeSourceRef.current,
      entityIds: ids,
    });
    if (!plan.ok) {
      setError("부모를 삭제해도 자식의 월드 변환을 보존할 수 없어 삭제를 취소했습니다.");
      return false;
    }
    commitSceneEntityRemoval(plan);
    setError(null);
    return true;
  };
  h.removeSceneEntities = removeSceneEntities;
  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (!removeSceneEntities(selectedIds)) return;
    setSelectedIds(new Set());
    setIsTransforming(false);
  };
  h.deleteSelected = deleteSelected;
  const deleteSelectedCustomModel = () => {
    deleteSelected();
  };
  h.deleteSelectedCustomModel = deleteSelectedCustomModel;
  function deleteSelectedEntity() {
    deleteSelected();
  }
  h.deleteSelectedEntity = deleteSelectedEntity;
  const resolveTemplateInstanceSource = (instance) => instance.sourceKind === "catalog"
    ? resolveStudioBg3dTemplateSourceByKey(instance.sourceKey, BG_SCENE_TEMPLATES)
    : resolveStudioBg3dTemplateSourceByKey(instance.sourceKey, templateLibrary);
  const templateSourceNodeCount = (instance, source) => instance.sourceKind === "catalog"
    ? source.placements.reduce((count, placement) => count + (placement.type === "primitive"
      ? 1
      : COMPOSITE_PRESETS.find((preset) => preset.id === placement.presetId)?.parts.length ?? 0), 0)
    : source.document.nodes.length;
  const templateInstanceMatchesCompleteSource = (instance, source) =>
    templateSourceNodeCount(instance, source) === instance.nodes.length &&
    instance.nodes.every((node, ordinal) => node.ordinal === ordinal);
  const duplicateSelected = () => {
    if (selectedIds.size === 0) return;
    const live = physicsRuntimeSourceRef.current;
    const occupiedNodeIds = new Set([
      ...live.primitives.map((primitive) => primitive.id),
      ...live.customModels.map((model) => model.id),
    ]);
    const taggedCloneIdBySourceId = new Map();
    for (const instance of collectStudioBg3dTemplateInstances(
      live.primitives,
      live.customModels,
    )) {
      const source = resolveTemplateInstanceSource(instance);
      if (
        !source ||
        !templateInstanceMatchesCompleteSource(instance, source) ||
        !instance.nodes.every((node) => selectedIds.has(node.id))
      ) continue;
      const allocation = allocateStudioBg3dTemplateInstanceNodeIds({
        sourceKind: instance.sourceKind,
        sourceId: source.id,
        insertionOffset: instance.insertionOffset,
        baselineOffset: [
          instance.baselineOffset[0] + 0.4,
          instance.baselineOffset[1],
          instance.baselineOffset[2] + 0.4,
        ],
        nodeCount: instance.nodes.length,
        occupiedNodeIds,
        createSeed: () => generateId(),
      });
      if (!allocation) {
        setError("템플릿 복제 묶음의 안전한 식별자를 만들지 못해 장면을 변경하지 않았습니다.");
        return;
      }
      instance.nodes.forEach((node, ordinal) => {
        const cloneId = allocation.nodeIds[ordinal];
        if (cloneId) {
          taggedCloneIdBySourceId.set(node.id, cloneId);
          occupiedNodeIds.add(cloneId);
        }
      });
    }

    const primitivePairs = [];
    const modelPairs = [];

    for (const id of selectedIds) {
      const p = live.primitives.find(x => x.id === id);
      if (p) {
        const clone = duplicatePrimitive(p);
        primitivePairs.push({ source: p, clone: {
          ...clone,
          id: taggedCloneIdBySourceId.get(p.id) ?? clone.id,
        } });
      } else {
        const m = live.customModels.find(x => x.id === id);
        if (m) {
          const clone = duplicateBgCustomModelInstance(m);
          modelPairs.push({ source: m, clone: {
            ...clone,
            id: taggedCloneIdBySourceId.get(m.id) ?? clone.id,
          } });
        }
      }
    }

    if (!canAdmitSceneNodes(primitivePairs.length + modelPairs.length)) return;
    const cloneIdBySourceId = new Map([
      ...primitivePairs.map(({ source, clone }) => [source.id, clone.id]),
      ...modelPairs.map(({ source, clone }) => [source.id, clone.id]),
    ]);
    const preserveSelectedHierarchy = ({ source, clone }) => ({
      ...clone,
      ...resolveStudioBg3dDuplicateHierarchyPatch({ source, clone, cloneIdBySourceId }),
    });
    const newPrimitives: BgPrimitive[] = primitivePairs.map(preserveSelectedHierarchy);
    const newModels: BgCustomModelInstance[] = modelPairs.map(preserveSelectedHierarchy);
    const nextPrimitives = [...live.primitives, ...newPrimitives];
    const nextCustomModels = [...live.customModels, ...newModels];
    physicsRuntimeSourceRef.current = {
      ...live,
      primitives: nextPrimitives,
      customModels: nextCustomModels,
    };
    if (newPrimitives.length > 0) setPrimitives(nextPrimitives);
    if (newModels.length > 0) setCustomModels(nextCustomModels);
    const clonedEntities = [...newPrimitives, ...newModels];
    setSelectedIds(new Set(orderStudioBg3dHierarchySelectionRootsFirst(clonedEntities)));
    setError(null);
  };
  h.duplicateSelected = duplicateSelected;
  const duplicateSelectedCustomModel = () => {
    duplicateSelected();
  };
  h.duplicateSelectedCustomModel = duplicateSelectedCustomModel;

  const templateInstances = collectStudioBg3dTemplateInstances(primitives, customModels);
  const templateInstanceById = new Map(
    templateInstances.map((instance) => [instance.id, instance]),
  );
  const templateOrganizationBlockedReason = isCapturing || isBatchRenderingShots
    ? "3D 장면을 캡처하는 중에는 템플릿을 정리할 수 없습니다."
    : isRestoringScene || isUploadingModel || applyingTemplateId !== null || isSavingTemplate
      ? "장면 또는 템플릿 작업이 끝난 뒤 정리해 주세요."
      : physicsInteractionLocked || isTransforming || placementActive
        ? "배치·물리·변형 작업을 마친 뒤 템플릿을 정리해 주세요."
        : null;

  const templateInstanceSummaries = templateInstances.map((instance, index) => {
    const source = resolveTemplateInstanceSource(instance);
    const lockedNodeCount = instance.nodes.filter((node) => node.locked).length;
    const completeNodeSet = source !== null &&
      templateInstanceMatchesCompleteSource(instance, source);
    return {
      id: instance.id,
      label: source?.label ?? source?.name ?? `템플릿 배치 ${index + 1}`,
      sourceKind: instance.sourceKind,
      nodeCount: instance.nodes.length,
      lockedNodeCount,
      selected: instance.nodes.length > 0 &&
        instance.nodes.every((node) => selectedIds.has(node.id)),
      resetAvailable: completeNodeSet &&
        !instance.hasDuplicateOrdinals && lockedNodeCount === 0,
      sourceAvailable: source !== null,
    };
  });

  const selectTemplateInstances = (instances) => {
    if (instances.length === 0) return;
    setSelectedIds(new Set(instances.flatMap((instance) =>
      orderStudioBg3dHierarchySelectionRootsFirst(instance.nodes)
    )));
    setError(null);
  };
  const selectTemplateInstance = (instanceId: string) => {
    const instance = templateInstanceById.get(instanceId);
    if (instance) selectTemplateInstances([instance]);
  };
  const selectAllTemplateInstances = () => selectTemplateInstances(templateInstances);

  const runTemplateOrganizerCommand = (command, instanceId?: string) => {
    if (h.templateOrganizerActionPending) return;
    const targetInstanceIds = command.endsWith("-all")
      ? templateInstances.map((instance) => instance.id)
      : instanceId && templateInstanceById.has(instanceId)
        ? [instanceId]
        : [];
    if (targetInstanceIds.length === 0) return;
    const session = modalAssetSessionRef.current;
    if (!session || !isModalAssetSessionCurrent(session)) return;
    const request = Object.freeze({
      command,
      targetInstanceIds: Object.freeze([...targetInstanceIds]),
      membershipInstanceIds: Object.freeze(
        templateInstances.map((instance) => instance.id).sort(),
      ),
      session,
      sceneEpoch: ltInsertSceneEpochRef.current,
    });
    const requestStillOwnsCurrentScene = () =>
      modalAssetSessionRef.current === session &&
      isModalAssetSessionCurrent(session) &&
      ltInsertSceneEpochRef.current === request.sceneEpoch;
    h.templateOrganizerActionPending = true;
    void import("./studio-bg3d-template-organizer-runtime")
      .then(({ runStudioBg3dTemplateOrganizerCommand }) => {
        runStudioBg3dTemplateOrganizerCommand(h, request);
      })
      .catch(() => {
        if (requestStillOwnsCurrentScene()) {
          setError("템플릿 정리 도구를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
      })
      .finally(() => {
        h.templateOrganizerActionPending = false;
      });
  };
  const groundTemplateInstance = (instanceId: string) =>
    runTemplateOrganizerCommand("arrange-one", instanceId);
  const arrangeAllTemplateInstances = () => runTemplateOrganizerCommand("arrange-all");
  const resetTemplateInstance = (instanceId: string) =>
    runTemplateOrganizerCommand("reset-one", instanceId);
  const resetAllTemplateInstances = () => runTemplateOrganizerCommand("reset-all");
  const deleteTemplateInstance = (instanceId: string) =>
    runTemplateOrganizerCommand("delete-one", instanceId);
  const deleteAllTemplateInstances = () => runTemplateOrganizerCommand("delete-all");

  h.templateInstances = templateInstances;
  h.selectTemplateInstances = selectTemplateInstances;
  h.resolveTemplateInstanceSource = resolveTemplateInstanceSource;
  h.instantiateSceneTemplate = instantiateSceneTemplate;
  h.readStudioBg3dTemplateNodeWorldBounds = (nodeId: string) => {
    const renderedBounds = readStudioBg3dObjectWorldBounds(
      primitiveObjectsRef.current.get(nodeId),
    );
    if (renderedBounds) return renderedBounds;
    // Static GPU batches intentionally omit one Object3D per model. The verified cache root plus
    // the document transform still gives the organizer a deterministic world AABB, so grounding
    // and arrange-all do not depend on selection temporarily disabling batching.
    const model = physicsRuntimeSourceRef.current.customModels.find(
      (candidate) => candidate.id === nodeId,
    );
    if (!model) return null;
    return readStudioBg3dTemplateStaticModelWorldBounds(
      modelRootCacheRef.current.get(model.modelId)?.root,
      model,
    );
  };
  h.createStudioBg3dHistorySnapshot = createStudioBg3dHistorySnapshot;
  h.planStudioBg3dSceneEntityRemoval = planStudioBg3dSceneEntityRemoval;
  h.templateInstanceSummaries = templateInstanceSummaries;
  h.templateOrganizationBlockedReason = templateOrganizationBlockedReason;
  h.selectTemplateInstance = selectTemplateInstance;
  h.selectAllTemplateInstances = selectAllTemplateInstances;
  h.groundTemplateInstance = groundTemplateInstance;
  h.arrangeAllTemplateInstances = arrangeAllTemplateInstances;
  h.resetTemplateInstance = resetTemplateInstance;
  h.resetAllTemplateInstances = resetAllTemplateInstances;
  h.deleteTemplateInstance = deleteTemplateInstance;
  h.deleteAllTemplateInstances = deleteAllTemplateInstances;

  // Refs shared across hosts and effects. Created here because every consumer binds after
  // scene-ops, mirroring the original monolith order: actions first, refs second.
  const selectedIdsRef = useRef(selectedIds);
  const undoRef = useRef(doUndo);
  const redoRef = useRef(doRedo);
  const deleteSelectedRef = useRef(deleteSelectedEntity);
  const addPrimitiveRef = useRef(addPrimitive);
  const addSceneTemplateRef = useRef(addSceneTemplate);
  h.selectedIdsRef = selectedIdsRef;
  h.undoRef = undoRef;
  h.redoRef = redoRef;
  h.deleteSelectedRef = deleteSelectedRef;
  h.addPrimitiveRef = addPrimitiveRef;
  h.addSceneTemplateRef = addSceneTemplateRef;
}
