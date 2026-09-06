import { describe, expect, it } from "vitest";

import { StudioPathfinderVectorEngine } from "./studio-pathfinder-vector-engine";

describe("StudioPathfinderVectorEngine", () => {
  it("expands 2D point sequence into offset path outline polygon", () => {
    const points = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
    ];
    const polygon = StudioPathfinderVectorEngine.offsetPathOutline(points, 5);
    expect(polygon.points.length).toBeGreaterThan(0);
  });

  it("performs boolean union on 2D polygons", () => {
    const polyA = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };
    const polyB = { points: [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }] };
    const union = StudioPathfinderVectorEngine.booleanUnion(polyA, polyB);
    expect(union.points.length).toBe(6);
  });
});
