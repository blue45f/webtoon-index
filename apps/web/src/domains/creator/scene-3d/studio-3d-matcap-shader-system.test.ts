import { describe, expect, it } from "vitest";

import {
  STYLIZED_SHADER_PRESETS,
  evaluateShaderUniforms,
  type StylizedShaderKind,
} from "./studio-3d-matcap-shader-system";

describe("Studio 3D MatCap & Stylized Shader System", () => {
  it("provides 9 complete stylized material presets across categories", () => {
    const keys = Object.keys(STYLIZED_SHADER_PRESETS) as StylizedShaderKind[];
    expect(keys.length).toBe(9);

    for (const key of keys) {
      const p = STYLIZED_SHADER_PRESETS[key];
      expect(p.id).toBe(key);
      expect(p.name).toBeTruthy();
      expect(p.baseColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.shadowColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("evaluates steady uniforms for static presets", () => {
    const preset = STYLIZED_SHADER_PRESETS["anime-cel-toon"];
    const u = evaluateShaderUniforms(preset, 0.5);
    expect(u.uShadowSteps).toBe(3);
    expect(u.uRimIntensity).toBe(0.8);
    expect(u.uEmissiveIntensity).toBe(0);
  });

  it("evaluates dynamic oscillating uniforms for pulsing neon preset", () => {
    const preset = STYLIZED_SHADER_PRESETS["neon-cyberpunk-pulse"];
    expect(preset.pulseFrequencyHz).toBeGreaterThan(0);

    const u0 = evaluateShaderUniforms(preset, 0.0);
    const uQuarter = evaluateShaderUniforms(preset, 1.0 / (4 * preset.pulseFrequencyHz));

    expect(uQuarter.uEmissiveIntensity).toBeGreaterThan(u0.uEmissiveIntensity * 0.9);
  });
});
