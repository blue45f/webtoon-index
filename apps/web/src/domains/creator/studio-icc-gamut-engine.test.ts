import { describe, expect, it } from "vitest";

import {
  analyzeGamutAndTotalInk,
  calculateDeltaE,
  convertRgbToCmyk,
  convertRgbToLab,
} from "./studio-icc-gamut-engine";

describe("Studio ICC Soft-Proofing & Gamut Warning Engine", () => {
  it("converts RGB to CMYK with Total Area Coverage (TAC)", () => {
    // Pure Black -> 100% K
    const black = convertRgbToCmyk(0, 0, 0);
    expect(black.k).toBe(100);
    expect(black.totalInkPercent).toBe(100);

    // Pure White -> 0% all
    const white = convertRgbToCmyk(255, 255, 255);
    expect(white.c).toBe(0);
    expect(white.m).toBe(0);
    expect(white.y).toBe(0);
    expect(white.k).toBe(0);
    expect(white.totalInkPercent).toBe(0);

    // Pure Cyan (0, 255, 255)
    const cyan = convertRgbToCmyk(0, 255, 255);
    expect(cyan.c).toBe(100);
    expect(cyan.m).toBe(0);
    expect(cyan.y).toBe(0);
  });

  it("converts RGB to CIE-Lab and computes Delta E", () => {
    const whiteLab = convertRgbToLab(255, 255, 255);
    expect(whiteLab.l).toBeCloseTo(100, 0);

    const blackLab = convertRgbToLab(0, 0, 0);
    expect(blackLab.l).toBeCloseTo(0, 0);

    const dE = calculateDeltaE(whiteLab, blackLab);
    expect(dE).toBeGreaterThan(90); // Large difference between white and black
  });

  it("analyzes gamut warning and ink limit on pixel batches", () => {
    const pixels: [number, number, number][] = [
      [255, 255, 255], // in gamut
      [100, 100, 100], // in gamut
      [255, 0, 255], // ultra saturated neon magenta -> out of gamut
    ];

    const report = analyzeGamutAndTotalInk(pixels, "Japan-Color-2001-Coated", 300);

    expect(report.totalPixels).toBe(3);
    expect(report.outOfGamutPixels).toBe(1);
    expect(report.outOfGamutRatio).toBeCloseTo(0.333, 2);
    expect(report.maxTacObserved).toBeGreaterThan(0);
  });
});
