import { describe, expect, it } from "vitest";

import {
  hasUniformFrameDurations,
  planStudioVideoTimeline,
  resolveStudioVideoExportPlan,
  resolveTimingMode,
  type StudioVideoExportPlanRequest,
} from "./studio-webcodecs-plan";

import type { StudioVideoEncoderProbe } from "./studio-webcodecs-capability";

function probeFor(prefixes: readonly string[], hardware = true): StudioVideoEncoderProbe {
  return {
    isConfigSupported(config) {
      const matched = prefixes.some((prefix) => config.codec.startsWith(prefix));
      const wantsHardware = config.hardwareAcceleration === "prefer-hardware";
      return Promise.resolve({ supported: matched && (hardware || !wantsHardware) });
    },
  };
}

const BASE: StudioVideoExportPlanRequest = {
  width: 720,
  height: 1280,
  fps: 30,
  selectedPipeline: "webcodecs-webm",
  mediaRecorderSupported: true,
  pureEncoderSupported: true,
};

describe("시간 모델 판정", () => {
  it("노출 시간이 균일한지 ±1ms로 본다", () => {
    expect(hasUniformFrameDurations([])).toBe(true);
    expect(hasUniformFrameDurations([100])).toBe(true);
    expect(hasUniformFrameDurations([100, 100.5, 99.5])).toBe(true);
    expect(hasUniformFrameDurations([100, 40, 250])).toBe(false);
  });

  it("auto는 불균일할 때만 VFR을 고르고, 명시 모드는 그대로 따른다", () => {
    expect(resolveTimingMode({ ...BASE, durationsMs: [100, 40, 250] })).toBe("vfr");
    expect(resolveTimingMode({ ...BASE, durationsMs: [80, 80, 80] })).toBe("cfr");
    expect(resolveTimingMode({ ...BASE, durationsMs: [100, 40], mode: "cfr" })).toBe("cfr");
    expect(resolveTimingMode({ ...BASE, durationsMs: [80, 80], mode: "vfr" })).toBe("vfr");
    expect(resolveTimingMode({ ...BASE, frameCount: 10 })).toBe("cfr");
  });
});

describe("타임라인 해석", () => {
  it("불균일 셀 애니메이션은 VFR로 프레임 수를 아낀다", () => {
    const timeline = planStudioVideoTimeline({ ...BASE, durationsMs: [100, 40, 250], loopCount: 2 });
    expect(timeline.frames).toHaveLength(6);
    expect(timeline.durationUs).toBe(780_000);
  });

  it("균일 셀 애니메이션은 fps 그리드로 리샘플한다", () => {
    const timeline = planStudioVideoTimeline({ ...BASE, durationsMs: [100, 100], fps: 10 });
    expect(timeline.frames).toHaveLength(2);
    expect(timeline.frames.map((frame) => frame.sourceIndex)).toEqual([0, 1]);
  });

  it("노출 시간이 없으면 frameCount×loopCount CFR이다", () => {
    const timeline = planStudioVideoTimeline({ ...BASE, frameCount: 30, loopCount: 3, fps: 30 });
    expect(timeline.frames).toHaveLength(90);
    expect(timeline.durationUs).toBe(3_000_000);
  });
});

describe("실행 계획 확정", () => {
  it("WebCodecs가 되면 인코더 설정까지 채워진 실행 스펙을 돌려준다", async () => {
    const plan = await resolveStudioVideoExportPlan(
      { ...BASE, frameCount: 60 },
      probeFor(["vp09"])
    );
    expect(plan.decision.pipeline).toBe("webcodecs-webm");
    expect(plan.decision.available).toBe(true);
    expect(plan.webCodecs).not.toBeNull();
    expect(plan.webCodecs!.webmCodecId).toBe("V_VP9");
    expect(plan.webCodecs!.config.codec).toBe("vp09.00.31.08");
    expect(plan.webCodecs!.config.hardwareAcceleration).toBe("prefer-hardware");
    expect(plan.webCodecs!.timeline.frames).toHaveLength(60);
    expect(plan.estimatedFrameCount).toBe(60);
    expect(plan.estimatedDurationSec).toBe(2);
    expect(plan.timingMode).toBe("cfr");
  });

  it("탐지된 비트레이트가 인코더 설정에 그대로 반영된다", async () => {
    const plan = await resolveStudioVideoExportPlan(
      { ...BASE, frameCount: 10, bitrate: 3_000_000 },
      probeFor(["vp09"])
    );
    expect(plan.webCodecs!.config.bitrate).toBe(3_000_000);
  });

  it("소프트웨어 전용이면 그에 맞는 가속 힌트로 설정한다", async () => {
    const plan = await resolveStudioVideoExportPlan(
      { ...BASE, frameCount: 10 },
      probeFor(["vp8"], false)
    );
    expect(plan.webCodecs!.webmCodecId).toBe("V_VP8");
    expect(plan.webCodecs!.config.hardwareAcceleration).toBe("no-preference");
  });

  it("선택한 WebCodecs가 없으면 unavailable이며 실행 스펙을 비운다", async () => {
    const plan = await resolveStudioVideoExportPlan({ ...BASE, frameCount: 60 }, null);
    expect(plan.decision.pipeline).toBe("webcodecs-webm");
    expect(plan.decision.available).toBe(false);
    expect(plan.webCodecs).toBeNull();
    // unavailable 상태에서도 예상 길이·프레임 수는 UI가 그대로 쓸 수 있어야 한다.
    expect(plan.estimatedFrameCount).toBe(60);
    expect(plan.estimatedDurationSec).toBe(2);
  });

  it("킬스위치가 켜지면 탐지 자체를 건너뛰고 선택 WebCodecs를 unavailable 처리한다", async () => {
    let probed = false;
    const probe: StudioVideoEncoderProbe = {
      isConfigSupported() {
        probed = true;
        return Promise.resolve({ supported: true });
      },
    };
    const plan = await resolveStudioVideoExportPlan(
      { ...BASE, frameCount: 10, disableWebCodecs: true },
      probe
    );
    expect(probed).toBe(false);
    expect(plan.decision.pipeline).toBe("webcodecs-webm");
    expect(plan.decision.available).toBe(false);
  });

  it("GIF는 명시 선택한 경우에만 승인하고 없으면 같은 선택을 unavailable 처리한다", async () => {
    const gif = await resolveStudioVideoExportPlan(
      { ...BASE, frameCount: 10, selectedPipeline: "gif", mediaRecorderSupported: false },
      null
    );
    expect(gif.decision.pipeline).toBe("gif");
    expect(gif.decision.available).toBe(true);

    const none = await resolveStudioVideoExportPlan(
      {
        ...BASE,
        frameCount: 10,
        selectedPipeline: "gif",
        mediaRecorderSupported: false,
        pureEncoderSupported: false,
      },
      null
    );
    expect(none.decision.available).toBe(false);
  });

  it("프레임이 0장이면 WebCodecs 실행 스펙을 만들지 않는다(빈 파일 방지)", async () => {
    const plan = await resolveStudioVideoExportPlan(
      { ...BASE, frameCount: 0 },
      probeFor(["vp09"])
    );
    expect(plan.estimatedFrameCount).toBe(0);
    expect(plan.webCodecs).toBeNull();
  });
});
