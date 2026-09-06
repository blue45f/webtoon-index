import { describe, expect, it } from "vitest";

import {
  advanceStudioBg3dFrameQuality,
  createStudioBg3dFrameQualityState,
} from "./studio-bg3d-frame-quality-governor";

function samples(
  count: number,
  deltaSeconds: number,
  initial = createStudioBg3dFrameQualityState(60),
) {
  let state = initial;
  for (let index = 0; index < count; index += 1) {
    state = advanceStudioBg3dFrameQuality(state, { deltaSeconds, targetFps: 60 });
  }
  return state;
}

describe("Studio BG3D frame quality governor", () => {
  it("degrades only after sustained overload and observes a cooldown", () => {
    expect(samples(40, 1 / 24).dprScale).toBe(1);
    const degraded = samples(80, 1 / 24);
    expect(degraded).toMatchObject({ dprStepIndex: 1, dprScale: 0.85 });
    expect(degraded.cooldownSamples).toBeGreaterThan(0);
    expect(samples(60, 1 / 15, degraded).dprStepIndex).toBe(1);
  });

  it("recovers much more slowly than it degrades", () => {
    const degraded = samples(80, 1 / 24);
    const shortHeadroom = samples(250, 1 / 120, degraded);
    expect(shortHeadroom.dprStepIndex).toBe(1);
    expect(samples(200, 1 / 120, shortHeadroom)).toMatchObject({
      dprStepIndex: 0,
      dprScale: 1,
    });
  });

  it("ignores resume outliers and pauses counters during capture", () => {
    const initial = samples(20, 1 / 24);
    expect(advanceStudioBg3dFrameQuality(initial, {
      deltaSeconds: 2,
      targetFps: 60,
    })).toMatchObject({ dprScale: 1, overloadSamples: 0, reason: "outlier-ignored" });
    expect(advanceStudioBg3dFrameQuality(initial, {
      deltaSeconds: 1 / 24,
      targetFps: 60,
      paused: true,
    })).toMatchObject({ overloadSamples: 0, headroomSamples: 0, reason: "paused" });
  });
});
