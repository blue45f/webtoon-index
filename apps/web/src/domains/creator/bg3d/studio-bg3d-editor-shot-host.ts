/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function attachStudioBg3dEditorShotHost(h) {
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
    updateRenderExposure, applyMoodRig, applySunRigConfig, selectedIdsRef,
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
    selectedPlaceableModels, snapSettingsSummary, sceneHierarchy, effectivelyVisibleLayerIds,
    surfaceSnapDisabledReason, measurementDisabledReason, focusSelectionDisabledReason, cancelMeasurement,
    measurementInferenceReferences, resolveMeasurementCandidate, updateMeasurementPreview, pickMeasurementPoint,
    handleMeasurementSurfacePreview, handleMeasurementLengthLockChange, toggleMeasurement, toggleSurfaceSnap,
    handleSurfaceSnapPick, physicsSelectionUnavailableReason, filteredLayerItems, ltLineSettings,
    ltToneSettings, hasFilledOutput, appliedLtPreset, appliedLtPresetId,
    appliedMoodRig, managedLtUserPreset, ltExportAspectRatio, ltCaptureSafeFrame,
    ltCaptureSizePreview, ltDocumentAspectPreset, ltCaptureAspectPresets, ltCaptureAspectPresetId,
    ltCaptureAspectLabel, hideOnTab, cancelPhysicsAnimationFrame, updatePhysicsProgress,
    restorePhysicsInitialPose, resetPhysicsPreview, failPhysicsPreview, physicsPlaybackFrame,
    startPhysicsPlayback, pausePhysicsPreview, resumePhysicsPreview, startPhysicsPreview,
    handleStartPhysicsPreview, bakePhysicsPreview, runBabylonDiagnostic, pausePhysicsWhenHidden,
    immersiveSceneActive, immersiveTransitionActive, effectiveIsQuadView, mainViewTrackRef,
    bg3dFrameLoop, isMainOrtho, currentFocalLengthMm, sunLightState,
    selectedSky, panoramaRotation, renderedSkyPresetId, fogNear,
    fogFar, fogSliderMax, selectSceneEntity, updateModelCloneStatuses,
    primitiveById, customModelById, batchCandidatesByModelId, batchedNodeIds,
    renderSceneEntity, sharedCharacterSceneContent, shadowSceneBounds, shadowMapSize,
    keyShadowFit, fillShadowFit, webXrDisabledReason, startStudioBg3dWebXr,
    endStudioBg3dWebXr, sceneContent, mainCameraNearClip, mainCameraUp,
    applyLensShift, mainCameraNode, immersiveCameraNode, mainScenePresentationNode,
    commonOrbitControls, commitSharedCharacterTransform, effectiveSelectedSharedCharacter, effectiveSelectedSharedCharacterElementId,
    includeSharedCharactersInCapture, mayApplyEmptySharedStageMutation, selectSharedStageMutation, setSelectedSharedCharacterElementId,
    setSharedStageMaterializationKind, setSharedStageMutationKind, sharedCharacterCaptureElementIds, sharedCharacterCaptureReadiness,
    sharedCharacterGroundings, sharedCharacterPreviewOmissionCount, sharedCharacterReadyCount, sharedCharacterRelationshipLabel,
    sharedCharacterStatuses, sharedCharacterUnavailableCount, sharedCharacters, sharedStageMaterializationKind,
    sharedStageMutationKind, shouldStartOnSharedStageLayerTab, targetHasLinkedCharacters, targetHasSavedSharedScene,
    updateSharedCharacterGrounding, updateSharedCharacterStatus, handleUploadModelFiles, handleDeleteModelFromLibrary,
    placementActive, twoPointPerspectiveActive, renderedPanoramaRotation, renderedBackgroundSettings,
    sharedCharacterGroundSurfaceRevision, staticModelBatches, mainCameraFarClip, mainCameraMaxOrbitDistance,
    quadViewHint, snapToggleHint, lineArtPreviewHint, surfaceSnapHint,
    // 파일 분할 때 목록에서 빠져 ReferenceError 를 던지던 식별자들(런타임 값 위치) — 복구.
    setCaptureBackgroundSnapshot,
  } = { ...R, ...h };

  function cameraLensInteractionLocked(): boolean {
    return (
      captureInFlightRef.current ||
      isCapturing ||
      isBatchRenderingShots ||
      isRestoringScene ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    );
  }
  h.cameraLensInteractionLocked = cameraLensInteractionLocked;
  function commitCameraLensView(
    beforeView: StudioBg3dCameraSettings,
    nextDocument: StudioBg3dSceneDocument,
  ): boolean {
    const beforeDocument = canonicalSceneDocument({
      ...nextDocument,
      camera: beforeView,
    });
    if (!beforeDocument) {
      viewportApiRef.current?.applyView(beforeView);
      setError("카메라 렌즈 설정을 장면 원본에 안전하게 적용하지 못했습니다.");
      return false;
    }
    if (JSON.stringify(beforeDocument.camera) !== JSON.stringify(nextDocument.camera)) {
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
    }
    setSceneBaseDocument(nextDocument);
    applyOrDeferStudioBg3dHistoryCamera(
      viewportApiRef.current,
      pendingInitialCameraRef,
      nextDocument.camera,
    );
    setError(null);
    return true;
  }
  h.commitCameraLensView = commitCameraLensView;
  function finishCameraLensGesture(): void {
    const beforeView = cameraLensGestureBeforeViewRef.current;
    const latestView = cameraLensGestureLatestViewRef.current;
    if (cameraLensGestureTimerRef.current !== null) {
      clearTimeout(cameraLensGestureTimerRef.current);
      cameraLensGestureTimerRef.current = null;
    }
    cameraLensGestureBeforeViewRef.current = null;
    cameraLensGestureLatestViewRef.current = null;
    if (!beforeView) return;
    // The controlled slider has already produced a canonical view. Prefer that exact intent over a
    // renderer readback that can still be one React/R3F commit behind on pointerup or keyup.
    const liveView = resolveStudioBg3dCameraGestureCommitView(
      latestView,
      viewportApiRef.current,
      sceneBaseDocument.camera,
    );
    const nextDocument = canonicalSceneDocument({
      ...sceneBaseDocument,
      camera: liveView,
    });
    if (!nextDocument) {
      viewportApiRef.current?.applyView(beforeView);
      setError("카메라 제스처를 안전한 장면 상태로 확정하지 못해 이전 구도로 되돌렸습니다.");
      return;
    }
    commitCameraLensView(beforeView, nextDocument);
  }
  h.finishCameraLensGesture = finishCameraLensGesture;
  function previewCameraLens(
    patch: (view: StudioBg3dCameraSettings) => Partial<StudioBg3dCameraSettings>,
  ): void {
    if (cameraLensInteractionLocked()) return;
    const liveView = viewportApiRef.current?.readView() ?? sceneBaseDocument.camera;
    cameraLensGestureBeforeViewRef.current ??= liveView;
    const nextDocument = canonicalSceneDocument({
      ...sceneBaseDocument,
      camera: { ...liveView, ...patch(liveView) },
    });
    if (!nextDocument) {
      setError("카메라 렌즈 미리보기를 안전하게 적용하지 못했습니다.");
      return;
    }
    cameraLensGestureLatestViewRef.current = nextDocument.camera;
    setSceneBaseDocument(nextDocument);
    applyOrDeferStudioBg3dHistoryCamera(
      viewportApiRef.current,
      pendingInitialCameraRef,
      nextDocument.camera,
    );
    if (cameraLensGestureTimerRef.current !== null) {
      clearTimeout(cameraLensGestureTimerRef.current);
    }
    // Pointer cancellation or a lost blur must not leave a preview outside history forever.
    cameraLensGestureTimerRef.current = setTimeout(finishCameraLensGesture, 800);
    setError(null);
  }
  h.previewCameraLens = previewCameraLens;
  function updateCameraLens(
    patch: (view: StudioBg3dCameraSettings) => Partial<StudioBg3dCameraSettings>,
  ): void {
    if (cameraLensInteractionLocked()) return;
    finishCameraLensGesture();
    const liveView = viewportApiRef.current?.readView() ?? sceneBaseDocument.camera;
    const nextDocument = canonicalSceneDocument({
      ...sceneBaseDocument,
      camera: { ...liveView, ...patch(liveView) },
    });
    if (!nextDocument) {
      setError("카메라 렌즈 설정을 장면 원본에 안전하게 적용하지 못했습니다.");
      return;
    }
    commitCameraLensView(liveView, nextDocument);
  }
  h.updateCameraLens = updateCameraLens;
  function applyTwoPointPerspective() {
    const liveView = viewportApiRef.current?.readView() ?? sceneBaseDocument.camera;
    const corrected = computeStudioBg3dTwoPointPerspective(liveView);
    if (!corrected) {
      setError("정수직 시점에서는 2점 투시 보정을 정의할 수 없습니다. 카메라를 조금 기울여 주세요.");
      return;
    }
    const up = createStudioBg3dCameraUpForDutchRoll({
      position: liveView.position,
      target: corrected.target,
    }, 0);
    if (!up) {
      setError("2점 투시의 수평 기준을 안전하게 계산하지 못했습니다.");
      return;
    }
    updateCameraLens((view) => ({
      target: corrected.target,
      lensShift: [view.lensShift?.[0] ?? 0, corrected.lensShiftY],
      up,
    }));
  }
  h.applyTwoPointPerspective = applyTwoPointPerspective;
  function resetTwoPointPerspective() {
    updateCameraLens((view) => ({ lensShift: [view.lensShift?.[0] ?? 0, 0] }));
  }
  h.resetTwoPointPerspective = resetTwoPointPerspective;
  function readCurrentCanonicalSceneForShot(): StudioBg3dSceneDocument | null {
    if (
      captureInFlightRef.current ||
      isCapturing ||
      isRestoringScene ||
      isBatchRenderingShots ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) {
      return null;
    }
    const currentView = viewportApiRef.current?.readView() ?? sceneBaseDocument.camera;
    const adaptation = tryAdaptStudioBg3dRuntimeToDocument({
      primitives,
      customModels,
      attachmentByStorageModelId: attachmentByStorageModelIdRef.current,
      baseDocument: { ...sceneBaseDocument, camera: currentView },
    });
    if (!adaptation.ok) {
      setError("현재 장면이 안전 예산을 초과해 컷 기록을 시작하지 않았습니다. 장면을 나누거나 일부 오브젝트를 정리해 주세요.");
      return null;
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
      setError("컷에 현재 장면을 손실 없이 기록할 수 없습니다. 문제가 있는 도형이나 모델을 확인해 주세요.");
      return null;
    }
    return adapted.document;
  }
  h.readCurrentCanonicalSceneForShot = readCurrentCanonicalSceneForShot;
  function commitAppliedShot(
    beforeDocument: StudioBg3dSceneDocument,
    appliedDocument: StudioBg3dSceneDocument,
  ): boolean {
    const projected = projectStudioBg3dShotVisibilityToRuntime(
      primitives,
      customModels,
      appliedDocument,
    );
    if (!projected) {
      setError("컷의 오브젝트 표시 상태를 현재 장면에 안전하게 적용하지 못했습니다.");
      return false;
    }
    commitImmediateHistoryTransition(
      projected.primitives,
      projected.customModels,
      appliedDocument,
      createStudioBg3dHistorySnapshot({
        primitives,
        customModels,
        document: beforeDocument,
      }),
    );
    setPrimitives(projected.primitives);
    setCustomModels(projected.customModels);
    setSceneBaseDocument(appliedDocument);
    if (viewportApiRef.current?.applyView(appliedDocument.camera) !== true) {
      // Projection changes replace the default R3F camera. The replacement controller consumes this
      // only after its own target-reset effect has completed.
      pendingInitialCameraRef.current = appliedDocument.camera;
    }
    setLineArtPreview(appliedDocument.output.line.enabled);
    setViewportHinted(true);
    const visibleIds = collectStudioBg3dEffectivelyVisibleEntityIds(appliedDocument.nodes);
    setSelectedIds((current) => new Set([...current].filter((id) => visibleIds.has(id))));
    setError(null);
    return true;
  }
  h.commitAppliedShot = commitAppliedShot;
  function captureCurrentShot() {
    const currentDocument = readCurrentCanonicalSceneForShot();
    if (!currentDocument) return;
    const shotCount = currentDocument.shots?.length ?? 0;
    if (shotCount >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS) {
      setError(`컷은 장면당 최대 ${STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS}개까지 저장할 수 있습니다.`);
      return;
    }
    const name = shotNameDraft.trim() || `컷 ${shotCount + 1}`;
    const captured = captureStudioBg3dShot(currentDocument, {
      id: createStudioBg3dShotId(currentDocument.shots),
      name,
    });
    if (!captured) {
      setError("컷 이름 또는 장면 데이터가 저장 한도를 벗어나 현재 구도를 기록하지 못했습니다.");
      return;
    }
    commitImmediateHistoryTransition(
      primitives,
      customModels,
      captured,
      createStudioBg3dHistorySnapshot({
        primitives,
        customModels,
        document: currentDocument,
      }),
    );
    setSceneBaseDocument(captured);
    setShotNameDraft("");
    setViewportHinted(true);
    setError(null);
  }
  h.captureCurrentShot = captureCurrentShot;
  function applySavedShot(shotId: string) {
    const currentDocument = readCurrentCanonicalSceneForShot();
    if (!currentDocument) return;
    const applied = applyStudioBg3dShot(currentDocument, shotId);
    if (!applied) {
      setError("선택한 컷을 현재 장면에 안전하게 적용하지 못했습니다.");
      return;
    }
    commitAppliedShot(currentDocument, applied);
  }
  h.applySavedShot = applySavedShot;
  function duplicateActiveShot() {
    const currentDocument = readCurrentCanonicalSceneForShot();
    if (!currentDocument) return;
    const source = currentDocument.shots?.find(
      (shot) => shot.id === currentDocument.activeShotId,
    );
    if (!source) {
      setError("복제할 컷을 먼저 선택해 주세요.");
      return;
    }
    const duplicateId = createStudioBg3dShotId(currentDocument.shots);
    const duplicated = duplicateStudioBg3dShot(currentDocument, source.id, {
      id: duplicateId,
      name: `${source.name} 사본`.slice(0, 80).trim(),
    });
    const applied = duplicated ? applyStudioBg3dShot(duplicated, duplicateId) : null;
    if (!applied) {
      setError("컷 개수 또는 문서 저장 한도를 벗어나 복제하지 못했습니다.");
      return;
    }
    commitAppliedShot(currentDocument, applied);
  }
  h.duplicateActiveShot = duplicateActiveShot;
  function moveSavedShot(shotId: string, targetIndex: number) {
    const currentDocument = readCurrentCanonicalSceneForShot();
    if (!currentDocument) return;
    const moved = moveStudioBg3dShot(currentDocument, shotId, targetIndex);
    if (!moved) {
      setError("컷 순서를 안전하게 변경하지 못했습니다.");
      return;
    }
    commitImmediateHistoryTransition(
      primitives,
      customModels,
      moved,
      createStudioBg3dHistorySnapshot({
        primitives,
        customModels,
        document: currentDocument,
      }),
    );
    setSceneBaseDocument(moved);
    setError(null);
  }
  h.moveSavedShot = moveSavedShot;
  function removeSavedShot(shotId: string) {
    const currentDocument = readCurrentCanonicalSceneForShot();
    if (!currentDocument) return;
    const removed = removeStudioBg3dShot(currentDocument, shotId);
    if (!removed) {
      setError("선택한 컷을 안전하게 삭제하지 못했습니다.");
      return;
    }
    commitImmediateHistoryTransition(
      primitives,
      customModels,
      removed,
      createStudioBg3dHistorySnapshot({
        primitives,
        customModels,
        document: currentDocument,
      }),
    );
    setSceneBaseDocument(removed);
    setError(null);
  }
  h.removeSavedShot = removeSavedShot;
  function updateBackgroundTransparency(transparent: boolean) {
    const modeResult = resolveStudioBg3dInsertBackgroundMode({ transparent });
    if (!modeResult.ok) {
      setError(modeResult.reason);
      return;
    }
    setSceneBaseDocument((current) => {
      const candidate: StudioBg3dSceneDocument = {
        ...current,
        background: {
          ...current.background,
          mode: modeResult.plan.documentBackgroundMode,
        },
        output: {
          ...current.output,
          transparentBackground: modeResult.plan.transparent,
        },
      };
      return canonicalSceneDocument(candidate) ?? current;
    });
    setError(null);
  }
  h.updateBackgroundTransparency = updateBackgroundTransparency;
  const exportSavedShotsAsZip = createStudioBg3dShotBatchExportRunner({
    acquireSharedCharacterCaptureAuthority,
    captureInFlightRef,
    captureRef,
    componentActiveRef,
    customModels,
    deviceSignals,
    lineArtPreview,
    pendingInitialCameraRef,
    primitives,
    readCurrentCanonicalSceneForShot,
    recoveryScope,
    sceneBaseDocument,
    selectedShotBatchPasses,
    setCaptureBackgroundSnapshot,
    setCustomModels,
    setError,
    setIsCapturing,
    setLineArtPreview,
    setPrimitives,
    setSceneBaseDocument,
    setShotBatchProgress,
    setShotBatchRecoverySummary,
    shotBatchAbortRef,
    shotBatchAuthorizationEpochRef,
    shotBatchBlockedReason,
    shotBatchExportHeight,
    shotBatchIncludeContactSheet,
    shotBatchIncludeLayeredPsd,
    shotBatchRecoveryRef,
    shotBatchRecoveryScopeRef,
    shotBatchRecoveryStoreRef,
    shotBatchSelectedIds,
    validateRecoveryAccess,
    verifySharedCharacterCaptureAuthority,
    viewportApiRef,
  });
  h.exportSavedShotsAsZip = exportSavedShotsAsZip;

}
