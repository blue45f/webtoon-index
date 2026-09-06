import { describe, expect, it } from "vitest";

import {
  applyLiquifyBrush,
  createMeshWarpGrid,
  displaceMeshControlPoint,
  evaluateMeshWarpPosition,
} from "./studio-mesh-warp-liquify";

describe("Studio Mesh Warp & Interactive Liquify Deformer", () => {
  it("creates mesh grid and displaces control points with bilinear evaluation", () => {
    let grid = createMeshWarpGrid({ x: 0, y: 0, width: 400, height: 400 }, 2, 2);
    expect(grid.controlPoints).toHaveLength(9); // (2+1) x (2+1) = 9

    // Undisplaced center point evaluation at u=0.5, v=0.5
    const centerBefore = evaluateMeshWarpPosition(grid, 0.5, 0.5);
    expect(centerBefore[0]).toBe(200);
    expect(centerBefore[1]).toBe(200);

    // Displace center control point (col=1, row=1) by dx=50, dy=-30
    grid = displaceMeshControlPoint(grid, 1, 1, 50, -30);
    const centerAfter = evaluateMeshWarpPosition(grid, 0.5, 0.5);
    expect(centerAfter[0]).toBe(250);
    expect(centerAfter[1]).toBe(170);
  });

  it("applies push-forward liquify brush to nearby points", () => {
    const points = [
      { x: 100, y: 100 }, // Center
      { x: 105, y: 100 }, // Close to center
      { x: 300, y: 300 }, // Far away (out of radius)
    ];

    const deformed = applyLiquifyBrush(
      points,
      [100, 100],
      "push-forward",
      50, // radius
      1.0, // strength
      [20, 0], // direction vector (+20px X)
    );

    expect(deformed[0].x).toBeCloseTo(120, 0); // Moved +20px
    expect(deformed[1].x).toBeGreaterThan(105);
    expect(deformed[2].x).toBe(300); // Untouched
  });

  it("applies expand-bloat and pinch-pucker brush modes", () => {
    const points = [{ x: 110, y: 100 }]; // 10px to right of center (100, 100)

    // Bloat moves points outward
    const bloated = applyLiquifyBrush(points, [100, 100], "expand-bloat", 50, 1.0);
    expect(bloated[0].x).toBeGreaterThan(110);

    // Pinch moves points inward
    const pinched = applyLiquifyBrush(points, [100, 100], "pinch-pucker", 50, 1.0);
    expect(pinched[0].x).toBeLessThan(110);
  });

  it("applies twirl-cw rotation to points", () => {
    const points = [{ x: 100, y: 80 }]; // Point above center (100, 100)
    const twirled = applyLiquifyBrush(points, [100, 100], "twirl-cw", 50, 1.0);

    // Clockwise rotation shifts point to the right (+X)
    expect(twirled[0].x).toBeGreaterThan(100);
  });
});
