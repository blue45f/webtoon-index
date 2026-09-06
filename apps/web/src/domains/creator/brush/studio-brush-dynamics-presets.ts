import {
  cloneNormalizedSettings,
  INTERNAL_DEFAULT_SETTINGS,
  normalizeStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics-normalize";
import {
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  studioSoftFalloffLinearAccumulationProgramPin,
} from "./studio-brush-dynamics-program-pins";
import {
  resolveStudioBrushDynamicsPresetId,
  type NormalizedStudioBrushDynamicsProperty,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioBrushDynamicsPreset,
  type StudioBrushDynamicsPresetId,
  type StudioBrushDynamicsPropertySettings,
  type StudioBrushDynamicsSettings,
} from "./studio-brush-dynamics-types";
import { STUDIO_BRUSH_DYNAMICS_VARIANTS } from "./studio-brush-dynamics-variants";

/**
 * A detached, directly JSON-serializable input value. Normalization uses a private copy so external
 * mutation cannot affect renderer defaults.
 */
export const DEFAULT_STUDIO_BRUSH_DYNAMICS_SETTINGS:
  NormalizedStudioBrushDynamicsSettings & StudioBrushDynamicsSettings = cloneNormalizedSettings(INTERNAL_DEFAULT_SETTINGS);

/** Commercial-style starting points; consumers should request a detached copy with the helper below. */
export const STUDIO_BRUSH_DYNAMICS_PRESETS: readonly StudioBrushDynamicsPreset[] = [
  {
    id: "ink-particle",
    name: "잉크 입자",
    description: "필압과 속도에 반응하는 미세 잉크 입자와 방향성 펜촉",
    settings: {
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      seed: 101,
      taper: {
        enabled: true,
        startLength: 0.1,
        endLength: 0.16,
        minSizeRatio: 0.18,
        minOpacityRatio: 0.5,
        curve: 1.05,
      },
      tip: { shape: "hard", softness: 0.22 },
      width: {
        base: 8,
        mappings: [{ source: "pressure", from: 0.22, to: 1.55 }],
        jitter: { mode: "multiply", amount: 0.08 },
      },
      opacity: { base: 0.95, mappings: [{ source: "pressure", from: 0.55, to: 1 }] },
      flow: { base: 0.85, mappings: [{ source: "pressure", from: 0.7, to: 1 }] },
      spacingRatio: 0.2,
      spacing: { mappings: [{ source: "speed", from: 0.8, to: 1.35 }] },
      scatterRatio: 0.08,
      scatter: {
        mappings: [{ source: "speed", from: 0.5, to: 1.4 }],
        jitter: { mode: "add", amount: 0.2 },
      },
      angle: {
        base: 0,
        mappings: [
          { source: "direction", mode: "add", from: 0, to: 360 },
          { source: "twist", mode: "add", from: 0, to: 360, amount: 0.25 },
        ],
        jitter: { mode: "add", amount: 6 },
      },
      roundness: { base: 0.42, mappings: [{ source: "tilt-magnitude", from: 1, to: 0.45 }] },
    },
  },
  {
    id: "airbrush",
    name: "소프트 에어브러시",
    description: "짧은 입력도 보이면서 여러 번 부드럽게 쌓이는 제어된 분사",
    settings: {
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      // Fresh-authoring linear-accumulation opt-in for the analytic soft skirt. The whole
      // airbrush family (toolbar aliases, variants, pack expansions) derives from this preset, so
      // one mint covers every freshly authored soft/spray/marker snapshot, while persisted
      // documents never gain it and replay their exact sRGB skirt
      // (`studioReplaySafeBrushDynamicsSettingsForBrushId` strips it for snapshot-less elements).
      softFalloffLinearProgram: studioSoftFalloffLinearAccumulationProgramPin(),
      seed: 202,
      taper: {
        enabled: true,
        startLength: 0.06,
        endLength: 0.1,
        minSizeRatio: 0.45,
        minOpacityRatio: 0.35,
        curve: 0.9,
      },
      // Keep a broad analytic shoulder instead of raising only the centre valve. A narrower
      // carrier made a moving stroke read as pale circular puffs even though its centre alpha was
      // technically visible. The centre remains normalized to one; opacity/flow still own density.
      tip: { shape: "soft", softness: 0.42 },
      width: {
        base: 32,
        mappings: [{ source: "pressure", from: 0.7, to: 1.25 }],
        jitter: { mode: "multiply", amount: 0.1 },
      },
      // Mouse fallback pressure is 0.5. Even with a normalized centre, the soft radial shoulder has
      // far lower mean alpha than a solid tip, so opacity/flow must keep a single pass legible.
      // Keep physical cadence independent of pointer speed: the same geometry must receive the
      // same continuous material density without opening gaps on fast pointer samples.
      opacity: { base: 0.65, mappings: [{ source: "pressure", from: 0.4, to: 1 }] },
      flow: { base: 0.5, mappings: [{ source: "pressure", from: 0.45, to: 1 }] },
      spacingRatio: 0.145,
      spacing: { mappings: [] },
      // Soft spray is one continuous envelope. Wide independent centre scatter belongs to the
      // dedicated spray/splatter variants; here it exposed the round dab lattice while moving.
      scatterRatio: 0.04,
      scatter: {
        mappings: [{ source: "pressure", from: 1, to: 0.7 }],
        jitter: null,
      },
      angle: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
    },
  },
  {
    id: "dry-media",
    name: "드라이 미디어",
    description: "크레용·목탄처럼 압력과 속도에 따라 끊기고 거칠어지는 마른 획",
    settings: {
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      seed: 303,
      taper: {
        enabled: true,
        startLength: 0.08,
        endLength: 0.14,
        minSizeRatio: 0.28,
        minOpacityRatio: 0.4,
        curve: 1.15,
      },
      tip: { shape: "grain", softness: 0.4 },
      width: {
        base: 6,
        mappings: [{ source: "pressure", from: 0.15, to: 1.45 }],
        jitter: { mode: "multiply", amount: 0.14 },
      },
      opacity: {
        base: 0.85,
        mappings: [{ source: "pressure", from: 0.35, to: 1 }],
        jitter: { mode: "multiply", amount: 0.16 },
      },
      flow: { base: 0.55, mappings: [{ source: "pressure", from: 0.5, to: 1 }] },
      // Stroke-fixed tooth follows the mark when it is transformed instead of appearing to slide
      // through the pigment. The modest amount preserves the existing opaque dry-media baseline.
      grain: {
        space: "stroke-fixed",
        amount: 0.18,
        scale: 5.5,
        contrast: 0.55,
        seed: 303,
      },
      spacingRatio: 0.16,
      // Keep a restrained velocity tooth, but cap it below one quarter of the nominal tip width.
      // Roughness comes primarily from grain/scatter rather than discontinuous high-speed gaps.
      spacing: {
        mappings: [{ source: "speed", from: 0.95, to: 1.12 }],
        jitter: null,
      },
      // Paper tooth and the textured tip create the broken edge. Large white-noise displacement
      // moved complete oval carriers apart and revealed them as beads during long strokes.
      scatterRatio: 0.08,
      scatter: {
        mappings: [{ source: "speed", from: 0.8, to: 1.15 }],
        jitter: null,
      },
      angle: {
        base: 0,
        mappings: [{ source: "direction", mode: "add", from: 0, to: 360 }],
        jitter: { mode: "add", amount: 8 },
      },
      roundness: {
        base: 0.32,
        mappings: [{ source: "tilt-magnitude", from: 1, to: 0.35 }],
        jitter: { mode: "multiply", amount: 0.1 },
      },
    },
  },
];

/** Returns a detached, normalized preset suitable for immediate UI editing or persistence. */
export function studioBrushDynamicsPresetSettings(
  id: StudioBrushDynamicsPresetId
): NormalizedStudioBrushDynamicsSettings {
  const preset = STUDIO_BRUSH_DYNAMICS_PRESETS.find((candidate) => candidate.id === id)
    ?? STUDIO_BRUSH_DYNAMICS_PRESETS[0]!;
  return normalizeStudioBrushDynamicsSettings({
    presetId: preset.id,
    ...preset.settings,
  });
}

function mergeStudioBrushDynamicsVariant(
  base: NormalizedStudioBrushDynamicsSettings,
  overrides: StudioBrushDynamicsSettings
): NormalizedStudioBrushDynamicsSettings {
  const mergeProperty = (
    property: NormalizedStudioBrushDynamicsProperty,
    override: StudioBrushDynamicsPropertySettings | undefined
  ): StudioBrushDynamicsPropertySettings => ({ ...property, ...override });

  return normalizeStudioBrushDynamicsSettings({
    ...base,
    ...overrides,
    taper: { ...base.taper, ...overrides.taper },
    tip: { ...base.tip, ...overrides.tip },
    colorDynamics: { ...base.colorDynamics, ...overrides.colorDynamics },
    grain: { ...base.grain, ...overrides.grain },
    dualBrush: { ...base.dualBrush, ...overrides.dualBrush },
    width: mergeProperty(base.width, overrides.width ?? overrides.size),
    opacity: mergeProperty(base.opacity, overrides.opacity),
    flow: mergeProperty(base.flow, overrides.flow),
    spacing: mergeProperty(base.spacing, overrides.spacing),
    scatter: mergeProperty(base.scatter, overrides.scatter),
    angle: mergeProperty(base.angle, overrides.angle),
    roundness: mergeProperty(base.roundness, overrides.roundness),
  });
}


/**
 * Resolve the exact runtime dynamics for a toolbar brush id.
 *
 * Unlike `resolveStudioBrushDynamicsPresetId`, this keeps related brushes on the same persistence
 * pipeline while returning different tip physics for rendering. Unknown/non-dynamic brushes return
 * null so callers can retain their existing ordinary line renderer.
 */
export function studioBrushDynamicsSettingsForBrushId(
  brushId: unknown
): NormalizedStudioBrushDynamicsSettings | null {
  if (typeof brushId !== "string") return null;
  const variant = STUDIO_BRUSH_DYNAMICS_VARIANTS[brushId];
  if (variant) {
    return mergeStudioBrushDynamicsVariant(
      studioBrushDynamicsPresetSettings(variant.presetId),
      variant.overrides
    );
  }
  const presetId = resolveStudioBrushDynamicsPresetId(brushId);
  return presetId ? studioBrushDynamicsPresetSettings(presetId) : null;
}

/**
 * The id-derived resolver for REPLAY of an element that stored no dynamics snapshot of its own.
 *
 * Such elements predate element-level capture, so their dynamics are re-derived from today's
 * catalogue — and that catalogue mints `dryMediaKernelProgram`, `softFalloffLinearProgram` and
 * `causalStampGridRule` for freshly authored presets. Inheriting the kernel pin would move a
 * finished stroke off the union carrier it was actually drawn with, inheriting the soft-falloff
 * pin would re-ramp its committed airbrush skirt, and inheriting the grid rule would re-lattice
 * its accepted causal dabs — all change pixels in a document the artist already closed. Only an
 * element's own stored snapshot may carry the pins.
 *
 * This exists as one shared function precisely because the rule has to hold on every surface at
 * once: canvas and SVG export each have their own fallback, and fixing only one made the same
 * document render two different ways. Call this instead of the raw resolver in any replay path.
 */
export function studioReplaySafeBrushDynamicsSettingsForBrushId(
  brushId: unknown
): NormalizedStudioBrushDynamicsSettings | null {
  const settings = studioBrushDynamicsSettingsForBrushId(brushId);
  if (
    !settings
    || (settings.dryMediaKernelProgram === undefined
      && settings.softFalloffLinearProgram === undefined
      && settings.causalStampGridRule === undefined)
  ) {
    return settings;
  }
  return normalizeStudioBrushDynamicsSettings({
    ...settings,
    dryMediaKernelProgram: undefined,
    softFalloffLinearProgram: undefined,
    causalStampGridRule: undefined,
  });
}
