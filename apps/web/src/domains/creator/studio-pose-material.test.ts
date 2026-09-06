import { describe, expect, it } from "vitest";

import {
  STUDIO_POSE_MATERIAL_KIND,
  STUDIO_POSE_MATERIAL_MAX_BYTES,
  STUDIO_POSE_MATERIAL_MAX_DESCRIPTION_LENGTH,
  STUDIO_POSE_MATERIAL_MAX_NAME_LENGTH,
  STUDIO_POSE_MATERIAL_MAX_TAG_LENGTH,
  STUDIO_POSE_MATERIAL_MAX_TAGS,
  STUDIO_POSE_MATERIAL_VERSION,
  STUDIO_POSE_ROTATION_CONVENTION,
  canonicalizeStudioPoseQuaternion,
  createStudioPoseMaterialMergePlan,
  parseStudioPoseMaterial,
  serializeStudioPoseMaterial,
  type StudioPoseMaterial,
} from "./studio-pose-material";

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

function parsed(raw: unknown): StudioPoseMaterial {
  const result = parseStudioPoseMaterial(raw);
  expect(result).not.toBeNull();
  if (!result) throw new Error("Invalid pose material test fixture.");
  return result;
}

describe("Studio pose material quaternion contract", () => {
  it("normalizes q and -q to one frozen canonical hemisphere", () => {
    const q = canonicalizeStudioPoseQuaternion([1, -2, 3, -4]);
    const negativeQ = canonicalizeStudioPoseQuaternion([-1, 2, -3, 4]);
    expect(q).toEqual(negativeQ);
    expect(Math.hypot(...(q ?? [0, 0, 0, 0]))).toBeCloseTo(1, 14);
    expect(q?.[3]).toBeGreaterThan(0);
    expect(Object.isFrozen(q)).toBe(true);
  });

  it("uses z/y/x as deterministic tie-breakers when w is zero and removes negative zero", () => {
    expect(canonicalizeStudioPoseQuaternion([0, 0, -2, 0])).toEqual([0, 0, 1, 0]);
    expect(canonicalizeStudioPoseQuaternion([-0, -2, 0, -0])).toEqual([0, 1, 0, 0]);
    expect(Object.is(canonicalizeStudioPoseQuaternion([-0, -2, 0, -0])?.[0], -0)).toBe(false);
  });

  it("rejects zero, non-finite, sparse, and wrong-shaped quaternions", () => {
    expect(canonicalizeStudioPoseQuaternion([0, 0, 0, 0])).toBeNull();
    expect(canonicalizeStudioPoseQuaternion([Number.NaN, 0, 0, 1])).toBeNull();
    expect(canonicalizeStudioPoseQuaternion([0, 0, 0, Number.POSITIVE_INFINITY])).toBeNull();
    expect(canonicalizeStudioPoseQuaternion([0, 0, 1])).toBeNull();
    expect(canonicalizeStudioPoseQuaternion(new Array(4))).toBeNull();
  });

  it("does not invoke quaternion array accessors", () => {
    let invoked = false;
    const hostile = [0, 0, 0, 1];
    Object.defineProperty(hostile, "0", {
      enumerable: true,
      get() {
        invoked = true;
        return 0;
      },
    });
    expect(canonicalizeStudioPoseQuaternion(hostile)).toBeNull();
    expect(invoked).toBe(false);
  });
});

describe("Studio pose material strict v1 boundary", () => {
  it("locks exact portable normalized-local quaternion semantics into the wire schema", () => {
    const result = parsed(material());
    expect(Object.keys(result)).toEqual([
      "kind",
      "version",
      "rotationConvention",
      "id",
      "name",
      "scope",
      "bones",
      "metadata",
    ]);
    expect(Object.keys(result.rotationConvention)).toEqual([
      "componentOrder",
      "coordinateSystem",
      "humanoidRig",
      "transformSpace",
      "referencePose",
      "composition",
    ]);
    expect(result.rotationConvention).toEqual({
      componentOrder: "xyzw",
      coordinateSystem: "right-handed",
      humanoidRig: "vrm-normalized",
      transformSpace: "bone-local",
      referencePose: "rest-relative",
      composition: "delta-times-rest",
    });
    expect(result.rotationConvention).toBe(STUDIO_POSE_ROTATION_CONVENTION);
    expect(Object.isFrozen(result.rotationConvention)).toBe(true);

    const invalidConventions = [
      undefined,
      { ...STUDIO_POSE_ROTATION_CONVENTION, componentOrder: "wxyz" },
      { ...STUDIO_POSE_ROTATION_CONVENTION, coordinateSystem: "left-handed" },
      { ...STUDIO_POSE_ROTATION_CONVENTION, humanoidRig: "raw-model" },
      { ...STUDIO_POSE_ROTATION_CONVENTION, transformSpace: "world" },
      { ...STUDIO_POSE_ROTATION_CONVENTION, referencePose: "absolute" },
      { ...STUDIO_POSE_ROTATION_CONVENTION, composition: "rest-times-delta" },
      { ...STUDIO_POSE_ROTATION_CONVENTION, extra: true },
    ];
    for (const rotationConvention of invalidConventions) {
      expect(parseStudioPoseMaterial({ ...material(), rotationConvention })).toBeNull();
    }
  });

  it("canonicalizes topology/tag order and deeply freezes every nested value", () => {
    const result = parsed(material());
    expect(result.bones.map((entry) => entry.bone)).toEqual([
      "hips",
      "leftEye",
      "leftHand",
      "leftIndexProximal",
      "rightHand",
    ]);
    expect(result.bones.at(-1)?.rotation).toEqual([0, 0, 0, 1]);
    expect(result.metadata.tags).toEqual(["웹툰", "인사"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.bones)).toBe(true);
    expect(Object.isFrozen(result.bones[0]?.rotation)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(Object.isFrozen(result.metadata.tags)).toBe(true);
  });

  it("serializes q and -q and arbitrary input order identically", () => {
    const positive = material({
      bones: [
        { bone: "head", rotation: [1, 2, 3, 4] },
        { bone: "hips", rotation: [0, 0, 0, 1] },
      ],
      metadata: { description: "", tags: ["B", "A"] },
    });
    const negative = material({
      bones: [
        { bone: "hips", rotation: [0, 0, 0, -1] },
        { bone: "head", rotation: [-1, -2, -3, -4] },
      ],
      metadata: { description: "", tags: ["A", "B"] },
    });
    expect(serializeStudioPoseMaterial(positive)).toBe(serializeStudioPoseMaterial(negative));
  });

  it("round-trips canonical JSON and preserves caller-owned identity", () => {
    const wire = serializeStudioPoseMaterial(material({ id: "User.Pose~01" }));
    expect(wire).not.toBeNull();
    const result = parsed(wire);
    expect(result.id).toBe("User.Pose~01");
    expect(serializeStudioPoseMaterial(result)).toBe(wire);
  });

  it("rejects duplicate/unknown/out-of-scope bones and invalid numeric rotations", () => {
    const invalid = [
      material({
        bones: [
          { bone: "head", rotation: [0, 0, 0, 1] },
          { bone: "head", rotation: [0, 0, 0, 1] },
        ],
      }),
      material({ bones: [{ bone: "sceneRoot" as "hips", rotation: [0, 0, 0, 1] }] }),
      material({ scope: "upper", bones: [{ bone: "hips", rotation: [0, 0, 0, 1] }] }),
      material({ bones: [{ bone: "head", rotation: [0, 0, 0, 0] }] }),
      material({ bones: [{ bone: "head", rotation: [Number.NaN, 0, 0, 1] }] }),
    ];
    for (const raw of invalid) expect(parseStudioPoseMaterial(raw)).toBeNull();
  });

  it("rejects unknown fields at every schema level and future versions", () => {
    expect(parseStudioPoseMaterial({ ...material(), extra: true })).toBeNull();
    expect(
      parseStudioPoseMaterial({
        ...material(),
        bones: [{ ...material().bones[0], translation: [0, 0, 0] }],
      })
    ).toBeNull();
    expect(
      parseStudioPoseMaterial({
        ...material(),
        metadata: { ...material().metadata, sourceUrl: "https://example.test" },
      })
    ).toBeNull();
    expect(parseStudioPoseMaterial({ ...material(), version: 2 })).toBeNull();
  });

  it("rejects control characters, URL-like metadata, duplicate tags, and noncanonical text", () => {
    const invalid = [
      material({ name: "위험\u0000이름" }),
      material({ name: "https://example.test/pose" }),
      material({ metadata: { description: "data:text/html,bad", tags: [] } }),
      material({ metadata: { description: "", tags: ["www.example.test"] } }),
      material({ metadata: { description: "", tags: ["태그", "태그"] } }),
      material({ metadata: { description: "", tags: ["TAG", "tag"] } }),
      material({ name: " 앞뒤 공백 " }),
      material({ metadata: { description: "두  칸", tags: [] } }),
    ];
    for (const raw of invalid) expect(parseStudioPoseMaterial(raw)).toBeNull();
  });

  it("rejects every oversized metadata dimension", () => {
    const invalid = [
      material({ name: "가".repeat(STUDIO_POSE_MATERIAL_MAX_NAME_LENGTH + 1) }),
      material({
        metadata: {
          description: "가".repeat(STUDIO_POSE_MATERIAL_MAX_DESCRIPTION_LENGTH + 1),
          tags: [],
        },
      }),
      material({
        metadata: {
          description: "",
          tags: Array.from({ length: STUDIO_POSE_MATERIAL_MAX_TAGS + 1 }, (_, index) => `태그${index}`),
        },
      }),
      material({
        metadata: {
          description: "",
          tags: ["가".repeat(STUDIO_POSE_MATERIAL_MAX_TAG_LENGTH + 1)],
        },
      }),
      material({ metadata: { description: "줄바꿈\n거부", tags: [] } }),
    ];
    for (const raw of invalid) expect(parseStudioPoseMaterial(raw)).toBeNull();
  });

  it("rejects malformed and oversized JSON before material traversal", () => {
    expect(parseStudioPoseMaterial("{bad-json")).toBeNull();
    expect(parseStudioPoseMaterial(" ".repeat(STUDIO_POSE_MATERIAL_MAX_BYTES + 1))).toBeNull();
    expect(parseStudioPoseMaterial([])).toBeNull();
  });

  it("does not invoke object accessors", () => {
    let invoked = false;
    const hostile = { ...material() } as Record<string, unknown>;
    Object.defineProperty(hostile, "name", {
      enumerable: true,
      get() {
        invoked = true;
        return "호출되면 안 됨";
      },
    });
    expect(parseStudioPoseMaterial(hostile)).toBeNull();
    expect(invoked).toBe(false);
  });
});

describe("Studio pose material scope and locked-bone merge plan", () => {
  it("emits only the requested scope and reports locked/outside bones separately", () => {
    const plan = createStudioPoseMaterialMergePlan(material(), {
      scope: "left-hand",
      lockedBones: ["leftIndexProximal"],
    });
    expect(plan).not.toBeNull();
    expect(plan).toMatchObject({
      materialId: "pose.hero-wave",
      materialScope: "full",
      requestedScope: "left-hand",
      rotationConvention: STUDIO_POSE_ROTATION_CONVENTION,
      skippedLocked: ["leftIndexProximal"],
      skippedOutsideScope: ["hips", "leftEye", "rightHand"],
    });
    expect(plan?.operations.map((entry) => entry.bone)).toEqual(["leftHand"]);
    expect(plan?.operations[0]?.rotation).toEqual(parsed(material()).bones[2]?.rotation);
    expect(Object.isFrozen(plan?.operations[0]?.rotation)).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan?.operations)).toBe(true);
  });

  it("defaults to the authored scope and can lock every emitted bone", () => {
    const hand = material({
      scope: "right-hand",
      bones: [
        { bone: "rightHand", rotation: [0, 0, 0, 1] },
        { bone: "rightThumbProximal", rotation: [0.2, 0, 0, 1] },
      ],
    });
    const plan = createStudioPoseMaterialMergePlan(hand, {
      lockedBones: ["rightHand", "rightThumbProximal"],
    });
    expect(plan?.requestedScope).toBe("right-hand");
    expect(plan?.operations).toEqual([]);
    expect(plan?.skippedLocked).toEqual(["rightHand", "rightThumbProximal"]);
    expect(plan?.skippedOutsideScope).toEqual([]);
  });

  it("rejects unknown option fields, duplicate locks, and arbitrary node locks", () => {
    expect(
      createStudioPoseMaterialMergePlan(material(), { scope: "full", extra: true } as never)
    ).toBeNull();
    expect(
      createStudioPoseMaterialMergePlan(material(), {
        lockedBones: ["head", "head"],
      })
    ).toBeNull();
    expect(
      createStudioPoseMaterialMergePlan(material(), {
        lockedBones: ["Armature/Hips" as "hips"],
      })
    ).toBeNull();
  });
});
