import { describe, expect, it } from "vitest";

import { exportPageToSvg } from "./export/studio-svg-export";
import { STUDIO_PIXEL_PENCIL_RENDER_MODE } from "./studio-pixel-pencil";
import {
  applyStudioSmartShapeBrushEffect,
  resolveStudioSmartShapeBrushEffectAvailability,
  studioSmartShapeBrushOutline,
} from "./studio-smart-shape-brush-effect";

import type { DrawEl } from "./studio-element-model";

function shape(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "shape-1",
    type: "draw",
    kind: "rect",
    mode: "pen",
    points: [10, 20, 110, 80],
    stroke: "#123456",
    strokeWidth: 8,
    opacity: 1,
    ...overrides,
  };
}

function source(overrides: Partial<DrawEl> = {}): DrawEl {
  return shape({
    kind: "freehand",
    points: [10, 20, 40, 24, 70, 19, 110, 20],
    brush: "pen",
    pressures: [0.2, 0.5, 0.8, 1],
    pressureModel: "linear-full-v1",
    sampleSpacing: 0,
    ...overrides,
  });
}

describe("studioSmartShapeBrushOutline", () => {
  it("builds exact open lines and explicitly closed rect, triangle, and polygon outlines", () => {
    expect(studioSmartShapeBrushOutline("line", [9, 8, 1, 2], 4, undefined)).toEqual([
      9, 8, 1, 2,
    ]);
    expect(studioSmartShapeBrushOutline("rect", [110, 80, 10, 20], 4, undefined)).toEqual([
      10, 20, 110, 20, 110, 80, 10, 80, 10, 20,
    ]);

    const triangle = studioSmartShapeBrushOutline("triangle", [10, 20, 110, 80], 4, undefined)!;
    expect(triangle).toHaveLength(8);
    expect(triangle.slice(-2)).toEqual(triangle.slice(0, 2));

    const polygon = studioSmartShapeBrushOutline(
      "polygon",
      [10, 20, 110, 80],
      4,
      { starPoints: 5, starInnerRatio: 0.45, polygonSides: 8, cornerRadius: 0 },
    )!;
    expect(polygon).toHaveLength(18);
    expect(polygon.slice(-2)).toEqual(polygon.slice(0, 2));
  });

  it("adapts ellipse detail to size while keeping output finite, closed, and bounded", () => {
    const small = studioSmartShapeBrushOutline("ellipse", [0, 0, 40, 20], 8, undefined)!;
    const large = studioSmartShapeBrushOutline("ellipse", [0, 0, 4000, 2000], 2, undefined)!;

    expect(small.length / 2).toBeGreaterThanOrEqual(33);
    expect(large.length / 2).toBeLessThanOrEqual(513);
    expect(large.length).toBeGreaterThan(small.length);
    expect(large.every(Number.isFinite)).toBe(true);
    expect(large.slice(-2)).toEqual(large.slice(0, 2));
  });

  it("rejects degenerate and non-finite bounds instead of creating corrupt paths", () => {
    expect(studioSmartShapeBrushOutline("rect", [1, 1, 1, 20], 4, undefined)).toBeNull();
    expect(studioSmartShapeBrushOutline("ellipse", [0, 0, Number.NaN, 4], 4, undefined)).toBeNull();
  });
});

describe("applyStudioSmartShapeBrushEffect", () => {
  it.each([
    ["pen", "pen"],
    ["gpen", "gpen"],
    ["calligraphy", "calligraphy"],
    ["marker", "marker"],
    ["highlighter", "highlighter"],
    ["neon", "neon"],
    ["glow", "glow"],
    ["glitter", "glitter"],
    ["brush", "brush"],
    ["watercolor", "watercolor"],
    ["oil", "oil"],
    ["pastel", "pastel"],
    ["ink-particle", "ink-particle"],
    ["airbrush", "airbrush"],
    ["dry-media", "dry-media"],
    ["pencil", "pencil"],
    ["screentone", "screentone"],
    ["ink-brush", "stamp"],
  ] as const)("routes the known %s brush through its real %s renderer", (brush, family) => {
    const result = applyStudioSmartShapeBrushEffect(shape(), source({ brush }));

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    expect(result.renderFamily).toBe(family);
    expect(result.stroke.kind).toBe("freehand");
    expect(result.stroke.brush).toBe(brush);
    expect(result.stroke.points.slice(-2)).toEqual(result.stroke.points.slice(0, 2));
  });

  it("resamples pressure and stylus channels to the perfect outline and clears shape-only fields", () => {
    const geometric = shape({
      fill: "#ffffff",
      gradient: { type: "linear", angleDeg: 0, stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }] },
      shapeParams: { starPoints: 6, starInnerRatio: 0.5, polygonSides: 7, cornerRadius: 12 },
      strokeStyle: { dash: "dash", lineCap: "square", arrowStart: "none", arrowEnd: "none" },
    });
    const result = applyStudioSmartShapeBrushEffect(geometric, source({
      brush: "calligraphy",
      tiltXs: [-30, 30],
      tiltYs: [10, 20],
      twists: [0, 90],
      brushTip: { tiltEnabled: true, angleDeg: 20, roundness: 0.4 },
      materialPressureModel: "canonical-material-v1",
      materialMinimumDiameterRatio: 0.64,
    }));

    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;
    const count = result.stroke.points.length / 2;
    expect(result.stroke.pressures).toHaveLength(count);
    expect(result.stroke.tiltXs).toHaveLength(count);
    expect(result.stroke.tiltYs).toHaveLength(count);
    expect(result.stroke.twists).toHaveLength(count);
    expect(result.stroke.tiltXs?.[0]).toBe(-30);
    expect(result.stroke.tiltXs?.at(-1)).toBe(30);
    expect(result.stroke.brushTip).toEqual({ tiltEnabled: true, angleDeg: 20, roundness: 0.4 });
    expect(result.stroke.materialMinimumDiameterRatio).toBe(0.64);
    expect(result.stroke.fill).toBeUndefined();
    expect(result.stroke.gradient).toBeUndefined();
    expect(result.stroke.pattern).toBeUndefined();
    expect(result.stroke.strokeStyle).toBeUndefined();
    expect(result.stroke.shapeParams).toBeUndefined();
  });

  it("produces an SVG-visible selected brush effect rather than inert metadata", () => {
    const result = applyStudioSmartShapeBrushEffect(
      shape({ kind: "ellipse", points: [30, 40, 230, 140], strokeWidth: 12 }),
      source({ brush: "neon" }),
    );
    expect(result.status).toBe("applied");
    if (result.status !== "applied") return;

    const exported = exportPageToSvg({
      width: 300,
      height: 200,
      bg: "#ffffff",
      elements: [result.stroke],
    });
    expect(exported.svg).toContain('data-brush-engine="neon-halo"');
    expect(exported.svg).not.toContain("<ellipse cx=\"130\" cy=\"90\" rx=\"100\"");
    expect(exported.skipped).toEqual([]);
  });

  it.each([
    ["eraser", source({ mode: "eraser" }), "eraser"],
    ["pixel", source({ brush: STUDIO_PIXEL_PENCIL_RENDER_MODE }), "pixel"],
    ["causal stamp", source({ brush: "ink-brush", stampPipeline: "causal-walker-v2" }), "causal-stamp"],
    ["causal watercolor", source({ brush: "watercolor", watercolorPipeline: "causal-walker-v2" }), "causal-watercolor"],
    ["unknown brush", source({ brush: "future-unregistered-tip" }), "unknown-brush"],
  ] as const)("reports incompatible %s semantics as unavailable without a substitute", (_label, effect, reason) => {
    const geometric = shape({
      brush: "stale",
      brushCatalogId: "catalog-stale",
      stampPipeline: "causal-walker-v2",
      pressures: [1, 1],
      materialPressureModel: "canonical-material-v1",
      materialMinimumDiameterRatio: 0.8,
    });
    const result = applyStudioSmartShapeBrushEffect(geometric, effect);

    expect(result).toEqual({ status: "unavailable", reason });
    expect("stroke" in result).toBe(false);
    expect(geometric.brush).toBe("stale");
    expect(geometric.brushCatalogId).toBe("catalog-stale");
    expect(geometric.stampPipeline).toBe("causal-walker-v2");
  });

  it("reports missing source or invalid geometry as unavailable", () => {
    expect(resolveStudioSmartShapeBrushEffectAvailability(null)).toEqual({
      status: "unavailable",
      reason: "missing-source",
    });
    expect(applyStudioSmartShapeBrushEffect(
      shape({ kind: "rect", points: [0, 0, 0, 20] }),
      source(),
    )).toEqual({ status: "unavailable", reason: "invalid-geometry" });
  });
});
