import { describe, expect, it } from "vitest";

import { applyMeshDeformer } from "./studio-3d-mesh-deformers";

describe("Studio 3D Mesh Deformers Engine", () => {
  const sampleCubeVertices = new Float32Array([
    -1, 0, -1,
     1, 0, -1,
     1, 1, -1,
    -1, 1, -1,
    -1, 0,  1,
     1, 0,  1,
     1, 1,  1,
    -1, 1,  1,
  ]);

  it("applies twist deformation around the Y axis", () => {
    const res = applyMeshDeformer(sampleCubeVertices, {
      kind: "twist",
      strength: 90,
      axis: "y",
      minBound: 0,
      maxBound: 1,
    });

    expect(res.originalCount).toBe(8);
    // Base vertices at y=0 should not rotate
    expect(res.deformedPositions[0]).toBeCloseTo(-1);
    expect(res.deformedPositions[2]).toBeCloseTo(-1);

    // Top vertex 2: original [1, 1, -1] rotated 90 deg -> z becomes +1
    expect(res.deformedPositions[8]).toBeCloseTo(1.0);
  });

  it("applies taper deformation creating a pyramid/cone effect", () => {
    const res = applyMeshDeformer(sampleCubeVertices, {
      kind: "taper",
      strength: -0.8, // shrink top by 80%
      axis: "y",
      minBound: 0,
      maxBound: 1,
    });

    // Top vertex width should be much smaller
    const topX = res.deformedPositions[6];
    expect(Math.abs(topX!)).toBeLessThan(1.0);
  });

  it("applies volume-preserving squash and stretch", () => {
    const res = applyMeshDeformer(sampleCubeVertices, {
      kind: "squash-stretch",
      strength: 0.5, // 50% taller, thinner in X/Z
      axis: "y",
      minBound: 0,
      maxBound: 1,
    });

    expect(res.boundingBox.max[1]).toBeGreaterThan(1.0);
    expect(res.boundingBox.max[0]).toBeLessThan(1.0);
  });
});
