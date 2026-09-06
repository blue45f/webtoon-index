import { describe, expect, it } from "vitest";

import { BRUSH_PRESETS } from "../studio-brush";

import {
  STUDIO_DEFAULT_QUALITY_PAINT_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,
  studioBrushCatalogItemById,
} from "./studio-brush-catalog";
import {
  listStudioListedPaintUniquenessCollisions,
  STUDIO_BRUSH_FEEL_CULL_PRESET_IDS,
  STUDIO_LISTED_PAINT_PRE_CHANGE_COUNT,
  studioBrushListedUniquenessKey,
} from "./studio-brush-listed-uniqueness";
import { studioBrushPackDescriptorById, STUDIO_BRUSH_PACK_DESCRIPTORS } from "./studio-brush-pack-index";
import { materializeStudioBrushPackSelection, materializeAllStudioBrushPackSelections } from "./studio-brush-pack-runtime";
import { auditStudioBrushPlannerQualityCatalogue } from "./studio-brush-planner-quality-audit";
import { STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS } from "./studio-brush-quality-portfolio";
import {
  isStudioBrushQuarantinedPresetId,
  STUDIO_BRUSH_QUARANTINE_REASON_BY_PRESET_ID,
} from "./studio-brush-quarantine";
import {
  resolveStudioBrushRuntime,
  resolveStudioBrushRuntimeContract,
  STUDIO_BRUSH_SAFE_FALLBACK_ID,
} from "./studio-brush-runtime-contract";
import { studioCoreBrushCatalogSelection } from "./studio-brush-selection";

describe("listed paint uniqueness and default quality portfolio", () => {
  it("keeps the exhaustive listed inventory while curating 46 default paint representatives", () => {
    expect(STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.length)
      .toBeLessThan(STUDIO_LISTED_PAINT_PRE_CHANGE_COUNT);
    expect(STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.length).toBe(185);
    expect(STUDIO_DEFAULT_QUALITY_PAINT_BRUSH_CATALOG_ITEMS.length)
      .toBe(STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS.paint);
    expect(STUDIO_DEFAULT_QUALITY_PAINT_BRUSH_CATALOG_ITEMS).toHaveLength(46);
    expect(
      STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.every(
        (item) => !isStudioBrushQuarantinedPresetId(item.id),
      ),
    ).toBe(true);
    expect(
      STUDIO_DEFAULT_QUALITY_PAINT_BRUSH_CATALOG_ITEMS.every(
        (item) => STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.includes(item),
      ),
    ).toBe(true);
  });

  it("keeps no two exhaustive listed paint ids on the same uniqueness key", () => {
    expect(listStudioListedPaintUniquenessCollisions()).toEqual([]);
    const keys = STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.map((item) => {
      const key = studioBrushListedUniquenessKey(item.id);
      expect(key, item.id).not.toBeNull();
      return key;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps exhaustive listed planner exact and perceptual fingerprints unique", () => {
    const listedIds = new Set(STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS.map((item) => item.id));
    const core = BRUSH_PRESETS
      .filter((preset) => listedIds.has(preset.id) && preset.operation !== "erase")
      .map(studioCoreBrushCatalogSelection);
    const professional = materializeAllStudioBrushPackSelections()
      .filter((selection) => listedIds.has(selection.catalogId))
      .map((selection) => {
        const descriptor = STUDIO_BRUSH_PACK_DESCRIPTORS.find(
          (row) => row.catalogId === selection.catalogId,
        );
        return {
          ...selection,
          category: descriptor?.category,
          previewStyle: descriptor?.previewStyle,
        };
      });
    const report = auditStudioBrushPlannerQualityCatalogue([...core, ...professional]);
    expect(report.exactFingerprintGroups).toEqual([]);
    expect(report.perceptualFingerprintGroups).toEqual([]);
    expect(report.errorCount).toBe(0);
  });

  it("keeps newly quarantined ids registered on their own runtime, never the pen fallback", () => {
    for (const quarantinedId of STUDIO_BRUSH_FEEL_CULL_PRESET_IDS) {
      expect(isStudioBrushQuarantinedPresetId(quarantinedId), quarantinedId).toBe(true);
      expect(
        (STUDIO_BRUSH_QUARANTINE_REASON_BY_PRESET_ID[quarantinedId] ?? "").trim().length,
        quarantinedId,
      ).toBeGreaterThan(0);
      expect(studioBrushCatalogItemById(quarantinedId), quarantinedId).not.toBeNull();
      const packDescriptor = studioBrushPackDescriptorById(quarantinedId);
      if (packDescriptor) {
        const selection = materializeStudioBrushPackSelection(quarantinedId);
        expect(selection?.catalogId, quarantinedId).toBe(quarantinedId);
        const packRuntime = resolveStudioBrushRuntime(packDescriptor.runtimeBrushId);
        expect(packRuntime.status, quarantinedId).toBe("exact");
        expect(packRuntime.resolvedId, quarantinedId).not.toBe(STUDIO_BRUSH_SAFE_FALLBACK_ID);
        continue;
      }
      const resolution = resolveStudioBrushRuntime(quarantinedId);
      expect(resolution.status, quarantinedId).toBe("exact");
      expect(resolution.resolvedId, quarantinedId).toBe(quarantinedId);
      expect(resolution.resolvedId, quarantinedId).not.toBe(STUDIO_BRUSH_SAFE_FALLBACK_ID);
      expect(resolveStudioBrushRuntimeContract(quarantinedId)?.id, quarantinedId)
        .toBe(quarantinedId);
    }
  });
});
