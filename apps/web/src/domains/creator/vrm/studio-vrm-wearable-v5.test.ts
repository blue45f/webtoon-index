import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { describe, expect, it } from "vitest";

import { applyStudioVrmPropTint } from "./studio-vrm-prop-material";
import { BLENDER_PROP_GLTF_URLS, propDefById } from "./studio-vrm-props";

(globalThis as unknown as { self: typeof globalThis }).self = globalThis;

interface WearableAsset {
  id: string;
  file: string;
  license: string;
  source: string;
  generator: string;
  units: string;
  anchor: [number, number, number];
  bounds: [[number, number, number], [number, number, number]];
  triangles: number;
  drawCalls: number;
  bytes: number;
  sha256: string;
}
const root = join(process.cwd(), "apps/web/public/assets/3d");
const manifest = JSON.parse(readFileSync(join(root, "wearable-v5-manifest.json"), "utf8")) as {
  version: number;
  assets: WearableAsset[];
};
const expectedIds = ["mic", "cap", "beret", "sunglasses", "headphones", "ribbon", "beanie", "blender_wizard_hat", "smartphone", "camera", "medicalBag", "shoulderbag"];

function bytesFor(asset: WearableAsset) { return readFileSync(join(root, asset.file)); }
async function sceneFor(asset: WearableAsset) {
  const bytes = bytesFor(asset);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return (await new GLTFLoader().parseAsync(buffer, "")).scene;
}

describe("original wearable pack v5", () => {
  it("upgrades twelve existing semantic IDs, rather than inflating the catalogue with duplicates", () => {
    expect(manifest.version).toBe(5);
    expect(manifest.assets.map((asset) => asset.id)).toEqual(expectedIds);
    expect(new Set(manifest.assets.map((asset) => asset.file)).size).toBe(12);
    for (const asset of manifest.assets) {
      expect(propDefById(asset.id)?.geometrySource).toEqual({ kind: "gltf", url: `/assets/3d/${asset.file}` });
    }
    expect(BLENDER_PROP_GLTF_URLS.blender_modern_smartphone).toBe(BLENDER_PROP_GLTF_URLS.smartphone);
  });

  it.each(manifest.assets)("$id has reproducible provenance and a bounded, self-contained binary", (asset) => {
    const bytes = bytesFor(asset);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("glTF");
    expect(bytes.length).toBe(asset.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect(asset.license).toBe("CC0-1.0");
    expect(asset.source).toBe("original-parametric-authoring");
    expect(asset.generator).toBe("scripts/generate-studio-wearable-v5.mts");
    expect(asset.units).toBe("metres");
    expect(asset.triangles).toBeGreaterThan(0);
    expect(asset.triangles).toBeLessThan(60_000);
    expect(asset.drawCalls).toBeLessThanOrEqual(6);
    const jsonLength = bytes.readUInt32LE(12);
    const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
      buffers: { uri?: string }[];
      images?: { uri?: string }[];
      materials: { name: string; pbrMetallicRoughness?: unknown }[];
    };
    expect([...json.buffers, ...(json.images ?? [])].every((resource) => resource.uri === undefined)).toBe(true);
    expect(json.materials.every((material) => material.pbrMetallicRoughness !== undefined)).toBe(true);
    expect(new Set(json.materials.map((material) => material.name)).size).toBe(json.materials.length);
  });

  it.each(manifest.assets)("$id keeps finite indexed geometry, UVs, normals and serialized anchors", async (asset) => {
    const scene = await sceneFor(asset);
    scene.updateMatrixWorld(true);
    let triangles = 0;
    let meshes = 0;
    scene.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      meshes += 1;
      expect(mesh.geometry.index).not.toBeNull();
      for (const key of ["position", "normal", "uv"]) {
        const attribute = mesh.geometry.getAttribute(key);
        expect(attribute).toBeDefined();
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
      triangles += mesh.geometry.index!.count / 3;
    });
    expect(triangles).toBe(asset.triangles);
    expect(meshes).toBe(asset.drawCalls);
    const bounds = new Box3().setFromObject(scene);
    expect(bounds.min.distanceTo(new Vector3(...asset.bounds[0]))).toBeLessThan(0.00001);
    expect(bounds.max.distanceTo(new Vector3(...asset.bounds[1]))).toBeLessThan(0.00001);
    const definition = propDefById(asset.id)!;
    const contact = definition.anchors.find((anchor) => anchor.role === "primary")
      ?? definition.anchors.find((anchor) => anchor.role === "surface")
      ?? definition.anchors[0];
    expect(contact?.position).toEqual(asset.anchor);
  });

  it("does not fake a head contact with a visible post inside the cap cavity", async () => {
    const scene = await sceneFor(manifest.assets.find((asset) => asset.id === "cap")!);
    expect(scene.getObjectByName("Cap_HeadContact")).toBeUndefined();
    const bounds = new Box3().setFromObject(scene);
    expect(bounds.min.y).toBeGreaterThan(0.045);
    expect(bounds.max.y).toBeLessThan(0.18);
    expect(bounds.getSize(new Vector3()).x).toBeLessThan(0.225);
    // A wearable anchor can be inside its hollow cavity. It must not require artificial geometry.
    expect(propDefById("cap")!.anchors[0]!.position).toEqual([0, 0, 0]);
  });

  it.each(manifest.assets.filter((asset) => asset.id !== "blender_wizard_hat"))("$id recolors only the authored body and releases instance materials", async (asset) => {
    const original = await sceneFor(asset);
    const instance = original.clone(true);
    const originals: MeshStandardMaterial[] = [];
    const before: number[] = [];
    original.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const material = (object as Mesh).material as MeshStandardMaterial;
      originals.push(material); before.push(material.color.getHex());
    });
    const restore = applyStudioVrmPropTint(instance, asset.id, "#8040cc");
    let changed = 0;
    instance.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const material = (object as Mesh).material as MeshStandardMaterial;
      if (material.userData.toonspectrum_tintable === true) {
        changed += 1;
        expect(material.color.getHexString()).toBe("8040cc");
        expect(originals.includes(material)).toBe(false);
      } else expect(originals.includes(material)).toBe(true);
    });
    expect(changed).toBeGreaterThan(0);
    expect(originals.map((material) => material.color.getHex())).toEqual(before);
    restore();
    instance.traverse((object) => {
      if ((object as Mesh).isMesh) expect(originals.includes((object as Mesh).material as MeshStandardMaterial)).toBe(true);
    });
  });
});
