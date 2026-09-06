import { describe, expect, it } from "vitest";

import {
  LIQUIFY_MAX_INPUT_POINTS,
  buildLiquifyDisplacementField,
  liquifyBrushWeight,
  planLiquifyBrushDabs,
  resampleLiquifyPath,
  stabilizeLiquifyPath,
  type LiquifyDisplacementField,
} from "./studio-liquify";
import {
  applyStudioLiquifyFieldRefinement,
  planStudioLiquifyFieldRefinement,
  refineStudioLiquifyDisplacementField,
} from "./studio-liquify-refinement";

function fieldWithCenterSpike(): LiquifyDisplacementField {
  const dx = new Float32Array(25);
  const dy = new Float32Array(25);
  dx[12] = 9;
  dy[12] = -9;
  return { originX: 0, originY: 0, width: 5, height: 5, dx, dy };
}

describe("studio liquify brush dynamics", () => {
  it("interpolates pressure with resampled geometry", () => {
    const points = resampleLiquifyPath([
      { x: 0, y: 0, pressure: 0 },
      { x: 10, y: 0, pressure: 1 },
    ], 5);

    expect(points).toEqual([
      { x: 0, y: 0, pressure: 0 },
      { x: 5, y: 0, pressure: 0.5 },
      { x: 10, y: 0, pressure: 1 },
    ]);
  });

  it("maps pen pressure independently to radius and strength with a minimum-radius floor", () => {
    const plan = planLiquifyBrushDabs(
      [{ x: 20, y: 20, pressure: 0.25 }],
      20,
      0.8,
      {
        mode: "bloat",
        pressureAffectsRadius: true,
        pressureAffectsStrength: true,
        minimumRadiusRatio: 0.2,
      }
    );

    expect(plan.complete).toBe(true);
    expect(plan.dabs).toHaveLength(1);
    expect(plan.dabs[0]).toMatchObject({ radius: 8, strength: 0.2 });
  });

  it("keeps endpoints while the stabilizer attenuates a noisy middle sample", () => {
    const original = [
      { x: 0, y: 0, pressure: 0.2 },
      { x: 5, y: 20, pressure: 0.5 },
      { x: 10, y: 0, pressure: 0.8 },
    ];
    const stabilized = stabilizeLiquifyPath(original, 1);

    expect(stabilized[0]).toEqual(original[0]);
    expect(stabilized[2]).toEqual(original[2]);
    expect(stabilized[1]!.y).toBeLessThan(original[1]!.y);
    expect(stabilized[1]!.pressure).toBeGreaterThan(0.2);
    expect(stabilized[1]!.pressure).toBeLessThan(0.8);
  });

  it("hardness expands the solid core without changing the exact brush boundary", () => {
    expect(liquifyBrushWeight(8, 0, 10, 1)).toBeGreaterThan(
      liquifyBrushWeight(8, 0, 10, 0)
    );
    expect(liquifyBrushWeight(10, 0, 10, 1)).toBe(0);
    expect(liquifyBrushWeight(10, 0, 10, 0)).toBe(0);
  });

  it("rejects overlong input and excessive cell visits instead of silently truncating", () => {
    const overlong = Array.from({ length: LIQUIFY_MAX_INPUT_POINTS + 1 }, (_, index) => ({
      x: index,
      y: 0,
    }));
    expect(planLiquifyBrushDabs(overlong, 10, 1, { mode: "push" }))
      .toMatchObject({ dabs: [], complete: false });

    const expensive = Array.from({ length: 40 }, (_, index) => ({
      x: 1_000 + index * 100,
      y: 1_000,
    }));
    expect(planLiquifyBrushDabs(expensive, 1_000, 1, {
      mode: "bloat",
      spacingRatio: 0.1,
    })).toMatchObject({ dabs: [], complete: false });
  });

  it("applies the dynamic plan through the existing displacement engine deterministically", () => {
    const options = {
      mode: "bloat" as const,
      hardness: 0.75,
      pressureAffectsRadius: true,
      pressureAffectsStrength: true,
      minimumRadiusRatio: 0.1,
      spacingRatio: 0.2,
    };
    const points = [{ x: 50, y: 50, pressure: 0.5 }];
    const first = buildLiquifyDisplacementField(points, 20, 0.8, 100, 100, options)!;
    const second = buildLiquifyDisplacementField(points, 20, 0.8, 100, 100, options)!;

    expect(second).toEqual(first);
    expect(new Uint8Array(second.dx.buffer)).toEqual(new Uint8Array(first.dx.buffer));
    expect(new Uint8Array(second.dy.buffer)).toEqual(new Uint8Array(first.dy.buffer));
    expect(first.width).toBeLessThanOrEqual(23);
  });
});

describe("studio liquify reconstruct and smooth field plans", () => {
  it("reconstruct reduces retained deformation without mutating the session field", () => {
    const field = fieldWithCenterSpike();
    const originalDx = field.dx.slice();
    const plan = planStudioLiquifyFieldRefinement(
      field,
      [{ x: 2, y: 2, pressure: 1 }],
      3,
      1,
      "reconstruct",
      { hardness: 1, pressureAffectsStrength: true }
    )!;
    const refined = applyStudioLiquifyFieldRefinement(field, plan)!;

    expect(plan.influence).toBeInstanceOf(Float32Array);
    expect(refined.dx[12]).toBe(0);
    expect(refined.dy[12]).toBe(0);
    expect(field.dx).toEqual(originalDx);
  });

  it("smooth attenuates an isolated vector spike and shares its direction locally", () => {
    const field = fieldWithCenterSpike();
    const refined = refineStudioLiquifyDisplacementField(
      field,
      [{ x: 2, y: 2 }],
      3,
      1,
      "smooth",
      { hardness: 1 }
    )!;

    expect(refined.dx[12]).toBeCloseTo(1, 6);
    expect(refined.dy[12]).toBeCloseTo(-1, 6);
    expect(refined.dx[11]).toBeGreaterThan(0);
    expect(refined.dy[11]).toBeLessThan(0);
  });

  it("produces byte-deterministic structured-clone-safe plans", () => {
    const field = fieldWithCenterSpike();
    const input = [
      { x: 1.25, y: 2.5, pressure: 0.3 },
      { x: 3.25, y: 2.5, pressure: 0.9 },
    ];
    const first = planStudioLiquifyFieldRefinement(field, input, 2.5, 0.7, "smooth", {
      hardness: 0.4,
      pressureAffectsRadius: true,
      minimumRadiusRatio: 0.2,
    })!;
    const second = planStudioLiquifyFieldRefinement(field, input, 2.5, 0.7, "smooth", {
      hardness: 0.4,
      pressureAffectsRadius: true,
      minimumRadiusRatio: 0.2,
    })!;

    expect(second).toEqual(first);
    expect(new Uint8Array(second.influence.buffer)).toEqual(new Uint8Array(first.influence.buffer));
    expect(structuredClone(first)).toEqual(first);
  });

  it("preserves Abort semantics before planning and during immutable application", () => {
    const field = fieldWithCenterSpike();
    const controller = new AbortController();
    controller.abort();
    expect(() => planStudioLiquifyFieldRefinement(
      field,
      [{ x: 2, y: 2 }],
      3,
      1,
      "reconstruct",
      { signal: controller.signal }
    )).toThrow(expect.objectContaining({ name: "AbortError" }));

    const plan = planStudioLiquifyFieldRefinement(
      field,
      [{ x: 2, y: 2 }],
      3,
      1,
      "reconstruct"
    )!;
    expect(() => applyStudioLiquifyFieldRefinement(field, plan, controller.signal))
      .toThrow(expect.objectContaining({ name: "AbortError" }));
  });
});
