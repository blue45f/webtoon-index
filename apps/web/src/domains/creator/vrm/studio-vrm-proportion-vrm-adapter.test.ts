import { VRMHumanoid, type VRM, type VRMHumanBones } from "@pixiv/three-vrm";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { STUDIO_HUMANOID_BONE_NAMES } from "../studio-humanoid-bones";

import { STUDIO_VRM_REFERENCE_BONE_SNAPSHOT } from "./studio-vrm-proportion-core";
import {
  createStudioVrmProportionVrmAdapter,
  measureStudioVrmProportionHeadLength,
  rebuildStudioVrmNormalizedHumanoid,
} from "./studio-vrm-proportion-vrm-adapter";

function createRig(options: { readonly autoUpdateHumanBones?: boolean } = {}) {
  const scene = new THREE.Group();
  const byName = new Map<string, THREE.Object3D>();
  const rests = new Map(
    STUDIO_VRM_REFERENCE_BONE_SNAPSHOT.bones.map((bone) => [bone.name, bone]),
  );
  const humanBones: Partial<VRMHumanBones> = {};
  for (const name of STUDIO_HUMANOID_BONE_NAMES) {
    const rest = rests.get(name);
    if (!rest) continue;
    const node = new THREE.Object3D();
    node.name = `raw:${name}`;
    node.position.fromArray(rest.restOffset);
    const parent = rest.parent ? byName.get(rest.parent) : scene;
    parent?.add(node);
    byName.set(name, node);
    humanBones[name] = { node };
  }
  const humanoid = new VRMHumanoid(humanBones as VRMHumanBones, {
    autoUpdateHumanBones: options.autoUpdateHumanBones,
  });
  scene.add(humanoid.normalizedHumanBonesRoot);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.6, 0.3),
    new THREE.MeshBasicMaterial(),
  );
  body.position.y = 0.8;
  scene.add(body);
  const constraintInit = vi.fn();
  const springInit = vi.fn();
  const vrm = {
    scene,
    humanoid,
    nodeConstraintManager: { setInitState: constraintInit },
    springBoneManager: { setInitState: springInit },
  } as unknown as VRM;
  scene.updateMatrixWorld(true);
  return { byName, constraintInit, humanoid, scene, springInit, vrm };
}

describe("three-vrm proportion adapter", () => {
  it("replaces the loader-attached normalized root instead of leaving a detached copy", () => {
    const { humanoid, scene, vrm } = createRig();
    const before = humanoid.normalizedHumanBonesRoot;
    const index = scene.children.indexOf(before);

    expect(rebuildStudioVrmNormalizedHumanoid(vrm)).toBe(true);

    const after = humanoid.normalizedHumanBonesRoot;
    expect(after).not.toBe(before);
    expect(before.parent).toBeNull();
    expect(after.parent).toBe(scene);
    expect(scene.children[index]).toBe(after);
    expect(scene.children.filter((child) => child === after)).toHaveLength(1);
  });

  it("measures a finite model-local head length from rest eyes with a bounded fallback", () => {
    const { vrm } = createRig();
    const receipt = measureStudioVrmProportionHeadLength(vrm);
    expect(receipt).not.toBeNull();
    expect(receipt).toMatchObject({
      version: 1,
      source: "eye-landmarks",
      reliable: true,
    });
    expect(receipt!.value).toBeGreaterThan(1.6 / 14);
    expect(receipt!.value).toBeLessThanOrEqual(1.6 / 2.5);
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("marks a bounds-only head length as an estimate instead of claiming exact measurement", () => {
    const { humanoid, vrm } = createRig();
    humanoid.rawHumanBones.leftEye = undefined;
    humanoid.rawHumanBones.rightEye = undefined;

    const receipt = measureStudioVrmProportionHeadLength(vrm);

    expect(receipt).toMatchObject({
      version: 1,
      source: "mesh-bounds-estimate",
      reliable: false,
    });
    expect(receipt!.value).toBeGreaterThan(0);
  });

  it("neutralizes authored root TRS, syncs raw rest and restores lifecycle owners", () => {
    const { constraintInit, humanoid, scene, springInit, vrm } = createRig();
    const reapply = vi.fn(() => {
      scene.position.set(0.2, 0.3, -0.1);
      scene.rotation.y = 0.4;
      scene.scale.set(0.9, 1.2, 0.9);
      scene.updateMatrixWorld(true);
      return true;
    });
    scene.position.set(1, 2, 3);
    scene.rotation.y = 0.8;
    scene.scale.set(0.7, 1.3, 0.7);
    humanoid.getNormalizedBoneNode("leftUpperArm")?.rotation.set(0.4, 0.2, -0.3);
    humanoid.update();

    const adapter = createStudioVrmProportionVrmAdapter({
      vrm,
      getCurrentModelGeneration: () => 7,
      reapplyAuthoredPose: reapply,
    });
    Object.assign(vrm, {
      nodeConstraintManager: undefined,
      springBoneManager: undefined,
    });

    expect(adapter.resetNormalizedPoseAndSyncRawRest()).toBe(true);
    expect(scene.position.toArray()).toEqual([0, 0, 0]);
    expect(scene.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    expect(scene.scale.toArray()).toEqual([1, 1, 1]);
    expect(adapter.rebuildNormalizedRig()).toBe(true);
    expect(adapter.setNodeConstraintInitState?.()).toBe(true);
    expect(adapter.setSpringBoneInitState?.()).toBe(true);
    expect(adapter.reapplyAuthoredPose()).toBe(true);
    expect(constraintInit).toHaveBeenCalledOnce();
    expect(springInit).toHaveBeenCalledOnce();
    expect(reapply).toHaveBeenCalledOnce();
    expect(scene.position.toArray()).toEqual([0.2, 0.3, -0.1]);
    expect(scene.scale.toArray()).toEqual([0.9, 1.2, 0.9]);
  });

  it("resets directly-authored raw pose when autoUpdateHumanBones is disabled", () => {
    const { humanoid, scene, vrm } = createRig({ autoUpdateHumanBones: false });
    const head = humanoid.getRawBoneNode("head")!;
    const hips = humanoid.getRawBoneNode("hips")!;
    const restHeadRotation = humanoid.rawRestPose.head!.rotation!;
    const restHipsPosition = humanoid.rawRestPose.hips!.position!;
    head.rotation.set(0.75, -0.2, 0.1);
    hips.position.add(new THREE.Vector3(0.3, 0.4, -0.2));
    scene.position.set(0.2, 0.5, -0.1);

    const adapter = createStudioVrmProportionVrmAdapter({
      vrm,
      getCurrentModelGeneration: () => 8,
      reapplyAuthoredPose: () => true,
    });

    expect(adapter.resetNormalizedPoseAndSyncRawRest()).toBe(true);
    expect(humanoid.autoUpdateHumanBones).toBe(false);
    expect(head.quaternion.toArray()).toEqual(restHeadRotation);
    expect(hips.position.toArray()).toEqual(restHipsPosition);
    expect(scene.position.toArray()).toEqual([0, 0, 0]);
  });
});
