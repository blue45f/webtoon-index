import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXPORT_FPS,
  MAX_EXPORT_FPS,
  frameTimestampUs,
  keyFrameIntervalFrames,
  normalizeExportFps,
  planConstantRateTimeline,
  planResampledTimeline,
  planVariableRateTimeline,
  sourceFrameIndexAt,
  timelineDurationSec,
  totalDurationMs,
} from "./studio-webcodecs-timeline";

describe("fps 정규화·키프레임 간격", () => {
  it("잘못된 fps는 기본값으로, 범위 밖은 클램프한다", () => {
    expect(normalizeExportFps(undefined)).toBe(DEFAULT_EXPORT_FPS);
    expect(normalizeExportFps(Number.NaN)).toBe(DEFAULT_EXPORT_FPS);
    expect(normalizeExportFps(0)).toBe(1);
    expect(normalizeExportFps(23.6)).toBe(24);
    expect(normalizeExportFps(500)).toBe(MAX_EXPORT_FPS);
  });

  it("키프레임 간격은 fps×초(최소 1프레임)다", () => {
    expect(keyFrameIntervalFrames(30, 2)).toBe(60);
    expect(keyFrameIntervalFrames(12, 2)).toBe(24);
    expect(keyFrameIntervalFrames(30, 0)).toBe(1);
    expect(keyFrameIntervalFrames(30, 0.01)).toBe(1);
  });

  it("프레임 순번 → µs 시각 반올림 규칙이 한 곳에 고정돼 있다", () => {
    expect(frameTimestampUs(0, 30)).toBe(0);
    expect(frameTimestampUs(1, 30)).toBe(33_333);
    expect(frameTimestampUs(2, 30)).toBe(66_667);
    expect(frameTimestampUs(30, 30)).toBe(1_000_000);
    expect(frameTimestampUs(1, 24)).toBe(41_667);
  });
});

describe("CFR 타임라인", () => {
  it("프레임 시각이 단조 증가하고 길이 합이 총 길이와 같다", () => {
    const timeline = planConstantRateTimeline({ frameCount: 90, fps: 30, keyFrameIntervalSec: 2 });
    expect(timeline.frames).toHaveLength(90);
    expect(timeline.durationUs).toBe(3_000_000);
    expect(timelineDurationSec(timeline)).toBe(3);
    let previous = -1;
    let sum = 0;
    for (const frame of timeline.frames) {
      expect(frame.timestampUs).toBeGreaterThan(previous);
      previous = frame.timestampUs;
      sum += frame.durationUs;
    }
    // 프레임 길이는 다음 프레임 시각과의 차 — 합치면 정확히 총 길이가 된다(반올림 누적 오차 0).
    expect(sum).toBe(timeline.durationUs);
  });

  it("키프레임은 0번부터 간격마다 정확히 한 번씩 찍힌다", () => {
    const timeline = planConstantRateTimeline({ frameCount: 121, fps: 30, keyFrameIntervalSec: 2 });
    const keys = timeline.frames.filter((frame) => frame.keyFrame).map((frame) => frame.index);
    expect(keys).toEqual([0, 60, 120]);
    expect(timeline.keyFrameIntervalFrames).toBe(60);
  });

  it("소스 인덱스는 출력 인덱스와 1:1이고 기본 프레임 길이(ns)를 함께 알려준다", () => {
    const timeline = planConstantRateTimeline({ frameCount: 3, fps: 25 });
    expect(timeline.frames.map((frame) => frame.sourceIndex)).toEqual([0, 1, 2]);
    expect(timeline.defaultFrameDurationNs).toBe(40_000_000);
  });

  it("프레임이 0장이면 빈 타임라인(길이 0)을 돌려준다", () => {
    const timeline = planConstantRateTimeline({ frameCount: 0, fps: 30 });
    expect(timeline.frames).toEqual([]);
    expect(timeline.durationUs).toBe(0);
  });
});

describe("VFR 타임라인", () => {
  it("프레임별 노출 시간을 그대로 보존한다", () => {
    const timeline = planVariableRateTimeline({ durationsMs: [100, 40, 250] });
    expect(timeline.frames.map((frame) => frame.timestampUs)).toEqual([0, 100_000, 140_000]);
    expect(timeline.frames.map((frame) => frame.durationUs)).toEqual([100_000, 40_000, 250_000]);
    expect(timeline.durationUs).toBe(390_000);
  });

  it("루프 반복은 프레임을 이어 붙이고 소스 인덱스를 되감는다", () => {
    const timeline = planVariableRateTimeline({ durationsMs: [50, 50], loopCount: 3 });
    expect(timeline.frames).toHaveLength(6);
    expect(timeline.frames.map((frame) => frame.sourceIndex)).toEqual([0, 1, 0, 1, 0, 1]);
    expect(timeline.frames.map((frame) => frame.timestampUs)).toEqual([
      0, 50_000, 100_000, 150_000, 200_000, 250_000,
    ]);
    expect(timeline.durationUs).toBe(300_000);
  });

  it("0·음수·비유한 노출 시간은 최소 1ms로 승격돼 시간축이 무너지지 않는다", () => {
    const timeline = planVariableRateTimeline({ durationsMs: [0, -5, Number.NaN] });
    expect(timeline.frames.map((frame) => frame.durationUs)).toEqual([1000, 1000, 1000]);
    expect(timeline.frames.map((frame) => frame.timestampUs)).toEqual([0, 1000, 2000]);
  });

  it("VFR은 CFR 리샘플보다 프레임 수가 훨씬 적다(같은 셀 애니메이션 기준)", () => {
    const durationsMs = [100, 100, 100, 100];
    const vfr = planVariableRateTimeline({ durationsMs });
    const cfr = planResampledTimeline({ durationsMs, fps: 30 });
    expect(vfr.frames).toHaveLength(4);
    expect(cfr.frames).toHaveLength(12);
    expect(vfr.durationUs).toBe(400_000);
  });
});

describe("소스 프레임 검색", () => {
  it("누적 노출 시간 구간에 맞는 프레임을 고른다(경계는 다음 프레임)", () => {
    const durations = [100, 40, 250];
    expect(sourceFrameIndexAt(durations, 0)).toBe(0);
    expect(sourceFrameIndexAt(durations, 99.9)).toBe(0);
    expect(sourceFrameIndexAt(durations, 100)).toBe(1);
    expect(sourceFrameIndexAt(durations, 139)).toBe(1);
    expect(sourceFrameIndexAt(durations, 140)).toBe(2);
    expect(sourceFrameIndexAt(durations, 10_000)).toBe(2);
  });

  it("빈 배열·전부 0인 배열도 안전하게 0을 돌려준다", () => {
    expect(sourceFrameIndexAt([], 10)).toBe(0);
    expect(sourceFrameIndexAt([0, 0], 10)).toBe(0);
    expect(totalDurationMs([10, Number.NaN, -3, 5])).toBe(15);
  });
});

describe("CFR 리샘플 타임라인", () => {
  it("총 길이×fps 만큼의 프레임을 만들고 각 프레임의 소스를 결정적으로 고른다", () => {
    const timeline = planResampledTimeline({ durationsMs: [100, 100], fps: 10 });
    expect(timeline.frames).toHaveLength(2);
    expect(timeline.frames.map((frame) => frame.sourceIndex)).toEqual([0, 1]);
    expect(timeline.frames.map((frame) => frame.timestampUs)).toEqual([0, 100_000]);
  });

  it("루프를 돌면 소스 인덱스가 주기적으로 반복된다", () => {
    const timeline = planResampledTimeline({ durationsMs: [100, 100], fps: 10, loopCount: 2 });
    expect(timeline.frames.map((frame) => frame.sourceIndex)).toEqual([0, 1, 0, 1]);
    expect(timeline.durationUs).toBe(400_000);
  });

  it("fps 그리드가 노출 시간과 안 맞아떨어져도 프레임 수가 반올림으로 확정된다", () => {
    const timeline = planResampledTimeline({ durationsMs: [83, 83, 84], fps: 30 });
    // 총 250ms × 30fps = 7.5 → 8프레임. 그리드 시각은 0/33.3/66.7/100/133.3/166.7/200/233.3ms이고
    // 셀 경계는 83·166ms라 소스 인덱스는 0,0,0,1,1,2,2,2 가 된다.
    expect(timeline.frames).toHaveLength(8);
    expect(timeline.frames.map((frame) => frame.sourceIndex)).toEqual([0, 0, 0, 1, 1, 2, 2, 2]);
  });

  it("노출 시간이 전부 0이면 프레임을 만들지 않는다", () => {
    expect(planResampledTimeline({ durationsMs: [0, 0], fps: 30 }).frames).toEqual([]);
  });
});

describe("결정성", () => {
  it("같은 요청은 항상 같은 타임라인을 만든다", () => {
    const request = { durationsMs: [120, 60, 90], fps: 24, loopCount: 2 };
    expect(planResampledTimeline(request)).toEqual(planResampledTimeline(request));
    expect(planConstantRateTimeline({ frameCount: 40, fps: 24 })).toEqual(
      planConstantRateTimeline({ frameCount: 40, fps: 24 })
    );
  });

  it("소스(주석 제외)에 벽시계·난수 호출이 없다 — 인코딩 속도가 결과를 바꾸지 못한다", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "studio-webcodecs-timeline.ts"), "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/Date\.now|performance\.now|Math\.random|requestAnimationFrame/);
  });
});
