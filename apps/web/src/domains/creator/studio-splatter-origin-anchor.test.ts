import { describe, expect, it } from "vitest";

import {
  studioBrushDynamicsSettingsForBrushId,
} from "./brush/studio-brush-dynamics";
import {
  planStudioDynamicBrushRenderBudget,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
} from "./brush/studio-brush-render-budget";
import {
  planStudioDynamicBrushCoverageMarks,
  type StudioDynamicBrushSegmentedDabVariation,
} from "./studio-dynamic-brush-coverage-renderer";
import {
  planStudioDynamicBrushRender,
  type StudioDynamicBrushRenderPlan,
} from "./studio-dynamic-brush-render-plan";
import {
  STUDIO_SPLATTER_ORIGIN_ANCHOR_MAX_DIAMETER,
  STUDIO_SPLATTER_ORIGIN_ANCHOR_MIN_DIAMETER,
} from "./studio-splatter-origin-anchor";

import type { StudioDynamicBrushDab } from "./brush/studio-brush-dynamics";
import type { DrawEl } from "./studio-element-model";

function element(
  id: string,
  brush: "splatter" | "spray",
  points: readonly number[],
): DrawEl {
  const dynamics = studioBrushDynamicsSettingsForBrushId(brush);
  if (!dynamics) throw new Error(`missing ${brush} dynamics`);
  const pointCount = points.length / 2;
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [...points],
    stroke: "#172033",
    strokeWidth: brush === "splatter" ? 45 : 16,
    opacity: brush === "splatter" ? 0.65 : 0.72,
    brush,
    brushDynamics: dynamics,
    pressures: Array.from({ length: pointCount }, () => 0.5),
    tangentialPressures: Array.from({ length: pointCount }, () => 0),
    speeds: Array.from(
      { length: pointCount },
      (_, index) => index === 0 ? 0 : 64,
    ),
    tiltXs: Array.from({ length: pointCount }, () => 0),
    tiltYs: Array.from({ length: pointCount }, () => 0),
    twists: Array.from({ length: pointCount }, () => 0),
  };
}

function readyPlan(
  source: DrawEl,
  activeDraft: boolean,
): StudioDynamicBrushRenderPlan {
  const result = planStudioDynamicBrushRender(
    source,
    source.brush ?? "splatter",
    activeDraft,
  );
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error(`unexpected plan rejection: ${result.reason}`);
  }
  return result.plan;
}

function dabs(plan: StudioDynamicBrushRenderPlan): readonly StudioDynamicBrushDab[] {
  const variation = plan.dabVariations[0];
  if (!variation) return [];
  return Array.isArray(variation)
    ? variation as readonly StudioDynamicBrushDab[]
    : (variation as StudioDynamicBrushSegmentedDabVariation)
        .segments.flatMap((segment) => segment);
}

function coverage(plan: StudioDynamicBrushRenderPlan) {
  const result = planStudioDynamicBrushCoverageMarks({
    dabVariations: plan.dabVariations,
    dynamics: plan.dynamics,
    materialIdentity: plan.materialIdentity,
    dynamicSeed: plan.seed,
    stroke: "#172033",
    stampGrid: plan.renderBudget.stampGrid,
    markBudget: plan.markBudget,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`unexpected coverage rejection: ${result.reason}`);
  return result;
}

describe("Studio splatter origin anchor", () => {
  it.each([
    ["tap", [100, 100]],
    ["fast-short-flick", [100, 100, 109, 103]],
  ] as const)(
    "keeps a seeded irregular flake visible at the authored origin for a %s",
    (_label, points) => {
      // This id produces a wide first scatter whose centre is over 90 px from the source.
      const plan = readyPlan(element("studio-48", "splatter", points), true);
      const plannedDabs = dabs(plan);
      const marks = coverage(plan).marks;

      expect(plannedDabs).toHaveLength(1);
      expect(Math.hypot(
        plannedDabs[0]!.x - plannedDabs[0]!.sourceX,
        plannedDabs[0]!.y - plannedDabs[0]!.sourceY,
      )).toBeGreaterThan(40);
      expect(plan.renderBudget.fixedMarksPerVariation).toBe(1);
      expect(marks).toHaveLength(2);

      const wideScatter = marks.find(
        (mark) =>
          mark.x === plannedDabs[0]!.x
          && mark.y === plannedDabs[0]!.y,
      );
      const originAnchor = marks.find(
        (mark) =>
          mark.x === plannedDabs[0]!.sourceX
          && mark.y === plannedDabs[0]!.sourceY,
      );
      expect(wideScatter).toMatchObject({
        texture: { kind: "alpha-map", alphaMap: { shape: "flake" } },
      });
      expect(originAnchor).toMatchObject({
        texture: { kind: "alpha-map", alphaMap: { shape: "flake" } },
      });
      expect((originAnchor?.radiusX ?? 0) * 2).toBeGreaterThanOrEqual(
        STUDIO_SPLATTER_ORIGIN_ANCHOR_MIN_DIAMETER,
      );
      expect((originAnchor?.radiusX ?? 0) * 2).toBeLessThanOrEqual(
        STUDIO_SPLATTER_ORIGIN_ANCHOR_MAX_DIAMETER,
      );
      expect(originAnchor?.alpha).toBeGreaterThan(0);
    },
  );

  it("uses byte-equivalent seeded placement for active and committed planning", () => {
    const source = element(
      "splatter-live-commit-parity",
      "splatter",
      [48, 52, 56, 55],
    );
    const active = readyPlan(source, true);
    const committed = readyPlan(structuredClone(source), false);

    expect(active).toEqual(committed);
    expect(coverage(active).marks).toEqual(coverage(committed).marks);
  });

  it("reserves one fixed mark without halving the causal dab budget", () => {
    const dynamics = studioBrushDynamicsSettingsForBrushId("splatter");
    if (!dynamics) throw new Error("missing splatter dynamics");
    const budget = planStudioDynamicBrushRenderBudget({
      settings: dynamics,
      dabCount: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
      symmetryCount: 1,
      fixedMarksPerVariation: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });

    expect(budget.fixedMarksPerVariation).toBe(1);
    expect(budget.maxDabsPerVariation).toBe(
      STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET - 1,
    );
    expect(budget.estimatedMarks).toBe(
      STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    );
    expect(budget.acceptedPrefixReceipt).toMatchObject({
      fixedMarksPerVariation: 1,
      acceptedMarkBudget:
        STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });
  });

  it("does not add an origin anchor or budget reserve to ordinary spray", () => {
    const plan = readyPlan(
      element("ordinary-spray", "spray", [100, 100, 109, 103]),
      true,
    );
    const plannedDabs = dabs(plan);
    const marks = coverage(plan).marks;

    expect(plan.renderBudget.fixedMarksPerVariation).toBe(0);
    expect(marks).toHaveLength(plannedDabs.length);
    expect(marks.some(
      (mark) =>
        mark.x === plannedDabs[0]?.sourceX
        && mark.y === plannedDabs[0]?.sourceY,
    )).toBe(false);
  });
});
