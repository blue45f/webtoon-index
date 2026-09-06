import { describe, expect, it } from "vitest";

import {
  PROPORTION_PRESETS,
  FACIAL_EXPRESSION_PRESETS,
  CORE_ANIMATION_CLIPS,
  calculateBoneScalesForProportions,
} from "./studio-3d-character-animator-and-proportions";

describe("Studio 3D Character Proportions & Facial Expression Engine", () => {
  it("provides 5 standard character head-to-body proportion presets", () => {
    const heroic = PROPORTION_PRESETS["8-head-heroic-real"];
    expect(heroic.headScale).toBeLessThan(1.0);
    expect(heroic.legLength).toBeGreaterThan(1.0);

    const chibi = PROPORTION_PRESETS["4-head-sd-chibi"];
    expect(chibi.headScale).toBeGreaterThan(1.5);
    expect(chibi.legLength).toBeLessThan(1.0);
  });

  it("calculates bone scaling vectors from proportions spec", () => {
    const sdSpec = PROPORTION_PRESETS["4-head-sd-chibi"];
    const boneScales = calculateBoneScalesForProportions(sdSpec);

    expect(boneScales.head[0]).toBeCloseTo(1.65);
    expect(boneScales.leftUpperLeg[1]).toBeCloseTo(0.75);
    expect(boneScales.chest[0]).toBeCloseTo(0.8);
  });

  it("provides 12 anime facial expression blendshape weight presets", () => {
    const smile = FACIAL_EXPRESSION_PRESETS["joy-smile"];
    expect(smile.mouthSmile).toBeGreaterThan(0.9);
    expect(smile.blushIntensity).toBeGreaterThan(0);

    const angry = FACIAL_EXPRESSION_PRESETS["anger-shout"];
    expect(angry.browAngry).toBeGreaterThan(0.9);
    expect(angry.mouthOpen).toBeGreaterThan(0.8);

    const wink = FACIAL_EXPRESSION_PRESETS["wink-left"];
    expect(wink.eyeBlinkLeft).toBe(1.0);
    expect(wink.eyeBlinkRight).toBe(0.0);
  });

  it("provides 8 core webtoon animation loops and action clips", () => {
    expect(CORE_ANIMATION_CLIPS.length).toBe(8);
    const walk = CORE_ANIMATION_CLIPS.find((c) => c.id === "walk-cycle");
    expect(walk?.isLooping).toBe(true);

    const slash = CORE_ANIMATION_CLIPS.find((c) => c.id === "sword-slashing");
    expect(slash?.isLooping).toBe(false);
  });
});
