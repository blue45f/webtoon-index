/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function bindStudioBg3dEditorSelectionViewModel(h) {
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
    handleInsert, changeSelectedGenericModelClassification, changeGenericModelControlMode, selectGenericModelProxy,
    commitSelectedPoseOverride, commitSelectedAimConstraint, commitSelectedTwoBoneIkConstraint, snapSettingsSummary,
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
    genericModelClassifications, genericModelSelectedProxyId, genericModelSourceFormats, poseJointSelection,
  } = { ...R, ...h };


  const firstSelectedId = Array.from(selectedIds)[0];
  const selectedPrimitive = firstSelectedId ? (primitives.find((p) => p.id === firstSelectedId) ?? null) : null;
  const selectedCustomModel = firstSelectedId ? (customModels.find((m) => m.id === firstSelectedId) ?? null) : null;
  const selectedEntity = selectedPrimitive ?? selectedCustomModel;
  const selectedModelCacheEntry = selectedCustomModel
    ? modelRootCacheRef.current.get(selectedCustomModel.modelId) ?? null
    : null;
  const selectedSemanticMaterials = selectedModelCacheEntry?.semanticMaterials ?? null;
  const selectedSemanticAssignments = selectedSemanticMaterials?.ok
    ? selectedSemanticMaterials.assignments
    : [];
  const selectedCharacterPassPlan = selectedSemanticMaterials?.ok
    ? createStudioBg3dSemanticRenderPassPlan(
        selectedSemanticMaterials.assignments,
        "character-only",
      )
    : null;
  const selectedBackgroundPassPlan = selectedSemanticMaterials?.ok
    ? createStudioBg3dSemanticRenderPassPlan(
        selectedSemanticMaterials.assignments,
        "background-only",
      )
    : null;
  const selectedModelAnimations = selectedModelCacheEntry?.animations ?? EMPTY_THREE_ANIMATION_CLIPS;
  const selectedModelJoints = selectedModelCacheEntry?.joints ?? EMPTY_THREE_JOINTS;
  const selectedGenericModelManifest = selectedCustomModel && selectedModelCacheEntry
    ? createStudioGeneric3dVerifiedManifest({
        name: selectedModelCacheEntry.record.name,
        sourceFormat: genericModelSourceFormats.get(selectedCustomModel.modelId) ?? "glb",
        profile: deviceQuality.profile,
        contentHash: selectedModelCacheEntry.record.contentHash,
        metrics: selectedModelCacheEntry.record.validatorMetrics,
        rights: createStudioGeneric3dRightsFromAttachment(selectedModelCacheEntry.record.rights),
        classification: genericModelClassifications.get(selectedCustomModel.modelId),
        ...selectedModelCacheEntry.genericHints,
      })
    : null;
  const selectedGenericModelProxies = selectedGenericModelManifest
    ? createStudioGeneric3dPoseProxies({
        manifest: selectedGenericModelManifest,
        nodes: selectedModelJoints.map((joint) => ({
          key: joint.key,
          name: joint.name,
          parentKey: joint.parentKey,
          isBone: true,
        })),
      })
    : [];
  const effectiveGenericModelProxyId = selectedGenericModelProxies.some(
    (proxy) => proxy.id === genericModelSelectedProxyId,
  )
    ? genericModelSelectedProxyId
    : selectedGenericModelProxies[0]?.id ?? null;

  const selectedJointByKey = new Map(selectedModelJoints.map((joint) => [joint.key, joint] as const));
  const selectedPoseRigSelection = selectedCustomModel
    ? resolveStudioBg3dRigSelection({
        modelId: selectedCustomModel.id,
        descriptors: selectedModelJoints,
        selection: poseJointSelection,
      })
    : null;
  const selectedPoseJointKey = selectedPoseRigSelection?.key ?? "";
  const selectedPoseCanonicalKey = selectedPoseRigSelection?.canonicalKey ?? "";
  const selectedPoseJoint = selectedCustomModel?.pose?.joints.find(
    (joint) => (
      selectedJointByKey.get(joint.jointKey)?.canonicalKey ?? joint.jointKey
    ) === selectedPoseCanonicalKey,
  );
  const selectedAimConstraints: StudioBg3dConstraintLayer["aims"] =
    Array.isArray(selectedCustomModel?.constraints?.aims)
    ? selectedCustomModel.constraints.aims
    : [];
  const selectedTwoBoneIkConstraints: StudioBg3dConstraintLayer["twoBoneIks"] =
    Array.isArray(selectedCustomModel?.constraints?.twoBoneIks)
    ? selectedCustomModel.constraints.twoBoneIks
    : [];
  const selectedHasEffectiveRigConstraint = Boolean(
    selectedCustomModel?.constraints?.enabled && (
      selectedAimConstraints.some((constraint) => constraint.weight > 0) ||
      selectedTwoBoneIkConstraints.some((constraint) => constraint.weight > 0)
    )
  );
  const selectedRigBakeDisabledReason = !selectedCustomModel
    ? "포즈로 구울 3D 모델을 먼저 선택해 주세요."
    : !selectedHasEffectiveRigConstraint
      ? "강도가 0보다 큰 IK 또는 에임 제약을 켜야 포즈로 구울 수 있습니다."
      : failedCloneIds.has(selectedCustomModel.id)
        ? "모델 리그를 불러오지 못해 포즈로 구울 수 없습니다. 모델 파일 상태를 확인해 주세요."
        : !readyCloneIds.has(selectedCustomModel.id)
          ? "모델 리그를 준비하는 중입니다. 준비가 끝나면 포즈로 구울 수 있습니다."
          : isCapturing
            ? "3D 장면을 캡처하는 중에는 포즈로 구울 수 없습니다. 캡처가 끝난 뒤 다시 시도해 주세요."
            : isRestoringScene
              ? "3D 장면을 복원하는 중에는 포즈로 구울 수 없습니다. 복원이 끝난 뒤 다시 시도해 주세요."
              : physicsInteractionLocked
                ? "물리 미리보기 중에는 포즈로 구울 수 없습니다. 현재 자세를 적용하거나 미리보기를 초기화해 주세요."
                : null;
  const selectedAimConstraint = selectedAimConstraints.find(
    (constraint) => (
      selectedJointByKey.get(constraint.jointKey)?.canonicalKey ?? constraint.jointKey
    ) === selectedPoseCanonicalKey,
  );
  const selectedIkProtectedJointKeys = new Set<string>();
  for (const constraint of selectedTwoBoneIkConstraints) {
    const middle = selectedJointByKey.get(constraint.middleJointKey);
    if (middle) selectedIkProtectedJointKeys.add(middle.canonicalKey);
    let ancestor = selectedJointByKey.get(constraint.upperJointKey);
    while (ancestor) {
      selectedIkProtectedJointKeys.add(ancestor.canonicalKey);
      ancestor = ancestor.parentKey ? selectedJointByKey.get(ancestor.parentKey) : undefined;
    }
  }
  const selectedAimSuppressedByIk = selectedIkProtectedJointKeys.has(
    selectedJointByKey.get(selectedPoseJointKey)?.canonicalKey ?? selectedPoseJointKey,
  );
  const selectedIkEndCandidates = selectedModelJoints.filter((end) => {
    const middle = end.parentKey ? selectedJointByKey.get(end.parentKey) : undefined;
    const upper = middle?.parentKey ? selectedJointByKey.get(middle.parentKey) : undefined;
    const upperLength = middle && upper
      ? Math.hypot(
          middle.restPosition[0] - upper.restPosition[0],
          middle.restPosition[1] - upper.restPosition[1],
          middle.restPosition[2] - upper.restPosition[2],
        )
      : 0;
    const lowerLength = middle
      ? Math.hypot(
          end.restPosition[0] - middle.restPosition[0],
          end.restPosition[1] - middle.restPosition[1],
          end.restPosition[2] - middle.restPosition[2],
        )
      : 0;
    return Boolean(
      middle && upper &&
      middle.skinIndex === end.skinIndex && upper.skinIndex === end.skinIndex &&
      upperLength > 1e-6 && lowerLength > 1e-6,
    );
  });
  const savedIkEndJointKey = selectedTwoBoneIkConstraints.find((constraint) =>
    selectedIkEndCandidates.some((joint) => joint.key === constraint.endJointKey)
  )?.endJointKey;
  const requestedIkEndJointKey = ikEndJointSelection &&
    ikEndJointSelection.modelId === selectedCustomModel?.id
    ? ikEndJointSelection.jointKey
    : "";
  const selectedIkEndJointKey = selectedIkEndCandidates.some(
    (joint) => joint.key === requestedIkEndJointKey,
  )
    ? requestedIkEndJointKey
    : (savedIkEndJointKey ?? selectedIkEndCandidates[0]?.key ?? "");
  const selectedIkRigSelection = selectedCustomModel && selectedIkEndJointKey
    ? { modelId: selectedCustomModel.id, key: selectedIkEndJointKey }
    : null;
  const selectedIkEndJoint = selectedJointByKey.get(selectedIkEndJointKey);
  const selectedIkMiddleJoint = selectedIkEndJoint?.parentKey
    ? selectedJointByKey.get(selectedIkEndJoint.parentKey)
    : undefined;
  const selectedIkUpperJoint = selectedIkMiddleJoint?.parentKey
    ? selectedJointByKey.get(selectedIkMiddleJoint.parentKey)
    : undefined;
  const selectedTwoBoneIkConstraint = selectedTwoBoneIkConstraints.find(
    (constraint) => (
      selectedJointByKey.get(constraint.endJointKey)?.canonicalKey ?? constraint.endJointKey
    ) === selectedIkEndJoint?.canonicalKey,
  );
  const selectedIkChainKeys = new Set([
    selectedIkUpperJoint?.canonicalKey,
    selectedIkMiddleJoint?.canonicalKey,
    selectedIkEndJoint?.canonicalKey,
  ].filter((key): key is string => Boolean(key)));
  const selectedIkHasOverlap = selectedTwoBoneIkConstraints.some(
    (constraint) => constraint !== selectedTwoBoneIkConstraint && [
      constraint.upperJointKey,
      constraint.middleJointKey,
      constraint.endJointKey,
    ].some((key) => selectedIkChainKeys.has(
      selectedJointByKey.get(key)?.canonicalKey ?? key,
    )),
  );
  const selectedIkLimitReached = selectedTwoBoneIkConstraints.length >=
    STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS;
  const selectedIkWorldMatrix = selectedCustomModel
    ? calculateStudioBg3dThreeWorldMatrix(
        [...primitives, ...customModels],
        selectedCustomModel.id,
      )
    : null;
  const selectedIkSourceRoot = selectedCustomModel
    ? modelRootCacheRef.current.get(selectedCustomModel.modelId)?.root
    : undefined;
  const selectedIkTransformSupported = !(
    selectedIkSourceRoot && selectedIkWorldMatrix &&
    selectedIkUpperJoint && selectedIkMiddleJoint && selectedIkEndJoint
  ) || isStudioBg3dThreeTwoBoneIkChainSupported({
    root: selectedIkSourceRoot,
    instanceWorldMatrix: selectedIkWorldMatrix,
    upperJointKey: selectedIkUpperJoint.key,
    middleJointKey: selectedIkMiddleJoint.key,
    endJointKey: selectedIkEndJoint.key,
  });
  const selectedIkDefaultTarget: [number, number, number] = selectedIkEndJoint
    ? [...selectedIkEndJoint.restPosition]
    : [0, 1, 0];
  const selectedIkDefaultPole: [number, number, number] =
    selectedIkUpperJoint && selectedIkMiddleJoint && selectedIkEndJoint
    ? createTwoBoneDefaultPoleTarget(
        selectedIkUpperJoint.restPosition,
        selectedIkMiddleJoint.restPosition,
        selectedIkEndJoint.restPosition,
      )
    : [0, 0, 1];
  const selectedPoseEulerDegrees = quaternionToEulerDegrees(
    selectedPoseJoint?.rotationOffset ?? [0, 0, 0, 1],
  );
  const selectedModelMorphTargets = selectedModelCacheEntry?.morphTargets ?? EMPTY_THREE_MORPH_TARGETS;
  const selectedMorphTargetCandidateKey = morphTargetSelection !== null &&
    morphTargetSelection.modelId === selectedCustomModel?.id
    ? morphTargetSelection.key
    : null;
  const selectedMorphTargetKey = selectedMorphTargetCandidateKey !== null &&
    selectedModelMorphTargets.some((target) => target.key === selectedMorphTargetCandidateKey)
    ? selectedMorphTargetCandidateKey
    : (selectedModelMorphTargets[0]?.key ?? "");
  const selectedMorphOverride = selectedCustomModel?.morph?.targets.find(
    (target) => target.targetKey === selectedMorphTargetKey,
  );
  const selectedAnimationClip = selectedCustomModel?.animation
    ? (selectedModelAnimations[selectedCustomModel.animation.clipIndex] ?? selectedModelAnimations[0])
    : undefined;
  const selectedAnimationDuration = Math.max(
    0.01,
    Number.isFinite(selectedAnimationClip?.duration) ? selectedAnimationClip?.duration ?? 0.01 : 0.01,
  );

  const selectedIsLocked = isBgObjectTransformBlocked(selectedEntity);
  const selectedEntities = Array.from(selectedIds).reduce<Array<BgPrimitive | BgCustomModelInstance>>(
    (entities, id) => {
      const entity = primitives.find((primitive) => primitive.id === id) ?? customModels.find((model) => model.id === id);
      if (entity) entities.push(entity);
      return entities;
    },
    []
  );
  const canGroundSelection = selectedEntities.some((entity) => !isBgObjectTransformBlocked(entity));
  const selectedPlaceableModels = selectedEntities.filter(
    (entity): entity is BgCustomModelInstance =>
      customModels.some((model) => model.id === entity.id),
  );
  // Placement recipe is custom-model only; multi is allowed when every selection is a model and at
  // least one is unlocked (locked siblings are skipped inside the command).
  const canPlaceSelectedModelRecipe =
    !physicsInteractionLocked &&
    selectedIds.size > 0 &&
    selectedIds.size <= STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS &&
    selectedEntities.length === selectedIds.size &&
    selectedPlaceableModels.length === selectedEntities.length &&
    selectedPlaceableModels.some((model) => !isBgObjectTransformBlocked(model));
  const groundSelectionDisabledReason =
    physicsInteractionLocked
      ? "물리 미리보기 중에는 장면 변형 도구를 잠급니다."
      : selectedEntities.length === 0
      ? "도형 또는 3D 모델을 먼저 선택하세요."
      : !canGroundSelection
        ? "선택한 객체의 잠금을 해제하세요."
        : undefined;
  const centerGroundSelectionDisabledReason =
    physicsInteractionLocked
      ? "물리 미리보기 중에는 장면 변형 도구를 잠급니다."
      : selectedEntities.length === 0
        ? "도형 또는 3D 모델을 먼저 선택하세요."
        : selectedEntities.length > 1
          ? "원점에 객체가 겹치지 않도록 한 번에 하나만 선택하세요."
          : selectedIsLocked
            ? "선택한 객체의 잠금을 해제하세요."
            : selectedCustomModel && !readyCloneIds.has(selectedCustomModel.id)
              ? failedCloneIds.has(selectedCustomModel.id)
                ? "모델 지오메트리를 불러오지 못해 정렬할 수 없습니다."
                : "모델 지오메트리를 준비하는 중입니다."
              : !selectedEntity || !primitiveObjectsRef.current.has(selectedEntity.id)
                ? "선택한 객체의 지오메트리를 준비하는 중입니다."
                : undefined;
  Object.assign(h, {
    firstSelectedId, selectedPrimitive, selectedCustomModel, selectedEntity,
    selectedModelCacheEntry, selectedSemanticMaterials, selectedSemanticAssignments,
    selectedCharacterPassPlan, selectedBackgroundPassPlan, selectedModelAnimations,
    selectedModelJoints, selectedGenericModelManifest, selectedGenericModelProxies,
    effectiveGenericModelProxyId, selectedJointByKey, selectedPoseRigSelection,
    selectedPoseJointKey, selectedPoseCanonicalKey, selectedPoseJoint,
    selectedAimConstraints, selectedTwoBoneIkConstraints, selectedHasEffectiveRigConstraint,
    selectedRigBakeDisabledReason, selectedAimConstraint, selectedIkProtectedJointKeys,
    selectedAimSuppressedByIk, selectedIkEndCandidates, savedIkEndJointKey,
    requestedIkEndJointKey, selectedIkEndJointKey, selectedIkRigSelection, selectedIkEndJoint,
    selectedIkMiddleJoint, selectedIkUpperJoint, selectedTwoBoneIkConstraint,
    selectedIkChainKeys, selectedIkHasOverlap, selectedIkLimitReached, selectedIkWorldMatrix,
    selectedIkSourceRoot, selectedIkTransformSupported, selectedIkDefaultTarget,
    selectedIkDefaultPole, selectedPoseEulerDegrees, selectedModelMorphTargets,
    selectedMorphTargetCandidateKey, selectedMorphTargetKey, selectedMorphOverride,
    selectedAnimationClip, selectedAnimationDuration, selectedIsLocked, selectedEntities,
    canGroundSelection, selectedPlaceableModels, canPlaceSelectedModelRecipe,
    groundSelectionDisabledReason, centerGroundSelectionDisabledReason,
  });
}
