import { describe, expect, it } from "vitest";

import {
  clampStudioPressureCurveExponent,
  recommendStudioPressureCurveExponent,
  studioPressureCalibrationStats,
  studioPressureCurveExponentForPoint,
  studioPressureCurveGraphPoints,
  studioPressureCurveHandlePoint,
  studioPressureCurveMap,
  studioPressureCurvePathD,
  studioPressureCurveSliderMeta,
  studioPressurePreviewDiameter,
} from "./studio-pressure-curve-graph";

describe("studio pressure curve graph", () => {
  it("maps input through power curve like brush pressure sample", () => {
    expect(studioPressureCurveMap(0.5, 1)).toBeCloseTo(0.5, 5);
    expect(studioPressureCurveMap(0.5, 2)).toBeCloseTo(0.25, 5);
    expect(studioPressureCurveMap(0.5, 0.5)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(studioPressureCurveMap(-1, 1)).toBe(0);
    expect(studioPressureCurveMap(2, 1)).toBe(1);
  });

  it("samples a monotonic unit polyline for SVG", () => {
    const pts = studioPressureCurveGraphPoints(1, 5);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[4]?.x).toBeCloseTo(1, 5);
    expect(pts[4]?.y).toBeCloseTo(1, 5);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.y).toBeGreaterThanOrEqual(pts[i - 1]!.y - 1e-9);
    }
  });

  it("builds an SVG path in pixel space", () => {
    const d = studioPressureCurvePathD(1, 100, 50, 3);
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("L");
    expect(clampStudioPressureCurveExponent(99)).toBe(2.5);
    expect(clampStudioPressureCurveExponent(0)).toBe(0.35);
    const meta = studioPressureCurveSliderMeta(1);
    expect(meta.value).toBe(1);
    expect(meta.min).toBeLessThan(meta.max);
  });

  it("round-trips the direct-manipulation handle through the legacy exponent", () => {
    for (const exponent of [0.35, 0.8, 1, 1.6, 2.5]) {
      const point = studioPressureCurveHandlePoint(exponent);
      expect(studioPressureCurveExponentForPoint(point.x, point.y)).toBeCloseTo(exponent, 5);
    }
    expect(studioPressureCurveExponentForPoint(0.5, 1)).toBe(0.35);
    expect(studioPressureCurveExponentForPoint(0.5, 0)).toBe(2.5);
  });

  it("summarizes real contact samples and recommends a balanced response", () => {
    const samples = [0, 0.1, 0.18, 0.22, 0.25, 0.28, 0.32, 0.4, 0.55, 0.7];
    const stats = studioPressureCalibrationStats(samples);
    expect(stats?.sampleCount).toBe(9);
    expect(stats?.minimum).toBeCloseTo(0.1, 5);
    expect(stats?.maximum).toBeCloseTo(0.7, 5);
    expect(stats?.dynamicRange).toBeCloseTo(0.6, 5);

    const recommendation = recommendStudioPressureCurveExponent(samples);
    expect(recommendation).not.toBeNull();
    expect(
      studioPressureCurveMap(stats?.median ?? 0, recommendation ?? 1)
    ).toBeCloseTo(0.5, 5);
  });

  it("does not pretend to calibrate a constant mouse-pressure stream", () => {
    expect(recommendStudioPressureCurveExponent(Array(20).fill(0.5))).toBeNull();
    expect(recommendStudioPressureCurveExponent([0.1, 0.3, 0.8])).toBeNull();
    expect(studioPressureCalibrationStats([0, Number.NaN])).toBeNull();
  });

  it("previews the same curve while respecting the minimum-size floor", () => {
    expect(studioPressurePreviewDiameter(0, 1, 0, 20)).toBe(0);
    expect(studioPressurePreviewDiameter(0, 1, 0.25, 20)).toBe(5);
    expect(studioPressurePreviewDiameter(1, 1, 0.25, 20)).toBe(20);
    expect(studioPressurePreviewDiameter(0.5, 2, 0, 20)).toBeCloseTo(5, 5);
  });
});
