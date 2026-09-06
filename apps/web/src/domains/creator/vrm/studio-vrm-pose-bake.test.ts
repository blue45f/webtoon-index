import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { STUDIO_HUMANOID_BONE_NAMES } from "../studio-humanoid-bones";

import {
  STUDIO_VRM_DIRECT_EDIT_BONES,
  bakeStudioVrmRuntimeBoneRotation,
  bakeStudioVrmRuntimePose,
  canonicalizeStudioVrmPoseAngle,
} from "./studio-vrm-pose-bake";
import {
  STUDIO_VRM_FINGER_BONES,
  STUDIO_VRM_HUMANOID_BONES,
} from "./studio-vrm-scene-document";

import type { VRMHumanBoneName } from "@pixiv/three-vrm";

describe("VRM runtime pose bake", () => {
  it("uses the complete shared 55-bone semantic topology", () => {
    expect(STUDIO_VRM_DIRECT_EDIT_BONES).toEqual(STUDIO_HUMANOID_BONE_NAMES);
    expect(new Set(STUDIO_VRM_DIRECT_EDIT_BONES).size).toBe(55);
    expect(new Set([...STUDIO_VRM_HUMANOID_BONES, ...STUDIO_VRM_FINGER_BONES])).toEqual(
      new Set(STUDIO_HUMANOID_BONE_NAMES),
    );
  });

  it("canonicalizes finite angles into the persisted half-open range", () => {
    expect(canonicalizeStudioVrmPoseAngle(Math.PI * 3)).toBe(-Math.PI);
    expect(canonicalizeStudioVrmPoseAngle(-Math.PI * 4)).toBe(0);
    expect(Object.is(canonicalizeStudioVrmPoseAngle(-0), -0)).toBe(false);
    expect(canonicalizeStudioVrmPoseAngle(Number.NaN)).toBe(0);
  });

  it("bakes a direction-derived quaternion without changing its visible orientation", () => {
    const node = new THREE.Object3D();
    const rest = new THREE.Vector3(0, -1, 0);
    const target = new THREE.Vector3(0.65, -0.5, 0.4).normalize();
    node.quaternion.setFromUnitVectors(rest, target);

    const rotation = bakeStudioVrmRuntimeBoneRotation(node);
    expect(rotation).not.toBeNull();
    const restored = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation!, "XYZ"));
    expect(Math.abs(restored.dot(node.quaternion))).toBeCloseTo(1, 10);
  });

  it("captures hips and shoulders with the runtime y offset", () => {
    const nodes = new Map<VRMHumanBoneName, THREE.Object3D>();
    const hips = new THREE.Object3D();
    hips.rotation.set(0.1, -0.2, 0.3);
    const shoulder = new THREE.Object3D();
    shoulder.rotation.set(-0.2, 0.15, -0.1);
    nodes.set("hips", hips);
    nodes.set("leftShoulder", shoulder);

    const baked = bakeStudioVrmRuntimePose({
      humanoid: { getNormalizedBoneNode: (name) => nodes.get(name) ?? null },
      scene: { position: { y: 0.42 } },
    }, ["hips", "leftShoulder"]);

    expect(baked?.yOffset).toBe(0.42);
    expect(baked?.bones.hips?.rotation).toEqual(expect.arrayContaining([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]));
    expect(baked?.bones.leftShoulder?.rotation).toBeDefined();
  });

  it("persists optional eye, jaw and toe rotations instead of dropping them during scene bake", () => {
    const nodes = new Map<VRMHumanBoneName, THREE.Object3D>();
    for (const bone of ["leftEye", "rightEye", "jaw", "leftToes", "rightToes"] as const) {
      const node = new THREE.Object3D();
      node.rotation.set(0.05, -0.1, 0.15);
      nodes.set(bone, node);
    }
    const baked = bakeStudioVrmRuntimePose({
      humanoid: { getNormalizedBoneNode: (name) => nodes.get(name) ?? null },
    });

    expect(Object.keys(baked?.bones ?? {}).sort()).toEqual(
      ["jaw", "leftEye", "leftToes", "rightEye", "rightToes"].sort(),
    );
  });

  it("skips invalid and missing runtime nodes instead of serializing non-finite data", () => {
    const invalid = new THREE.Object3D();
    invalid.quaternion.set(Number.NaN, 0, 0, 1);
    const baked = bakeStudioVrmRuntimePose({
      humanoid: {
        getNormalizedBoneNode: (name) => name === "head" ? invalid : null,
      },
      scene: { position: { y: Number.POSITIVE_INFINITY } },
    }, ["head", "neck"]);

    expect(baked).toEqual({ bones: {}, yOffset: 0 });
  });
});
