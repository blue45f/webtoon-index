import { describe, expect, it } from "vitest";

import {
  applyStudioWebComicCelGrade,
  applyStudioWebHalftoneGrade,
  applyStudioWebInkEdgeBoostGrade,
  applyStudioWebSoftColorBoostGrade,
  applyStudioWebWatercolorWashGrade,
  isStudioWebColoringBrushId,
  planStudioWebBlendSoftenerSamples,
  planStudioWebCelFlatSamples,
  planStudioWebColoringSamplesForBrush,
  planStudioWebDotToneSamples,
  planStudioWebHatchColorSamples,
  planStudioWebLinearGradientFill,
  planStudioWebRadialGradientFill,
  sampleStudioWebGradientFill,
  STUDIO_WEB_COLORING_BRUSH_IDS,
} from "./studio-web-drawing-coloring-kit";

const PATH = Object.freeze([
  { x: 40, y: 40, pressure: 0.35 },
  { x: 60, y: 48, pressure: 0.7 },
  { x: 90, y: 55, pressure: 0.95 },
  { x: 120, y: 70, pressure: 0.55 },
  { x: 150, y: 90, pressure: 0.4 },
]);

describe("studio web drawing coloring kit", () => {
  it("exposes four colouring brush ids", () => {
    expect(STUDIO_WEB_COLORING_BRUSH_IDS).toHaveLength(4);
    expect(isStudioWebColoringBrushId("web-hatch-color")).toBe(true);
    expect(isStudioWebColoringBrushId("web-dot-tone")).toBe(true);
    expect(isStudioWebColoringBrushId("web-lazy-ink")).toBe(false);
  });

  it("hatch colouring samples are deterministic lattice stations", () => {
    const a = planStudioWebHatchColorSamples(PATH, { spacing: 6, angleDegrees: 45 });
    const b = planStudioWebHatchColorSamples(PATH, { spacing: 6, angleDegrees: 45 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(PATH.length);
    expect(a.every((s) => Math.abs(s.angleRadians - Math.PI / 4) < 1e-9)).toBe(true);
  });

  it("cel flat samples stay sparse and high-opacity", () => {
    const longPath = Array.from({ length: 200 }, (_, i) => ({
      x: i * 2,
      y: 20 + Math.sin(i / 8) * 4,
      pressure: 0.6,
    }));
    const samples = planStudioWebCelFlatSamples(longPath, { baseSize: 24, hardness: 0.95 });
    expect(samples.length).toBeLessThan(longPath.length);
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every((s) => s.opacity >= 0.75)).toBe(true);
  });

  it("blend softener keeps low opacity soft deposits", () => {
    const samples = planStudioWebBlendSoftenerSamples(PATH, {
      baseSize: 32,
      softness: 0.9,
    });
    expect(samples).toHaveLength(PATH.length);
    expect(samples.every((s) => s.opacity <= 0.35)).toBe(true);
    expect(samples.every((s) => s.size >= 16)).toBe(true);
  });

  it("dot tone samples snap to a jittered grid and are deterministic", () => {
    const a = planStudioWebDotToneSamples(PATH, { pitch: 8, seed: 11 });
    const b = planStudioWebDotToneSamples(PATH, { pitch: 8, seed: 11 });
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    // Dense path should collapse to unique grid cells.
    const denser = planStudioWebDotToneSamples(
      Array.from({ length: 40 }, (_, i) => ({ x: 10 + i * 0.5, y: 10, pressure: 0.7 })),
      { pitch: 8, seed: 11 },
    );
    expect(denser.length).toBeLessThan(40);
  });

  it("dispatcher routes each colouring brush id", () => {
    for (const id of STUDIO_WEB_COLORING_BRUSH_IDS) {
      const samples = planStudioWebColoringSamplesForBrush(id, PATH, { baseSize: 10, seed: 3 });
      expect(samples.length, id).toBeGreaterThan(0);
    }
    expect(planStudioWebColoringSamplesForBrush("pen", PATH)).toEqual([]);
  });

  it("rejects invalid coordinates and empty paths", () => {
    expect(planStudioWebHatchColorSamples([])).toEqual([]);
    expect(planStudioWebCelFlatSamples([{ x: Number.NaN, y: 1 }])).toEqual([]);
    expect(planStudioWebDotToneSamples([{ x: 1e12, y: 0 }])).toEqual([]);
  });

  it("plans linear and radial gradient fills with interpolable stops", () => {
    const linear = planStudioWebLinearGradientFill({
      x0: 0,
      y0: 0,
      x1: 100,
      y1: 0,
      stops: [
        { t: 0, r: 255, g: 0, b: 0, a: 255 },
        { t: 1, r: 0, g: 0, b: 255, a: 255 },
      ],
    });
    expect(linear).not.toBeNull();
    const mid = sampleStudioWebGradientFill(linear!, 50, 0);
    expect(mid[0]).toBeGreaterThan(100);
    expect(mid[0]).toBeLessThan(200);
    expect(mid[2]).toBeGreaterThan(100);

    const radial = planStudioWebRadialGradientFill({
      cx: 50,
      cy: 50,
      radius: 30,
      stops: [
        { t: 0, r: 255, g: 255, b: 255, a: 255 },
        { t: 1, r: 0, g: 0, b: 0, a: 255 },
      ],
    });
    expect(radial).not.toBeNull();
    const center = sampleStudioWebGradientFill(radial!, 50, 50);
    expect(center[0]).toBe(255);
  });

  it("comic cel grade quantizes colours and darkens edges", () => {
    const width = 8;
    const height = 8;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        // Hard step edge through the middle.
        const v = x < 4 ? 40 : 210;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    const changed = applyStudioWebComicCelGrade(
      { data, width, height },
      { levels: 4, edgeStrength: 0.8 },
    );
    expect(changed).toBeGreaterThan(0);
  });

  it("halftone and ink-edge boost grades mutate non-flat images", () => {
    const width = 16;
    const height = 16;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const v = x < 8 ? 40 : 200;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 255;
      }
    }
    expect(
      applyStudioWebHalftoneGrade(
        { data: new Uint8ClampedArray(data), width, height },
        { pitch: 4, strength: 0.7 },
      ),
    ).toBeGreaterThan(0);
    expect(
      applyStudioWebInkEdgeBoostGrade(
        { data: new Uint8ClampedArray(data), width, height },
        { strength: 0.6 },
      ),
    ).toBeGreaterThan(0);
  });

  it("watercolor wash and soft colour boost grades mutate pixels when strength > 0", () => {
    const width = 4;
    const height = 4;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      data[o] = 180;
      data[o + 1] = 90;
      data[o + 2] = 60;
      data[o + 3] = 255;
    }
    const wash = applyStudioWebWatercolorWashGrade(
      { data: new Uint8ClampedArray(data), width, height },
      { strength: 0.6 },
    );
    expect(wash).toBeGreaterThan(0);

    const boost = applyStudioWebSoftColorBoostGrade(
      { data: new Uint8ClampedArray(data), width, height },
      { strength: 0.5 },
    );
    expect(boost).toBeGreaterThan(0);

    expect(
      applyStudioWebWatercolorWashGrade(
        { data: new Uint8ClampedArray(data), width, height },
        { strength: 0 },
      ),
    ).toBe(0);
  });
});
