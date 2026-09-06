import { describe, expect, it } from "vitest";

import {
  calculateCameraShake,
  createShotBookmark,
  createShotBookmarkFromCamera,
  createShotDeckPlaybackPlan,
  evaluateWebtoonShotEasing,
  interpolateShotBookmark,
  WEBTOON_SHOT_ANGLE_PRESETS,
} from "./studio-3d-camera-cinematic-director";

describe("Studio 3D Webtoon Camera Cinematography Director", () => {
  it("provides 8 webtoon cinematography shot angle presets", () => {
    expect(WEBTOON_SHOT_ANGLE_PRESETS.length).toBe(8);
    const lowAngle = WEBTOON_SHOT_ANGLE_PRESETS.find((preset) => preset.kind === "low-angle-heroic");
    expect(lowAngle).toBeDefined();
    expect(lowAngle?.defaultFov).toBe(28);

    const dutch = WEBTOON_SHOT_ANGLE_PRESETS.find((preset) => preset.kind === "dutch-tilt-tension");
    expect(dutch?.defaultDutchRoll).toBe(20);
  });

  it("calculates realistic camera shake offsets for explosive shockwave and earthquake rumble", () => {
    const zeroShake = calculateCameraShake(
      { preset: "none", intensity: 1.0, frequency: 10, decayRate: 1.0 },
      0.5,
    );
    expect(zeroShake.offsetX).toBe(0);
    expect(zeroShake.offsetY).toBe(0);

    const earthShake = calculateCameraShake(
      { preset: "earthquake-rumble", intensity: 1.0, frequency: 15, decayRate: 0.5 },
      0.2,
    );
    expect(Math.abs(earthShake.offsetX)).toBeGreaterThan(0);
    expect(Math.abs(earthShake.offsetY)).toBeGreaterThan(0);

    const shockwaveEarly = calculateCameraShake(
      { preset: "explosive-shockwave", intensity: 1.5, frequency: 20, decayRate: 2.0 },
      0.05,
    );
    const shockwaveLate = calculateCameraShake(
      { preset: "explosive-shockwave", intensity: 1.5, frequency: 20, decayRate: 2.0 },
      2.0,
    );
    expect(Math.abs(shockwaveEarly.offsetY)).toBeGreaterThan(Math.abs(shockwaveLate.offsetY));
  });

  it("creates a webtoon shot bookmark with bounded transition metadata", () => {
    const bookmark = createShotBookmark(
      "cut-01",
      "1화 오프닝 영웅 등장",
      1,
      "low-angle-heroic",
      [0, 0, 0],
      { transitionSeconds: 0.45, holdSeconds: 2, easing: "whip-pan", panelAspect: "16:9" },
    );
    expect(bookmark.id).toBe("cut-01");
    expect(bookmark.angleKind).toBe("low-angle-heroic");
    expect(bookmark.position[1]).toBeCloseTo(0.3);
    expect(bookmark.fov).toBe(28);
    expect(bookmark.easing).toBe("whip-pan");
    expect(bookmark.holdSeconds).toBe(2);
    expect(bookmark.panelAspect).toBe("16:9");
  });

  it("captures an exact live camera and interpolates using the destination easing", () => {
    const live = createShotBookmarkFromCamera(
      "live",
      "현재 뷰",
      1,
      "eye-level-dialogue",
      {
        position: [2, 3, 4],
        target: [0, 1, 0],
        fovDegrees: 37,
        up: [0, 1, 0],
      },
    );
    const next = createShotBookmark("next", "다음", 2, "wide-establishing");
    const frame = interpolateShotBookmark(live, next, 0.5);

    expect(live.position).toEqual([2, 3, 4]);
    expect(live.target).toEqual([0, 1, 0]);
    expect(live.fov).toBe(37);
    expect(frame.position[0]).toBeGreaterThanOrEqual(0);
    expect(frame.position[0]).toBeLessThanOrEqual(2);
    expect(frame.fov).toBeGreaterThan(37);
    expect(frame.fov).toBeLessThan(65);
  });

  it("builds a deterministic shot deck timeline and bounded easing curves", () => {
    const first = createShotBookmark("a", "A", 1, "eye-level-dialogue", [0, 1, 0], {
      holdSeconds: 1,
    });
    const second = createShotBookmark("b", "B", 2, "over-the-shoulder", [0, 1, 0], {
      transitionSeconds: 0.5,
      holdSeconds: 2,
    });
    const plan = createShotDeckPlaybackPlan([first, second]);

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.arrivalSeconds).toBe(0);
    expect(plan.steps[1]?.arrivalSeconds).toBe(1.5);
    expect(plan.totalSeconds).toBe(3.5);
    for (const easing of ["linear", "ease-in-out", "spring-punch", "whip-pan"] as const) {
      expect(evaluateWebtoonShotEasing(easing, -1)).toBe(0);
      expect(evaluateWebtoonShotEasing(easing, 2)).toBe(1);
    }
  });
});
