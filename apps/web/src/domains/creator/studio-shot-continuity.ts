/**
 * Shot continuity / animatic P2 (SHT-004/006) + camera lens P1 (SHT-002).
 */

export const STUDIO_SHOT_CONTINUITY_REVISION = 1 as const;

export interface StudioCameraLens {
  readonly focalLengthMm: number;
  readonly sensorWidthMm: number;
  readonly sensorHeightMm: number;
  readonly ortho: boolean;
  readonly orthoSize?: number;
}

export function studioCameraFovY(lens: StudioCameraLens): number {
  if (lens.ortho) return 0;
  const f = Math.max(1, lens.focalLengthMm);
  const h = Math.max(1, lens.sensorHeightMm);
  return 2 * Math.atan(h / (2 * f));
}

export function studioCameraFovX(lens: StudioCameraLens): number {
  if (lens.ortho) return 0;
  const f = Math.max(1, lens.focalLengthMm);
  const w = Math.max(1, lens.sensorWidthMm);
  return 2 * Math.atan(w / (2 * f));
}

export interface StudioShotContinuitySnapshot {
  readonly shotId: string;
  readonly camera: {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly lens: StudioCameraLens;
  };
  readonly objectVisibility: Readonly<Record<string, boolean>>;
  readonly characterPoses: Readonly<Record<string, string>>;
  readonly materials: Readonly<Record<string, string>>;
}

export interface StudioShotContinuityDiff {
  readonly fromShotId: string;
  readonly toShotId: string;
  readonly cameraMoved: boolean;
  readonly cameraDistance: number;
  readonly fovDelta: number;
  readonly visibilityChanged: readonly string[];
  readonly poseChanged: readonly string[];
  readonly materialChanged: readonly string[];
}

export function diffStudioShotContinuity(
  from: StudioShotContinuitySnapshot,
  to: StudioShotContinuitySnapshot,
): StudioShotContinuityDiff {
  const dx = to.camera.position[0] - from.camera.position[0];
  const dy = to.camera.position[1] - from.camera.position[1];
  const dz = to.camera.position[2] - from.camera.position[2];
  const cameraDistance = Math.hypot(dx, dy, dz);
  const fovDelta =
    studioCameraFovY(to.camera.lens) - studioCameraFovY(from.camera.lens);
  const keys = new Set([
    ...Object.keys(from.objectVisibility),
    ...Object.keys(to.objectVisibility),
  ]);
  const visibilityChanged = [...keys].filter(
    (k) => from.objectVisibility[k] !== to.objectVisibility[k],
  );
  const poseKeys = new Set([
    ...Object.keys(from.characterPoses),
    ...Object.keys(to.characterPoses),
  ]);
  const poseChanged = [...poseKeys].filter(
    (k) => from.characterPoses[k] !== to.characterPoses[k],
  );
  const matKeys = new Set([
    ...Object.keys(from.materials),
    ...Object.keys(to.materials),
  ]);
  const materialChanged = [...matKeys].filter(
    (k) => from.materials[k] !== to.materials[k],
  );
  return {
    fromShotId: from.shotId,
    toShotId: to.shotId,
    cameraMoved: cameraDistance > 1e-4,
    cameraDistance,
    fovDelta,
    visibilityChanged,
    poseChanged,
    materialChanged,
  };
}

export interface StudioAnimaticCue {
  readonly shotId: string;
  readonly startSec: number;
  readonly durationSec: number;
  readonly audioCue?: string;
}

export function buildStudioAnimaticTimeline(
  cues: readonly StudioAnimaticCue[],
): {
  readonly totalDuration: number;
  readonly ordered: readonly StudioAnimaticCue[];
} {
  const ordered = [...cues].sort((a, b) => a.startSec - b.startSec);
  let totalDuration = 0;
  for (const c of ordered) {
    totalDuration = Math.max(totalDuration, c.startSec + c.durationSec);
  }
  return { totalDuration, ordered };
}
