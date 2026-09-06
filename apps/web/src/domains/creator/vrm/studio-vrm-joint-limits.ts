import type { VRMHumanBoneName } from "@pixiv/three-vrm";

const FULL_TURN_RADIANS = Math.PI * 2;
const SOFT_LIMIT_CURVE = 3;

export const STUDIO_VRM_DEFAULT_SOFT_LIMIT_STRENGTH = 0.6;

export type StudioVrmJointRotation = readonly [x: number, y: number, z: number];
export type StudioVrmJointAxis = "x" | "y" | "z";

/** All values are normalized-bone local Euler angles in radians. */
export interface StudioVrmJointAxisLimit {
  readonly hardMin: number;
  readonly softMin: number;
  readonly softMax: number;
  readonly hardMax: number;
}

export interface StudioVrmJointLimit {
  readonly x: StudioVrmJointAxisLimit;
  readonly y: StudioVrmJointAxisLimit;
  readonly z: StudioVrmJointAxisLimit;
}

type JointLimitTable = Readonly<Partial<Record<VRMHumanBoneName, StudioVrmJointLimit>>>;

function radians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function axis(
  hardMinDegrees: number,
  softMinDegrees: number,
  softMaxDegrees: number,
  hardMaxDegrees: number,
): StudioVrmJointAxisLimit {
  return Object.freeze({
    hardMin: radians(hardMinDegrees),
    softMin: radians(softMinDegrees),
    softMax: radians(softMaxDegrees),
    hardMax: radians(hardMaxDegrees),
  });
}

function joint(
  x: StudioVrmJointAxisLimit,
  y: StudioVrmJointAxisLimit,
  z: StudioVrmJointAxisLimit,
): StudioVrmJointLimit {
  return Object.freeze({ x, y, z });
}

function negateAxis(limit: StudioVrmJointAxisLimit): StudioVrmJointAxisLimit {
  return Object.freeze({
    hardMin: -limit.hardMax,
    softMin: -limit.softMax,
    softMax: -limit.softMin,
    hardMax: -limit.hardMin,
  });
}

/**
 * Mirrors a normalized-bone Euler limit across the character's YZ plane.
 * ToonSpectrum's pose mirror contract keeps X and negates Y/Z.
 */
export function mirrorStudioVrmJointLimit(limit: StudioVrmJointLimit): StudioVrmJointLimit {
  return joint(limit.x, negateAxis(limit.y), negateAxis(limit.z));
}

/**
 * Conservative fallback for extensions or future VRM bones unknown to this client.
 * It prevents unbounded rotations without assuming a joint-specific anatomy.
 */
export const STUDIO_VRM_FALLBACK_JOINT_LIMIT = joint(
  axis(-180, -135, 135, 180),
  axis(-180, -135, 135, 180),
  axis(-180, -135, 135, 180),
);

const CENTER_JOINT_LIMITS = {
  hips: joint(axis(-55, -40, 40, 55), axis(-75, -55, 55, 75), axis(-45, -32, 32, 45)),
  spine: joint(axis(-35, -25, 30, 42), axis(-45, -32, 32, 45), axis(-30, -22, 22, 30)),
  chest: joint(axis(-40, -28, 35, 48), axis(-55, -38, 38, 55), axis(-38, -26, 26, 38)),
  upperChest: joint(axis(-38, -27, 32, 45), axis(-50, -36, 36, 50), axis(-35, -25, 25, 35)),
  neck: joint(axis(-50, -35, 40, 55), axis(-75, -55, 55, 75), axis(-45, -32, 32, 45)),
  head: joint(axis(-45, -32, 38, 55), axis(-70, -50, 50, 70), axis(-40, -28, 28, 40)),
  jaw: joint(axis(-8, -3, 25, 40), axis(-8, -4, 4, 8), axis(-8, -4, 4, 8)),
} as const satisfies JointLimitTable;

// Left-side limits are the single source of truth. Right-side limits are mirrored below so
// elbow, wrist, ankle, finger, and shoulder asymmetry cannot silently drift between sides.
const LEFT_JOINT_LIMITS = {
  leftEye: joint(axis(-35, -25, 25, 35), axis(-35, -25, 25, 35), axis(-8, -3, 3, 8)),
  leftShoulder: joint(axis(-45, -30, 30, 45), axis(-50, -35, 35, 50), axis(-55, -38, 25, 38)),
  leftUpperArm: joint(axis(-135, -105, 105, 135), axis(-110, -85, 85, 110), axis(-175, -145, 80, 110)),
  leftLowerArm: joint(axis(-105, -80, 80, 105), axis(-25, -15, 15, 25), axis(-155, -135, 8, 15)),
  leftHand: joint(axis(-90, -65, 65, 90), axis(-55, -40, 40, 55), axis(-85, -65, 55, 75)),
  leftUpperLeg: joint(axis(-140, -110, 65, 85), axis(-70, -50, 50, 70), axis(-65, -45, 38, 55)),
  leftLowerLeg: joint(axis(-10, -3, 130, 155), axis(-25, -15, 15, 25), axis(-20, -12, 12, 20)),
  leftFoot: joint(axis(-55, -38, 50, 70), axis(-40, -28, 28, 40), axis(-35, -25, 20, 30)),
  leftToes: joint(axis(-45, -30, 45, 60), axis(-18, -10, 10, 18), axis(-15, -8, 8, 15)),

  leftThumbMetacarpal: joint(axis(-30, -20, 20, 30), axis(-60, -45, 20, 30), axis(-55, -42, 20, 30)),
  leftThumbProximal: joint(axis(-25, -15, 15, 25), axis(-55, -42, 15, 25), axis(-75, -58, 10, 18)),
  leftThumbDistal: joint(axis(-18, -10, 10, 18), axis(-30, -22, 10, 18), axis(-85, -68, 5, 12)),

  leftIndexProximal: joint(axis(-15, -8, 8, 15), axis(-18, -10, 10, 18), axis(-110, -90, 10, 18)),
  leftIndexIntermediate: joint(axis(-8, -4, 4, 8), axis(-8, -4, 4, 8), axis(-120, -100, 3, 8)),
  leftIndexDistal: joint(axis(-8, -4, 4, 8), axis(-8, -4, 4, 8), axis(-95, -78, 3, 8)),
  leftMiddleProximal: joint(axis(-15, -8, 8, 15), axis(-15, -8, 8, 15), axis(-115, -95, 8, 15)),
  leftMiddleIntermediate: joint(axis(-8, -4, 4, 8), axis(-8, -4, 4, 8), axis(-125, -105, 3, 8)),
  leftMiddleDistal: joint(axis(-8, -4, 4, 8), axis(-8, -4, 4, 8), axis(-100, -82, 3, 8)),
  leftRingProximal: joint(axis(-15, -8, 8, 15), axis(-18, -10, 10, 18), axis(-120, -100, 8, 15)),
  leftRingIntermediate: joint(axis(-8, -4, 4, 8), axis(-8, -4, 4, 8), axis(-130, -110, 3, 8)),
  leftRingDistal: joint(axis(-8, -4, 4, 8), axis(-8, -4, 4, 8), axis(-105, -86, 3, 8)),
  leftLittleProximal: joint(axis(-18, -10, 10, 18), axis(-25, -15, 15, 25), axis(-125, -105, 8, 15)),
  leftLittleIntermediate: joint(axis(-10, -5, 5, 10), axis(-10, -5, 5, 10), axis(-135, -115, 3, 8)),
  leftLittleDistal: joint(axis(-10, -5, 5, 10), axis(-10, -5, 5, 10), axis(-110, -90, 3, 8)),
} as const satisfies JointLimitTable;

function buildJointLimitTable(): JointLimitTable {
  const result: Partial<Record<VRMHumanBoneName, StudioVrmJointLimit>> = {
    ...CENTER_JOINT_LIMITS,
  };
  for (const [leftBoneName, limit] of Object.entries(LEFT_JOINT_LIMITS)) {
    const typedLeftBoneName = leftBoneName as VRMHumanBoneName;
    result[typedLeftBoneName] = limit;
    if (!leftBoneName.startsWith("left")) continue;
    const rightBoneName = `right${leftBoneName.slice("left".length)}` as VRMHumanBoneName;
    result[rightBoneName] = mirrorStudioVrmJointLimit(limit);
  }
  return Object.freeze(result);
}

/** Joint-specific limits keyed by the normalized VRM humanoid bone name. */
export const STUDIO_VRM_JOINT_LIMITS = buildJointLimitTable();

export function getStudioVrmJointLimit(boneName: unknown): StudioVrmJointLimit {
  if (typeof boneName !== "string") return STUDIO_VRM_FALLBACK_JOINT_LIMIT;
  if (!Object.hasOwn(STUDIO_VRM_JOINT_LIMITS, boneName)) {
    return STUDIO_VRM_FALLBACK_JOINT_LIMIT;
  }
  return STUDIO_VRM_JOINT_LIMITS[boneName as VRMHumanBoneName]
    ?? STUDIO_VRM_FALLBACK_JOINT_LIMIT;
}

/** Canonical half-open angle range used by authored pose data: [-PI, PI). */
export function canonicalizeStudioVrmJointAngle(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value >= -Math.PI && value < Math.PI) return Object.is(value, -0) ? 0 : value;
  const canonical = ((value + Math.PI) % FULL_TURN_RADIANS + FULL_TURN_RADIANS)
    % FULL_TURN_RADIANS - Math.PI;
  return Object.is(canonical, -0) ? 0 : canonical;
}

export function canonicalizeStudioVrmJointRotation(value: unknown): StudioVrmJointRotation {
  if (!Array.isArray(value)) return [0, 0, 0];
  return [
    canonicalizeStudioVrmJointAngle(value[0]),
    canonicalizeStudioVrmJointAngle(value[1]),
    canonicalizeStudioVrmJointAngle(value[2]),
  ];
}

function clampAxis(value: number, limit: StudioVrmJointAxisLimit): number {
  return Math.min(limit.hardMax, Math.max(limit.hardMin, value));
}

/** Hard safety boundary for slider, gizmo, and IK outputs. Never mutates the supplied rotation. */
export function clampStudioVrmJointRotation(
  boneName: unknown,
  rotation: unknown,
): StudioVrmJointRotation {
  const canonical = canonicalizeStudioVrmJointRotation(rotation);
  const limit = getStudioVrmJointLimit(boneName);
  return [
    clampAxis(canonical[0], limit.x),
    clampAxis(canonical[1], limit.y),
    clampAxis(canonical[2], limit.z),
  ];
}

function canonicalizeStrength(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return STUDIO_VRM_DEFAULT_SOFT_LIMIT_STRENGTH;
  }
  return Math.min(1, Math.max(0, value));
}

function softLimitProgress(value: number, limit: StudioVrmJointAxisLimit): number {
  if (value < limit.softMin) {
    return Math.min(1, (limit.softMin - value) / (limit.softMin - limit.hardMin));
  }
  if (value > limit.softMax) {
    return Math.min(1, (value - limit.softMax) / (limit.hardMax - limit.softMax));
  }
  return 0;
}

/**
 * Returns per-axis multipliers in [0, 1]. A multiplier is 1 inside the soft range and decreases
 * continuously as the hard boundary approaches. IK can apply these factors directly to deltas.
 */
export function getStudioVrmJointSoftLimitDamping(
  boneName: unknown,
  rotation: unknown,
  strength: unknown = STUDIO_VRM_DEFAULT_SOFT_LIMIT_STRENGTH,
): StudioVrmJointRotation {
  const hardClamped = clampStudioVrmJointRotation(boneName, rotation);
  const limit = getStudioVrmJointLimit(boneName);
  const curveStrength = canonicalizeStrength(strength) * SOFT_LIMIT_CURVE;
  const factor = (value: number, axisLimit: StudioVrmJointAxisLimit) => {
    const progress = softLimitProgress(value, axisLimit);
    if (progress === 0 || curveStrength === 0) return 1;
    const denominator = curveStrength * progress;
    return -Math.expm1(-denominator) / denominator;
  };
  return [
    factor(hardClamped[0], limit.x),
    factor(hardClamped[1], limit.y),
    factor(hardClamped[2], limit.z),
  ];
}

function dampAxis(
  value: number,
  limit: StudioVrmJointAxisLimit,
  damping: number,
): number {
  if (value < limit.softMin) {
    return limit.softMin + (value - limit.softMin) * damping;
  }
  if (value > limit.softMax) {
    return limit.softMax + (value - limit.softMax) * damping;
  }
  return value;
}

/**
 * Applies the progressive soft-limit curve after the hard safety clamp. `strength = 0` performs
 * only the hard clamp; `strength = 1` supplies the strongest resistance. The result stays finite.
 */
export function dampStudioVrmJointRotation(
  boneName: unknown,
  rotation: unknown,
  strength: unknown = STUDIO_VRM_DEFAULT_SOFT_LIMIT_STRENGTH,
): StudioVrmJointRotation {
  const hardClamped = clampStudioVrmJointRotation(boneName, rotation);
  const limit = getStudioVrmJointLimit(boneName);
  const damping = getStudioVrmJointSoftLimitDamping(boneName, hardClamped, strength);
  return [
    dampAxis(hardClamped[0], limit.x, damping[0]),
    dampAxis(hardClamped[1], limit.y, damping[1]),
    dampAxis(hardClamped[2], limit.z, damping[2]),
  ];
}
