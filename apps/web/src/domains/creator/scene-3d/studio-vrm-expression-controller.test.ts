import { describe, expect, it } from "vitest";

import {
  alignObjectToNormal,
  applyVrmMoodPreset,
  DEFAULT_VRM_EXPRESSION_STATE,
  setVrmExpressionWeight,
  WEBTOON_VRM_MOOD_PRESETS,
} from "./studio-vrm-expression-controller";

describe("studio-vrm-expression-controller", () => {
  describe("VRM Facial Expressions", () => {
    it("sets individual expression blend weights clamped between 0 and 1", () => {
      let state = DEFAULT_VRM_EXPRESSION_STATE;
      state = setVrmExpressionWeight(state, "happy", 0.75);
      expect(state.weights.happy).toBe(0.75);

      state = setVrmExpressionWeight(state, "happy", 1.5);
      expect(state.weights.happy).toBe(1.0); // Clamped
    });

    it("applies webtoon emotional mood presets", () => {
      const surprisedState = applyVrmMoodPreset("당황·경악");
      expect(surprisedState.activePresetMood).toBe("당황·경악");
      expect(surprisedState.weights.surprised).toBe(1.0);
      expect(surprisedState.weights.happy).toBe(0.2);
    });

    it("includes standard character mood presets", () => {
      expect(WEBTOON_VRM_MOOD_PRESETS["기쁨·미소"]).toBeDefined();
      expect(WEBTOON_VRM_MOOD_PRESETS["분노·격앙"]).toBeDefined();
      expect(WEBTOON_VRM_MOOD_PRESETS["윙크(좌)"]).toBeDefined();
    });
  });

  describe("3D Object Orientation Alignment", () => {
    it("computes Euler angles to align with flat floor normal [0, 1, 0]", () => {
      const [pitch, yaw, roll] = alignObjectToNormal([0, 1, 0]);
      expect(pitch).toBe(0);
      expect(yaw).toBe(0);
      expect(roll).toBe(0);
    });

    it("computes non-zero tilt angles for sloped surface normal", () => {
      const [_pitch, yaw] = alignObjectToNormal([1, 1, 0]);
      expect(yaw).not.toBe(0);
    });
  });
});
