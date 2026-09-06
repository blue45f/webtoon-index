import type {
  FingerRotationMap,
  PoseBone,
  PoseBoneMap,
  Vec3,
} from "./studio-vrm-poser-utils";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";

export type StudioVrmPoseMirrorScope = "all" | "arms" | "legs" | "torso";

export type StudioVrmJointAxisRange = {
  readonly minDegrees: number;
  readonly maxDegrees: number;
};

export type StudioVrmJointLimit = readonly [
  StudioVrmJointAxisRange,
  StudioVrmJointAxisRange,
  StudioVrmJointAxisRange,
];

export type StudioVrmJointLimitProfile = {
  readonly id: string;
  readonly label: string;
  readonly version: 1;
  readonly limits: Readonly<Partial<Record<VRMHumanBoneName, StudioVrmJointLimit>>>;
};

const FULL_AXIS_RANGE: StudioVrmJointAxisRange = Object.freeze({
  minDegrees: -180,
  maxDegrees: 180,
});

function axis(minDegrees: number, maxDegrees: number): StudioVrmJointAxisRange {
  return Object.freeze({ minDegrees, maxDegrees });
}

function joint(
  x: readonly [number, number],
  y: readonly [number, number],
  z: readonly [number, number],
): StudioVrmJointLimit {
  return Object.freeze([axis(x[0], x[1]), axis(y[0], y[1]), axis(z[0], z[1])]);
}

const TORSO_LIMITS = {
  hips: joint([-45, 45], [-75, 75], [-40, 40]),
  spine: joint([-35, 35], [-45, 45], [-35, 35]),
  chest: joint([-40, 40], [-55, 55], [-40, 40]),
  upperChest: joint([-35, 35], [-50, 50], [-35, 35]),
  neck: joint([-40, 45], [-60, 60], [-40, 40]),
  head: joint([-55, 55], [-85, 85], [-50, 50]),
} satisfies Partial<Record<VRMHumanBoneName, StudioVrmJointLimit>>;

const LIMB_LIMITS = {
  leftShoulder: joint([-45, 45], [-55, 55], [-55, 55]),
  rightShoulder: joint([-45, 45], [-55, 55], [-55, 55]),
  leftUpperArm: joint([-150, 150], [-150, 150], [-170, 170]),
  rightUpperArm: joint([-150, 150], [-150, 150], [-170, 170]),
  leftLowerArm: joint([-155, 155], [-120, 120], [-30, 30]),
  rightLowerArm: joint([-155, 155], [-120, 120], [-30, 30]),
  leftHand: joint([-80, 80], [-65, 65], [-85, 85]),
  rightHand: joint([-80, 80], [-65, 65], [-85, 85]),
  leftUpperLeg: joint([-135, 135], [-70, 70], [-85, 85]),
  rightUpperLeg: joint([-135, 135], [-70, 70], [-85, 85]),
  leftLowerLeg: joint([-155, 155], [-25, 25], [-25, 25]),
  rightLowerLeg: joint([-155, 155], [-25, 25], [-25, 25]),
  leftFoot: joint([-65, 65], [-45, 45], [-50, 50]),
  rightFoot: joint([-65, 65], [-45, 45], [-50, 50]),
  leftToes: joint([-55, 55], [-20, 20], [-20, 20]),
  rightToes: joint([-55, 55], [-20, 20], [-20, 20]),
} satisfies Partial<Record<VRMHumanBoneName, StudioVrmJointLimit>>;

/**
 * A deliberately conservative editing guard, not a medical/anatomical promise. VRM normalized
 * bones are still allowed to opt out per edit, because stylized characters and unusual rest poses
 * can legitimately require a wider range.
 */
export const STUDIO_VRM_REFERENCE_JOINT_LIMIT_PROFILE: StudioVrmJointLimitProfile = Object.freeze({
  id: "vrm-reference-safe-v1",
  label: "관절 안전 범위",
  version: 1,
  limits: Object.freeze({ ...TORSO_LIMITS, ...LIMB_LIMITS }),
});

const TORSO_BONES = new Set<VRMHumanBoneName>([
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "jaw",
]);

function isArmBone(boneName: VRMHumanBoneName): boolean {
  return (
    boneName.startsWith("leftShoulder") ||
    boneName.startsWith("rightShoulder") ||
    boneName.startsWith("leftUpperArm") ||
    boneName.startsWith("rightUpperArm") ||
    boneName.startsWith("leftLowerArm") ||
    boneName.startsWith("rightLowerArm") ||
    boneName.startsWith("leftHand") ||
    boneName.startsWith("rightHand") ||
    boneName.startsWith("leftThumb") ||
    boneName.startsWith("rightThumb") ||
    boneName.startsWith("leftIndex") ||
    boneName.startsWith("rightIndex") ||
    boneName.startsWith("leftMiddle") ||
    boneName.startsWith("rightMiddle") ||
    boneName.startsWith("leftRing") ||
    boneName.startsWith("rightRing") ||
    boneName.startsWith("leftLittle") ||
    boneName.startsWith("rightLittle")
  );
}

function isLegBone(boneName: VRMHumanBoneName): boolean {
  return (
    boneName.startsWith("leftUpperLeg") ||
    boneName.startsWith("rightUpperLeg") ||
    boneName.startsWith("leftLowerLeg") ||
    boneName.startsWith("rightLowerLeg") ||
    boneName.startsWith("leftFoot") ||
    boneName.startsWith("rightFoot") ||
    boneName.startsWith("leftToes") ||
    boneName.startsWith("rightToes")
  );
}

export function isStudioVrmBoneInMirrorScope(
  boneName: VRMHumanBoneName,
  scope: StudioVrmPoseMirrorScope,
): boolean {
  if (scope === "all") return true;
  if (scope === "arms") return isArmBone(boneName);
  if (scope === "legs") return isLegBone(boneName);
  return TORSO_BONES.has(boneName);
}

export function studioVrmMirroredBoneName(boneName: VRMHumanBoneName): VRMHumanBoneName {
  if (boneName.startsWith("left")) {
    return (`right${boneName.slice(4)}`) as VRMHumanBoneName;
  }
  if (boneName.startsWith("right")) {
    return (`left${boneName.slice(5)}`) as VRMHumanBoneName;
  }
  return boneName;
}

function finiteRotation(value: unknown): Vec3 {
  if (!Array.isArray(value) || value.length < 3) return [0, 0, 0];
  return [0, 1, 2].map((index) => {
    const candidate = value[index];
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
  }) as unknown as Vec3;
}

function isStudioVrmVec3Direction(value: PoseBone["direction"]): value is Vec3 {
  return Array.isArray(value);
}

export function mirrorStudioVrmRotation(rotation: unknown): Vec3 {
  const [x, y, z] = finiteRotation(rotation);
  return [x, -y, -z];
}

export function mirrorStudioVrmPoseBone(bone: PoseBone): PoseBone {
  if (bone.direction) {
    if (isStudioVrmVec3Direction(bone.direction)) {
      const [x, y, z] = finiteRotation(bone.direction);
      return { direction: [-x, y, z] };
    }
    return {
      direction: {
        sideX: Number.isFinite(bone.direction.sideX) ? bone.direction.sideX : 0,
        y: Number.isFinite(bone.direction.y) ? bone.direction.y : 0,
        ...(Number.isFinite(bone.direction.z) ? { z: bone.direction.z } : {}),
      },
    };
  }
  return { rotation: mirrorStudioVrmRotation(bone.rotation) };
}

/**
 * Mirrors only the requested semantic region. Target keys are cleared first so swapping a missing
 * side produces the normalized rest pose on the opposite side instead of leaking stale edits.
 */
export function mirrorStudioVrmPoseBones(
  bones: PoseBoneMap,
  scope: StudioVrmPoseMirrorScope,
): PoseBoneMap {
  const next: PoseBoneMap = { ...bones };
  const entries = Object.entries(bones) as Array<[VRMHumanBoneName, PoseBone | undefined]>;

  for (const [boneName] of entries) {
    if (isStudioVrmBoneInMirrorScope(boneName, scope)) delete next[boneName];
  }
  for (const [boneName, bone] of entries) {
    if (!bone || !isStudioVrmBoneInMirrorScope(boneName, scope)) continue;
    next[studioVrmMirroredBoneName(boneName)] = mirrorStudioVrmPoseBone(bone);
  }
  return next;
}

export function mirrorStudioVrmFingerRotations(
  fingers: FingerRotationMap,
  scope: StudioVrmPoseMirrorScope,
): FingerRotationMap {
  if (scope === "legs" || scope === "torso") return { ...fingers };
  const next: FingerRotationMap = { ...fingers };
  const entries = Object.entries(fingers) as Array<[VRMHumanBoneName, Vec3 | undefined]>;
  for (const [boneName] of entries) delete next[boneName];
  for (const [boneName, rotation] of entries) {
    if (!rotation) continue;
    next[studioVrmMirroredBoneName(boneName)] = mirrorStudioVrmRotation(rotation);
  }
  return next;
}

export function straightenStudioVrmUpperBody(bones: PoseBoneMap): PoseBoneMap {
  const next: PoseBoneMap = { ...bones };
  for (const boneName of ["spine", "chest", "upperChest", "neck", "head"] as const) {
    if (Object.hasOwn(next, boneName)) next[boneName] = { rotation: [0, 0, 0] };
  }
  return next;
}

export function resolveStudioVrmJointAxisRange(
  boneName: VRMHumanBoneName,
  axisIndex: number,
  profile: StudioVrmJointLimitProfile = STUDIO_VRM_REFERENCE_JOINT_LIMIT_PROFILE,
): StudioVrmJointAxisRange {
  if (!Number.isInteger(axisIndex) || axisIndex < 0 || axisIndex > 2) return FULL_AXIS_RANGE;
  return profile.limits[boneName]?.[axisIndex] ?? FULL_AXIS_RANGE;
}

export function clampStudioVrmJointDegrees(
  boneName: VRMHumanBoneName,
  axisIndex: number,
  degrees: unknown,
  profile: StudioVrmJointLimitProfile = STUDIO_VRM_REFERENCE_JOINT_LIMIT_PROFILE,
): number {
  const finiteDegrees = typeof degrees === "number" && Number.isFinite(degrees) ? degrees : 0;
  const range = resolveStudioVrmJointAxisRange(boneName, axisIndex, profile);
  return Math.min(range.maxDegrees, Math.max(range.minDegrees, finiteDegrees));
}
