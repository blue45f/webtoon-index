/**
 * Deterministic material-response probe for dynamic brushes.
 *
 * Commercial brush libraries often look diverse while opacity, flow, spacing and texture collapse
 * to the same renderer result. This DOM-free probe exercises the real dynamics/tip/grain engines
 * on one fixed curved stroke and reports each response axis separately:
 *
 * - geometry: arc-length spacing, size and scatter,
 * - deposition: per-dab flow buildup under the layered-flow paint contract,
 * - texture: primary/dual tip alpha plus document-space grain,
 * - blend: the active dual-tip composition mode.
 *
 * The result can back catalogue validation and future generated preview strokes. It deliberately
 * contains no competitor assets, names or implementation details.
 */

import {
  normalizeStudioBrushDynamicsSettings,
  planNormalizedStudioDynamicBrushDabs,
  type StudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import { resolveNormalizedStudioBrushGrainAlphaMultiplierAt } from "./studio-brush-material-dynamics";
import { composeStudioBrushDualTipAlphaMap } from "./studio-brush-tip-composition";
import {
  resolveStudioLayeredFlowOverlapAlpha,
  resolveStudioLegacyPerDabOverlapAlpha,
} from "./studio-stroke-paint-model";

const RESPONSE_PROBE_POINTS = [
  8, 32,
  20, 20,
  36, 34,
  52, 16,
  72, 28,
  92, 20,
] as const;

const RESPONSE_PROBE_PRESSURES = [0.45, 0.62, 0.78, 0.58, 0.86, 0.66] as const;
const RESPONSE_PROBE_SPEEDS = [0.25, 0.5, 1.2, 0.4, 1.6, 0.8] as const;
const RESPONSE_PROBE_SEED = 0x6d2b_79f5;
const RESPONSE_PROBE_OVERLAP_COUNTS = [1, 4, 16] as const;
const TEXTURE_OCCUPANCY_THRESHOLD = 0.02;

export interface StudioBrushMaterialResponseGeometry {
  readonly dabCount: number;
  readonly meanSpacing: number;
  readonly spacingVariance: number;
  readonly meanSize: number;
  readonly sizeVariance: number;
  readonly meanScatterRatio: number;
}

export interface StudioBrushMaterialResponseDeposition {
  /** Whole-stroke opacity; flow buildup must never cross this ceiling. */
  readonly opacityCeiling: number;
  /** Dab-local opacity after pressure/taper mappings, before flow and tip alpha. */
  readonly dabOpacity: number;
  /** Pigment deposited by one representative dab. */
  readonly flow: number;
  /** Strongest combined tip/grain sample used for the visible buildup probe. */
  readonly materialPeakAlpha: number;
  /** Flow × dab opacity × material peak, without whole-stroke opacity. */
  readonly perDabDepositionAlpha: number;
  readonly overlap1Alpha: number;
  readonly overlap4Alpha: number;
  readonly overlap16Alpha: number;
  /**
   * Frozen historical per-dab-opacity result. A positive delta from the layered result quantifies
   * how much self-overlap darkening the separated paint model prevents.
   */
  readonly legacyOverlap16Alpha: number;
  readonly preventedDarkeningAt16: number;
}

export interface StudioBrushMaterialResponseTexture {
  readonly tipMeanAlpha: number;
  readonly tipAlphaVariance: number;
  readonly grainMeanMultiplier: number;
  readonly grainMultiplierVariance: number;
  readonly materialMeanAlpha: number;
  readonly materialAlphaVariance: number;
  readonly occupiedRatio: number;
  readonly dualBlendMode: "multiply" | "none" | "screen";
  readonly dualSizeRatio: number;
}

export interface StudioBrushMaterialResponseFingerprints {
  readonly geometry: string;
  readonly deposition: string;
  readonly texture: string;
  readonly combined: string;
}

export interface StudioBrushMaterialResponse {
  readonly geometry: StudioBrushMaterialResponseGeometry;
  readonly deposition: StudioBrushMaterialResponseDeposition;
  readonly texture: StudioBrushMaterialResponseTexture;
  readonly fingerprints: StudioBrushMaterialResponseFingerprints;
}

export interface StudioBrushMaterialResponseInput {
  readonly brushDynamics?: StudioBrushDynamicsSettings | null;
  readonly defaultWidth: number;
  readonly defaultOpacity: number;
  readonly seed?: number;
}

interface Distribution {
  readonly mean: number;
  readonly variance: number;
  readonly peak: number;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function rounded(value: number, digits = 6): number {
  const multiplier = 10 ** digits;
  return Math.round(finiteNumber(value, 0) * multiplier) / multiplier;
}

function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { mean: 0, variance: 0, peak: 0 };
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => {
    const difference = value - mean;
    return total + difference * difference;
  }, 0) / values.length;
  return {
    mean: rounded(mean),
    variance: rounded(variance),
    peak: rounded(Math.max(...values)),
  };
}

function pairDistances(
  values: readonly { readonly sourceX: number; readonly sourceY: number }[]
): number[] {
  const distances: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const current = values[index]!;
    const previous = values[index - 1]!;
    distances.push(Math.hypot(
      current.sourceX - previous.sourceX,
      current.sourceY - previous.sourceY,
    ));
  }
  return distances;
}

function fingerprint(value: object): string {
  return JSON.stringify(value);
}

/**
 * Profiles one brush with a fixed, bounded path. The same normalized settings and seed always
 * produce byte-identical fingerprints, including after JSON persistence/collaboration replay.
 */
export function profileStudioBrushMaterialResponse(
  input: StudioBrushMaterialResponseInput
): StudioBrushMaterialResponse {
  const settings = normalizeStudioBrushDynamicsSettings(input.brushDynamics);
  const defaultWidth = clamp(finiteNumber(input.defaultWidth, 6), 0.25, 4096);
  const defaultOpacity = clamp01(finiteNumber(input.defaultOpacity, 1));
  const seed = Math.trunc(clamp(
    finiteNumber(input.seed, RESPONSE_PROBE_SEED),
    0,
    0xffff_ffff,
  )) >>> 0;

  // Keep whole-stroke opacity outside the dab planner. This is the central semantic distinction:
  // local opacity and flow build pigment, while defaultOpacity caps the completed stroke.
  const dabs = planNormalizedStudioDynamicBrushDabs({
    baseOpacity: 1,
    baseWidth: defaultWidth,
    maxDabs: 4096,
    points: RESPONSE_PROBE_POINTS,
    pressures: RESPONSE_PROBE_PRESSURES,
    seed,
    speeds: RESPONSE_PROBE_SPEEDS,
  }, settings);
  const representative = dabs[Math.floor(dabs.length / 2)];
  const spacingStats = distribution(pairDistances(dabs));
  const sizeStats = distribution(dabs.map((dab) => dab.size));
  const meanScatterRatio = dabs.length === 0
    ? 0
    : dabs.reduce((total, dab) => (
        total
        + Math.hypot(dab.x - dab.sourceX, dab.y - dab.sourceY)
          / Math.max(0.25, dab.size)
      ), 0) / dabs.length;

  const geometry = Object.freeze({
    dabCount: dabs.length,
    meanSpacing: spacingStats.mean,
    spacingVariance: spacingStats.variance,
    meanSize: sizeStats.mean,
    sizeVariance: sizeStats.variance,
    meanScatterRatio: rounded(meanScatterRatio),
  }) satisfies StudioBrushMaterialResponseGeometry;

  const tipMap = composeStudioBrushDualTipAlphaMap(settings.tip, settings.dualBrush);
  const tipAlphas = Array.from(tipMap.alphas, clamp01);
  const tipStats = distribution(tipAlphas);
  const grainMultipliers: number[] = [];
  const materialAlphas: number[] = [];
  const mapMaximum = Math.max(1, tipMap.size - 1);
  const probeSize = representative?.size ?? defaultWidth;
  const probeRadius = Math.max(0.125, probeSize / 2);
  const probeX = representative?.x ?? RESPONSE_PROBE_POINTS[0];
  const probeY = representative?.y ?? RESPONSE_PROBE_POINTS[1];
  for (let index = 0; index < tipAlphas.length; index += 1) {
    const gridX = index % tipMap.size;
    const gridY = Math.floor(index / tipMap.size);
    const worldX = probeX + ((gridX / mapMaximum) * 2 - 1) * probeRadius;
    const worldY = probeY + ((gridY / mapMaximum) * 2 - 1) * probeRadius;
    const grain = resolveNormalizedStudioBrushGrainAlphaMultiplierAt(
      worldX,
      worldY,
      RESPONSE_PROBE_POINTS[0],
      RESPONSE_PROBE_POINTS[1],
      seed,
      settings.grain,
    );
    grainMultipliers.push(grain);
    materialAlphas.push((tipAlphas[index] ?? 0) * grain);
  }
  const grainStats = distribution(grainMultipliers);
  const materialStats = distribution(materialAlphas);
  const occupiedRatio = materialAlphas.length === 0
    ? 0
    : materialAlphas.filter((alpha) => alpha > TEXTURE_OCCUPANCY_THRESHOLD).length
      / materialAlphas.length;
  const activeDualBrush = settings.dualBrush?.enabled === true
    ? settings.dualBrush
    : null;
  const texture = Object.freeze({
    tipMeanAlpha: tipStats.mean,
    tipAlphaVariance: tipStats.variance,
    grainMeanMultiplier: grainStats.mean,
    grainMultiplierVariance: grainStats.variance,
    materialMeanAlpha: materialStats.mean,
    materialAlphaVariance: materialStats.variance,
    occupiedRatio: rounded(occupiedRatio),
    dualBlendMode: activeDualBrush?.blendMode ?? "none",
    dualSizeRatio: rounded(activeDualBrush?.sizeRatio ?? 1),
  }) satisfies StudioBrushMaterialResponseTexture;

  const dabOpacity = clamp01(representative?.opacity ?? 0);
  const flow = clamp01(representative?.flow ?? 0);
  const perDabDepositionAlpha = clamp01(
    dabOpacity * flow * materialStats.peak
  );
  const layeredOverlap = RESPONSE_PROBE_OVERLAP_COUNTS.map((count) => (
    resolveStudioLayeredFlowOverlapAlpha(
      defaultOpacity,
      flow,
      count,
      dabOpacity * materialStats.peak,
    )
  ));
  const legacyOverlap16Alpha = resolveStudioLegacyPerDabOverlapAlpha(
    defaultOpacity,
    flow,
    RESPONSE_PROBE_OVERLAP_COUNTS[2],
    dabOpacity * materialStats.peak,
  );
  const deposition = Object.freeze({
    opacityCeiling: rounded(defaultOpacity),
    dabOpacity: rounded(dabOpacity),
    flow: rounded(flow),
    materialPeakAlpha: materialStats.peak,
    perDabDepositionAlpha: rounded(perDabDepositionAlpha),
    overlap1Alpha: rounded(layeredOverlap[0] ?? 0),
    overlap4Alpha: rounded(layeredOverlap[1] ?? 0),
    overlap16Alpha: rounded(layeredOverlap[2] ?? 0),
    legacyOverlap16Alpha: rounded(legacyOverlap16Alpha),
    preventedDarkeningAt16: rounded(Math.max(
      0,
      legacyOverlap16Alpha - (layeredOverlap[2] ?? 0),
    )),
  }) satisfies StudioBrushMaterialResponseDeposition;

  const geometryFingerprint = fingerprint(geometry);
  const depositionFingerprint = fingerprint(deposition);
  const textureFingerprint = fingerprint(texture);
  const fingerprints = Object.freeze({
    geometry: geometryFingerprint,
    deposition: depositionFingerprint,
    texture: textureFingerprint,
    combined: fingerprint({
      geometry: geometryFingerprint,
      deposition: depositionFingerprint,
      texture: textureFingerprint,
    }),
  }) satisfies StudioBrushMaterialResponseFingerprints;

  return Object.freeze({ geometry, deposition, texture, fingerprints });
}
