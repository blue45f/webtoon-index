/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function attachStudioBg3dEditorCaptureHost(h) {
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
    handleInsert, firstSelectedId, selectedPrimitive, selectedCustomModel, selectedEntity,
    selectedModelCacheEntry, selectedSemanticMaterials, selectedSemanticAssignments,
    selectedCharacterPassPlan, selectedBackgroundPassPlan, selectedModelAnimations,
    selectedModelJoints, selectedGenericModelManifest, selectedGenericModelProxies,
    effectiveGenericModelProxyId, changeSelectedGenericModelClassification,
    changeGenericModelControlMode, selectGenericModelProxy, selectedJointByKey,
    selectedPoseRigSelection, selectedPoseJointKey, selectedPoseCanonicalKey, selectedPoseJoint,
    selectedHasEffectiveRigConstraint, selectedRigBakeDisabledReason, selectedAimConstraint,
    selectedIkProtectedJointKeys, selectedAimSuppressedByIk, selectedIkEndCandidates,
    savedIkEndJointKey, requestedIkEndJointKey, selectedIkEndJointKey, selectedIkRigSelection,
    selectedIkEndJoint, selectedIkMiddleJoint, selectedIkUpperJoint,
    selectedTwoBoneIkConstraint, selectedIkChainKeys, selectedIkHasOverlap,
    selectedIkLimitReached, selectedIkWorldMatrix, selectedIkSourceRoot,
    selectedIkTransformSupported, selectedPoseEulerDegrees, selectedModelMorphTargets,
    selectedMorphTargetCandidateKey, selectedMorphTargetKey, selectedMorphOverride,
    selectedAnimationClip, selectedAnimationDuration, commitSelectedPoseOverride,
    commitSelectedAimConstraint, commitSelectedTwoBoneIkConstraint, selectedIsLocked,
    selectedEntities, canGroundSelection, selectedPlaceableModels, snapSettingsSummary,
    sceneHierarchy, effectivelyVisibleLayerIds, surfaceSnapDisabledReason,
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
    setCaptureBackgroundSnapshot,
  } = { ...R, ...h };

  const onCaptureUpdate = (
    state: CaptureState,
    cleanupAdapter?: StudioBg3dCaptureAdapter | null
  ) => {
    if (cleanupAdapter) {
      if (captureRef.current.adapter === cleanupAdapter) {
        captureRef.current = { adapter: null, camera: null };
      }
    } else {
      captureRef.current = state;
    }
  };
  h.onCaptureUpdate = onCaptureUpdate;
  function requestModalDismiss() {
    if (measurementActiveRef.current) {
      cancelMeasurement("줄자 측정을 취소했습니다.");
      return;
    }
    if (surfaceSnapArmedRef.current) {
      cancelSurfaceSnap("표면 붙이기를 취소했습니다.");
      return;
    }
    requestUserClose();
  }
  h.requestModalDismiss = requestModalDismiss;
  function requestUserClose() {
    // The synchronous guard covers header clicks that precede capture/delete state commits.
    const thumbnailLease = modelThumbnailGpuLeaseRef.current;
    if (thumbnailLease) {
      const session = modalAssetSessionRef.current;
      invalidateModelThumbnailCaptures();
      void thumbnailLease.released.then(() => {
        if (session && isModalAssetSessionCurrent(session)) requestUserClose();
      });
      return;
    }
    if (captureInFlightRef.current) return;
    if (destructiveMutationGuardRef.current.blocksClose) return;
    if (isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)) {
      resetPhysicsPreview();
    }
    if (measurementActiveRef.current) cancelMeasurement();
    cancelSurfaceSnap();
    webXrCloseRequestedRef.current = true;
    disposeCurrentWebXrControllerGeneration();
    invalidateModalAssetSession();
    onClose();
  }
  h.requestUserClose = requestUserClose;
  async function handleSaveToLibrary() {
    if (
      captureInFlightRef.current || isCapturing ||
      destructiveMutationGuardRef.current.blocksClose || insertBlocked ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) return;
    if (!insertBackgroundIntent.ok) {
      setError(insertBackgroundIntent.reason);
      return;
    }
    const currentCapture = captureRef.current;
    if (!currentCapture.adapter) {
      setError("캡처할 3D 장면이 아직 준비되지 않았습니다.");
      return;
    }
    const backgroundSnapshot = createStudioBg3dCaptureBackgroundSnapshot({
      background: sceneBaseDocument.background,
      transparent: transparentInsert,
    });
    const currentView = viewportApiRef.current?.readView() ?? sceneBaseDocument.camera;
    const currentBaseDocument: StudioBg3dSceneDocument = {
      ...sceneBaseDocument,
      camera: currentView,
      background: backgroundSnapshot.background,
      output: {
        ...sceneBaseDocument.output,
        transparentBackground: backgroundSnapshot.transparent,
      },
    };
    const adaptation = tryAdaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels,
      attachmentByStorageModelId: attachmentByStorageModelIdRef.current,
      baseDocument: currentBaseDocument,
    });
    if (!adaptation.ok) {
      setError("현재 장면이 안전 예산을 초과해 소재 저장을 시작하지 않았습니다. 장면을 나누거나 일부 오브젝트를 정리해 주세요.");
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
      setError("장면 원본을 손실 없이 저장할 수 없어 소재 저장을 중단했습니다. 문제가 있는 도형이나 모델을 확인해 주세요.");
      return;
    }
    const sharedCharacterAuthorityResult = acquireSharedCharacterCaptureAuthority();
    if (!sharedCharacterAuthorityResult?.ok) {
      setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
      return;
    }
    const sharedCharacterAuthorityLease = sharedCharacterAuthorityResult.lease;

    const previousLineArtPreview = lineArtPreview;
    captureInFlightRef.current = true;
    setCaptureBackgroundSnapshot(backgroundSnapshot);
    setLineArtPreview(false);
    setIsCapturing(true);
    try {
      // Load the asset writer only on explicit save while the capture guard excludes re-entry.
      const { saveAsset } = await import("../studio-asset-library");
      const captureAdapter = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
        isActive: () => componentActiveRef.current,
        readAdapter: () => captureRef.current.adapter,
        waitForPaintFrame: waitForStudioBg3dPaintFrame,
      });
      if (!captureAdapter) {
        if (componentActiveRef.current) {
          setError("캡처할 단일 3D 시점을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
        return;
      }
      const rasterAuthority = verifySharedCharacterCaptureAuthority(
        sharedCharacterAuthorityLease,
        "raster",
      );
      if (!rasterAuthority?.ok) {
        setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
        return;
      }

      const captured = await captureStudioBg3dRaster(captureAdapter, {
        width: 320,
        height: 320,
        background: studioBg3dCaptureBackgroundRequestFromSnapshot(backgroundSnapshot),
        includeDepth: false,
      });
      if (!componentActiveRef.current || captureRef.current.adapter !== captureAdapter) return;

      const canvas = document.createElement("canvas");
      canvas.width = captured.width;
      canvas.height = captured.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D context");
      const idata = new ImageData(new Uint8ClampedArray(captured.rgba), captured.width, captured.height);
      ctx.putImageData(idata, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const hashUrl = `${dataUrl}#${encodeURIComponent(adapted.serialized)}`;
      const receiptAuthority = verifySharedCharacterCaptureAuthority(
        sharedCharacterAuthorityLease,
        "receipt",
      );
      if (!receiptAuthority?.ok) {
        setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
        return;
      }

      await saveAsset({
        name: "내 3D 장면",
        dataUrl: hashUrl,
        width: captured.width,
        height: captured.height,
        kind: "bg3d",
      });
      window.alert("현재 장면을 내 소재 라이브러리에 저장했습니다.\\n화면 좌측 상단의 '소재' 패널에서 언제든 꺼내 쓸 수 있습니다.");
    } catch (_e) {
      setError("소재 라이브러리 저장 중 오류가 발생했습니다.");
    } finally {
      captureInFlightRef.current = false;
      if (componentActiveRef.current) {
        setCaptureBackgroundSnapshot(null);
        setIsCapturing(false);
        setLineArtPreview(previousLineArtPreview);
      }
    }
  }
  h.handleSaveToLibrary = handleSaveToLibrary;
  async function handleUseAsAiMethodReference() {
    if (
      !onUseAsAiMethodReference ||
      captureInFlightRef.current ||
      isCapturing ||
      destructiveMutationGuardRef.current.blocksClose ||
      insertBlocked
    ) return;
    if (!insertBackgroundIntent.ok) {
      setError(insertBackgroundIntent.reason);
      return;
    }
    const currentCapture = captureRef.current;
    if (!currentCapture.adapter) {
      setError("AI 구도 참조로 캡처할 3D 장면이 아직 준비되지 않았습니다.");
      return;
    }
    const session = modalAssetSessionRef.current;
    if (!session || !isModalAssetSessionCurrent(session)) return;

    const backgroundSnapshot = createStudioBg3dCaptureBackgroundSnapshot({
      background: sceneBaseDocument.background,
      transparent: transparentInsert,
    });
    const currentView = viewportApiRef.current?.readView() ?? sceneBaseDocument.camera;
    const currentBaseDocument: StudioBg3dSceneDocument = {
      ...sceneBaseDocument,
      camera: currentView,
      background: backgroundSnapshot.background,
      output: {
        ...sceneBaseDocument.output,
        transparentBackground: backgroundSnapshot.transparent,
      },
    };
    const adaptation = tryAdaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels,
      attachmentByStorageModelId: attachmentByStorageModelIdRef.current,
      baseDocument: currentBaseDocument,
    });
    if (!adaptation.ok) {
      setError("현재 장면이 안전 예산을 초과해 AI 구도 참조 캡처를 시작하지 않았습니다. 장면을 나누거나 일부 오브젝트를 정리해 주세요.");
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
      setError(
        "현재 3D 샷을 손실 없이 고정할 수 없어 AI 구도 참조 캡처를 중단했습니다. 문제가 있는 모델을 확인해 주세요.",
      );
      return;
    }
    const sharedCharacterAuthorityResult = acquireSharedCharacterCaptureAuthority();
    if (!sharedCharacterAuthorityResult?.ok) {
      setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
      return;
    }
    const sharedCharacterAuthorityLease = sharedCharacterAuthorityResult.lease;

    aiMethodReferenceAbortRef.current?.abort();
    const controller = new AbortController();
    aiMethodReferenceAbortRef.current = controller;
    const isCaptureCurrent = () => (
      !controller.signal.aborted &&
      aiMethodReferenceAbortRef.current === controller &&
      isModalAssetSessionCurrent(session)
    );
    const previousLineArtPreview = lineArtPreview;
    captureInFlightRef.current = true;
    setError(null);
    setCaptureBackgroundSnapshot(backgroundSnapshot);
    setLineArtPreview(false);
    setIsCapturing(true);

    try {
      const captureAdapter = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
        isActive: isCaptureCurrent,
        readAdapter: () => captureRef.current.adapter,
        waitForPaintFrame: waitForStudioBg3dPaintFrame,
        signal: controller.signal,
        timeoutMs: 15_000,
      });
      if (!captureAdapter) {
        if (isCaptureCurrent()) {
          setError("AI 구도 참조용 3D 시점을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
        return;
      }

      const sourceSize = await getStudioBg3dCaptureSourceSize(captureAdapter);
      const captureFrame = resolveStudioBg3dCaptureFrame({
        viewportWidth: sourceSize.width,
        viewportHeight: sourceSize.height,
        aspectRatio: adapted.document.output.exportAspectRatio ?? null,
      });
      if (!captureFrame) throw new Error("AI reference capture frame admission failed.");

      const captureDensity = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
      const captureSize = resolveStudioBg3dLtCaptureSize({
        sourceWidth: sourceSize.width,
        sourceHeight: sourceSize.height,
        aspectRatio: captureFrame.aspectRatio,
        requestedHeight: Math.min(
          2_048,
          Math.max(640, Math.round(adapted.document.output.exportHeight * captureDensity)),
        ),
        // A provider reference is not a final print render. Keep its worst-case RGBA footprint
        // below the existing 12 MiB single-reference admission before PNG encoding.
        maxPixels: Math.min(deviceQuality.maxRenderPixels, 2_000_000),
      });
      if (!captureSize) throw new Error("AI reference capture size admission failed.");
      const rasterAuthority = verifySharedCharacterCaptureAuthority(
        sharedCharacterAuthorityLease,
        "raster",
      );
      if (!rasterAuthority?.ok) {
        setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
        return;
      }

      const releaseCaptureFrameViewOffset = applyStudioBg3dCaptureFrameViewOffset(
        captureRef.current.adapter === captureAdapter ? captureRef.current.camera : null,
        captureFrame,
        sourceSize,
      );
      if (!releaseCaptureFrameViewOffset) {
        throw new Error("AI reference capture frame could not be applied.");
      }
      const captured = await captureStudioBg3dRaster(captureAdapter, {
        width: captureSize.width,
        height: captureSize.height,
        background: studioBg3dCaptureBackgroundRequestFromSnapshot(backgroundSnapshot),
        includeDepth: false,
      }, {
        signal: controller.signal,
        timeoutMs: 30_000,
      }).finally(releaseCaptureFrameViewOffset);
      if (
        !isCaptureCurrent() ||
        captureRef.current.adapter !== captureAdapter
      ) return;

      const canvas = document.createElement("canvas");
      canvas.width = captured.width;
      canvas.height = captured.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("AI reference PNG context unavailable.");
      const imageData = context.createImageData(captured.width, captured.height);
      imageData.data.set(captured.rgba);
      context.putImageData(imageData, 0, 0);
      const receiptAuthority = verifySharedCharacterCaptureAuthority(
        sharedCharacterAuthorityLease,
        "receipt",
      );
      if (!receiptAuthority?.ok) {
        setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
        return;
      }

      const handoff = createStudioBg3dAiMethodReferenceCapture({
        dataUrl: canvas.toDataURL("image/png").split("#", 1)[0],
        width: captured.width,
        height: captured.height,
        ...(adapted.document.activeShotId
          ? { shotId: adapted.document.activeShotId }
          : {}),
        captureIdentity: {
          backend: captureAdapter.backend,
          engineId: captureAdapter.engineId,
          engineVersion: captureAdapter.engineVersion,
          implementationRevision: captureAdapter.implementationRevision,
          graphicsApi: captureAdapter.graphicsApi,
          profileId: captureAdapter.profileId,
        },
      });
      const accepted = await onUseAsAiMethodReference(handoff);
      if (accepted === false && isCaptureCurrent()) {
        setError("현재 3D 샷을 AI 참조 팩에 추가하지 못했습니다. 편집 잠금과 저장소 상태를 확인해 주세요.");
      }
    } catch (cause) {
      if (!controller.signal.aborted && isCaptureCurrent()) {
        setError(
          cause instanceof Error && cause.message.includes("크기")
            ? cause.message
            : "현재 3D 샷을 AI 구도 참조로 준비하지 못했습니다. 장면을 확인한 뒤 다시 시도해 주세요.",
        );
      }
    } finally {
      const ownsCapture = aiMethodReferenceAbortRef.current === controller;
      if (ownsCapture) {
        aiMethodReferenceAbortRef.current = null;
        captureInFlightRef.current = false;
      }
      if (ownsCapture && componentActiveRef.current) {
        setCaptureBackgroundSnapshot(null);
        setLineArtPreview(previousLineArtPreview);
        setIsCapturing(false);
      }
    }
  }
  h.handleUseAsAiMethodReference = handleUseAsAiMethodReference;
}
