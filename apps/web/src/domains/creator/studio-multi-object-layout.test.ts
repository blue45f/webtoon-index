import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  STUDIO_ROOM_LAYOUT_PRESETS,
  StudioMultiObjectLayoutManager,
} from "./studio-multi-object-layout";

describe("StudioMultiObjectLayoutManager", () => {
  it("adds and duplicates 3D object instances", () => {
    const manager = new StudioMultiObjectLayoutManager();
    const obj1 = manager.addObject({
      modelUrl: "/desk.glb",
      name: "책상",
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
    });

    expect(obj1.id).toBeDefined();
    expect(manager.getAllObjects()).toHaveLength(1);

    const dup = manager.duplicateObject(obj1.id);
    expect(dup).toBeDefined();
    expect(dup?.name).toContain("복사본");
    expect(manager.getAllObjects()).toHaveLength(2);
  });

  it("snaps object to floor level y=0", () => {
    const manager = new StudioMultiObjectLayoutManager();
    const obj = manager.addObject({
      modelUrl: "/chair.glb",
      name: "의자",
      position: [1, 2.5, 3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
    });

    const snapped = manager.snapToFloor(obj.id);
    expect(snapped?.position[1]).toBe(0);
  });

  it("loads room layout presets (classroom, cafe)", () => {
    const manager = new StudioMultiObjectLayoutManager();
    const classroomObjs = manager.loadPreset("classroom");
    expect(classroomObjs.length).toBeGreaterThan(0);
    expect(STUDIO_ROOM_LAYOUT_PRESETS.length).toBeGreaterThanOrEqual(2);
  });

  it("backs every room preset URL with a real Blender GLB asset", () => {
    const urls = new Set(
      STUDIO_ROOM_LAYOUT_PRESETS.flatMap((preset) =>
        preset.objects.map((object) => object.modelUrl)),
    );
    expect(urls).toEqual(new Set([
      "/assets/3d/blackboard.glb",
      "/assets/3d/desk.glb",
      "/assets/3d/chair.glb",
      "/assets/3d/round_table.glb",
      "/assets/3d/sofa.glb",
    ]));

    for (const url of urls) {
      expect(url).toMatch(/^\/assets\/3d\/[a-z_]+\.glb$/);
      const file = statSync(join(process.cwd(), "apps/web/public", url));
      expect(file.isFile(), url).toBe(true);
      expect(file.size, url).toBeGreaterThan(10 * 1024);
    }
  });

  it("documents first-party source and redistribution rights for every bundled GLB", () => {
    const licensePath = join(process.cwd(), "apps/web/public", "assets", "3d", "LICENSES.md");
    const license = readFileSync(licensePath, "utf8");

    expect(license).toContain("generate_core_furniture_pack.py");
    expect(license).toContain("CC0 1.0");
    for (const filename of [
      "blackboard.glb",
      "desk.glb",
      "chair.glb",
      "round_table.glb",
      "sofa.glb",
    ]) {
      expect(license).toContain(`\`${filename}\``);
    }
  });
});
