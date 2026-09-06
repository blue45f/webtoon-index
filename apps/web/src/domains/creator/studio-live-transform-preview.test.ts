/**
 * Contract for the engine-agnostic live transform preview projection.
 *
 * The load-bearing claims: (a) the attrs decomposition applied in scene-graph order
 * (translate ∘ rotate ∘ scale ∘ translate(−offset)) lands on exactly the points
 * `planStudioDrawObjectTransform` bakes at commit, (b) the stable-IR `Mat2d` projection is the
 * same affine, so a non-Konva document lane previews identical geometry, and (c) degenerate
 * frames are rejected as `null`, never as a partial projection.
 */
import { applyMat2d } from "@toonspectrum/studio-project-model";
import { describe, expect, it } from "vitest";

import { planStudioDrawObjectTransform } from "./brush/studio-draw-object-transform";
import {
  classifyStudioLiveTransformPreviewFrame,
  STUDIO_LIVE_TRANSFORM_PREVIEW_NEUTRAL_ATTRS,
  planStudioLiveTransformPreviewAttrs,
  studioLiveTransformPreviewMat2d,
} from "./studio-live-transform-preview";

import type { DrawEl } from "./studio-element-model";
import type { StudioLiveTransformPreviewNodeAttrs } from "./studio-live-transform-preview";

/** Konva's node transform order: translate(x,y) ∘ rotate ∘ scale ∘ translate(−offset). */
function applyNodeAttrs(
  attrs: StudioLiveTransformPreviewNodeAttrs,
  px: number,
  py: number
): [number, number] {
  const u = (px - attrs.offsetX) * attrs.scaleX;
  const v = (py - attrs.offsetY) * attrs.scaleY;
  const radians = (attrs.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [attrs.x + u * cos - v * sin, attrs.y + u * sin + v * cos];
}

function drawElementWithPoints(points: number[]): DrawEl {
  return {
    type: "draw",
    id: "live-preview-stroke",
    kind: "freehand",
    points,
    strokeWidth: 4,
    stroke: "#16100c",
    opacity: 1,
    hidden: false,
  } as unknown as DrawEl;
}

const SOURCE = { x: 100, y: 60, width: 200, height: 80 } as const;
const TARGET = { x: 140, y: 90, width: 300, height: 120 } as const;
const POINTS = [110, 70, 180, 95, 290, 130, 240, 66];

describe("planStudioLiveTransformPreviewAttrs", () => {
  it("projects the gesture to the exact points the commit planner bakes", () => {
    const rotationDeg = 27.5;
    const attrs = planStudioLiveTransformPreviewAttrs({
      sourceBounds: SOURCE,
      targetBounds: TARGET,
      rotationDeg,
    });
    expect(attrs).not.toBeNull();
    const baked = planStudioDrawObjectTransform({
      el: drawElementWithPoints(POINTS),
      sourceBounds: SOURCE,
      targetBounds: TARGET,
      rotationDeg,
    });
    expect(baked).not.toBeNull();

    for (let index = 0; index < POINTS.length; index += 2) {
      const [x, y] = applyNodeAttrs(attrs!, POINTS[index]!, POINTS[index + 1]!);
      expect(x).toBeCloseTo(baked!.points[index]!, 9);
      expect(y).toBeCloseTo(baked!.points[index + 1]!, 9);
    }
  });

  it("carries the decomposition verbatim: target origin, axis scales, source offset", () => {
    expect(
      planStudioLiveTransformPreviewAttrs({
        sourceBounds: SOURCE,
        targetBounds: TARGET,
        rotationDeg: 45,
      })
    ).toEqual({
      x: TARGET.x,
      y: TARGET.y,
      rotationDeg: 45,
      scaleX: 1.5,
      scaleY: 1.5,
      offsetX: SOURCE.x,
      offsetY: SOURCE.y,
    });
  });

  it("neutral attrs are the identity projection", () => {
    const [x, y] = applyNodeAttrs(STUDIO_LIVE_TRANSFORM_PREVIEW_NEUTRAL_ATTRS, 123.4, -56.7);
    expect(x).toBe(123.4);
    expect(y).toBe(-56.7);
  });

  it.each([
    ["zero-width target", SOURCE, { ...TARGET, width: 0 }, 0],
    ["negative-height target", SOURCE, { ...TARGET, height: -4 }, 0],
    ["non-finite source", { ...SOURCE, x: Number.NaN }, TARGET, 0],
    ["non-finite rotation", SOURCE, TARGET, Number.POSITIVE_INFINITY],
  ] as const)("rejects a degenerate frame (%s) as null", (_label, sourceBounds, targetBounds, rotationDeg) => {
    expect(
      planStudioLiveTransformPreviewAttrs({ sourceBounds, targetBounds, rotationDeg })
    ).toBeNull();
  });
});

describe("studioLiveTransformPreviewMat2d", () => {
  it("is the same affine as the attrs projection", () => {
    const frame = { sourceBounds: SOURCE, targetBounds: TARGET, rotationDeg: -33 };
    const attrs = planStudioLiveTransformPreviewAttrs(frame);
    const matrix = studioLiveTransformPreviewMat2d(frame);
    expect(attrs).not.toBeNull();
    expect(matrix).not.toBeNull();

    for (let index = 0; index < POINTS.length; index += 2) {
      const viaAttrs = applyNodeAttrs(attrs!, POINTS[index]!, POINTS[index + 1]!);
      const viaMatrix = applyMat2d(matrix!, POINTS[index]!, POINTS[index + 1]!);
      expect(viaMatrix[0]).toBeCloseTo(viaAttrs[0], 9);
      expect(viaMatrix[1]).toBeCloseTo(viaAttrs[1], 9);
    }
  });

  it("shares the attrs projection's rejection rules", () => {
    expect(
      studioLiveTransformPreviewMat2d({
        sourceBounds: SOURCE,
        targetBounds: { ...TARGET, width: Number.NaN },
        rotationDeg: 0,
      })
    ).toBeNull();
  });
});

describe("rejection reasons", () => {
  const SOURCE = { x: 0, y: 0, width: 100, height: 100 } as const;

  it("separates a valid-but-unsupported frame from a degenerate one", () => {
    // The two need opposite handling: a degenerate box holds the last projection (the next frame
    // recovers), while a valid non-uniform frame must neutralize or the ink freezes mid-gesture.
    expect(
      classifyStudioLiveTransformPreviewFrame({
        sourceBounds: SOURCE,
        targetBounds: { x: 0, y: 0, width: 200, height: 100 },
        rotationDeg: 0,
      }),
    ).toEqual({ ok: false, reason: "unsupported-non-uniform" });

    expect(
      classifyStudioLiveTransformPreviewFrame({
        sourceBounds: SOURCE,
        targetBounds: { x: 0, y: 0, width: 0, height: 100 },
        rotationDeg: 0,
      }),
    ).toEqual({ ok: false, reason: "invalid" });

    expect(
      classifyStudioLiveTransformPreviewFrame({
        sourceBounds: SOURCE,
        targetBounds: { x: 0, y: 0, width: 200, height: 100 },
        rotationDeg: Number.NaN,
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("returns the attrs on a supported frame", () => {
    const projection = classifyStudioLiveTransformPreviewFrame({
      sourceBounds: SOURCE,
      targetBounds: { x: 5, y: 6, width: 300, height: 300 },
      rotationDeg: 15,
    });

    expect(projection.ok).toBe(true);
    expect(projection.ok && projection.attrs.scaleX).toBeCloseTo(3, 9);
  });
});

describe("non-uniform frames", () => {
  const SOURCE = { x: 0, y: 0, width: 100, height: 100 } as const;

  it("rejects an anisotropic frame the commit cannot reproduce", () => {
    // Scaling the wrapper scales the rendered stroke anisotropically (elliptical caps, thickness
    // varying with direction) while the commit applies sqrt(scaleX * scaleY) to one strokeWidth
    // and replans with round caps. A 2x horizontal-only resize previews unchanged vertical
    // thickness and commits ~1.41x everywhere, so the ink would snap at release.
    expect(
      planStudioLiveTransformPreviewAttrs({
        sourceBounds: SOURCE,
        targetBounds: { x: 0, y: 0, width: 200, height: 100 },
        rotationDeg: 0,
      }),
    ).toBeNull();
  });

  it("keeps a uniform frame live, where the commit's width rule is exact", () => {
    // sqrt(s * s) === s is precisely what scaling the node does, so uniform gestures stay live.
    const attrs = planStudioLiveTransformPreviewAttrs({
      sourceBounds: SOURCE,
      targetBounds: { x: 10, y: 20, width: 200, height: 200 },
      rotationDeg: 30,
    });

    expect(attrs).not.toBeNull();
    expect(attrs?.scaleX).toBeCloseTo(2, 9);
    expect(attrs?.scaleY).toBeCloseTo(2, 9);
  });

  it("rejects the matrix projection on the same frames, not just the attrs", () => {
    expect(
      studioLiveTransformPreviewMat2d({
        sourceBounds: SOURCE,
        targetBounds: { x: 0, y: 0, width: 100, height: 250 },
        rotationDeg: 0,
      }),
    ).toBeNull();
  });

  it("still accepts a frame that is uniform only within the planner's epsilon", () => {
    // The boundary comes from the commit planner's own scale helper, so preview and commit cannot
    // disagree about what counts as uniform.
    const attrs = planStudioLiveTransformPreviewAttrs({
      sourceBounds: SOURCE,
      targetBounds: { x: 0, y: 0, width: 100, height: 100 + 1e-9 },
      rotationDeg: 0,
    });

    expect(attrs).not.toBeNull();
  });
});
