import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  applyVrmTwoBoneGrip,
  createVrmTwoBoneGripState,
  releaseVrmTwoBoneGripState,
  solveTwoBoneTarget,
} from "./studio-vrm-prop-ik";

import type { VRM } from "@pixiv/three-vrm";

function expectVectorClose(actual: THREE.Vector3, expected: THREE.Vector3, precision = 5) {
  expect(actual.x).toBeCloseTo(expected.x, precision);
  expect(actual.y).toBeCloseTo(expected.y, precision);
  expect(actual.z).toBeCloseTo(expected.z, precision);
}

function expectFiniteQuaternion(quaternion: THREE.Quaternion) {
  expect([quaternion.x, quaternion.y, quaternion.z, quaternion.w].every(Number.isFinite)).toBe(true);
  expect(quaternion.length()).toBeCloseTo(1, 5);
}

function expectRotationClose(actual: THREE.Quaternion, expected: THREE.Quaternion, precision = 7) {
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, precision);
}

describe("solveTwoBoneTarget", () => {
  it("도달 가능한 목표를 정확히 풀고 입력 Vector3를 변경하지 않는다", () => {
    const start = new THREE.Vector3(0, 0, 0);
    const elbow = new THREE.Vector3(1, 0, 0);
    const end = new THREE.Vector3(1, 1, 0);
    const target = new THREE.Vector3(1, 1, 0);
    const snapshots = [start, elbow, end, target].map((value) => value.clone());

    const result = solveTwoBoneTarget(start, elbow, end, target)!;

    expect(result.reachable).toBe(true);
    expect(result.clamped).toBe(false);
    expectVectorClose(result.end, target);
    expect(result.start.distanceTo(result.elbow)).toBeCloseTo(1, 6);
    expect(result.elbow.distanceTo(result.end)).toBeCloseTo(1, 6);
    [start, elbow, end, target].forEach((value, index) => expectVectorClose(value, snapshots[index]));
  });

  it("너무 먼 목표를 최대 도달 거리로 clamp하고 관절 길이를 보존한다", () => {
    const result = solveTwoBoneTarget(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(10, 0, 0)
    )!;

    expect(result.reachable).toBe(false);
    expect(result.clamped).toBe(true);
    expect(result.solvedDistance).toBeLessThan(2);
    expect(result.solvedDistance).toBeGreaterThan(1.99);
    expect(result.start.distanceTo(result.elbow)).toBeCloseTo(1, 6);
    expect(result.elbow.distanceTo(result.end)).toBeCloseTo(1, 6);
    expect(result.end.x).toBeCloseTo(result.solvedDistance, 6);
  });

  it("길이가 다른 팔의 너무 가까운 목표를 최소 도달 거리로 clamp한다", () => {
    const result = solveTwoBoneTarget(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(0, 0, 0),
      undefined,
      [2, 1]
    )!;

    expect(result.reachable).toBe(false);
    expect(result.clamped).toBe(true);
    expect(result.solvedDistance).toBeGreaterThan(1);
    expect(result.start.distanceTo(result.elbow)).toBeCloseTo(2, 6);
    expect(result.elbow.distanceTo(result.end)).toBeCloseTo(1, 6);
  });

  it("pole point가 지정한 쪽으로 팔꿈치를 안정적으로 굽힌다", () => {
    const result = solveTwoBoneTarget(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1)
    )!;

    expect(result.elbow.z).toBeGreaterThan(0);
    expect(result.poleDirection.z).toBeCloseTo(1, 6);
  });

  it("pole과 현재 팔이 목표축에 겹쳐도 결정적인 fallback을 반복 반환한다", () => {
    const args = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1.2, 0, 0),
      new THREE.Vector3(5, 0, 0),
    ] as const;
    const first = solveTwoBoneTarget(...args)!;
    const second = solveTwoBoneTarget(...args)!;

    expectVectorClose(first.elbow, second.elbow, 8);
    expect(first.poleDirection.length()).toBeCloseTo(1, 8);
    expect(Math.abs(first.poleDirection.dot(new THREE.Vector3(1, 0, 0)))).toBeCloseTo(0, 8);
  });

  it("명시한 관절 길이를 사용한다", () => {
    const result = solveTwoBoneTarget(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(2, 1, 0),
      new THREE.Vector3(0, 0, 1),
      [2, 1]
    )!;

    expect(result.lengths).toEqual([2, 1]);
    expect(result.start.distanceTo(result.elbow)).toBeCloseTo(2, 6);
    expect(result.elbow.distanceTo(result.end)).toBeCloseTo(1, 6);
  });

  it("NaN, zero-length, 손상된 명시 길이는 null로 안전하게 거부한다", () => {
    const zero = new THREE.Vector3(0, 0, 0);
    expect(solveTwoBoneTarget(zero, zero, zero, new THREE.Vector3(1, 0, 0))).toBeNull();
    expect(solveTwoBoneTarget(
      zero,
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(Number.NaN, 0, 0)
    )).toBeNull();
    expect(solveTwoBoneTarget(
      zero,
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(2, 0, 0),
      new THREE.Vector3(1, 1, 0),
      undefined,
      [0, 1]
    )).toBeNull();
  });
});

type ArmFixture = {
  vrm: VRM;
  scene: THREE.Group;
  upperArm: THREE.Bone;
  lowerArm: THREE.Bone;
  hand: THREE.Bone;
  nodes: Map<string, THREE.Object3D>;
};

function createArmFixture(side: "left" | "right" = "left", lowerOffset = 1, handOffset = 1): ArmFixture {
  const scene = new THREE.Group();
  const upperArm = new THREE.Bone();
  const lowerArm = new THREE.Bone();
  const hand = new THREE.Bone();
  lowerArm.position.set(lowerOffset, 0, 0);
  hand.position.set(handOffset, 0, 0);
  upperArm.add(lowerArm);
  lowerArm.add(hand);
  scene.add(upperArm);
  scene.updateMatrixWorld(true);

  const nodes = new Map<string, THREE.Object3D>([
    [`${side}UpperArm`, upperArm],
    [`${side}LowerArm`, lowerArm],
    [`${side}Hand`, hand],
  ]);
  const vrm = {
    scene,
    humanoid: {
      getNormalizedBoneNode(name: string) {
        return nodes.get(name) ?? null;
      },
    },
  } as unknown as VRM;
  return { vrm, scene, upperArm, lowerArm, hand, nodes };
}

describe("applyVrmTwoBoneGrip", () => {
  it("normalized upper/lower arm을 회전해 손을 world 목표에 맞춘다", () => {
    const fixture = createArmFixture();
    const target = new THREE.Vector3(1, 1, 0);

    expect(applyVrmTwoBoneGrip(fixture.vrm, "left", target, 1)).toBe(true);
    fixture.scene.updateMatrixWorld(true);
    expectVectorClose(fixture.hand.getWorldPosition(new THREE.Vector3()), target, 5);
    expectFiniteQuaternion(fixture.upperArm.quaternion);
    expectFiniteQuaternion(fixture.lowerArm.quaternion);
  });

  it("모델 로컬 elbowHint를 이동·회전된 VRM의 world pole로 변환한다", () => {
    const fixture = createArmFixture();
    fixture.scene.position.set(8, -3, 5);
    fixture.scene.rotation.set(0.35, -0.7, 0.45);
    fixture.scene.updateMatrixWorld(true);

    const target = new THREE.Vector3(1, 1, 0).applyMatrix4(fixture.scene.matrixWorld);
    const elbowHint = [0, 0, 1] as const;
    const poleWorld = new THREE.Vector3(...elbowHint).applyMatrix4(fixture.scene.matrixWorld);
    const expected = solveTwoBoneTarget(
      fixture.upperArm.getWorldPosition(new THREE.Vector3()),
      fixture.lowerArm.getWorldPosition(new THREE.Vector3()),
      fixture.hand.getWorldPosition(new THREE.Vector3()),
      target,
      poleWorld
    )!;

    expect(applyVrmTwoBoneGrip(fixture.vrm, "left", target, 1, elbowHint)).toBe(true);
    fixture.scene.updateMatrixWorld(true);

    expectVectorClose(fixture.lowerArm.getWorldPosition(new THREE.Vector3()), expected.elbow, 5);
    expectVectorClose(fixture.hand.getWorldPosition(new THREE.Vector3()), target, 5);
  });

  it("targetQuaternion 옵션으로 손의 world 방향까지 정렬한다", () => {
    const fixture = createArmFixture();
    const targetQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0.7));

    expect(applyVrmTwoBoneGrip(
      fixture.vrm,
      "left",
      new THREE.Vector3(1, 1, 0),
      1,
      undefined,
      { targetQuaternion }
    )).toBe(true);
    fixture.scene.updateMatrixWorld(true);
    const actualWorld = fixture.hand.getWorldQuaternion(new THREE.Quaternion());
    expect(Math.abs(actualWorld.dot(targetQuaternion))).toBeCloseTo(1, 5);
  });

  it("재사용 state로 부분 influence를 반복해도 첫 25% 혼합을 누적하지 않는다", () => {
    const fixture = createArmFixture();
    const target = new THREE.Vector3(0.8, 1.25, 0.2);
    const state = createVrmTwoBoneGripState();

    expect(applyVrmTwoBoneGrip(
      fixture.vrm,
      "left",
      target,
      0.25,
      [0, 0, 1],
      { state }
    )).toBe(true);
    fixture.scene.updateMatrixWorld(true);
    const firstRotations = [
      fixture.upperArm.quaternion.clone(),
      fixture.lowerArm.quaternion.clone(),
      fixture.hand.quaternion.clone(),
    ];
    const firstHandWorld = fixture.hand.getWorldPosition(new THREE.Vector3());

    for (let index = 0; index < 40; index += 1) {
      expect(applyVrmTwoBoneGrip(
        fixture.vrm,
        "left",
        target,
        0.25,
        [0, 0, 1],
        { state }
      )).toBe(true);
      expectFiniteQuaternion(fixture.upperArm.quaternion);
      expectFiniteQuaternion(fixture.lowerArm.quaternion);
    }

    fixture.scene.updateMatrixWorld(true);
    const handWorld = fixture.hand.getWorldPosition(new THREE.Vector3());
    expectVectorClose(handWorld, firstHandWorld, 7);
    expectRotationClose(fixture.upperArm.quaternion, firstRotations[0]);
    expectRotationClose(fixture.lowerArm.quaternion, firstRotations[1]);
    expectRotationClose(fixture.hand.quaternion, firstRotations[2]);
    expect(handWorld.distanceTo(target)).toBeGreaterThan(0.1);
  });

  it("트래킹이 다시 쓴 authored pose를 새 기준으로 감지한다", () => {
    const fixture = createArmFixture();
    const reference = createArmFixture();
    const target = new THREE.Vector3(0.7, 1.15, 0.3);
    const state = createVrmTwoBoneGripState();

    expect(applyVrmTwoBoneGrip(
      fixture.vrm,
      "left",
      target,
      0.25,
      [0, 0, 1],
      { state }
    )).toBe(true);

    const authoredRotations = [
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.2, 0.25)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, 0.05, -0.2)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, 0.12, -0.04)),
    ] as const;
    [fixture, reference].forEach((arm) => {
      arm.upperArm.quaternion.copy(authoredRotations[0]);
      arm.lowerArm.quaternion.copy(authoredRotations[1]);
      arm.hand.quaternion.copy(authoredRotations[2]);
      arm.scene.updateMatrixWorld(true);
    });

    expect(applyVrmTwoBoneGrip(
      fixture.vrm,
      "left",
      target,
      0.25,
      [0, 0, 1],
      { state }
    )).toBe(true);
    expect(applyVrmTwoBoneGrip(
      reference.vrm,
      "left",
      target,
      0.25,
      [0, 0, 1],
      { state: createVrmTwoBoneGripState() }
    )).toBe(true);

    expectRotationClose(fixture.upperArm.quaternion, reference.upperArm.quaternion);
    expectRotationClose(fixture.lowerArm.quaternion, reference.lowerArm.quaternion);
    expectRotationClose(fixture.hand.quaternion, reference.hand.quaternion);
  });

  it("release는 authored base를 복원하고 이후 외부 포즈는 덮어쓰지 않는다", () => {
    const fixture = createArmFixture();
    const state = createVrmTwoBoneGripState();
    fixture.upperArm.rotation.set(0.1, 0.2, 0.3);
    fixture.lowerArm.rotation.set(-0.2, 0.1, 0.15);
    fixture.hand.rotation.set(0.05, -0.08, 0.12);
    fixture.scene.updateMatrixWorld(true);
    const authored = [
      fixture.upperArm.quaternion.clone(),
      fixture.lowerArm.quaternion.clone(),
      fixture.hand.quaternion.clone(),
    ];

    expect(applyVrmTwoBoneGrip(
      fixture.vrm,
      "left",
      new THREE.Vector3(0.9, 1.1, 0.2),
      0.25,
      [0, 0, 1],
      { state }
    )).toBe(true);
    expect(releaseVrmTwoBoneGripState(state)).toBe(true);
    expectRotationClose(fixture.upperArm.quaternion, authored[0]);
    expectRotationClose(fixture.lowerArm.quaternion, authored[1]);
    expectRotationClose(fixture.hand.quaternion, authored[2]);

    expect(applyVrmTwoBoneGrip(
      fixture.vrm,
      "left",
      new THREE.Vector3(0.9, 1.1, 0.2),
      0.25,
      [0, 0, 1],
      { state }
    )).toBe(true);
    const external = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.2, 0.1));
    fixture.upperArm.quaternion.copy(external);
    fixture.scene.updateMatrixWorld(true);

    expect(releaseVrmTwoBoneGripState(state)).toBe(false);
    expectRotationClose(fixture.upperArm.quaternion, external);
  });

  it("influence 0은 quaternion과 matrix를 변경하지 않는다", () => {
    const fixture = createArmFixture();
    fixture.upperArm.rotation.set(0.1, 0.2, 0.3);
    fixture.lowerArm.rotation.set(-0.2, 0.1, 0.15);
    fixture.scene.updateMatrixWorld(true);
    const before = [fixture.upperArm.quaternion.clone(), fixture.lowerArm.quaternion.clone(), fixture.hand.quaternion.clone()];

    expect(applyVrmTwoBoneGrip(fixture.vrm, "left", new THREE.Vector3(1, 1, 0), 0)).toBe(false);
    expect(fixture.upperArm.quaternion.equals(before[0])).toBe(true);
    expect(fixture.lowerArm.quaternion.equals(before[1])).toBe(true);
    expect(fixture.hand.quaternion.equals(before[2])).toBe(true);
  });

  it("missing bone, zero-length hierarchy, NaN target을 안전하게 거부한다", () => {
    const missing = createArmFixture();
    missing.nodes.delete("leftLowerArm");
    expect(applyVrmTwoBoneGrip(missing.vrm, "left", new THREE.Vector3(1, 1, 0), 1)).toBe(false);

    const zeroLength = createArmFixture("left", 0, 0);
    expect(applyVrmTwoBoneGrip(zeroLength.vrm, "left", new THREE.Vector3(1, 1, 0), 1)).toBe(false);

    const invalid = createArmFixture();
    const before = invalid.upperArm.quaternion.clone();
    expect(applyVrmTwoBoneGrip(
      invalid.vrm,
      "left",
      new THREE.Vector3(Number.NaN, 0, 0),
      1
    )).toBe(false);
    expect(invalid.upperArm.quaternion.equals(before)).toBe(true);
  });
});
