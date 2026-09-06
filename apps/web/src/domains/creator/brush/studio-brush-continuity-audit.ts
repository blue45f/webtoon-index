/**
 * Deterministic brush-continuity audit.
 *
 * This module is intentionally DOM/Canvas-free so catalogue tests and future authoring tools can
 * compare every brush against the same slow/medium/fast curved input. It measures the renderer
 * contract that can create visible discontinuities:
 *
 * - dynamic brushes: source-station gap versus neighbouring tip diameter,
 * - stamp brushes: stamp-centre gap versus neighbouring radii,
 * - connected path brushes: admitted input spacing (the renderer joins those points),
 * - pixel brushes: exact grid cadence, reported but never treated as a smooth mark.
 *
 * Tapered stroke tips are excluded from the strict interior gap metric. A narrow start/end is an
 * intentional expressive feature; holes in the body of the stroke are not.
 */

import {
  resolveStudioBrushRenderFamily,
  strokeSampleDistanceForBrushFamily,
  type StudioBrushRenderFamily,
} from "../studio-brush";

import {
  planNormalizedStudioDynamicBrushDabs,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioDynamicBrushDab,
} from "./studio-brush-dynamics";
import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
  type StudioStampBrushDab,
} from "./studio-brush-stamp-engine";

export type StudioBrushContinuityAuditSpeed = "slow" | "medium" | "fast";
export type StudioBrushContinuityRenderStrategy =
  | "connected-path"
  | "dynamic-dab"
  | "pixel-grid"
  | "stamp-dab";

export interface StudioBrushContinuityAuditCandidate {
  catalogId: string;
  catalogName: string;
  runtimeBrushId: string;
  defaultWidth: number;
  defaultOpacity: number;
  brushDynamics: NormalizedStudioBrushDynamicsSettings | null;
  /** Catalogue classification used only to preserve deliberately discontinuous media. */
  category?: string;
  previewStyle?: string;
}

export interface StudioBrushContinuityProfile {
  speed: StudioBrushContinuityAuditSpeed;
  sourcePointCount: number;
  markCount: number;
  inputSampleSpacing: number;
  /** Arc-length station gap before scatter; protects source sampling continuity. */
  maxInteriorGapRatio: number;
  meanInteriorGapRatio: number;
  /**
   * Distance between the actual rendered carrier centres after deterministic scatter. This catches
   * the circular-dab/beading failure that source-station-only audits cannot see.
   */
  maxRenderedCarrierGapRatio: number;
  meanRenderedCarrierGapRatio: number;
  meanEffectiveAlpha: number;
  meanSizeRatio: number;
  meanScatterRatio: number;
  meanRoundness: number;
}

export interface StudioBrushContinuityAuditResult {
  catalogId: string;
  catalogName: string;
  renderStrategy: StudioBrushContinuityRenderStrategy;
  renderFamily: StudioBrushRenderFamily;
  intentionalDiscontinuity: boolean;
  profiles: readonly StudioBrushContinuityProfile[];
  /** Perceptual-enough deterministic fingerprint; excludes catalogue id and random seed. */
  behaviorFingerprint: string;
}

interface CurveProfile {
  speed: StudioBrushContinuityAuditSpeed;
  pointerSpeed: number;
  sourcePointCount: number;
}

const CURVE_PROFILES: readonly CurveProfile[] = [
  { speed: "slow", pointerSpeed: 0.08, sourcePointCount: 257 },
  { speed: "medium", pointerSpeed: 0.6, sourcePointCount: 129 },
  { speed: "fast", pointerSpeed: 2.5, sourcePointCount: 49 },
] as const;

const INTENTIONALLY_DISCONTINUOUS_CATEGORIES = new Set([
  "foliage",
  "pattern",
  "pixel",
  "stamp",
  "tone",
]);

const INTENTIONALLY_DISCONTINUOUS_PREVIEWS = new Set([
  "dashed",
  "dots",
  "glitter",
  "tone",
]);

/**
 * Ids this audit excuses from the continuity bar because sparse deposit IS their product promise.
 *
 * Exported because the browser gate has to agree. The gate asks three different classifiers
 * whether a preset is an intentional discrete carrier — a dry-media classification, a brush-pack
 * descriptor and the cc0 spacing threshold — and none of them can see this list. So
 * `splatter--burst-cloud`, which is excused HERE for depositing sparse carriers, was handed the
 * 9px flick meant for continuous media and reported as depositing no visible pixels. One list, two
 * consumers: a preset that this file excuses must get a gesture long enough to contain its own
 * stations.
 */
const INTENTIONALLY_DISCONTINUOUS_CATALOG_IDS = new Set([
  "spray",
  "splatter",
  // Engine-lane scatter / burst variants intentionally deposit sparse carriers
  // (same product promise as base spray/splatter particle media).
  "spray--equal-area",
  "splatter--burst-cloud",
  "ink-particle--scatter-cloud",
  "glitter--star-field",
  // Sketchpad lattice + clean-room web kits intentionally deposit sparse/stationed
  // marks (tile grids, multi-agent swarms, dash stitches, scatter stamps, hatch lattices).
  "sketchpad-tile",
  "web-multi-agent",
  "web-dash-stitch",
  "web-scatter-stamp",
  "web-hatch-color",
  "web-dot-tone",
  "web-gravity-drip",
  "web-kaleido-ink",
  "web-fur-strand",
  "web-contour-double",
  "web-radial-burst",
  "web-mirror-ink",
  "web-grid-ink",
  "web-spiro-orbit",
  "web-zigzag-edge",
  "web-neon-tube",
  "web-cross-hatch-pen",
]);

const INTERIOR_START = 0.08;
const INTERIOR_END = 0.92;
const AUDIT_SEED = 0x51f1_7a3e;

function candidateUsesIntentionalDiscontinuity(
  candidate: StudioBrushContinuityAuditCandidate,
  renderFamily: StudioBrushRenderFamily,
): boolean {
  return INTENTIONALLY_DISCONTINUOUS_CATEGORIES.has(candidate.category ?? "")
    // An effect label alone does not make a carrier discrete. Smoke, cloud and cirrus presets use
    // a soft/wavy airbrush envelope and need the same continuity gates as paint. The one wavy
    // ink-particle effect is an authored repeated ray motif and remains intentionally separated.
    || (
      candidate.category === "effect"
      && candidate.previewStyle === "wavy"
      && candidate.runtimeBrushId === "ink-particle"
    )
    || INTENTIONALLY_DISCONTINUOUS_PREVIEWS.has(candidate.previewStyle ?? "")
    || INTENTIONALLY_DISCONTINUOUS_CATALOG_IDS.has(candidate.catalogId)
    || renderFamily === "glitter"
    || renderFamily === "screentone"
    || renderFamily === "pixel";
}

function rounded(value: number, digits = 3): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function curvedInput(profile: CurveProfile): {
  points: number[];
  pressures: number[];
  speeds: number[];
} {
  const points: number[] = [];
  const pressures: number[] = [];
  const speeds: number[] = [];
  for (let index = 0; index < profile.sourcePointCount; index += 1) {
    const progress = index / (profile.sourcePointCount - 1);
    points.push(
      10 + progress * 120,
      50 + Math.sin(progress * Math.PI * 1.5) * 30
    );
    // Avoid an artificial zero-pressure endpoint while exercising a meaningful pressure swell.
    pressures.push(0.48 + Math.pow(Math.sin(Math.PI * progress), 0.7) * 0.35);
    speeds.push(profile.pointerSpeed);
  }
  return { points, pressures, speeds };
}

function dynamicProfile(
  candidate: StudioBrushContinuityAuditCandidate,
  curve: CurveProfile
): StudioBrushContinuityProfile {
  const input = curvedInput(curve);
  const dabs = planNormalizedStudioDynamicBrushDabs({
    points: input.points,
    pressures: input.pressures,
    speeds: input.speeds,
    baseWidth: candidate.defaultWidth,
    // Catalogue opacity is retained by the element, while the captured dynamics channel is
    // neutral. Include it below when reporting effective alpha instead of applying it twice.
    baseOpacity: 1,
    seed: AUDIT_SEED,
    maxDabs: 4096,
  }, candidate.brushDynamics!);
  const gapRatios: number[] = [];
  const renderedCarrierGapRatios: number[] = [];
  for (let index = 1; index < dabs.length; index += 1) {
    const current = dabs[index]!;
    if (current.progress < INTERIOR_START || current.progress > INTERIOR_END) continue;
    const previous = dabs[index - 1]!;
    const gap = Math.hypot(
      current.sourceX - previous.sourceX,
      current.sourceY - previous.sourceY
    );
    const meanDiameter = Math.max(0.05, (current.size + previous.size) / 2);
    gapRatios.push(gap / meanDiameter);
    renderedCarrierGapRatios.push(
      Math.hypot(current.x - previous.x, current.y - previous.y)
      / meanDiameter,
    );
  }
  return summarizeDabs(
    candidate,
    curve,
    dabs,
    gapRatios,
    renderedCarrierGapRatios,
  );
}

function summarizeDabs(
  candidate: StudioBrushContinuityAuditCandidate,
  curve: CurveProfile,
  dabs: readonly StudioDynamicBrushDab[],
  gapRatios: readonly number[],
  renderedCarrierGapRatios: readonly number[],
): StudioBrushContinuityProfile {
  return {
    speed: curve.speed,
    sourcePointCount: curve.sourcePointCount,
    markCount: dabs.length,
    inputSampleSpacing: 0,
    maxInteriorGapRatio: rounded(Math.max(0, ...gapRatios)),
    meanInteriorGapRatio: rounded(mean(gapRatios)),
    maxRenderedCarrierGapRatio: rounded(
      Math.max(0, ...renderedCarrierGapRatios),
    ),
    meanRenderedCarrierGapRatio: rounded(mean(renderedCarrierGapRatios)),
    meanEffectiveAlpha: rounded(mean(
      dabs.map((dab) => candidate.defaultOpacity * dab.opacity * dab.flow)
    )),
    meanSizeRatio: rounded(mean(
      dabs.map((dab) => dab.size / Math.max(0.05, candidate.defaultWidth))
    )),
    meanScatterRatio: rounded(mean(
      dabs.map((dab) => dab.scatter / Math.max(0.05, dab.size))
    )),
    meanRoundness: rounded(mean(dabs.map((dab) => dab.roundness))),
  };
}

function stampProfile(
  candidate: StudioBrushContinuityAuditCandidate,
  curve: CurveProfile
): StudioBrushContinuityProfile {
  const input = curvedInput(curve);
  const kind = resolveStudioStampBrushKind(candidate.runtimeBrushId)!;
  const style = resolveStudioStampBrushStyle(kind, {
    color: "#111111",
    size: candidate.defaultWidth,
    opacity: candidate.defaultOpacity,
  });
  const dabs = planStudioStampBrushDabs(style, input.points, input.pressures);
  const gapRatios: number[] = [];
  for (let index = 1; index < dabs.length; index += 1) {
    const current = dabs[index]!;
    const previous = dabs[index - 1]!;
    const gap = Math.hypot(current.x - previous.x, current.y - previous.y);
    gapRatios.push(gap / Math.max(0.05, current.radius + previous.radius));
  }
  return summarizeStampDabs(candidate, curve, dabs, gapRatios);
}

function summarizeStampDabs(
  candidate: StudioBrushContinuityAuditCandidate,
  curve: CurveProfile,
  dabs: readonly StudioStampBrushDab[],
  gapRatios: readonly number[]
): StudioBrushContinuityProfile {
  return {
    speed: curve.speed,
    sourcePointCount: curve.sourcePointCount,
    markCount: dabs.length,
    inputSampleSpacing: 0,
    maxInteriorGapRatio: rounded(Math.max(0, ...gapRatios)),
    meanInteriorGapRatio: rounded(mean(gapRatios)),
    maxRenderedCarrierGapRatio: rounded(Math.max(0, ...gapRatios)),
    meanRenderedCarrierGapRatio: rounded(mean(gapRatios)),
    meanEffectiveAlpha: rounded(mean(dabs.map((dab) => dab.alpha))),
    meanSizeRatio: rounded(mean(
      dabs.map((dab) => (dab.radius * 2) / Math.max(0.05, candidate.defaultWidth))
    )),
    meanScatterRatio: 0,
    meanRoundness: 1,
  };
}

function connectedPathProfile(
  candidate: StudioBrushContinuityAuditCandidate,
  family: StudioBrushRenderFamily,
  curve: CurveProfile
): StudioBrushContinuityProfile {
  const inputSampleSpacing = strokeSampleDistanceForBrushFamily(1, family);
  return {
    speed: curve.speed,
    sourcePointCount: curve.sourcePointCount,
    // Connected-path renderers join every accepted source point, so marks cannot have a dab gap.
    markCount: curve.sourcePointCount,
    inputSampleSpacing,
    maxInteriorGapRatio: 0,
    meanInteriorGapRatio: 0,
    maxRenderedCarrierGapRatio: 0,
    meanRenderedCarrierGapRatio: 0,
    meanEffectiveAlpha: rounded(candidate.defaultOpacity),
    meanSizeRatio: 1,
    meanScatterRatio: 0,
    meanRoundness: 1,
  };
}

function behaviorFingerprint(
  candidate: StudioBrushContinuityAuditCandidate,
  result: Omit<StudioBrushContinuityAuditResult, "behaviorFingerprint">
): string {
  const dynamics = candidate.brushDynamics;
  return JSON.stringify({
    strategy: result.renderStrategy,
    family: result.renderFamily,
    width: rounded(candidate.defaultWidth, 2),
    opacity: rounded(candidate.defaultOpacity, 2),
    tip: dynamics
      ? [
          dynamics.tip.shape,
          rounded(dynamics.tip.softness, 2),
          rounded(dynamics.grain.amount, 2),
          dynamics.dualBrush?.enabled === true,
        ]
      : null,
    profiles: result.profiles.map((profile) => [
      profile.markCount,
      rounded(profile.meanInteriorGapRatio, 2),
      rounded(profile.meanRenderedCarrierGapRatio, 2),
      rounded(profile.meanEffectiveAlpha, 2),
      rounded(profile.meanSizeRatio, 2),
      rounded(profile.meanScatterRatio, 2),
      rounded(profile.meanRoundness, 2),
    ]),
  });
}

/** Whether this catalogue id is excused from the continuity bar by the list above. */
export function studioBrushCatalogIdIsIntentionallyDiscontinuous(
  catalogId: string | null | undefined,
): boolean {
  return typeof catalogId === "string"
    && INTENTIONALLY_DISCONTINUOUS_CATALOG_IDS.has(catalogId);
}

export function auditStudioBrushContinuity(
  candidate: StudioBrushContinuityAuditCandidate
): StudioBrushContinuityAuditResult {
  const renderFamily = resolveStudioBrushRenderFamily(candidate.runtimeBrushId);
  const stampKind = resolveStudioStampBrushKind(candidate.runtimeBrushId);
  const renderStrategy: StudioBrushContinuityRenderStrategy = candidate.brushDynamics
    ? "dynamic-dab"
    : stampKind
      ? "stamp-dab"
      : renderFamily === "pixel"
        ? "pixel-grid"
        : "connected-path";
  const profiles = CURVE_PROFILES.map((curve) => {
    if (candidate.brushDynamics) return dynamicProfile(candidate, curve);
    if (stampKind) return stampProfile(candidate, curve);
    return connectedPathProfile(candidate, renderFamily, curve);
  });
  const baseResult = {
    catalogId: candidate.catalogId,
    catalogName: candidate.catalogName,
    renderStrategy,
    renderFamily,
    intentionalDiscontinuity: candidateUsesIntentionalDiscontinuity(
      candidate,
      renderFamily,
    ),
    profiles,
  };
  return {
    ...baseResult,
    behaviorFingerprint: behaviorFingerprint(candidate, baseResult),
  };
}

export function auditStudioBrushCatalogueContinuity(
  candidates: readonly StudioBrushContinuityAuditCandidate[]
): readonly StudioBrushContinuityAuditResult[] {
  return candidates.map(auditStudioBrushContinuity);
}
