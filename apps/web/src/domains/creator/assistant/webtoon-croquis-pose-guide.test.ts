import { describe, expect, it } from "vitest";

import {
  COMIC_POSE_LIBRARY,
  PERSPECTIVE_GUIDES,
  WebtoonCroquisPoseGuide,
  type ComicPoseCategory,
} from "./webtoon-croquis-pose-guide";

describe("WebtoonCroquisPoseGuide", () => {
  const guide = new WebtoonCroquisPoseGuide();

  it("provides 24 unique prompts balanced across the four production categories", () => {
    expect(COMIC_POSE_LIBRARY).toHaveLength(24);
    expect(new Set(COMIC_POSE_LIBRARY.map((pose) => pose.id)).size).toBe(24);

    for (const category of ["action", "emotion", "daily", "fantasy"] as const satisfies readonly ComicPoseCategory[]) {
      const poses = guide.listPoses(category);
      expect(poses).toHaveLength(6);
      expect(poses.every((pose) => pose.category === category)).toBe(true);
    }

    expect(guide.listPoses()).toHaveLength(COMIC_POSE_LIBRARY.length);
  });

  it("provides 4 distinct perspective camera guide presets", () => {
    expect(Object.keys(PERSPECTIVE_GUIDES)).toHaveLength(4);

    const low = guide.getPerspectiveGuide("low-angle");
    expect(low.horizonRatioY).toBe(0.8);
    expect(low.vanishingPointCount).toBe(3);

    const dutch = guide.getPerspectiveGuide("dutch-tilt");
    expect(dutch.tiltAngleDeg).toBe(-12);
  });

  it("picks a pose consistently using a seed and tolerates invalid seeds", () => {
    const poseA = guide.getRandomPose(42);
    const poseB = guide.getRandomPose(42);
    expect(poseA.id).toBe(poseB.id);
    expect(guide.getRandomPose(Number.NaN)).toBeTruthy();
    expect(guide.getRandomPose(Number.POSITIVE_INFINITY, "fantasy").category).toBe("fantasy");
  });

  it("selects a next pose without immediately repeating the current one", () => {
    const current = guide.getRandomPose(7, "daily");
    const next = guide.getNextPose(current.id, 7, "daily");

    expect(next.category).toBe("daily");
    expect(next.id).not.toBe(current.id);
  });

  it("creates deterministic non-repeating practice sequences with exclusions", () => {
    const sequenceA = guide.getPracticeSequence(5, {
      category: "action",
      seed: 1234,
      excludeIds: ["pose-hero-dash"],
    });
    const sequenceB = guide.getPracticeSequence(5, {
      category: "action",
      seed: 1234,
      excludeIds: ["pose-hero-dash"],
    });

    expect(sequenceA.map((pose) => pose.id)).toEqual(sequenceB.map((pose) => pose.id));
    expect(new Set(sequenceA.map((pose) => pose.id)).size).toBe(sequenceA.length);
    expect(sequenceA.every((pose) => pose.category === "action")).toBe(true);
    expect(sequenceA.some((pose) => pose.id === "pose-hero-dash")).toBe(false);
  });

  it("clamps a requested drill to eligible content instead of repeating prompts", () => {
    expect(guide.getPracticeSequence(99, { category: "fantasy", seed: 1 })).toHaveLength(6);
    expect(guide.getPracticeSequence(-3, { seed: 1 })).toHaveLength(0);
    expect(guide.getPracticeSequence(Number.NaN, { seed: 1 })).toHaveLength(0);
  });
});