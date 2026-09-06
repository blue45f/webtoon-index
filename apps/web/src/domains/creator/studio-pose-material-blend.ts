/**
 * Pure strength blending for engine-neutral pose material merge plans.
 *
 * Strength 0 slerps every operation to the rest-relative identity `[0,0,0,1]` (or drops ops when
 * `restIdentity` is true). Strength 1 keeps the original plan rotations. The plan metadata and
 * skip lists are preserved; results are deeply frozen.
 */

import {
  canonicalizeStudioPoseQuaternion,
  createStudioPoseMaterialMergePlan,
  type StudioPoseMaterialMergeOperation,
  type StudioPoseMaterialMergeOptions,
  type StudioPoseMaterialMergePlan,
  type StudioPoseQuaternion,
} from "./studio-pose-material";

export type StudioPoseMaterialStrengthMergeOptions = StudioPoseMaterialMergeOptions & {
  readonly strength?: number;
};

const IDENTITY_QUATERNION: StudioPoseQuaternion = Object.freeze([0, 0, 0, 1] as const);
const MIN_QUATERNION_NORM = 1e-8;

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/** Clamps finite strength into `[0, 1]`. Non-finite values fail closed to `0`. */
export function clampStudioPoseMaterialStrength(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function positiveZero(component: number): number {
  return Object.is(component, -0) ? 0 : component;
}

/**
 * Slerp from unit quaternion `a` toward unit quaternion `b` by `t` in `[0, 1]`.
 * Always takes the short arc and returns a unit quaternion (or null if degenerate).
 */
function slerpUnitQuaternions(
  a: StudioPoseQuaternion,
  b: StudioPoseQuaternion,
  t: number
): StudioPoseQuaternion | null {
  if (t <= 0) return a;
  if (t >= 1) return b;

  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cosOmega = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosOmega < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosOmega = -cosOmega;
  }

  let scale0: number;
  let scale1: number;
  if (cosOmega > 0.9995) {
    // Near-parallel: fall back to normalized linear interpolation to avoid sin(omega) ≈ 0.
    scale0 = 1 - t;
    scale1 = t;
  } else {
    const omega = Math.acos(Math.min(1, Math.max(-1, cosOmega)));
    const sinOmega = Math.sin(omega);
    if (!Number.isFinite(sinOmega) || Math.abs(sinOmega) < MIN_QUATERNION_NORM) {
      scale0 = 1 - t;
      scale1 = t;
    } else {
      scale0 = Math.sin((1 - t) * omega) / sinOmega;
      scale1 = Math.sin(t * omega) / sinOmega;
    }
  }

  const x = scale0 * a[0] + scale1 * bx;
  const y = scale0 * a[1] + scale1 * by;
  const z = scale0 * a[2] + scale1 * bz;
  const w = scale0 * a[3] + scale1 * bw;
  const normalized = canonicalizeStudioPoseQuaternion([
    positiveZero(x),
    positiveZero(y),
    positiveZero(z),
    positiveZero(w),
  ]);
  return normalized;
}

function blendOperationRotation(
  rotation: StudioPoseQuaternion,
  strength: number
): StudioPoseQuaternion {
  if (strength <= 0) return IDENTITY_QUATERNION;
  if (strength >= 1) {
    return canonicalizeStudioPoseQuaternion(rotation) ?? IDENTITY_QUATERNION;
  }
  const target = canonicalizeStudioPoseQuaternion(rotation) ?? IDENTITY_QUATERNION;
  return slerpUnitQuaternions(IDENTITY_QUATERNION, target, strength) ?? IDENTITY_QUATERNION;
}

/**
 * Blends every operation quaternion from identity toward the plan rotation by `strength`.
 *
 * - `strength = 0`, `restIdentity = true` → empty operations (pure no-op plan)
 * - `strength = 0`, `restIdentity` falsy → identity quaternions for every original op
 * - `strength = 1` → original rotations (re-canonicalized)
 *
 * Skip lists and plan metadata are preserved. The returned plan is deeply frozen.
 */
export function blendStudioPoseMaterialMergePlan(
  plan: StudioPoseMaterialMergePlan,
  strength: number,
  restIdentity = false
): StudioPoseMaterialMergePlan {
  const clamped = clampStudioPoseMaterialStrength(strength);

  let operations: readonly StudioPoseMaterialMergeOperation[];
  if (clamped === 0 && restIdentity) {
    operations = Object.freeze([]);
  } else {
    operations = Object.freeze(
      plan.operations.map((operation) =>
        Object.freeze({
          bone: operation.bone,
          rotation: blendOperationRotation(operation.rotation, clamped),
        })
      )
    );
  }

  return deepFreeze({
    materialId: plan.materialId,
    materialScope: plan.materialScope,
    requestedScope: plan.requestedScope,
    rotationConvention: plan.rotationConvention,
    operations,
    skippedLocked: Object.freeze(plan.skippedLocked.slice()),
    skippedOutsideScope: Object.freeze(plan.skippedOutsideScope.slice()),
  });
}

/**
 * Builds a merge plan then blends operation rotations by optional `strength` (default `1`).
 * Unknown option keys other than `strength` are stripped so the strict merge planner stays closed.
 */
export function createStudioPoseMaterialStrengthMergePlan(
  rawMaterial: unknown,
  rawOptions?: StudioPoseMaterialStrengthMergeOptions
): StudioPoseMaterialMergePlan | null {
  const strength =
    rawOptions !== undefined && typeof rawOptions.strength === "number"
      ? rawOptions.strength
      : 1;
  // Strip `strength` (and any other non-merge keys) so the strict planner stays fail-closed.
  const mergeOptions: StudioPoseMaterialMergeOptions | undefined =
    rawOptions === undefined
      ? undefined
      : {
          ...(rawOptions.scope !== undefined ? { scope: rawOptions.scope } : {}),
          ...(rawOptions.lockedBones !== undefined
            ? { lockedBones: rawOptions.lockedBones }
            : {}),
        };
  const plan = createStudioPoseMaterialMergePlan(rawMaterial, mergeOptions);
  if (!plan) return null;
  return blendStudioPoseMaterialMergePlan(plan, strength);
}
