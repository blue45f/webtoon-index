import {
  bodySilhouetteSignature,
  sampleBodySilhouette,
  type BodySilhouette,
} from "./studio-vrm-body-silhouette";
import {
  WARDROBE_FIT_MAX,
  WARDROBE_FIT_MIN,
  WARDROBE_SLOTS,
  measuredTorsoClearanceM,
  sanitizeWardrobeMetrics,
  wardrobeItemById,
  type WardrobeGarmentRegion,
  type WardrobeMetrics,
  type WardrobeSlot,
  type WardrobeState,
} from "./studio-vrm-wardrobe";

export type StudioVrmGarmentFitStatus = "ready" | "warning" | "unavailable";

export type StudioVrmGarmentFitIssueCode =
  | "metric-fallback"
  | "body-clearance"
  | "layer-clearance"
  | "auto-adjusted";

export interface StudioVrmGarmentFitIssue {
  code: StudioVrmGarmentFitIssueCode;
  severity: "info" | "warning";
  slots: readonly WardrobeSlot[];
  regions: readonly WardrobeGarmentRegion[];
  message: string;
  estimatedPenetrationM: number;
  suggestedFit?: number;
}

export interface StudioVrmGarmentSlotFit {
  slot: WardrobeSlot;
  itemId: string;
  authoredFit: number;
  suggestedFit: number;
  effectiveFit: number;
  referenceRadiusM: number;
  estimatedBodyClearanceM: number;
  autoAdjustmentM: number;
}

export interface StudioVrmGarmentFitReport {
  status: StudioVrmGarmentFitStatus;
  metricSource: WardrobeMetrics["source"] | "unavailable";
  signature: string;
  slots: Partial<Record<WardrobeSlot, StudioVrmGarmentSlotFit>>;
  issues: readonly StudioVrmGarmentFitIssue[];
  autoAdjusted: boolean;
  maxEstimatedPenetrationM: number;
}

export interface StudioVrmGarmentEvaluationReceipt {
  kind: "studio-vrm-garment-evaluation-receipt";
  version: 1;
  solver: "analytic-layer-fit-v1";
  modelId: string;
  poseSignature: string;
  inputSignature: string;
  generation: number;
  status: StudioVrmGarmentFitStatus;
  maxEstimatedPenetrationM: number;
  issues: readonly StudioVrmGarmentFitIssue[];
}

const EPSILON_M = 0.00025;

function clampFit(value: number): number {
  return Math.min(WARDROBE_FIT_MAX, Math.max(WARDROBE_FIT_MIN, value));
}

function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function intersectRegions(
  a: readonly WardrobeGarmentRegion[],
  b: readonly WardrobeGarmentRegion[],
): WardrobeGarmentRegion[] {
  const bSet = new Set(b);
  return a.filter((region) => bSet.has(region));
}

/** Chest span in silhouette t (waist → neck) — the height band a top or an outer has to clear. */
const CHEST_BAND_T = { low: 0.5, high: 1 } as const;

/** Hip span in silhouette t. The pelvis is widest a little above the hips joint, so a band. */
const HIP_BAND_T = { low: 0, high: 0.2 } as const;

/**
 * A reference radius divides a shortfall into fit steps, so it may never approach zero. This floor
 * is a division guard and not a claim about the body: a measured torso narrower than a human one
 * (chibi proportions) keeps its own smaller radius as long as it stays above the guard.
 */
const MIN_MEASURED_REFERENCE_M = 0.02;

/** Widest measured half-width inside a height band, floored by the guard above. */
function measuredRadiusM(silhouette: BodySilhouette, band: { low: number; high: number }): number {
  let widest = 0;
  for (const ring of silhouette.rings) {
    if (ring.t < band.low || ring.t > band.high) continue;
    widest = Math.max(widest, ring.halfWidth);
  }
  // A silhouette with no ring inside the band still measured the body somewhere: sampling clamps
  // to the nearest measured ring, which beats reporting a width nobody measured.
  const measured = widest > 0
    ? widest
    : sampleBodySilhouette(silhouette, (band.low + band.high) / 2).halfWidth;
  return Math.max(measured, MIN_MEASURED_REFERENCE_M);
}

function referenceRadiusM(slot: WardrobeSlot, metrics: WardrobeMetrics): number {
  const average = (left: number, right: number) => (left + right) / 2;
  const torso = metrics.torso;
  switch (slot) {
    case "outer":
    case "top":
      // shoulderW is the joint-to-joint span, which is exactly the assumption the cut is being
      // fixed for: it over-reports penetration on a narrow chest and under-reports it on a broad
      // one. Measured, the garment has to clear the widest cross-section above the waist.
      return torso
        ? measuredRadiusM(torso, CHEST_BAND_T)
        : Math.max(metrics.shoulderW * 0.56, metrics.hipW * 0.95, 0.08);
    case "bottom":
      return torso
        ? measuredRadiusM(torso, HIP_BAND_T)
        : Math.max(
          metrics.hipW * 0.95,
          average(metrics.upperLeg.left.len, metrics.upperLeg.right.len) * 0.175,
          0.065,
        );
    case "shoes":
      // The silhouette spans hips → neck, so a measured body says nothing about feet. Shoes keep
      // the skeleton radius on purpose; there is no measurement here that was forgotten.
      return Math.max(
        metrics.ankleH,
        average(metrics.lowerLeg.left.len, metrics.lowerLeg.right.len) * 0.1,
        0.04,
      );
  }
}

function formatMillimetres(valueM: number): string {
  return `${Math.max(1, Math.round(valueM * 1000))}mm`;
}

function hashSignature(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildStudioVrmGarmentFitInputSignature(
  wardrobe: WardrobeState,
  metricsRaw: WardrobeMetrics | null | undefined,
): string {
  const metrics = metricsRaw ? sanitizeWardrobeMetrics(metricsRaw) : null;
  const slots = WARDROBE_SLOTS.flatMap((slot) => {
    const equip = wardrobe[slot];
    return equip
      ? [{ slot, itemId: equip.itemId, fit: round(equip.fit), fitMode: equip.fitMode }]
      : [];
  });
  const payload = metrics
    ? {
        source: metrics.source,
        shoulderW: round(metrics.shoulderW),
        hipW: round(metrics.hipW),
        hipsToSpine: round(metrics.hipsToSpine),
        spineToNeck: round(metrics.spineToNeck),
        ankleH: round(metrics.ankleH),
        upperArm: [round(metrics.upperArm.left.len), round(metrics.upperArm.right.len)],
        upperLeg: [round(metrics.upperLeg.left.len), round(metrics.upperLeg.right.len)],
        lowerLeg: [round(metrics.lowerLeg.left.len), round(metrics.lowerLeg.right.len)],
        // The skeleton fields cannot see a re-measured body: two silhouettes on the same rig share
        // every joint distance yet give a top a different reference radius, so a cached report
        // keyed on the skeleton alone would survive a measurement it no longer describes.
        torso: bodySilhouetteSignature(metrics.torso),
        slots,
      }
    : { source: "unavailable", slots };
  // garfit2 (was garfit1): the payload gained the measurement, and on a measured body every
  // penetration number a garfit1 receipt carries came from the skeleton radius instead. Those
  // receipts have to be recomputed rather than matched, so the tag says so out loud.
  return `garfit2:${hashSignature(JSON.stringify(payload))}`;
}

/**
 * Resolves a deterministic, non-destructive fit plan. Auto mode changes only the rendered shell;
 * authored fit values remain untouched until the user explicitly applies a suggestion.
 */
export function inspectStudioVrmGarmentFit(
  wardrobe: WardrobeState,
  metricsRaw: WardrobeMetrics | null | undefined,
): StudioVrmGarmentFitReport {
  const signature = buildStudioVrmGarmentFitInputSignature(wardrobe, metricsRaw);
  if (!metricsRaw) {
    return {
      status: "unavailable",
      metricSource: "unavailable",
      signature,
      slots: {},
      issues: [],
      autoAdjusted: false,
      maxEstimatedPenetrationM: 0,
    };
  }

  const metrics = sanitizeWardrobeMetrics(metricsRaw);
  const candidates = WARDROBE_SLOTS.flatMap((slot) => {
    const equip = wardrobe[slot];
    const item = equip ? wardrobeItemById(equip.itemId) : undefined;
    if (!equip || !item || item.slot !== slot) return [];
    const radius = referenceRadiusM(slot, metrics);
    // 실측 재단은 fit을 여유분에만 곱한다(몸 쪽에 곱하면 fit을 줄였을 때 옷이 살을 파고든다).
    // 그래서 fit 한 칸이 벌어 주는 폭은 반경 배율이 아니라 여유분 배율이다. 공식을 여기서 다시
    // 쓰는 대신 재단이 실제로 남긴 여유를 재서, 두 모델이 다시 어긋나지 않게 한다. 실측 여유는
    // fit에 정비례하므로(여유분 × 아이템 배율 × fit) 한 번 재면 나머지 fit은 나눗셈으로 얻는다.
    const measured = measuredTorsoClearanceM(equip.itemId, metrics, equip.fit);
    const perFitStepM = measured === null
      ? radius
      : Math.max(EPSILON_M, measured / Math.max(EPSILON_M, equip.fit));
    const clearanceAt = measured === null
      ? (value: number) => item.fitProfile.baseBodyClearanceM + (value - 1) * radius
      : (value: number) => perFitStepM * value;
    const bodyShortfall = Math.max(0, item.fitProfile.motionAllowanceM - clearanceAt(equip.fit));
    return [{
      slot,
      equip,
      item,
      radius,
      clearanceAt,
      perFitStepM,
      suggestedFit: clampFit(equip.fit + bodyShortfall / perFitStepM),
    }];
  });

  // Higher-ranked garments must clear every lower-ranked garment in the same anatomical region.
  const ordered = [...candidates].sort((a, b) => (
    a.item.fitProfile.layerRank - b.item.fitProfile.layerRank
    || WARDROBE_SLOTS.indexOf(a.slot) - WARDROBE_SLOTS.indexOf(b.slot)
  ));
  for (const outer of ordered) {
    for (const inner of ordered) {
      if (inner === outer || inner.item.fitProfile.layerRank >= outer.item.fitProfile.layerRank) continue;
      if (intersectRegions(outer.item.fitProfile.regions, inner.item.fitProfile.regions).length === 0) continue;
      const shortfall = Math.max(
        0,
        outer.item.fitProfile.layerClearanceM
          - (outer.clearanceAt(outer.suggestedFit) - inner.clearanceAt(inner.suggestedFit)),
      );
      outer.suggestedFit = clampFit(outer.suggestedFit + shortfall / outer.perFitStepM);
    }
  }

  const slots: StudioVrmGarmentFitReport["slots"] = {};
  for (const candidate of candidates) {
    const effectiveFit = candidate.equip.fitMode === "auto"
      ? candidate.suggestedFit
      : candidate.equip.fit;
    const estimatedBodyClearanceM = candidate.clearanceAt(effectiveFit);
    slots[candidate.slot] = {
      slot: candidate.slot,
      itemId: candidate.equip.itemId,
      authoredFit: round(candidate.equip.fit),
      suggestedFit: round(candidate.suggestedFit),
      effectiveFit: round(effectiveFit),
      referenceRadiusM: round(candidate.radius),
      estimatedBodyClearanceM: round(estimatedBodyClearanceM),
      // 자동 보정이 셸을 실제로 얼마나 밀어냈는지 — 같은 여유분 모델로 잰다.
      autoAdjustmentM: round(Math.max(
        0,
        candidate.clearanceAt(effectiveFit) - candidate.clearanceAt(candidate.equip.fit),
      )),
    };
  }

  const issues: StudioVrmGarmentFitIssue[] = [];
  if (metrics.source !== "raw-rig" && candidates.length > 0) {
    issues.push({
      code: "metric-fallback",
      severity: "warning",
      slots: candidates.map((candidate) => candidate.slot),
      regions: [],
      message: metrics.source === "partial-rig"
        ? "이 VRM은 일부 휴머노이드 본이 없어 읽을 수 있는 체형과 안전 기준값을 함께 사용했습니다."
        : "이 VRM은 체형 치수를 읽지 못해 안전 기준값으로 맞췄습니다.",
      estimatedPenetrationM: 0,
    });
  }

  for (const candidate of candidates) {
    const resolved = slots[candidate.slot];
    if (!resolved) continue;
    const bodyShortfall = Math.max(
      0,
      candidate.item.fitProfile.motionAllowanceM - resolved.estimatedBodyClearanceM,
    );
    if (bodyShortfall > EPSILON_M) {
      issues.push({
        code: "body-clearance",
        severity: "warning",
        slots: [candidate.slot],
        regions: candidate.item.fitProfile.regions,
        message: `${candidate.item.label}이 몸에 ${formatMillimetres(bodyShortfall)} 정도 가까워 관절을 크게 굽히면 겹칠 수 있습니다.`,
        estimatedPenetrationM: round(bodyShortfall),
        suggestedFit: round(candidate.suggestedFit),
      });
    }
    if (resolved.autoAdjustmentM > EPSILON_M) {
      issues.push({
        code: "auto-adjusted",
        severity: "info",
        slots: [candidate.slot],
        regions: candidate.item.fitProfile.regions,
        message: `${candidate.item.label}에 ${formatMillimetres(resolved.autoAdjustmentM)}의 안전 여유를 자동 적용했습니다.`,
        estimatedPenetrationM: 0,
        suggestedFit: resolved.suggestedFit,
      });
    }
  }

  for (const outer of ordered) {
    const outerResolved = slots[outer.slot];
    if (!outerResolved) continue;
    for (const inner of ordered) {
      if (inner === outer || inner.item.fitProfile.layerRank >= outer.item.fitProfile.layerRank) continue;
      const regions = intersectRegions(outer.item.fitProfile.regions, inner.item.fitProfile.regions);
      if (regions.length === 0) continue;
      const innerResolved = slots[inner.slot];
      if (!innerResolved) continue;
      // 해결기(위)와 같은 여유분 모델을 쓴다. 여기만 옛 선형식을 남겨 두면 자동 맞춤이 해결했다고
      // 판단한 겹침을 경고가 계속 띄우거나 그 반대가 된다.
      const shortfall = Math.max(
        0,
        outer.item.fitProfile.layerClearanceM
          - (outer.clearanceAt(outerResolved.effectiveFit) - inner.clearanceAt(innerResolved.effectiveFit)),
      );
      if (shortfall <= EPSILON_M) continue;
      issues.push({
        code: "layer-clearance",
        severity: "warning",
        slots: [inner.slot, outer.slot],
        regions,
        message: `${inner.item.label}과 ${outer.item.label} 사이 여유가 ${formatMillimetres(shortfall)} 부족합니다. 겉 의상을 자동 맞춤으로 바꿔 주세요.`,
        estimatedPenetrationM: round(shortfall),
        suggestedFit: round(outer.suggestedFit),
      });
    }
  }

  const maxEstimatedPenetrationM = issues.reduce(
    (max, issue) => Math.max(max, issue.estimatedPenetrationM),
    0,
  );
  return {
    status: issues.some((issue) => issue.severity === "warning") ? "warning" : "ready",
    metricSource: metrics.source,
    signature,
    slots,
    issues,
    autoAdjusted: Object.values(slots).some((slot) => (slot?.autoAdjustmentM ?? 0) > EPSILON_M),
    maxEstimatedPenetrationM: round(maxEstimatedPenetrationM),
  };
}

export function createStudioVrmGarmentEvaluationReceipt(input: {
  modelId: string;
  poseSignature: string;
  generation: number;
  report: StudioVrmGarmentFitReport;
}): StudioVrmGarmentEvaluationReceipt {
  return {
    kind: "studio-vrm-garment-evaluation-receipt",
    version: 1,
    solver: "analytic-layer-fit-v1",
    modelId: input.modelId,
    poseSignature: input.poseSignature,
    inputSignature: input.report.signature,
    generation: Math.max(0, Math.trunc(input.generation)),
    status: input.report.status,
    maxEstimatedPenetrationM: input.report.maxEstimatedPenetrationM,
    issues: input.report.issues.map((issue) => ({
      ...issue,
      slots: [...issue.slots],
      regions: [...issue.regions],
    })),
  };
}
