import { describe, expect, it } from "vitest";

import { STUDIO_AUTHORED_SCENE_TEMPLATES } from "./studio-authored-scene-templates";
import { summarizeStudioSceneTemplate } from "./studio-scene-template-summary";

describe("authored situation compositions", () => {
  it("has fourteen independent geometric compositions, not text/color variants", () => {
    expect(STUDIO_AUTHORED_SCENE_TEMPLATES).toHaveLength(14);
    const shapes = STUDIO_AUTHORED_SCENE_TEMPLATES.map((template) => JSON.stringify(template.build(0, 0).map((seed) => [seed.type, seed.x, seed.y, seed.width, "height" in seed ? seed.height : seed.fontSize])));
    expect(new Set(shapes).size).toBe(14);
  });
  it("preserves native editable seed types, finite bounds and origin translation", () => {
    for (const template of STUDIO_AUTHORED_SCENE_TEMPLATES) {
      const summary = summarizeStudioSceneTemplate(template);
      expect(summary.width).toBe(720); expect(summary.height).toBeLessThan(1000);
      const base = template.build(0, 0); const moved = template.build(21, -30);
      base.forEach((seed, index) => { expect(moved[index]).toEqual({ ...seed, x: seed.x + 21, y: seed.y - 30 }); });
    }
  });
  it("build returns fresh elements, preventing one insertion from modifying the next", () => {
    const template = STUDIO_AUTHORED_SCENE_TEMPLATES[0]; const first = template.build(0, 0); first[0].x = 999;
    expect(template.build(0, 0)[0].x).toBe(30);
  });
  it("rejects invalid dimensions in a schematic rather than creating a broken viewBox", () => {
    const bad = { ...STUDIO_AUTHORED_SCENE_TEMPLATES[0], build: () => [{ type: "frame" as const, x: NaN, y: 0, width: 10, height: 10 }] };
    expect(() => summarizeStudioSceneTemplate(bad)).toThrow();
  });
});
