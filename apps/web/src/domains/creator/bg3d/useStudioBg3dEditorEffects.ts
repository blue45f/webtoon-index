/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";

export function useStudioBg3dEditorEffects(h) {
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
    sharedCharacterCaptureAuthorityPayloadKeyRef, sharedCharacterCaptureAuthorityRevisionRef, sharedCharacterCaptureStatusFenceRef, updateSharedCharacterStatusWithCaptureFence,
    acquireSharedCharacterCaptureAuthority, verifySharedCharacterCaptureAuthority, primitives, setPrimitives,
    selectedIds, setSelectedIds, transformMode, setTransformMode,
    lineArtPreview, setLineArtPreview, magicLayerEnabled, setMagicLayerEnabled,
    isTransforming, setIsTransforming, isQuadView, setIsQuadView,
    webXrBridgeGeneration, setWebXrBridgeGeneration, webXrCanvasGeneration, setWebXrCanvasGeneration,
    webXrSessionStateRef, webXrControllerRef, webXrRestoreCameraRef, webXrCleanupPromiseRef,
    webXrRendererRecreationPendingRef, webXrCloseRequestedRef, webXrOpenRef, webXrMountedRef,
    viewTopRef, viewFrontRef, viewRightRef, viewPerspRef,
    isCapturing, setIsCapturing, error, setError,
    activePanelTab, setActivePanelTab, modelsPanelActivated, setModelsPanelActivated,
    viewEditorSection, setViewEditorSection, babylonDiagnosticAbortRef, babylonDiagnosticGenerationRef,
    physicsPhase, setPhysicsPhase, physicsDurationSeconds, setPhysicsDurationSeconds,
    physicsGroundEnabled, setPhysicsGroundEnabled, physicsProgress, setPhysicsProgress,
    physicsCurrentSeconds, setPhysicsCurrentSeconds, physicsError, setPhysicsError,
    physicsPreviewRevision, setPhysicsPreviewRevision, ltEditorSection, setLtEditorSection,
    ltPresetPanelActivated, setLtPresetPanelActivated, ltUserPresetRepository, ltUserPresetHydrationGenerationRef,
    ltUserPresetMutationGenerationRef, ltUserPresetPayload, setLtUserPresetPayload, ltUserPresetNotice,
    setLtUserPresetNotice, ltPreferredPresetId, setLtPreferredPresetId, ltManagedUserPresetId,
    setLtManagedUserPresetId, ltDeleteConfirmId, setLtDeleteConfirmId, ltUserPresetName,
    setLtUserPresetName, ltUserPresetDescription, setLtUserPresetDescription, viewportHinted,
    setViewportHinted, canUndo, setCanUndo, canRedo,
    setCanRedo, shotNameDraft, setShotNameDraft, shotBatchExcludedIds,
    setShotBatchExcludedIds, shotBatchPasses, setShotBatchPasses, shotBatchIncludeLayeredPsd,
    setShotBatchIncludeLayeredPsd, shotBatchIncludeContactSheet, setShotBatchIncludeContactSheet, shotBatchExportHeight,
    setShotBatchExportHeight, shotBatchProgress, setShotBatchProgress, shotBatchRecoverySummary,
    setShotBatchRecoverySummary, isBatchRenderingShots, compositeCategory, setCompositeCategory,
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
    sceneBaseDocument, setSceneBaseDocument, savedShots, shotBatchSelectedIds,
    selectedShotBatchPasses, deviceSignals, setDeviceSignals, skyPresetId,
    insertBackgroundIntent, transparentInsert, captureRef, modalDialogRef,
    modalRootRef, viewportApiRef, pendingInitialCameraRef, cameraLensGestureBeforeViewRef,
    cameraLensGestureLatestViewRef, cameraLensGestureTimerRef, viewportHostRef, viewportBoxSize,
    setViewportBoxSize, primitiveObjectsRef, surfaceSnapArmedRef, dragInitialSelectedTransformsRef,
    dragInitialFirstTransformRef, panelScrollRef, modelRootCacheRef, modelLoadPendingRef,
    attachmentByStorageModelIdRef, storageModelIdByAttachmentIdRef, componentActiveRef, modalAssetSessionRef,
    captureInFlightRef, invalidateModelThumbnailCaptures, ltInsertAbortRef, aiMethodReferenceAbortRef,
    ltInsertSceneEpochRef, ltMagicSelectionEpochRef, ltMagicCaptureGenerationRef, ltInsertRestoreLineArtPreviewRef,
    destructiveMutationGuardRef, shotBatchAbortRef, shotBatchRecoveryRef, shotBatchRecoveryScopeRef,
    shotBatchRecoveryStoreRef, shotBatchAuthorizationEpochRef, physicsPhaseRef, physicsAbortRef,
    physicsAnimationFrameRef, physicsGenerationRef, physicsPlaybackStartedAtRef, physicsPlaybackOffsetRef,
    physicsLastUiUpdateRef, physicsLastFrameTimestampRef, latestPhysicsSamplesRef, physicsSessionRef,
    physicsWorkerSessionRef, physicsRuntimeSourceRef, physicsStartButtonRef, physicsTransportActionRef,
    shouldTransferPhysicsFocusRef, isModalAssetSessionCurrent, getModelThumbnailCaptureController, acquireModelThumbnailGpuLease,
    startModelThumbnailCaptureBatch, invalidateModalAssetSession, cancelSurfaceSnap, handleViewportReady,
    resetWebXrPresentationUi, finishWebXrControllerCleanup, disposeCurrentWebXrControllerGeneration, handleWebXrControllerReady,
    handleWebXrSessionStateChange, historyRef, historyIndexRef, deviceQuality,
    hasCloneFailure, hasPendingClone, hasPendingSharedCharacter, hasUnavailableSharedCharacter,
    physicsInteractionLocked, insertBlocked, magicLayerSelectedPrimitive, magicLayerLensShift,
    magicLayerUnavailableReason, shotBatchBlockedReason, transitionPhysicsPhase, commitImmediateHistoryTransition,
    doUndo, doRedo, canAdmitSceneNodes, addPrimitive,
    addComposite, proceduralStarterDisabledReason, addProceduralStarterAsset, addSceneTemplate,
    addRoomBuild, applyRoomBuilderPreset, handleRoomBuilderSpecChange, commitSceneEntityRemoval,
    removeSceneEntities, deleteSelected, deleteSelectedCustomModel, deleteSelectedEntity,
    duplicateSelected, duplicateSelectedCustomModel, applyMultiSelectDelta, updateTransform,
    updateCustomModelTransform, updateCustomModelMaterial, updateCustomModelAnimation, updateCustomModelPose,
    updateCustomModelMorph, updateCustomModelConstraints, reparentSceneEntity, registerModelAnimationTime,
    registerModelRigBake, bakeCustomModelRigConstraints, finishModelAnimation, updateColor,
    applySurfacePreset, togglePrimitiveFlag, toggleCustomModelFlag, renameBgObject,
    groundSelectedEntity, placeSelectedModelRecipe, centerAndGroundSelectedEntity, commitCameraViewCommand,
    zoomCameraBy, applyCameraPreset, focusSelectedEntity, registerPrimitiveRef,
    ensureModelRootCached, publishPlacementSession, cancelCustomModelPlacement, moveCustomModelPlacement,
    rotateCustomModelPlacement, commitCustomModelPlacement, addCustomModelToScene, applyUserTemplate,
    handlePanelTabChange, reportLtUserPresetMutationFailure, persistLtUserPresetMutation, currentLtUserPresetDraft,
    saveCurrentLtAsUserPreset, updateManagedLtUserPreset, renameManagedLtUserPreset, deleteManagedLtUserPreset,
    applyLtPreset, updateLtLineSettings, updateLtToneSettings, updateLtExportHeight,
    updateLtExportAspectRatio, updateBackgroundSettings, updateLightingSettings, updateRenderExposure,
    applyMoodRig, applySunRigConfig, cameraLensInteractionLocked, commitCameraLensView,
    finishCameraLensGesture, previewCameraLens, updateCameraLens, applyTwoPointPerspective,
    resetTwoPointPerspective, readCurrentCanonicalSceneForShot, commitAppliedShot, captureCurrentShot,
    applySavedShot, duplicateActiveShot, moveSavedShot, removeSavedShot,
    exportSavedShotsAsZip, updateBackgroundTransparency, onCaptureUpdate, requestModalDismiss,
    requestUserClose, handleSaveToLibrary, handleUseAsAiMethodReference, handleInsert,
    firstSelectedId, selectedPrimitive, selectedCustomModel, selectedEntity,
    selectedModelCacheEntry, selectedSemanticMaterials, selectedSemanticAssignments, selectedCharacterPassPlan,
    selectedBackgroundPassPlan, selectedModelAnimations, selectedModelJoints, selectedGenericModelManifest,
    selectedGenericModelProxies, effectiveGenericModelProxyId, changeSelectedGenericModelClassification, changeGenericModelControlMode,
    selectGenericModelProxy, selectedJointByKey, selectedPoseRigSelection, selectedPoseJointKey,
    selectedPoseCanonicalKey, selectedPoseJoint, selectedHasEffectiveRigConstraint, selectedRigBakeDisabledReason,
    selectedAimConstraint, selectedIkProtectedJointKeys, selectedAimSuppressedByIk, selectedIkEndCandidates,
    savedIkEndJointKey, requestedIkEndJointKey, selectedIkEndJointKey, selectedIkRigSelection,
    selectedIkEndJoint, selectedIkMiddleJoint, selectedIkUpperJoint, selectedTwoBoneIkConstraint,
    selectedIkChainKeys, selectedIkHasOverlap, selectedIkLimitReached, selectedIkWorldMatrix,
    selectedIkSourceRoot, selectedIkTransformSupported, selectedPoseEulerDegrees, selectedModelMorphTargets,
    selectedMorphTargetCandidateKey, selectedMorphTargetKey, selectedMorphOverride, selectedAnimationClip,
    selectedAnimationDuration, commitSelectedPoseOverride, commitSelectedAimConstraint, commitSelectedTwoBoneIkConstraint,
    selectedIsLocked, selectedEntities, canGroundSelection, selectedPlaceableModels,
    snapSettingsSummary, sceneHierarchy, effectivelyVisibleLayerIds, surfaceSnapDisabledReason,
    measurementDisabledReason, focusSelectionDisabledReason, cancelMeasurement, measurementInferenceReferences,
    resolveMeasurementCandidate, updateMeasurementPreview, pickMeasurementPoint, handleMeasurementSurfacePreview,
    handleMeasurementLengthLockChange, toggleMeasurement, toggleSurfaceSnap, handleSurfaceSnapPick,
    physicsSelectionUnavailableReason, filteredLayerItems, ltLineSettings, ltToneSettings,
    hasFilledOutput, appliedLtPreset, appliedLtPresetId, appliedMoodRig,
    managedLtUserPreset, ltExportAspectRatio, ltCaptureSafeFrame, ltCaptureSizePreview,
    ltDocumentAspectPreset, ltCaptureAspectPresets, ltCaptureAspectPresetId, ltCaptureAspectLabel,
    hideOnTab, cancelPhysicsAnimationFrame, updatePhysicsProgress, restorePhysicsInitialPose,
    resetPhysicsPreview, failPhysicsPreview, physicsPlaybackFrame, startPhysicsPlayback,
    pausePhysicsPreview, resumePhysicsPreview, startPhysicsPreview, handleStartPhysicsPreview,
    bakePhysicsPreview, runBabylonDiagnostic, immersiveSceneActive, immersiveTransitionActive,
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
    selectedIdsRef, undoRef, redoRef, deleteSelectedRef, addPrimitiveRef, addSceneTemplateRef,
    // 파일 분할 때 목록에서 빠져 ReferenceError 를 던지던 식별자들(런타임 값 위치) — 복구.
    modelThumbnailCaptureControllerRef, setCaptureBackgroundSnapshot, setImmersiveStagePlan, setLtUserPresetLibraryStatus, setMeasurementDraft, setMeasurementInference, setMeasurementStartWorld, setModelLibraryStatus, setPlacementPreviewAsset, setWebXrController, setWebXrRendererLifetimeRetained, setWebXrSessionState, setWebXrSupport, sharedCharacterCaptureAuthorityRef, webXrRendererLifetimeRetained,
  } = { ...R, ...h };

  selectedIdsRef.current = selectedIds;
  undoRef.current = doUndo;
  redoRef.current = doRedo;
  deleteSelectedRef.current = deleteSelectedEntity;
  addPrimitiveRef.current = addPrimitive;
  addSceneTemplateRef.current = addSceneTemplate;
  if (h.objectInsertSeedKeyRef == null) {
    h.objectInsertSeedKeyRef = { current: null };
  }
  const objectInsertSeedKeyRef = h.objectInsertSeedKeyRef;

  const readSharedCharacterCaptureAuthorityDraft = useEffectEvent(
    () => sharedCharacterCaptureAuthorityDraft,
  );

  useLayoutEffect(() => {
    sharedCharacterCaptureStatusFenceRef.current = sharedCharacterStatuses;
    if (
      sharedCharacterCaptureAuthorityRef.current
      && sharedCharacterCaptureAuthorityPayloadKeyRef.current
        === sharedCharacterCaptureAuthorityPayloadKey
    ) return;
    if (sharedCharacterCaptureAuthorityRevisionRef.current < 1) {
      sharedCharacterCaptureAuthorityRevisionRef.current = 1;
    } else if (sharedCharacterCaptureAuthorityRef.current) {
      sharedCharacterCaptureAuthorityRevisionRef.current += 1;
    }
    sharedCharacterCaptureAuthorityPayloadKeyRef.current =
      sharedCharacterCaptureAuthorityPayloadKey;
    sharedCharacterCaptureAuthorityRef.current = {
      revision: sharedCharacterCaptureAuthorityRevisionRef.current,
      ...readSharedCharacterCaptureAuthorityDraft(),
    };
  }, [
    sharedCharacterCaptureAuthorityPayloadKey,
    sharedCharacterStatuses,
  ]);

  useEffect(() => () => modelImportAbortRef.current?.abort(), []);

  useEffect(() => () => {
    modelThumbnailCaptureEpochRef.current += 1;
    modelThumbnailCaptureAbortRef.current?.abort();
    modelThumbnailCaptureAbortRef.current = null;
    modelThumbnailCaptureControllerRef.current?.dispose();
    modelThumbnailCaptureControllerRef.current = null;
  }, []);

  useEffect(() => () => shotBatchAbortRef.current?.abort(), []);

  useEffect(() => {
    if (!open && !webXrRendererLifetimeRetained) {
      primitiveGeometryPool.dispose();
      setAdaptiveDprScale(1);
      webXrControllerRef.current = null;
      webXrSessionStateRef.current = { status: "idle" };
      webXrRestoreCameraRef.current = null;
      setWebXrController(null);
      setWebXrSupport(null);
      setWebXrSessionState({ status: "idle" });
      setImmersiveStagePlan(null);
      measurementActiveRef.current = false;
      setMeasurementActive(false);
      setMeasurementStartWorld(null);
      setMeasurementDraft(null);
      setMeasurementInference(null);
      const idlePlacement = createStudioBg3dPlacementSession();
      placementSessionRef.current = idlePlacement;
      setPlacementSession(idlePlacement);
      setPlacementPreviewAsset(null);
      modelRendererRef.current = null;
      setModelRenderer(null);
    }
  }, [open, primitiveGeometryPool, webXrRendererLifetimeRetained]);

  useEffect(() => {
    if (!open) return;
    return () => {
      physicsGenerationRef.current += 1;
      physicsAbortRef.current?.abort();
      physicsAbortRef.current = null;
      if (physicsAnimationFrameRef.current !== null) {
        cancelAnimationFrame(physicsAnimationFrameRef.current);
        physicsAnimationFrameRef.current = null;
      }
      physicsSessionRef.current = null;
      physicsWorkerSessionRef.current?.dispose();
      physicsWorkerSessionRef.current = null;
      latestPhysicsSamplesRef.current = [];
      physicsPhaseRef.current = "idle";
    };
  }, [open]);

  useEffect(() => {
    primitiveGeometryPool.retain();
    return () => primitiveGeometryPool.releaseSoon();
  }, [primitiveGeometryPool]);

  useEffect(() => () => {
    if (cameraLensGestureTimerRef.current !== null) {
      clearTimeout(cameraLensGestureTimerRef.current);
      cameraLensGestureTimerRef.current = null;
    }
    cameraLensGestureBeforeViewRef.current = null;
    cameraLensGestureLatestViewRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const session = studioBg3dModalOperationCoordinator.beginSession();
    modalAssetSessionRef.current = session;
    return () => {
      invalidateModelThumbnailCaptures();
      ltInsertAbortRef.current?.abort();
      ltInsertAbortRef.current = null;
      aiMethodReferenceAbortRef.current?.abort();
      aiMethodReferenceAbortRef.current = null;
      if (modalAssetSessionRef.current === session) modalAssetSessionRef.current = null;
      studioBg3dModalOperationCoordinator.endSession(session);
    };
  }, [invalidateModelThumbnailCaptures, open]);

  useLayoutEffect(() => {
    ltInsertSceneEpochRef.current += 1;
    const controller = ltInsertAbortRef.current;
    controller?.abort();
    aiMethodReferenceAbortRef.current?.abort();
  }, [customModels, primitives, sceneBaseDocument]);

  useLayoutEffect(() => {
    ltMagicSelectionEpochRef.current += 1;
    if (magicLayerEnabled && captureInFlightRef.current) {
      ltInsertAbortRef.current?.abort();
    }
  }, [magicLayerEnabled, selectedIds]);

  useLayoutEffect(() => {
    if (!surfaceSnapArmedRef.current) return;
    cancelSurfaceSnap("장면이 변경되어 표면 붙이기 대상을 다시 선택해야 합니다.");
  }, [customModels, primitives, sceneBaseDocument]);

  useLayoutEffect(() => {
    if (!surfaceSnapArmedRef.current) return;
    cancelSurfaceSnap("선택이 변경되어 표면 붙이기를 취소했습니다.");
  }, [selectedIds]);

  useLayoutEffect(() => {
    if (!surfaceSnapArmedRef.current) return;
    if (
      !open || isQuadView || isCapturing || isBatchRenderingShots || isRestoringScene ||
      isTransforming || isUploadingModel || applyingTemplateId !== null || deletingModelId !== null ||
      isStudioBg3dPhysicsTransientPhase(physicsPhase)
    ) {
      cancelSurfaceSnap("다른 3D 작업이 시작되어 표면 붙이기를 취소했습니다.");
    }
  }, [
    applyingTemplateId,
    deletingModelId,
    isBatchRenderingShots,
    isCapturing,
    isQuadView,
    isRestoringScene,
    isTransforming,
    isUploadingModel,
    open,
    physicsPhase,
  ]);

  useLayoutEffect(() => {
    if (open) return;
    invalidateModelThumbnailCaptures();
    ltInsertAbortRef.current?.abort();
    ltInsertAbortRef.current = null;
    aiMethodReferenceAbortRef.current?.abort();
    aiMethodReferenceAbortRef.current = null;
    if (!modelThumbnailGpuLeaseRef.current) captureInFlightRef.current = false;
    const restoreLineArtPreview = ltInsertRestoreLineArtPreviewRef.current;
    ltInsertRestoreLineArtPreviewRef.current = null;
    setCaptureBackgroundSnapshot(null);
    setIsCapturing(false);
    if (restoreLineArtPreview !== null) setLineArtPreview(restoreLineArtPreview);
  }, [invalidateModelThumbnailCaptures, open]);

  useLayoutEffect(() => {
    const previous = shotBatchRecoveryScopeRef.current?.scope ??
      shotBatchRecoveryRef.current?.plan.scope;
    if (!previous) return;
    if (!recoveryScope || previous.durability !== recoveryScope.durability ||
      previous.authUserId !== recoveryScope.authUserId || previous.workId !== recoveryScope.workId ||
      previous.pageId !== recoveryScope.pageId || previous.elementId !== recoveryScope.elementId) {
      shotBatchAuthorizationEpochRef.current += 1;
      shotBatchAbortRef.current?.abort();
    }
  }, [recoveryScope]);

  useEffect(() => () => {
    const store = shotBatchRecoveryStoreRef.current;
    const session = shotBatchRecoveryRef.current;
    if (store && session) void store.release(session);
  }, []);

  const disposeWebXrControllerForOpenChange = useEffectEvent(() => {
    disposeCurrentWebXrControllerGeneration();
  });

  useLayoutEffect(() => {
    if (open) {
      webXrCloseRequestedRef.current = false;
      setWebXrRendererLifetimeRetained(true);
      return;
    }
    webXrCloseRequestedRef.current = true;
    disposeWebXrControllerForOpenChange();
  }, [open]);

  useEffect(() => {
    webXrMountedRef.current = true;
    return () => {
      webXrMountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    modalRootRef.current = modalDialogRef.current?.ownerDocument.body ?? null;
  }, [open]);

  useStudioModalSheet({
    activeKey: open ? "studio-bg3d" : null,
    dialogRef: modalDialogRef,
    onDismiss: requestModalDismiss,
    resolveInitialFocus: (dialog) =>
      dialog.querySelector<HTMLElement>("[data-bg3d-initial-focus='true']"),
    resolveReturnFocus: () => resolveStudioBg3dReturnFocus(modalDialogRef.current),
    rootRef: modalRootRef,
  });

  useLayoutEffect(() => {
    if (!shouldTransferPhysicsFocusRef.current) return;
    if (!physicsInteractionLocked) {
      shouldTransferPhysicsFocusRef.current = false;
      return;
    }
    const currentAction = physicsTransportActionRef.current;
    if (!currentAction || currentAction.disabled) return;
    shouldTransferPhysicsFocusRef.current = false;
    currentAction.focus({ preventScroll: true });
  }, [physicsInteractionLocked, physicsPhase]);

  useEffect(() => {
    // `componentActiveRef` fences every async editor operation, not only the model library.
    // Gating this lifecycle behind the Models tab leaves diagnostics, capture, physics, and
    // restore work permanently unable to publish while the dialog is otherwise fully active.
    if (!open) return;
    componentActiveRef.current = true;
    const cache = modelRootCacheRef.current;
    const pending = modelLoadPendingRef.current;
    const attachmentByStorageId = attachmentByStorageModelIdRef.current;
    const storageIdByAttachment = storageModelIdByAttachmentIdRef.current;
    return () => {
      componentActiveRef.current = false;
      babylonDiagnosticAbortRef.current?.abort();
      babylonDiagnosticAbortRef.current = null;
      pending.clear();
      disposeModelCache(cache);
      attachmentByStorageId.clear();
      storageIdByAttachment.clear();
    };
  }, [open, setTemplateLibrary, setTemplateLibraryStatus]);

  useEffect(() => {
    if (!open || !ltPresetPanelActivated) return;
    const hydrationGeneration = ltUserPresetHydrationGenerationRef.current + 1;
    ltUserPresetHydrationGenerationRef.current = hydrationGeneration;
    const mutationGeneration = ltUserPresetMutationGenerationRef.current;
    let active = true;
    setLtPreferredPresetId(null);
    setLtManagedUserPresetId(null);
    setLtDeleteConfirmId(null);
    setLtUserPresetName("");
    setLtUserPresetDescription(DEFAULT_LT_USER_PRESET_DESCRIPTION);
    setLtUserPresetPayload(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD);
    setLtUserPresetLibraryStatus("idle");
    setLtUserPresetNotice(null);

    void ltUserPresetRepository.load().then((payload) => {
      if (
        !active ||
        ltUserPresetHydrationGenerationRef.current !== hydrationGeneration ||
        ltUserPresetMutationGenerationRef.current !== mutationGeneration
      ) {
        return;
      }
      setLtUserPresetPayload(payload);
      setLtUserPresetLibraryStatus("ready");
      setLtUserPresetNotice(null);
    }).catch((cause: unknown) => {
      if (!active || ltUserPresetHydrationGenerationRef.current !== hydrationGeneration) return;
      setLtUserPresetPayload(EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD);
      setLtUserPresetLibraryStatus("memory-only");
      setLtUserPresetNotice({
        tone: "error",
        message: `SQLite/OPFS에서 LT 프리셋을 불러오지 못했습니다. 현재 탭 메모리 임시 · 새로고침 시 사라짐: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    });
    return () => {
      active = false;
      if (ltUserPresetHydrationGenerationRef.current === hydrationGeneration) {
        ltUserPresetHydrationGenerationRef.current += 1;
      }
    };
  }, [ltPresetPanelActivated, ltUserPresetRepository, open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const browserNavigator = navigator as BrowserNavigatorCapabilities;
    const coarse = window.matchMedia?.("(pointer: coarse)");
    const fine = window.matchMedia?.("(pointer: fine)");
    const refresh = () => setDeviceSignals(collectDeviceSignals(viewportHostRef.current));
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(refresh) : null;
    if (viewportHostRef.current) observer?.observe(viewportHostRef.current);
    window.addEventListener("resize", refresh, { passive: true });
    coarse?.addEventListener?.("change", refresh);
    fine?.addEventListener?.("change", refresh);
    browserNavigator.connection?.addEventListener?.("change", refresh);
    refresh();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", refresh);
      coarse?.removeEventListener?.("change", refresh);
      fine?.removeEventListener?.("change", refresh);
      browserNavigator.connection?.removeEventListener?.("change", refresh);
    };
  }, [open, setTemplateLibrary, setTemplateLibraryStatus]);

  // 모델 라이브러리 목록은 모달이 열릴 때 한 번 읽어온다(VRM 포저의 listVrmLibraryEntries() 패턴과 동일).
  useEffect(() => {
    if (!open || !modelsPanelActivated) return;
    const session = modalAssetSessionRef.current;
    if (!session) return;
    setModelLibrary(copyStudioBg3dBundledEnvironmentLibraryEntries());
    setModelLibraryStatus("loading");
    studioBg3dModalOperationCoordinator.waitForSceneMutationLane()
      .then(() => {
        if (!isModalAssetSessionCurrent(session)) {
          throw new StudioBg3dStaleModalOperationError();
        }
        return listBg3dModelLibraryEntries();
      })
      .then((entries) => {
        studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
          setModelLibrary(entries);
          setModelLibraryStatus("ready");
        });
      })
      .catch(() => {
        studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
          setModelLibrary(copyStudioBg3dBundledEnvironmentLibraryEntries());
          setModelLibraryStatus("degraded");
        });
      });
  }, [modelsPanelActivated, open, setTemplateLibrary, setTemplateLibraryStatus]);

  useEffect(() => {
    if (!open || (!modelsPanelActivated && activePanelTab !== "templates")) return;
    const session = modalAssetSessionRef.current;
    if (!session) return;
    setTemplateLibraryStatus("loading");
    listBg3dTemplates()
      .then((entries) => {
        studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
          setTemplateLibrary(entries);
          setTemplateLibraryStatus("ready");
        });
      })
      .catch(() => {
        studioBg3dModalOperationCoordinator.commitIfCurrent(session, () => {
          setTemplateLibraryStatus("error");
        });
      });
  }, [activePanelTab, modelsPanelActivated, open, setTemplateLibrary, setTemplateLibraryStatus]);

  useEffect(() => {
    if (!open) {
      objectInsertSeedKeyRef.current = null;
      return;
    }
    if (isRestoringScene) return;
    const templateId =
      typeof seedSceneTemplateId === "string" ? seedSceneTemplateId.trim() : "";
    const primitiveKind = seedPrimitiveKind ?? null;
    if (!templateId && !primitiveKind) return;
    const key = templateId ? `t:${templateId}` : `p:${primitiveKind}`;
    if (objectInsertSeedKeyRef.current === key) return;
    objectInsertSeedKeyRef.current = key;
    if (templateId) addSceneTemplateRef.current(templateId);
    else if (primitiveKind && primitiveKind in PRIMITIVE_DEFS) {
      addPrimitiveRef.current(primitiveKind);
    }
    onSeedObjectInsertConsumed?.();
  }, [open, isRestoringScene, seedSceneTemplateId, seedPrimitiveKind, onSeedObjectInsertConsumed]);

  useLayoutEffect(() => {
    selectedIdsRef.current = selectedIds;
    undoRef.current = doUndo;
    redoRef.current = doRedo;
    deleteSelectedRef.current = deleteSelectedEntity;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing) return;
      if (captureInFlightRef.current) return;
      if (
        webXrSessionStateRef.current.status !== "idle" &&
        webXrSessionStateRef.current.status !== "error"
      ) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (
          !isStudioBg3dPhysicsTransientPhase(physicsPhaseRef.current) &&
          selectedIdsRef.current.size > 0
        ) {
          e.preventDefault();
          deleteSelectedRef.current();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === "z") {
          e.preventDefault();
          if (e.shiftKey) redoRef.current();
          else undoRef.current();
        } else if (key === "y") {
          e.preventDefault();
          redoRef.current();
        }
        return;
      }
      const lower = e.key.toLowerCase();
      if (lower === "t" || lower === "r" || lower === "s") {
        if (measurementActiveRef.current) {
          cancelMeasurement("변형 도구로 전환해 줄자 측정을 취소했습니다.");
        }
        if (lower === "t") setTransformMode("translate");
        else if (lower === "r") setTransformMode("rotate");
        else setTransformMode("scale");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const host = viewportHostRef.current;
    if (!open || !host || typeof ResizeObserver === "undefined") {
      setViewportBoxSize(null);
      return;
    }
    const sync = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      setViewportBoxSize((previous) => (
        previous &&
          Math.abs(previous.width - rect.width) < 0.5 &&
          Math.abs(previous.height - rect.height) < 0.5
          ? previous
          : { width: rect.width, height: rect.height }
      ));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    return () => observer.disconnect();
  }, [open]);

  const pausePhysicsWhenHidden = useEffectEvent(() => pausePhysicsPreview());

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") pausePhysicsWhenHidden();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [open]);

  useEffect(() => {
    if (!open || ltManagedUserPresetId || !appliedLtPreset) return;
    const exactUserPreset = ltUserPresetPayload.presets.find(
      (preset) => preset.id === appliedLtPreset.id
    );
    if (!exactUserPreset) return;
    setLtManagedUserPresetId(exactUserPreset.id);
    setLtUserPresetName(exactUserPreset.name);
    setLtUserPresetDescription(exactUserPreset.description);
  }, [appliedLtPreset, ltManagedUserPresetId, ltUserPresetPayload, open]);
}
