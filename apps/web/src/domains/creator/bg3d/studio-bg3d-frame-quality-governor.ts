export const STUDIO_BG3D_ADAPTIVE_DPR_STEPS = [1, 0.85, 0.7, 0.55] as const;

export type StudioBg3dFrameQualityReason =
  | "warming-up"
  | "stable"
  | "degraded"
  | "recovered"
  | "paused"
  | "outlier-ignored";

export interface StudioBg3dFrameQualityState {
  readonly dprStepIndex: number;
  readonly dprScale: number;
  readonly smoothedFrameMs: number;
  readonly acceptedSamples: number;
  readonly overloadSamples: number;
  readonly headroomSamples: number;
  readonly cooldownSamples: number;
  readonly reason: StudioBg3dFrameQualityReason;
}

export interface StudioBg3dFrameQualitySample {
  readonly deltaSeconds: number;
  readonly targetFps: number;
  readonly paused?: boolean;
}

/** Samples the smoothed average needs before it describes the scene rather than the first frame. */
export const STUDIO_BG3D_FRAME_QUALITY_WARMUP_SAMPLES = 30;
const WARMUP_SAMPLES = STUDIO_BG3D_FRAME_QUALITY_WARMUP_SAMPLES;
const DEGRADE_SAMPLES = 45;
const RECOVER_SAMPLES = 300;
const CHANGE_COOLDOWN_SAMPLES = 120;
const SMOOTHING_ALPHA = 0.08;

export function createStudioBg3dFrameQualityState(
  targetFps = 60,
): StudioBg3dFrameQualityState {
  const safeTargetFps = Number.isFinite(targetFps) ? Math.min(120, Math.max(15, targetFps)) : 30;
  return Object.freeze({
    dprStepIndex: 0,
    dprScale: STUDIO_BG3D_ADAPTIVE_DPR_STEPS[0],
    smoothedFrameMs: 1_000 / safeTargetFps,
    acceptedSamples: 0,
    overloadSamples: 0,
    headroomSamples: 0,
    cooldownSamples: 0,
    reason: "warming-up",
  });
}

/** Degrades after sustained pressure and recovers slowly so DPR cannot oscillate while orbiting. */
export function advanceStudioBg3dFrameQuality(
  previous: StudioBg3dFrameQualityState,
  sample: StudioBg3dFrameQualitySample,
): StudioBg3dFrameQualityState {
  if (sample.paused) {
    return Object.freeze({
      ...previous,
      overloadSamples: 0,
      headroomSamples: 0,
      reason: "paused",
    });
  }
  const frameMs = sample.deltaSeconds * 1_000;
  // A resumed background tab, debugger pause, or isolated long task is not GPU throughput.
  if (!Number.isFinite(frameMs) || frameMs < 1 || frameMs > 250) {
    return Object.freeze({
      ...previous,
      overloadSamples: 0,
      headroomSamples: 0,
      reason: "outlier-ignored",
    });
  }
  const targetFps = Number.isFinite(sample.targetFps)
    ? Math.min(120, Math.max(15, sample.targetFps))
    : 30;
  const targetFrameMs = 1_000 / targetFps;
  const acceptedSamples = previous.acceptedSamples + 1;
  const smoothedFrameMs = previous.smoothedFrameMs
    + (frameMs - previous.smoothedFrameMs) * SMOOTHING_ALPHA;
  const cooldownSamples = Math.max(0, previous.cooldownSamples - 1);
  let overloadSamples = smoothedFrameMs > targetFrameMs * 1.15
    ? previous.overloadSamples + 1
    : Math.max(0, previous.overloadSamples - 2);
  let headroomSamples = smoothedFrameMs < targetFrameMs * 0.78
    ? previous.headroomSamples + 1
    : Math.max(0, previous.headroomSamples - 2);
  let dprStepIndex = previous.dprStepIndex;
  let nextCooldown = cooldownSamples;
  let reason: StudioBg3dFrameQualityReason = acceptedSamples < WARMUP_SAMPLES
    ? "warming-up"
    : "stable";

  if (
    acceptedSamples >= WARMUP_SAMPLES && cooldownSamples === 0 &&
    overloadSamples >= DEGRADE_SAMPLES &&
    dprStepIndex < STUDIO_BG3D_ADAPTIVE_DPR_STEPS.length - 1
  ) {
    dprStepIndex += 1;
    overloadSamples = 0;
    headroomSamples = 0;
    nextCooldown = CHANGE_COOLDOWN_SAMPLES;
    reason = "degraded";
  } else if (
    acceptedSamples >= WARMUP_SAMPLES && cooldownSamples === 0 &&
    headroomSamples >= RECOVER_SAMPLES && dprStepIndex > 0
  ) {
    dprStepIndex -= 1;
    overloadSamples = 0;
    headroomSamples = 0;
    nextCooldown = CHANGE_COOLDOWN_SAMPLES;
    reason = "recovered";
  }

  return Object.freeze({
    dprStepIndex,
    dprScale: STUDIO_BG3D_ADAPTIVE_DPR_STEPS[dprStepIndex] ?? 1,
    smoothedFrameMs,
    acceptedSamples,
    overloadSamples,
    headroomSamples,
    cooldownSamples: nextCooldown,
    reason,
  });
}
