import { describe, expect, it } from "vitest";

import { materializeStudioBrushPackSelection } from "./brush/studio-brush-pack-runtime";
import {
  planStudioDynamicBrushCoverageAndLegacyMarks,
  type StudioDynamicBrushCoverageMark,
} from "./studio-dynamic-brush-coverage-renderer";
import { planStudioDynamicBrushRender } from "./studio-dynamic-brush-render-plan";

import type { DrawEl } from "./studio-element-model";

const TEST_SEEDS = Array.from({ length: 64 }, (_, index) =>
  `sumi-short-flick-${index}-${Math.imul(index + 1, 0x9e37_79b1) >>> 0}`
);

function requireSumiWashFray() {
  const selection = materializeStudioBrushPackSelection("sumi-wash-fray");
  if (!selection) throw new Error("sumi-wash-fray did not materialize");
  return selection;
}

function shortFlick(id: string): DrawEl {
  const selection = requireSumiWashFray();
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [100, 100, 107, 98],
    stroke: "#16100c",
    strokeWidth: selection.defaultWidth,
    opacity: selection.defaultOpacity,
    paintModel: "bounded-flow-v2",
    brush: selection.runtimeBrushId,
    brushCatalogId: selection.catalogId,
    brushCatalogName: selection.catalogName,
    brushDynamics: selection.brushDynamics,
    pressures: [0.5, 0.5],
    speeds: [64, 64],
    tangentialPressures: [0, 0],
    tiltXs: [0, 0],
    tiltYs: [0, 0],
    twists: [0, 0],
  };
}

function coverageMarks(element: DrawEl, activeDraft: boolean) {
  const selection = requireSumiWashFray();
  const render = planStudioDynamicBrushRender(
    element,
    selection.runtimeBrushId,
    activeDraft,
  );
  if (render.status !== "ready") {
    throw new Error(`sumi render plan was ${render.status}`);
  }
  const coverage = planStudioDynamicBrushCoverageAndLegacyMarks({
    dabVariations: render.plan.dabVariations,
    dynamics: render.plan.dynamics,
    materialIdentity: render.plan.materialIdentity,
    dynamicSeed: render.plan.seed,
    stroke: element.stroke,
    stampGrid: render.plan.renderBudget.stampGrid,
    markBudget: render.plan.markBudget,
  }).coveragePlan;
  if (!coverage.ok) {
    throw new Error(`sumi coverage plan failed: ${coverage.reason}`);
  }
  return { marks: coverage.marks, render: render.plan };
}

function alphaMapSample(
  mark: StudioDynamicBrushCoverageMark,
  documentX: number,
  documentY: number,
): number {
  const alphaMap = mark.texture?.alphaMap;
  if (!alphaMap) return 0;
  const cosine = Math.cos(mark.angleRadians);
  const sine = Math.sin(mark.angleRadians);
  const deltaX = documentX - mark.x;
  const deltaY = documentY - mark.y;
  const localX = cosine * deltaX + sine * deltaY;
  const localY = -sine * deltaX + cosine * deltaY;
  const normalizedX = localX / (mark.radiusX * 2) + 0.5;
  const normalizedY = localY / (mark.radiusY * 2) + 0.5;
  if (
    normalizedX < 0
    || normalizedX > 1
    || normalizedY < 0
    || normalizedY > 1
  ) {
    return 0;
  }

  // Canvas drawImage maps destination pixel centres onto source texel centres. Sampling the same
  // R8 field here keeps this unit test sensitive to the sub-pixel alpha quantisation that made a
  // valid short stroke disappear, without relying on a platform-native Canvas package in Vitest.
  const sourceX = normalizedX * alphaMap.size - 0.5;
  const sourceY = normalizedY * alphaMap.size - 0.5;
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const fractionX = sourceX - x0;
  const fractionY = sourceY - y0;
  const texel = (x: number, y: number) => (
    x < 0 || y < 0 || x >= alphaMap.size || y >= alphaMap.size
      ? 0
      : alphaMap.alphas[y * alphaMap.size + x] ?? 0
  );
  const top = texel(x0, y0) * (1 - fractionX)
    + texel(x0 + 1, y0) * fractionX;
  const bottom = texel(x0, y0 + 1) * (1 - fractionX)
    + texel(x0 + 1, y0 + 1) * fractionX;
  return top * (1 - fractionY) + bottom * fractionY;
}

function rasterVisibility(
  marks: readonly StudioDynamicBrushCoverageMark[],
  elementOpacity: number,
) {
  const texturedMarks = marks.filter((mark) => mark.texture);
  if (texturedMarks.length !== marks.length || marks.length === 0) {
    throw new Error("sumi short-flick must remain a non-empty textured mark plan");
  }
  const bounds = texturedMarks.map((mark) => {
    const cosine = Math.cos(mark.angleRadians);
    const sine = Math.sin(mark.angleRadians);
    return {
      minX: mark.x
        - Math.abs(mark.radiusX * cosine)
        - Math.abs(mark.radiusY * sine),
      minY: mark.y
        - Math.abs(mark.radiusX * sine)
        - Math.abs(mark.radiusY * cosine),
      maxX: mark.x
        + Math.abs(mark.radiusX * cosine)
        + Math.abs(mark.radiusY * sine),
      maxY: mark.y
        + Math.abs(mark.radiusX * sine)
        + Math.abs(mark.radiusY * cosine),
    };
  });
  const minX = Math.floor(Math.min(...bounds.map((bound) => bound.minX))) - 1;
  const minY = Math.floor(Math.min(...bounds.map((bound) => bound.minY))) - 1;
  const maxX = Math.ceil(Math.max(...bounds.map((bound) => bound.maxX))) + 1;
  const maxY = Math.ceil(Math.max(...bounds.map((bound) => bound.maxY))) + 1;

  let changedPixels = 0;
  let peakAlpha = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      let destinationAlpha = 0;
      for (const mark of texturedMarks) {
        const sourceAlpha = Math.min(
          1,
          Math.max(
            0,
            mark.alpha
              * elementOpacity
              * alphaMapSample(mark, x + 0.5, y + 0.5),
          ),
        );
        destinationAlpha = sourceAlpha
          + destinationAlpha * (1 - sourceAlpha);
      }
      const alphaByte = Math.round(destinationAlpha * 255);
      if (alphaByte > 2) changedPixels += 1;
      peakAlpha = Math.max(peakAlpha, alphaByte);
    }
  }
  return { changedPixels, peakAlpha };
}

describe("sumi wash fray short-flick visibility", () => {
  it("keeps every bounded deterministic 7×2px high-speed flick visibly rasterized", () => {
    const selection = requireSumiWashFray();
    expect(selection.brushDynamics.taper).toMatchObject({
      enabled: true,
      minSizeRatio: 0.12,
      minOpacityRatio: 0.62,
    });
    expect(selection.brushDynamics.grain).toMatchObject({
      space: "stroke-fixed",
      amount: 0.38,
    });
    expect(selection.brushDynamics.dualBrush).toMatchObject({
      enabled: true,
      blendMode: "multiply",
      sizeRatio: 0.76,
      tip: { shape: "bristle" },
    });

    for (const id of TEST_SEEDS) {
      const element = shortFlick(id);
      const { marks } = coverageMarks(element, false);
      const visibility = rasterVisibility(marks, element.opacity ?? 1);
      expect(visibility.peakAlpha, `${id}: peak alpha`).toBeGreaterThanOrEqual(4);
      expect(
        visibility.changedPixels,
        `${id}: pixels above the browser screenshot tolerance`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it("keeps live and retained causal plans byte-equivalent for short flicks", () => {
    for (const id of TEST_SEEDS.slice(0, 8)) {
      const element = shortFlick(id);
      const live = coverageMarks(element, true);
      const retained = coverageMarks(element, false);
      expect(live.render.dabVariations).toEqual(retained.render.dabVariations);
      expect(live.marks).toEqual(retained.marks);
    }
  });
});
