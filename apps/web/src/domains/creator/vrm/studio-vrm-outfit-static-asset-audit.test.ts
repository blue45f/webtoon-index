import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FALLBACK_WARDROBE_METRICS,
  WARDROBE_ITEMS,
  buildGarmentParts,
} from "./studio-vrm-wardrobe";

const LEGACY_OUTFIT_FILES = [
  "outfit_cardigan.glb",
  "outfit_cyber_suit_v2.glb",
  "outfit_cyberpunk_suit.glb",
  "outfit_dress.glb",
  "outfit_hanbok_modern.glb",
  "outfit_kimono_traditional.glb",
  "outfit_pants.glb",
  "outfit_punk_jacket.glb",
  "outfit_sailor.glb",
  "outfit_scrubpants.glb",
  "outfit_scrubs.glb",
  "outfit_shorts.glb",
  "outfit_space_suit.glb",
  "outfit_tactical_vest.glb",
  "outfit_tank.glb",
  "outfit_trenchcoat.glb",
  "outfit_tshirt.glb",
  "outfit_wide.glb",
] as const;

type JsonRecord = Record<string, unknown>;

function embeddedJson(filePath: string): JsonRecord {
  const bytes = readFileSync(filePath);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true), filePath).toBe(0x46546c67);
  expect(view.getUint32(4, true), filePath).toBe(2);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
  ) as JsonRecord;
}

function productionSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const filePath = join(directory, name);
    if (statSync(filePath).isDirectory()) return productionSources(filePath);
    if (!/\.(?:ts|tsx)$/u.test(name) || /\.test\.(?:ts|tsx)$/u.test(name)) return [];
    return [readFileSync(filePath, "utf8")];
  });
}

describe("legacy static outfit GLB authority audit", () => {
  it("records all 18 rigid, unskinned reference shells instead of pretending they are wearable", () => {
    const outfitDir = join(process.cwd(), "apps/web/public", "assets", "3d", "outfits");
    expect(readdirSync(outfitDir).filter((name) => name.endsWith(".glb")).sort())
      .toEqual([...LEGACY_OUTFIT_FILES].sort());

    for (const fileName of LEGACY_OUTFIT_FILES) {
      const filePath = join(outfitDir, fileName);
      const json = embeddedJson(filePath);
      const meshes = (json.meshes as JsonRecord[] | undefined) ?? [];
      const primitives = meshes.flatMap((mesh) => (
        (mesh.primitives as { attributes?: JsonRecord }[] | undefined) ?? []
      ));

      expect((json.asset as JsonRecord).version, fileName).toBe("2.0");
      expect(json.skins ?? [], fileName).toEqual([]);
      expect(json.animations ?? [], fileName).toEqual([]);
      expect(primitives.length, fileName).toBeGreaterThan(0);
      expect(primitives.every((primitive) => primitive.attributes?.JOINTS_0 === undefined), fileName)
        .toBe(true);
      expect(primitives.every((primitive) => primitive.attributes?.WEIGHTS_0 === undefined), fileName)
        .toBe(true);
    }
  });

  it("keeps the historical directory outside the product runtime graph", () => {
    const source = productionSources(join(process.cwd(), "apps/web", "src", "domains", "creator")).join("\n");
    expect(source).not.toContain("/assets/3d/outfits/");
    for (const fileName of LEGACY_OUTFIT_FILES) expect(source).not.toContain(fileName);

    const auditPath = join(process.cwd(), "apps/web/public", "assets", "3d", "outfits", "README.md");
    expect(existsSync(auditPath)).toBe(true);
    const audit = readFileSync(auditPath, "utf8");
    expect(audit).toContain("not** the wardrobe assets shown");
    expect(audit).toContain("studio-vrm-skinned-garment.ts");
    expect(audit).toContain("inverse-bind matrices");
  });

  it("uses the tested measured, multi-part wardrobe generator for selectable items", () => {
    const selectable = WARDROBE_ITEMS.filter((item) => item.catalogStatus === "selectable");
    expect(selectable).toHaveLength(WARDROBE_ITEMS.length);
    expect(WARDROBE_ITEMS.every((item) => item.quality === "standard-procedural")).toBe(true);
    for (const item of selectable) {
      const parts = buildGarmentParts(item.id, FALLBACK_WARDROBE_METRICS);
      expect(parts.length, item.id).toBeGreaterThan(1);
      expect(item.geometrySource, item.id).toMatch(
        /^(?:skinned-procedural-v1|xpbd-skirt-v1|rigid-procedural)$/u,
      );
      if (item.slot !== "shoes") expect(item.geometrySource, item.id).not.toBe("rigid-procedural");
    }
  });
});
