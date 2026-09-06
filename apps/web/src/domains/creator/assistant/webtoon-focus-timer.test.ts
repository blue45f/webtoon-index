import { describe, expect, it } from "vitest";

import {
  POMODORO_CONFIGS,
  PRODUCTION_STAGES,
  WebtoonFocusTimerEngine,
} from "./webtoon-focus-timer";

describe("WebtoonFocusTimerEngine", () => {
  it("initializes with 6 production stages and standard 25min mode", () => {
    const engine = new WebtoonFocusTimerEngine();
    const state = engine.getState();

    expect(PRODUCTION_STAGES.length).toBe(6);
    expect(state.activeStage).toBe("storyboard");
    expect(state.pomodoroMode).toBe("standard-25");
    expect(state.currentSecondsRemaining).toBe(25 * 60);
    expect(state.isRunning).toBe(false);
  });

  it("switches stage and pomodoro mode without discarding measured work", () => {
    const engine = new WebtoonFocusTimerEngine();
    engine.start();
    engine.tick(60);

    engine.setStage("lineart");
    expect(engine.getState().activeStage).toBe("lineart");

    engine.setPomodoroMode("deep-flow-50");
    const state = engine.getState();
    expect(state.pomodoroMode).toBe("deep-flow-50");
    expect(state.currentSecondsRemaining).toBe(50 * 60);
    expect(state.isRunning).toBe(false);
    expect(state.stageSecondsMap.storyboard).toBe(60);
  });

  it("advances active stage time on tick while running", () => {
    const engine = new WebtoonFocusTimerEngine("flat-color", "sprint-15");
    engine.start();

    engine.tick(60);
    const state = engine.getState();

    expect(state.stageSecondsMap["flat-color"]).toBe(60);
    expect(state.currentSecondsRemaining).toBe(15 * 60 - 60);
  });

  it("transitions to rest cycle upon timer expiry", () => {
    const engine = new WebtoonFocusTimerEngine("storyboard", "sprint-15");
    engine.start();

    engine.tick(900);
    const state = engine.getState();

    expect(state.isResting).toBe(true);
    expect(state.completedPomodoros).toBe(1);
    expect(state.currentSecondsRemaining).toBe(
      POMODORO_CONFIGS["sprint-15"].restMinutes * 60,
    );
  });

  it("carries a delayed browser tick across focus and rest without counting rest as work", () => {
    const engine = new WebtoonFocusTimerEngine("lineart", "sprint-15");
    engine.start();

    // 15m focus + 3m rest + 2m into the next focus.
    engine.tick(20 * 60);
    const state = engine.getState();

    expect(state.isResting).toBe(false);
    expect(state.completedPomodoros).toBe(1);
    expect(state.currentSecondsRemaining).toBe(13 * 60);
    expect(state.stageSecondsMap.lineart).toBe(17 * 60);
  });

  it("bulk-skips complete cycles deterministically", () => {
    const engine = new WebtoonFocusTimerEngine("background-3d", "standard-25");
    engine.start();

    engine.tick(60 * 60);
    const state = engine.getState();

    expect(state.completedPomodoros).toBe(2);
    expect(state.isResting).toBe(false);
    expect(state.currentSecondsRemaining).toBe(25 * 60);
    expect(state.stageSecondsMap["background-3d"]).toBe(50 * 60);
    expect(engine.getTotalWorkHours()).toBeCloseTo(0.83, 2);
  });

  it("returns a defensive state snapshot", () => {
    const engine = new WebtoonFocusTimerEngine();
    const snapshot = engine.getState();

    snapshot.stageSecondsMap.storyboard = 99_999;

    expect(engine.getState().stageSecondsMap.storyboard).toBe(0);
  });

  it("resets the current interval separately from the whole session", () => {
    const engine = new WebtoonFocusTimerEngine("flat-color", "sprint-15");
    engine.start();
    engine.tick(120);

    engine.resetCurrentInterval();
    let state = engine.getState();
    expect(state.currentSecondsRemaining).toBe(15 * 60);
    expect(state.stageSecondsMap["flat-color"]).toBe(120);
    expect(state.isRunning).toBe(false);

    engine.resetSession();
    state = engine.getState();
    expect(state.currentSecondsRemaining).toBe(15 * 60);
    expect(state.stageSecondsMap["flat-color"]).toBe(0);
    expect(state.completedPomodoros).toBe(0);
  });

  it("ignores invalid or non-positive elapsed values", () => {
    const engine = new WebtoonFocusTimerEngine();
    engine.start();

    engine.tick(Number.NaN);
    engine.tick(Number.POSITIVE_INFINITY);
    engine.tick(-10);

    expect(engine.getState().currentSecondsRemaining).toBe(25 * 60);
    expect(engine.getState().stageSecondsMap.storyboard).toBe(0);
  });

  it("computes deadline countdown accurately and rejects invalid dates", () => {
    const engine = new WebtoonFocusTimerEngine();
    const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const countdown = engine.calculateDeadlineToHours(futureDate);
    expect(countdown.isPastDeadline).toBe(false);
    expect(countdown.daysRemaining).toBeGreaterThanOrEqual(1);
    expect(() => engine.calculateDeadlineToHours("not-a-date")).toThrow(RangeError);
  });
});