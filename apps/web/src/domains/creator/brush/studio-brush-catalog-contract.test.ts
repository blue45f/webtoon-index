import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import { exportPageToSvg } from "../export/studio-svg-export";
import {
  BRUSH_PRESETS,
  STUDIO_BRUSH_RENDER_FAMILY,
  resolveStudioBrushRenderFamily,
} from "../studio-brush";
import { listStudioBrushTrayItems } from "../studio-creative-ux";
import { loadStudioPerfectFreehandStroker } from "../studio-perfect-freehand";

import {
  filterStudioBrushCatalogItems,
  listStudioCoreBrushCatalogItems,
  listStudioQuickBrushCatalogItems,
  STUDIO_ALL_BRUSH_CATALOG_ITEMS,
  STUDIO_BRUSH_CATALOG_COUNTS,
  STUDIO_ERASER_BRUSH_CATALOG_ITEMS,
  STUDIO_PAINT_BRUSH_CATALOG_ITEMS,
  STUDIO_PRO_BRUSH_CATALOG_ITEMS,
  studioBrushCatalogItemById,
  studioBrushCatalogKindLabel,
} from "./studio-brush-catalog";
import {
  resolveStudioBrushDynamicsPresetId,
  studioBrushDynamicsSettingsForBrushId,
} from "./studio-brush-dynamics";
import { studioBrushPackDescriptorById } from "./studio-brush-pack-index";
import {
  isStudioBrushQuarantinedPresetId,
  STUDIO_BRUSH_QUARANTINED_PRESET_IDS,
} from "./studio-brush-quarantine";
import {
  STUDIO_BRUSH_RUNTIME_CONTRACT,
  resolveStudioBrushRuntimeContract,
  resolveStudioBrushSinglePointRoute,
  studioBrushRuntimeExecutionSignature,
} from "./studio-brush-runtime-contract";
import { resolveStudioStampBrushKind } from "./studio-brush-stamp-engine";
import { filterStudioBrushLibraryItems } from "./studio-draw-ux";
import { LargeBrushPreview } from "./StudioBrushLibrarySheet";

const SUPPORTED_PREVIEW_KINDS = new Set([
  "ribbon",
  "calligraphy",
  "marker",
  "square-marker",
  "wash-marker",
  "pencil",
  "texture",
  "soft-air",
  "soft-wash",
  "soft-pigment",
  "oil",
  "neon",
  "glow",
  "particle",
  "tone",
  "eraser",
]);

const CORE_BRUSH_CATALOG_ITEMS = listStudioBrushTrayItems("all");
const CORE_BRUSH_CATALOG_COUNT = CORE_BRUSH_CATALOG_ITEMS.length;

describe(`${CORE_BRUSH_CATALOG_COUNT}-preset brush catalog contract`, () => {
  // perfect-outline 엔진은 다이내믹 청크(perfect-freehand)를 쓴다 — 동기 SVG export가
  // 실제 아웃라인 경로(폴백 아님)를 감사하도록 스트로커를 선로드한다.
  beforeAll(async () => {
    await loadStudioPerfectFreehandStroker();
  });

  it("maps every preset exactly once into selectable catalog metadata", () => {
    const catalog = CORE_BRUSH_CATALOG_ITEMS;
    const filteredCatalog = filterStudioBrushLibraryItems({ category: "all" });
    const presetIds = BRUSH_PRESETS.map((preset) => preset.id);

    expect(BRUSH_PRESETS).toHaveLength(CORE_BRUSH_CATALOG_COUNT);
    expect(new Set(presetIds).size).toBe(CORE_BRUSH_CATALOG_COUNT);
    expect(catalog.map((item) => item.id)).toEqual(filteredCatalog.map((item) => item.id));
    expect(new Set(catalog.map((item) => item.id))).toEqual(new Set(presetIds));
    expect(STUDIO_BRUSH_RUNTIME_CONTRACT.map((contract) => contract.id)).toEqual(presetIds);
  });

  it("keeps all identities behind one searchable quick/full catalogue source", () => {
    const counts = STUDIO_BRUSH_CATALOG_COUNTS;
    expect(counts.core).toBe(BRUSH_PRESETS.length);
    expect(counts.pro).toBe(160);
    expect(counts.total).toBe(counts.core + counts.pro);
    expect(counts.erase).toBe(2);
    expect(counts.paint).toBe(counts.total - counts.erase);
    expect(STUDIO_ALL_BRUSH_CATALOG_ITEMS).toHaveLength(counts.total);
    expect(new Set(STUDIO_ALL_BRUSH_CATALOG_ITEMS.map((item) => item.id))).toHaveProperty(
      "size",
      counts.total
    );

    for (const item of STUDIO_ALL_BRUSH_CATALOG_ITEMS) {
      expect(studioBrushCatalogItemById(item.id), `${item.id}: lookup drift`).toBe(item);
      // The eleven STUDIO_BRUSH_MATERIAL_GROUP_LABELS since #771 (c9ef0ff7) — pinned literally so a
      // renamed or added material shows up here as a deliberate vocabulary change.
      expect(studioBrushCatalogKindLabel(item), `${item.id}: missing kind label`).toMatch(
        /^(펜·잉크|연필·흑연|마커|수채·수묵|유화·아크릴|에어브러시|목탄·파스텔|질감|망점·해칭|빛·효과|지우개)$/u
      );
      // V17.1 quarantined ids stay resolvable above but leave every picker listing/search —
      // their exposure contract is asserted in the dedicated quarantine block below.
      if (isStudioBrushQuarantinedPresetId(item.id)) continue;
      expect(
        filterStudioBrushCatalogItems({
          // Exact-id search must be global even while the UI still has another category selected.
          category: "beginner",
          query: item.id,
        }).some((candidate) => candidate.id === item.id),
        `${item.id}: hidden behind category during search`
      ).toBe(true);
    }
    expect(studioBrushCatalogKindLabel(
      STUDIO_ERASER_BRUSH_CATALOG_ITEMS[0]!,
    )).toBe("지우개");

    const quick = listStudioQuickBrushCatalogItems({
      favoriteIds: ["heart-stamp"],
      recentIds: ["hair-fiber", "pen"],
      limit: 3,
    });
    expect(quick.map(({ id, quickSource }) => [id, quickSource])).toEqual([
      ["heart-stamp", "favorite"],
      ["hair-fiber", "recent"],
      ["pen", "recent"],
    ]);
  });

  it("keeps quarantined presets resolvable for persisted documents while removing picker exposure", () => {
    // V17.1 quarantine (studio-brush-quarantine.ts): exposure removal must never break existing
    // documents. Each quarantined id keeps its SSOT row, metadata lookup, and its own renderer
    // contract, but no picker listing or search path may surface it (no 숨김 포함 flag exists).
    expect(STUDIO_BRUSH_QUARANTINED_PRESET_IDS.length).toBeGreaterThan(0);
    for (const quarantinedId of STUDIO_BRUSH_QUARANTINED_PRESET_IDS) {
      expect(studioBrushCatalogItemById(quarantinedId), `${quarantinedId}: lookup lost`)
        .not.toBeNull();
      // Registration is partition-specific: a core/lane id lives in BRUSH_PRESETS and owns a
      // renderer contract under its own name, while a pro-pack id lives in the pack descriptor
      // array and materializes onto one of the three durable pack runtimes. Both must still be
      // registered — checked on the registry that actually holds them, so the assertion keeps
      // testing the real replay path rather than a lookup that was never going to hit.
      const packDescriptor = studioBrushPackDescriptorById(quarantinedId);
      if (packDescriptor) {
        expect(
          STUDIO_PRO_BRUSH_CATALOG_ITEMS.some((item) => item.id === quarantinedId),
          `${quarantinedId}: left the pro pack SSOT`
        ).toBe(true);
        expect(
          resolveStudioBrushRuntimeContract(packDescriptor.runtimeBrushId)?.id,
          `${quarantinedId}: pack runtime contract lost`
        ).toBe(packDescriptor.runtimeBrushId);
      } else {
        expect(
          BRUSH_PRESETS.some((preset) => preset.id === quarantinedId),
          `${quarantinedId}: left the preset SSOT`
        ).toBe(true);
        expect(
          resolveStudioBrushRuntimeContract(quarantinedId)?.id,
          `${quarantinedId}: renderer contract lost`
        ).toBe(quarantinedId);
      }
      for (const listing of [
        filterStudioBrushCatalogItems({}),
        filterStudioBrushCatalogItems({ operation: "paint" }),
        // 티어 탭이 사라진 뒤에도 "자기 재질 탭"에서 새어나오지 않아야 한다. 카테고리를
        // 고정하지 않고 해당 id 의 실제 재질 그룹으로 조회해 탭이 늘어나도 커버리지가 유지된다.
        filterStudioBrushCatalogItems({
          category: studioBrushCatalogItemById(quarantinedId)!.mediaGroup,
        }),
        filterStudioBrushCatalogItems({ query: quarantinedId }),
      ]) {
        expect(
          listing.some((item) => item.id === quarantinedId),
          `${quarantinedId}: still exposed by the picker`
        ).toBe(false);
      }
    }
  });

  it("keeps quarantined favorites/MRU off the quick shelf without touching listed rows", () => {
    // The quick shelf is a LISTING lane: its fresh default must come from the listed inventory,
    // or a quarantined id persisted in favorites/MRU re-surfaces as a picker affordance the
    // library and search already refuse to show.
    for (const quarantinedId of STUDIO_BRUSH_QUARANTINED_PRESET_IDS) {
      const quick = listStudioQuickBrushCatalogItems({
        favoriteIds: [quarantinedId, "heart-stamp"],
        recentIds: [quarantinedId, "pen"],
      });
      expect(
        quick.some((item) => item.id === quarantinedId),
        `${quarantinedId}: quarantined favorite/MRU re-surfaced on the quick shelf`
      ).toBe(false);
      // Exposure removal only — saved-document metadata RESOLUTION stays on the unfiltered SSOT.
      expect(
        studioBrushCatalogItemById(quarantinedId),
        `${quarantinedId}: saved-document metadata resolution lost`
      ).not.toBeNull();
    }

    // A quarantined favorite/MRU entry is skipped, never a hole: listed neighbours keep their slots.
    const quarantinedId = STUDIO_BRUSH_QUARANTINED_PRESET_IDS[0]!;
    expect(listStudioQuickBrushCatalogItems({
      favoriteIds: [quarantinedId, "heart-stamp"],
      recentIds: [quarantinedId, "hair-fiber", "pen"],
      limit: 3,
    }).map(({ id, quickSource }) => [id, quickSource])).toEqual([
      ["heart-stamp", "favorite"],
      ["hair-fiber", "recent"],
      ["pen", "recent"],
    ]);

    // Non-quarantined listings are byte-identical to the unfiltered default: the listed inventory
    // preserves SSOT order, so removing quarantined rows must not reorder or reshape anything.
    for (const options of [
      {},
      { favoriteIds: ["heart-stamp"], recentIds: ["hair-fiber", "pen"] },
      { favoriteIds: ["heart-stamp"], recentIds: ["hair-fiber", "pen"], limit: 3 },
      { limit: STUDIO_ALL_BRUSH_CATALOG_ITEMS.length },
    ]) {
      expect(JSON.stringify(listStudioQuickBrushCatalogItems(options))).toBe(
        JSON.stringify(listStudioQuickBrushCatalogItems({
          ...options,
          catalogItems: STUDIO_ALL_BRUSH_CATALOG_ITEMS,
        }))
      );
    }
  });

  it("keeps paint and eraser catalogues disjoint on the operation axis", () => {
    expect(STUDIO_ALL_BRUSH_CATALOG_ITEMS.every(
      (item) => item.operation === "paint" || item.operation === "erase"
    )).toBe(true);
    expect(STUDIO_PAINT_BRUSH_CATALOG_ITEMS).toHaveLength(STUDIO_BRUSH_CATALOG_COUNTS.paint);
    expect(STUDIO_ERASER_BRUSH_CATALOG_ITEMS.map((item) => item.id)).toEqual([
      "standard-eraser",
      "kneaded-eraser",
    ]);
    expect(listStudioCoreBrushCatalogItems("erase").map((item) => item.id)).toEqual([
      "standard-eraser",
      "kneaded-eraser",
    ]);
    expect(filterStudioBrushCatalogItems({ operation: "erase" }).map((item) => item.id)).toEqual([
      "standard-eraser",
      "kneaded-eraser",
    ]);
    expect(filterStudioBrushCatalogItems({ operation: "paint" }).some(
      (item) => item.id === "standard-eraser" || item.id === "kneaded-eraser"
    )).toBe(false);
    expect(filterStudioBrushCatalogItems({
      operation: "paint",
      query: "eraser",
    })).toEqual([]);
    expect(STUDIO_ALL_BRUSH_CATALOG_ITEMS.filter((item) => item.source === "pro").every(
      (item) => item.operation === "paint"
    )).toBe(true);
  });

  it("gives every preset an explicit renderer, engine route, preview, and exact-id search result", () => {
    const catalog = new Map(listStudioBrushTrayItems("all").map((item) => [item.id, item]));

    for (const preset of BRUSH_PRESETS) {
      const item = catalog.get(preset.id);
      expect(item, `${preset.id}: missing catalog item`).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(STUDIO_BRUSH_RENDER_FAMILY, preset.id),
        `${preset.id}: relies on unknown-brush fallback`
      ).toBe(true);

      const family = resolveStudioBrushRenderFamily(preset.id);
      const runtime = resolveStudioBrushRuntimeContract(preset.id);
      const stampKind = resolveStudioStampBrushKind(preset.id);
      const dynamicsId = resolveStudioBrushDynamicsPresetId(preset.id);
      const dynamicsFamily = runtime?.engine === "dynamic-dabs";
      const previewHtml = renderToStaticMarkup(
        createElement(LargeBrushPreview, { item: item!, active: false })
      );
      const previewKind = /data-studio-brush-preview-kind="([^"]+)"/.exec(previewHtml)?.[1];

      // 2026-08-13 brush quality wave: dry-stamp engine lanes keep their material family
      // (dry-media/pastel) while executing on stamp-dabs, so the stamp route is pinned to the
      // declared runtime engine rather than the presentation family.
      expect(stampKind !== null, `${preset.id}: stamp route mismatch`).toBe(
        runtime?.engine === "stamp-dabs"
      );
      expect(dynamicsId !== null, `${preset.id}: dynamics route mismatch`).toBe(dynamicsFamily);
      expect(runtime, `${preset.id}: missing runtime contract`).toBeDefined();
      expect(runtime?.family, `${preset.id}: family contract drift`).toBe(family);
      expect(runtime?.preview, `${preset.id}: preview contract drift`).toBe(item?.previewStyle);
      if (runtime?.engine === "stamp-dabs") {
        expect(stampKind, `${preset.id}: stamp variant drift`).toBe(runtime.engineVariant);
      } else {
        expect(stampKind, `${preset.id}: undeclared stamp route`).toBeNull();
      }
      if (runtime?.engine === "dynamic-dabs") {
        expect(
          studioBrushDynamicsSettingsForBrushId(preset.id),
          `${preset.id}: missing exact dynamics profile`
        ).not.toBeNull();
        if (runtime.distinctness === "unique") {
          expect(dynamicsId, `${preset.id}: canonical dynamics variant drift`).toBe(
            resolveStudioBrushDynamicsPresetId(runtime.engineVariant)
          );
        }
      } else {
        expect(dynamicsId, `${preset.id}: undeclared dynamics route`).toBeNull();
      }
      expect(
        previewKind !== undefined && SUPPORTED_PREVIEW_KINDS.has(previewKind),
        `${preset.id}: unsupported catalog preview`
      ).toBe(true);
      expect(
        filterStudioBrushLibraryItems({ category: "all", query: preset.id }).some(
          (result) => result.id === preset.id
        ),
        `${preset.id}: not selectable through exact-id catalog search`
      ).toBe(true);
    }
  });

  it("declares every renderer alias as a canonical profile or engine variant", () => {
    const contracts = new Map(
      STUDIO_BRUSH_RUNTIME_CONTRACT.map((contract) => [contract.id, contract])
    );
    const canonicalBySignature = new Map<string, string>();

    for (const contract of STUDIO_BRUSH_RUNTIME_CONTRACT) {
      const canonical = contracts.get(contract.canonicalId);
      expect(canonical, `${contract.id}: unknown canonicalId ${contract.canonicalId}`).toBeDefined();
      const signature = studioBrushRuntimeExecutionSignature(contract);
      const declaredCanonical = canonicalBySignature.get(signature);
      if (declaredCanonical) {
        expect(
          contract.canonicalId,
          `${contract.id}: duplicate renderer ${signature} must declare canonical ${declaredCanonical}`
        ).toBe(declaredCanonical);
      } else {
        canonicalBySignature.set(signature, contract.canonicalId);
      }

      if (contract.distinctness === "unique") {
        expect(contract.canonicalId).toBe(contract.id);
      } else if (contract.distinctness === "profile-variant") {
        expect(contract.canonicalId).not.toBe(contract.id);
        expect(studioBrushRuntimeExecutionSignature(canonical!)).toBe(signature);
      } else {
        expect(contract.canonicalId).not.toBe(contract.id);
        expect(canonical?.engine).toBe(contract.engine);
        expect(studioBrushRuntimeExecutionSignature(canonical!)).not.toBe(signature);
      }
    }
  });

  it("routes every manga nib through the continuous pressure-outline engine", () => {
    for (const brushId of ["gpen", "mapping-pen", "kaburapen", "liner"] as const) {
      expect(resolveStudioBrushRuntimeContract(brushId)).toMatchObject({
        family: "gpen",
        engine: "perfect-outline",
        engineVariant: "gpen-taper",
        dynamics: "outline-pressure",
      });
      expect(resolveStudioBrushSinglePointRoute({ brushId })).toBe("generic-dot");
    }
  });

  it(`executes and exports a visible deterministic stroke for all ${CORE_BRUSH_CATALOG_COUNT} presets`, () => {
    for (const preset of BRUSH_PRESETS) {
      const runtime = resolveStudioBrushRuntimeContract(preset.id)!;
      const input = {
        width: 96,
        height: 64,
        bg: "#ffffff",
        transparentBg: true,
        elements: [{
          id: `contract-${preset.id}`,
          type: "draw" as const,
          kind: "freehand" as const,
          mode: "pen" as const,
          brush: preset.id,
          points: [10, 34, 24, 18, 42, 42, 62, 20, 82, 31],
          pressures: [0.35, 0.55, 0.8, 0.6, 0.42],
          stroke: "#1f6feb",
          strokeWidth: preset.defaultWidth,
          opacity: preset.defaultOpacity,
          sampleSpacing: 1,
          stampPipeline: runtime.engine === "stamp-dabs" ? "causal-walker-v2" as const : undefined,
          watercolorPipeline: runtime.engine === "watercolor-dabs" ? "causal-walker-v2" as const : undefined,
        }],
      };
      const first = exportPageToSvg(input);
      const second = exportPageToSvg(input);

      expect(first.elementCount, `${preset.id}: element was not exported`).toBe(1);
      expect(first.skipped, `${preset.id}: export reported a skipped feature`).toEqual([]);
      expect(first.svg, `${preset.id}: renderer produced no coloured mark`).toContain("#1f6feb");
      expect(first.svg, `${preset.id}: export is not deterministic`).toBe(second.svg);
    }
  });

  it("catches byte-identical normalized renderers that omit a canonical alias declaration", () => {
    const canonicalBySvg = new Map<string, string>();
    const svgById = new Map<string, string>();

    // Erase identities share renderer carriers but differ by compositing operation, so a forced
    // paint-mode SVG cannot audit their canonical relation. Operation parity is covered above.
    for (const preset of BRUSH_PRESETS.filter(({ operation }) => operation === "paint")) {
      const runtime = resolveStudioBrushRuntimeContract(preset.id)!;
      const { svg } = exportPageToSvg({
        width: 96,
        height: 64,
        bg: "#ffffff",
        transparentBg: true,
        elements: [{
          // Deliberately identical id/controls: only the preset route is allowed to affect bytes.
          id: "duplicate-audit-stroke",
          type: "draw",
          kind: "freehand",
          mode: "pen",
          brush: preset.id,
          points: [10, 34, 24, 18, 42, 42, 62, 20, 82, 31],
          pressures: [0.35, 0.55, 0.8, 0.6, 0.42],
          stroke: "#1f6feb",
          strokeWidth: 12,
          opacity: 0.72,
          sampleSpacing: 1,
          stampPipeline: runtime.engine === "stamp-dabs" ? "causal-walker-v2" : undefined,
          watercolorPipeline: runtime.engine === "watercolor-dabs" ? "causal-walker-v2" : undefined,
        }],
      });
      svgById.set(preset.id, svg);

      const firstCanonical = canonicalBySvg.get(svg);
      if (firstCanonical) {
        expect(
          runtime.canonicalId,
          `${preset.id}: byte-identical output must declare canonical ${firstCanonical}`
        ).toBe(firstCanonical);
      } else {
        canonicalBySvg.set(svg, runtime.canonicalId);
      }
    }

    for (const runtime of STUDIO_BRUSH_RUNTIME_CONTRACT) {
      // A quarantined preset is delisted from every picker precisely BECAUSE its declared variant
      // is not real at paint time — that is what the ledger records and what its reason string
      // says. Requiring it to also prove itself distinct would contradict the quarantine's own
      // purpose, and would have forced either a fake difference or the loss of a true one:
      // gpen--causal-round is byte-identical to gpen, and the hash-derived diameter jitter that
      // used to hide that was removed as unprincipled. Every LISTED variant is still held to the
      // bar below.
      if (isStudioBrushQuarantinedPresetId(runtime.id)) continue;
      // This audit renders every preset from the SAME fixed points, so it can only judge
      // paint-stage variants. An INPUT-stage variant is invisible to it by construction: it
      // changes how the points are produced, not how they are painted, and feeding both the same
      // points is exactly the case where it must render identically.
      // pen--croquis-stabilized declares croquis-capsule-pulled-string, which is a real
      // implementation (studio-croquis-capsule-pen-v1.ts, ported from croquis.js
      // stabilizer/pulled-string.ts) living at the input stage. Asserting byte difference here
      // would demand a paint-time difference the variant never claimed. It needs an instrument
      // that feeds POINTER input and compares the resulting paths.
      if (runtime.engineVariant === "croquis-capsule-pulled-string") continue;
      if (runtime.distinctness === "profile-variant") {
        expect(svgById.get(runtime.id), `${runtime.id}: exact-id profile collapsed`).not.toBe(
          svgById.get(runtime.canonicalId)
        );
      } else if (runtime.distinctness === "engine-variant") {
        expect(svgById.get(runtime.id), `${runtime.id}: advertised engine variant collapsed`).not.toBe(
          svgById.get(runtime.canonicalId)
        );
      }
    }
  });

  it("routes legacy one-point stamp strokes through the stamp exporter", () => {
    for (const brush of ["ink-brush", "airbrush-fine", "pencil-grain", "wash-brush"] as const) {
      const kind = resolveStudioStampBrushKind(brush)!;
      expect(
        resolveStudioBrushSinglePointRoute({ brushId: brush, mode: "pen" }),
        `${brush}: generic-dot must never intercept a stamp tap`
      ).toBe("stamp-dabs");
      const result = exportPageToSvg({
        width: 64,
        height: 64,
        bg: "#ffffff",
        transparentBg: true,
        elements: [{
          id: `legacy-tap-${brush}`,
          type: "draw",
          kind: "freehand",
          mode: "pen",
          brush,
          points: [32, 32],
          pressures: [0.6],
          stroke: "#1f6feb",
          strokeWidth: 12,
        }],
      });
      expect(result.svg).toContain(`data-stamp-brush="${kind}"`);
    }
  });

  it("makes the one-point fallback decision explicit for causal ink, FX, and erasers", () => {
    expect(resolveStudioBrushSinglePointRoute({ brushId: "pen" })).toBe("generic-dot");
    expect(resolveStudioBrushSinglePointRoute({
      brushId: "pen",
      causalInkEnabled: true,
    })).toBe("causal-ink");
    expect(resolveStudioBrushSinglePointRoute({ brushId: "neon" })).toBe("neon-halo");
    expect(resolveStudioBrushSinglePointRoute({ brushId: "glitter" })).toBe("particle-scatter");
    expect(resolveStudioBrushSinglePointRoute({
      brushId: "wash-brush",
      mode: "eraser",
    })).toBe("generic-dot");
  });
});
