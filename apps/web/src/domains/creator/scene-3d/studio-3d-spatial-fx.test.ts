import { describe, it, expect } from "vitest";

import { Studio3DSpatialFxEngine } from "./studio-3d-spatial-fx";

describe("Studio3DSpatialFxEngine", () => {
  it("generates 3D perspective focus speed lines", () => {
    const fx = new Studio3DSpatialFxEngine();
    const lines = fx.generateFocusSpeedLines({
      center: [0, 1.5, 0],
      rayCount: 24,
      innerRadius: 1.0,
      outerRadius: 5.0,
      lineThickness: 2.0,
      colorHex: "#000000",
      opacity: 0.85,
    });

    expect(lines.length).toBe(24);
    expect(lines[0].start[1]).toBeCloseTo(1.5, 1);
    expect(lines[0].thickness).toBe(2.0);
  });

  it("generates 3D impact starburst vertices", () => {
    const fx = new Studio3DSpatialFxEngine();
    const vertices = fx.generateImpactStarburstVertices({
      position: [1, 2, 0],
      pointCount: 8,
      innerRadius: 0.5,
      outerRadius: 1.8,
      colorHex: "#ffbe0b",
      rotationSpeedDeg: 0,
    });

    // 8 points -> 16 vertices -> 48 float numbers (x, y, z)
    expect(vertices.length).toBe(48);
  });

  it("creates 3D onomatopoeia SFX typography presets with custom color palettes and depths", () => {
    const fx = new Studio3DSpatialFxEngine();

    const crash = fx.createSfxPreset("쾅", [0, 2, 0], 1.5);
    expect(crash.text).toBe("쾅");
    expect(crash.fillColorHex).toBe("#ffbe0b");
    expect(crash.extrusionDepth).toBeGreaterThan(0.1);

    const whoosh = fx.createSfxPreset("촤아악", [1, 1, 0], 1.2);
    expect(whoosh.text).toBe("촤아악");
    expect(whoosh.fillColorHex).toBe("#4cc9f0");
  });
});
