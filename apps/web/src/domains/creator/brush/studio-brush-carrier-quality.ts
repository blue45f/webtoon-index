/**
 * Quality guardrails for continuously painted, stamp-carried brush presets.
 *
 * A continuous charcoal, crayon or soft wash is still rendered as a sequence of finite carriers.
 * If preset generation combines wide station spacing with independently scattered centres, the
 * carrier silhouette becomes visible as a row of circles/ovals while the pointer is moving. The
 * paper grain then looks like a defect in the dab lattice instead of a material texture.
 *
 * This policy is deliberately applied only while built-in catalogue presets are materialized.
 * User-authored dynamics and intentionally discrete particle/pattern/stamp brushes remain exact.
 * It does not copy a vendor preset: the limits are renderer-derived overlap budgets expressed as
 * fractions of our own canonical tip diameter.
 */

import {
  normalizeStudioBrushDynamicsSettings,
  type NormalizedStudioBrushDynamicsProperty,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";

export const STUDIO_BRUSH_CONTINUOUS_CARRIER_POLICY_VERSION =
  "continuous-carrier-quality-v3" as const;

export interface StudioBrushContinuousCarrierPolicyInput {
  readonly runtimeBrushId: "airbrush" | "dry-media" | "ink-particle";
  readonly category: string;
  readonly previewStyle: string;
  readonly settings: NormalizedStudioBrushDynamicsSettings;
}

const DISCRETE_CATEGORIES = new Set([
  "foliage",
  "pattern",
  "pixel",
  "stamp",
  "tone",
]);

const DISCRETE_PREVIEW_STYLES = new Set([
  "dashed",
  "dots",
  "glitter",
  "tone",
]);

interface CarrierLimits {
  readonly spacingRatio: number;
  readonly scatterRatio: number;
}

/**
 * Soft airbrush washes hide most of the tip disk in falloff, so a 0.16 tip-diameter station gap
 * still reads as a row of beads ("번짐 끊김"). Keep wash/paint carriers denser than hard nibs.
 * Softness further tightens the envelope without rewriting intentional particle presets.
 */
function carrierLimits(
  input: StudioBrushContinuousCarrierPolicyInput,
): CarrierLimits {
  if (input.runtimeBrushId === "airbrush") {
    if (input.category === "marker") {
      return { spacingRatio: 0.12, scatterRatio: 0.05 };
    }
    if (input.previewStyle === "soft" || input.category === "paint") {
      // ~1.45× denser than v2 (0.16). Soft wash falloff still beads above ~0.12 tip-diameter.
      return { spacingRatio: 0.11, scatterRatio: 0.05 };
    }
    return { spacingRatio: 0.15, scatterRatio: 0.08 };
  }
  if (input.runtimeBrushId === "dry-media") {
    if (
      input.category === "ink"
      || input.category === "marker"
      || input.category === "paint"
    ) {
      return {
        spacingRatio: 0.16,
        scatterRatio: input.category === "marker" ? 0.07 : 0.09,
      };
    }
    return { spacingRatio: 0.2, scatterRatio: 0.11 };
  }
  return { spacingRatio: 0.16, scatterRatio: 0.07 };
}

/** Softer tips need denser stations; hard tips keep the full limit. */
function softnessSpacingScale(softness: number): number {
  const soft = Math.min(1, Math.max(0, softness));
  // softness 0 → 1.0, 0.5 → 0.89, 0.85 → 0.81, 1.0 → 0.78
  return 1 - soft * 0.22;
}

function clampSpacingSpeedMappings(
  property: NormalizedStudioBrushDynamicsProperty,
  maxTo = 1.12,
): NormalizedStudioBrushDynamicsProperty {
  if (property.mappings.length === 0) return property;
  let changed = false;
  const mappings = property.mappings.map((mapping) => {
    if (mapping.source !== "speed") return mapping;
    if (mapping.to <= maxTo) return mapping;
    changed = true;
    return { ...mapping, to: maxTo };
  });
  return changed ? { ...property, mappings } : property;
}

function capJitter(
  property: NormalizedStudioBrushDynamicsProperty,
  maximumAmount: number,
): NormalizedStudioBrushDynamicsProperty {
  if (!property.jitter || property.jitter.amount <= maximumAmount) {
    return property;
  }
  return {
    ...property,
    jitter: {
      ...property.jitter,
      amount: maximumAmount,
    },
  };
}

function hasTexturedCarrier(
  settings: NormalizedStudioBrushDynamicsSettings,
): boolean {
  return settings.grain.amount > 0
    || settings.tip.shape === "bristle"
    || settings.tip.shape === "grain"
    || settings.tip.shape === "sponge";
}

function stabilizeContinuousCarrierColor(
  input: StudioBrushContinuousCarrierPolicyInput,
): NormalizedStudioBrushDynamicsSettings["colorDynamics"] {
  const colorDynamics = input.settings.colorDynamics;

  /*
   * Continuous catalogue paint has one pigment colour per stroke. Signed per-dab HSV/background
   * jitter lets a later, lighter carrier raise RGB luminance even though source-over alpha remains
   * monotonic, which looks exactly like an earlier mark was rubbed away at self-overlaps. Grain,
   * pressure, flow and opacity still retain material variation without changing pigment identity.
   *
   * Analytic soft tips have an additional performance requirement: every exact jitter colour needs
   * a separately tinted 259×259 falloff surface. Once the small immutable cache fills, long wet
   * washes otherwise retint that complete scratch surface at nearly every station and expose the
   * regular carrier lattice as lighter/darker discs.
   *
   * Explicit particle/stamp presets return before this helper, and user-authored dynamics never
   * pass through the catalogue materialization policy.
   */
  return {
    ...colorDynamics,
    foregroundBackgroundJitter: 0,
    hueJitter: 0,
    saturationJitter: 0,
    valueJitter: 0,
  };
}

export function studioBrushPresetUsesIntentionalDiscreteCarrier(
  input: Pick<
    StudioBrushContinuousCarrierPolicyInput,
    "category" | "previewStyle" | "runtimeBrushId"
  >,
): boolean {
  // `effect` is deliberately not a blanket discrete category. Soft smoke/cloud effects and
  // flowing weather wisps are continuous paint carriers even though they live in the FX library.
  // Their visual preview is `soft`/`wavy`, whereas repeated particles, glints, rain stamps and
  // similar authored marks already opt into one of the explicit discrete preview styles below.
  return DISCRETE_CATEGORIES.has(input.category)
    // Ink-particle FX rendered as a wavy preview are authored repeated line/ray motifs (for
    // example focus-ray stamps), unlike airbrush smoke/cloud streams that need carrier overlap.
    || (
      input.category === "effect"
      && input.previewStyle === "wavy"
      && input.runtimeBrushId === "ink-particle"
    )
    || DISCRETE_PREVIEW_STYLES.has(input.previewStyle);
}

/**
 * Returns a detached normalized preset with a continuous carrier envelope.
 *
 * - spacing is bounded before a full tip-diameter hole can open;
 * - scatter is bounded tightly enough that neighbouring carrier supports keep overlapping;
 * - white-noise amplitude is limited while pressure mappings remain untouched;
 * - a tiny deterministic rotation is added to textured tips that otherwise repeat one identical
 *   bitmap orientation. The canonical seeded jitter stream still guarantees prefix-stable replay.
 */
export function applyStudioBrushContinuousCarrierQualityPolicy(
  input: StudioBrushContinuousCarrierPolicyInput,
): NormalizedStudioBrushDynamicsSettings {
  if (studioBrushPresetUsesIntentionalDiscreteCarrier(input)) {
    return normalizeStudioBrushDynamicsSettings(input.settings);
  }

  const limits = carrierLimits(input);
  const settings = input.settings;
  const softnessScale = softnessSpacingScale(settings.tip.softness);
  const spacingCap = limits.spacingRatio * softnessScale;
  const scatterCap = limits.scatterRatio * (0.7 + 0.3 * softnessScale);
  const spacingRatio = settings.spacingRatio === null
    ? null
    : Math.min(settings.spacingRatio, spacingCap);
  const scatterRatio = settings.scatterRatio === null
    ? null
    : Math.min(settings.scatterRatio, scatterCap);
  const angle = capJitter(settings.angle, 12);
  /*
   * An alpha map is only a tip silhouette transport. Broad chisel/calligraphy tips also use an
   * alpha map, and rotating each station of those otherwise smooth carriers exposes a saw-tooth
   * dab lattice along both edges. Decorrelate only genuinely textured material (grain/bristle/
   * sponge), while a flat mapped nib keeps its authored orientation exactly.
   */
  const antiRepeatAngle = angle.jitter || !hasTexturedCarrier(settings)
    ? angle
    : {
        ...angle,
        jitter: {
          mode: "add" as const,
          amount: 2.5,
        },
      };

  // Soft wash only: speed-widened station gaps reopen holes the ratio cap just closed.
  // Line tools (G-pen etc.) keep authored speed→spacing so ink loading still varies by speed.
  const softWash =
    input.runtimeBrushId === "airbrush"
    && (
      input.previewStyle === "soft"
      || input.category === "paint"
      || input.category === "marker"
    );
  const spacing = softWash
    ? clampSpacingSpeedMappings(capJitter(settings.spacing, 0.08), 1.12)
    : capJitter(settings.spacing, 0.1);
  const scatterJitterCap = softWash ? 0.1 : 0.14;

  return normalizeStudioBrushDynamicsSettings({
    ...settings,
    spacingRatio,
    scatterRatio,
    width: capJitter(settings.width, 0.18),
    opacity: capJitter(settings.opacity, 0.2),
    flow: capJitter(settings.flow, 0.16),
    spacing,
    scatter: capJitter(settings.scatter, scatterJitterCap),
    angle: antiRepeatAngle,
    roundness: capJitter(settings.roundness, 0.12),
    colorDynamics: stabilizeContinuousCarrierColor(input),
  });
}
