import { describe, expect, it } from "vitest";

import {
  computeStudioStabilizationPreview,
  DEFAULT_STUDIO_BRUSH_QUALITY_SETTINGS,
  normalizeStudioBrushQualitySettings,
  resolveStudioBrushQualityDisposition,
} from "./studio-stroke-stabilization-preview";

describe("studio-stroke-stabilization-preview", () => {
  describe("Quality settings normalization and resolution", () => {
    it("normalizes default and partial settings safely", () => {
      const def = normalizeStudioBrushQualitySettings();
      expect(def).toEqual(DEFAULT_STUDIO_BRUSH_QUALITY_SETTINGS);

      const custom = normalizeStudioBrushQualitySettings({
        mode: "speed",
        speedThresholdRadius: 80,
        speedSpacingMultiplier: 2.2,
        simplifyTextureDabs: false,
      });
      expect(custom.mode).toBe("speed");
      expect(custom.speedThresholdRadius).toBe(80);
      expect(custom.speedSpacingMultiplier).toBe(2.2);
      expect(custom.simplifyTextureDabs).toBe(false);
    });

    it("clamps extreme settings values", () => {
      const clamped = normalizeStudioBrushQualitySettings({
        speedThresholdRadius: 9999,
        speedSpacingMultiplier: 0.1,
      });
      expect(clamped.speedThresholdRadius).toBe(256);
      expect(clamped.speedSpacingMultiplier).toBe(1.1);
    });

    it("resolves speed mode when explicitly configured", () => {
      const disposition = resolveStudioBrushQualityDisposition(
        { mode: "speed", speedThresholdRadius: 50, speedSpacingMultiplier: 1.8, simplifyTextureDabs: true },
        20,
      );
      expect(disposition.effectiveMode).toBe("speed");
      expect(disposition.spacingMultiplier).toBe(1.8);
      expect(disposition.skipFineTexture).toBe(true);
      expect(disposition.maxDabsPerSegment).toBe(128);
    });

    it("resolves quality mode when explicitly configured", () => {
      const disposition = resolveStudioBrushQualityDisposition(
        { mode: "quality", speedThresholdRadius: 50, speedSpacingMultiplier: 1.8, simplifyTextureDabs: true },
        120,
      );
      expect(disposition.effectiveMode).toBe("quality");
      expect(disposition.spacingMultiplier).toBe(1.0);
      expect(disposition.skipFineTexture).toBe(false);
      expect(disposition.maxDabsPerSegment).toBe(512);
    });

    it("automatically engages speed mode for large brush radius in auto mode", () => {
      const settings = { mode: "auto" as const, speedThresholdRadius: 40, speedSpacingMultiplier: 1.7, simplifyTextureDabs: true };

      const small = resolveStudioBrushQualityDisposition(settings, 20);
      expect(small.effectiveMode).toBe("quality");
      expect(small.spacingMultiplier).toBe(1.0);

      const large = resolveStudioBrushQualityDisposition(settings, 60);
      expect(large.effectiveMode).toBe("speed");
      expect(large.spacingMultiplier).toBe(1.7);
      expect(large.reason).toContain("대형 브러시 반경");
    });

    it("automatically engages speed mode when measured FPS drops in auto mode", () => {
      const settings = { mode: "auto" as const, speedThresholdRadius: 60, speedSpacingMultiplier: 1.7, simplifyTextureDabs: true };

      const lagging = resolveStudioBrushQualityDisposition(settings, 25, 42); // 42 FPS
      expect(lagging.effectiveMode).toBe("speed");
      expect(lagging.reason).toContain("프레임 저하 감지");
    });
  });

  describe("computeStudioStabilizationPreview", () => {
    it("returns hidden preview when stabilizer strength is 0 or low", () => {
      const result = computeStudioStabilizationPreview({
        rawPoint: [100, 100],
        stabilizedPoint: [80, 80],
        stabilizerStrength: 0,
        brushRadius: 10,
      });
      expect(result.visible).toBe(false);
      expect(result.guideSegment).toBeNull();
      expect(result.curvePoints).toHaveLength(0);
    });

    it("returns hidden preview when distance is below minimal threshold", () => {
      const result = computeStudioStabilizationPreview({
        rawPoint: [100, 100],
        stabilizedPoint: [101, 101], // distance ~1.4px
        stabilizerStrength: 8,
        brushRadius: 10,
      });
      expect(result.visible).toBe(false);
      expect(result.guideSegment).toBeNull();
    });

    it("computes visible lead preview when stabilization lag exists", () => {
      const result = computeStudioStabilizationPreview({
        rawPoint: [150, 200],
        stabilizedPoint: [100, 160],
        stabilizerStrength: 6,
        brushRadius: 16,
      });
      expect(result.visible).toBe(true);
      expect(result.guideSegment).toEqual([[100, 160], [150, 200]]);
      expect(result.distance).toBeCloseTo(64, 0);
      expect(result.curvePoints.length).toBeGreaterThan(2);
      expect(result.opacity).toBeGreaterThan(0.2);
      expect(result.strokeWidth).toBeGreaterThanOrEqual(1);
    });

    it("hides preview when pointer is released", () => {
      const result = computeStudioStabilizationPreview({
        rawPoint: [150, 200],
        stabilizedPoint: [100, 160],
        stabilizerStrength: 6,
        brushRadius: 16,
        pointerDown: false,
      });
      expect(result.visible).toBe(false);
    });
  });
});
