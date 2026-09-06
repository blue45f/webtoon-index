/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function bindStudioBg3dEditorLayoutViewModel(h) {
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
    generateId, handleSaveSceneAsTemplate, handleDeleteTemplate, failedCloneIds,
    setFailedCloneIds, readyCloneIds, setReadyCloneIds, unbatchableModelIds,
    setUnbatchableModelIds, sceneBaseDocument, setSceneBaseDocument, savedShots,
    shotBatchSelectedIds, selectedShotBatchPasses, deviceSignals, setDeviceSignals,
    skyPresetId, insertBackgroundIntent, transparentInsert, captureRef,
    modalDialogRef, modalRootRef, viewportApiRef, pendingInitialCameraRef,
    cameraLensGestureBeforeViewRef, cameraLensGestureLatestViewRef, cameraLensGestureTimerRef, viewportHostRef,
    viewportBoxSize, setViewportBoxSize, primitiveObjectsRef, surfaceSnapArmedRef,
    dragInitialSelectedTransformsRef, dragInitialFirstTransformRef, panelScrollRef, modelRootCacheRef,
    modelLoadPendingRef, attachmentByStorageModelIdRef, storageModelIdByAttachmentIdRef, componentActiveRef,
    modalAssetSessionRef, captureInFlightRef, invalidateModelThumbnailCaptures, ltInsertAbortRef,
    aiMethodReferenceAbortRef, ltInsertSceneEpochRef, ltMagicSelectionEpochRef, ltMagicCaptureGenerationRef,
    ltInsertRestoreLineArtPreviewRef, destructiveMutationGuardRef, shotBatchAbortRef, shotBatchRecoveryRef,
    shotBatchRecoveryScopeRef, shotBatchRecoveryStoreRef, shotBatchAuthorizationEpochRef, physicsPhaseRef,
    physicsAbortRef, physicsAnimationFrameRef, physicsGenerationRef, physicsPlaybackStartedAtRef,
    physicsPlaybackOffsetRef, physicsLastUiUpdateRef, physicsLastFrameTimestampRef, latestPhysicsSamplesRef,
    physicsSessionRef, physicsWorkerSessionRef, physicsRuntimeSourceRef, physicsStartButtonRef,
    physicsTransportActionRef, shouldTransferPhysicsFocusRef, isModalAssetSessionCurrent, getModelThumbnailCaptureController,
    acquireModelThumbnailGpuLease, startModelThumbnailCaptureBatch, invalidateModalAssetSession, cancelSurfaceSnap,
    handleViewportReady, resetWebXrPresentationUi, finishWebXrControllerCleanup, disposeCurrentWebXrControllerGeneration,
    disposeWebXrControllerForOpenChange, handleWebXrControllerReady, handleWebXrSessionStateChange, historyRef,
    historyIndexRef, deviceQuality, hasCloneFailure, hasPendingClone,
    hasPendingSharedCharacter, hasUnavailableSharedCharacter, physicsInteractionLocked, insertBlocked,
    magicLayerSelectedPrimitive, magicLayerLensShift, magicLayerUnavailableReason, shotBatchBlockedReason,
    transitionPhysicsPhase, commitImmediateHistoryTransition, doUndo, doRedo,
    canAdmitSceneNodes, addPrimitive, addComposite, proceduralStarterDisabledReason,
    addProceduralStarterAsset, addSceneTemplate, addPrimitiveRef, addSceneTemplateRef,
    objectInsertSeedKeyRef, addRoomBuild, applyRoomBuilderPreset, handleRoomBuilderSpecChange,
    commitSceneEntityRemoval, removeSceneEntities, deleteSelected, deleteSelectedCustomModel,
    deleteSelectedEntity, duplicateSelected, duplicateSelectedCustomModel, applyMultiSelectDelta,
    updateTransform, updateCustomModelTransform, updateCustomModelMaterial, updateCustomModelAnimation,
    updateCustomModelPose, updateCustomModelMorph, updateCustomModelConstraints, reparentSceneEntity,
    registerModelAnimationTime, registerModelRigBake, bakeCustomModelRigConstraints, finishModelAnimation,
    updateColor, applySurfacePreset, togglePrimitiveFlag, toggleCustomModelFlag,
    renameBgObject, groundSelectedEntity, placeSelectedModelRecipe, centerAndGroundSelectedEntity,
    commitCameraViewCommand, zoomCameraBy, applyCameraPreset, focusSelectedEntity,
    registerPrimitiveRef, ensureModelRootCached, publishPlacementSession, cancelCustomModelPlacement,
    moveCustomModelPlacement, rotateCustomModelPlacement, commitCustomModelPlacement, addCustomModelToScene,
    applyUserTemplate, handlePanelTabChange, reportLtUserPresetMutationFailure, persistLtUserPresetMutation,
    currentLtUserPresetDraft, saveCurrentLtAsUserPreset, updateManagedLtUserPreset, renameManagedLtUserPreset,
    deleteManagedLtUserPreset, applyLtPreset, updateLtLineSettings, updateLtToneSettings,
    updateLtExportHeight, updateLtExportAspectRatio, updateBackgroundSettings, updateLightingSettings,
    updateRenderExposure, applyMoodRig, applySunRigConfig, cameraLensInteractionLocked,
    commitCameraLensView, finishCameraLensGesture, previewCameraLens, updateCameraLens,
    applyTwoPointPerspective, resetTwoPointPerspective, readCurrentCanonicalSceneForShot, commitAppliedShot,
    captureCurrentShot, applySavedShot, duplicateActiveShot, moveSavedShot,
    removeSavedShot, exportSavedShotsAsZip, updateBackgroundTransparency, selectedIdsRef,
    undoRef, redoRef, deleteSelectedRef, onCaptureUpdate,
    requestModalDismiss, requestUserClose, handleSaveToLibrary, handleUseAsAiMethodReference,
    handleInsert, firstSelectedId, selectedPrimitive, selectedCustomModel,
    selectedEntity, selectedModelCacheEntry, selectedSemanticMaterials, selectedSemanticAssignments,
    selectedCharacterPassPlan, selectedBackgroundPassPlan, selectedModelAnimations, selectedModelJoints,
    selectedGenericModelManifest, selectedGenericModelProxies, effectiveGenericModelProxyId, changeSelectedGenericModelClassification,
    changeGenericModelControlMode, selectGenericModelProxy, selectedJointByKey, selectedPoseRigSelection,
    selectedPoseJointKey, selectedPoseCanonicalKey, selectedPoseJoint, selectedHasEffectiveRigConstraint,
    selectedRigBakeDisabledReason, selectedAimConstraint, selectedIkProtectedJointKeys, selectedAimSuppressedByIk,
    selectedIkEndCandidates, savedIkEndJointKey, requestedIkEndJointKey, selectedIkEndJointKey,
    selectedIkRigSelection, selectedIkEndJoint, selectedIkMiddleJoint, selectedIkUpperJoint,
    selectedTwoBoneIkConstraint, selectedIkChainKeys, selectedIkHasOverlap, selectedIkLimitReached,
    selectedIkWorldMatrix, selectedIkSourceRoot, selectedIkTransformSupported, selectedPoseEulerDegrees,
    selectedModelMorphTargets, selectedMorphTargetCandidateKey, selectedMorphTargetKey, selectedMorphOverride,
    selectedAnimationClip, selectedAnimationDuration, commitSelectedPoseOverride, commitSelectedAimConstraint,
    commitSelectedTwoBoneIkConstraint, selectedIsLocked, selectedEntities, canGroundSelection,
    selectedPlaceableModels, cancelMeasurement, measurementInferenceReferences, resolveMeasurementCandidate,
    updateMeasurementPreview, pickMeasurementPoint, handleMeasurementSurfacePreview, handleMeasurementLengthLockChange,
    toggleMeasurement, toggleSurfaceSnap, handleSurfaceSnapPick, hideOnTab,
    cancelPhysicsAnimationFrame, updatePhysicsProgress, restorePhysicsInitialPose, resetPhysicsPreview,
    failPhysicsPreview, physicsPlaybackFrame, startPhysicsPlayback, pausePhysicsPreview,
    resumePhysicsPreview, startPhysicsPreview, handleStartPhysicsPreview, bakePhysicsPreview,
    runBabylonDiagnostic, pausePhysicsWhenHidden, selectSceneEntity, updateModelCloneStatuses,
    renderSceneEntity, sharedCharacterSceneContent, startStudioBg3dWebXr, endStudioBg3dWebXr,
    sceneContent, applyLensShift, mainCameraNode, immersiveCameraNode,
    mainScenePresentationNode, commonOrbitControls, commitSharedCharacterTransform, effectiveSelectedSharedCharacter,
    effectiveSelectedSharedCharacterElementId, includeSharedCharactersInCapture, mayApplyEmptySharedStageMutation, selectSharedStageMutation,
    setSelectedSharedCharacterElementId, setSharedStageMaterializationKind, setSharedStageMutationKind, sharedCharacterCaptureElementIds,
    sharedCharacterCaptureReadiness, sharedCharacterGroundings, sharedCharacterPreviewOmissionCount, sharedCharacterReadyCount,
    sharedCharacterRelationshipLabel, sharedCharacterStatuses, sharedCharacterUnavailableCount, sharedCharacters,
    sharedStageMaterializationKind, sharedStageMutationKind, shouldStartOnSharedStageLayerTab, targetHasLinkedCharacters,
    targetHasSavedSharedScene, updateSharedCharacterGrounding, updateSharedCharacterStatus, handleUploadModelFiles,
    handleDeleteModelFromLibrary,
    // 파일 분할 때 목록에서 빠져 ReferenceError 를 던지던 식별자들(런타임 값 위치) — 복구.
    canPlaceSelectedModelRecipe, centerGroundSelectionDisabledReason, groundSelectionDisabledReason, magicLayerEffectivelyVisibleIds, sharedStageUpdateBlockedReason, transformSpace,
    captureBackgroundSnapshot, immersiveStagePlan, placementPreviewAsset, sceneRecoveryError,
    webXrController, webXrSessionState, engineRuntime,
  } = { ...R, ...h };

  const snapSettingsSummary = studioBg3dSnapSettingsSummary(snapSettings);
  const quadViewHint: StudioToolHintSpec = isQuadView
    ? {
        ...BG3D_VIEWPORT_HINTS.quad,
        title: "단일 뷰로 복귀",
        description: "다음 클릭으로 4분할 화면을 닫고 원근 단일 뷰로 돌아가 장면 편집 공간을 넓힙니다.",
        preview: "quad-view",
        previewVariant: "close",
        tip: "필요할 때 같은 버튼을 다시 누르면 네 시점을 함께 열 수 있어요.",
      }
    : BG3D_VIEWPORT_HINTS.quad;
  const snapToggleHint: StudioToolHintSpec = snapSettings.enabled
    ? {
        ...BG3D_VIEWPORT_HINTS.snap,
        title: "변형 스냅 끄기",
        description: `다음 클릭으로 이동·회전 스냅을 끕니다. 현재 설정: ${snapSettingsSummary}.`,
        preview: "object-snap",
        previewVariant: "disable",
        tip: "다시 켜면 현재 간격과 축 설정을 그대로 이어서 사용할 수 있어요.",
      }
    : {
        ...BG3D_VIEWPORT_HINTS.snap,
        description: `${BG3D_VIEWPORT_HINTS.snap.description} 현재 설정: ${snapSettingsSummary}.`,
      };
  const lineArtPreviewHint: StudioToolHintSpec = lineArtPreview
    ? {
        ...BG3D_VIEWPORT_HINTS.linePreview,
        title: "선화 미리보기 끄기",
        description: "다음 클릭으로 외곽선 중심 미리보기를 끄고 재질색과 조명이 적용된 컬러 장면으로 돌아갑니다.",
        preview: "line-art",
        previewVariant: "disable",
        tip: "필요할 때 같은 버튼으로 외곽선 미리보기를 다시 켤 수 있어요.",
      }
    : BG3D_VIEWPORT_HINTS.linePreview;
  const surfaceSnapHint: StudioToolHintSpec = surfaceSnapArmed
    ? {
        ...BG3D_VIEWPORT_HINTS.surfaceSnap,
        title: "표면 붙이기 취소",
        description: "현재 다른 객체의 표면 클릭을 기다리고 있습니다. 이 버튼이나 Esc를 누르면 배치하지 않고 취소합니다.",
        previewVariant: "disable",
        tip: "객체를 클릭해도 현재 선택은 바뀌지 않습니다.",
      }
    : BG3D_VIEWPORT_HINTS.surfaceSnap;
  const layerListItems: StudioBg3dLayerListItem[] = [
    ...primitives.map((prim, index) => {
      const kindCountBefore = primitives.slice(0, index).filter((p) => p.kind === prim.kind).length;
      return {
        id: prim.id,
        label: prim.name || `${PRIMITIVE_DEFS[prim.kind].label} ${kindCountBefore + 1}`,
        kind: "primitive" as const,
        visible: isBgObjectVisible(prim),
        locked: isBgObjectLocked(prim),
        parentId: prim.parentId,
      };
    }),
    ...customModels.map((inst, index) => {
      const kindCountBefore = customModels.slice(0, index).filter((m) => m.modelId === inst.modelId).length;
      const modelName = modelLibrary.find((entry) => entry.id === inst.modelId)?.name ?? "3D 모델";
      return {
        id: inst.id,
        label: inst.name || `${modelName} ${kindCountBefore + 1}`,
        kind: "model" as const,
        visible: isBgObjectVisible(inst),
        locked: isBgObjectLocked(inst),
        parentId: inst.parentId,
      };
    }),
  ];
  const sceneHierarchy = resolveStudioBg3dHierarchy(layerListItems);
  const effectivelyVisibleLayerIds = collectStudioBg3dEffectivelyVisibleEntityIds(layerListItems);
  const surfaceSnapDisabledReason = isQuadView
    ? "표면 붙이기는 단일 뷰에서만 사용할 수 있습니다."
    : isCapturing || isBatchRenderingShots
      ? "3D 장면을 캡처하는 중에는 표면 붙이기를 사용할 수 없습니다."
      : isRestoringScene || isUploadingModel || applyingTemplateId !== null ||
          deletingModelId !== null || isSavingTemplate
        ? "3D 장면 또는 모델 작업이 끝난 뒤 표면 붙이기를 사용해 주세요."
        : physicsInteractionLocked || isTransforming
          ? "물리 미리보기나 변형 작업 중에는 표면 붙이기를 사용할 수 없습니다."
          : selectedIds.size === 0
            ? "표면에 붙일 객체를 선택해 주세요."
            : selectedIds.size > STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS
              ? `표면 붙이기는 한 번에 최대 ${STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS}개까지 지원합니다.`
              : selectedEntities.length === 0
                ? "표면에 붙일 객체를 선택해 주세요."
                : selectedEntities.every((entity) => isBgObjectTransformBlocked(entity))
                  ? "선택한 객체의 잠금을 먼저 해제해 주세요."
                  : selectedEntities.every((entity) => !effectivelyVisibleLayerIds.has(entity.id))
                    ? "숨겨진 객체는 표면에 붙일 수 없습니다."
                    : selectedEntities.every((entity) => {
                        const custom = customModels.find((model) => model.id === entity.id);
                        if (custom && !readyCloneIds.has(custom.id)) return true;
                        return !primitiveObjectsRef.current.has(entity.id);
                      })
                      ? "선택한 객체의 지오메트리를 준비하는 중입니다."
                      : null;
  const measurementDisabledReason = isQuadView
    ? "줄자는 단일 뷰에서만 사용할 수 있습니다."
    : isCapturing || isBatchRenderingShots
      ? "3D 장면을 캡처하는 중에는 줄자를 사용할 수 없습니다."
      : isRestoringScene || isUploadingModel || applyingTemplateId !== null ||
          deletingModelId !== null || isSavingTemplate
        ? "3D 장면 또는 모델 작업이 끝난 뒤 줄자를 사용해 주세요."
        : physicsInteractionLocked || isTransforming ||
            (placementSession.phase === "preview" && placementPreviewAsset !== null)
          ? "배치·물리·변형 작업이 끝난 뒤 줄자를 사용해 주세요."
          : null;
  const focusSelectionDisabledReason = isCapturing || isBatchRenderingShots || isRestoringScene ||
      physicsInteractionLocked
    ? "다른 3D 작업이 끝난 뒤 화면 맞춤을 사용해 주세요."
    : selectedIds.size !== 1 || !selectedEntity
      ? "화면에 맞출 객체를 하나만 선택해 주세요."
      : !effectivelyVisibleLayerIds.has(selectedEntity.id)
        ? "숨겨진 객체는 화면에 맞출 수 없습니다."
        : selectedCustomModel && !readyCloneIds.has(selectedCustomModel.id)
          ? failedCloneIds.has(selectedCustomModel.id)
            ? "선택한 모델 지오메트리를 불러오지 못했습니다."
            : "선택한 모델 지오메트리를 준비하는 중입니다."
          : !primitiveObjectsRef.current.has(selectedEntity.id)
            ? "선택한 객체의 지오메트리를 준비하는 중입니다."
            : null;

  let physicsSelectionUnavailableReason: string | null = null;
  if (selectedIds.size > STUDIO_BG3D_PHYSICS_MAX_DYNAMIC_BODIES) {
    physicsSelectionUnavailableReason =
      `한 번에 최대 ${STUDIO_BG3D_PHYSICS_MAX_DYNAMIC_BODIES}개 오브젝트를 시뮬레이션할 수 있습니다.`;
  } else {
    for (const id of selectedIds) {
      const entity = primitives.find((primitive) => primitive.id === id) ??
        customModels.find((model) => model.id === id);
      if (!entity || !isBgObjectVisible(entity)) {
        physicsSelectionUnavailableReason = "숨긴 오브젝트는 물리 미리보기에 사용할 수 없습니다.";
        break;
      }
      if (isBgObjectTransformBlocked(entity)) {
        physicsSelectionUnavailableReason = "선택한 오브젝트의 잠금을 먼저 해제하세요.";
        break;
      }
      if ((sceneHierarchy.parentById.get(id) ?? null) !== null) {
        physicsSelectionUnavailableReason = "그룹 안의 자식 대신 독립된 최상위 오브젝트를 선택하세요.";
        break;
      }
      if ((sceneHierarchy.childrenByParent.get(id)?.length ?? 0) > 0) {
        physicsSelectionUnavailableReason = "자식이 있는 그룹은 아직 동적 충돌체로 바꿀 수 없습니다.";
        break;
      }
      const model = customModels.find((candidate) => candidate.id === id);
      const cacheEntry = model ? modelRootCacheRef.current.get(model.modelId) : undefined;
      if (
        model && (
          model.animation !== undefined || model.pose !== undefined || model.morph !== undefined ||
          model.constraints !== undefined || (cacheEntry?.metrics.skins ?? 0) > 0 ||
          (cacheEntry?.metrics.morphTargets ?? 0) > 0
        )
      ) {
        physicsSelectionUnavailableReason =
          "리그·애니메이션 모델은 자세를 고정하거나 일반 소품 모델로 바꾼 뒤 사용하세요.";
        break;
      }
    }
  }
  if (!physicsSelectionUnavailableReason) {
    const unsupportedVisibleModel = customModels.find((model) => {
      if (!effectivelyVisibleLayerIds.has(model.id)) return false;
      const cacheEntry = modelRootCacheRef.current.get(model.modelId);
      return model.animation !== undefined || model.pose !== undefined || model.morph !== undefined ||
        model.constraints !== undefined || (cacheEntry?.metrics.skins ?? 0) > 0 ||
        (cacheEntry?.metrics.morphTargets ?? 0) > 0;
    });
    if (unsupportedVisibleModel) {
      physicsSelectionUnavailableReason =
        "보이는 리그·애니메이션·모프 모델은 현재 자세와 충돌체가 어긋날 수 있습니다. 해당 모델을 숨기거나 정적 소품으로 고정한 뒤 물리를 실행하세요.";
    }
  }
  const filteredLayerItems = filterStudioBg3dLayerItems(layerListItems, layerQuery);
  const ltLineSettings = sceneBaseDocument.output.line;
  const ltToneSettings = sceneBaseDocument.output.tone;
  const hasFilledOutput = ltToneSettings.mode !== "none" && ltToneSettings.opacity > 0;
  const appliedLtPreset = matchingLtPreset(
    ltLineSettings,
    ltToneSettings,
    ltUserPresetPayload,
    ltPreferredPresetId
  );
  const appliedLtPresetId = appliedLtPreset?.id ?? "custom";
  const appliedMoodRig = resolveStudioBg3dAppliedMoodRig(sceneBaseDocument);
  const managedLtUserPreset = ltManagedUserPresetId
    ? ltUserPresetPayload.presets.find((preset) => preset.id === ltManagedUserPresetId) ?? null
    : null;
  const ltExportAspectRatio = sceneBaseDocument.output.exportAspectRatio ?? null;
  // 세이프 프레임 오버레이와 라벨은 실제 캡처와 같은 식(같은 순수 함수)을 쓴다. 자동일 때만
  // 뷰포트 비율을 따르고, 고정 비율이면 패널 크기와 무관하게 같은 결과가 나온다.
  const ltCaptureSafeFrame = resolveStudioBg3dCaptureFrame({
    viewportWidth: viewportBoxSize?.width ?? deviceQuality.renderWidth,
    viewportHeight: viewportBoxSize?.height ?? deviceQuality.renderHeight,
    aspectRatio: ltExportAspectRatio,
  });
  const ltCaptureSizePreview = resolveStudioBg3dLtCaptureSize({
    sourceWidth: deviceQuality.renderWidth,
    sourceHeight: deviceQuality.renderHeight,
    ...(ltCaptureSafeFrame ? { aspectRatio: ltCaptureSafeFrame.aspectRatio } : {}),
    requestedHeight: sceneBaseDocument.output.exportHeight,
    maxPixels: Math.min(deviceQuality.maxRenderPixels, STUDIO_BG3D_LT_RENDER_MAX_PIXELS),
  });
  const ltDocumentAspectPreset = createStudioBg3dDocumentCaptureAspectPreset(
    documentCanvasSize?.width,
    documentCanvasSize?.height,
  );
  const ltCaptureAspectPresets = ltDocumentAspectPreset
    ? [
        STUDIO_BG3D_CAPTURE_ASPECT_PRESETS[0]!,
        ltDocumentAspectPreset,
        ...STUDIO_BG3D_CAPTURE_ASPECT_PRESETS.slice(1),
      ]
    : STUDIO_BG3D_CAPTURE_ASPECT_PRESETS;
  const ltCaptureAspectPresetId = matchStudioBg3dCaptureAspectPreset(
    ltExportAspectRatio,
    ltCaptureAspectPresets,
  );
  const ltCaptureAspectLabel = ltCaptureAspectPresets.find(
    (preset) => preset.id === ltCaptureAspectPresetId,
  )?.label ?? `${(ltExportAspectRatio ?? 1).toFixed(2)} : 1`;
  const placementActive =
    placementSession.phase === "preview" && placementPreviewAsset !== null;
  const immersiveSceneActive = immersiveStagePlan !== null;
  const immersiveTransitionActive = webXrSessionState.status === "requesting"
    || webXrSessionState.status === "presenting"
    || webXrSessionState.status === "ending";
  // Capture renders the main View's virtual Scene/Camera into an offscreen target, so the quad
  // topology can remain intact. Keeping this View mounted prevents linked VRMs, wardrobe, props,
  // auto-grip, and their post-commit readiness generation from restarting during capture.
  const effectiveIsQuadView = isQuadView
    && !physicsInteractionLocked
    && !placementActive
    && !immersiveSceneActive;
  const mainViewTrackRef = effectiveIsQuadView ? viewPerspRef : viewportHostRef;
  const bg3dFrameLoop = immersiveSceneActive
    ? "always"
    : resolveStudioBg3dFrameLoop({
        modelAnimationPlaying: customModels.some((model) => model.animation?.playing === true),
        physicsPlaying: physicsPhase === "running",
        transforming: isTransforming,
        capturing: isCapturing,
        batchRendering: isBatchRenderingShots,
      });
  const isMainOrtho = sceneBaseDocument.camera.projection === "orthographic";
  const currentFocalLengthMm = Math.round(
    studioBg3dFovDegreesToFocalLength(sceneBaseDocument.camera.fovDegrees),
  );
  const twoPointPerspectiveActive =
    isStudioBg3dTwoPointPerspectiveActive(sceneBaseDocument.camera) &&
    Math.abs(readStudioBg3dCameraDutchRollDegrees(sceneBaseDocument.camera)) < 0.5;
  const sunLightState = resolveStudioBg3dSunLightState(sunRigConfig.timeOfDayHours);
  const selectedSky = getSkyPreset(skyPresetId);
  const panoramaRotation = normalizePanoramaRotationDegrees(
    sceneBaseDocument.background.panoramaRotation,
  );
  const renderedSkyPresetId = captureBackgroundSnapshot?.skyPresetId ?? skyPresetId;
  const renderedPanoramaRotation =
    captureBackgroundSnapshot?.panoramaRotation ?? panoramaRotation;
  const renderedBackgroundSettings =
    captureBackgroundSnapshot?.background ?? sceneBaseDocument.background;
  const fogNear = sceneBaseDocument.background.fogNear ?? 10;
  const fogFar = Math.max(
    fogNear + STUDIO_BG3D_FOG_MIN_GAP,
    sceneBaseDocument.background.fogFar ?? 50,
  );
  const fogSliderMax = Math.max(
    120,
    Math.ceil(Math.max(fogNear + STUDIO_BG3D_FOG_MIN_GAP, fogFar) / 10) * 10,
  );
  const primitiveById = new Map(primitives.map((primitive) => [primitive.id, primitive] as const));
  const customModelById = new Map(customModels.map((model) => [model.id, model] as const));
  const sharedCharacterGroundSurfaceRevision =
    createStudioBg3dSharedCharacterGroundSurfaceRevision({
      primitives,
      customModels,
      readyCloneIds,
    });
  const batchCandidatesByModelId = new Map<string, BgCustomModelInstance[]>();
  for (const model of customModels) {
    const cacheEntry = modelRootCacheRef.current.get(model.modelId);
    if (
      !cacheEntry || unbatchableModelIds.has(model.modelId) || !isBgObjectVisible(model) ||
      selectedIds.has(model.id) || (sceneHierarchy.parentById.get(model.id) ?? null) !== null ||
      (sceneHierarchy.childrenByParent.get(model.id)?.length ?? 0) > 0 ||
      model.materialOverride !== undefined || model.animation !== undefined || model.pose !== undefined ||
      model.morph !== undefined || model.constraints !== undefined ||
      cacheEntry.metrics.skins > 0 || cacheEntry.metrics.morphTargets > 0 || cacheEntry.metrics.lights > 0 ||
      model.scale.some((component) => component <= 0)
    ) continue;
    const candidates = batchCandidatesByModelId.get(model.modelId) ?? [];
    candidates.push(model);
    batchCandidatesByModelId.set(model.modelId, candidates);
  }
  const staticModelBatches: {
    readonly key: string;
    readonly modelId: string;
    readonly sourceRoot: THREE.Object3D;
    readonly instances: readonly BgCustomModelInstance[];
  }[] = [];
  const batchedNodeIds = new Set<string>();
  for (const [modelId, candidates] of batchCandidatesByModelId) {
    const sourceRoot = modelRootCacheRef.current.get(modelId)?.root;
    if (!sourceRoot) continue;
    for (let offset = 0; offset < candidates.length; offset += 1_024) {
      const instances = candidates.slice(offset, offset + 1_024);
      if (instances.length < 3) continue;
      const key = instances.map((instance) => [
        instance.id,
        ...instance.position,
        ...instance.rotation,
        ...instance.scale,
      ].join(":")).join("|");
      staticModelBatches.push({ key, modelId, sourceRoot, instances });
      for (const instance of instances) batchedNodeIds.add(instance.id);
    }
  }
  const shadowSceneBounds = collectStudioBg3dShadowSceneBounds([
    ...primitives.map((primitive) => ({
      id: primitive.id,
      parentId: primitive.parentId,
      position: primitive.position,
      rotation: primitive.rotation,
      scale: primitive.scale,
      visible: primitive.visible,
      localBounds: readStudioBg3dShadowGeometryLocalBounds(
        primitiveGeometryPool.get(primitive.kind).geometry,
      ),
    })),
    ...customModels.map((model) => ({
      id: model.id,
      parentId: model.parentId,
      position: model.position,
      rotation: model.rotation,
      scale: model.scale,
      visible: model.visible,
      localBounds: readStudioBg3dShadowModelLocalBounds(
        modelRootCacheRef.current.get(model.modelId)?.root,
      ),
    })),
    ...sharedCharacters.map(createStudioShared3dCharacterShadowEntity),
  ]);
  const shadowMapSize = deviceQuality.shadowMapSize || 1_024;
  const keyShadowFit = fitStudioBg3dDirectionalShadowFrustum({
    bounds: shadowSceneBounds.bounds,
    boundsWereClamped: shadowSceneBounds.clamped,
    direction: sceneBaseDocument.lighting.key.direction,
    focus: sceneBaseDocument.camera.target,
    groundY: 0,
    mapSize: shadowMapSize,
  });
  const fillShadowFit = fitStudioBg3dDirectionalShadowFrustum({
    bounds: shadowSceneBounds.bounds,
    boundsWereClamped: shadowSceneBounds.clamped,
    direction: sceneBaseDocument.lighting.fill.direction,
    focus: sceneBaseDocument.camera.target,
    groundY: 0,
    mapSize: shadowMapSize,
  });

  // 몰입형 브리지는 `WebGLRenderer.xr` 을 구동한다. WebGPU 세션에서 시작을 허용하면
  // `controller.start()` 가 WebGPU canvas 의 controller 로 네이티브 세션을 이미 요청한 뒤에야
  // 엔진 정책이 선택된 WebGPU 를 사용 불가로 만들고 Canvas 를 내리면서 요청 중인 controller 를
  // 파괴한다 — 아티스트의 첫 시도가 조용히 취소된다. 먼저 엔진 선택을 바꾼 뒤 start 를 부르는 것도
  // 답이 아니다: 클릭의 user activation 이 그 사이에 사라진다. 그래서 시작 자체를 막고,
  // 무엇을 해야 하는지 말해 준다.
  const webXrDisabledReason = engineRuntime?.plan?.backend === "webgpu"
    ? "몰입형(AR·VR) 미리보기는 WebGL2 엔진에서만 열립니다. 보기 탭의 3D 렌더 엔진에서 WebGL2를 고른 뒤 다시 시도해 주세요."
    : !webXrController
    ? "기존 Three.js 렌더러의 WebXR 연결을 준비하는 중입니다."
    : sceneRecoveryError
      ? "3D 장면 복원 오류를 해결한 뒤 AR·VR 미리보기를 열어 주세요."
      : hasCloneFailure || hasUnavailableSharedCharacter
        ? "불러오지 못한 3D 모델이 있어 모든 공간 경계를 검증할 수 없습니다."
        : hasPendingClone || hasPendingSharedCharacter
          ? "모든 3D 모델과 캐릭터가 표시될 때까지 기다려 주세요."
          : isCapturing || isBatchRenderingShots || captureInFlightRef.current
            ? "3D 캡처나 컷 배치 출력이 끝난 뒤 AR·VR 미리보기를 열어 주세요."
            : isRestoringScene
              ? "3D 장면 복원이 끝난 뒤 AR·VR 미리보기를 열어 주세요."
              : isUploadingModel || applyingTemplateId !== null || deletingModelId !== null
                || isSavingTemplate
                ? "3D 에셋 작업이 끝난 뒤 AR·VR 미리보기를 열어 주세요."
                : physicsInteractionLocked
                  ? "물리 미리보기를 적용하거나 초기화한 뒤 AR·VR 미리보기를 열어 주세요."
                  : isTransforming || placementActive || measurementActive || surfaceSnapArmed
                    ? "현재 배치·측정·변형 도구를 마친 뒤 AR·VR 미리보기를 열어 주세요."
                    : destructiveMutationGuardRef.current.blocksClose
                      ? "진행 중인 3D 변경을 마친 뒤 AR·VR 미리보기를 열어 주세요."
                      : shadowSceneBounds.includedEntityCount === 0
                        ? "몰입형 미리보기에 표시할 3D 오브젝트가 없습니다."
                        : shadowSceneBounds.clamped || shadowSceneBounds.rejectedEntityCount > 0
                          ? "일부 3D 오브젝트의 실제 공간 경계를 확인하지 못했습니다."
                          : null;
  const mainCameraNearClip = resolveStudioBg3dCameraNearClip(
    sceneBaseDocument.camera.nearClip,
  );
  const { farClip: mainCameraFarClip, maxOrbitDistance: mainCameraMaxOrbitDistance } =
    resolveStudioBg3dCameraDistanceLimits(
      sceneBaseDocument.camera.position, sceneBaseDocument.camera.target,
    );
  const mainCameraUp = resolveStudioBg3dCameraUpVector(sceneBaseDocument.camera);
  Object.assign(h, {
    isBatchRenderingShots,
    savedShots,
    shotBatchSelectedIds,
    selectedShotBatchPasses,
    skyPresetId,
    insertBackgroundIntent,
    transparentInsert,
    deviceQuality,
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
    firstSelectedId,
    selectedPrimitive,
    selectedCustomModel,
    selectedEntity,
    selectedModelCacheEntry,
    selectedSemanticMaterials,
    selectedSemanticAssignments,
    selectedCharacterPassPlan,
    selectedBackgroundPassPlan,
    selectedModelAnimations,
    selectedModelJoints,
    selectedGenericModelManifest,
    selectedGenericModelProxies,
    effectiveGenericModelProxyId,
    selectedIsLocked,
    selectedEntities,
    canGroundSelection,
    selectedPlaceableModels,
    canPlaceSelectedModelRecipe,
    groundSelectionDisabledReason,
    centerGroundSelectionDisabledReason,
    snapSettingsSummary,
    quadViewHint,
    snapToggleHint,
    lineArtPreviewHint,
    surfaceSnapHint,
    layerListItems,
    sceneHierarchy,
    effectivelyVisibleLayerIds,
    surfaceSnapDisabledReason,
    measurementDisabledReason,
    focusSelectionDisabledReason,
    physicsSelectionUnavailableReason,
    filteredLayerItems,
    ltLineSettings,
    ltToneSettings,
    hasFilledOutput,
    appliedLtPreset,
    appliedLtPresetId,
    appliedMoodRig,
    managedLtUserPreset,
    ltExportAspectRatio,
    ltCaptureSafeFrame,
    ltCaptureSizePreview,
    ltDocumentAspectPreset,
    ltCaptureAspectPresets,
    ltCaptureAspectPresetId,
    ltCaptureAspectLabel,
    placementActive,
    immersiveSceneActive,
    immersiveTransitionActive,
    effectiveIsQuadView,
    mainViewTrackRef,
    bg3dFrameLoop,
    isMainOrtho,
    currentFocalLengthMm,
    twoPointPerspectiveActive,
    sunLightState,
    selectedSky,
    panoramaRotation,
    renderedSkyPresetId,
    renderedPanoramaRotation,
    renderedBackgroundSettings,
    fogNear,
    fogFar,
    fogSliderMax,
    primitiveById,
    customModelById,
    sharedCharacterGroundSurfaceRevision,
    staticModelBatches,
    batchedNodeIds,
    shadowSceneBounds,
    shadowMapSize,
    keyShadowFit,
    fillShadowFit,
    webXrDisabledReason,
    mainCameraNearClip,
    mainCameraFarClip,
    mainCameraMaxOrbitDistance,
    mainCameraUp,
  });
}
