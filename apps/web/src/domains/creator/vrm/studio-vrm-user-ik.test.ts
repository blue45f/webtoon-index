import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { solveTwoBoneTarget } from "../studio-rig-two-bone-ik";

import { solveStudioVrmFloorContact } from "./studio-vrm-contact-solver";
import {
  clampStudioVrmJointRotation,
  dampStudioVrmJointRotation,
} from "./studio-vrm-joint-limits";
import { bakeStudioVrmRuntimePose } from "./studio-vrm-pose-bake";
import {
  STUDIO_VRM_USER_IK_CHAINS,
  solveStudioVrmUserIk,
} from "./studio-vrm-user-ik";

import type { StudioVrmJointRotation } from "./studio-vrm-joint-limits";
import type { PoseBoneMap } from "./studio-vrm-poser-utils";
import type {
  StudioVrmUserIkDependencies,
  StudioVrmUserIkEffector,
  StudioVrmUserIkRequest,
  StudioVrmUserIkSource,
} from "./studio-vrm-user-ik";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";

const UNLIMITED_DEPENDENCIES: StudioVrmUserIkDependencies = {
  solveTarget: solveTwoBoneTarget,
  bakeRuntimePose: bakeStudioVrmRuntimePose,
  dampJointRotation: (_boneName, rotation) => {
    if (!Array.isArray(rotation) || rotation.length < 3) return [0, 0, 0];
    return [Number(rotation[0]), Number(rotation[1]), Number(rotation[2])];
  },
  dampProfiledJointRotation: (_boneName, rotation) => {
    if (!Array.isArray(rotation) || rotation.length < 3) return [0, 0, 0];
    return [Number(rotation[0]), Number(rotation[1]), Number(rotation[2])];
  },
};

interface RigFixture {
  readonly source: StudioVrmUserIkSource;
  readonly scene: THREE.Group;
  readonly nodes: Map<VRMHumanBoneName, THREE.Bone>;
}

function addArm(
  scene: THREE.Group,
  nodes: Map<VRMHumanBoneName, THREE.Bone>,
  side: "left" | "right",
) {
  const shoulder = new THREE.Bone();
  const upper = new THREE.Bone();
  const lower = new THREE.Bone();
  const hand = new THREE.Bone();
  shoulder.position.x = side === "left" ? -3 : 3;
  lower.position.x = 1;
  hand.position.x = 1;
  shoulder.add(upper);
  upper.add(lower);
  lower.add(hand);
  scene.add(shoulder);
  nodes.set(`${side}Shoulder`, shoulder);
  nodes.set(`${side}UpperArm`, upper);
  nodes.set(`${side}LowerArm`, lower);
  nodes.set(`${side}Hand`, hand);
}

function addLeg(
  scene: THREE.Group,
  nodes: Map<VRMHumanBoneName, THREE.Bone>,
  side: "left" | "right",
) {
  const upper = new THREE.Bone();
  const lower = new THREE.Bone();
  const foot = new THREE.Bone();
  upper.position.x = side === "left" ? -1 : 1;
  lower.position.y = -1;
  foot.position.y = -1;
  upper.add(lower);
  lower.add(foot);
  scene.add(upper);
  nodes.set(`${side}UpperLeg`, upper);
  nodes.set(`${side}LowerLeg`, lower);
  nodes.set(`${side}Foot`, foot);
}

function createRig(): RigFixture {
  const scene = new THREE.Group();
  const nodes = new Map<VRMHumanBoneName, THREE.Bone>();
  const hips = new THREE.Bone();
  hips.position.y = 1;
  scene.add(hips);
  nodes.set("hips", hips);
  addArm(scene, nodes, "left");
  addArm(scene, nodes, "right");
  addLeg(scene, nodes, "left");
  addLeg(scene, nodes, "right");
  scene.updateMatrixWorld(true);
  return {
    scene,
    nodes,
    source: {
      scene,
      humanoid: {
        getNormalizedBoneNode(name) {
          return nodes.get(name) ?? null;
        },
      },
    },
  };
}

function vectorClose(actual: THREE.Vector3, expected: THREE.Vector3, precision = 5) {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
  expect(actual.z).toBeCloseTo(expected.z, precision);
}

function applyRotationOnlyPose(fixture: RigFixture, bones: PoseBoneMap, yOffset: number) {
  fixture.scene.position.y = yOffset;
  for (const [name, poseBone] of Object.entries(bones)) {
    if (!poseBone?.rotation) continue;
    fixture.nodes.get(name as VRMHumanBoneName)?.rotation.set(...poseBone.rotation, "XYZ");
  }
  fixture.scene.updateMatrixWorld(true);
}

function targetFor(fixture: RigFixture, effector: StudioVrmUserIkEffector): THREE.Vector3 {
  const chain = STUDIO_VRM_USER_IK_CHAINS[effector];
  const start = fixture.nodes.get(chain.upper)!.getWorldPosition(new THREE.Vector3());
  return chain.kind === "hand"
    ? start.add(new THREE.Vector3(1, 1, 0))
    : start.add(new THREE.Vector3(1, -1, 0));
}

function poleFor(fixture: RigFixture, effector: StudioVrmUserIkEffector, z = 1): THREE.Vector3 {
  const chain = STUDIO_VRM_USER_IK_CHAINS[effector];
  return fixture.nodes
    .get(chain.upper)!
    .getWorldPosition(new THREE.Vector3())
    .add(new THREE.Vector3(0, 0, z));
}

describe("Studio VRM user IK", () => {
  it.each([
    ["leftHand", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand"],
    ["rightHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"],
    ["leftFoot", undefined, "leftUpperLeg", "leftLowerLeg", "leftFoot"],
    ["rightFoot", undefined, "rightUpperLeg", "rightLowerLeg", "rightFoot"],
  ] as const)(
    "%s effector를 올바른 normalized-bone 체인에 매핑한다",
    (effector, proximal, upper, lower, end) => {
      expect(STUDIO_VRM_USER_IK_CHAINS[effector]).toMatchObject({
        effector,
        upper,
        lower,
        end,
      });
      expect(STUDIO_VRM_USER_IK_CHAINS[effector].proximal).toBe(proximal);
    },
  );

  it.each([
    "leftHand",
    "rightHand",
    "leftFoot",
    "rightFoot",
  ] as const)("%s world 목표를 rotation-only pose로 푼다", (effector) => {
    const sourceFixture = createRig();
    const target = targetFor(sourceFixture, effector);
    const pole = poleFor(sourceFixture, effector);

    const result = solveStudioVrmUserIk(
      sourceFixture.source,
      { effector, targetWorld: target, poleWorld: pole, softLimitStrength: 0 },
      UNLIMITED_DEPENDENCIES,
    );

    expect(result).not.toBeNull();
    expect(result?.reachable).toBe(true);
    expect(result?.clamped).toBe(false);
    expect(result?.limited).toBe(false);
    expect(Object.values(result!.bones).every((bone) => (
      bone?.rotation !== undefined && bone.direction === undefined
    ))).toBe(true);

    const outputFixture = createRig();
    applyRotationOnlyPose(outputFixture, result!.bones, result!.yOffset);
    const actual = outputFixture.nodes
      .get(STUDIO_VRM_USER_IK_CHAINS[effector].end)!
      .getWorldPosition(new THREE.Vector3());
    vectorClose(actual, target);
  });

  it("solves in scale-free avatar space under rotated non-uniform body scale", () => {
    const fixture = createRig();
    fixture.scene.scale.set(0.7, 1.4, 0.7);
    fixture.scene.rotation.y = 0.35;
    fixture.scene.updateMatrixWorld(true);
    const upper = fixture.nodes.get("rightUpperArm")!;
    const startWorld = upper.getWorldPosition(new THREE.Vector3());
    const sceneInverse = fixture.scene.matrixWorld.clone().invert();
    const startLocal = startWorld.clone().applyMatrix4(sceneInverse);
    const target = startLocal.clone().add(new THREE.Vector3(1, 0.5, 0))
      .applyMatrix4(fixture.scene.matrixWorld);
    const pole = startLocal.clone().add(new THREE.Vector3(0, 0, 1))
      .applyMatrix4(fixture.scene.matrixWorld);

    const result = solveStudioVrmUserIk(fixture.source, {
      effector: "rightHand",
      targetWorld: target,
      poleWorld: pole,
      softLimitStrength: 0,
    }, UNLIMITED_DEPENDENCIES);

    expect(result).not.toBeNull();
    expect(result?.reachable).toBe(true);
    expect(result?.limited).toBe(false);
    applyRotationOnlyPose(fixture, result!.bones, result!.yOffset);
    const actual = fixture.nodes.get("rightHand")!.getWorldPosition(new THREE.Vector3());
    vectorClose(actual, target, 8);
    vectorClose(new THREE.Vector3(...result!.effectiveTargetWorld), actual, 8);
  });

  it("현재 runtime 자세를 먼저 bake해 shoulder/end 회전과 yOffset을 보존한다", () => {
    const fixture = createRig();
    fixture.scene.position.y = 0.42;
    const shoulder = fixture.nodes.get("leftShoulder")!;
    const upper = fixture.nodes.get("leftUpperArm")!;
    const hand = fixture.nodes.get("leftHand")!;
    shoulder.rotation.set(0.08, -0.12, 0.16);
    upper.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0.8, 0.3, 0.2).normalize(),
    );
    hand.rotation.set(-0.1, 0.25, -0.2);
    fixture.scene.updateMatrixWorld(true);
    const bakedBefore = bakeStudioVrmRuntimePose(fixture.source)!;
    const target = fixture.nodes
      .get("leftUpperArm")!
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0.9, 0.8, 0.2));

    const result = solveStudioVrmUserIk(
      fixture.source,
      {
        effector: "leftHand",
        targetWorld: target,
        poleWorld: poleFor(fixture, "leftHand"),
      },
      UNLIMITED_DEPENDENCIES,
    );

    expect(result?.yOffset).toBe(0.42);
    expect(result?.bones.leftShoulder).toEqual(bakedBefore.bones.leftShoulder);
    expect(result?.bones.leftHand).toEqual(bakedBefore.bones.leftHand);
    expect(result?.bones.leftUpperArm?.direction).toBeUndefined();
    expect(result?.bones.leftUpperArm?.rotation).toBeDefined();
  });

  it("pole 방향을 따르고 같은 입력에는 결정론적인 결과를 반환한다", () => {
    const fixture = createRig();
    const target = targetFor(fixture, "leftHand");
    const positive = solveStudioVrmUserIk(
      fixture.source,
      {
        effector: "leftHand",
        targetWorld: target,
        poleWorld: poleFor(fixture, "leftHand", 1),
      },
      UNLIMITED_DEPENDENCIES,
    )!;
    const repeated = solveStudioVrmUserIk(
      fixture.source,
      {
        effector: "leftHand",
        targetWorld: target,
        poleWorld: poleFor(fixture, "leftHand", 1),
      },
      UNLIMITED_DEPENDENCIES,
    )!;
    const negative = solveStudioVrmUserIk(
      fixture.source,
      {
        effector: "leftHand",
        targetWorld: target,
        poleWorld: poleFor(fixture, "leftHand", -1),
      },
      UNLIMITED_DEPENDENCIES,
    )!;

    expect(repeated).toEqual(positive);
    expect(positive.solvedMiddleWorld[2]).toBeGreaterThan(0);
    expect(negative.solvedMiddleWorld[2]).toBeLessThan(0);
  });

  it("도달 불가능한 target을 체인 길이 안으로 clamp하고 입력을 바꾸지 않는다", () => {
    const fixture = createRig();
    const upper = fixture.nodes.get("rightUpperLeg")!;
    const start = upper.getWorldPosition(new THREE.Vector3());
    const target = start.clone().add(new THREE.Vector3(100, -20, 5));
    const pole = start.clone().add(new THREE.Vector3(0, 0, 3));
    const targetSnapshot = target.clone();
    const poleSnapshot = pole.clone();

    const result = solveStudioVrmUserIk(
      fixture.source,
      { effector: "rightFoot", targetWorld: target, poleWorld: pole },
      UNLIMITED_DEPENDENCIES,
    )!;

    expect(result.reachable).toBe(false);
    expect(result.clamped).toBe(true);
    expect(new THREE.Vector3(...result.effectiveTargetWorld).distanceTo(start)).toBeLessThan(2);
    vectorClose(target, targetSnapshot, 10);
    vectorClose(pole, poleSnapshot, 10);
  });

  it("runtime bone transforms를 변경하지 않고 새 PoseBoneMap만 반환한다", () => {
    const fixture = createRig();
    fixture.nodes.get("rightUpperArm")!.rotation.set(0.1, -0.2, 0.3);
    fixture.nodes.get("rightLowerArm")!.rotation.set(-0.15, 0.05, -0.25);
    fixture.scene.updateMatrixWorld(true);
    const snapshots = [...fixture.nodes.values()].map((node) => ({
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    }));

    expect(solveStudioVrmUserIk(
      fixture.source,
      {
        effector: "rightHand",
        targetWorld: targetFor(fixture, "rightHand"),
        poleWorld: poleFor(fixture, "rightHand"),
      },
      UNLIMITED_DEPENDENCIES,
    )).not.toBeNull();

    for (const snapshot of snapshots) {
      vectorClose(snapshot.node.position, snapshot.position, 12);
      vectorClose(snapshot.node.scale, snapshot.scale, 12);
      expect(Math.abs(snapshot.node.quaternion.dot(snapshot.quaternion))).toBeCloseTo(1, 12);
    }
  });

  it("soft damping을 적용한 뒤 두 IK 관절을 hard limit 안에 둔다", () => {
    const fixture = createRig();
    const target = fixture.nodes
      .get("leftUpperArm")!
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(-0.6, 0.15, 0.1));
    const dampingCalls: Array<{
      bone: unknown;
      rotation: StudioVrmJointRotation;
      strength: unknown;
    }> = [];
    const dependencies: StudioVrmUserIkDependencies = {
      solveTarget: solveTwoBoneTarget,
      bakeRuntimePose: bakeStudioVrmRuntimePose,
      dampJointRotation(bone, rotation, strength) {
        const typed = rotation as StudioVrmJointRotation;
        dampingCalls.push({ bone, rotation: [...typed], strength });
        return dampStudioVrmJointRotation(bone, typed, strength);
      },
    };

    const result = solveStudioVrmUserIk(
      fixture.source,
      {
        effector: "leftHand",
        targetWorld: target,
        poleWorld: poleFor(fixture, "leftHand", -1),
        softLimitStrength: 0.85,
      },
      dependencies,
    )!;

    expect(dampingCalls.map((call) => call.bone)).toEqual([
      "leftUpperArm",
      "leftLowerArm",
    ]);
    expect(dampingCalls.every((call) => call.strength === 0.85)).toBe(true);
    for (const name of ["leftUpperArm", "leftLowerArm"] as const) {
      const rotation = result.bones[name]!.rotation!;
      expect(rotation).toEqual(clampStudioVrmJointRotation(name, rotation));
      expect(rotation.every(Number.isFinite)).toBe(true);
    }
    expect(result.limited).toBe(true);
    applyRotationOnlyPose(fixture, result.bones, result.yOffset);
    const actual = fixture.nodes.get("leftHand")!.getWorldPosition(new THREE.Vector3());
    vectorClose(actual, new THREE.Vector3(...result.effectiveTargetWorld), 10);
    expect(actual.distanceTo(target)).toBeGreaterThan(0.01);
  });

  it("neutral profile은 기존 IK 출력과 같고 선택 profile의 전용 damping을 사용한다", () => {
    const fixture = createRig();
    const request = {
      effector: "leftHand" as const,
      targetWorld: targetFor(fixture, "leftHand"),
      poleWorld: poleFor(fixture, "leftHand"),
    };
    const legacy = solveStudioVrmUserIk(fixture.source, request);
    const neutral = solveStudioVrmUserIk(fixture.source, {
      ...request,
      jointProfile: "neutral",
    });
    expect(neutral).toEqual(legacy);

    const calls: string[] = [];
    const profiled = solveStudioVrmUserIk(fixture.source, {
      ...request,
      jointProfile: "limited",
    }, {
      ...UNLIMITED_DEPENDENCIES,
      dampProfiledJointRotation(bone, rotation, profile) {
        calls.push(`${String(bone)}:${typeof profile === "string" ? profile : profile.id}`);
        return UNLIMITED_DEPENDENCIES.dampProfiledJointRotation!(bone, rotation, profile);
      },
    });
    expect(profiled).not.toBeNull();
    expect(calls).toEqual([
      "leftUpperArm:limited",
      "leftLowerArm:limited",
    ]);
  });

  it("발 고정은 contact solver의 골반 Y 분담 후 residual leg IK를 적용한다", () => {
    const fixture = createRig();
    let contactCalls = 0;
    const target = new THREE.Vector3(-0.5, 25, 0);
    const result = solveStudioVrmUserIk(fixture.source, {
      effector: "leftFoot",
      targetWorld: target,
      poleWorld: poleFor(fixture, "leftFoot"),
      jointProfile: "neutral",
      footPlant: true,
      fullBodyIk: true,
      floorHeight: -1.8,
    }, {
      ...UNLIMITED_DEPENDENCIES,
      solveFloorContact(input) {
        contactCalls += 1;
        return solveStudioVrmFloorContact(input);
      },
    });

    expect(contactCalls).toBe(1);
    expect(result).not.toBeNull();
    expect(result?.requestedTargetWorld).toEqual([-0.5, 25, 0]);
    expect(result?.floorContact?.floorHeight).toBe(-1.8);
    expect(result?.floorContact?.contactClamped).toBe(false);
    expect(result?.floorContact?.hipsTranslation[0]).toBe(0);
    expect(result?.floorContact?.hipsTranslation[1]).toBeCloseTo(0.1, 12);
    expect(result?.floorContact?.hipsTranslation[2]).toBe(0);
    expect(result?.floorContact?.residualLegIkTranslation[0]).toBeCloseTo(0.5, 12);
    expect(result?.floorContact?.residualLegIkTranslation[1]).toBeCloseTo(0.1, 12);
    expect(result?.floorContact?.residualLegIkTranslation[2]).toBe(0);
    expect(result?.yOffset).toBeCloseTo(0.1, 12);

    const output = createRig();
    applyRotationOnlyPose(output, result!.bones, result!.yOffset);
    const footWorld = output.nodes.get("leftFoot")!.getWorldPosition(new THREE.Vector3());
    expect(footWorld.x).toBeCloseTo(-0.5, 5);
    expect(footWorld.y).toBeCloseTo(-1.8, 5);
  });

  it("발 고정 off 경로는 contact solver를 호출하지 않고 기존 결과를 유지한다", () => {
    const fixture = createRig();
    const request = {
      effector: "rightFoot" as const,
      targetWorld: targetFor(fixture, "rightFoot"),
      poleWorld: poleFor(fixture, "rightFoot"),
    };
    const baseline = solveStudioVrmUserIk(fixture.source, request, UNLIMITED_DEPENDENCIES);
    let contactCalls = 0;
    const disabled = solveStudioVrmUserIk(fixture.source, {
      ...request,
      footPlant: false,
      fullBodyIk: true,
      floorHeight: -1.8,
    }, {
      ...UNLIMITED_DEPENDENCIES,
      solveFloorContact(input) {
        contactCalls += 1;
        return solveStudioVrmFloorContact(input);
      },
    });
    expect(contactCalls).toBe(0);
    expect(disabled).toEqual(baseline);
    expect(disabled).not.toHaveProperty("floorContact");
  });

  it("missing bone, 잘못된 계층, zero length, 비유한 입력을 fail-closed한다", () => {
    const missing = createRig();
    missing.nodes.delete("leftShoulder");
    expect(solveStudioVrmUserIk(missing.source, {
      effector: "leftHand",
      targetWorld: new THREE.Vector3(1, 1, 0),
    })).toBeNull();

    const wrongHierarchy = createRig();
    wrongHierarchy.scene.attach(wrongHierarchy.nodes.get("rightHand")!);
    wrongHierarchy.scene.updateMatrixWorld(true);
    expect(solveStudioVrmUserIk(wrongHierarchy.source, {
      effector: "rightHand",
      targetWorld: new THREE.Vector3(1, 1, 0),
    })).toBeNull();

    const zeroLength = createRig();
    zeroLength.nodes.get("leftLowerLeg")!.position.set(0, 0, 0);
    zeroLength.scene.updateMatrixWorld(true);
    expect(solveStudioVrmUserIk(zeroLength.source, {
      effector: "leftFoot",
      targetWorld: new THREE.Vector3(-1, -1, 0),
    })).toBeNull();

    const finite = createRig();
    expect(solveStudioVrmUserIk(finite.source, {
      effector: "leftFoot",
      targetWorld: new THREE.Vector3(Number.NaN, 0, 0),
    })).toBeNull();
    expect(solveStudioVrmUserIk(finite.source, {
      effector: "leftFoot",
      targetWorld: new THREE.Vector3(0, -1, 0),
      poleWorld: new THREE.Vector3(0, Number.POSITIVE_INFINITY, 0),
    })).toBeNull();
    expect(solveStudioVrmUserIk(finite.source, {
      effector: "leftFoot",
      targetWorld: new THREE.Vector3(0, -1, 0),
      softLimitStrength: Number.NaN,
    })).toBeNull();
    expect(solveStudioVrmUserIk(finite.source, {
      effector: "leftFoot",
      targetWorld: new THREE.Vector3(0, -1, 0),
      jointProfile: "neutral",
      softLimitStrength: 0.5,
    })).toBeNull();
    expect(solveStudioVrmUserIk(finite.source, {
      effector: "leftFoot",
      targetWorld: new THREE.Vector3(0, -1, 0),
      // Deliberately bypass the compile-time contract to exercise runtime rejection of an
      // untrusted persisted/network payload that makes a medical-purpose claim.
      jointProfile: { version: 1, purpose: "medical", id: "adult" } as unknown as
        StudioVrmUserIkRequest["jointProfile"],
    })).toBeNull();
    expect(solveStudioVrmUserIk(finite.source, {
      effector: "leftFoot",
      targetWorld: new THREE.Vector3(0, -1, 0),
      footPlant: true,
      floorHeight: Number.POSITIVE_INFINITY,
    })).toBeNull();

    finite.nodes.get("leftUpperLeg")!.quaternion.set(Number.NaN, 0, 0, 1);
    expect(solveStudioVrmUserIk(finite.source, {
      effector: "leftFoot",
      targetWorld: new THREE.Vector3(0, -1, 0),
    })).toBeNull();
  });
});
