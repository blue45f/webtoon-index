import { describe, expect, it } from "vitest";

import {
  buildShaperLayeredPsd,
  DEFAULT_SHAPER_SELECTION,
  DEFAULT_SHAPER_SURFACE_DRAW_STATE,
  recommendShaperPreset,
  SHAPER_AI_ARCHETYPES,
  SHAPER_CATEGORIES,
  SHAPER_PRESETS,
} from "./studio-shaper-model";

describe("studio-shaper-model", () => {
  it("provides the 14 modular authoring categories", () => {
    expect(SHAPER_CATEGORIES.length).toBe(14);
    expect(DEFAULT_SHAPER_SELECTION.face).toBeDefined();
    const categoryIds = SHAPER_CATEGORIES.map((c) => c.id);
    expect(categoryIds).toContain("face");
    expect(categoryIds).toContain("eye");
    expect(categoryIds).toContain("hair");
    expect(categoryIds).toContain("body");
    expect(categoryIds).toContain("top");
    expect(categoryIds).toContain("bottom");
    expect(categoryIds).toContain("bodypose");
    expect(categoryIds).toContain("handpose");
  });

  it("contains curated presets for all 14 categories", () => {
    for (const cat of SHAPER_CATEGORIES) {
      const items = SHAPER_PRESETS.filter((p) => p.category === cat.id);
      expect(items.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("recommends full 14-slot selections for AI archetypes", () => {
    for (const archetype of SHAPER_AI_ARCHETYPES) {
      const recommended = recommendShaperPreset(archetype.id);
      expect(Object.keys(recommended).length).toBe(14);
      expect(recommended.face).toBeDefined();
      expect(recommended.hair).toBeDefined();
      expect(recommended.body).toBeDefined();
    }
  });

  it("provides default state for 3D surface drawing", () => {
    expect(DEFAULT_SHAPER_SURFACE_DRAW_STATE.active).toBe(false);
    expect(DEFAULT_SHAPER_SURFACE_DRAW_STATE.brushMode).toBe("pen");
    expect(DEFAULT_SHAPER_SURFACE_DRAW_STATE.strokes).toEqual([]);
  });

  it("generates a valid transparent layered PSD blob with separated passes", () => {
    const width = 10;
    const height = 10;
    const dummyBuffer = new Uint8ClampedArray(width * height * 4);
    // RGBA: solid blue
    for (let i = 0; i < dummyBuffer.length; i += 4) {
      dummyBuffer[i] = 0;
      dummyBuffer[i + 1] = 100;
      dummyBuffer[i + 2] = 255;
      dummyBuffer[i + 3] = 255;
    }

    const blob = buildShaperLayeredPsd({
      width,
      height,
      flatColor: dummyBuffer,
      shadowCel: dummyBuffer,
      lineArt: dummyBuffer,
      drawStrokes: dummyBuffer,
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/vnd.adobe.photoshop");
    expect(blob.size).toBeGreaterThan(50);
  });
});
