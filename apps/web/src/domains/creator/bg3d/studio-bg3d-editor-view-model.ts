/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function bindStudioBg3dEditorViewModel(h) {
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
    useStudioBg3dEngineRuntime,
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
    setWebXrCanvasGeneration, webXrSessionState, webXrSessionStateRef, webXrControllerRef, webXrRestoreCameraRef,
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
    shotBatchRecoverySummary, setShotBatchRecoverySummary, compositeCategory, setCompositeCategory,
    sceneTemplateCategory, setSceneTemplateCategory, roomBuilderSpec, setRoomBuilderSpec,
    sunRigConfig, setSunRigConfig, sectionPlane, setSectionPlane,
    scaleGuideVisible, setScaleGuideVisible, measurementActive, setMeasurementActive,
    measurementStatus, setMeasurementStatus, measurementActiveRef, snapSettings,
    setSnapSettings, surfaceSnapArmed, setSurfaceSnapArmed, surfaceSnapAlignNormal,
    setSurfaceSnapAlignNormal, surfaceSnapStatus, setSurfaceSnapStatus, layerQuery,
    setLayerQuery, customModels, setCustomModels, modelLibrary,
    setModelLibrary, placementSession, setPlacementSession, placementSessionRef,
    placementTokenSequenceRef, modelRenderer, setModelRenderer, modelRendererRef,
    isUploadingModel, setIsUploadingModel, modelImportProgress, setModelImportProgress,
    modelImportAbortRef, modelThumbnailCaptureAbortRef, modelThumbnailCaptureEpochRef, modelThumbnailGpuLeaseRef,
    modelAnimationTimeReadersRef, modelRigBakeReadersRef, ikEndJointSelection, setIkEndJointSelection,
    morphTargetSelection, setMorphTargetSelection, deletingModelId, setDeletingModelId,
    isRestoringScene, setIsRestoringScene, sceneRestoreAbortRef, templateLibrary,
    setTemplateLibrary, templateLibraryStatus, setTemplateLibraryStatus, isSavingTemplate,
    setIsSavingTemplate, applyingTemplateId, setApplyingTemplateId, generateId,
    handleSaveSceneAsTemplate, handleDeleteTemplate, failedCloneIds, setFailedCloneIds,
    readyCloneIds, setReadyCloneIds, unbatchableModelIds, setUnbatchableModelIds,
    sceneBaseDocument, setSceneBaseDocument,
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
    historyRef, historyIndexRef, transitionPhysicsPhase, commitImmediateHistoryTransition,
    doUndo, doRedo, canAdmitSceneNodes, addPrimitive,
    addComposite, addProceduralStarterAsset, addSceneTemplate,
    addPrimitiveRef, addSceneTemplateRef, objectInsertSeedKeyRef, addRoomBuild,
    applyRoomBuilderPreset, handleRoomBuilderSpecChange, commitSceneEntityRemoval, removeSceneEntities,
    deleteSelected, deleteSelectedCustomModel, deleteSelectedEntity, duplicateSelected,
    duplicateSelectedCustomModel, applyMultiSelectDelta, updateTransform, updateCustomModelTransform,
    updateCustomModelMaterial, updateCustomModelAnimation, updateCustomModelPose, updateCustomModelMorph,
    updateCustomModelConstraints, reparentSceneEntity, registerModelAnimationTime, registerModelRigBake,
    bakeCustomModelRigConstraints, finishModelAnimation, updateColor, applySurfacePreset,
    togglePrimitiveFlag, toggleCustomModelFlag, renameBgObject, groundSelectedEntity,
    placeSelectedModelRecipe, centerAndGroundSelectedEntity, commitCameraViewCommand, zoomCameraBy,
    applyCameraPreset, focusSelectedEntity, registerPrimitiveRef, ensureModelRootCached,
    publishPlacementSession, cancelCustomModelPlacement, moveCustomModelPlacement, rotateCustomModelPlacement,
    commitCustomModelPlacement, addCustomModelToScene, applyUserTemplate, handlePanelTabChange,
    reportLtUserPresetMutationFailure, persistLtUserPresetMutation, currentLtUserPresetDraft, saveCurrentLtAsUserPreset,
    updateManagedLtUserPreset, renameManagedLtUserPreset, deleteManagedLtUserPreset, applyLtPreset,
    updateLtLineSettings, updateLtToneSettings, updateLtExportHeight, updateLtExportAspectRatio,
    updateBackgroundSettings, updateLightingSettings, updateRenderExposure, applyMoodRig,
    applySunRigConfig, cameraLensInteractionLocked, commitCameraLensView, finishCameraLensGesture,
    previewCameraLens, updateCameraLens, applyTwoPointPerspective, resetTwoPointPerspective,
    readCurrentCanonicalSceneForShot, commitAppliedShot, captureCurrentShot, applySavedShot,
    duplicateActiveShot, moveSavedShot, removeSavedShot, exportSavedShotsAsZip,
    updateBackgroundTransparency, selectedIdsRef, undoRef, redoRef,
    deleteSelectedRef, onCaptureUpdate, requestModalDismiss, requestUserClose,
    handleSaveToLibrary, handleUseAsAiMethodReference, handleInsert, firstSelectedId,
    selectedPrimitive, selectedCustomModel, selectedEntity, selectedModelCacheEntry,
    selectedSemanticMaterials, selectedSemanticAssignments, selectedCharacterPassPlan, selectedBackgroundPassPlan,
    selectedModelAnimations, selectedModelJoints, selectedGenericModelManifest, selectedGenericModelProxies,
    effectiveGenericModelProxyId, changeSelectedGenericModelClassification, changeGenericModelControlMode, selectGenericModelProxy,
    selectedJointByKey, selectedPoseRigSelection, selectedPoseJointKey, selectedPoseCanonicalKey,
    selectedPoseJoint, selectedHasEffectiveRigConstraint, selectedRigBakeDisabledReason, selectedAimConstraint,
    selectedIkProtectedJointKeys, selectedAimSuppressedByIk, selectedIkEndCandidates, savedIkEndJointKey,
    requestedIkEndJointKey, selectedIkEndJointKey, selectedIkRigSelection, selectedIkEndJoint,
    selectedIkMiddleJoint, selectedIkUpperJoint, selectedTwoBoneIkConstraint, selectedIkChainKeys,
    selectedIkHasOverlap, selectedIkLimitReached, selectedIkWorldMatrix, selectedIkSourceRoot,
    selectedIkTransformSupported, selectedPoseEulerDegrees, selectedModelMorphTargets, selectedMorphTargetCandidateKey,
    selectedMorphTargetKey, selectedMorphOverride, selectedAnimationClip, selectedAnimationDuration,
    commitSelectedPoseOverride, commitSelectedAimConstraint, commitSelectedTwoBoneIkConstraint, selectedIsLocked,
    selectedEntities, canGroundSelection, selectedPlaceableModels, snapSettingsSummary,
    sceneHierarchy, effectivelyVisibleLayerIds, surfaceSnapDisabledReason, measurementDisabledReason,
    focusSelectionDisabledReason, cancelMeasurement, measurementInferenceReferences, resolveMeasurementCandidate,
    updateMeasurementPreview, pickMeasurementPoint, handleMeasurementSurfacePreview, handleMeasurementLengthLockChange,
    toggleMeasurement, toggleSurfaceSnap, handleSurfaceSnapPick, physicsSelectionUnavailableReason,
    filteredLayerItems, ltLineSettings, ltToneSettings, hasFilledOutput,
    appliedLtPreset, appliedLtPresetId, appliedMoodRig, managedLtUserPreset,
    ltExportAspectRatio, ltCaptureSafeFrame, ltCaptureSizePreview, ltDocumentAspectPreset,
    ltCaptureAspectPresets, ltCaptureAspectPresetId, ltCaptureAspectLabel, hideOnTab,
    cancelPhysicsAnimationFrame, updatePhysicsProgress, restorePhysicsInitialPose, resetPhysicsPreview,
    failPhysicsPreview, physicsPlaybackFrame, startPhysicsPlayback, pausePhysicsPreview,
    resumePhysicsPreview, startPhysicsPreview, handleStartPhysicsPreview, bakePhysicsPreview,
    runBabylonDiagnostic, pausePhysicsWhenHidden, immersiveSceneActive, immersiveTransitionActive,
    effectiveIsQuadView, mainViewTrackRef, bg3dFrameLoop, isMainOrtho,
    currentFocalLengthMm, sunLightState, selectedSky, panoramaRotation,
    renderedSkyPresetId, fogNear, fogFar, fogSliderMax,
    selectSceneEntity, updateModelCloneStatuses, primitiveById, customModelById,
    batchCandidatesByModelId, batchedNodeIds, renderSceneEntity, sharedCharacterSceneContent,
    shadowSceneBounds, shadowMapSize, keyShadowFit, fillShadowFit,
    webXrDisabledReason, startStudioBg3dWebXr, endStudioBg3dWebXr, sceneContent,
    mainCameraNearClip, mainCameraUp, applyLensShift, mainCameraNode,
    immersiveCameraNode, mainScenePresentationNode, commonOrbitControls, commitSharedCharacterTransform,
    effectiveSelectedSharedCharacter, effectiveSelectedSharedCharacterElementId, includeSharedCharactersInCapture, mayApplyEmptySharedStageMutation,
    selectSharedStageMutation, setSelectedSharedCharacterElementId, setSharedStageMaterializationKind, setSharedStageMutationKind,
    sharedCharacterCaptureElementIds, sharedCharacterCaptureReadiness, sharedCharacterGroundings, sharedCharacterPreviewOmissionCount,
    sharedCharacterReadyCount, sharedCharacterRelationshipLabel, sharedCharacterStatuses, sharedCharacterUnavailableCount,
    sharedCharacters, sharedStageMaterializationKind, sharedStageMutationKind, shouldStartOnSharedStageLayerTab,
    targetHasLinkedCharacters, targetHasSavedSharedScene, updateSharedCharacterGrounding, updateSharedCharacterStatus,
    handleUploadModelFiles, handleDeleteModelFromLibrary, placementActive, twoPointPerspectiveActive,
    renderedPanoramaRotation, renderedBackgroundSettings, sharedCharacterGroundSurfaceRevision, staticModelBatches,
    mainCameraFarClip, mainCameraMaxOrbitDistance, quadViewHint, snapToggleHint,
    lineArtPreviewHint, surfaceSnapHint,
    // 파일 분할 때 목록에서 빠져 ReferenceError 를 던지던 식별자들(런타임 값 위치) — 복구.
    sceneRecoveryError, transformSpaceOverride,
  } = { ...R, ...h };
  const isBatchRenderingShots = shotBatchProgress !== null;
  const savedShots = sceneBaseDocument.shots ?? [];
  const shotBatchSelectedIds = savedShots
    .filter(({ id }) => !shotBatchExcludedIds.has(id))
    .map(({ id }) => id);
  const selectedShotBatchPasses = STUDIO_BG3D_SHOT_BATCH_PASSES.filter((pass) =>
    shotBatchPasses.has(pass),
  );
  const [captureBackgroundSnapshot, setCaptureBackgroundSnapshot] =
    useState<StudioBg3dCaptureBackgroundSnapshot | null>(null);
  const [deviceSignals, setDeviceSignals] = useState<StudioBg3dDeviceSignals>(() => collectDeviceSignals());
  const skyPresetId = sceneBaseDocument.background.skyPresetId;
  const insertBackgroundIntent = resolveStudioBg3dInsertBackgroundFromDocument({
    transparentBackground: sceneBaseDocument.output.transparentBackground,
    backgroundMode: sceneBaseDocument.background.mode,
  });
  const transparentInsert = insertBackgroundIntent.ok
    ? insertBackgroundIntent.plan.transparent
    : false;
  const deviceQuality = resolveStudioBg3dDeviceQuality({
    document: sceneBaseDocument,
    mode: isCapturing ? "capture" : "edit",
    signals: deviceSignals,
  });
  // Next-generation engine admission. The plan owns which renderer the R3F Canvas builds, so it is
  // resolved beside device quality rather than inside the viewport, where a late decision would
  // remount the canvas after the scene had already been hydrated.
  const engineRuntime = useStudioBg3dEngineRuntime({
    enabled: open,
    deviceProfile: deviceQuality.profile,
    antialias: sceneBaseDocument.render.antialias,
    saveData: deviceSignals.saveData,
    deviceMemoryGb: deviceSignals.deviceMemoryGb,
    observedWebglOnlyFeatures: {
      // The immersive bridge needs WebGLRenderer.xr, so it makes a selected WebGPU plan unavailable
      // until the artist explicitly chooses WebGL2.
      webxr: webXrSessionState.status !== "idle",
      // A character has the same explicit-choice requirement — not because WebGPU cannot load
      // MToon, but because the two implementations shade differently and delivery must match the
      // poser and every other machine. See studio-bg3d-engine-selection.
      vrmCharacters: sharedCharacters.length > 0,
    },
  });
  const hasCloneFailure = customModels.some((model) => failedCloneIds.has(model.id));
  const hasPendingClone = customModels.some(
    (model) => !readyCloneIds.has(model.id) && !failedCloneIds.has(model.id)
  );
  const hasPendingSharedCharacter = includeSharedCharactersInCapture
    && sharedCharacterCaptureReadiness.phase === "loading";
  const hasUnavailableSharedCharacter = includeSharedCharactersInCapture
    && sharedCharacterCaptureReadiness.phase === "unavailable";
  const sharedStageUpdateBlockedReason =
    resolveStudioBg3dSharedStageMutationBlockedReason({
      operation,
      stageResolution: sharedStageResolution,
      mutationKind: sharedStageMutationKind,
      includeCharactersInCapture: includeSharedCharactersInCapture,
      captureReadiness: sharedCharacterCaptureReadiness,
    });
  const physicsInteractionLocked = isStudioBg3dPhysicsTransientPhase(physicsPhase);
  // 파일 분할 때 계산 자체가 누락됐던 파생값 — 분할 전 StudioBackground3D 원문 그대로 복원
  // (소비처: scene-ops 호스트의 addProceduralStarterAsset 가드, ShapesPanel disabledReason).
  const proceduralStarterDisabledReason = isRestoringScene
    ? "3D 장면을 복원하는 중입니다. 복원이 끝난 뒤 추가할 수 있습니다."
    : isUploadingModel || applyingTemplateId !== null || deletingModelId !== null ||
        isSavingTemplate
      ? "다른 3D 에셋 작업이 끝난 뒤 추가할 수 있습니다."
      : isCapturing || isBatchRenderingShots
        ? "3D 장면을 캡처하는 동안에는 에셋을 추가할 수 없습니다."
        : physicsInteractionLocked || isTransforming
          ? "물리 미리보기 또는 변형 작업을 마친 뒤 추가할 수 있습니다."
          : null;
  const transformSpace =
    transformSpaceOverride ?? (transformMode === "rotate" ? "local" : "world");
  const insertBlocked = Boolean(sceneRecoveryError) || hasCloneFailure || hasPendingClone ||
    hasPendingSharedCharacter || hasUnavailableSharedCharacter || isRestoringScene ||
    physicsInteractionLocked || isBatchRenderingShots;
  const magicLayerEffectivelyVisibleIds =
    collectStudioBg3dEffectivelyVisibleEntityIds([...primitives, ...customModels]);
  const magicLayerSelectedPrimitive = selectedIds.size === 1
    ? primitives.find((primitive) => selectedIds.has(primitive.id)) ?? null
    : null;
  const magicLayerLensShift = sceneBaseDocument.camera.lensShift;
  const magicLayerUnavailableReason = operation === "update"
    ? "첫 단계에서는 새 3D 배경을 추가할 때만 매직 마스크를 만들 수 있어요."
    : customModels.length > 0
      ? "첫 단계에서는 외부 모델이 없는 프리미티브 장면만 정확하게 분리할 수 있어요."
      : selectedIds.size !== 1
        ? "보이는 프리미티브 한 개를 선택하면 사용할 수 있어요."
        : !magicLayerSelectedPrimitive
          ? "현재 선택은 프리미티브가 아니어서 매직 마스크를 만들 수 없어요."
          : !magicLayerEffectivelyVisibleIds.has(magicLayerSelectedPrimitive.id)
            ? "숨겨진 프리미티브나 숨겨진 그룹의 자식은 마스크에 나타나지 않아요. 먼저 표시해 주세요."
            : sceneBaseDocument.camera.projection === "orthographic"
              ? "첫 단계의 매직 마스크는 원근 카메라에서만 지원해요."
              : magicLayerLensShift &&
                  (magicLayerLensShift[0] !== 0 || magicLayerLensShift[1] !== 0)
                ? "렌즈 시프트를 0으로 되돌리면 매직 마스크를 만들 수 있어요."
                : sceneBaseDocument.background.mode === "sky-preset" &&
                    sceneBaseDocument.background.skyPresetId !== "blank"
                  ? "첫 단계에서는 단색·투명·빈 하늘 배경에서만 매직 마스크를 만들 수 있어요."
                  : sceneBaseDocument.output.tone.mode === "none" ||
                      sceneBaseDocument.output.tone.opacity <= 0
                    ? "매직 마스크를 붙일 컬러 또는 톤 베이스 출력을 먼저 켜 주세요."
                    : null;
  const shotBatchBlockedReason = sceneRecoveryError
    ? "3D 장면 복원 오류를 해결하기 전에는 누락 가능성이 있는 컷을 배치 출력할 수 없습니다."
    : hasCloneFailure
      ? "불러오기에 실패한 3D 모델이 있어 컷 배치 출력을 막았습니다. 모델 파일 상태를 확인해 주세요."
      : hasPendingClone
        ? "3D 모델 렌더 복제본을 준비하는 중입니다. 모든 모델이 표시된 뒤 컷 배치 출력을 다시 실행해 주세요."
        : hasUnavailableSharedCharacter
          ? "연결된 3D 캐릭터 모델을 불러오지 못해 컷 배치 출력을 막았습니다. 캐릭터 레이어의 모델 파일을 확인해 주세요."
          : hasPendingSharedCharacter
            ? "연결된 3D 캐릭터를 준비하는 중입니다. 모든 캐릭터가 표시된 뒤 컷 배치 출력을 다시 실행해 주세요."
            : isRestoringScene
              ? "3D 장면을 복원하는 중입니다. 복원이 끝난 뒤 컷 배치 출력을 실행해 주세요."
              : physicsInteractionLocked
                ? "물리 미리보기 중에는 컷 배치 출력을 실행할 수 없습니다. 현재 자세를 적용하거나 미리보기를 초기화해 주세요."
                : isCapturing || isBatchRenderingShots
                  ? "다른 3D 캡처가 진행 중입니다. 완료하거나 취소한 뒤 컷 배치 출력을 다시 실행해 주세요."
                  : null;
  // 선택된 것이 도형(primitives)인지 커스텀 모델(customModels)인지는 배타적이다 — 둘 다 같은
  // selectedId/primitiveObjectsRef를 공유하므로(§4) "primitives에 있으면 도형, 아니면 모델"로 분기한다.
  Object.assign(h, {
    // 파일 분할 때 출력 목록에서 빠져 소비 모듈(레이아웃 VM·캡처/삽입 호스트·이펙트)이
    // ReferenceError 를 던지던 useState 쌍 — 복구. deviceSignals 쌍은 이펙트의 matchMedia
    // 리스너가 setDeviceSignals 를 undefined 로 호출하던 TypeError 의 원인이었다.
    captureBackgroundSnapshot,
    setCaptureBackgroundSnapshot,
    deviceSignals,
    setDeviceSignals,
    proceduralStarterDisabledReason,
    isBatchRenderingShots,
    savedShots,
    shotBatchSelectedIds,
    selectedShotBatchPasses,
    skyPresetId,
    insertBackgroundIntent,
    transparentInsert,
    deviceQuality,
    engineRuntime,
    hasCloneFailure,
    hasPendingClone,
    hasPendingSharedCharacter,
    hasUnavailableSharedCharacter,
    sharedStageUpdateBlockedReason,
    physicsInteractionLocked,
    transformSpace,
    insertBlocked,
    magicLayerEffectivelyVisibleIds,
    magicLayerSelectedPrimitive,
    magicLayerLensShift,
    magicLayerUnavailableReason,
    shotBatchBlockedReason,
  });
}
