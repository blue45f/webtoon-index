import { describe, expect, it } from "vitest";

import {
  STUDIO_AI_EMOTION_ANALYSIS_TEXT_LIMIT,
  STUDIO_AI_EMOTION_BUBBLE_MATCHER_VERSION,
  StudioAiEmotionBubbleMatcher,
} from "./studio-ai-emotion-bubble-matcher";

describe("StudioAiEmotionBubbleMatcher", () => {
  const matcher = new StudioAiEmotionBubbleMatcher();

  it("recommends spiky shout bubble for rage/shout dialogues", () => {
    const res = matcher.match("닥쳐!! 절대 용서 못 해!!");
    expect(res.detectedEmotion).toBe("rage-shout");
    expect(res.recommendedBubbleShape).toBe("shout-spiky");
    expect(res.strokeWidthPx).toBeGreaterThanOrEqual(3);
    expect(res.recommendedFontWeight).toBe("black");
    expect(res.matchedSignals).toContain("ko-rage-lexicon");
  });

  it("recommends dashed border bubble for whisper dialogues", () => {
    const res = matcher.match("쉿... 들키면 안 되니까 조용히 해...");
    expect(res.detectedEmotion).toBe("whisper-secret");
    expect(res.recommendedBubbleShape).toBe("whisper-dashed");
    expect(res.isDashedBorder).toBe(true);
  });

  it("recommends blush pink bubble for romance dialogues", () => {
    const res = matcher.match("너를 처음 본 순간부터 좋아했어.");
    expect(res.detectedEmotion).toBe("romance-blush");
    expect(res.recommendedBubbleShape).toBe("soft-blush");
    expect(res.fillColor).toBe("#fff1f2");
  });

  it("recommends cloud bubble for thought/monologue dialogues", () => {
    const res = matcher.match("(과연 내가 해낼 수 있을까...?)");
    expect(res.detectedEmotion).toBe("thought-monologue");
    expect(res.recommendedBubbleShape).toBe("cloud-thought");
    expect(res.matchedSignals).toContain("thought-wrapper");
  });

  it("falls back to standard oval for calm neutral speech", () => {
    const res = matcher.match("오늘 점심은 구내식당에서 먹자.");
    expect(res.detectedEmotion).toBe("neutral-calm");
    expect(res.recommendedBubbleShape).toBe("standard-oval");
    expect(res.confidenceScore).toBe(75);
    expect(res.needsHumanReview).toBe(false);
  });

  it("treats question-heavy surprise as shock instead of rage", () => {
    const res = matcher.match("What?? No way?!");
    expect(res.detectedEmotion).toBe("shock-gasp");
    expect(res.recommendedBubbleShape).toBe("wobbly-distress");
    expect(res.analysisLocale).toBe("en");
    expect(res.matchedSignals).toEqual(
      expect.arrayContaining(["en-shock-lexicon", "repeated-question"]),
    );
  });

  it("supports Japanese dialogue without a network model", () => {
    const res = matcher.match("まさか……本当に君なの？");
    expect(res.detectedEmotion).toBe("shock-gasp");
    expect(res.analysisLocale).toBe("ja");
    expect(res.confidenceScore).toBeGreaterThanOrEqual(80);
  });

  it("surfaces runner-up evidence and review state for mixed emotion", () => {
    const res = matcher.match("사랑해, but get out!!");
    expect(res.analysisVersion).toBe(STUDIO_AI_EMOTION_BUBBLE_MATCHER_VERSION);
    expect(res.analysisLocale).toBe("mixed");
    expect(res.detectedEmotion).toBe("rage-shout");
    expect(res.secondaryEmotion).toBe("romance-blush");
    expect(res.secondaryConfidenceScore).toBeGreaterThan(0);
    expect(res.confidenceGap).toBeGreaterThan(0);
    expect(res.needsHumanReview).toBe(true);
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.candidates)).toBe(true);
  });

  it("processes a panel dialogue batch in order without mutating the input", () => {
    const input = Object.freeze(["쉿...", "ありがとう♡"] as const);
    const result = matcher.matchMany(input);
    expect(result.map((item) => item.detectedEmotion)).toEqual([
      "whisper-secret",
      "romance-blush",
    ]);
    expect(input).toEqual(["쉿...", "ありがとう♡"]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("bounds analysis work and flags truncated dialogue for review", () => {
    const res = matcher.match("쉿 ".repeat(STUDIO_AI_EMOTION_ANALYSIS_TEXT_LIMIT));
    expect(res.detectedEmotion).toBe("whisper-secret");
    expect(res.analysisWasTruncated).toBe(true);
    expect(res.needsHumanReview).toBe(true);
  });

  it("marks empty input as an explicit zero-confidence review case", () => {
    const res = matcher.match("   ");
    expect(res.detectedEmotion).toBe("neutral-calm");
    expect(res.analysisLocale).toBe("undetermined");
    expect(res.confidenceScore).toBe(0);
    expect(res.needsHumanReview).toBe(true);
  });
});
