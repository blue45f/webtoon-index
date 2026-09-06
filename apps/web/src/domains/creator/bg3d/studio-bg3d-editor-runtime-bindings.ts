/* Re-exports the original StudioBackground3D import graph for host extracts. */
import { lazy as createLazyComponent } from "react";

export { OrbitControls } from "@react-three/drei/core/OrbitControls.js";
export { OrthographicCamera } from "@react-three/drei/core/OrthographicCamera.js";
export { PerspectiveCamera } from "@react-three/drei/core/PerspectiveCamera.js";
export { TransformControls } from "@react-three/drei/core/TransformControls.js";
export { View } from "@react-three/drei/web/View.js";
export { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
export {
  Aperture,
  Boxes,
  Camera,
  ChevronDown,
  CircleDashed,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Globe,
  Hexagon,
  Home,
  Layers,
  LayoutTemplate,
  Loader2,
  LocateFixed,
  Lock,
  Magnet,
  Maximize2,
  Move,
  MoveDown,
  PencilLine,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Save,
  ScanLine,
  Scissors,
  Trash2,
  SunMoon,
  Undo2,
  Unlock,
  Upload,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
export {
  Suspense,
  useEffect,
  useEffectEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  Fragment,
  lazy,
} from "react";
export { createPortal, flushSync } from "react-dom";
export * as THREE from "three";

export {
  createStudioBg3dAiMethodReferenceCapture,
} from "../scene-3d/studio-3d-ai-reference-handoff";
export {
  COMPOSITE_CATEGORIES,
  COMPOSITE_CATEGORY_LABELS,
  COMPOSITE_PRESETS,
  instantiateCompositePreset,
  type BgCompositeCategory,
} from "../studio-background-3d-composites";
export {
  cloneBgCustomModelInstances,
  createBgCustomModelInstance,
  duplicateBgCustomModelInstance,
  isStudioBg3dThreeTwoBoneIkChainSupported,
  measureBg3dObjectSize,
  parseBg3dSceneWithModelsFromDataUrl,
  StudioBg3dThreeOperationError,
  type BgCustomModelInstance,
} from "../studio-background-3d-model";
export {
  clonePrimitives,
  createPrimitive,
  duplicatePrimitive,
  PRIMITIVE_DEFS,
  type BgPrimitive,
  type BgPrimitiveKind,
} from "../studio-background-3d-primitives";
export {
  BG_SCENE_TEMPLATE_CATEGORIES,
  BG_SCENE_TEMPLATE_CATEGORY_LABELS,
  BG_SCENE_TEMPLATES,
  instantiateSceneTemplate,
  type BgSceneTemplateCategory,
} from "../studio-background-3d-scene-templates";
export {
  BG_SKY_PRESETS,
  getSkyPreset,
  normalizePanoramaRotationDegrees,
} from "../studio-background-3d-sky";
export {
  createStudioGeneric3dRightsFromAttachment,
  createStudioGeneric3dVerifiedManifest,
  type StudioGeneric3dClassification,
  type StudioGeneric3dSourceFormat,
} from "../studio-generic-3d-model-mode";
export { createStudioGeneric3dPoseProxies } from "../studio-generic-3d-pose-proxy";
export {
  mergeStudioGeneric3dWorkflowMaps,
  normalizeStudioGeneric3dClassification,
  normalizeStudioGeneric3dSourceFormat,
  parseStudioGeneric3dWorkflowMetadata,
} from "../studio-generic-3d-workflow-metadata";
export { createTwoBoneDefaultPoleTarget } from "../studio-rig-two-bone-ik";
export {
  createStudioShared3dCharacterShadowEntity,
} from "../studio-shared-3d-scene-runtime";
export {
  StudioGeneric3dModelModePanel,
  type StudioGeneric3dControlMode,
} from "../StudioGeneric3dModelModePanel";
export { StudioToolHintTarget } from "../StudioToolHint";
export { useStudioBg3dSharedCharacterStatus } from "../useStudioBg3dSharedCharacterStatus";
export { useStudioModalSheet } from "../useStudioModalSheet";

export { snapshotStudioBg3dLiveAnimationPlayback } from "./studio-bg3d-animation-time";
export {
  STUDIO_BG3D_ARTIFACT_CAPTURE_VERSION,
  STUDIO_BG3D_BEAUTY_RGBA8_PROFILE,
  STUDIO_BG3D_DEPTH_FLOAT32_PROFILE,
  STUDIO_BG3D_NORMAL_PROFILE,
  STUDIO_BG3D_STABLE_ID_PROFILE,
  normalizeStudioBg3dArtifactCaptureResultV2,
} from "./studio-bg3d-artifact-capture-v2";
export { copyStudioBg3dBundledEnvironmentLibraryEntries } from "./studio-bg3d-bundled-environment-library";
export {
  isStudioBg3dViewportControlTarget,
  readStudioBg3dObjectWorldBounds,
  readStudioBg3dWorldSurfaceHit,
  type BgViewportApi,
} from "./studio-bg3d-camera-application";
export {
  fitStudioBg3dCameraToBounds,
} from "./studio-bg3d-camera-framing";
export {
  applyOrDeferStudioBg3dHistoryCamera,
  resolveStudioBg3dCameraGestureCommitView,
} from "./studio-bg3d-camera-history-transition";
export {
  createStudioBg3dCameraUpForDutchRoll,
  readStudioBg3dCameraDutchRollDegrees,
  resolveStudioBg3dCameraDistanceLimits,
  resolveStudioBg3dCameraNearClip,
  resolveStudioBg3dCameraUpVector,
} from "./studio-bg3d-camera-orientation";
export {
  createStudioBg3dCaptureBackgroundSnapshot,
  studioBg3dCaptureBackgroundRequestFromSnapshot,
  type StudioBg3dCaptureBackgroundSnapshot,
} from "./studio-bg3d-capture-background";
export { registerStudioBg3dCaptureExcludedObject } from "./studio-bg3d-capture-exclusion";
export {
  STUDIO_BG3D_CAPTURE_ASPECT_PRESETS,
  createStudioBg3dDocumentCaptureAspectPreset,
  matchStudioBg3dCaptureAspectPreset,
  normalizeStudioBg3dCaptureAspectRatio,
  resolveStudioBg3dCaptureFrame,
  resolveStudioBg3dCaptureFrameCameraSettings,
} from "./studio-bg3d-capture-frame-geometry";
export { applyStudioBg3dCaptureFrameViewOffset } from "./studio-bg3d-capture-frame-view-offset";
export {
  BgAnimationPlayhead,
  LtRangeControl,
  LtToggleRow,
  PanoramaRotationNumberField,
  Vec3Field,
} from "./studio-bg3d-control-fields";
export { StudioBg3dDestructiveMutationGuard } from "./studio-bg3d-destructive-mutation-guard";
export {
  deriveStudioBg3dGlbValidationPolicy,
  resolveStudioBg3dDeviceQuality,
  type StudioBg3dDeviceSignals,
} from "./studio-bg3d-device-quality";
export {
  acquireStudioBg3dCaptureAdapterAfterViewTransition,
  CAMERA_PRESETS,
  canonicalSceneDocument,
  captureStudioBg3dRaster,
  collectDeviceSignals,
  createStudioBg3dHistorySnapshot,
  createStudioBg3dShotId,
  degToRad,
  describeStudioBg3dPhysicsStatus,
  eulerDegreesToQuaternion,
  formatBg3dSunTime,
  generateLtUserPresetId,
  getStudioBg3dCaptureSourceSize,
  loadStudioBg3dThreeWebglCaptureRuntime,
  ltTonePreviewStyle,
  ltUserPresetFailureMessage,
  matchingLtPreset,
  quaternionToEulerDegrees,
  radToDeg,
  resolveDeviceQuality,
  SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE,
  studioBg3dHistoryDocumentAtView,
  studioBg3dMagicCaptureCompatibilityMessage,
  waitForStudioBg3dPaintFrame,
  type BrowserNavigatorCapabilities,
  type StudioBg3dHistorySnapshot,
} from "./studio-bg3d-editor-derivations";
export { createStudioBg3dModelImportActions } from "./studio-bg3d-editor-model-import-actions";
export {
  STUDIO_BG3D_CONTROL_BUTTON as CONTROL_BUTTON,
  STUDIO_BG3D_ICON_BUTTON as ICON_BUTTON,
  studioBg3dClassNames as cx,
} from "./studio-bg3d-editor-ui";
export {
  canSetStudioBg3dParent,
  collectStudioBg3dEffectivelyVisibleEntityIds,
  resolveStudioBg3dHierarchy,
} from "./studio-bg3d-hierarchy";
export {
  planStudioBg3dImmersiveStage,
  studioBg3dImmersiveStageFailureMessage,
} from "./studio-bg3d-immersive-stage";
export {
  resolveStudioBg3dInsertBackgroundFromDocument,
  resolveStudioBg3dInsertBackgroundMode,
} from "./studio-bg3d-insert-background-mode";
export {
  STUDIO_BG3D_LENS_MAX_FOCAL_MM,
  STUDIO_BG3D_LENS_MIN_FOCAL_MM,
  STUDIO_BG3D_LENS_PRESETS,
  computeStudioBg3dTwoPointPerspective,
  isStudioBg3dTwoPointPerspectiveActive,
  studioBg3dFocalLengthToFovDegrees,
  studioBg3dFovDegreesToFocalLength,
} from "./studio-bg3d-lens";
export { resolveStudioBg3dLtCaptureSize } from "./studio-bg3d-lt-capture-size";
export { encodeStudioBg3dLtLayers } from "./studio-bg3d-lt-layer-encoder";
export {
  EMPTY_STUDIO_BG3D_LT_USER_PRESET_PAYLOAD,
  createStudioBg3dLtUserPreset,
  deleteStudioBg3dLtUserPreset,
  renameStudioBg3dLtUserPreset,
  upsertStudioBg3dLtUserPreset,
  type StudioBg3dLtUserPresetMutationResult,
  type StudioBg3dLtUserPresetMutationSuccess,
} from "./studio-bg3d-lt-preset-library";
export { getProductStudioBg3dLtPresetSqliteRepository } from "./studio-bg3d-lt-preset-repository-loader";
export {
  STUDIO_BG3D_LT_BUILT_IN_PRESETS,
  STUDIO_BG3D_LT_PRESET_MAX_COUNT,
  STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH,
  STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH,
  applyStudioBg3dLtPreset,
  type StudioBg3dLtPresetPayload,
} from "./studio-bg3d-lt-presets";
export {
  renderStudioBg3dLtLayers,
  STUDIO_BG3D_LT_RENDER_MAX_PIXELS,
  type StudioBg3dLtRenderSettings,
} from "./studio-bg3d-lt-render";
export {
  renderStudioBg3dLtLayersInWorker,
  StudioBg3dLtRenderWorkerError,
} from "./studio-bg3d-lt-render-worker-client";
export {
  buildStudioBg3dMagicFilterMask,
} from "./studio-bg3d-magic-filter-mask";
export {
  encodeStudioBg3dMagicMaskPngDataUrl,
} from "./studio-bg3d-magic-mask-png";
export {
  captureStudioBg3dMagicObjectIds,
  STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES,
  type StudioBg3dMagicBabylonBackend,
} from "./studio-bg3d-magic-object-id-capture";
export {
  resolveStudioBg3dMagicSelection,
  type StudioBg3dMagicSelectionSnapshot,
} from "./studio-bg3d-magic-selection";
export {
  STUDIO_BG3D_MEASUREMENT_MAX_REFERENCES,
  classifyStudioBg3dMeasurementInference,
  createStudioBg3dMeasurementDocument,
  formatStudioBg3dMeasurementLength,
  lockStudioBg3dMeasurementLength,
  measureStudioBg3dWorldPoints,
  resolveStudioBg3dMeasurementGuide,
  type StudioBg3dMeasurementDocument,
  type StudioBg3dMeasurementInferenceReference,
  type StudioBg3dMeasurementInferenceSuccess,
  type StudioBg3dMeasurementVec3,
  type StudioBg3dWorldMeasurement,
} from "./studio-bg3d-measurement";
export { readStudioBg3dMeasurementPointFromThreeEvent } from "./studio-bg3d-measurement-three-adapter";
export {
  StudioBg3dStaleModalOperationError,
  studioBg3dModalOperationCoordinator,
  type StudioBg3dModalSession,
} from "./studio-bg3d-modal-operation-coordinator";
export {
  createStudioBg3dModelAttachment,
  getStoredBg3dModelV12 as getStoredBg3dModel,
  getStoredBg3dModelByHashV12 as getStoredBg3dModelByHash,
  listBg3dModelLibraryEntriesV12 as listBg3dModelLibraryEntries,
  resolveBg3dModelHashV12 as resolveBg3dModelHash,
  type Bg3dModelLibraryEntry,
  type Bg3dVerifiedStoredRecord,
} from "./studio-bg3d-model-library-loader";
export {
  assertStudioBg3dModelAttachmentAdmission,
  calculateStudioBg3dPlacedModelBytes,
  StudioBg3dModelPlacementAdmissionError,
  totalStudioBg3dModelAttachmentBytes,
} from "./studio-bg3d-model-placement-admission";
export {
  admitAndCacheStudioBg3dModel as admitAndCacheModel,
  attachmentMatchesRecord,
  bindModelAttachment,
  disposeStudioBg3dModelCache as disposeModelCache,
  readGenericWorkflowMapsFromAttachments,
  withStudioGeneric3dWorkflowMetadata,
  type StudioBg3dModelRootCacheEntry as ModelRootCacheEntry,
} from "./studio-bg3d-model-runtime-admission";
export { encodeStudioBg3dModelThumbnailPng } from "./studio-bg3d-model-thumbnail-encode";
export {
  applyStudioBg3dMoodRig,
  resolveStudioBg3dAppliedMoodRig,
  STUDIO_BG3D_MOOD_RIGS,
} from "./studio-bg3d-mood-rigs";
export {
  applyStudioBg3dSnapToTransform,
  DEFAULT_STUDIO_BG3D_SNAP_SETTINGS,
  filterStudioBg3dLayerItems,
  groundModelTransform,
  groundPrimitiveTransform,
  isBgObjectLocked,
  isBgObjectTransformBlocked,
  isBgObjectVisible,
  normalizeStudioBg3dSnapSettings,
  STUDIO_BG3D_ROTATE_STEP_OPTIONS_DEG,
  STUDIO_BG3D_TRANSLATE_STEP_OPTIONS,
  studioBg3dSnapSettingsSummary,
  type StudioBg3dLayerListItem,
  type StudioBg3dSnapSettings,
} from "./studio-bg3d-object-ops";
export { deriveStudioBg3dVanishingPoints } from "./studio-bg3d-perspective-bridge";
export {
  applyStudioBg3dPhysicsTransforms,
  createStudioBg3dPhysicsWorld,
  STUDIO_BG3D_PHYSICS_MAX_DYNAMIC_BODIES,
  type StudioBg3dPhysicsTransformSample,
} from "./studio-bg3d-physics";
export {
  createStudioBg3dPhysicsSessionSourceToken,
  isStudioBg3dPhysicsSessionSourceCurrent,
} from "./studio-bg3d-physics-session";
export {
  createStudioBg3dPhysicsThreeJob,
  measureStudioBg3dPhysicsModelLocalBounds,
  projectStudioBg3dPhysicsSamples,
  STUDIO_BG3D_PHYSICS_PROJECTION_ROOT_USER_DATA_KEY,
} from "./studio-bg3d-physics-three";
export {
  sampleStudioBg3dPhysicsTimeline,
} from "./studio-bg3d-physics-timeline";
export {
  isStudioBg3dPhysicsTransientPhase,
  STUDIO_BG3D_PHYSICS_GRAVITY,
  type StudioBg3dPhysicsGravityPreset,
  type StudioBg3dPhysicsPhase,
} from "./studio-bg3d-physics-ui";
export { planStudioBg3dModelPlacementRecipe } from "./studio-bg3d-placement-recipe";
export {
  createStudioBg3dPlacementSession,
  transitionStudioBg3dPlacementSession,
  type StudioBg3dPlacementPointerTarget,
  type StudioBg3dPlacementSessionState,
} from "./studio-bg3d-placement-session";
export { calculateStudioBg3dProceduralSceneUsage } from "./studio-bg3d-procedural-scene-usage";
export {
  getStudioBg3dProceduralStarterAsset,
  planStudioBg3dProceduralStarterInsertion,
  type StudioBg3dProceduralInsertionPlan,
} from "./studio-bg3d-procedural-starter-pack";
export {
StudioBg3dPrimitiveGeometryPool,
} from "./studio-bg3d-render-optimization";
export { resolveStudioBg3dFrameLoop } from "./studio-bg3d-render-policy";
export { resolveStudioBg3dReturnFocus } from "./studio-bg3d-return-focus";
export { createStudioBg3dRigPoseBakeHistoryTransition } from "./studio-bg3d-rig-pose-bake";
export {
  mutateStudioBg3dAimConstraint,
  mutateStudioBg3dPoseOverride,
  mutateStudioBg3dTwoBoneIkConstraint,
  resolveStudioBg3dRigSelection,
  type StudioBg3dRigSelectionState,
} from "./studio-bg3d-rig-selection";
export {
  clampStudioBg3dRoomSpec,
  getStudioBg3dRoomPreset,
  instantiateStudioBg3dRoomBuild,
  type StudioBg3dRoomSpec,
} from "./studio-bg3d-room-builder";
export {
  createStudioBg3dRuntimeSnapshot,
  type StudioBg3dRuntimeAdapter,
} from "./studio-bg3d-runtime-adapter";
export {
  DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK,
  DEFAULT_STUDIO_BG3D_CONSTRAINT_LAYER,
  DEFAULT_STUDIO_BG3D_MATERIAL_OVERRIDE,
  DEFAULT_STUDIO_BG3D_POSE_LAYER,
  DEFAULT_STUDIO_BG3D_MORPH_LAYER,
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_ATTACHMENTS,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_NODES,
  STUDIO_BG3D_SCENE_DOCUMENT_MAX_SHOTS,
  STUDIO_BG3D_MAX_TWO_BONE_IK_CONSTRAINTS,
  applyStudioBg3dShot,
  captureStudioBg3dShot,
  duplicateStudioBg3dShot,
  moveStudioBg3dShot,
  normalizeStudioBg3dSceneDocument,
  removeStudioBg3dShot,
  type StudioBg3dCameraSettings,
  type StudioBg3dBackgroundSettings,
  type StudioBg3dLineOutputSettings,
  type StudioBg3dAnimationPlayback,
  type StudioBg3dConstraintLayer,
  type StudioBg3dLightingSettings,
  type StudioBg3dMaterialOverride,
  type StudioBg3dPoseLayer,
  type StudioBg3dMorphLayer,
  type StudioBg3dModelAttachment,
  type StudioBg3dSceneDocument,
  type StudioBg3dToneOutputSettings,
} from "./studio-bg3d-scene-document";
export {
  STUDIO_BG3D_FOG_MIN_GAP,
  STUDIO_BG3D_FOG_PRESETS,
} from "./studio-bg3d-scene-fog";
export {
  planStudioBg3dDeletedAttachmentReconciliation,
  planStudioBg3dSceneEntityRemoval,
  type StudioBg3dSceneRemovalSuccess,
} from "./studio-bg3d-scene-removal";
export {
  hydrateStudioBg3dDocumentToRuntime,
  tryAdaptStudioBg3dRuntimeToDocument,
} from "./studio-bg3d-scene-runtime";
export {
  DEFAULT_STUDIO_BG3D_SECTION_PLANE_STATE,
  STUDIO_BG3D_SECTION_AXES,
  STUDIO_BG3D_SECTION_AXIS_LABELS,
  STUDIO_BG3D_SECTION_OFFSET_LIMIT,
  type StudioBg3dSectionPlaneState,
} from "./studio-bg3d-section-plane";
export {
  createStudioBg3dSemanticRenderPassPlan,
} from "./studio-bg3d-semantic-materials";
export {
  collectStudioBg3dShadowSceneBounds,
  fitStudioBg3dDirectionalShadowFrustum,
  readStudioBg3dShadowGeometryLocalBounds,
  readStudioBg3dShadowModelLocalBounds,
} from "./studio-bg3d-shadow-frustum";
export {
  acquireStudioBg3dSharedCharacterCaptureAuthorityLease,
  verifyStudioBg3dSharedCharacterCaptureAuthorityLease,
  type StudioBg3dSharedCharacterCaptureAuthorityInput,
  type StudioBg3dSharedCharacterCaptureAuthorityLease,
} from "./studio-bg3d-shared-character-capture-authority";
export {
  createStudioBg3dLinkedCharacterCapture,
  createStudioBg3dSharedCharacterGroundSurfaceRevision,
  resolveStudioBg3dSharedStageMutationBlockedReason,
} from "./studio-bg3d-shared-stage-projection";
export { createStudioBg3dShotBatchExportRunner } from "./studio-bg3d-shot-batch-export-run";
export {
  STUDIO_BG3D_SHOT_BATCH_PASSES,
  STUDIO_BG3D_SHOT_BATCH_PASS_LABELS,
} from "./studio-bg3d-shot-batch-pass-catalog";
export { projectStudioBg3dShotVisibilityToRuntime } from "./studio-bg3d-shot-runtime";
export {
  createStudioBg3dBabylonDiagnosticDocument,
  hasStudioBg3dBabylonDiagnosticBeautyVariation,
  hasStudioBg3dBabylonDiagnosticDepthVariation,
  hasStudioBg3dBabylonDiagnosticNormalVariation,
  hasStudioBg3dBabylonDiagnosticStableIds,
  studioBg3dBabylonDiagnosticErrorMessage,
} from "./studio-bg3d-specialist-diagnostic-support";
export {
  DEFAULT_STUDIO_BG3D_SUN_RIG_CONFIG,
  STUDIO_BG3D_SUN_TIME_PRESETS,
  applyStudioBg3dSunRig,
  resolveStudioBg3dSunLightState,
  type StudioBg3dSunRigConfig,
} from "./studio-bg3d-sun-rig";
export {
  buildStudioBg3dSurfacePresetOverride,
  STUDIO_BG3D_SURFACE_PRESETS,
} from "./studio-bg3d-surface-presets";
export {
  collectStudioBg3dSurfaceSelectionSubtreeIds,
  collectStudioBg3dSurfaceTargetPathIds,
  planStudioBg3dMultiSurfaceSnap,
  STUDIO_BG3D_SURFACE_SNAP_MAX_MULTI_INPUTS,
  type ResolveStudioBg3dSurfaceSnapInput,
} from "./studio-bg3d-surface-snap";
export {
  deleteBg3dTemplateV12 as deleteBg3dTemplate,
  instantiateBg3dTemplateDocument,
  listBg3dTemplatesV12 as listBg3dTemplates,
  saveBg3dTemplateV12 as saveBg3dTemplate,
  type Bg3dTemplateLibraryEntry,
} from "./studio-bg3d-template-library-loader";
export {
  calculateStudioBg3dThreeReparentTransform,
  calculateStudioBg3dThreeWorldMatrix,
  calculateStudioBg3dThreeWorldDeltaTransform,
} from "./studio-bg3d-three-hierarchy";
export { resolveStudioBg3dThreeCenterGroundLocalPosition } from "./studio-bg3d-three-model-alignment";
export {
  applyStudioBg3dThreeRenderSettings,
  applyStudioBg3dThreeWebglRenderSettings,
} from "./studio-bg3d-three-render-settings";
export { useStudioBg3dEngineRuntime } from "./useStudioBg3dEngineRuntime";
export { StudioBg3dEnginePanel } from "./StudioBg3dEnginePanel";
export {
  ADD_BUTTONS,
  BG_PANEL_TABS,
  BG3D_VIEWPORT_HINTS,
  DEFAULT_LT_USER_PRESET_DESCRIPTION,
  EMPTY_THREE_ANIMATION_CLIPS,
  EMPTY_THREE_JOINTS,
  EMPTY_THREE_MORPH_TARGETS,
  loadStudioBg3dBabylonSpecialistEntry,
  loadStudioBg3dModelThumbnailRuntime,
  LT_EXPORT_HEIGHTS,
  LT_TONE_MODE_LABELS,
  LT_TONE_PATTERN_LABELS,
  LT_TONE_TYPE_LABELS,
  SEMANTIC_MATERIAL_CONFIDENCE_LABELS,
  SEMANTIC_MATERIAL_SLOT_LABELS,
  STUDIO_BG3D_LT_INSERT_WORKER_TIMEOUT_MS,
  TRANSFORM_MODES,
  VIEW_EDITOR_SECTIONS,
  VIEWPORT_BTN,
  type BgPanelTab,
  type CaptureState,
  type LtEditorSection,
  type LtUserPresetLibraryStatus,
  type LtUserPresetNotice,
  type ModelThumbnailGpuLease,
  type StudioBackground3DProps,
  type StudioBg3dBabylonSpecialistEntry,
  type StudioBg3dModelThumbnailCaptureControllerConstructor,
  type StudioBg3dModelThumbnailRuntime,
  type StudioBg3dPhysicsSession,
  type TransformModeId,
  type TransformSpace,
  type ViewEditorSection,
} from "./StudioBackground3DTypes";
export { StudioBg3dActionFooter } from "./StudioBg3dActionFooter";
export { StudioBg3dDirectionalShadowLight } from "./StudioBg3dDirectionalShadowLight";
export { StudioBg3dImmersivePanel } from "./StudioBg3dImmersivePanel";
export { StudioBg3dLtPanel } from "./StudioBg3dLtPanel";
export { StudioBg3dMeasurementPanel } from "./StudioBg3dMeasurementPanel";
export { StudioBg3dMeasurementViewport } from "./StudioBg3dMeasurementViewport";
export {
  StudioBg3dPhysicsPanel,
  StudioBg3dPhysicsTransport,
} from "./StudioBg3dPhysicsControls";
export { StudioBg3dPlacementPointerController } from "./StudioBg3dPlacementPointerController";
export { StudioBg3dRoomBuilderPanel } from "./StudioBg3dRoomBuilderPanel";
export { StudioBg3dSceneFog } from "./StudioBg3dSceneFog";
export {
  BgAdaptiveDprController,
  BgCustomModelInstanceBatch,
  BgCustomModelMesh,
  BgGroundHelper,
  BgPlacementPreview,
  BgPrimitiveMesh,
  BgScaleGuide,
  BgSectionPlaneController,
  BgViewportController,
  SkyClearColorController,
  StudioBg3dThreeRenderSettingsController,
  type StudioBg3dPlacementPreviewAsset,
  type StudioBg3dRigBakeReader,
} from "./StudioBg3dSceneNodes";
export { StudioBg3dScenePanorama } from "./StudioBg3dScenePanorama";
export const StudioBg3dSceneTemplatePanel = createLazyComponent(() =>
  import("./StudioBg3dSceneTemplatePanel").then(({ StudioBg3dSceneTemplatePanel: Panel }) => ({
    default: Panel,
  }))
);
export { StudioBg3dShapesPanel } from "./StudioBg3dShapesPanel";
export { StudioBg3dSharedCharacterSceneContent } from "./StudioBg3dSharedCharacterSceneContent";
export { StudioBg3dSharedCharacterStatusOverlay } from "./StudioBg3dSharedCharacterStatusOverlay";
export const StudioBg3dSharedStagePanel = createLazyComponent(() =>
  import("./StudioBg3dSharedStagePanel").then(({ StudioBg3dSharedStagePanel: Panel }) => ({
    default: Panel,
  }))
);
export {
  StudioBg3dViewPanel,
  type StudioBg3dBabylonDiagnosticBackend,
  type StudioBg3dBabylonDiagnosticState,
} from "./StudioBg3dViewPanel";
export {
  StudioBg3dImmersiveRenderBridge,
  StudioBg3dWebXrSessionBridge,
} from "./StudioBg3dWebXrSessionBridge";


export type {
  StudioBg3dCaptureAdapter,
  StudioBg3dCaptureRequest,
} from "./studio-bg3d-capture-adapter";
export type { StudioBg3dImmersiveStagePlan } from "./studio-bg3d-immersive-stage";
export type { StudioBg3dImportProgress } from "./studio-bg3d-model-import";
export type { StudioBg3dModelThumbnailCaptureController } from "./studio-bg3d-model-thumbnail-capture";
export type { StudioBg3dModelThumbnailThreeCaptureHandle } from "./studio-bg3d-model-thumbnail-three-capture";
export type {
  StudioBg3dPhysicsTimelineWorkerSession,
} from "./studio-bg3d-physics-worker-client";
export type { StudioBg3dShotBatchPass } from "./studio-bg3d-shot-batch-pass-catalog";
export type { StudioBg3dShotBatchRecoveryScope } from "./studio-bg3d-shot-batch-plan";
export type {
  StudioBg3dShotBatchRecoverySession,
  StudioBg3dShotBatchRecoveryStore,
} from "./studio-bg3d-shot-batch-recovery-store";
export type {
  StudioBackground3DInsertResult,
} from "../scene-3d/studio-3d-insert-contract";
export type { StudioToolHintSpec } from "../studio-tool-hints";
export type {
  StudioWebXrMode,
  StudioWebXrSessionController,
  StudioWebXrSessionState,
  StudioWebXrSupportSnapshot,
} from "../studio-webxr-session";
