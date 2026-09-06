/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";
import { CaptureBridge } from "./StudioBg3dCaptureBridge";
import { StudioBg3dCompositionOverlay } from "./StudioBg3dCompositionOverlay";
import { StudioBg3dEngineRecoveryActions } from "./StudioBg3dEngineRecoveryActions";
import type { StudioBg3dCompositionGuideMode } from "./studio-bg3d-composition-guide";
import { StudioBg3dTurntableController } from "./StudioBg3dTurntableController";
import { StudioBg3dViewFrameClear } from "./StudioBg3dViewFrameClear";

export function StudioBg3dEditorViewport({ h }) {
  const {
    THREE, OrbitControls, OrthographicCamera, PerspectiveCamera, TransformControls, View,
    Canvas, useThree, Aperture, Boxes, Camera, ChevronDown, CircleDashed, Copy, Crosshair, Eye,
    EyeOff, Globe, Hexagon, Home, Layers, LayoutTemplate, Loader2, LocateFixed, Lock, Magnet,
    Maximize2, Move, MoveDown, PencilLine, Redo2, RotateCcw, RotateCw, Ruler, Save, ScanLine,
    Scissors, Trash2, SunMoon, Undo2, Unlock, Upload, WandSparkles, X, ZoomIn, ZoomOut,
    Suspense, useEffect, useEffectEvent, useCallback, useLayoutEffect, useRef, useState,
    Fragment, lazy, createPortal, flushSync, createStudioBg3dAiMethodReferenceCapture,
    COMPOSITE_CATEGORIES, COMPOSITE_CATEGORY_LABELS, COMPOSITE_PRESETS,
    instantiateCompositePreset, cloneBgCustomModelInstances, createBgCustomModelInstance,
    duplicateBgCustomModelInstance, isStudioBg3dThreeTwoBoneIkChainSupported,
    measureBg3dObjectSize, parseBg3dSceneWithModelsFromDataUrl, StudioBg3dThreeOperationError,
    clonePrimitives, createPrimitive, duplicatePrimitive, PRIMITIVE_DEFS, BG_SCENE_TEMPLATES,
    instantiateSceneTemplate, BG_SKY_PRESETS, getSkyPreset, normalizePanoramaRotationDegrees,
    createStudioGeneric3dRightsFromAttachment, createStudioGeneric3dVerifiedManifest,
    createStudioGeneric3dPoseProxies, mergeStudioGeneric3dWorkflowMaps,
    normalizeStudioGeneric3dClassification, normalizeStudioGeneric3dSourceFormat,
    parseStudioGeneric3dWorkflowMetadata, createTwoBoneDefaultPoleTarget,
    createStudioShared3dCharacterShadowEntity, StudioGeneric3dModelModePanel,
    StudioToolHintTarget, useStudioBg3dSharedCharacterStatus, useStudioModalSheet,
    snapshotStudioBg3dLiveAnimationPlayback, STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
    STUDIO_BG3D_BEAUTY_RGBA8_PROFILE, STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
    STUDIO_BG3D_NORMAL_PROFILE, STUDIO_BG3D_STABLE_ID_PROFILE,
    normalizeStudioBg3dArtifactCaptureResultV2, copyStudioBg3dBundledEnvironmentLibraryEntries,
    isStudioBg3dViewportControlTarget, readStudioBg3dObjectWorldBounds,
    readStudioBg3dWorldSurfaceHit, fitStudioBg3dCameraToBounds,
    applyOrDeferStudioBg3dHistoryCamera, resolveStudioBg3dCameraGestureCommitView,
    createStudioBg3dCameraUpForDutchRoll, readStudioBg3dCameraDutchRollDegrees,
    resolveStudioBg3dCameraDistanceLimits, resolveStudioBg3dCameraNearClip,
    resolveStudioBg3dCameraUpVector, createStudioBg3dCaptureBackgroundSnapshot,
    studioBg3dCaptureBackgroundRequestFromSnapshot, registerStudioBg3dCaptureExcludedObject,
    STUDIO_BG3D_CAPTURE_ASPECT_PRESETS, createStudioBg3dDocumentCaptureAspectPreset,
    matchStudioBg3dCaptureAspectPreset, normalizeStudioBg3dCaptureAspectRatio,
    resolveStudioBg3dCaptureFrame, resolveStudioBg3dCaptureFrameCameraSettings,
    applyStudioBg3dCaptureFrameViewOffset, BgAnimationPlayhead, LtRangeControl, LtToggleRow,
    PanoramaRotationNumberField, Vec3Field, StudioBg3dDestructiveMutationGuard,
    deriveStudioBg3dGlbValidationPolicy, resolveStudioBg3dDeviceQuality,
    acquireStudioBg3dCaptureAdapterAfterViewTransition, CAMERA_PRESETS, canonicalSceneDocument,
    captureStudioBg3dRaster, collectDeviceSignals, createStudioBg3dHistorySnapshot,
    createStudioBg3dShotId, degToRad, describeStudioBg3dPhysicsStatus, eulerDegreesToQuaternion,
    formatBg3dSunTime, generateLtUserPresetId, getStudioBg3dCaptureSourceSize,
    loadStudioBg3dThreeWebglCaptureRuntime, ltTonePreviewStyle, ltUserPresetFailureMessage,
    matchingLtPreset, quaternionToEulerDegrees, radToDeg, resolveDeviceQuality,
    SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE, studioBg3dHistoryDocumentAtView,
    studioBg3dMagicCaptureCompatibilityMessage, waitForStudioBg3dPaintFrame,
    createStudioBg3dModelImportActions, CONTROL_BUTTON, ICON_BUTTON, cx, canSetStudioBg3dParent,
    collectStudioBg3dEffectivelyVisibleEntityIds, resolveStudioBg3dHierarchy,
    planStudioBg3dImmersiveStage, studioBg3dImmersiveStageFailureMessage,
    resolveStudioBg3dInsertBackgroundFromDocument, resolveStudioBg3dInsertBackgroundMode,
    STUDIO_BG3D_LENS_MAX_FOCAL_MM, STUDIO_BG3D_LENS_MIN_FOCAL_MM, STUDIO_BG3D_LENS_PRESETS,
    computeStudioBg3dTwoPointPerspective, isStudioBg3dTwoPointPerspectiveActive,
    studioBg3dFocalLengthToFovDegrees, studioBg3dFovDegreesToFocalLength,
    resolveStudioBg3dLtCaptureSize, encodeStudioBg3dLtLayers,
    EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD, createStudioBg3dLtUserPreset,
    deleteStudioBg3dLtUserPreset, renameStudioBg3dLtUserPreset, upsertStudioBg3dLtUserPreset,
    getProductStudioBg3dLtPresetSqliteRepository, STUDIO_BG3D_LT_BUILT_IN_PRESETS,
    STUDIO_BG3D_LT_PRESET_MAX_COUNT, STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH,
    STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH, applyStudioBg3dLtPreset, renderStudioBg3dLtLayers,
    STUDIO_BG3D_LT_RENDER_MAX_PIXELS, renderStudioBg3dLtLayersInWorker,
    StudioBg3dLtRenderWorkerError, buildStudioBg3dMagicFilterMask,
    encodeStudioBg3dMagicMaskPngDataUrl, captureStudioBg3dMagicObjectIds,
    STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES, resolveStudioBg3dMagicSelection,
    STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES, classifyStudioBg3dMeasurementInference,
    createStudioBg3dMeasurementDocument, formatStudioBg3dMeasurementLength,
    lockStudioBg3dMeasurementLength, measureStudioBg3dWorldPoints,
    resolveStudioBg3dMeasurementGuide, readStudioBg3dMeasurementPointFromThreeEvent,
    StudioBg3dStaleModalOperationError, studioBg3dModalOperationCoordinator,
    createStudioBg3dModelAttachment, getStoredBg3dModel, getStoredBg3dModelByHash,
    listBg3dModelLibraryEntries, resolveBg3dModelHash, assertStudioBg3dModelAttachmentAdmission,
    calculateStudioBg3dPlacedModelBytes, StudioBg3dModelPlacementAdmissionError,
    totalStudioBg3dModelAttachmentBytes, admitAndCacheModel, attachmentMatchesRecord,
    bindModelAttachment, disposeModelCache, readGenericWorkflowMapsFromAttachments,
    withStudioGeneric3dWorkflowMetadata, encodeStudioBg3dModelThumbnailPng,
    applyStudioBg3dMoodRig, resolveStudioBg3dAppliedMoodRig, STUDIO_BG3D_MOOD_RIGS,
    applyStudioBg3dSnapToTransform, DEFAULT_STUDIO_BG3D_SNAP_SETTINGS,
    filterStudioBg3dLayerItems, groundModelTransform, groundPrimitiveTransform,
    isBgObjectLocked, isBgObjectTransformBlocked, isBgObjectVisible,
    normalizeStudioBg3dSnapSettings, STUDIO_BG3D_ROTATE_STEP_OPTIONS_DEG,
    STUDIO_BG3D_TRANSLATE_STEP_OPTIONS, studioBg3dSnapSettingsSummary,
    deriveStudioBg3dVanishingPoints, applyStudioBg3dPhysicsTransforms,
    createStudioBg3dPhysicsWorld, STUDIO_BG3D_PHYSICS_MAX_DYNAMIC_BODIES,
    createStudioBg3dPhysicsSessionSourceToken, isStudioBg3dPhysicsSessionSourceCurrent,
    createStudioBg3dPhysicsThreeJob, measureStudioBg3dPhysicsModelLocalBounds,
    projectStudioBg3dPhysicsSamples, STUDIO_BG3D_PHYSICS_PROJECTION_ROOT_USER_DATA_KEY,
    sampleStudioBg3dPhysicsTimeline, isStudioBg3dPhysicsTransientPhase,
    STUDIO_BG3D_PHYSICS_GRAVITY, planStudioBg3dModelPlacementRecipe,
    createStudioBg3dPlacementSession, transitionStudioBg3dPlacementSession,
    calculateStudioBg3dProceduralSceneUsage, getStudioBg3dProceduralStarterAsset,
    planStudioBg3dProceduralStarterInsertion, StudioBg3dPrimitiveGeometryPool,
    resolveStudioBg3dFrameLoop, resolveStudioBg3dReturnFocus,
    createStudioBg3dRigPoseBakeHistoryTransition, mutateStudioBg3dAimConstraint,
    mutateStudioBg3dPoseOverride, mutateStudioBg3dTwoBoneIkConstraint,
    resolveStudioBg3dRigSelection, clampStudioBg3dRoomSpec, getStudioBg3dRoomPreset,
    instantiateStudioBg3dRoomBuild, createStudioBg3dRuntimeSnapshot,
    DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK, DEFAULT_STUDIO_BG3D_CONSTRAINT_LAYER,
    DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE, DEFAULT_STUDIO_BG3D_POSE_LAYER,
    DEFAULT_STUDIO_BG3D_MORPH_LAYER, DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS, STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
    STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS, STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS,
    applyStudioBg3dShot, captureStudioBg3dShot, duplicateStudioBg3dShot, moveStudioBg3dShot,
    normalizeStudioBg3dSceneDocument, removeStudioBg3dShot, STUDIO_BG3D_FOG_MIN_GAP,
    STUDIO_BG3D_FOG_PRESETS, planStudioBg3dDeletedAttachmentReconciliation,
    planStudioBg3dSceneEntityRemoval, hydrateStudioBg3dDocumentToRuntime,
    tryAdaptStudioBg3dRuntimeToDocument, DEFAULT_STUDIO_BG3D_SECTION_PLANE_STATE,
    STUDIO_BG3D_SECTION_AXES, STUDIO_BG3D_SECTION_AXIS_LABELS, STUDIO_BG3D_SECTION_OFFSET_LIMIT,
    createStudioBg3dSemanticRenderPassPlan, collectStudioBg3dShadowSceneBounds,
    fitStudioBg3dDirectionalShadowFrustum, readStudioBg3dShadowGeometryLocalBounds,
    readStudioBg3dShadowModelLocalBounds, acquireStudioBg3dSharedCharacterCaptureAuthorityLease,
    verifyStudioBg3dSharedCharacterCaptureAuthorityLease,
    createStudioBg3dLinkedCharacterCapture,
    createStudioBg3dSharedCharacterGroundSurfaceRevision,
    resolveStudioBg3dSharedStageMutationBlockedReason, createStudioBg3dShotBatchExportRunner,
    STUDIO_BG3D_SHOT_BATCH_PASSES, STUDIO_BG3D_SHOT_BATCH_PASS_LABELS,
    projectStudioBg3dShotVisibilityToRuntime, createStudioBg3dBabylonDiagnosticDocument,
    hasStudioBg3dBabylonDiagnosticBeautyVariation, hasStudioBg3dBabylonDiagnosticDepthVariation,
    hasStudioBg3dBabylonDiagnosticNormalVariation, hasStudioBg3dBabylonDiagnosticStableIds,
    studioBg3dBabylonDiagnosticErrorMessage, DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG,
    STUDIO_BG3D_SUN_TIME_PRESETS, applyStudioBg3dSunRig, resolveStudioBg3dSunLightState,
    buildStudioBg3dSurfacePresetOverride, STUDIO_BG3D_SURFACE_PRESETS,
    collectStudioBg3dSurfaceSelectionSubtreeIds, collectStudioBg3dSurfaceTargetPathIds,
    planStudioBg3dMultiSurfaceSnap, STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS,
    deleteBg3dTemplate, instantiateBg3dTemplateDocument, listBg3dTemplates, saveBg3dTemplate,
    calculateStudioBg3dThreeReparentTransform, calculateStudioBg3dThreeWorldMatrix,
    calculateStudioBg3dThreeWorldDeltaTransform,
    resolveStudioBg3dThreeCenterGroundLocalPosition, applyStudioBg3dThreeWebglRenderSettings,
    ADD_BUTTONS, BG_PANEL_TABS, BG3D_VIEWPORT_HINTS, DEFAULT_LT_USER_PRESET_DESCRIPTION,
    EMPTY_THREE_ANIMATION_CLIPS, EMPTY_THREE_JOINTS, EMPTY_THREE_MORPH_TARGETS,
    loadStudioBg3dBabylonSpecialistEntry, loadStudioBg3dModelThumbnailRuntime,
    LT_EXPORT_HEIGHTS, LT_TONE_MODE_LABELS, LT_TONE_PATTERN_LABELS, LT_TONE_TYPE_LABELS,
    SEMANTIC_MATERIAL_CONFIDENCE_LABELS, SEMANTIC_MATERIAL_SLOT_LABELS,
    STUDIO_BG3D_LT_INSERT_WORKER_TIMEOUT_MS,
    TRANSFORM_MODES, VIEW_EDITOR_SECTIONS, VIEWPORT_BTN, StudioBg3dActionFooter,
    StudioBg3dDirectionalShadowLight, StudioBg3dImmersivePanel, StudioBg3dLtPanel,
    StudioBg3dMeasurementPanel, StudioBg3dMeasurementViewport, StudioBg3dPhysicsPanel,
    StudioBg3dPhysicsTransport, StudioBg3dPlacementPointerController,
    StudioBg3dRoomBuilderPanel, StudioBg3dSceneFog, BgAdaptiveDprController,
    BgCustomModelInstanceBatch, BgCustomModelMesh, BgGroundHelper, BgPlacementPreview,
    BgPrimitiveMesh, BgScaleGuide, BgSectionPlaneController, BgViewportController,
    SkyClearColorController, StudioBg3dThreeRenderSettingsController, StudioBg3dScenePanorama,
    StudioBg3dSceneTemplatePanel, StudioBg3dShapesPanel, StudioBg3dSharedCharacterSceneContent,
    StudioBg3dSharedCharacterStatusOverlay, StudioBg3dSharedStagePanel, StudioBg3dViewPanel,
    StudioBg3dImmersiveRenderBridge, StudioBg3dWebXrSessionBridge, StudioBg3dCaptureAdapter,
    StudioBg3dCaptureRequest, StudioBg3dImmersiveStagePlan, StudioBg3dImportProgress,
    StudioBg3dModelThumbnailCaptureController, StudioBg3dModelThumbnailThreeCaptureHandle,
    StudioBg3dPhysicsTimelineWorkerSession, StudioBg3dShotBatchPass,
    StudioBg3dShotBatchRecoveryScope, StudioBg3dShotBatchRecoverySession,
    StudioBg3dShotBatchRecoveryStore, StudioBackground3DInsertResult, StudioToolHintSpec,
    StudioWebXrMode, StudioWebXrSessionController, StudioWebXrSessionState,
    StudioWebXrSupportSnapshot, open, initialDataUrl, initialScene, seedSceneTemplateId,
    seedPrimitiveKind, onSeedObjectInsertConsumed, sharedSceneSession, sharedStageResolution,
    sharedStageSessionScopeKey, sharedCharactersLinkedToOtherBackgroundCount, operation,
    recoveryScope, validateRecoveryAccess, onWebXrCleanupPendingChange, onClose, onInsert,
    onUseAsAiMethodReference, documentCanvasSize, primitiveGeometryPool, adaptiveDprScale,
    engineRuntime, applyStudioBg3dThreeRenderSettings, setEngineFrameTimeMs,
    setAdaptiveDprScale, sharedCharacterCaptureAuthorityDraft,
    sharedCharacterCaptureAuthorityPayloadKey, readSharedCharacterCaptureAuthorityDraft,
    sharedCharacterCaptureAuthorityPayloadKeyRef, sharedCharacterCaptureAuthorityRevisionRef,
    sharedCharacterCaptureStatusFenceRef, updateSharedCharacterStatusWithCaptureFence,
    acquireSharedCharacterCaptureAuthority, verifySharedCharacterCaptureAuthority, primitives,
    setPrimitives, selectedIds, setSelectedIds, transformMode, setTransformMode, lineArtPreview,
    setLineArtPreview, magicLayerEnabled, setMagicLayerEnabled, isTransforming,
    setIsTransforming, isQuadView, setIsQuadView, webXrBridgeGeneration,
    setWebXrBridgeGeneration, webXrCanvasGeneration, setWebXrCanvasGeneration,
    webXrSessionStateRef, webXrControllerRef, webXrRestoreCameraRef, webXrCleanupPromiseRef,
    webXrRendererRecreationPendingRef, webXrCloseRequestedRef, webXrOpenRef, webXrMountedRef,
    viewTopRef, viewFrontRef, viewRightRef, viewPerspRef, isCapturing, setIsCapturing, error,
    setError, activePanelTab, setActivePanelTab, modelsPanelActivated, setModelsPanelActivated,
    viewEditorSection, setViewEditorSection, babylonDiagnosticAbortRef,
    babylonDiagnosticGenerationRef, physicsPhase, setPhysicsPhase, physicsDurationSeconds,
    setPhysicsDurationSeconds, physicsGroundEnabled, setPhysicsGroundEnabled, physicsProgress,
    setPhysicsProgress, physicsCurrentSeconds, setPhysicsCurrentSeconds, physicsError,
    setPhysicsError, physicsPreviewRevision, setPhysicsPreviewRevision, ltEditorSection,
    setLtEditorSection, ltPresetPanelActivated, setLtPresetPanelActivated,
    ltUserPresetRepository, ltUserPresetHydrationGenerationRef,
    ltUserPresetMutationGenerationRef, ltUserPresetPayload, setLtUserPresetPayload,
    ltUserPresetNotice, setLtUserPresetNotice, ltPreferredPresetId, setLtPreferredPresetId,
    ltManagedUserPresetId, setLtManagedUserPresetId, ltDeleteConfirmId, setLtDeleteConfirmId,
    ltUserPresetName, setLtUserPresetName, ltUserPresetDescription, setLtUserPresetDescription,
    viewportHinted, setViewportHinted, canUndo, setCanUndo, canRedo, setCanRedo, shotNameDraft,
    setShotNameDraft, shotBatchExcludedIds, setShotBatchExcludedIds, shotBatchPasses,
    setShotBatchPasses, shotBatchIncludeLayeredPsd, setShotBatchIncludeLayeredPsd,
    shotBatchIncludeContactSheet, setShotBatchIncludeContactSheet, shotBatchExportHeight,
    setShotBatchExportHeight, shotBatchProgress, setShotBatchProgress, shotBatchRecoverySummary,
    setShotBatchRecoverySummary, isBatchRenderingShots, compositeCategory, setCompositeCategory,
    sceneTemplateCategory, setSceneTemplateCategory, roomBuilderSpec, setRoomBuilderSpec,
    sunRigConfig, setSunRigConfig, sectionPlane, setSectionPlane, scaleGuideVisible,
    setScaleGuideVisible, measurementActive, setMeasurementActive, measurementStatus,
    setMeasurementStatus, measurementActiveRef, snapSettings, setSnapSettings, surfaceSnapArmed,
    setSurfaceSnapArmed, surfaceSnapAlignNormal, setSurfaceSnapAlignNormal, surfaceSnapStatus,
    setSurfaceSnapStatus, layerQuery, setLayerQuery, customModels, setCustomModels,
    modelLibrary, setModelLibrary, placementSession, setPlacementSession, placementSessionRef,
    placementTokenSequenceRef, modelRenderer, setModelRenderer, modelRendererRef,
    isUploadingModel, setIsUploadingModel, modelImportProgress, setModelImportProgress,
    modelImportAbortRef, modelThumbnailCaptureAbortRef, modelThumbnailCaptureEpochRef,
    modelThumbnailGpuLeaseRef, modelAnimationTimeReadersRef, modelRigBakeReadersRef,
    ikEndJointSelection, setIkEndJointSelection, morphTargetSelection, setMorphTargetSelection,
    deletingModelId, setDeletingModelId, isRestoringScene, setIsRestoringScene,
    sceneRestoreAbortRef, templateLibrary, setTemplateLibrary, templateLibraryStatus,
    setTemplateLibraryStatus, isSavingTemplate, setIsSavingTemplate, applyingTemplateId,
    setApplyingTemplateId, generateId, handleSaveSceneAsTemplate, handleDeleteTemplate,
    failedCloneIds, setFailedCloneIds, readyCloneIds, setReadyCloneIds, unbatchableModelIds,
    setUnbatchableModelIds, sceneBaseDocument, setSceneBaseDocument, savedShots,
    shotBatchSelectedIds, selectedShotBatchPasses, deviceSignals, setDeviceSignals, skyPresetId,
    insertBackgroundIntent, transparentInsert, captureRef, modalDialogRef, modalRootRef,
    viewportApiRef, pendingInitialCameraRef, cameraLensGestureBeforeViewRef,
    cameraLensGestureLatestViewRef, cameraLensGestureTimerRef, viewportHostRef, viewportBoxSize,
    setViewportBoxSize, primitiveObjectsRef, surfaceSnapArmedRef,
    dragInitialSelectedTransformsRef, dragInitialFirstTransformRef, panelScrollRef,
    modelRootCacheRef, modelLoadPendingRef, attachmentByStorageModelIdRef,
    storageModelIdByAttachmentIdRef, componentActiveRef, modalAssetSessionRef,
    captureInFlightRef, invalidateModelThumbnailCaptures, ltInsertAbortRef,
    aiMethodReferenceAbortRef, ltInsertSceneEpochRef, ltMagicSelectionEpochRef,
    ltMagicCaptureGenerationRef, ltInsertRestoreLineArtPreviewRef, destructiveMutationGuardRef,
    shotBatchAbortRef, shotBatchRecoveryRef, shotBatchRecoveryScopeRef,
    shotBatchRecoveryStoreRef, shotBatchAuthorizationEpochRef, physicsPhaseRef, physicsAbortRef,
    physicsAnimationFrameRef, physicsGenerationRef, physicsPlaybackStartedAtRef,
    physicsPlaybackOffsetRef, physicsLastUiUpdateRef, physicsLastFrameTimestampRef,
    latestPhysicsSamplesRef, physicsSessionRef, physicsWorkerSessionRef,
    physicsRuntimeSourceRef, physicsStartButtonRef, physicsTransportActionRef,
    shouldTransferPhysicsFocusRef, isModalAssetSessionCurrent,
    getModelThumbnailCaptureController, acquireModelThumbnailGpuLease,
    startModelThumbnailCaptureBatch, invalidateModalAssetSession, cancelSurfaceSnap,
    handleViewportReady, resetWebXrPresentationUi, finishWebXrControllerCleanup,
    disposeCurrentWebXrControllerGeneration, disposeWebXrControllerForOpenChange,
    handleWebXrControllerReady, handleWebXrSessionStateChange, historyRef, historyIndexRef,
    deviceQuality, hasCloneFailure, hasPendingClone, hasPendingSharedCharacter,
    hasUnavailableSharedCharacter, physicsInteractionLocked, insertBlocked,
    magicLayerSelectedPrimitive, magicLayerLensShift, magicLayerUnavailableReason,
    shotBatchBlockedReason, transitionPhysicsPhase, commitImmediateHistoryTransition, doUndo,
    doRedo, canAdmitSceneNodes, addPrimitive, addComposite, proceduralStarterDisabledReason,
    addProceduralStarterAsset, addSceneTemplate, addPrimitiveRef, addSceneTemplateRef,
    objectInsertSeedKeyRef, addRoomBuild, applyRoomBuilderPreset, handleRoomBuilderSpecChange,
    commitSceneEntityRemoval, removeSceneEntities, deleteSelected, deleteSelectedCustomModel,
    deleteSelectedEntity, duplicateSelected, duplicateSelectedCustomModel,
    applyMultiSelectDelta, updateTransform, updateCustomModelTransform,
    updateCustomModelMaterial, updateCustomModelAnimation, updateCustomModelPose,
    updateCustomModelMorph, updateCustomModelConstraints, reparentSceneEntity,
    registerModelAnimationTime, registerModelRigBake, bakeCustomModelRigConstraints,
    finishModelAnimation, updateColor, applySurfacePreset, togglePrimitiveFlag,
    toggleCustomModelFlag, renameBgObject, groundSelectedEntity, placeSelectedModelRecipe,
    centerAndGroundSelectedEntity, commitCameraViewCommand, zoomCameraBy, applyCameraPreset,
    focusSelectedEntity, registerPrimitiveRef, ensureModelRootCached, publishPlacementSession,
    cancelCustomModelPlacement, moveCustomModelPlacement, rotateCustomModelPlacement,
    commitCustomModelPlacement, addCustomModelToScene, applyUserTemplate, handlePanelTabChange,
    reportLtUserPresetMutationFailure, persistLtUserPresetMutation, currentLtUserPresetDraft,
    saveCurrentLtAsUserPreset, updateManagedLtUserPreset, renameManagedLtUserPreset,
    deleteManagedLtUserPreset, applyLtPreset, updateLtLineSettings, updateLtToneSettings,
    updateLtExportHeight, updateLtExportAspectRatio, updateBackgroundSettings,
    updateLightingSettings, updateRenderExposure, applyMoodRig, applySunRigConfig,
    cameraLensInteractionLocked, commitCameraLensView, finishCameraLensGesture,
    previewCameraLens, updateCameraLens, applyTwoPointPerspective, resetTwoPointPerspective,
    readCurrentCanonicalSceneForShot, commitAppliedShot, captureCurrentShot, applySavedShot,
    duplicateActiveShot, moveSavedShot, removeSavedShot, exportSavedShotsAsZip,
    updateBackgroundTransparency, selectedIdsRef, undoRef, redoRef, deleteSelectedRef,
    onCaptureUpdate, requestModalDismiss, requestUserClose, handleSaveToLibrary,
    handleUseAsAiMethodReference, handleInsert, firstSelectedId, selectedPrimitive,
    selectedCustomModel, selectedEntity, selectedModelCacheEntry, selectedSemanticMaterials,
    selectedSemanticAssignments, selectedCharacterPassPlan, selectedBackgroundPassPlan,
    selectedModelAnimations, selectedModelJoints, selectedGenericModelManifest,
    selectedGenericModelProxies, effectiveGenericModelProxyId,
    changeSelectedGenericModelClassification, changeGenericModelControlMode,
    selectGenericModelProxy, selectedJointByKey, selectedPoseRigSelection, selectedPoseJointKey,
    selectedPoseCanonicalKey, selectedPoseJoint, selectedHasEffectiveRigConstraint,
    selectedRigBakeDisabledReason, selectedAimConstraint, selectedIkProtectedJointKeys,
    selectedAimSuppressedByIk, selectedIkEndCandidates, savedIkEndJointKey,
    requestedIkEndJointKey, selectedIkEndJointKey, selectedIkRigSelection, selectedIkEndJoint,
    selectedIkMiddleJoint, selectedIkUpperJoint, selectedTwoBoneIkConstraint,
    selectedIkChainKeys, selectedIkHasOverlap, selectedIkLimitReached, selectedIkWorldMatrix,
    selectedIkSourceRoot, selectedIkTransformSupported, selectedPoseEulerDegrees,
    selectedModelMorphTargets, selectedMorphTargetCandidateKey, selectedMorphTargetKey,
    selectedMorphOverride, selectedAnimationClip, selectedAnimationDuration,
    commitSelectedPoseOverride, commitSelectedAimConstraint, commitSelectedTwoBoneIkConstraint,
    selectedIsLocked, selectedEntities, canGroundSelection, selectedPlaceableModels,
    snapSettingsSummary, sceneHierarchy, effectivelyVisibleLayerIds, surfaceSnapDisabledReason,
    measurementDisabledReason, focusSelectionDisabledReason, cancelMeasurement,
    measurementInferenceReferences, resolveMeasurementCandidate, updateMeasurementPreview,
    pickMeasurementPoint, handleMeasurementSurfacePreview, handleMeasurementLengthLockChange,
    toggleMeasurement, toggleSurfaceSnap, handleSurfaceSnapPick,
    physicsSelectionUnavailableReason, filteredLayerItems, ltLineSettings, ltToneSettings,
    hasFilledOutput, appliedLtPreset, appliedLtPresetId, appliedMoodRig, managedLtUserPreset,
    ltExportAspectRatio, ltCaptureSafeFrame, ltCaptureSizePreview, ltDocumentAspectPreset,
    ltCaptureAspectPresets, ltCaptureAspectPresetId, ltCaptureAspectLabel, hideOnTab,
    cancelPhysicsAnimationFrame, updatePhysicsProgress, restorePhysicsInitialPose,
    resetPhysicsPreview, failPhysicsPreview, physicsPlaybackFrame, startPhysicsPlayback,
    pausePhysicsPreview, resumePhysicsPreview, startPhysicsPreview, handleStartPhysicsPreview,
    bakePhysicsPreview, runBabylonDiagnostic, pausePhysicsWhenHidden, immersiveSceneActive,
    immersiveTransitionActive, effectiveIsQuadView, mainViewTrackRef, bg3dFrameLoop,
    isMainOrtho, currentFocalLengthMm, sunLightState, selectedSky, panoramaRotation,
    renderedSkyPresetId, fogNear, fogFar, fogSliderMax, selectSceneEntity,
    updateModelCloneStatuses, primitiveById, customModelById, batchCandidatesByModelId,
    batchedNodeIds, renderSceneEntity, sharedCharacterSceneContent, shadowSceneBounds,
    shadowMapSize, keyShadowFit, fillShadowFit, webXrDisabledReason, startStudioBg3dWebXr,
    endStudioBg3dWebXr, sceneContent, mainCameraNearClip, mainCameraUp, applyLensShift,
    mainCameraNode, immersiveCameraNode, mainScenePresentationNode, commonOrbitControls,
    commitSharedCharacterTransform, effectiveSelectedSharedCharacter,
    effectiveSelectedSharedCharacterElementId, includeSharedCharactersInCapture,
    mayApplyEmptySharedStageMutation, selectSharedStageMutation,
    setSelectedSharedCharacterElementId, setSharedStageMaterializationKind,
    setSharedStageMutationKind, sharedCharacterCaptureElementIds,
    sharedCharacterCaptureReadiness, sharedCharacterGroundings,
    sharedCharacterPreviewOmissionCount, sharedCharacterReadyCount,
    sharedCharacterRelationshipLabel, sharedCharacterStatuses, sharedCharacterUnavailableCount,
    sharedCharacters, sharedStageMaterializationKind, sharedStageMutationKind,
    shouldStartOnSharedStageLayerTab, targetHasLinkedCharacters, targetHasSavedSharedScene,
    updateSharedCharacterGrounding, updateSharedCharacterStatus, handleUploadModelFiles,
    handleDeleteModelFromLibrary, placementActive, twoPointPerspectiveActive,
    renderedPanoramaRotation, renderedBackgroundSettings, sharedCharacterGroundSurfaceRevision,
    staticModelBatches, mainCameraFarClip, mainCameraMaxOrbitDistance, quadViewHint,
    snapToggleHint, lineArtPreviewHint, surfaceSnapHint,
    // 파일 분할 때 목록에서 빠져 ReferenceError 를 던지던 식별자들(런타임 값 위치) — 복구.
    canPlaceSelectedModelRecipe, centerGroundSelectionDisabledReason, groundSelectionDisabledReason, measurementDraft, measurementStartWorld, placementPreviewAsset, setTransformSpaceOverride, setWebXrSupport, transformSpace,
  } = { ...R, ...h, CaptureBridge };
  const [compositionGuideMode, setCompositionGuideMode] = useState<StudioBg3dCompositionGuideMode>("none");
  const cycleCompositionGuide = () => {
    setCompositionGuideMode((current) => {
      if (current === "none") return "ruleOfThirds";
      if (current === "ruleOfThirds") return "verticalWebtoon";
      if (current === "verticalWebtoon") return "goldenSpiral";
      if (current === "goldenSpiral") return "crosshair";
      return "none";
    });
  };
  const sceneIsEmpty =
    primitives.length === 0 && customModels.length === 0 && sharedCharacters.length === 0;
  return (
          <section className="relative min-h-0 overflow-hidden bg-[oklch(0.98_0_0)] lg:min-h-0">
            <div className="relative mx-auto flex h-full max-h-full min-h-0 w-full max-w-[min(92vw,960px)] items-center justify-center p-2 sm:p-5 lg:max-h-[calc(100dvh-12rem)] lg:min-h-[420px]">
              <div
                ref={viewportHostRef}
                data-testid="studio-bg3d-viewport"
                inert={immersiveSceneActive || undefined}
                className="relative aspect-video h-full max-h-full min-h-0 w-auto overflow-hidden rounded-xl border border-line/80 bg-white shadow-[inset_0_0_0_1px_oklch(1_0_0/0.04)] lg:min-h-[360px]"
              >
                {effectiveIsQuadView && (
                  <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 divide-x divide-y divide-line/80">
                    <div ref={viewTopRef} className="relative w-full h-full" />
                    <div ref={viewPerspRef} className="relative w-full h-full" />
                    <div ref={viewFrontRef} className="relative w-full h-full" />
                    <div ref={viewRightRef} className="relative w-full h-full" />
                  </div>
                )}
                {engineRuntime.phase === "probing" ? (
                  <div
                    role="status"
                    data-testid="studio-bg3d-engine-probing"
                    className="flex h-full w-full items-center justify-center p-6 text-center text-sm text-fg-3"
                  >
                    선택한 3D 엔진을 확인하고 있습니다.
                  </div>
                ) : engineRuntime.plan.status !== "available" ? (
                  <div
                    role="alert"
                    data-testid="studio-bg3d-engine-unavailable"
                    className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-danger"
                  >
                    <p className="font-semibold">
                      {engineRuntime.deviceLostMessage ?? engineRuntime.plan.notice}
                    </p>
                    <p className="max-w-md text-xs leading-relaxed text-fg-3">
                      자동으로 다른 엔진을 실행하지 않습니다. 보기 탭의 3D 렌더 엔진에서
                      WebGPU 또는 WebGL2를 직접 선택해 주세요.
                    </p>
                    <StudioBg3dEngineRecoveryActions
                      preference={engineRuntime.preference}
                      onPreferenceChange={engineRuntime.setPreference}
                    />
                  </div>
                ) : (
                  <Canvas
                  key={`${webXrCanvasGeneration}:${engineRuntime.canvasKey}`}
                  eventSource={viewportHostRef as unknown as React.RefObject<HTMLElement>}
                  camera={{
                    fov: sceneBaseDocument.camera.fovDegrees,
                    position: [...sceneBaseDocument.camera.position],
                    near: mainCameraNearClip,
                    far: 200,
                    up: [...mainCameraUp],
                  }}
                  className={cx(
                    "h-full w-full",
                    !immersiveSceneActive
                      && (surfaceSnapArmed || placementActive || measurementActive)
                      && "cursor-crosshair",
                    effectiveIsQuadView && "pointer-events-none absolute inset-0 z-10",
                  )}
                  dpr={deviceQuality.effectiveDpr * adaptiveDprScale}
                  frameloop={bg3dFrameLoop}
                  shadows={{ enabled: deviceQuality.shadows, type: THREE.PCFShadowMap }}
                  gl={
                    engineRuntime.glFactory
                      ?? { antialias: sceneBaseDocument.render.antialias, alpha: true }
                  }
                  onCreated={({ gl }) => {
                    modelRendererRef.current = gl;
                    setModelRenderer(gl);
                    // Routes by the renderer's own brand flag so the WebGPU renderer receives the
                    // same document colour contract instead of being silently skipped.
                    applyStudioBg3dThreeRenderSettings(gl, sceneBaseDocument.render);
                    gl.setClearColor(getSkyPreset(renderedSkyPresetId).clearColor, 1);
                  }}
                  onPointerMissed={(event) => {
                    if (immersiveSceneActive) return;
                    if (isStudioBg3dViewportControlTarget(event.target)) return;
                    if (placementActive) return;
                    if (surfaceSnapArmedRef.current) {
                      setSurfaceSnapStatus({
                        tone: "error",
                        message: "붙일 수 있는 3D 객체의 표면을 클릭해 주세요.",
                      });
                      return;
                    }
                    if (!isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)) {
                      setSelectedIds(new Set());
                      setSelectedSharedCharacterElementId(null);
                    }
                  }}
                >
                  <StudioBg3dWebXrSessionBridge
                    key={webXrBridgeGeneration}
                    domOverlayRootRef={modalDialogRef}
                    onControllerReady={handleWebXrControllerReady}
                    onSupportChange={setWebXrSupport}
                    onStateChange={handleWebXrSessionStateChange}
                  />
                  <BgAdaptiveDprController
                    targetFps={deviceQuality.targetFps}
                    // Freeze resolution beneath a held gizmo, including when a separate animation
                    // keeps the renderer continuous. Demand-frame idle gaps are not GPU timings.
                    paused={isTransforming || isCapturing || immersiveSceneActive || !open}
                    onScaleChange={setAdaptiveDprScale}
                    onFrameTimeChange={setEngineFrameTimeMs}
                  />
                  <StudioBg3dPlacementPointerController
                    active={placementActive && !effectiveIsQuadView && !immersiveSceneActive}
                    objectsRef={primitiveObjectsRef}
                    onMove={moveCustomModelPlacement}
                    onCommit={commitCustomModelPlacement}
                    onCancel={() => cancelCustomModelPlacement("3D 모델 배치를 취소했습니다.")}
                    onRotate={rotateCustomModelPlacement}
                  />
                  <StudioBg3dViewFrameClear />
                  {effectiveIsQuadView ? (
                    <Fragment>
                      <View track={viewTopRef as unknown as React.RefObject<HTMLElement>}>
                        <OrthographicCamera makeDefault position={[0, 15, 0]} rotation={[-Math.PI / 2, 0, 0]} zoom={40} near={-100} far={100} />
                        {sceneContent}
                        <OrbitControls makeDefault enableRotate={false} enableDamping dampingFactor={0.08} enablePan enabled={!isTransforming && !isCapturing && !placementActive && !measurementActive} />
                      </View>
                      <View track={viewFrontRef as unknown as React.RefObject<HTMLElement>}>
                        <OrthographicCamera makeDefault position={[0, 0, 15]} rotation={[0, 0, 0]} zoom={40} near={-100} far={100} />
                        {sceneContent}
                        <OrbitControls makeDefault enableRotate={false} enableDamping dampingFactor={0.08} enablePan enabled={!isTransforming && !isCapturing && !placementActive && !measurementActive} />
                      </View>
                      <View track={viewRightRef as unknown as React.RefObject<HTMLElement>}>
                        <OrthographicCamera makeDefault position={[15, 0, 0]} rotation={[0, Math.PI / 2, 0]} zoom={40} near={-100} far={100} />
                        {sceneContent}
                        <OrbitControls makeDefault enableRotate={false} enableDamping dampingFactor={0.08} enablePan enabled={!isTransforming && !isCapturing && !placementActive && !measurementActive} />
                      </View>
                    </Fragment>
                  ) : null}
                  <View
                    key="studio-bg3d-main-view"
                    track={mainViewTrackRef as unknown as React.RefObject<HTMLElement>}
                    visible={!immersiveSceneActive}
                  >
                    {immersiveCameraNode ?? mainCameraNode}
                    {!immersiveSceneActive ? (
                      <Fragment>
                        <CaptureBridge onCaptureUpdate={onCaptureUpdate} />
                        <BgViewportController onReady={handleViewportReady} />
                      </Fragment>
                    ) : null}
                    {mainScenePresentationNode}
                    <StudioBg3dImmersiveRenderBridge active={immersiveSceneActive} />
                    {!immersiveSceneActive ? commonOrbitControls : null}
                  </View>
                  </Canvas>
                )}

                {!isCapturing && !immersiveSceneActive ? (
                  <StudioBg3dSharedCharacterStatusOverlay
                    totalCount={sharedCharacters.length}
                    readyCount={sharedCharacterReadyCount}
                    unavailableCount={sharedCharacterUnavailableCount}
                    previewOmissionCount={sharedCharacterPreviewOmissionCount}
                    capacityOmissionCount={sharedSceneSession?.omittedCharacterCount ?? 0}
                    includeInCapture={includeSharedCharactersInCapture}
                    relationshipLabel={sharedCharacterRelationshipLabel}
                    stageResolution={sharedStageResolution}
                  />
                ) : null}

                {sharedCharacters.length === 0
                && sharedStageResolution
                && !isCapturing
                && !immersiveSceneActive ? (
                  <div
                    role={sharedStageResolution.phase === "ready" ? "status" : "alert"}
                    data-testid="studio-bg3d-shared-stage-status"
                    // 좁은 화면에서 top-2/left-2 는 변형 모드 클러스터가 이미 차지한 자리다.
                    // z-30 으로 덮으면 버튼이 반투명 배지 뒤로 비쳐 둘 다 읽히지 않으므로, sm
                    // 미만에서는 같은 파일의 다른 뷰포트 알림들이 쓰는 아래쪽 슬롯으로 내린다.
                    className="pointer-events-none absolute inset-x-3 bottom-12 z-30 mx-auto max-w-[24rem] rounded-lg border border-line/80 bg-panel/92 px-2.5 py-2 text-[0.68rem] font-semibold leading-relaxed text-fg-2 shadow-lg backdrop-blur sm:inset-x-auto sm:bottom-auto sm:left-3 sm:top-3 sm:mx-0 sm:max-w-[min(88%,24rem)]"
                  >
                    {sharedStageResolution.message}
                  </div>
                ) : null}

                {/* Capture-derived, pointer-transparent safe frame and crop mask. */}
                {!immersiveSceneActive
                && !effectiveIsQuadView
                && !isCapturing
                && viewportBoxSize
                && ltCaptureSafeFrame ? (
                  <div className="pointer-events-none absolute inset-0 z-20" aria-hidden="true">
                    <div
                      className={cx(
                        "absolute border border-dashed",
                        ltCaptureSafeFrame.fit === "exact"
                          ? "border-accent/30"
                          : "border-accent/75"
                      )}
                      style={{
                        left: `${ltCaptureSafeFrame.x}px`,
                        top: `${ltCaptureSafeFrame.y}px`,
                        width: `${ltCaptureSafeFrame.width}px`,
                        height: `${ltCaptureSafeFrame.height}px`,
                        ...(ltCaptureSafeFrame.fit === "exact"
                          ? {}
                          : { boxShadow: "0 0 0 9999px oklch(0.16 0 0 / 0.5)" }),
                      }}
                    />
                    {ltCaptureSafeFrame.fit === "exact" ? null : (
                      <span
                        className="absolute rounded-md bg-panel/90 px-1.5 py-0.5 text-[0.6rem] font-bold text-fg-2 shadow-sm"
                        style={{
                          left: `${ltCaptureSafeFrame.x + 4}px`,
                          top: `${ltCaptureSafeFrame.y + 4}px`,
                        }}
                      >
                        {ltCaptureAspectLabel}
                      </span>
                    )}
                  </div>
                ) : null}

                {/* Webtoon composition and perspective guides overlay */}
                {!immersiveSceneActive && !isCapturing ? (
                  <StudioBg3dCompositionOverlay mode={compositionGuideMode} />
                ) : null}

                {placementSession.phase === "preview" && placementPreviewAsset ? (
                  <div
                    data-bg3d-viewport-control="true"
                    role="status"
                    aria-live="polite"
                    className="absolute inset-x-2 bottom-2 z-20 mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-accent/45 bg-panel/95 p-2 shadow-lg backdrop-blur sm:bottom-2.5 sm:px-3"
                  >
                    <Crosshair className="hidden shrink-0 text-accent sm:block" size={17} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-fg">
                        {placementPreviewAsset.name} 배치
                      </p>
                      <p className="truncate text-[0.66rem] font-medium text-fg-3">
                        {placementSession.placement.targetKind === "surface" ? "표면" : "바닥"} · 클릭 확정 · Shift 축 고정 · [ ] 15° 회전
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="3D 배치 왼쪽으로 15도 회전"
                      title="왼쪽 15° ([)"
                      className={VIEWPORT_BTN}
                      onClick={() => rotateCustomModelPlacement("counter-clockwise")}
                    >
                      <RotateCcw size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="3D 배치 오른쪽으로 15도 회전"
                      title="오른쪽 15° (])"
                      className={VIEWPORT_BTN}
                      onClick={() => rotateCustomModelPlacement("clockwise")}
                    >
                      <RotateCw size={16} aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="3D 모델 배치 취소"
                      title="배치 취소 (Esc)"
                      className={cx(VIEWPORT_BTN, "text-bad hover:text-bad")}
                      onClick={() => cancelCustomModelPlacement("3D 모델 배치를 취소했습니다.")}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </div>
                ) : null}

                <div
                  data-bg3d-viewport-control="true"
                  inert={placementActive || undefined}
                  className={cx(
                    "absolute left-2 top-2 z-10 grid grid-cols-3 gap-1.5 sm:left-2.5 sm:top-2.5 sm:flex sm:flex-col",
                    immersiveSceneActive && "hidden",
                  )}
                >
                  <div className="col-span-3 grid grid-cols-3 gap-1 rounded-lg border border-line/70 bg-panel/80 p-1 shadow-sm backdrop-blur sm:flex sm:flex-col">
                    {TRANSFORM_MODES.map((m) => {
                      const ModeIcon = m.icon;
                      const isActive = transformMode === m.id;
                      return (
                        <StudioToolHintTarget key={m.id} hint={m.hint} preferredSide="right">
                          <button
                            type="button"
                            aria-label={m.label}
                            aria-pressed={isActive}
                            disabled={physicsInteractionLocked || placementActive}
                            className={cx(
                              "grid size-11 place-items-center rounded-md text-fg-2 transition-colors hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-8",
                              isActive && "bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent"
                            )}
                            onClick={() => {
                              if (measurementActiveRef.current) {
                                cancelMeasurement("변형 도구로 전환해 줄자 측정을 취소했습니다.");
                              }
                              setTransformMode(m.id);
                            }}
                          >
                            <ModeIcon size={15} aria-hidden />
                          </button>
                        </StudioToolHintTarget>
                      );
                    })}
                  </div>
                  <StudioToolHintTarget
                    className="col-span-2 sm:col-span-1"
                    hint={{
                      id: "bg3d:transform:space",
                      title: transformSpace === "local" ? "로컬 축" : "글로벌 축",
                      description:
                        transformSpace === "local"
                          ? "선택 객체가 회전한 방향을 기준으로 기즈모 축을 표시합니다."
                          : "장면의 고정된 X·Y·Z 방향을 기준으로 기즈모 축을 표시합니다.",
                      preview: "object-rotate",
                      tip: "한 번 선택한 축 기준은 이동·회전·크기 도구를 바꿔도 유지됩니다.",
                    }}
                    disabled={
                      physicsInteractionLocked ||
                      placementActive ||
                      isCapturing ||
                      isRestoringScene ||
                      isBatchRenderingShots
                    }
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label={`${transformSpace === "local" ? "로컬 축" : "글로벌 축"} · ${
                        transformSpace === "local" ? "글로벌 축으로 전환" : "로컬 축으로 전환"
                      }`}
                      aria-pressed={transformSpace === "local"}
                      data-testid="bg3d-transform-space-toggle"
                      disabled={
                        physicsInteractionLocked ||
                        placementActive ||
                        isCapturing ||
                        isRestoringScene ||
                        isBatchRenderingShots
                      }
                      className={cx(
                        "inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-lg border border-line/70 bg-panel/80 px-2 text-[0.65rem] font-bold text-fg-2 shadow-sm backdrop-blur transition-colors",
                        "hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        "disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9",
                        transformSpace === "local" &&
                          "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent",
                      )}
                      onClick={() =>
                        setTransformSpaceOverride((current) => {
                          const effective =
                            current ?? (transformMode === "rotate" ? "local" : "world");
                          return effective === "local" ? "world" : "local";
                        })
                      }
                    >
                      {transformSpace === "local" ? "로컬 축" : "글로벌 축"}
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget hint={quadViewHint} preferredSide="right">
                    <button
                      type="button"
                      aria-label={isQuadView ? "단일 뷰로 복귀" : "4분할 뷰 열기"}
                      aria-pressed={isQuadView}
                      disabled={physicsInteractionLocked || placementActive}
                      className={cx(
                        VIEWPORT_BTN,
                        isQuadView && "bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent"
                      )}
                      onClick={() => {
                        if (measurementActiveRef.current) {
                          cancelMeasurement("4분할 뷰로 전환해 줄자 측정을 취소했습니다.");
                        }
                        setIsQuadView((prev) => !prev);
                      }}
                    >
                      <LayoutTemplate size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={BG3D_VIEWPORT_HINTS.undo}
                    disabled={!canUndo}
                    unavailableReason={!canUndo ? "되돌릴 3D 장면 변경이 없습니다." : undefined}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label="실행 취소"
                      disabled={!canUndo || physicsInteractionLocked}
                      className={cx(VIEWPORT_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
                      onClick={doUndo}
                    >
                      <Undo2 size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={BG3D_VIEWPORT_HINTS.redo}
                    disabled={!canRedo}
                    unavailableReason={!canRedo ? "다시 적용할 3D 장면 변경이 없습니다." : undefined}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label="다시 실행"
                      disabled={!canRedo || physicsInteractionLocked}
                      className={cx(VIEWPORT_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
                      onClick={doRedo}
                    >
                      <Redo2 size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={snapToggleHint}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label={`${snapSettings.enabled ? "스냅 끄기" : "스냅 켜기"} · ${snapSettingsSummary}`}
                      aria-pressed={snapSettings.enabled}
                      className={cx(
                        VIEWPORT_BTN,
                        snapSettings.enabled && "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent"
                      )}
                      onClick={() =>
                        setSnapSettings((prev) =>
                          normalizeStudioBg3dSnapSettings({ ...prev, enabled: !prev.enabled })
                        )
                      }
                    >
                      <Magnet size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={BG3D_VIEWPORT_HINTS.ground}
                    disabled={Boolean(groundSelectionDisabledReason)}
                    unavailableReason={groundSelectionDisabledReason}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label="바닥에 접지"
                      disabled={Boolean(groundSelectionDisabledReason)}
                      className={cx(VIEWPORT_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
                      onClick={groundSelectedEntity}
                    >
                      <MoveDown size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={{
                      id: "bg3d:object:placement-recipe",
                      title: "배치 정리",
                      description: "자동 맞춤 후 바닥에 붙입니다. 다중 선택 지원.",
                      preview: "object-ground",
                    }}
                    disabled={!canPlaceSelectedModelRecipe}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label="배치 정리"
                      disabled={!canPlaceSelectedModelRecipe}
                      className={cx(
                        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line/70 bg-panel/80 px-1.5 text-[0.65rem] font-semibold text-fg-2 shadow-sm backdrop-blur transition-colors",
                        "hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        "disabled:cursor-not-allowed disabled:opacity-40",
                      )}
                      onClick={placeSelectedModelRecipe}
                    >
                      배치 정리
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={BG3D_VIEWPORT_HINTS.originGround}
                    disabled={Boolean(centerGroundSelectionDisabledReason)}
                    unavailableReason={centerGroundSelectionDisabledReason}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label="원점 · 바닥 정렬"
                      disabled={Boolean(centerGroundSelectionDisabledReason)}
                      className={cx(VIEWPORT_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
                      onClick={centerAndGroundSelectedEntity}
                    >
                      <LocateFixed size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={surfaceSnapHint}
                    disabled={Boolean(surfaceSnapDisabledReason) && !surfaceSnapArmed}
                    unavailableReason={surfaceSnapArmed ? undefined : surfaceSnapDisabledReason ?? undefined}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label={surfaceSnapArmed ? "표면 붙이기 취소" : "표면에 붙이기"}
                      aria-pressed={surfaceSnapArmed}
                      data-testid="bg3d-surface-snap-toggle"
                      disabled={Boolean(surfaceSnapDisabledReason) && !surfaceSnapArmed}
                      className={cx(
                        VIEWPORT_BTN,
                        "min-h-11 min-w-11 sm:size-11",
                        "disabled:cursor-not-allowed disabled:opacity-40",
                        surfaceSnapArmed && "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent",
                      )}
                      onClick={toggleSurfaceSnap}
                    >
                      <Crosshair size={17} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={{
                      id: "bg3d:measure:tape",
                      title: measurementActive ? "줄자 측정 취소" : "줄자 · 추론 가이드",
                      description: measurementActive
                        ? "현재 두 점 측정을 취소하고 카메라 조작으로 돌아갑니다."
                        : "객체 표면이나 바닥의 두 점을 찍어 실제 거리와 축·평행·수직 추론을 확인합니다.",
                      preview: "object-snap",
                      previewVariant: measurementActive ? "disable" : undefined,
                      tip: "확정한 측정은 오른쪽 보기 탭에서 길이를 잠그거나 영구 가이드로 남길 수 있어요.",
                    }}
                    disabled={Boolean(measurementDisabledReason) && !measurementActive}
                    unavailableReason={
                      measurementActive ? undefined : measurementDisabledReason ?? undefined
                    }
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label={measurementActive ? "줄자 측정 취소" : "줄자 측정 시작"}
                      aria-pressed={measurementActive}
                      data-testid="bg3d-measurement-toggle"
                      disabled={Boolean(measurementDisabledReason) && !measurementActive}
                      className={cx(
                        VIEWPORT_BTN,
                        "min-h-11 min-w-11 sm:size-11",
                        "disabled:cursor-not-allowed disabled:opacity-40",
                        measurementActive &&
                          "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent",
                      )}
                      onClick={toggleMeasurement}
                    >
                      <Ruler size={17} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={{
                      id: "bg3d:object:surface-snap-normal",
                      title: "법선 정렬",
                      description: "표면에 붙일 때 객체 위쪽을 법선 방향으로 맞춥니다.",
                      preview: "object-snap",
                    }}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label="법선 정렬"
                      aria-pressed={surfaceSnapAlignNormal}
                      data-testid="bg3d-surface-snap-align-normal"
                      className={cx(
                        "inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-2 text-[0.65rem] font-semibold text-fg-2 transition-colors",
                        "hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        surfaceSnapAlignNormal &&
                          "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent",
                      )}
                      onClick={() => setSurfaceSnapAlignNormal((prev) => !prev)}
                    >
                      법선 정렬
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={BG3D_VIEWPORT_HINTS.focus}
                    disabled={Boolean(focusSelectionDisabledReason)}
                    unavailableReason={focusSelectionDisabledReason ?? undefined}
                    preferredSide="right"
                  >
                    <button
                      type="button"
                      aria-label="선택 객체 화면 맞춤"
                      disabled={Boolean(focusSelectionDisabledReason)}
                      className={cx(VIEWPORT_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
                      onClick={focusSelectedEntity}
                    >
                      <ScanLine size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                </div>

                <div
                  data-bg3d-viewport-control="true"
                  inert={placementActive || undefined}
                  className={cx(
                    "absolute right-2 top-2 z-10 grid grid-cols-2 gap-1.5 sm:right-2.5 sm:top-2.5 sm:flex sm:flex-col",
                    immersiveSceneActive && "hidden",
                  )}
                >
                  <StudioToolHintTarget hint={BG3D_VIEWPORT_HINTS.zoomIn} preferredSide="left">
                    <button
                      type="button"
                      aria-label="확대"
                      className={VIEWPORT_BTN}
                      onClick={() => zoomCameraBy(0.82)}
                    >
                      <ZoomIn size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget hint={BG3D_VIEWPORT_HINTS.zoomOut} preferredSide="left">
                    <button
                      type="button"
                      aria-label="축소"
                      className={VIEWPORT_BTN}
                      onClick={() => zoomCameraBy(1.22)}
                    >
                      <ZoomOut size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget hint={BG3D_VIEWPORT_HINTS.resetView} preferredSide="left">
                    <button
                      type="button"
                      aria-label="시점 초기화"
                      className={VIEWPORT_BTN}
                      onClick={() => applyCameraPreset("default")}
                    >
                      <Maximize2 size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget hint={lineArtPreviewHint} preferredSide="left">
                    <button
                      type="button"
                      aria-label={lineArtPreview ? "선화 미리보기 끄기" : "선화 미리보기 켜기"}
                      aria-pressed={lineArtPreview}
                      className={cx(VIEWPORT_BTN, lineArtPreview && "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent")}
                      onClick={() => setLineArtPreview((v) => !v)}
                    >
                      <Boxes size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={{
                      id: "bg3d:viewport:composition-guide",
                      title: `구도 가이드 (${
                        compositionGuideMode === "none"
                          ? "꺼짐"
                          : compositionGuideMode === "ruleOfThirds"
                            ? "3분할선"
                            : compositionGuideMode === "verticalWebtoon"
                              ? "웹툰 컷"
                              : compositionGuideMode === "goldenSpiral"
                                ? "황금나선"
                                : "중심선"
                      })`,
                      description: "웹툰 컷 프레임, 3분할 황금비율 격자, 황금나선, 소점 중심선 가이드를 순환 전환합니다.",
                      preview: "camera-orbit",
                    }}
                    preferredSide="left"
                  >
                    <button
                      type="button"
                      aria-label={`구도 가이드 전환 · 현재: ${compositionGuideMode}`}
                      aria-pressed={compositionGuideMode !== "none"}
                      data-testid="bg3d-composition-guide-toggle"
                      className={cx(
                        VIEWPORT_BTN,
                        compositionGuideMode !== "none" &&
                          "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent",
                      )}
                      onClick={cycleCompositionGuide}
                    >
                      <Aperture size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                  <StudioToolHintTarget
                    hint={{
                      id: "bg3d:viewport:prosuite",
                      title: "웹툰 프로 툴 (20종)",
                      description: "셰이퍼 3D 체형, 투닝 말풍선/이모트, 2.5D 집중선, 스냅툰/에이블러 웹툰 필터, 지면 착지락 등 20종 전문 제작 툴을 엽니다.",
                      preview: "camera-orbit",
                    }}
                    preferredSide="left"
                  >
                    <button
                      type="button"
                      aria-label="웹툰 프로 툴 열기"
                      data-testid="bg3d-prosuite-quick-open"
                      className={cx(
                        VIEWPORT_BTN,
                        activePanelTab === "view" &&
                          viewEditorSection === "prosuite" &&
                          "border-accent/60 bg-accent text-on-accent hover:bg-accent/90 hover:text-on-accent",
                      )}
                      onClick={() => {
                        handlePanelTabChange("view");
                        setViewEditorSection("prosuite");
                      }}
                    >
                      <WandSparkles size={16} aria-hidden />
                    </button>
                  </StudioToolHintTarget>
                </div>

                {surfaceSnapStatus && !immersiveSceneActive ? (
                  <div
                    role="status"
                    aria-live="polite"
                    data-testid="bg3d-surface-snap-status"
                    data-tone={surfaceSnapStatus.tone}
                    className={cx(
                      "pointer-events-none absolute inset-x-3 bottom-12 z-20 mx-auto max-w-md rounded-xl border px-3 py-2 text-center text-xs font-semibold leading-relaxed shadow-lg backdrop-blur",
                      surfaceSnapStatus.tone === "error"
                        ? "border-bad/50 bg-panel/95 text-bad"
                        : surfaceSnapStatus.tone === "success"
                          ? "border-good/50 bg-panel/95 text-good"
                          : "border-accent/50 bg-panel/95 text-accent",
                    )}
                  >
                    {surfaceSnapStatus.message}
                  </div>
                ) : null}

                {!immersiveSceneActive
                && (measurementActive || measurementStartWorld || measurementDraft) ? (
                  <output
                    aria-live="polite"
                    aria-atomic="true"
                    data-testid="bg3d-measurement-status"
                    className="pointer-events-none absolute inset-x-3 bottom-12 z-20 mx-auto max-w-md rounded-xl border border-accent/50 bg-panel/95 px-3 py-2 text-center text-xs font-semibold leading-relaxed text-accent shadow-lg backdrop-blur"
                  >
                    {measurementStatus}
                  </output>
                ) : null}

                <StudioBg3dPhysicsTransport
                  currentActionRef={physicsTransportActionRef}
                  phase={physicsPhase}
                  progress={physicsProgress}
                  currentSeconds={physicsCurrentSeconds}
                  durationSeconds={physicsSessionRef.current?.timeline.durationSeconds ?? physicsDurationSeconds}
                  onPause={pausePhysicsPreview}
                  onResume={resumePhysicsPreview}
                  onReset={() => resetPhysicsPreview()}
                  onBake={bakePhysicsPreview}
                />
                <output
                  aria-live="polite"
                  aria-atomic="true"
                  data-testid="bg3d-physics-status"
                  data-state={physicsPhase}
                  data-preview-revision={physicsPreviewRevision}
                  data-dynamic-count={physicsSessionRef.current?.timeline.nodeIds.length ?? 0}
                  data-sample-count={latestPhysicsSamplesRef.current.length}
                  data-preview-node-id={latestPhysicsSamplesRef.current[0]?.nodeId ?? ""}
                  data-preview-y={latestPhysicsSamplesRef.current[0]?.position[1] ?? ""}
                  className="sr-only"
                >
                  {describeStudioBg3dPhysicsStatus(physicsPhase, physicsError)}
                </output>

                {!immersiveSceneActive && !physicsInteractionLocked && !viewportHinted
                && !sceneIsEmpty ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex flex-col items-center gap-1.5 sm:flex-row sm:justify-between sm:px-3">
                    <div className="pointer-events-auto">
                      <StudioBg3dTurntableController />
                    </div>
                    <span className="rounded-full border border-line/70 bg-panel/85 px-3 py-1 text-center text-[0.66rem] font-medium text-fg-3 shadow-sm backdrop-blur">
                      끌어서 회전 · 오른쪽 드래그로 이동 · 도형 클릭으로 선택
                    </span>
                  </div>
                ) : null}

                {sceneIsEmpty ? (
                  // 360px 인앱 브라우저에서 이 뷰포트의 높이는 240px 안팎이고, 위쪽 모서리는
                  // 조작 클러스터 두 개가 이미 다 쓴다. 그 안에 카드를 띄우면 어떤 여백을 줘도
                  // 버튼과 글자가 서로를 뚫고 겹쳐 둘 다 못 읽는다 — 그래서 좁은 화면에서는
                  // 아래쪽 한 줄로 내리고, 공간이 생기는 sm 이상에서만 카드로 세운다.
                  <div
                    data-testid="studio-bg3d-empty-scene-guide"
                    className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex justify-center sm:inset-0 sm:bottom-auto sm:grid sm:place-items-center sm:p-6"
                  >
                    {/* 컨트롤 패널은 lg 미만에서 뷰포트 "아래"에 쌓인다(lg:border-l). 방향을
                        말하면 휴대폰과 태블릿에서 틀린 안내가 되므로 탭 이름만 부른다. */}
                    <span className="rounded-full border border-line/70 bg-panel/90 px-3 py-1 text-center text-[0.66rem] font-semibold text-fg-2 shadow-sm backdrop-blur sm:hidden">
                      템플릿 · 도형 · 에셋 탭에서 장면을 채워보세요
                    </span>
                    <div className="hidden max-w-[18rem] rounded-2xl border border-line/70 bg-panel/92 px-4 py-4 text-center shadow-lg backdrop-blur sm:block">
                      <div className="mx-auto grid size-12 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
                        <Boxes size={22} aria-hidden />
                      </div>
                      <p className="mt-3 text-sm font-bold leading-relaxed text-fg">
                        &ldquo;템플릿&rdquo; 탭에서 완성된 공간을 통째로,
                        &ldquo;도형&rdquo; 탭에서 상자·원기둥·평면을 하나씩,
                        &ldquo;에셋&rdquo; 탭에서 캐릭터·소품을 놓아 장면을 잡아보세요.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

  );
}
