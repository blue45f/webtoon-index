import { beforeAll, describe, expect, it } from "vitest";

import { exportPageToSvg } from "../export/studio-svg-export";
import { BRUSH_PRESETS, type BrushPreset } from "../studio-brush";
import { loadStudioPerfectFreehandStroker } from "../studio-perfect-freehand";

import {
  DEFAULT_STUDIO_BRUSH_SNAPSHOT,
  sanitizeBrushSnapshot,
} from "./studio-brush-library";
import {
  STUDIO_BRUSH_RUNTIME_CATALOG_AUDIT,
  STUDIO_BRUSH_RUNTIME_CONTRACT,
  STUDIO_BRUSH_SAFE_FALLBACK_ID,
  auditStudioBrushRuntimeCatalog,
  inspectStudioBrushUserPresetRuntime,
  resolveStudioBrushRuntime,
  type StudioBrushRuntimeContract,
} from "./studio-brush-runtime-contract";

describe("Studio brush executable runtime validation", () => {
  // perfect-outline 엔진의 다이내믹 청크를 선로드해 동기 SVG 감사가 실제 아웃라인을 검증한다.
  beforeAll(async () => {
    await loadStudioPerfectFreehandStroker();
  });

  it("fail-fast audit proves every built-in preset has a supported engine tuple", () => {
    expect(STUDIO_BRUSH_RUNTIME_CATALOG_AUDIT).toEqual({
      ok: true,
      presetCount: BRUSH_PRESETS.length,
      contractCount: STUDIO_BRUSH_RUNTIME_CONTRACT.length,
      issues: [],
    });

    for (const contract of STUDIO_BRUSH_RUNTIME_CONTRACT) {
      expect(contract.texture, `${contract.id}: missing texture capability`).toBeTruthy();
      expect(contract.dynamics, `${contract.id}: missing dynamics capability`).toBeTruthy();
    }
  });

  it("rejects a selectable catalogue preset whose renderer contract was forgotten", () => {
    const catalogOnly: BrushPreset = {
      id: "catalog-only-no-renderer",
      name: "계약 없는 브러시",
      defaultWidth: 12,
      defaultOpacity: 1,
      operation: "paint",
    };
    const audit = auditStudioBrushRuntimeCatalog(
      [...BRUSH_PRESETS, catalogOnly],
      STUDIO_BRUSH_RUNTIME_CONTRACT
    );

    expect(audit.ok).toBe(false);
    expect(audit.issues).toContainEqual(expect.objectContaining({
      brushId: catalogOnly.id,
      code: "missing-runtime-contract",
    }));
  });

  it("rejects unknown variants and incompatible tip/texture/dynamics combinations", () => {
    const pen = STUDIO_BRUSH_RUNTIME_CONTRACT[0];
    const unknownVariant: StudioBrushRuntimeContract = {
      ...pen,
      engineVariant: "declared-but-not-rendered",
    };
    const incompatibleTuple: StudioBrushRuntimeContract = {
      ...pen,
      tip: "spark",
      texture: "procedural-spark",
      dynamics: "seeded-particles",
    };

    expect(auditStudioBrushRuntimeCatalog([BRUSH_PRESETS[0]], [unknownVariant]).issues)
      .toContainEqual(expect.objectContaining({ code: "unsupported-engine-variant" }));
    expect(auditStudioBrushRuntimeCatalog([BRUSH_PRESETS[0]], [incompatibleTuple]).issues)
      .toContainEqual(expect.objectContaining({ code: "incompatible-engine-combination" }));
  });

  it("rejects a runtime contract whose operation disagrees with its catalogue preset", () => {
    const standardEraser = BRUSH_PRESETS.find((preset) => preset.id === "standard-eraser")!;
    const contract = STUDIO_BRUSH_RUNTIME_CONTRACT.find(
      (candidate) => candidate.id === standardEraser.id
    )!;
    const audit = auditStudioBrushRuntimeCatalog(
      [standardEraser],
      [{ ...contract, operation: "paint", canonicalId: standardEraser.id, distinctness: "unique" }]
    );

    expect(audit.issues).toContainEqual(expect.objectContaining({
      brushId: "standard-eraser",
      code: "operation-mismatch",
    }));
  });

  it("reports exact capabilities for custom presets built on stamp and dynamic engines", () => {
    expect(inspectStudioBrushUserPresetRuntime({ brushId: "wash-brush" })).toMatchObject({
      resolution: { status: "exact", resolvedId: "wash-brush", reason: "supported" },
      stampTuning: "active",
      brushDynamics: "preserved-inactive",
      customTipTexture: "unsupported",
    });
    expect(inspectStudioBrushUserPresetRuntime({ brushId: "dry-media" })).toMatchObject({
      resolution: { status: "exact", resolvedId: "dry-media", reason: "supported" },
      stampTuning: "inactive",
      brushDynamics: "active",
      customTipTexture: "supported",
    });
  });

  it("sanitizes and renders a visible user-defined preset on every supported base engine", () => {
    for (const preset of BRUSH_PRESETS) {
      const runtime = resolveStudioBrushRuntime(preset.id);
      const { snapshot } = sanitizeBrushSnapshot({
        ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
        brushId: preset.id,
        strokeWidth: preset.defaultWidth,
        brushOpacity: preset.defaultOpacity,
        stampTuning: undefined,
      });
      const result = exportPageToSvg({
        width: 96,
        height: 64,
        bg: "#ffffff",
        transparentBg: true,
        elements: [{
          id: `user-preset-${preset.id}`,
          type: "draw",
          kind: "freehand",
          mode: "pen",
          brush: snapshot.brushId,
          points: [10, 34, 24, 18, 42, 42, 62, 20, 82, 31],
          pressures: [0.35, 0.55, 0.8, 0.6, 0.42],
          stroke: snapshot.color,
          strokeWidth: snapshot.strokeWidth,
          opacity: snapshot.brushOpacity,
          sampleSpacing: 1,
          brushDynamics: snapshot.brushDynamics,
          stamp: snapshot.stampTuning ?? undefined,
          stampPipeline: runtime.contract.engine === "stamp-dabs"
            ? "causal-walker-v2"
            : undefined,
          watercolorPipeline: runtime.contract.engine === "watercolor-dabs"
            ? "causal-walker-v2"
            : undefined,
        }],
      });

      expect(snapshot.brushId, `${preset.id}: user preset fell back unexpectedly`).toBe(preset.id);
      expect(result.elementCount, `${preset.id}: sanitized preset did not render`).toBe(1);
      expect(result.skipped, `${preset.id}: sanitized preset hit an unsupported route`).toEqual([]);
      expect(result.svg, `${preset.id}: sanitized preset produced no visible colour`)
        .toContain(snapshot.color);
    }
  });

  it("turns unsupported user/import ids into an explicit, diagnosable safe fallback", () => {
    expect(resolveStudioBrushRuntime("marketplace-engine-not-installed")).toMatchObject({
      status: "safe-fallback",
      requestedId: "marketplace-engine-not-installed",
      resolvedId: STUDIO_BRUSH_SAFE_FALLBACK_ID,
      reason: "unsupported-id",
      contract: { engine: "causal-ink", tip: "round" },
    });
    expect(resolveStudioBrushRuntime(undefined)).toMatchObject({
      status: "safe-fallback",
      requestedId: null,
      reason: "missing-id",
    });
  });

  it("does not trust a user preset merely because an id leaked into the visual catalogue", () => {
    const leakedPreset: BrushPreset = {
      id: "catalog-leak-without-runtime",
      name: "무반응 브러시",
      defaultWidth: 10,
      defaultOpacity: 1,
      operation: "paint",
    };
    BRUSH_PRESETS.push(leakedPreset);
    try {
      const result = sanitizeBrushSnapshot({
        brushId: leakedPreset.id,
        strokeWidth: 10,
        brushOpacity: 1,
        color: "#123456",
      });
      expect(result.snapshot.brushId).toBe(STUDIO_BRUSH_SAFE_FALLBACK_ID);
      expect(result.adjustedFields).toContain("brushId");
    } finally {
      const index = BRUSH_PRESETS.findIndex((preset) => preset.id === leakedPreset.id);
      if (index >= 0) BRUSH_PRESETS.splice(index, 1);
    }
  });
});
