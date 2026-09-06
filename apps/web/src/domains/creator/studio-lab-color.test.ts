import { describe, expect, it } from "vitest";

import {
  clampLab,
  DEFAULT_STUDIO_SOFT_PROOF_CONFIG,
  deltaE76,
  formatLabString,
  hexToLab,
  labToHex,
  labToRgb,
  rgbToLab,
  STUDIO_DOCUMENT_COLOR_PROFILES,
} from "./studio-lab-color";

describe("studio-lab-color", () => {
  describe("RGB <-> CIELAB Conversions", () => {
    it("converts pure white (255, 255, 255) to L*=100, a*=0, b*=0", () => {
      const lab = rgbToLab(255, 255, 255);
      expect(lab.l).toBeCloseTo(100, 0);
      expect(lab.a).toBeCloseTo(0, 0);
      expect(lab.b).toBeCloseTo(0, 0);

      const rgb = labToRgb(100, 0, 0);
      expect(rgb.r).toBe(255);
      expect(rgb.g).toBe(255);
      expect(rgb.b).toBe(255);
    });

    it("converts pure black (0, 0, 0) to L*=0, a*=0, b*=0", () => {
      const lab = rgbToLab(0, 0, 0);
      expect(lab.l).toBeCloseTo(0, 0);
      expect(lab.a).toBeCloseTo(0, 0);
      expect(lab.b).toBeCloseTo(0, 0);

      const rgb = labToRgb(0, 0, 0);
      expect(rgb.r).toBe(0);
      expect(rgb.g).toBe(0);
      expect(rgb.b).toBe(0);
    });

    it("round-trips common colors accurately", () => {
      // Primary Red
      const redLab = hexToLab("#ff0000");
      expect(redLab.l).toBeGreaterThan(45);
      expect(redLab.a).toBeGreaterThan(70);
      const redHex = labToHex(redLab.l, redLab.a, redLab.b);
      expect(redHex).toBe("#ff0000");

      // Primary Green
      const greenLab = hexToLab("#00ff00");
      expect(greenLab.a).toBeLessThan(-70);
      const greenHex = labToHex(greenLab.l, greenLab.a, greenLab.b);
      expect(greenHex).toBe("#00ff00");

      // Primary Blue
      const blueLab = hexToLab("#0000ff");
      expect(blueLab.b).toBeLessThan(-90);
      const blueHex = labToHex(blueLab.l, blueLab.a, blueLab.b);
      expect(blueHex).toBe("#0000ff");
    });
  });

  describe("Formatting and Color Difference", () => {
    it("formats Lab strings nicely for UI readout", () => {
      const formatted = formatLabString({ l: 54.2, a: 80.5, b: -67.1 });
      expect(formatted).toBe("L* 54.2  a* +80.5  b* -67.1");
    });

    it("calculates Delta E (CIE76) correctly", () => {
      const c1 = { l: 50, a: 20, b: -10 };
      const c2 = { l: 53, a: 24, b: -10 }; // dL = 3, da = 4, db = 0 => 5
      expect(deltaE76(c1, c2)).toBeCloseTo(5, 4);
    });

    it("clamps Lab parameters to valid color space boundaries", () => {
      const clamped = clampLab(150, -200, 300);
      expect(clamped.l).toBe(100);
      expect(clamped.a).toBe(-128);
      expect(clamped.b).toBe(127);
    });
  });

  describe("Document Profiles & Soft Proofing Defaults", () => {
    it("provides standard document color profiles", () => {
      expect(STUDIO_DOCUMENT_COLOR_PROFILES.map((p) => p.id)).toEqual(["sRGB", "Display-P3", "Adobe-RGB"]);
      expect(DEFAULT_STUDIO_SOFT_PROOF_CONFIG.enabled).toBe(false);
      expect(DEFAULT_STUDIO_SOFT_PROOF_CONFIG.targetProfile).toBe("Japan-Color-2001-Coated");
    });
  });
});
