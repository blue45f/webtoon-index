/**
 * Terminal render dynamics for the non-G-pen hybrid pressure profiles.
 *
 * `resolveStudioHybridPressureSample` owns the only pressure-curve evaluation. This adapter turns
 * its dimensionless response ratios into final renderer values exactly once. A downstream
 * renderer must consume `resolvedWidth`, `resolvedOpacity` and `resolvedFlow` directly; it must
 * not feed `inputPressure` through another pressure response curve.
 *
 * Unknown brush families are deliberately neutral so adopting this helper cannot alter an
 * existing renderer by accident. G-pen aliases return `null` because their versioned
 * perfect-freehand contract remains a separate authority.
 */

import {
  isStudioHybridPressureExcludedGpenBrush,
  resolveStudioHybridPressureProfile,
  resolveStudioHybridPressureSample,
  resolveStudioHybridPressureSeries,
  type StudioHybridPressureProfileId,
  type StudioHybridPressureSample,
  type StudioHybridPressureSampleInput,
  type StudioHybridPressureSeriesInput,
  type StudioHybridPressureSource,
} from "./studio-hybrid-pressure-profile";

export const STUDIO_HYBRID_PRESSURE_RENDER_DYNAMICS_VERSION =
  "hybrid-pressure-render-dynamics-v1" as const;

const MAX_RENDER_WIDTH = 65_536;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export interface StudioHybridPressureRenderBases {
  readonly baseWidth?: unknown;
  readonly baseOpacity?: unknown;
  readonly baseFlow?: unknown;
}

export interface StudioHybridPressureRenderDynamics {
  readonly version: typeof STUDIO_HYBRID_PRESSURE_RENDER_DYNAMICS_VERSION;
  /**
   * `terminal-resolved-once` is a semantic guardrail: the three resolved values below already
   * contain their family response and must not enter another pressure curve.
   */
  readonly pressureApplication: "terminal-resolved-once";
  readonly source: StudioHybridPressureSource | "neutral";
  readonly profileId: StudioHybridPressureProfileId | null;
  /** Pressure retained for diagnostics, texture selection and tilt logic, not response remapping. */
  readonly inputPressure: number;
  /**
   * Neutral pressure for legacy renderers that structurally require a pressure scalar after
   * receiving the terminal width/opacity/flow values.
   */
  readonly downstreamPressure: 1;
  readonly widthRatio: number;
  readonly opacityRatio: number;
  readonly flowRatio: number;
  readonly resolvedWidth: number;
  readonly resolvedOpacity: number;
  readonly resolvedFlow: number;
}

export interface StudioHybridPressureRenderDynamicsInput
  extends StudioHybridPressureSampleInput,
    StudioHybridPressureRenderBases {}

export interface StudioHybridPressureRenderDynamicsSeriesInput
  extends StudioHybridPressureSeriesInput,
    StudioHybridPressureRenderBases {}

interface SanitizedRenderBases {
  readonly width: number;
  readonly opacity: number;
  readonly flow: number;
}

function sanitizeRenderBases(
  input: StudioHybridPressureRenderBases
): SanitizedRenderBases {
  return {
    width: clamp(finiteOr(input.baseWidth, 1), 0, MAX_RENDER_WIDTH),
    opacity: clamp01(finiteOr(input.baseOpacity, 1)),
    flow: clamp01(finiteOr(input.baseFlow, 1)),
  };
}

function resolveFromSample(
  sample: StudioHybridPressureSample | null,
  bases: SanitizedRenderBases
): StudioHybridPressureRenderDynamics {
  const widthRatio = clamp01(sample?.widthRatio ?? 1);
  const opacityRatio = clamp01(sample?.opacityRatio ?? 1);
  const flowRatio = clamp01(sample?.flowRatio ?? 1);
  return Object.freeze({
    version: STUDIO_HYBRID_PRESSURE_RENDER_DYNAMICS_VERSION,
    pressureApplication: "terminal-resolved-once",
    source: sample?.source ?? "neutral",
    profileId: sample?.profileId ?? null,
    inputPressure: clamp01(sample?.pressure ?? 1),
    downstreamPressure: 1,
    widthRatio,
    opacityRatio,
    flowRatio,
    resolvedWidth: bases.width * widthRatio,
    resolvedOpacity: bases.opacity * opacityRatio,
    resolvedFlow: bases.flow * flowRatio,
  });
}

/**
 * Resolves one sample to terminal renderer values.
 *
 * - supported non-G-pen family: profile response is applied exactly once;
 * - unrelated family: base values pass through unchanged;
 * - G-pen family: `null`, preserving its existing renderer contract.
 */
export function resolveStudioHybridPressureRenderDynamics(
  brushId: unknown,
  input: StudioHybridPressureRenderDynamicsInput = {}
): StudioHybridPressureRenderDynamics | null {
  if (isStudioHybridPressureExcludedGpenBrush(brushId)) return null;
  const bases = sanitizeRenderBases(input);
  const sample = resolveStudioHybridPressureProfile(brushId)
    ? resolveStudioHybridPressureSample(brushId, input)
    : null;
  return resolveFromSample(sample, bases);
}

/**
 * Prefix-stable journal variant for replay, collaboration and export. The pressure journal remains
 * the causal authority; this function performs only a pointwise terminal scaling pass.
 */
export function resolveStudioHybridPressureRenderDynamicsSeries(
  input: StudioHybridPressureRenderDynamicsSeriesInput
): StudioHybridPressureRenderDynamics[] {
  if (isStudioHybridPressureExcludedGpenBrush(input.brushId)) return [];
  const bases = sanitizeRenderBases(input);
  if (!resolveStudioHybridPressureProfile(input.brushId)) {
    return input.samples.map(() => resolveFromSample(null, bases));
  }
  return resolveStudioHybridPressureSeries(input).map((sample) =>
    resolveFromSample(sample, bases)
  );
}
