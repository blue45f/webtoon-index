import { describe, expect, it } from "vitest";

import {
  auditStudioCanvasPointerFlags,
  planStudioCanvasToolTransition,
  studioCanvasPointerOwner,
  studioCanvasToolStateViolations,
} from "./studio-canvas-tool-state-machine";

import type {
  StudioCanvasAuxiliaryPointerOwner,
  StudioCanvasToolMachineState,
} from "./studio-canvas-tool-state-machine";

function state(
  overrides: Partial<StudioCanvasToolMachineState> = {},
): StudioCanvasToolMachineState {
  return {
    tool: "select",
    drawMode: "pen",
    auxiliary: null,
    unfinished: [],
    ...overrides,
  };
}

describe("Studio canvas pointer flag audit", () => {
  it("exposes one primary pixel-pencil owner when no auxiliary is armed", () => {
    expect(
      auditStudioCanvasPointerFlags({
        tool: "draw",
        drawMode: "pixel",
        advancedFillActive: false,
        eyedropperActive: false,
        filterMaskPaintActive: false,
        pixelSelectionTool: null,
      }),
    ).toEqual({
      valid: true,
      owners: [{ kind: "draw", drawMode: "pixel" }],
      violations: [],
    });
  });

  it("does not silently resolve independently armed fill and eyedropper flags by branch priority", () => {
    const audit = auditStudioCanvasPointerFlags({
      tool: "select",
      drawMode: "pen",
      advancedFillActive: true,
      eyedropperActive: true,
      filterMaskPaintActive: false,
      pixelSelectionTool: null,
    });

    expect(audit.valid).toBe(false);
    expect(audit.owners).toEqual([
      { kind: "advanced-fill" },
      { kind: "eyedropper" },
    ]);
    expect(audit.violations).toEqual([
      {
        code: "multiple-auxiliary-owners",
        owners: [{ kind: "advanced-fill" }, { kind: "eyedropper" }],
      },
    ]);
  });

  it("reports selection-owned filter-mask and lasso flags that remain armed under Draw", () => {
    const audit = auditStudioCanvasPointerFlags({
      tool: "draw",
      drawMode: "pen",
      advancedFillActive: false,
      eyedropperActive: false,
      filterMaskPaintActive: true,
      pixelSelectionTool: "lasso",
    });

    expect(audit.valid).toBe(false);
    expect(audit.violations).toEqual([
      {
        code: "multiple-auxiliary-owners",
        owners: [
          { kind: "filter-mask" },
          { kind: "pixel-selection", tool: "lasso" },
        ],
      },
      {
        code: "auxiliary-requires-selection",
        owner: "filter-mask",
        tool: "draw",
      },
      {
        code: "auxiliary-requires-selection",
        owner: "pixel-selection",
        tool: "draw",
      },
    ]);
  });
});

describe("Studio canvas tool state machine", () => {
  it("moves filter-mask painting to lasso selection through one cancellation boundary", () => {
    const plan = planStudioCanvasToolTransition(
      state({
        auxiliary: { kind: "filter-mask" },
        unfinished: ["filter-mask-stroke"],
      }),
      {
        type: "auxiliary.arm",
        owner: { kind: "pixel-selection", tool: "lasso" },
      },
    );

    expect(plan.cancelledUnfinished).toEqual(["filter-mask-stroke"]);
    expect(plan.commands).toEqual([
      { type: "session.cancel", session: "filter-mask-stroke" },
      { type: "auxiliary.disarm-all" },
      {
        type: "auxiliary.arm",
        owner: { kind: "pixel-selection", tool: "lasso" },
      },
    ]);
    expect(plan.selectionDisarmedDrawingAuxiliary).toBe(true);
    expect(plan.next).toEqual(
      state({
        auxiliary: { kind: "pixel-selection", tool: "lasso" },
      }),
    );
    expect(studioCanvasToolStateViolations(plan.next)).toEqual([]);
  });

  it("cancels every unfinished pixel-selection session before Pixel Pencil takes the pointer", () => {
    const plan = planStudioCanvasToolTransition(
      state({
        auxiliary: { kind: "pixel-selection", tool: "poly-lasso" },
        unfinished: [
          "pixel-selection-drag",
          "poly-lasso-draft",
          "pixel-selection-scan",
        ],
      }),
      { type: "primary.draw", drawMode: "pixel" },
    );

    expect(plan.previousOwner).toEqual({
      kind: "pixel-selection",
      tool: "poly-lasso",
    });
    expect(plan.nextOwner).toEqual({ kind: "draw", drawMode: "pixel" });
    expect(plan.commands).toEqual([
      { type: "session.cancel", session: "pixel-selection-drag" },
      { type: "session.cancel", session: "poly-lasso-draft" },
      { type: "session.cancel", session: "pixel-selection-scan" },
      { type: "auxiliary.disarm-all" },
      { type: "primary.set-tool", tool: "draw" },
      { type: "primary.set-draw-mode", drawMode: "pixel" },
    ]);
    expect(plan.next).toEqual(
      state({
        tool: "draw",
        drawMode: "pixel",
      }),
    );
    expect(studioCanvasToolStateViolations(plan.next)).toEqual([]);
  });

  it("cancels fill tap, calculation, and preview before returning to element selection", () => {
    const plan = planStudioCanvasToolTransition(
      state({
        auxiliary: { kind: "advanced-fill" },
        unfinished: [
          "advanced-fill-tap",
          "advanced-fill-work",
          "advanced-fill-preview",
        ],
      }),
      { type: "primary.select" },
    );

    expect(plan.ownerChanged).toBe(true);
    expect(plan.selectionDisarmedDrawingAuxiliary).toBe(true);
    expect(plan.commands).toEqual([
      { type: "session.cancel", session: "advanced-fill-tap" },
      { type: "session.cancel", session: "advanced-fill-work" },
      { type: "session.cancel", session: "advanced-fill-preview" },
      { type: "auxiliary.disarm-all" },
    ]);
    expect(plan.next).toEqual(state());
  });

  it("cancels an active draw stroke before a one-shot eyedropper becomes the owner", () => {
    const armed = planStudioCanvasToolTransition(
      state({
        tool: "draw",
        drawMode: "pen",
        unfinished: ["drawing-stroke"],
      }),
      {
        type: "auxiliary.arm",
        owner: { kind: "eyedropper" },
      },
    );

    expect(armed.commands).toEqual([
      { type: "session.cancel", session: "drawing-stroke" },
      { type: "auxiliary.disarm-all" },
      { type: "auxiliary.arm", owner: { kind: "eyedropper" } },
    ]);
    expect(armed.next).toEqual(
      state({
        tool: "draw",
        drawMode: "pen",
        auxiliary: { kind: "eyedropper" },
      }),
    );

    const released = planStudioCanvasToolTransition(armed.next, {
      type: "auxiliary.release",
      owner: "eyedropper",
    });
    expect(released.commands).toEqual([{ type: "auxiliary.disarm-all" }]);
    expect(released.nextOwner).toEqual({ kind: "draw", drawMode: "pen" });
    expect(released.next).toEqual(
      state({
        tool: "draw",
        drawMode: "pen",
      }),
    );
  });

  it("cancels an active stroke before changing draw modes", () => {
    const plan = planStudioCanvasToolTransition(
      state({
        tool: "draw",
        drawMode: "pen",
        unfinished: ["drawing-stroke"],
      }),
      { type: "primary.draw", drawMode: "eraser" },
    );

    expect(plan.commands).toEqual([
      { type: "session.cancel", session: "drawing-stroke" },
      { type: "auxiliary.disarm-all" },
      { type: "primary.set-draw-mode", drawMode: "eraser" },
    ]);
    expect(plan.nextOwner).toEqual({ kind: "draw", drawMode: "eraser" });
  });

  it("keeps a valid active stroke when the same primary draw mode is selected again", () => {
    const current = state({
      tool: "draw",
      drawMode: "pen",
      unfinished: ["drawing-stroke"],
    });
    const plan = planStudioCanvasToolTransition(current, {
      type: "primary.draw",
      drawMode: "pen",
    });

    expect(plan.changed).toBe(false);
    expect(plan.ownerChanged).toBe(false);
    expect(plan.cancelledUnfinished).toEqual([]);
    // The broad disarm remains intentional: it clears any out-of-scope transient flag without
    // discarding the valid primary drawing session.
    expect(plan.commands).toEqual([{ type: "auxiliary.disarm-all" }]);
    expect(plan.next).toEqual(current);
  });

  it("repairs an Inspector lasso armed under Draw before accepting the same owner", () => {
    const plan = planStudioCanvasToolTransition(
      state({
        tool: "draw",
        drawMode: "pen",
        auxiliary: { kind: "pixel-selection", tool: "lasso" },
        unfinished: ["pixel-selection-drag"],
      }),
      {
        type: "auxiliary.arm",
        owner: { kind: "pixel-selection", tool: "lasso" },
      },
    );

    expect(plan.commands).toEqual([
      { type: "session.cancel", session: "pixel-selection-drag" },
      { type: "auxiliary.disarm-all" },
      { type: "primary.set-tool", tool: "select" },
      {
        type: "auxiliary.arm",
        owner: { kind: "pixel-selection", tool: "lasso" },
      },
    ]);
    expect(plan.next).toEqual(
      state({
        tool: "select",
        drawMode: "pen",
        auxiliary: { kind: "pixel-selection", tool: "lasso" },
      }),
    );
    expect(studioCanvasToolStateViolations(plan.next)).toEqual([]);
  });

  it("ignores a stale one-shot release after another auxiliary takes ownership", () => {
    const current = state({
      auxiliary: { kind: "pixel-selection", tool: "rect" },
      unfinished: ["pixel-selection-drag"],
    });
    const plan = planStudioCanvasToolTransition(current, {
      type: "auxiliary.release",
      owner: "eyedropper",
    });

    expect(plan.changed).toBe(false);
    expect(plan.commands).toEqual([]);
    expect(plan.next).toBe(current);
  });

  it.each([
    { kind: "advanced-fill" },
    { kind: "filter-mask" },
    { kind: "pixel-selection", tool: "wand" },
  ] satisfies readonly StudioCanvasAuxiliaryPointerOwner[])(
    "moves $kind ownership onto the Select primary tool",
    (owner) => {
      const plan = planStudioCanvasToolTransition(
        state({ tool: "draw", drawMode: "pixel" }),
        { type: "auxiliary.arm", owner },
      );

      expect(plan.next.tool).toBe("select");
      expect(studioCanvasPointerOwner(plan.next)).toEqual(owner);
      expect(studioCanvasToolStateViolations(plan.next)).toEqual([]);
    },
  );

  it("reports duplicate and wrong-owner sessions instead of treating branch order as cleanup", () => {
    expect(
      studioCanvasToolStateViolations(
        state({
          auxiliary: { kind: "filter-mask" },
          unfinished: [
            "filter-mask-stroke",
            "filter-mask-stroke",
            "poly-lasso-draft",
          ],
        }),
      ),
    ).toEqual([
      {
        code: "duplicate-unfinished-session",
        session: "filter-mask-stroke",
      },
      {
        code: "unfinished-session-owner-mismatch",
        session: "poly-lasso-draft",
        owner: { kind: "filter-mask" },
      },
    ]);
  });
});
