import { describe, expect, it } from "vitest";

import {
  planStudioDynamicBrushCoverageAndLegacyMarks,
  type StudioDynamicBrushCoverageMark,
} from "../studio-dynamic-brush-coverage-renderer";

import {
  studioBrushPresetUsesIntentionalDiscreteCarrier,
} from "./studio-brush-carrier-quality";
import {
  planNormalizedStudioDynamicBrushDabs,
} from "./studio-brush-dynamics";
import {
  STUDIO_BRUSH_PACK_DESCRIPTORS,
} from "./studio-brush-pack-index";
import {
  materializeAllStudioBrushPackSelections,
} from "./studio-brush-pack-runtime";
import {
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
} from "./studio-brush-render-budget";

const SELECTED_PIGMENT = "#315f9b";
const OVERLAP_PATH = [
  8, 32,
  32, 32,
  56, 32,
  80, 32,
  104, 32,
  80, 32,
  56, 32,
  32, 32,
  8, 32,
  32, 32,
  56, 32,
  80, 32,
  104, 32,
] as const;
const SAMPLE_POINTS = [
  [20, 32],
  [32, 32],
  [44, 32],
  [56, 32],
  [68, 32],
  [80, 32],
  [92, 32],
] as const;

function parseRgb(color: string): readonly [number, number, number] | null {
  const match = /^#([\da-f]{6})$/iu.exec(color);
  if (!match) return null;
  return [
    Number.parseInt(match[1]!.slice(0, 2), 16) / 255,
    Number.parseInt(match[1]!.slice(2, 4), 16) / 255,
    Number.parseInt(match[1]!.slice(4, 6), 16) / 255,
  ];
}

function relativeLuminance(rgb: readonly number[]): number {
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

function textureAlphaAt(
  mark: StudioDynamicBrushCoverageMark,
  normalizedX: number,
  normalizedY: number,
): number {
  const alphaMap = mark.texture?.alphaMap;
  if (!alphaMap) return 1;
  const x = (normalizedX * 0.5 + 0.5) * (alphaMap.size - 1);
  const y = (normalizedY * 0.5 + 0.5) * (alphaMap.size - 1);
  if (
    x < 0
    || x > alphaMap.size - 1
    || y < 0
    || y > alphaMap.size - 1
  ) {
    return 0;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(alphaMap.size - 1, x0 + 1);
  const y1 = Math.min(alphaMap.size - 1, y0 + 1);
  const amountX = x - x0;
  const amountY = y - y0;
  const alphaAt = (sampleX: number, sampleY: number) => (
    alphaMap.alphas[sampleY * alphaMap.size + sampleX] ?? 0
  );
  const top = alphaAt(x0, y0)
    + (alphaAt(x1, y0) - alphaAt(x0, y0)) * amountX;
  const bottom = alphaAt(x0, y1)
    + (alphaAt(x1, y1) - alphaAt(x0, y1)) * amountX;
  return top + (bottom - top) * amountY;
}

function markAlphaAt(
  mark: StudioDynamicBrushCoverageMark,
  sampleX: number,
  sampleY: number,
): number {
  const cosine = Math.cos(mark.angleRadians);
  const sine = Math.sin(mark.angleRadians);
  const deltaX = sampleX - mark.x;
  const deltaY = sampleY - mark.y;
  const normalizedX = (
    deltaX * cosine + deltaY * sine
  ) / mark.radiusX;
  const normalizedY = (
    -deltaX * sine + deltaY * cosine
  ) / mark.radiusY;

  if (mark.texture) {
    return mark.alpha * textureAlphaAt(mark, normalizedX, normalizedY);
  }
  const radius = Math.hypot(normalizedX, normalizedY);
  if (radius >= 1) return 0;
  const falloff = mark.falloff
    ? Math.pow(1 - radius, mark.falloff.exponent)
    : 1;
  return mark.alpha * falloff;
}

describe("catalogue brush overlap monotonicity", () => {
  it("never lightens already deposited selected pigment for a continuous source-over carrier", () => {
    const descriptors = new Map(
      STUDIO_BRUSH_PACK_DESCRIPTORS.map((descriptor) => [
        descriptor.catalogId,
        descriptor,
      ]),
    );

    for (const selection of materializeAllStudioBrushPackSelections()) {
      const descriptor = descriptors.get(selection.catalogId);
      expect(descriptor, `${selection.catalogId}: descriptor`).toBeDefined();
      if (
        !descriptor
        || studioBrushPresetUsesIntentionalDiscreteCarrier({
          category: descriptor.category,
          previewStyle: descriptor.previewStyle,
          runtimeBrushId: selection.runtimeBrushId,
        })
      ) {
        continue;
      }

      const pointCount = OVERLAP_PATH.length / 2;
      const dabs = planNormalizedStudioDynamicBrushDabs({
        baseOpacity: 1,
        baseWidth: selection.defaultWidth,
        maxDabs: 4_096,
        points: OVERLAP_PATH,
        pressures: new Array<number>(pointCount).fill(0.62),
        seed: 0x51f1_7a3e,
        speeds: new Array<number>(pointCount).fill(0.3),
      }, selection.brushDynamics);
      const planned = planStudioDynamicBrushCoverageAndLegacyMarks({
        dabVariations: [dabs],
        dynamics: selection.brushDynamics,
        dynamicSeed: 0x51f1_7a3e,
        stroke: SELECTED_PIGMENT,
        stampGrid: 3,
        markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
      });

      expect(
        planned.coveragePlan.ok,
        `${selection.catalogId}: coverage plan`,
      ).toBe(true);
      if (!planned.coveragePlan.ok) continue;
      expect(
        planned.legacyMarks,
        `${selection.catalogId}: legacy/live mark parity`,
      ).toEqual(planned.coveragePlan.marks);
      expect(
        new Set(planned.coveragePlan.marks.map((mark) => mark.color)),
        `${selection.catalogId}: continuous pigment colour`,
      ).toEqual(new Set([SELECTED_PIGMENT]));

      for (const [sampleX, sampleY] of SAMPLE_POINTS) {
        let destinationAlpha = 0;
        let destinationRgb: readonly [number, number, number] = [1, 1, 1];
        let previousLuminance = 1;
        for (const mark of planned.coveragePlan.marks) {
          const sourceAlpha = Math.min(
            1,
            Math.max(0, markAlphaAt(mark, sampleX, sampleY)),
          );
          if (sourceAlpha <= 0) continue;
          const sourceRgb = parseRgb(mark.color);
          expect(
            sourceRgb,
            `${selection.catalogId}: canonical mark colour`,
          ).not.toBeNull();
          if (!sourceRgb) continue;

          const nextAlpha = sourceAlpha
            + destinationAlpha * (1 - sourceAlpha);
          const nextRgb = [
            sourceRgb[0] * sourceAlpha
              + destinationRgb[0] * (1 - sourceAlpha),
            sourceRgb[1] * sourceAlpha
              + destinationRgb[1] * (1 - sourceAlpha),
            sourceRgb[2] * sourceAlpha
              + destinationRgb[2] * (1 - sourceAlpha),
          ] as const;
          const nextLuminance = relativeLuminance(nextRgb);
          expect(
            nextAlpha + Number.EPSILON,
            `${selection.catalogId}: alpha at ${sampleX},${sampleY}`,
          ).toBeGreaterThanOrEqual(destinationAlpha);
          expect(
            nextLuminance,
            `${selection.catalogId}: pigment lightened at ${sampleX},${sampleY}`,
          ).toBeLessThanOrEqual(previousLuminance + 1e-12);
          destinationAlpha = nextAlpha;
          destinationRgb = nextRgb;
          previousLuminance = nextLuminance;
        }
      }
    }
  });
});
