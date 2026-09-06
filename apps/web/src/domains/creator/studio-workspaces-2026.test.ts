import { describe, expect, it } from "vitest";

import {
  advanceSimpleModeStep,
  DEFAULT_SIMPLE_MODE_STATE,
  SIMPLE_MODE_STEPS,
  WORK_CENTRIC_WORKSPACES,
} from "./studio-workspaces-2026";

describe("studio-workspaces-2026", () => {
  describe("Work-Centric Workspaces (7 Stages)", () => {
    it("contains all 7 core webtoon production workspaces", () => {
      const ids = WORK_CENTRIC_WORKSPACES.map((w) => w.id);
      expect(ids).toEqual([
        "story-draft",
        "sketch-ink",
        "coloring-paint",
        "bubble-lettering",
        "bg3d-pose",
        "animation-timeline",
        "review-export",
      ]);
      expect(WORK_CENTRIC_WORKSPACES).toHaveLength(7);
    });

    it("configures dock visibilities and inspector tabs appropriately per stage", () => {
      const sketch = WORK_CENTRIC_WORKSPACES.find((w) => w.id === "sketch-ink")!;
      expect(sketch.defaultDocks.leftPanelVisible).toBe(true);
      expect(sketch.defaultDocks.rightPanelVisible).toBe(false); // Maximizes drawing canvas

      const bg3d = WORK_CENTRIC_WORKSPACES.find((w) => w.id === "bg3d-pose")!;
      expect(bg3d.defaultDocks.primaryInspectorTab).toBe("3d");

      const anim = WORK_CENTRIC_WORKSPACES.find((w) => w.id === "animation-timeline")!;
      expect(anim.defaultDocks.bottomTimelineVisible).toBe(true);
    });
  });

  describe("Simple Mode Workflow", () => {
    it("defines 7 guided creation steps from canvas preset to export", () => {
      expect(SIMPLE_MODE_STEPS).toHaveLength(7);
      expect(SIMPLE_MODE_STEPS[0].step).toBe("canvas-preset");
      expect(SIMPLE_MODE_STEPS[6].step).toBe("export");
    });

    it("advances through steps sequentially", () => {
      let state = DEFAULT_SIMPLE_MODE_STATE;
      expect(state.currentStep).toBe("sketch");

      state = advanceSimpleModeStep(state);
      expect(state.currentStep).toBe("lineart");
      expect(state.completedSteps).toContain("sketch");

      state = advanceSimpleModeStep(state);
      expect(state.currentStep).toBe("coloring");
      expect(state.completedSteps).toEqual(["sketch", "lineart"]);
    });
  });
});
