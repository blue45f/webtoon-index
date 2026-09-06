import { describe, expect, it } from "vitest";

import {
  calculateKelvinRgb,
  sampleScreentone,
  SCREENTONE_PRESETS,
  type ScreentoneShaderConfig,
} from "./studio-3d-halftone-screentone-shader";

describe("Studio 3D Halftone & Screentone Shader System", () => {
  it("provides 6 stylized manga screentone presets", () => {
    expect(SCREENTONE_PRESETS.length).toBe(6);
    const shonen = SCREENTONE_PRESETS.find((p) => p.id === "shonen-manga-dots");
    expect(shonen).toBeDefined();
    expect(shonen?.frequencyLpi).toBe(60);
    expect(shonen?.pattern).toBe("manga-dot-grid");
  });

  it("calculates accurate linear RGB from Kelvin color temperature", () => {
    // 3200K warm tungsten: strong red, moderate green, low blue
    const warmRgb = calculateKelvinRgb(3200);
    expect(warmRgb[0]).toBeCloseTo(1.0, 1);
    expect(warmRgb[0]).toBeGreaterThan(warmRgb[1]);
    expect(warmRgb[1]).toBeGreaterThan(warmRgb[2]);

    // 8500K cool moonlight: blue-tinted
    const coolRgb = calculateKelvinRgb(8500);
    expect(coolRgb[2]).toBeGreaterThan(coolRgb[1]);
  });

  it("samples procedural screentone dots based on shadow luminance", () => {
    const config: ScreentoneShaderConfig = {
      pattern: "manga-dot-grid",
      frequencyLpi: 50,
      angleDegrees: 0,
      dotSizeMax: 0.8,
      threshold: 0.5,
      sharpness: 1.0,
      colorTemperatureKelvin: 6500,
      toneColor: "#000000",
      paperColor: "#ffffff",
    };

    // Full light above threshold -> 0.0 (no ink)
    const highlight = sampleScreentone(0.01, 0.01, 0.8, config);
    expect(highlight).toBe(0.0);

    // Deep shadow near center of dot (u=0.01, v=0.01 with freq=50 gives cellU = 0.5, cellV = 0.5)
    const deepShadowCenter = sampleScreentone(0.01, 0.01, 0.05, config);
    expect(deepShadowCenter).toBe(1.0);
  });
});
