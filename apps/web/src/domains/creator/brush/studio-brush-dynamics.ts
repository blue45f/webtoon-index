/**
 * Studio professional brush dynamics core.
 *
 * This file deliberately has no DOM, Canvas, Konva or React dependency. It forms three reusable
 * layers for a future dynamic/particle brush renderer:
 *
 * 1. normalize PointerEvent-compatible samples,
 * 2. map pressure/speed/tilt/twist/direction to a deterministic dab recipe,
 * 3. resample a polyline by arc length into a bounded list of render-ready dabs,
 * 4. apply shared start/end taper and attach PNG-alpha tip stamp settings for consumers.
 *
 * Every public input/output type contains only JSON-compatible data. Random variation never uses
 * Math.random: a stroke seed and dab index fully determine jitter and scatter, so reopening,
 * collaboration replay and export all reproduce the same stroke.
 */

export {
  STUDIO_BRUSH_DYNAMICS_SETTINGS_VERSION,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
  STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  studioDryMediaUnionComposableProgramPin,
  isStudioDryMediaUnionComposableProgramPin,
  STUDIO_DRY_MEDIA_KERNEL_PROGRAM_VERSION,
  STUDIO_DRY_MEDIA_KERNEL_PROGRAM_DIGEST,
  studioDryMediaKernelDabProgramPin,
  isStudioDryMediaKernelDabProgramPin,
  STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION,
  STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST,
  studioSoftFalloffLinearAccumulationProgramPin,
  isStudioSoftFalloffLinearAccumulationProgramPin,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  isStudioDynamicBrushCausalDepositPipeline,
  type StudioDryMediaUnionProgramPin,
  type StudioDryMediaKernelProgramPin,
  type StudioSoftFalloffLinearProgramPin,
  type StudioDynamicBrushDepositPipeline,
} from "./studio-brush-dynamics-program-pins";

export {
  STUDIO_BRUSH_DYNAMICS_PROPERTY_LIMITS,
  STUDIO_DYNAMIC_BRUSH_DAB_CAP_RANGE,
  DEFAULT_STUDIO_DYNAMIC_BRUSH_MAX_DABS,
  STUDIO_BRUSH_DYNAMICS_RATIO_LIMITS,
  STUDIO_BRUSH_TAPER_LIMITS,
  applyStudioDynamicBrushMinimumDiameterRatio,
  isStudioBrushDynamicsPresetId,
  isStudioDynamicBrushMinimumDiameterRatio,
  resolveStudioBrushDynamicsPresetId,
  resolveStudioBrushDynamicsSelectionPresetId,
  resolveStudioCapturedBrushDynamicsPresetId,
  studioDynamicBrushContactFactor,
  studioDynamicBrushDepositPipelineUsesContinuation,
  type NormalizedStudioBrushDynamicsJitter,
  type NormalizedStudioBrushDynamicsMapping,
  type NormalizedStudioBrushDynamicsProperty,
  type NormalizedStudioBrushDynamicsSample,
  type NormalizedStudioBrushDynamicsSettings,
  type NormalizedStudioBrushTaperSettings,
  type StudioBrushDynamicsBrushId,
  type StudioBrushDynamicsJitterSettings,
  type StudioBrushDynamicsMappingMode,
  type StudioBrushDynamicsMappingSettings,
  type StudioBrushDynamicsPreset,
  type StudioBrushDynamicsPresetId,
  type StudioBrushDynamicsPropertySettings,
  type StudioBrushDynamicsRecipe,
  type StudioBrushDynamicsSample,
  type StudioBrushDynamicsSettings,
  type StudioBrushDynamicsSource,
  type StudioBrushTaperSettings,
  type StudioDynamicBrushDab,
  type StudioDynamicBrushMinimumDiameterRatio,
  type StudioDynamicBrushPlan,
  type StudioDynamicBrushPlanInput,
  type StudioDynamicBrushSegmentStartFrame,
} from "./studio-brush-dynamics-types";

export {
  DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS,
  STUDIO_BRUSH_DYNAMICS_PRESETS,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSettingsForBrushId,
  studioReplaySafeBrushDynamicsSettingsForBrushId,
} from "./studio-brush-dynamics-presets";

export {
  evaluateCubicBezierCurve,
  normalizeStudioBrushDynamicsSample,
  normalizeStudioBrushDynamicsSettings,
  resolveStudioBrushDynamics,
  resolveStudioBrushDynamicsForNormalizedSettings,
  serializeStudioBrushDynamicsSettingsCanonical,
  studioBrushDynamicsSeedFromKey,
  studioBrushDynamicsSettingsEqual,
  studioBrushTaperFactors,
} from "./studio-brush-dynamics-normalize";

export {
  planNormalizedStudioDynamicBrushDabs,
  planStudioDynamicBrush,
  planStudioDynamicBrushDabs,
} from "./studio-brush-dynamics-plan";
