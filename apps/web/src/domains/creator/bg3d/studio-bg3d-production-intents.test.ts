import { describe, expect, it } from "vitest";

import {
  detectStudioBg3dProductionIntent,
  planStudioBg3dProductionIntent,
} from "./studio-bg3d-production-intents";

const AVAILABLE_PASSES = [
  "beauty",
  "lt-composite",
  "color",
  "tone",
  "texture-line",
  "main-line",
  "depth",
] as const;

const COLOR_LOOK = Object.freeze({
  lineEnabled: true,
  lineStrength: 0.8,
  textureLineEnabled: true,
  textureLineStrength: 0.5,
  toneMode: "flat" as const,
  toneType: "color" as const,
  toneOpacity: 1,
});

describe("Studio BG3D production intents", () => {
  it("plans only renderer-proven and LT-configured manuscript passes", () => {
    const plan = planStudioBg3dProductionIntent(
      AVAILABLE_PASSES,
      "manuscript",
      COLOR_LOOK,
    );

    expect(plan.selectedPasses).toEqual([
      "lt-composite",
      "color",
      "texture-line",
      "main-line",
    ]);
    expect(plan.definition.includeLayeredPsd).toBe(true);
    expect(plan.definition.includeContactSheet).toBe(true);
    expect(plan.definition.transparentBackground).toBe(false);
  });

  it("makes 2D compositing explicit instead of silently removing the background", () => {
    const plan = planStudioBg3dProductionIntent(
      AVAILABLE_PASSES,
      "composite",
      COLOR_LOOK,
    );

    expect(plan.selectedPasses).toEqual([
      "lt-composite",
      "color",
      "texture-line",
      "main-line",
    ]);
    expect(plan.definition.transparentBackground).toBe(true);
    expect(plan.definition.includeContactSheet).toBe(false);
  });

  it("detects an exact cross-tool state and rejects partial matches", () => {
    expect(detectStudioBg3dProductionIntent({
      availablePasses: AVAILABLE_PASSES,
      selectedPasses: ["beauty", "main-line", "depth"],
      look: COLOR_LOOK,
      includeLayeredPsd: false,
      includeContactSheet: false,
      lineArtPreview: true,
      transparentBackground: false,
    })).toBe("ai-reference");

    expect(detectStudioBg3dProductionIntent({
      availablePasses: AVAILABLE_PASSES,
      selectedPasses: ["beauty", "main-line", "depth"],
      look: COLOR_LOOK,
      includeLayeredPsd: true,
      includeContactSheet: false,
      lineArtPreview: true,
      transparentBackground: false,
    })).toBeNull();
  });

  it("degrades presets to the passes actually available and configured", () => {
    const plan = planStudioBg3dProductionIntent(
      ["beauty", "main-line"],
      "ai-reference",
      {
        ...COLOR_LOOK,
        lineEnabled: false,
      },
    );

    expect(plan.selectedPasses).toEqual(["beauty"]);
  });
});
