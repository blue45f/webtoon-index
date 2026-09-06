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
import { BRUSH_PRESETS } from "./studio-brush";
import {
  adaptStudioDrawElementToCanonicalBrushPlan,
  type StudioCanonicalBrushDrawAdapterRequest,
} from "./studio-canonical-brush-draw-adapter";
import { loadStudioPerfectFreehandStroker } from "./studio-perfect-freehand";
import { normalizeStudioProDrawPrefs } from "./studio-pro-draw-prefs";

import type { DrawEl } from "./studio-element-model";

const LINE_TOOL_IDS = [
  "maru-pen",
  "parallel-pen",
  "ruling-pen",
  "glass-pen",
] as const;

const EXPECTED_PRESETS = {
  "maru-pen": {
    name: "마루펜(세필 탄성)",
    width: 2.4,
    opacity: 1,
    aliases: ["마루 펜", "둥근 펜촉", "maru pen", "round manga nib"],
  },
  "parallel-pen": {
    name: "평행펜(넓은 촉)",
    width: 18,
    opacity: 0.98,
    aliases: ["패럴렐 펜", "평행 촉", "parallel pen", "parallel calligraphy nib"],
  },
  "ruling-pen": {
    name: "룰링펜(잉크 간격)",
    width: 4.6,
    opacity: 0.98,
    aliases: ["룰링 펜", "선긋기 펜", "ruling pen", "technical ruling pen"],
  },
  "glass-pen": {
    name: "유리펜(잉크 흐름)",
    width: 3.1,
    opacity: 0.92,
    aliases: ["글라스 펜", "유리 딥펜", "glass pen", "glass dip pen"],
  },
} as const;

const ADAPTER_BASE = {
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
} as const satisfies Omit<StudioCanonicalBrushDrawAdapterRequest, "element">;

function strokeElement(brush: string): DrawEl {
  return {
    id: `line-tool-${brush}`,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    brush,
    points: [8, 44, 24, 18, 44, 48, 65, 15, 87, 42, 105, 26],
    pressures: [0.16, 0.34, 0.68, 0.94, 0.56, 0.28],
    stroke: "#2559d9",
    strokeWidth: 12,
    opacity: 0.82,
    sampleSpacing: 1,
  };
}

function renderStroke(brush: string): string {
  return exportPageToSvg({
    width: 116,
    height: 68,
    transparentBg: true,
    elements: [strokeElement(brush)],
  }).svg;
}

describe("commercial basic line-tool expansion", () => {
  beforeAll(async () => {
    await loadStudioPerfectFreehandStroker();
  });

  it("publishes four stable core identities with distinct defaults and bilingual aliases", () => {
    for (const id of LINE_TOOL_IDS) {
      const expected = EXPECTED_PRESETS[id];
      expect(BRUSH_PRESETS.find((preset) => preset.id === id)).toMatchObject({
        id,
        name: expected.name,
        defaultWidth: expected.width,
        defaultOpacity: expected.opacity,
        searchAliases: [...expected.aliases],
      });
    }

    // ruling-pen and glass-pen were delisted in the 2026-08-21 roster reduction — both share
    // pen's causal-ink execution signature, so nothing but width separated them from it. Alias
    // search is a picker path, so it must stop returning them while metadata stays resolvable.
    const listedDiscoveryQueries = [
      ["maru-pen", "둥근 펜촉"],
      ["maru-pen", "round manga nib"],
      ["parallel-pen", "평행 촉"],
      ["parallel-pen", "parallel calligraphy nib"],
    ] as const;
    for (const [id, query] of listedDiscoveryQueries) {
      expect(
        filterStudioBrushCatalogItems({ category: "fx", query })
          .some((item) => item.id === id),
        `${id}: alias ${query} is not globally searchable`,
      ).toBe(true);
    }
    const delistedDiscoveryQueries = [
      ["ruling-pen", "선긋기 펜"],
      ["ruling-pen", "technical ruling pen"],
      ["glass-pen", "유리 딥펜"],
      ["glass-pen", "glass dip pen"],
    ] as const;
    for (const [id, query] of delistedDiscoveryQueries) {
      expect(isStudioBrushQuarantinedPresetId(id), `${id}: expected delisted`).toBe(true);
      expect(
        filterStudioBrushCatalogItems({ query }).some((item) => item.id === id),
        `${id}: alias ${query} still exposes a delisted preset`,
      ).toBe(false);
      expect(studioBrushCatalogItemById(id)?.searchAliases, id)
        .toEqual([...EXPECTED_PRESETS[id].aliases]);
    }
  });

  it("routes only to engines the product already executes and classifies explicitly", () => {
    expect(resolveStudioBrushRuntimeContract("maru-pen")).toMatchObject({
      family: "gpen",
      engine: "perfect-outline",
      canonicalId: "gpen",
      distinctness: "profile-variant",
    });
    expect(resolveStudioBrushRuntimeContract("parallel-pen")).toMatchObject({
      family: "calligraphy",
      engine: "calligraphy-segments",
      canonicalId: "calligraphy",
      distinctness: "profile-variant",
    });
    for (const id of ["ruling-pen", "glass-pen"] as const) {
      expect(resolveStudioBrushRuntimeContract(id)).toMatchObject({
        family: "pen",
        engine: "causal-ink",
        canonicalId: "pen",
        distinctness: "profile-variant",
      });
    }

    expect(classifyStudioBrushBackendQuality({ catalogId: "maru-pen" }))
      .toMatchObject({ identity: { routeProfile: "continuous-outline" } });
    expect(classifyStudioBrushBackendQuality({ catalogId: "parallel-pen" }))
      .toMatchObject({ identity: { routeProfile: "continuous-specialist" } });
    for (const id of ["ruling-pen", "glass-pen"] as const) {
      expect(classifyStudioBrushBackendQuality({ catalogId: id }))
        .toMatchObject({ identity: { routeProfile: "continuous-analytic" } });
    }
  });

  it("keeps selection, favorites, and recent history on the exact persisted ids", async () => {
    for (const id of LINE_TOOL_IDS) {
      expect(await materializeStudioBrushCatalogSelection(id)).toMatchObject({
        catalogId: id,
        runtimeBrushId: id,
      });
      expect((await materializeStudioBrushCatalogSelection(id))?.drawMode).toBeUndefined();
    }
    const normalized = normalizeStudioProDrawPrefs({
      recentBrushIds: [...LINE_TOOL_IDS],
      favoriteBrushIds: [...LINE_TOOL_IDS],
    });
    expect(normalized.recentBrushIds).toEqual(LINE_TOOL_IDS);
    expect(normalized.favoriteBrushIds).toEqual(LINE_TOOL_IDS);
  });

  it("shows exact-tool preview cues and four distinguishable icons", () => {
    const previewById = new Map(LINE_TOOL_IDS.map((id) => {
      const item = studioBrushCatalogItemById(id);
      expect(item, `${id}: missing catalogue item`).not.toBeNull();
      return [
        id,
        renderToStaticMarkup(
          createElement(LargeBrushPreview, { item: item!, active: false }),
        ),
      ];
    }));

    expect(previewById.get("maru-pen"))
      .toContain('data-studio-brush-preview-detail="maru-hairline"');
    expect(previewById.get("parallel-pen"))
      .toContain('data-studio-brush-preview-detail="parallel-edge"');
    expect(previewById.get("ruling-pen"))
      .toContain('data-studio-brush-preview-detail="ruling-gap"');
    expect(previewById.get("glass-pen"))
      .toContain('data-studio-brush-preview-detail="glass-flow"');
    expect(new Set(previewById.values()).size).toBe(LINE_TOOL_IDS.length);

    expect(LINE_TOOL_IDS.map(studioBrushIconId)).toEqual([
      "circle-dot",
      "align-justify",
      "direction",
      "gem",
    ]);
  });

  it("keeps live causal profiles and SVG outputs deterministic and materially distinct", () => {
    const comparisons = [
      ["maru-pen", "gpen"],
      ["parallel-pen", "calligraphy"],
      ["ruling-pen", "pen"],
      ["glass-pen", "pen"],
    ] as const;
    const outputs = new Set<string>();
    for (const [id, canonicalId] of comparisons) {
      const first = renderStroke(id);
      expect(first, `${id}: missing visible SVG output`).toContain("#2559d9");
      expect(first, `${id}: nondeterministic SVG output`).toBe(renderStroke(id));
      expect(first, `${id}: collapsed into ${canonicalId}`).not.toBe(
        renderStroke(canonicalId),
      );
      outputs.add(first);
    }
    expect(outputs.size).toBe(comparisons.length);

    const ruling = resolveStudioCausalInkDrawContract(strokeElement("ruling-pen"));
    const glass = resolveStudioCausalInkDrawContract(strokeElement("glass-pen"));
    expect(ruling.strokeWidth).toBeCloseTo(10.32);
    expect(glass.strokeWidth).toBeCloseTo(7.44);
    expect(ruling.pressures).not.toEqual(glass.pressures);
  });

  it("preserves exact analytic identities in canonical plans and fails closed for the ribbon specialist", () => {
    for (const [id, expectedSize] of [
      ["maru-pen", 6.96],
      ["ruling-pen", 10.32],
      ["glass-pen", 7.44],
    ] as const) {
      const result = adaptStudioDrawElementToCanonicalBrushPlan({
        ...ADAPTER_BASE,
        element: strokeElement(id),
      });
      expect(result.status, `${id}: canonical adapter rejected an analytic profile`).toBe("ready");
      if (result.status !== "ready") continue;
      expect(result.plan.recipe.brushId).toBe(id);
      expect(result.plan.recipe.size).toBeCloseTo(expectedSize);
      expect(result.plan.recipe.pressure.size.minimum)
        .not.toBe(result.plan.recipe.pressure.size.maximum);
    }

    // The canonical dab schema cannot reproduce a segment-union parallel nib. Keeping this
    // explicit prevents the production calligraphy ribbon from silently degrading to round dabs.
    const parallel = adaptStudioDrawElementToCanonicalBrushPlan({
      ...ADAPTER_BASE,
      element: strokeElement("parallel-pen"),
    });
    expect(parallel).toMatchObject({
      status: "rejected",
      reason: "unsupported-brush",
      path: "element.brush",
    });
  });
});
