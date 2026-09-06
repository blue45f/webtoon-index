import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import { filterStudioBrushCatalogItems, studioBrushCatalogItemById } from "./studio-brush-catalog";
import { STUDIO_BRUSH_DISCOVERY } from "./studio-brush-discovery";
import { STUDIO_SUB_TOOL_PALETTE_CATEGORIES } from "./studio-sub-tool-palette-data";

describe("brush discovery without destructive catalogue migration", () => {
  it("offers 18 genuinely named shortcut choices in six usable categories", () => {
    const tools = STUDIO_SUB_TOOL_PALETTE_CATEGORIES.flatMap((group) => group.tools);
    expect(tools).toHaveLength(18);
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(18);
    expect(STUDIO_SUB_TOOL_PALETTE_CATEGORIES).toHaveLength(6);
    for (const tool of tools) {
      expect(tool.name).toBe(STUDIO_BRUSH_DISCOVERY[tool.id].name);
      expect(tool.hint!.length).toBeGreaterThan(10);
      expect(BRUSH_PRESETS.find((preset) => preset.id === tool.id)?.name).toBe(tool.name);
    }
  });
  it("retains every omitted specialist's exact ID in the full library", () => {
    const tools = STUDIO_SUB_TOOL_PALETTE_CATEGORIES.flatMap((group) => group.tools);
    for (const id of ["perfect-ink", "pencil-grain", "inkwash-pen", "inkwash-water-brush", "brush", "hard-airbrush"]) {
      expect(tools.some((tool) => tool.id === id)).toBe(false);
      expect(studioBrushCatalogItemById(id)?.id).toBe(id);
      expect(filterStudioBrushCatalogItems({ query: id }).some((item) => item.id === id)).toBe(true);
    }
  });
  it("preserves physical defaults and erase operations while only renaming presentation", () => {
    expect(BRUSH_PRESETS.find((preset) => preset.id === "pen")).toMatchObject({ id: "pen", defaultWidth: 6, defaultOpacity: 1, operation: "paint" });
    expect(BRUSH_PRESETS.find((preset) => preset.id === "marker")).toMatchObject({ defaultWidth: 16, defaultOpacity: 0.6, operation: "paint" });
    expect(BRUSH_PRESETS.find((preset) => preset.id === "kneaded-eraser")).toMatchObject({ defaultWidth: 26, defaultOpacity: 0.38, operation: "erase" });
  });
  it("finds old names, full-width IDs, and multiple intent words", () => {
    for (const [query, id] of [["만년필(사선 촉)", "fountain-pen"], ["스플래터(흩뿌리기)", "splatter"], ["방사 버스트", "web-radial-burst"], ["ＧＰＥＮ 선화", "gpen"], ["물감 매트", "gouache--matte-body"]]) {
      expect(filterStudioBrushCatalogItems({ query }).map((item) => item.id), query).toContain(id);
    }
  });
  it("searches favorites and recent without leaking global matches or duplicating pinned IDs", () => {
    expect(filterStudioBrushCatalogItems({ category: "favorites", query: "pen", favoriteIds: ["gpen", "gpen", "watercolor"] }).map((item) => item.id)).toEqual(["gpen"]);
    expect(filterStudioBrushCatalogItems({ category: "recent", query: "pen", recentIds: ["pen", "gpen", "pen", "watercolor"] }).map((item) => item.id)).toEqual(["pen", "gpen"]);
    expect(filterStudioBrushCatalogItems({ category: "favorites", query: "pen", favoriteIds: [] })).toEqual([]);
  });
  it("retains global intent search from material tabs and never crosses an operation boundary", () => {
    expect(filterStudioBrushCatalogItems({ category: "watercolor", query: "ＧＰＥＮ" }).map((item) => item.id)).toContain("gpen");
    expect(filterStudioBrushCatalogItems({ operation: "erase", query: "gpen" })).toEqual([]);
  });
});
