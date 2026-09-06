import { describe, expect, it } from "vitest";

import { WEBTOON_PLATFORM_SPECS } from "./webtoon-platform-spec-validator";
import {
  CANVAS_MAX_PANELS_PER_SCREEN,
  CANVAS_MIN_GUTTER_PX,
  CANVAS_SCENE_TRANSITION_PX,
  PACING_BAND_SOURCES,
  WebtoonScrollPacingSimulator,
  type PacingBeatType,
  type PanelVerticalSpan,
} from "./webtoon-scroll-pacing-simulator";

/** 정확히 `gutter` 만큼 떨어진 컷 두 개를 만든다. */
function pairWithGutter(gutter: number): PanelVerticalSpan[] {
  return [
    { id: "a", topY: 0, bottomY: 500, heightPx: 500 },
    { id: "b", topY: 500 + gutter, bottomY: 1000 + gutter, heightPx: 500 },
  ];
}

describe("WebtoonScrollPacingSimulator", () => {
  const simulator = new WebtoonScrollPacingSimulator();

  const classify = (gutter: number): PacingBeatType =>
    simulator.analyze(pairWithGutter(gutter), 4000).beats[0].beatType;

  it("handles empty panels gracefully", () => {
    const res = simulator.analyze([], 5000);
    expect(res.panelCount).toBe(0);
    expect(res.pacingHealthScore).toBe(100);
    expect(res.maxPanelsPerScreen).toBeUndefined();
  });

  describe("band edges are the WEBTOON CANVAS published numbers", () => {
    it("puts the action-rush ceiling exactly at the published 200px minimum gutter", () => {
      expect(CANVAS_MIN_GUTTER_PX).toBe(200);
      expect(classify(199)).toBe("action-rush");
      expect(classify(200)).toBe("dialogue-beat");
    });

    it("puts the scene-transition band exactly at the published 600~1000px range", () => {
      expect(CANVAS_SCENE_TRANSITION_PX).toEqual({ min: 600, max: 1000 });
      expect(classify(599)).toBe("dialogue-beat");
      expect(classify(600)).toBe("scene-transition");
      expect(classify(1000)).toBe("scene-transition");
      expect(classify(1001)).toBe("suspense-cliffhanger");
    });

    it("keeps the unsourced 1200px void threshold rather than inventing a new one", () => {
      expect(classify(1200)).toBe("suspense-cliffhanger");
      expect(classify(1201)).toBe("excessive-void");
      expect(PACING_BAND_SOURCES["excessive-void"].sourced).toBe(false);
      expect(PACING_BAND_SOURCES["suspense-cliffhanger"].sourced).toBe(false);
    });

    it("labels every band with whether its edge is sourced or a heuristic", () => {
      for (const [band, meta] of Object.entries(PACING_BAND_SOURCES)) {
        expect(typeof meta.sourced, band).toBe("boolean");
        expect(meta.basis.trim().length, band).toBeGreaterThan(0);
      }
      expect(PACING_BAND_SOURCES["scene-transition"].sourced).toBe(true);
      expect(PACING_BAND_SOURCES["action-rush"].sourced).toBe(true);
    });

    it("agrees with the gutter thresholds the platform spec validator enforces", () => {
      // 두 모듈이 같은 CANVAS 가이드를 인용하므로 숫자가 갈라지면 안 된다.
      const canvas = WEBTOON_PLATFORM_SPECS["webtoon-canvas"];
      expect(canvas.minGutterPx).toBe(CANVAS_MIN_GUTTER_PX);
      expect(canvas.maxGutterPx).toBe(CANVAS_SCENE_TRANSITION_PX.max);
    });

    it("tells the author that a sub-minimum gutter is under the published minimum", () => {
      const rush = simulator.analyze(pairWithGutter(120), 4000).beats[0];
      expect(rush.beatType).toBe("action-rush");
      expect(rush.guidance).toContain(`${CANVAS_MIN_GUTTER_PX}px`);
      // 종전 문구는 최소 간격 미만을 아무 단서 없이 "적합합니다" 라고만 말했다.
      expect(rush.guidance).not.toBe(
        "빠른 템포의 연속 컷 또는 충격적인 순간 연출에 적합합니다.",
      );
    });
  });

  it("classifies diverse gutter distances into appropriate narrative beats", () => {
    const panels: PanelVerticalSpan[] = [
      { id: "p1", topY: 100, bottomY: 600, heightPx: 500, dialogueCount: 1 },
      { id: "p2", topY: 720, bottomY: 1200, heightPx: 480, dialogueCount: 2 }, // gutter 120
      { id: "p3", topY: 1470, bottomY: 2000, heightPx: 530, dialogueCount: 1 }, // gutter 270
      { id: "p4", topY: 2700, bottomY: 3200, heightPx: 500, dialogueCount: 0 }, // gutter 700
      { id: "p5", topY: 4400, bottomY: 5100, heightPx: 700, dialogueCount: 1 }, // gutter 1200
    ];

    const res = simulator.analyze(panels, 5500);

    expect(res.panelCount).toBe(5);
    expect(res.beats.map((b) => b.beatType)).toEqual([
      "action-rush",
      "dialogue-beat",
      "scene-transition",
      "suspense-cliffhanger",
    ]);
    expect(res.warnings.length).toBe(0);
    expect(res.pacingHealthScore).toBeGreaterThanOrEqual(90);
  });

  it("flags excessive void gaps greater than 1200px", () => {
    const panels: PanelVerticalSpan[] = [
      { id: "p1", topY: 0, bottomY: 500, heightPx: 500 },
      { id: "p2", topY: 2000, bottomY: 2500, heightPx: 500 }, // gutter 1500px
    ];

    const res = simulator.analyze(panels, 3000);

    expect(res.beats[0].beatType).toBe("excessive-void");
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings[0]).toContain("너무 길어");
    expect(res.pacingHealthScore).toBeLessThan(90);
  });

  it("no longer penalises an average gutter that sits inside the published transition band", () => {
    // 종전 점수 계산은 평균 간격 600px 초과를 감점했는데, 600~1000px 는 공식 가이드가
    // 정상적인 장면 전환이라고 말하는 구간이다.
    const res = simulator.analyze(pairWithGutter(800), 4000);

    expect(res.averageGutterPx).toBe(800);
    expect(res.warnings.length).toBe(0);
    expect(res.pacingHealthScore).toBe(100);
  });

  it("penalises an average gutter below the published minimum", () => {
    const res = simulator.analyze(pairWithGutter(120), 4000);

    expect(res.averageGutterPx).toBeLessThan(CANVAS_MIN_GUTTER_PX);
    expect(res.pacingHealthScore).toBeLessThan(100);
  });

  describe("panels per screen", () => {
    const dense: PanelVerticalSpan[] = [
      { id: "p1", topY: 0, bottomY: 300, heightPx: 300 },
      { id: "p2", topY: 500, bottomY: 800, heightPx: 300 },
      { id: "p3", topY: 1000, bottomY: 1300, heightPx: 300 },
      { id: "p4", topY: 1500, bottomY: 1800, heightPx: 300 },
    ];

    it("does not check panel density unless the caller supplies a viewport height", () => {
      const res = simulator.analyze(dense, 2000);
      expect(res.maxPanelsPerScreen).toBeUndefined();
      expect(res.warnings.length).toBe(0);
    });

    it("warns when more than two panels share one screen", () => {
      const res = simulator.analyze(dense, 2000, { readerViewportHeightPx: 1400 });

      expect(res.maxPanelsPerScreen).toBeGreaterThan(CANVAS_MAX_PANELS_PER_SCREEN);
      expect(res.warnings.some((w) => w.includes("화면당"))).toBe(true);
      expect(res.pacingHealthScore).toBeLessThan(100);
    });

    it("stays silent when at most two panels share one screen", () => {
      const res = simulator.analyze(dense, 2000, { readerViewportHeightPx: 700 });

      expect(res.maxPanelsPerScreen).toBe(CANVAS_MAX_PANELS_PER_SCREEN);
      expect(res.warnings.some((w) => w.includes("화면당"))).toBe(false);
    });
  });

  it("calculates estimated reading times across casual, skimmer, and immersive profiles", () => {
    const panels: PanelVerticalSpan[] = [
      { id: "p1", topY: 100, bottomY: 600, heightPx: 500, dialogueCount: 2 },
      { id: "p2", topY: 850, bottomY: 1400, heightPx: 550, dialogueCount: 3 },
    ];

    const res = simulator.analyze(panels, 2000);

    expect(res.estimatedReadingSeconds.casual).toBeGreaterThan(res.estimatedReadingSeconds.skimmer);
    expect(res.estimatedReadingSeconds.immersive).toBeGreaterThan(res.estimatedReadingSeconds.casual);
  });
});
