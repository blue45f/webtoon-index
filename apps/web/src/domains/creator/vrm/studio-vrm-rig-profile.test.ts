import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_FALLBACK_JOINT_LIMIT,
  STUDIO_VRM_JOINT_LIMITS,
  dampStudioVrmJointRotation,
  type StudioVrmJointAxisLimit,
  type StudioVrmJointLimit,
} from "./studio-vrm-joint-limits";
import {
  STUDIO_VRM_RIG_PROFILES,
  STUDIO_VRM_RIG_PROFILE_IDS,
  STUDIO_VRM_RIG_PROFILE_PURPOSE,
  applyStudioVrmRigProfileToJointLimit,
  createStudioVrmRigProfileSelection,
  dampStudioVrmJointRotationForProfile,
  getEffectiveStudioVrmJointLimit,
  normalizeStudioVrmRigProfile,
} from "./studio-vrm-rig-profile";

function expectAxisNeverExpanded(
  effective: StudioVrmJointAxisLimit,
  base: StudioVrmJointAxisLimit,
): void {
  expect(effective.hardMin).toBe(base.hardMin);
  expect(effective.hardMax).toBe(base.hardMax);
  expect(effective.softMin).toBeGreaterThanOrEqual(base.softMin);
  expect(effective.softMax).toBeLessThanOrEqual(base.softMax);
  expect(effective.softMin).toBeLessThanOrEqual(effective.softMax);
}

describe("studio VRM drawing rig profiles", () => {
  it("publishes the seven non-medical drawing presets with bounded correction weights", () => {
    expect(Object.keys(STUDIO_VRM_RIG_PROFILES)).toEqual(STUDIO_VRM_RIG_PROFILE_IDS);
    for (const id of STUDIO_VRM_RIG_PROFILE_IDS) {
      const profile = STUDIO_VRM_RIG_PROFILES[id];
      expect(profile.id).toBe(id);
      expect(profile.purpose).toBe(STUDIO_VRM_RIG_PROFILE_PURPOSE);
      expect(profile.softRangeScale).toBeGreaterThan(0);
      expect(profile.softRangeScale).toBeLessThanOrEqual(1);
      expect(profile.damping).toBeGreaterThanOrEqual(0);
      expect(profile.damping).toBeLessThanOrEqual(1);
      expect(profile.hipsWeight).toBeGreaterThanOrEqual(0);
      expect(profile.spineWeight).toBeGreaterThanOrEqual(0);
      expect(profile.hipsWeight + profile.spineWeight).toBeCloseTo(1, 12);
      expect(Object.isFrozen(profile)).toBe(true);
    }
    expect(Object.isFrozen(STUDIO_VRM_RIG_PROFILES)).toBe(true);
  });

  it("normalizes only known ids and exact versioned selections", () => {
    expect(normalizeStudioVrmRigProfile("senior")).toBe(STUDIO_VRM_RIG_PROFILES.senior);
    expect(normalizeStudioVrmRigProfile({
      version: 1,
      purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE,
      id: "child",
    })).toBe(STUDIO_VRM_RIG_PROFILES.child);
    expect(normalizeStudioVrmRigProfile({ ...STUDIO_VRM_RIG_PROFILES.flexible }))
      .toBe(STUDIO_VRM_RIG_PROFILES.flexible);
  });

  it("fails closed for unknown, extended, future, or numerically overridden profiles", () => {
    for (const value of [
      null,
      [],
      "medical",
      { version: 2, purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE, id: "adult" },
      { version: 1, purpose: "medical", id: "adult" },
      { version: 1, purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE, id: "adult", extra: true },
      { ...STUDIO_VRM_RIG_PROFILES.adult, damping: Number.NaN },
      { ...STUDIO_VRM_RIG_PROFILES.adult, softRangeScale: 2 },
    ]) {
      expect(normalizeStudioVrmRigProfile(value)).toBeNull();
      expect(createStudioVrmRigProfileSelection(value)).toBeNull();
    }
  });

  it("creates a minimal frozen selection without copying tunable numbers", () => {
    const selection = createStudioVrmRigProfileSelection("limited");
    expect(selection).toEqual({
      version: 1,
      purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE,
      id: "limited",
    });
    expect(Object.isFrozen(selection)).toBe(true);
    expect(selection).not.toHaveProperty("damping");
  });

  it("retains every existing hard endpoint and only narrows soft ranges", () => {
    const limits = [
      ...Object.values(STUDIO_VRM_JOINT_LIMITS),
      STUDIO_VRM_FALLBACK_JOINT_LIMIT,
    ].filter((limit): limit is StudioVrmJointLimit => limit !== undefined);
    for (const base of limits) {
      for (const id of STUDIO_VRM_RIG_PROFILE_IDS) {
        const effective = applyStudioVrmRigProfileToJointLimit(base, id);
        expect(effective).not.toBeNull();
        expectAxisNeverExpanded(effective!.x, base.x);
        expectAxisNeverExpanded(effective!.y, base.y);
        expectAxisNeverExpanded(effective!.z, base.z);
      }
    }
  });

  it("uses the conservative existing fallback for unknown bones", () => {
    const effective = getEffectiveStudioVrmJointLimit("futureBone", "limited");
    expect(effective).not.toBeNull();
    expectAxisNeverExpanded(effective!.x, STUDIO_VRM_FALLBACK_JOINT_LIMIT.x);
    expectAxisNeverExpanded(effective!.y, STUDIO_VRM_FALLBACK_JOINT_LIMIT.y);
    expectAxisNeverExpanded(effective!.z, STUDIO_VRM_FALLBACK_JOINT_LIMIT.z);
  });

  it("rejects malformed base limits instead of manufacturing an expanded boundary", () => {
    const malformed = {
      x: { hardMin: -1, softMin: -0.5, softMax: 0.5, hardMax: 1 },
      y: { hardMin: -1, softMin: -2, softMax: 0.5, hardMax: 1 },
      z: { hardMin: -1, softMin: -0.5, softMax: Number.POSITIVE_INFINITY, hardMax: 1 },
    } as StudioVrmJointLimit;
    expect(applyStudioVrmRigProfileToJointLimit(malformed, "neutral")).toBeNull();
    expect(applyStudioVrmRigProfileToJointLimit(STUDIO_VRM_FALLBACK_JOINT_LIMIT, "unknown"))
      .toBeNull();
  });

  it("is deterministic and never mutates the base limit", () => {
    const before = JSON.stringify(STUDIO_VRM_FALLBACK_JOINT_LIMIT);
    const first = applyStudioVrmRigProfileToJointLimit(
      STUDIO_VRM_FALLBACK_JOINT_LIMIT,
      "senior",
    );
    const second = applyStudioVrmRigProfileToJointLimit(
      STUDIO_VRM_FALLBACK_JOINT_LIMIT,
      "senior",
    );
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(JSON.stringify(STUDIO_VRM_FALLBACK_JOINT_LIMIT)).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first!.x)).toBe(true);
  });

  it("keeps neutral IK damping byte-for-byte compatible and applies narrowed profile softness", () => {
    const raw = [1.9, 0.2, -0.1] as const;
    expect(dampStudioVrmJointRotationForProfile("leftLowerLeg", raw, "neutral"))
      .toEqual(dampStudioVrmJointRotation("leftLowerLeg", raw, 0.6));

    const limited = dampStudioVrmJointRotationForProfile("leftLowerLeg", raw, "limited");
    const effective = getEffectiveStudioVrmJointLimit("leftLowerLeg", "limited");
    expect(limited).not.toBeNull();
    expect(effective).not.toBeNull();
    expect(limited![0]).toBeGreaterThanOrEqual(effective!.x.hardMin);
    expect(limited![0]).toBeLessThanOrEqual(effective!.x.hardMax);
    expect(limited).not.toEqual(
      dampStudioVrmJointRotation("leftLowerLeg", raw, STUDIO_VRM_RIG_PROFILES.limited.damping),
    );
  });

  it("fails closed when profiled damping receives an untrusted numeric override", () => {
    expect(dampStudioVrmJointRotationForProfile("leftUpperArm", [1, 2, 3], {
      ...STUDIO_VRM_RIG_PROFILES.adult,
      damping: 0,
    })).toBeNull();
  });
});
