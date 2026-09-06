import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import { isStudioBrushQuarantinedPresetId } from "./studio-brush-quarantine";
import {
  STUDIO_SUB_TOOL_PALETTE_CATEGORIES,
  STUDIO_SUB_TOOL_PALETTE_DEFAULT_CATEGORY_ID,
  studioSubToolPaletteCategoryById,
  studioSubToolPaletteCategoryIdForBrushId,
  studioSubToolPalettePresetById,
} from "./studio-sub-tool-palette-data";

const CORE_PRESET_IDS = new Set(BRUSH_PRESETS.map((preset) => preset.id));

describe("studio sub tool palette data", () => {
  it("only lists ids that exist in the launch-safe core catalogue", () => {
    for (const category of STUDIO_SUB_TOOL_PALETTE_CATEGORIES) {
      for (const tool of category.tools) {
        expect(CORE_PRESET_IDS.has(tool.id), `${category.id}/${tool.id}`).toBe(true);
      }
    }
  });

  it("never exposes a quarantined preset", () => {
    for (const category of STUDIO_SUB_TOOL_PALETTE_CATEGORIES) {
      for (const tool of category.tools) {
        expect(isStudioBrushQuarantinedPresetId(tool.id), tool.id).toBe(false);
      }
    }
  });

  it("keeps every curated category usable after fail-closed filtering", () => {
    for (const category of STUDIO_SUB_TOOL_PALETTE_CATEGORIES) {
      expect(category.tools.length, category.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps tool operations coherent with each category's draw mode", () => {
    for (const category of STUDIO_SUB_TOOL_PALETTE_CATEGORIES) {
      for (const tool of category.tools) {
        const preset = BRUSH_PRESETS.find((candidate) => candidate.id === tool.id);
        expect(preset, tool.id).toBeTruthy();
        const expectedOperation = category.drawMode === "eraser" ? "erase" : "paint";
        expect(preset!.operation, `${category.id}/${tool.id}`).toBe(expectedOperation);
      }
    }
  });

  it("names palette rows with the real preset names", () => {
    for (const category of STUDIO_SUB_TOOL_PALETTE_CATEGORIES) {
      for (const tool of category.tools) {
        const preset = BRUSH_PRESETS.find((candidate) => candidate.id === tool.id);
        expect(tool.name, tool.id).toBe(preset!.name);
      }
    }
  });

  it("assigns each representative to at most one category tab", () => {
    const seen = new Set<string>();
    for (const category of STUDIO_SUB_TOOL_PALETTE_CATEGORIES) {
      for (const tool of category.tools) {
        expect(seen.has(tool.id), tool.id).toBe(false);
        seen.add(tool.id);
      }
    }
  });

  it("resolves the default category and category lookups", () => {
    const fallback = studioSubToolPaletteCategoryById(
      STUDIO_SUB_TOOL_PALETTE_DEFAULT_CATEGORY_ID,
    );
    expect(fallback?.id).toBe(STUDIO_SUB_TOOL_PALETTE_DEFAULT_CATEGORY_ID);
    expect(studioSubToolPaletteCategoryById("not-a-category")).toBeNull();
    expect(studioSubToolPaletteCategoryById(undefined)).toBeNull();
  });

  it("maps a listed brush id back to its owning category", () => {
    for (const category of STUDIO_SUB_TOOL_PALETTE_CATEGORIES) {
      for (const tool of category.tools) {
        expect(studioSubToolPaletteCategoryIdForBrushId(tool.id)).toBe(category.id);
      }
    }
    // Similar historical nib variants remain searchable in the library, not duplicated here.
    expect(studioSubToolPaletteCategoryIdForBrushId("school-pen")).toBeNull();
    expect(studioSubToolPaletteCategoryIdForBrushId(null)).toBeNull();
  });

  it("resolves curated sub tool ids to presets and stays fail-closed otherwise", () => {
    const gpen = studioSubToolPalettePresetById("gpen");
    expect(gpen?.id).toBe("gpen");
    const directPen = studioSubToolPalettePresetById("pen");
    expect(directPen?.id).toBe("pen");
    const eraser = studioSubToolPalettePresetById("standard-eraser");
    expect(eraser?.operation).toBe("erase");
    expect(CORE_PRESET_IDS.has("school-pen")).toBe(true);
    expect(studioSubToolPalettePresetById("school-pen")).toBeNull();
    expect(studioSubToolPalettePresetById("no-such-brush")).toBeNull();
    expect(studioSubToolPalettePresetById(42)).toBeNull();
  });
});
