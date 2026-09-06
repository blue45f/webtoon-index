import type {
  StudioBg3dAnimationLoopMode,
  StudioBg3dAnimationPlayback,
} from "./studio-bg3d-scene-document";

export interface StudioBg3dAnimationTimeInput {
  readonly baseTimeSeconds: number;
  readonly elapsedSeconds: number;
  readonly timeScale: number;
  readonly durationSeconds: number;
  readonly loop: StudioBg3dAnimationLoopMode;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/** Resolves a stable clip-local time for forward, paused, and reverse playback. */
export function resolveStudioBg3dAnimationTime({
  baseTimeSeconds,
  elapsedSeconds,
  timeScale,
  durationSeconds,
  loop,
}: StudioBg3dAnimationTimeInput): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  const base = Number.isFinite(baseTimeSeconds) ? baseTimeSeconds : 0;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const scale = Number.isFinite(timeScale) ? timeScale : 1;
  const raw = base + elapsed * scale;

  if (loop === "once") return Math.min(durationSeconds, Math.max(0, raw));
  if (loop === "repeat") return positiveModulo(raw, durationSeconds);

  const period = durationSeconds * 2;
  const phase = positiveModulo(raw, period);
  return phase <= durationSeconds ? phase : period - phase;
}

/** Detects the one transition that should persist a stopped UI state. */
export function isStudioBg3dAnimationOnceComplete({
  baseTimeSeconds,
  elapsedSeconds,
  timeScale,
  durationSeconds,
  loop,
}: StudioBg3dAnimationTimeInput): boolean {
  if (
    loop !== "once"
    || !Number.isFinite(durationSeconds)
    || durationSeconds <= 0
    || !Number.isFinite(timeScale)
    || timeScale === 0
  ) {
    return false;
  }
  const base = Number.isFinite(baseTimeSeconds) ? baseTimeSeconds : 0;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const raw = base + elapsed * timeScale;
  return timeScale > 0 ? raw >= durationSeconds : raw <= 0;
}

/** Captures the live mixer pose once before a UI edit rebuilds playback state. */
export function snapshotStudioBg3dLiveAnimationPlayback(
  playback: StudioBg3dAnimationPlayback,
  liveTimeSeconds: number | undefined,
): StudioBg3dAnimationPlayback {
  if (!playback.playing || !Number.isFinite(liveTimeSeconds)) return playback;
  return { ...playback, timeSeconds: Math.max(0, liveTimeSeconds!) };
}

/**
 * Resolves the selected-model playhead without persisting mixer ticks into SceneDocument/history.
 * The live reader is authoritative only while the same model is playing; all other states use the
 * canonical stored time. The result is always safe for a range input.
 */
export function resolveStudioBg3dAnimationDisplayTime(input: {
  readonly modelId: string;
  readonly playback: StudioBg3dAnimationPlayback;
  readonly durationSeconds: number;
  readonly liveSample: {
    readonly modelId: string;
    readonly clipIndex: number;
    readonly baseTimeSeconds: number;
    readonly timeSeconds: number;
  } | null;
}): number {
  const duration = Number.isFinite(input.durationSeconds)
    ? Math.max(0, input.durationSeconds)
    : 0;
  const hasCurrentLiveSample = input.playback.playing &&
    input.liveSample?.modelId === input.modelId &&
    input.liveSample.clipIndex === input.playback.clipIndex &&
    input.liveSample.baseTimeSeconds === input.playback.timeSeconds &&
    Number.isFinite(input.liveSample.timeSeconds);
  if (hasCurrentLiveSample) {
    return Math.min(duration, Math.max(0, input.liveSample!.timeSeconds));
  }
  return resolveStudioBg3dAnimationTime({
    baseTimeSeconds: input.playback.timeSeconds,
    elapsedSeconds: 0,
    timeScale: input.playback.timeScale,
    durationSeconds: duration,
    loop: input.playback.loop,
  });
}
