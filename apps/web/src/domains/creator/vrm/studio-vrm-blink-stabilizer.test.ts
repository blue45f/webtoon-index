import { beforeEach, describe, expect, it } from "vitest";

import {
  BLINK_CLOSE_THRESHOLD,
  BLINK_MIN_FRAMES,
  BLINK_OPEN_THRESHOLD,
  BlinkStabilizer,
  EYE_SYNC_MAX_YAW,
  WINK_DIFF_THRESHOLD,
} from "./studio-vrm-blink-stabilizer";

describe("BlinkStabilizer", () => {
  let stabilizer: BlinkStabilizer;

  beforeEach(() => {
    stabilizer = new BlinkStabilizer();
  });

  it("임계 경계(0.45↔0.55) 채터링 입력에서 상태가 토글되지 않는다(히스테리시스)", () => {
    // 먼저 확실히 닫는다.
    for (let i = 0; i < BLINK_MIN_FRAMES + 1; i++) stabilizer.process(0.9, 0.9, 0);
    expect(stabilizer.process(0.9, 0.9, 0).left).toBe(1);

    // 0.45 ↔ 0.55 교차 입력 — 열림 임계(0.35) 미만이 연속되지 않으므로 closed 유지.
    const outputs: number[] = [];
    for (let i = 0; i < 20; i++) {
      const raw = i % 2 === 0 ? 0.45 : 0.55;
      outputs.push(stabilizer.process(raw, raw, 0).left);
    }
    for (const out of outputs) expect(out).toBe(1);
  });

  it("닫힘 스파이크 1프레임은 무시하고, 최소 연속 프레임이 차면 닫힌다", () => {
    // 단일 프레임 스파이크(0.6) — 다음 프레임 낮은 값으로 pending 리셋.
    stabilizer.process(0.6, 0.6, 0);
    const afterSpike = stabilizer.process(0.1, 0.1, 0);
    expect(afterSpike.left).toBeLessThan(0.5); // 여전히 open 리맵 구간

    // 2연속(BLINK_MIN_FRAMES) 초과 관측이면 닫힘.
    stabilizer.process(0.6, 0.6, 0);
    const closed = stabilizer.process(0.6, 0.6, 0);
    expect(closed.left).toBe(1);
    expect(closed.right).toBe(1);
  });

  it("좌우차가 윙크 임계 이상이면 좌우 독립을 유지한다(윙크)", () => {
    expect(Math.abs(0.9 - 0.05)).toBeGreaterThanOrEqual(WINK_DIFF_THRESHOLD);
    let out = { left: 0, right: 0 };
    for (let i = 0; i < BLINK_MIN_FRAMES + 1; i++) {
      out = stabilizer.process(0.9, 0.05, 0);
    }
    expect(out.left).toBe(1); // 윙크한 눈은 닫힘
    expect(out.right).toBeLessThan(0.2); // 반대 눈은 열림 유지
  });

  it("좌우차가 윙크 임계 미만이면 양안을 동조한다", () => {
    // 차 0.5 < 0.8 → 양안 모두 max(0.7) 기준으로 동일 출력.
    let out = { left: 0, right: 1 };
    for (let i = 0; i < BLINK_MIN_FRAMES + 1; i++) {
      out = stabilizer.process(0.7, 0.2, 0);
    }
    expect(out.left).toBe(out.right);
    expect(out.left).toBe(1); // max 0.7 ≥ CLOSE(0.5) 연속 → 양안 닫힘
  });

  it("yaw가 크면 먼 눈을 가까운 눈에 0.95/0.05로 동기화한다", () => {
    expect(0.6).toBeGreaterThan(EYE_SYNC_MAX_YAW);
    // 윙크 수준의 좌우차(0.85)로 1단계 동조를 우회하고, yaw>0 → 먼 눈 = 왼눈.
    // left = 0.05*0.95 + 0.9*0.05 = 0.0925 → 닫힘 임계 미달, 절대 닫히지 않는다.
    let out = { left: 1, right: 1 };
    for (let i = 0; i < 10; i++) {
      out = stabilizer.process(0.9, 0.05, 0.6);
    }
    expect(out.left).toBeLessThan(0.5); // 먼 눈이 가까운 눈(열림)에 수렴
    expect(out.right).toBeLessThan(0.5);
  });

  it("yaw가 작으면 먼 눈 동기화가 발동하지 않는다", () => {
    let out = { left: 0, right: 0 };
    for (let i = 0; i < BLINK_MIN_FRAMES + 1; i++) {
      out = stabilizer.process(0.9, 0.05, 0.3);
    }
    expect(out.left).toBe(1); // 동기화 없이 윙크 그대로
  });

  it("reset 후 초기(열림) 상태로 돌아간다", () => {
    for (let i = 0; i < BLINK_MIN_FRAMES + 1; i++) stabilizer.process(0.9, 0.9, 0);
    expect(stabilizer.process(0.9, 0.9, 0).left).toBe(1);
    stabilizer.reset();
    // reset 직후 낮은 입력이면 즉시 open 리맵 출력(상태기계 초기화 확인).
    const out = stabilizer.process(0.1, 0.1, 0);
    expect(out.left).toBeLessThan(0.5);
    expect(out.right).toBeLessThan(0.5);
  });

  it("열림 상태 출력은 [0, 0.5) 리맵, 임계 상수는 히스테리시스 순서를 만족한다", () => {
    expect(BLINK_OPEN_THRESHOLD).toBeLessThan(BLINK_CLOSE_THRESHOLD);
    const zero = stabilizer.process(0, 0, 0);
    expect(zero.left).toBe(0);
    const nearThreshold = stabilizer.process(BLINK_OPEN_THRESHOLD - 0.01, BLINK_OPEN_THRESHOLD - 0.01, 0);
    expect(nearThreshold.left).toBeGreaterThan(0.4);
    expect(nearThreshold.left).toBeLessThan(0.5);
  });
});
