import { describe, expect, it } from "vitest";

import {
  isStudioWebAssistBrushId,
  planStudioWebAssistSamplesForBrush,
  planStudioWebContourDoubleSamples,
  planStudioWebEqualizePressurePath,
  planStudioWebFurStrandSamples,
  planStudioWebGridInkSamples,
  planStudioWebKaleidoInkSamples,
  planStudioWebMirrorInkSamples,
  planStudioWebRadialBurstSamples,
  planStudioWebStraightenPath,
  STUDIO_WEB_ASSIST_BRUSH_IDS,
} from "./studio-web-drawing-assist-kit";

const PATH = Object.freeze([
  { x: 100, y: 100, pressure: 0.4 },
  { x: 120, y: 108, pressure: 0.7 },
  { x: 150, y: 120, pressure: 0.9 },
  { x: 180, y: 140, pressure: 0.55 },
  { x: 200, y: 160, pressure: 0.35 },
]);

describe("studio web drawing assist kit", () => {
  it("exposes twelve assist brush ids", () => {
    expect(STUDIO_WEB_ASSIST_BRUSH_IDS).toHaveLength(12);
    expect(isStudioWebAssistBrushId("web-kaleido-ink")).toBe(true);
    expect(isStudioWebAssistBrushId("web-grid-ink")).toBe(true);
    expect(isStudioWebAssistBrushId("web-lazy-ink")).toBe(false);
  });

  it("kaleidoscope multiplies samples by folds and is deterministic", () => {
    const a = planStudioWebKaleidoInkSamples(PATH, {
      folds: 4,
      centerX: 150,
      centerY: 130,
      mirror: false,
    });
    const b = planStudioWebKaleidoInkSamples(PATH, {
      folds: 4,
      centerX: 150,
      centerY: 130,
      mirror: false,
    });
    expect(a).toEqual(b);
    expect(a.length).toBe(PATH.length * 4);
    expect(a.some((s) => s.agent === 3)).toBe(true);
  });

  it("fur strands emit parallel offsets around the stroke", () => {
    const samples = planStudioWebFurStrandSamples(PATH, { strands: 5, spread: 12 });
    expect(samples.length).toBe(PATH.length * 5);
    // Use the second path station (indices 5..9) where the tangent is non-zero.
    const station = samples.filter((s) => s.index >= 5 && s.index < 10);
    const xs = new Set(station.map((s) => s.x.toFixed(3)));
    expect(xs.size).toBeGreaterThan(1);
  });

  it("contour double emits left and right edge samples", () => {
    const samples = planStudioWebContourDoubleSamples(PATH, { separation: 8 });
    expect(samples.length).toBe(PATH.length * 2);
    expect(samples.some((s) => s.agent === 0)).toBe(true);
    expect(samples.some((s) => s.agent === 1)).toBe(true);
  });

  it("radial burst adds ray stations at sparse path samples", () => {
    const samples = planStudioWebRadialBurstSamples(PATH, { rays: 6, length: 20 });
    expect(samples.length).toBeGreaterThan(PATH.length);
    expect(samples.every((s) => s.size > 0)).toBe(true);
  });

  it("mirror ink duplicates across a vertical axis", () => {
    const samples = planStudioWebMirrorInkSamples(PATH, {
      mode: "vertical",
      axisX: 150,
    });
    expect(samples.length).toBe(PATH.length * 2);
    const originals = samples.filter((s) => s.agent === 0);
    const mirrors = samples.filter((s) => s.agent === 1);
    expect(mirrors).toHaveLength(originals.length);
    expect(mirrors[2]!.x).toBeCloseTo(150 * 2 - originals[2]!.x, 5);
  });

  it("grid ink snaps freehand to a lattice and collapses dense cells", () => {
    const dense = Array.from({ length: 40 }, (_, i) => ({
      x: 10 + i * 0.4,
      y: 20,
      pressure: 0.6,
    }));
    const samples = planStudioWebGridInkSamples(dense, { cell: 8 });
    expect(samples.length).toBeLessThan(dense.length);
    expect(samples.every((s) => s.x % 8 === 0 && s.y % 8 === 0)).toBe(true);
  });

  it("straighten and equalize pressure helpers preserve length", () => {
    const straight = planStudioWebStraightenPath(PATH, 1);
    expect(straight).toHaveLength(PATH.length);
    expect(straight[0]).toMatchObject({ x: 100, y: 100 });
    expect(straight[4]).toMatchObject({ x: 200, y: 160 });
    // Midpoint should lie on the chord when strength is 1.
    expect(straight[2]!.x).toBeCloseTo(150, 5);
    expect(straight[2]!.y).toBeCloseTo(130, 5);

    const eq = planStudioWebEqualizePressurePath(PATH, 0.8);
    expect(eq.every((p) => p.pressure === 0.8)).toBe(true);
  });

  it("dispatcher routes every assist brush id", () => {
    for (const id of STUDIO_WEB_ASSIST_BRUSH_IDS) {
      const samples = planStudioWebAssistSamplesForBrush(id, PATH, {
        baseSize: 8,
        seed: 3,
        centerX: 150,
        centerY: 130,
      });
      expect(samples.length, id).toBeGreaterThan(0);
    }
    expect(planStudioWebAssistSamplesForBrush("pen", PATH)).toEqual([]);
  });

  it("wave-3 planners: spiro, zigzag, neon, flat, smudge, cross-hatch", () => {
    const spiro = planStudioWebAssistSamplesForBrush("web-spiro-orbit", PATH, { baseSize: 5 });
    expect(spiro.length).toBe(PATH.length * 3);
    const zig = planStudioWebAssistSamplesForBrush("web-zigzag-edge", PATH);
    expect(zig).toHaveLength(PATH.length);
    const neon = planStudioWebAssistSamplesForBrush("web-neon-tube", PATH);
    expect(neon.length).toBe(PATH.length * 2);
    const flat = planStudioWebAssistSamplesForBrush("web-pressure-flat", PATH);
    expect(flat.every((s) => s.pressure === 0.72)).toBe(true);
    const smudge = planStudioWebAssistSamplesForBrush("web-smudge-trail", PATH);
    expect(smudge.length).toBeGreaterThan(PATH.length);
    const hatch = planStudioWebAssistSamplesForBrush("web-cross-hatch-pen", PATH);
    expect(hatch.some((s) => s.agent === 1)).toBe(true);
  });

  it("rejects invalid coordinates", () => {
    expect(planStudioWebKaleidoInkSamples([])).toEqual([]);
    expect(planStudioWebFurStrandSamples([{ x: Number.NaN, y: 1 }])).toEqual([]);
  });
});
