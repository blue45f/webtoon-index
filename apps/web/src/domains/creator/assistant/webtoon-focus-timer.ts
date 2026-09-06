/**
 * webtoon-focus-timer.ts
 *
 * Webtoon Production Stage Pomodoro Tracker & Deadline Manager.
 * Benchmarks Acon3D FocusFlow and specialized webtoon deadline trackers.
 *
 * - Tracks work duration across 6 core production stages (Storyboard, Draft, Lineart, Color, BG/3D, Finishing/SFX).
 * - Implements 3 Pomodoro intervals (Standard 25/5, Deep Flow 50/10, Sprint 15/3).
 * - Calculates total episode burn time and deadline countdown.
 * - Correctly carries elapsed time across focus/rest boundaries when a browser tab wakes up late.
 */

export type WebtoonProductionStage =
  | "storyboard" // 콘티 / 연출 계획
  | "draft" // 데생 / 러프 스케치
  | "lineart" // 펜선 / 선화
  | "flat-color" // 밑색 / 채색
  | "background-3d" // 배경 / 3D 소품
  | "finishing-sfx"; // 식자 / 효과음 / 후가공

export type PomodoroMode = "standard-25" | "deep-flow-50" | "sprint-15";

export interface ProductionStageMeta {
  readonly id: WebtoonProductionStage;
  readonly label: string;
  readonly defaultTargetHours: number;
  readonly iconName: string;
}

export interface PomodoroConfig {
  readonly focusMinutes: number;
  readonly restMinutes: number;
}

export interface ProductionSessionState {
  readonly activeStage: WebtoonProductionStage;
  readonly isRunning: boolean;
  readonly isResting: boolean;
  readonly pomodoroMode: PomodoroMode;
  readonly currentSecondsRemaining: number;
  readonly completedPomodoros: number;
  readonly stageSecondsMap: Record<WebtoonProductionStage, number>;
  readonly deadlineIsoString?: string;
}

export const PRODUCTION_STAGES: readonly ProductionStageMeta[] = [
  { id: "storyboard", label: "콘티 / 연출", defaultTargetHours: 8, iconName: "NotebookPen" },
  { id: "draft", label: "데생 / 러프", defaultTargetHours: 12, iconName: "Pencil" },
  { id: "lineart", label: "펜선 / 선화", defaultTargetHours: 16, iconName: "Paintbrush" },
  { id: "flat-color", label: "밑색 / 채색", defaultTargetHours: 18, iconName: "Palette" },
  { id: "background-3d", label: "배경 / 3D", defaultTargetHours: 10, iconName: "Layers" },
  { id: "finishing-sfx", label: "식자 / 효과", defaultTargetHours: 6, iconName: "Type" },
];

export const POMODORO_CONFIGS: Record<PomodoroMode, PomodoroConfig> = {
  "standard-25": { focusMinutes: 25, restMinutes: 5 },
  "deep-flow-50": { focusMinutes: 50, restMinutes: 10 },
  "sprint-15": { focusMinutes: 15, restMinutes: 3 },
};

function createEmptyStageSecondsMap(): Record<WebtoonProductionStage, number> {
  return {
    storyboard: 0,
    draft: 0,
    lineart: 0,
    "flat-color": 0,
    "background-3d": 0,
    "finishing-sfx": 0,
  };
}

function cloneStageSecondsMap(
  source: Readonly<Record<WebtoonProductionStage, number>>,
): Record<WebtoonProductionStage, number> {
  return {
    storyboard: source.storyboard,
    draft: source.draft,
    lineart: source.lineart,
    "flat-color": source["flat-color"],
    "background-3d": source["background-3d"],
    "finishing-sfx": source["finishing-sfx"],
  };
}

function normalizedElapsedSeconds(deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0;
  return Math.floor(deltaSeconds);
}

export class WebtoonFocusTimerEngine {
  private state: ProductionSessionState;

  constructor(
    initialStage: WebtoonProductionStage = "storyboard",
    mode: PomodoroMode = "standard-25",
  ) {
    const config = POMODORO_CONFIGS[mode];
    this.state = {
      activeStage: initialStage,
      isRunning: false,
      isResting: false,
      pomodoroMode: mode,
      currentSecondsRemaining: config.focusMinutes * 60,
      completedPomodoros: 0,
      stageSecondsMap: createEmptyStageSecondsMap(),
    };
  }

  /** Returns a defensive snapshot; callers cannot mutate the engine through the nested map. */
  public getState(): ProductionSessionState {
    return {
      ...this.state,
      stageSecondsMap: cloneStageSecondsMap(this.state.stageSecondsMap),
    };
  }

  public setStage(stage: WebtoonProductionStage): void {
    this.state = { ...this.state, activeStage: stage };
  }

  /**
   * Changes the interval preset without discarding already measured production time.
   * The current interval itself restarts in focus mode so an old mode cannot leak a mismatched duration.
   */
  public setPomodoroMode(mode: PomodoroMode): void {
    const config = POMODORO_CONFIGS[mode];
    this.state = {
      ...this.state,
      pomodoroMode: mode,
      isResting: false,
      isRunning: false,
      currentSecondsRemaining: config.focusMinutes * 60,
    };
  }

  public start(): void {
    this.state = { ...this.state, isRunning: true };
  }

  public pause(): void {
    this.state = { ...this.state, isRunning: false };
  }

  /** Restarts only the active focus/rest interval and preserves measured work. */
  public resetCurrentInterval(): void {
    const config = POMODORO_CONFIGS[this.state.pomodoroMode];
    this.state = {
      ...this.state,
      isRunning: false,
      isResting: false,
      currentSecondsRemaining: config.focusMinutes * 60,
    };
  }

  /** Clears the whole episode session while preserving the selected stage and mode. */
  public resetSession(): void {
    const config = POMODORO_CONFIGS[this.state.pomodoroMode];
    this.state = {
      activeStage: this.state.activeStage,
      pomodoroMode: this.state.pomodoroMode,
      isRunning: false,
      isResting: false,
      currentSecondsRemaining: config.focusMinutes * 60,
      completedPomodoros: 0,
      stageSecondsMap: createEmptyStageSecondsMap(),
      ...(this.state.deadlineIsoString
        ? { deadlineIsoString: this.state.deadlineIsoString }
        : {}),
    };
  }

  /**
   * Advances the timer by elapsed wall-clock seconds.
   *
   * A browser can throttle `setInterval` while the Studio is backgrounded. `deltaSeconds` therefore may
   * be larger than the current interval. The previous implementation crossed at most one boundary and
   * counted the entire delta as focus time. This version consumes every focus/rest phase in order, counts
   * only focus seconds, and bulk-skips complete cycles so even a long sleep resumes deterministically.
   */
  public tick(deltaSeconds = 1): void {
    if (!this.state.isRunning) return;

    let remainingElapsed = normalizedElapsedSeconds(deltaSeconds);
    if (remainingElapsed === 0) return;

    const config = POMODORO_CONFIGS[this.state.pomodoroMode];
    const focusSeconds = config.focusMinutes * 60;
    const restSeconds = config.restMinutes * 60;
    const cycleSeconds = focusSeconds + restSeconds;
    const stageSecondsMap = cloneStageSecondsMap(this.state.stageSecondsMap);
    let isResting = this.state.isResting;
    let currentSecondsRemaining = this.state.currentSecondsRemaining;
    let completedPomodoros = this.state.completedPomodoros;

    while (remainingElapsed > 0) {
      const phaseSeconds = isResting ? restSeconds : focusSeconds;

      // At a clean phase boundary, whole focus+rest cycles leave us in the same phase. Skip them in O(1).
      if (currentSecondsRemaining === phaseSeconds && remainingElapsed >= cycleSeconds) {
        const completeCycles = Math.floor(remainingElapsed / cycleSeconds);
        stageSecondsMap[this.state.activeStage] += completeCycles * focusSeconds;
        completedPomodoros += completeCycles;
        remainingElapsed -= completeCycles * cycleSeconds;
        continue;
      }

      const consumed = Math.min(remainingElapsed, currentSecondsRemaining);
      if (!isResting) {
        stageSecondsMap[this.state.activeStage] += consumed;
      }
      currentSecondsRemaining -= consumed;
      remainingElapsed -= consumed;

      if (currentSecondsRemaining > 0) break;

      if (isResting) {
        isResting = false;
        currentSecondsRemaining = focusSeconds;
      } else {
        isResting = true;
        completedPomodoros += 1;
        currentSecondsRemaining = restSeconds;
      }
    }

    this.state = {
      ...this.state,
      isResting,
      currentSecondsRemaining,
      completedPomodoros,
      stageSecondsMap,
    };
  }

  /** Calculates total elapsed focus time in hours across all stages. */
  public getTotalWorkHours(): number {
    const totalSec = Object.values(this.state.stageSecondsMap).reduce((acc, seconds) => acc + seconds, 0);
    return Number((totalSec / 3600).toFixed(2));
  }

  /** Calculates countdown to a valid ISO-compatible deadline in days/hours. */
  public calculateDeadlineToHours(deadlineIso: string): {
    daysRemaining: number;
    hoursRemaining: number;
    isPastDeadline: boolean;
  } {
    const deadlineMs = new Date(deadlineIso).getTime();
    if (!Number.isFinite(deadlineMs)) {
      throw new RangeError("유효한 마감 일시를 입력해야 합니다.");
    }

    const diffMs = deadlineMs - Date.now();
    if (diffMs <= 0) {
      return { daysRemaining: 0, hoursRemaining: 0, isPastDeadline: true };
    }

    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    return {
      daysRemaining: Math.floor(totalHours / 24),
      hoursRemaining: totalHours % 24,
      isPastDeadline: false,
    };
  }
}