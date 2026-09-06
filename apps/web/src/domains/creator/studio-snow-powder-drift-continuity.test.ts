import { describe, expect, it } from "vitest";

import { materializeStudioBrushPackSelection } from "./brush/studio-brush-pack-runtime";
import { planStudioDynamicBrushCoverageMarks } from "./studio-dynamic-brush-coverage-renderer";
import { planStudioDynamicBrushRender } from "./studio-dynamic-brush-render-plan";

import type { StudioDynamicBrushCoverageMark } from "./studio-dynamic-brush-coverage-renderer";
import type { StudioDynamicBrushRenderPlan } from "./studio-dynamic-brush-render-plan";
import type { DrawEl } from "./studio-element-model";

const ROUTE_LENGTH = 504;
const ROUTE_SEGMENTS = 6;
const ROUTE_SEGMENT_WIDTH = ROUTE_LENGTH / ROUTE_SEGMENTS;
const ROUTE_HALF_CLIP_HEIGHT = 48;
const MEANINGFUL_FOOTPRINT_RATIO = 0.25;

function requireReady(
  result: ReturnType<typeof planStudioDynamicBrushRender>,
): StudioDynamicBrushRenderPlan {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error(`snow-powder-drift plan was rejected: ${result.reason}`);
  }
  return result.plan;
}

function markSupportsSegment(
  mark: StudioDynamicBrushCoverageMark,
  segmentIndex: number,
): boolean {
  const cosine = Math.cos(mark.angleRadians);
  const sine = Math.sin(mark.angleRadians);
  const extentX = (
    Math.abs(mark.radiusX * cosine)
    + Math.abs(mark.radiusY * sine)
  ) * MEANINGFUL_FOOTPRINT_RATIO;
  const extentY = (
    Math.abs(mark.radiusX * sine)
    + Math.abs(mark.radiusY * cosine)
  ) * MEANINGFUL_FOOTPRINT_RATIO;
  const segmentLeft = segmentIndex * ROUTE_SEGMENT_WIDTH;
  const segmentRight = segmentLeft + ROUTE_SEGMENT_WIDTH;
  return mark.x + extentX >= segmentLeft
    && mark.x - extentX < segmentRight
    && mark.y + extentY >= -ROUTE_HALF_CLIP_HEIGHT
    && mark.y - extentY <= ROUTE_HALF_CLIP_HEIGHT;
}

describe("snow-powder-drift sparse route continuity", () => {
  it("bounds fast-stroke spacing and scatter without turning the preset into a dense brush", () => {
    const selection = materializeStudioBrushPackSelection("snow-powder-drift");
    expect(selection).not.toBeNull();
    if (!selection) return;

    expect(selection.brushDynamics).toMatchObject({
      spacingRatio: 0.36,
      scatterRatio: 0.46,
      scatter: {
        mappings: [{ source: "speed", from: 0.76, to: 1.2 }],
        jitter: { mode: "add", amount: 0.24 },
      },
    });

    const failures: Array<{
      strokeIndex: number;
      missingSegments: number[];
      markCount: number;
    }> = [];
    const markCounts: number[] = [];
    for (let strokeIndex = 0; strokeIndex < 512; strokeIndex += 1) {
      const element: DrawEl = {
        id: `snow-powder-continuity-${strokeIndex}`,
        type: "draw",
        kind: "freehand",
        mode: "pen",
        points: [0, 0, ROUTE_LENGTH, 4],
        stroke: "#5378a8",
        strokeWidth: selection.defaultWidth,
        opacity: selection.defaultOpacity,
        brush: selection.runtimeBrushId,
        brushCatalogId: selection.catalogId,
        pressures: [0.5, 0.5],
        tangentialPressures: [0, 0],
        // A single browser-dispatched long move clamps to this worst-case product speed.
        speeds: [64, 64],
        tiltXs: [0, 0],
        tiltYs: [0, 0],
        twists: [0, 0],
        brushDynamics: selection.brushDynamics,
      };
      const renderPlan = requireReady(
        planStudioDynamicBrushRender(
          element,
          selection.runtimeBrushId,
          false,
        ),
      );
      const coverage = planStudioDynamicBrushCoverageMarks({
        dabVariations: renderPlan.dabVariations,
        materialIdentity: renderPlan.materialIdentity,
        dynamics: renderPlan.dynamics,
        dynamicSeed: renderPlan.seed,
        stroke: element.stroke,
        stampGrid: renderPlan.renderBudget.stampGrid,
        markBudget: renderPlan.markBudget,
      });
      expect(coverage.ok).toBe(true);
      if (!coverage.ok) continue;

      markCounts.push(coverage.marks.length);
      const missingSegments = Array.from(
        { length: ROUTE_SEGMENTS },
        (_, segmentIndex) => segmentIndex,
      ).filter((segmentIndex) => !coverage.marks.some(
        (mark) => markSupportsSegment(mark, segmentIndex),
      ));
      if (missingSegments.length > 0) {
        failures.push({
          strokeIndex,
          missingSegments,
          markCount: coverage.marks.length,
        });
      }
    }

    expect(failures).toEqual([]);
    expect(markCounts).toHaveLength(512);
    // The continuity fix must retain a sparse snow carrier rather than becoming a solid ribbon.
    expect(Math.min(...markCounts)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...markCounts)).toBeLessThanOrEqual(28);
  });
});
