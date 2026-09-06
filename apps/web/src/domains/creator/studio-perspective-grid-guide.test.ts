import { describe, expect, it } from "vitest";

import { snapToStudioPerspectiveGrid } from "./studio-perspective-grid-guide";

describe("snapToStudioPerspectiveGrid", () => {
  it("snaps pen input coordinate to nearest perspective ray within radius", () => {
    const config = {
      type: "1point" as const,
      vanishingPoints: [{ x: 500, y: 500 }],
      horizonY: 500,
      snapRadiusPx: 20,
    };

    // Point near horizontal line y=500
    const result = snapToStudioPerspectiveGrid(700, 503, config);
    expect(result.activeVanishingPointIndex).toBe(0);
    expect(result.snappedY).toBeCloseTo(500, 0);
  });

  it("returns un-snapped coordinate if distance exceeds snap radius", () => {
    const config = {
      type: "1point" as const,
      vanishingPoints: [{ x: 500, y: 500 }],
      horizonY: 500,
      snapRadiusPx: 5,
    };

    const result = snapToStudioPerspectiveGrid(700, 580, config);
    expect(result.activeVanishingPointIndex).toBe(-1);
    expect(result.snappedX).toBe(700);
    expect(result.snappedY).toBe(580);
  });
});
