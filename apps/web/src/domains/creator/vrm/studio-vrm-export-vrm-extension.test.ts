import { describe, expect, it } from "vitest";

import { STUDIO_HUMANOID_BONE_NAMES } from "../studio-humanoid-bones";

import { StudioVrmExportError } from "./studio-vrm-export-error";
import {
  buildStudioVrmcMToonExtension,
  buildStudioVrmcSpringBoneExtension,
  buildStudioVrmcVrmExtension,
  buildStudioVrmExportExpressions,
  buildStudioVrmExportHumanoid,
  buildStudioVrmExportMeta,
  STUDIO_VRM_EXPORT_EXPRESSION_PRESETS,
  STUDIO_VRM_EXPORT_LICENSE_URL,
  STUDIO_VRM_EXPORT_REQUIRED_BONES,
  STUDIO_VRM_EXPORT_SPEC_VERSION,
  type StudioVrmExportHumanoidBones,
  type StudioVrmExportMeta,
  type StudioVrmExtensionContext,
} from "./studio-vrm-export-vrm-extension";

const NODE_COUNT = 64;

function context(overrides: Partial<StudioVrmExtensionContext> = {}): StudioVrmExtensionContext {
  return {
    nodeCount: NODE_COUNT,
    imageCount: 1,
    morphTargetCountByNode: new Array<number | null>(NODE_COUNT).fill(null),
    ...overrides,
  };
}

function completeBones(): StudioVrmExportHumanoidBones {
  return Object.fromEntries(
    STUDIO_VRM_EXPORT_REQUIRED_BONES.map((bone, index) => [bone, index]),
  ) as StudioVrmExportHumanoidBones;
}

function validMeta(overrides: Partial<StudioVrmExportMeta> = {}): StudioVrmExportMeta {
  return { name: "루미", authors: ["ToonSpectrum"], ...overrides };
}

function caught(run: () => unknown): StudioVrmExportError {
  try {
    run();
  } catch (error) {
    if (error instanceof StudioVrmExportError) return error;
    throw error;
  }
  return expect.unreachable("expected a StudioVrmExportError") as never;
}

describe("buildStudioVrmExportMeta", () => {
  it("emits the three mandatory VRM 1.0 licence fields", () => {
    const meta = buildStudioVrmExportMeta(validMeta(), { imageCount: 0 });
    expect(meta.name).toBe("루미");
    expect(meta.authors).toEqual(["ToonSpectrum"]);
    expect(meta.licenseUrl).toBe(STUDIO_VRM_EXPORT_LICENSE_URL);
  });

  it("fails with an honest Korean message when the model name is missing", () => {
    const error = caught(() =>
      buildStudioVrmExportMeta({ name: "   ", authors: ["a"] }, { imageCount: 0 }),
    );
    expect(error.code).toBe("meta-name-missing");
    expect(error.message).toContain("모델 이름은 필수입니다");
  });

  it("fails when authors is empty or contains a blank entry", () => {
    expect(caught(() => buildStudioVrmExportMeta({ name: "a", authors: [] }, { imageCount: 0 })).code).toBe(
      "meta-authors-missing",
    );
    expect(
      caught(() => buildStudioVrmExportMeta({ name: "a", authors: [""] }, { imageCount: 0 })).code,
    ).toBe("meta-authors-missing");
  });

  it("rejects any licence URL other than the one three-vrm accepts", () => {
    const error = caught(() =>
      buildStudioVrmExportMeta(validMeta({ licenseUrl: "https://example.com/licence" }), {
        imageCount: 0,
      }),
    );
    expect(error.code).toBe("meta-license-url-invalid");
    expect(error.details?.expectedLicenseUrl).toBe(STUDIO_VRM_EXPORT_LICENSE_URL);
    expect(error.message).toContain("https://vrm.dev/licenses/1.0/");
  });

  it("accepts the canonical licence URL when passed explicitly", () => {
    const meta = buildStudioVrmExportMeta(
      validMeta({ licenseUrl: STUDIO_VRM_EXPORT_LICENSE_URL, otherLicenseUrl: "https://example.com" }),
      { imageCount: 0 },
    );
    expect(meta.otherLicenseUrl).toBe("https://example.com");
  });

  it("validates permission enums and rejects unknown values", () => {
    const meta = buildStudioVrmExportMeta(
      validMeta({
        avatarPermission: "everyone",
        commercialUsage: "corporation",
        creditNotation: "required",
        modification: "allowModificationRedistribution",
        allowRedistribution: true,
      }),
      { imageCount: 0 },
    );
    expect(meta.avatarPermission).toBe("everyone");
    expect(meta.allowRedistribution).toBe(true);

    expect(
      caught(() =>
        buildStudioVrmExportMeta(
          validMeta({ avatarPermission: "anyone" as never }),
          { imageCount: 0 },
        ),
      ).code,
    ).toBe("meta-field-invalid");
  });

  it("rejects a thumbnail index outside the image table", () => {
    expect(
      caught(() => buildStudioVrmExportMeta(validMeta({ thumbnailImage: 3 }), { imageCount: 1 })).code,
    ).toBe("meta-thumbnail-invalid");
    expect(buildStudioVrmExportMeta(validMeta({ thumbnailImage: 0 }), { imageCount: 1 }).thumbnailImage).toBe(0);
  });
});

describe("buildStudioVrmExportHumanoid", () => {
  it("uses the same 55-bone vocabulary as VRM 1.0", () => {
    expect(STUDIO_HUMANOID_BONE_NAMES).toHaveLength(55);
    for (const bone of STUDIO_VRM_EXPORT_REQUIRED_BONES) {
      expect(STUDIO_HUMANOID_BONE_NAMES).toContain(bone);
    }
    expect(STUDIO_VRM_EXPORT_REQUIRED_BONES).toHaveLength(15);
  });

  it("maps every supplied bone to a node record", () => {
    const humanoid = buildStudioVrmExportHumanoid(completeBones(), { nodeCount: NODE_COUNT });
    const humanBones = humanoid.humanBones as Record<string, { node: number }>;
    expect(Object.keys(humanBones)).toHaveLength(15);
    expect(humanBones.hips).toEqual({ node: 0 });
  });

  it("lists exactly the missing required bones in the error details", () => {
    const bones = { ...completeBones() } as Record<string, number>;
    delete bones.leftHand;
    delete bones.spine;
    const error = caught(() =>
      buildStudioVrmExportHumanoid(bones as StudioVrmExportHumanoidBones, { nodeCount: NODE_COUNT }),
    );
    expect(error.code).toBe("humanoid-bone-missing");
    expect(error.details?.missingBones).toEqual(["spine", "leftHand"]);
    expect(error.message).toContain("필수 휴머노이드 본");
  });

  it("rejects a bone pointing outside the node table", () => {
    const error = caught(() =>
      buildStudioVrmExportHumanoid({ ...completeBones(), hips: NODE_COUNT }, { nodeCount: NODE_COUNT }),
    );
    expect(error.code).toBe("humanoid-node-invalid");
    expect(error.details?.bone).toBe("hips");
  });

  it("rejects two bones claiming the same node", () => {
    const error = caught(() =>
      buildStudioVrmExportHumanoid({ ...completeBones(), spine: 0 }, { nodeCount: NODE_COUNT }),
    );
    expect(error.code).toBe("humanoid-node-duplicate");
    expect(error.details?.conflictsWith).toBe("hips");
  });

  it("rejects an unknown bone name instead of forwarding it into the document", () => {
    const error = caught(() =>
      buildStudioVrmExportHumanoid(
        { ...completeBones(), tail: 40 } as unknown as StudioVrmExportHumanoidBones,
        { nodeCount: NODE_COUNT },
      ),
    );
    expect(error.code).toBe("humanoid-node-invalid");
    expect(error.details?.bone).toBe("tail");
  });

  it("emits bones in canonical topology order regardless of caller key order", () => {
    const reversed = Object.fromEntries(
      [...STUDIO_VRM_EXPORT_REQUIRED_BONES].reverse().map((bone, index) => [bone, 14 - index]),
    ) as StudioVrmExportHumanoidBones;
    const forward = buildStudioVrmExportHumanoid(completeBones(), { nodeCount: NODE_COUNT });
    const backward = buildStudioVrmExportHumanoid(reversed, { nodeCount: NODE_COUNT });
    expect(Object.keys(backward.humanBones as object)).toEqual(Object.keys(forward.humanBones as object));
  });
});

describe("buildStudioVrmExportExpressions", () => {
  const morphContext = context({
    morphTargetCountByNode: [2, null, ...new Array<number | null>(NODE_COUNT - 2).fill(null)],
  });

  it("returns undefined when nothing is configured", () => {
    expect(buildStudioVrmExportExpressions(undefined, morphContext)).toBeUndefined();
    expect(buildStudioVrmExportExpressions({ preset: {} }, morphContext)).toBeUndefined();
  });

  it("emits preset expressions in canonical preset order", () => {
    const result = buildStudioVrmExportExpressions(
      { preset: { blink: { isBinary: true }, happy: { morphTargetBinds: [{ node: 0, index: 1, weight: 1 }] } } },
      morphContext,
    );
    const preset = result?.preset as Record<string, unknown>;
    expect(Object.keys(preset)).toEqual(["happy", "blink"]);
    expect((preset.happy as { preset: string }).preset).toBe("happy");
  });

  it("rejects a morph bind whose target index does not exist on that node", () => {
    expect(
      caught(() =>
        buildStudioVrmExportExpressions(
          { preset: { happy: { morphTargetBinds: [{ node: 0, index: 2, weight: 1 }] } } },
          morphContext,
        ),
      ).code,
    ).toBe("expression-invalid");
  });

  it("rejects a morph bind on a node without a mesh, and an out-of-range weight", () => {
    expect(
      caught(() =>
        buildStudioVrmExportExpressions(
          { preset: { happy: { morphTargetBinds: [{ node: 1, index: 0, weight: 1 }] } } },
          morphContext,
        ),
      ).code,
    ).toBe("expression-invalid");
    expect(
      caught(() =>
        buildStudioVrmExportExpressions(
          { preset: { happy: { morphTargetBinds: [{ node: 0, index: 0, weight: 1.5 }] } } },
          morphContext,
        ),
      ).code,
    ).toBe("expression-invalid");
  });

  it("rejects an unknown preset key and a custom name that shadows a preset", () => {
    expect(
      caught(() =>
        buildStudioVrmExportExpressions({ preset: { smile: {} } as never }, morphContext),
      ).code,
    ).toBe("expression-invalid");
    expect(
      caught(() => buildStudioVrmExportExpressions({ custom: { blink: {} } }, morphContext)).code,
    ).toBe("expression-invalid");
  });

  it("covers every VRM 1.0 preset name", () => {
    expect(STUDIO_VRM_EXPORT_EXPRESSION_PRESETS).toHaveLength(18);
    const result = buildStudioVrmExportExpressions(
      { preset: Object.fromEntries(STUDIO_VRM_EXPORT_EXPRESSION_PRESETS.map((name) => [name, {}])) },
      morphContext,
    );
    expect(Object.keys(result?.preset as object)).toEqual([...STUDIO_VRM_EXPORT_EXPRESSION_PRESETS]);
  });
});

describe("buildStudioVrmcSpringBoneExtension", () => {
  it("returns undefined for an absent or empty configuration", () => {
    expect(buildStudioVrmcSpringBoneExtension(undefined, { nodeCount: NODE_COUNT })).toBeUndefined();
    expect(buildStudioVrmcSpringBoneExtension({}, { nodeCount: NODE_COUNT })).toBeUndefined();
  });

  it("emits sphere and capsule colliders in the VRMC_springBone shape", () => {
    const extension = buildStudioVrmcSpringBoneExtension(
      {
        colliders: [
          { node: 1, shape: "sphere", offset: [0, 0.1, 0], radius: 0.05 },
          { node: 2, shape: "capsule", offset: [0, 0, 0], radius: 0.02, tail: [0, 0.2, 0] },
        ],
        colliderGroups: [{ name: "머리", colliders: [0, 1] }],
        springs: [
          {
            name: "앞머리",
            joints: [
              { node: 3, hitRadius: 0.01, stiffness: 1, gravityPower: 0, dragForce: 0.4 },
              { node: 4, hitRadius: 0.01, stiffness: 1, gravityPower: 0, dragForce: 0.4 },
            ],
            colliderGroups: [0],
            center: 1,
          },
        ],
      },
      { nodeCount: NODE_COUNT },
    );
    expect(extension?.specVersion).toBe(STUDIO_VRM_EXPORT_SPEC_VERSION);
    const colliders = extension?.colliders as { shape: Record<string, unknown> }[];
    expect(colliders[0]?.shape).toHaveProperty("sphere");
    expect(colliders[1]?.shape).toHaveProperty("capsule");
    expect((extension?.springs as { joints: unknown[] }[])[0]?.joints).toHaveLength(2);
  });

  it("rejects out-of-range physics values and dangling references", () => {
    const base = {
      springs: [
        { joints: [{ node: 3, hitRadius: 0.01, stiffness: 1, gravityPower: 0, dragForce: 0.4 }] },
      ],
    };
    expect(
      caught(() =>
        buildStudioVrmcSpringBoneExtension(
          {
            springs: [
              { joints: [{ node: 3, hitRadius: 0.01, stiffness: 1, gravityPower: 0, dragForce: 1.5 }] },
            ],
          },
          { nodeCount: NODE_COUNT },
        ),
      ).code,
    ).toBe("spring-bone-invalid");
    expect(
      caught(() =>
        buildStudioVrmcSpringBoneExtension(
          { ...base, springs: [{ ...base.springs[0], colliderGroups: [0] }] },
          { nodeCount: NODE_COUNT },
        ),
      ).code,
    ).toBe("spring-bone-invalid");
    expect(
      caught(() =>
        buildStudioVrmcSpringBoneExtension(
          {
            springs: [
              { joints: [{ node: NODE_COUNT, hitRadius: 0.01, stiffness: 1, gravityPower: 0, dragForce: 0.4 }] },
            ],
          },
          { nodeCount: NODE_COUNT },
        ),
      ).code,
    ).toBe("spring-bone-invalid");
  });
});

describe("buildStudioVrmcMToonExtension", () => {
  it("emits the spec version and the supplied toon parameters", () => {
    const mtoon = buildStudioVrmcMToonExtension({
      shadeColorFactor: [0.8, 0.7, 0.9],
      shadingToonyFactor: 0.9,
      outlineWidthMode: "worldCoordinates",
      outlineWidthFactor: 0.02,
      outlineColorFactor: [0, 0, 0],
      transparentWithZWrite: true,
      renderQueueOffsetNumber: -1,
    });
    expect(mtoon.specVersion).toBe(STUDIO_VRM_EXPORT_SPEC_VERSION);
    expect(mtoon.shadeColorFactor).toEqual([0.8, 0.7, 0.9]);
    expect(mtoon.outlineWidthMode).toBe("worldCoordinates");
    expect(mtoon.renderQueueOffsetNumber).toBe(-1);
  });

  it("rejects factors outside their spec range and an unknown outline mode", () => {
    expect(caught(() => buildStudioVrmcMToonExtension({ shadingToonyFactor: 1.5 })).code).toBe(
      "mtoon-invalid",
    );
    expect(caught(() => buildStudioVrmcMToonExtension({ shadeColorFactor: [2, 0, 0] })).code).toBe(
      "mtoon-invalid",
    );
    expect(
      caught(() => buildStudioVrmcMToonExtension({ outlineWidthMode: "wide" as never })).code,
    ).toBe("mtoon-invalid");
  });
});

describe("buildStudioVrmcVrmExtension", () => {
  it("composes specVersion, meta and humanoid into a single root extension", () => {
    const extension = buildStudioVrmcVrmExtension({
      meta: validMeta(),
      humanoidBones: completeBones(),
      context: context(),
    });
    expect(extension.specVersion).toBe(STUDIO_VRM_EXPORT_SPEC_VERSION);
    expect(extension.meta).toBeTypeOf("object");
    expect(extension.humanoid).toHaveProperty("humanBones");
    expect(extension.expressions).toBeUndefined();
    expect(extension.firstPerson).toBeUndefined();
  });

  it("carries first-person mesh annotations when supplied", () => {
    const extension = buildStudioVrmcVrmExtension({
      meta: validMeta(),
      humanoidBones: completeBones(),
      firstPerson: [{ node: 2, type: "thirdPersonOnly" }],
      context: context(),
    });
    expect(extension.firstPerson).toEqual({ meshAnnotations: [{ node: 2, type: "thirdPersonOnly" }] });
  });
});
