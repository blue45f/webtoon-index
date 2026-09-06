import { describe, expect, it } from "vitest";

import {
  isStudioBg3dAnimationOnceComplete,
  resolveStudioBg3dAnimationDisplayTime,
  resolveStudioBg3dAnimationTime,
  snapshotStudioBg3dLiveAnimationPlayback,
} from "./studio-bg3d-animation-time";
import { DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK } from "./studio-bg3d-scene-document";

describe("resolveStudioBg3dAnimationTime", () => {
  it("wraps repeat playback in both forward and reverse directions", () => {
    expect(resolveStudioBg3dAnimationTime({
      baseTimeSeconds: 1.75,
      elapsedSeconds: 0.5,
      timeScale: 1,
      durationSeconds: 2,
      loop: "repeat",
    })).toBeCloseTo(0.25);
    expect(resolveStudioBg3dAnimationTime({
      baseTimeSeconds: 0.25,
      elapsedSeconds: 0.5,
      timeScale: -1,
      durationSeconds: 2,
      loop: "repeat",
    })).toBeCloseTo(1.75);
  });

  it("reflects ping-pong playback across both clip boundaries", () => {
    expect(resolveStudioBg3dAnimationTime({
      baseTimeSeconds: 1.5,
      elapsedSeconds: 1,
      timeScale: 1,
      durationSeconds: 2,
      loop: "ping-pong",
    })).toBeCloseTo(1.5);
    expect(resolveStudioBg3dAnimationTime({
      baseTimeSeconds: 0.25,
      elapsedSeconds: 0.5,
      timeScale: -1,
      durationSeconds: 2,
      loop: "ping-pong",
    })).toBeCloseTo(0.25);
  });

  it("clamps one-shot playback and preserves a zero-speed pose", () => {
    expect(resolveStudioBg3dAnimationTime({
      baseTimeSeconds: 1,
      elapsedSeconds: 10,
      timeScale: 1,
      durationSeconds: 2,
      loop: "once",
    })).toBe(2);
    expect(resolveStudioBg3dAnimationTime({
      baseTimeSeconds: 1,
      elapsedSeconds: 10,
      timeScale: 0,
      durationSeconds: 2,
      loop: "repeat",
    })).toBe(1);
  });

  it("fails closed for invalid durations and normalizes non-finite inputs", () => {
    expect(resolveStudioBg3dAnimationTime({
      baseTimeSeconds: 1,
      elapsedSeconds: 1,
      timeScale: 1,
      durationSeconds: 0,
      loop: "repeat",
    })).toBe(0);
    expect(resolveStudioBg3dAnimationTime({
      baseTimeSeconds: Number.NaN,
      elapsedSeconds: Number.POSITIVE_INFINITY,
      timeScale: Number.NaN,
      durationSeconds: 2,
      loop: "once",
    })).toBe(0);
  });

  it("reports one-shot completion once in either direction", () => {
    expect(isStudioBg3dAnimationOnceComplete({
      baseTimeSeconds: 1.5,
      elapsedSeconds: 0.5,
      timeScale: 1,
      durationSeconds: 2,
      loop: "once",
    })).toBe(true);
    expect(isStudioBg3dAnimationOnceComplete({
      baseTimeSeconds: 0.5,
      elapsedSeconds: 0.5,
      timeScale: -1,
      durationSeconds: 2,
      loop: "once",
    })).toBe(true);
    expect(isStudioBg3dAnimationOnceComplete({
      baseTimeSeconds: 0.5,
      elapsedSeconds: 20,
      timeScale: -1,
      durationSeconds: 2,
      loop: "repeat",
    })).toBe(false);
  });

  it("snapshots the live mixer time before pause or playback edits", () => {
    const playing = { ...DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK, playing: true, timeSeconds: 0 };
    const snapshot = snapshotStudioBg3dLiveAnimationPlayback(playing, 1.375);

    expect(snapshot).toEqual({ ...playing, timeSeconds: 1.375 });
    expect(snapshot).not.toBe(playing);
    expect(snapshotStudioBg3dLiveAnimationPlayback(
      { ...playing, playing: false },
      1.375,
    )).toEqual({ ...playing, playing: false });
    expect(snapshotStudioBg3dLiveAnimationPlayback(playing, Number.NaN)).toBe(playing);
  });

  it("shows only the selected playing model's live time without changing stored playback", () => {
    const playback = {
      ...DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK,
      playing: true,
      timeSeconds: 1,
    };

    expect(resolveStudioBg3dAnimationDisplayTime({
      modelId: "model-a",
      playback,
      durationSeconds: 10,
      liveSample: { modelId: "model-a", clipIndex: 0, baseTimeSeconds: 1, timeSeconds: 7.5 },
    })).toBe(7.5);
    expect(resolveStudioBg3dAnimationDisplayTime({
      modelId: "model-b",
      playback,
      durationSeconds: 10,
      liveSample: { modelId: "model-a", clipIndex: 0, baseTimeSeconds: 1, timeSeconds: 7.5 },
    })).toBe(1);
    expect(playback.timeSeconds).toBe(1);
  });

  it("matches renderer loop semantics for paused or unavailable live samples", () => {
    const paused = {
      ...DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK,
      playing: false,
      timeSeconds: 3,
    };

    expect(resolveStudioBg3dAnimationDisplayTime({
      modelId: "model",
      playback: paused,
      durationSeconds: 2,
      liveSample: { modelId: "model", clipIndex: 0, baseTimeSeconds: 3, timeSeconds: 1.5 },
    })).toBe(1);
    expect(resolveStudioBg3dAnimationDisplayTime({
      modelId: "model",
      playback: { ...paused, playing: true },
      durationSeconds: 2,
      liveSample: { modelId: "model", clipIndex: 0, baseTimeSeconds: 3, timeSeconds: Number.NaN },
    })).toBe(1);
    expect(resolveStudioBg3dAnimationDisplayTime({
      modelId: "model",
      playback: { ...paused, playing: true },
      durationSeconds: Number.POSITIVE_INFINITY,
      liveSample: { modelId: "model", clipIndex: 0, baseTimeSeconds: 3, timeSeconds: 1 },
    })).toBe(0);

    expect(resolveStudioBg3dAnimationDisplayTime({
      modelId: "model",
      playback: { ...paused, loop: "ping-pong", timeSeconds: 3 },
      durationSeconds: 2,
      liveSample: null,
    })).toBe(1);
    expect(resolveStudioBg3dAnimationDisplayTime({
      modelId: "model",
      playback: { ...paused, loop: "once", timeSeconds: 3 },
      durationSeconds: 2,
      liveSample: null,
    })).toBe(2);
  });

  it("ignores a stale sample after the clip or playback anchor changes", () => {
    const playback = {
      ...DEFAULT_STUDIO_BG3D_ANIMATION_PLAYBACK,
      playing: true,
      clipIndex: 1,
      timeSeconds: 4,
    };
    const stale = { modelId: "model", clipIndex: 0, baseTimeSeconds: 1, timeSeconds: 9 };

    expect(resolveStudioBg3dAnimationDisplayTime({
      modelId: "model",
      playback,
      durationSeconds: 10,
      liveSample: stale,
    })).toBe(4);
  });
});
