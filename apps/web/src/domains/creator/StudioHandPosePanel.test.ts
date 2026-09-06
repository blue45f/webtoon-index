import { describe, expect, it } from "vitest";

import {
  STUDIO_HAND_PRESETS,
  solveHandLandmarksToPose,
} from "./studio-hand-pose-scanner";

describe("StudioHandPosePanel integration", () => {
  it("has 6 hand presets covering common webtoon gestures", () => {
    expect(STUDIO_HAND_PRESETS.length).toBe(6);
    const ids = STUDIO_HAND_PRESETS.map((p) => p.id);
    expect(ids).toContain("open_palm");
    expect(ids).toContain("fist");
    expect(ids).toContain("peace");
    expect(ids).toContain("finger_heart");
    expect(ids).toContain("pointing");
    expect(ids).toContain("pencil_grip");
  });

  it("solveHandLandmarksToPose returns default for <21 landmarks", () => {
    const pose = solveHandLandmarksToPose([]);
    expect(pose.thumb.flex).toBeCloseTo(0.1, 1);
  });

  it("all presets produce valid flex (0..1) and spread (-1..1) ranges", () => {
    for (const preset of STUDIO_HAND_PRESETS) {
      for (const [, spec] of Object.entries(preset.pose)) {
        expect(spec.flex).toBeGreaterThanOrEqual(0);
        expect(spec.flex).toBeLessThanOrEqual(1);
        expect(spec.spread).toBeGreaterThanOrEqual(-1);
        expect(spec.spread).toBeLessThanOrEqual(1);
      }
    }
  });
});
