import { describe, expect, it } from "vitest";

import {
  computeLightVectorFromSpherical,
  computeShadowConfigFromLight,
  STUDIO_MOOD_LIGHTING_PRESETS,
} from "./studio-light-shadow-gizmo";

describe("StudioLightShadowPanel integration", () => {
  it("computeLightVectorFromSpherical gives unit-ish vector at overhead", () => {
    const [x, y, z] = computeLightVectorFromSpherical({ azimuthDeg: 0, elevationDeg: 90 });
    expect(y).toBeCloseTo(1, 3);
    expect(Math.abs(x)).toBeLessThan(0.01);
    expect(Math.abs(z)).toBeLessThan(0.01);
  });

  it("shadow opacity is bounded 0..1", () => {
    for (const preset of STUDIO_MOOD_LIGHTING_PRESETS) {
      const shadow = computeShadowConfigFromLight(
        { azimuthDeg: preset.azimuthDeg, elevationDeg: preset.elevationDeg },
        preset.shadowOpacity,
        preset.shadowBlurPx,
      );
      expect(shadow.opacity).toBeGreaterThanOrEqual(0);
      expect(shadow.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("all mood presets have ambient color RGB within 0..255", () => {
    for (const preset of STUDIO_MOOD_LIGHTING_PRESETS) {
      for (const channel of preset.ambientColor) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});
