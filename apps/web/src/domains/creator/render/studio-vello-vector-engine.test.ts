import { describe, expect, it } from "vitest";

import { StudioVelloVectorEngine } from "./studio-vello-vector-engine";

describe("StudioVelloVectorEngine", () => {
  it("generates fine/coarse stroke tile binning", () => {
    const vello = new StudioVelloVectorEngine(16);
    const segments = [
      { x0: 0, y0: 0, x1: 32, y1: 32 },
      { x0: 32, y0: 32, cpX: 48, cpY: 16, x1: 64, y1: 32 },
    ];
    const tiles = vello.generateTiles(segments, {
      width: 4,
      lineCap: "round",
      lineJoin: "round",
      miterLimit: 4,
      color: { r: 0, g: 0, b: 0, a: 1 },
    });

    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles[0]!.tileSize).toBe(16);
  });

  it("renders SVG path string for vector path segments", () => {
    const vello = new StudioVelloVectorEngine(16);
    const segments = [
      { x0: 10, y0: 10, x1: 50, y1: 50 },
      { x0: 50, y0: 50, cpX: 70, cpY: 30, x1: 90, y1: 50 },
    ];
    const d = vello.renderPathString(segments);
    expect(d).toContain("M 10 10 L 50 50 Q 70 30 90 50");
  });
});
