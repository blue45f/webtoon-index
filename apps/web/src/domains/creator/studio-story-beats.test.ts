import { describe, expect, it } from "vitest";

import { normalizeScenarioBeatType, SCENARIO_BEAT_LABELS, SCENARIO_BEAT_TYPES } from "./studio-story-beats";

describe("studio story beats", () => {
  it("keeps every supported beat type and exposes a Korean label", () => {
    for (const type of SCENARIO_BEAT_TYPES) {
      expect(normalizeScenarioBeatType(type)).toBe(type);
      expect(SCENARIO_BEAT_LABELS[type].length).toBeGreaterThan(0);
    }
  });

  it.each([undefined, null, "unknown", 42])("falls back unknown values to transition (%s)", (value) => {
    expect(normalizeScenarioBeatType(value)).toBe("transition");
  });
});
