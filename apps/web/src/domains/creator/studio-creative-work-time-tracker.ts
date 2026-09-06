/**
 * Studio Creative Work Time & Productivity Tracker ("My Creative Hours")
 *
 * CLIP STUDIO PAINT Ver.3.0 & Ver.4.1.0 Parity:
 * - Project Creative Work Time Recording (작업 시간 기록 및 통계):
 *   - Automatically tracks active artist time spent creating webtoon episodes/illustrations.
 *   - Idle Detection (휴식 감지): Pauses accumulation when inactive for > 60 seconds.
 *   - Detailed Metrics:
 *     - Cumulative work time (total seconds across sessions)
 *     - Current session active time
 *     - Total strokes executed
 *     - Activity pace (strokes per active minute)
 *   - Pure, deterministic, zero-dependency.
 */

export interface CreativeWorkTimeTrackerState {
  readonly projectId: string;
  readonly totalWorkTimeSeconds: number;
  readonly sessionWorkTimeSeconds: number;
  readonly strokeCount: number;
  readonly sessionStartedAt: number; // Unix timestamp ms
  readonly lastActiveAt: number; // Unix timestamp ms
  readonly isIdle: boolean;
  readonly idleThresholdSeconds: number; // default: 60s
}

export const DEFAULT_IDLE_THRESHOLD_SECONDS = 60;

/**
 * Initializes a new creative work time tracker state.
 */
export function createCreativeWorkTimeTracker(
  projectId: string,
  initialTotalSeconds = 0,
  initialStrokeCount = 0,
  nowMs = Date.now(),
  idleThresholdSeconds = DEFAULT_IDLE_THRESHOLD_SECONDS,
): CreativeWorkTimeTrackerState {
  return Object.freeze({
    projectId,
    totalWorkTimeSeconds: Math.max(0, initialTotalSeconds),
    sessionWorkTimeSeconds: 0,
    strokeCount: Math.max(0, initialStrokeCount),
    sessionStartedAt: nowMs,
    lastActiveAt: nowMs,
    isIdle: false,
    idleThresholdSeconds,
  });
}

/**
 * Records user creative activity (stroke drawn, canvas manipulated, etc.).
 * Accumulates active work time if within the idle threshold.
 */
export function recordCreativeActivity(
  state: CreativeWorkTimeTrackerState,
  isNewStroke = false,
  nowMs = Date.now(),
): CreativeWorkTimeTrackerState {
  const elapsedMs = Math.max(0, nowMs - state.lastActiveAt);
  const elapsedSeconds = elapsedMs / 1000;

  // If time since last interaction exceeds idle threshold, artist was idle.
  // We resume tracking from nowMs without counting the idle period.
  const wasIdle = elapsedSeconds > state.idleThresholdSeconds;

  let addedSeconds = 0;
  if (!wasIdle && elapsedSeconds > 0) {
    addedSeconds = Math.min(elapsedSeconds, state.idleThresholdSeconds);
  }

  const nextTotal = state.totalWorkTimeSeconds + addedSeconds;
  const nextSession = state.sessionWorkTimeSeconds + addedSeconds;
  const nextStrokes = state.strokeCount + (isNewStroke ? 1 : 0);

  return Object.freeze({
    ...state,
    totalWorkTimeSeconds: Math.round(nextTotal * 10) / 10,
    sessionWorkTimeSeconds: Math.round(nextSession * 10) / 10,
    strokeCount: nextStrokes,
    lastActiveAt: nowMs,
    isIdle: false,
  });
}

/**
 * Periodically marks tracker as idle if inactivity exceeds the threshold.
 */
export function evaluateTrackerIdleStatus(
  state: CreativeWorkTimeTrackerState,
  nowMs = Date.now(),
): CreativeWorkTimeTrackerState {
  const elapsedSeconds = Math.max(0, nowMs - state.lastActiveAt) / 1000;
  const isIdle = elapsedSeconds >= state.idleThresholdSeconds;

  if (isIdle === state.isIdle) return state;

  return Object.freeze({
    ...state,
    isIdle,
  });
}

/**
 * Formats seconds into human-readable Korean duration string, e.g. "4시간 25분" or "18분 30초".
 */
export function formatWorkTimeDuration(seconds: number): string {
  const sec = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;

  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }
  if (minutes > 0) {
    return `${minutes}분 ${remSec}초`;
  }
  return `${remSec}초`;
}

export interface CreativeWorkStatistics {
  readonly totalDurationFormatted: string;
  readonly sessionDurationFormatted: string;
  readonly strokeCount: number;
  readonly strokesPerMinute: number;
  readonly isCurrentlyIdle: boolean;
}

/**
 * Computes high-level creative productivity statistics.
 */
export function computeCreativeWorkStatistics(
  state: CreativeWorkTimeTrackerState,
): CreativeWorkStatistics {
  const activeMinutes = Math.max(0.1, state.totalWorkTimeSeconds / 60);
  const strokesPerMinute = Math.round((state.strokeCount / activeMinutes) * 10) / 10;

  return Object.freeze({
    totalDurationFormatted: formatWorkTimeDuration(state.totalWorkTimeSeconds),
    sessionDurationFormatted: formatWorkTimeDuration(state.sessionWorkTimeSeconds),
    strokeCount: state.strokeCount,
    strokesPerMinute,
    isCurrentlyIdle: state.isIdle,
  });
}
