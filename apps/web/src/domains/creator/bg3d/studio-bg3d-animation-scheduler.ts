import { selectStudioBg3dLodLevel } from "./studio-bg3d-lod-selection";

export type StudioBg3dAnimationScheduleReason =
  | "capture"
  | "selected"
  | "near"
  | "far"
  | "very-far"
  | "hidden"
  | "offscreen";

export interface StudioBg3dAnimationScheduleInput {
  readonly visibleInHierarchy: boolean;
  readonly inCameraFrustum: boolean;
  readonly capturing: boolean;
  readonly selected: boolean;
  readonly targetFps: number;
  /** Positive values make CPU animation LOD engage sooner; negative values preserve full rate. */
  readonly lodBias?: number;
  /** Preferred camera-projected coverage in CSS pixels; invalid/missing values use distance fallback. */
  readonly projectedDiameterCssPx?: number;
  /** Near-plane/camera intersection override from the projection helper. */
  readonly projectedForceHighestDetail?: boolean;
  /** Last near/far band, used only to stabilize valid projected measurements. */
  readonly previousProjectedLodReason?: "near" | "far" | "very-far" | null;
  readonly distanceToCamera: number;
  readonly boundingRadius: number;
}

export interface StudioBg3dAnimationSchedule {
  readonly suspended: boolean;
  readonly minimumIntervalSeconds: number;
  readonly reason: StudioBg3dAnimationScheduleReason;
}

const PROJECTED_ANIMATION_LOD_THRESHOLDS_CSS_PX = Object.freeze([56, 21] as const);
const PROJECTED_ANIMATION_LOD_HYSTERESIS_RATIO = 0.1;

function scheduleForAnimationLodLevel(
  level: number,
  targetFps: number,
): StudioBg3dAnimationSchedule {
  if (level >= 2) {
    return {
      suspended: false,
      minimumIntervalSeconds: 1 / Math.min(targetFps, 10),
      reason: "very-far",
    };
  }
  if (level === 1) {
    return {
      suspended: false,
      minimumIntervalSeconds: 1 / Math.min(targetFps, 20),
      reason: "far",
    };
  }
  return { suspended: false, minimumIntervalSeconds: 1 / targetFps, reason: "near" };
}

/**
 * CPU scheduler for mixer/skin/morph sampling. Rendering remains controlled by Three/R3F; skipped
 * animations are sampled from absolute Studio time when they become visible again, so no drift is
 * accumulated and captures/selected editing always receive a fresh pose.
 */
export function resolveStudioBg3dAnimationSchedule(
  input: StudioBg3dAnimationScheduleInput,
): StudioBg3dAnimationSchedule {
  if (!input.visibleInHierarchy) {
    return { suspended: true, minimumIntervalSeconds: Number.POSITIVE_INFINITY, reason: "hidden" };
  }
  if (input.capturing) return { suspended: false, minimumIntervalSeconds: 0, reason: "capture" };
  if (input.selected) return { suspended: false, minimumIntervalSeconds: 0, reason: "selected" };
  if (!input.inCameraFrustum) {
    return { suspended: true, minimumIntervalSeconds: Number.POSITIVE_INFINITY, reason: "offscreen" };
  }
  const targetFps = Number.isFinite(input.targetFps)
    ? Math.min(60, Math.max(10, Math.floor(input.targetFps)))
    : 30;
  const lodBias = Number.isFinite(input.lodBias)
    ? Math.min(4, Math.max(-2, input.lodBias ?? 0))
    : 0;
  const hasProjectedMeasurement = input.projectedForceHighestDetail === true || (
    Number.isFinite(input.projectedDiameterCssPx) &&
    (input.projectedDiameterCssPx ?? -1) >= 0
  );
  if (hasProjectedMeasurement) {
    const previousLevelIndex = input.previousProjectedLodReason === "far"
      ? 1
      : input.previousProjectedLodReason === "very-far"
        ? 2
        : input.previousProjectedLodReason === "near"
          ? 0
          : null;
    return scheduleForAnimationLodLevel(selectStudioBg3dLodLevel({
      projectedDiameterCssPx: input.projectedDiameterCssPx ?? 0,
      fallbackThresholdsCssPx: PROJECTED_ANIMATION_LOD_THRESHOLDS_CSS_PX,
      lodBias,
      previousLevelIndex,
      hysteresisRatio: PROJECTED_ANIMATION_LOD_HYSTERESIS_RATIO,
      forceHighestDetail: input.projectedForceHighestDetail === true,
      offscreen: false,
      invalid: false,
    }), targetFps);
  }
  const radius = Number.isFinite(input.boundingRadius) && input.boundingRadius > 1e-6
    ? input.boundingRadius
    : 1;
  const distance = Number.isFinite(input.distanceToCamera)
    ? Math.max(0, input.distanceToCamera)
    : Number.POSITIVE_INFINITY;
  const distanceInRadii = distance / radius;
  const lodDistanceFactor = 2 ** lodBias;
  if (distanceInRadii >= 80 / lodDistanceFactor) {
    return scheduleForAnimationLodLevel(2, targetFps);
  }
  if (distanceInRadii >= 30 / lodDistanceFactor) {
    return scheduleForAnimationLodLevel(1, targetFps);
  }
  return scheduleForAnimationLodLevel(0, targetFps);
}
