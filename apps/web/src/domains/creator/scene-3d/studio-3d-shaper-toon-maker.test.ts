import { describe, it, expect } from "vitest";

import { Studio3DShaperToonMaker } from "./studio-3d-shaper-toon-maker";

describe("Studio3DShaperToonMaker", () => {
  it("initializes with default shonen archetype and standard styling slots", () => {
    const maker = new Studio3DShaperToonMaker();
    expect(maker.getArchetype()).toBe("shonen-hero-8head");
    expect(maker.getStyling().hairstyleId).toBe("short-messy-hero");
    expect(maker.getStyling().outfitId).toBe("korean-school-uniform-v1");
  });

  it("evaluates archetype proportions accurately for SD Chibi vs Hero", () => {
    const heroMaker = new Studio3DShaperToonMaker("shonen-hero-8head");
    const heroProp = heroMaker.evaluateArchetypeProportions();
    expect(heroProp.legLengthRatio).toBeGreaterThan(0.55);
    expect(heroProp.headScale[0]).toBeLessThan(1.0);

    const chibiMaker = new Studio3DShaperToonMaker("sd-chibi-4head");
    const chibiProp = chibiMaker.evaluateArchetypeProportions();
    expect(chibiProp.headScale[0]).toBe(1.8);
    expect(chibiProp.legLengthRatio).toBe(0.42);
  });

  it("evaluates 3D surface ink world positions via barycentric interpolation", () => {
    const maker = new Studio3DShaperToonMaker();

    // Triangle 0: (0,0,0), (10,0,0), (0,10,0)
    const vertices = new Float32Array([
      0, 0, 0,
      10, 0, 0,
      0, 10, 0,
    ]);
    const indices = new Uint32Array([0, 1, 2]);

    const stroke = {
      id: "stroke-1",
      targetMeshId: "character-face",
      colorHex: "#ff0000",
      width: 2,
      opacity: 1,
      points: [
        {
          triangleIndex: 0,
          barycentric: [0.5, 0.5, 0.0] as const, // Midpoint between v0 and v1 -> (5, 0, 0)
          pressure: 1,
          localOffset: 0,
        },
        {
          triangleIndex: 0,
          barycentric: [0.3333, 0.3333, 0.3334] as const, // Centroid -> (3.33, 3.33, 0)
          pressure: 0.8,
          localOffset: 0,
        },
      ],
    };

    const worldPts = maker.evaluateStrokeWorldPositions(stroke, vertices, indices);
    expect(worldPts.length).toBe(2);
    expect(worldPts[0][0]).toBeCloseTo(5.0, 3);
    expect(worldPts[0][1]).toBeCloseTo(0.0, 3);
    expect(worldPts[1][0]).toBeCloseTo(3.333, 2);
    expect(worldPts[1][1]).toBeCloseTo(3.333, 2);
  });
});
