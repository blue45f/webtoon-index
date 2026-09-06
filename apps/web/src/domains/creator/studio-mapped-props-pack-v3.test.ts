import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { BLENDER_PROP_GLTF_URLS } from "./vrm/studio-vrm-props";

type JsonRecord = Record<string, unknown>;
type QualityClass = "handheld" | "headwear" | "large-body";

interface PropGate {
  mappedId: keyof typeof BLENDER_PROP_GLTF_URLS;
  filename: string;
  assetId: string;
  qualityClass: QualityClass;
  minNodes: number;
  minEmissiveMaterials: number;
  requiredNodes: readonly string[];
}

const WAVE3_PROPS: readonly PropGate[] = [
  { mappedId: "blender_cyber_katana", filename: "cyber_katana.glb", assetId: "cyber_katana_v3", qualityClass: "handheld", minNodes: 15, minEmissiveMaterials: 2, requiredNodes: ["Blade_TaperedCore", "Handle_Core"] },
  { mappedId: "blender_magic_staff", filename: "magic_staff_crystal.glb", assetId: "magic_staff_crystal_v3", qualityClass: "handheld", minNodes: 16, minEmissiveMaterials: 1, requiredNodes: ["Staff_RunewoodShaft", "Crystal_FacetedCore"] },
  { mappedId: "blender_scifi_drone", filename: "scifi_drone_bot.glb", assetId: "scifi_drone_bot_v3", qualityClass: "large-body", minNodes: 24, minEmissiveMaterials: 3, requiredNodes: ["Drone_CentralShell", "Drone_ThrusterRing_1"] },
  { mappedId: "blender_neon_bench", filename: "neom_bench_prop.glb", assetId: "neon_bench_prop_v3", qualityClass: "large-body", minNodes: 28, minEmissiveMaterials: 1, requiredNodes: ["Bench_SeatSlat_1", "Bench_NeonFront"] },
  { mappedId: "blender_cyber_visor", filename: "cyber_helmet_visor.glb", assetId: "cyber_helmet_visor_v3", qualityClass: "headwear", minNodes: 14, minEmissiveMaterials: 2, requiredNodes: ["Visor_CurvedShield", "Visor_OuterFrame"] },
  { mappedId: "blender_holo_tablet", filename: "hologram_tablet.glb", assetId: "hologram_tablet_v3", qualityClass: "handheld", minNodes: 18, minEmissiveMaterials: 2, requiredNodes: ["Tablet_HoloScreen", "Tablet_HologramCore"] },
  { mappedId: "blender_rune_shield", filename: "ancient_rune_shield.glb", assetId: "ancient_rune_shield_v3", qualityClass: "handheld", minNodes: 22, minEmissiveMaterials: 1, requiredNodes: ["RuneShield_OuterRim", "RuneShield_RuneCircle"] },
  { mappedId: "blender_arcade_cabinet", filename: "arcade_game_cabinet.glb", assetId: "arcade_game_cabinet_v3", qualityClass: "large-body", minNodes: 26, minEmissiveMaterials: 3, requiredNodes: ["Arcade_CRTGlass", "Arcade_JoystickBall"] },
  { mappedId: "blender_medieval_greatsword", filename: "medieval_greatsword.glb", assetId: "medieval_greatsword_v3", qualityClass: "handheld", minNodes: 19, minEmissiveMaterials: 1, requiredNodes: ["Greatsword_TaperedBlade", "Greatsword_PommelGem"] },
  { mappedId: "blender_cyber_hoverbike", filename: "cyberpunk_hoverbike.glb", assetId: "cyberpunk_hoverbike_v3", qualityClass: "large-body", minNodes: 19, minEmissiveMaterials: 1, requiredNodes: ["Hoverbike_RiderSeat", "Hoverbike_LeftFrontLiftRing"] },
  { mappedId: "blender_cyber_sniper_rifle", filename: "cyber_sniper_rifle.glb", assetId: "cyber_sniper_rifle_v3", qualityClass: "handheld", minNodes: 25, minEmissiveMaterials: 1, requiredNodes: ["Sniper_Receiver", "Sniper_ScopeLens"] },
  { mappedId: "blender_magic_wand_staff", filename: "fantasy_magic_wand_staff.glb", assetId: "fantasy_magic_wand_staff_v3", qualityClass: "handheld", minNodes: 19, minEmissiveMaterials: 2, requiredNodes: ["Wand_StarCore", "Wand_OrbitRing"] },
  { mappedId: "blender_steampunk_airship", filename: "steampunk_airship.glb", assetId: "steampunk_airship_v3", qualityClass: "large-body", minNodes: 25, minEmissiveMaterials: 1, requiredNodes: ["Airship_MainEnvelope", "Airship_GondolaHull"] },
  { mappedId: "blender_cyberpunk_motorcycle", filename: "cyberpunk_motorcycle.glb", assetId: "cyberpunk_motorcycle_v3", qualityClass: "large-body", minNodes: 26, minEmissiveMaterials: 1, requiredNodes: ["Motorcycle_FrontTyre", "Motorcycle_RiderSeat"] },
  { mappedId: "blender_scifi_laser_gun", filename: "scifi_laser_gun.glb", assetId: "scifi_laser_gun_v3", qualityClass: "handheld", minNodes: 18, minEmissiveMaterials: 2, requiredNodes: ["LaserGun_MainReceiver", "LaserGun_MuzzleGlow"] },
  { mappedId: "blender_magic_grimoire", filename: "magic_grimoire.glb", assetId: "magic_grimoire_v3", qualityClass: "handheld", minNodes: 19, minEmissiveMaterials: 2, requiredNodes: ["Grimoire_PageBlock", "Grimoire_CentreGem"] },
  { mappedId: "blender_medieval_shield", filename: "medieval_shield.glb", assetId: "medieval_shield_v3", qualityClass: "handheld", minNodes: 15, minEmissiveMaterials: 0, requiredNodes: ["MedievalShield_IronFace", "MedievalShield_BackHandle"] },
  { mappedId: "blender_street_lamp", filename: "street_lamp.glb", assetId: "street_lamp_v3", qualityClass: "large-body", minNodes: 22, minEmissiveMaterials: 1, requiredNodes: ["StreetLamp_MainPole", "StreetLamp_LeftGlassGlobe"] },
  { mappedId: "blender_royal_throne", filename: "royal_throne.glb", assetId: "royal_throne_v3", qualityClass: "large-body", minNodes: 30, minEmissiveMaterials: 1, requiredNodes: ["Throne_SeatCushion", "Throne_CrownJewel"] },
  { mappedId: "blender_crystal_orb", filename: "crystal_orb.glb", assetId: "crystal_orb_v3", qualityClass: "handheld", minNodes: 11, minEmissiveMaterials: 3, requiredNodes: ["CrystalOrb_OuterGlass", "CrystalOrb_InnerCore"] },
  { mappedId: "blender_tactical_helmet", filename: "tactical_helmet.glb", assetId: "tactical_helmet_v3", qualityClass: "headwear", minNodes: 21, minEmissiveMaterials: 2, requiredNodes: ["Helmet_MainShell", "Helmet_FrontVisor"] },
] as const;

/** Atelier v5 wearables/props (wearable-v5-manifest.json) share the same URL table. */
const ATELIER_V5_PACK_IDS = [
  "mic",
  "beret",
  "sunglasses",
  "headphones",
  "ribbon",
  "beanie",
  "camera",
  "medicalBag",
  "shoulderbag",
] as const;

const EXCLUDED_WAVE2_IDS = [
  "blender_magic_chest",
  "blender_modern_smartphone",
  "blender_cyber_glasses",
  "blender_vending_machine",
  "blender_school_desk",
  "blender_adaptive_power_wheelchair",
] as const;

const EXCLUDED_EVERYDAY_V4_IDS = [
  "smartphone",
  "mug",
  "book",
  "cap",
  "glasses",
  "backpack",
  "stethoscope",
] as const;

const V6_DIVERSE_PACK_IDS = [
  "blender_ramen_bowl",
  "blender_ice_cream_cone",
  "blender_bubble_tea",
  "blender_paper_lantern",
  "blender_potted_monstera",
  "blender_bonsai_tree",
  "blender_street_food_cart",
  "blender_traffic_light",
  "blender_mailbox",
  "blender_grandfather_clock",
  "blender_fireplace",
  "blender_bathtub",
  "blender_kitchen_stove",
  "blender_campfire",
  "blender_wishing_well",
  "blender_robot_pet",
  "blender_mech_turret",
  "blender_fox_mask",
  "blender_wizard_hat",
  "blender_tea_set",
  "blender_hanging_sign",
] as const;

const GLB_MAGIC = 0x4654_6c67;
const GLB_JSON_CHUNK = 0x4e4f_534a;
const GENERATOR = "scripts/blender/generate_mapped_props_pack_v3.py";
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

describe("ToonSpectrum mapped Blender prop pack v3", () => {
  it("covers exactly the 21 mappings not already replaced by the v2 pack", () => {
    expect(Object.keys(BLENDER_PROP_GLTF_URLS)).toHaveLength(64);
    expect(WAVE3_PROPS).toHaveLength(21);
    const expectedIds = new Set([
      ...WAVE3_PROPS.map((gate) => gate.mappedId),
      ...EXCLUDED_WAVE2_IDS,
      ...EXCLUDED_EVERYDAY_V4_IDS,
      ...V6_DIVERSE_PACK_IDS,
      ...ATELIER_V5_PACK_IDS,
    ]);
    expect(new Set(Object.keys(BLENDER_PROP_GLTF_URLS))).toEqual(expectedIds);
    for (const gate of WAVE3_PROPS) {
      expect(BLENDER_PROP_GLTF_URLS[gate.mappedId]).toBe(`/assets/3d/${gate.filename}`);
    }
  });

  it.each(WAVE3_PROPS)("$filename meets its strict v3 GLB quality gate", (gate) => {
    const bytes = bundledBytes(gate.filename);
    const minimumBytes = gate.qualityClass === "large-body" ? 280 * 1024 : 140 * 1024;
    const minimumTriangles = gate.qualityClass === "large-body" ? 6_000 : 2_500;
    expect(bytes.byteLength).toBeGreaterThanOrEqual(minimumBytes);
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);

    const json = embeddedJson(bytes);
    const nodes = json.nodes as JsonRecord[];
    const materials = json.materials as JsonRecord[];
    const resources = [
      ...((json.buffers as JsonRecord[] | undefined) ?? []),
      ...((json.images as JsonRecord[] | undefined) ?? []),
    ];
    const nodeNames = new Set(nodes.map((node) => node.name));
    const materialNames = materials.map((entry) => entry.name);
    const emissiveMaterials = materials.filter((entry) => {
      const factor = entry.emissiveFactor;
      return Array.isArray(factor)
        && factor.some((channel) => typeof channel === "number" && channel > 0);
    });
    const root = nodes.find((node) => (node.extras as JsonRecord | undefined)?.asset_id === gate.assetId);

    expect(nodes.length).toBeGreaterThanOrEqual(gate.minNodes);
    expect(materials.length).toBeGreaterThanOrEqual(4);
    expect(new Set(materialNames).size).toBe(materialNames.length);
    expect(materials.every((entry) => entry.pbrMetallicRoughness !== undefined)).toBe(true);
    expect(emissiveMaterials.length).toBeGreaterThanOrEqual(gate.minEmissiveMaterials);
    expect(triangleCount(json)).toBeGreaterThanOrEqual(minimumTriangles);
    expect(resources.every((resource) => resource.uri === undefined)).toBe(true);
    expect(gate.requiredNodes.every((name) => nodeNames.has(name))).toBe(true);
    expect(root?.extras).toMatchObject({
      asset_id: gate.assetId,
      asset_author: "ToonSpectrum",
      asset_generator: GENERATOR,
      asset_license: "CC0-1.0",
      asset_license_url: CC0_LICENSE_URL,
      units: "metres",
      quality_class: gate.qualityClass,
    });
  });

  it("documents every stable filename and its reproducible CC0 source", () => {
    const license = readFileSync(
      join(process.cwd(), "apps/web/public", "assets", "3d", "LICENSES.md"),
      "utf8",
    );
    expect(license).toContain(GENERATOR);
    expect(license).toContain("CC0 1.0");
    expect(license).toContain("`neom_bench_prop.glb`의 `neom` 표기");
    for (const gate of WAVE3_PROPS) {
      expect(license).toContain(`\`${gate.filename}\``);
    }
  });
});
