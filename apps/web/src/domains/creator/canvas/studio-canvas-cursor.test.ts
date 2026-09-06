import { describe, expect, it } from "vitest";

import {
  isStudioBrushCursorMode,
  isStudioCanvasInteractionBlocked,
  planStudioBrushCursorVisual,
  shouldShowStudioBrushCursor,
  studioCanvasCursorClassName,
  studioCanvasViewportCursorClassName,
  type StudioCanvasCursorInput,
} from "./studio-canvas-cursor";

const interactionBase = {
  activeSurfaceReviewLocked: true,
  commentPinArmed: true,
  canCreateStudioComment: true,
  saving: false,
  documentReloadRequired: false,
  sourceHydrationPending: false,
  workHydrationFailed: false,
  collaborationDocumentUnavailable: false,
} as const;

const base: StudioCanvasCursorInput = {
  tool: "select",
  drawMode: "pen",
  isSpacePressed: false,
  isPanning: false,
  interactionBlocked: false,
  commentPinArmed: false,
  eyedropperActive: false,
  advancedFillArmed: false,
  cropArmed: false,
  pixelToolArmed: false,
  panelSplitArmed: false,
  nodeEditArmed: false,
  bubbleShapeArmed: false,
  puppetWarpArmed: false,
  perspectiveRulerActive: false,
  precisionBrushArmed: false,
};

describe("studioCanvasCursorClassName", () => {
  it("admits only an authorized comment placement through a read-only document lock", () => {
    const interactionBlocked = isStudioCanvasInteractionBlocked(interactionBase);

    expect(interactionBlocked).toBe(false);
    expect(studioCanvasCursorClassName({
      ...base,
      interactionBlocked,
      commentPinArmed: true,
    })).toBe("cursor-crosshair");
    expect(isStudioCanvasInteractionBlocked({
      ...interactionBase,
      commentPinArmed: false,
    })).toBe(true);
    expect(isStudioCanvasInteractionBlocked({
      ...interactionBase,
      canCreateStudioComment: false,
    })).toBe(true);
    expect(isStudioCanvasInteractionBlocked({
      ...interactionBase,
      activeSurfaceReviewLocked: false,
      commentPinArmed: false,
      canCreateStudioComment: false,
    })).toBe(false);
  });

  it.each([
    "saving",
    "documentReloadRequired",
    "sourceHydrationPending",
    "workHydrationFailed",
    "collaborationDocumentUnavailable",
  ] as const)("keeps the %s barrier absolute during comment placement", (barrier) => {
    expect(isStudioCanvasInteractionBlocked({
      ...interactionBase,
      [barrier]: true,
    })).toBe(true);
  });

  it("distinguishes select, hand and active pan modes", () => {
    expect(studioCanvasCursorClassName(base)).toBe("cursor-default");
    expect(studioCanvasCursorClassName({ ...base, tool: "hand" })).toBe("cursor-grab");
    expect(studioCanvasCursorClassName({ ...base, tool: "hand", isPanning: true })).toBe("cursor-grabbing");
  });

  it("keeps paper-only precision cursors out of the surrounding scroll workspace", () => {
    expect(studioCanvasViewportCursorClassName({
      tool: "select",
      isSpacePressed: false,
      isPanning: false,
      interactionBlocked: false,
    })).toBe("cursor-default");
    expect(studioCanvasViewportCursorClassName({
      tool: "hand",
      isSpacePressed: false,
      isPanning: false,
      interactionBlocked: false,
    })).toBe("cursor-grab");
  });

  it("uses crosshairs for placement, selection and geometric editing", () => {
    expect(studioCanvasCursorClassName({ ...base, commentPinArmed: true })).toBe("cursor-crosshair");
    expect(studioCanvasCursorClassName({ ...base, eyedropperActive: true })).toBe("cursor-crosshair");
    expect(studioCanvasCursorClassName({ ...base, pixelToolArmed: true })).toBe("cursor-crosshair");
    expect(studioCanvasCursorClassName({ ...base, cropArmed: true })).toBe("cursor-crosshair");
    expect(studioCanvasCursorClassName({ ...base, tool: "draw", drawMode: "shape" })).toBe("cursor-crosshair");
    expect(studioCanvasCursorClassName({ ...base, tool: "draw", drawMode: "pixel" })).toBe("cursor-crosshair");
  });

  it("keeps a native crosshair fallback beneath pen and eraser footprint rings", () => {
    expect(studioCanvasCursorClassName({ ...base, tool: "draw", drawMode: "pen" })).toBe("cursor-crosshair");
    expect(studioCanvasCursorClassName({ ...base, tool: "draw", drawMode: "eraser" })).toBe("cursor-crosshair");
    expect(studioCanvasCursorClassName({ ...base, precisionBrushArmed: true })).toBe("cursor-none");
  });

  it("keeps blocked and active-pan states higher priority than tool hints", () => {
    expect(studioCanvasCursorClassName({ ...base, interactionBlocked: true, commentPinArmed: true })).toBe("cursor-not-allowed");
    expect(studioCanvasCursorClassName({ ...base, isPanning: true, precisionBrushArmed: true })).toBe("cursor-grabbing");
  });
});

describe("Studio brush cursor", () => {
  it("uses custom footprint rings only for pen and eraser modes", () => {
    expect(isStudioBrushCursorMode("pen")).toBe(true);
    expect(isStudioBrushCursorMode("eraser")).toBe(true);
    expect(isStudioBrushCursorMode("shape")).toBe(false);
    expect(isStudioBrushCursorMode("pixel")).toBe(false);
    expect(isStudioBrushCursorMode("lasso-fill")).toBe(false);
  });

  it("keeps mouse and pen cursors visible while avoiding a fake hover cursor for touch", () => {
    expect(shouldShowStudioBrushCursor("mouse")).toBe(true);
    expect(shouldShowStudioBrushCursor("pen")).toBe(true);
    expect(shouldShowStudioBrushCursor(undefined)).toBe(true);
    expect(shouldShowStudioBrushCursor("touch")).toBe(false);
  });

  it("preserves the exact document footprint while keeping outlines screen-stable", () => {
    const atHalf = planStudioBrushCursorVisual({
      diameter: 20,
      effectiveScale: 0.5,
      mode: "eraser",
    });
    const atDouble = planStudioBrushCursorVisual({
      diameter: 20,
      effectiveScale: 2,
      mode: "eraser",
    });

    expect(atHalf.radius).toBe(10);
    expect(atDouble.radius).toBe(10);
    expect(atHalf.outerStrokeWidth * 0.5).toBeCloseTo(3.25);
    expect(atDouble.outerStrokeWidth * 2).toBeCloseTo(3.25);
    expect(atHalf.innerStrokeWidth * 0.5).toBeCloseTo(1.25);
    expect(atDouble.innerStrokeWidth * 2).toBeCloseTo(1.25);
    expect(atHalf.dash?.map((value) => value * 0.5)).toEqual([4, 3]);
    expect(atDouble.dash?.map((value) => value * 2)).toEqual([4, 3]);
  });

  it("adds a center sight for tiny outlines and honors the saved dot style", () => {
    const tiny = planStudioBrushCursorVisual({ diameter: 2, effectiveScale: 1, mode: "pen" });
    const large = planStudioBrushCursorVisual({ diameter: 20, effectiveScale: 1, mode: "pen" });
    const dot = planStudioBrushCursorVisual({
      diameter: 20,
      effectiveScale: 2,
      mode: "eraser",
      style: "dot",
    });

    expect(tiny.radius).toBe(1);
    expect(tiny.centerRadius).toBe(1.5);
    expect(tiny.centerStrokeWidth).toBe(0.75);
    expect(tiny.dash).toBeUndefined();
    expect(tiny.showOutline).toBe(true);
    expect(large.centerRadius).toBeNull();
    expect(dot.showOutline).toBe(false);
    expect(dot.centerRadius).toBe(1);
    expect(dot.centerStrokeWidth * 2).toBe(0.75);
  });

  it("never synthesizes a tiny fallback dot when the cursor preference is none", () => {
    const hidden = planStudioBrushCursorVisual({
      brushId: "g-pen",
      diameter: 1,
      effectiveScale: 1,
      mode: "pen",
      style: "none",
    });

    expect(hidden.showOutline).toBe(false);
    expect(hidden.centerRadius).toBeNull();
  });

  it("matches cursor geometry and texture to the active brush renderer", () => {
    const calligraphy = planStudioBrushCursorVisual({
      brushId: "calligraphy",
      diameter: 20,
      effectiveScale: 1,
      mode: "pen",
      tipAngleDeg: 36,
      tipRoundness: 0.25,
    });
    const highlighter = planStudioBrushCursorVisual({
      brushId: "highlighter",
      diameter: 24,
      effectiveScale: 1,
      mode: "pen",
    });
    const softGlow = planStudioBrushCursorVisual({
      brushId: "soft-glow",
      diameter: 20,
      effectiveScale: 1,
      mode: "pen",
    });
    const starDust = planStudioBrushCursorVisual({
      brushId: "star-dust",
      diameter: 20,
      effectiveScale: 1,
      mode: "pen",
    });

    expect(calligraphy).toMatchObject({
      shape: "ellipse",
      texture: "solid",
      radiusX: 10,
      radiusY: 2.5,
      rotationDeg: 36,
    });
    expect(highlighter.shape).toBe("square");
    expect(softGlow.texture).toBe("soft");
    expect(softGlow.radius).toBe(42);
    expect(softGlow.innerBoundaryScale).toBe(0.2);
    expect(starDust.texture).toBe("scatter");
    expect(starDust.radius).toBe(23);
    expect(starDust.dash).toEqual([2, 2]);
  });
});
