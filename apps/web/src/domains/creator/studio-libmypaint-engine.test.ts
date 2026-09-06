import { describe, expect, it } from "vitest";

import {
  DEFAULT_MYPAINT_BRUSH_SETTINGS,
  StudioLibmypaintEngine,
} from "./studio-libmypaint-engine";

describe("StudioLibmypaintEngine", () => {
  it("initializes with default MyPaint brush settings", () => {
    const engine = new StudioLibmypaintEngine();
    expect(engine).toBeDefined();
    expect(DEFAULT_MYPAINT_BRUSH_SETTINGS.smudge).toBe(0.45);
  });

  it("generates natural MyPaint dabs along input points", () => {
    const engine = new StudioLibmypaintEngine({ radiusLogarithmic: 2.0 }, { r: 50, g: 100, b: 150, a: 1 });
    const points = [
      { x: 10, y: 10, pressure: 0.5, timeMs: 0 },
      { x: 30, y: 10, pressure: 0.8, timeMs: 16 },
      { x: 50, y: 10, pressure: 1.0, timeMs: 32 },
    ];
    const dabs = engine.generateDabs(points);
    expect(dabs.length).toBeGreaterThan(0);
    expect(dabs[0]!.x).toBe(10);
    expect(dabs[dabs.length - 1]!.x).toBe(50);
  });

  it("blends canvas smudge color when canvas sampling is provided", () => {
    const engine = new StudioLibmypaintEngine({ smudge: 0.8 }, { r: 255, g: 0, b: 0, a: 1 });
    const sampleCanvas = (_x: number, _y: number) => ({ r: 0, g: 255, b: 0, a: 1 });
    const points = [
      { x: 0, y: 0, pressure: 0.5, timeMs: 0 },
      { x: 10, y: 0, pressure: 0.5, timeMs: 16 },
    ];
    const dabs = engine.generateDabs(points, sampleCanvas);
    expect(dabs.length).toBeGreaterThan(0);
    expect(dabs[0]!.color.g).toBeGreaterThan(0);
  });
});
