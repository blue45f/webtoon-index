/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function attachStudioBg3dEditorPhysicsHost(h) {
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
    shotBatchBlockedReason, commitImmediateHistoryTransition, doUndo, doRedo,
    canAdmitSceneNodes, addPrimitive, addComposite, proceduralStarterDisabledReason,
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
    ltCaptureAspectPresets, ltCaptureAspectPresetId, ltCaptureAspectLabel, runBabylonDiagnostic,
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
    physicsGravityPreset,
  } = { ...R, ...h };

  const transitionPhysicsPhase = (next: StudioBg3dPhysicsPhase) => {
    physicsPhaseRef.current = next;
    setPhysicsPhase(next);
  };
  h.transitionPhysicsPhase = transitionPhysicsPhase;
  const hideOnTab = (tab: BgPanelTab) => activePanelTab !== tab;

  h.hideOnTab = hideOnTab;
  const cancelPhysicsAnimationFrame = () => {
    if (physicsAnimationFrameRef.current === null) return;
    cancelAnimationFrame(physicsAnimationFrameRef.current);
    physicsAnimationFrameRef.current = null;
  };
  h.cancelPhysicsAnimationFrame = cancelPhysicsAnimationFrame;
  const updatePhysicsProgress = (
    currentSeconds: number,
    durationSeconds: number,
    timestamp: number,
    force = false,
  ) => {
    if (!force && timestamp - physicsLastUiUpdateRef.current < 100) return;
    physicsLastUiUpdateRef.current = timestamp;
    setPhysicsCurrentSeconds(currentSeconds);
    setPhysicsProgress(durationSeconds > 0 ? currentSeconds / durationSeconds : 0);
    setPhysicsPreviewRevision((revision) => revision + 1);
  };
  h.updatePhysicsProgress = updatePhysicsProgress;
  const restorePhysicsInitialPose = (session = physicsSessionRef.current) => {
    if (!session || session.initialDynamicSamples.length === 0) return;
    projectStudioBg3dPhysicsSamples(session.initialDynamicSamples, primitiveObjectsRef.current);
  };
  h.restorePhysicsInitialPose = restorePhysicsInitialPose;
  const resetPhysicsPreview = (options: { readonly keepError?: boolean } = {}) => {
    physicsGenerationRef.current += 1;
    physicsAbortRef.current?.abort();
    physicsAbortRef.current = null;
    cancelPhysicsAnimationFrame();
    restorePhysicsInitialPose();
    physicsSessionRef.current = null;
    latestPhysicsSamplesRef.current = [];
    physicsPlaybackStartedAtRef.current = 0;
    physicsPlaybackOffsetRef.current = 0;
    physicsLastUiUpdateRef.current = 0;
    physicsLastFrameTimestampRef.current = 0;
    setPhysicsCurrentSeconds(0);
    setPhysicsProgress(0);
    setPhysicsPreviewRevision((revision) => revision + 1);
    if (!options.keepError) setPhysicsError(null);
    transitionPhysicsPhase(options.keepError ? "error" : "idle");
  };
  h.resetPhysicsPreview = resetPhysicsPreview;
  const failPhysicsPreview = (message: string) => {
    setPhysicsError(message);
    resetPhysicsPreview({ keepError: true });
  };
  h.failPhysicsPreview = failPhysicsPreview;
  const physicsPlaybackFrame = (timestamp: number) => {
    physicsAnimationFrameRef.current = null;
    if (physicsPhaseRef.current !== "running") return;
    const session = physicsSessionRef.current;
    if (!session) {
      failPhysicsPreview("물리 미리보기 세션을 복원하지 못했습니다. 다시 시도해 주세요.");
      return;
    }
    if (physicsPlaybackStartedAtRef.current < 0) physicsPlaybackStartedAtRef.current = timestamp;
    physicsLastFrameTimestampRef.current = timestamp;
    const elapsedSeconds = Math.max(0, (timestamp - physicsPlaybackStartedAtRef.current) / 1_000);
    const currentSeconds = Math.min(
      session.timeline.durationSeconds,
      physicsPlaybackOffsetRef.current + elapsedSeconds,
    );
    const samples = sampleStudioBg3dPhysicsTimeline(session.timeline, currentSeconds);
    if (!samples || !projectStudioBg3dPhysicsSamples(samples, primitiveObjectsRef.current)) {
      failPhysicsPreview("물리 결과를 현재 3D 오브젝트에 안전하게 표시하지 못했습니다.");
      return;
    }
    latestPhysicsSamplesRef.current = samples;
    updatePhysicsProgress(
      currentSeconds,
      session.timeline.durationSeconds,
      timestamp,
      currentSeconds >= session.timeline.durationSeconds,
    );
    if (currentSeconds >= session.timeline.durationSeconds) {
      physicsPlaybackOffsetRef.current = session.timeline.durationSeconds;
      transitionPhysicsPhase("complete");
      return;
    }
    physicsAnimationFrameRef.current = requestAnimationFrame(physicsPlaybackFrame);
  };
  h.physicsPlaybackFrame = physicsPlaybackFrame;
  const startPhysicsPlayback = (session: StudioBg3dPhysicsSession, offsetSeconds = 0) => {
    cancelPhysicsAnimationFrame();
    const safeOffset = Math.min(session.timeline.durationSeconds, Math.max(0, offsetSeconds));
    physicsPlaybackOffsetRef.current = safeOffset;
    physicsPlaybackStartedAtRef.current = -1;
    physicsLastUiUpdateRef.current = 0;
    transitionPhysicsPhase("running");
    physicsAnimationFrameRef.current = requestAnimationFrame(physicsPlaybackFrame);
  };
  h.startPhysicsPlayback = startPhysicsPlayback;
  const pausePhysicsPreview = () => {
    if (physicsPhaseRef.current !== "running") return;
    const session = physicsSessionRef.current;
    if (!session) return;
    const now = physicsLastFrameTimestampRef.current;
    physicsPlaybackOffsetRef.current = Math.min(
      session.timeline.durationSeconds,
      physicsPlaybackOffsetRef.current +
        Math.max(0, (now - physicsPlaybackStartedAtRef.current) / 1_000),
    );
    cancelPhysicsAnimationFrame();
    updatePhysicsProgress(
      physicsPlaybackOffsetRef.current,
      session.timeline.durationSeconds,
      now,
      true,
    );
    transitionPhysicsPhase("paused");
  };
  h.pausePhysicsPreview = pausePhysicsPreview;
  const resumePhysicsPreview = () => {
    const session = physicsSessionRef.current;
    if (!session || (physicsPhaseRef.current !== "paused" && physicsPhaseRef.current !== "complete")) {
      return;
    }
    const offset = physicsPhaseRef.current === "complete" ? 0 : physicsPlaybackOffsetRef.current;
    if (offset === 0) {
      const initial = sampleStudioBg3dPhysicsTimeline(session.timeline, 0);
      if (!initial || !projectStudioBg3dPhysicsSamples(initial, primitiveObjectsRef.current)) {
        failPhysicsPreview("물리 미리보기의 시작 자세를 복원하지 못했습니다.");
        return;
      }
      latestPhysicsSamplesRef.current = initial;
      updatePhysicsProgress(0, session.timeline.durationSeconds, physicsLastFrameTimestampRef.current, true);
    }
    startPhysicsPlayback(session, offset);
  };
  h.resumePhysicsPreview = resumePhysicsPreview;
  const startPhysicsPreview = async () => {
    if (
      captureInFlightRef.current || isCapturing || isRestoringScene ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) return;
    if (selectedIds.size === 0 || physicsSelectionUnavailableReason) {
      setPhysicsError(physicsSelectionUnavailableReason ?? "움직일 오브젝트를 먼저 선택하세요.");
      transitionPhysicsPhase("error");
      return;
    }

    const sourceToken = createStudioBg3dPhysicsSessionSourceToken({
      primitives,
      customModels,
      document: sceneBaseDocument,
    });
    if (!sourceToken) {
      setPhysicsError("현재 장면 상태를 물리 세션과 원자적으로 연결하지 못했습니다.");
      transitionPhysicsPhase("error");
      return;
    }

    const adaptation = tryAdaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels,
      attachmentByStorageModelId: attachmentByStorageModelIdRef.current,
      baseDocument: sceneBaseDocument,
    });
    if (!adaptation.ok) {
      setPhysicsError("현재 장면이 안전 예산을 초과해 물리 미리보기를 시작하지 않았습니다.");
      transitionPhysicsPhase("error");
      return;
    }
    const adapted = adaptation.value;
    if (
      adapted.diagnostics.length > 0 || adapted.omittedDiagnosticCount > 0 ||
      adapted.counts.droppedPrimitives > 0 || adapted.counts.droppedCustomModels > 0 ||
      adapted.counts.emittedPrimitives !== primitives.length ||
      adapted.counts.emittedCustomModels !== customModels.length
    ) {
      setPhysicsError("장면 원본을 손실 없이 준비하지 못해 물리 미리보기를 시작하지 않았습니다.");
      transitionPhysicsPhase("error");
      return;
    }
    const localWorld = createStudioBg3dPhysicsWorld(adapted.document, selectedIds);
    const modelLocalBoundsByNodeId = new Map(
      customModels.flatMap((model) => {
        const cachedRoot = modelRootCacheRef.current.get(model.modelId)?.root;
        const bounds = cachedRoot
          ? measureStudioBg3dPhysicsModelLocalBounds(cachedRoot)
          : null;
        return bounds ? [[model.id, bounds] as const] : [];
      }),
    );
    const physicsJob = localWorld
      ? createStudioBg3dPhysicsThreeJob(
          adapted.document,
          localWorld,
          modelLocalBoundsByNodeId,
        )
      : null;
    if (!physicsJob) {
      setPhysicsError("선택한 오브젝트의 계층·잠금·변형을 물리 장면으로 안전하게 변환하지 못했습니다.");
      transitionPhysicsPhase("error");
      return;
    }

    const generation = physicsGenerationRef.current + 1;
    physicsGenerationRef.current = generation;
    physicsAbortRef.current?.abort();
    const abortController = new AbortController();
    physicsAbortRef.current = abortController;
    physicsSessionRef.current = null;
    latestPhysicsSamplesRef.current = [];
    setPhysicsError(null);
    setError(null);
    setPhysicsCurrentSeconds(0);
    setPhysicsProgress(0);
    transitionPhysicsPhase("loading");

    try {
      // Literal import keeps Rapier, its Worker, and WASM outside the 3D editor's initial chunk.
      const {
        createStudioBg3dPhysicsTimelineWorkerSession,
      } = await import("./studio-bg3d-physics-worker-client");
      if (
        abortController.signal.aborted || generation !== physicsGenerationRef.current ||
        !componentActiveRef.current
      ) return;
      const workerSession = physicsWorkerSessionRef.current ??
        createStudioBg3dPhysicsTimelineWorkerSession();
      physicsWorkerSessionRef.current = workerSession;
      const timeline = await workerSession.run({
        world: physicsJob.world,
        initialPoses: physicsJob.initialPoses,
        durationSeconds: physicsDurationSeconds,
        gravity: STUDIO_BG3D_PHYSICS_GRAVITY[physicsGravityPreset],
        ground: physicsGroundEnabled
          ? { y: 0, friction: 0.75, restitution: 0.08 }
          : null,
      }, {
        signal: abortController.signal,
        timeoutMs: 15_000,
      });
      if (
        abortController.signal.aborted || generation !== physicsGenerationRef.current ||
        !componentActiveRef.current
      ) return;
      if (!isStudioBg3dPhysicsSessionSourceCurrent(
        sourceToken,
        physicsRuntimeSourceRef.current,
      )) {
        failPhysicsPreview("물리 계산 중 장면이 변경되어 오래된 결과를 폐기했습니다. 다시 실행해 주세요.");
        return;
      }
      const initialDynamicSamples = sampleStudioBg3dPhysicsTimeline(timeline, 0);
      if (!initialDynamicSamples) {
        throw new Error("invalid-initial-physics-sample");
      }
      const session: StudioBg3dPhysicsSession = Object.freeze({
        document: adapted.document,
        world: physicsJob.world,
        timeline,
        initialDynamicSamples,
        sourceToken,
      });
      physicsSessionRef.current = session;
      latestPhysicsSamplesRef.current = initialDynamicSamples;
      if (!projectStudioBg3dPhysicsSamples(initialDynamicSamples, primitiveObjectsRef.current)) {
        throw new Error("physics-projection-unavailable");
      }
      startPhysicsPlayback(session);
    } catch (caught) {
      if (generation !== physicsGenerationRef.current || abortController.signal.aborted) return;
      console.error("Studio BG3D physics preview failed", caught);
      failPhysicsPreview(
        typeof Worker !== "function"
          ? "이 브라우저는 격리된 물리 Worker를 지원하지 않습니다. 최신 브라우저에서 다시 시도해 주세요."
          : "물리 엔진을 준비하거나 계산하지 못했습니다. 오브젝트 수를 줄이고 다시 시도해 주세요.",
      );
    } finally {
      if (physicsAbortRef.current === abortController) physicsAbortRef.current = null;
    }
  };
  h.startPhysicsPreview = startPhysicsPreview;
  const handleStartPhysicsPreview = () => {
    shouldTransferPhysicsFocusRef.current = true;
    void startPhysicsPreview();
  };
  h.handleStartPhysicsPreview = handleStartPhysicsPreview;
  const bakePhysicsPreview = () => {
    if (
      physicsPhaseRef.current !== "paused" && physicsPhaseRef.current !== "complete" &&
      physicsPhaseRef.current !== "running"
    ) return;
    const session = physicsSessionRef.current;
    const samples = latestPhysicsSamplesRef.current;
    if (!session || samples.length === 0) return;
    if (!isStudioBg3dPhysicsSessionSourceCurrent(
      session.sourceToken,
      physicsRuntimeSourceRef.current,
    )) {
      failPhysicsPreview("물리 미리보기 시작 뒤 장면이 변경되어 현재 자세를 적용하지 않았습니다.");
      return;
    }
    const currentRuntimeSource = physicsRuntimeSourceRef.current;
    cancelPhysicsAnimationFrame();
    transitionPhysicsPhase("baking");
    const bakedDocument = applyStudioBg3dPhysicsTransforms(
      session.document,
      samples,
      session.world,
    );
    const hydrated = bakedDocument
      ? hydrateStudioBg3dDocumentToRuntime({
          document: bakedDocument,
          storageModelIdByAttachmentId: storageModelIdByAttachmentIdRef.current,
        })
      : null;
    if (
      !bakedDocument || !hydrated || !hydrated.ok || hydrated.diagnostics.length > 0 ||
      hydrated.omittedDiagnosticCount > 0 ||
      hydrated.counts.droppedPrimitives > 0 || hydrated.counts.droppedCustomModels > 0 ||
      hydrated.primitives.length !== currentRuntimeSource.primitives.length ||
      hydrated.customModels.length !== currentRuntimeSource.customModels.length
    ) {
      failPhysicsPreview("현재 물리 자세를 장면 문서에 손실 없이 적용하지 못했습니다.");
      return;
    }
    physicsGenerationRef.current += 1;
    physicsSessionRef.current = null;
    latestPhysicsSamplesRef.current = [];
    physicsPlaybackOffsetRef.current = 0;
    commitImmediateHistoryTransition(
      hydrated.primitives,
      hydrated.customModels,
      bakedDocument,
      createStudioBg3dHistorySnapshot(currentRuntimeSource),
    );
    setPrimitives(hydrated.primitives);
    setCustomModels(hydrated.customModels);
    setSceneBaseDocument(bakedDocument);
    setPhysicsCurrentSeconds(0);
    setPhysicsProgress(0);
    setPhysicsError(null);
    setPhysicsPreviewRevision((revision) => revision + 1);
    transitionPhysicsPhase("idle");
  };
  h.bakePhysicsPreview = bakePhysicsPreview;
}
