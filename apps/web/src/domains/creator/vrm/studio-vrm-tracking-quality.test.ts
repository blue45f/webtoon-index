import { describe, expect, it } from "vitest";

import {
  AdaptiveQualityController,
  DEGRADE_MS,
  PROMOTE_HOLD_MS,
  PROMOTE_MS,
  QUALITY_WINDOW,
} from "./studio-vrm-tracking-quality";

/** frameMs 프레임을 count개, intervalMs 간격으로 주입한다. 마지막 nowMs를 반환. */
function feed(
  controller: AdaptiveQualityController,
  frameMs: number,
  count: number,
  startNowMs: number,
  intervalMs = 33,
): number {
  let now = startNowMs;
  for (let i = 0; i < count; i++) {
    now += intervalMs;
    controller.recordFrame(frameMs, now);
  }
  return now;
}

describe("AdaptiveQualityController", () => {
  it("중앙값이 강등 임계를 넘는 윈도우가 차면 즉시 1단계 강등한다", () => {
    const controller = new AdaptiveQualityController("full");
    feed(controller, DEGRADE_MS + 10, QUALITY_WINDOW - 1, 0);
    expect(controller.tier).toBe("full"); // 윈도우 미충족 — 판정 보류
    feed(controller, DEGRADE_MS + 10, 1, 1000);
    expect(controller.tier).toBe("reduced");

    // 강등 후 윈도우가 비워지므로, 다시 한 윈도우를 채워야 추가 강등된다.
    feed(controller, DEGRADE_MS + 10, QUALITY_WINDOW - 1, 2000);
    expect(controller.tier).toBe("reduced");
    feed(controller, DEGRADE_MS + 10, 1, 4000);
    expect(controller.tier).toBe("minimal");

    // 최저 티어에서는 더 내려가지 않는다.
    feed(controller, DEGRADE_MS + 10, QUALITY_WINDOW, 5000);
    expect(controller.tier).toBe("minimal");
  });

  it("여유가 있어도 유지 시간 미만이면 승격하지 않는다(히스테리시스)", () => {
    const controller = new AdaptiveQualityController("reduced");
    // 3초 동안만 빠른 프레임 — PROMOTE_HOLD_MS(4초) 미달.
    feed(controller, PROMOTE_MS - 10, 90, 0, 33); // 90*33ms ≈ 2.97s
    expect(controller.tier).toBe("reduced");
  });

  it("유지 시간을 채우면 정확히 1단계만 승격한다", () => {
    const controller = new AdaptiveQualityController("minimal");
    // 윈도우 채움 + 4초 이상 유지 → minimal → reduced 한 단계만.
    feed(controller, PROMOTE_MS - 10, QUALITY_WINDOW + Math.ceil(PROMOTE_HOLD_MS / 33) + 2, 0, 33);
    expect(controller.tier).toBe("reduced");
    // 이어서 또 4초 유지해야 full 로 승격된다.
    feed(controller, PROMOTE_MS - 10, QUALITY_WINDOW + Math.ceil(PROMOTE_HOLD_MS / 33) + 2, 100000, 33);
    expect(controller.tier).toBe("full");
  });

  it("승격 대기 중 느린 프레임이 끼면 유지 타이머가 리셋된다", () => {
    const controller = new AdaptiveQualityController("reduced");
    // 연속 시간축: 빠른 프레임 ~2초 유지(승격 4초 미달) 후,
    let now = feed(controller, PROMOTE_MS - 10, QUALITY_WINDOW + 30, 0, 33);
    // 중간 속도 프레임으로 중앙값을 승격 임계 위로 — 유지 타이머 리셋(강등 임계 미만이라 강등은 없음).
    now = feed(controller, DEGRADE_MS - 2, QUALITY_WINDOW, now, 33);
    expect(controller.tier).toBe("reduced");
    // 다시 빠른 프레임 ~3초 — 타이머가 리셋됐으므로 아직 승격 불가.
    feed(controller, PROMOTE_MS - 10, 90, now, 33);
    expect(controller.tier).toBe("reduced");
  });

  it("티어별 pose/hands 스케줄이 격프레임 규칙을 따른다", () => {
    const full = new AdaptiveQualityController("full");
    expect(full.shouldRunPose(0)).toBe(true);
    expect(full.shouldRunPose(1)).toBe(true);
    expect(full.shouldRunHands(1, true)).toBe(true);
    expect(full.shouldRunHands(1, false)).toBe(false); // 손가락 옵션 꺼짐

    const reduced = new AdaptiveQualityController("reduced");
    expect(reduced.shouldRunPose(1)).toBe(true);
    expect(reduced.shouldRunHands(0, true)).toBe(true);
    expect(reduced.shouldRunHands(1, true)).toBe(false); // 격프레임

    const minimal = new AdaptiveQualityController("minimal");
    expect(minimal.shouldRunPose(0)).toBe(true);
    expect(minimal.shouldRunPose(1)).toBe(false); // 격프레임
    expect(minimal.shouldRunHands(0, true)).toBe(false); // hands 끔
  });

  it("초기 티어를 생성자로 주입할 수 있고 reset은 초기 티어로 되돌린다", () => {
    const controller = new AdaptiveQualityController("reduced");
    expect(controller.tier).toBe("reduced");
    feed(controller, DEGRADE_MS + 20, QUALITY_WINDOW, 0);
    expect(controller.tier).toBe("minimal");
    controller.reset();
    expect(controller.tier).toBe("reduced");
  });
});
