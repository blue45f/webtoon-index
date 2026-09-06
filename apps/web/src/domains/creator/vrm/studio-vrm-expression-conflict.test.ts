import { describe, expect, it } from "vitest";

import {
  resolveStudioVrmExpressionConflicts,
  STUDIO_VRM_EXPRESSION_DEFAULT_MOUTH_CEILING,
  STUDIO_VRM_EXPRESSION_EMOTIONS,
  STUDIO_VRM_EXPRESSION_MOUTH_GROUP,
} from "./studio-vrm-expression-conflict";

const mouthSum = (weights: Readonly<Record<string, number>>) =>
  STUDIO_VRM_EXPRESSION_MOUTH_GROUP.reduce((total, name) => total + (weights[name] ?? 0), 0);

describe("resolveStudioVrmExpressionConflicts", () => {
  it("keeps the strongest emotion and attenuates the rest", () => {
    const result = resolveStudioVrmExpressionConflicts({
      happy: 0.8,
      sad: 0.42,
      angry: 0.38,
      surprised: 0.2,
    });
    expect(result.dominantEmotion).toBe("happy");
    expect(result.weights.happy).toBeCloseTo(0.8, 10);
    for (const name of ["sad", "angry", "surprised"] as const) {
      expect(result.weights[name]).toBeLessThan(result.weights.happy * 0.5);
      expect(result.attenuated).toContain(name);
    }
  });

  it("lets priority decide the dominant emotion when a weaker signal is more trustworthy", () => {
    // surprised 가 더 작지만 우선순위(1.35)가 happy(1.0)를 넘겨 지배한다.
    const result = resolveStudioVrmExpressionConflicts({ happy: 0.8, surprised: 0.65 });
    expect(result.dominantEmotion).toBe("surprised");
    expect(result.weights.surprised).toBeCloseTo(0.65, 10);
    expect(result.weights.happy).toBeLessThan(0.8);
  });

  it("attenuates gently when the dominant emotion is weak, so frames do not pop", () => {
    const weak = resolveStudioVrmExpressionConflicts({ happy: 0.1, sad: 0.09 });
    const strong = resolveStudioVrmExpressionConflicts({ happy: 0.95, sad: 0.09 });
    expect(weak.weights.sad).toBeGreaterThan(0.08);
    expect(strong.weights.sad).toBeLessThan(0.02);
  });

  it("scales the mouth group down to the ceiling while keeping its proportions", () => {
    const result = resolveStudioVrmExpressionConflicts({ aa: 0.9, ee: 0.8, oh: 0.7 });
    expect(mouthSum(result.weights)).toBeCloseTo(STUDIO_VRM_EXPRESSION_DEFAULT_MOUTH_CEILING, 6);
    expect(result.mouthScale).toBeLessThan(1);
    // 비율 보존 — 입 모양의 성격은 그대로.
    expect(result.weights.aa / result.weights.ee).toBeCloseTo(0.9 / 0.8, 6);
    expect(result.weights.oh / result.weights.ee).toBeCloseTo(0.7 / 0.8, 6);
  });

  it("leaves an already-safe frame untouched", () => {
    const input = { aa: 0.3, happy: 0.4, blinkLeft: 0.9, lookRight: 0.5 };
    const result = resolveStudioVrmExpressionConflicts(input);
    expect(result.weights).toEqual(input);
    expect(result.mouthScale).toBe(1);
    expect(result.attenuated).toEqual([]);
  });

  it("never touches blink, look or brow weights", () => {
    const result = resolveStudioVrmExpressionConflicts({
      happy: 0.9,
      sad: 0.8,
      aa: 0.9,
      ee: 0.9,
      blinkLeft: 1,
      blinkRight: 0.4,
      lookUp: 0.6,
      lookLeft: 0.3,
      browInnerUp: 0.7,
      browOuterUpLeft: 0.2,
    });
    expect(result.weights.blinkLeft).toBe(1);
    expect(result.weights.blinkRight).toBe(0.4);
    expect(result.weights.lookUp).toBe(0.6);
    expect(result.weights.lookLeft).toBe(0.3);
    expect(result.weights.browInnerUp).toBe(0.7);
    expect(result.weights.browOuterUpLeft).toBe(0.2);
  });

  it("clamps hostile input instead of propagating it", () => {
    const result = resolveStudioVrmExpressionConflicts({
      happy: Number.NaN,
      sad: -3,
      angry: 12,
      aa: Number.POSITIVE_INFINITY,
    });
    for (const value of Object.values(result.weights)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(result.dominantEmotion).toBe("angry");
  });

  it("can be disabled through exclusivity and a permissive ceiling", () => {
    const input = { happy: 0.8, sad: 0.7, aa: 0.9, ee: 0.9 };
    const result = resolveStudioVrmExpressionConflicts(input, {
      exclusivity: 0,
      mouthCeiling: Number.POSITIVE_INFINITY,
    });
    expect(result.weights).toEqual(input);
  });

  it("ignores emotions the model cannot show", () => {
    // 모델에 surprised 가 없으면 적용 단계에서 버려진다. 그걸 지배 표정으로 뽑으면
    // happy 만 깎이고 놀람은 나타나지 않아, 미소가 이유 없이 약해진다.
    const available = ["happy", "aa", "blink", "blinkLeft", "blinkRight"];
    const result = resolveStudioVrmExpressionConflicts(
      { happy: 0.8, surprised: 0.9, aa: 0.3 },
      { available },
    );
    expect(result.dominantEmotion).toBe("happy");
    expect(result.weights.happy).toBeCloseTo(0.8, 10);
    // 지원되지 않는 이름은 예산에서도 빠지므로 입 계열이 괜히 줄지 않는다.
    expect(result.weights.aa).toBeCloseTo(0.3, 10);
    expect(result.mouthScale).toBe(1);
  });

  it("still resolves normally when the model supports everything", () => {
    const full = ["happy", "surprised", "aa"];
    const scoped = resolveStudioVrmExpressionConflicts({ happy: 0.8, surprised: 0.9, aa: 0.3 }, {
      available: full,
    });
    const unscoped = resolveStudioVrmExpressionConflicts({ happy: 0.8, surprised: 0.9, aa: 0.3 });
    expect(scoped.dominantEmotion).toBe("surprised");
    expect(scoped.weights).toEqual(unscoped.weights);
  });

  it("is pure — repeated calls on the same input agree and the input is not mutated", () => {
    const input = { happy: 0.8, sad: 0.42, angry: 0.38, aa: 0.7 };
    const snapshot = { ...input };
    const first = resolveStudioVrmExpressionConflicts(input);
    const second = resolveStudioVrmExpressionConflicts(input);
    expect(first.weights).toEqual(second.weights);
    expect(input).toEqual(snapshot);
  });

  it("counts every mouth-moving emotion toward the ceiling", () => {
    // 놀람·분노도 입을 움직인다(생성 캐릭터의 surprised 는 입을 2.4배로 벌린다). 상한에서
    // 빼 두면 `surprised 1 + aa 1` 이 입 가중치 2.0 으로 통과해 가산 변형이 되살아난다.
    for (const emotion of STUDIO_VRM_EXPRESSION_EMOTIONS) {
      expect(STUDIO_VRM_EXPRESSION_MOUTH_GROUP, emotion).toContain(emotion);
    }
  });

  it("holds a shouting-surprise frame under the ceiling", () => {
    const result = resolveStudioVrmExpressionConflicts({ surprised: 1, aa: 1 });
    expect(mouthSum(result.weights)).toBeCloseTo(STUDIO_VRM_EXPRESSION_DEFAULT_MOUTH_CEILING, 6);
    expect(result.weights.surprised).toBeLessThan(1);
    expect(result.weights.aa).toBeLessThan(1);
  });
});
