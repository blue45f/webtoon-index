import { describe, expect, it } from "vitest";

import {
  detectStudioBg3dProductionBatchPresetForLook,
  evaluateStudioBg3dProductionPassReadiness,
  resolveStudioBg3dProductionBatchPresetForLook,
  type StudioBg3dProductionLookState,
} from "./studio-bg3d-production-pass-readiness";

const AVAILABLE = [
  "beauty",
  "lt-composite",
  "color",
  "tone",
  "texture-line",
  "main-line",
  "depth",
] as const;

const COLOR_LOOK: StudioBg3dProductionLookState = Object.freeze({
  lineEnabled: true,
  lineStrength: 0.8,
  textureLineEnabled: true,
  textureLineStrength: 0.5,
  toneMode: "flat",
  toneType: "color",
  toneOpacity: 1,
});

const SCREEN_TONE_LOOK: StudioBg3dProductionLookState = Object.freeze({
  ...COLOR_LOOK,
  toneMode: "screentone",
  toneType: "pattern",
});

describe("Studio BG3D production pass readiness", () => {
  it("keeps color and non-color tone mutually exclusive in manuscript presets", () => {
    expect(resolveStudioBg3dProductionBatchPresetForLook(
      AVAILABLE,
      "manuscript",
      COLOR_LOOK,
    )).toEqual(["lt-composite", "color", "texture-line", "main-line"]);

    expect(resolveStudioBg3dProductionBatchPresetForLook(
      AVAILABLE,
      "manuscript",
      SCREEN_TONE_LOOK,
    )).toEqual(["lt-composite", "tone", "texture-line", "main-line"]);
  });

  it("explains every selected pass that the active LT look cannot generate", () => {
    const readiness = evaluateStudioBg3dProductionPassReadiness(
      ["beauty", "main-line", "texture-line", "color", "tone"],
      {
        ...COLOR_LOOK,
        lineEnabled: false,
        toneMode: "none",
      },
    );

    expect(readiness.readyPasses).toEqual(["beauty"]);
    expect(readiness.issues.map((issue) => issue.pass)).toEqual([
      "main-line",
      "texture-line",
      "color",
      "tone",
    ]);
    expect(readiness.blockingReason).toContain("4개 선택 패스");
  });

  it("never flags the renderer-proven beauty and depth passes as LT-dependent", () => {
    const readiness = evaluateStudioBg3dProductionPassReadiness(
      ["beauty", "depth"],
      {
        ...COLOR_LOOK,
        lineEnabled: false,
        toneMode: "none",
      },
    );

    expect(readiness.readyPasses).toEqual(["beauty", "depth"]);
    expect(readiness.issues).toEqual([]);
    expect(readiness.blockingReason).toBeNull();
  });

  it("detects purpose presets against the actual configured LT pass set", () => {
    expect(detectStudioBg3dProductionBatchPresetForLook(
      AVAILABLE,
      ["lt-composite", "color", "texture-line", "main-line"],
      COLOR_LOOK,
    )).toBe("manuscript");

    expect(detectStudioBg3dProductionBatchPresetForLook(
      AVAILABLE,
      ["lt-composite", "color", "tone", "texture-line", "main-line"],
      COLOR_LOOK,
    )).toBe("custom");
  });
});
