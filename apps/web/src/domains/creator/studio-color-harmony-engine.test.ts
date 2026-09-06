import { describe, expect, it } from "vitest";

import {
  auditContrast,
  calculateContrastRatio,
  cmykToRgb,
  generateWebtoonCelShading,
  getAllHarmonies,
  getAnalogous,
  getComplementary,
  getFriendlyColorName,
  getMonochromatic,
  getSplitComplementary,
  getTetradic,
  getTintsAndShades,
  getTriadic,
  hexToHsl,
  hexToHsv,
  hexToRgb,
  hslToHex,
  hsvToHex,
  hsvToRgb,
  rgbToCmyk,
  rgbToHex,
  rgbToHsl,
  rgbToHsv,
} from "./studio-color-harmony-engine";

describe("studio-color-harmony-engine", () => {
  describe("Conversions: RGB <-> HEX", () => {
    it("converts hex to rgb accurately", () => {
      expect(hexToRgb("#ff0000")).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 255 });
      expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    });

    it("converts rgb to hex accurately", () => {
      expect(rgbToHex(255, 0, 0)).toBe("#ff0000");
      expect(rgbToHex(0, 255, 0)).toBe("#00ff00");
      expect(rgbToHex(0, 0, 255)).toBe("#0000ff");
      expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
      expect(rgbToHex(0, 0, 0)).toBe("#000000");
    });
  });

  describe("Conversions: RGB <-> HSV/HSB", () => {
    it("converts red #ff0000 to hsv", () => {
      const hsv = rgbToHsv(255, 0, 0);
      expect(hsv.h).toBe(0);
      expect(hsv.s).toBe(100);
      expect(hsv.v).toBe(100);
    });

    it("round-trips hsv <-> rgb", () => {
      const original = { r: 124, g: 210, b: 88 };
      const hsv = rgbToHsv(original.r, original.g, original.b);
      const restored = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(Math.abs(restored.r - original.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(restored.g - original.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(restored.b - original.b)).toBeLessThanOrEqual(1);
    });

    it("converts hex to hsv and back", () => {
      const hex = "#3b82f6";
      const hsv = hexToHsv(hex);
      const back = hsvToHex(hsv.h, hsv.s, hsv.v);
      expect(back).toBe(hex);
    });
  });

  describe("Conversions: RGB <-> HSL", () => {
    it("converts pure colors to hsl", () => {
      expect(rgbToHsl(255, 0, 0)).toEqual({ h: 0, s: 100, l: 50 });
      expect(rgbToHsl(0, 255, 0)).toEqual({ h: 120, s: 100, l: 50 });
      expect(rgbToHsl(0, 0, 255)).toEqual({ h: 240, s: 100, l: 50 });
    });

    it("converts hex to hsl and back", () => {
      const hex = "#ec4899";
      const hsl = hexToHsl(hex);
      const back = hslToHex(hsl.h, hsl.s, hsl.l);
      expect(back).toBe(hex);
    });
  });

  describe("Conversions: RGB <-> CMYK", () => {
    it("converts red to cmyk", () => {
      const cmyk = rgbToCmyk(255, 0, 0);
      expect(cmyk.c).toBe(0);
      expect(cmyk.m).toBe(100);
      expect(cmyk.y).toBe(100);
      expect(cmyk.k).toBe(0);
    });

    it("round-trips cmyk <-> rgb", () => {
      const rgb = { r: 50, g: 150, b: 200 };
      const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);
      const back = cmykToRgb(cmyk.c, cmyk.m, cmyk.y, cmyk.k);
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(2);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(2);
    });
  });

  describe("Color Harmonies", () => {
    const base = "#ff5500"; // orange-red

    it("generates complementary color 180 degrees away", () => {
      const comp = getComplementary(base);
      expect(comp).toHaveLength(2);
      expect(comp[0]).toBe(base);
      const compHsv = hexToHsv(comp[1]);
      const baseHsv = hexToHsv(base);
      expect(Math.abs(compHsv.h - ((baseHsv.h + 180) % 360))).toBeLessThanOrEqual(1);
    });

    it("generates analogous palette", () => {
      const analogous = getAnalogous(base, 30);
      expect(analogous).toHaveLength(3);
      expect(analogous[1]).toBe(base);
    });

    it("generates triadic palette", () => {
      const triad = getTriadic(base);
      expect(triad).toHaveLength(3);
      expect(triad[0]).toBe(base);
    });

    it("generates split-complementary palette", () => {
      const split = getSplitComplementary(base);
      expect(split).toHaveLength(3);
      expect(split[0]).toBe(base);
    });

    it("generates tetradic palette", () => {
      const tetrad = getTetradic(base);
      expect(tetrad).toHaveLength(4);
      expect(tetrad[0]).toBe(base);
    });

    it("generates monochromatic palette", () => {
      const mono = getMonochromatic(base);
      expect(mono).toHaveLength(5);
      expect(mono[2]).toBe(base);
    });

    it("returns all harmony modes with labels and descriptions", () => {
      const all = getAllHarmonies(base);
      expect(all).toHaveLength(6);
      expect(all.map((h) => h.mode)).toEqual([
        "complementary",
        "analogous",
        "triadic",
        "split-complementary",
        "tetradic",
        "monochromatic",
      ]);
    });
  });

  describe("Webtoon Cel Shading & Hue-Shift Shadow Generator", () => {
    it("generates 5-tier webtoon cell shading with anti-muddy hue shifts", () => {
      const skinBase = "#ffdcc5";
      const result = generateWebtoonCelShading(skinBase);

      expect(result.base).toBe(skinBase);
      expect(result.highlight).toMatch(/^#[0-9a-f]{6}$/);
      expect(result.celShadow1).toMatch(/^#[0-9a-f]{6}$/);
      expect(result.celShadow2).toMatch(/^#[0-9a-f]{6}$/);
      expect(result.blushTint).toMatch(/^#[0-9a-f]{6}$/);
      expect(result.rimLight).toMatch(/^#[0-9a-f]{6}$/);

      // Shadow must be darker than base
      const baseRgb = hexToRgb(skinBase);
      const s1Rgb = hexToRgb(result.celShadow1);
      const s2Rgb = hexToRgb(result.celShadow2);
      expect(s1Rgb.r + s1Rgb.g + s1Rgb.b).toBeLessThan(baseRgb.r + baseRgb.g + baseRgb.b);
      expect(s2Rgb.r + s2Rgb.g + s2Rgb.b).toBeLessThan(s1Rgb.r + s1Rgb.g + s1Rgb.b);
    });
  });

  describe("Tints & Shades Generator", () => {
    it("generates 9 steps from light tint to dark shade", () => {
      const steps = getTintsAndShades("#3b82f6", 9);
      expect(steps).toHaveLength(9);
      expect(steps[4]).toBe("#3b82f6"); // Middle is the base color
      // First is lightest
      const firstRgb = hexToRgb(steps[0]);
      const lastRgb = hexToRgb(steps[8]);
      expect(firstRgb.r + firstRgb.g + firstRgb.b).toBeGreaterThan(lastRgb.r + lastRgb.g + lastRgb.b);
    });
  });

  describe("Contrast & WCAG Audit", () => {
    it("calculates contrast ratio correctly", () => {
      const ratio = calculateContrastRatio("#ffffff", "#000000");
      expect(ratio).toBe(21);
    });

    it("audits contrast on white and black", () => {
      const audit = auditContrast("#ffffff");
      expect(audit.ratioOnWhite).toBe(1);
      expect(audit.ratioOnBlack).toBe(21);
      expect(audit.bestForeground).toBe("#000000");
    });
  });

  describe("Friendly Color Naming", () => {
    it("returns descriptive names for common colors", () => {
      expect(getFriendlyColorName("#000000")).toContain("블랙");
      expect(getFriendlyColorName("#ffffff")).toContain("화이트");
      expect(getFriendlyColorName("#ff0000")).toContain("레드");
      expect(getFriendlyColorName("#3b82f6")).toContain("블루");
      expect(getFriendlyColorName("#10b981")).toContain("그린");
    });
  });
});
