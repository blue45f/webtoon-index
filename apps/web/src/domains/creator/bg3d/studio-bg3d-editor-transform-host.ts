/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";
import { hasStudioBg3dSelectedAncestor } from "./studio-bg3d-template-instance";

export function attachStudioBg3dEditorTransformHost(h) {
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
    registerModelAnimationTime, registerModelRigBake, finishModelAnimation,
    ensureModelRootCached, publishPlacementSession, cancelCustomModelPlacement,
    moveCustomModelPlacement, rotateCustomModelPlacement, commitCustomModelPlacement,
    addCustomModelToScene, applyUserTemplate, handlePanelTabChange,
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
    setRefTick,
  } = { ...R, ...h };

  const applyMultiSelectDelta = (snap: boolean) => {
    const firstObj = primitiveObjectsRef.current.get(firstSelectedId!);
    const initialFirst = dragInitialFirstTransformRef.current;
    if (!firstObj || !initialFirst) return;
    firstObj.updateWorldMatrix(true, false);
    const hasSelectedTransformDriverAncestor = (item: BgPrimitive | BgCustomModelInstance) =>
      hasStudioBg3dSelectedAncestor(
        item,
        selectedIds,
        (id) => primitiveById.get(id) ?? customModelById.get(id),
        (ancestor) => !isBgObjectTransformBlocked(ancestor),
      );

    const patchTransform = (item: BgPrimitive | BgCustomModelInstance, isFirst: boolean) => {
      const initial = dragInitialSelectedTransformsRef.current.get(item.id);
      if (isFirst) {
        const next = {
          ...item,
          position: [firstObj.position.x, firstObj.position.y, firstObj.position.z] as [number, number, number],
          rotation: [firstObj.rotation.x, firstObj.rotation.y, firstObj.rotation.z] as [number, number, number],
          scale: [firstObj.scale.x, firstObj.scale.y, firstObj.scale.z] as [number, number, number],
        };
        if (snap && (next.position || next.rotation)) {
          const snapped = applyStudioBg3dSnapToTransform(next as { position: [number, number, number]; rotation: [number, number, number] }, snapSettings);
          next.position = snapped.position as [number, number, number];
          next.rotation = snapped.rotation as [number, number, number];
        }
        return next;
      }
      
      if (!initial) return item;
      const object = primitiveObjectsRef.current.get(item.id);
      if (!object) return item;
      object.parent?.updateWorldMatrix(true, false);
      const parentWorld = object.parent?.matrixWorld;
      const targetLocal = calculateStudioBg3dThreeWorldDeltaTransform({
        initialDriverWorldMatrix: initialFirst.worldMatrix,
        currentDriverWorldMatrix: firstObj.matrixWorld,
        initialTargetWorldMatrix: initial.worldMatrix,
        targetParentWorldMatrix: parentWorld,
      });
      if (!targetLocal) return item;
      const next = {
        ...item,
        ...targetLocal,
      };
      if (snap) {
        const snapped = applyStudioBg3dSnapToTransform({
          position: next.position,
          rotation: next.rotation,
        }, snapSettings);
        next.position = snapped.position as [number, number, number];
        next.rotation = snapped.rotation as [number, number, number];
      }
      return next;
    };

    setPrimitives((prev) => prev.map((p) => {
      if (
        !selectedIds.has(p.id) ||
        isBgObjectTransformBlocked(p) ||
        p.id !== firstSelectedId && hasSelectedTransformDriverAncestor(p)
      ) return p;
      return patchTransform(p, p.id === firstSelectedId) as BgPrimitive;
    }));

    setCustomModels((prev) => prev.map((m) => {
      if (
        !selectedIds.has(m.id) ||
        isBgObjectTransformBlocked(m) ||
        m.id !== firstSelectedId && hasSelectedTransformDriverAncestor(m)
      ) return m;
      return patchTransform(m, m.id === firstSelectedId) as BgCustomModelInstance;
    }));
  };
  h.applyMultiSelectDelta = applyMultiSelectDelta;
  const updateTransform = (
    id: string,
    patch: Partial<Pick<BgPrimitive, "position" | "rotation" | "scale">>,
    options: { readonly snap?: boolean } = {}
  ) => {
    const shouldSnap = options.snap !== false;
    setPrimitives((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (isBgObjectTransformBlocked(p)) return p;
        const next = { ...p, ...patch };
        if (shouldSnap && (patch.position || patch.rotation)) {
          const snapped = applyStudioBg3dSnapToTransform(
            {
              position: next.position,
              rotation: next.rotation,
            },
            snapSettings
          );
          if (patch.position) next.position = snapped.position;
          if (patch.rotation) next.rotation = snapped.rotation;
        }
        return next;
      })
    );
  };
  h.updateTransform = updateTransform;
  function updateCustomModelTransform(
    id: string,
    patch: Partial<Pick<BgCustomModelInstance, "position" | "rotation" | "scale">>,
    options: { readonly snap?: boolean } = {}
  ) {
    const shouldSnap = options.snap !== false;
    setCustomModels((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        if (isBgObjectTransformBlocked(m)) return m;
        const next = { ...m, ...patch };
        if (shouldSnap && (patch.position || patch.rotation)) {
          const snapped = applyStudioBg3dSnapToTransform(
            {
              position: next.position,
              rotation: next.rotation,
            },
            snapSettings
          );
          if (patch.position) next.position = snapped.position;
          if (patch.rotation) next.rotation = snapped.rotation;
        }
        return next;
      })
    );
  }
  h.updateCustomModelTransform = updateCustomModelTransform;
  function updateCustomModelMaterial(
    id: string,
    update: StudioBg3dMaterialOverride | null | ((current: StudioBg3dMaterialOverride) => StudioBg3dMaterialOverride),
  ) {
    setCustomModels((prev) => prev.map((model) => {
      if (model.id !== id) return model;
      if (update === null) return { ...model, materialOverride: undefined };
      const current = model.materialOverride ?? DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE;
      const materialOverride = typeof update === "function" ? update(current) : update;
      return { ...model, materialOverride: { ...materialOverride } };
    }));
  }
  h.updateCustomModelMaterial = updateCustomModelMaterial;
  function updateCustomModelAnimation(
    id: string,
    update: StudioBg3dAnimationPlayback | null | ((current: StudioBg3dAnimationPlayback) => StudioBg3dAnimationPlayback),
  ) {
    setCustomModels((prev) => prev.map((model) => {
      if (model.id !== id) return model;
      if (update === null) return { ...model, animation: undefined };
      const stored = model.animation ?? DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK;
      const liveTimeSeconds = modelAnimationTimeReadersRef.current.get(id)?.();
      const current = snapshotStudioBg3dLiveAnimationPlayback(stored, liveTimeSeconds);
      const animation = typeof update === "function" ? update(current) : update;
      return { ...model, animation: { ...animation } };
    }));
  }
  h.updateCustomModelAnimation = updateCustomModelAnimation;
  function updateCustomModelPose(
    id: string,
    update: StudioBg3dPoseLayer | null | ((current: StudioBg3dPoseLayer) => StudioBg3dPoseLayer),
  ) {
    setCustomModels((prev) => prev.map((model) => {
      if (model.id !== id) return model;
      if (update === null) return { ...model, pose: undefined };
      const current = model.pose ?? DEFAULT_STUDIO_BG3D_POSE_LAYER;
      const pose = typeof update === "function" ? update(current) : update;
      return {
        ...model,
        pose: {
          ...pose,
          joints: pose.joints.map((joint) => ({
            jointKey: joint.jointKey,
            rotationOffset: [...joint.rotationOffset],
          })),
        },
      };
    }));
  }
  h.updateCustomModelPose = updateCustomModelPose;
  function updateCustomModelMorph(
    id: string,
    update: StudioBg3dMorphLayer | null | ((current: StudioBg3dMorphLayer) => StudioBg3dMorphLayer),
  ) {
    setCustomModels((prev) => prev.map((model) => {
      if (model.id !== id) return model;
      if (update === null) return { ...model, morph: undefined };
      const current = model.morph ?? DEFAULT_STUDIO_BG3D_MORPH_LAYER;
      const morph = typeof update === "function" ? update(current) : update;
      return {
        ...model,
        morph: {
          ...morph,
          targets: morph.targets.map((target) => ({ ...target })),
        },
      };
    }));
  }
  h.updateCustomModelMorph = updateCustomModelMorph;
  function updateCustomModelConstraints(
    id: string,
    update: StudioBg3dConstraintLayer | null | ((current: StudioBg3dConstraintLayer) => StudioBg3dConstraintLayer),
  ) {
    setCustomModels((previous) => previous.map((model) => {
      if (model.id !== id) return model;
      if (update === null) return { ...model, constraints: undefined };
      const current: StudioBg3dConstraintLayer = model.constraints
        ? {
            ...model.constraints,
            aims: Array.isArray(model.constraints.aims) ? model.constraints.aims : [],
            twoBoneIks: Array.isArray(model.constraints.twoBoneIks)
              ? model.constraints.twoBoneIks
              : [],
          }
        : DEFAULT_STUDIO_BG3D_CONSTRAINT_LAYER;
      const constraints = typeof update === "function" ? update(current) : update;
      return {
        ...model,
        constraints: {
          ...constraints,
          aims: constraints.aims.map((aim) => ({ ...aim, target: [...aim.target] })),
          twoBoneIks: constraints.twoBoneIks.map((ik) => ({
            ...ik,
            target: [...ik.target],
            poleTarget: [...ik.poleTarget],
          })),
        },
      };
    }));
  }
  h.updateCustomModelConstraints = updateCustomModelConstraints;
  function reparentSceneEntity(id: string, nextParentId: string | null): void {
    const entities = [...primitives, ...customModels];
    const entity = entities.find((candidate) => candidate.id === id);
    if (
      !entity ||
      isBgObjectTransformBlocked(entity) ||
      !canSetStudioBg3dParent(entities, id, nextParentId)
    ) {
      return;
    }
    const preserved = calculateStudioBg3dThreeReparentTransform(entities, id, nextParentId);
    if (!preserved) {
      setError("현재 부모 변환에는 기울어짐이 생겨 위치를 보존할 수 없습니다. 부모의 비균일 크기 조정을 확인해 주세요.");
      return;
    }
    const apply = <T extends BgPrimitive | BgCustomModelInstance>(candidate: T): T => {
      if (candidate.id !== id) return candidate;
      return {
        ...candidate,
        parentId: nextParentId,
        ...preserved,
      };
    };
    setPrimitives((current) => current.map(apply) as BgPrimitive[]);
    setCustomModels((current) => current.map(apply) as BgCustomModelInstance[]);
  }
  h.reparentSceneEntity = reparentSceneEntity;
  function bakeCustomModelRigConstraints(id: string): void {
    if (
      captureInFlightRef.current || isCapturing || isRestoringScene ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) return;
    const model = customModels.find((candidate) => candidate.id === id);
    const hasEffectiveConstraint = Boolean(
      model?.constraints?.enabled && (
        model.constraints.aims.some((aim) => aim.weight > 0) ||
        model.constraints.twoBoneIks.some((ik) => ik.weight > 0)
      )
    );
    if (!model || !hasEffectiveConstraint) {
      setError("굽기 전에 강도가 0보다 큰 IK 또는 에임 제약을 켜 주세요.");
      return;
    }
    const snapshot = modelRigBakeReadersRef.current.get(id)?.() ?? null;
    if (!snapshot) {
      setError("현재 리그 결과를 안전하게 고정할 수 없습니다. 조인트 계층·크기 변환과 모델 준비 상태를 확인해 주세요.");
      return;
    }
    const transition = createStudioBg3dRigPoseBakeHistoryTransition(model.animation, snapshot);
    if (!transition) {
      setError("현재 표시 프레임을 정적 포즈로 정규화하지 못했습니다.");
      return;
    }
    const beforeCustomModels = customModels.map((candidate) => {
      if (!candidate.animation) return candidate;
      const animation = candidate.id === id
        ? transition.beforeAnimation
        : snapshotStudioBg3dLiveAnimationPlayback(
            candidate.animation,
            modelAnimationTimeReadersRef.current.get(candidate.id)?.(),
          );
      return animation ? { ...candidate, animation } : candidate;
    });
    const nextCustomModels = beforeCustomModels.map((candidate) => candidate.id === id
      ? { ...candidate, ...transition.patch }
      : candidate
    );
    commitImmediateHistoryTransition(
      primitives,
      nextCustomModels,
      sceneBaseDocument,
      createStudioBg3dHistorySnapshot({
        primitives,
        customModels: beforeCustomModels,
        document: sceneBaseDocument,
      }),
    );
    setError(null);
    setCustomModels(nextCustomModels);
  }
  h.bakeCustomModelRigConstraints = bakeCustomModelRigConstraints;
  const updateColor = (id: string, color: string) => {
    setPrimitives((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)));
  };
  h.updateColor = updateColor;
  const applySurfacePreset = (id: string, presetId: string | null) => {
    setPrimitives((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              materialOverride:
                presetId === null ? undefined : buildStudioBg3dSurfacePresetOverride(presetId) ?? undefined,
            }
          : p,
      ),
    );
  };
  h.applySurfacePreset = applySurfacePreset;
  function togglePrimitiveFlag(id: string, flag: "visible" | "locked") {
    setPrimitives((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (flag === "visible") return { ...p, visible: !isBgObjectVisible(p) };
        return { ...p, locked: !isBgObjectLocked(p) };
      })
    );
  }
  h.togglePrimitiveFlag = togglePrimitiveFlag;
  function toggleCustomModelFlag(id: string, flag: "visible" | "locked") {
    setCustomModels((prev) =>
      prev.map((m) => {
        if (m.id !== id) return m;
        if (flag === "visible") return { ...m, visible: !isBgObjectVisible(m) };
        return { ...m, locked: !isBgObjectLocked(m) };
      })
    );
  }
  h.toggleCustomModelFlag = toggleCustomModelFlag;
  function renameBgObject(id: string, kind: "primitive" | "model") {
    const item = kind === "primitive" ? primitives.find(p => p.id === id) : customModels.find(m => m.id === id);
    if (!item) return;
    const currentName = item.name || (kind === "primitive" ? PRIMITIVE_DEFS[(item as BgPrimitive).kind].label : "3D 모델");
    const newName = window.prompt("새 이름을 입력하세요", currentName);
    if (newName === null) return;
    const trimmed = newName.trim();
    
    if (kind === "primitive") {
      setPrimitives((prev) => prev.map(p => p.id === id ? { ...p, name: trimmed || undefined } : p));
    } else {
      setCustomModels((prev) => prev.map(m => m.id === id ? { ...m, name: trimmed || undefined } : m));
    }
  }
  h.renameBgObject = renameBgObject;
  function groundSelectedEntity() {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      const object = primitiveObjectsRef.current.get(id);
      if (object) {
        object.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(object);
        if (!bounds.isEmpty() && Number.isFinite(bounds.min.y)) {
          const nextWorldPosition = object.getWorldPosition(new THREE.Vector3());
          nextWorldPosition.y -= bounds.min.y;
          object.parent?.updateWorldMatrix(true, false);
          const nextLocalPosition = object.parent
            ? object.parent.worldToLocal(nextWorldPosition)
            : nextWorldPosition;
          const position: [number, number, number] = [
            nextLocalPosition.x,
            nextLocalPosition.y,
            nextLocalPosition.z,
          ];
          const primitive = primitives.find((candidate) => candidate.id === id);
          if (primitive && !isBgObjectTransformBlocked(primitive)) {
            updateTransform(id, { position }, { snap: false });
            continue;
          }
          const model = customModels.find((candidate) => candidate.id === id);
          if (model && !isBgObjectTransformBlocked(model)) {
            updateCustomModelTransform(id, { position }, { snap: false });
            continue;
          }
        }
      }
      const prim = primitives.find((p) => p.id === id);
      if (prim) {
        if (isBgObjectTransformBlocked(prim)) continue;
        if (prim.parentId) continue;
        const position = groundPrimitiveTransform(prim.kind, prim.position, prim.rotation, prim.scale);
        updateTransform(prim.id, { position });
        continue;
      }
      const model = customModels.find((m) => m.id === id);
      if (!model || isBgObjectTransformBlocked(model)) continue;
      if (model.parentId) continue;
      const root = modelRootCacheRef.current.get(model.modelId)?.root;
      const size = root ? measureBg3dObjectSize(root) : ([2, 2, 2] as [number, number, number]);
      const position = groundModelTransform(size, model.position, model.rotation, model.scale);
      updateCustomModelTransform(model.id, { position });
    }
  }
  h.groundSelectedEntity = groundSelectedEntity;
  function placeSelectedModelRecipe() {
    if (physicsInteractionLocked) {
      setError("물리 미리보기 중에는 장면 변형 도구를 잠급니다.");
      return;
    }
    if (selectedIds.size === 0) {
      setError("배치 정리할 커스텀 모델을 선택해 주세요.");
      return;
    }
    if (selectedIds.size > STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS) {
      setError(
        `배치 정리는 한 번에 최대 ${STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS}개까지 지원합니다.`,
      );
      return;
    }

    // Multi-select: independent per-model auto-fit → ground recipes, one history step (surface snap style).
    const models: BgCustomModelInstance[] = [];
    for (const id of selectedIds) {
      const model = customModels.find((candidate) => candidate.id === id);
      if (!model) {
        setError("배치 정리는 커스텀 모델에만 사용할 수 있습니다.");
        return;
      }
      models.push(model);
    }
    if (models.every((model) => isBgObjectTransformBlocked(model))) {
      setError("선택한 객체의 잠금을 먼저 해제해 주세요.");
      return;
    }

    const transformById = new Map<
      string,
      {
        position: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
      }
    >();
    let successCount = 0;
    let firstFailure: string | null = null;
    for (const model of models) {
      if (transformById.size >= STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS) break;
      if (isBgObjectTransformBlocked(model)) continue;
      const root = modelRootCacheRef.current.get(model.modelId)?.root;
      const boundingSize = root
        ? measureBg3dObjectSize(root)
        : ([2, 2, 2] as [number, number, number]);
      const result = planStudioBg3dModelPlacementRecipe({
        position: model.position,
        rotation: model.rotation,
        scale: model.scale,
        boundingSize,
        autoFitTargetSize: 2,
        groundY: 0,
        yawDegrees: 0,
      });
      if (!result.ok) {
        firstFailure ??= result.reason;
        continue;
      }
      successCount += 1;
      transformById.set(model.id, {
        position: [...result.position] as [number, number, number],
        rotation: [...result.rotation] as [number, number, number],
        scale: [...result.scale] as [number, number, number],
      });
    }

    if (successCount === 0) {
      setError(firstFailure ?? "배치 정리를 적용할 수 없습니다.");
      return;
    }

    const nextCustomModels = customModels.map((model) => {
      const next = transformById.get(model.id);
      if (!next) return model;
      return {
        ...model,
        position: next.position,
        rotation: next.rotation,
        scale: next.scale,
      };
    });
    commitImmediateHistoryTransition(primitives, nextCustomModels, sceneBaseDocument);
    setCustomModels(nextCustomModels);
    setError(null);
    setSurfaceSnapStatus({
      tone: "success",
      message: `${successCount}개 배치를 정리했어요`,
    });
  }
  h.placeSelectedModelRecipe = placeSelectedModelRecipe;
  function centerAndGroundSelectedEntity() {
    if (
      selectedIds.size !== 1 ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) {
      return;
    }

    const id = selectedIds.values().next().value;
    if (typeof id !== "string") return;
    const primitive = primitives.find((candidate) => candidate.id === id);
    const model = customModels.find((candidate) => candidate.id === id);
    const entity = primitive ?? model;
    if (!entity || isBgObjectTransformBlocked(entity)) return;

    const object = primitiveObjectsRef.current.get(id);
    if (!object) {
      setError("선택한 객체의 지오메트리를 아직 준비하지 못했습니다. 모델이 표시된 뒤 다시 시도해 주세요.");
      return;
    }

    const nextLocalPosition = resolveStudioBg3dThreeCenterGroundLocalPosition(object);
    if (!nextLocalPosition) {
      setError("선택한 객체의 지오메트리 경계가 올바르지 않아 원점 정렬을 취소했습니다.");
      return;
    }

    const currentPosition = entity.position;
    if (currentPosition.every(
      (value, index) => Math.abs(value - nextLocalPosition[index]) <= 1e-6
    )) {
      setError(null);
      return;
    }

    const nextPrimitives = primitive
      ? primitives.map((candidate) => candidate.id === id
        ? { ...candidate, position: nextLocalPosition }
        : candidate)
      : primitives;
    const nextCustomModels = model
      ? customModels.map((candidate) => candidate.id === id
        ? { ...candidate, position: nextLocalPosition }
        : candidate)
      : customModels;

    // Explicit editor commands enter history immediately, avoiding the normal 400 ms debounce and
    // guaranteeing one-step undo even when the user invokes another command right away.
    commitImmediateHistoryTransition(nextPrimitives, nextCustomModels, sceneBaseDocument);
    setPrimitives(nextPrimitives);
    setCustomModels(nextCustomModels);
    setError(null);
  }
  h.centerAndGroundSelectedEntity = centerAndGroundSelectedEntity;
  function commitCameraViewCommand(
    beforeView: StudioBg3dCameraSettings,
    nextView: StudioBg3dCameraSettings,
  ): boolean {
    const viewport = viewportApiRef.current;
    const beforeDocument = canonicalSceneDocument({ ...sceneBaseDocument, camera: beforeView });
    const nextDocument = canonicalSceneDocument({ ...sceneBaseDocument, camera: nextView });
    if (!viewport || !beforeDocument || !nextDocument) {
      viewport?.applyView(beforeView);
      setError("카메라 구도를 안전한 장면 상태로 만들지 못해 명령을 취소했습니다.");
      return false;
    }
    if (JSON.stringify(beforeDocument.camera) === JSON.stringify(nextDocument.camera)) {
      setError(null);
      return true;
    }
    if (!viewport.applyView(nextDocument.camera)) {
      viewport.applyView(beforeDocument.camera);
      setError("현재 카메라 투영이 아직 준비되지 않아 구도를 변경하지 않았습니다.");
      return false;
    }
    commitImmediateHistoryTransition(
      primitives,
      customModels,
      nextDocument,
      createStudioBg3dHistorySnapshot({
        primitives,
        customModels,
        document: beforeDocument,
      }),
      { preserveBeforeCamera: true },
    );
    setSceneBaseDocument(nextDocument);
    setViewportHinted(true);
    setError(null);
    return true;
  }
  h.commitCameraViewCommand = commitCameraViewCommand;
  function zoomCameraBy(distanceFactor: number): void {
    if (
      isCapturing || isBatchRenderingShots || isRestoringScene ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) return;
    const viewport = viewportApiRef.current;
    if (!viewport) {
      setError("카메라가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const beforeView = viewport.readView();
    if (!viewport.zoomBy(distanceFactor)) {
      setError("현재 카메라에서는 더 확대하거나 축소할 수 없습니다.");
      return;
    }
    const nextView = viewport.readView();
    commitCameraViewCommand(beforeView, nextView);
  }
  h.zoomCameraBy = zoomCameraBy;
  function applyCameraPreset(presetId: string): void {
    if (
      isCapturing || isBatchRenderingShots || isRestoringScene ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) return;
    const viewport = viewportApiRef.current;
    if (!viewport) {
      setError("카메라가 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }
    const beforeView = viewport.readView();
    if (!viewport.applyPreset(presetId)) {
      setError("선택한 카메라 프리셋을 적용하지 못했습니다.");
      return;
    }
    commitCameraViewCommand(beforeView, viewport.readView());
  }
  h.applyCameraPreset = applyCameraPreset;
  function focusSelectedEntity() {
    if (selectedIds.size !== 1) {
      setError("화면에 맞출 3D 객체를 하나만 선택해 주세요.");
      return;
    }
    const selectedId = selectedIds.values().next().value;
    if (typeof selectedId !== "string") return;
    const object = primitiveObjectsRef.current.get(selectedId);
    const bounds = readStudioBg3dObjectWorldBounds(object);
    const framing = viewportApiRef.current?.readFramingState() ?? null;
    if (!object || !bounds || !framing) {
      setError("선택한 객체의 실제 경계 또는 카메라 화면을 아직 준비하지 못했습니다. 모델이 표시된 뒤 다시 시도해 주세요.");
      return;
    }
    const nextView = fitStudioBg3dCameraToBounds({
      camera: framing.view,
      bounds,
      viewportAspect: framing.viewportAspect,
      ...(framing.orthographicFrustumAtZoomOne
        ? { orthographicFrustumAtZoomOne: framing.orthographicFrustumAtZoomOne }
        : {}),
    });
    if (!nextView || !commitCameraViewCommand(framing.view, nextView)) {
      if (!nextView) {
        setError("선택한 객체를 현재 카메라 투영과 렌즈 이동 범위 안에 맞출 수 없어 구도를 유지했습니다.");
      }
      return;
    }
  }
  h.focusSelectedEntity = focusSelectedEntity;
  const registerPrimitiveRef = (id: string, obj: THREE.Group | null) => {
    if (obj) primitiveObjectsRef.current.set(id, obj);
    else primitiveObjectsRef.current.delete(id);
    setRefTick((n) => n + 1);
  };
  h.registerPrimitiveRef = registerPrimitiveRef;
}
