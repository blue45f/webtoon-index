import { describe, expect, it, vi } from "vitest";

import { createStudioVrmPoseApplyPlan } from "./studio-vrm-pose-apply";

describe("studio VRM lock-aware pose apply plan", () => {
  it("merges body and finger targets without mutating inputs", () => {
    const currentBones = { chest: { rotation: [0.1, 0, 0] as const } };
    const currentFingerEdits = {
      leftIndexProximal: [0, 0, -0.1] as const,
      rightIndexProximal: [0, 0, 0.7] as const,
    };
    const plan = createStudioVrmPoseApplyPlan({
      currentBones,
      currentFingerEdits,
      incomingBones: { chest: { rotation: [0.4, 0.2, 0] } },
      incomingFingerEdits: { leftIndexProximal: [0, 0, -0.8] },
      isBoneAvailable: () => true,
    });

    expect(plan.bones.chest?.rotation).toEqual([0.4, 0.2, 0]);
    expect(plan.fingerEdits.leftIndexProximal).toEqual([0, 0, -0.8]);
    expect(plan.fingerEdits.rightIndexProximal).toEqual([0, 0, 0.7]);
    expect(plan.appliedBodyBones).toEqual(["chest"]);
    expect(plan.appliedFingerBones).toEqual(["leftIndexProximal"]);
    expect(currentBones.chest.rotation).toEqual([0.1, 0, 0]);
    expect(currentFingerEdits.leftIndexProximal).toEqual([0, 0, -0.1]);
  });

  it("preserves locked and unavailable bones", () => {
    const plan = createStudioVrmPoseApplyPlan({
      currentBones: {
        head: { rotation: [0.1, 0.1, 0.1] },
        leftHand: { rotation: [0.2, 0.2, 0.2] },
      },
      currentFingerEdits: { leftThumbDistal: [0, 0, -0.2] },
      incomingBones: {
        head: { rotation: [0.9, 0.9, 0.9] },
        leftHand: { rotation: [0.8, 0.8, 0.8] },
      },
      incomingFingerEdits: { leftThumbDistal: [0, 0, -1] },
      lockedBones: ["head", "leftThumbDistal"],
      isBoneAvailable: (bone) => bone !== "leftHand",
    });

    expect(plan.bones.head?.rotation).toEqual([0.1, 0.1, 0.1]);
    expect(plan.bones.leftHand?.rotation).toEqual([0.2, 0.2, 0.2]);
    expect(plan.fingerEdits.leftThumbDistal).toEqual([0, 0, -0.2]);
    expect(plan.skippedLocked).toEqual(["head", "leftThumbDistal"]);
    expect(plan.skippedMissing).toEqual(["leftHand"]);
    expect(plan.appliedBodyBones).toEqual([]);
    expect(plan.appliedFingerBones).toEqual([]);
  });

  it("lerps current→incoming by strength (mid blend)", () => {
    const plan = createStudioVrmPoseApplyPlan({
      currentBones: { head: { rotation: [0, 0, 0] } },
      currentFingerEdits: { leftIndexProximal: [0, 0, 0] },
      incomingBones: { head: { rotation: [1, 0.5, -0.5] } },
      incomingFingerEdits: { leftIndexProximal: [0, 0, 1] },
      isBoneAvailable: () => true,
      strength: 0.5,
    });

    expect(plan.bones.head?.rotation).toEqual([0.5, 0.25, -0.25]);
    expect(plan.fingerEdits.leftIndexProximal).toEqual([0, 0, 0.5]);
    expect(plan.appliedBodyBones).toEqual(["head"]);
    expect(plan.appliedFingerBones).toEqual(["leftIndexProximal"]);
  });

  it("treats strength 0 as identity (current only)", () => {
    const plan = createStudioVrmPoseApplyPlan({
      currentBones: { head: { rotation: [0.3, 0.1, -0.2] } },
      currentFingerEdits: { leftIndexProximal: [0.1, 0, 0.2] },
      incomingBones: { head: { rotation: [1, 1, 1] } },
      incomingFingerEdits: { leftIndexProximal: [9, 9, 9] },
      isBoneAvailable: () => true,
      strength: 0,
    });

    expect(plan.bones.head?.rotation).toEqual([0.3, 0.1, -0.2]);
    expect(plan.fingerEdits.leftIndexProximal).toEqual([0.1, 0, 0.2]);
  });

  it("rejects malformed, unknown, and wrong-channel entries; clamps finite axes", () => {
    const clamp = vi.fn((_bone, _axis, radians: number) => Math.max(-0.5, Math.min(0.5, radians)));
    const plan = createStudioVrmPoseApplyPlan({
      currentBones: {},
      currentFingerEdits: {},
      incomingBones: {
        head: { rotation: [1, -1, 0.25] },
        leftIndexProximal: { rotation: [0, 0, -0.2] },
        unknownBone: { rotation: [0, 0, 0] },
        chest: { rotation: [Number.NaN, 0, 0] },
        neck: { direction: [0, 1, 0] },
      },
      incomingFingerEdits: {
        rightIndexProximal: [0, 0, 1],
        rightHand: [0, 0, 0],
      },
      isBoneAvailable: () => true,
      clampRotation: clamp,
    });

    expect(plan.bones.head?.rotation).toEqual([0.5, -0.5, 0.25]);
    expect(plan.fingerEdits.rightIndexProximal).toEqual([0, 0, 0.5]);
    expect(plan.skippedInvalid).toEqual([
      "leftIndexProximal",
      "unknownBone",
      "chest",
      "neck",
      "rightHand",
    ]);
    expect(clamp).toHaveBeenCalledTimes(6);
  });

  it("treats a throwing availability/clamp boundary as a skipped edit", () => {
    const missing = createStudioVrmPoseApplyPlan({
      currentBones: {},
      currentFingerEdits: {},
      incomingBones: { head: { rotation: [0.1, 0.2, 0.3] } },
      isBoneAvailable: () => {
        throw new Error("runtime detached");
      },
    });
    expect(missing.skippedMissing).toEqual(["head"]);

    const invalid = createStudioVrmPoseApplyPlan({
      currentBones: {},
      currentFingerEdits: {},
      incomingBones: { head: { rotation: [0.1, 0.2, 0.3] } },
      isBoneAvailable: () => true,
      clampRotation: () => {
        throw new Error("bad profile");
      },
    });
    expect(invalid.skippedInvalid).toEqual(["head"]);
  });
});
