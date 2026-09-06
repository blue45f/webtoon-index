import { describe, expect, it } from "vitest";

import {
  STUDIO_ROOM_LAYOUT_PRESETS,
  StudioMultiObjectLayoutManager,
} from "./studio-multi-object-layout";

describe("StudioMultiObjectPanel integration", () => {
  it("room presets contain classroom and cafe", () => {
    const ids = STUDIO_ROOM_LAYOUT_PRESETS.map((p) => p.id);
    expect(ids).toContain("classroom");
    expect(ids).toContain("cafe");
  });

  it("manager loads classroom preset and returns objects", () => {
    const manager = new StudioMultiObjectLayoutManager();
    const objs = manager.loadPreset("classroom");
    expect(objs.length).toBeGreaterThanOrEqual(2);
    for (const obj of objs) {
      expect(obj.id).toBeTruthy();
      expect(obj.visible).toBe(true);
    }
  });

  it("duplicate creates copy with offset position", () => {
    const manager = new StudioMultiObjectLayoutManager();
    const objs = manager.loadPreset("cafe");
    const first = objs[0];
    if (!first) return;
    const dup = manager.duplicateObject(first.id);
    expect(dup).not.toBeNull();
    expect(dup!.position[0]).not.toEqual(first.position[0]);
  });

  it("snapToFloor sets Y to 0", () => {
    const manager = new StudioMultiObjectLayoutManager();
    const added = manager.addObject({
      modelUrl: "/test.glb",
      name: "Test",
      position: [1, 5, 2],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
    });
    const snapped = manager.snapToFloor(added.id);
    expect(snapped?.position[1]).toBe(0);
  });
});
