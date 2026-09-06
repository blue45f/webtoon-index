import { describe, expect, it } from "vitest";

import { groundModelTransform } from "./studio-bg3d-object-ops";
import { planStudioBg3dModelPlacementRecipe } from "./studio-bg3d-placement-recipe";

describe("planStudioBg3dModelPlacementRecipe", () => {
  it("returns identity-scale grounded placement for a unit seed", () => {
    const result = planStudioBg3dModelPlacementRecipe({
      position: [3, 99, -1],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      boundingSize: [2, 4, 2],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same ground contract as groundModelTransform (halfExtentsFromSize + groundTransformPosition).
    expect(result.position).toEqual(
      groundModelTransform([2, 4, 2], [3, 99, -1], [0, 0, 0], [1, 1, 1]),
    );
    expect(result.rotation).toEqual([0, 0, 0]);
    expect(result.scale).toEqual([1, 1, 1]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("auto-fits so the largest bounding extent does not exceed the target", () => {
    const result = planStudioBg3dModelPlacementRecipe({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [2, 2, 2],
      boundingSize: [4, 2, 1],
      autoFitTargetSize: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // max(|4*2|, |2*2|, |1*2|) = 8 → factor 2/8 = 0.25 → scale 0.5
    expect(result.scale[0]).toBeCloseTo(0.5, 9);
    expect(result.scale[1]).toBeCloseTo(0.5, 9);
    expect(result.scale[2]).toBeCloseTo(0.5, 9);
    const extents = [4, 2, 1].map((size, index) => Math.abs(size * result.scale[index]));
    expect(Math.max(...extents)).toBeLessThanOrEqual(2 + 1e-9);
  });

  it("does not enlarge models already under the auto-fit target", () => {
    const result = planStudioBg3dModelPlacementRecipe({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      boundingSize: [1, 1, 1],
      autoFitTargetSize: 4,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scale).toEqual([1, 1, 1]);
  });

  it("grounds to a custom groundY and applies yaw degrees to rotation Y", () => {
    const result = planStudioBg3dModelPlacementRecipe({
      position: [1, 0, 2],
      rotation: [0.1, 0.2, 0.3],
      scale: [1, 1, 1],
      boundingSize: [2, 2, 2],
      groundY: 5,
      yawDegrees: 90,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rotation[0]).toBeCloseTo(0.1, 9);
    expect(result.rotation[1]).toBeCloseTo(0.2 + Math.PI / 2, 9);
    expect(result.rotation[2]).toBeCloseTo(0.3, 9);
    // Yaw changes the oriented AABB, so ground height is recomputed from the final rotation —
    // not the naive half-extent on groundY alone.
    expect(result.position).toEqual(
      groundModelTransform(
        [2, 2, 2],
        [1, 0, 2],
        [result.rotation[0], result.rotation[1], result.rotation[2]],
        [1, 1, 1],
        5,
      ),
    );
    expect(result.position[0]).toBe(1);
    expect(result.position[2]).toBe(2);
    expect(result.position[1]).toBeGreaterThan(5);
  });

  it("fails closed on non-finite and invalid inputs without mutating the seed", () => {
    const seed = {
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      boundingSize: [1, 1, 1] as [number, number, number],
    };
    const snapshot = structuredClone(seed);

    expect(planStudioBg3dModelPlacementRecipe({
      ...seed,
      position: [0, Number.NaN, 0],
    }).ok).toBe(false);
    expect(planStudioBg3dModelPlacementRecipe({
      ...seed,
      autoFitTargetSize: 0,
    }).ok).toBe(false);
    expect(planStudioBg3dModelPlacementRecipe({
      ...seed,
      yawDegrees: Number.POSITIVE_INFINITY,
    }).ok).toBe(false);
    expect(planStudioBg3dModelPlacementRecipe({
      ...seed,
      scale: [0, 1, 1],
    }).ok).toBe(false);
    expect(planStudioBg3dModelPlacementRecipe(null as never).ok).toBe(false);

    for (const result of [
      planStudioBg3dModelPlacementRecipe({ ...seed, position: [Number.NaN, 0, 0] }),
      planStudioBg3dModelPlacementRecipe({ ...seed, autoFitTargetSize: -1 }),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(typeof result.reason).toBe("string");
        expect(result.reason.length).toBeGreaterThan(0);
        // Korean failure copy for user-facing paths.
        expect(/[가-힣]/u.test(result.reason)).toBe(true);
      }
    }

    expect(seed).toEqual(snapshot);
  });
});
