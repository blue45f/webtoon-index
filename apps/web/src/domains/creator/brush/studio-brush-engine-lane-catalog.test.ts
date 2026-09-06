import { describe, expect, it } from "vitest";

import { exportPageToSvg } from "../export/studio-svg-export";
import { BRUSH_PRESETS } from "../studio-brush";
import {
  describeStudioOssBrushHybridStack,
  hasStudioBrushTextureKindExactPin,
  resolveStudioBrushTextureKind,
} from "../studio-oss-brush-hybrid-registry";
import {
  STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE,
  captureStudioOutlineStrokeContractV1,
} from "../studio-outline-stroke-contract";
import { loadStudioPerfectFreehandStroker } from "../studio-perfect-freehand";

import { applyStudioBrushAliasWatercolorMaterial } from "./studio-brush-alias-profile";
import {
  STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS,
  isStudioBrushEngineLaneId,
  listStudioBrushEngineLaneIds,
  resolveStudioBrushEngineLaneBaseId,
  resolveStudioBrushEngineLaneCroquisCapsuleProgramId,
  resolveStudioBrushEngineLaneLabelKo,
  resolveStudioBrushEngineLaneWatercolorMaterial,
  studioBrushEngineLaneRowById,
} from "./studio-brush-engine-lane-catalog";
import {
  resolveStudioBrushRuntimeContract,
  studioBrushRuntimeExecutionSignature,
} from "./studio-brush-runtime-contract";
import { filterStudioBrushLibraryItems } from "./studio-draw-ux";

function exportBrushSvg(brushId: string): string {
  const runtime = resolveStudioBrushRuntimeContract(brushId)!;
  return exportPageToSvg({
    width: 96,
    height: 64,
    bg: "#ffffff",
    transparentBg: true,
    elements: [{
      id: "visual-lane-stroke",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      brush: brushId,
      brushCatalogId: brushId,
      points: [10, 34, 24, 18, 42, 42, 62, 20, 82, 31],
      pressures: [0.35, 0.55, 0.8, 0.6, 0.42],
      stroke: "#1f6feb",
      strokeWidth: 12,
      opacity: 0.72,
      sampleSpacing: 1,
      stampPipeline: runtime.engine === "stamp-dabs" ? "causal-walker-v2" : undefined,
      watercolorPipeline:
        runtime.engine === "watercolor-dabs" ? "causal-walker-v2" : undefined,
    }],
  }).svg;
}

describe("studio brush engine-lane catalog", () => {
  it("ships unique lane ids into BRUSH_PRESETS with runtime contracts", () => {
    const ids = listStudioBrushEngineLaneIds();
    expect(ids.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isStudioBrushEngineLaneId(id)).toBe(true);
      expect(BRUSH_PRESETS.some((p) => p.id === id)).toBe(true);
      expect(resolveStudioBrushRuntimeContract(id)).not.toBeNull();
      expect(resolveStudioBrushEngineLaneLabelKo(id)).toBeTruthy();
    }
  });

  it("routes hybrid texture by artistic base and exposes engineLane metadata", () => {
    for (const row of STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS) {
      expect(resolveStudioBrushEngineLaneBaseId(row.id)).toBe(row.baseId);
      // Lanes inherit their base's texture kind unless the id carries an explicit registry pin
      // (heterogeneous-media collection bases like mypaint-cc0 pin per id).
      if (!hasStudioBrushTextureKindExactPin(row.id)) {
        expect(resolveStudioBrushTextureKind(row.id)).toBe(
          resolveStudioBrushTextureKind(row.baseId),
        );
      } else {
        expect(resolveStudioBrushTextureKind(row.id)).not.toBe("dynamics-generic");
      }
      const stack = describeStudioOssBrushHybridStack(row.id);
      expect(stack.engineLane?.runtimeEngine).toBe(row.engine);
      expect(stack.crossEngineProductFallbackAllowed).toBe(false);
    }
  });

  it("keeps engine-variant lanes on different execution signatures than their canonical", () => {
    for (const row of STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS) {
      if (row.distinctness !== "engine-variant") continue;
      const contract = resolveStudioBrushRuntimeContract(row.id)!;
      const canonical = resolveStudioBrushRuntimeContract(row.canonicalId)!;
      expect(studioBrushRuntimeExecutionSignature(contract)).not.toBe(
        studioBrushRuntimeExecutionSignature(canonical),
      );
    }
  });

  it("files every engine lane under its own material tab instead of a tier tab", () => {
    // 회귀 방지: 예전에는 id→미디어 그룹 표에 `--` 레인 키가 하나도 없어서 71개 레인이 전부
    // "선" 탭으로 떨어졌다. 유화 리본이 선화 탭에, 수채 과립이 선화 탭에 있던 원인이다.
    const laneIds = new Set(listStudioBrushEngineLaneIds());
    const all = filterStudioBrushLibraryItems({ category: "all" });
    const lanes = all.filter((item) => laneIds.has(item.id));
    expect(lanes.length).toBe(STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.length);
    expect(lanes.every((item) => isStudioBrushEngineLaneId(item.id))).toBe(true);

    for (const lane of lanes) {
      const tabItems = filterStudioBrushLibraryItems({ category: lane.mediaGroup });
      expect(
        tabItems.some((item) => item.id === lane.id),
        `${lane.id}: missing from its own ${lane.mediaGroup} tab`,
      ).toBe(true);
    }

    const groupOf = (id: string) => lanes.find((item) => item.id === id)?.mediaGroup;
    expect(groupOf("oil--filbert-ribbon")).toBe("oil");
    expect(groupOf("watercolor--granular")).toBe("watercolor");
    expect(groupOf("mypaint-cc0--pastel")).toBe("pastel");
    expect(groupOf("ink-wash--sumi-core")).toBe("watercolor");
    expect(lanes.some((item) => item.id === "pen")).toBe(false);
  });

  it("pairs same-medium lanes onto different runtime engines", () => {
    expect(resolveStudioBrushRuntimeContract("oil--filbert-ribbon")?.engine).toBe(
      "oil-ribbon",
    );
    expect(resolveStudioBrushRuntimeContract("oil--tube-extrude")?.engine).toBe(
      "dynamic-dabs",
    );
    expect(resolveStudioBrushRuntimeContract("watercolor--granular")?.engine).toBe(
      "watercolor-dabs",
    );
    expect(resolveStudioBrushRuntimeContract("watercolor--edge-stamp")?.engine).toBe(
      "stamp-dabs",
    );
    expect(studioBrushEngineLaneRowById("oil--knife-edge")?.lane).toBe("oil-extrude");
  });
});

describe("engine-lane visual texture discrimination", () => {
  it("renders multi-engine pairs with non-identical SVG marks", async () => {
    await loadStudioPerfectFreehandStroker();
    const pairs: Array<[string, string]> = [
      ["oil", "oil--filbert-ribbon"],
      ["oil", "oil--tube-extrude"],
      ["oil--filbert-ribbon", "oil--flat-ribbon"],
      ["watercolor", "watercolor--granular"],
      ["watercolor--granular", "watercolor--dense-core"],
      ["ink-wash--sumi-core", "ink-wash--bleed-halo"],
      ["wash-brush", "watercolor--edge-stamp"],
      ["ink-brush", "gouache--flat-stamp"],
      ["airbrush", "airbrush--klecks-grit"],
      ["airbrush-fine", "airbrush--stamp-soft"],
      ["charcoal", "charcoal--vine-soft"],
      ["pen", "pen--perfect-taper"],
      // 2026-08-13 wave 3 — each new lane's declared feature must be real bytes at the durable
      // SVG surface, distinct from its non-pinned sibling (honesty policy).
      ["charcoal--mypaint-stamp", "mypaint-cc0--charcoal"],
      ["wash-brush", "mypaint-cc0--watercolor-fringe"],
      ["ink-brush", "mypaint-cc0--kabura"],
      ["ink-wash--sumi-core", "ink-wash--living-bake"],
      ["watercolor--granular", "watercolor--fluid-feather"],
      ["brush--oil-lanes", "brush--bristle-physics"],
      ["brush--bristle-depletion", "brush--bristle-physics"],
    ];
    const svgs = new Map<string, string>();
    for (const id of new Set(pairs.flat())) {
      const svg = exportBrushSvg(id);
      expect(svg, `${id}: empty`).toContain("#1f6feb");
      svgs.set(id, svg);
    }
    for (const [a, b] of pairs) {
      expect(svgs.get(a), `${a} vs ${b}`).not.toBe(svgs.get(b));
    }
    expect(svgs.get("oil--filbert-ribbon")).toContain("oil-ribbon-carrier");
    expect(svgs.get("oil--tube-extrude")!.includes("oil-ribbon-carrier")).toBe(false);
  });
});

describe("2026-08-13 wave 3 lane integrations", () => {
  it("grants the croquis capsule engine only through the explicit catalog pin", () => {
    expect(resolveStudioBrushEngineLaneCroquisCapsuleProgramId("gpen--croquis-capsule"))
      .toBe("croquis-capsule-v1");
    expect(resolveStudioBrushEngineLaneCroquisCapsuleProgramId("pen--croquis-stabilized"))
      .toBe("croquis-capsule-pulled-string-v1");
    // Fail-closed: unpinned/unknown ids never resolve a capsule program.
    expect(resolveStudioBrushEngineLaneCroquisCapsuleProgramId("gpen")).toBeNull();
    expect(resolveStudioBrushEngineLaneCroquisCapsuleProgramId("pen--perfect-taper")).toBeNull();
    expect(resolveStudioBrushEngineLaneCroquisCapsuleProgramId("gpen--croquis-capsule-x"))
      .toBeNull();

    const capsule = captureStudioOutlineStrokeContractV1({
      brushId: "gpen--croquis-capsule",
      pressureSource: "recorded",
    });
    expect(capsule?.engine).toBe(STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE);
    expect(capsule?.profile.id).toBe("croquis-capsule-v1");
    const stabilized = captureStudioOutlineStrokeContractV1({
      brushId: "pen--croquis-stabilized",
      pressureSource: "recorded",
    });
    expect(stabilized?.engine).toBe(STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE);
    expect(
      stabilized?.profile.id === "croquis-capsule-pulled-string-v1"
      && "pulledStringLengthPx" in (stabilized?.profile ?? {}),
    ).toBe(true);
    // Byte-frozen sibling branch: the perfect-freehand capture is untouched by the capsule pin.
    const gpen = captureStudioOutlineStrokeContractV1({
      brushId: "gpen",
      pressureSource: "recorded",
    });
    expect(gpen?.engine).toBe("perfect-freehand-outline");
  });

  it("exports capsule-contract strokes through the capsule engine with real hull bytes", () => {
    const exportWithContract = (brushId: string) => exportPageToSvg({
      width: 96,
      height: 64,
      bg: "#ffffff",
      transparentBg: true,
      elements: [{
        id: "capsule-lane-stroke",
        type: "draw",
        kind: "freehand",
        mode: "pen",
        brush: brushId,
        points: [10, 34, 24, 18, 42, 42, 62, 20, 82, 31],
        pressures: [0.35, 0.55, 0.8, 0.6, 0.42],
        stroke: "#1f6feb",
        strokeWidth: 12,
        opacity: 0.72,
        sampleSpacing: 1,
        outlineStroke: captureStudioOutlineStrokeContractV1({
          brushId,
          pressureSource: "recorded",
        }) ?? undefined,
      }],
    }).svg;

    const capsuleSvg = exportWithContract("gpen--croquis-capsule");
    expect(capsuleSvg).toContain('data-brush-engine="croquis-capsule-outline-contract-v1"');
    expect(capsuleSvg).toContain("#1f6feb");
    const stabilizedSvg = exportWithContract("pen--croquis-stabilized");
    expect(stabilizedSvg).toContain('data-brush-engine="croquis-capsule-outline-contract-v1"');
    // The pulled-string prefilter is a real geometric difference, not a relabel.
    expect(stabilizedSvg).not.toBe(capsuleSvg);
    // The perfect-freehand branch keeps its byte-frozen engine label.
    const gpenSvg = exportWithContract("gpen");
    expect(gpenSvg).toContain('data-brush-engine="perfect-outline-contract-v1"');
  });

  it("keeps non-pinned wet lanes byte-identical across the settled bake phase gate", () => {
    const dabs = Object.freeze([
      Object.freeze({ x: 10, y: 10, radius: 6, opacity: 0.5, role: "core" as const }),
      Object.freeze({ x: 10, y: 10, radius: 9, opacity: 0.3, role: "diffuse" as const }),
      Object.freeze({ x: 22, y: 14, radius: 6, opacity: 0.5, role: "core" as const }),
      Object.freeze({ x: 22, y: 14, radius: 9, opacity: 0.3, role: "diffuse" as const }),
    ]);
    // Mutation proxy for the phase gate: a non-pinned lane may not change a byte between the
    // live and settled phases, while the pinned lane's settled pass must produce real new dabs.
    const sumiLive = applyStudioBrushAliasWatercolorMaterial("ink-wash--sumi-core", dabs, 7, "live");
    const sumiSettled = applyStudioBrushAliasWatercolorMaterial(
      "ink-wash--sumi-core",
      dabs,
      7,
      "settled",
    );
    expect(JSON.stringify(sumiSettled)).toBe(JSON.stringify(sumiLive));

    const bakedLive = applyStudioBrushAliasWatercolorMaterial(
      "ink-wash--living-bake",
      dabs,
      7,
      "live",
    );
    const bakedSettled = applyStudioBrushAliasWatercolorMaterial(
      "ink-wash--living-bake",
      dabs,
      7,
      "settled",
    );
    expect(JSON.stringify(bakedSettled)).not.toBe(JSON.stringify(bakedLive));
    // One wet-texture authority per lane: a bake pin may never coexist with a bloom pin.
    for (const row of STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS) {
      const material = resolveStudioBrushEngineLaneWatercolorMaterial(row.id);
      if (!material) continue;
      expect(
        material.wetEdgeBloomProgramId !== undefined
          && material.livingInkBakeProgramId !== undefined,
        `${row.id}: two wet texture authorities`,
      ).toBe(false);
    }
  });
});
