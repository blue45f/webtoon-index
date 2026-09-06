import { describe, expect, it } from "vitest";

import {
  filterStudioBrushCatalogItems,
  listStudioQuickBrushCatalogItems,
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS,
  STUDIO_DEFAULT_QUALITY_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_DEFAULT_QUALITY_PAINT_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,
  STUDIO_SEARCHABLE_ALL_BRUSH_CATALOG_ITEMS,
  studioBrushCatalogItemById,
} from "./studio-brush-catalog";
import {
  isStudioBrushQualityPortfolioId,
  resolveStudioBrushQualityRepresentativeId,
  selectStudioBrushQualityEngine,
  STUDIO_BRUSH_FULLSCREEN_LONG_STROKE_EXPERIMENT,
  STUDIO_BRUSH_HAND_FEEL_PROFILES,
  STUDIO_BRUSH_LIVE_COMMIT_GATES,
  STUDIO_BRUSH_QUALITY_ALIAS_TO_REPRESENTATIVE,
  STUDIO_BRUSH_QUALITY_ENGINE_PINS,
  STUDIO_BRUSH_QUALITY_PORTFOLIO,
  STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS,
  STUDIO_BRUSH_QUALITY_PORTFOLIO_IDS,
  STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS,
  STUDIO_BRUSH_TEXTURE_PROFILES,
  studioBrushQualityOnlyScore,
} from "./studio-brush-quality-portfolio";
import { STUDIO_BRUSH_DEFAULT_PORTFOLIO_COUNTS } from "./studio-brush-quality-portfolio-counts";
import { isStudioBrushQuarantinedPresetId } from "./studio-brush-quarantine";

const perfect = {
  textureFidelity: 1,
  handFeel: 1,
  liveCommitConsistency: 1,
  geometryFidelity: 1,
  performance: 0.5,
  memoryStability: 0.5,
} as const;

describe("quality-first Studio brush portfolio", () => {
  it("reduces only the default picker to 48 materially distinct representatives", () => {
    expect(STUDIO_BRUSH_QUALITY_PORTFOLIO).toHaveLength(48);
    expect(new Set(STUDIO_BRUSH_QUALITY_PORTFOLIO_IDS).size).toBe(48);
    expect(STUDIO_BRUSH_QUALITY_PORTFOLIO_COUNTS).toMatchObject({
      total: 48,
      paint: 46,
      erase: 2,
    });
    expect(STUDIO_BRUSH_DEFAULT_PORTFOLIO_COUNTS).toEqual({
      total: 48,
      paint: 46,
      erase: 2,
    });
    expect(STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.map((item) => item.id))
      .toEqual(STUDIO_BRUSH_QUALITY_PORTFOLIO_IDS);
    expect(STUDIO_DEFAULT_QUALITY_PAINT_BRUSH_CATALOG_ITEMS).toHaveLength(46);
    expect(STUDIO_DEFAULT_QUALITY_ERASER_BRUSH_CATALOG_ITEMS).toHaveLength(2);
    expect(
      STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.length
        / STUDIO_ALL_BRUSH_CATALOG_ITEMS.length,
    ).toBeLessThanOrEqual(0.25);
  });

  it("preserves the exhaustive non-quarantined inventory for quality and durability gates", () => {
    const expected = STUDIO_ALL_BRUSH_CATALOG_ITEMS
      .filter((item) => !isStudioBrushQuarantinedPresetId(item.id));
    expect(STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS).toEqual(expected);
    expect(STUDIO_SEARCHABLE_ALL_BRUSH_CATALOG_ITEMS)
      .toBe(STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS);
    expect(STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS).toEqual(
      expected.filter((item) => item.operation === "paint"),
    );
    expect(STUDIO_LISTED_ERASER_BRUSH_CATALOG_ITEMS).toEqual(
      expected.filter((item) => item.operation === "erase"),
    );
    expect(filterStudioBrushCatalogItems({ category: "all" }))
      .toEqual(STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS);
    expect(STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.length)
      .toBeGreaterThan(STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.length);
  });

  it("keeps every representative registered, source-correct and outside quarantine", () => {
    for (const entry of STUDIO_BRUSH_QUALITY_PORTFOLIO) {
      const item = studioBrushCatalogItemById(entry.id);
      expect(item, entry.id).not.toBeNull();
      expect(item?.source, entry.id).toBe(entry.source);
      expect(isStudioBrushQuarantinedPresetId(entry.id), entry.id).toBe(false);
      expect(STUDIO_BRUSH_TEXTURE_PROFILES[entry.textureProfile], entry.id).toBeDefined();
      expect(STUDIO_BRUSH_HAND_FEEL_PROFILES[entry.handFeelProfile], entry.id).toBeDefined();
      expect(STUDIO_BRUSH_LIVE_COMMIT_GATES[entry.liveCommitGate], entry.id).toBeDefined();
      expect(STUDIO_BRUSH_QUALITY_ENGINE_PINS[entry.enginePin], entry.id).toBeDefined();
    }
  });

  it("keeps absorbed variants out of the default list but searchable and resolvable", () => {
    const defaultIds = new Set(
      STUDIO_DEFAULT_QUALITY_BRUSH_CATALOG_ITEMS.map((item) => item.id),
    );
    for (const [aliasId, representativeId] of Object.entries(
      STUDIO_BRUSH_QUALITY_ALIAS_TO_REPRESENTATIVE,
    )) {
      expect(defaultIds.has(aliasId), aliasId).toBe(false);
      expect(resolveStudioBrushQualityRepresentativeId(aliasId), aliasId).toBe(representativeId);
      const registered = studioBrushCatalogItemById(aliasId);
      if (!registered || isStudioBrushQuarantinedPresetId(aliasId)) continue;
      expect(
        filterStudioBrushCatalogItems({ query: aliasId }).some((item) => item.id === aliasId),
        `${aliasId}: registered absorbed variant is no longer searchable`,
      ).toBe(true);
      expect(
        STUDIO_LISTED_ALL_BRUSH_CATALOG_ITEMS.some((item) => item.id === aliasId),
        `${aliasId}: exhaustive inventory lost a searchable variant`,
      ).toBe(true);
    }
  });

  it("preserves explicit hidden favorites, recents and all-tab discovery", () => {
    const hidden = Object.keys(STUDIO_BRUSH_QUALITY_ALIAS_TO_REPRESENTATIVE).find((id) => {
      const item = studioBrushCatalogItemById(id);
      return item !== null && !isStudioBrushQuarantinedPresetId(id);
    });
    expect(hidden).toBeDefined();
    expect(filterStudioBrushCatalogItems({}).some((item) => item.id === hidden))
      .toBe(false);
    expect(filterStudioBrushCatalogItems({ category: "all" }).some((item) => item.id === hidden))
      .toBe(true);
    expect(filterStudioBrushCatalogItems({ category: "favorites", favoriteIds: [hidden!] }))
      .toMatchObject([{ id: hidden }]);
    expect(listStudioQuickBrushCatalogItems({ favoriteIds: [hidden!], limit: 4 })[0])
      .toMatchObject({ id: hidden, quickSource: "favorite" });
  });

  it("keeps signatures and aliases globally unambiguous", () => {
    const signatures = STUDIO_BRUSH_QUALITY_PORTFOLIO.map((entry) => entry.signature);
    expect(new Set(signatures).size).toBe(signatures.length);
    const aliases = Object.keys(STUDIO_BRUSH_QUALITY_ALIAS_TO_REPRESENTATIVE);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(aliases.some(isStudioBrushQualityPortfolioId)).toBe(false);
  });

  it("gives visual quality 85% of the score and performance only 15%", () => {
    const weights = STUDIO_BRUSH_QUALITY_SCORE_WEIGHTS;
    expect(
      weights.textureFidelity
      + weights.handFeel
      + weights.liveCommitConsistency
      + weights.geometryFidelity,
    ).toBeCloseTo(0.85, 8);
    expect(weights.performance + weights.memoryStability).toBeCloseTo(0.15, 8);
    expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
  });

  it("rejects a faster GPU backend when any primary quality axis regresses", () => {
    const decision = selectStudioBrushQualityEngine([
      {
        backend: "canvas2d-material-specialist",
        gpu: false,
        authority: true,
        gatePassed: true,
        measurements: perfect,
      },
      {
        backend: "canonical-webgpu-wet-specialist",
        gpu: true,
        authority: false,
        gatePassed: true,
        measurements: {
          ...perfect,
          textureFidelity: 0.96,
          performance: 1,
          memoryStability: 1,
        },
      },
    ]);
    expect(decision?.selected.backend).toBe("canvas2d-material-specialist");
    expect(decision?.reason).toBe("authority-retained");
  });

  it("prefers GPU only inside the quality-equivalent band", () => {
    const decision = selectStudioBrushQualityEngine([
      {
        backend: "canvas2d-material-specialist",
        gpu: false,
        authority: true,
        gatePassed: true,
        measurements: perfect,
      },
      {
        backend: "canonical-webgpu-wet-specialist",
        gpu: true,
        authority: false,
        gatePassed: true,
        measurements: {
          ...perfect,
          textureFidelity: 0.997,
          handFeel: 0.998,
          liveCommitConsistency: 0.999,
          geometryFidelity: 1,
          performance: 0.9,
          memoryStability: 0.9,
        },
      },
    ]);
    expect(decision?.selected.backend).toBe("canonical-webgpu-wet-specialist");
    expect(decision?.reason).toBe("quality-equivalent-gpu");
    expect(studioBrushQualityOnlyScore(decision!.selected.measurements)).toBeGreaterThan(0.99);
  });

  it("defines a viewport-filling, zoomed, live-to-settled experiment for every representative", () => {
    const experiment = STUDIO_BRUSH_FULLSCREEN_LONG_STROKE_EXPERIMENT;
    expect(experiment.route.horizontalFillRatio).toBeGreaterThanOrEqual(0.9);
    expect(experiment.route.verticalFillRatio).toBeGreaterThanOrEqual(0.7);
    expect(experiment.performanceSamples).toBeGreaterThanOrEqual(3_200);
    expect(experiment.zoomInspection).toEqual([1, 4, 8, 16, 32]);
    expect(experiment.engineModes).toContain("gpu-candidate-when-declared");
  });
});
