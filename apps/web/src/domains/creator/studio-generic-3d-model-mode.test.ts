import { describe, expect, it } from "vitest";

import {
  createStudioGeneric3dGlbManifest,
  createStudioGeneric3dObjManifest,
  createStudioGeneric3dRightsFromAssetMetadata,
  createStudioGeneric3dRightsFromAttachment,
  createStudioGeneric3dVerifiedManifest,
  getStudioGeneric3dCapability,
  isStudioGeneric3dSourceFormat,
} from "./studio-generic-3d-model-mode";

import type {
  StudioBg3dGlbMetrics,
  StudioBg3dGlbValidationFailure,
  StudioBg3dGlbValidationSuccess,
} from "./bg3d/studio-bg3d-glb-validation";
import type { StudioBg3dObjWorkerCanonicalResult } from "./bg3d/studio-bg3d-obj-worker-protocol";

function metrics(patch: Partial<StudioBg3dGlbMetrics> = {}): StudioBg3dGlbMetrics {
  return {
    byteSize: 4_096,
    jsonByteSize: 512,
    binByteSize: 3_564,
    nodes: 1,
    meshes: 1,
    meshPrimitives: 1,
    drawCalls: 1,
    triangles: 12,
    materials: 1,
    textures: 1,
    images: 1,
    imageBytes: 256,
    estimatedDecodedImageBytes: 1_024,
    maxImageDimension: 16,
    undeterminedImageDimensions: 0,
    lights: 0,
    animations: 0,
    animationChannels: 0,
    animationKeyframes: 0,
    animationValues: 0,
    skins: 0,
    joints: 0,
    morphTargets: 0,
    accessorElements: 36,
    estimatedDecodedGeometryBytes: 1_024,
    ...patch,
  };
}

function validGlb(patch: Partial<StudioBg3dGlbMetrics> = {}): StudioBg3dGlbValidationSuccess {
  const validatorMetrics = metrics(patch);
  return {
    ok: true,
    code: "valid",
    message: "검증 완료",
    profile: "desktop",
    verifiedSha256: `sha256:${"a".repeat(64)}`,
    verifiedBytes: new Uint8Array(validatorMetrics.byteSize),
    cumulativeBytesAfter: validatorMetrics.byteSize,
    usesBasisTextures: false,
    requiresBasisTextures: false,
    metrics: validatorMetrics,
  };
}

function objResult(withMtl = true): StudioBg3dObjWorkerCanonicalResult {
  return {
    primaryPath: "models/doctor.obj",
    nodes: [
      { name: "DoctorRoot", parentIndex: null, renderableIndex: null },
      { name: "DoctorBody", parentIndex: 0, renderableIndex: 0 },
      { name: "DoctorBag", parentIndex: 0, renderableIndex: 1 },
    ],
    renderables: [
      {
        kind: "mesh",
        name: "DoctorBody",
        vertexCount: 18,
        attributes: [],
        groups: [],
        materialSlots: [],
      },
      {
        kind: "mesh",
        name: "DoctorBag",
        vertexCount: 18,
        attributes: [],
        groups: [],
        materialSlots: [],
      },
    ],
    materials: [
      {
        name: "coat",
        sourceMtlPath: withMtl ? "models/doctor.mtl" : null,
        synthesized: !withMtl,
        ambient: [0, 0, 0],
        diffuse: [1, 1, 1],
        specular: [0, 0, 0],
        emissive: [0, 0, 0],
        shininess: 0,
        opacity: 1,
        textures: withMtl
          ? [{
            slot: "normal",
            resourcePath: "models/doctor-normal.png",
            offset: [0, 0],
            repeat: [1, 1],
            bumpScale: 1,
            displacementBias: 0,
            displacementScale: 1,
          }]
          : [],
      },
    ],
    usedResourcePaths: withMtl
      ? ["models/doctor.mtl", "models/doctor-normal.png"]
      : [],
    metrics: {
      nodes: 3,
      meshes: 2,
      vertices: 36,
      triangles: 12,
      outputBytes: 432,
      materials: 1,
      materialSlots: 1,
      usedResources: withMtl ? 2 : 0,
    },
  };
}

describe("generic 3D model manifest", () => {
  it("keeps VRM outside the generic source contract", () => {
    expect(isStudioGeneric3dSourceFormat("glb")).toBe(true);
    expect(isStudioGeneric3dSourceFormat("obj-mtl")).toBe(true);
    expect(isStudioGeneric3dSourceFormat("vrm")).toBe(false);
    expect(isStudioGeneric3dSourceFormat("fbx")).toBe(false);
    expect(() => createStudioGeneric3dGlbManifest({
      name: "avatar.vrm",
      sourceFormat: "vrm" as never,
      validation: validGlb(),
    })).toThrow(/cannot use VRM/iu);
  });

  it("detects skinned character capabilities from validated GLB evidence", () => {
    const manifest = createStudioGeneric3dGlbManifest({
      name: "Doctor_Character.glb",
      validation: validGlb({
        nodes: 58,
        meshes: 4,
        skins: 1,
        joints: 42,
        animations: 3,
        morphTargets: 12,
      }),
      parts: 6,
      bones: 42,
      skinnedMeshes: 4,
      normalMaps: 2,
      nodeNames: ["Hips", "Spine", "Head", "LeftArm", "RightArm"],
    });

    expect(manifest.kind).toBe("generic-3d-model");
    expect(manifest.isVrm).toBe(false);
    expect(manifest.classification).toBe("character");
    expect(manifest.rigStatus).toBe("skinned");
    expect(manifest.admission.status).toBe("ready");
    expect(getStudioGeneric3dCapability(manifest, "bone-pose").availability).toBe("available");
    expect(getStudioGeneric3dCapability(manifest, "skinned-deformation").availability).toBe("available");
    expect(getStudioGeneric3dCapability(manifest, "animation-playback").detail).toContain("3개");
    expect(getStudioGeneric3dCapability(manifest, "normal-map").availability).toBe("available");
  });

  it("states the static single-mesh limitations without pretending to deform it", () => {
    const manifest = createStudioGeneric3dGlbManifest({
      name: "wooden-chair.glb",
      validation: validGlb(),
    });

    expect(manifest.classification).toBe("prop");
    expect(manifest.classificationSource).toBe("fallback");
    expect(manifest.rigStatus).toBe("static");
    expect(getStudioGeneric3dCapability(manifest, "root-transform").availability).toBe("available");
    expect(getStudioGeneric3dCapability(manifest, "bone-pose").availability).toBe("unavailable");
    expect(getStudioGeneric3dCapability(manifest, "pose-proxy").availability).toBe("limited");
    expect(manifest.limitations.map((item) => item.code)).toEqual(expect.arrayContaining([
      "static-no-deformation",
      "single-part-model",
      "rights-review",
    ]));
  });

  it("fails closed when canonical GLB validation blocks the model", () => {
    const failure: StudioBg3dGlbValidationFailure = {
      ok: false,
      code: "triangle-budget-exceeded",
      message: "기기 삼각형 예산을 초과했습니다.",
    };
    const manifest = createStudioGeneric3dGlbManifest({
      name: "oversized.glb",
      validation: failure,
      classification: "creature",
    });

    expect(manifest.admission.status).toBe("blocked");
    expect(manifest.rigStatus).toBe("unverified");
    expect(manifest.classification).toBe("creature");
    expect(manifest.classificationSource).toBe("manual");
    expect(manifest.capabilities.every((item) => item.availability === "unavailable")).toBe(true);
    expect(manifest.limitations.find((item) => item.code === "validation-blocked")?.severity).toBe("blocking");
  });

  it("reports OBJ+MTL source inspection separately from canonical GLB admission", () => {
    const pending = createStudioGeneric3dObjManifest({
      name: "의사 캐릭터.obj",
      parsed: objResult(),
    });

    expect(pending.sourceFormat).toBe("obj-mtl");
    expect(pending.convertedToCanonicalGlb).toBe(true);
    expect(pending.classification).toBe("character");
    expect(pending.rigStatus).toBe("static");
    expect(pending.structure.parts).toBe(2);
    expect(pending.structure.normalMaps).toBe(1);
    expect(pending.admission.sourceValidation).toBe("passed");
    expect(pending.admission.canonicalValidation).toBe("pending");
    expect(getStudioGeneric3dCapability(pending, "root-transform").availability).toBe("unavailable");

    const ready = createStudioGeneric3dObjManifest({
      name: "의사 캐릭터.obj",
      parsed: objResult(),
      canonicalValidation: validGlb({ nodes: 3, meshes: 2 }),
    });
    expect(ready.admission.status).toBe("ready");
    expect(getStudioGeneric3dCapability(ready, "part-transform").availability).toBe("available");

    const withoutMtl = createStudioGeneric3dObjManifest({
      name: "chair.obj",
      parsed: objResult(false),
      canonicalValidation: validGlb(),
    });
    expect(withoutMtl.sourceFormat).toBe("obj");
    expect(withoutMtl.limitations.some((item) => item.code === "missing-mtl")).toBe(true);
  });

  it("rebuilds a verified imported-source manifest without fabricating validator bytes", () => {
    const manifest = createStudioGeneric3dVerifiedManifest({
      name: "doctor.obj",
      sourceFormat: "obj-mtl",
      profile: "mobile",
      contentHash: `sha256:${"d".repeat(64)}`,
      metrics: metrics({ nodes: 8, meshes: 3, skins: 1, joints: 12 }),
      parts: 3,
      partTransformsSupported: false,
      bones: 12,
      skinnedMeshes: 1,
    });

    expect(manifest.sourceFormat).toBe("obj-mtl");
    expect(manifest.canonicalFormat).toBe("glb");
    expect(manifest.admission).toMatchObject({
      status: "ready",
      profile: "mobile",
      canonicalValidation: "passed",
    });
    expect(manifest.structure).toMatchObject({
      parts: 3,
      partTransformsSupported: false,
    });
    expect(getStudioGeneric3dCapability(manifest, "part-transform").availability).toBe("unavailable");
    expect(manifest.limitations.some(
      (item) => item.code === "part-transform-runtime-unavailable",
    )).toBe(true);
  });

  it("adapts both asset metadata and scene attachment license receipts", () => {
    const metadataRights = createStudioGeneric3dRightsFromAssetMetadata({
      rights: {
        status: "licensed",
        commercialUse: true,
        teamShareAllowed: false,
        provider: "ACON3D",
        license: "구매 라이선스",
      },
    });
    expect(metadataRights).toMatchObject({
      source: "asset-metadata",
      status: "licensed",
      commercialUse: true,
      teamShareAllowed: false,
      reviewRequired: false,
    });

    const attachmentRights = createStudioGeneric3dRightsFromAttachment({
      status: "licensed",
      commercialUse: true,
      attributionRequired: true,
      licenseName: "작가 허가",
      attribution: "Model by Artist",
    });
    expect(attachmentRights).toMatchObject({
      source: "scene-attachment",
      teamShareAllowed: null,
      attributionRequired: true,
      reviewRequired: false,
    });
  });
});
