/**
 * Contract for the single-stroke free affine transform.
 *
 * The load-bearing claims are (a) the geometry is exact, (b) it agrees with the group planner
 * wherever their domains overlap, and (c) the stroke stays a *vector* — the transform lands in
 * `points`, never as a residual node scale that would resample rasterized ink.
 */
import { describe, expect, it } from "vitest";

import { planStudioGroupUniformResize } from "../studio-group-uniform-resize";

import {
  planStudioDrawObjectTransform,
  planStudioDrawObjectTransformWithBounds,
  studioDrawObjectTransformScale,
} from "./studio-draw-object-transform";

import type { DrawEl } from "../studio-element-model";

function drawEl(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "draw-1",
    type: "draw",
    points: [0, 0, 10, 0, 10, 10, 0, 10],
    stroke: "#101010",
    strokeWidth: 4,
    ...overrides,
  };
}

const UNIT_SOURCE = { x: 0, y: 0, width: 10, height: 10 } as const;

/** Largest coordinate error against an expected point array. */
function maxPointError(actual: readonly number[], expected: readonly number[]): number {
  expect(actual).toHaveLength(expected.length);
  let worst = 0;
  for (let index = 0; index < actual.length; index += 1) {
    worst = Math.max(worst, Math.abs(actual[index]! - expected[index]!));
  }
  return worst;
}

describe("studioDrawObjectTransformScale", () => {
  it("reports uniform scale for a proportional box change", () => {
    const scale = studioDrawObjectTransformScale(UNIT_SOURCE, {
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });

    expect(scale).toEqual({
      scaleX: 2.5,
      scaleY: 2.5,
      uniformEquivalent: 2.5,
      uniform: true,
    });
  });

  it("flags a non-uniform box change and returns the area-preserving mean", () => {
    const scale = studioDrawObjectTransformScale(UNIT_SOURCE, {
      x: 0,
      y: 0,
      width: 40,
      height: 10,
    });

    expect(scale?.scaleX).toBe(4);
    expect(scale?.scaleY).toBe(1);
    expect(scale?.uniform).toBe(false);
    expect(scale?.uniformEquivalent).toBe(2);
  });

  it("rejects degenerate boxes instead of dividing by zero", () => {
    expect(studioDrawObjectTransformScale(UNIT_SOURCE, { x: 0, y: 0, width: 0, height: 5 }))
      .toBeNull();
    expect(studioDrawObjectTransformScale({ ...UNIT_SOURCE, height: 0 }, UNIT_SOURCE))
      .toBeNull();
    expect(
      studioDrawObjectTransformScale(UNIT_SOURCE, {
        x: Number.NaN,
        y: 0,
        width: 5,
        height: 5,
      }),
    ).toBeNull();
  });
});

describe("planStudioDrawObjectTransform · scaling", () => {
  it("returns exact transformed point bounds from the same traversal", () => {
    const plan = planStudioDrawObjectTransformWithBounds({
      el: drawEl({ points: [0, 0, 10, 0, 4, 10] }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 5, y: 7, width: 20, height: 10 },
      rotationDeg: 90,
    });

    expect(plan?.bounds.x).toBeCloseTo(-5);
    expect(plan?.bounds.y).toBeCloseTo(7);
    expect(plan?.bounds.w).toBeCloseTo(10);
    expect(plan?.bounds.h).toBeCloseTo(20);
  });

  it("scales point coordinates exactly, so the stroke is re-rendered rather than resampled", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl(),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 20, height: 20 },
    });

    // Every coordinate doubled: the geometry itself changed, so the rasterizer draws crisp edges
    // at the new size. A residual node scale would have left `points` untouched.
    expect(next?.points).toEqual([0, 0, 20, 0, 20, 20, 0, 20]);
    expect(next?.points).not.toEqual(drawEl().points);
  });

  it("scales brush width with the object under the default policy", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl({ strokeWidth: 4, sampleSpacing: 3 }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 30, height: 30 },
    });

    expect(next?.strokeWidth).toBe(12);
    expect(next?.sampleSpacing).toBe(9);
  });

  it("keeps the authored width when the caller asks to preserve it", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl({ strokeWidth: 4, sampleSpacing: 3 }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 30, height: 30 },
      strokeWidthPolicy: "preserve",
    });

    expect(next?.strokeWidth).toBe(4);
    expect(next?.sampleSpacing).toBe(3);
  });

  it("deforms the path exactly under a non-uniform scale and keeps nib area", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl({ strokeWidth: 4 }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 40, height: 10 },
    });

    // Path follows the box exactly — x quadrupled, y unchanged.
    expect(next?.points).toEqual([0, 0, 40, 0, 40, 10, 0, 10]);
    // A round nib cannot become elliptical, so width takes the area-preserving mean (sqrt(4*1)).
    expect(next?.strokeWidth).toBe(8);
  });

  it("translates the stroke when the target box moves", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl(),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 100, y: -50, width: 10, height: 10 },
    });

    expect(next?.points).toEqual([100, -50, 110, -50, 110, -40, 100, -40]);
    expect(next?.strokeWidth).toBe(4);
  });
});

describe("planStudioDrawObjectTransform · rotation", () => {
  it("rotates 90 degrees about the target box origin", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl({ points: [0, 0, 10, 0] }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 10, height: 10 },
      rotationDeg: 90,
    });

    // (10,0) -> (0,10) for a clockwise-positive rotation, matching Konva's convention.
    expect(maxPointError(next!.points, [0, 0, 0, 10])).toBeLessThan(1e-9);
  });

  it("preserves segment lengths under pure rotation", () => {
    const el = drawEl({ points: [0, 0, 6, 8] });
    const next = planStudioDrawObjectTransform({
      el,
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 10, height: 10 },
      rotationDeg: 37,
    });

    const before = Math.hypot(el.points[2]! - el.points[0]!, el.points[3]! - el.points[1]!);
    const after = Math.hypot(
      next!.points[2]! - next!.points[0]!,
      next!.points[3]! - next!.points[1]!,
    );
    expect(Math.abs(after - before)).toBeLessThan(1e-9);
    // Pure rotation must not re-weight the line.
    expect(next?.strokeWidth).toBe(4);
  });

  it("returns to the original geometry after a full turn", () => {
    const el = drawEl({ points: [3, 7, -2, 11, 5, 5] });
    const next = planStudioDrawObjectTransform({
      el,
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 10, height: 10 },
      rotationDeg: 360,
    });

    expect(maxPointError(next!.points, el.points)).toBeLessThan(1e-9);
  });

  it("round-trips a rotation and its inverse back to the source geometry", () => {
    const el = drawEl({ points: [1, 2, 9, 4, 5, 9] });
    const rotated = planStudioDrawObjectTransform({
      el,
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 10, height: 10 },
      rotationDeg: 30,
    });
    const restored = planStudioDrawObjectTransform({
      el: rotated!,
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 10, height: 10 },
      rotationDeg: -30,
    });

    expect(maxPointError(restored!.points, el.points)).toBeLessThan(1e-9);
  });

  it("composes rotation with non-uniform scale in scale-then-rotate order", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl({ points: [0, 0, 10, 0] }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 5, y: 5, width: 20, height: 10 },
      rotationDeg: 90,
    });

    // (10,0) scales to (20,0), then rotates to (0,20), then translates by the target origin.
    expect(maxPointError(next!.points, [5, 5, 5, 25])).toBeLessThan(1e-9);
  });

  it("drops the turn for a mirrored-symmetry stroke instead of tearing it against its copies", () => {
    // The renderer re-reflects the committed base about world axes, so a turned base would put
    // every mirrored copy at -theta. The move and resize still land; only the angle is dropped.
    const el = drawEl({
      points: [0, 0, 10, 0],
      symmetry: { type: "vertical", centerX: 5, centerY: 5 },
    });
    const rotateOnly = planStudioDrawObjectTransform({
      el,
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 90,
    });
    // A dropped turn with nothing else to do must hand back the original reference.
    expect(rotateOnly).toBe(el);

    const moved = planStudioDrawObjectTransform({
      el,
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 5, y: 5, width: 20, height: 20 },
      rotationDeg: 90,
    });
    expect(maxPointError(moved!.points, [5, 5, 25, 5])).toBeLessThan(1e-9);
    expect(moved?.symmetry).toEqual({ type: "vertical", centerX: 15, centerY: 15 });
  });

  it("keeps the turn for radial symmetry, whose copies commute with the rotation", () => {
    const plain = planStudioDrawObjectTransform({
      el: drawEl({ points: [0, 0, 10, 0] }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 90,
    });
    const radial = planStudioDrawObjectTransform({
      el: drawEl({
        points: [0, 0, 10, 0],
        symmetry: { type: "radial", centerX: 5, centerY: 5, radialCount: 6 },
      }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 90,
    });

    expect(maxPointError(radial!.points, plain!.points)).toBeLessThan(1e-9);
    // The centre turns with the stroke: (5,5) about the origin lands at (-5,5).
    expect(radial?.symmetry?.centerX).toBeCloseTo(-5, 9);
    expect(radial?.symmetry?.centerY).toBeCloseTo(5, 9);
    expect(radial?.symmetry?.radialCount).toBe(6);
  });
});

describe("planStudioDrawObjectTransform · companion geometry", () => {
  it("moves the symmetry centre with the stroke", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl({
        symmetry: { type: "radial", centerX: 5, centerY: 5, radialCount: 4 },
      }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 20, height: 20 },
    });

    expect(next?.symmetry).toEqual({
      type: "radial",
      centerX: 10,
      centerY: 10,
      radialCount: 4,
    });
  });

  it("scales the corner radius but leaves scale-free shape counts alone", () => {
    const next = planStudioDrawObjectTransform({
      el: drawEl({
        shapeParams: {
          starPoints: 5,
          starInnerRatio: 0.5,
          polygonSides: 6,
          cornerRadius: 3,
        },
      }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 20, height: 20 },
    });

    expect(next?.shapeParams).toEqual({
      starPoints: 5,
      starInnerRatio: 0.5,
      polygonSides: 6,
      cornerRadius: 6,
    });
  });

  it("carries unrelated authored fields through untouched", () => {
    const el = drawEl({ brush: "ink-brush", opacity: 0.6, mode: "pen" });
    const next = planStudioDrawObjectTransform({
      el,
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 20, height: 20 },
    });

    expect(next?.brush).toBe("ink-brush");
    expect(next?.opacity).toBe(0.6);
    expect(next?.mode).toBe("pen");
    expect(next?.id).toBe(el.id);
  });

  it("does not mutate the source element", () => {
    const el = drawEl();
    const snapshot = [...el.points];

    planStudioDrawObjectTransform({
      el,
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 20, height: 20 },
    });

    expect(el.points).toEqual(snapshot);
  });
});

describe("planStudioDrawObjectTransform · rejection", () => {
  it.each([
    ["non-finite point", drawEl({ points: [0, 0, Number.NaN, 4] })],
    ["odd point array", drawEl({ points: [0, 0, 5] })],
    ["empty points", drawEl({ points: [] })],
    ["negative stroke width", drawEl({ strokeWidth: -1 })],
    [
      "non-finite symmetry centre",
      drawEl({
        symmetry: { type: "vertical", centerX: Number.POSITIVE_INFINITY, centerY: 0 },
      }),
    ],
  ])("returns null for %s rather than a partial transform", (_label, el) => {
    expect(
      planStudioDrawObjectTransform({
        el,
        sourceBounds: UNIT_SOURCE,
        targetBounds: { x: 0, y: 0, width: 20, height: 20 },
      }),
    ).toBeNull();
  });

  it("returns null for a non-finite rotation", () => {
    expect(
      planStudioDrawObjectTransform({
        el: drawEl(),
        sourceBounds: UNIT_SOURCE,
        targetBounds: { x: 0, y: 0, width: 20, height: 20 },
        rotationDeg: Number.NaN,
      }),
    ).toBeNull();
  });
});

describe("agreement with the group uniform planner", () => {
  it("matches planStudioGroupUniformResize on the uniform, unrotated domain they share", () => {
    const el = drawEl({ points: [2, 3, 8, 9, 4, 6], strokeWidth: 5, sampleSpacing: 2 });
    const sourceBounds = { x: 1, y: 1, width: 10, height: 10 };
    const targetBounds = { x: 4, y: -2, width: 25, height: 25 };

    const single = planStudioDrawObjectTransform({
      el,
      sourceBounds,
      targetBounds,
      rotationDeg: 0,
      // The group planner preserves authored widths by default; compare like for like.
      strokeWidthPolicy: "preserve",
    });
    const grouped = planStudioGroupUniformResize({
      items: [el],
      selectedIds: [el.id],
      sourceBounds,
      targetBounds,
      isLocked: () => false,
    });

    const groupedDraw = grouped[0] as DrawEl;
    expect(maxPointError(single!.points, groupedDraw.points)).toBeLessThan(1e-9);
    expect(single?.strokeWidth).toBe(groupedDraw.strokeWidth);
    expect(single?.sampleSpacing).toBe(groupedDraw.sampleSpacing);
  });
});

describe("orientation-dependent nibs", () => {
  // Per-sample stylus channels are NOT transformed here — see the planner's note. Strokes that
  // carry them are excluded from the live preview instead, so the commit replays them as authored.
  const NIB = { tiltEnabled: false, angleDeg: -30, roundness: 0.35 } as const;

  it("turns the nib with the stroke so the commit matches what the preview showed", () => {
    // The preview rotates the whole rendered subtree, nib included. `brushTip.angleDeg` feeds
    // Konva's `rotation` prop for the calligraphy Ellipse in the same clockwise-degree convention,
    // so the commit has to compose the two or the nib snaps back at pointer-up.
    const rotated = planStudioDrawObjectTransform({
      el: drawEl({ brushTip: { ...NIB } }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });

    expect(rotated?.brushTip?.angleDeg).toBe(15);
    // Everything else about the tip is carried through untouched.
    expect(rotated?.brushTip?.roundness).toBe(NIB.roundness);
    expect(rotated?.brushTip?.tiltEnabled).toBe(NIB.tiltEnabled);
  });

  it("wraps to (-180, 180] so repeated rotations cannot drift the stored angle", () => {
    const rotated = planStudioDrawObjectTransform({
      el: drawEl({ brushTip: { ...NIB, angleDeg: 170 } }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 30,
    });

    // 200deg is the same orientation as -160deg; storing the wrapped form keeps the field bounded
    // however many times a stroke is rotated.
    expect(rotated?.brushTip?.angleDeg).toBe(-160);
  });

  it("leaves the nib alone when the transform carries no rotation", () => {
    const scaledOnly = planStudioDrawObjectTransform({
      el: drawEl({ brushTip: { ...NIB } }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 20, height: 20 },
      rotationDeg: 0,
    });

    expect(scaledOnly?.brushTip).toEqual(NIB);
  });

  it("rotates a tilt-disabled nib even when inert sample arrays are present", () => {
    // The renderer uses brushTip.angleDeg only as the fallback for samples WITHOUT tilt, and
    // atan2(tiltY, tiltX) + twist for samples with it. Rotating the fallback on a mixed stroke
    // would turn half the nib and leave the other half, distorting the commit.
    const rotated = planStudioDrawObjectTransform({
      el: drawEl({ brushTip: { ...NIB }, tiltXs: [1, 0], tiltYs: [0, 1] }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });

    expect(rotated?.brushTip).toEqual({ ...NIB, angleDeg: 15 });
  });

  it("treats zero-filled calligraphy channels as inert but preserves effective pen orientation", () => {
    const zeroFilled = planStudioDrawObjectTransform({
      el: drawEl({
        brush: "fountain-pen",
        tiltXs: [0, 0],
        tiltYs: [0, 0],
        twists: [0, 0],
      }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });
    expect(zeroFilled?.brushTip?.angleDeg).toBe(75);

    const oriented = planStudioDrawObjectTransform({
      el: drawEl({
        brush: "fountain-pen",
        tiltXs: [10, 0],
        tiltYs: [0, 10],
        twists: [0, 20],
      }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });
    expect(oriented).not.toBeNull();
    expect("brushTip" in oriented!).toBe(false);

    const partiallyMalformed = planStudioDrawObjectTransform({
      el: drawEl({
        brush: "fountain-pen",
        tiltXs: [20, 20],
        tiltYs: [Number.NaN, Number.NaN],
      }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });
    expect(partiallyMalformed).not.toBeNull();
    expect("brushTip" in partiallyMalformed!).toBe(false);
  });

  it("refuses a transform whose width the CRDT payload validator would reject", () => {
    // validatePayload asserts strokeWidth within [0.01, MAX_STROKE_WIDTH]. Without this the
    // transform applies locally and then fails publication, so the collaborator's document
    // silently diverges from the author's.
    expect(
      planStudioDrawObjectTransform({
        el: drawEl({ strokeWidth: 5_000 }),
        sourceBounds: UNIT_SOURCE,
        targetBounds: { x: 0, y: 0, width: 20, height: 20 },
        rotationDeg: 0,
      }),
    ).toBeNull();
    // And the other end of the range.
    expect(
      planStudioDrawObjectTransform({
        el: drawEl({ strokeWidth: 0.02 }),
        sourceBounds: UNIT_SOURCE,
        targetBounds: { x: 0, y: 0, width: 1, height: 1 },
        rotationDeg: 0,
      }),
    ).toBeNull();
    // Well inside the range, the same gesture is fine.
    expect(
      planStudioDrawObjectTransform({
        el: drawEl({ strokeWidth: 10 }),
        sourceBounds: UNIT_SOURCE,
        targetBounds: { x: 0, y: 0, width: 20, height: 20 },
        rotationDeg: 0,
      })?.strokeWidth,
    ).toBe(20);
  });

  it("refuses a transform whose coordinates the CRDT payload validator would reject", () => {
    // validatePayload asserts every coordinate within +/-MAX_COORDINATE, so a stroke near that
    // boundary can be moved to a finite-but-unpublishable position: it applies locally and then
    // fails publication, leaving the author ahead of every collaborator.
    expect(
      planStudioDrawObjectTransform({
        el: drawEl({ points: [0, 0, 10, 10] }),
        sourceBounds: UNIT_SOURCE,
        targetBounds: { x: 9_999_999, y: 0, width: 10, height: 10 },
        rotationDeg: 0,
      }),
    ).toBeNull();
    // A move that stays inside the range is fine.
    expect(
      planStudioDrawObjectTransform({
        el: drawEl({ points: [0, 0, 10, 10] }),
        sourceBounds: UNIT_SOURCE,
        targetBounds: { x: 1_000, y: 0, width: 10, height: 10 },
        rotationDeg: 0,
      }),
    ).not.toBeNull();
  });

  it("drops the rotation for bounds-derived shapes instead of collapsing them", () => {
    // StudioDrawNode rebuilds these from drawBounds(points) as axis-aligned primitives, so a
    // rotated point array cannot carry the turn -- and destroys the shape trying. A square stored
    // as its diagonal puts both endpoints on one vertical line under a 45deg rotation.
    for (const kind of ["rect", "ellipse", "star", "triangle", "polygon"] as const) {
      const rotated = planStudioDrawObjectTransform({
        el: drawEl({ kind, points: [0, 0, 40, 40] }),
        sourceBounds: { x: 0, y: 0, width: 40, height: 40 },
        targetBounds: { x: 0, y: 0, width: 40, height: 40 },
        rotationDeg: 45,
      });

      expect(rotated, kind).not.toBeNull();
      // Unrotated: the stored diagonal survives, so the shape still has both extents.
      expect(rotated?.points, kind).toEqual([0, 0, 40, 40]);
    }
  });

  it("returns the ORIGINAL element for a rotate-only gesture on a bounds-derived shape", () => {
    // commitCanvasSelectionResize decides "did anything change?" by object identity, so a fresh
    // element with identical numbers would publish an undo entry, a CRDT mutation and a "resized"
    // announcement for a gesture that changed nothing.
    const el = drawEl({ kind: "rect", points: [0, 0, 40, 40] });
    const rotated = planStudioDrawObjectTransform({
      el,
      sourceBounds: { x: 0, y: 0, width: 40, height: 40 },
      targetBounds: { x: 0, y: 0, width: 40, height: 40 },
      rotationDeg: 45,
    });

    expect(rotated).toBe(el);
  });

  it("clamps the scaled corner radius to the editor's own range", () => {
    // normalizeShapeParams clamps cornerRadius to 0-120 whenever the shape renders, and the live
    // payload validator enforces the same bounds, so an unclamped product is both invisible and
    // unpublishable — and the NEXT resize would compound from the hidden value.
    const scaled = planStudioDrawObjectTransform({
      el: drawEl({
        kind: "rect",
        points: [0, 0, 40, 40],
        shapeParams: {
          starPoints: 5,
          starInnerRatio: 0.5,
          polygonSides: 6,
          cornerRadius: 100,
        },
      }),
      sourceBounds: { x: 0, y: 0, width: 40, height: 40 },
      targetBounds: { x: 0, y: 0, width: 80, height: 80 },
      rotationDeg: 0,
    });

    expect(scaled?.shapeParams?.cornerRadius).toBe(120);
  });

  it("returns the ORIGINAL element for a rotate-only shape that carries metadata", () => {
    // shapeParams and symmetry are cloned by the transform, and the no-op guard compares by
    // identity (as commitCanvasSelectionResize does), so an always-fresh clone defeated it: a
    // rotate-only gesture on a star still pushed an undo entry and a CRDT mutation. The clones
    // now keep the original reference when nothing moved.
    const el = drawEl({
      kind: "star",
      points: [0, 0, 40, 40],
      shapeParams: {
        starPoints: 5,
        starInnerRatio: 0.5,
        polygonSides: 6,
        cornerRadius: 4,
      },
    });
    const rotated = planStudioDrawObjectTransform({
      el,
      sourceBounds: { x: 0, y: 0, width: 40, height: 40 },
      targetBounds: { x: 0, y: 0, width: 40, height: 40 },
      rotationDeg: 45,
    });

    expect(rotated).toBe(el);
  });

  it("rotates a legacy TAP from the fallback nib its own route renders", () => {
    // The two legacy routes disagree on the base nib: the multi-point ribbon resolves the
    // catalogue profile, while the single-point tap branch hardcodes angle -30 / roundness 0.35
    // and never consults the catalogue. Materializing the catalogue nib for a tap would rotate
    // from the wrong base — a fountain-pen tap would jump an extra 60 degrees at commit.
    const tap = planStudioDrawObjectTransform({
      el: drawEl({ brush: "fountain-pen", points: [5, 5] }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });

    // -30 (the tap's own fallback) + 45, not 30 (the catalogue profile) + 45.
    expect(tap?.brushTip?.angleDeg).toBe(15);
    expect(tap?.brushTip?.roundness).toBe(0.35);
    // The multi-point stroke still rotates from the catalogue profile.
    const ribbon = planStudioDrawObjectTransform({
      el: drawEl({ brush: "fountain-pen", points: [0, 0, 10, 10] }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });

    expect(ribbon?.brushTip?.angleDeg).toBe(75);
  });

  it("still moves and resizes a bounds-derived shape while dropping its rotation", () => {
    // Only the turn is refused -- the handle's move and resize must still land.
    const resized = planStudioDrawObjectTransform({
      el: drawEl({ kind: "rect", points: [0, 0, 40, 40] }),
      sourceBounds: { x: 0, y: 0, width: 40, height: 40 },
      targetBounds: { x: 10, y: 10, width: 80, height: 40 },
      rotationDeg: 45,
    });

    expect(resized?.points).toEqual([10, 10, 90, 50]);
  });

  it("still rotates a freehand stroke, which absorbs it exactly", () => {
    // The refusal is scoped to the bounds-derived kinds; nothing else loses its rotation.
    const rotated = planStudioDrawObjectTransform({
      el: drawEl({ points: [0, 0, 40, 0] }),
      sourceBounds: { x: 0, y: 0, width: 40, height: 40 },
      targetBounds: { x: 0, y: 0, width: 40, height: 40 },
      rotationDeg: 90,
    });

    expect(maxPointError(rotated!.points, [0, 0, 0, 40])).toBeLessThan(1e-9);
  });

  it("materializes a legacy stroke's catalogue nib so the rotation survives the commit", () => {
    // Pre-nib-table documents store no brushTip, and StudioDrawNode recovers one from the
    // catalogue before building the ribbon (resolveStudioCalligraphyRenderTip). Skipping those
    // would leave the recovered nib at its catalogue angle through every rotation while the
    // preview turned it, so the tip the renderer would have used is rotated and persisted.
    const rotated = planStudioDrawObjectTransform({
      el: drawEl({ brush: "fountain-pen" }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });

    // The catalogue nib sits at 30 degrees; the gesture adds 45.
    expect(rotated?.brushTip?.angleDeg).toBe(75);
    expect(rotated?.brushTip?.roundness).toBe(0.5);
    expect(rotated?.brushTip?.tiltEnabled).toBe(true);
  });

  it("does not materialize a nib for a legacy stroke that only moved or scaled", () => {
    // Nothing turned, so the document must not acquire a tip it never stored.
    const scaled = planStudioDrawObjectTransform({
      el: drawEl({ brush: "fountain-pen" }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: { x: 0, y: 0, width: 20, height: 20 },
      rotationDeg: 0,
    });

    expect(scaled).not.toBeNull();
    expect("brushTip" in scaled!).toBe(false);
  });

  it("leaves a legacy stroke's nib alone when it carries per-sample orientation", () => {
    const rotated = planStudioDrawObjectTransform({
      el: drawEl({ brush: "fountain-pen", tiltXs: [1, 0], tiltYs: [0, 1] }),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });

    expect(rotated).not.toBeNull();
    expect("brushTip" in rotated!).toBe(false);
  });

  it("leaves a stroke without a tip snapshot untouched", () => {
    const rotated = planStudioDrawObjectTransform({
      el: drawEl(),
      sourceBounds: UNIT_SOURCE,
      targetBounds: UNIT_SOURCE,
      rotationDeg: 45,
    });

    expect(rotated).not.toBeNull();
    expect("brushTip" in rotated!).toBe(false);
  });
});
