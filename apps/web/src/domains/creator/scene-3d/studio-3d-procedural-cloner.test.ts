import { describe, expect, it } from "vitest";

import {
  generateLinearCloner,
  generateRadialCloner,
  generateGridCloner,
} from "./studio-3d-procedural-cloner";

describe("Studio 3D Procedural Cloner", () => {
  it("generates linear cloner instances with offsets and step rotations", () => {
    const res = generateLinearCloner({
      count: 5,
      spacing: [1.5, 0.5, 0],
      rotationStep: [0, 45, 0],
      scaleMultiplier: [1, 1, 1],
      noiseJitter: [0, 0, 0],
      randomSeed: 1,
    });

    expect(res.clonerType).toBe("linear");
    expect(res.totalInstances).toBe(5);
    expect(res.instances[0].position).toEqual([0, 0, 0]);
    expect(res.instances[1].position).toEqual([1.5, 0.5, 0]);
    expect(res.instances[2].rotation).toEqual([0, 90, 0]);
  });

  it("generates radial cloner instances around y-axis with tangent alignment", () => {
    const res = generateRadialCloner({
      count: 4,
      radius: 10,
      arcDegrees: 360,
      axis: "y",
      alignToTangent: true,
      spiralHeight: 2,
    });

    expect(res.clonerType).toBe("radial");
    expect(res.totalInstances).toBe(4);
    expect(res.instances[0].position[1]).toBeCloseTo(0);
    expect(res.instances[3].position[1]).toBeCloseTo(2);
  });

  it("generates 3D grid cloner instances with center offsets", () => {
    const res = generateGridCloner({
      countX: 3,
      countY: 2,
      countZ: 2,
      spacingX: 2,
      spacingY: 1.5,
      spacingZ: 3,
      centerGrid: true,
      noiseJitter: [0, 0, 0],
      randomSeed: 42,
    });

    expect(res.clonerType).toBe("grid");
    expect(res.totalInstances).toBe(12); // 3 * 2 * 2
    // First instance should be offset to center
    expect(res.instances[0].position[0]).toBe(-2);
    expect(res.instances[0].position[1]).toBe(-0.75);
    expect(res.instances[0].position[2]).toBe(-1.5);
  });
});
