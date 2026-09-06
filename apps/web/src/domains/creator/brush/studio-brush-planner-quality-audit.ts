/**
 * Catalogue-wide, DOM-free brush quality audit.
 *
 * The existing continuity and material-response probes remain the rendering oracles. This module
 * combines them into one commercial-quality report for every shipped catalogue selection:
 * immediate tap visibility, curved-path continuity, spacing/diameter safety, low-pigment and
 * early-opacity clipping risk, speed-density response, and perceptual fingerprint collisions.
 */

import {
  auditStudioBrushContinuity,
  type StudioBrushContinuityAuditCandidate,
  type StudioBrushContinuityAuditResult,
} from "./studio-brush-continuity-audit";
import {
  planNormalizedStudioDynamicBrushDabs,
} from "./studio-brush-dynamics";
import {
  profileStudioBrushMaterialResponse,
  type StudioBrushMaterialResponse,
} from "./studio-brush-material-response";
import {
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
} from "./studio-brush-stamp-engine";

export interface StudioBrushPlannerQualityCandidate
  extends StudioBrushContinuityAuditCandidate {
  readonly category?: string;
  readonly previewStyle?: string;
}

export type StudioBrushPlannerQualityFindingLevel = "error" | "warning";

export interface StudioBrushPlannerQualityFinding {
  readonly level: StudioBrushPlannerQualityFindingLevel;
  readonly code:
    | "curve-gap"
    | "carrier-beading"
    | "density-collapse"
    | "early-opacity-clipping"
    | "equivalent-fingerprint"
    | "faint-first-tap"
    | "low-pigment"
    | "near-fingerprint";
  readonly message: string;
}

export interface StudioBrushPlannerTapQuality {
  readonly markCount: number;
  readonly peakChannelDelta: number;
  readonly meanChannelDelta: number;
  readonly effectivePeakAlpha: number;
}

export interface StudioBrushPlannerCurveQuality {
  readonly worstGapRatio: number;
  readonly worstMeanGapRatio: number;
  readonly worstRenderedCarrierGapRatio: number;
  readonly spacingDiameterRatio: number;
}

export interface StudioBrushPlannerSpeedQuality {
  readonly slowMarkCount: number;
  readonly mediumMarkCount: number;
  readonly fastMarkCount: number;
  readonly fastToSlowDensityRatio: number;
  readonly densitySpan: number;
}

export interface StudioBrushPlannerOpacityQuality {
  readonly minimumMeanEffectiveAlpha: number;
  readonly maximumMeanEffectiveAlpha: number;
  readonly overlap1ToCeilingRatio: number;
  readonly overlap4ToCeilingRatio: number;
  readonly overlap16ToCeilingRatio: number;
}

export interface StudioBrushPlannerQualityResult {
  readonly catalogId: string;
  readonly catalogName: string;
  readonly runtimeBrushId: string;
  readonly category: string | null;
  readonly previewStyle: string | null;
  readonly intentionalDiscontinuity: boolean;
  readonly renderStrategy: StudioBrushContinuityAuditResult["renderStrategy"];
  readonly renderFamily: StudioBrushContinuityAuditResult["renderFamily"];
  readonly tap: StudioBrushPlannerTapQuality;
  readonly curve: StudioBrushPlannerCurveQuality;
  readonly speed: StudioBrushPlannerSpeedQuality;
  readonly opacity: StudioBrushPlannerOpacityQuality;
  readonly exactFingerprint: string;
  readonly perceptualFingerprint: string;
  readonly findings: readonly StudioBrushPlannerQualityFinding[];
  readonly riskScore: number;
}

export interface StudioBrushPlannerFingerprintGroup {
  readonly fingerprint: string;
  readonly catalogIds: readonly string[];
}

export interface StudioBrushPlannerQualityCatalogueReport {
  readonly results: readonly StudioBrushPlannerQualityResult[];
  readonly rankedWorst: readonly StudioBrushPlannerQualityResult[];
  readonly exactFingerprintGroups: readonly StudioBrushPlannerFingerprintGroup[];
  readonly perceptualFingerprintGroups: readonly StudioBrushPlannerFingerprintGroup[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly ok: boolean;
}

const AUDIT_SEED = 0x51f1_7a3e;
const WHITE_PAPER_VS_INK_CHANNEL_RANGE = 255 - 17;
const FIRST_TAP_PEAK_DELTA_FLOOR = 4.5;
const FIRST_TAP_SOFT_WARNING_DELTA = 12;
const LOW_PIGMENT_FLOOR = 0.05;
const CONTINUOUS_GAP_RATIO_LIMIT = 1;
const CONTINUOUS_RENDERED_CARRIER_GAP_RATIO_LIMIT = 1;
const CONTINUOUS_DENSITY_SPAN_WARNING = 2.5;
const EARLY_CLIPPING_RATIO_WARNING = 0.985;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number, digits = 4): number {
  const multiplier = 10 ** digits;
  return Math.round(finite(value) * multiplier) / multiplier;
}

function quantized(value: number, step: number): number {
  return rounded(Math.round(finite(value) / step) * step, 6);
}

function minimum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.min(...values);
}

function maximum(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function profileBySpeed(
  continuity: StudioBrushContinuityAuditResult,
  speed: "fast" | "medium" | "slow",
) {
  const profile = continuity.profiles.find((candidate) => candidate.speed === speed);
  if (!profile) throw new Error(`${continuity.catalogId}: missing ${speed} continuity profile`);
  return profile;
}

function firstTapQuality(
  candidate: StudioBrushPlannerQualityCandidate,
  material: StudioBrushMaterialResponse | null,
): StudioBrushPlannerTapQuality {
  if (candidate.brushDynamics && material) {
    const dabs = planNormalizedStudioDynamicBrushDabs({
      baseOpacity: 1,
      baseWidth: candidate.defaultWidth,
      maxDabs: 8,
      points: [0, 0],
      pressures: [0.5],
      seed: AUDIT_SEED,
      speeds: [2.5],
    }, candidate.brushDynamics);
    const first = dabs[0];
    if (!first) {
      return {
        markCount: 0,
        peakChannelDelta: 0,
        meanChannelDelta: 0,
        effectivePeakAlpha: 0,
      };
    }
    const pigment = clamp(
      candidate.defaultOpacity * first.opacity * first.flow,
      0,
      1,
    );
    const effectivePeakAlpha = clamp(
      pigment * material.deposition.materialPeakAlpha,
      0,
      1,
    );
    return {
      markCount: dabs.length,
      peakChannelDelta: rounded(
        effectivePeakAlpha * WHITE_PAPER_VS_INK_CHANNEL_RANGE,
      ),
      meanChannelDelta: rounded(
        pigment
        * material.texture.materialMeanAlpha
        * WHITE_PAPER_VS_INK_CHANNEL_RANGE,
      ),
      effectivePeakAlpha: rounded(effectivePeakAlpha, 6),
    };
  }

  const stampKind = resolveStudioStampBrushKind(candidate.runtimeBrushId);
  if (stampKind) {
    const style = resolveStudioStampBrushStyle(stampKind, {
      color: "#111111",
      size: candidate.defaultWidth,
      opacity: candidate.defaultOpacity,
    });
    const dabs = planStudioStampBrushDabs(style, [0, 0], [0.5]);
    const peakAlpha = clamp(maximum(dabs.map((dab) => dab.alpha)), 0, 1);
    return {
      markCount: dabs.length,
      peakChannelDelta: rounded(peakAlpha * WHITE_PAPER_VS_INK_CHANNEL_RANGE),
      meanChannelDelta: rounded(peakAlpha * WHITE_PAPER_VS_INK_CHANNEL_RANGE),
      effectivePeakAlpha: rounded(peakAlpha, 6),
    };
  }

  const alpha = clamp(candidate.defaultOpacity, 0, 1);
  return {
    markCount: 1,
    peakChannelDelta: rounded(alpha * WHITE_PAPER_VS_INK_CHANNEL_RANGE),
    meanChannelDelta: rounded(alpha * WHITE_PAPER_VS_INK_CHANNEL_RANGE),
    effectivePeakAlpha: rounded(alpha, 6),
  };
}

function curveQuality(
  continuity: StudioBrushContinuityAuditResult,
): StudioBrushPlannerCurveQuality {
  const worstGapRatio = maximum(
    continuity.profiles.map((profile) => profile.maxInteriorGapRatio),
  );
  const worstMeanGapRatio = maximum(
    continuity.profiles.map((profile) => profile.meanInteriorGapRatio),
  );
  const worstRenderedCarrierGapRatio = maximum(
    continuity.profiles.map((profile) => (
      profile.maxRenderedCarrierGapRatio
    )),
  );
  return {
    worstGapRatio: rounded(worstGapRatio),
    worstMeanGapRatio: rounded(worstMeanGapRatio),
    worstRenderedCarrierGapRatio: rounded(worstRenderedCarrierGapRatio),
    spacingDiameterRatio:
      continuity.renderStrategy === "connected-path"
      || continuity.renderStrategy === "pixel-grid"
        ? 0
        : rounded(worstMeanGapRatio),
  };
}

function speedQuality(
  continuity: StudioBrushContinuityAuditResult,
): StudioBrushPlannerSpeedQuality {
  const slow = profileBySpeed(continuity, "slow").markCount;
  const medium = profileBySpeed(continuity, "medium").markCount;
  const fast = profileBySpeed(continuity, "fast").markCount;
  if (
    continuity.renderStrategy === "connected-path"
    || continuity.renderStrategy === "pixel-grid"
  ) {
    return {
      slowMarkCount: slow,
      mediumMarkCount: medium,
      fastMarkCount: fast,
      fastToSlowDensityRatio: 1,
      densitySpan: 1,
    };
  }
  const counts = [slow, medium, fast].filter((count) => count > 0);
  return {
    slowMarkCount: slow,
    mediumMarkCount: medium,
    fastMarkCount: fast,
    fastToSlowDensityRatio: rounded(fast / Math.max(1, slow)),
    densitySpan: rounded(maximum(counts) / Math.max(1, minimum(counts))),
  };
}

function opacityQuality(
  candidate: StudioBrushPlannerQualityCandidate,
  continuity: StudioBrushContinuityAuditResult,
  material: StudioBrushMaterialResponse | null,
): StudioBrushPlannerOpacityQuality {
  const effectiveAlphas = continuity.profiles.map(
    (profile) => profile.meanEffectiveAlpha,
  );
  const ceiling = material?.deposition.opacityCeiling
    ?? clamp(candidate.defaultOpacity, 0, 1);
  return {
    minimumMeanEffectiveAlpha: rounded(minimum(effectiveAlphas)),
    maximumMeanEffectiveAlpha: rounded(maximum(effectiveAlphas)),
    overlap1ToCeilingRatio: ceiling > 0
      ? rounded((material?.deposition.overlap1Alpha ?? ceiling) / ceiling)
      : 0,
    overlap4ToCeilingRatio: ceiling > 0
      ? rounded((material?.deposition.overlap4Alpha ?? ceiling) / ceiling)
      : 0,
    overlap16ToCeilingRatio: ceiling > 0
      ? rounded((material?.deposition.overlap16Alpha ?? ceiling) / ceiling)
      : 0,
  };
}

function exactFingerprint(
  continuity: StudioBrushContinuityAuditResult,
  material: StudioBrushMaterialResponse | null,
): string {
  return JSON.stringify({
    continuity: continuity.behaviorFingerprint,
    material: material?.fingerprints.combined ?? null,
  });
}

function perceptualFingerprint(
  candidate: StudioBrushPlannerQualityCandidate,
  continuity: StudioBrushContinuityAuditResult,
  material: StudioBrushMaterialResponse | null,
): string {
  return JSON.stringify({
    strategy: continuity.renderStrategy,
    family: continuity.renderFamily,
    width: quantized(candidate.defaultWidth, 1),
    opacity: quantized(candidate.defaultOpacity, 0.025),
    profiles: continuity.profiles.map((profile) => [
      quantized(profile.markCount, 4),
      quantized(profile.meanInteriorGapRatio, 0.025),
      quantized(profile.meanRenderedCarrierGapRatio, 0.025),
      quantized(profile.meanEffectiveAlpha, 0.025),
      quantized(profile.meanSizeRatio, 0.025),
      quantized(profile.meanScatterRatio, 0.025),
      quantized(profile.meanRoundness, 0.025),
    ]),
    material: material
      ? [
          quantized(material.deposition.overlap4Alpha, 0.025),
          quantized(material.texture.materialMeanAlpha, 0.025),
          quantized(material.texture.materialAlphaVariance, 0.005),
          quantized(material.texture.occupiedRatio, 0.025),
          material.texture.dualBlendMode,
        ]
      : null,
  });
}

function baseFindings(
  result: Omit<
    StudioBrushPlannerQualityResult,
    "exactFingerprint" | "findings" | "perceptualFingerprint" | "riskScore"
  >,
): StudioBrushPlannerQualityFinding[] {
  const findings: StudioBrushPlannerQualityFinding[] = [];
  if (
    result.tap.markCount === 0
    || result.tap.peakChannelDelta < FIRST_TAP_PEAK_DELTA_FLOOR
  ) {
    findings.push({
      level: "error",
      code: "faint-first-tap",
      message:
        `${result.catalogId}: first tap projects only `
        + `${result.tap.peakChannelDelta.toFixed(2)} channel levels`,
    });
  } else if (
    !result.intentionalDiscontinuity
    && result.tap.peakChannelDelta < FIRST_TAP_SOFT_WARNING_DELTA
  ) {
    findings.push({
      level: "warning",
      code: "faint-first-tap",
      message:
        `${result.catalogId}: first tap has a narrow `
        + `${result.tap.peakChannelDelta.toFixed(2)}-level visibility margin`,
    });
  }
  if (result.opacity.minimumMeanEffectiveAlpha < LOW_PIGMENT_FLOOR) {
    findings.push({
      level: "error",
      code: "low-pigment",
      message:
        `${result.catalogId}: curved stroke mean pigment falls to `
        + `${result.opacity.minimumMeanEffectiveAlpha.toFixed(3)}`,
    });
  }
  if (
    !result.intentionalDiscontinuity
    && result.curve.worstGapRatio > CONTINUOUS_GAP_RATIO_LIMIT
  ) {
    findings.push({
      level: "error",
      code: "curve-gap",
      message:
        `${result.catalogId}: curved path exposes a `
        + `${result.curve.worstGapRatio.toFixed(3)} diameter gap`,
    });
  }
  if (
    !result.intentionalDiscontinuity
    && result.curve.worstRenderedCarrierGapRatio
      > CONTINUOUS_RENDERED_CARRIER_GAP_RATIO_LIMIT
  ) {
    findings.push({
      level: "error",
      code: "carrier-beading",
      message:
        `${result.catalogId}: scatter opens a `
        + `${result.curve.worstRenderedCarrierGapRatio.toFixed(3)} diameter `
        + "gap between rendered carriers",
    });
  }
  if (
    !result.intentionalDiscontinuity
    && result.speed.densitySpan > CONTINUOUS_DENSITY_SPAN_WARNING
  ) {
    findings.push({
      level: "warning",
      code: "density-collapse",
      message:
        `${result.catalogId}: speed changes mark density by `
        + `${result.speed.densitySpan.toFixed(2)}×`,
    });
  }
  if (
    !result.intentionalDiscontinuity
    && result.renderStrategy === "dynamic-dab"
    && (
      result.renderFamily === "airbrush"
      || result.renderFamily === "dry-media"
      || result.renderFamily === "pastel"
      || result.renderFamily === "watercolor"
    )
    && result.opacity.maximumMeanEffectiveAlpha < 0.9
    && result.opacity.overlap1ToCeilingRatio >= EARLY_CLIPPING_RATIO_WARNING
  ) {
    findings.push({
      level: "warning",
      code: "early-opacity-clipping",
      message:
        `${result.catalogId}: one dab already reaches `
        + `${(result.opacity.overlap1ToCeilingRatio * 100).toFixed(1)}% of the opacity ceiling`,
    });
  }
  return findings;
}

function riskScore(
  result: Pick<
    StudioBrushPlannerQualityResult,
    "curve" | "findings" | "opacity" | "speed" | "tap"
  >,
): number {
  const errorCount = result.findings.filter((finding) => finding.level === "error").length;
  const warningCount = result.findings.length - errorCount;
  const faintRisk = Math.max(
    0,
    (FIRST_TAP_SOFT_WARNING_DELTA - result.tap.peakChannelDelta)
      / FIRST_TAP_SOFT_WARNING_DELTA,
  );
  const densityRisk = Math.max(0, Math.log2(Math.max(1, result.speed.densitySpan)));
  return rounded(
    errorCount * 100
    + warningCount * 12
    + Math.max(0, result.curve.worstGapRatio - 0.5) * 20
    + Math.max(
      0,
      result.curve.worstRenderedCarrierGapRatio - 0.5,
    ) * 20
    + faintRisk * 20
    + Math.max(0, 0.1 - result.opacity.minimumMeanEffectiveAlpha) * 80
    + densityRisk * 4,
  );
}

function fingerprintGroups(
  results: readonly StudioBrushPlannerQualityResult[],
  field: "exactFingerprint" | "perceptualFingerprint",
): StudioBrushPlannerFingerprintGroup[] {
  const byFingerprint = new Map<string, string[]>();
  for (const result of results) {
    const group = byFingerprint.get(result[field]) ?? [];
    group.push(result.catalogId);
    byFingerprint.set(result[field], group);
  }
  return [...byFingerprint.entries()]
    .flatMap(([fingerprint, catalogIds]) => (
      catalogIds.length > 1 ? [{ fingerprint, catalogIds: catalogIds.sort() }] : []
    ))
    .sort((left, right) => (
      right.catalogIds.length - left.catalogIds.length
      || left.catalogIds[0]!.localeCompare(right.catalogIds[0]!)
    ));
}

/**
 * Returns a deterministic report. Strict failures are limited to invisible taps, sub-floor
 * pigment, real continuous-path holes, and exact behavior collisions between continuous media.
 * Coarse perceptual collisions remain warnings so intentionally related brush families can ship.
 */
export function auditStudioBrushPlannerQualityCatalogue(
  candidates: readonly StudioBrushPlannerQualityCandidate[],
): StudioBrushPlannerQualityCatalogueReport {
  const mutableResults = candidates.map((candidate) => {
    const continuity = auditStudioBrushContinuity(candidate);
    const material = candidate.brushDynamics
      ? profileStudioBrushMaterialResponse({
          brushDynamics: candidate.brushDynamics,
          defaultWidth: candidate.defaultWidth,
          defaultOpacity: candidate.defaultOpacity,
          seed: AUDIT_SEED,
        })
      : null;
    const base = {
      catalogId: candidate.catalogId,
      catalogName: candidate.catalogName,
      runtimeBrushId: candidate.runtimeBrushId,
      category: candidate.category ?? null,
      previewStyle: candidate.previewStyle ?? null,
      intentionalDiscontinuity: continuity.intentionalDiscontinuity,
      renderStrategy: continuity.renderStrategy,
      renderFamily: continuity.renderFamily,
      tap: firstTapQuality(candidate, material),
      curve: curveQuality(continuity),
      speed: speedQuality(continuity),
      opacity: opacityQuality(candidate, continuity, material),
    };
    const exact = exactFingerprint(continuity, material);
    const perceptual = perceptualFingerprint(candidate, continuity, material);
    const findings = baseFindings(base);
    return {
      ...base,
      exactFingerprint: exact,
      perceptualFingerprint: perceptual,
      findings,
      riskScore: 0,
    } satisfies StudioBrushPlannerQualityResult;
  });

  const exactGroups = fingerprintGroups(mutableResults, "exactFingerprint");
  const perceptualGroups = fingerprintGroups(mutableResults, "perceptualFingerprint");
  const resultById = new Map(mutableResults.map((result) => [result.catalogId, result]));
  for (const group of exactGroups) {
    const continuousIds = group.catalogIds.filter(
      (catalogId) => !resultById.get(catalogId)!.intentionalDiscontinuity,
    );
    if (continuousIds.length < 2) continue;
    for (const catalogId of continuousIds) {
      resultById.get(catalogId)!.findings.push({
        level: "error",
        code: "equivalent-fingerprint",
        message: `${catalogId}: exact behavior duplicates ${continuousIds.filter((id) => id !== catalogId).join(", ")}`,
      });
    }
  }
  for (const group of perceptualGroups) {
    const continuousIds = group.catalogIds.filter(
      (catalogId) => !resultById.get(catalogId)!.intentionalDiscontinuity,
    );
    if (continuousIds.length < 2) continue;
    for (const catalogId of continuousIds) {
      const result = resultById.get(catalogId)!;
      if (result.findings.some((finding) => finding.code === "equivalent-fingerprint")) continue;
      result.findings.push({
        level: "warning",
        code: "near-fingerprint",
        message: `${catalogId}: perceptually near ${continuousIds.filter((id) => id !== catalogId).join(", ")}`,
      });
    }
  }

  for (const result of mutableResults) {
    result.riskScore = riskScore(result);
  }
  const results = mutableResults.map((result) => Object.freeze({
    ...result,
    findings: Object.freeze([...result.findings]),
  }));
  const errorCount = results.reduce(
    (total, result) => total
      + result.findings.filter((finding) => finding.level === "error").length,
    0,
  );
  const warningCount = results.reduce(
    (total, result) => total
      + result.findings.filter((finding) => finding.level === "warning").length,
    0,
  );
  return Object.freeze({
    results: Object.freeze(results),
    rankedWorst: Object.freeze(
      [...results].sort((left, right) => (
        right.riskScore - left.riskScore
        || right.curve.worstGapRatio - left.curve.worstGapRatio
        || left.catalogId.localeCompare(right.catalogId)
      )),
    ),
    exactFingerprintGroups: Object.freeze(exactGroups),
    perceptualFingerprintGroups: Object.freeze(perceptualGroups),
    errorCount,
    warningCount,
    ok: errorCount === 0,
  });
}
