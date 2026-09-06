import { readFileSync } from "node:fs";
import { join } from "node:path";

import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import {
  applyStudioVrmPropTint,
  supportsStudioVrmPropTint,
} from "./vrm/studio-vrm-prop-material";
import {
  measureVrmPropRigMetrics,
  resolvePropAttachment,
} from "./vrm/studio-vrm-prop-rig";
import {
  BLENDER_PROP_GLTF_URLS,
  createPropInstance,
  propDefById,
  type PropAnchorDef,
  type VrmPropId,
} from "./vrm/studio-vrm-props";

(globalThis as unknown as { self: typeof globalThis }).self = globalThis;

type JsonRecord = Record<string, unknown>;

interface EverydayPropGate {
  readonly id: Extract<VrmPropId, "mug" | "book" | "cap" | "glasses" | "backpack" | "stethoscope">;
  readonly filename: string;
  readonly assetId: string;
  readonly qualityClass: "handheld" | "headwear" | "large-body" | "body-wearable";
  readonly minNodes: number;
  readonly minTriangles: number;
  readonly requiredNodes: readonly string[];
  readonly contacts: readonly { readonly anchorId: string; readonly node: string }[];
}

const EVERYDAY_PROPS: readonly EverydayPropGate[] = [
  {
    id: "mug",
    filename: "everyday_mug.glb",
    assetId: "everyday_mug_v4",
    qualityClass: "handheld",
    minNodes: 9,
    minTriangles: 2_500,
    requiredNodes: ["Mug_CeramicBody", "Mug_Rim", "Mug_HandleLoop", "Mug_HandleContact"],
    contacts: [{ anchorId: "primary", node: "Mug_HandleContact" }],
  },
  {
    id: "book",
    filename: "everyday_book.glb",
    assetId: "everyday_book_v4",
    qualityClass: "handheld",
    minNodes: 22,
    minTriangles: 2_500,
    requiredNodes: ["Book_PageBlock", "Book_Spine", "Book_LeftGripEdge", "Book_RightGripEdge"],
    contacts: [
      { anchorId: "primary", node: "Book_LeftGripEdge" },
      { anchorId: "secondary", node: "Book_RightGripEdge" },
    ],
  },
  // Cap v5 is covered by studio-vrm-wearable-v5.test.ts; hollow headwear must not require a visible contact post.
  {
    id: "glasses",
    filename: "everyday_glasses.glb",
    assetId: "everyday_glasses_v4",
    qualityClass: "headwear",
    minNodes: 17,
    minTriangles: 2_500,
    requiredNodes: ["Glasses_BridgeContact", "Glasses_LeftLens", "Glasses_RightLens", "Glasses_LeftTempleArm"],
    contacts: [{ anchorId: "surface", node: "Glasses_BridgeContact" }],
  },
  {
    id: "backpack",
    filename: "everyday_backpack.glb",
    assetId: "everyday_backpack_v4",
    qualityClass: "large-body",
    minNodes: 19,
    minTriangles: 5_000,
    requiredNodes: ["Backpack_BackContact", "Backpack_MainShell", "Backpack_LeftShoulderStrap", "Backpack_MainZipper"],
    contacts: [{ anchorId: "surface", node: "Backpack_BackContact" }],
  },
  {
    id: "stethoscope",
    filename: "medical_stethoscope.glb",
    assetId: "medical_stethoscope_v4",
    qualityClass: "body-wearable",
    minNodes: 14,
    minTriangles: 2_500,
    requiredNodes: ["Stethoscope_NeckContact", "Stethoscope_LeftTubing", "Stethoscope_RightTubing", "Stethoscope_Chestpiece"],
    contacts: [{ anchorId: "surface", node: "Stethoscope_NeckContact" }],
  },
] as const;

const GLB_MAGIC = 0x4654_6c67;
const GLB_JSON_CHUNK = 0x4e4f_534a;
const GENERATOR = "scripts/blender/generate_everyday_props_pack_v4.py";
const CC0_LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

function bundledBytes(filename: string): Uint8Array {
  return readFileSync(join(process.cwd(), "apps/web/public", "assets", "3d", filename));
}

function embeddedJson(bytes: Uint8Array): JsonRecord {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(GLB_MAGIC);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(GLB_JSON_CHUNK);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as JsonRecord;
}

function triangleCount(json: JsonRecord): number {
  const accessors = json.accessors as JsonRecord[];
  const meshes = json.meshes as { primitives?: JsonRecord[] }[];
  let triangles = 0;
  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      expect(primitive.mode ?? 4).toBe(4);
      const attributes = primitive.attributes as JsonRecord;
      const accessorIndex = typeof primitive.indices === "number"
        ? primitive.indices
        : attributes.POSITION;
      expect(accessorIndex).toBeTypeOf("number");
      triangles += Math.floor((accessors[accessorIndex as number]?.count as number) / 3);
    }
  }
  return triangles;
}

async function parseScene(filename: string) {
  const bytes = bundledBytes(filename);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new GLTFLoader().parseAsync(arrayBuffer, "");
}

// Kate (100Avatars R1 #038, CC0) stands in for the retired procedural reference character. The
// proportion constants were calibrated on that rig's authored head and palm meshes and are kept
// relative to the measured rig metrics, so the gates stay meaningful on any bundled humanoid.
const REFERENCE_VRM_FILE = "Kate.vrm";
const REFERENCE_HEAD_WIDTH_PER_HEAD_METRIC = 1.25; // 0.232394 / 0.185916
const REFERENCE_HEAD_DEPTH_PER_HEAD_METRIC = 1.075; // 0.199859 / 0.185916
const REFERENCE_PALM_WIDTH_PER_HAND_METRIC = 0.95; // 0.0959 / 0.1010

async function parseReferenceVrm(): Promise<VRM> {
  const bytes = readFileSync(join(process.cwd(), "apps/web/public", "vrm", REFERENCE_VRM_FILE));
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(arrayBuffer, "");
  const vrm = (gltf.userData as { vrm?: VRM }).vrm;
  expect(vrm).toBeDefined();
  return vrm!;
}

function anchorById(id: VrmPropId, anchorId: string): PropAnchorDef {
  const anchor = propDefById(id)?.anchors.find((candidate) => candidate.id === anchorId);
  expect(anchor, `${id}/${anchorId}`).toBeDefined();
  return anchor!;
}

describe("ToonSpectrum everyday prop pack v4", () => {
  it.each(EVERYDAY_PROPS)("$filename meets the strict mobile GLB gate", (gate) => {
    const bytes = bundledBytes(gate.filename);
    expect(bytes.byteLength).toBeGreaterThanOrEqual(150 * 1024);
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);

    const json = embeddedJson(bytes);
    const nodes = json.nodes as JsonRecord[];
    const materials = json.materials as JsonRecord[];
    const nodeNames = new Set(nodes.map((node) => node.name));
    const materialNames = materials.map((entry) => entry.name);
    const resources = [
      ...((json.buffers as JsonRecord[] | undefined) ?? []),
      ...((json.images as JsonRecord[] | undefined) ?? []),
    ];
    const root = nodes.find((node) => (node.extras as JsonRecord | undefined)?.asset_id === gate.assetId);
    const tintable = materials.filter((entry) => (
      entry.extras as JsonRecord | undefined
    )?.toonspectrum_tintable === true);

    expect(nodes.length).toBeGreaterThanOrEqual(gate.minNodes);
    expect(materials.length).toBeGreaterThanOrEqual(4);
    expect(new Set(materialNames).size).toBe(materialNames.length);
    expect(materials.every((entry) => entry.pbrMetallicRoughness !== undefined)).toBe(true);
    expect(tintable).toHaveLength(1);
    expect(triangleCount(json)).toBeGreaterThanOrEqual(gate.minTriangles);
    expect(resources.every((resource) => resource.uri === undefined)).toBe(true);
    expect(json.images ?? []).toEqual([]);
    expect(json.skins ?? []).toEqual([]);
    expect(json.animations ?? []).toEqual([]);
    expect(gate.requiredNodes.every((name) => nodeNames.has(name))).toBe(true);
    expect(root?.extras).toMatchObject({
      asset_id: gate.assetId,
      asset_author: "ToonSpectrum",
      asset_generator: GENERATOR,
      asset_license: "CC0-1.0",
      asset_license_url: CC0_LICENSE_URL,
      units: "metres",
      quality_class: gate.qualityClass,
      forward_axis: "+Z",
      up_axis: "+Y",
    });
  });

  it.each(EVERYDAY_PROPS)("$id keeps every serialized anchor inside its named contact mesh", async (gate) => {
    const gltf = await parseScene(gate.filename);
    gltf.scene.updateMatrixWorld(true);
    for (const contactGate of gate.contacts) {
      const contact = gltf.scene.getObjectByName(contactGate.node);
      expect(contact, `${gate.id}/${contactGate.node}`).toBeDefined();
      const bounds = new Box3().setFromObject(contact!);
      const anchor = anchorById(gate.id, contactGate.anchorId);
      expect(
        bounds.distanceToPoint(new Vector3(...anchor.position)),
        `${gate.id}/${contactGate.anchorId}: contact gap`,
      ).toBeLessThanOrEqual(0.001);
    }
  });

  it("keeps all recommended-row IDs and semantic profiles stable while changing only geometry authority", () => {
    expect(propDefById("mug")).toMatchObject({
      label: "머그컵", category: "hand", defaultBone: "rightHand",
      defaultPosition: [0.02, 0.01, 0.02], defaultRotationDeg: [0, 0, 0], defaultScale: 1,
      defaultColor: "#e8e2d6", anchors: [{ id: "primary", role: "primary", position: [0.07, 0, 0], gripRadius: 0.008 }],
      grip: { kind: "handle", radius: 0.008, fingerCurlDeg: 58, thumbOppositionDeg: 42 },
      fit: { reference: "hand", designReference: 0.075, minScale: 0.72, maxScale: 1.45 },
    });
    expect(propDefById("book")).toMatchObject({
      label: "책", category: "hand", defaultBone: "leftHand",
      defaultPosition: [0.02, 0.01, 0.04], defaultRotationDeg: [60, 0, 0], defaultScale: 1,
      defaultColor: "#7a3b3b", smartRotationDeg: [0, 0, 90], secondaryGripInfluence: 0.65,
      anchors: [
        { id: "primary", role: "primary", position: [-0.07, -0.045, 0], gripRadius: 0.015 },
        { id: "secondary", role: "secondary", position: [0.07, -0.045, 0], gripRadius: 0.015 },
      ],
      grip: { kind: "support", radius: 0.015, fingerCurlDeg: 22, thumbOppositionDeg: 24 },
      fit: { reference: "hand", designReference: 0.075, minScale: 0.72, maxScale: 1.45 },
    });
    expect(propDefById("cap")).toMatchObject({
      label: "캡모자", category: "head", defaultBone: "head",
      defaultPosition: [0, 0.08, 0.01], defaultRotationDeg: [-8, 0, 0], defaultScale: 1,
      defaultColor: "#2b3a55", anchors: [{ id: "surface", position: [0, 0, 0] }],
      fit: { reference: "head", designReference: 0.18, minScale: 0.72, maxScale: 1.45 },
    });
    expect(propDefById("glasses")).toMatchObject({
      label: "안경", category: "head", defaultBone: "head",
      defaultPosition: [0, 0.02, 0.07], defaultRotationDeg: [0, 0, 0], defaultScale: 1,
      defaultColor: "#1c1c22", anchors: [{ id: "surface", position: [0, 0, 0] }],
      fit: { reference: "eyeDistance", designReference: 0.064, minScale: 0.72, maxScale: 1.45 },
    });
    expect(propDefById("backpack")).toMatchObject({
      label: "백팩", category: "body", defaultBone: "chest",
      defaultPosition: [0, -0.05, -0.1], defaultRotationDeg: [0, 0, 0], defaultScale: 1,
      defaultColor: "#3b4a3b", anchors: [{ id: "surface", position: [0, 0, 0.06], forward: [0, 0, -1] }],
      fit: { reference: "shoulder", designReference: 0.32, minScale: 0.68, maxScale: 1.55 },
    });
    expect(propDefById("stethoscope")).toMatchObject({
      label: "청진기", category: "body", defaultBone: "neck",
      defaultPosition: [0, -0.055, 0.055], defaultRotationDeg: [90, 0, 0], defaultScale: 1,
      defaultColor: "#1e293b", anchors: [{ id: "surface", position: [0, 0.105, 0] }],
      fit: { reference: "none", designReference: 1, minScale: 0.72, maxScale: 1.45 },
    });
  });

  it("reuses the audited phone GLB while preserving stable and legacy color semantics", () => {
    expect(BLENDER_PROP_GLTF_URLS.smartphone).toBe("/assets/3d/modern_smartphone_prop.glb");
    expect(BLENDER_PROP_GLTF_URLS.blender_modern_smartphone)
      .toBe(BLENDER_PROP_GLTF_URLS.smartphone);
    expect(propDefById("smartphone")).toMatchObject({
      label: "스마트폰",
      defaultColor: "#1c1c22",
      geometrySource: { kind: "gltf", url: "/assets/3d/modern_smartphone_prop.glb" },
    });
    expect(propDefById("blender_modern_smartphone")).toMatchObject({
      label: "블렌더 모던 스마트폰",
      defaultColor: null,
      geometrySource: { kind: "gltf", url: "/assets/3d/modern_smartphone_prop.glb" },
    });

    const phoneBody = new MeshStandardMaterial({ color: "#111111" });
    phoneBody.name = "PhoneV2_AnodizedBody";
    expect(supportsStudioVrmPropTint(phoneBody, "smartphone")).toBe(true);
    expect(supportsStudioVrmPropTint(phoneBody, "blender_modern_smartphone")).toBe(false);

    const legacyRoot = new Group();
    const legacyMesh = new Mesh(new BoxGeometry(), phoneBody);
    legacyRoot.add(legacyMesh);
    const cleanupLegacy = applyStudioVrmPropTint(
      legacyRoot,
      "blender_modern_smartphone",
      "#ff0000",
    );
    expect(legacyMesh.material).toBe(phoneBody);
    cleanupLegacy();
  });

  it("clones only the authored tint surface and restores cache-owned PBR materials", () => {
    const root = new Group();
    const primary = new MeshStandardMaterial({ color: "#ffffff" });
    primary.userData.toonspectrum_tintable = true;
    const detail = new MeshStandardMaterial({ color: "#222222" });
    const primaryMesh = new Mesh(new BoxGeometry(), primary);
    const detailMesh = new Mesh(new BoxGeometry(), detail);
    root.add(primaryMesh, detailMesh);

    const cleanup = applyStudioVrmPropTint(root, "mug", "#804020");
    expect(primaryMesh.material).not.toBe(primary);
    expect((primaryMesh.material as MeshStandardMaterial).color.getHexString()).toBe("804020");
    expect(detailMesh.material).toBe(detail);

    cleanup();
    expect(primaryMesh.material).toBe(primary);
    expect(detailMesh.material).toBe(detail);
  });

  it("fits the reference rig's head and body measurements without oversize geometry", async () => {
    const vrm = await parseReferenceVrm();
    const metrics = measureVrmPropRigMetrics(vrm);
    const headMetric = metrics.head;
    const eyeDistance = headMetric * 0.355;
    const headWidth = headMetric * REFERENCE_HEAD_WIDTH_PER_HEAD_METRIC;
    const headDepth = headMetric * REFERENCE_HEAD_DEPTH_PER_HEAD_METRIC;
    // The backpack fit clamps to its minimum scale on every bundled rig, so its footprint is
    // judged against the design-reference shoulder width the fit profile was authored for.
    const visualShoulderWidth = propDefById("backpack")!.fit.designReference;

    const cap = await parseScene("everyday_cap.glb");
    const capSize = new Box3().setFromObject(cap.scene).getSize(new Vector3())
      .multiplyScalar(headMetric / propDefById("cap")!.fit.designReference);
    expect(capSize.x / headWidth).toBeLessThanOrEqual(1.02);
    expect(capSize.z / headDepth).toBeLessThanOrEqual(1.42);

    const glasses = await parseScene("everyday_glasses.glb");
    const glassesSize = new Box3().setFromObject(glasses.scene).getSize(new Vector3())
      .multiplyScalar(eyeDistance / propDefById("glasses")!.fit.designReference);
    expect(glassesSize.x / headWidth).toBeGreaterThan(0.58);
    expect(glassesSize.x / headWidth).toBeLessThanOrEqual(0.75);
    expect(glassesSize.z / headDepth).toBeLessThanOrEqual(0.95);

    const backpack = await parseScene("everyday_backpack.glb");
    const backpackSize = new Box3().setFromObject(backpack.scene).getSize(new Vector3())
      .multiplyScalar(resolvePropAttachment(
        propDefById("backpack")!,
        createPropInstance("backpack", "reference-backpack-fit")!,
        metrics,
      ).scale);
    expect(backpackSize.x / visualShoulderWidth).toBeGreaterThanOrEqual(0.65);
    expect(backpackSize.x / visualShoulderWidth).toBeLessThanOrEqual(0.76);
    expect(backpackSize.y).toBeLessThan(0.30);
    // Z includes the authored shoulder straps wrapping from the back contact to the chest.
    expect(backpackSize.z).toBeLessThan(0.30);

    VRMUtils.deepDispose(vrm.scene);
  });

  it("keeps the mug palm on the handle and away from the ceramic body", async () => {
    const mug = await parseScene("everyday_mug.glb");
    mug.scene.updateMatrixWorld(true);
    const anchor = anchorById("mug", "primary");
    const point = new Vector3(...anchor.position);
    const handle = mug.scene.getObjectByName("Mug_HandleContact")!;
    const body = mug.scene.getObjectByName("Mug_CeramicBody")!;
    expect(new Box3().setFromObject(handle).distanceToPoint(point)).toBeLessThanOrEqual(0.001);
    expect(new Box3().setFromObject(body).distanceToPoint(point)).toBeGreaterThan(0.045);
  });

  it("keeps the reference rig's palm on the handle with full hand-volume clearance", async () => {
    const [vrm, mug] = await Promise.all([
      parseReferenceVrm(),
      parseScene("everyday_mug.glb"),
    ]);
    const metrics = measureVrmPropRigMetrics(vrm);
    const resolved = resolvePropAttachment(
      propDefById("mug")!,
      createPropInstance("mug", "reference-mug-contact")!,
      metrics,
    );
    // The clearance this guards is the PALM's: the mug body must not intersect the mass the
    // handle sits against. Fingers curl around the handle rather than pushing the body away, so
    // the palm width comes from the hand metric with the proportion measured on the retired rig's
    // authored palm mesh — authored single-mesh models cannot promise a palm node to look up.
    const halfPalmVolume = metrics.rightHand * REFERENCE_PALM_WIDTH_PER_HAND_METRIC * 0.5;
    const anchor = new Vector3(...resolved.anchor.position);
    const handle = mug.scene.getObjectByName("Mug_HandleContact")!;
    const body = mug.scene.getObjectByName("Mug_CeramicBody")!;
    const scaledBodyClearance = new Box3().setFromObject(body).distanceToPoint(anchor) * resolved.scale;

    expect(new Box3().setFromObject(handle).distanceToPoint(anchor)).toBeLessThanOrEqual(0.001);
    expect(scaledBodyClearance).toBeGreaterThan(halfPalmVolume + 0.01);

    VRMUtils.deepDispose(vrm.scene);
  });

  it("documents the reproducible generator and all six CC0 outputs", () => {
    const license = readFileSync(join(process.cwd(), "apps/web/public", "assets", "3d", "LICENSES.md"), "utf8");
    expect(license).toContain(GENERATOR);
    expect(license).toContain("CC0 1.0");
    for (const gate of EVERYDAY_PROPS) expect(license).toContain(`\`${gate.filename}\``);
  });
});
