import { describe, expect, it } from "vitest";

import { planCsgBooleanOperation } from "./studio-3d-csg-boolean-engine";

describe("Studio 3D CSG Boolean Engine", () => {
  it("plans a boolean difference operation (hole cutting)", () => {
    const res = planCsgBooleanOperation({
      operation: "difference",
      target: {
        id: "wall-1",
        type: "box",
        position: [0, 1.5, 0],
        rotation: [0, 0, 0],
        scale: [4, 3, 0.2],
      },
      cutter: {
        id: "window-hole",
        type: "box",
        position: [0, 1.5, 0],
        rotation: [0, 0, 0],
        scale: [1.2, 1.4, 0.5],
      },
    });

    expect(res.operation).toBe("difference");
    expect(res.targetId).toBe("wall-1");
    expect(res.cutterId).toBe("window-hole");
    expect(res.isManifold).toBe(true);
    expect(res.estimatedTriangles).toBeGreaterThan(0);
  });

  it("plans a smooth clay blend operation with smooth radius factors", () => {
    const res = planCsgBooleanOperation({
      operation: "smooth-clay-blend",
      target: {
        id: "body-sphere",
        type: "sphere",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [2, 2, 2],
      },
      cutter: {
        id: "arm-capsule",
        type: "capsule",
        position: [1.5, 0.5, 0],
        rotation: [0, 0, 30],
        scale: [0.8, 2, 0.8],
      },
      smoothBlendRadius: 0.5,
    });

    expect(res.operation).toBe("smooth-clay-blend");
    expect(res.bounds.min[0]).toBeLessThan(0);
    expect(res.bounds.max[0]).toBeGreaterThan(1.5);
  });
});
