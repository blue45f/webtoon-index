import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  STUDIO_BG3D_GLB_MIME_TYPE,
  validateStudioBg3dGlb,
  type StudioBg3dGlbValidationResult,
} from "../bg3d/studio-bg3d-glb-validation";

import { StudioVrmExportError } from "./studio-vrm-export-error";
import { readStudioVrmExportGlb } from "./studio-vrm-export-glb-container";
import {
  planStudioVrmExport,
  serializeStudioVrmExport,
  STUDIO_VRM_EXPORT_GENERATOR,
  type StudioVrmExportSceneSnapshot,
} from "./studio-vrm-export-plan";
import {
  STUDIO_VRM_EXPORT_MTOON_EXTENSION,
  STUDIO_VRM_EXPORT_REQUIRED_BONES,
  STUDIO_VRM_EXPORT_SPRING_BONE_EXTENSION,
  STUDIO_VRM_EXPORT_VRM_EXTENSION,
  type StudioVrmExportHumanoidBones,
} from "./studio-vrm-export-vrm-extension";
import { validateVrmGlbBytes } from "./vrm-library";

const ROOT_NODE = 0;
const HIPS_NODE = 1;
const HEAD_NODE = 3;
const MESH_NODE = 16;
const BONE_NODES = STUDIO_VRM_EXPORT_REQUIRED_BONES.length;

const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

/** 24-byte PNG prefix with a readable IHDR so the studio validator can measure 4x4. */
function pngStub(): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, 4, false);
  view.setUint32(20, 4, false);
  return bytes;
}

function humanoidBones(): StudioVrmExportHumanoidBones {
  return Object.fromEntries(
    STUDIO_VRM_EXPORT_REQUIRED_BONES.map((bone, index) => [bone, index + HIPS_NODE]),
  ) as StudioVrmExportHumanoidBones;
}

function skeletonNodes(): StudioVrmExportSceneSnapshot["nodes"] {
  const nodes: StudioVrmExportSceneSnapshot["nodes"][number][] = [
    { name: "Armature", children: [HIPS_NODE, MESH_NODE] },
  ];
  for (let index = 0; index < BONE_NODES; index += 1) {
    const bone = STUDIO_VRM_EXPORT_REQUIRED_BONES[index] as string;
    nodes.push({
      name: bone,
      translation: [0, index * 0.1, 0],
      // The hips own every other bone so the skeleton is a single connected chain root.
      ...(index === 0
        ? { children: Array.from({ length: BONE_NODES - 1 }, (_unused, child) => child + HIPS_NODE + 1) }
        : {}),
    });
  }
  nodes.push({ name: "Body", mesh: 0, skin: 0 });
  return nodes;
}

/** Skeleton-only VRM: no meshes, no materials, therefore no BIN chunk at all. */
function skeletonSnapshot(): StudioVrmExportSceneSnapshot {
  const nodes = skeletonNodes().slice(0, MESH_NODE);
  return {
    meta: { name: "루미", authors: ["ToonSpectrum"] },
    humanoidBones: humanoidBones(),
    nodes: nodes.map((node, index) =>
      index === ROOT_NODE ? { ...node, children: [HIPS_NODE] } : node,
    ),
  };
}

/** Full character: skinned mesh, morph target, MToon material, embedded texture, spring bones. */
function characterSnapshot(): StudioVrmExportSceneSnapshot {
  return {
    meta: {
      name: "루미",
      authors: ["ToonSpectrum", "에이치준랩스"],
      version: "1.0.0",
      thumbnailImage: 0,
      avatarPermission: "onlyAuthor",
      commercialUsage: "personalNonProfit",
      creditNotation: "required",
      modification: "prohibited",
    },
    humanoidBones: humanoidBones(),
    nodes: skeletonNodes(),
    meshes: [
      {
        name: "Body",
        primitives: [
          {
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
            uvs: [0, 0, 1, 0, 0, 1],
            joints: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
            weights: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
            indices: [0, 1, 2],
            material: 0,
            targets: [{ name: "smile", positions: [0, 0.1, 0, 0, 0.1, 0, 0, 0.1, 0] }],
          },
        ],
      },
    ],
    skins: [
      {
        joints: Array.from({ length: BONE_NODES }, (_unused, index) => index + HIPS_NODE),
        skeleton: HIPS_NODE,
        inverseBindMatrices: Array.from({ length: BONE_NODES }, () => [...IDENTITY_MATRIX]).flat(),
      },
    ],
    materials: [
      {
        name: "Skin",
        baseColorFactor: [1, 0.9, 0.85, 1],
        baseColorTexture: 0,
        metallicFactor: 0,
        roughnessFactor: 0.9,
        alphaMode: "OPAQUE",
        doubleSided: false,
        mtoon: {
          shadeColorFactor: [0.7, 0.6, 0.6],
          shadingToonyFactor: 0.95,
          outlineWidthMode: "worldCoordinates",
          outlineWidthFactor: 0.01,
          outlineColorFactor: [0.1, 0.1, 0.1],
        },
      },
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [{ name: "skin", mimeType: "image/png", bytes: pngStub() }],
    expressions: {
      preset: { happy: { morphTargetBinds: [{ node: MESH_NODE, index: 0, weight: 1 }], isBinary: false } },
    },
    firstPerson: [{ node: MESH_NODE, type: "auto" }],
    springBone: {
      colliders: [{ node: HEAD_NODE, shape: "sphere", offset: [0, 0, 0], radius: 0.1 }],
      colliderGroups: [{ name: "머리", colliders: [0] }],
      springs: [
        {
          name: "앞머리",
          joints: [
            { node: 14, hitRadius: 0.01, stiffness: 1, gravityPower: 0.1, dragForce: 0.4 },
            { node: 15, hitRadius: 0.01, stiffness: 1, gravityPower: 0.1, dragForce: 0.4 },
          ],
          colliderGroups: [0],
          center: HIPS_NODE,
        },
      ],
    },
  };
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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // WebCrypto needs a plain ArrayBuffer-backed view; copy so the caller's buffer type never leaks.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function runStudioImportGate(bytes: Uint8Array): Promise<StudioBg3dGlbValidationResult> {
  return validateStudioBg3dGlb(bytes, {
    declared: {
      byteSize: bytes.byteLength,
      sha256: await sha256Hex(bytes),
      mimeType: STUDIO_BG3D_GLB_MIME_TYPE,
    },
    cumulative: { usedBytes: 0, maximumBytes: 100 * 1024 * 1024 },
    profile: "desktop",
    budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  });
}

describe("planStudioVrmExport — document shape", () => {
  it("emits a glTF 2.0 root with the VRM extension and a fixed generator", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    expect(plan.json.asset).toEqual({ version: "2.0", generator: STUDIO_VRM_EXPORT_GENERATOR });
    expect(plan.json.scene).toBe(0);
    expect(plan.json.scenes).toEqual([{ nodes: [ROOT_NODE] }]);
    const extensions = plan.json.extensions as Record<string, unknown>;
    expect(extensions[STUDIO_VRM_EXPORT_VRM_EXTENSION]).toBeTypeOf("object");
    expect(extensions[STUDIO_VRM_EXPORT_SPRING_BONE_EXTENSION]).toBeTypeOf("object");
  });

  it("declares every used extension exactly once, sorted, and never requires one", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    expect(plan.json.extensionsUsed).toEqual([
      STUDIO_VRM_EXPORT_MTOON_EXTENSION,
      STUDIO_VRM_EXPORT_SPRING_BONE_EXTENSION,
      STUDIO_VRM_EXPORT_VRM_EXTENSION,
    ]);
    expect(plan.json.extensionsRequired).toBeUndefined();
  });

  it("puts the MToon parameters on the material, not on the root", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    const material = (plan.json.materials as Record<string, unknown>[])[0];
    const mtoon = (material?.extensions as Record<string, unknown>)[STUDIO_VRM_EXPORT_MTOON_EXTENSION];
    expect(mtoon).toMatchObject({ specVersion: "1.0", outlineWidthMode: "worldCoordinates" });
  });

  it("reports honest stats for the planned document", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    expect(plan.stats).toMatchObject({
      nodes: MESH_NODE + 1,
      meshes: 1,
      primitives: 1,
      materials: 1,
      textures: 1,
      images: 1,
      skins: 1,
      morphTargets: 1,
      springs: 1,
    });
    expect(plan.stats.binByteLength).toBe(plan.binary.byteLength);
  });
});

describe("planStudioVrmExport — buffer views and accessors", () => {
  it("starts every buffer view on a 4-byte boundary and never overlaps", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    const views = plan.json.bufferViews as { byteOffset?: number; byteLength: number }[];
    expect(views.length).toBeGreaterThan(0);
    let previousEnd = 0;
    for (const view of views) {
      const byteOffset = view.byteOffset ?? 0;
      expect(byteOffset % 4).toBe(0);
      expect(view.byteLength).toBeGreaterThan(0);
      expect(byteOffset).toBeGreaterThanOrEqual(previousEnd);
      expect(byteOffset + view.byteLength).toBeLessThanOrEqual(plan.binary.byteLength);
      previousEnd = byteOffset + view.byteLength;
    }
  });

  it("declares a single buffer whose byteLength matches the packed payload", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    expect(plan.json.buffers).toEqual([{ byteLength: plan.binary.byteLength }]);
  });

  it("gives POSITION accessors the min/max bounds glTF requires", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    const accessors = plan.json.accessors as Record<string, unknown>[];
    const primitive = (plan.json.meshes as { primitives: { attributes: Record<string, number> }[] }[])[0]
      ?.primitives[0];
    const position = accessors[primitive?.attributes.POSITION as number];
    expect(position).toMatchObject({ componentType: 5126, type: "VEC3", count: 3 });
    expect(position?.min).toEqual([0, 0, 0]);
    expect(position?.max).toEqual([1, 1, 0]);
  });

  it("stores skin weights as float VEC4 and joints as unsigned-short VEC4", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    const accessors = plan.json.accessors as Record<string, unknown>[];
    const attributes = (
      plan.json.meshes as { primitives: { attributes: Record<string, number> }[] }[]
    )[0]?.primitives[0]?.attributes;
    expect(accessors[attributes?.JOINTS_0 as number]).toMatchObject({
      componentType: 5123,
      type: "VEC4",
      count: 3,
    });
    expect(accessors[attributes?.WEIGHTS_0 as number]).toMatchObject({
      componentType: 5126,
      type: "VEC4",
      count: 3,
    });
  });

  it("narrows indices to unsigned short below the 65536-vertex threshold", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    const accessors = plan.json.accessors as Record<string, unknown>[];
    const indices = (plan.json.meshes as { primitives: { indices: number }[] }[])[0]?.primitives[0]
      ?.indices;
    expect(accessors[indices as number]).toMatchObject({
      componentType: 5123,
      type: "SCALAR",
      count: 3,
    });
  });

  it("emits inverse bind matrices as MAT4 with one entry per joint", () => {
    const plan = planStudioVrmExport(characterSnapshot());
    const accessors = plan.json.accessors as Record<string, unknown>[];
    const skin = (plan.json.skins as { inverseBindMatrices: number }[])[0];
    expect(accessors[skin?.inverseBindMatrices as number]).toMatchObject({
      componentType: 5126,
      type: "MAT4",
      count: BONE_NODES,
    });
  });

  it("keeps the planned layout in sync with the serialized bytes", () => {
    const snapshot = characterSnapshot();
    const plan = planStudioVrmExport(snapshot);
    const bytes = serializeStudioVrmExport(snapshot);
    expect(bytes.byteLength).toBe(plan.layout.totalByteLength);
  });

  it("omits buffers, buffer views and the BIN chunk for a skeleton-only export", () => {
    const plan = planStudioVrmExport(skeletonSnapshot());
    expect(plan.json.buffers).toBeUndefined();
    expect(plan.json.bufferViews).toBeUndefined();
    expect(plan.json.accessors).toBeUndefined();
    expect(plan.binary.byteLength).toBe(0);
    expect(plan.layout.binChunkOffset).toBeNull();
  });
});

describe("serializeStudioVrmExport — determinism", () => {
  it("produces byte-identical output for two independent equal snapshots", () => {
    const first = serializeStudioVrmExport(characterSnapshot());
    const second = serializeStudioVrmExport(characterSnapshot());
    expect(second.byteLength).toBe(first.byteLength);
    expect([...second]).toEqual([...first]);
  });

  it("stays stable across repeated serialization of the same object", () => {
    const snapshot = characterSnapshot();
    expect([...serializeStudioVrmExport(snapshot)]).toEqual([...serializeStudioVrmExport(snapshot)]);
  });

  it("never reads a clock or a random source while serializing", () => {
    const now = vi.spyOn(Date, "now");
    const random = vi.spyOn(Math, "random");
    const randomUuid = vi.spyOn(globalThis.crypto, "randomUUID");
    try {
      serializeStudioVrmExport(characterSnapshot());
      expect(now).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
      expect(randomUuid).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("round trip through the app's own import gates", () => {
  it("re-parses its own GLB and recovers the VRM extension", () => {
    const bytes = serializeStudioVrmExport(characterSnapshot());
    const parsed = readStudioVrmExportGlb(bytes);
    const vrm = (parsed.json.extensions as Record<string, Record<string, unknown>>)[
      STUDIO_VRM_EXPORT_VRM_EXTENSION
    ];
    expect(vrm?.specVersion).toBe("1.0");
    expect((vrm?.meta as Record<string, unknown>).licenseUrl).toBe("https://vrm.dev/licenses/1.0/");
    expect(Object.keys((vrm?.humanoid as { humanBones: object }).humanBones)).toHaveLength(BONE_NODES);
  });

  it("passes validateVrmGlbBytes as a VRM 1.0 document", () => {
    expect(validateVrmGlbBytes(serializeStudioVrmExport(characterSnapshot()))).toEqual({ vrmVersion: 1 });
    expect(validateVrmGlbBytes(serializeStudioVrmExport(skeletonSnapshot()))).toEqual({ vrmVersion: 1 });
  });

  it("passes validateStudioBg3dGlb with the expected metrics", async () => {
    const bytes = serializeStudioVrmExport(characterSnapshot());
    const result = await runStudioImportGate(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metrics).toMatchObject({
      byteSize: bytes.byteLength,
      nodes: MESH_NODE + 1,
      meshes: 1,
      meshPrimitives: 1,
      drawCalls: 1,
      triangles: 1,
      materials: 1,
      textures: 1,
      images: 1,
      skins: 1,
      joints: BONE_NODES,
      morphTargets: 1,
      maxImageDimension: 4,
    });
    expect(result.usesBasisTextures).toBe(false);
    expect(result.requiresBasisTextures).toBe(false);
  });

  it("passes validateStudioBg3dGlb for a skeleton-only export with no binary chunk", async () => {
    const result = await runStudioImportGate(serializeStudioVrmExport(skeletonSnapshot()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metrics.binByteSize).toBe(0);
    expect(result.metrics.nodes).toBe(MESH_NODE);
  });

  it("survives the byte-for-byte hash check the studio importer performs", async () => {
    const bytes = serializeStudioVrmExport(characterSnapshot());
    const result = await runStudioImportGate(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verifiedSha256).toBe(`sha256:${await sha256Hex(bytes)}`);
    expect([...result.verifiedBytes]).toEqual([...bytes]);
  });
});

describe("planStudioVrmExport — rejections", () => {
  it("rejects an empty node table", () => {
    expect(caught(() => planStudioVrmExport({ ...skeletonSnapshot(), nodes: [] })).code).toBe(
      "node-tree-invalid",
    );
  });

  it("rejects a node claimed as a child by two parents", () => {
    const snapshot = skeletonSnapshot();
    // Node 2 is already a child of the hips; also listing it under the armature root would give it
    // two parents, which a glTF node forest forbids.
    const nodes = snapshot.nodes.map((node, index) =>
      index === ROOT_NODE ? { ...node, children: [HIPS_NODE, 2] } : node,
    );
    expect(caught(() => planStudioVrmExport({ ...snapshot, nodes })).code).toBe("node-tree-invalid");
  });

  it("rejects a cycle in the node graph", () => {
    const snapshot = skeletonSnapshot();
    const nodes = snapshot.nodes.map((node, index) => {
      if (index === ROOT_NODE) return { name: "Armature" };
      if (index === HIPS_NODE) return { ...node, children: [2] };
      if (index === 2) return { ...node, children: [HIPS_NODE] };
      return node;
    });
    expect(caught(() => planStudioVrmExport({ ...snapshot, nodes })).code).toBe("node-cycle");
  });

  it("rejects a skin attached to a node without a mesh", () => {
    const snapshot = characterSnapshot();
    const nodes = snapshot.nodes.map((node, index) =>
      index === MESH_NODE ? { name: "Body", skin: 0 } : node,
    );
    expect(caught(() => planStudioVrmExport({ ...snapshot, nodes })).code).toBe("skin-invalid");
  });

  it("rejects a mesh primitive whose attributes disagree on vertex count", () => {
    const snapshot = characterSnapshot();
    const meshes = [
      {
        primitives: [
          { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1] },
        ],
      },
    ];
    expect(caught(() => planStudioVrmExport({ ...snapshot, meshes })).code).toBe(
      "accessor-length-mismatch",
    );
  });

  it("rejects an empty position stream", () => {
    const snapshot = characterSnapshot();
    expect(
      caught(() =>
        planStudioVrmExport({ ...snapshot, meshes: [{ primitives: [{ positions: [] }] }] }),
      ).code,
    ).toBe("accessor-empty");
  });

  it("rejects primitives of one mesh disagreeing on morph-target count", () => {
    const snapshot = characterSnapshot();
    const meshes = [
      {
        primitives: [
          {
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            targets: [{ positions: [0, 0.1, 0, 0, 0.1, 0, 0, 0.1, 0] }],
          },
          { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
        ],
      },
    ];
    expect(caught(() => planStudioVrmExport({ ...snapshot, meshes })).code).toBe("mesh-invalid");
  });

  it("rejects a primitive pointing at a material that does not exist", () => {
    const snapshot = characterSnapshot();
    const meshes = [{ primitives: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], material: 9 }] }];
    expect(caught(() => planStudioVrmExport({ ...snapshot, meshes })).code).toBe("material-invalid");
  });

  it("rejects an index that addresses a vertex outside the primitive", () => {
    const snapshot = characterSnapshot();
    const meshes = [{ primitives: [{ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 7] }] }];
    expect(caught(() => planStudioVrmExport({ ...snapshot, meshes })).code).toBe("mesh-invalid");
  });

  it("rejects an unsupported embedded image type", () => {
    const snapshot = characterSnapshot();
    const images = [{ mimeType: "image/ktx2" as never, bytes: pngStub() }];
    expect(caught(() => planStudioVrmExport({ ...snapshot, images })).code).toBe("image-invalid");
  });

  it("rejects a texture whose source image does not exist", () => {
    const snapshot = characterSnapshot();
    expect(caught(() => planStudioVrmExport({ ...snapshot, textures: [{ source: 5 }] })).code).toBe(
      "texture-invalid",
    );
  });

  it("propagates the humanoid completeness failure from a partial rig", () => {
    const snapshot = skeletonSnapshot();
    const bones = { ...humanoidBones() } as Record<string, number>;
    delete bones.rightFoot;
    const error = caught(() =>
      planStudioVrmExport({ ...snapshot, humanoidBones: bones as StudioVrmExportHumanoidBones }),
    );
    expect(error.code).toBe("humanoid-bone-missing");
    expect(error.details?.missingBones).toEqual(["rightFoot"]);
  });

  it("propagates the licence failure so no unlicensed VRM can be written", () => {
    const snapshot = skeletonSnapshot();
    expect(
      caught(() =>
        planStudioVrmExport({ ...snapshot, meta: { name: "루미", authors: [] } }),
      ).code,
    ).toBe("meta-authors-missing");
  });
});
