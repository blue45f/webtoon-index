import { describe, expect, it } from "vitest";

import {
  filterStudioBrushCatalogItems,
  STUDIO_PAINT_BRUSH_CATALOG_ITEMS,
  studioBrushCatalogItemById,
} from "./studio-brush-catalog";
import { studioBrushPackDescriptorById } from "./studio-brush-pack-index";
import { materializeStudioBrushPackSelection } from "./studio-brush-pack-runtime";
import {
  resolveStudioBrushRuntime,
  resolveStudioBrushRuntimeContract,
  STUDIO_BRUSH_SAFE_FALLBACK_ID,
} from "./studio-brush-runtime-contract";
import {
  isStudioBrushQuarantinedPresetId,
  STUDIO_BRUSH_EXPERIMENTAL_LANE_PRESET_IDS,
  STUDIO_BRUSH_QUALITY_WEIGHTS,
  STUDIO_BRUSH_QUARANTINE_REASON_BY_PRESET_ID,
  STUDIO_BRUSH_QUARANTINED_PRESET_IDS,
  buildStudioBrushVariantGroups,
  certifyStudioBrushQualityReceipt,
  computeStudioBrushPlanDigest,
  computeStudioBrushQualityReceiptSkeleton,
  resolveStudioBrushLifecycleStage,
  type StudioBrushQualityAxis,
} from "./studio-brush-variant-group-manifest";

describe("studio brush variant group manifest", () => {
  it("partitions every SSOT paint id into exactly one variant group", () => {
    const groups = buildStudioBrushVariantGroups();
    const paintIds = STUDIO_PAINT_BRUSH_CATALOG_ITEMS.map((item) => item.id);

    const memberIds = groups.flatMap((group) => [...group.memberPresetIds]);
    expect(memberIds.length).toBe(paintIds.length);
    expect(new Set(memberIds).size).toBe(memberIds.length);
    expect(new Set(memberIds)).toEqual(new Set(paintIds));
  });

  it("never emits an empty group and derives axes for every comparable group", () => {
    const groups = buildStudioBrushVariantGroups();
    for (const group of groups) {
      expect(group.memberPresetIds.length, group.groupId).toBeGreaterThan(0);
      if (group.memberPresetIds.length >= 2) {
        expect(group.comparisonAxes.length, group.groupId).toBeGreaterThan(0);
      }
      if (group.kind === "pro-pack-category") {
        expect(group.packCategory, group.groupId).not.toBeNull();
        expect(group.anchorPresetId, group.groupId).toBeNull();
      } else {
        expect(group.anchorPresetId, group.groupId).not.toBeNull();
        expect(group.packCategory, group.groupId).toBeNull();
      }
      expect(group.intent.length, group.groupId).toBeGreaterThan(0);
    }
  });

  it("merges lanes hanging off a self-canonical base with that base's core family", () => {
    const groups = buildStudioBrushVariantGroups();
    const oil = groups.find((group) => group.groupId === "medium:oil");
    expect(oil).toBeDefined();
    // Core canonical fold (acrylic → oil) and engine lanes compared side by side — the exact
    // cross-engine comparison the variant groups exist for.
    expect(oil?.memberPresetIds).toContain("oil");
    expect(oil?.memberPresetIds).toContain("acrylic");
    expect(oil?.memberPresetIds).toContain("oil--filbert-ribbon");
    expect(oil?.comparisonAxes).toContain("engine");
  });

  it("keeps the derived group count stable against accidental catalogue drift", () => {
    // Snapshot of the derived group COUNT only (never the content): 65 medium families + 14 pro
    // pack categories over the 312-preset paint SSOT. This number moves ONLY with a deliberate
    // catalogue change (new preset family, new engine-lane base, or a new pro-pack category);
    // update it in the same change that lands the catalogue rows, citing that change.
    // 2026-08-13 wave 3: +1 medium family (medium:mypaint-cc0 — the CC0 MyPaint import pool's
    // engine-lane base) alongside 17 new engine-lane presets.
    const groups = buildStudioBrushVariantGroups();
    expect(groups.length).toBe(79);
  });

  it("builds deterministically and freezes every artifact", () => {
    const first = buildStudioBrushVariantGroups();
    const second = buildStudioBrushVariantGroups();
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    for (const group of first) {
      expect(Object.isFrozen(group)).toBe(true);
      expect(Object.isFrozen(group.memberPresetIds)).toBe(true);
      expect(Object.isFrozen(group.comparisonAxes)).toBe(true);
    }
    expect(Object.isFrozen(STUDIO_BRUSH_QUALITY_WEIGHTS)).toBe(true);
    expect(Object.isFrozen(STUDIO_BRUSH_EXPERIMENTAL_LANE_PRESET_IDS)).toBe(true);
  });

  it("resolves a lifecycle stage for every shipped paint id", () => {
    for (const item of STUDIO_PAINT_BRUSH_CATALOG_ITEMS) {
      expect(resolveStudioBrushLifecycleStage(item.id), item.id).not.toBeNull();
    }
    expect(resolveStudioBrushLifecycleStage("pen")).toBe("core");
    expect(resolveStudioBrushLifecycleStage("oil--filbert-ribbon")).toBe("extended");
    expect(resolveStudioBrushLifecycleStage("core-round")).toBe("extended");
    expect(resolveStudioBrushLifecycleStage("no-such-brush")).toBeNull();
    expect(resolveStudioBrushLifecycleStage(42)).toBeNull();
    // The wave's new engine lanes are pinned experimental by the catalogue integrator here
    // (2026-08-13 brush quality wave: dry-stamp x4, wet-texture x4, oil x3;
    // 2026-08-13 wave 3: CC0 MyPaint x17, croquis capsule x2, living-ink bake x2, physics oil x1).
    // 2026-08-21 roster reduction: 12 pins RESOLVED — watercolor--granulating,
    // watercolor--fluid-feather and 10 mypaint-cc0 lanes each shared an execution signature with a
    // lane that already ships, so the lab answered "no" and they moved to the quarantine ledger.
    // The audit demands the pin be resolved before quarantine, so this list and the ledger must
    // stay disjoint; that disjointness is asserted in studio-brush-catalog-lifecycle.test.ts.
    expect(STUDIO_BRUSH_EXPERIMENTAL_LANE_PRESET_IDS).toEqual([
      "crayon--klecks-stamp",
      "chalk--klecks-stamp",
      "charcoal--mypaint-stamp",
      "pastel--soft-stamp",
      "watercolor--edge-bloom",
      "ink-wash--fiber-feather",
      "ink-wash--chroma-halo",
      "brush--impasto-relief",
      "brush--bristle-depletion",
      // 2026-08-27: oil-pastel--wgm-mix and mypaint-cc0--watercolor-fringe pins RESOLVED to the
      // quarantine ledger — the browser lab's committed-tap measurements answered "no shelf slot".
      // 2026-09-02 feel-cull: 2b-pencil · dry-brush · splatter · kabura · marker-fat pins
      // RESOLVED — each shared a stamp signature with a listed core stamp.
      "mypaint-cc0--ink-blot",
      "gpen--croquis-capsule",
      "pen--croquis-stabilized",
      "ink-wash--living-bake",
      "brush--bristle-physics",
    ]);
    for (const experimentalId of STUDIO_BRUSH_EXPERIMENTAL_LANE_PRESET_IDS) {
      expect(resolveStudioBrushLifecycleStage(experimentalId), experimentalId)
        .toBe("experimental");
    }
  });

  it("stages quarantined ids as quarantined with an owner-auditable reason each", () => {
    // 2026-08-13 wave 3 pruning (workstream M §2): glitter--star-field paints as plain glitter
    // because the durable dispatch never honours its declared engineVariant (지침 6).
    // 2026-08-14 browser gate: erodible-pencil and hard-airbrush render zero pixels on release for
    // both short and long strokes — a pre-wave defect (reproduced on the 65e9bf64 build) whose
    // family siblings, including the same-engine pencil--erodible-wear lane, are verified working.
    // 2026-08-14 long-route quality gate: airbrush--stamp-soft declares preview "soft" (a
    // continuous carrier) but measures edgePeriodicityScore 0.85 at a 7px period — a visible
    // ridge. Its stamp-family and airbrush-family siblings all clear the same bar (지침 6).
    // 2026-08-16 wave 4 duplicate confirm: pencil--side-shade and gpen--causal-round each declare
    // an engine/profile variant that no renderer branches on — outside the lane catalogue the only
    // reference to those ids is the icon map — so they paint their base media. Width-normalised
    // pixel |difference| p95 (brush-duplicate-confirm.json): 0.00000 vs pencil, 0.00014 vs
    // gpen--croquis-capsule. marker--chisel-ribbon was a candidate in the same audit and is
    // deliberately NOT here: since the angled-nib carrier began carrying pressure into the stroke
    // interior it is visibly distinct from base brush (distinctTones 102 vs 1), so the duplicate
    // evidence is stale — its remaining gap is that it never opted into the pressure model.
    // 2026-08-16 wave 5 structural-promise audit PROPOSED five more ids and they are deliberately
    // NOT here. web-cross-hatch-pen, web-contour-double, web-radial-burst, web-fur-strand and
    // sketchpad-tile each declare a second mark no renderer emits, and Chromium renders of the
    // pinned tone-probe cells confirm it (web-cross-hatch-pen lays 91 dabs in ONE 42.0-48.0deg
    // lobe, so no cross exists). Quarantining them was measured, landed and then REVERTED for a
    // reason that has nothing to do with the evidence: delisting them moves the listed catalogue
    // 325 -> 320, which invalidates the recorded production-browser receipt that
    // studio-brush-browser-evidence.test.ts pins, and that receipt cannot currently be
    // regenerated — `pnpm verify:studio-brushes` aborts on 4/160 continuous-policy failures that
    // predate this audit (inkwash-water-brush, watercolor--granulating, gouache--matte-body,
    // mypaint-cc0--knife, all edge-periodicity). Land the shrink together with a fresh receipt
    // once those four are fixed; a red evidence gate hides the next regression.
    //
    // 2026-08-21 ROSTER REDUCTION WAVE (사용자 지시: "비슷한 질감의 브러시가 너무 많다") — 83 ids
    // added below, 325 -> 242 listed. Two mechanical facts decide membership, never taste:
    //   - core/lane: a shared `studioBrushRuntimeExecutionSignature` means one execution path, so
    //     the only thing separating the pair is a value the width/opacity sliders reproduce;
    //   - pro pack: a shared tip footprint (runtime + tip motif/alpha map + tip layers) means one
    //     texture, because every other pack parameter is a brush-editor slider.
    // Distinct alpha-map motifs (68 pro), distinct signatures, the four real nib geometries
    // (calligraphy/fountain-pen/parallel-pen/brush-pen) and the sparse ids pinned by
    // studio-brush-continuity-audit are all deliberately untouched. Each entry's reason cites the
    // shared signature/footprint and names the alternatives that stay exposed.
    // Note this wave delists three of the four ids the paragraph above blames for the stale
    // receipt (inkwash-water-brush, watercolor--granulating, mypaint-cc0--knife); gouache--matte-
    // body is the remaining continuous-policy failure and is NOT a duplicate, so it stays listed.
    //
    // 2026-08-22 SECOND REDUCTION WAVE (사용자 지시 재확인) — 4 more ids: ballpoint · felt-tip ·
    // ink-wash · acrylic. Same mechanical rule as above: identical execution signature, separated
    // only by slider-reproducible width/opacity, with an exposed in-group alternative kept
    // (수묵은 ink-wash 레인, 유화 변주는 oil 레인이 유지합니다). 242 -> 238 listed.
    //
    // 2026-08-23 marker--chisel-ribbon delisted: it adopted the material pressure model via the
    // dedicated "marker-chisel" profile consumed by both durable angled-nib renderers, so it now
    // separates from canonical brush by measured material behaviour instead of the id checksum.
    // 238 -> 237 listed.
    //
    // 2026-08-25 marker--chisel-ribbon RE-quarantined (6a32205): the declared minus-30deg chisel
    // profile-variant turned out to have no renderer branch — at the contract audit's fixed points
    // the brush is byte-identical to canonical brush (same engine/variant, same 18/0.7
    // width/opacity), the same declaration-vs-reality collapse as gpen--causal-round. The
    // 3a79a43b ledger restructure had accidentally released it to extended, which unmasked the
    // collapse in the catalog contract.
    //
    // 2026-08-27 dry-media (the UMBRELLA id) quarantined during receipt regeneration: the T1
    // de-polygon wave moved its five material children onto the kernel dab path but left the
    // umbrella preset itself on the generic base pipeline with no kernel pin and no lane
    // overrides. Measured on the production-browser long-route gate at the same 24px width:
    // inkEnergy 170 vs crayon's 3044 (18x lighter), mean cross-section 3.1px vs 14.9px, and the
    // released stroke drops another 40% of ink with a 12.3px centroid drift — a strict-continuous
    // policy failure — while a fast short stroke measured changedPixels 1/4392 (invisible). All
    // five material children stay listed as in-group alternatives. 238 -> 237 listed.
    //
    // 2026-08-27 charcoal--vine-soft quarantined (second receipt-regeneration audit): the same
    // defect class as the dry-media umbrella. The stored-replay authority resolver pins engine-
    // lane ids to the kernel only by EXACT match, so this lane's identity resolved null and it
    // stayed on the generic textured pipeline. Measured with the offline planner on the audit's
    // own 9px fast-short-stroke: ink energy 1.1 vs charcoal's 37 (30x lighter), peak mark alpha
    // 0.066–0.075 — straddling the visibility threshold (16/255 ≈ 0.063), which made the
    // production-browser fast-short-stroke gate fail probabilistically (5 reproduced failures;
    // the seal breadcrumb measured a 1px ink census on the full-alpha active surface at seal).
    // A 66px stroke is uniformly 5.5x lighter (peak 0.277). Remapping onto the kernel would
    // re-render persisted vine-soft strokes 30x denser, so exposure-only quarantine applies;
    // charcoal · chalk · pastel stay listed as in-group alternatives. 237 -> 236 listed.
    //
    // 2026-08-27 oil-pastel--wgm-mix + mypaint-cc0--watercolor-fringe quarantined (third
    // receipt-regeneration audit, full-catalogue survey + fresh-session reproduction + offline
    // planner probes). Both are committed-tap ghosts: wgm-mix's committed plan collapses under
    // the per-stroke contact-tooth-v2 paper coupling (peak alpha 0.147 -> 0.014, energy 10.5x
    // down; the kernel lanes are untouched by the same coupling) and measures 22px@delta4 on
    // screen - exactly straddling the visibility gate, flipping run to run - while fringe
    // commits through the causal-walker watercolor stamp wash at a deterministic 16px@delta3.
    // Both live previews draw the same tap far denser (fringe: 134px census), so the stroke
    // visibly evaporates on release; the commit is the stored authority, so matching the live
    // preview down would still leave the tap invisible. Exposure-only quarantine per the
    // dry-media/vine-soft precedent; oil-pastel · pastel and watercolor · wash-brush stay
    // listed as in-group alternatives. 236 -> 234 listed.
    //
    // 2026-08-27 web-soft-cloud and web-calligraphy-ribbon: both quarantined during the fourth
    // receipt-regeneration audit for near-invisible committed long strokes (soft-cloud 8px@delta6
    // total, 1/6 segments; ribbon 2/6 with endpoint caps only - both reproduced on origin/main),
    // then DELISTED the same day once the shared root cause - the web-drawing kit bridge placing
    // samples only ON sparse path points, leaving soft-cloud with two particle stations and the
    // ribbon with two chisel stamps for a 520px route - was fixed by gap densification in
    // studio-web-drawing-stroke-bridge.ts and each lane re-verified 6/6 on the long-route gate.
    // 234 listed again after the round trips.
    //
    // 2026-09-01 inkwash-pen · inkwash-water-brush DELISTED: they no longer share watercolor's
    // dab wash. Pointer-start consumes the dedicated Stam fluid wash, so picker exposure returns.
    // 234 -> 236 listed.
    //
    // 2026-09-02 feel-cull: 45 more ids (11 core/lane + 34 pro footprint siblings). Listed
    // uniqueness is execution signature unless a real renderer branch distinguishes the pair,
    // plus pack tip footprint (runtime + motif/alpha + layers + 45° angle). 236 listed all
    // (234 paint) -> 191 listed all (189 paint).
    //
    // 2026-09-03 mark-distance cull: fresh-leaf · long-leaf · fur-soft-clumps. Ranked by the
    // channels that make the mark — tip alpha map, spacing/scatter/flow/softness/grain, stamp
    // angle — over every exposed pro preset. The single-leaf trio sat inside 0.064 of each other
    // (fresh<->long 0.0355 is the closest pair in the whole pack) and fur-soft-clumps was the
    // nearest rake pair at 0.0494. 191 listed all (189 paint) -> 188 listed all (185 paint).
    expect(STUDIO_BRUSH_QUARANTINED_PRESET_IDS)
      .toEqual([
        "airbrush--stamp-soft",
        "glitter--star-field",
        "screentone--sparse-grid",
        "gpen--causal-round",
        "marker--chisel-ribbon",
        "gel-pen",
        "glass-pen",
        "ruling-pen",
        "technical-pen",
        "alcohol-marker",
        "ballpoint",
        "felt-tip",
        "school-pen",
        "liner",
        "mapping-pen",
        "kaburapen",
        "soft-pencil",
        "pencil-2b",
        "inkwash-bleed-wash",
        "ink-wash",
        "watercolor--granulating",
        "watercolor--fluid-feather",
        "watercolor--dense-core",
        "gouache--flat-stamp",
        "mypaint-cc0--calligraphy",
        "mypaint-cc0--marker-small",
        "mypaint-cc0--slow-ink",
        "mypaint-cc0--knife",
        "mypaint-cc0--spray",
        "mypaint-cc0--watercolor-expressive",
        "mypaint-cc0--charcoal",
        "mypaint-cc0--charcoal-tanda",
        "mypaint-cc0--oil-paint",
        "mypaint-cc0--pastel",
        "brush--oil-lanes",
        "acrylic--stiff-ribbon",
        "oil--tube-extrude",
        "acrylic--polymer-flat",
        "acrylic",
        "marker--soft-dynamic",
        "airbrush--hard-envelope",
        "airbrush--klecks-grit",
        "spray--equal-area",
        "splatter--burst-cloud",
        "web-smudge-trail",
        "pen--perfect-taper",
        "calligraphy--perfect-chisel",
        "pencil--erodible-wear",
        "pencil--stamp-grain",
        "sparkle-star",
        "chalk--klecks-powder",
        "pastel--cake-soft",
        "crayon--wax-scrape",
        "oil-pastel--waxy-film",
        "watercolor--edge-stamp",
        "powder-sketch",
        "chalk-powder",
        "rough-grain",
        "sand-texture",
        "pencil-colored-soft",
        "pencil-tilt-shading",
        "watercolor-dry-granule",
        "oval-shading",
        "clean-flat",
        "rhythm-flat",
        "clean-flat-marker",
        "alcohol-chisel-marker",
        "acrylic-stiff-flat",
        "chalk-rough",
        "strong-rough-grain",
        "heavy-rough-grain",
        "plaster-texture",
        "pencil-charcoal-stick",
        "classic-marker",
        "round-paint",
        "watercolor-detail-round",
        "crisp-ink",
        "milli-pen-uniform",
        "cloud-soft",
        "airbrush-grand-soft",
        "watercolor-wet-wash",
        "fiber-marker",
        "fiber-sketch",
        "scattered-flat",
        "chalk-compressed",
        "paint-ink",
        "watercolor-edge-stain",
        "broken-nib-ink",
        "angular-square",
        "watercolor-flat-wash",
        "foliage-broad-canopy",
        "dry-media",
        "charcoal--vine-soft",
        "oil-pastel--wgm-mix",
        "mypaint-cc0--watercolor-fringe",
        "fineliner",
        "marker-bold",
        "pencil-6b",
        "colored-pencil",
        "flat-brush",
        "crosshatch",
        "mypaint-cc0--kabura",
        "mypaint-cc0--marker-fat",
        "mypaint-cc0--splatter",
        "mypaint-cc0--dry-brush",
        "mypaint-cc0--2b-pencil",
        "rock-texture",
        "compressed-charcoal-edge",
        "pastel-paper-soft",
        "sponge-stipple-dab",
        "technical-needle-ink",
        "maru-pen-fine",
        "ink-splatter-burst",
        "stage-safe-splatter",
        "round-shading",
        "hard-oval",
        "smooth-oval",
        "spoon-pen-round",
        "bokeh-scatter",
        "watercolor-wet-bleed",
        "marker-colorless-blender",
        "bumpy-grain",
        "pencil-4b-rough",
        "crayon-wax-bold",
        "calligraphy-tilt-nib",
        "marker-wide-chisel",
        "taper-brush-marker",
        "oil-dry-scumble",
        "side-graphite-shade",
        "gouache-grain-flat",
        "dust-mote-depth",
        "cloud-billow-soft",
        "bristle-flat-streak",
        "wood-knot-rake",
        "sumi-wash-fray",
        "bristle-round-loaded",
        "snow-flurry-flake",
        "leaf-fall-flurry",
        "sparkle-glint-cross",
        "brush-pen-ink",
        "fresh-leaf",
        "long-leaf",
        "fur-soft-clumps",
      ]);
    expect(Object.isFrozen(STUDIO_BRUSH_QUARANTINED_PRESET_IDS)).toBe(true);
    expect(Object.isFrozen(STUDIO_BRUSH_QUARANTINE_REASON_BY_PRESET_ID)).toBe(true);
    for (const quarantinedId of STUDIO_BRUSH_QUARANTINED_PRESET_IDS) {
      expect(isStudioBrushQuarantinedPresetId(quarantinedId), quarantinedId).toBe(true);
      expect(resolveStudioBrushLifecycleStage(quarantinedId), quarantinedId).toBe("quarantined");
      expect(
        (STUDIO_BRUSH_QUARANTINE_REASON_BY_PRESET_ID[quarantinedId] ?? "").trim().length,
        quarantinedId,
      ).toBeGreaterThan(0);
    }
    // The retained in-group alternatives stay exposed on their own stages.
    expect(isStudioBrushQuarantinedPresetId("glitter")).toBe(false);
    expect(resolveStudioBrushLifecycleStage("glitter")).toBe("core");
    expect(resolveStudioBrushLifecycleStage("star-dust")).toBe("core");
    expect(isStudioBrushQuarantinedPresetId(42)).toBe(false);
  });

  it("keeps every quarantined id on its own runtime contract — never the pen safe-fallback", () => {
    // Pen-convergence regression (지침 3): quarantine removes exposure, not registration. A
    // quarantined id must keep replaying its OWN texture; only genuinely unknown ids may converge
    // to the documented pen fallback.
    //
    // The two catalogue partitions replay through different resolvers and always have:
    //  - core/engine-lane ids own a row in the runtime contract, so `resolveStudioBrushRuntime`
    //    answers `exact` for them;
    //  - pro-pack ids never appear in that table at all (quarantined or not) — they materialize
    //    onto one of the three durable pack runtimes through `materializeStudioBrushPackSelection`,
    //    keyed by the descriptor's array ordinal. Asserting `exact` from the core resolver for a
    //    pack id would assert a fact that was never true, so each partition is checked on the
    //    resolver that actually replays it.
    for (const quarantinedId of STUDIO_BRUSH_QUARANTINED_PRESET_IDS) {
      const packDescriptor = studioBrushPackDescriptorById(quarantinedId);
      if (packDescriptor) {
        // Pack replay path: the descriptor is still in the pack and still materializes its own
        // dynamics snapshot — the ordinal it is keyed by never moved, so the stroke is unchanged.
        const selection = materializeStudioBrushPackSelection(quarantinedId);
        expect(selection, quarantinedId).not.toBeNull();
        expect(selection?.catalogId, quarantinedId).toBe(quarantinedId);
        expect(selection?.brushDynamics?.presetId, quarantinedId)
          .toBe(packDescriptor.runtimeBrushId);
        // …and its runtime brush is a real contract, never the pen fallback.
        const packRuntime = resolveStudioBrushRuntime(packDescriptor.runtimeBrushId);
        expect(packRuntime.status, quarantinedId).toBe("exact");
        expect(packRuntime.resolvedId, quarantinedId).not.toBe(STUDIO_BRUSH_SAFE_FALLBACK_ID);
        continue;
      }
      const resolution = resolveStudioBrushRuntime(quarantinedId);
      expect(resolution.status, quarantinedId).toBe("exact");
      expect(resolution.reason, quarantinedId).toBe("supported");
      expect(resolution.resolvedId, quarantinedId).toBe(quarantinedId);
      expect(resolution.resolvedId, quarantinedId).not.toBe(STUDIO_BRUSH_SAFE_FALLBACK_ID);
      expect(resolution.contract, quarantinedId).toBe(
        resolveStudioBrushRuntimeContract(quarantinedId),
      );
    }
    const unknown = resolveStudioBrushRuntime("quarantine-never-shipped-id");
    expect(unknown.status).toBe("safe-fallback");
    expect(unknown.resolvedId).toBe(STUDIO_BRUSH_SAFE_FALLBACK_ID);
  });

  it("keeps quarantined ids inside the SSOT partition while the picker stops listing them", () => {
    const groups = buildStudioBrushVariantGroups();
    for (const quarantinedId of STUDIO_BRUSH_QUARANTINED_PRESET_IDS) {
      // Still governed: exactly one variant group owns the id (exposure ≠ governance removal).
      const owners = groups.filter((group) => group.memberPresetIds.includes(quarantinedId));
      expect(owners.length, quarantinedId).toBe(1);
      // Still resolvable for persisted documents…
      expect(studioBrushCatalogItemById(quarantinedId), quarantinedId).not.toBeNull();
      // …but absent from the default catalogue listing derived from the lifecycle stage.
      expect(
        filterStudioBrushCatalogItems({}).some((item) => item.id === quarantinedId),
        quarantinedId,
      ).toBe(false);
    }
  });

  it("locks the texture-first quality weights to the V17.1 split summing to 1", () => {
    expect(STUDIO_BRUSH_QUALITY_WEIGHTS).toEqual({
      texture: 0.4,
      dynamics: 0.15,
      edge: 0.1,
      determinism: 0.1,
      uniqueness: 0.1,
      performance: 0.1,
      editability: 0.05,
    });
    const sum = Object.values(STUDIO_BRUSH_QUALITY_WEIGHTS).reduce(
      (total, weight) => total + weight,
      0,
    );
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
});

describe("studio brush quality receipts", () => {
  it("hashes plan streams stably and order-sensitively", () => {
    expect(computeStudioBrushPlanDigest([])).toBe("811c9dc5");
    const digest = computeStudioBrushPlanDigest([1.5, -2.25, 1e-9]);
    expect(computeStudioBrushPlanDigest([1.5, -2.25, 1e-9])).toBe(digest);
    expect(computeStudioBrushPlanDigest([-2.25, 1.5, 1e-9])).not.toBe(digest);
    expect(digest).toMatch(/^[0-9a-f]{8}$/u);
  });

  it("keeps an unmeasured skeleton fully pending instead of fabricating scores", () => {
    const receipt = computeStudioBrushQualityReceiptSkeleton("pen");
    expect(receipt.status).toBe("bench");
    expect(receipt.textureScore).toBeNull();
    expect(receipt.dynamicsScore).toBeNull();
    expect(receipt.edgeScore).toBeNull();
    expect(receipt.determinismScore).toBeNull();
    expect(receipt.uniquenessScore).toBeNull();
    expect(receipt.performanceScore).toBeNull();
    expect(receipt.editabilityScore).toBeNull();
    expect(receipt.totalScore).toBeNull();
    expect(receipt.measuredAxes).toEqual([]);
    expect(receipt.pendingAxes).toEqual([
      "texture",
      "dynamics",
      "edge",
      "determinism",
      "uniqueness",
      "performance",
      "editability",
    ]);
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it("fills only determinism/performance from a mechanical bench measurement", () => {
    const receipt = computeStudioBrushQualityReceiptSkeleton("crayon", {
      planOk: true,
      planElapsedMs: 90,
      planBudgetMs: 450,
      planDigestFirst: "0a0a0a0a",
      planDigestSecond: "0a0a0a0a",
    });
    expect(receipt.determinismScore).toBe(1);
    expect(receipt.performanceScore).toBeCloseTo(0.8, 10);
    expect(receipt.textureScore).toBeNull();
    expect(receipt.totalScore).toBeNull();
    expect(receipt.measuredAxes).toEqual(["determinism", "performance"]);
    expect(receipt.pendingAxes).toEqual([
      "texture",
      "dynamics",
      "edge",
      "uniqueness",
      "editability",
    ]);
  });

  it("scores diverging digests 0 and missing digests as unmeasured", () => {
    const diverged = computeStudioBrushQualityReceiptSkeleton("crayon", {
      planOk: true,
      planElapsedMs: 10,
      planBudgetMs: 450,
      planDigestFirst: "0a0a0a0a",
      planDigestSecond: "0b0b0b0b",
    });
    expect(diverged.determinismScore).toBe(0);

    const unmeasured = computeStudioBrushQualityReceiptSkeleton("highlighter", {
      planOk: true,
      planElapsedMs: 10,
      planBudgetMs: 450,
      planDigestFirst: null,
      planDigestSecond: null,
    });
    expect(unmeasured.determinismScore).toBeNull();
    expect(unmeasured.performanceScore).not.toBeNull();
    expect(unmeasured.pendingAxes).toContain("determinism");
  });

  it("measures nothing from a failed plan or an invalid budget", () => {
    const failedPlan = computeStudioBrushQualityReceiptSkeleton("crayon", {
      planOk: false,
      planElapsedMs: 10,
      planBudgetMs: 450,
      planDigestFirst: "0a0a0a0a",
      planDigestSecond: "0a0a0a0a",
    });
    expect(failedPlan.determinismScore).toBeNull();
    expect(failedPlan.performanceScore).toBeNull();
    expect(failedPlan.measuredAxes).toEqual([]);

    const invalidBudget = computeStudioBrushQualityReceiptSkeleton("crayon", {
      planOk: true,
      planElapsedMs: 10,
      planBudgetMs: 0,
      planDigestFirst: null,
      planDigestSecond: null,
    });
    expect(invalidBudget.performanceScore).toBeNull();
  });

  it("clamps over-budget plans to 0 instead of going negative", () => {
    const receipt = computeStudioBrushQualityReceiptSkeleton("crayon", {
      planOk: true,
      planElapsedMs: 900,
      planBudgetMs: 450,
      planDigestFirst: null,
      planDigestSecond: null,
    });
    expect(receipt.performanceScore).toBe(0);
  });

  it("certifies fully measured receipts with the weighted total and rejects fabricated inputs", () => {
    const scores: Record<StudioBrushQualityAxis, number> = {
      texture: 0.9,
      dynamics: 0.8,
      edge: 0.7,
      determinism: 1,
      uniqueness: 0.6,
      performance: 0.5,
      editability: 0.4,
    };
    const receipt = certifyStudioBrushQualityReceipt("crayon", scores);
    expect(receipt.status).toBe("certified");
    expect(receipt.pendingAxes).toEqual([]);
    expect(receipt.measuredAxes.length).toBe(7);
    expect(receipt.totalScore).toBeCloseTo(
      0.9 * 0.4 + 0.8 * 0.15 + 0.7 * 0.1 + 1 * 0.1 + 0.6 * 0.1 + 0.5 * 0.1 + 0.4 * 0.05,
      10,
    );
    expect(Object.isFrozen(receipt)).toBe(true);

    expect(() =>
      certifyStudioBrushQualityReceipt("crayon", { ...scores, texture: 1.2 }),
    ).toThrowError(/texture/u);
    expect(() =>
      certifyStudioBrushQualityReceipt("crayon", {
        ...scores,
        determinism: Number.NaN,
      }),
    ).toThrowError(/determinism/u);
  });
});
