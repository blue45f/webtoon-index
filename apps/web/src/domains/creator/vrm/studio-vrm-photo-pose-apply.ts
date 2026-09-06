import {
  getStudioHumanoidBoneDescriptor,
  isStudioHumanoidBoneName,
  type StudioHumanoidBoneName,
} from "../studio-humanoid-bones";

import type { FingerRotationMap, PoseBoneMap, Vec3 } from "./studio-vrm-poser-utils";

export interface StudioVrmPhotoPoseApplyInput {
  readonly currentBones: PoseBoneMap;
  readonly currentFingerEdits: FingerRotationMap;
  readonly scannedBones: Readonly<Record<string, readonly [number, number, number]>>;
  readonly scannedFingerEdits?: Readonly<Record<string, readonly [number, number, number]>>;
  readonly lockedBones?: readonly string[];
  readonly isBoneAvailable: (bone: StudioHumanoidBoneName) => boolean;
  readonly clampRotation?: (
    bone: StudioHumanoidBoneName,
    axisIndex: 0 | 1 | 2,
    radians: number,
  ) => number;
}

export interface StudioVrmPhotoPoseApplyPlan {
  readonly bones: PoseBoneMap;
  readonly fingerEdits: FingerRotationMap;
  readonly appliedBodyBones: readonly StudioHumanoidBoneName[];
  readonly appliedFingerBones: readonly StudioHumanoidBoneName[];
  readonly skippedLocked: readonly StudioHumanoidBoneName[];
  readonly skippedMissing: readonly StudioHumanoidBoneName[];
  readonly skippedInvalid: readonly string[];
}

function copyRotation(
  bone: StudioHumanoidBoneName,
  value: unknown,
  clampRotation: StudioVrmPhotoPoseApplyInput["clampRotation"],
): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const rotation: number[] = [];
  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const radians = value[axisIndex];
    if (typeof radians !== "number" || !Number.isFinite(radians)) return null;
    let next = radians;
    if (clampRotation) {
      try {
        next = clampRotation(bone, axisIndex as 0 | 1 | 2, radians);
      } catch {
        return null;
      }
    }
    if (!Number.isFinite(next)) return null;
    rotation.push(next);
  }
  return Object.freeze([rotation[0]!, rotation[1]!, rotation[2]!]);
}

function available(
  bone: StudioHumanoidBoneName,
  isBoneAvailable: StudioVrmPhotoPoseApplyInput["isBoneAvailable"],
): boolean {
  try {
    return isBoneAvailable(bone);
  } catch {
    return false;
  }
}

/**
 * Plans one authoritative photo edit without mutating React state or the live VRM. Missing,
 * locked, malformed, and undetected bones retain their current values; the caller commits only
 * this returned snapshot after every runtime ownership check succeeds.
 */
export function createStudioVrmPhotoPoseApplyPlan(
  input: StudioVrmPhotoPoseApplyInput,
): StudioVrmPhotoPoseApplyPlan {
  const bones: PoseBoneMap = { ...input.currentBones };
  const fingerEdits: FingerRotationMap = { ...input.currentFingerEdits };
  const locked = new Set(input.lockedBones ?? []);
  const appliedBodyBones: StudioHumanoidBoneName[] = [];
  const appliedFingerBones: StudioHumanoidBoneName[] = [];
  const skippedLocked: StudioHumanoidBoneName[] = [];
  const skippedMissing: StudioHumanoidBoneName[] = [];
  const skippedInvalid: string[] = [];

  const applyEntries = (
    entries: readonly [string, readonly [number, number, number]][],
    expectedFinger: boolean,
  ) => {
    for (const [rawBone, rawRotation] of entries) {
      if (!isStudioHumanoidBoneName(rawBone)) {
        skippedInvalid.push(rawBone);
        continue;
      }
      const isFinger = getStudioHumanoidBoneDescriptor(rawBone).region === "finger";
      if (isFinger !== expectedFinger) {
        skippedInvalid.push(rawBone);
        continue;
      }
      if (locked.has(rawBone)) {
        skippedLocked.push(rawBone);
        continue;
      }
      if (!available(rawBone, input.isBoneAvailable)) {
        skippedMissing.push(rawBone);
        continue;
      }
      const rotation = copyRotation(rawBone, rawRotation, input.clampRotation);
      if (!rotation) {
        skippedInvalid.push(rawBone);
        continue;
      }
      if (expectedFinger) {
        fingerEdits[rawBone] = rotation;
        delete bones[rawBone];
        appliedFingerBones.push(rawBone);
      } else {
        bones[rawBone] = { rotation };
        appliedBodyBones.push(rawBone);
      }
    }
  };

  applyEntries(Object.entries(input.scannedBones), false);
  applyEntries(Object.entries(input.scannedFingerEdits ?? {}), true);

  return Object.freeze({
    bones,
    fingerEdits,
    appliedBodyBones: Object.freeze(appliedBodyBones),
    appliedFingerBones: Object.freeze(appliedFingerBones),
    skippedLocked: Object.freeze(skippedLocked),
    skippedMissing: Object.freeze(skippedMissing),
    skippedInvalid: Object.freeze(skippedInvalid),
  });
}
