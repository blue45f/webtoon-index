import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

type JsonRecord = Record<string, unknown>;

interface QualityGate {
  filename: string;
  assetId: string;
  minBytes: number;
  minNodes: number;
  minMaterials: number;
  minTriangles: number;
  minEmissiveMaterials: number;
  requiredNodes: readonly string[];
}

const QUALITY_GATES: readonly QualityGate[] = [
  {
    filename: "school_desk.glb",
    assetId: "school_desk_v2",
    minBytes: 180 * 1024,
    minNodes: 20,
    minMaterials: 5,
    minTriangles: 4_000,
    minEmissiveMaterials: 0,
    requiredNodes: ["Desktop_Oak", "BookShelf_Base", "SteelLeg_1", "BagHook"],
  },
  {
    filename: "vending_machine.glb",
    assetId: "vending_machine_v2",
    minBytes: 450 * 1024,
    minNodes: 55,
    minMaterials: 8,
    minTriangles: 10_000,
    minEmissiveMaterials: 2,
    requiredNodes: ["Cabinet_Main", "ProductBay_Glass", "PriceDisplay", "DeliveryDoor"],
  },
  {
    filename: "fantasy_magic_chest.glb",
    assetId: "fantasy_magic_chest_v2",
    minBytes: 180 * 1024,
    minNodes: 22,
    minMaterials: 6,
    minTriangles: 4_500,
    minEmissiveMaterials: 2,
    requiredNodes: ["Chest_Base", "Lid_ArchedWood", "Lock_Rune", "Corner_SoulGem_1"],
  },
  // modern_smartphone_prop.glb left this pack on 2026-09-06: the atelier v5 smartphone replaced
  // the v2 mesh and is pinned by wearable-v5-manifest.json / studio-vrm-prop-asset-revisions.ts.
  {
    filename: "cyber_glasses.glb",
    assetId: "cyber_glasses_v2",
    minBytes: 150 * 1024,
    minNodes: 19,
    minMaterials: 6,
    minTriangles: 4_500,
    minEmissiveMaterials: 3,
    requiredNodes: ["Left_LensRim", "Right_LensRim", "NoseBridge", "Left_TempleArm"],
  },
  {
    filename: "adaptive_power_wheelchair.glb",
    assetId: "adaptive_power_wheelchair",
    minBytes: 400 * 1024,
    minNodes: 52,
    minMaterials: 7,
    minTriangles: 14_000,
    minEmissiveMaterials: 1,
    requiredNodes: [
      "Left_DriveTyre",
      "Right_FrontCaster",
      "PressureReliefSeat",
      "Left_Footplate",
      "Joystick_Console",
      "Joystick_Knob",
    ],
  },
] as const;

const GLB_MAGIC = 0x4654_6c67;
const GLB_JSON_CHUNK = 0x4e4f_534a;
const GENERATOR = "scripts/blender/generate_story_props_pack_v2.py";
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
      const accessor = accessors[accessorIndex as number];
      expect(accessor.count).toBeTypeOf("number");
      triangles += Math.floor((accessor.count as number) / 3);
    }
  }
  return triangles;
}

describe("ToonSpectrum story prop GLB pack v2", () => {
  it.each(QUALITY_GATES)("$filename is a detailed, self-contained Blender GLB", (gate) => {
    const bytes = bundledBytes(gate.filename);
    expect(bytes.byteLength).toBeGreaterThanOrEqual(gate.minBytes);
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);

    const json = embeddedJson(bytes);
    const nodes = json.nodes as JsonRecord[];
    const materials = json.materials as JsonRecord[];
    const resources = [
      ...((json.buffers as JsonRecord[] | undefined) ?? []),
      ...((json.images as JsonRecord[] | undefined) ?? []),
    ];
    const nodeNames = new Set(nodes.map((node) => node.name));
    const materialNames = materials.map((material) => material.name);
    const emissiveMaterials = materials.filter((material) => {
      const factor = material.emissiveFactor;
      return Array.isArray(factor) && factor.some((channel) => typeof channel === "number" && channel > 0);
    });
    const root = nodes.find((node) => (node.extras as JsonRecord | undefined)?.asset_id === gate.assetId);

    expect(nodes.length).toBeGreaterThanOrEqual(gate.minNodes);
    expect(materials.length).toBeGreaterThanOrEqual(gate.minMaterials);
    expect(new Set(materialNames).size).toBe(materialNames.length);
    expect(triangleCount(json)).toBeGreaterThanOrEqual(gate.minTriangles);
    expect(emissiveMaterials.length).toBeGreaterThanOrEqual(gate.minEmissiveMaterials);
    expect(resources.every((resource) => resource.uri === undefined)).toBe(true);
    expect(gate.requiredNodes.every((name) => nodeNames.has(name))).toBe(true);
    expect(root?.extras).toMatchObject({
      asset_id: gate.assetId,
      asset_author: "ToonSpectrum",
      asset_generator: GENERATOR,
      asset_license: "CC0-1.0",
      asset_license_url: CC0_LICENSE_URL,
      units: "metres",
    });
  });

  it("documents the reproducible source, dimensions, and redistribution rights", () => {
    const license = readFileSync(
      join(process.cwd(), "apps/web/public", "assets", "3d", "LICENSES.md"),
      "utf8",
    );
    expect(license).toContain(GENERATOR);
    expect(license).toContain("CC0 1.0");
    for (const gate of QUALITY_GATES) {
      expect(license).toContain(`\`${gate.filename}\``);
    }
  });
});
