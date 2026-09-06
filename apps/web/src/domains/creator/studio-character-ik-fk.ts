/**
 * CHR-003 IK/FK body posing — pure numeric solvers (no Three.js runtime required).
 * Two-bone analytic IK for limbs + FK joint rotations; switchable per-chain mode.
 */

export const STUDIO_CHARACTER_IK_FK_REVISION = 1 as const;

export type StudioIkFkVec3 = readonly [number, number, number];

export type StudioBodyChainId =
  | "leftArm"
  | "rightArm"
  | "leftLeg"
  | "rightLeg"
  | "spine";

export type StudioChainSolveMode = "ik" | "fk";

export interface StudioBoneTransform {
  readonly name: string;
  readonly position: StudioIkFkVec3;
  /** Euler XYZ radians */
  readonly rotation: StudioIkFkVec3;
}

export interface StudioTwoBoneIkRequest {
  readonly start: StudioIkFkVec3;
  readonly upperLength: number;
  readonly lowerLength: number;
  readonly target: StudioIkFkVec3;
  /** Preferred bend direction hint (world). */
  readonly pole?: StudioIkFkVec3;
}

export interface StudioTwoBoneIkResult {
  readonly start: StudioIkFkVec3;
  readonly mid: StudioIkFkVec3;
  readonly end: StudioIkFkVec3;
  readonly effectiveTarget: StudioIkFkVec3;
  readonly reachable: boolean;
  readonly clamped: boolean;
  readonly inputDistance: number;
  readonly solvedDistance: number;
}

export interface StudioFkJointRequest {
  readonly bone: string;
  /** Local euler XYZ radians applied in FK mode. */
  readonly rotation: StudioIkFkVec3;
}

export interface StudioBodyPoseState {
  readonly revision: typeof STUDIO_CHARACTER_IK_FK_REVISION;
  readonly modes: Readonly<Record<StudioBodyChainId, StudioChainSolveMode>>;
  readonly bones: Readonly<Record<string, StudioBoneTransform>>;
  readonly chainRest: Readonly<
    Record<
      StudioBodyChainId,
      {
        readonly upper: string;
        readonly lower: string;
        readonly end: string;
        readonly upperLength: number;
        readonly lowerLength: number;
      }
    >
  >;
}

function add(a: StudioIkFkVec3, b: StudioIkFkVec3): StudioIkFkVec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: StudioIkFkVec3, b: StudioIkFkVec3): StudioIkFkVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: StudioIkFkVec3, s: number): StudioIkFkVec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot(a: StudioIkFkVec3, b: StudioIkFkVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: StudioIkFkVec3, b: StudioIkFkVec3): StudioIkFkVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function len(a: StudioIkFkVec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: StudioIkFkVec3): StudioIkFkVec3 | null {
  const l = len(a);
  if (l <= 1e-12) return null;
  return scale(a, 1 / l);
}

function perpendicular(axis: StudioIkFkVec3): StudioIkFkVec3 {
  const abs = [Math.abs(axis[0]), Math.abs(axis[1]), Math.abs(axis[2])] as const;
  const seed: StudioIkFkVec3 =
    abs[0] <= abs[1] && abs[0] <= abs[2]
      ? [1, 0, 0]
      : abs[1] <= abs[2]
        ? [0, 1, 0]
        : [0, 0, 1];
  const c = cross(axis, seed);
  return normalize(c) ?? [0, 1, 0];
}

/**
 * Analytic two-bone IK (law of cosines) with pole plane.
 * Pure math — same class of solver used by production arm/leg manipulators.
 */
export function solveStudioTwoBoneIk(
  request: StudioTwoBoneIkRequest,
): StudioTwoBoneIkResult {
  const upper = Math.max(1e-6, request.upperLength);
  const lower = Math.max(1e-6, request.lowerLength);
  const maxReach = upper + lower;
  const minReach = Math.abs(upper - lower);
  const toTarget = sub(request.target, request.start);
  const inputDistance = len(toTarget);
  let dir = normalize(toTarget);
  if (!dir) dir = [0, 0, 1];

  let clamped = false;
  let reachable = true;
  let solvedDistance = inputDistance;
  if (inputDistance >= maxReach) {
    solvedDistance = maxReach - 1e-6;
    clamped = true;
    reachable = false;
  } else if (inputDistance <= minReach) {
    solvedDistance = minReach + 1e-6;
    clamped = true;
    reachable = false;
  }

  const effectiveTarget = add(request.start, scale(dir, solvedDistance));
  // Law of cosines: mid distance from start along dir, and height off-axis
  const d = solvedDistance;
  let cosUpper = (upper * upper + d * d - lower * lower) / (2 * upper * d);
  cosUpper = Math.max(-1, Math.min(1, cosUpper));
  const midAlong = upper * cosUpper;
  const midHeight = Math.sqrt(Math.max(0, upper * upper - midAlong * midAlong));

  let poleDir: StudioIkFkVec3;
  if (request.pole) {
    const toPole = sub(request.pole, request.start);
    const projected = sub(toPole, scale(dir, dot(toPole, dir)));
    poleDir = normalize(projected) ?? perpendicular(dir);
  } else {
    poleDir = perpendicular(dir);
  }

  const mid = add(
    add(request.start, scale(dir, midAlong)),
    scale(poleDir, midHeight),
  );
  return {
    start: request.start,
    mid,
    end: effectiveTarget,
    effectiveTarget,
    reachable,
    clamped,
    inputDistance,
    solvedDistance,
  };
}

/** Rotate a local offset by euler XYZ (radians) — FK forward kinematics step. */
export function applyStudioFkEuler(
  localOffset: StudioIkFkVec3,
  euler: StudioIkFkVec3,
): StudioIkFkVec3 {
  const [rx, ry, rz] = euler;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // R = Rz * Ry * Rx
  const m00 = cz * cy;
  const m01 = cz * sy * sx - sz * cx;
  const m02 = cz * sy * cx + sz * sx;
  const m10 = sz * cy;
  const m11 = sz * sy * sx + cz * cx;
  const m12 = sz * sy * cx - cz * sx;
  const m20 = -sy;
  const m21 = cy * sx;
  const m22 = cy * cx;
  const [x, y, z] = localOffset;
  return [
    m00 * x + m01 * y + m02 * z,
    m10 * x + m11 * y + m12 * z,
    m20 * x + m21 * y + m22 * z,
  ];
}

export function createStudioDefaultBodyPose(): StudioBodyPoseState {
  const bone = (
    name: string,
    position: StudioIkFkVec3,
  ): StudioBoneTransform => ({
    name,
    position,
    rotation: [0, 0, 0],
  });
  return {
    revision: STUDIO_CHARACTER_IK_FK_REVISION,
    modes: {
      leftArm: "ik",
      rightArm: "ik",
      leftLeg: "ik",
      rightLeg: "ik",
      spine: "fk",
    },
    bones: {
      hips: bone("hips", [0, 1, 0]),
      spine: bone("spine", [0, 1.2, 0]),
      chest: bone("chest", [0, 1.4, 0]),
      neck: bone("neck", [0, 1.55, 0]),
      head: bone("head", [0, 1.7, 0]),
      leftUpperArm: bone("leftUpperArm", [-0.2, 1.45, 0]),
      leftLowerArm: bone("leftLowerArm", [-0.45, 1.25, 0]),
      leftHand: bone("leftHand", [-0.55, 1.05, 0]),
      rightUpperArm: bone("rightUpperArm", [0.2, 1.45, 0]),
      rightLowerArm: bone("rightLowerArm", [0.45, 1.25, 0]),
      rightHand: bone("rightHand", [0.55, 1.05, 0]),
      leftUpperLeg: bone("leftUpperLeg", [-0.1, 1, 0]),
      leftLowerLeg: bone("leftLowerLeg", [-0.1, 0.55, 0]),
      leftFoot: bone("leftFoot", [-0.1, 0.05, 0.05]),
      rightUpperLeg: bone("rightUpperLeg", [0.1, 1, 0]),
      rightLowerLeg: bone("rightLowerLeg", [0.1, 0.55, 0]),
      rightFoot: bone("rightFoot", [0.1, 0.05, 0.05]),
    },
    chainRest: {
      leftArm: {
        upper: "leftUpperArm",
        lower: "leftLowerArm",
        end: "leftHand",
        upperLength: 0.28,
        lowerLength: 0.26,
      },
      rightArm: {
        upper: "rightUpperArm",
        lower: "rightLowerArm",
        end: "rightHand",
        upperLength: 0.28,
        lowerLength: 0.26,
      },
      leftLeg: {
        upper: "leftUpperLeg",
        lower: "leftLowerLeg",
        end: "leftFoot",
        upperLength: 0.45,
        lowerLength: 0.45,
      },
      rightLeg: {
        upper: "rightUpperLeg",
        lower: "rightLowerLeg",
        end: "rightFoot",
        upperLength: 0.45,
        lowerLength: 0.45,
      },
      spine: {
        upper: "spine",
        lower: "chest",
        end: "head",
        upperLength: 0.2,
        lowerLength: 0.3,
      },
    },
  };
}

export function setStudioChainSolveMode(
  pose: StudioBodyPoseState,
  chain: StudioBodyChainId,
  mode: StudioChainSolveMode,
): StudioBodyPoseState {
  return {
    ...pose,
    modes: { ...pose.modes, [chain]: mode },
  };
}

/** IK pose a chain end effector toward a world target. */
export function poseStudioBodyChainIk(
  pose: StudioBodyPoseState,
  chain: StudioBodyChainId,
  target: StudioIkFkVec3,
  pole?: StudioIkFkVec3,
): StudioBodyPoseState {
  if (pose.modes[chain] !== "ik" && chain !== "spine") {
    // Allow explicit IK call to switch mode
  }
  const rest = pose.chainRest[chain];
  const startBone = pose.bones[rest.upper];
  if (!startBone) return pose;
  const solved = solveStudioTwoBoneIk({
    start: startBone.position,
    upperLength: rest.upperLength,
    lowerLength: rest.lowerLength,
    target,
    pole,
  });
  return {
    ...pose,
    modes: { ...pose.modes, [chain]: "ik" },
    bones: {
      ...pose.bones,
      [rest.upper]: { ...pose.bones[rest.upper]!, position: solved.start },
      [rest.lower]: { ...pose.bones[rest.lower]!, position: solved.mid },
      [rest.end]: { ...pose.bones[rest.end]!, position: solved.end },
    },
  };
}

/** FK rotate a joint and propagate child offset for a chain. */
export function poseStudioBodyChainFk(
  pose: StudioBodyPoseState,
  chain: StudioBodyChainId,
  joint: "upper" | "lower",
  rotation: StudioIkFkVec3,
): StudioBodyPoseState {
  const rest = pose.chainRest[chain];
  const upper = pose.bones[rest.upper];
  const lower = pose.bones[rest.lower];
  const end = pose.bones[rest.end];
  if (!upper || !lower || !end) return pose;

  if (joint === "upper") {
    const lowerOffset = applyStudioFkEuler([0, -rest.upperLength, 0], rotation);
    const newLowerPos = add(upper.position, lowerOffset);
    const endOffset = sub(end.position, lower.position);
    return {
      ...pose,
      modes: { ...pose.modes, [chain]: "fk" },
      bones: {
        ...pose.bones,
        [rest.upper]: { ...upper, rotation },
        [rest.lower]: { ...lower, position: newLowerPos },
        [rest.end]: {
          ...end,
          position: add(newLowerPos, endOffset),
        },
      },
    };
  }

  const endOffset = applyStudioFkEuler([0, -rest.lowerLength, 0], rotation);
  return {
    ...pose,
    modes: { ...pose.modes, [chain]: "fk" },
    bones: {
      ...pose.bones,
      [rest.lower]: { ...lower, rotation },
      [rest.end]: { ...end, position: add(lower.position, endOffset) },
    },
  };
}
