import { describe, expect, it } from "vitest";

import { StudioSixEngineFilterService } from "./studio-six-engine-filter-service";

describe("StudioSixEngineFilterService", () => {
  it("applies Glance GPU preview filters", () => {
    const input = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < input.length; i += 4) {
      input[i] = 120;
      input[i + 1] = 140;
      input[i + 2] = 160;
      input[i + 3] = 200;
    }
    const output = StudioSixEngineFilterService.applyGlanceFilters(input, 4, 4, { wetEdgeGloss: 0.4 });
    expect(output.length).toBe(input.length);
  });

  it("creates Krita tip masks with dual brush blending", () => {
    const mask = StudioSixEngineFilterService.createKritaTipMask(
      { shape: "gaussian", diameter: 12, ratio: 1.0, angleDeg: 0, hardness: 0.7, fade: 1.0, spikes: 5, ringThickness: 0.3 },
      {
        config: { shape: "ring", diameter: 12, ratio: 1.0, angleDeg: 0, hardness: 0.5, fade: 1.0, spikes: 5, ringThickness: 0.4 },
        mode: "multiply",
      }
    );
    expect(mask.width).toBe(12);
    expect(mask.height).toBe(12);
  });

  it("generates MyPaint smudge and velocity dabs", () => {
    const dabs = StudioSixEngineFilterService.generateMyPaintDabs([
      { x: 0, y: 0, pressure: 0.5, timeMs: 0 },
      { x: 20, y: 0, pressure: 0.8, timeMs: 16 },
    ]);
    expect(dabs.length).toBeGreaterThan(0);
  });

  it("offsets vector paths using Pathfinder engine", () => {
    const poly = StudioSixEngineFilterService.offsetVectorPath(
      [{ x: 0, y: 0 }, { x: 40, y: 0 }],
      6
    );
    expect(poly.points.length).toBeGreaterThan(0);
  });

  it("bins Vello tiles and resolves Freehand profiles", () => {
    const tiles = StudioSixEngineFilterService.binVelloTiles(
      [{ x0: 0, y0: 0, x1: 32, y1: 32 }],
      { width: 4, lineCap: "round", lineJoin: "round", miterLimit: 4, color: { r: 0, g: 0, b: 0, a: 1 } }
    );
    expect(tiles.length).toBeGreaterThan(0);

    const profile = StudioSixEngineFilterService.getFreehandProfile("perfect-ink");
    expect(profile).toBeDefined();
    expect(profile.thinning).toBeGreaterThan(0);
  });
});
