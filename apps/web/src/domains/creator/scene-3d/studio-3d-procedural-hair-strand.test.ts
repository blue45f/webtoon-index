import { describe, it, expect } from "vitest";

import { Studio3DProceduralHairStrandGenerator } from "./studio-3d-procedural-hair-strand";

describe("Studio3DProceduralHairStrandGenerator", () => {
  it("evaluates curve points along quadratic Bezier with gravity sag", () => {
    const generator = new Studio3DProceduralHairStrandGenerator();
    const strand = {
      id: "hair-strand-1",
      rootPoint: [0, 1.8, 0] as const,
      midPoint: [0.1, 1.6, 0.2] as const,
      tipPoint: [0.15, 1.2, 0.3] as const,
      baseWidth: 0.04,
      profile: "triangular-anime-spike" as const,
      taperExponent: 1.2,
      gravitySag: 0.05,
      twistDeg: 30,
    };

    const root = generator.evaluateCurvePoint(strand, 0.0);
    expect(root[0]).toBe(0);
    expect(root[1]).toBe(1.8);

    const mid = generator.evaluateCurvePoint(strand, 0.5);
    // Gravity sag reduces Y coordinate at midpoint
    expect(mid[1]).toBeLessThan(1.6);

    const tip = generator.evaluateCurvePoint(strand, 1.0);
    expect(tip[0]).toBe(0.15);
    expect(tip[1]).toBe(1.2);
  });

  it("generates valid WebGL triangle vertex buffers for hair strands", () => {
    const generator = new Studio3DProceduralHairStrandGenerator();
    generator.addStrand({
      id: "strand-front-ahoge",
      rootPoint: [0, 1.85, 0],
      midPoint: [0, 2.05, 0.1],
      tipPoint: [0.05, 2.1, 0.05],
      baseWidth: 0.03,
      profile: "triangular-anime-spike",
      taperExponent: 1.5,
      gravitySag: 0.02,
      twistDeg: 45,
    });

    const buffers = generator.generateMeshBuffers(6);
    expect(buffers.vertexCount).toBeGreaterThan(0);
    expect(buffers.triangleCount).toBeGreaterThan(0);
    expect(buffers.positions.length).toBe(buffers.vertexCount * 3);
    expect(buffers.indices.length).toBe(buffers.triangleCount * 3);
  });
});
