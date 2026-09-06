import { describe, expect, it } from "vitest";

import { StudioAiPromptEnhancer } from "./studio-ai-prompt-enhancer";

describe("StudioAiPromptEnhancer", () => {
  const enhancer = new StudioAiPromptEnhancer();

  it("detects genres from Korean and English natural keywords", () => {
    expect(enhancer.detectGenre("검을 들고 돌진하는 기사")).toBe("action");
    expect(enhancer.detectGenre("첫눈에 반한 로맨스 고백")).toBe("romance");
    expect(enhancer.detectGenre("마법 지팡이와 고대 드래곤")).toBe("fantasy");
    expect(enhancer.detectGenre("비 내리는 밤 골목의 섬뜩한 혈흔")).toBe("horror");
    expect(enhancer.detectGenre("카페에서 커피를 마시는 일상")).toBe("slice-of-life");
  });

  it("enhances prompt with genre keywords and universal quality boosters", () => {
    const res = enhancer.enhance("비 내리는 골목길의 결투");

    expect(res.detectedGenre).toBe("action");
    expect(res.enhancedPositivePrompt).toContain("비 내리는 골목길의 결투");
    expect(res.enhancedPositivePrompt).toContain("dynamic action pose");
    expect(res.enhancedPositivePrompt).toContain("crisp sharp digital ink lineart");
    expect(res.recommendedNegativePrompt).toContain("bad anatomy");
    expect(res.recommendedNegativePrompt).toContain("muddy gray shadows");
  });

  it("allows explicit genre override", () => {
    const res = enhancer.enhance("주인공", { genre: "fantasy" });
    expect(res.detectedGenre).toBe("fantasy");
    expect(res.enhancedPositivePrompt).toContain("ornate royal fantasy attire");
  });
});
