import { describe, expect, it } from "vitest";

import {
  STUDIO_HUMANOID_BONE_NAMES,
  STUDIO_HUMANOID_BONE_TOPOLOGY,
  STUDIO_POSE_SCOPES,
  getStudioHumanoidBoneDescriptor,
  isStudioHumanoidBoneInScope,
  isStudioHumanoidBoneName,
  isStudioPoseScope,
  studioHumanoidBoneAncestors,
  studioHumanoidBonesForScope,
} from "./studio-humanoid-bones";

describe("Studio semantic humanoid bone topology", () => {
  it("publishes the complete duplicate-free VRM humanoid vocabulary including fingers", () => {
    expect(STUDIO_HUMANOID_BONE_NAMES).toHaveLength(55);
    expect(new Set(STUDIO_HUMANOID_BONE_NAMES).size).toBe(55);
    expect(STUDIO_HUMANOID_BONE_NAMES).toContain("leftThumbMetacarpal");
    expect(STUDIO_HUMANOID_BONE_NAMES).toContain("rightLittleDistal");
    expect(STUDIO_HUMANOID_BONE_NAMES).toContain("leftToes");
    expect(Object.isFrozen(STUDIO_HUMANOID_BONE_NAMES)).toBe(true);
  });

  it("orders every parent before its children and deeply freezes descriptors", () => {
    const indexByName = new Map(
      STUDIO_HUMANOID_BONE_TOPOLOGY.map((descriptor, index) => [descriptor.name, index])
    );
    for (const descriptor of STUDIO_HUMANOID_BONE_TOPOLOGY) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.scopes)).toBe(true);
      if (descriptor.parent) {
        expect(indexByName.get(descriptor.parent)).toBeLessThan(indexByName.get(descriptor.name) ?? -1);
      }
    }
    expect(Object.isFrozen(STUDIO_HUMANOID_BONE_TOPOLOGY)).toBe(true);
  });

  it("assigns stable semantic side, region, and parent data", () => {
    expect(getStudioHumanoidBoneDescriptor("hips")).toMatchObject({
      parent: null,
      side: "center",
      region: "root",
    });
    expect(getStudioHumanoidBoneDescriptor("leftIndexDistal")).toMatchObject({
      parent: "leftIndexIntermediate",
      side: "left",
      region: "finger",
    });
    expect(getStudioHumanoidBoneDescriptor("rightFoot")).toMatchObject({
      parent: "rightLowerLeg",
      side: "right",
      region: "foot",
    });
  });

  it("builds exact full, body, hand, and gaze/jaw scopes", () => {
    expect(STUDIO_POSE_SCOPES).toEqual([
      "full",
      "upper",
      "lower",
      "left-hand",
      "right-hand",
      "gaze-jaw",
    ]);
    expect(studioHumanoidBonesForScope("full")).toHaveLength(55);
    expect(studioHumanoidBonesForScope("upper")).toHaveLength(46);
    expect(studioHumanoidBonesForScope("lower")).toEqual([
      "hips",
      "leftUpperLeg",
      "leftLowerLeg",
      "leftFoot",
      "leftToes",
      "rightUpperLeg",
      "rightLowerLeg",
      "rightFoot",
      "rightToes",
    ]);
    expect(studioHumanoidBonesForScope("left-hand")).toHaveLength(16);
    expect(studioHumanoidBonesForScope("right-hand")).toHaveLength(16);
    expect(studioHumanoidBonesForScope("gaze-jaw")).toEqual(["leftEye", "rightEye", "jaw"]);
    expect(isStudioHumanoidBoneInScope("leftIndexDistal", "left-hand")).toBe(true);
    expect(isStudioHumanoidBoneInScope("leftLowerArm", "left-hand")).toBe(false);
    expect(Object.isFrozen(studioHumanoidBonesForScope("left-hand"))).toBe(true);
  });

  it("returns parent-first ancestry without exposing mutable state", () => {
    const ancestors = studioHumanoidBoneAncestors("leftIndexDistal");
    expect(ancestors).toEqual([
      "hips",
      "spine",
      "chest",
      "upperChest",
      "leftShoulder",
      "leftUpperArm",
      "leftLowerArm",
      "leftHand",
      "leftIndexProximal",
      "leftIndexIntermediate",
    ]);
    expect(Object.isFrozen(ancestors)).toBe(true);
  });

  it("rejects arbitrary node names and future scopes", () => {
    expect(isStudioHumanoidBoneName("leftIndexDistal")).toBe(true);
    expect(isStudioHumanoidBoneName("Armature/Hips")).toBe(false);
    expect(isStudioHumanoidBoneName("__proto__")).toBe(false);
    expect(isStudioPoseScope("gaze-jaw")).toBe(true);
    expect(isStudioPoseScope("face")).toBe(false);
    expect(isStudioPoseScope("all-nodes")).toBe(false);
  });
});
