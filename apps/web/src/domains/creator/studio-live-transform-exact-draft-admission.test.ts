import { describe, expect, it } from "vitest";

import { studioCalligraphyRibbonWorkUpperBound } from "./brush/studio-calligraphy-ribbon";
import { studioAngledNibCoverageWorkUpperBound } from "./brush/studio-stroke-local-coverage";
import { studioCalligraphyMaximumNibRadius } from "./studio-brush";
import {
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_ANGLED_RIBBON_SAMPLES,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_CALLIGRAPHY_SAMPLES,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_DABS,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_SAMPLES,
  STUDIO_LIVE_TRANSFORM_EXACT_MAX_SCENE_ELEMENTS,
  admitStudioLiveTransformExactDraft,
} from "./studio-live-transform-exact-draft-admission";
import {
  studioPerfectFreehandMaximumPaintRadius,
  studioPerfectFreehandWorkUpperBound,
} from "./studio-perfect-freehand";

const sourceBounds = { x: 0, y: 0, width: 100, height: 50 };
const targetBounds = { x: 20, y: 30, width: 200, height: 75 };

function decide(overrides: Partial<Parameters<typeof admitStudioLiveTransformExactDraft>[0]> = {}) {
  return admitStudioLiveTransformExactDraft({
    complexity: {
      rendererEngine: "causal-ink",
      sampleCount: 40,
      pathLength: 240,
      strokeWidth: 4,
      causalMaxDabRadius: 3.4,
    },
    sourceBounds,
    targetBounds,
    sceneElementCount: 200,
    rasterScale: 1,
    sceneCanvasBackingPixels: 1_000_000,
    ...overrides,
  });
}

function calligraphyComplexity(sampleCount: number, strokeWidth = 4) {
  const work = studioCalligraphyRibbonWorkUpperBound(sampleCount)!;
  return {
    rendererEngine: "calligraphy-segments",
    sampleCount,
    pathLength: Math.max(0, sampleCount - 1) * 3,
    strokeWidth,
    rendererExpandedScalarWork: work.outlineCoordinateScalars,
    rendererPathCommandUpperBound: work.canvasPathCommands,
    rendererMaxPaintRadius: studioCalligraphyMaximumNibRadius(strokeWidth, sampleCount),
  } as const;
}

function perfectComplexity(sampleCount: number, strokeWidth = 4) {
  const work = studioPerfectFreehandWorkUpperBound(sampleCount)!;
  return {
    rendererEngine: "perfect-outline",
    sampleCount,
    pathLength: Math.max(0, sampleCount - 1) * 3,
    strokeWidth,
    rendererExpandedScalarWork: work.pathCoordinateScalars,
    rendererPathCommandUpperBound: work.pathCommands,
    rendererMaxPaintRadius: studioPerfectFreehandMaximumPaintRadius(strokeWidth),
  } as const;
}

function angledNibComplexity(sampleCount: number, strokeWidth = 4) {
  const work = studioAngledNibCoverageWorkUpperBound(sampleCount);
  return {
    rendererEngine: "angled-ribbon",
    sampleCount,
    pathLength: Math.max(0, sampleCount - 1) * 3,
    strokeWidth,
    rendererExpandedScalarWork: work.canvasCoordinateScalars,
    rendererPathCommandUpperBound: work.canvasPathCommands,
    // The swept quadrilateral has no join expansion or halo, so the nib half-width IS the radius.
    rendererMaxPaintRadius: strokeWidth / 2,
  } as const;
}

describe("admitStudioLiveTransformExactDraft", () => {
  it("charges the angled nib's per-segment quadrilateral fill, not its raw sample count", () => {
    const admitted = decide({ complexity: angledNibComplexity(300) });
    expect(admitted.admitted).toBe(true);
    expect(admitted.admitted && admitted.lane).toBe("angled-nib-coverage");
    // Reported work is the largest compiled dimension -- here the eight coordinate scalars each
    // quadrilateral serializes.
    expect(admitted.estimatedWork).toBe(
      studioAngledNibCoverageWorkUpperBound(300).canvasCoordinateScalars,
    );
    // What actually BINDS is the path-command ceiling: five commands per segment reaches it at
    // ~396 segments, well before the sample cap, so the raw sample count alone would let through
    // a stroke emitting five times the established path-operation budget.
    const overCommandBudget = decide({
      complexity: angledNibComplexity(STUDIO_LIVE_TRANSFORM_EXACT_MAX_ANGLED_RIBBON_SAMPLES),
    });
    expect(overCommandBudget.admitted).toBe(false);
    expect(overCommandBudget.admitted === false && overCommandBudget.reason).toBe(
      "renderer-budget",
    );
  });

  it("stops scaling the charge down when the commit preserves stroke width", () => {
    // A multi-selection resize commits through `planStudioGroupUniformResize`, which does NOT
    // re-weight line art. Charging a shrunken radius there is an UNDER-bound: the drafted stroke
    // keeps its authored width however far the box shrinks, so a wide stroke could pass the 512px
    // ceilings simply by being scaled down.
    const wide = {
      rendererEngine: "causal-ink",
      sampleCount: 50,
      pathLength: 200,
      strokeWidth: 600,
      causalMaxDabRadius: 510,
    } as const;
    const shrink = { x: 0, y: 0, width: 10, height: 5 };
    // Under the default scaling policy the 0.1x box divides the charge and the frame is admitted.
    expect(decide({ complexity: wide, targetBounds: shrink }).admitted).toBe(true);
    // Told the truth about the commit, the same frame is refused on the width it will actually paint.
    const preserved = decide({
      complexity: wide,
      targetBounds: shrink,
      strokeWidthPolicy: "preserve",
    });
    expect(preserved.admitted).toBe(false);
    expect(preserved.admitted === false && preserved.reason).toBe("renderer-budget");
    // The ribbon lanes already clamped at 1, so the policy cannot make them cheaper either.
    const ribbon = decide({
      complexity: angledNibComplexity(40, 400),
      targetBounds: shrink,
      strokeWidthPolicy: "preserve",
    });
    expect(ribbon.admitted).toBe(
      decide({ complexity: angledNibComplexity(40, 400), targetBounds: shrink }).admitted,
    );
  });

  it("refuses an angled-nib frame that omits its compiled renderer facts", () => {
    // The compiler supplies all three; a caller that does not is an unknown, not a licence.
    const { rendererMaxPaintRadius: _radius, ...withoutRadius } = angledNibComplexity(40);
    const decision = decide({ complexity: withoutRadius });
    expect(decision.admitted).toBe(false);
    expect(decision.admitted === false && decision.reason).toBe("invalid");
  });

  it("charges the angled nib's transformed footprint against zoom and DPR", () => {
    // 100x50 -> 200x75 is a 2x centre-line scale, so a 512-wide nib enlarges past the stroke-width
    // ceiling and the frame stands down before any planning runs.
    const decision = decide({ complexity: angledNibComplexity(40, 400) });
    expect(decision.admitted).toBe(false);
    expect(decision.admitted === false && decision.reason).toBe("renderer-budget");
    // Same geometry at a workable width, but rasterized at 4x backing scale, exceeds the paint cap.
    const zoomed = decide({ complexity: angledNibComplexity(40, 40), rasterScale: 8 });
    expect(zoomed.admitted).toBe(false);
  });

  it("bounds calligraphy's one-point pressure Ellipse separately from its ribbon nib", () => {
    expect(studioCalligraphyMaximumNibRadius(4, 1, 1)).toBeCloseTo(3.4, 12);
    expect(studioCalligraphyMaximumNibRadius(4, 1, 1.3)).toBeCloseTo(4.24, 12);
    expect(studioCalligraphyMaximumNibRadius(0.1, 1, 0)).toBe(0.35);
    expect(studioCalligraphyMaximumNibRadius(4, 2)).toBe(2.5);
  });

  it("admits a bounded causal frame using the 0.5px worst-case dab spacing", () => {
    const decision = decide();
    expect(decision).toMatchObject({
      admitted: true,
      lane: "causal-dabs",
      estimatedWork: 1_000,
    });
    // The shaded area is reported alongside the count so a multi-element caller can add up both;
    // the two are independent dimensions and one frame pays for each.
    expect(decision.admitted && decision.estimatedBackingPixels).toBeGreaterThan(0);
  });

  it("rejects a two-point causal segment whose transformed dab field exceeds the frame budget", () => {
    const pathLength = STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_DABS;
    expect(decide({
      complexity: {
        rendererEngine: "causal-ink",
        sampleCount: 2,
        pathLength,
        strokeWidth: 4,
        causalMaxDabRadius: 3.4,
      },
    })).toMatchObject({
      admitted: false,
      reason: "renderer-budget",
    });
  });

  it("rejects a 100k-sample zero-length causal stroke despite its one-dab estimate", () => {
    expect(decide({
      complexity: {
        rendererEngine: "causal-ink",
        sampleCount: 100_000,
        pathLength: 0,
        strokeWidth: 4,
        causalMaxDabRadius: 3.4,
      },
    })).toMatchObject({
      admitted: false,
      reason: "renderer-budget",
    });
    expect(decide({
      complexity: {
        rendererEngine: "causal-ink",
        sampleCount: STUDIO_LIVE_TRANSFORM_EXACT_MAX_CAUSAL_SAMPLES,
        pathLength: 0,
        strokeWidth: 4,
        causalMaxDabRadius: 3.4,
      },
    }).admitted).toBe(true);
  });

  it("charges calligraphy's 32-step ribbon expansion instead of its raw sample count", () => {
    const oversized = decide({ complexity: calligraphyComplexity(3_200) });
    expect(oversized).toMatchObject({ admitted: false, reason: "renderer-budget" });
    expect(oversized.estimatedWork).toBeGreaterThan(3_200);

    const adversarial = decide({
      complexity: calligraphyComplexity(STUDIO_LIVE_TRANSFORM_EXACT_MAX_CALLIGRAPHY_SAMPLES),
    });
    expect(adversarial).toEqual({
      admitted: false,
      reason: "renderer-budget",
      // 255 accepted segments * 208 final outline scalars - the first polygon's shared bridge.
      estimatedWork: 53_038,
    });

    expect(decide({ complexity: calligraphyComplexity(19) }).admitted).toBe(true);
    expect(decide({ complexity: calligraphyComplexity(20) })).toMatchObject({
      admitted: false,
      reason: "renderer-budget",
    });
  });

  it("charges perfect-freehand outline/path expansion instead of raw samples", () => {
    expect(decide({ complexity: perfectComplexity(71) }).admitted).toBe(true);
    expect(decide({ complexity: perfectComplexity(72) })).toMatchObject({
      admitted: false,
      reason: "renderer-budget",
    });
    const maximumRawCandidate = decide({ complexity: perfectComplexity(2_048) });
    expect(maximumRawCandidate).toMatchObject({
      admitted: false,
      reason: "renderer-budget",
    });
    expect(maximumRawCandidate.estimatedWork).toBeGreaterThan(2_048);
  });

  it("rejects scene and malformed input before any renderer work", () => {
    expect(decide({
      sceneElementCount: STUDIO_LIVE_TRANSFORM_EXACT_MAX_SCENE_ELEMENTS + 1,
    })).toMatchObject({ admitted: false, reason: "scene-budget" });
    expect(decide({
      complexity: {
        rendererEngine: "causal-ink",
        sampleCount: 1,
        pathLength: Number.NaN,
        strokeWidth: 4,
        causalMaxDabRadius: 3.4,
      },
    })).toMatchObject({ admitted: false, reason: "invalid" });
    expect(decide({ sceneCanvasBackingPixels: Number.NaN })).toMatchObject({
      admitted: false,
      reason: "invalid",
    });
  });

  it("charges the full Layer SceneCanvas clear even when the object AABB is tiny", () => {
    const tinyBounds = { x: 0, y: 0, width: 1, height: 1 };
    expect(decide({
      sourceBounds: tinyBounds,
      targetBounds: tinyBounds,
      sceneCanvasBackingPixels: STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS,
    }).admitted).toBe(true);
    expect(decide({
      sourceBounds: tinyBounds,
      targetBounds: tinyBounds,
      sceneCanvasBackingPixels: STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS + 1,
    })).toEqual({
      admitted: false,
      reason: "renderer-budget",
      estimatedWork: STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS + 1,
    });
  });

  it("rejects a valid maximum-width causal stroke before full-canvas dab overdraw", () => {
    expect(decide({
      complexity: {
        rendererEngine: "causal-ink",
        sampleCount: 128,
        pathLength: 500,
        strokeWidth: 8_192,
        causalMaxDabRadius: 6_963.2,
      },
    })).toMatchObject({ admitted: false, reason: "renderer-budget" });
  });

  it("charges every short causal segment and its backing-pixel footprint", () => {
    // 2,048 tiny, non-zero segments each emit at least one legacy dab even though their combined
    // path is only ~1px. The old total-length estimate counted four dabs and admitted this frame.
    expect(decide({
      complexity: {
        rendererEngine: "causal-ink",
        sampleCount: 2_048,
        pathLength: 1,
        strokeWidth: 64,
        causalMaxDabRadius: 54.4,
      },
    })).toMatchObject({ admitted: false, reason: "renderer-budget" });

    const retinaCandidate = {
      rendererEngine: "causal-ink",
      sampleCount: 100,
      pathLength: 0,
      strokeWidth: 58,
      causalMaxDabRadius: 50,
    } as const;
    expect(decide({ complexity: retinaCandidate, rasterScale: 1 }).admitted).toBe(true);
    expect(decide({ complexity: retinaCandidate, rasterScale: 2 })).toMatchObject({
      admitted: false,
      reason: "renderer-budget",
    });
  });

  it("rejects wide calligraphy and perfect fills when zoom times DPR exceeds backing pixels", () => {
    const identityBounds = { sourceBounds, targetBounds: sourceBounds };
    const calligraphy = calligraphyComplexity(2, 400);
    expect(decide({ ...identityBounds, complexity: calligraphy, rasterScale: 1 }).admitted)
      .toBe(true);
    expect(decide({ ...identityBounds, complexity: calligraphy, rasterScale: 4 })).toMatchObject({
      admitted: false,
      reason: "renderer-budget",
    });

    const perfect = perfectComplexity(2, 256);
    expect(decide({ ...identityBounds, complexity: perfect, rasterScale: 1 }).admitted)
      .toBe(true);
    expect(decide({ ...identityBounds, complexity: perfect, rasterScale: 4 })).toMatchObject({
      admitted: false,
      reason: "renderer-budget",
    });
  });

  it("applies the same zoom/DPR backing and path-sweep ceiling to the generic lane", () => {
    const generic = {
      rendererEngine: "future-path-adapter",
      sampleCount: 100,
      pathLength: 100,
      strokeWidth: 100,
    } as const;
    expect(decide({
      sourceBounds,
      targetBounds: sourceBounds,
      complexity: generic,
      rasterScale: 1,
    })).toMatchObject({ admitted: true, lane: "generic", estimatedWork: 100 });
    expect(decide({
      sourceBounds,
      targetBounds: sourceBounds,
      complexity: generic,
      rasterScale: 8,
    })).toMatchObject({ admitted: false, reason: "renderer-budget" });
  });
});
