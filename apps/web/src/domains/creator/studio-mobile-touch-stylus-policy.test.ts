import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_TOUCH_STYLUS_POLICY,
  evaluatePointerSamplePolicy,
  predictNextStrokePoint,
} from "./studio-mobile-touch-stylus-policy";

describe("studio-mobile-touch-stylus-policy", () => {
  describe("Palm Rejection & Touch Role Separation", () => {
    it("always accepts stylus/pen drawing regardless of touch state", () => {
      const decision = evaluatePointerSamplePolicy({
        pointerType: "pen",
        clientX: 100,
        clientY: 200,
        pressure: 0.5,
      });
      expect(decision.action).toBe("accept");
      expect(decision.isPalm).toBe(false);
    });

    it("suppresses touch input when stylus is actively drawing (concurrent palm suppression)", () => {
      const decision = evaluatePointerSamplePolicy(
        {
          pointerType: "touch",
          clientX: 80,
          clientY: 220,
          width: 10,
          height: 10,
        },
        DEFAULT_STUDIO_TOUCH_STYLUS_POLICY,
        true, // activeStylusDrawing = true
      );
      expect(decision.action).toBe("suppress-palm");
      expect(decision.isPalm).toBe(true);
    });

    it("suppresses large palm contact patches by size and area", () => {
      const palmSample = {
        pointerType: "touch",
        clientX: 300,
        clientY: 400,
        width: 60, // radius 30 >= threshold 22
        height: 60,
      };
      const decision = evaluatePointerSamplePolicy(palmSample, DEFAULT_STUDIO_TOUCH_STYLUS_POLICY, false);
      expect(decision.action).toBe("suppress-palm");
      expect(decision.isPalm).toBe(true);
      expect(decision.reason).toContain("대형 접촉 면적");
    });

    it("delegates normal finger touches to canvas navigation when fingerAction is 'navigate'", () => {
      const touchSample = {
        pointerType: "touch",
        clientX: 150,
        clientY: 150,
        width: 12,
        height: 12,
      };
      const decision = evaluatePointerSamplePolicy(touchSample, DEFAULT_STUDIO_TOUCH_STYLUS_POLICY, false);
      expect(decision.action).toBe("delegate-navigation");
      expect(decision.isPalm).toBe(false);
    });

    it("allows finger drawing when fingerAction is set to 'draw'", () => {
      const touchSample = {
        pointerType: "touch",
        clientX: 150,
        clientY: 150,
        width: 12,
        height: 12,
      };
      const decision = evaluatePointerSamplePolicy(
        touchSample,
        { ...DEFAULT_STUDIO_TOUCH_STYLUS_POLICY, fingerAction: "draw" },
        false,
      );
      expect(decision.action).toBe("accept");
    });
  });

  describe("Stroke Prediction", () => {
    it("returns null when prediction is turned off or not enough points", () => {
      expect(predictNextStrokePoint([[10, 10]], "linear")).toBeNull();
      expect(predictNextStrokePoint([[10, 10], [20, 20]], "off")).toBeNull();
    });

    it("extrapolates next point linearly along velocity vector", () => {
      const predicted = predictNextStrokePoint(
        [[10, 20], [20, 30]],
        "linear",
        1.0,
      );
      expect(predicted).toEqual([30, 40]);
    });

    it("extrapolates next point with acceleration in quadratic mode", () => {
      const predicted = predictNextStrokePoint(
        [[0, 0], [10, 0], [30, 0]], // accelerating in X (+10 then +20)
        "quadratic",
        1.0,
      );
      expect(predicted![0]).toBeGreaterThan(30);
    });
  });
});
