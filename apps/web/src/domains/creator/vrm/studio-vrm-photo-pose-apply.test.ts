import { describe, expect, it, vi } from "vitest";

import { createStudioVrmPhotoPoseApplyPlan } from "./studio-vrm-photo-pose-apply";

describe("studio VRM photo-pose authoritative apply plan", () => {
  it("merges body and detected fingers while preserving the undetected hand", () => {
    const currentBones = { chest: { rotation: [0.1, 0, 0] as const } };
    const currentFingerEdits = {
      leftIndexProximal: [0, 0, -0.1] as const,
      rightIndexProximal: [0, 0, 0.7] as const,
    };
    const plan = createStudioVrmPhotoPoseApplyPlan({
      currentBones,
      currentFingerEdits,
      scannedBones: { chest: [0.4, 0.2, 0] },
      scannedFingerEdits: { leftIndexProximal: [0, 0, -0.8] },
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

  it("preserves locked and target-missing body/finger bones", () => {
    const plan = createStudioVrmPhotoPoseApplyPlan({
      currentBones: {
        head: { rotation: [0.1, 0.1, 0.1] },
        leftHand: { rotation: [0.2, 0.2, 0.2] },
      },
      currentFingerEdits: { leftThumbDistal: [0, 0, -0.2] },
      scannedBones: {
        head: [0.9, 0.9, 0.9],
        leftHand: [0.8, 0.8, 0.8],
      },
      scannedFingerEdits: { leftThumbDistal: [0, 0, -1] },
      lockedBones: ["head", "leftThumbDistal"],
      isBoneAvailable: (bone) => bone !== "leftHand",
    });

    expect(plan.bones.head?.rotation).toEqual([0.1, 0.1, 0.1]);
    expect(plan.bones.leftHand?.rotation).toEqual([0.2, 0.2, 0.2]);
    expect(plan.fingerEdits.leftThumbDistal).toEqual([0, 0, -0.2]);
    expect(plan.skippedLocked).toEqual(["head", "leftThumbDistal"]);
    expect(plan.skippedMissing).toEqual(["leftHand"]);
  });

  it("clamps each finite axis and rejects malformed, non-finite, unknown, and wrong-owner entries", () => {
    const clamp = vi.fn((_bone, _axis, radians: number) => Math.max(-0.5, Math.min(0.5, radians)));
    const plan = createStudioVrmPhotoPoseApplyPlan({
      currentBones: {},
      currentFingerEdits: {},
      scannedBones: {
        head: [1, -1, 0.25],
        leftIndexProximal: [0, 0, -0.2],
        unknownBone: [0, 0, 0],
        chest: [Number.NaN, 0, 0],
      },
      scannedFingerEdits: {
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
      "rightHand",
    ]);
    expect(clamp).toHaveBeenCalledTimes(6);
  });

  it("treats a throwing availability/clamp boundary as a skipped edit", () => {
    const missing = createStudioVrmPhotoPoseApplyPlan({
      currentBones: {},
      currentFingerEdits: {},
      scannedBones: { head: [0.1, 0.2, 0.3] },
      isBoneAvailable: () => { throw new Error("runtime detached"); },
    });
    expect(missing.skippedMissing).toEqual(["head"]);

    const invalid = createStudioVrmPhotoPoseApplyPlan({
      currentBones: {},
      currentFingerEdits: {},
      scannedBones: { head: [0.1, 0.2, 0.3] },
      isBoneAvailable: () => true,
      clampRotation: () => { throw new Error("bad profile"); },
    });
    expect(invalid.skippedInvalid).toEqual(["head"]);
  });
});
