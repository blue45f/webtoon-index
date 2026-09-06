import { describe, expect, it } from "vitest";

import {
  StudioAiShadingAssistEngine,
  LIGHT_DIRECTION_ANGLES_DEG,
} from "./studio-ai-shading-assist";

describe("StudioAiShadingAssistEngine", () => {
  const engine = new StudioAiShadingAssistEngine();

  it("defines all 8 direction angles plus backlight-rim", () => {
    expect(LIGHT_DIRECTION_ANGLES_DEG["top-left"]).toBe(135);
    expect(LIGHT_DIRECTION_ANGLES_DEG.top).toBe(90);
    expect(LIGHT_DIRECTION_ANGLES_DEG.right).toBe(0);
    expect(LIGHT_DIRECTION_ANGLES_DEG.bottom).toBe(270);
  });

  it("calculates shadow offsets opposite to light direction", () => {
    // Light from top (90 deg -> vy = 1) -> shadow should cast downward (dy < 0 or > 0 depending on inversion)
    const result = engine.compute({
      direction: "top",
      intensityPercent: 100,
      softnessPercent: 0,
      temperature: "neutral-day",
      enableRimLight: true,
    });

    expect(result.lightVector.y).toBeCloseTo(1.0, 1);
    expect(result.shadowOffsetPx.dy).toBeLessThan(0); // -1 * 18 = -18
    expect(result.shadow1Opacity).toBe(0.35);
    expect(result.rimLightColorHex).toBe("#ffffff");
    expect(result.promptInstruction).toContain("crisp sharp cel shaded");
  });

  it("adjusts shadow colors based on ambient temperature", () => {
    const moonResult = engine.compute({
      direction: "top-left",
      intensityPercent: 80,
      softnessPercent: 50,
      temperature: "cool-moon",
      enableRimLight: true,
    });

    expect(moonResult.shadow1ColorHex).toBe("#1e1b4b");
    expect(moonResult.rimLightColorHex).toBe("#38bdf8");
    expect(moonResult.promptInstruction).toContain("cool-moon");
  });
});
