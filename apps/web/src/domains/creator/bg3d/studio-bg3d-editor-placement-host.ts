/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";
import {
  allocateStudioBg3dTemplateInstanceNodeIds,
  orderStudioBg3dHierarchySelectionRootsFirst,
} from "./studio-bg3d-template-instance";

export function attachStudioBg3dEditorPlacementHost(h) {
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
    focusSelectedEntity, registerPrimitiveRef, handlePanelTabChange,
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
    genericModelClassifications, genericModelSourceFormats, placementPreviewAsset, setGenericModelSourceFormats, setPlacementPreviewAsset, setRefTick,
  } = { ...R, ...h };

  async function ensureModelRootCached(
    modelId: string,
    session: StudioBg3dModalSession,
    isOperationCurrent: () => boolean,
    signal: AbortSignal,
  ): Promise<Bg3dVerifiedStoredRecord | null> {
    const record = await getStoredBg3dModel(modelId);
    if (!isOperationCurrent()) throw new StudioBg3dStaleModalOperationError();
    if (!record) return null;
    const existingAttachment = attachmentByStorageModelIdRef.current.get(modelId);
    const sourceFormat =
      normalizeStudioGeneric3dSourceFormat(genericModelSourceFormats.get(modelId))
      ?? parseStudioGeneric3dWorkflowMetadata(existingAttachment)?.sourceFormat
      ?? "glb";
    const classification =
      normalizeStudioGeneric3dClassification(genericModelClassifications.get(modelId))
      ?? parseStudioGeneric3dWorkflowMetadata(existingAttachment)?.classification
      ?? null;
    const attachment = withStudioGeneric3dWorkflowMetadata(
      existingAttachment ?? await createStudioBg3dModelAttachment(record),
      { sourceFormat, classification },
    );
    const live = physicsRuntimeSourceRef.current;
    assertStudioBg3dModelAttachmentAdmission({
      models: live.customModels,
      attachments: attachmentByStorageModelIdRef.current,
      candidateAttachments: [attachment],
      maximumAttachments: STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
      maximumCumulativeBytes: live.document.budgets.complexity.maxModelBytes,
    });
    const cumulativeUsedBytes = calculateStudioBg3dPlacedModelBytes(
      live.customModels,
      attachmentByStorageModelIdRef.current,
      modelId
    );
    await admitAndCacheModel({
      record,
      document: live.document,
      quality: resolveDeviceQuality(live.document, viewportHostRef.current),
      cumulativeUsedBytes,
      renderer: modelRenderer,
      cache: modelRootCacheRef.current,
      pending: modelLoadPendingRef.current,
      isActive: () => isModalAssetSessionCurrent(session) && isOperationCurrent(),
      signal,
    });
    if (!isOperationCurrent()) throw new StudioBg3dStaleModalOperationError();
    if (!bindModelAttachment({
      attachmentByStorageModelId: attachmentByStorageModelIdRef.current,
      storageModelIdByAttachmentId: storageModelIdByAttachmentIdRef.current,
    }, record, attachment)) {
      return null;
    }
    setGenericModelSourceFormats((previous) =>
      previous.get(modelId) === sourceFormat
        ? previous
        : mergeStudioGeneric3dWorkflowMaps(previous, new Map([[modelId, sourceFormat]])),
    );
    return record;
  }
  h.ensureModelRootCached = ensureModelRootCached;
  function publishPlacementSession(next: StudioBg3dPlacementSessionState): void {
    placementSessionRef.current = next;
    setPlacementSession(next);
  }
  h.publishPlacementSession = publishPlacementSession;
  function cancelCustomModelPlacement(message?: string): void {
    const current = placementSessionRef.current;
    if (current.phase === "preview") {
      const transition = transitionStudioBg3dPlacementSession(current, {
        type: "escape",
        placementToken: current.identity.placementToken,
      });
      if (transition.ok) publishPlacementSession(transition.state);
    }
    setPlacementPreviewAsset(null);
    if (message) setSurfaceSnapStatus({ tone: "info", message });
  }
  h.cancelCustomModelPlacement = cancelCustomModelPlacement;
  function moveCustomModelPlacement(
    target: StudioBg3dPlacementPointerTarget,
    shiftKey: boolean,
  ): void {
    const current = placementSessionRef.current;
    if (current.phase !== "preview") return;
    const transition = transitionStudioBg3dPlacementSession(current, {
      type: "pointer-move",
      placementToken: current.identity.placementToken,
      shiftKey,
      ...target,
    });
    if (transition.ok) publishPlacementSession(transition.state);
  }
  h.moveCustomModelPlacement = moveCustomModelPlacement;
  function rotateCustomModelPlacement(direction: "clockwise" | "counter-clockwise"): void {
    const current = placementSessionRef.current;
    if (current.phase !== "preview") return;
    const transition = transitionStudioBg3dPlacementSession(current, {
      type: "rotate",
      placementToken: current.identity.placementToken,
      direction,
    });
    if (transition.ok) publishPlacementSession(transition.state);
  }
  h.rotateCustomModelPlacement = rotateCustomModelPlacement;
  function commitCustomModelPlacement(
    target: StudioBg3dPlacementPointerTarget,
    shiftKey: boolean,
  ): void {
    const current = placementSessionRef.current;
    const asset = placementPreviewAsset;
    if (current.phase !== "preview" || !asset) return;
    if (!canAdmitSceneNodes(1)) return;
    const moved = transitionStudioBg3dPlacementSession(current, {
      type: "pointer-move",
      placementToken: current.identity.placementToken,
      shiftKey,
      ...target,
    });
    if (!moved.ok || moved.state.phase !== "preview") return;
    const committed = transitionStudioBg3dPlacementSession(moved.state, {
      type: "click-commit",
      placementToken: moved.state.identity.placementToken,
    });
    const plan = committed.ok ? committed.commitPlan : null;
    if (!plan || plan.storageId !== asset.modelId) return;

    const normal = new THREE.Vector3(...plan.placement.worldNormal).normalize();
    const orientation = new THREE.Quaternion()
      .setFromAxisAngle(normal, THREE.MathUtils.degToRad(-plan.placement.yawDegrees))
      .multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal));
    const insertionOffset = new THREE.Vector3(...asset.localInsertionPoint)
      .applyQuaternion(orientation);
    const position = new THREE.Vector3(...plan.placement.worldPosition)
      .addScaledVector(new THREE.Vector3(...plan.placement.worldNormal), 0.01)
      .sub(insertionOffset);
    if (!position.toArray().every((component) => (
      Number.isFinite(component) && Math.abs(component) <= 10_000
    ))) {
      cancelCustomModelPlacement();
      setError("선택한 위치가 3D 장면의 안전 범위를 벗어나 배치를 취소했습니다.");
      return;
    }

    const runtime = physicsRuntimeSourceRef.current;
    const attachment = attachmentByStorageModelIdRef.current.get(asset.modelId);
    if (!attachment) {
      setError("배치할 3D 모델의 장면 연결 정보를 확인할 수 없어 장면을 변경하지 않았습니다.");
      return;
    }
    try {
      assertStudioBg3dModelAttachmentAdmission({
        models: runtime.customModels,
        attachments: attachmentByStorageModelIdRef.current,
        candidateAttachments: [attachment],
        maximumAttachments: STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
        maximumCumulativeBytes: runtime.document.budgets.complexity.maxModelBytes,
      });
    } catch (admissionFailure) {
      setError(
        admissionFailure instanceof StudioBg3dModelPlacementAdmissionError
          ? admissionFailure.message
          : "3D 모델 원본 개수 예산을 확인할 수 없어 장면을 변경하지 않았습니다.",
      );
      return;
    }
    const rotation = new THREE.Euler().setFromQuaternion(orientation, "XYZ");
    const next: BgCustomModelInstance = {
      ...createBgCustomModelInstance(asset.modelId, runtime.customModels.length),
      position: position.toArray() as [number, number, number],
      rotation: [rotation.x, rotation.y, rotation.z],
    };
    const nextCustomModels = [...runtime.customModels, next];
    commitImmediateHistoryTransition(runtime.primitives, nextCustomModels, runtime.document);
    physicsRuntimeSourceRef.current = { ...runtime, customModels: nextCustomModels };
    setCustomModels(nextCustomModels);
    setSelectedIds(new Set([next.id]));
    setRefTick((revision) => revision + 1);
    publishPlacementSession(committed.state);
    setPlacementPreviewAsset(null);
    setSurfaceSnapStatus({
      tone: "success",
      message: `${asset.name} 모델을 포인터 위치에 배치했습니다.`,
    });
    setError(null);
  }
  h.commitCustomModelPlacement = commitCustomModelPlacement;
  async function addCustomModelToScene(modelId: string) {
    const session = modalAssetSessionRef.current;
    if (!session || !isModalAssetSessionCurrent(session)) return;
    if (
      isCapturing || isRestoringScene || isUploadingModel || isBatchRenderingShots || isQuadView ||
      applyingTemplateId !== null || deletingModelId !== null ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) return;
    if (!canAdmitSceneNodes(1)) return;
    setError(null);
    try {
      await studioBg3dModalOperationCoordinator.runSceneMutation(
        session,
        async (lease) => {
          lease.throwIfRevoked();
          const record = await ensureModelRootCached(
            modelId,
            session,
            lease.isCurrent,
            lease.signal,
          );
          lease.throwIfRevoked();
          if (!record) throw new Error("model-unavailable");
          const root = modelRootCacheRef.current.get(modelId)?.root;
          if (!root) throw new Error("model-unavailable");
          root.updateWorldMatrix(true, true);
          const bounds = new THREE.Box3().setFromObject(root, true);
          if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
            throw new Error("model-bounds-unavailable");
          }
          const size = bounds.getSize(new THREE.Vector3()).toArray();
          if (size.some((component) => component <= 0 || component > 10_000)) {
            throw new Error("model-bounds-unavailable");
          }
          return {
            record,
            asset: {
              modelId,
              name: record.name,
              size: size as [number, number, number],
              localInsertionPoint: [
                (bounds.min.x + bounds.max.x) / 2,
                bounds.min.y,
                (bounds.min.z + bounds.max.z) / 2,
              ] as [number, number, number],
            } satisfies StudioBg3dPlacementPreviewAsset,
          };
        },
        ({ record, asset }) => {
          if (surfaceSnapArmedRef.current) cancelSurfaceSnap();
          placementTokenSequenceRef.current += 1;
          const initialTarget = viewportApiRef.current?.readView().target ?? [0, 0, 0];
          const idle = createStudioBg3dPlacementSession();
          const begun = transitionStudioBg3dPlacementSession(idle, {
            type: "begin",
            assetId: record.contentHash,
            storageId: record.id,
            placementToken: `place-${placementTokenSequenceRef.current}-${Date.now()}`,
            sourceKind: "asset-library",
            floorPoint: [initialTarget[0], initialTarget[2]],
          });
          if (!begun.ok || begun.state.phase !== "preview") {
            throw new Error("placement-session-unavailable");
          }
          publishPlacementSession(begun.state);
          setPlacementPreviewAsset(asset);
          setSurfaceSnapStatus({
            tone: "info",
            message: `${asset.name} 모델을 원하는 위치로 옮긴 뒤 클릭해 배치하세요. Shift를 누르면 X/Z축으로 고정됩니다.`,
          });
          setSelectedIds(new Set());
          setRefTick((revision) => revision + 1);
        },
      );
    } catch (modelFailure) {
      if (!isModalAssetSessionCurrent(session)) return;
      setError(
        modelFailure instanceof StudioBg3dThreeOperationError
          ? modelFailure.message
          : modelFailure instanceof StudioBg3dModelPlacementAdmissionError
            ? modelFailure.message
          : "3D 모델의 원본·경계와 무결성을 확인하지 못해 배치 미리보기를 시작하지 않았습니다."
      );
    }
  }
  h.addCustomModelToScene = addCustomModelToScene;
  async function applyUserTemplate(entry: Bg3dTemplateLibraryEntry) {
    if (
      applyingTemplateId !== null ||
      isRestoringScene ||
      isUploadingModel ||
      captureInFlightRef.current ||
      isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)
    ) {
      return;
    }
    const session = modalAssetSessionRef.current;
    if (!session || !isModalAssetSessionCurrent(session)) return;
    const templateOwnedCacheEntries = new Map<string, ModelRootCacheEntry>();
    let committed = false;
    const cleanupUncommittedTemplateCache = () => {
      const liveStorageIds = new Set(
        physicsRuntimeSourceRef.current.customModels.map((model) => model.modelId),
      );
      for (const [storageId, ownedEntry] of templateOwnedCacheEntries) {
        // A later queued operation may already have committed this exact cache entry into the live
        // scene. Never dispose live geometry, and never delete a replacement installed by another
        // operation after this template load completed.
        if (liveStorageIds.has(storageId)) continue;
        if (modelRootCacheRef.current.get(storageId) !== ownedEntry) continue;
        ownedEntry.dispose();
        modelRootCacheRef.current.delete(storageId);
      }
      templateOwnedCacheEntries.clear();
    };
    setApplyingTemplateId(entry.id);
    setError(null);
    try {
      await studioBg3dModalOperationCoordinator.runSceneMutation(
        session,
        async (lease) => {
          lease.throwIfRevoked();
          if (isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)) {
            throw new Error("physics-transient");
          }
          const live = physicsRuntimeSourceRef.current;
          const destinationDocument = sceneBaseDocument;
          const nodeLimit = Math.min(
            STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
            destinationDocument.budgets.complexity.maxNodes,
          );
          if (live.primitives.length + live.customModels.length + entry.document.nodes.length > nodeLimit) {
            throw new Error("template-node-budget");
          }
          const occupiedNodeIds = new Set([
            ...live.primitives.map((primitive) => primitive.id),
            ...live.customModels.map((model) => model.id),
          ]);
          const templateInstanceAllocation = allocateStudioBg3dTemplateInstanceNodeIds({
            sourceKind: "user",
            sourceId: entry.id,
            insertionOffset: 0,
            nodeCount: entry.document.nodes.length,
            occupiedNodeIds,
            createSeed: () => generateId(),
          });
          if (!templateInstanceAllocation) throw new Error("template-instance-id");
          let templateNodeOrdinal = 0;
          const instantiated = await instantiateBg3dTemplateDocument(
            entry.document,
            occupiedNodeIds,
            () => templateInstanceAllocation.nodeIds[templateNodeOrdinal++] ?? "",
          );
          if (!instantiated) throw new Error("template-instantiation");

          const nextAttachmentByStorageId = new Map(attachmentByStorageModelIdRef.current);
          const nextStorageIdByAttachment = new Map(storageModelIdByAttachmentIdRef.current);
          const countedHashes = new Set<string>();
          for (const model of live.customModels) {
            const attachment = attachmentByStorageModelIdRef.current.get(model.modelId);
            if (attachment) countedHashes.add(attachment.hash);
          }
          let cumulativeUsedBytes = calculateStudioBg3dPlacedModelBytes(
            live.customModels,
            attachmentByStorageModelIdRef.current,
          );
          const quality = resolveDeviceQuality(
            destinationDocument,
            viewportHostRef.current,
          );

          for (const attachment of instantiated.document.attachments) {
            if (!isModalAssetSessionCurrent(session) || !lease.isCurrent()) {
              throw new StudioBg3dStaleModalOperationError();
            }
            const record = await getStoredBg3dModelByHash(attachment.hash);
            lease.throwIfRevoked();
            if (!record || !attachmentMatchesRecord(attachment, record)) {
              throw new Error("template-attachment-missing");
            }
            if (
              !countedHashes.has(attachment.hash) &&
              countedHashes.size >= STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS
            ) {
              throw new Error("template-attachment-budget");
            }
            await admitAndCacheModel({
              record,
              document: destinationDocument,
              quality,
              cumulativeUsedBytes,
              renderer: modelRenderer,
              cache: modelRootCacheRef.current,
              pending: modelLoadPendingRef.current,
              isActive: () => isModalAssetSessionCurrent(session) && lease.isCurrent(),
              signal: lease.signal,
              onCacheEntryCreated: (storageId, cacheEntry) => {
                templateOwnedCacheEntries.set(storageId, cacheEntry);
              },
            });
            if (!bindModelAttachment({
              attachmentByStorageModelId: nextAttachmentByStorageId,
              storageModelIdByAttachmentId: nextStorageIdByAttachment,
            }, record, attachment)) {
              throw new Error("template-attachment-binding");
            }
            if (!countedHashes.has(attachment.hash)) {
              countedHashes.add(attachment.hash);
              cumulativeUsedBytes += attachment.byteSize;
            }
          }

          const hydrated = hydrateStudioBg3dDocumentToRuntime({
            document: instantiated.document,
            storageModelIdByAttachmentId: nextStorageIdByAttachment,
          });
          const expectedPrimitives = instantiated.document.nodes.filter(
            (node) => node.kind === "primitive",
          ).length;
          const expectedCustomModels = instantiated.document.nodes.length - expectedPrimitives;
          if (
            !hydrated.ok ||
            hydrated.diagnostics.length > 0 ||
            hydrated.omittedDiagnosticCount > 0 ||
            hydrated.counts.droppedPrimitives > 0 ||
            hydrated.counts.droppedCustomModels > 0 ||
            hydrated.counts.emittedPrimitives !== expectedPrimitives ||
            hydrated.counts.emittedCustomModels !== expectedCustomModels
          ) {
            throw new Error("template-hydration");
          }
          return {
            primitives: hydrated.primitives,
            customModels: hydrated.customModels,
            nextAttachmentByStorageId,
            nextStorageIdByAttachment,
            nodeLimit,
          };
        },
        (prepared) => {
          if (isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current)) {
            throw new Error("physics-transient");
          }
          const current = physicsRuntimeSourceRef.current;
          if (
            current.primitives.length + current.customModels.length +
              prepared.primitives.length + prepared.customModels.length > prepared.nodeLimit
          ) {
            throw new Error("template-node-budget");
          }
          const occupiedIds = new Set([
            ...current.primitives.map((primitive) => primitive.id),
            ...current.customModels.map((model) => model.id),
          ]);
          const insertedIds = [
            ...prepared.primitives.map((primitive) => primitive.id),
            ...prepared.customModels.map((model) => model.id),
          ];
          if (insertedIds.some((id) => occupiedIds.has(id))) {
            throw new Error("template-node-collision");
          }

          const preparedAttachments = prepared.customModels.map((model) => {
            const attachment = prepared.nextAttachmentByStorageId.get(model.modelId);
            if (!attachment) throw new Error("template-attachment-binding");
            return attachment;
          });
          assertStudioBg3dModelAttachmentAdmission({
            models: current.customModels,
            attachments: prepared.nextAttachmentByStorageId,
            candidateAttachments: preparedAttachments,
            maximumAttachments: STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
            maximumCumulativeBytes: current.document.budgets.complexity.maxModelBytes,
          });

          attachmentByStorageModelIdRef.current.clear();
          storageModelIdByAttachmentIdRef.current.clear();
          for (const [storageId, attachment] of prepared.nextAttachmentByStorageId) {
            attachmentByStorageModelIdRef.current.set(storageId, attachment);
          }
          for (const [attachmentId, storageId] of prepared.nextStorageIdByAttachment) {
            storageModelIdByAttachmentIdRef.current.set(attachmentId, storageId);
          }
          const nextPrimitives = [...current.primitives, ...prepared.primitives];
          const nextCustomModels = [...current.customModels, ...prepared.customModels];
          physicsRuntimeSourceRef.current = {
            ...current,
            primitives: nextPrimitives,
            customModels: nextCustomModels,
          };
          setPrimitives(nextPrimitives);
          setCustomModels(nextCustomModels);
          if (insertedIds.length > 0) {
            const insertedEntities = [...prepared.primitives, ...prepared.customModels];
            setSelectedIds(new Set(
              orderStudioBg3dHierarchySelectionRootsFirst(insertedEntities),
            ));
          }
          setRefTick((tick) => tick + 1);
          setError(null);
          committed = true;
        },
      );
    } catch (templateFailure) {
      if (isModalAssetSessionCurrent(session)) {
        setError(
          templateFailure instanceof StudioBg3dThreeOperationError
            ? templateFailure.message
            : "템플릿의 모든 모델 원본과 무결성을 확인하지 못해 장면을 변경하지 않았습니다.",
        );
      }
    } finally {
      if (!committed) cleanupUncommittedTemplateCache();
      studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
        setApplyingTemplateId(null);
      });
    }
  }
  h.applyUserTemplate = applyUserTemplate;
}
