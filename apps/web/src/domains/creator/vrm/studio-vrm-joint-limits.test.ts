import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_FALLBACK_JOINT_LIMIT,
  STUDIO_VRM_JOINT_LIMITS,
  canonicalizeStudioVrmJointAngle,
  canonicalizeStudioVrmJointRotation,
  clampStudioVrmJointRotation,
  dampStudioVrmJointRotation,
  getStudioVrmJointLimit,
  getStudioVrmJointSoftLimitDamping,
} from "./studio-vrm-joint-limits";

import type { StudioVrmJointAxis, StudioVrmJointAxisLimit } from "./studio-vrm-joint-limits";

const AXES = ["x", "y", "z"] as const satisfies readonly StudioVrmJointAxis[];

function expectMirroredAxis(
  left: StudioVrmJointAxisLimit,
  right: StudioVrmJointAxisLimit,
) {
  expect(right.hardMin).toBeCloseTo(-left.hardMax, 12);
  expect(right.softMin).toBeCloseTo(-left.softMax, 12);
  expect(right.softMax).toBeCloseTo(-left.softMin, 12);
  expect(right.hardMax).toBeCloseTo(-left.hardMin, 12);
}

describe("VRM joint limits", () => {
  it("defines finite ordered radian limits with a neutral rest angle", () => {
    for (const [boneName, limit] of Object.entries(STUDIO_VRM_JOINT_LIMITS)) {
      for (const axisName of AXES) {
        const value = limit[axisName];
        expect(
          [value.hardMin, value.softMin, value.softMax, value.hardMax].every(Number.isFinite),
          `${boneName}.${axisName} should be finite`,
        ).toBe(true);
        expect(value.hardMin, `${boneName}.${axisName} hardMin`).toBeLessThanOrEqual(value.softMin);
        expect(value.softMin, `${boneName}.${axisName} softMin`).toBeLessThanOrEqual(0);
        expect(value.softMax, `${boneName}.${axisName} softMax`).toBeGreaterThanOrEqual(0);
        expect(value.softMax, `${boneName}.${axisName} softMax`).toBeLessThanOrEqual(value.hardMax);
        expect(Math.abs(value.hardMin)).toBeLessThanOrEqual(Math.PI);
        expect(Math.abs(value.hardMax)).toBeLessThanOrEqual(Math.PI);
      }
    }

    expect(getStudioVrmJointLimit("head").y.hardMax).toBeCloseTo(70 * Math.PI / 180, 12);
    expect(getStudioVrmJointLimit("leftLowerArm").z.hardMin).toBeCloseTo(-155 * Math.PI / 180, 12);
  });

  it("derives every right-side joint by the poser X/-Y/-Z mirror contract", () => {
    for (const [leftName, left] of Object.entries(STUDIO_VRM_JOINT_LIMITS)) {
      if (!leftName.startsWith("left")) continue;
      const rightName = `right${leftName.slice("left".length)}`;
      const right = getStudioVrmJointLimit(rightName);
      expect(right.x, `${leftName} x`).toEqual(left.x);
      expectMirroredAxis(left.y, right.y);
      expectMirroredAxis(left.z, right.z);
    }

    // The elbow flexion axis is intentionally asymmetric, making this more than a symmetric-data test.
    expect(getStudioVrmJointLimit("leftLowerArm").z.hardMin).toBeLessThan(-2);
    expect(getStudioVrmJointLimit("rightLowerArm").z.hardMax).toBeGreaterThan(2);
  });

  it("canonicalizes angles and malformed tuples without leaking NaN, infinity, or negative zero", () => {
    expect(canonicalizeStudioVrmJointAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 12);
    expect(canonicalizeStudioVrmJointAngle(-Math.PI * 4)).toBe(0);
    expect(canonicalizeStudioVrmJointAngle(Number.NaN)).toBe(0);
    expect(canonicalizeStudioVrmJointAngle(Number.POSITIVE_INFINITY)).toBe(0);
    expect(canonicalizeStudioVrmJointAngle("1")).toBe(0);
    expect(Object.is(canonicalizeStudioVrmJointAngle(-0), -0)).toBe(false);

    expect(canonicalizeStudioVrmJointRotation(null)).toEqual([0, 0, 0]);
    expect(canonicalizeStudioVrmJointRotation([0.25, Number.NaN, "0.5"])).toEqual([0.25, 0, 0]);
    expect(canonicalizeStudioVrmJointRotation([0.25])).toEqual([0.25, 0, 0]);
  });

  it("hard-clamps every axis at the exact joint boundary and does not mutate caller input", () => {
    const input = [2, -2, 2];
    const snapshot = [...input];
    const result = clampStudioVrmJointRotation("head", input);
    const limit = getStudioVrmJointLimit("head");

    expect(result[0]).toBeCloseTo(limit.x.hardMax, 12);
    expect(result[1]).toBeCloseTo(limit.y.hardMin, 12);
    expect(result[2]).toBeCloseTo(limit.z.hardMax, 12);
    expect(input).toEqual(snapshot);

    expect(clampStudioVrmJointRotation("head", [
      limit.x.hardMin,
      limit.y.hardMax,
      limit.z.hardMin,
    ])).toEqual([
      limit.x.hardMin,
      limit.y.hardMax,
      limit.z.hardMin,
    ]);
  });

  it("uses a safe generic range for unknown or malicious bone names", () => {
    expect(getStudioVrmJointLimit("tail")).toBe(STUDIO_VRM_FALLBACK_JOINT_LIMIT);
    expect(getStudioVrmJointLimit("__proto__")).toBe(STUDIO_VRM_FALLBACK_JOINT_LIMIT);
    expect(getStudioVrmJointLimit(null)).toBe(STUDIO_VRM_FALLBACK_JOINT_LIMIT);

    const result = clampStudioVrmJointRotation("futureExtensionBone", [2.8, -2.8, Number.NaN]);
    expect(result).toEqual([2.8, -2.8, 0]);
    expect(result.every(Number.isFinite)).toBe(true);
  });

  it("keeps rotations inside the soft range unchanged and reports unit damping", () => {
    const rotation = [0.1, -0.2, 0.15] as const;
    expect(getStudioVrmJointSoftLimitDamping("head", rotation)).toEqual([1, 1, 1]);
    expect(dampStudioVrmJointRotation("head", rotation)).toEqual(rotation);
  });

  it("progressively resists the soft-to-hard zone while remaining inside hard limits", () => {
    const limit = getStudioVrmJointLimit("leftLowerArm").z;
    const requested = limit.softMin + (limit.hardMin - limit.softMin) * 0.8;
    const lightlyDamped = dampStudioVrmJointRotation("leftLowerArm", [0, 0, requested], 0.25)[2];
    const stronglyDamped = dampStudioVrmJointRotation("leftLowerArm", [0, 0, requested], 1)[2];
    const factor = getStudioVrmJointSoftLimitDamping("leftLowerArm", [0, 0, requested], 1)[2];

    expect(factor).toBeGreaterThan(0);
    expect(factor).toBeLessThan(1);
    expect(lightlyDamped).toBeGreaterThan(requested);
    expect(lightlyDamped).toBeLessThan(limit.softMin);
    expect(stronglyDamped).toBeGreaterThan(lightlyDamped);
    expect(stronglyDamped).toBeLessThan(limit.softMin);

    expect(dampStudioVrmJointRotation("leftLowerArm", [0, 0, -Math.PI], 0)[2])
      .toBeCloseTo(limit.hardMin, 12);
    expect(dampStudioVrmJointRotation("leftLowerArm", [0, 0, -Math.PI], 1)[2])
      .toBeGreaterThan(limit.hardMin);
  });

  it("produces mirrored soft damping and finite safe outputs for malformed parameters", () => {
    const leftInput = [0.4, 0.2, -2.5] as const;
    const rightInput = [leftInput[0], -leftInput[1], -leftInput[2]] as const;
    const left = dampStudioVrmJointRotation("leftLowerArm", leftInput, 0.7);
    const right = dampStudioVrmJointRotation("rightLowerArm", rightInput, 0.7);

    expect(right[0]).toBeCloseTo(left[0], 12);
    expect(right[1]).toBeCloseTo(-left[1], 12);
    expect(right[2]).toBeCloseTo(-left[2], 12);

    const malformed = dampStudioVrmJointRotation({}, [Number.NaN, Number.POSITIVE_INFINITY], Number.NaN);
    expect(malformed).toEqual([0, 0, 0]);
    expect(getStudioVrmJointSoftLimitDamping("head", [Number.NaN, null, undefined], "strong")
      .every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
  });
});
