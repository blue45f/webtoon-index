import { describe, expect, it } from "vitest";

import { studioDrawElementToCrdtStroke } from "../live/studio-crdt-draw-bridge";
import { smoothStrokePoints } from "../studio-brush";
import { STUDIO_PIXEL_PENCIL_RENDER_MODE } from "../studio-pixel-pencil";

import {
  planStudioDrawPointerRelease,
  type StudioDrawPointerReleasePlanInput,
} from "./studio-draw-pointer-release-plan";


import type { DrawEl } from "../studio-element-model";

import { captureStudioInkInputContractV2 } from "@/shared/lib/studio-ink-input-contract";

function stroke(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stroke-1",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 10, 3, 20, -2, 35, 2, 50, 0],
    stroke: "#112233",
    strokeWidth: 8,
    opacity: 1,
    brush: "pen",
    pressures: [1, 0.9, 0.8, 0.9, 1],
    ...overrides,
  };
}

type PlanOverrides = {
  stroke?: DrawEl;
  quickShape?: Partial<StudioDrawPointerReleasePlanInput["quickShape"]>;
  postCorrection?: Partial<StudioDrawPointerReleasePlanInput["postCorrection"]>;
  commit?: Partial<StudioDrawPointerReleasePlanInput["commit"]>;
};

function plan(overrides: PlanOverrides = {}) {
  return planStudioDrawPointerRelease({
    stroke: overrides.stroke ?? stroke(),
    quickShape: {
      active: false,
      anchor: null,
      sourcePoints: [],
      stableSourceLength: 0,
      elapsed: 0,
      locked: false,
      converted: false,
      ...overrides.quickShape,
    },
    postCorrection: {
      strength: 0,
      preserveCorners: true,
      causalStateSealed: false,
      ...overrides.postCorrection,
    },
    commit: {
      masterEditMode: false,
      directLiveDraft: false,
      directInkSurfaceAvailable: false,
      ...overrides.commit,
    },
  });
}

describe("planStudioDrawPointerRelease", () => {
  it("preserves an untouched completed stroke reference and classifies an opaque long stroke as deferred", () => {
    const completed = stroke();
    const result = plan({ stroke: completed });

    expect(result.stroke).toBe(completed);
    expect(result.quickShapeTransition).toBe("none");
    expect(result.quickShapeAnnouncementKind).toBeNull();
    expect(result.postCorrectionApplied).toBe(false);
    expect(result.commitMode).toBe("deferred");
  });

  it.each([
    {
      label: "tap",
      stroke: stroke({ points: [4, 5], pressures: [1] }),
      commit: {},
    },
    {
      label: "short physical mark",
      stroke: stroke({ points: [0, 0, 4, 1, 8, 1], pressures: [1, 1, 1] }),
      commit: {},
    },
    {
      label: "eraser",
      stroke: stroke({ mode: "eraser" }),
      commit: {},
    },
    {
      label: "master edit mode",
      stroke: stroke(),
      commit: { masterEditMode: true },
    },
    {
      label: "unavailable direct surface",
      stroke: stroke(),
      commit: { directLiveDraft: true, directInkSurfaceAvailable: false },
    },
  ])("forces $label through the immediate commit path", ({ stroke: completed, commit }) => {
    expect(plan({ stroke: completed, commit }).commitMode).toBe("immediate");
  });

  it("defers a long translucent stroke so pointerup does not re-render the editor", () => {
    expect(plan({
      stroke: stroke({ opacity: 0.55 }),
    }).commitMode).toBe("deferred");
  });

  it("defers a direct eraser while the live draft preview remains visible", () => {
    expect(plan({
      stroke: stroke({ mode: "eraser" }),
      commit: { directLiveDraft: true, directInkSurfaceAvailable: false },
    }).commitMode).toBe("deferred");
  });

  it("allows direct ink to defer only while its Canvas or GPU surface remains available", () => {
    expect(plan({
      commit: { directLiveDraft: true, directInkSurfaceAvailable: true },
    }).commitMode).toBe("deferred");
    expect(plan({
      commit: { directLiveDraft: true, directInkSurfaceAvailable: false },
    }).commitMode).toBe("immediate");
    // Non-direct drafts use the settled preview store, so direct surface availability is irrelevant.
    expect(plan({
      commit: { directLiveDraft: false, directInkSurfaceAvailable: false },
    }).commitMode).toBe("deferred");
  });

  it("applies release post-correction with the captured strength and corner policy", () => {
    const roughPoints = [
      0, 0,
      10, 6,
      20, -5,
      30, 8,
      40, -4,
      50, 7,
      60, 0,
    ];
    const completed = stroke({
      points: roughPoints,
      pressures: [1, 0.9, 0.8, 0.7, 0.8, 0.9, 1],
    });
    const result = plan({
      stroke: completed,
      postCorrection: { strength: 8, preserveCorners: true },
    });

    expect(result.postCorrectionApplied).toBe(true);
    expect(result.stroke).not.toBe(completed);
    expect(result.stroke.points).toEqual(
      smoothStrokePoints(roughPoints, 8, { preserveCorners: true })
    );
    expect(result.stroke.points.slice(0, 2)).toEqual(roughPoints.slice(0, 2));
    expect(result.stroke.points.slice(-2)).toEqual(roughPoints.slice(-2));
    expect(result.stroke.pressures).toBe(completed.pressures);
  });

  it.each([
    {
      label: "sealed causal correction",
      stroke: stroke(),
      postCorrection: { causalStateSealed: true },
    },
    {
      label: "causal stamp walker",
      stroke: stroke({ stampPipeline: "causal-walker-v2" }),
      postCorrection: {},
    },
    {
      label: "causal watercolor walker",
      stroke: stroke({ watercolorPipeline: "causal-walker-v2" }),
      postCorrection: {},
    },
    {
      label: "geometric shape",
      stroke: stroke({ kind: "rect", points: [0, 0, 80, 40] }),
      postCorrection: {},
    },
    {
      label: "hard-grid pixel pencil",
      stroke: stroke({ brush: STUDIO_PIXEL_PENCIL_RENDER_MODE, strokeWidth: 1 }),
      postCorrection: {},
    },
  ])("does not double-correct $label", ({ stroke: completed, postCorrection }) => {
    const result = plan({
      stroke: completed,
      postCorrection: { strength: 9, ...postCorrection },
    });

    expect(result.postCorrectionApplied).toBe(false);
    expect(result.stroke).toBe(completed);
  });

  it("promotes a release-recognized freehand line and clears every sample-aligned input channel", () => {
    const linePoints = [0, 0, 10, 0.2, 20, -0.1, 30, 0.1, 40, 0, 50, 0];
    const completed = stroke({
      points: linePoints,
      pressures: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
      brush: "ink-brush",
      brushTip: { tiltEnabled: true, angleDeg: 35, roundness: 0.4 },
      stamp: { flow: 0.4, hardness: 0.8, minSize: 0.2 },
      stampPipeline: "causal-walker-v2",
      watercolorPipeline: "causal-walker-v2",
      paintModel: "layered-flow-v1",
      fill: "#abcdef",
      tiltXs: [1, 2, 3, 4, 5, 6],
      tiltYs: [6, 5, 4, 3, 2, 1],
      twists: [0, 10, 20, 30, 40, 50],
      speeds: [0, 1, 2, 3, 4, 5],
      tangentialPressures: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
      altitudeAngles: [0.7, 0.65, 0.6, 0.55, 0.5, 0.45],
      azimuthAngles: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      contactWidths: [2, 2, 2.5, 2.5, 3, 3],
      contactHeights: [1, 1, 1.5, 1.5, 2, 2],
      sampleTimeOffsets: [0, 4, 8, 12, 16, 20],
      inkInput: captureStudioInkInputContractV2("pen"),
      pressureModel: "linear-full-v1",
      sampleSpacing: 0,
      shapeParams: { starPoints: 8, starInnerRatio: 0.3, polygonSides: 8, cornerRadius: 9 },
    });
    const result = plan({
      stroke: completed,
      quickShape: {
        active: true,
        anchor: { x: 50, y: 0 },
        sourcePoints: linePoints,
        stableSourceLength: linePoints.length,
      },
      postCorrection: { strength: 9 },
    });

    expect(result.quickShapeTransition).toBe("promoted");
    expect(result.quickShapeAnnouncementKind).toBe("line");
    expect(result.stroke.kind).toBe("line");
    expect(result.stroke.points).toHaveLength(4);
    for (const clearedField of [
      "brush",
      "pressures",
      "inkInput",
      "pressureModel",
      "outlineStroke",
      "tiltXs",
      "tiltYs",
      "twists",
      "speeds",
      "tangentialPressures",
      "altitudeAngles",
      "azimuthAngles",
      "contactWidths",
      "contactHeights",
      "sampleTimeOffsets",
      "sampleSpacing",
      "brushTip",
      "stamp",
      "stampPipeline",
      "watercolorPipeline",
      "paintModel",
      "fill",
      "shapeParams",
    ] as const) {
      expect(result.stroke[clearedField]).toBeUndefined();
    }
    expect(() => studioDrawElementToCrdtStroke("page-a", result.stroke)).not.toThrow();
    expect(result.postCorrectionApplied).toBe(false);
    expect(result.commitMode).toBe("deferred");
  });

  it("routes an explicitly requested supported brush through a real perfect-outline freehand path", () => {
    const linePoints = [0, 0, 10, 0.2, 20, -0.1, 30, 0.1, 40, 0, 50, 0];
    const completed = stroke({
      points: linePoints,
      brush: "neon",
      pressures: [0.2, 0.4, 0.6, 0.8, 0.9, 1],
      pressureModel: "linear-full-v1",
      sampleSpacing: 0,
    });
    const result = plan({
      stroke: completed,
      quickShape: {
        active: true,
        sourcePoints: linePoints,
        stableSourceLength: linePoints.length,
        brushEffectMode: "selected-brush",
      },
      postCorrection: { strength: 10 },
    });

    expect(result.quickShapeTransition).toBe("promoted");
    expect(result.quickShapeAnnouncementKind).toBe("line");
    expect(result.quickShapeBrushEffectStatus).toBe("applied");
    expect(result.quickShapeBrushEffectRejectionReason).toBeNull();
    expect(result.stroke.kind).toBe("freehand");
    expect(result.stroke.brush).toBe("neon");
    expect(result.stroke.points).toHaveLength(4);
    expect(result.stroke.pressures).toHaveLength(2);
    // The generated perfect outline is already authoritative; release smoothing must not deform it.
    expect(result.postCorrectionApplied).toBe(false);
    // The live surface still owns the pre-snap gesture, so the rebuilt visual commits synchronously.
    expect(result.commitMode).toBe("immediate");
  });

  it.each([
    {
      label: "causal stamp",
      source: stroke({ brush: "ink-brush", stampPipeline: "causal-walker-v2" }),
      reason: "causal-stamp",
    },
    {
      label: "causal watercolor",
      source: stroke({ brush: "watercolor", watercolorPipeline: "causal-walker-v2" }),
      reason: "causal-watercolor",
    },
  ] as const)("rejects $label QuickShape promotion and preserves its source stroke", ({ source, reason }) => {
    const result = plan({
      stroke: source,
      quickShape: {
        active: true,
        sourcePoints: source.points,
        stableSourceLength: source.points.length,
        brushEffectMode: "selected-brush",
      },
    });

    expect(result.quickShapeTransition).toBe("none");
    expect(result.quickShapeAnnouncementKind).toBeNull();
    expect(result.quickShapeBrushEffectStatus).toBe("rejected");
    expect(result.quickShapeBrushEffectRejectionReason).toBe(reason);
    expect(result.stroke).toBe(source);
    expect(result.stroke.kind).toBe("freehand");
    expect(result.stroke.brush).toBe(source.brush);
    expect(result.stroke.stampPipeline).toBe(source.stampPipeline);
    expect(result.stroke.watercolorPipeline).toBe(source.watercolorPipeline);
    expect(result.postCorrectionApplied).toBe(false);
    expect(result.commitMode).toBe("immediate");
  });

  it("trims dwell jitter before release promotion", () => {
    const stableLine = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0, 50, 0];
    const sourceWithDwellJitter = [
      ...stableLine,
      51, 18,
      47, -22,
      55, 16,
      49, -19,
    ];
    const result = plan({
      stroke: stroke({ points: sourceWithDwellJitter }),
      quickShape: {
        active: true,
        anchor: { x: 50, y: 0 },
        sourcePoints: sourceWithDwellJitter,
        stableSourceLength: stableLine.length,
        elapsed: 400,
      },
    });

    expect(result.quickShapeTransition).toBe("promoted");
    expect(result.quickShapeAnnouncementKind).toBe("line");
  });

  it("reports an already converted live QuickShape without rebuilding its geometry", () => {
    const converted = stroke({ kind: "rect", points: [10, 20, 90, 70], pressures: undefined });
    const result = plan({
      stroke: converted,
      quickShape: { active: true, converted: true },
      postCorrection: { strength: 10 },
    });

    expect(result.stroke).toBe(converted);
    expect(result.quickShapeTransition).toBe("already-converted");
    expect(result.quickShapeAnnouncementKind).toBe("rect");
    expect(result.postCorrectionApplied).toBe(false);
  });

  it("rebuilds an already converted live QuickShape from its captured brush-effect source", () => {
    const original = stroke({
      brush: "gpen",
      pressures: [0.2, 0.4, 0.6, 0.8, 1],
      pressureModel: "linear-full-v1",
      sampleSpacing: 0,
    });
    const converted = stroke({
      kind: "ellipse",
      points: [10, 20, 210, 120],
      brush: undefined,
      pressures: undefined,
    });
    const result = plan({
      stroke: converted,
      quickShape: {
        active: true,
        converted: true,
        brushEffectMode: "selected-brush",
        brushEffectSource: original,
      },
    });

    expect(result.quickShapeTransition).toBe("already-converted");
    expect(result.quickShapeAnnouncementKind).toBe("ellipse");
    expect(result.quickShapeBrushEffectStatus).toBe("applied");
    expect(result.stroke.kind).toBe("freehand");
    expect(result.stroke.brush).toBe("gpen");
    expect(result.stroke.points.slice(-2)).toEqual(result.stroke.points.slice(0, 2));
    expect(result.stroke.pressures).toHaveLength(result.stroke.points.length / 2);
  });

  it("fails closed when live conversion did not capture the original brush source", () => {
    const converted = stroke({
      kind: "rect",
      points: [10, 20, 90, 70],
      brush: undefined,
      pressures: undefined,
      brushCatalogId: "stale-brush",
      stampPipeline: "causal-walker-v2",
    });
    const result = plan({
      stroke: converted,
      quickShape: {
        active: true,
        converted: true,
        brushEffectMode: "selected-brush",
      },
    });

    expect(result.quickShapeTransition).toBe("none");
    expect(result.quickShapeAnnouncementKind).toBeNull();
    expect(result.quickShapeBrushEffectStatus).toBe("rejected");
    expect(result.quickShapeBrushEffectRejectionReason).toBe("missing-source");
    expect(result.stroke).toBe(converted);
    expect(result.stroke.kind).toBe("rect");
    expect(result.stroke.brushCatalogId).toBe("stale-brush");
    expect(result.stroke.stampPipeline).toBe("causal-walker-v2");
    expect(result.commitMode).toBe("immediate");
  });

  it("restores the captured source when a live-converted selected effect is unavailable", () => {
    const original = stroke({
      brush: "ink-brush",
      stampPipeline: "causal-walker-v2",
    });
    const converted = stroke({
      kind: "rect",
      points: [10, 20, 90, 70],
      brush: undefined,
      pressures: undefined,
    });
    const result = plan({
      stroke: converted,
      quickShape: {
        active: true,
        converted: true,
        brushEffectMode: "selected-brush",
        brushEffectSource: original,
      },
      postCorrection: { strength: 10 },
    });

    expect(result.quickShapeTransition).toBe("none");
    expect(result.quickShapeBrushEffectStatus).toBe("rejected");
    expect(result.quickShapeBrushEffectRejectionReason).toBe("causal-stamp");
    expect(result.stroke).toBe(original);
    expect(result.postCorrectionApplied).toBe(false);
    expect(result.commitMode).toBe("immediate");
  });

  it("never promotes or announces an eraser QuickShape gesture", () => {
    const linePoints = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
    const eraser = stroke({ mode: "eraser", points: linePoints });
    const result = plan({
      stroke: eraser,
      quickShape: {
        active: true,
        converted: true,
        sourcePoints: linePoints,
        stableSourceLength: linePoints.length,
      },
    });

    expect(result.stroke).toBe(eraser);
    expect(result.quickShapeTransition).toBe("none");
    expect(result.quickShapeAnnouncementKind).toBeNull();
    expect(result.commitMode).toBe("immediate");
  });
});
