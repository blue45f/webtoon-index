import { describe, expect, it } from "vitest";

import {
  classifyStudioVrmPoseBucket,
  filterStudioVrmPosesByBucket,
  filterStudioVrmPosesByQuery,
  findStudioVrmLightingQuickPreset,
  loadStudioVrmRecentPoses,
  normalizeStudioVrmRecentState,
  rememberStudioVrmRecent,
  saveStudioVrmRecentPoses,
  studioVrmPoseBucketCountLabel,
  STUDIO_VRM_LIGHTING_QUICK_PRESETS,
  STUDIO_VRM_POSE_BUCKETS,
} from "./studio-vrm-poser-ux";

describe("studio-vrm-poser-ux", () => {
  const poses = [
    { id: "default", label: "기본", tone: "편한 스탠딩" },
    { id: "xp_sprint", label: "전력 질주", tone: "역동적인 대시" },
    { id: "xp_chair_sit", label: "의자 앉기", tone: "바른 자세 착석" },
    { id: "wave", label: "손인사", tone: "반가운 손짓" },
    { id: "cheer", label: "기쁨", tone: "만세 포즈" },
  ];

  it("classifies pose buckets from labels and ids", () => {
    expect(classifyStudioVrmPoseBucket(poses[0])).toBe("standing");
    expect(classifyStudioVrmPoseBucket(poses[1])).toBe("action");
    expect(classifyStudioVrmPoseBucket(poses[2])).toBe("sit");
    expect(classifyStudioVrmPoseBucket(poses[3])).toBe("hand");
    expect(classifyStudioVrmPoseBucket(poses[4])).toBe("action");
  });

  it("filters by bucket and recent order", () => {
    expect(filterStudioVrmPosesByBucket(poses, "sit").map((p) => p.id)).toEqual(["xp_chair_sit"]);
    expect(
      filterStudioVrmPosesByBucket(poses, "recent", ["wave", "missing", "default"]).map((p) => p.id)
    ).toEqual(["wave", "default"]);
  });

  it("filters by free-text query", () => {
    expect(filterStudioVrmPosesByQuery(poses, "앉").map((p) => p.id)).toEqual(["xp_chair_sit"]);
  });

  it("normalizes and remembers recent ids as MRU", () => {
    const state = normalizeStudioVrmRecentState({ version: 1, ids: ["a", "b", "a", ""] });
    expect(state.ids).toEqual(["a", "b"]);
    expect(rememberStudioVrmRecent(state, "c").ids[0]).toBe("c");
    expect(rememberStudioVrmRecent(state, "b").ids).toEqual(["b", "a"]);
  });

  it("round-trips recent poses through storage", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };
    const next = rememberStudioVrmRecent(loadStudioVrmRecentPoses(storage), "xp_sprint");
    expect(saveStudioVrmRecentPoses(storage, next)).toBe(true);
    expect(loadStudioVrmRecentPoses(storage).ids).toEqual(["xp_sprint"]);
  });

  it("exposes lighting presets and bucket labels", () => {
    expect(STUDIO_VRM_LIGHTING_QUICK_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(findStudioVrmLightingQuickPreset("drama_rim").label).toContain("림");
    expect(STUDIO_VRM_POSE_BUCKETS.some((b) => b.id === "recent")).toBe(true);
    expect(studioVrmPoseBucketCountLabel("recent", 0)).toBe("최근 없음");
    expect(studioVrmPoseBucketCountLabel("all", 3)).toBe("3개");
  });
});
