import { describe, expect, it } from "vitest";

import {
  studioLiveTransformRouteOfPoints,
  studioLiveTransformRouteSurvivesScale,
} from "./studio-live-transform-render-route";

/** A stroke comfortably inside every route: thick enough, long enough, densely sampled. */
const SAFE = {
  strokeWidth: 8,
  strokeDistance: 60,
  pointCount: 40,
  isPerfectFamily: true,
} as const;

describe("studioLiveTransformRouteSurvivesScale", () => {
  it("allows a stroke that stays well inside every route", () => {
    for (const scale of [0.5, 0.9, 1, 1.1, 1.7]) {
      expect(studioLiveTransformRouteSurvivesScale(SAFE, scale), `${scale}`).toBe(true);
    }
  });

  it("refuses the retained shortcut when the renderer requires an exact model draft", () => {
    expect(studioLiveTransformRouteSurvivesScale({
      ...SAFE,
      retainedAffinePolicy: "model-draft-only",
    }, 1)).toBe(false);
    expect(studioLiveTransformRouteSurvivesScale({
      ...SAFE,
      retainedAffinePolicy: "model-draft-only",
    }, 2)).toBe(false);
  });

  it("refuses a scale that drives the stroke under the renderer's 1px diameter floor", () => {
    // StudioDrawNode draws Math.max(1, el.strokeWidth). Halving a 1px stroke previews a 0.5px nib
    // and commits strokeWidth 0.5, which the renderer floors straight back to 1px.
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: 1 }, 0.5)).toBe(false);
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: 2 }, 0.25)).toBe(false);
    // Already below the floor, staying below it: the preview scales a 1px render while the commit
    // still floors to 1px, so they disagree too.
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: 0.5 }, 0.5)).toBe(false);
    // Scaling a sub-floor stroke UP past the floor also switches routes.
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: 0.5 }, 4)).toBe(false);
    // Away from the floor in both readings, it is exact.
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: 4 }, 0.5)).toBe(true);
  });

  it("refuses a scale that crosses the 16px compact-route cutoff", () => {
    // A 10px flick scaled 2x previews the enlarged compact fallback and commits a tapered outline.
    expect(
      studioLiveTransformRouteSurvivesScale(
        { strokeWidth: 8, strokeDistance: 10, pointCount: 3, isPerfectFamily: true },
        2,
      ),
    ).toBe(false);
    // And the reverse: a 20px stroke shrunk under the cutoff.
    expect(
      studioLiveTransformRouteSurvivesScale(
        { strokeWidth: 8, strokeDistance: 20, pointCount: 3, isPerfectFamily: true },
        0.5,
      ),
    ).toBe(false);
    // Comfortably short on both sides stays previewable.
    expect(
      studioLiveTransformRouteSurvivesScale(
        { strokeWidth: 8, strokeDistance: 4, pointCount: 3, isPerfectFamily: true },
        2,
      ),
    ).toBe(true);
  });

  it("refuses a scale that crosses the 180px sparse-long cutoff", () => {
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeDistance: 100 }, 2)).toBe(false);
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeDistance: 200 }, 0.5)).toBe(false);
  });

  it("refuses a scale that can cross the 120px degenerate-outline fallback", () => {
    // Legacy perfect strokes do not carry a captured outline contract. StudioDrawNode falls back
    // from a short/degenerate outline to a Line only while strokeDistance is under 120px. The
    // outline length itself is renderer output, so the retained preflight conservatively guards
    // the distance threshold for every legacy perfect stroke.
    expect(
      studioLiveTransformRouteSurvivesScale(
        { strokeWidth: 8, strokeDistance: 100, pointCount: 2, isPerfectFamily: true },
        1.5,
      ),
    ).toBe(false);
    expect(
      studioLiveTransformRouteSurvivesScale(
        { strokeWidth: 8, strokeDistance: 150, pointCount: 2, isPerfectFamily: true },
        0.5,
      ),
    ).toBe(false);
  });

  it("refuses a scale that flips the sparse-spacing predicate on its non-linear floor", () => {
    // The floor is Math.max(20, strokeWidth * 4), which is NOT linear in scale, so this can flip
    // even when both distance cutoffs hold. Spacing 24px against a floor of 20 (width 2) is
    // sparse; at 4x the spacing is 96 and the floor becomes max(20, 32) = 32, still sparse -- but
    // shrinking makes the floor stick at 20 while the spacing falls below it.
    const stroke = {
      strokeWidth: 2,
      strokeDistance: 240,
      pointCount: 11,
      isPerfectFamily: true,
    } as const;
    expect(studioLiveTransformRouteSurvivesScale(stroke, 0.5)).toBe(false);
  });

  it("refuses a scale that crosses the perfect-freehand 400px outline cap", () => {
    // studioPerfectFreehandStrokeOptions clamps the committed outline to 400px, so a 300px stroke
    // scaled 2x previews a 600px outline and re-renders at 400px.
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: 300 }, 2)).toBe(false);
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: 500 }, 0.5)).toBe(false);
    // Both readings under the cap: exact.
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: 100 }, 1.5)).toBe(true);
  });

  it("refuses a scale that crosses the 8px arrowhead floor, for strokes that draw one", () => {
    // The head is Math.max(8, strokeWidth * 2). A 2px arrow scaled 2x previews its existing 8px
    // head at 16px while the commit regenerates it at 8px.
    // strokeDistance 40 keeps both readings inside the 16/180 cutoffs at 2x, so this assertion
    // isolates the head floor rather than tripping a distance branch.
    const arrow = {
      strokeWidth: 2,
      strokeDistance: 40,
      pointCount: 40,
      drawsArrowHead: true,
      isPerfectFamily: true,
    } as const;
    expect(studioLiveTransformRouteSurvivesScale(arrow, 2)).toBe(false);
    // Above the floor on both sides, the head scales exactly.
    expect(
      studioLiveTransformRouteSurvivesScale({ ...arrow, strokeWidth: 20 }, 2),
    ).toBe(true);
    // A stroke that draws no head does not pay for the check.
    expect(
      studioLiveTransformRouteSurvivesScale({ ...arrow, drawsArrowHead: false }, 2),
    ).toBe(true);
  });

  it("refuses a rotation that can carry the AABB span across a route cutoff at scale 1", () => {
    // strokeDistance is an AABB DIAGONAL, not a rotation invariant: a 10x10 square spans 14.1px
    // upright and 20px at 45 degrees, crossing the 16px compact-dot cutoff on rotation alone.
    // The check grades the whole interval rotation can reach, so this stands down.
    const square = {
      strokeWidth: 8,
      strokeDistance: 14.1,
      pointCount: 4,
      isPerfectFamily: true,
    } as const;
    expect(studioLiveTransformRouteSurvivesScale({ ...square, rotationDeg: 45 }, 1)).toBe(false);
    // Upright, the same stroke is comfortably inside its route.
    expect(studioLiveTransformRouteSurvivesScale(square, 1)).toBe(true);
    // A full turn is not a rotation for this purpose.
    expect(studioLiveTransformRouteSurvivesScale({ ...square, rotationDeg: 360 }, 1)).toBe(true);
    // Far from every cutoff, a rotation is still previewable.
    expect(
      studioLiveTransformRouteSurvivesScale(
        {
          strokeWidth: 8,
          strokeDistance: 60,
          pointCount: 40,
          rotationDeg: 45,
          isPerfectFamily: true,
        },
        1,
      ),
    ).toBe(true);
  });

  it("refuses a scale that changes a compact dot's floored radius", () => {
    // A stroke can stay ON the compact-dot route and still be non-affine: perfect-ink never draws
    // a dot under 3px radius, so a 1px 4-point stroke scaled 2x previews a 6px-radius dot against
    // a regenerated 3px one.
    const dot = {
      strokeWidth: 1,
      strokeDistance: 5,
      pointCount: 4,
      isPerfectInk: true,
      isPerfectFamily: true,
    } as const;
    expect(studioLiveTransformRouteSurvivesScale(dot, 2)).toBe(false);
    // Above the floor on both sides, the dot scales exactly: radius 6 previews at 7.2 and the
    // commit regenerates 7.2 from the scaled width.
    expect(
      studioLiveTransformRouteSurvivesScale({ ...dot, strokeWidth: 12 }, 1.2),
    ).toBe(true);
  });

  it("grades the sparse-spacing predicate across the rotation interval too", () => {
    // The renderer derives this spacing from the ROTATED points' AABB distance, so a turn can
    // flip the predicate without crossing either distance cutoff: an 11-point diamond at 300px
    // and width 7 is sparse upright (30 >= 28) and not sparse at 45 degrees (21.2 < 28).
    const diamond = {
      strokeWidth: 7,
      strokeDistance: 300,
      pointCount: 11,
      isPerfectFamily: true,
    } as const;
    expect(studioLiveTransformRouteSurvivesScale({ ...diamond, rotationDeg: 45 }, 1)).toBe(false);
    // Upright it stays previewable.
    expect(studioLiveTransformRouteSurvivesScale(diamond, 1)).toBe(true);
  });

  it("applies the perfect-only route branches ONLY to the perfect family", () => {
    // The distance cutoffs, sparse predicate, dot floors and 400px outline cap all live inside
    // StudioDrawNode's perfect-freehand branch. Applying them to every allowlisted stroke rejected
    // previews over thresholds those renderers never consult: a causal-ink pen stroke spanning
    // 10px lost its live preview at 2x for a 16px cutoff that does not apply to it.
    const causalInk = { strokeWidth: 8, strokeDistance: 10, pointCount: 3 } as const;
    expect(studioLiveTransformRouteSurvivesScale(causalInk, 2)).toBe(true);
    // The identical stroke on the perfect family does cross, and is still refused.
    expect(
      studioLiveTransformRouteSurvivesScale({ ...causalInk, isPerfectFamily: true }, 2),
    ).toBe(false);
    // The 1px diameter floor is universal -- StudioDrawNode floors EVERY draw element -- so it
    // still applies with no perfect flag.
    expect(
      studioLiveTransformRouteSurvivesScale({ ...causalInk, strokeWidth: 1 }, 0.5),
    ).toBe(false);
  });

  it("refuses anything it cannot read, because an unreadable route is not a licence", () => {
    expect(studioLiveTransformRouteSurvivesScale(SAFE, Number.NaN)).toBe(false);
    expect(studioLiveTransformRouteSurvivesScale(SAFE, 0)).toBe(false);
    expect(studioLiveTransformRouteSurvivesScale(SAFE, -1)).toBe(false);
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeWidth: Number.NaN }, 2))
      .toBe(false);
    expect(studioLiveTransformRouteSurvivesScale({ ...SAFE, strokeDistance: Number.NaN }, 2))
      .toBe(false);
  });
});

describe("studioLiveTransformRouteOfPoints", () => {
  it("reads the renderer's own strokeDistance off the point bounds", () => {
    // hypot of the bounding span, matching StudioDrawNode's strokeSpanX/strokeSpanY reading.
    expect(studioLiveTransformRouteOfPoints([0, 0, 3, 4], 5)).toEqual({
      strokeWidth: 5,
      strokeDistance: 5,
      pointCount: 2,
      pathLength: 5,
    });
  });

  it("reports a zero-length route for an empty stroke rather than an infinity", () => {
    expect(studioLiveTransformRouteOfPoints([], 3)).toEqual({
      strokeWidth: 3,
      strokeDistance: 0,
      pointCount: 0,
      pathLength: 0,
    });
  });

  it("captures centreline travel once for exact-draft admission", () => {
    expect(studioLiveTransformRouteOfPoints([0, 0, 3, 4, 6, 8], 2).pathLength).toBe(10);
  });
});
