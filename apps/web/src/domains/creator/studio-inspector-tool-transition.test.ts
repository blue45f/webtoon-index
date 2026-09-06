import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_INSPECTOR_TRANSIENT_STATE_TABLE,
  executeStudioInspectorArmedChange,
  executeStudioInspectorArmedToggle,
  executeStudioInspectorDrawModeTransition,
  executeStudioInspectorRouteTransition,
  executeStudioPrimaryCanvasToolTransition,
  planStudioInspectorPanelVisibilityTransition,
  planStudioInspectorRouteTransition,
  studioInspectorTransientOwners,
  type StudioInspectorTransientState,
} from "./studio-inspector-tool-transition";

import type { DrawMode } from "./studio-editor-tool-model";
import type { StudioInspectorLayout } from "./studio-inspector-layout";

const FILL_LAYOUT: StudioInspectorLayout = {
  primary: "properties",
  image: "fill",
  document: "canvas",
};
const RETOUCH_LAYOUT: StudioInspectorLayout = {
  ...FILL_LAYOUT,
  image: "retouch",
};
const MASK_LAYOUT: StudioInspectorLayout = {
  ...FILL_LAYOUT,
  image: "mask",
};
const TRANSFORM_LAYOUT: StudioInspectorLayout = {
  ...FILL_LAYOUT,
  image: "transform",
};
const LAYERS_LAYOUT: StudioInspectorLayout = {
  ...FILL_LAYOUT,
  primary: "layers",
};

function transient(
  patch: Partial<StudioInspectorTransientState> = {},
): StudioInspectorTransientState {
  return {
    advancedFillActive: false,
    advancedFillBusy: false,
    advancedFillPreviewActive: false,
    autoColorScribbleArmed: false,
    pixelToolActive: false,
    polyLassoSessionActive: false,
    colorRangePickActive: false,
    quickMaskActive: false,
    smudgeActive: false,
    dodgeBurnActive: false,
    wetMixActive: false,
    liquifyActive: false,
    healCloneActive: false,
    historyBrushActive: false,
    layerMaskPaintActive: false,
    filterMaskPaintActive: false,
    cropActive: false,
    puppetWarpActive: false,
    eyedropperActive: false,
    quickShapeActive: false,
    nodeEditActive: false,
    bubbleAnchorPickActive: false,
    bubbleShapeEditActive: false,
    panelSplitActive: false,
    ...patch,
  };
}

describe("studio inspector transient state ownership", () => {
  it("covers every armed, preview and in-progress canvas state in one transition table", () => {
    expect(STUDIO_INSPECTOR_TRANSIENT_STATE_TABLE).toEqual([
      ["advancedFillActive", "fill"],
      ["advancedFillBusy", "fill"],
      ["advancedFillPreviewActive", "fill"],
      ["autoColorScribbleArmed", "fill"],
      ["pixelToolActive", "retouch"],
      ["polyLassoSessionActive", "retouch"],
      ["colorRangePickActive", "retouch"],
      ["quickMaskActive", "retouch"],
      ["smudgeActive", "retouch"],
      ["dodgeBurnActive", "retouch"],
      ["wetMixActive", "retouch"],
      ["liquifyActive", "retouch"],
      ["healCloneActive", "retouch"],
      ["historyBrushActive", "retouch"],
      ["layerMaskPaintActive", "mask"],
      ["filterMaskPaintActive", "mask"],
      ["cropActive", "transform"],
      ["puppetWarpActive", "transform"],
      ["eyedropperActive", "draw"],
      ["quickShapeActive", "draw"],
      ["nodeEditActive", "properties"],
      ["bubbleAnchorPickActive", "properties"],
      ["bubbleShapeEditActive", "properties"],
      ["panelSplitActive", "properties"],
    ]);
  });

  it.each([
    ["advanced fill armed", { advancedFillActive: true }, ["fill"]],
    ["advanced fill preview", { advancedFillPreviewActive: true }, ["fill"]],
    ["selection tool", { pixelToolActive: true }, ["retouch"]],
    ["poly lasso session", { polyLassoSessionActive: true }, ["retouch"]],
    ["quick mask session", { quickMaskActive: true }, ["retouch"]],
    ["filter mask brush", { filterMaskPaintActive: true }, ["mask"]],
    ["crop session", { cropActive: true }, ["transform"]],
    ["eyedropper", { eyedropperActive: true }, ["draw"]],
    ["quick shape", { quickShapeActive: true }, ["draw"]],
    ["node editor", { nodeEditActive: true }, ["properties"]],
  ] as const)("maps %s to its visible inspector owner", (_label, patch, owners) => {
    expect(studioInspectorTransientOwners(transient(patch))).toEqual(owners);
  });

  it("deduplicates several armed states owned by the same route", () => {
    expect(
      studioInspectorTransientOwners(
        transient({
          pixelToolActive: true,
          smudgeActive: true,
          liquifyActive: true,
        }),
      ),
    ).toEqual(["retouch"]);
  });
});

describe("studio inspector route transitions", () => {
  it.each([
    [
      "fill",
      FILL_LAYOUT,
      RETOUCH_LAYOUT,
      { advancedFillActive: true },
    ],
    [
      "fill preview",
      FILL_LAYOUT,
      LAYERS_LAYOUT,
      { advancedFillPreviewActive: true },
    ],
    [
      "selection",
      RETOUCH_LAYOUT,
      MASK_LAYOUT,
      { pixelToolActive: true },
    ],
    [
      "liquify",
      RETOUCH_LAYOUT,
      FILL_LAYOUT,
      { liquifyActive: true },
    ],
    [
      "mask",
      MASK_LAYOUT,
      TRANSFORM_LAYOUT,
      { layerMaskPaintActive: true },
    ],
    [
      "transform",
      TRANSFORM_LAYOUT,
      LAYERS_LAYOUT,
      { puppetWarpActive: true },
    ],
  ] as const)(
    "disarms a hidden %s session before navigating",
    (_label, current, next, patch) => {
      const events: string[] = [];
      const result = executeStudioInspectorRouteTransition(
        {
          current,
          next,
          transient: transient(patch),
          drawing: false,
        },
        {
          disarm: () => events.push("disarm"),
          navigate: () => events.push("navigate"),
        },
      );

      expect(result.kind).toBe("navigate-and-disarm");
      expect(events).toEqual(["disarm", "navigate"]);
    },
  );

  it.each([
    ["fill", FILL_LAYOUT, { advancedFillBusy: true }],
    ["retouch", RETOUCH_LAYOUT, { colorRangePickActive: true }],
    ["mask", MASK_LAYOUT, { filterMaskPaintActive: true }],
    ["transform", TRANSFORM_LAYOUT, { cropActive: true }],
  ] as const)(
    "keeps an active %s session while its owning panel remains visible",
    (_label, current, patch) => {
      const next = { ...current };
      expect(
        planStudioInspectorRouteTransition({
          current,
          next,
          transient: transient(patch),
          drawing: false,
        }),
      ).toEqual(
        expect.objectContaining({
          kind: "unchanged",
          shouldDisarm: false,
          shouldNavigate: false,
        }),
      );
    },
  );

  it("navigates normally when no transient canvas input owns the pointer", () => {
    expect(
      planStudioInspectorRouteTransition({
        current: FILL_LAYOUT,
        next: LAYERS_LAYOUT,
        transient: transient(),
        drawing: false,
      }),
    ).toEqual(
      expect.objectContaining({
        kind: "navigate",
        shouldDisarm: false,
        shouldNavigate: true,
      }),
    );
  });

  it("fails closed if corrupted state leaves sessions from two panels armed", () => {
    const plan = planStudioInspectorRouteTransition({
      current: RETOUCH_LAYOUT,
      next: RETOUCH_LAYOUT,
      transient: transient({
        pixelToolActive: true,
        filterMaskPaintActive: true,
      }),
      drawing: false,
    });

    expect(plan.kind).toBe("disarm");
    expect(plan.shouldDisarm).toBe(true);
    expect(plan.shouldNavigate).toBe(false);
    expect(plan.unsupportedOwners).toEqual(["mask"]);
  });

  it("preserves draw-owned tools only in the visible drawing properties route", () => {
    const drawState = transient({ eyedropperActive: true });
    expect(
      planStudioInspectorRouteTransition({
        current: FILL_LAYOUT,
        next: { ...FILL_LAYOUT },
        transient: drawState,
        drawing: true,
      }).shouldDisarm,
    ).toBe(false);
    expect(
      planStudioInspectorRouteTransition({
        current: FILL_LAYOUT,
        next: LAYERS_LAYOUT,
        transient: drawState,
        drawing: true,
      }).shouldDisarm,
    ).toBe(true);
  });
});

describe("studio inspector draw-mode and visibility transitions", () => {
  it("disarms competing pointer owners before an explicit armed state turns on", () => {
    const events: string[] = [];

    executeStudioInspectorArmedChange(true, {
      disarm: () => events.push("disarm"),
      setActive: (next) => events.push(`active:${next}`),
    });

    expect(events).toEqual(["disarm", "active:true"]);
  });

  it("allows an explicit armed state to turn off without a second global disarm", () => {
    const events: string[] = [];

    executeStudioInspectorArmedChange(false, {
      disarm: () => events.push("disarm"),
      setActive: (next) => events.push(`active:${next}`),
    });

    expect(events).toEqual(["active:false"]);
  });

  it("arms outside the React updater and disarms competing sessions first", () => {
    const events: string[] = [];

    expect(
      executeStudioInspectorArmedToggle(false, {
        disarm: () => events.push("disarm"),
        setActive: (next) => events.push(`active:${next}`),
      }),
    ).toEqual({ kind: "arm", next: true });
    expect(events).toEqual(["disarm", "active:true"]);
  });

  it("turns the same armed button off without invoking global disarm again", () => {
    const events: string[] = [];

    expect(
      executeStudioInspectorArmedToggle(true, {
        disarm: () => events.push("disarm"),
        setActive: (next) => events.push(`active:${next}`),
      }),
    ).toEqual({ kind: "disarm", next: false });
    expect(events).toEqual(["active:false"]);
  });

  it.each([
    ["pen", "pixel"],
    ["pixel", "eraser"],
    ["eraser", "shape"],
    ["shape", "pen"],
  ] as const)("disarms before changing %s to %s", (current, next) => {
    const events: string[] = [];
    const result = executeStudioInspectorDrawModeTransition(current, next, {
      disarm: () => events.push("disarm"),
      setDrawMode: (mode) => events.push(`mode:${mode}`),
    });

    expect(result).toEqual({ kind: "change-and-disarm", next });
    expect(events).toEqual(["disarm", `mode:${next}`]);
  });

  it("cancels an active stroke before changing the primary canvas owner", () => {
    const events: string[] = [];

    expect(
      executeStudioPrimaryCanvasToolTransition(
        {
          current: { tool: "draw", drawMode: "pen" },
          next: { tool: "draw", drawMode: "eraser" },
          activeStroke: true,
        },
        {
          cancelActiveStroke: () => events.push("cancel-stroke"),
          disarm: () => events.push("disarm"),
          setTool: (tool) => events.push(`tool:${tool}`),
          setDrawMode: (mode) => events.push(`mode:${mode}`),
        },
      ),
    ).toEqual({
      changed: true,
      cancelledActiveStroke: true,
      next: { tool: "draw", drawMode: "eraser" },
    });
    expect(events).toEqual(["cancel-stroke", "disarm", "mode:eraser"]);
  });

  it("keeps the current draw mode while a repeated selection still clears competing owners", () => {
    const events: string[] = [];

    expect(
      executeStudioPrimaryCanvasToolTransition(
        {
          current: { tool: "select" },
          next: { tool: "select" },
          activeStroke: false,
        },
        {
          cancelActiveStroke: () => events.push("cancel-stroke"),
          disarm: () => events.push("disarm"),
          setTool: (tool) => events.push(`tool:${tool}`),
          setDrawMode: (mode) => events.push(`mode:${mode}`),
        },
      ),
    ).toEqual({
      changed: false,
      cancelledActiveStroke: false,
      next: { tool: "select" },
    });
    expect(events).toEqual(["disarm"]);
  });

  it("returns from the hand tool to selection without changing the remembered draw mode", () => {
    const events: string[] = [];

    expect(
      executeStudioPrimaryCanvasToolTransition(
        {
          current: { tool: "hand" },
          next: { tool: "select" },
          activeStroke: false,
        },
        {
          cancelActiveStroke: () => events.push("cancel-stroke"),
          disarm: () => events.push("disarm"),
          setTool: (tool) => events.push(`tool:${tool}`),
          setDrawMode: (mode) => events.push(`mode:${mode}`),
        },
      ),
    ).toEqual({
      changed: true,
      cancelledActiveStroke: false,
      next: { tool: "select" },
    });
    expect(events).toEqual(["disarm", "tool:select"]);
  });

  it.each(["pen", "pixel", "eraser", "shape"] as const)(
    "treats a second %s click as a stable no-op",
    (mode: DrawMode) => {
      const disarm = vi.fn();
      const setDrawMode = vi.fn();

      expect(
        executeStudioInspectorDrawModeTransition(mode, mode, {
          disarm,
          setDrawMode,
        }),
      ).toEqual({ kind: "unchanged", next: mode });
      expect(disarm).not.toHaveBeenCalled();
      expect(setDrawMode).not.toHaveBeenCalled();
    },
  );

  it("preserves route, settings and armed session through collapse and reopen", () => {
    const state = transient({ smudgeActive: true });
    const closed = planStudioInspectorPanelVisibilityTransition({
      open: true,
      nextOpen: false,
      layout: RETOUCH_LAYOUT,
      transient: state,
    });
    const reopened = planStudioInspectorPanelVisibilityTransition({
      open: false,
      nextOpen: true,
      layout: closed.layout,
      transient: closed.transient,
    });

    expect(closed.shouldDisarm).toBe(false);
    expect(reopened.shouldDisarm).toBe(false);
    expect(reopened.layout).toBe(RETOUCH_LAYOUT);
    expect(reopened.transient).toBe(state);
  });
});
