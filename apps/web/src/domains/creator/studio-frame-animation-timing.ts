import type { StudioAnimFrame } from "./studio-frame-animation";

export const DEFAULT_FRAME_FPS = 12;
export const MIN_FRAME_FPS = 1;
export const MAX_FRAME_FPS = 30;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function normalizeFrameFps(fps: number | undefined): number {
  if (fps === undefined || !Number.isFinite(fps)) return DEFAULT_FRAME_FPS;
  return Math.round(clamp(fps, MIN_FRAME_FPS, MAX_FRAME_FPS));
}

/** 프레임 1장의 노출 시간(ms) — durationMs가 유효하면 그 값, 아니면 fps 기반 균등 시간. */
export function frameDurationMs(frame: StudioAnimFrame, fps: number): number {
  if (
    frame.durationMs !== undefined &&
    Number.isFinite(frame.durationMs) &&
    frame.durationMs > 0
  ) {
    return frame.durationMs;
  }
  return 1000 / normalizeFrameFps(fps);
}

/** frames와 같은 순서와 길이로 한 루프의 노출 시간 배열을 만든다. */
export function frameDurationsMs(
  frames: StudioAnimFrame[],
  fps: number
): number[] {
  return frames.map((frame) => frameDurationMs(frame, fps));
}

/**
 * 한 루프의 프레임 노출 시간과 경과 시간으로 현재 프레임 인덱스를 계산한다. 내보내기 런타임과
 * 에디터 미리보기가 동일한 결정적 타이밍 규칙을 공유하되 서로의 번들 수명에는 의존하지 않는다.
 */
export function frameIndexAtElapsed(
  durations: number[],
  elapsedMs: number,
  loop: boolean
): number {
  if (durations.length === 0) return 0;
  const total = durations.reduce((sum, duration) => sum + Math.max(0, duration), 0);
  if (total <= 0) return 0;
  const time = loop
    ? ((elapsedMs % total) + total) % total
    : clamp(elapsedMs, 0, total - 0.0001);
  let accumulated = 0;
  for (let index = 0; index < durations.length; index += 1) {
    accumulated += Math.max(0, durations[index]!);
    if (time < accumulated) return index;
  }
  return durations.length - 1;
}
