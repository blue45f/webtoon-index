import { describe, expect, it } from "vitest";

import {
  canCollectStudioPointerPredictionsForActiveTail,
  canUseStudioPointerPredictionForSession,
  resolveStudioPointerPredictionPreference,
  supportsStudioPointerPrediction,
} from "./studio-pointer-prediction-capability";

const supportedEnvironment = {
  PointerEvent: { prototype: { getPredictedEvents: () => [] } },
  requestAnimationFrame: () => 1,
  prefersReducedMotion: false,
};

describe("Studio pointer prediction capability", () => {
  it("defaults to capability-driven auto and fails closed for unknown deployment values", () => {
    expect(resolveStudioPointerPredictionPreference(undefined)).toBe("auto");
    expect(resolveStudioPointerPredictionPreference("")).toBe("auto");
    expect(resolveStudioPointerPredictionPreference("auto")).toBe("auto");
    expect(resolveStudioPointerPredictionPreference("off")).toBe("off");
    expect(resolveStudioPointerPredictionPreference("true")).toBe("off");
  });

  it("requires native prediction, animation frames, and non-reduced motion", () => {
    expect(supportsStudioPointerPrediction("auto", supportedEnvironment)).toBe(true);
    expect(supportsStudioPointerPrediction("off", supportedEnvironment)).toBe(false);
    expect(supportsStudioPointerPrediction("auto", {
      ...supportedEnvironment,
      PointerEvent: { prototype: {} },
    })).toBe(false);
    expect(supportsStudioPointerPrediction("auto", {
      ...supportedEnvironment,
      requestAnimationFrame: undefined,
    })).toBe(false);
    expect(supportsStudioPointerPrediction("auto", {
      ...supportedEnvironment,
      prefersReducedMotion: true,
    })).toBe(false);
  });

  it("admits only pen sessions after the global capability gate passes", () => {
    expect(canUseStudioPointerPredictionForSession(true, { pointerType: "pen" })).toBe(true);
    expect(canUseStudioPointerPredictionForSession(true, { pointerType: "mouse" })).toBe(false);
    expect(canUseStudioPointerPredictionForSession(true, { pointerType: "touch" })).toBe(false);
    expect(canUseStudioPointerPredictionForSession(false, { pointerType: "pen" })).toBe(false);
    expect(canUseStudioPointerPredictionForSession(true, null)).toBe(false);
  });

  it("collects native predictions only while a replaceable pen tail is armed", () => {
    expect(canCollectStudioPointerPredictionsForActiveTail(
      true,
      { pointerType: "pen" },
      true
    )).toBe(true);
    expect(canCollectStudioPointerPredictionsForActiveTail(
      true,
      { pointerType: "pen" },
      false
    )).toBe(false);
    expect(canCollectStudioPointerPredictionsForActiveTail(
      true,
      { pointerType: "mouse" },
      true
    )).toBe(false);
    expect(canCollectStudioPointerPredictionsForActiveTail(
      false,
      { pointerType: "pen" },
      true
    )).toBe(false);
    expect(canCollectStudioPointerPredictionsForActiveTail(true, null, true)).toBe(false);
  });
});
