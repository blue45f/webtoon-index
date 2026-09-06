import { describe, expect, it } from "vitest";

import {
  planStudioDynamicBrushCoverageMarks,
  type StudioDynamicBrushDabVariation,
} from "../studio-dynamic-brush-coverage-renderer";

import {
  normalizeStudioBrushDynamicsSettings,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  type StudioDynamicBrushDab,
} from "./studio-brush-dynamics";
import { STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID } from "./studio-brush-render-budget";
import {
  resolveStudioDynamicBrushMaterialIdentity,
  type StudioDynamicBrushMaterialIdentity,
} from "./studio-dry-media-dynamic-bridge";

const DYNAMICS = normalizeStudioBrushDynamicsSettings({
  depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
  seed: 91,
  width: { base: 18, mappings: [] },
  opacity: { base: 0.72, mappings: [] },
  flow: { base: 0.66, mappings: [] },
  spacingRatio: null,
  spacing: { base: 2.1, mappings: [] },
  scatterRatio: null,
  scatter: { base: 0, mappings: [] },
  angle: { base: 0, mappings: [] },
  roundness: { base: 0.8, mappings: [] },
  tip: { shape: "round", softness: 0 },
  grain: { amount: 0 },
  tipLayers: [],
  dualBrush: { enabled: false },
  taper: { enabled: false },
});

function dabs(count = 192): StudioDynamicBrushDab[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    progress: count <= 1 ? 0 : index / (count - 1),
    sourceX: index * 2.1,
    sourceY: Math.sin(index / 19) * 4,
    x: index * 2.1,
    y: Math.sin(index / 19) * 4,
    size: 18,
    opacity: 0.72,
    flow: 0.66,
    spacing: 2.1,
    scatter: 0,
    angle: Math.atan2(
      Math.cos(index / 19) * 4 / 19,
      2.1,
    ) * 180 / Math.PI,
    roundness: 0.8,
  }));
}

function identity(
  brushId: string,
  brushCatalogId?: string,
): StudioDynamicBrushMaterialIdentity {
  const result = resolveStudioDynamicBrushMaterialIdentity(
    brushId,
    brushCatalogId,
  );
  if (!result) throw new Error("missing material identity");
  return result;
}

function coverage(
  materialIdentity: StudioDynamicBrushMaterialIdentity | undefined,
  dabVariations: readonly StudioDynamicBrushDabVariation[] = [dabs()],
) {
  return planStudioDynamicBrushCoverageMarks({
    dabVariations,
    ...(materialIdentity ? { materialIdentity } : {}),
    dynamics: DYNAMICS,
    dynamicSeed: 0x5eed_cafe,
    stroke: "#34261d",
    stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
    markBudget: 65_536,
  });
}

describe("dynamic dry-media product integration", () => {
  it("makes core crayon, chalk and charcoal visually distinct with material lane coverage", () => {
    const plans = ([
      ["crayon", 5],
      ["chalk", 5],
      ["charcoal", 5],
    ] as const).map(([brushId, laneCount]) => {
      const plan = coverage(identity(brushId));
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.reason);
      expect(plan.marks).toHaveLength(192 * laneCount);
      expect(plan.marks.every((mark) => mark.radiusX > mark.radiusY)).toBe(true);
      return plan;
    });
    const signatures = plans.map((plan) => {
      const mark = plan.marks[73]!;
      return [
        mark.radiusX,
        mark.radiusY,
        mark.angleRadians,
        mark.alpha,
      ].map((value) => value.toFixed(8)).join(":");
    });
    expect(new Set(signatures).size).toBe(3);
  });

  it("is byte-identical across causal-v3 segment boundaries", () => {
    const source = dabs(4_096);
    const materialIdentity = identity("dry-media", "pastel-paper-soft");
    const complete = coverage(materialIdentity, [source]);
    const segmented = coverage(materialIdentity, [{
      kind: "studio-dynamic-brush-segmented-dab-variation",
      segments: [
        source.slice(0, 311),
        source.slice(311, 1_337),
        source.slice(1_337, 2_971),
        source.slice(2_971),
      ],
    }]);
    expect(complete.ok).toBe(true);
    expect(segmented.ok).toBe(true);
    if (!complete.ok || !segmented.ok) return;
    expect(segmented.marks).toEqual(complete.marks);
  });

  it("keeps intentional discrete dry media on the authored renderer", () => {
    const authored = coverage(undefined);
    const explicitDiscrete = coverage(
      identity("dry-media", "sponge-stipple-dab"),
    );
    expect(explicitDiscrete).toEqual(authored);
  });

  it("rejects a corrupted mapped identity instead of using generic circular coverage", () => {
    const corrupted = {
      brushId: "dry-media",
      brushCatalogId: "chalk-rough",
      dryMediaPresetId: "charcoal",
    } as const satisfies StudioDynamicBrushMaterialIdentity;
    expect(coverage(corrupted)).toEqual({
      ok: false,
      reason: "dry-media-bridge",
    });
  });
});
