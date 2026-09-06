import { describe, expect, it } from "vitest";

import { layoutScenarioPanels, scenarioPanelAspect, type ScenarioFrameRect } from "./studio-scenario-layout";

const CANVAS_W = 720;

describe("scenarioPanelAspect", () => {
  it("classifies clearly wide rects as landscape", () => {
    expect(scenarioPanelAspect(800, 400)).toBe("landscape");
  });
  it("classifies clearly tall rects as portrait", () => {
    expect(scenarioPanelAspect(400, 800)).toBe("portrait");
  });
  it("classifies near-1:1 rects as square", () => {
    expect(scenarioPanelAspect(700, 720)).toBe("square");
  });
  it("does not throw/NaN on a zero-height rect (defensive fallback to square)", () => {
    expect(scenarioPanelAspect(500, 0)).toBe("square");
  });
});

describe("layoutScenarioPanels", () => {
  it("returns an empty layout for an empty scenes list without shrinking canvasH", () => {
    const result = layoutScenarioPanels([], CANVAS_W, 1080, []);
    expect(result.panels).toEqual([]);
    expect(result.nextCanvasH).toBe(1080);
  });

  it("stacks one frame per scene starting at the top margin when there are no existing frames", () => {
    const result = layoutScenarioPanels([], CANVAS_W, 1080, [
      { imagePrompt: "배경1", dialogue: "" },
      { imagePrompt: "배경2", dialogue: "" },
    ]);
    expect(result.panels).toHaveLength(2);
    const [first, second] = result.panels;
    expect(first.frame.y).toBe(24); // MARGIN
    expect(first.frame.x).toBe(24);
    expect(first.frame.width).toBe(CANVAS_W - 24 * 2);
    // second frame starts below the first with a margin gap, no overlap
    expect(second.frame.y).toBeGreaterThanOrEqual(first.frame.y + first.frame.height + 24);
    expect(result.nextCanvasH).toBeGreaterThanOrEqual(second.frame.y + second.frame.height);
  });

  it("appends new panels below the bottommost existing frame (does not overlap existing content)", () => {
    const existing: ScenarioFrameRect[] = [{ x: 24, y: 24, width: 672, height: 400 }];
    const result = layoutScenarioPanels(existing, CANVAS_W, 1080, [{ imagePrompt: "새 장면", dialogue: "" }]);
    expect(result.panels[0].frame.y).toBeGreaterThanOrEqual(24 + 400 + 24);
  });

  it("picks the bottommost frame by (y + height), not just the last array entry", () => {
    const existing: ScenarioFrameRect[] = [
      { x: 24, y: 500, width: 672, height: 100 }, // bottom edge 600
      { x: 24, y: 24, width: 672, height: 900 }, // bottom edge 924 — taller, comes first in array
    ];
    const result = layoutScenarioPanels(existing, CANVAS_W, 2000, [{ imagePrompt: "새 장면", dialogue: "" }]);
    expect(result.panels[0].frame.y).toBeGreaterThanOrEqual(924 + 24);
  });

  it("grows the frame height to fit a longer dialogue stack, within the max cap", () => {
    const shortDialogueResult = layoutScenarioPanels([], CANVAS_W, 1080, [{ imagePrompt: "", dialogue: "민수: 안녕" }]);
    const longDialogue = Array.from({ length: 10 }, (_, i) => `대사${i}: 아주 길고 긴 대사를 여러 번 반복해서 적어봅니다`).join(
      "\n"
    );
    const longDialogueResult = layoutScenarioPanels([], CANVAS_W, 1080, [{ imagePrompt: "", dialogue: longDialogue }]);
    expect(longDialogueResult.panels[0].frame.height).toBeGreaterThan(shortDialogueResult.panels[0].frame.height);
    expect(longDialogueResult.panels[0].frame.height).toBeLessThanOrEqual(900); // MAX_FRAME_HEIGHT
  });

  it("uses the minimum frame height for a scene with no dialogue", () => {
    const result = layoutScenarioPanels([], CANVAS_W, 1080, [{ imagePrompt: "고요한 배경", dialogue: "" }]);
    expect(result.panels[0].frame.height).toBe(360); // MIN_FRAME_HEIGHT
    expect(result.panels[0].bubbles).toEqual([]);
  });

  it("positions bubbles inside the frame bounds (offset by frame.x/frame.y, not raw page origin)", () => {
    const existing: ScenarioFrameRect[] = [{ x: 24, y: 24, width: 672, height: 300 }];
    const result = layoutScenarioPanels(existing, CANVAS_W, 1080, [{ imagePrompt: "", dialogue: "민수: 안녕\n지영: 반가워" }]);
    const frame = result.panels[0].frame;
    for (const bubble of result.panels[0].bubbles) {
      expect(bubble.y).toBeGreaterThan(frame.y);
      expect(bubble.y + bubble.height).toBeLessThanOrEqual(frame.y + frame.height);
      expect(bubble.x).toBeGreaterThanOrEqual(frame.x);
      expect(bubble.x + bubble.width).toBeLessThanOrEqual(frame.x + frame.width + 1); // +1 rounding slack
    }
  });

  it("carries the imagePrompt through to each panel seed untouched", () => {
    const result = layoutScenarioPanels([], CANVAS_W, 1080, [
      {
        beatType: "turn",
        summary: "친구가 숨겨온 사실을 고백한다",
        imagePrompt: "학교 옥상, 노을",
        dialogue: "민수: 늦었네",
        continuity: { characterNames: ["민수"], location: "학교 옥상", time: "노을" },
      },
    ]);
    expect(result.panels[0].beatType).toBe("turn");
    expect(result.panels[0].summary).toBe("친구가 숨겨온 사실을 고백한다");
    expect(result.panels[0].imagePrompt).toBe("학교 옥상, 노을");
    expect(result.panels[0].dialogue).toBe("민수: 늦었네");
    expect(result.panels[0].continuity).toEqual({
      characterNames: ["민수"],
      location: "학교 옥상",
      time: "노을",
    });
  });

  it("normalizes legacy scenes without beat metadata", () => {
    const result = layoutScenarioPanels([], CANVAS_W, 1080, [
      { imagePrompt: "버스 정류장", dialogue: "민수: 기다렸어?" },
    ]);
    expect(result.panels[0].beatType).toBe("transition");
    expect(result.panels[0].summary).toBe("버스 정류장");
  });

  it("does not mutate the existingFrames input array", () => {
    const existing: ScenarioFrameRect[] = [{ x: 24, y: 24, width: 672, height: 300 }];
    const snapshot = JSON.parse(JSON.stringify(existing));
    layoutScenarioPanels(existing, CANVAS_W, 1080, [{ imagePrompt: "a", dialogue: "b" }]);
    expect(existing).toEqual(snapshot);
  });
});
