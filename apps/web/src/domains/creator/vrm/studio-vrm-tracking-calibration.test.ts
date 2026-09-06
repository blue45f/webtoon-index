import { describe, expect, it } from "vitest";

import {
  applyCalibration,
  CALIBRATION_SAMPLE_FRAMES,
  CalibrationSampler,
  deserializeCalibration,
  serializeCalibration,
  type TrackingCalibration,
} from "./studio-vrm-tracking-calibration";

import type { TrackingChannels } from "./studio-vrm-webcam-tracking";

const neutralChannels: TrackingChannels = {
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

const sampleCalibration: TrackingCalibration = {
  headPitch: 0.1,
  headYaw: -0.2,
  headRoll: 0.05,
  gazeX: 0.1,
  gazeY: -0.1,
  blinkOpenL: 0.2,
  blinkOpenR: 0.15,
  mouthOpenBase: 0.1,
};

describe("CalibrationSampler", () => {
  it("지정 프레임 수의 평균을 계산하고 progress를 보고한다", () => {
    const sampler = new CalibrationSampler(4);
    expect(sampler.progress).toBe(0);
    expect(sampler.done).toBe(false);
    expect(sampler.build()).toBeNull(); // 샘플 부족

    const yaws = [0.1, 0.2, 0.3, 0.4];
    yaws.forEach((yaw, i) => {
      sampler.add({ ...neutralChannels, headYaw: yaw, blinkLeft: 0.2 });
      expect(sampler.progress).toBeCloseTo((i + 1) / 4);
    });

    expect(sampler.done).toBe(true);
    const cal = sampler.build();
    expect(cal).not.toBeNull();
    expect(cal!.headYaw).toBeCloseTo(0.25);
    expect(cal!.blinkOpenL).toBeCloseTo(0.2);
    expect(cal!.headPitch).toBe(0);
  });

  it("done 이후 add는 무시되고, 기본 프레임 수 상수를 사용한다", () => {
    const sampler = new CalibrationSampler();
    for (let i = 0; i < CALIBRATION_SAMPLE_FRAMES; i++) {
      sampler.add({ ...neutralChannels, headYaw: 0.2 });
    }
    expect(sampler.done).toBe(true);
    sampler.add({ ...neutralChannels, headYaw: 100 }); // 무시돼야 함
    expect(sampler.build()!.headYaw).toBeCloseTo(0.2);
  });
});

describe("applyCalibration", () => {
  it("head 채널에서 중립 오프셋을 감산한다", () => {
    const channels: TrackingChannels = { ...neutralChannels, headPitch: 0.3, headYaw: 0.1, headRoll: 0.15 };
    const out = applyCalibration(channels, sampleCalibration);
    expect(out.headPitch).toBeCloseTo(0.2);
    expect(out.headYaw).toBeCloseTo(0.3); // 0.1 - (-0.2)
    expect(out.headRoll).toBeCloseTo(0.1);
  });

  it("gaze는 감산 후 [-1,1]로 클램프한다", () => {
    const channels: TrackingChannels = { ...neutralChannels, gazeX: -0.95, gazeY: 0.95 };
    const out = applyCalibration(channels, { ...sampleCalibration, gazeX: 0.2, gazeY: -0.2 });
    expect(out.gazeX).toBe(-1);
    expect(out.gazeY).toBe(1);
  });

  it("blink를 개인 기준치(open)로 리맵한다: raw=open→0, raw=1→1", () => {
    const cal = { ...sampleCalibration, blinkOpenL: 0.2, blinkOpenR: 0.2 };
    const atOpen = applyCalibration({ ...neutralChannels, blinkLeft: 0.2, blinkRight: 0.2 }, cal);
    expect(atOpen.blinkLeft).toBe(0);
    expect(atOpen.blinkRight).toBe(0);

    const fullyClosed = applyCalibration({ ...neutralChannels, blinkLeft: 1, blinkRight: 1 }, cal);
    expect(fullyClosed.blinkLeft).toBe(1);
    expect(fullyClosed.blinkRight).toBe(1);

    const mid = applyCalibration({ ...neutralChannels, blinkLeft: 0.6 }, cal);
    expect(mid.blinkLeft).toBeCloseTo((0.6 - 0.2) / 0.8);
  });

  it("mouthOpen을 무표정 기준치로 리맵하고 나머지 채널은 통과시킨다", () => {
    const channels: TrackingChannels = { ...neutralChannels, mouthOpen: 0.55, mouthSmile: 0.4, eyeWide: 0.3 };
    const out = applyCalibration(channels, { ...sampleCalibration, mouthOpenBase: 0.1 });
    expect(out.mouthOpen).toBeCloseTo((0.55 - 0.1) / 0.9);
    expect(out.mouthSmile).toBe(0.4); // 통과
    expect(out.eyeWide).toBe(0.3); // 통과
  });

  it("기준치가 1에 가까워도 분모 하한(0.2)으로 폭주하지 않는다", () => {
    const out = applyCalibration(
      { ...neutralChannels, blinkLeft: 1 },
      { ...sampleCalibration, blinkOpenL: 0.95 },
    );
    expect(out.blinkLeft).toBeCloseTo((1 - 0.95) / 0.2);
  });

  it("cal=null이면 입력을 그대로 통과시킨다", () => {
    const channels: TrackingChannels = { ...neutralChannels, headYaw: 0.5, blinkLeft: 0.7 };
    expect(applyCalibration(channels, null)).toEqual(channels);
  });
});

describe("serialize/deserialize", () => {
  it("직렬화 라운드트립이 값을 보존한다", () => {
    const raw = serializeCalibration(sampleCalibration);
    expect(deserializeCalibration(raw)).toEqual(sampleCalibration);
  });

  it("손상 JSON·버전 불일치·필드 누락·null은 null을 반환한다", () => {
    expect(deserializeCalibration(null)).toBeNull();
    expect(deserializeCalibration("not-json{")).toBeNull();
    expect(deserializeCalibration(JSON.stringify({ v: 999, ...sampleCalibration }))).toBeNull();
    expect(deserializeCalibration(JSON.stringify({ v: 1, headPitch: 0.1 }))).toBeNull();
    expect(deserializeCalibration(JSON.stringify({ v: 1, ...sampleCalibration, headYaw: "oops" }))).toBeNull();
    expect(deserializeCalibration(JSON.stringify({ v: 1, ...sampleCalibration, headYaw: Infinity }))).toBeNull();
  });
});
