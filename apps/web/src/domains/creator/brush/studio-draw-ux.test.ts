import { describe, expect, it } from "vitest";

import { STUDIO_ALL_BRUSH_CATALOG_ITEMS } from "./studio-brush-catalog";
import { isStudioBrushPackCatalogId } from "./studio-brush-pack-id";
import {
  adjustStudioBrushOpacity,
  adjustStudioBrushSize,
  filterStudioBrushLibraryItems,
  studioBrushPresetById,
  studioBrushSizeStep,
  STUDIO_BRUSH_SIZE_RANGE,
} from "./studio-draw-ux";

describe("studio-draw-ux", () => {
  it("nudges brush size with coarse-when-large steps and clamps", () => {
    expect(adjustStudioBrushSize(6, studioBrushSizeStep(6, 1))).toBe(7);
    expect(adjustStudioBrushSize(40, studioBrushSizeStep(40, 1))).toBe(44);
    expect(adjustStudioBrushSize(1, -5)).toBe(STUDIO_BRUSH_SIZE_RANGE.min);
    expect(adjustStudioBrushSize(90, 10)).toBe(STUDIO_BRUSH_SIZE_RANGE.max);
  });

  it("adjusts opacity in percent-safe steps", () => {
    expect(adjustStudioBrushOpacity(0.5, 0.1)).toBe(0.6);
    expect(adjustStudioBrushOpacity(0.05, -0.1)).toBe(0.05);
    expect(adjustStudioBrushOpacity(0.98, 0.1)).toBe(1);
  });

  it("filters library by favorites, recent, and search", () => {
    const fav = filterStudioBrushLibraryItems({
      category: "favorites",
      favoriteIds: ["neon", "missing", "pen"],
    });
    expect(fav.map((i) => i.id)).toEqual(["neon", "pen"]);

    const recent = filterStudioBrushLibraryItems({
      category: "recent",
      recentIds: ["glow", "pen"],
    });
    expect(recent.map((i) => i.id)).toEqual(["glow", "pen"]);

    const searched = filterStudioBrushLibraryItems({
      category: "all",
      query: "글리터",
    });
    expect(searched.some((i) => i.id === "glitter")).toBe(true);
  });

  it("filters the complete injected catalog without losing Pro favorites, recents, or search", () => {
    // 티어("프로") 탭이 사라져도 팩 브러시는 재질 탭으로 전부 도달 가능해야 한다.
    const all = filterStudioBrushLibraryItems({
      category: "all",
      catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
    });
    const pro = all.filter((item) => isStudioBrushPackCatalogId(item.id));
    expect(pro).toHaveLength(160);
    expect(new Set(pro.map((item) => item.id))).toHaveProperty("size", 160);
    for (const item of pro) {
      const tabItems = filterStudioBrushLibraryItems({
        category: item.mediaGroup,
        catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
      });
      expect(
        tabItems.some((candidate) => candidate.id === item.id),
        `${item.id}: unreachable from its ${item.mediaGroup} tab`,
      ).toBe(true);
    }

    const favorites = filterStudioBrushLibraryItems({
      category: "favorites",
      favoriteIds: ["heart-stamp", "neon", "missing", "checker-grid"],
      catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
    });
    expect(favorites.map((item) => item.id)).toEqual([
      "heart-stamp",
      "neon",
      "checker-grid",
    ]);

    const recent = filterStudioBrushLibraryItems({
      category: "recent",
      recentIds: ["hair-fiber", "pen", "footstep-stamp", "hair-fiber"],
      catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
    });
    expect(recent.map((item) => item.id)).toEqual([
      "hair-fiber",
      "pen",
      "footstep-stamp",
    ]);

    const searched = filterStudioBrushLibraryItems({
      category: "all",
      query: "발자국",
      catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
    });
    expect(searched.map((item) => item.id)).toEqual(["footstep-stamp"]);
  });

  it("resolves preset by id", () => {
    expect(studioBrushPresetById("watercolor")?.name).toContain("수채");
    expect(studioBrushPresetById("nope")).toBeNull();
  });
});
