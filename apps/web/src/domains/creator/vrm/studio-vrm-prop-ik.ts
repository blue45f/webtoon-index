import * as THREE from "three";

import { solveTwoBoneTarget } from "../studio-rig-two-bone-ik";

import type {
  TwoBoneLengths,
  TwoBoneTargetSolution,
} from "../studio-rig-two-bone-ik";
import type { Vec3 } from "./studio-vrm-props";
import type { VRM } from "@pixiv/three-vrm";

const VECTOR_EPSILON = 1e-8;
const ROTATION_MATCH_EPSILON = 1e-7;

export { solveTwoBoneTarget };
export type { TwoBoneLengths, TwoBoneTargetSolution };

export interface VrmTwoBoneGripOptions {
  /** 보조 손의 최종 world quaternion. 생략하면 현재 손 local rotation을 보존한다. */
  targetQuaternion?: THREE.Quaternion;
  /**
   * 부분 influence를 프레임마다 적용할 때 기준 포즈를 보존하는 재사용 상태.
   * 같은 제약의 수명 동안 하나를 유지하고, 비활성화·unmount 시 releaseVrmTwoBoneGripState를 호출한다.
   */
  state?: VrmTwoBoneGripState;
}

type GripLocalRotations = readonly [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion];

interface GripBoneBinding {
  upperArm: THREE.Object3D;
  lowerArm: THREE.Object3D;
  hand: THREE.Object3D;
}

interface VrmTwoBoneGripStateInternal {
  binding: GripBoneBinding | null;
  baseRotations: GripLocalRotations | null;
  appliedRotations: GripLocalRotations | null;
  /** restore 시 normalized→raw 동기화에 쓰는 휴머노이드. 첫 apply에서 스탬프된다. */
  humanoid: NonNullable<VRM["humanoid"]> | null;
}

declare const VRM_TWO_BONE_GRIP_STATE_BRAND: unique symbol;

/** createVrmTwoBoneGripState로만 생성하는 불투명한 프레임 지속 상태다. */
export interface VrmTwoBoneGripState {
  readonly [VRM_TWO_BONE_GRIP_STATE_BRAND]: true;
}

const gripStateInternals = new WeakMap<VrmTwoBoneGripState, VrmTwoBoneGripStateInternal>();

/** 부분 influence 제약 하나당 하나씩 생성해 프레임 사이에 재사용한다. */
export function createVrmTwoBoneGripState(): VrmTwoBoneGripState {
  const state = {} as VrmTwoBoneGripState;
  gripStateInternals.set(state, {
    binding: null,
    baseRotations: null,
    appliedRotations: null,
    humanoid: null,
  });
  return state;
}

function isFiniteVector(vector: THREE.Vector3 | null | undefined): vector is THREE.Vector3 {
  return Boolean(vector)
    && Number.isFinite(vector!.x)
    && Number.isFinite(vector!.y)
    && Number.isFinite(vector!.z);
}

function isFiniteQuaternion(quaternion: THREE.Quaternion | null | undefined): quaternion is THREE.Quaternion {
  return Boolean(quaternion)
    && Number.isFinite(quaternion!.x)
    && Number.isFinite(quaternion!.y)
    && Number.isFinite(quaternion!.z)
    && Number.isFinite(quaternion!.w)
    && quaternion!.lengthSq() > VECTOR_EPSILON;
}

function localQuaternionForWorld(node: THREE.Object3D, desiredWorld: THREE.Quaternion): THREE.Quaternion {
  const parentWorld = new THREE.Quaternion();
  node.parent?.getWorldQuaternion(parentWorld);
  return parentWorld.invert().multiply(desiredWorld).normalize();
}

function aimedLocalQuaternion(
  node: THREE.Object3D,
  currentStart: THREE.Vector3,
  currentEnd: THREE.Vector3,
  desiredEnd: THREE.Vector3
): THREE.Quaternion | null {
  const currentDirection = currentEnd.clone().sub(currentStart);
  const desiredDirection = desiredEnd.clone().sub(currentStart);
  if (currentDirection.lengthSq() <= VECTOR_EPSILON || desiredDirection.lengthSq() <= VECTOR_EPSILON) return null;
  currentDirection.normalize();
  desiredDirection.normalize();

  const currentWorld = node.getWorldQuaternion(new THREE.Quaternion());
  const deltaWorld = new THREE.Quaternion().setFromUnitVectors(currentDirection, desiredDirection);
  const desiredWorld = deltaWorld.multiply(currentWorld).normalize();
  return isFiniteQuaternion(desiredWorld) ? localQuaternionForWorld(node, desiredWorld) : null;
}

function vectorFromTuple(value: Vec3 | undefined): THREE.Vector3 | undefined {
  if (!value || value.length < 3) return undefined;
  const vector = new THREE.Vector3(value[0], value[1], value[2]);
  return isFiniteVector(vector) ? vector : undefined;
}

function restoreLocalRotations(
  upperArm: THREE.Object3D,
  lowerArm: THREE.Object3D,
  hand: THREE.Object3D,
  rotations: GripLocalRotations
) {
  upperArm.quaternion.copy(rotations[0]);
  lowerArm.quaternion.copy(rotations[1]);
  hand.quaternion.copy(rotations[2]);
}

function captureLocalRotations(binding: GripBoneBinding): GripLocalRotations {
  return [
    binding.upperArm.quaternion.clone(),
    binding.lowerArm.quaternion.clone(),
    binding.hand.quaternion.clone(),
  ];
}

function isSameRotation(left: THREE.Quaternion, right: THREE.Quaternion): boolean {
  if (!isFiniteQuaternion(left) || !isFiniteQuaternion(right)) return false;
  const normalizedDot = Math.abs(left.dot(right)) / Math.sqrt(left.lengthSq() * right.lengthSq());
  return normalizedDot >= 1 - ROTATION_MATCH_EPSILON;
}

function rotationsMatch(left: GripLocalRotations, right: GripLocalRotations): boolean {
  return left.every((rotation, index) => isSameRotation(rotation, right[index]));
}

function bindingMatches(left: GripBoneBinding | null, right: GripBoneBinding): boolean {
  return left?.upperArm === right.upperArm
    && left.lowerArm === right.lowerArm
    && left.hand === right.hand;
}

/**
 * 제약이 마지막으로 쓴 포즈가 그대로 남아 있을 때만 기준 포즈를 복원한다.
 * 그 사이 트래킹·키프레임 시스템이 포즈를 다시 썼다면 최신 외부 포즈를 덮어쓰지 않는다.
 * 반환값은 실제 기준 포즈를 복원했는지 여부다. 상태 객체는 이후 다시 사용할 수 있다.
 */
export function releaseVrmTwoBoneGripState(state: VrmTwoBoneGripState): boolean {
  const internal = gripStateInternals.get(state);
  if (!internal) return false;

  let restored = false;
  if (internal.binding && internal.baseRotations && internal.appliedRotations) {
    const current = captureLocalRotations(internal.binding);
    if (rotationsMatch(current, internal.appliedRotations)) {
      restoreLocalRotations(
        internal.binding.upperArm,
        internal.binding.lowerArm,
        internal.binding.hand,
        internal.baseRotations
      );
      // 복원은 normalized 본에만 쓰이므로 raw 스키튼에 즉시 동기화한다. 그렇지 않으면
      // 소품 해제 직후 손이 그립 포즈로 한 프레임(또는 커밋이 없는 경로에선 영구히) 남는다.
      if (typeof internal.humanoid?.update === "function") internal.humanoid.update();
      internal.binding.upperArm.updateWorldMatrix(true, true);
      restored = true;
    }
  }

  internal.binding = null;
  internal.baseRotations = null;
  internal.appliedRotations = null;
  return restored;
}

function stampGripHumanoid(
  state: VrmTwoBoneGripState,
  humanoid: NonNullable<VRM["humanoid"]> | null
) {
  const internal = gripStateInternals.get(state);
  if (internal) internal.humanoid = humanoid;
}

function resolveGripBaseRotations(
  state: VrmTwoBoneGripState,
  binding: GripBoneBinding,
  current: GripLocalRotations
): GripLocalRotations | null {
  const internal = gripStateInternals.get(state);
  if (!internal) return null;

  if (!bindingMatches(internal.binding, binding)) {
    releaseVrmTwoBoneGripState(state);
    internal.binding = binding;
  }

  // 현재 값이 직전 제약 출력과 같으면 프레임 사이에 보존한 authored base를 재사용한다.
  if (
    internal.baseRotations
    && internal.appliedRotations
    && rotationsMatch(current, internal.appliedRotations)
  ) {
    return internal.baseRotations;
  }

  // 트래킹/키프레임이 먼저 쓴 새 포즈는 다음 혼합의 새로운 authored base로 승격한다.
  internal.baseRotations = [
    current[0].clone(),
    current[1].clone(),
    current[2].clone(),
  ];
  internal.appliedRotations = null;
  return internal.baseRotations;
}

function recordGripOutput(
  state: VrmTwoBoneGripState | undefined,
  binding: GripBoneBinding
) {
  if (!state) return;
  const internal = gripStateInternals.get(state);
  if (!internal || !bindingMatches(internal.binding, binding)) return;
  internal.appliedRotations = captureLocalRotations(binding);
}

/**
 * 현재 normalized VRM 팔 포즈 위에 secondary grip 제약을 적용한다.
 * 반환값은 제약 적용 여부이며, 실패·influence 0에서는 기존 local quaternion을 보존한다.
 */
export function applyVrmTwoBoneGrip(
  vrm: VRM,
  side: "left" | "right",
  targetWorld: THREE.Vector3,
  influence: number,
  elbowHint?: Vec3,
  options: VrmTwoBoneGripOptions = {}
): boolean {
  if (!vrm?.humanoid || !vrm.scene || !isFiniteVector(targetWorld) || !Number.isFinite(influence)) return false;
  const weight = THREE.MathUtils.clamp(influence, 0, 1);
  if (weight <= 0) return false;

  const upperArm = vrm.humanoid.getNormalizedBoneNode(`${side}UpperArm`) as THREE.Object3D | null;
  const lowerArm = vrm.humanoid.getNormalizedBoneNode(`${side}LowerArm`) as THREE.Object3D | null;
  const hand = vrm.humanoid.getNormalizedBoneNode(`${side}Hand`) as THREE.Object3D | null;
  if (!upperArm || !lowerArm || !hand) return false;

  const binding = { upperArm, lowerArm, hand };
  if (options.state) stampGripHumanoid(options.state, vrm.humanoid);
  const original = captureLocalRotations(binding);
  const base = options.state
    ? resolveGripBaseRotations(options.state, binding, original) ?? original
    : original;

  restoreLocalRotations(upperArm, lowerArm, hand, base);

  vrm.scene.updateMatrixWorld(true);
  const start = upperArm.getWorldPosition(new THREE.Vector3());
  const currentElbow = lowerArm.getWorldPosition(new THREE.Vector3());
  const currentEnd = hand.getWorldPosition(new THREE.Vector3());
  // 직렬화된 elbowHint는 아바타/모델 로컬 점이며, 해석기는 world-space pole을 받는다.
  const pole = vectorFromTuple(elbowHint)?.applyMatrix4(vrm.scene.matrixWorld);
  const solution = solveTwoBoneTarget(start, currentElbow, currentEnd, targetWorld, pole);
  if (!solution) {
    restoreLocalRotations(upperArm, lowerArm, hand, original);
    vrm.scene.updateMatrixWorld(true);
    return false;
  }

  try {
    const fullUpper = aimedLocalQuaternion(upperArm, start, currentElbow, solution.elbow);
    if (!fullUpper || !isFiniteQuaternion(fullUpper)) {
      restoreLocalRotations(upperArm, lowerArm, hand, original);
      vrm.scene.updateMatrixWorld(true);
      return false;
    }
    upperArm.quaternion.copy(fullUpper);
    vrm.scene.updateMatrixWorld(true);

    const movedElbow = lowerArm.getWorldPosition(new THREE.Vector3());
    const movedEnd = hand.getWorldPosition(new THREE.Vector3());
    const fullLower = aimedLocalQuaternion(lowerArm, movedElbow, movedEnd, solution.end);
    if (!fullLower || !isFiniteQuaternion(fullLower)) {
      restoreLocalRotations(upperArm, lowerArm, hand, original);
      vrm.scene.updateMatrixWorld(true);
      return false;
    }
    lowerArm.quaternion.copy(fullLower);
    vrm.scene.updateMatrixWorld(true);

    let fullHand = base[2].clone();
    if (isFiniteQuaternion(options.targetQuaternion)) {
      fullHand = localQuaternionForWorld(hand, options.targetQuaternion.clone().normalize());
    }
    if (![fullUpper, fullLower, fullHand].every(isFiniteQuaternion)) {
      restoreLocalRotations(upperArm, lowerArm, hand, original);
      vrm.scene.updateMatrixWorld(true);
      return false;
    }

    // full 해를 구하기 위해 임시 변형한 뒤 authored base에서 weight만큼 한 번만 혼합한다.
    restoreLocalRotations(upperArm, lowerArm, hand, base);
    upperArm.quaternion.slerp(fullUpper, weight).normalize();
    lowerArm.quaternion.slerp(fullLower, weight).normalize();
    if (isFiniteQuaternion(options.targetQuaternion)) hand.quaternion.slerp(fullHand, weight).normalize();
    vrm.scene.updateMatrixWorld(true);
    recordGripOutput(options.state, binding);
    return true;
  } catch {
    restoreLocalRotations(upperArm, lowerArm, hand, original);
    vrm.scene.updateMatrixWorld(true);
    return false;
  }
}
