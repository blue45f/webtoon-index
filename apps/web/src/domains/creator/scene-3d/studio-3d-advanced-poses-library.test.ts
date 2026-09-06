import { describe, expect, it } from "vitest";

import {
  ADVANCED_WEBTOON_POSES,
  EXPRESSIVE_HAND_PRESETS,
  PROP_SOCKET_DEFAULTS,
} from "./studio-3d-advanced-poses-library";

describe("Studio 3D Advanced Pose & Hand Expression Library", () => {
  it("provides comprehensive webtoon action, daily, and dramatic pose presets", () => {
    expect(ADVANCED_WEBTOON_POSES.length).toBeGreaterThanOrEqual(12);

    const landing = ADVANCED_WEBTOON_POSES.find((p) => p.id === "action-hero-landing");
    expect(landing).toBeDefined();
    expect(landing?.jointRotations.length).toBeGreaterThan(4);

    const kabeDon = ADVANCED_WEBTOON_POSES.find((p) => p.id === "dramatic-wall-slam-kabe-don");
    expect(kabeDon).toBeDefined();
  });

  it("provides 16 expressive hand presets with normalized finger curl ranges", () => {
    expect(EXPRESSIVE_HAND_PRESETS.length).toBe(16);

    for (const hand of EXPRESSIVE_HAND_PRESETS) {
      expect(hand.id).toBeTruthy();
      expect(hand.fingerCurls.thumb).toBeGreaterThanOrEqual(0);
      expect(hand.fingerCurls.thumb).toBeLessThanOrEqual(1);
      expect(hand.fingerCurls.index).toBeGreaterThanOrEqual(0);
      expect(hand.fingerCurls.pinky).toBeLessThanOrEqual(1);
    }
  });

  it("provides socket transform defaults for all 6 character attachment points", () => {
    expect(PROP_SOCKET_DEFAULTS["hand-right"]).toBeDefined();
    expect(PROP_SOCKET_DEFAULTS["hand-left"]).toBeDefined();
    expect(PROP_SOCKET_DEFAULTS["head"]).toBeDefined();
    expect(PROP_SOCKET_DEFAULTS["back"]).toBeDefined();
    expect(PROP_SOCKET_DEFAULTS["hip-right"]).toBeDefined();
    expect(PROP_SOCKET_DEFAULTS["hip-left"]).toBeDefined();
  });
});
