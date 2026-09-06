import { describe, expect, it } from "vitest";

import {
  measureStudioLayerRowActionDistance,
  planStudioBrushHudPlacement,
  planStudioSelectionContextBarPlacement,
  projectStudioDocumentRectToClient,
  stepStudioBrushHudTether,
  STUDIO_BRUSH_HUD_COARSE_GEOMETRY,
  STUDIO_BRUSH_HUD_FINE_GEOMETRY,
  STUDIO_BRUSH_HUD_GUARANTEE_INSET_PX,
  STUDIO_BRUSH_HUD_LATCH_APPROACH_PX,
  STUDIO_BRUSH_HUD_LATCH_RELEASE_PX,
  STUDIO_BRUSH_HUD_TETHER_INITIAL,
  STUDIO_POINTER_DISTANCE_BUDGETS_PX,
  studioBrushHudExtentPx,
  studioDistanceToRect,
  studioOnCanvasSafeArea,
  type StudioBrushHudGeometry,
  type StudioPointerHandedness,
  type StudioSurfaceRect,
} from "./studio-oncanvas-command-surfaces";

/**
 * Viewport / canvas geometry taken from the three viewports Wave C ships for,
 * with the 1440×900 row matching `tests/benchmarks/results/ux-audit.json`
 * (`canvasRect { x: 224, y: 44, w: 924, h: 1386 }`, clipped by the 900px viewport).
 */
const VIEWPORTS: readonly {
  readonly label: string;
  readonly viewport: StudioSurfaceRect;
  readonly canvas: StudioSurfaceRect;
}[] = [
  {
    label: "1600x1000 desktop",
    viewport: { left: 0, top: 0, width: 1600, height: 1000 },
    canvas: { left: 224, top: 44, width: 1084, height: 956 },
  },
  {
    label: "900x900 compact",
    viewport: { left: 0, top: 0, width: 900, height: 900 },
    canvas: { left: 168, top: 44, width: 560, height: 856 },
  },
  {
    label: "430x932 mobile",
    viewport: { left: 0, top: 0, width: 430, height: 932 },
    canvas: { left: 0, top: 48, width: 430, height: 720 },
  },
];

const HANDS: readonly StudioPointerHandedness[] = ["right", "left"];
const GEOMETRIES: readonly { label: string; geometry: StudioBrushHudGeometry }[] = [
  { label: "fine", geometry: STUDIO_BRUSH_HUD_FINE_GEOMETRY },
  { label: "coarse", geometry: STUDIO_BRUSH_HUD_COARSE_GEOMETRY },
];

function rectContains(outer: StudioSurfaceRect, inner: StudioSurfaceRect): boolean {
  return inner.left >= outer.left - 0.01
    && inner.top >= outer.top - 0.01
    && inner.left + inner.width <= outer.left + outer.width + 0.01
    && inner.top + inner.height <= outer.top + outer.height + 0.01;
}

describe("V5 §15 포인터 거리 budgets", () => {
  it("states the three ceilings the spec table states", () => {
    expect(STUDIO_POINTER_DISTANCE_BUDGETS_PX).toEqual({
      brushHud: 80,
      selectionCommand: 180,
      layerRowAction: 120,
    });
  });
});

describe("planStudioBrushHudPlacement", () => {
  it("keeps every control inside the 80px budget across the guaranteed band", () => {
    for (const { label, viewport, canvas } of VIEWPORTS) {
      const safeArea = studioOnCanvasSafeArea(canvas, viewport);
      for (const { label: geometryLabel, geometry } of GEOMETRIES) {
        const inset = Math.max(
          STUDIO_BRUSH_HUD_GUARANTEE_INSET_PX,
          studioBrushHudExtentPx(geometry) / 2
        );
        for (const handedness of HANDS) {
          for (let x = safeArea.left + inset; x <= safeArea.left + safeArea.width - inset; x += 23) {
            for (let y = safeArea.top + inset; y <= safeArea.top + safeArea.height - inset; y += 29) {
              const placement = planStudioBrushHudPlacement({
                anchor: { x, y },
                safeArea,
                handedness,
                geometry,
              });
              const context = `${label}/${geometryLabel}/${handedness}@${x},${y}`;
              expect(
                placement.maxControlDistancePx,
                `${context} exceeded the brush HUD budget`
              ).toBeLessThanOrEqual(STUDIO_POINTER_DISTANCE_BUDGETS_PX.brushHud);
              expect(placement.withinBudget, context).toBe(true);
              expect(rectContains(safeArea, placement.rect), `${context} escaped the safe area`)
                .toBe(true);
            }
          }
        }
      }
    }
  });

  it("never parks the cluster under the cursor", () => {
    for (const { geometry } of GEOMETRIES) {
      const placement = planStudioBrushHudPlacement({
        anchor: { x: 600, y: 500 },
        safeArea: { left: 200, top: 40, width: 900, height: 800 },
        handedness: "right",
        geometry,
      });
      expect(studioDistanceToRect({ x: 600, y: 500 }, placement.rect)).toBeGreaterThan(6);
    }
  });

  it("prefers above, then the hand-free side", () => {
    const safeArea = { left: 200, top: 40, width: 900, height: 800 };
    expect(
      planStudioBrushHudPlacement({ anchor: { x: 600, y: 500 }, safeArea, handedness: "right" }).side
    ).toBe("top");
    // No room above: a right hand covers the right of the nib, so go left.
    expect(
      planStudioBrushHudPlacement({ anchor: { x: 600, y: 80 }, safeArea, handedness: "right" }).side
    ).toBe("left");
    expect(
      planStudioBrushHudPlacement({ anchor: { x: 600, y: 80 }, safeArea, handedness: "left" }).side
    ).toBe("right");
  });

  it("dodges an open popup instead of sitting under it", () => {
    const safeArea = { left: 200, top: 40, width: 900, height: 800 };
    const anchor = { x: 600, y: 500 };
    const above = planStudioBrushHudPlacement({ anchor, safeArea, handedness: "right" });
    expect(above.side).toBe("top");
    const dodged = planStudioBrushHudPlacement({
      anchor,
      safeArea,
      handedness: "right",
      obstacles: [above.rect],
    });
    expect(dodged.side).not.toBe("top");
    expect(dodged.obstructedPx2).toBe(0);
    expect(dodged.withinBudget).toBe(true);
  });

  it("reports honestly rather than escaping the safe area in a corner", () => {
    const safeArea = { left: 0, top: 0, width: 430, height: 600 };
    const placement = planStudioBrushHudPlacement({
      anchor: { x: 2, y: 2 },
      safeArea,
      handedness: "right",
    });
    expect(rectContains(safeArea, placement.rect)).toBe(true);
    expect(placement.withinBudget).toBe(
      placement.maxControlDistancePx <= STUDIO_POINTER_DISTANCE_BUDGETS_PX.brushHud
    );
  });
});

describe("stepStudioBrushHudTether", () => {
  const hudRect: StudioSurfaceRect = { left: 300, top: 300, width: 72, height: 72 };

  it("starts idle and follows the pointer over the canvas", () => {
    const next = stepStudioBrushHudTether(STUDIO_BRUSH_HUD_TETHER_INITIAL, {
      type: "pointer",
      point: { x: 500, y: 500 },
      overCanvas: true,
      hudRect: null,
    });
    expect(next).toEqual({ phase: "following", anchor: { x: 500, y: 500 } });
  });

  it("hides for the whole stroke and returns on lift", () => {
    const following = stepStudioBrushHudTether(STUDIO_BRUSH_HUD_TETHER_INITIAL, {
      type: "pointer",
      point: { x: 500, y: 500 },
      overCanvas: true,
      hudRect: null,
    });
    const drawing = stepStudioBrushHudTether(following, { type: "stroke-start" });
    expect(drawing.phase).toBe("drawing");
    // Every sample of a 60-move stroke must leave it hidden.
    let mid = drawing;
    for (let i = 0; i < 60; i += 1) {
      mid = stepStudioBrushHudTether(mid, {
        type: "pointer",
        point: { x: 500 + i, y: 500 + i },
        overCanvas: true,
        hudRect,
      });
      expect(mid.phase).toBe("drawing");
    }
    const lifted = stepStudioBrushHudTether(mid, {
      type: "stroke-end",
      point: { x: 560, y: 560 },
    });
    expect(lifted).toEqual({ phase: "following", anchor: { x: 560, y: 560 } });
  });

  it("latches so the pointer can actually reach it, then releases", () => {
    const anchor = { x: 336, y: 420 };
    const following = { phase: "following", anchor } as const;
    const approaching = {
      x: hudRect.left + hudRect.width / 2,
      y: hudRect.top + hudRect.height + STUDIO_BRUSH_HUD_LATCH_APPROACH_PX - 2,
    };
    const latched = stepStudioBrushHudTether(following, {
      type: "pointer",
      point: approaching,
      overCanvas: true,
      hudRect,
    });
    expect(latched.phase).toBe("latched");
    // Anchor frozen: the HUD stops fleeing while the pointer closes the gap.
    expect(latched.anchor).toEqual(anchor);

    const inside = stepStudioBrushHudTether(latched, {
      type: "pointer",
      point: { x: hudRect.left + 10, y: hudRect.top + 10 },
      overCanvas: false,
      hudRect,
    });
    expect(inside.phase).toBe("latched");

    const away = stepStudioBrushHudTether(inside, {
      type: "pointer",
      point: {
        x: hudRect.left + hudRect.width / 2,
        y: hudRect.top + hudRect.height + STUDIO_BRUSH_HUD_LATCH_RELEASE_PX + 4,
      },
      overCanvas: true,
      hudRect,
    });
    expect(away.phase).toBe("following");
  });

  it("goes idle when the pointer leaves the canvas and the HUD", () => {
    const following = { phase: "following", anchor: { x: 500, y: 500 } } as const;
    const next = stepStudioBrushHudTether(following, {
      type: "pointer",
      point: { x: 20, y: 20 },
      overCanvas: false,
      hudRect,
    });
    expect(next.phase).toBe("idle");
  });
});

describe("planStudioSelectionContextBarPlacement", () => {
  const safeArea: StudioSurfaceRect = { left: 200, top: 40, width: 900, height: 800 };
  const bar = { width: 220, height: 42 };

  it("sits above the selection inside the 180px budget", () => {
    const placement = planStudioSelectionContextBarPlacement({
      selection: { left: 500, top: 400, width: 120, height: 90 },
      bar,
      safeArea,
    });
    expect(placement.side).toBe("top");
    expect(placement.maxControlDistancePx).toBeLessThanOrEqual(
      STUDIO_POINTER_DISTANCE_BUDGETS_PX.selectionCommand
    );
    expect(placement.withinBudget).toBe(true);
  });

  it("flips below when the selection is against the top edge", () => {
    const placement = planStudioSelectionContextBarPlacement({
      selection: { left: 500, top: 44, width: 120, height: 90 },
      bar,
      safeArea,
    });
    expect(placement.side).toBe("bottom");
    expect(placement.withinBudget).toBe(true);
  });

  it("holds the budget for selections of every size the canvas allows", () => {
    for (const { viewport, canvas } of VIEWPORTS) {
      const area = studioOnCanvasSafeArea(canvas, viewport);
      for (const size of [8, 40, 160, 400]) {
        for (const multiRow of [42, 84]) {
          const selection = {
            left: area.left + area.width / 2 - size / 2,
            top: area.top + area.height / 2 - size / 2,
            width: size,
            height: size,
          };
          const placement = planStudioSelectionContextBarPlacement({
            selection,
            bar: { width: Math.min(260, area.width), height: multiRow },
            safeArea: area,
          });
          expect(placement.maxControlDistancePx).toBeLessThanOrEqual(
            STUDIO_POINTER_DISTANCE_BUDGETS_PX.selectionCommand
          );
          expect(rectContains(area, placement.rect)).toBe(true);
        }
      }
    }
  });

  it("dodges an obstacle by flipping sides", () => {
    const selection = { left: 500, top: 400, width: 120, height: 90 };
    const above = planStudioSelectionContextBarPlacement({ selection, bar, safeArea });
    const dodged = planStudioSelectionContextBarPlacement({
      selection,
      bar,
      safeArea,
      obstacles: [above.rect],
    });
    expect(dodged.side).toBe("bottom");
    expect(dodged.obstructedPx2).toBe(0);
  });
});

describe("measureStudioLayerRowActionDistance", () => {
  it("measures inline actions from the row centre", () => {
    const row: StudioSurfaceRect = { left: 1000, top: 260, width: 256, height: 36 };
    const inline: readonly StudioSurfaceRect[] = [
      { left: 1176, top: 268, width: 28, height: 28 },
      { left: 1204, top: 268, width: 28, height: 28 },
      { left: 1232, top: 268, width: 20, height: 28 },
    ];
    expect(measureStudioLayerRowActionDistance(row, inline)).toBeLessThanOrEqual(
      STUDIO_POINTER_DISTANCE_BUDGETS_PX.layerRowAction
    );
  });

  it("shows why a popover route failed the same budget", () => {
    const row: StudioSurfaceRect = { left: 1000, top: 260, width: 256, height: 36 };
    // The `…` popover opens beside the panel; its lock control lands here.
    const popoverControl: readonly StudioSurfaceRect[] = [
      { left: 1060, top: 520, width: 96, height: 32 },
    ];
    expect(measureStudioLayerRowActionDistance(row, popoverControl)).toBeGreaterThan(
      STUDIO_POINTER_DISTANCE_BUDGETS_PX.layerRowAction
    );
  });
});

describe("projectStudioDocumentRectToClient", () => {
  const hostRect: StudioSurfaceRect = { left: 100, top: 50, width: 800, height: 1200 };

  it("maps a document rect through the identity view", () => {
    const projected = projectStudioDocumentRectToClient({
      documentWidth: 800,
      documentHeight: 1200,
      canvasFlipH: false,
      canvasRotation: 0,
      rect: { x: 200, y: 300, w: 100, h: 60 },
      hostRect,
    });
    expect(projected).toEqual({ left: 300, top: 350, width: 100, height: 60 });
  });

  it("stays axis-aligned through a quarter turn", () => {
    const projected = projectStudioDocumentRectToClient({
      documentWidth: 800,
      documentHeight: 1200,
      canvasFlipH: false,
      canvasRotation: 90,
      rect: { x: 200, y: 300, w: 100, h: 60 },
      hostRect: { left: 0, top: 0, width: 1200, height: 800 },
    });
    expect(projected.width).toBeCloseTo(60, 5);
    expect(projected.height).toBeCloseTo(100, 5);
  });

  it("mirrors horizontally when the view is flipped", () => {
    const plain = projectStudioDocumentRectToClient({
      documentWidth: 800,
      documentHeight: 1200,
      canvasFlipH: false,
      canvasRotation: 0,
      rect: { x: 0, y: 0, w: 100, h: 60 },
      hostRect,
    });
    const flipped = projectStudioDocumentRectToClient({
      documentWidth: 800,
      documentHeight: 1200,
      canvasFlipH: true,
      canvasRotation: 0,
      rect: { x: 0, y: 0, w: 100, h: 60 },
      hostRect,
    });
    expect(plain.left).toBeLessThan(flipped.left);
    expect(flipped.width).toBeCloseTo(plain.width, 5);
  });
});

describe("studioOnCanvasSafeArea", () => {
  it("intersects the canvas with the visual viewport and insets it", () => {
    const area = studioOnCanvasSafeArea(
      { left: 224, top: 44, width: 924, height: 1386 },
      { left: 0, top: 0, width: 1440, height: 900 }
    );
    expect(area).toEqual({ left: 232, top: 52, width: 908, height: 840 });
  });

  it("collapses instead of going negative when the canvas is off screen", () => {
    const area = studioOnCanvasSafeArea(
      { left: 2000, top: 2000, width: 100, height: 100 },
      { left: 0, top: 0, width: 1440, height: 900 }
    );
    expect(area.width).toBe(0);
    expect(area.height).toBe(0);
  });
});
