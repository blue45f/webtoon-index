import { describe, expect, it } from "vitest";

import {
  computeLightVectorFromSpherical,
  computeShadowConfigFromLight,
  STUDIO_MOOD_LIGHTING_PRESETS,
} from "./studio-light-shadow-gizmo";

describe("studio-light-shadow-gizmo", () => {
  it("computes normalized 3D light direction vector from spherical angles", () => {
    const light = computeLightVectorFromSpherical({ azimuthDeg: 0, elevationDeg: 90 });
    expect(light[1]).toBeCloseTo(1, 4); // Y is +1 straight overhead
  });

  it("calculates shadow vector offset opposite to light direction", () => {
    const shadow = computeShadowConfigFromLight({ azimuthDeg: 90, elevationDeg: 45 });
    expect(shadow.shadowVectorX).toBeLessThan(0); // Right light pushes shadow to left
    expect(shadow.opacity).toBeGreaterThan(0);
  });

  it("provides rich mood lighting presets (noon, sunset, thriller, night)", () => {
    expect(STUDIO_MOOD_LIGHTING_PRESETS.length).toBeGreaterThanOrEqual(4);
    const thriller = STUDIO_MOOD_LIGHTING_PRESETS.find((p) => p.id === "thriller");
    expect(thriller).toBeDefined();
    expect(thriller?.elevationDeg).toBeLessThan(0);
  });
});
