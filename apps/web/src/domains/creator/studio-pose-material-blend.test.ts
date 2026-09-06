import { describe, expect, it } from "vitest";

import {
  STUDIO_POSE_MATERIAL_KIND,
  STUDIO_POSE_MATERIAL_VERSION,
  STUDIO_POSE_ROTATION_CONVENTION,
  createStudioPoseMaterialMergePlan,
  parseStudioPoseMaterial,
  type StudioPoseMaterial,
  type StudioPoseMaterialMergePlan,
  type StudioPoseQuaternion,
} from "./studio-pose-material";
import {
  blendStudioPoseMaterialMergePlan,
  clampStudioPoseMaterialStrength,
  createStudioPoseMaterialStrengthMergePlan,
} from "./studio-pose-material-blend";

function material(
  overrides: Partial<StudioPoseMaterial> = {}
): StudioPoseMaterial {
  return {
    kind: STUDIO_POSE_MATERIAL_KIND,
    version: STUDIO_POSE_MATERIAL_VERSION,
    rotationConvention: STUDIO_POSE_ROTATION_CONVENTION,
    id: "pose.hero-wave",
    name: "주인공 손인사",
    scope: "full",
    bones: [
      { bone: "rightHand", rotation: [0, 0, 0, -2] },
      { bone: "hips", rotation: [0, 0.2, 0, 0.98] },
      { bone: "leftIndexProximal", rotation: [0.2, 0, 0, 1] },
      { bone: "leftHand", rotation: [1, 2, 3, 4] },
      { bone: "leftEye", rotation: [0, 0.1, 0, 1] },
    ],
    metadata: { description: "마감용 자연스러운 인사 자세", tags: ["웹툰", "인사"] },
    ...overrides,
  };
}

function parsedMaterial(): StudioPoseMaterial {
  const result = parseStudioPoseMaterial(material());
  expect(result).not.toBeNull();
  if (!result) throw new Error("Invalid pose material test fixture.");
  return result;
}

function basePlan(): StudioPoseMaterialMergePlan {
  const plan = createStudioPoseMaterialMergePlan(material(), {
    scope: "left-hand",
    lockedBones: ["leftIndexProximal"],
  });
  expect(plan).not.toBeNull();
  if (!plan) throw new Error("Invalid merge plan test fixture.");
  return plan;
}

function quatNorm(q: StudioPoseQuaternion): number {
  return Math.hypot(q[0], q[1], q[2], q[3]);
}

function quatDot(a: StudioPoseQuaternion, b: StudioPoseQuaternion): number {
  return Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
}

describe("clampStudioPoseMaterialStrength", () => {
  it("clamps to [0, 1] and fails closed for non-finite values", () => {
    expect(clampStudioPoseMaterialStrength(-2)).toBe(0);
    expect(clampStudioPoseMaterialStrength(0)).toBe(0);
    expect(clampStudioPoseMaterialStrength(0.25)).toBe(0.25);
    expect(clampStudioPoseMaterialStrength(1)).toBe(1);
    expect(clampStudioPoseMaterialStrength(4)).toBe(1);
    expect(clampStudioPoseMaterialStrength(Number.NaN)).toBe(0);
    expect(clampStudioPoseMaterialStrength(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("blendStudioPoseMaterialMergePlan", () => {
  it("returns the original rotations at strength 1 and freezes the result", () => {
    const plan = basePlan();
    const blended = blendStudioPoseMaterialMergePlan(plan, 1);
    expect(blended.materialId).toBe(plan.materialId);
    expect(blended.materialScope).toBe(plan.materialScope);
    expect(blended.requestedScope).toBe(plan.requestedScope);
    expect(blended.rotationConvention).toBe(STUDIO_POSE_ROTATION_CONVENTION);
    expect(blended.skippedLocked).toEqual(plan.skippedLocked);
    expect(blended.skippedOutsideScope).toEqual(plan.skippedOutsideScope);
    expect(blended.operations.map((entry) => entry.bone)).toEqual(
      plan.operations.map((entry) => entry.bone)
    );
    for (let index = 0; index < plan.operations.length; index += 1) {
      expect(blended.operations[index]?.rotation).toEqual(plan.operations[index]?.rotation);
      expect(quatNorm(blended.operations[index]!.rotation)).toBeCloseTo(1, 12);
    }
    expect(Object.isFrozen(blended)).toBe(true);
    expect(Object.isFrozen(blended.operations)).toBe(true);
    expect(Object.isFrozen(blended.operations[0]?.rotation)).toBe(true);
    expect(Object.isFrozen(blended.skippedLocked)).toBe(true);
  });

  it("slerps every operation from identity at strength 0", () => {
    const plan = basePlan();
    const blended = blendStudioPoseMaterialMergePlan(plan, 0);
    expect(blended.operations).toHaveLength(plan.operations.length);
    for (const operation of blended.operations) {
      expect(operation.rotation).toEqual([0, 0, 0, 1]);
    }
    expect(blended.skippedLocked).toEqual(plan.skippedLocked);
    expect(blended.skippedOutsideScope).toEqual(plan.skippedOutsideScope);
  });

  it("empties operations at strength 0 when restIdentity is true", () => {
    const plan = basePlan();
    const blended = blendStudioPoseMaterialMergePlan(plan, 0, true);
    expect(blended.operations).toEqual([]);
    expect(blended.skippedLocked).toEqual(["leftIndexProximal"]);
    expect(blended.skippedOutsideScope).toEqual(["hips", "leftEye", "rightHand"]);
  });

  it("produces intermediate unit quaternions at partial strength", () => {
    const plan = basePlan();
    const original = plan.operations[0]!.rotation;
    const half = blendStudioPoseMaterialMergePlan(plan, 0.5);
    const blended = half.operations[0]!.rotation;
    expect(quatNorm(blended)).toBeCloseTo(1, 12);
    // Half blend should sit between identity and the original on the short arc.
    expect(quatDot(blended, [0, 0, 0, 1])).toBeGreaterThan(quatDot(original, [0, 0, 0, 1]));
    expect(quatDot(blended, original)).toBeGreaterThan(quatDot([0, 0, 0, 1], original) - 1e-9);

    const quarter = blendStudioPoseMaterialMergePlan(plan, 0.25).operations[0]!.rotation;
    const threeQuarters = blendStudioPoseMaterialMergePlan(plan, 0.75).operations[0]!.rotation;
    expect(quatDot(quarter, [0, 0, 0, 1])).toBeGreaterThan(quatDot(half.operations[0]!.rotation, [0, 0, 0, 1]));
    expect(quatDot(threeQuarters, original)).toBeGreaterThan(quatDot(half.operations[0]!.rotation, original));
  });

  it("clamps out-of-range strength and does not mutate the source plan", () => {
    const plan = basePlan();
    const before = JSON.stringify(plan);
    const over = blendStudioPoseMaterialMergePlan(plan, 2);
    const under = blendStudioPoseMaterialMergePlan(plan, -1);
    expect(over.operations[0]?.rotation).toEqual(plan.operations[0]?.rotation);
    expect(under.operations[0]?.rotation).toEqual([0, 0, 0, 1]);
    expect(JSON.stringify(plan)).toBe(before);
  });
});

describe("createStudioPoseMaterialStrengthMergePlan", () => {
  it("builds a scoped plan and blends by strength without rejecting the strength option", () => {
    const plan = createStudioPoseMaterialStrengthMergePlan(material(), {
      scope: "left-hand",
      lockedBones: ["leftIndexProximal"],
      strength: 0,
    });
    expect(plan).not.toBeNull();
    expect(plan?.requestedScope).toBe("left-hand");
    expect(plan?.skippedLocked).toEqual(["leftIndexProximal"]);
    expect(plan?.operations.map((entry) => entry.bone)).toEqual(["leftHand"]);
    expect(plan?.operations[0]?.rotation).toEqual([0, 0, 0, 1]);
  });

  it("defaults strength to 1 so the full authored plan is preserved", () => {
    const full = createStudioPoseMaterialMergePlan(parsedMaterial());
    const withDefault = createStudioPoseMaterialStrengthMergePlan(parsedMaterial());
    expect(withDefault?.operations).toEqual(full?.operations);
  });

  it("strips strength (and unknown keys) before merge planning and still rejects bad locks", () => {
    expect(
      createStudioPoseMaterialStrengthMergePlan(material(), {
        scope: "full",
        strength: 0.5,
        extra: true,
      } as never)
    ).not.toBeNull();
    expect(
      createStudioPoseMaterialStrengthMergePlan(material(), {
        lockedBones: ["head", "head"],
        strength: 0.5,
      })
    ).toBeNull();
  });

  it("returns null for invalid materials", () => {
    expect(createStudioPoseMaterialStrengthMergePlan({ kind: "nope" }, { strength: 0.5 })).toBeNull();
  });
});
