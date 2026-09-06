import {
  canonicalizeStudioVrmJointRotation,
  dampStudioVrmJointRotation,
  getStudioVrmJointLimit,
  type StudioVrmJointAxisLimit,
  type StudioVrmJointLimit,
  type StudioVrmJointRotation,
} from "./studio-vrm-joint-limits";

import type { VRMHumanBoneName } from "@pixiv/three-vrm";

export const STUDIO_VRM_RIG_PROFILE_VERSION = 1 as const;
export const STUDIO_VRM_RIG_PROFILE_PURPOSE = "stylized-drawing-reference-only" as const;

export const STUDIO_VRM_RIG_PROFILE_IDS = [
  "neutral",
  "child",
  "teen",
  "adult",
  "senior",
  "flexible",
  "limited",
] as const;

export type StudioVrmRigProfileId = (typeof STUDIO_VRM_RIG_PROFILE_IDS)[number];
export type StudioVrmRigProfilePurpose = typeof STUDIO_VRM_RIG_PROFILE_PURPOSE;

/**
 * A stylized drawing-assist preset, not a medical, diagnostic, ergonomic, or anatomical claim.
 *
 * Names such as `child` and `senior` are only convenient illustration starting points. They must
 * never be used to infer a real person's health, age, disability, safe range of motion, or fitness.
 */
export interface StudioVrmRigProfile {
  readonly version: typeof STUDIO_VRM_RIG_PROFILE_VERSION;
  readonly purpose: StudioVrmRigProfilePurpose;
  readonly id: StudioVrmRigProfileId;
  readonly label: string;
  /** Scales the existing soft interval around its midpoint. It is always in `(0, 1]`. */
  readonly softRangeScale: number;
  /** Drawing-assist resistance in `[0, 1]`; it does not alter the hard safety boundary. */
  readonly damping: number;
  /** Share of whole-body correction suggested for the hips. Hips + spine always equals one. */
  readonly hipsWeight: number;
  /** Share of whole-body correction suggested for the spine. Hips + spine always equals one. */
  readonly spineWeight: number;
}

/** Minimal, stable selection shape suitable for a versioned scene document. */
export interface StudioVrmRigProfileSelection {
  readonly version: typeof STUDIO_VRM_RIG_PROFILE_VERSION;
  readonly purpose: StudioVrmRigProfilePurpose;
  readonly id: StudioVrmRigProfileId;
}

export type StudioVrmRigProfileInput =
  | StudioVrmRigProfileId
  | StudioVrmRigProfileSelection
  | StudioVrmRigProfile;

function profile(
  id: StudioVrmRigProfileId,
  label: string,
  softRangeScale: number,
  damping: number,
  hipsWeight: number,
): StudioVrmRigProfile {
  return Object.freeze({
    version: STUDIO_VRM_RIG_PROFILE_VERSION,
    purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE,
    id,
    label,
    softRangeScale,
    damping,
    hipsWeight,
    spineWeight: 1 - hipsWeight,
  });
}

/**
 * Conservative illustration presets. Every soft-range scale is at most one, so selecting a
 * profile can only retain or narrow the existing soft interval; it can never expand hard limits.
 */
export const STUDIO_VRM_RIG_PROFILES: Readonly<
  Record<StudioVrmRigProfileId, StudioVrmRigProfile>
> = Object.freeze({
  neutral: profile("neutral", "중립", 1, 0.6, 0.5),
  child: profile("child", "어린이 드로잉", 0.88, 0.56, 0.44),
  teen: profile("teen", "청소년 드로잉", 0.95, 0.58, 0.48),
  adult: profile("adult", "성인 드로잉", 1, 0.62, 0.5),
  senior: profile("senior", "노년 드로잉", 0.76, 0.78, 0.58),
  flexible: profile("flexible", "유연한 연출", 1, 0.28, 0.42),
  limited: profile("limited", "제한된 연출", 0.56, 0.9, 0.64),
});

const PROFILE_ID_SET = new Set<string>(STUDIO_VRM_RIG_PROFILE_IDS);
const SELECTION_KEYS = new Set(["version", "purpose", "id"]);
const FULL_PROFILE_KEYS = new Set([
  "version",
  "purpose",
  "id",
  "label",
  "softRangeScale",
  "damping",
  "hipsWeight",
  "spineWeight",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function isProfileId(value: unknown): value is StudioVrmRigProfileId {
  return typeof value === "string" && PROFILE_ID_SET.has(value);
}

function exactlyCanonicalProfile(
  value: Record<string, unknown>,
  canonical: StudioVrmRigProfile,
): boolean {
  return hasExactKeys(value, FULL_PROFILE_KEYS)
    && value.version === canonical.version
    && value.purpose === canonical.purpose
    && value.id === canonical.id
    && value.label === canonical.label
    && value.softRangeScale === canonical.softRangeScale
    && value.damping === canonical.damping
    && value.hipsWeight === canonical.hipsWeight
    && value.spineWeight === canonical.spineWeight;
}

/**
 * Resolves only a known id, an exact versioned selection, or an exact canonical profile.
 * Unknown keys, partially trusted numeric overrides, and future versions fail closed with `null`.
 */
export function normalizeStudioVrmRigProfile(value: unknown): StudioVrmRigProfile | null {
  if (isProfileId(value)) return STUDIO_VRM_RIG_PROFILES[value];
  if (!isRecord(value) || !isProfileId(value.id)) return null;
  const canonical = STUDIO_VRM_RIG_PROFILES[value.id];
  if (
    hasExactKeys(value, SELECTION_KEYS)
    && value.version === STUDIO_VRM_RIG_PROFILE_VERSION
    && value.purpose === STUDIO_VRM_RIG_PROFILE_PURPOSE
  ) return canonical;
  return exactlyCanonicalProfile(value, canonical) ? canonical : null;
}

export function createStudioVrmRigProfileSelection(
  value: unknown,
): StudioVrmRigProfileSelection | null {
  const normalized = normalizeStudioVrmRigProfile(value);
  return normalized
    ? Object.freeze({
        version: STUDIO_VRM_RIG_PROFILE_VERSION,
        purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE,
        id: normalized.id,
      })
    : null;
}

function validAxisLimit(value: StudioVrmJointAxisLimit): boolean {
  const values = [value.hardMin, value.softMin, value.softMax, value.hardMax];
  return values.every(Number.isFinite)
    && value.hardMin <= value.softMin
    && value.softMin <= value.softMax
    && value.softMax <= value.hardMax;
}

function validJointLimit(value: StudioVrmJointLimit): boolean {
  return validAxisLimit(value.x) && validAxisLimit(value.y) && validAxisLimit(value.z);
}

function effectiveAxisLimit(
  base: StudioVrmJointAxisLimit,
  softRangeScale: number,
): StudioVrmJointAxisLimit {
  const midpoint = (base.softMin + base.softMax) / 2;
  const halfRange = (base.softMax - base.softMin) * softRangeScale / 2;
  const softMin = Math.max(base.softMin, Math.min(base.softMax, midpoint - halfRange));
  const softMax = Math.min(base.softMax, Math.max(base.softMin, midpoint + halfRange));
  return Object.freeze({
    hardMin: base.hardMin,
    softMin,
    softMax,
    hardMax: base.hardMax,
  });
}

/**
 * Applies a drawing preset to a trusted joint limit without ever changing its hard endpoints.
 * Invalid profiles or malformed limits fail closed instead of silently widening a joint.
 */
export function applyStudioVrmRigProfileToJointLimit(
  base: StudioVrmJointLimit,
  profileInput: StudioVrmRigProfileInput | unknown,
): StudioVrmJointLimit | null {
  const normalized = normalizeStudioVrmRigProfile(profileInput);
  if (!normalized || !validJointLimit(base)) return null;
  return Object.freeze({
    x: effectiveAxisLimit(base.x, normalized.softRangeScale),
    y: effectiveAxisLimit(base.y, normalized.softRangeScale),
    z: effectiveAxisLimit(base.z, normalized.softRangeScale),
  });
}

/** Effective profile limit for an existing normalized VRM humanoid bone. */
export function getEffectiveStudioVrmJointLimit(
  boneName: VRMHumanBoneName | unknown,
  profileInput: StudioVrmRigProfileInput | unknown,
): StudioVrmJointLimit | null {
  return applyStudioVrmRigProfileToJointLimit(
    getStudioVrmJointLimit(boneName),
    profileInput,
  );
}

const PROFILE_SOFT_LIMIT_CURVE = 3;

function clampProfileAxis(value: number, limit: StudioVrmJointAxisLimit): number {
  return Math.min(limit.hardMax, Math.max(limit.hardMin, value));
}

function profileSoftLimitProgress(value: number, limit: StudioVrmJointAxisLimit): number {
  if (value < limit.softMin) {
    return Math.min(1, (limit.softMin - value) / (limit.softMin - limit.hardMin));
  }
  if (value > limit.softMax) {
    return Math.min(1, (value - limit.softMax) / (limit.hardMax - limit.softMax));
  }
  return 0;
}

function dampProfileAxis(
  value: number,
  limit: StudioVrmJointAxisLimit,
  strength: number,
): number {
  const progress = profileSoftLimitProgress(value, limit);
  if (progress === 0 || strength === 0) return value;
  const denominator = strength * PROFILE_SOFT_LIMIT_CURVE * progress;
  const damping = -Math.expm1(-denominator) / denominator;
  if (value < limit.softMin) {
    return limit.softMin + (value - limit.softMin) * damping;
  }
  return limit.softMax + (value - limit.softMax) * damping;
}

/**
 * Applies a profile's effective soft interval and resistance to one IK rotation. Hard endpoints
 * remain the base joint limits. Invalid profile input fails closed with `null`.
 */
export function dampStudioVrmJointRotationForProfile(
  boneName: VRMHumanBoneName | unknown,
  rotation: unknown,
  profileInput: StudioVrmRigProfileInput | unknown,
): StudioVrmJointRotation | null {
  const profile = normalizeStudioVrmRigProfile(profileInput);
  if (!profile) return null;
  // This preserves the exact legacy math and output when the profile does not narrow soft ranges.
  if (profile.softRangeScale === 1) {
    return dampStudioVrmJointRotation(boneName, rotation, profile.damping);
  }
  const limit = getEffectiveStudioVrmJointLimit(boneName, profile);
  if (!limit) return null;
  const canonical = canonicalizeStudioVrmJointRotation(rotation);
  const values: StudioVrmJointRotation = [
    clampProfileAxis(canonical[0], limit.x),
    clampProfileAxis(canonical[1], limit.y),
    clampProfileAxis(canonical[2], limit.z),
  ];
  return [
    dampProfileAxis(values[0], limit.x, profile.damping),
    dampProfileAxis(values[1], limit.y, profile.damping),
    dampProfileAxis(values[2], limit.z, profile.damping),
  ];
}
