import { describe, expect, it } from "vitest";

import { createStudioVrmExpressionApplyPlan } from "./studio-vrm-expression-apply";

describe("studio VRM expression apply plan", () => {
  it("replaces weights at blend 1 and freezes the plan", () => {
    const current = { happy: 0.2, angry: 0.5 };
    const plan = createStudioVrmExpressionApplyPlan({
      current,
      incoming: { happy: 1, sad: 0.4 },
    });

    expect(plan.weights).toEqual({ happy: 1, angry: 0, sad: 0.4 });
    expect(plan.applied).toEqual(["happy", "angry", "sad"]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.weights)).toBe(true);
    expect(current.happy).toBe(0.2);
  });

  it("lerps current→incoming by blend for keys in either map", () => {
    const plan = createStudioVrmExpressionApplyPlan({
      current: { happy: 0, blink: 1 },
      incoming: { happy: 1, sad: 0.5 },
      blend: 0.5,
    });

    expect(plan.weights.happy).toBe(0.5);
    expect(plan.weights.blink).toBe(0.5);
    expect(plan.weights.sad).toBe(0.25);
    expect(plan.applied).toEqual(["happy", "blink", "sad"]);
  });

  it("clamps weights and blend to 0..1", () => {
    const plan = createStudioVrmExpressionApplyPlan({
      current: { happy: -2 },
      incoming: { happy: 3 },
      blend: 2,
    });

    expect(plan.weights.happy).toBe(1);
  });

  it("drops unknown names when availableNames is provided", () => {
    const plan = createStudioVrmExpressionApplyPlan({
      current: { happy: 0.5, customMorph: 0.8 },
      incoming: { sad: 1, anotherUnknown: 0.3 },
      availableNames: ["happy", "sad", "blink"],
    });

    expect(plan.weights).toEqual({ happy: 0, sad: 1 });
    expect(plan.applied).toEqual(["happy", "sad"]);
    expect(plan.skippedUnavailable).toEqual(["customMorph", "anotherUnknown"]);
  });

  it("skips non-finite invalid weights", () => {
    const plan = createStudioVrmExpressionApplyPlan({
      current: { happy: Number.NaN },
      incoming: { sad: Number.POSITIVE_INFINITY, blink: 0.5 },
    });

    expect(plan.weights).toEqual({ blink: 0.5 });
    expect(plan.applied).toEqual(["blink"]);
    expect(plan.skippedInvalid).toEqual(["happy", "sad"]);
  });

  it("treats blend 0 as identity (current only for shared/current keys)", () => {
    const plan = createStudioVrmExpressionApplyPlan({
      current: { happy: 0.7 },
      incoming: { happy: 0, sad: 1 },
      blend: 0,
    });

    expect(plan.weights.happy).toBe(0.7);
    expect(plan.weights.sad).toBe(0);
  });
});
