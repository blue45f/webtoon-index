import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_RUNTIME_CONTRACT,
  resolveStudioBrushRuntimeContract,
} from "./brush/studio-brush-runtime-contract";
import {
  planStudioAngledNibStrokeLocalCoverage,
  studioAngledNibCoverageWorkUpperBound,
} from "./brush/studio-stroke-local-coverage";
import { resolveStudioBrushRenderFamily } from "./studio-brush";
import { studioLiveTransformPreviewBlockedForElement } from "./studio-live-transform-preview-eligibility";
import { studioRetainedMediaMaximumSizeScale } from "./studio-retained-media-pressure";

import type { El } from "./studio-element-model";

/**
 * The evidence behind admitting `angled-ribbon` to the exact-draft allowlist.
 *
 * `studio-live-transform-preview-eligibility` keys on the ENGINE, but the pixels come from
 * `StudioDrawNode`'s FAMILY branch. Those are two different lookups over two different tables, so
 * an engine entry is only a licence for the branch that was actually audited while the two agree.
 * Everything below is a property this admission depends on; if one of these fails, the allowlist
 * entry is unsupported and has to come back out rather than be patched around.
 */
describe("angled-ribbon exact-draft admission evidence", () => {
  const angledRibbonIds = STUDIO_BRUSH_RUNTIME_CONTRACT
    .filter((contract) => contract.engine === "angled-ribbon")
    .map((contract) => contract.id);

  it("covers at least the two shipped nib presets", () => {
    expect(angledRibbonIds).toEqual(expect.arrayContaining(["brush", "flat-brush"]));
  });

  it("routes every angled-ribbon id through the audited brushFamily branch", () => {
    // `StudioDrawNode` selects its renderer with `resolveStudioBrushRenderFamily`, whose lookup
    // falls back to lane bases and then to keyword regexes. A future preset given the
    // angled-ribbon engine but, say, a "marker" in its id would resolve to a different branch and
    // silently inherit an audit it never had.
    for (const id of angledRibbonIds) {
      expect(resolveStudioBrushRenderFamily(id), id).toBe("brush");
    }
  });

  it("paints, rather than erases -- the composite an isolated draft Layer can show", () => {
    for (const id of angledRibbonIds) {
      expect(resolveStudioBrushRuntimeContract(id)?.operation ?? "paint", id).toBe("paint");
    }
  });

  it("replans deterministically: identical input, byte-identical plan", () => {
    // No seed, no clock, no `Math.random`, no coordinate hash. This is what lets the draft show
    // the commit rather than an approximation of it.
    const points = [0, 0, 12, 4, 26, 3, 40, 14, 51, 30];
    const first = planStudioAngledNibStrokeLocalCoverage(points, 8);
    const second = planStudioAngledNibStrokeLocalCoverage(points, 8);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("keeps the nib angle world-fixed, so the draft turns exactly the way the commit does", () => {
    // The offset is `radius * (cos(theta), sin(theta))` with theta fixed at -30deg for both the
    // draft and the commit, so rotating a stroke re-lays the ribbon instead of turning it. The
    // draft is allowed to look "wrong" here; it is required to look like release.
    const horizontal = planStudioAngledNibStrokeLocalCoverage([0, 0, 40, 0], 10);
    const vertical = planStudioAngledNibStrokeLocalCoverage([0, 0, 0, 40], 10);
    const nibOffset = (plan: ReturnType<typeof planStudioAngledNibStrokeLocalCoverage>) => {
      const polygon = plan.polygons[0]!.points;
      // Vertices are emitted as centre-nib, centre+nib, end+nib, end-nib.
      return [
        (polygon[2]! - polygon[0]!) / 2,
        (polygon[3]! - polygon[1]!) / 2,
      ] as const;
    };
    expect(nibOffset(horizontal)[0]).toBeCloseTo(nibOffset(vertical)[0], 10);
    expect(nibOffset(horizontal)[1]).toBeCloseTo(nibOffset(vertical)[1], 10);
    expect(nibOffset(horizontal)[0]).toBeCloseTo(5 * Math.cos(-Math.PI / 6), 10);
  });

  it("never emits more polygons than the compiled work bound charges for", () => {
    // Work admission decides BEFORE planning, from the sample count alone. An emission the bound
    // does not cover is a long task the gate believed it had already refused.
    for (const pointCount of [2, 3, 17, 64, 257]) {
      const points: number[] = [];
      for (let index = 0; index < pointCount; index += 1) {
        points.push(index * 3.5, Math.sin(index) * 9);
      }
      const plan = planStudioAngledNibStrokeLocalCoverage(points, 6);
      const bound = studioAngledNibCoverageWorkUpperBound(pointCount);
      // Bands partition the same polygons, so the painted total can never exceed the emission.
      const bandedPolygons = plan.bands.reduce(
        (total, band) => total + band.polygons.length,
        0,
      );
      expect(bandedPolygons, `${pointCount} points`).toBeLessThanOrEqual(plan.polygons.length);
      expect(plan.polygons.length * 8, `${pointCount} points`)
        .toBeLessThanOrEqual(bound.canvasCoordinateScalars);
      expect(plan.polygons.length * 5, `${pointCount} points`)
        .toBeLessThanOrEqual(bound.canvasPathCommands);
      for (const polygon of plan.polygons) {
        expect(polygon.points.length, `${pointCount} points`).toBe(8);
      }
    }
  });

  it("bounds the nib radius the budget charges by the profile's heaviest response", () => {
    // `resolveStudioRetainedMediaPressureSeries` is monotonic above its neutral plateau and peaks
    // at `size.heavy`; the minimum-diameter floor is capped at 1 and so cannot lift it further.
    for (const profileId of ["brush", "flat-brush", "marker-chisel"] as const) {
      const maximum = studioRetainedMediaMaximumSizeScale(profileId);
      expect(maximum, profileId).toBeGreaterThan(1);
      const widest = planStudioAngledNibStrokeLocalCoverage([0, 0, 30, 0], 10, -Math.PI / 6, {
        profileId,
        pressures: [1, 1],
        elementOpacity: 1,
      });
      const polygon = widest.polygons[0]!.points;
      const halfWidth = Math.hypot(
        (polygon[2]! - polygon[0]!) / 2,
        (polygon[3]! - polygon[1]!) / 2,
      );
      expect(halfWidth, profileId).toBeLessThanOrEqual(10 / 2 * maximum + 1e-9);
    }
  });

  it("gives the shipped nib presets a live preview, and still refuses the unaudited neighbours", () => {
    const draw = (brush: string): El => ({
      id: "draw-1",
      type: "draw",
      points: [0, 0, 10, 10],
      stroke: "#101010",
      strokeWidth: 4,
      sampleSpacing: 2,
      brush,
    } as unknown as El);
    for (const id of angledRibbonIds) {
      expect(studioLiveTransformPreviewBlockedForElement(draw(id), false), id).toBe(false);
    }
    // A different engine in the same neighbourhood keeps commit-at-release until someone audits
    // its own branch; the entry added here is not a licence for the family around it.
    for (const unaudited of ["dry-media", "oil-paint", "watercolor"]) {
      expect(
        studioLiveTransformPreviewBlockedForElement(draw(unaudited), false),
        unaudited,
      ).toBe(true);
    }
  });
});
