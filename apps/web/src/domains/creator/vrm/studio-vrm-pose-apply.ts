import {
  getStudioHumanoidBoneDescriptor,
  isStudioHumanoidBoneName,
  type StudioHumanoidBoneName,
} from "../studio-humanoid-bones";

import type { FingerRotationMap, PoseBoneMap, Vec3 } from "./studio-vrm-poser-utils";

export interface StudioVrmPoseApplyInput {
  readonly currentBones: PoseBoneMap;
  readonly currentFingerEdits: FingerRotationMap;
  /** Body bone targets. Accepts PoseBoneMap or a rotation-only record. */
  readonly incomingBones?: PoseBoneMap | Readonly<Record<string, { readonly rotation?: unknown }>>;
  /** Finger bone targets as raw Euler triples (FingerRotationMap shape). */
  readonly incomingFingerEdits?: FingerRotationMap | Readonly<Record<string, unknown>>;
  readonly lockedBones?: readonly string[];
  readonly isBoneAvailable: (bone: StudioHumanoidBoneName) => boolean;
  readonly clampRotation?: (
    bone: StudioHumanoidBoneName,
    axisIndex: 0 | 1 | 2,
    radians: number,
  ) => number;
  /** 0 = keep current (identity); 1 = full replace. Default 1. */
  readonly strength?: number;
}

export interface StudioVrmPoseApplyPlan {
  readonly bones: PoseBoneMap;
  readonly fingerEdits: FingerRotationMap;
  readonly appliedBodyBones: readonly StudioHumanoidBoneName[];
  readonly appliedFingerBones: readonly StudioHumanoidBoneName[];
  readonly skippedLocked: readonly StudioHumanoidBoneName[];
  readonly skippedMissing: readonly StudioHumanoidBoneName[];
  readonly skippedInvalid: readonly string[];
}

const ZERO: Vec3 = Object.freeze([0, 0, 0]);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function asFiniteTriple(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const x = value[0];
  const y = value[1];
  const z = value[2];
  if (
    typeof x !== "number" || !Number.isFinite(x)
    || typeof y !== "number" || !Number.isFinite(y)
    || typeof z !== "number" || !Number.isFinite(z)
  ) {
    return null;
  }
  return Object.freeze([x, y, z]);
}

function extractIncomingBodyRotation(value: unknown): Vec3 | null {
  if (value == null || typeof value !== "object") return null;
  const rotation = (value as { rotation?: unknown }).rotation;
  return asFiniteTriple(rotation);
}

function available(
  bone: StudioHumanoidBoneName,
  isBoneAvailable: StudioVrmPoseApplyInput["isBoneAvailable"],
): boolean {
  try {
    return isBoneAvailable(bone);
  } catch {
    return false;
  }
}

function clampAxis(
  bone: StudioHumanoidBoneName,
  axisIndex: 0 | 1 | 2,
  radians: number,
  clampRotation: StudioVrmPoseApplyInput["clampRotation"],
): number | null {
  if (!clampRotation) return radians;
  try {
    const next = clampRotation(bone, axisIndex, radians);
    return Number.isFinite(next) ? next : null;
  } catch {
    return null;
  }
}

function blendRotation(
  bone: StudioHumanoidBoneName,
  current: Vec3 | undefined,
  incoming: Vec3,
  strength: number,
  clampRotation: StudioVrmPoseApplyInput["clampRotation"],
): Vec3 | null {
  const from = current ?? ZERO;
  const rotation: number[] = [];
  for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
    const a = from[axisIndex]!;
    const b = incoming[axisIndex]!;
    const lerped = a + (b - a) * strength;
    if (!Number.isFinite(lerped)) return null;
    const clamped = clampAxis(bone, axisIndex as 0 | 1 | 2, lerped, clampRotation);
    if (clamped == null) return null;
    rotation.push(clamped);
  }
  return Object.freeze([rotation[0]!, rotation[1]!, rotation[2]!]);
}

/**
 * Plans one lock-aware pose apply without mutating React state or the live VRM.
 * Unlocked bones present in the incoming maps are blended toward the target by `strength`
 * (0 = identity / current only, 1 = full replace). Locked, missing, and invalid bones are
 * reported and keep their current values.
 */
export function createStudioVrmPoseApplyPlan(
  input: StudioVrmPoseApplyInput,
): StudioVrmPoseApplyPlan {
  const bones: PoseBoneMap = { ...input.currentBones };
  const fingerEdits: FingerRotationMap = { ...input.currentFingerEdits };
  const locked = new Set(input.lockedBones ?? []);
  const strength = clamp01(input.strength ?? 1);
  const appliedBodyBones: StudioHumanoidBoneName[] = [];
  const appliedFingerBones: StudioHumanoidBoneName[] = [];
  const skippedLocked: StudioHumanoidBoneName[] = [];
  const skippedMissing: StudioHumanoidBoneName[] = [];
  const skippedInvalid: string[] = [];

  for (const [rawBone, rawValue] of Object.entries(input.incomingBones ?? {})) {
    if (!isStudioHumanoidBoneName(rawBone)) {
      skippedInvalid.push(rawBone);
      continue;
    }
    const isFinger = getStudioHumanoidBoneDescriptor(rawBone).region === "finger";
    if (isFinger) {
      // Body channel only — finger targets belong in incomingFingerEdits.
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
    const incoming = extractIncomingBodyRotation(rawValue);
    if (!incoming) {
      skippedInvalid.push(rawBone);
      continue;
    }
    const next = blendRotation(
      rawBone,
      input.currentBones[rawBone]?.rotation,
      incoming,
      strength,
      input.clampRotation,
    );
    if (!next) {
      skippedInvalid.push(rawBone);
      continue;
    }
    bones[rawBone] = { rotation: next };
    appliedBodyBones.push(rawBone);
  }

  for (const [rawBone, rawValue] of Object.entries(input.incomingFingerEdits ?? {})) {
    if (!isStudioHumanoidBoneName(rawBone)) {
      skippedInvalid.push(rawBone);
      continue;
    }
    const isFinger = getStudioHumanoidBoneDescriptor(rawBone).region === "finger";
    if (!isFinger) {
      // Finger channel only — body targets belong in incomingBones.
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
    const incoming = asFiniteTriple(rawValue);
    if (!incoming) {
      skippedInvalid.push(rawBone);
      continue;
    }
    const next = blendRotation(
      rawBone,
      input.currentFingerEdits[rawBone],
      incoming,
      strength,
      input.clampRotation,
    );
    if (!next) {
      skippedInvalid.push(rawBone);
      continue;
    }
    fingerEdits[rawBone] = next;
    delete bones[rawBone];
    appliedFingerBones.push(rawBone);
  }

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
