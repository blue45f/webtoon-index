export const STUDIO_BRUSH_DYNAMICS_SETTINGS_VERSION = 1 as const;
export const STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION =
  "dry-media-union-causal-group-alpha-max-v3" as const;
export const STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST =
  "c5279091049bbf27c8303439b2083ff861d562fddc81deea37032d4e5aac8f96" as const;

export interface StudioDryMediaUnionProgramPin {
  readonly version: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION;
  readonly programDigest: typeof STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST;
}

export function studioDryMediaUnionComposableProgramPin(): StudioDryMediaUnionProgramPin {
  return Object.freeze({
    version: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION,
    programDigest: STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST,
  });
}

export function isStudioDryMediaUnionComposableProgramPin(
  value: unknown,
): value is StudioDryMediaUnionProgramPin {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_VERSION
    && candidate.programDigest === STUDIO_DRY_MEDIA_UNION_COMPOSABLE_PROGRAM_DIGEST
    && Object.keys(candidate).every((key) => key === "version" || key === "programDigest");
}

export const STUDIO_DRY_MEDIA_KERNEL_PROGRAM_VERSION =
  "dry-media-kernel-dab-path-v1" as const;
export const STUDIO_DRY_MEDIA_KERNEL_PROGRAM_DIGEST =
  "30c48947ab54ce7efde21a4935d7d5e278e08510e061fc5fbefb7056de818860" as const;

export interface StudioDryMediaKernelProgramPin {
  readonly version: typeof STUDIO_DRY_MEDIA_KERNEL_PROGRAM_VERSION;
  readonly programDigest: typeof STUDIO_DRY_MEDIA_KERNEL_PROGRAM_DIGEST;
}

export function studioDryMediaKernelDabProgramPin(): StudioDryMediaKernelProgramPin {
  return Object.freeze({
    version: STUDIO_DRY_MEDIA_KERNEL_PROGRAM_VERSION,
    programDigest: STUDIO_DRY_MEDIA_KERNEL_PROGRAM_DIGEST,
  });
}

export function isStudioDryMediaKernelDabProgramPin(
  value: unknown,
): value is StudioDryMediaKernelProgramPin {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === STUDIO_DRY_MEDIA_KERNEL_PROGRAM_VERSION
    && candidate.programDigest === STUDIO_DRY_MEDIA_KERNEL_PROGRAM_DIGEST
    && Object.keys(candidate).every((key) => key === "version" || key === "programDigest");
}

export const STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION =
  "soft-falloff-linear-accumulation-v1" as const;
export const STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST =
  "29fe1ed897d416ca8deda99e38f5b606e394714cd6deac0b559224ce231f6ff3" as const;

export interface StudioSoftFalloffLinearProgramPin {
  readonly version: typeof STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION;
  readonly programDigest: typeof STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST;
}

export function studioSoftFalloffLinearAccumulationProgramPin(): StudioSoftFalloffLinearProgramPin {
  return Object.freeze({
    version: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION,
    programDigest: STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST,
  });
}

export function isStudioSoftFalloffLinearAccumulationProgramPin(
  value: unknown,
): value is StudioSoftFalloffLinearProgramPin {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_VERSION
    && candidate.programDigest === STUDIO_SOFT_FALLOFF_LINEAR_PROGRAM_DIGEST
    && Object.keys(candidate).every((key) => key === "version" || key === "programDigest");
}

export const STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2_PIN =
  "causal-stamp-grid-v2" as const;

export const STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2 =
  "causal-deposit-v2" as const;

export const STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3 =
  "causal-deposit-v3-segmented" as const;

export type StudioDynamicBrushDepositPipeline =
  | typeof STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2
  | typeof STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3;

export function isStudioDynamicBrushCausalDepositPipeline(
  value: unknown,
): value is StudioDynamicBrushDepositPipeline {
  return value === STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2
    || value === STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3;
}
