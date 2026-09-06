/**
 * End-to-end proof that the pure exporter emits a file the app's *actual* runtime loader accepts.
 *
 * The other export suites are Three.js-free by design. This one deliberately is not: it feeds the
 * emitted bytes to `GLTFLoader` + `@pixiv/three-vrm`'s `VRMLoaderPlugin`, the exact pair the studio
 * viewport uses, and asserts the humanoid, licence metadata, expressions and spring bones all
 * survive. No WebGL context is needed because the fixtures embed no images — texture decoding is the
 * only part of the loader that requires a DOM.
 */

import { describe, expect, it } from "vitest";

import { serializeStudioVrmExport, type StudioVrmExportSceneSnapshot } from "./studio-vrm-export-plan";
import {
  STUDIO_VRM_EXPORT_LICENSE_URL,
  STUDIO_VRM_EXPORT_REQUIRED_BONES,
  type StudioVrmExportHumanoidBones,
} from "./studio-vrm-export-vrm-extension";

const BONE_COUNT = STUDIO_VRM_EXPORT_REQUIRED_BONES.length;
const HIPS_NODE = 1;
const HEAD_NODE = 3;
const MESH_NODE = BONE_COUNT + 1;
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

interface LoadedVrm {
  readonly meta?: Record<string, unknown>;
  readonly humanoid?: { getNormalizedBoneNode(name: string): unknown };
  readonly expressionManager?: { getExpression(name: string): unknown } | null;
  readonly springBoneManager?: { joints: ReadonlySet<unknown> } | null;
}

function humanoidBones(): StudioVrmExportHumanoidBones {
  return Object.fromEntries(
    STUDIO_VRM_EXPORT_REQUIRED_BONES.map((bone, index) => [bone, index + HIPS_NODE]),
  ) as StudioVrmExportHumanoidBones;
}

function nodes(withMesh: boolean): StudioVrmExportSceneSnapshot["nodes"] {
  const skeleton: StudioVrmExportSceneSnapshot["nodes"][number][] = [
    { name: "Armature", children: withMesh ? [HIPS_NODE, MESH_NODE] : [HIPS_NODE] },
  ];
  STUDIO_VRM_EXPORT_REQUIRED_BONES.forEach((bone, index) => {
    skeleton.push({
      name: bone,
      translation: [0, index * 0.1, 0],
      ...(index === 0
        ? { children: Array.from({ length: BONE_COUNT - 1 }, (_unused, child) => child + HIPS_NODE + 1) }
        : {}),
    });
  });
  if (withMesh) skeleton.push({ name: "Body", mesh: 0, skin: 0 });
  return skeleton;
}

function characterSnapshot(): StudioVrmExportSceneSnapshot {
  return {
    meta: {
      name: "루미",
      authors: ["ToonSpectrum"],
      avatarPermission: "onlyAuthor",
      commercialUsage: "personalNonProfit",
    },
    humanoidBones: humanoidBones(),
    nodes: nodes(true),
    meshes: [
      {
        name: "Body",
        primitives: [
          {
            positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
            normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
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
        joints: Array.from({ length: BONE_COUNT }, (_unused, index) => index + HIPS_NODE),
        skeleton: HIPS_NODE,
        inverseBindMatrices: Array.from({ length: BONE_COUNT }, () => [...IDENTITY_MATRIX]).flat(),
      },
    ],
    materials: [
      {
        name: "Skin",
        baseColorFactor: [1, 0.9, 0.85, 1],
        mtoon: {
          shadeColorFactor: [0.7, 0.6, 0.6],
          shadingToonyFactor: 0.95,
          outlineWidthMode: "worldCoordinates",
          outlineWidthFactor: 0.01,
        },
      },
    ],
    expressions: {
      preset: { happy: { morphTargetBinds: [{ node: MESH_NODE, index: 0, weight: 1 }] } },
    },
    springBone: {
      colliders: [{ node: HEAD_NODE, shape: "sphere", offset: [0, 0, 0], radius: 0.1 }],
      colliderGroups: [{ name: "머리", colliders: [0] }],
      springs: [
        {
          name: "앞머리",
          joints: [
            { node: BONE_COUNT - 1, hitRadius: 0.01, stiffness: 1, gravityPower: 0.1, dragForce: 0.4 },
            { node: BONE_COUNT, hitRadius: 0.01, stiffness: 1, gravityPower: 0.1, dragForce: 0.4 },
          ],
          colliderGroups: [0],
        },
      ],
    },
  };
}

async function loadExportedVrm(snapshot: StudioVrmExportSceneSnapshot): Promise<LoadedVrm> {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { VRMLoaderPlugin } = await import("@pixiv/three-vrm");
  const bytes = serializeStudioVrmExport(snapshot);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(buffer, "");
  const vrm = (gltf.userData as { vrm?: LoadedVrm }).vrm;
  expect(vrm).toBeDefined();
  return vrm as LoadedVrm;
}

describe("exported VRM loads in @pixiv/three-vrm", () => {
  it("resolves the licence metadata the loader refuses to guess", async () => {
    const vrm = await loadExportedVrm(characterSnapshot());
    expect(vrm.meta?.metaVersion).toBe("1");
    expect(vrm.meta?.name).toBe("루미");
    expect(vrm.meta?.authors).toEqual(["ToonSpectrum"]);
    expect(vrm.meta?.licenseUrl).toBe(STUDIO_VRM_EXPORT_LICENSE_URL);
    expect(vrm.meta?.avatarPermission).toBe("onlyAuthor");
  });

  it("builds a complete humanoid from the exported bone map", async () => {
    const vrm = await loadExportedVrm(characterSnapshot());
    expect(vrm.humanoid).toBeDefined();
    for (const bone of STUDIO_VRM_EXPORT_REQUIRED_BONES) {
      expect(vrm.humanoid?.getNormalizedBoneNode(bone)).not.toBeNull();
    }
  });

  it("rebuilds the exported expression and spring bone chain", async () => {
    const vrm = await loadExportedVrm(characterSnapshot());
    expect(vrm.expressionManager?.getExpression("happy")).toBeTruthy();
    expect((vrm.springBoneManager?.joints.size ?? 0)).toBeGreaterThan(0);
  });

  it("loads a skeleton-only export that carries no BIN chunk at all", async () => {
    const vrm = await loadExportedVrm({
      meta: { name: "Probe", authors: ["ToonSpectrum"] },
      humanoidBones: humanoidBones(),
      nodes: nodes(false),
    });
    expect(vrm.meta?.name).toBe("Probe");
    expect(vrm.humanoid?.getNormalizedBoneNode("hips")).not.toBeNull();
  });
});
