/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function attachStudioBg3dEditorInsertHost(h) {
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
    STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH, applyStudioBg3dLtPreset,
    STUDIO_BG3D_LT_RENDER_MAX_PIXELS, renderStudioBg3dLtLayersInWorker,
    buildStudioBg3dMagicFilterMask,
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
    deviceQuality, engineRuntime, hasCloneFailure, hasPendingClone, hasPendingSharedCharacter,
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
    handleUseAsAiMethodReference, firstSelectedId, selectedPrimitive, selectedCustomModel,
    selectedEntity, selectedModelCacheEntry, selectedSemanticMaterials,
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
    setCaptureBackgroundSnapshot, sharedStageUpdateBlockedReason,
  } = { ...R, ...h };

  async function handleInsert() {
    if (
      captureInFlightRef.current || isCapturing ||
      destructiveMutationGuardRef.current.blocksClose
    ) return;
    if (isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)) {
      setError("물리 미리보기를 초기화하거나 현재 자세를 적용한 뒤 3D 배경을 추가하세요.");
      return;
    }
    if (sharedStageUpdateBlockedReason) {
      setError(sharedStageUpdateBlockedReason);
      return;
    }
    if (insertBlocked) {
      setError(
        hasUnavailableSharedCharacter
          ? "연결된 3D 캐릭터 중 불러오지 못한 모델이 있어 합성을 중단했어요. 캐릭터 레이어의 모델 파일을 확인해 주세요."
          : hasPendingSharedCharacter
            ? "연결된 3D 캐릭터를 모두 불러온 뒤 합성할 수 있어요."
            : "3D 장면 복원과 모델 렌더 준비를 모두 마친 뒤 추가할 수 있습니다.",
      );
      return;
    }
    if (!insertBackgroundIntent.ok) {
      setError(insertBackgroundIntent.reason);
      return;
    }
    const currentCapture = captureRef.current;
    if (!currentCapture.adapter) {
      setError("캡처할 3D 장면이 아직 준비되지 않았습니다.");
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
      setError("현재 장면이 안전 예산을 초과해 추가를 시작하지 않았습니다. 장면을 나누거나 일부 오브젝트를 정리해 주세요.");
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
      setError("장면 원본을 손실 없이 저장할 수 없어 추가를 중단했습니다. 문제가 있는 도형이나 모델을 확인해 주세요.");
      return;
    }
    const sharedCharacterAuthorityResult = acquireSharedCharacterCaptureAuthority();
    if (!sharedCharacterAuthorityResult?.ok) {
      setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
      return;
    }
    const sharedCharacterAuthorityLease = sharedCharacterAuthorityResult.lease;

    let magicSelectionSnapshot: StudioBg3dMagicSelectionSnapshot | null = null;
    if (magicLayerEnabled) {
      const compatibilityMessage =
        studioBg3dMagicCaptureCompatibilityMessage(adapted.document);
      if (compatibilityMessage) {
        setError(compatibilityMessage);
        return;
      }
      const magicSelection = resolveStudioBg3dMagicSelection({
        operation,
        document: adapted.document,
        selectedIds: Object.freeze([...selectedIds]),
      });
      if (!magicSelection.ok) {
        setError(magicSelection.message);
        return;
      }
      magicSelectionSnapshot = magicSelection.snapshot;
    }

    const ltSettingsSnapshot: StudioBg3dLtRenderSettings = Object.freeze({
      line: Object.freeze({ ...adapted.document.output.line }),
      tone: Object.freeze({ ...adapted.document.output.tone }),
    });
    ltInsertAbortRef.current?.abort();
    const insertController = new AbortController();
    ltInsertAbortRef.current = insertController;
    const insertSceneEpoch = ltInsertSceneEpochRef.current;
    const magicSelectionEpoch = ltMagicSelectionEpochRef.current;
    const isInsertCurrent = () => (
      !insertController.signal.aborted &&
      ltInsertAbortRef.current === insertController &&
      ltInsertSceneEpochRef.current === insertSceneEpoch &&
      (
        magicSelectionSnapshot === null ||
        (
          ltMagicSelectionEpochRef.current === magicSelectionEpoch &&
          selectedIdsRef.current.size === 1 &&
          selectedIdsRef.current.has(magicSelectionSnapshot.selectedId)
        )
      ) &&
      isModalAssetSessionCurrent(session)
    );

    // LT 검출은 깨끗한 셰이딩 캡처를 입력으로 삼는다. 캡처 중에는 그리드·변환 핸들·프리미티브의
    // 뷰포트용 edge overlay를 숨기고, 순수 래스터 단계가 주선·재질선·톤을 독립적으로 계산한다.
    const previousLineArtPreview = lineArtPreview;
    ltInsertRestoreLineArtPreviewRef.current = previousLineArtPreview;
    captureInFlightRef.current = true;
    setCaptureBackgroundSnapshot(backgroundSnapshot);
    setLineArtPreview(false);
    setIsCapturing(true);
    let insertPhase:
      | "lt"
      | "magic-object-id"
      | "magic-png"
      | "lt-encode"
      | "commit" = "lt";
    try {
      // React/R3F가 캡처 전용 visibility와 셰이딩 상태를 반영할 시간을 보장한다.
      const captureAdapter = await acquireStudioBg3dCaptureAdapterAfterViewTransition({
        isActive: isInsertCurrent,
        readAdapter: () => captureRef.current.adapter,
        waitForPaintFrame: waitForStudioBg3dPaintFrame,
        signal: insertController.signal,
        timeoutMs: 15_000,
      });
      if (!captureAdapter) {
        if (isInsertCurrent()) {
          setError("캡처할 단일 3D 시점을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        }
        return;
      }
      const captureAdapterIsStale = () => captureRef.current.adapter !== captureAdapter;

      const sourceSize = await getStudioBg3dCaptureSourceSize(captureAdapter);
      if (!isInsertCurrent() || captureAdapterIsStale()) return;
      // The document owns capture aspect; legacy documents retain the full viewport ratio.
      const captureFrame = resolveStudioBg3dCaptureFrame({
        viewportWidth: sourceSize.width,
        viewportHeight: sourceSize.height,
        aspectRatio: adapted.document.output.exportAspectRatio ?? null,
      });
      if (!captureFrame) {
        throw new Error("LT capture frame admission failed.");
      }
      // Clamp DPR to 1..3; the size resolver enforces pixel and 4096-edge budgets.
      const captureDensity = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
      const captureSize = resolveStudioBg3dLtCaptureSize({
        sourceWidth: sourceSize.width,
        sourceHeight: sourceSize.height,
        aspectRatio: captureFrame.aspectRatio,
        requestedHeight: Math.min(
          4096,
          Math.round(adapted.document.output.exportHeight * captureDensity)
        ),
        maxPixels: Math.min(deviceQuality.maxRenderPixels, STUDIO_BG3D_LT_RENDER_MAX_PIXELS),
      });
      if (!captureSize) {
        throw new Error("LT capture size admission failed.");
      }
      const rasterAuthority = verifySharedCharacterCaptureAuthority(
        sharedCharacterAuthorityLease,
        "raster",
      );
      if (!rasterAuthority?.ok) {
        setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
        return;
      }
      const captureFrameCameraSettings =
        resolveStudioBg3dCaptureFrameCameraSettings(
          adapted.document.camera,
          captureFrame,
        );
      // Apply a camera view offset only for crop frames and fail closed if it cannot be acquired.
      const releaseCaptureFrameViewOffset = applyStudioBg3dCaptureFrameViewOffset(
        captureRef.current.adapter === captureAdapter ? captureRef.current.camera : null,
        captureFrame,
        sourceSize,
      );
      if (!releaseCaptureFrameViewOffset) {
        throw new Error("LT capture frame could not be applied to the live camera.");
      }
      const captured = await captureStudioBg3dRaster(captureAdapter, {
        width: captureSize.width,
        height: captureSize.height,
        background: studioBg3dCaptureBackgroundRequestFromSnapshot(backgroundSnapshot),
        includeDepth: ltSettingsSnapshot.line.depthEnabled,
      }, { signal: insertController.signal, timeoutMs: 30_000 })
        // 성공·실패·취소 어느 쪽이든 라이브 카메라를 원래 view 창으로 되돌린다(멱등).
        .finally(releaseCaptureFrameViewOffset);
      if (!isInsertCurrent() || captureAdapterIsStale()) return;
      const ltRenderInput = Object.freeze({
        width: captured.width,
        height: captured.height,
        rgba: captured.rgba,
        ...(captured.depth ? { depth: captured.depth } : {}),
      });
      const rendered = await renderStudioBg3dLtLayersInWorker(
        ltRenderInput,
        ltSettingsSnapshot,
        {
          signal: insertController.signal,
          timeoutMs: STUDIO_BG3D_LT_INSERT_WORKER_TIMEOUT_MS,
        },
      );
      if (!isInsertCurrent() || captureAdapterIsStale()) return;
      if (rendered.layers.length === 0) {
        setError("현재 LT 설정에서는 보이는 선화나 톤이 만들어지지 않습니다. 선화 또는 톤을 켜 주세요.");
        return;
      }
      if (
        magicSelectionSnapshot &&
        !rendered.layers.some((layer) => layer.role === "color" || layer.role === "tone")
      ) {
        setError("매직 마스크를 붙일 컬러 또는 톤 베이스 레이어가 만들어지지 않았어요. 베이스 출력을 켜고 다시 시도해 주세요.");
        return;
      }

      let magicFilterMask: StudioBackground3DInsertResult["magicFilterMask"];
      if (magicSelectionSnapshot) {
        insertPhase = "magic-object-id";
        const magicCaptureDocument = normalizeStudioBg3dSceneDocument({
          ...adapted.document,
          camera: captureFrameCameraSettings,
        });
        const magicCompatibilityMessage =
          studioBg3dMagicCaptureCompatibilityMessage(magicCaptureDocument);
        if (magicCompatibilityMessage) {
          setError(magicCompatibilityMessage);
          return;
        }
        const magicRuntimeSnapshot = createStudioBg3dRuntimeSnapshot(
          magicCaptureDocument,
          new Map(),
        );
        const babylonEntry = await loadStudioBg3dBabylonSpecialistEntry();
        if (!isInsertCurrent() || captureAdapterIsStale()) return;
        // Magic is a shipped product capture, not a cross-engine diagnostic. It must use exactly
        // the backend the artist selected for BG3D; failure remains visible instead of silently
        // changing the pixels to an independently configured engine.
        const magicBackends: readonly StudioBg3dMagicBabylonBackend[] = [
          engineRuntime.preference,
        ];
        ltMagicCaptureGenerationRef.current += 1;
        const objectIdCapture = await captureStudioBg3dMagicObjectIds({
          snapshot: magicRuntimeSnapshot,
          width: rendered.width,
          height: rendered.height,
          jobId: `magic-${insertSceneEpoch}-${ltMagicCaptureGenerationRef.current}`,
          backends: magicBackends,
          createCanvas: () => document.createElement("canvas"),
          createRuntime: ({ backend, canvas, capabilities, settings }) => {
            if (!(canvas instanceof HTMLCanvasElement)) {
              throw new Error("Magic Layer canvas owner is unavailable.");
            }
            if (capabilities !== STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES) {
              throw new Error("Magic Layer runtime capabilities changed unexpectedly.");
            }
            return babylonEntry.createStudioBg3dBabylonSpecialist({
              canvas,
              backend,
              capabilities,
              settings,
            });
          },
          signal: insertController.signal,
        });
        if (!isInsertCurrent() || captureAdapterIsStale()) return;
        const magicMask = buildStudioBg3dMagicFilterMask({
          width: objectIdCapture.width,
          height: objectIdCapture.height,
          objectIds: objectIdCapture.objectIds,
          legend: objectIdCapture.legend,
          selectedId: magicSelectionSnapshot.selectedId,
        });
        if (magicMask.selectedStableId !== magicSelectionSnapshot.stableId) {
          throw new Error("Magic Layer stable object identity changed.");
        }
        insertPhase = "magic-png";
        const magicMaskPngDataUrl = await encodeStudioBg3dMagicMaskPngDataUrl({
          width: magicMask.width,
          height: magicMask.height,
          data: magicMask.data,
        }, {
          signal: insertController.signal,
          timeoutMs: STUDIO_BG3D_LT_INSERT_WORKER_TIMEOUT_MS,
        });
        if (!isInsertCurrent() || captureAdapterIsStale()) return;
        magicFilterMask = Object.freeze({
          pngDataUrl: magicMaskPngDataUrl,
          width: magicMask.width,
          height: magicMask.height,
          selectedObjectStableId: magicMask.selectedStableId,
        });
      }

      insertPhase = "lt-encode";
      const encoded = encodeStudioBg3dLtLayers(rendered.layers);
      if (!isInsertCurrent() || captureAdapterIsStale()) return;
      // 소실점도 캡처 프레임 기준이어야 한다. 중앙 크롭은 NDC 선형 확대라 카메라 설정을 프레임
      // 배율로 환산하면 잘린 래스터 좌표계에서 렌더러와 정확히 같은 위치가 나온다.
      const perspectiveGuides = deriveStudioBg3dVanishingPoints(
        captureFrameCameraSettings,
        rendered.width,
        rendered.height,
      ).map((point) => ({
        axis: point.axis,
        x: point.x / rendered.width,
        y: point.y / rendered.height,
      }));
      if (!isInsertCurrent() || captureAdapterIsStale()) return;
      const receiptAuthority = verifySharedCharacterCaptureAuthority(
        sharedCharacterAuthorityLease,
        "receipt",
      );
      if (!receiptAuthority?.ok) {
        setError(SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE);
        return;
      }
      insertPhase = "commit";
      setSceneBaseDocument(adapted.document);
      const linkedCharacterCapture = createStudioBg3dLinkedCharacterCapture(
        receiptAuthority.captureElementIds,
        sharedCharacters,
      );
      const accepted = await onInsert({
        kind: "separated",
        width: rendered.width,
        height: rendered.height,
        layers: encoded.layers,
        compositePngDataUrl: encoded.compositePngDataUrl,
        perspectiveGuides,
        ...(magicFilterMask ? { magicFilterMask } : {}),
        ...(linkedCharacterCapture ? { linkedCharacterCapture } : {}),
        sharedStageMutation: { kind: sharedStageMutationKind },
        materialization: { kind: sharedStageMaterializationKind },
        bg3dScene: adapted.document,
      });
      if (accepted === false) {
        setError(
          "편집 문서가 변경되었거나 현재 페이지에 삽입할 수 없습니다. 3D 창을 닫고 페이지 잠금·선택 상태를 확인한 뒤 다시 열어 주세요."
        );
        return;
      }
      if (
        ltInsertAbortRef.current === insertController &&
        modalAssetSessionRef.current === session &&
        studioBg3dModalOperationCoordinator.isCurrent(session)
      ) {
        ltInsertAbortRef.current = null;
        ltInsertRestoreLineArtPreviewRef.current = null;
        captureInFlightRef.current = false;
        setCaptureBackgroundSnapshot(null);
        setLineArtPreview(previousLineArtPreview);
        setIsCapturing(false);
      }
      invalidateModalAssetSession();
      onClose();
    } catch (insertFailure) {
      const cancelled = insertController.signal.aborted ||
        (insertFailure instanceof Error && insertFailure.name === "AbortError");
      if (cancelled) {
        const supersededByNewInsert = ltInsertAbortRef.current !== null &&
          ltInsertAbortRef.current !== insertController;
        if (!supersededByNewInsert && isModalAssetSessionCurrent(session)) {
          setError("장면·선택 또는 출력 설정이 변경되어 LT 변환을 취소했습니다. 최신 상태에서 다시 추가해 주세요.");
        }
        return;
      }
      if (!isInsertCurrent()) return;
      if (insertPhase === "magic-object-id") {
        setError(
          "선택 객체를 같은 프레임에서 안전하게 분리하지 못했습니다. 원근 카메라·단색 배경·선택 상태를 확인하고 다시 시도해 주세요.",
        );
      } else if (insertPhase === "magic-png") {
        setError(
          "선택 객체 마스크를 안전한 PNG로 만들지 못했습니다. 출력 해상도를 낮추거나 브라우저 그래픽 상태를 확인해 주세요.",
        );
      } else if (insertFailure instanceof StudioBg3dLtRenderWorkerError) {
        setError(
          insertFailure.code === "worker-unavailable"
            ? "이 브라우저에서 LT 백그라운드 작업을 시작할 수 없고 현재 출력은 안전한 즉시 변환 한도를 넘습니다. 출력 해상도를 낮춰 다시 시도해 주세요."
            : insertFailure.code === "timeout"
              ? "LT 변환 시간이 제한을 초과했습니다. 출력 해상도나 선화 정밀도를 낮춰 다시 시도해 주세요."
              : "LT 처리 작업을 안전하게 완료하지 못했습니다. 잠시 후 다시 시도하거나 출력 해상도를 낮춰 주세요.",
        );
      } else if (insertFailure instanceof Error && insertFailure.name === "TimeoutError") {
        setError("3D 장면 캡처 시간이 제한을 초과했습니다. 출력 해상도를 낮추고 다시 시도해 주세요.");
      } else {
        setError("3D 장면을 LT 레이어로 변환하지 못했습니다. 출력 해상도와 브라우저 그래픽 상태를 확인해 주세요.");
      }
    } finally {
      const ownsCurrentInsert =
        ltInsertAbortRef.current === insertController &&
        modalAssetSessionRef.current === session &&
        studioBg3dModalOperationCoordinator.isCurrent(session);
      if (ownsCurrentInsert) {
        ltInsertAbortRef.current = null;
        ltInsertRestoreLineArtPreviewRef.current = null;
        captureInFlightRef.current = false;
      }
      if (ownsCurrentInsert && componentActiveRef.current) {
        setCaptureBackgroundSnapshot(null);
        setLineArtPreview(previousLineArtPreview);
        setIsCapturing(false);
      }
    }
  }
  h.handleInsert = handleInsert;
  // 선택된 것이 도형(primitives)인지 커스텀 모델(customModels)인지는 배타적이다 — 둘 다 같은
  // selectedId/primitiveObjectsRef를 공유하므로(§4) "primitives에 있으면 도형, 아니면 모델"로 분기한다.

}
