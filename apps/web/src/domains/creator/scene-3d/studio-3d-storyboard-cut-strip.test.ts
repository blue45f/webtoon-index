import { describe, it, expect } from "vitest";

import { Studio3DStoryboardCutStrip } from "./studio-3d-storyboard-cut-strip";

describe("Studio3DStoryboardCutStrip", () => {
  it("initializes with empty cuts and default document width 800px", () => {
    const strip = new Studio3DStoryboardCutStrip();
    expect(strip.getCuts().length).toBe(0);
    expect(strip.getDocumentWidth()).toBe(800);
  });

  it("calculates cut pixel dimensions and cumulative vertical strip height", () => {
    const strip = new Studio3DStoryboardCutStrip();
    strip.addCut({
      id: "cut-1",
      cutNumber: 1,
      title: "인트로 롱샷",
      aspectRatio: "21:9-wide-action",
      cameraPosition: [0, 2, 5],
      cameraTarget: [0, 1, 0],
      cameraFovDeg: 45,
      cameraRollDeg: 0,
      characterIds: ["char-1"],
    });

    strip.addCut({
      id: "cut-2",
      cutNumber: 2,
      title: "클로즈업",
      aspectRatio: "1:1-square-medium",
      cameraPosition: [0, 1.6, 1.5],
      cameraTarget: [0, 1.6, 0],
      cameraFovDeg: 35,
      cameraRollDeg: -5,
      characterIds: ["char-1"],
    });

    // 21:9 cut (800 * 9 / 21 = 343px) + 1:1 cut (800px) + intercut gap (80px) = 1223px
    const totalHeight = strip.evaluateTotalStripHeight(80);
    expect(totalHeight).toBe(343 + 800 + 80);
  });

  it("reindexes cut numbers properly when cuts are added, moved, or removed", () => {
    const strip = new Studio3DStoryboardCutStrip();
    strip.addCut({
      id: "cut-a",
      cutNumber: 1,
      title: "A",
      aspectRatio: "1:1-square-medium",
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, -1],
      cameraFovDeg: 45,
      cameraRollDeg: 0,
      characterIds: [],
    });
    strip.addCut({
      id: "cut-b",
      cutNumber: 2,
      title: "B",
      aspectRatio: "1:1-square-medium",
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, -1],
      cameraFovDeg: 45,
      cameraRollDeg: 0,
      characterIds: [],
    });

    strip.moveCut(1, 0); // Move B to top
    expect(strip.getCuts()[0].id).toBe("cut-b");
    expect(strip.getCuts()[0].cutNumber).toBe(1);
    expect(strip.getCuts()[1].id).toBe("cut-a");
    expect(strip.getCuts()[1].cutNumber).toBe(2);
  });

  it("generates multi-pass PSD layer manifest with standard layer channels", () => {
    const strip = new Studio3DStoryboardCutStrip();
    strip.addCut({
      id: "cut-1",
      cutNumber: 1,
      title: "액션 씬",
      aspectRatio: "16:9-cinematic",
      cameraPosition: [0, 0, 0],
      cameraTarget: [0, 0, -1],
      cameraFovDeg: 50,
      cameraRollDeg: 0,
      characterIds: [],
    });

    const manifest = strip.generatePsdExportManifest();
    expect(manifest.documentWidth).toBe(800);
    expect(manifest.channels.length).toBe(8);
    expect(manifest.channels[3].name).toContain("Ink Line Art");
    expect(manifest.channels[3].blendMode).toBe("multiply");
  });
});
