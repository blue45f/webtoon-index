/**
 * Engine-neutral semantic topology for the VRM 1.0 humanoid bone vocabulary.
 *
 * Pose persistence must not accept arbitrary scene-node names: doing so would couple saved data to
 * one importer and would let untrusted files address unrelated nodes. This module is the single
 * allowlist used by the pose-material boundary. It deliberately contains no Three.js/VRM runtime
 * objects, so the same contract can be consumed by future Babylon.js or WebGPU adapters.
 */

export const STUDIO_HUMANOID_BONE_NAMES = Object.freeze([
  "hips",
  "spine",
  "chest",
  "upperChest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "jaw",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "leftToes",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "rightToes",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "leftThumbMetacarpal",
  "leftThumbProximal",
  "leftThumbDistal",
  "leftIndexProximal",
  "leftIndexIntermediate",
  "leftIndexDistal",
  "leftMiddleProximal",
  "leftMiddleIntermediate",
  "leftMiddleDistal",
  "leftRingProximal",
  "leftRingIntermediate",
  "leftRingDistal",
  "leftLittleProximal",
  "leftLittleIntermediate",
  "leftLittleDistal",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand",
  "rightThumbMetacarpal",
  "rightThumbProximal",
  "rightThumbDistal",
  "rightIndexProximal",
  "rightIndexIntermediate",
  "rightIndexDistal",
  "rightMiddleProximal",
  "rightMiddleIntermediate",
  "rightMiddleDistal",
  "rightRingProximal",
  "rightRingIntermediate",
  "rightRingDistal",
  "rightLittleProximal",
  "rightLittleIntermediate",
  "rightLittleDistal",
] as const);

export type StudioHumanoidBoneName = (typeof STUDIO_HUMANOID_BONE_NAMES)[number];

export const STUDIO_POSE_SCOPES = Object.freeze([
  "full",
  "upper",
  "lower",
  "left-hand",
  "right-hand",
  "gaze-jaw",
] as const);

export type StudioPoseScope = (typeof STUDIO_POSE_SCOPES)[number];
export type StudioHumanoidBoneSide = "center" | "left" | "right";
export type StudioHumanoidBoneRegion =
  | "root"
  | "torso"
  | "face"
  | "arm"
  | "hand"
  | "finger"
  | "leg"
  | "foot";

export interface StudioHumanoidBoneDescriptor {
  readonly name: StudioHumanoidBoneName;
  readonly parent: StudioHumanoidBoneName | null;
  readonly side: StudioHumanoidBoneSide;
  readonly region: StudioHumanoidBoneRegion;
  readonly scopes: readonly StudioPoseScope[];
}

const BONE_NAME_SET = new Set<string>(STUDIO_HUMANOID_BONE_NAMES);
const SCOPE_SET = new Set<string>(STUDIO_POSE_SCOPES);

const PARENT_BY_BONE: Readonly<Record<StudioHumanoidBoneName, StudioHumanoidBoneName | null>> = {
  hips: null,
  spine: "hips",
  chest: "spine",
  upperChest: "chest",
  neck: "upperChest",
  head: "neck",
  leftEye: "head",
  rightEye: "head",
  jaw: "head",
  leftUpperLeg: "hips",
  leftLowerLeg: "leftUpperLeg",
  leftFoot: "leftLowerLeg",
  leftToes: "leftFoot",
  rightUpperLeg: "hips",
  rightLowerLeg: "rightUpperLeg",
  rightFoot: "rightLowerLeg",
  rightToes: "rightFoot",
  leftShoulder: "upperChest",
  leftUpperArm: "leftShoulder",
  leftLowerArm: "leftUpperArm",
  leftHand: "leftLowerArm",
  leftThumbMetacarpal: "leftHand",
  leftThumbProximal: "leftThumbMetacarpal",
  leftThumbDistal: "leftThumbProximal",
  leftIndexProximal: "leftHand",
  leftIndexIntermediate: "leftIndexProximal",
  leftIndexDistal: "leftIndexIntermediate",
  leftMiddleProximal: "leftHand",
  leftMiddleIntermediate: "leftMiddleProximal",
  leftMiddleDistal: "leftMiddleIntermediate",
  leftRingProximal: "leftHand",
  leftRingIntermediate: "leftRingProximal",
  leftRingDistal: "leftRingIntermediate",
  leftLittleProximal: "leftHand",
  leftLittleIntermediate: "leftLittleProximal",
  leftLittleDistal: "leftLittleIntermediate",
  rightShoulder: "upperChest",
  rightUpperArm: "rightShoulder",
  rightLowerArm: "rightUpperArm",
  rightHand: "rightLowerArm",
  rightThumbMetacarpal: "rightHand",
  rightThumbProximal: "rightThumbMetacarpal",
  rightThumbDistal: "rightThumbProximal",
  rightIndexProximal: "rightHand",
  rightIndexIntermediate: "rightIndexProximal",
  rightIndexDistal: "rightIndexIntermediate",
  rightMiddleProximal: "rightHand",
  rightMiddleIntermediate: "rightMiddleProximal",
  rightMiddleDistal: "rightMiddleIntermediate",
  rightRingProximal: "rightHand",
  rightRingIntermediate: "rightRingProximal",
  rightRingDistal: "rightRingIntermediate",
  rightLittleProximal: "rightHand",
  rightLittleIntermediate: "rightLittleProximal",
  rightLittleDistal: "rightLittleIntermediate",
};

function sideOf(name: StudioHumanoidBoneName): StudioHumanoidBoneSide {
  if (name.startsWith("left")) return "left";
  if (name.startsWith("right")) return "right";
  return "center";
}

function regionOf(name: StudioHumanoidBoneName): StudioHumanoidBoneRegion {
  if (name === "hips") return "root";
  if (["spine", "chest", "upperChest", "neck", "head"].includes(name)) return "torso";
  if (["leftEye", "rightEye", "jaw"].includes(name)) return "face";
  if (name.includes("Shoulder") || name.includes("Arm")) return "arm";
  if (name.endsWith("Hand")) return "hand";
  if (/Thumb|Index|Middle|Ring|Little/u.test(name)) return "finger";
  if (name.endsWith("Foot") || name.endsWith("Toes")) return "foot";
  return "leg";
}

function scopesOf(
  name: StudioHumanoidBoneName,
  region: StudioHumanoidBoneRegion
): readonly StudioPoseScope[] {
  const scopes: StudioPoseScope[] = ["full"];
  if (region === "root" || region === "leg" || region === "foot") scopes.push("lower");
  if (region === "torso" || region === "face" || region === "arm" || region === "hand" || region === "finger") {
    scopes.push("upper");
  }
  if (region === "face") scopes.push("gaze-jaw");
  if (name === "leftHand" || (name.startsWith("left") && region === "finger")) {
    scopes.push("left-hand");
  }
  if (name === "rightHand" || (name.startsWith("right") && region === "finger")) {
    scopes.push("right-hand");
  }
  return Object.freeze(scopes);
}

const descriptorEntries = STUDIO_HUMANOID_BONE_NAMES.map((name) => {
  const region = regionOf(name);
  const descriptor: StudioHumanoidBoneDescriptor = {
    name,
    parent: PARENT_BY_BONE[name],
    side: sideOf(name),
    region,
    scopes: scopesOf(name, region),
  };
  return Object.freeze(descriptor);
});

/** Stable topology order: parents always precede their children. */
export const STUDIO_HUMANOID_BONE_TOPOLOGY = Object.freeze(descriptorEntries);

const DESCRIPTOR_BY_BONE = new Map(
  STUDIO_HUMANOID_BONE_TOPOLOGY.map((descriptor) => [descriptor.name, descriptor] as const)
);

const BONES_BY_SCOPE = Object.freeze(
  Object.fromEntries(
    STUDIO_POSE_SCOPES.map((scope) => [
      scope,
      Object.freeze(
        STUDIO_HUMANOID_BONE_TOPOLOGY
          .filter((descriptor) => descriptor.scopes.includes(scope))
          .map((descriptor) => descriptor.name)
      ),
    ])
  ) as Record<StudioPoseScope, readonly StudioHumanoidBoneName[]>
);

export function isStudioHumanoidBoneName(value: unknown): value is StudioHumanoidBoneName {
  return typeof value === "string" && BONE_NAME_SET.has(value);
}

export function isStudioPoseScope(value: unknown): value is StudioPoseScope {
  return typeof value === "string" && SCOPE_SET.has(value);
}

export function getStudioHumanoidBoneDescriptor(
  name: StudioHumanoidBoneName
): StudioHumanoidBoneDescriptor {
  const descriptor = DESCRIPTOR_BY_BONE.get(name);
  if (!descriptor) throw new Error(`Unknown Studio humanoid bone: ${name}`);
  return descriptor;
}

/** Returns a shared frozen array; callers cannot mutate the semantic allowlist. */
export function studioHumanoidBonesForScope(
  scope: StudioPoseScope
): readonly StudioHumanoidBoneName[] {
  return BONES_BY_SCOPE[scope];
}

export function isStudioHumanoidBoneInScope(
  name: StudioHumanoidBoneName,
  scope: StudioPoseScope
): boolean {
  return getStudioHumanoidBoneDescriptor(name).scopes.includes(scope);
}

/** Parent-first ancestry, excluding the bone itself. */
export function studioHumanoidBoneAncestors(
  name: StudioHumanoidBoneName
): readonly StudioHumanoidBoneName[] {
  const ancestors: StudioHumanoidBoneName[] = [];
  let parent = getStudioHumanoidBoneDescriptor(name).parent;
  while (parent) {
    ancestors.unshift(parent);
    parent = getStudioHumanoidBoneDescriptor(parent).parent;
  }
  return Object.freeze(ancestors);
}
