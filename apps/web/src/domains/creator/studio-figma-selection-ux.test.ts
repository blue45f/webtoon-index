import { describe, expect, it } from "vitest";

import {
  planStudioMultiSelectionLayoutPatch,
  planStudioSelectionFlip,
  planStudioSelectionLayoutPatch,
  planStudioZoomToSelection,
  resolveStudioFigmaSelectionLayoutMetrics,
  selectStudioFigmaDesignTargets,
  unionStudioSelectionBounds,
} from "./studio-figma-selection-ux";

import type {
  DrawEl,
  El,
  FocusLinesEl,
  ImageEl,
  SpeedLinesEl,
  TextEl,
} from "./studio-element-model";

function draw(partial: Partial<DrawEl> & Pick<DrawEl, "id" | "points">): DrawEl {
  return {
    type: "draw",
    mode: "pen",
    brush: "pen",
    stroke: "#111",
    strokeWidth: 6,
    ...partial,
  } as DrawEl;
}

function image(partial: Partial<ImageEl> & Pick<ImageEl, "id" | "x" | "y" | "width" | "height">): ImageEl {
  return {
    type: "image",
    src: "data:image/png;base64,AA==",
    rotation: 0,
    ...partial,
  } as ImageEl;
}

function text(partial: Partial<TextEl> & Pick<TextEl, "id" | "x" | "y">): TextEl {
  return {
    type: "text",
    text: "대사",
    width: 120,
    fontSize: 20,
    fill: "#111",
    ...partial,
  } as TextEl;
}

function focusLines(partial: Partial<FocusLinesEl> = {}): FocusLinesEl {
  return {
    id: "focus",
    type: "focusLines",
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    lineCount: 24,
    innerRadius: 30,
    outerRadius: 140,
    stroke: "#111",
    strokeWidth: 2,
    noise: 0,
    rotation: 12,
    ...partial,
  };
}

function speedLines(partial: Partial<SpeedLinesEl> = {}): SpeedLinesEl {
  return {
    id: "speed",
    type: "speedLines",
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    lineCount: 24,
    direction: "horizontal",
    stroke: "#111",
    strokeWidth: 2,
    rotation: 12,
    ...partial,
  };
}

describe("studio figma selection ux", () => {
  it("unions selection bounds and pads flat freehand strokes", () => {
    const a = draw({ id: "a", points: [10, 20, 110, 20], strokeWidth: 8 });
    const box = unionStudioSelectionBounds([a]);
    expect(box).not.toBeNull();
    expect(box!.w).toBeGreaterThan(100);
    expect(box!.h).toBeGreaterThanOrEqual(8);
  });

  it("targets the marquee set when present and the single selection otherwise", () => {
    const a = image({ id: "a", x: 0, y: 0, width: 10, height: 10 });
    const b = image({ id: "b", x: 20, y: 0, width: 10, height: 10 });
    expect(selectStudioFigmaDesignTargets([a, b], ["b"], a)).toEqual([b]);
    expect(selectStudioFigmaDesignTargets([a, b], [], a)).toEqual([a]);
    expect(selectStudioFigmaDesignTargets([a, b], [], null)).toEqual([]);
  });

  it("plans zoom-to-selection so the selection fills most of the viewport", () => {
    const plan = planStudioZoomToSelection({
      bounds: { x: 100, y: 200, w: 200, h: 100 },
      viewportWidth: 1000,
      viewportHeight: 800,
      documentWidth: 720,
      documentHeight: 1280,
      paddingRatio: 0.2,
      maxScale: 4,
      minScale: 0.2,
    });
    expect(plan).not.toBeNull();
    expect(plan!.scale).toBeGreaterThan(1);
    expect(plan!.zoom).toBe(1);
    expect(plan!.centerX).toBe(200);
    expect(plan!.centerY).toBe(250);
  });

  it("flips a multi-selection around its shared center", () => {
    const left = image({ id: "L", x: 0, y: 0, width: 40, height: 40 });
    const right = image({ id: "R", x: 100, y: 0, width: 40, height: 40 });
    const next = planStudioSelectionFlip([left, right], ["L", "R"], "horizontal");
    expect(next).not.toBeNull();
    const nextLeft = next!.find((el) => el.id === "L") as ImageEl;
    const nextRight = next!.find((el) => el.id === "R") as ImageEl;
    // Centers swap around mid-point 70: left center 20 → 120, right 120 → 20.
    expect(nextLeft.x).toBe(100);
    expect(nextRight.x).toBe(0);
  });

  it("mirrors a lone image in place instead of leaving it untouched", () => {
    const only = image({ id: "i", x: 30, y: 30, width: 40, height: 40 });
    const flipped = planStudioSelectionFlip([only], ["i"], "horizontal")!.find(
      (el) => el.id === "i",
    ) as ImageEl;
    expect(flipped.x).toBe(30);
    expect(flipped.flipped).toBe(true);
    const flippedBack = planStudioSelectionFlip([flipped], ["i"], "horizontal")!.find(
      (el) => el.id === "i",
    ) as ImageEl;
    expect(flippedBack.flipped).toBe(false);
    const vertical = planStudioSelectionFlip([only], ["i"], "vertical")!.find(
      (el) => el.id === "i",
    ) as ImageEl;
    expect(vertical.y).toBe(30);
    expect(vertical.flippedY).toBe(true);
  });

  it("reverses rotation and skew when it mirrors an image", () => {
    const rotated = image({
      id: "i",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      rotation: 30,
      skewX: 12,
      skewY: -4,
    } as Partial<ImageEl> & Pick<ImageEl, "id" | "x" | "y" | "width" | "height">);
    const flipped = planStudioSelectionFlip([rotated], ["i"], "horizontal")!.find(
      (el) => el.id === "i",
    ) as ImageEl & { skewX?: number; skewY?: number };
    expect(flipped.rotation).toBe(-30);
    expect(flipped.skewX).toBe(-12);
    expect(flipped.skewY).toBe(4);
    expect(flipped.flipped).toBe(true);
  });

  it("returns untouched references when a selection cannot mirror", () => {
    // A lone text block has no mirror flag and is already centred on the axis, so flipping
    // it must not manufacture a history entry.
    const only = text({ id: "t", x: 10, y: 10 });
    const next = planStudioSelectionFlip([only], ["t"], "horizontal");
    expect(next).not.toBeNull();
    expect(next![0]).toBe(only);
  });

  it("leaves a flat stroke where it is when flipped along its own axis", () => {
    // A horizontal flip of a vertical line must be a visual no-op. An off-centre padded box
    // would walk the stroke sideways by its stroke width on every press.
    let stroke = draw({ id: "s", points: [100, 0, 100, 200], strokeWidth: 6 });
    for (let press = 0; press < 3; press += 1) {
      stroke = planStudioSelectionFlip([stroke], ["s"], "horizontal")!.find(
        (el) => el.id === "s",
      ) as DrawEl;
      expect(stroke.points).toEqual([100, 0, 100, 200]);
    }
    expect(resolveStudioFigmaSelectionLayoutMetrics([stroke])!.width).toBe(6);
  });

  it("mirrors the pen direction channels along with the points", () => {
    const stroke = draw({
      id: "s",
      points: [0, 0, 40, 20],
      tiltXs: [30, 20],
      tiltYs: [10, 5],
      twists: [45, 60],
      brushTip: { tiltEnabled: false, angleDeg: -30, roundness: 0.35 },
    } as Partial<DrawEl> & Pick<DrawEl, "id" | "points">);
    const flipped = planStudioSelectionFlip([stroke], ["s"], "horizontal")!.find(
      (el) => el.id === "s",
    ) as DrawEl;
    expect(flipped.tiltXs).toEqual([-30, -20]);
    expect(flipped.tiltYs).toEqual([10, 5]);
    expect(flipped.twists).toEqual([-45, -60]);
    expect(flipped.brushTip?.angleDeg).toBe(30);
  });

  it("flips freehand strokes point by point", () => {
    const stroke = draw({ id: "s", points: [0, 0, 20, 10], strokeWidth: 2 });
    const flipped = planStudioSelectionFlip([stroke], ["s"], "vertical")!.find(
      (el) => el.id === "s",
    ) as DrawEl;
    expect(flipped.points[1]).toBeGreaterThan(flipped.points[3]!);
  });

  it("moves freehand strokes by the same padded bounds the panel displays", () => {
    const stroke = draw({ id: "s", points: [10, 10, 30, 10], strokeWidth: 6 });
    const patch = planStudioSelectionLayoutPatch(stroke, { x: 40, y: 50 });
    const moved = { ...stroke, ...patch } as El;
    const metrics = resolveStudioFigmaSelectionLayoutMetrics([moved]);
    // Typing the displayed X/Y back in must land the stroke exactly there — no half-width drift.
    expect(metrics!.x).toBe(40);
    expect(metrics!.y).toBe(50);
  });

  it("fits the transposed extents when the view is quarter-turned", () => {
    const bounds = { x: 0, y: 0, w: 400, h: 100 };
    const straight = planStudioZoomToSelection({
      bounds,
      viewportWidth: 800,
      viewportHeight: 400,
      documentWidth: 720,
      documentHeight: 1280,
      paddingRatio: 0,
      maxScale: 8,
      minScale: 0.1,
    });
    const turned = planStudioZoomToSelection({
      bounds,
      viewportWidth: 800,
      viewportHeight: 400,
      documentWidth: 720,
      documentHeight: 1280,
      canvasRotation: 90,
      paddingRatio: 0,
      maxScale: 8,
      minScale: 0.1,
    });
    // Straight: 400 wide into 800 → 2. Turned: the 400 extent lands on the 400-tall axis → 1.
    expect(straight!.scale).toBe(2);
    expect(turned!.scale).toBe(1);
  });

  it("keeps the opacity field off frames, whose renderer ignores it", () => {
    const frame = {
      id: "f",
      type: "frame",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    } as unknown as El;
    expect(resolveStudioFigmaSelectionLayoutMetrics([frame])?.supportsOpacity).toBe(false);
    expect(planStudioSelectionLayoutPatch(frame, { opacity: 0.5 })).toBeNull();
  });

  it("opens W/H and rotation for a lone freehand stroke", () => {
    // The handles already scale and rotate a stroke by baking the box into `points`; the numeric
    // fields must not claim the object cannot do what it demonstrably does.
    const metrics = resolveStudioFigmaSelectionLayoutMetrics([
      draw({ id: "s", points: [10, 10, 110, 60], strokeWidth: 4 }),
    ]);
    expect(metrics).toMatchObject({
      hasFixedSize: true,
      supportsRotation: true,
      rotationIsRelative: true,
      rotation: 0,
      sizeDisabledReason: null,
      rotationDisabledReason: null,
    });
  });

  it("keeps rotation off box-derived shape strokes and says why", () => {
    // rect/ellipse/star/triangle/polygon render from the axis-aligned box of their points, so a
    // baked angle would only resize them. Size still works, and the field explains itself.
    for (const kind of ["rect", "ellipse", "star", "triangle", "polygon"] as const) {
      const metrics = resolveStudioFigmaSelectionLayoutMetrics([
        draw({ id: kind, kind, points: [0, 0, 80, 40], strokeWidth: 2 }),
      ]);
      expect(metrics!.hasFixedSize).toBe(true);
      expect(metrics!.supportsRotation).toBe(false);
      expect(metrics!.rotationDisabledReason).toContain("자유곡선");
    }
    for (const kind of ["line", "arrow"] as const) {
      const metrics = resolveStudioFigmaSelectionLayoutMetrics([
        draw({ id: kind, kind, points: [0, 0, 80, 40], strokeWidth: 2 }),
      ]);
      expect(metrics!.supportsRotation).toBe(true);
    }
  });

  it("keeps rotation off a mirrored-symmetry stroke, which the planner would translate instead", () => {
    // The renderer regenerates mirrored copies by reflecting the committed base about world axes,
    // so the commit planner drops the angle. This field turns the planner's origin rotation into a
    // centre rotation by pre-rotating the box, so a dropped angle would leave that pivot offset
    // behind: the stroke would MOVE, not turn. Offer nothing rather than a field that lies.
    for (const type of ["vertical", "horizontal", "kaleidoscope", "silk"] as const) {
      const stroke = draw({
        id: type,
        points: [10, 10, 110, 60],
        symmetry: { type, centerX: 60, centerY: 35 },
      });
      const metrics = resolveStudioFigmaSelectionLayoutMetrics([stroke]);
      expect(metrics!.supportsRotation).toBe(false);
      expect(metrics!.rotationDisabledReason).toContain("대칭");
      // And a typed angle is inert rather than a disguised move.
      expect(planStudioSelectionLayoutPatch(stroke, { rotation: 30 })).toBeNull();
    }
    // Radial copies are rotations about the same centre, so they commute with the frame and turn.
    const radial = draw({
      id: "radial",
      points: [10, 10, 110, 60],
      symmetry: { type: "radial", centerX: 60, centerY: 35, radialCount: 6 },
    });
    expect(resolveStudioFigmaSelectionLayoutMetrics([radial])!.supportsRotation).toBe(true);
    expect(planStudioSelectionLayoutPatch(radial, { rotation: 30 })).not.toBeNull();
  });

  it("resizes a stroke to exactly the width that was typed", () => {
    const stroke = draw({ id: "s", points: [10, 10, 110, 10, 110, 60], strokeWidth: 8 });
    const before = resolveStudioFigmaSelectionLayoutMetrics([stroke])!;
    const patch = planStudioSelectionLayoutPatch(stroke, {
      width: before.width * 1.5,
    }) as Partial<DrawEl>;
    const scaled = { ...stroke, ...patch } as DrawEl;
    const after = resolveStudioFigmaSelectionLayoutMetrics([scaled])!;
    expect(after.width).toBeCloseTo(before.width * 1.5, 3);
    // A W-only edit must leave the displayed H where the artist left it.
    expect(after.height).toBeCloseTo(before.height, 3);
    // Top-left anchored, exactly like the W/H fields on an image in this same panel.
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    // The ink itself grew — a stroke scaled by rewriting its points, not by resampling pixels.
    expect(scaled.points).not.toEqual(stroke.points);
    expect(scaled.strokeWidth).toBeGreaterThan(stroke.strokeWidth);
  });

  it("keeps the ratio on an aspect-locked stroke", () => {
    const stroke = draw({
      id: "s",
      kind: "rect",
      points: [0, 0, 100, 50],
      strokeWidth: 4,
      lockAspect: true,
    } as Partial<DrawEl> & Pick<DrawEl, "id" | "points">);
    const before = resolveStudioFigmaSelectionLayoutMetrics([stroke])!;
    const patch = planStudioSelectionLayoutPatch(stroke, { width: before.width * 2 });
    const after = resolveStudioFigmaSelectionLayoutMetrics([
      { ...stroke, ...patch } as El,
    ])!;
    expect(after.width / before.width).toBeCloseTo(2, 3);
    expect(after.height / before.height).toBeCloseTo(2, 3);
  });

  it("rotates a stroke about its centre and treats the field as a delta", () => {
    const stroke = draw({ id: "s", points: [0, 0, 100, 0], strokeWidth: 2 });
    const before = resolveStudioFigmaSelectionLayoutMetrics([stroke])!;
    const centreX = before.x + before.width / 2;
    const centreY = before.y + before.height / 2;
    const turned = {
      ...stroke,
      ...planStudioSelectionLayoutPatch(stroke, { rotation: 90 }),
    } as DrawEl;
    const after = resolveStudioFigmaSelectionLayoutMetrics([turned])!;
    // A quarter turn about the centre swaps the extents and leaves the centre alone.
    expect(after.width).toBeCloseTo(before.height, 3);
    expect(after.height).toBeCloseTo(before.width, 3);
    expect(after.x + after.width / 2).toBeCloseTo(centreX, 3);
    expect(after.y + after.height / 2).toBeCloseTo(centreY, 3);
    // Relative: four 90° presses come back to the start, and the field still reads 0.
    let round = stroke;
    for (let press = 0; press < 4; press += 1) {
      round = {
        ...round,
        ...planStudioSelectionLayoutPatch(round, { rotation: 90 }),
      } as DrawEl;
    }
    expect(after.rotation).toBe(0);
    round.points.forEach((value, index) => {
      expect(value).toBeCloseTo(stroke.points[index]!, 6);
    });
  });

  it("refuses no-op numeric edits so they never spend a history entry", () => {
    const stroke = draw({ id: "s", points: [10, 10, 90, 40], strokeWidth: 6 });
    const shown = resolveStudioFigmaSelectionLayoutMetrics([stroke])!;
    expect(planStudioSelectionLayoutPatch(stroke, { rotation: 0 })).toBeNull();
    expect(planStudioSelectionLayoutPatch(stroke, { rotation: 360 })).toBeNull();
    expect(planStudioSelectionLayoutPatch(stroke, { x: shown.x })).toBeNull();
    expect(planStudioSelectionLayoutPatch(stroke, { width: shown.width })).toBeNull();
    // A rotation typed onto a shape stroke is inert rather than a silent resize.
    const rect = draw({ id: "r", kind: "rect", points: [0, 0, 40, 20], strokeWidth: 2 });
    expect(planStudioSelectionLayoutPatch(rect, { rotation: 30 })).toBeNull();
  });

  it("carries a numeric resize through the same bake the handles use", async () => {
    // Not "similar maths" — the identical planner. A number typed into W and a handle dragged to
    // the same box must not be able to drift apart.
    const { planStudioDrawObjectTransform } = await import("./brush/studio-draw-object-transform");
    const stroke = draw({ id: "s", points: [4, 4, 84, 44], strokeWidth: 10 });
    const shown = unionStudioSelectionBounds([stroke])!;
    const patch = planStudioSelectionLayoutPatch(stroke, {
      x: shown.x + 25,
      y: shown.y - 10,
    }) as Partial<DrawEl>;
    const handle = planStudioDrawObjectTransform({
      el: stroke,
      sourceBounds: { x: shown.x, y: shown.y, width: shown.w, height: shown.h },
      targetBounds: {
        x: shown.x + 25,
        y: shown.y - 10,
        width: shown.w,
        height: shown.h,
      },
      rotationDeg: 0,
    })!;
    expect(patch.points).toEqual(handle.points);
    expect(patch.strokeWidth).toBeUndefined();
    expect(handle.strokeWidth).toBe(stroke.strokeWidth);
  });

  it("only emits the geometry keys the transform can move", () => {
    const stroke = draw({ id: "s", points: [0, 0, 60, 30], strokeWidth: 4 });
    const patch = planStudioSelectionLayoutPatch(stroke, { width: 200, opacity: 0.4 })!;
    expect(Object.keys(patch).sort()).toEqual(["opacity", "points", "strokeWidth"]);
  });

  it("reports Figma-like layout metrics for a single image", () => {
    const metrics = resolveStudioFigmaSelectionLayoutMetrics([
      image({ id: "i", x: 12, y: 24, width: 80, height: 40, opacity: 0.5, rotation: 15 }),
    ]);
    expect(metrics).toMatchObject({
      x: 12,
      y: 24,
      width: 80,
      height: 40,
      opacity: 0.5,
      rotation: 15,
      hasFixedSize: true,
      supportsOpacity: true,
      supportsRotation: true,
      elementCount: 1,
    });
  });

  it("allows a zero-degree text element to receive its first stored rotation", () => {
    const element = text({ id: "t", x: 10, y: 20 });
    expect("rotation" in element).toBe(false);
    expect(resolveStudioFigmaSelectionLayoutMetrics([element])?.supportsRotation).toBe(true);
    expect(planStudioSelectionLayoutPatch(element, { rotation: 30 })).toEqual({
      rotation: 30,
    });
  });

  it.each([
    ["집중선", focusLines()],
    ["속도선", speedLines()],
  ] as const)("keeps stored rotation editable for %s", (_label, element) => {
    expect(resolveStudioFigmaSelectionLayoutMetrics([element])).toMatchObject({
      rotation: 12,
      supportsRotation: true,
      rotationDisabledReason: null,
    });
    expect(planStudioSelectionLayoutPatch(element, { rotation: 37 })).toEqual({
      rotation: 37,
    });
  });

  it("moves a multi-selection without collapsing spacing and applies opacity once", () => {
    const a = image({ id: "a", x: 10, y: 20, width: 40, height: 30, opacity: 0.25 });
    const b = image({ id: "b", x: 80, y: 60, width: 20, height: 20, opacity: 0.75 });
    const next = planStudioMultiSelectionLayoutPatch(
      [a, b],
      ["a", "b"],
      { x: 40, y: 50, opacity: 0.6 },
    );
    expect(next).not.toBeNull();
    const movedA = next!.find((element) => element.id === "a") as ImageEl;
    const movedB = next!.find((element) => element.id === "b") as ImageEl;
    expect(movedA.x).toBe(40);
    expect(movedA.y).toBe(50);
    expect(movedB.x - movedA.x).toBe(70);
    expect(movedB.y - movedA.y).toBe(40);
    expect(movedA.opacity).toBe(0.6);
    expect(movedB.opacity).toBe(0.6);

    expect(resolveStudioFigmaSelectionLayoutMetrics([a, b])).toMatchObject({
      elementCount: 2,
      opacityMixed: true,
      supportsOpacity: true,
    });
  });

  it("moves freehand ink in a group by the exact shared delta", () => {
    const stroke = draw({ id: "s", points: [10, 20, 30, 20], strokeWidth: 8 });
    const picture = image({ id: "i", x: 80, y: 60, width: 20, height: 20 });
    const before = unionStudioSelectionBounds([stroke, picture])!;
    const strokeBefore = unionStudioSelectionBounds([stroke])!;
    const next = planStudioMultiSelectionLayoutPatch(
      [stroke, picture],
      ["s", "i"],
      { x: before.x + 25, y: before.y - 10 },
    )!;
    const movedStroke = next.find((element) => element.id === "s")!;
    const strokeAfter = unionStudioSelectionBounds([movedStroke])!;
    expect(strokeAfter.x - strokeBefore.x).toBeCloseTo(25, 6);
    expect(strokeAfter.y - strokeBefore.y).toBeCloseTo(-10, 6);
  });
});
