import { describe, expect, it } from "vitest";

import {
  CHANNEL_FILTER_PRESETS,
  OneEuroFilter1D,
  SMOOTHING_BASELINE,
  TrackingChannelFilterBank,
} from "./studio-vrm-one-euro";

import type { TrackingChannels } from "./studio-vrm-webcam-tracking";

const baseChannels: TrackingChannels = {
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  blinkLeft: 0,
  blinkRight: 0,
  gazeX: 0,
  gazeY: 0,
  mouthOpen: 0,
  mouthSmile: 0,
  browInnerUp: 0,
  browOuterUpLeft: 0,
  browOuterUpRight: 0,
  browDown: 0,
  mouthFrown: 0,
  eyeWide: 0,
};

/** 결정적 의사 노이즈(LCG) — CI에서 항상 같은 시퀀스를 생성한다. */
function makeNoise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff - 0.5;
  };
}

function variance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
}

describe("OneEuroFilter1D", () => {
  it("상수 입력에 수렴한 뒤 출력이 흔들리지 않는다(지터 0)", () => {
    const f = new OneEuroFilter1D({ minCutoff: 1.5, beta: 0.3, dCutoff: 1.0 });
    const outputs: number[] = [];
    for (let i = 0; i < 60; i++) {
      outputs.push(f.filter(0.42, i / 30));
    }
    // 첫 호출은 입력 스냅이므로 이후 전부 동일해야 한다.
    for (const out of outputs) expect(out).toBeCloseTo(0.42, 10);
  });

  it("사인+노이즈 입력에서 출력의 프레임간 지터 분산이 입력보다 작다", () => {
    const f = new OneEuroFilter1D({ minCutoff: 1.0, beta: 0.05, dCutoff: 1.0 });
    const noise = makeNoise(12345);
    const inputs: number[] = [];
    const outputs: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t = i / 30;
      const clean = Math.sin(2 * Math.PI * 0.25 * t) * 0.5;
      const noisy = clean + noise() * 0.06;
      inputs.push(noisy);
      outputs.push(f.filter(noisy, t));
    }
    // 프레임간 델타 분산 — 위상 지연(lag) 영향 없이 지터만 측정한다.
    const deltas = (arr: number[]) => arr.slice(1).map((v, i) => v - arr[i]);
    expect(variance(deltas(outputs))).toBeLessThan(variance(deltas(inputs)) * 0.5);
  });

  it("스텝 입력에서 beta가 큰 필터가 작은 필터보다 빠르게 추종한다", () => {
    const slow = new OneEuroFilter1D({ minCutoff: 1.0, beta: 0.05, dCutoff: 1.0 });
    const fast = new OneEuroFilter1D({ minCutoff: 1.0, beta: 2.0, dCutoff: 1.0 });
    // 0에서 시작해 1로 스텝.
    slow.filter(0, 0);
    fast.filter(0, 0);
    let slowOut = 0;
    let fastOut = 0;
    for (let i = 1; i <= 6; i++) {
      const t = i / 30;
      slowOut = slow.filter(1, t);
      fastOut = fast.filter(1, t);
    }
    expect(fastOut).toBeGreaterThan(slowOut);
    expect(fastOut).toBeGreaterThan(0.5);
  });

  it("dt가 0 이하(같은/역행 타임스탬프)이면 이전 출력을 유지하고 크래시하지 않는다", () => {
    const f = new OneEuroFilter1D({ minCutoff: 1.5, beta: 0.3, dCutoff: 1.0 });
    f.filter(0.2, 1.0);
    const atOne = f.filter(0.4, 1.5);
    expect(f.filter(999, 1.5)).toBeCloseTo(atOne, 10); // dt = 0
    expect(f.filter(999, 1.0)).toBeCloseTo(atOne, 10); // dt < 0
    // 이후 정상 타임스탬프에서는 다시 필터링이 진행된다.
    const next = f.filter(0.4, 2.0);
    expect(next).toBeGreaterThan(atOne);
  });

  it("30fps와 60fps 타임스탬프 시퀀스에서 같은 시각의 출력이 근사한다(초 단위 시간 사용)", () => {
    const f30 = new OneEuroFilter1D({ minCutoff: 1.0, beta: 0.1, dCutoff: 1.0 });
    const f60 = new OneEuroFilter1D({ minCutoff: 1.0, beta: 0.1, dCutoff: 1.0 });
    const signal = (t: number) => Math.sin(2 * Math.PI * 0.5 * t) * 0.4;
    let out30 = 0;
    let out60 = 0;
    for (let i = 0; i <= 60; i++) out30 = f30.filter(signal(i / 30), i / 30);
    for (let i = 0; i <= 120; i++) out60 = f60.filter(signal(i / 60), i / 60);
    // t=2.0s 시점 비교 — 프레임레이트가 달라도 시간 기반 컷오프라 결과가 유사해야 한다.
    expect(Math.abs(out30 - out60)).toBeLessThan(0.04);
  });

  it("reset 후 첫 호출은 다시 입력 스냅이다", () => {
    const f = new OneEuroFilter1D({ minCutoff: 1.0, beta: 0.1, dCutoff: 1.0 });
    f.filter(0.9, 0);
    f.filter(0.9, 1 / 30);
    f.reset();
    expect(f.filter(0.1, 2)).toBe(0.1);
  });
});

describe("TrackingChannelFilterBank", () => {
  it("smoothing=기본값(0.35)에서 상수 입력을 그대로 통과시킨다(프리셋 원값 동작)", () => {
    const bank = new TrackingChannelFilterBank();
    const channels: TrackingChannels = { ...baseChannels, headYaw: 0.3, blinkLeft: 0.5, gazeX: -0.4 };
    let out = channels;
    for (let i = 0; i < 30; i++) {
      out = bank.filter(channels, i / 30, SMOOTHING_BASELINE);
    }
    expect(out.headYaw).toBeCloseTo(0.3, 6);
    expect(out.blinkLeft).toBeCloseTo(0.5, 6);
    expect(out.gazeX).toBeCloseTo(-0.4, 6);
  });

  it("15채널이 서로 독립적으로 필터링된다", () => {
    const bank = new TrackingChannelFilterBank();
    bank.filter(baseChannels, 0, SMOOTHING_BASELINE);
    // headYaw 만 스텝 — 다른 채널은 0을 유지해야 한다.
    const stepped: TrackingChannels = { ...baseChannels, headYaw: 1 };
    const out = bank.filter(stepped, 1 / 30, SMOOTHING_BASELINE);
    expect(out.headYaw).toBeGreaterThan(0);
    expect(out.headYaw).toBeLessThan(1);
    expect(out.headPitch).toBe(0);
    expect(out.blinkLeft).toBe(0);
    expect(out.gazeX).toBe(0);
  });

  it("smoothing이 낮을수록 스텝 추종이 느리다(슬라이더 → minCutoff 스케일)", () => {
    const soft = new TrackingChannelFilterBank();
    const snappy = new TrackingChannelFilterBank();
    soft.filter(baseChannels, 0, 0.05);
    snappy.filter(baseChannels, 0, 1.0);
    const stepped: TrackingChannels = { ...baseChannels, headYaw: 1 };
    let softOut = baseChannels;
    let snappyOut = baseChannels;
    for (let i = 1; i <= 5; i++) {
      softOut = soft.filter(stepped, i / 30, 0.05);
      snappyOut = snappy.filter(stepped, i / 30, 1.0);
    }
    expect(snappyOut.headYaw).toBeGreaterThan(softOut.headYaw);
  });

  it("채널 그룹 프리셋이 head/shape/gaze 세 그룹을 정의한다", () => {
    expect(CHANNEL_FILTER_PRESETS.head.minCutoff).toBeGreaterThan(CHANNEL_FILTER_PRESETS.gaze.minCutoff);
    expect(Object.keys(CHANNEL_FILTER_PRESETS).sort()).toEqual(["gaze", "head", "shape"]);
  });
});
