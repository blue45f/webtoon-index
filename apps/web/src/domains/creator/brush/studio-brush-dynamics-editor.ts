import {
  STUDIO_BRUSH_DYNAMICS_PRESETS,
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSettingsEqual,
  type NormalizedStudioBrushDynamicsMapping,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioBrushDynamicsMappingSettings,
  type StudioBrushDynamicsPresetId,
  type StudioBrushDynamicsSource,
  type StudioBrushTaperSettings,
} from "./studio-brush-dynamics";
import {
  normalizeStudioBrushColorDynamicsSettings,
  normalizeStudioBrushGrainSettings,
  type StudioBrushColorDynamicsSettings,
  type StudioBrushGrainSettings,
} from "./studio-brush-material-dynamics";
import {
  normalizeStudioBrushTipSettings,
  type StudioBrushTipSettings,
} from "./studio-brush-tip-stamp";

export type StudioBrushDynamicsPropertyKey =
  | "width"
  | "opacity"
  | "flow"
  | "spacing"
  | "scatter"
  | "angle"
  | "roundness";

export function studioBrushDynamicsPresetMatch(
  settings: unknown
): StudioBrushDynamicsPresetId | null {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  // Toolbar and panel selection mint the causal stamp-grid v2 pin at the brush-id variant seam,
  // while `STUDIO_BRUSH_DYNAMICS_PRESETS` stays unpinned. The pin marks a render lattice rule,
  // not an authored tweak, so ignore it when deciding which preset lights up as active.
  const comparable = normalized.causalStampGridRule === undefined
    ? normalized
    : normalizeStudioBrushDynamicsSettings({ ...normalized, causalStampGridRule: undefined });
  for (const preset of STUDIO_BRUSH_DYNAMICS_PRESETS) {
    if (studioBrushDynamicsSettingsEqual(comparable, studioBrushDynamicsPresetSettings(preset.id))) {
      return preset.id;
    }
  }
  return null;
}

export function studioBrushDynamicsActiveMappingCount(settings: unknown): number {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  return (
    normalized.width.mappings.length
    + normalized.opacity.mappings.length
    + normalized.flow.mappings.length
    + normalized.spacing.mappings.length
    + normalized.scatter.mappings.length
    + normalized.angle.mappings.length
    + normalized.roundness.mappings.length
  );
}

export function findStudioBrushDynamicsMapping(
  settings: unknown,
  property: StudioBrushDynamicsPropertyKey,
  source: StudioBrushDynamicsSource
): NormalizedStudioBrushDynamicsMapping | null {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  return normalized[property].mappings.find((mapping) => mapping.source === source) ?? null;
}

export function updateStudioBrushDynamicsMapping(
  settings: unknown,
  property: StudioBrushDynamicsPropertyKey,
  source: StudioBrushDynamicsSource,
  patch: Partial<StudioBrushDynamicsMappingSettings>,
  fallback: StudioBrushDynamicsMappingSettings = { source, from: 0, to: 1 }
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  const currentProperty = normalized[property];
  const existing = currentProperty.mappings.find((mapping) => mapping.source === source);
  const nextMapping: StudioBrushDynamicsMappingSettings = {
    ...fallback,
    ...existing,
    ...patch,
    source,
  };
  const mappings = existing
    ? currentProperty.mappings.map((mapping) => mapping.source === source ? nextMapping : mapping)
    : [...currentProperty.mappings, nextMapping];
  return normalizeStudioBrushDynamicsSettings({
    ...normalized,
    [property]: { ...currentProperty, mappings },
  });
}

export function removeStudioBrushDynamicsMapping(
  settings: unknown,
  property: StudioBrushDynamicsPropertyKey,
  source: StudioBrushDynamicsSource
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  const currentProperty = normalized[property];
  return normalizeStudioBrushDynamicsSettings({
    ...normalized,
    [property]: {
      ...currentProperty,
      mappings: currentProperty.mappings.filter((mapping) => mapping.source !== source),
    },
  });
}

export function updateStudioBrushDynamicsPropertyBase(
  settings: unknown,
  property: StudioBrushDynamicsPropertyKey,
  base: number
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  return normalizeStudioBrushDynamicsSettings({
    ...normalized,
    [property]: { ...normalized[property], base },
  });
}

export function updateStudioBrushDynamicsRatio(
  settings: unknown,
  property: "spacing" | "scatter",
  ratio: number | null
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  const key = property === "spacing" ? "spacingRatio" : "scatterRatio";
  return normalizeStudioBrushDynamicsSettings({ ...normalized, [key]: ratio });
}

export function updateStudioBrushDynamicsJitter(
  settings: unknown,
  property: StudioBrushDynamicsPropertyKey,
  amount: number,
  mode: "multiply" | "add" = "multiply"
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  return normalizeStudioBrushDynamicsSettings({
    ...normalized,
    [property]: {
      ...normalized[property],
      jitter: amount > 0 ? { mode, amount } : null,
    },
  });
}

export function updateStudioBrushDynamicsTaper(
  settings: unknown,
  patch: Partial<StudioBrushTaperSettings>
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  return normalizeStudioBrushDynamicsSettings({
    ...normalized,
    taper: { ...normalized.taper, ...patch },
  });
}

export function updateStudioBrushDynamicsGrain(
  settings: unknown,
  patch: Partial<StudioBrushGrainSettings>
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  return normalizeStudioBrushDynamicsSettings({
    ...normalized,
    grain: normalizeStudioBrushGrainSettings({ ...normalized.grain, ...patch }),
  });
}

export function updateStudioBrushDynamicsTip(
  settings: unknown,
  patch: Partial<StudioBrushTipSettings>
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  return normalizeStudioBrushDynamicsSettings({
    ...normalized,
    tip: normalizeStudioBrushTipSettings({ ...normalized.tip, ...patch }),
  });
}

export function updateStudioBrushDynamicsColorDynamics(
  settings: unknown,
  patch: Partial<StudioBrushColorDynamicsSettings>
): NormalizedStudioBrushDynamicsSettings {
  const normalized = normalizeStudioBrushDynamicsSettings(settings);
  return normalizeStudioBrushDynamicsSettings({
    ...normalized,
    colorDynamics: normalizeStudioBrushColorDynamicsSettings({
      ...normalized.colorDynamics,
      ...patch,
    }),
  });
}
