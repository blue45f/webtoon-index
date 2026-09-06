import { describe, expect, it } from "vitest";

import {
  compileStudioAiSuitePromptHandoff,
  createStudioAiSuitePromptHandoff,
  STUDIO_AI_SUITE_COMPILED_PROMPT_MAX,
} from "./studio-ai-suite-handoff";

describe("studio AI suite handoff", () => {
  it("preserves positive, negative and rendering controls in one provider-safe prompt", () => {
    const handoff = createStudioAiSuitePromptHandoff({
      positivePrompt: "hero in a rainy alley",
      negativePrompt: "extra fingers, watermark",
      denoiseStrength: 0.65,
      recommendedSettings: {
        lineFactor: 1.6,
        contrast: 1.35,
        saturation: 1,
      },
    });

    const prompt = compileStudioAiSuitePromptHandoff(handoff);

    expect(prompt).toContain("hero in a rainy alley");
    expect(prompt).toContain("extra fingers, watermark");
    expect(prompt).toContain("denoise strength 0.65");
    expect(prompt).toContain("line weight 1.6");
    expect(prompt).toContain("preserve subject identity and panel composition");
  });

  it("clamps unsafe numeric values and bounds the compiled prompt", () => {
    const handoff = createStudioAiSuitePromptHandoff({
      positivePrompt: "x".repeat(8_000),
      negativePrompt: "y".repeat(8_000),
      denoiseStrength: 99,
      recommendedSettings: {
        lineFactor: Number.POSITIVE_INFINITY,
        contrast: -10,
        saturation: 99,
      },
    });

    const prompt = compileStudioAiSuitePromptHandoff(handoff);

    expect(handoff.denoiseStrength).toBe(1);
    expect(handoff.recommendedSettings.lineFactor).toBe(1);
    expect(handoff.recommendedSettings.contrast).toBe(0.1);
    expect(handoff.recommendedSettings.saturation).toBe(3);
    expect(prompt.length).toBeLessThanOrEqual(STUDIO_AI_SUITE_COMPILED_PROMPT_MAX);
  });
});
