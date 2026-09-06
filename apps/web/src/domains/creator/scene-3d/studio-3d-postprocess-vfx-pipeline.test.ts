import { describe, expect, it } from "vitest";

import {
  calculateCircleOfConfusion,
  COLOR_GRADING_PRESETS,
  DEFAULT_POSTPROCESS_CONFIG,
} from "./studio-3d-postprocess-vfx-pipeline";

describe("Studio 3D Post-Processing Lens Effects & Bokeh Engine", () => {
  it("provides 6 color grading LUT presets", () => {
    expect(COLOR_GRADING_PRESETS.length).toBe(6);
    const anime = COLOR_GRADING_PRESETS.find((p) => p.id === "anime-vibrant");
    expect(anime).toBeDefined();
    expect(anime?.saturation).toBeGreaterThan(1.0);
  });

  it("calculates zero blur at exact focal plane and increasing blur away from focus", () => {
    const dofConfig = {
      ...DEFAULT_POSTPROCESS_CONFIG.dof,
      enabled: true,
      focusDistance: 3.0,
      focalLength: 50,
      fStop: 1.8,
    };

    // Exactly at 3.0 meters -> zero blur
    const atFocus = calculateCircleOfConfusion(3.0, dofConfig);
    expect(atFocus).toBeCloseTo(0.0, 3);

    // Foreground at 1.0 meters -> blurred
    const foregroundBlur = calculateCircleOfConfusion(1.0, dofConfig);
    expect(foregroundBlur).toBeGreaterThan(0.01);

    // Background at 15.0 meters -> blurred
    const backgroundBlur = calculateCircleOfConfusion(15.0, dofConfig);
    expect(backgroundBlur).toBeGreaterThan(0.005);
  });
});
