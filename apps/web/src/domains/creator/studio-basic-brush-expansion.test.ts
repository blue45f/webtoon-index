import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import {
  classifyStudioBrushBackendQuality,
} from "./brush/studio-brush-backend-quality-policy";
import {
  filterStudioBrushCatalogItems,
  studioBrushCatalogItemById,
} from "./brush/studio-brush-catalog";
import { studioBrushIconId } from "./brush/studio-brush-icons";
import { isStudioBrushQuarantinedPresetId } from "./brush/studio-brush-quarantine";
import {
  resolveStudioBrushRuntimeContract,
} from "./brush/studio-brush-runtime-contract";
import {
  materializeStudioBrushCatalogSelection,
} from "./brush/studio-brush-selection";
import {
  resolveStudioCausalInkDrawContract,
} from "./brush/studio-draw-rendering";
import { LargeBrushPreview } from "./brush/StudioBrushLibrarySheet";
import { exportPageToSvg } from "./export/studio-svg-export";
import {
  BRUSH_PRESETS,
  resolveStudioBrushPresetDrawMode,
} from "./studio-brush";
import {
  adaptStudioDrawElementToCanonicalBrushPlan,
} from "./studio-canonical-brush-draw-adapter";
import { loadStudioPerfectFreehandStroker } from "./studio-perfect-freehand";
import { normalizeStudioProDrawPrefs } from "./studio-pro-draw-prefs";

import type { DrawEl } from "./studio-element-model";

const BASIC_BRUSH_IDS = [
  "school-pen",
  "fountain-pen",
  "gel-pen",
  "kneaded-eraser",
] as const;

const EXPECTED_PRESETS = {
  "school-pen": {
    name: "스쿨펜(안정 선화)",
    width: 4.2,
    opacity: 1,
    aliases: ["스쿨 펜", "학생 펜", "school pen", "school nib"],
  },
  "fountain-pen": {
    name: "캘리그래피 펜",
    width: 6.5,
    opacity: 1,
    aliases: ["만년필 펜", "잉크 만년필", "fountain pen", "fountain nib"],
  },
  "gel-pen": {
    name: "젤펜(선명)",
    width: 3.8,
    opacity: 1,
    aliases: ["젤 펜", "중성펜", "gel pen", "gel ink pen"],
  },
  "kneaded-eraser": {
    name: "연한 떡지우개",
    width: 26,
    opacity: 0.38,
    aliases: ["말랑 지우개", "찰흙 지우개", "kneaded eraser", "putty eraser"],
  },
} as const;

function renderStroke(brush: string): string {
  return exportPageToSvg({
    width: 112,
    height: 72,
    transparentBg: true,
    elements: [{
      id: "basic-brush-output-contract",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      brush,
      points: [8, 44, 24, 20, 44, 48, 66, 16, 88, 42, 104, 28],
      pressures: [0.18, 0.38, 0.72, 0.94, 0.58, 0.32],
      stroke: "#2457d6",
      strokeWidth: 12,
      opacity: 0.82,
      sampleSpacing: 1,
    }],
  }).svg;
}

function kneadedEraserElement(brush = "kneaded-eraser"): DrawEl {
  return {
    id: `erase-${brush}`,
    type: "draw",
    kind: "freehand",
    mode: "eraser",
    brush,
    points: [4, 4, 18, 10, 36, 4],
    pressures: [0.2, 0.55, 0.9],
    stroke: "#222222",
    strokeWidth: 26,
    opacity: 0.38,
    paintModel: "layered-flow-v1",
    sampleSpacing: 1,
  };
}

describe("commercial basic brush expansion", () => {
  beforeAll(async () => {
    await loadStudioPerfectFreehandStroker();
  });

  it("publishes stable core ids, useful defaults, and Korean/English search aliases", () => {
    for (const id of BASIC_BRUSH_IDS) {
      const expected = EXPECTED_PRESETS[id];
      const preset = BRUSH_PRESETS.find((candidate) => candidate.id === id);
      expect(preset, `${id}: missing core preset`).toMatchObject({
        id,
        name: expected.name,
        defaultWidth: expected.width,
        defaultOpacity: expected.opacity,
        searchAliases: expect.arrayContaining([...expected.aliases]),
      });
    }

    // Search coverage is a LISTING promise, so it is asserted per partition. school-pen and
    // gel-pen were delisted in the 2026-08-21 roster reduction (both share pen/gpen's execution
    // signature), and a delisted id must be unreachable from every picker path including alias
    // search — its aliases keep resolving metadata for saved documents, nothing more.
    const listedDiscoveryQueries = [
      ["fountain-pen", "잉크 만년필"],
      ["fountain-pen", "fountain nib"],
      ["kneaded-eraser", "말랑 지우개"],
      ["kneaded-eraser", "putty eraser"],
    ] as const;
    for (const [id, query] of listedDiscoveryQueries) {
      expect(
        filterStudioBrushCatalogItems({
          // A query must escape the currently selected category.
          category: "fx",
          query,
        }).some((candidate) => candidate.id === id),
        `${id}: alias ${query} is not globally searchable`,
      ).toBe(true);
    }
    const delistedDiscoveryQueries = [
      ["school-pen", "학생 펜"],
      ["school-pen", "school nib"],
      ["gel-pen", "중성펜"],
      ["gel-pen", "gel ink pen"],
    ] as const;
    for (const [id, query] of delistedDiscoveryQueries) {
      expect(isStudioBrushQuarantinedPresetId(id), `${id}: expected delisted`).toBe(true);
      expect(
        filterStudioBrushCatalogItems({ query }).some((candidate) => candidate.id === id),
        `${id}: alias ${query} still exposes a delisted preset`,
      ).toBe(false);
      // Exposure removal only — the preset and its aliases stay registered for saved documents.
      expect(studioBrushCatalogItemById(id)?.searchAliases, id)
        .toEqual([...EXPECTED_PRESETS[id].aliases]);
    }
  });

  it("declares explicit runtime and backend routes instead of specialist-route claims", () => {
    expect(resolveStudioBrushRuntimeContract("gel-pen")).toMatchObject({
      engine: "causal-ink",
      engineVariant: "round",
      canonicalId: "pen",
      distinctness: "profile-variant",
    });
    expect(resolveStudioBrushRuntimeContract("school-pen")).toMatchObject({
      engine: "perfect-outline",
      engineVariant: "gpen-taper",
      canonicalId: "gpen",
      distinctness: "profile-variant",
    });
    expect(resolveStudioBrushRuntimeContract("fountain-pen")).toMatchObject({
      engine: "calligraphy-segments",
      engineVariant: "tilt-chisel",
      canonicalId: "calligraphy",
      distinctness: "profile-variant",
    });
    expect(resolveStudioBrushRuntimeContract("kneaded-eraser")).toMatchObject({
      engine: "causal-ink",
      engineVariant: "round",
      canonicalId: "kneaded-eraser",
      distinctness: "unique",
      operation: "erase",
    });

    expect(classifyStudioBrushBackendQuality({ catalogId: "gel-pen" }))
      .toMatchObject({ identity: { routeProfile: "continuous-analytic" } });
    expect(classifyStudioBrushBackendQuality({ catalogId: "school-pen" }))
      .toMatchObject({ identity: { routeProfile: "continuous-outline" } });
    expect(classifyStudioBrushBackendQuality({ catalogId: "fountain-pen" }))
      .toMatchObject({ identity: { routeProfile: "continuous-specialist" } });
    expect(classifyStudioBrushBackendQuality({
      catalogId: "kneaded-eraser",
      brushId: "kneaded-eraser",
      operation: "erase",
    })).toMatchObject({
      identity: {
        family: "eraser-mixer",
        routeProfile: "eraser",
      },
    });
  });

  it("keeps the new ids selectable and persistence-safe, including eraser rehydration", async () => {
    for (const id of BASIC_BRUSH_IDS) {
      const selection = await materializeStudioBrushCatalogSelection(id);
      expect(selection, `${id}: missing selection`).toMatchObject({
        catalogId: id,
        runtimeBrushId: id,
      });
    }
    expect(await materializeStudioBrushCatalogSelection("kneaded-eraser"))
      .toMatchObject({ drawMode: "eraser" });
    expect(resolveStudioBrushPresetDrawMode("kneaded-eraser")).toBe("eraser");
    expect(resolveStudioBrushPresetDrawMode("gel-pen")).toBe("pen");
    expect(resolveStudioBrushPresetDrawMode("unknown-future-id")).toBe("pen");

    const normalized = normalizeStudioProDrawPrefs({
      recentBrushIds: [...BASIC_BRUSH_IDS],
      favoriteBrushIds: [...BASIC_BRUSH_IDS],
    });
    expect(normalized.recentBrushIds).toEqual(BASIC_BRUSH_IDS);
    expect(normalized.favoriteBrushIds).toEqual(BASIC_BRUSH_IDS);
  });

  it("renders materially distinct catalogue previews and recognizable icons", () => {
    const previewById = new Map(BASIC_BRUSH_IDS.map((id) => {
      const item = studioBrushCatalogItemById(id);
      expect(item, `${id}: missing catalogue metadata`).not.toBeNull();
      return [
        id,
        renderToStaticMarkup(
          createElement(LargeBrushPreview, { item: item!, active: false }),
        ),
      ];
    }));

    expect(previewById.get("gel-pen")).toContain('data-studio-brush-preview-kind="ribbon"');
    expect(previewById.get("school-pen"))
      .toContain('data-studio-brush-preview-kind="calligraphy"');
    expect(previewById.get("fountain-pen"))
      .toContain('data-studio-brush-preview-kind="calligraphy"');
    expect(previewById.get("kneaded-eraser"))
      .toContain('data-studio-brush-preview-kind="eraser"');
    expect(new Set(previewById.values()).size).toBe(BASIC_BRUSH_IDS.length);

    expect(studioBrushIconId("gel-pen")).toBe("pen-line");
    expect(studioBrushIconId("school-pen")).toBe("pen-tool");
    expect(studioBrushIconId("fountain-pen")).toBe("feather");
    expect(studioBrushIconId("standard-eraser")).toBe("eraser");
    expect(studioBrushIconId("kneaded-eraser")).toBe("eraser");
  });

  it("exports each pen profile deterministically without collapsing into its canonical preset", () => {
    const comparisons = [
      ["gel-pen", "pen"],
      ["school-pen", "gpen"],
      ["fountain-pen", "calligraphy"],
    ] as const;
    const expandedOutputs = new Set<string>();

    for (const [id, canonicalId] of comparisons) {
      const first = renderStroke(id);
      const second = renderStroke(id);
      expect(first, `${id}: missing visible SVG output`).toContain("#2457d6");
      expect(first, `${id}: nondeterministic SVG output`).toBe(second);
      expect(first, `${id}: collapsed into ${canonicalId}`).not.toBe(
        renderStroke(canonicalId),
      );
      expandedOutputs.add(first);
    }
    expect(expandedOutputs.size).toBe(comparisons.length);
  });

  it("makes the named kneaded eraser a low-density destination-out stroke in live and canonical plans", () => {
    const element = kneadedEraserElement();
    const contract = resolveStudioCausalInkDrawContract(element);
    const genericContract = resolveStudioCausalInkDrawContract(
      kneadedEraserElement("pen"),
    );

    expect(contract.composite).toBe("destination-out");
    expect(contract.opacity).toBe(0.38);
    expect(contract.paintModel).toBe("layered-flow-v1");
    expect(contract.strokeWidth).toBeCloseTo(30.16);
    expect(contract.pressures).not.toEqual(genericContract.pressures);
    expect(contract.strokeWidth).toBeGreaterThan(genericContract.strokeWidth);

    const canonical = adaptStudioDrawElementToCanonicalBrushPlan({
      element,
      sessionEpoch: 1,
      strokeEpoch: 1,
      commandSequence: 1,
      firstSampleSequence: 1,
      firstTimeMilliseconds: 0,
      fallbackSampleIntervalMilliseconds: 4,
      pointerId: 1,
      flags: 0,
      colorSpace: "linear-srgb",
      transform: {
        encoding: "affine-f64-v1",
        m11: 1,
        m12: 0,
        m21: 0,
        m22: 1,
        translateX: 0,
        translateY: 0,
      },
    });
    expect(canonical.status).toBe("ready");
    if (canonical.status === "ready") {
      expect(canonical.plan.composite.porterDuff).toBe("destination-out");
      expect(canonical.plan.recipe).toMatchObject({
        brushId: "eraser:kneaded-eraser",
        material: "eraser",
      });
      expect(canonical.plan.recipe.size).toBeCloseTo(30.16);
    }

    const svg = exportPageToSvg({
      width: 64,
      height: 48,
      transparentBg: true,
      elements: [element],
    });
    expect(svg.elementCount).toBe(1);
    expect(svg.skipped).toEqual([expect.objectContaining({
      id: element.id,
      mode: "skipped",
      label: expect.stringContaining("지우개"),
    })]);
    expect(svg.svg).not.toContain(element.stroke);
  });
});
