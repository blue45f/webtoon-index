import { describe, expect, it } from "vitest";

import {
  classifyStudioBrushBackendQuality,
} from "./brush/studio-brush-backend-quality-policy";
import {
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_BRUSH_CATALOG_COUNTS,
  filterStudioBrushCatalogItems,
  studioBrushCatalogItemById,
} from "./brush/studio-brush-catalog";
import {
  planNormalizedStudioDynamicBrushDabs,
  studioBrushDynamicsSettingsForBrushId,
} from "./brush/studio-brush-dynamics";
import { studioBrushIconId } from "./brush/studio-brush-icons";
import {
  resolveStudioBrushRuntimeContract,
} from "./brush/studio-brush-runtime-contract";
import {
  materializeStudioBrushCatalogSelection,
} from "./brush/studio-brush-selection";
import { BRUSH_PRESETS } from "./studio-brush";
import { normalizeStudioProDrawPrefs } from "./studio-pro-draw-prefs";

const SPECIALTY_IDS = [
  "hard-airbrush",
  "erodible-pencil",
  "paint-tube",
  "tangent-normal-brush",
] as const;

const EXPECTED_PRESETS = Object.freeze({
  "hard-airbrush": {
    name: "하드 에어브러시",
    width: 28,
    opacity: 0.76,
    aliases: [
      "경질 에어브러시",
      "하드 라운드 분사",
      "hard airbrush",
      "hard round airbrush",
    ],
  },
  "erodible-pencil": {
    name: "마모 연필(닳는 심)",
    width: 7,
    opacity: 0.84,
    aliases: ["닳는 연필", "마모 촉", "erodible pencil", "erodible tip"],
  },
  "paint-tube": {
    name: "튜브 물감(압출 릴리프)",
    width: 30,
    opacity: 0.96,
    aliases: ["물감 튜브", "3D 튜브", "paint tube", "3d tube brush"],
  },
  "tangent-normal-brush": {
    name: "탄젠트 노멀 브러시",
    width: 20,
    opacity: 1,
    aliases: [
      "노멀 맵 브러시",
      "법선 페인트",
      "tangent normal brush",
      "normal map brush",
    ],
  },
});

const EXPECTED_RUNTIME_VARIANT = Object.freeze({
  "hard-airbrush": "connected-hard-envelope",
  "erodible-pencil": "progressive-wear-ribbon",
  "paint-tube": "extruded-bead-ribbon",
  "tangent-normal-brush": "direction-encoded-ribbon",
});

const EXPECTED_BACKEND_ROUTE = Object.freeze({
  "hard-airbrush": "spray-dynamics",
  "erodible-pencil": "dry-dynamics",
  "paint-tube": "wet-specialist",
  "tangent-normal-brush": "continuous-catalog-dynamics",
});

function pressureAxes(id: (typeof SPECIALTY_IDS)[number], pressure: number) {
  const preset = EXPECTED_PRESETS[id];
  const settings = studioBrushDynamicsSettingsForBrushId(id);
  if (!settings) throw new Error(`missing dynamics: ${id}`);
  const dabs = planNormalizedStudioDynamicBrushDabs({
    points: [0, 0, 18, 7, 37, -4, 58, 9, 80, 0],
    pressures: [pressure, pressure, pressure, pressure, pressure],
    speeds: [0.45, 0.45, 0.45, 0.45, 0.45],
    baseWidth: preset.width,
    baseOpacity: preset.opacity,
    seed: 73,
    maxDabs: 512,
  }, settings);
  return {
    count: dabs.length,
    size: dabs.reduce((sum, dab) => sum + dab.size, 0),
    deposit: dabs.reduce(
      (sum, dab) => sum + dab.opacity * dab.flow,
      0,
    ),
  };
}

describe("competitor specialty brush expansion", () => {
  it("publishes four stable core ids with bilingual discovery aliases", () => {
    for (const id of SPECIALTY_IDS) {
      const expected = EXPECTED_PRESETS[id];
      expect(BRUSH_PRESETS.find((preset) => preset.id === id)).toMatchObject({
        id,
        name: expected.name,
        defaultWidth: expected.width,
        defaultOpacity: expected.opacity,
        searchAliases: [...expected.aliases],
      });
      expect(studioBrushCatalogItemById(id)).toMatchObject({
        id,
        source: "core",
      });
    }

    for (const [id, query] of [
      ["hard-airbrush", "hard round airbrush"],
      ["erodible-pencil", "마모 촉"],
      ["paint-tube", "3d tube brush"],
      ["tangent-normal-brush", "법선 페인트"],
    ] as const) {
      expect(
        filterStudioBrushCatalogItems({ category: "marker", query })
          .some((item) => item.id === id),
        `${id}: alias ${query} must escape the selected category`,
      ).toBe(true);
    }
  });

  it("keeps the catalogue exhaustive and assigns unique runtime variants", () => {
    expect(STUDIO_BRUSH_CATALOG_COUNTS.pro).toBe(160);
    expect(STUDIO_BRUSH_CATALOG_COUNTS.core).toBeGreaterThanOrEqual(99);
    expect(STUDIO_BRUSH_CATALOG_COUNTS.total).toBe(
      STUDIO_BRUSH_CATALOG_COUNTS.core + STUDIO_BRUSH_CATALOG_COUNTS.pro,
    );
    expect(STUDIO_ALL_BRUSH_CATALOG_ITEMS).toHaveLength(STUDIO_BRUSH_CATALOG_COUNTS.total);
    expect(new Set(STUDIO_ALL_BRUSH_CATALOG_ITEMS.map(({ id }) => id)).size)
      .toBe(STUDIO_BRUSH_CATALOG_COUNTS.total);
    for (const id of SPECIALTY_IDS) {
      expect(resolveStudioBrushRuntimeContract(id)).toMatchObject({
        id,
        engine: "dynamic-dabs",
        engineVariant: EXPECTED_RUNTIME_VARIANT[id],
        canonicalId: id,
        distinctness: "unique",
      });
    }
    expect(new Set(
      SPECIALTY_IDS.map(
        (id) => resolveStudioBrushRuntimeContract(id)?.engineVariant,
      ),
    ).size).toBe(SPECIALTY_IDS.length);
  });

  it("classifies every new identity through its intended backend quality family", () => {
    for (const id of SPECIALTY_IDS) {
      expect(classifyStudioBrushBackendQuality({
        catalogId: id,
        brushId: id,
      })).toMatchObject({
        identity: {
          catalogId: id,
          routeProfile: EXPECTED_BACKEND_ROUTE[id],
        },
      });
    }
  });

  it("materializes exact persistence identities and preserves favorites/recent history", async () => {
    for (const id of SPECIALTY_IDS) {
      const selection = await materializeStudioBrushCatalogSelection(id);
      expect(selection).toMatchObject({
        catalogId: id,
        runtimeBrushId: id,
        brushDynamics: expect.any(Object),
      });
      expect(selection?.drawMode).toBeUndefined();
    }
    const normalized = normalizeStudioProDrawPrefs({
      favoriteBrushIds: [...SPECIALTY_IDS],
      recentBrushIds: [...SPECIALTY_IDS],
    });
    expect(normalized.favoriteBrushIds).toEqual(SPECIALTY_IDS);
    expect(normalized.recentBrushIds).toEqual(SPECIALTY_IDS);
  });

  it("keeps pressure responsive on all four specialist materials", () => {
    for (const id of SPECIALTY_IDS) {
      const low = pressureAxes(id, 0.12);
      const high = pressureAxes(id, 0.88);
      expect(
        Math.abs(low.size - high.size) > 1e-8
        || Math.abs(low.deposit - high.deposit) > 1e-8,
        `${id}: pressure response collapsed`,
      ).toBe(true);
    }
  });

  it("uses deliberate, recognizable non-default icons", () => {
    expect(SPECIALTY_IDS.map(studioBrushIconId)).toEqual([
      "wind",
      "pencil",
      "paintbrush",
      "direction",
    ]);
  });
});
