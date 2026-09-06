/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function attachStudioBg3dEditorSessionHost(h) {
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
    sharedCharacterCaptureStatusFenceRef, primitives, setPrimitives, selectedIds,
    setSelectedIds, transformMode, setTransformMode, lineArtPreview, setLineArtPreview,
    magicLayerEnabled, setMagicLayerEnabled, isTransforming, setIsTransforming, isQuadView,
    setIsQuadView, webXrBridgeGeneration, setWebXrBridgeGeneration, webXrCanvasGeneration,
    setWebXrCanvasGeneration, webXrSessionStateRef, webXrControllerRef, webXrRestoreCameraRef,
    webXrCleanupPromiseRef, webXrRendererRecreationPendingRef, webXrCloseRequestedRef,
    webXrOpenRef, webXrMountedRef, viewTopRef, viewFrontRef, viewRightRef, viewPerspRef,
    isCapturing, setIsCapturing, error, setError, activePanelTab, setActivePanelTab,
    modelsPanelActivated, setModelsPanelActivated, viewEditorSection, setViewEditorSection,
    babylonDiagnosticAbortRef, babylonDiagnosticGenerationRef, physicsPhase, setPhysicsPhase,
    physicsDurationSeconds, setPhysicsDurationSeconds, physicsGroundEnabled,
    setPhysicsGroundEnabled, physicsProgress, setPhysicsProgress, physicsCurrentSeconds,
    setPhysicsCurrentSeconds, physicsError, setPhysicsError, physicsPreviewRevision,
    setPhysicsPreviewRevision, ltEditorSection, setLtEditorSection, ltPresetPanelActivated,
    setLtPresetPanelActivated, ltUserPresetRepository, ltUserPresetHydrationGenerationRef,
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
    shouldTransferPhysicsFocusRef, handleViewportReady, disposeWebXrControllerForOpenChange,
    historyRef, historyIndexRef, deviceQuality, hasCloneFailure, hasPendingClone,
    hasPendingSharedCharacter, hasUnavailableSharedCharacter, physicsInteractionLocked,
    insertBlocked, magicLayerSelectedPrimitive, magicLayerLensShift,
    magicLayerUnavailableReason, shotBatchBlockedReason, transitionPhysicsPhase,
    commitImmediateHistoryTransition, doUndo, doRedo, canAdmitSceneNodes, addPrimitive,
    addComposite, proceduralStarterDisabledReason, addProceduralStarterAsset, addSceneTemplate,
    addPrimitiveRef, addSceneTemplateRef, objectInsertSeedKeyRef, addRoomBuild,
    applyRoomBuilderPreset, handleRoomBuilderSpecChange, commitSceneEntityRemoval,
    removeSceneEntities, deleteSelected, deleteSelectedCustomModel, deleteSelectedEntity,
    duplicateSelected, duplicateSelectedCustomModel, applyMultiSelectDelta, updateTransform,
    updateCustomModelTransform, updateCustomModelMaterial, updateCustomModelAnimation,
    updateCustomModelPose, updateCustomModelMorph, updateCustomModelConstraints,
    reparentSceneEntity, registerModelAnimationTime, registerModelRigBake,
    bakeCustomModelRigConstraints, finishModelAnimation, updateColor, applySurfacePreset,
    togglePrimitiveFlag, toggleCustomModelFlag, renameBgObject, groundSelectedEntity,
    placeSelectedModelRecipe, centerAndGroundSelectedEntity, commitCameraViewCommand,
    zoomCameraBy, applyCameraPreset, focusSelectedEntity, registerPrimitiveRef,
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
    modelThumbnailCaptureControllerRef, setImmersiveStagePlan, setModelLibraryStatus, setWebXrController, setWebXrRendererLifetimeRetained, setWebXrSessionState, setWebXrSupport, sharedCharacterCaptureAuthorityRef,
  } = { ...R, ...h };

  const updateSharedCharacterStatusWithCaptureFence = (
    ...args: Parameters<typeof updateSharedCharacterStatus>
  ) => {
    const [runtimeKey, status] = args;
    if (sharedCharacterCaptureStatusFenceRef.current[runtimeKey] !== status) {
      sharedCharacterCaptureStatusFenceRef.current = {
        ...sharedCharacterCaptureStatusFenceRef.current,
        [runtimeKey]: status,
      };
      sharedCharacterCaptureAuthorityRevisionRef.current = Math.max(
        1,
        sharedCharacterCaptureAuthorityRevisionRef.current + 1,
      );
      sharedCharacterCaptureAuthorityPayloadKeyRef.current = null;
      sharedCharacterCaptureAuthorityRef.current = null;
    }
    updateSharedCharacterStatus(...args);
  };
  h.updateSharedCharacterStatusWithCaptureFence = updateSharedCharacterStatusWithCaptureFence;
  const acquireSharedCharacterCaptureAuthority = () => {
    const current = sharedCharacterCaptureAuthorityRef.current;
    return current
      ? acquireStudioBg3dSharedCharacterCaptureAuthorityLease(current)
      : null;
  };
  h.acquireSharedCharacterCaptureAuthority = acquireSharedCharacterCaptureAuthority;
  const verifySharedCharacterCaptureAuthority = (
    lease: StudioBg3dSharedCharacterCaptureAuthorityLease,
    checkpoint: "raster" | "receipt",
  ) => {
    const current = sharedCharacterCaptureAuthorityRef.current;
    return current
      ? verifyStudioBg3dSharedCharacterCaptureAuthorityLease(lease, current, checkpoint)
      : null;
  };
  h.verifySharedCharacterCaptureAuthority = verifySharedCharacterCaptureAuthority;
  function isModalAssetSessionCurrent(session: StudioBg3dModalSession): boolean {
    return componentActiveRef.current && studioBg3dModalOperationCoordinator.isCurrent(session);
  }
  h.isModalAssetSessionCurrent = isModalAssetSessionCurrent;
  function getModelThumbnailCaptureController(
    CaptureController: StudioBg3dModelThumbnailCaptureControllerConstructor,
  ): StudioBg3dModelThumbnailCaptureController {
    const existing = modelThumbnailCaptureControllerRef.current;
    if (existing) return existing;
    const created = new CaptureController({
      dependencies: { encode: encodeStudioBg3dModelThumbnailPng },
    });
    modelThumbnailCaptureControllerRef.current = created;
    return created;
  }
  h.getModelThumbnailCaptureController = getModelThumbnailCaptureController;
  function acquireModelThumbnailGpuLease(): ModelThumbnailGpuLease | null {
    if (captureInFlightRef.current) return null;
    let resolveReleased: () => void = () => undefined;
    let didRelease = false;
    const released = new Promise<void>((resolve) => {
      resolveReleased = resolve;
    });
    const lease: ModelThumbnailGpuLease = {
      released,
      release() {
        if (didRelease) return;
        didRelease = true;
        if (modelThumbnailGpuLeaseRef.current === lease) {
          modelThumbnailGpuLeaseRef.current = null;
          captureInFlightRef.current = false;
        }
        resolveReleased();
      },
    };
    modelThumbnailGpuLeaseRef.current = lease;
    captureInFlightRef.current = true;
    return lease;
  }
  h.acquireModelThumbnailGpuLease = acquireModelThumbnailGpuLease;
  function startModelThumbnailCaptureBatch(
    records: readonly Bg3dVerifiedStoredRecord[],
    session: StudioBg3dModalSession,
  ): void {
    invalidateModelThumbnailCaptures();
    if (records.length === 0 || !isModalAssetSessionCurrent(session)) return;
    const renderer = modelRendererRef.current;
    if (!renderer) return;

    const batchController = new AbortController();
    modelThumbnailCaptureAbortRef.current = batchController;
    const batchEpoch = modelThumbnailCaptureEpochRef.current;
    const isCurrent = () => (
      !batchController.signal.aborted &&
      modelThumbnailCaptureAbortRef.current === batchController &&
      modelThumbnailCaptureEpochRef.current === batchEpoch &&
      modelRendererRef.current === renderer &&
      isModalAssetSessionCurrent(session)
    );

    void (async () => {
      let thumbnailRuntime: StudioBg3dModelThumbnailRuntime;
      try {
        thumbnailRuntime = await loadStudioBg3dModelThumbnailRuntime();
      } catch {
        // Runtime loading is best-effort just like capture. The imported model remains committed
        // and a later import may retry after a transient chunk/network failure.
        return;
      }
      if (!isCurrent()) return;
      const thumbnailCaptureController = getModelThumbnailCaptureController(
        thumbnailRuntime.CaptureController,
      );
      let capturedAnyThumbnail = false;
      for (const record of records) {
        if (!isCurrent()) break;
        // Import and scene placement remain successful when another shot/LT/insert capture owns
        // the renderer. The library card simply retains its existing placeholder in that case.
        if (captureInFlightRef.current) continue;
        const cachedEntry = modelRootCacheRef.current.get(record.id);
        if (
          !cachedEntry ||
          cachedEntry.record.contentHash !== record.contentHash ||
          cachedEntry.record.byteSize !== record.byteSize
        ) continue;

        let captureHandle: StudioBg3dModelThumbnailThreeCaptureHandle | null = null;
        try {
          captureHandle = await thumbnailRuntime.createThreeCapture({
            renderer,
            cachedRoot: cachedEntry.root,
            signal: batchController.signal,
            isCurrent,
          });
          if (!isCurrent()) continue;
          const isolatedAdapter = captureHandle.adapter;
          const leasedAdapter: StudioBg3dCaptureAdapter = Object.freeze({
            backend: isolatedAdapter.backend,
            engineId: isolatedAdapter.engineId,
            engineVersion: isolatedAdapter.engineVersion,
            implementationRevision: isolatedAdapter.implementationRevision,
            graphicsApi: isolatedAdapter.graphicsApi,
            profileId: isolatedAdapter.profileId,
            getSourceSize: () => isolatedAdapter.getSourceSize(),
            async capture(request: StudioBg3dCaptureRequest) {
              const lease = acquireModelThumbnailGpuLease();
              if (!lease) throw new Error("studio-bg3d-model-thumbnail:gpu-lease-busy");
              try {
                return await isolatedAdapter.capture(request);
              } finally {
                lease.release();
              }
            },
          });
          await thumbnailCaptureController.captureAndStore({
            storageModelId: record.id,
            adapter: leasedAdapter,
            signal: batchController.signal,
            isCurrent: () => isCurrent() && (
              modelRootCacheRef.current.get(record.id)?.record.contentHash === record.contentHash
            ),
          });
          capturedAnyThumbnail = true;
        } catch {
          // Thumbnail generation is best-effort. A verified model import and its scene placement
          // stay committed; malformed bounds, a busy renderer, or a blocked Worker keep the card's
          // placeholder instead of rolling the model transaction back.
        } finally {
          modelThumbnailGpuLeaseRef.current?.release();
          captureHandle?.dispose();
        }
      }

      if (!capturedAnyThumbnail || !isCurrent()) return;
      try {
        const entries = await listBg3dModelLibraryEntries();
        if (!isCurrent()) return;
        studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
          setModelLibrary(entries);
          setModelLibraryStatus("ready");
        });
      } catch {
        // A failed refresh must not downgrade the already committed import. The next modal open
        // reads the persisted thumbnail store again.
      }
    })().finally(() => {
      if (modelThumbnailCaptureAbortRef.current === batchController) {
        modelThumbnailCaptureAbortRef.current = null;
      }
    });
  }
  h.startModelThumbnailCaptureBatch = startModelThumbnailCaptureBatch;
  function invalidateModalAssetSession(): void {
    invalidateModelThumbnailCaptures();
    ltInsertAbortRef.current?.abort();
    ltInsertAbortRef.current = null;
    aiMethodReferenceAbortRef.current?.abort();
    aiMethodReferenceAbortRef.current = null;
    const session = modalAssetSessionRef.current;
    if (!session) return;
    modalAssetSessionRef.current = null;
    studioBg3dModalOperationCoordinator.endSession(session);
  }
  h.invalidateModalAssetSession = invalidateModalAssetSession;
  function cancelSurfaceSnap(message?: string): void {
    surfaceSnapArmedRef.current = false;
    setSurfaceSnapArmed(false);
    if (message) setSurfaceSnapStatus({ tone: "info", message });
  }
  h.cancelSurfaceSnap = cancelSurfaceSnap;
  function resetWebXrPresentationUi(): void {
    setWebXrController(null);
    setWebXrSupport(null);
    const restoreCamera = webXrRestoreCameraRef.current;
    if (restoreCamera) pendingInitialCameraRef.current = restoreCamera;
    webXrRestoreCameraRef.current = null;
    webXrSessionStateRef.current = { status: "idle" };
    setWebXrSessionState({ status: "idle" });
    setImmersiveStagePlan(null);
  }
  h.resetWebXrPresentationUi = resetWebXrPresentationUi;
  function finishWebXrControllerCleanup(cleanup: Promise<void>): void {
    if (webXrCleanupPromiseRef.current !== cleanup) return;
    webXrCleanupPromiseRef.current = null;
    if (!webXrMountedRef.current) return;
    const rendererMustStayMounted = webXrOpenRef.current;
    const replacePoisonedRenderer = webXrRendererRecreationPendingRef.current;
    webXrRendererRecreationPendingRef.current = false;
    setWebXrRendererLifetimeRetained(rendererMustStayMounted);
    onWebXrCleanupPendingChange?.(false);
    if (rendererMustStayMounted && !webXrCloseRequestedRef.current) {
      if (replacePoisonedRenderer) {
        // Three can revive isPresenting after native end when its setSession continuation wins a
        // race. Its public API cannot repair that manager, so replace this one Canvas only after
        // controller.dispose() proves both attachment and native dispatch have settled.
        setWebXrCanvasGeneration((generation) => generation + 1);
      } else {
        // The modal was reopened before an ordinary controller generation finished. Recreate only
        // the bridge; the admitted scene and its one Canvas remain the same.
        setWebXrBridgeGeneration((generation) => generation + 1);
      }
    }
  }
  h.finishWebXrControllerCleanup = finishWebXrControllerCleanup;
  function disposeCurrentWebXrControllerGeneration(): Promise<void> | null {
    const existingCleanup = webXrCleanupPromiseRef.current;
    if (existingCleanup) return existingCleanup;
    const controller = webXrControllerRef.current;
    webXrControllerRef.current = null;
    resetWebXrPresentationUi();
    if (!controller) {
      if (!webXrOpenRef.current) {
        setWebXrRendererLifetimeRetained(false);
        onWebXrCleanupPendingChange?.(false);
      }
      return null;
    }

    const cleanup = controller.dispose();
    webXrCleanupPromiseRef.current = cleanup;
    // This state is committed in the same discrete close turn as the parent's logical close. It
    // renders the existing Canvas hidden, never a second renderer, until Three can be torn down.
    setWebXrRendererLifetimeRetained(true);
    onWebXrCleanupPendingChange?.(true);
    void cleanup.then(
      () => finishWebXrControllerCleanup(cleanup),
      () => finishWebXrControllerCleanup(cleanup),
    );
    return cleanup;
  }
  h.disposeCurrentWebXrControllerGeneration = disposeCurrentWebXrControllerGeneration;
  const handleWebXrControllerReady = (controller: StudioWebXrSessionController | null) => {
    const lostController = controller === null && webXrControllerRef.current !== null;
    webXrControllerRef.current = controller;
    setWebXrController(controller);
    if (!lostController) return;
    const restoreCamera = webXrRestoreCameraRef.current;
    if (restoreCamera) pendingInitialCameraRef.current = restoreCamera;
    webXrRestoreCameraRef.current = null;
    webXrSessionStateRef.current = { status: "idle" };
    setWebXrSessionState({ status: "idle" });
    setImmersiveStagePlan(null);
  };
  h.handleWebXrControllerReady = handleWebXrControllerReady;
  const handleWebXrSessionStateChange = (nextState: StudioWebXrSessionState) => {
    webXrSessionStateRef.current = nextState;
    setWebXrSessionState(nextState);
    if (
      nextState.status === "error"
      && nextState.code === "renderer-failed"
      && webXrControllerRef.current?.requiresRendererRecreation
    ) {
      webXrRendererRecreationPendingRef.current = true;
      disposeCurrentWebXrControllerGeneration();
      return;
    }
    if (nextState.status !== "idle" && nextState.status !== "error") return;
    const restoreCamera = webXrRestoreCameraRef.current;
    if (restoreCamera) pendingInitialCameraRef.current = restoreCamera;
    webXrRestoreCameraRef.current = null;
    setImmersiveStagePlan(null);
  };
  h.handleWebXrSessionStateChange = handleWebXrSessionStateChange;
}
