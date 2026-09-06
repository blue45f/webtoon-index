import { describe, expect, it } from "vitest";

import {
  solveHandLandmarksToPose,
  STUDIO_HAND_PRESETS,
  type StudioHandLandmark,
} from "./studio-hand-pose-scanner";

describe("studio-hand-pose-scanner", () => {
  it("provides rich hand pose presets including fist and finger heart", () => {
    expect(STUDIO_HAND_PRESETS.length).toBeGreaterThanOrEqual(5);
    const fist = STUDIO_HAND_PRESETS.find((p) => p.id === "fist");
    expect(fist).toBeDefined();
    expect(fist?.pose.index.flex).toBeGreaterThan(0.8);
  });

  it("solves 21 hand landmarks into finger flex and spread specifications", () => {
    const landmarks: StudioHandLandmark[] = Array.from({ length: 21 }, (_, i) => ({
      x: i * 0.05,
      y: i * 0.05,
      z: 0,
    }));

    const result = solveHandLandmarksToPose(landmarks);
    expect(result.thumb).toBeDefined();
    expect(result.index).toBeDefined();
    expect(result.middle).toBeDefined();
    expect(result.ring).toBeDefined();
    expect(result.little).toBeDefined();
    expect(result.index.flex).toBeGreaterThanOrEqual(0);
    expect(result.index.flex).toBeLessThanOrEqual(1);
  });
});
