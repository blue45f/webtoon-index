/**
 * Persisted opt-in for pressure-sensitive material appearance.
 *
 * Omitted strokes predate the material-pressure rollout and keep their historical fixed width,
 * opacity and halo. The one shared marker covers retained pencil/angled-nib media and fixed-path
 * FX so collaboration, replay and export cannot infer provenance from pressure values.
 */
export const STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 =
  "canonical-material-v1" as const;

export type StudioMaterialPressureModel =
  typeof STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1;

export function isStudioMaterialPressureModel(
  value: unknown,
): value is StudioMaterialPressureModel {
  return value === STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1;
}

/**
 * Stroke-local minimum diameter selected when the material stroke starts.
 *
 * This is deliberately separate from canonical pigment pressure: opacity, flow and halo continue
 * to receive the unmodified 0..1 pressure journal while only geometry observes this floor.
 * Omitted values identify strokes authored before the setting was persisted and must therefore
 * leave their existing pixels unchanged.
 */
export type StudioMaterialMinimumDiameterRatio = number;

export function isStudioMaterialMinimumDiameterRatio(
  value: unknown,
): value is StudioMaterialMinimumDiameterRatio {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Snapshots the stricter of the artist setting and the physical brush-family diameter floor. */
export function snapshotStudioMaterialMinimumDiameterRatio(
  artistMinimum: unknown,
  familyMinimum: unknown,
): StudioMaterialMinimumDiameterRatio {
  const artist = typeof artistMinimum === "number" && Number.isFinite(artistMinimum)
    ? clamp01(artistMinimum)
    : 0;
  const family = typeof familyMinimum === "number" && Number.isFinite(familyMinimum)
    ? clamp01(familyMinimum)
    : 0;
  return Math.max(artist, family);
}

/**
 * Applies a persisted geometry floor without changing pigment pressure.
 *
 * Invalid/unversioned local data is ignored here; the CRDT admission boundary rejects a present
 * malformed value so collaborators never disagree about its interpretation.
 */
export function applyStudioMaterialMinimumDiameterRatio(
  diameterScale: number,
  minimumDiameterRatio: unknown,
): number {
  return isStudioMaterialMinimumDiameterRatio(minimumDiameterRatio)
    ? Math.max(diameterScale, minimumDiameterRatio)
    : diameterScale;
}
