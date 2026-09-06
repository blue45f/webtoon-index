/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function attachStudioBg3dEditorMeasureHost(h) {
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
    measurementDisabledReason, focusSelectionDisabledReason, physicsSelectionUnavailableReason,
    filteredLayerItems, ltLineSettings, ltToneSettings, hasFilledOutput, appliedLtPreset,
    appliedLtPresetId, appliedMoodRig, managedLtUserPreset, ltExportAspectRatio,
    ltCaptureSafeFrame, ltCaptureSizePreview, ltDocumentAspectPreset, ltCaptureAspectPresets,
    ltCaptureAspectPresetId, ltCaptureAspectLabel, hideOnTab, cancelPhysicsAnimationFrame,
    updatePhysicsProgress, restorePhysicsInitialPose, resetPhysicsPreview, failPhysicsPreview,
    physicsPlaybackFrame, startPhysicsPlayback, pausePhysicsPreview, resumePhysicsPreview,
    startPhysicsPreview, handleStartPhysicsPreview, bakePhysicsPreview, runBabylonDiagnostic,
    pausePhysicsWhenHidden, immersiveSceneActive, immersiveTransitionActive,
    effectiveIsQuadView, mainViewTrackRef, bg3dFrameLoop, isMainOrtho, currentFocalLengthMm,
    sunLightState, selectedSky, panoramaRotation, renderedSkyPresetId, fogNear, fogFar,
    fogSliderMax, selectSceneEntity, updateModelCloneStatuses, primitiveById, customModelById,
    batchCandidatesByModelId, batchedNodeIds, renderSceneEntity, sharedCharacterSceneContent,
    shadowSceneBounds, shadowMapSize, keyShadowFit, fillShadowFit, webXrDisabledReason,
    startStudioBg3dWebXr, endStudioBg3dWebXr, sceneContent, mainCameraNearClip, mainCameraUp,
    applyLensShift, mainCameraNode, immersiveCameraNode, mainScenePresentationNode,
    commonOrbitControls, commitSharedCharacterTransform, effectiveSelectedSharedCharacter,
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
    measurementDocument, measurementDraft, measurementLockedLengthMeters, measurementStartWorld, setMeasurementDraft, setMeasurementInference, setMeasurementLockedLengthMeters, setMeasurementStartWorld,
  } = { ...R, ...h };

  function cancelMeasurement(message = "줄자를 켠 뒤 첫 번째 점을 선택하세요."): void {
    measurementActiveRef.current = false;
    setMeasurementActive(false);
    setMeasurementStartWorld(null);
    setMeasurementDraft(null);
    setMeasurementInference(null);
    setMeasurementStatus(message);
  }
  h.cancelMeasurement = cancelMeasurement;
  function measurementInferenceReferences(): StudioBg3dMeasurementInferenceReference[] {
    const references: StudioBg3dMeasurementInferenceReference[] = [];
    for (const guide of measurementDocument.guides) {
      if (references.length >= STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES) break;
      const resolved = resolveStudioBg3dMeasurementGuide(guide, measurementDocument.unit);
      const direction = resolved.ok
        ? resolved.resolved.measurement.directionWorld
        : null;
      if (!direction) continue;
      references.push({ id: guide.id, directionWorld: direction });
    }
    return references;
  }
  h.measurementInferenceReferences = measurementInferenceReferences;
  function resolveMeasurementCandidate(
    point: StudioBg3dMeasurementVec3,
    lockedLengthMeters = measurementLockedLengthMeters,
  ): {
    readonly measurement: StudioBg3dWorldMeasurement;
    readonly inference: StudioBg3dMeasurementInferenceSuccess | null;
  } | null {
    if (!measurementStartWorld) return null;
    const measured = lockedLengthMeters === null
      ? measureStudioBg3dWorldPoints(measurementStartWorld, point)
      : lockStudioBg3dMeasurementLength({
          startWorld: measurementStartWorld,
          proposedEndWorld: point,
          lockedLengthMeters,
          fallbackDirectionWorld: measurementDraft?.directionWorld ?? [1, 0, 0],
        });
    if (!measured.ok) {
      setMeasurementStatus(measured.message);
      return null;
    }
    const measurement = measured.measurement;
    const inferred = classifyStudioBg3dMeasurementInference({
      startWorld: measurement.startWorld,
      endWorld: measurement.endWorld,
      references: measurementInferenceReferences(),
    });
    return {
      measurement,
      inference: inferred.ok ? inferred : null,
    };
  }
  h.resolveMeasurementCandidate = resolveMeasurementCandidate;
  function updateMeasurementPreview(point: StudioBg3dMeasurementVec3): void {
    if (!measurementActiveRef.current || !measurementStartWorld) return;
    const candidate = resolveMeasurementCandidate(point);
    if (!candidate) return;
    setMeasurementDraft(candidate.measurement);
    setMeasurementInference(candidate.inference);
    const label = formatStudioBg3dMeasurementLength(
      candidate.measurement.distanceMeters,
      measurementDocument.unit,
    );
    setMeasurementStatus(
      `${label ?? "측정 중"} · 두 번째 점을 클릭해 확정하세요.`,
    );
  }
  h.updateMeasurementPreview = updateMeasurementPreview;
  function pickMeasurementPoint(point: StudioBg3dMeasurementVec3): void {
    if (!measurementActiveRef.current) return;
    if (!measurementStartWorld) {
      setMeasurementStartWorld(point);
      setMeasurementDraft(null);
      setMeasurementInference(null);
      setMeasurementStatus("시작점을 잡았습니다. 두 번째 점을 움직여 거리와 방향을 확인하세요.");
      return;
    }
    const candidate = resolveMeasurementCandidate(point);
    if (!candidate) return;
    measurementActiveRef.current = false;
    setMeasurementActive(false);
    setMeasurementDraft(candidate.measurement);
    setMeasurementInference(candidate.inference);
    const label = formatStudioBg3dMeasurementLength(
      candidate.measurement.distanceMeters,
      measurementDocument.unit,
    );
    setMeasurementStatus(
      `${label ?? "측정"} 확정 · 길이를 잠그거나 영구 가이드로 고정할 수 있습니다.`,
    );
  }
  h.pickMeasurementPoint = pickMeasurementPoint;
  function handleMeasurementSurfacePreview(event: ThreeEvent<PointerEvent>): void {
    if (!measurementActiveRef.current || !measurementStartWorld) return;
    const point = readStudioBg3dMeasurementPointFromThreeEvent(event);
    if (point) updateMeasurementPreview(point);
  }
  h.handleMeasurementSurfacePreview = handleMeasurementSurfacePreview;
  function handleMeasurementLengthLockChange(lockedLengthMeters: number | null): void {
    setMeasurementLockedLengthMeters(lockedLengthMeters);
    if (lockedLengthMeters === null || !measurementStartWorld || !measurementDraft) return;
    const candidate = resolveMeasurementCandidate(
      measurementDraft.endWorld,
      lockedLengthMeters,
    );
    if (!candidate) return;
    setMeasurementDraft(candidate.measurement);
    setMeasurementInference(candidate.inference);
    const label = formatStudioBg3dMeasurementLength(
      candidate.measurement.distanceMeters,
      measurementDocument.unit,
    );
    setMeasurementStatus(`${label ?? "측정"} 길이를 정확히 잠갔습니다.`);
  }
  h.handleMeasurementLengthLockChange = handleMeasurementLengthLockChange;
  function toggleMeasurement(): void {
    if (measurementActiveRef.current) {
      cancelMeasurement("줄자 측정을 취소했습니다.");
      return;
    }
    if (measurementDisabledReason) {
      setMeasurementStatus(measurementDisabledReason);
      return;
    }
    if (surfaceSnapArmedRef.current) cancelSurfaceSnap();
    measurementActiveRef.current = true;
    setMeasurementActive(true);
    setMeasurementStartWorld(null);
    setMeasurementDraft(null);
    setMeasurementInference(null);
    setMeasurementStatus("첫 번째 점을 선택하세요. 객체 표면과 바닥을 모두 찍을 수 있습니다.");
    handlePanelTabChange("view");
    setError(null);
  }
  h.toggleMeasurement = toggleMeasurement;
  function toggleSurfaceSnap(): void {
    if (surfaceSnapArmedRef.current) {
      cancelSurfaceSnap("표면 붙이기를 취소했습니다.");
      return;
    }
    if (measurementActiveRef.current) {
      cancelMeasurement("표면 붙이기로 전환해 줄자 측정을 취소했습니다.");
    }
    if (surfaceSnapDisabledReason) {
      setSurfaceSnapStatus({ tone: "error", message: surfaceSnapDisabledReason });
      return;
    }
    surfaceSnapArmedRef.current = true;
    setSurfaceSnapArmed(true);
    setSurfaceSnapStatus({
      tone: "info",
      message: "붙일 표면을 클릭하세요. 선택은 유지되며 Esc로 취소할 수 있습니다.",
    });
    setError(null);
  }
  h.toggleSurfaceSnap = toggleSurfaceSnap;
  function handleSurfaceSnapPick(
    targetId: string,
    event: ThreeEvent<MouseEvent>,
  ): boolean {
    if (measurementActiveRef.current) {
      const point = readStudioBg3dMeasurementPointFromThreeEvent(event);
      if (point) pickMeasurementPoint(point);
      else setMeasurementStatus("클릭한 표면의 안전한 world 좌표를 읽지 못했습니다.");
      return true;
    }
    if (!surfaceSnapArmedRef.current) return false;
    if (surfaceSnapDisabledReason || selectedEntities.length === 0) {
      cancelSurfaceSnap();
      setSurfaceSnapStatus({
        tone: "error",
        message: surfaceSnapDisabledReason ?? "표면 붙이기 상태가 만료되어 다시 시작해야 합니다.",
      });
      return true;
    }
    if (!effectivelyVisibleLayerIds.has(targetId)) {
      setSurfaceSnapStatus({ tone: "error", message: "숨겨진 객체의 표면에는 붙일 수 없습니다." });
      return true;
    }

    const worldHit = readStudioBg3dWorldSurfaceHit(event);
    const targetPathIds = collectStudioBg3dSurfaceTargetPathIds(
      targetId,
      sceneHierarchy.parentById,
    );
    if (!worldHit || !targetPathIds) {
      setSurfaceSnapStatus({
        tone: "error",
        message: "클릭한 표면의 위치·법선 또는 객체 계층을 확인하지 못했습니다. 다른 면을 클릭해 주세요.",
      });
      return true;
    }

    // Multi-select: shared hit normal/point; each object keeps individual world bounds + subtree.
    // Single-select still goes through planStudioBg3dMultiSurfaceSnap (1 input) for one code path.
    const snapInputs: ResolveStudioBg3dSurfaceSnapInput[] = [];
    const snapEntities: Array<BgPrimitive | BgCustomModelInstance> = [];
    for (const entity of selectedEntities) {
      if (snapInputs.length >= STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS) break;
      const selectionObject = primitiveObjectsRef.current.get(entity.id);
      const worldBounds = readStudioBg3dObjectWorldBounds(selectionObject);
      const selectionSubtreeIds = collectStudioBg3dSurfaceSelectionSubtreeIds(
        entity.id,
        sceneHierarchy.childrenByParent,
      );
      selectionObject?.parent?.updateWorldMatrix(true, false);
      if (!selectionObject || !worldBounds || !selectionSubtreeIds) continue;
      snapEntities.push(entity);
      snapInputs.push({
        // Per-object single-selection contract required by resolveStudioBg3dSurfaceSnap.
        selectedIds: [entity.id],
        selectionId: entity.id,
        selectionSubtreeIds,
        locked: isBgObjectTransformBlocked(entity),
        localPosition: entity.position,
        rotation: entity.rotation,
        worldBounds,
        ...(selectionObject.parent
          ? { parentWorldMatrix: [...selectionObject.parent.matrixWorld.elements] }
          : {}),
        hit: {
          targetPathIds,
          point: worldHit.point,
          normal: worldHit.normal,
        },
        surfaceOffset: 0.01,
        alignRotationToNormal: surfaceSnapAlignNormal,
      });
    }

    if (snapInputs.length === 0) {
      setSurfaceSnapStatus({
        tone: "error",
        message: "선택한 객체의 지오메트리를 준비하지 못했습니다. 준비가 끝난 뒤 다시 시도해 주세요.",
      });
      return true;
    }

    const plan = planStudioBg3dMultiSurfaceSnap(snapInputs);
    if (!plan.ok) {
      const firstReason = plan.results?.find((result) => !result.ok && "reason" in result);
      const reason = firstReason && !firstReason.ok ? firstReason.reason : plan.reason;
      setSurfaceSnapStatus({
        tone: "error",
        message: reason === "self-hit"
          ? "선택한 객체나 그 자식 표면에는 붙일 수 없습니다. 다른 객체의 면을 클릭해 주세요."
          : "이 표면에는 객체를 안전하게 배치할 수 없습니다. 다른 면을 클릭해 주세요.",
      });
      return true;
    }

    const positionById = new Map<string, [number, number, number]>();
    const rotationById = new Map<string, [number, number, number]>();
    let successCount = 0;
    let selfHitCount = 0;
    let lockedCount = 0;
    for (let index = 0; index < plan.results.length; index += 1) {
      const result = plan.results[index]!;
      const entity = snapEntities[index];
      if (!entity) continue;
      if (!result.ok) {
        if (result.reason === "self-hit") selfHitCount += 1;
        if (result.reason === "locked") lockedCount += 1;
        continue;
      }
      successCount += 1;
      positionById.set(entity.id, [...result.localPosition] as [number, number, number]);
      if (surfaceSnapAlignNormal) {
        rotationById.set(entity.id, [...result.rotation] as [number, number, number]);
      }
    }

    if (successCount === 0) {
      setSurfaceSnapStatus({
        tone: "error",
        message: selfHitCount > 0
          ? "선택한 객체나 그 자식 표면에는 붙일 수 없습니다. 다른 객체의 면을 클릭해 주세요."
          : lockedCount > 0
            ? "선택한 객체의 잠금을 먼저 해제해 주세요."
            : "이 표면에는 객체를 안전하게 배치할 수 없습니다. 다른 면을 클릭해 주세요.",
      });
      return true;
    }

    const nextPrimitives = primitives.map((primitive) => {
      const nextPosition = positionById.get(primitive.id);
      if (!nextPosition) return primitive;
      const nextRotation = rotationById.get(primitive.id);
      return {
        ...primitive,
        position: nextPosition,
        ...(nextRotation ? { rotation: nextRotation } : {}),
      };
    });
    const nextCustomModels = customModels.map((model) => {
      const nextPosition = positionById.get(model.id);
      if (!nextPosition) return model;
      const nextRotation = rotationById.get(model.id);
      return {
        ...model,
        position: nextPosition,
        ...(nextRotation ? { rotation: nextRotation } : {}),
      };
    });
    surfaceSnapArmedRef.current = false;
    setSurfaceSnapArmed(false);
    commitImmediateHistoryTransition(nextPrimitives, nextCustomModels, sceneBaseDocument);
    setPrimitives(nextPrimitives);
    setCustomModels(nextCustomModels);
    const failedCount = snapInputs.length - successCount;
    const multi = snapInputs.length > 1;
    setSurfaceSnapStatus({
      tone: "success",
      message: multi
        ? surfaceSnapAlignNormal
          ? `${successCount}개 객체를 표면에 붙이고 법선에 맞춰 회전했어요.${failedCount > 0 ? ` (${failedCount}개는 건너뜀)` : ""}`
          : `${successCount}개 객체를 클릭한 표면에 붙였습니다.${failedCount > 0 ? ` (${failedCount}개는 건너뜀)` : ""}`
        : surfaceSnapAlignNormal
          ? "표면에 붙이고 법선에 맞춰 회전했어요."
          : "선택한 객체를 클릭한 표면에 붙였습니다. 회전은 그대로 유지했습니다.",
    });
    setError(null);
    return true;
  }
  h.handleSurfaceSnapPick = handleSurfaceSnapPick;
}
