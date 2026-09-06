import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsSettingsForBrushId,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
} from "./brush/studio-brush-dynamics";
import { resolveStudioStrokeSymmetry } from "./brush/studio-brush-intrinsic-symmetry";
import { materializeStudioBrushPackDynamics } from "./brush/studio-brush-pack-runtime";
import {
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
} from "./brush/studio-brush-render-budget";
import { studioBrushSymmetryTransforms } from "./brush/studio-brush-symmetry";
import { encodeStudioBrushTipAlphaMapBase64 } from "./brush/studio-brush-tip-stamp";
import { exportPageToSvg } from "./export/studio-svg-export";
import { planStudioDynamicBrushRender } from "./studio-dynamic-brush-render-plan";
import {
  planStudioWebDrawingKitOwnedDabs,
  STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS,
} from "./studio-web-drawing-stroke-bridge";

import type { StudioDynamicBrushDab } from "./brush/studio-brush-dynamics";
import type { DrawEl } from "./studio-element-model";

const ROUTE = [
  10, 20,
  24, 22,
  41, 29,
  63, 35,
  88, 31,
] as const;

function causalV3Dynamics() {
  return normalizeStudioBrushDynamicsSettings({
    depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
    seed: 73,
    width: { base: 8, mappings: [] },
    opacity: { base: 0.82, mappings: [] },
    flow: { base: 0.74, mappings: [] },
    spacingRatio: null,
    spacing: { base: 1.25, mappings: [] },
    scatterRatio: null,
    scatter: { base: 0, mappings: [] },
    angle: { base: 0, mappings: [] },
    roundness: { base: 1, mappings: [] },
    tip: { shape: "round", softness: 0 },
    grain: { amount: 0 },
    tipLayers: [],
    dualBrush: { enabled: false },
    taper: { enabled: false },
  });
}

function drawElement(
  id: string,
  overrides: Partial<DrawEl> = {},
): DrawEl {
  const pointCount = ROUTE.length / 2;
  return {
    id,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [...ROUTE],
    stroke: "#1d3f8f",
    strokeWidth: 8,
    opacity: 0.8,
    brush: "g-pen-flex",
    pressures: Array.from({ length: pointCount }, (_, index) => 0.35 + index * 0.1),
    tangentialPressures: Array.from({ length: pointCount }, () => 0),
    speeds: Array.from({ length: pointCount }, (_, index) => index * 0.08),
    tiltXs: Array.from({ length: pointCount }, (_, index) => index * 2),
    tiltYs: Array.from({ length: pointCount }, (_, index) => -index),
    twists: Array.from({ length: pointCount }, (_, index) => index * 9),
    brushDynamics: causalV3Dynamics(),
    ...overrides,
  };
}

function requireReady(
  result: ReturnType<typeof planStudioDynamicBrushRender>,
) {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error(`unexpected plan rejection: ${result.reason}`);
  }
  return result.plan;
}

function requireLegacyVariation(
  plan: ReturnType<typeof requireReady>,
  index: number,
): readonly StudioDynamicBrushDab[] {
  const variation = plan.dabVariations[index];
  if (!Array.isArray(variation)) {
    throw new Error("expected a legacy flat dab variation");
  }
  return variation;
}

describe("studio dynamic brush render plan", () => {
  it("builds a deterministic segmented causal-v3 plan", () => {
    const element = drawElement("causal-v3-stroke");

    const first = requireReady(
      planStudioDynamicBrushRender(element, "g-pen-flex", true),
    );
    const replay = requireReady(
      planStudioDynamicBrushRender(
        structuredClone(element),
        "g-pen-flex",
        false,
      ),
    );

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      materialIdentity: {
        brushId: "g-pen-flex",
        dryMediaPresetId: null,
      },
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
      usesCausalDepositPlan: true,
      renderBudget: {
        symmetryCount: 1,
        dabCapped: false,
      },
    });
    expect(first.dabVariations).toHaveLength(1);
    expect(first.dabVariations[0]).toMatchObject({
      kind: "studio-dynamic-brush-segmented-dab-variation",
    });
  });

  it("carries the explicit catalogue material identity into every renderer-neutral plan", () => {
    const plan = requireReady(planStudioDynamicBrushRender(
      drawElement("catalogue-chalk", {
        brush: "dry-media",
        brushCatalogId: "chalk-rough",
      }),
      "dry-media",
      false,
    ));

    expect(plan.materialIdentity).toEqual({
      brushId: "dry-media",
      brushCatalogId: "chalk-rough",
      dryMediaPresetId: "chalk",
    });
  });

  it("uses an explicit page surface so retained strokes update with the selected paper", () => {
    const plan = requireReady(planStudioDynamicBrushRender(
      drawElement("retained-paper", {
        brush: "dry-media",
        brushCatalogId: "chalk-rough",
      }),
      "dry-media",
      false,
      { kind: "rough", seed: 91 },
    ));

    expect(plan.paper?.surface).toEqual({ kind: "rough", seed: 91 });
  });

  it("budgets the connected professional shelf carrier as one command per causal dab", () => {
    const brushDynamics = materializeStudioBrushPackDynamics("bristle-fan-dry");
    if (!brushDynamics) throw new Error("missing bristle-fan-dry dynamics");
    const plan = requireReady(planStudioDynamicBrushRender(
      drawElement("professional-fan-bristle", {
        brush: "dry-media",
        brushCatalogId: "bristle-fan-dry",
        brushDynamics,
      }),
      "dry-media",
      true,
    ));

    expect(plan.materialIdentity).toEqual({
      brushId: "dry-media",
      brushCatalogId: "bristle-fan-dry",
      dryMediaPresetId: "charcoal",
    });
    expect(brushDynamics.tipLayers.length).toBeGreaterThan(0);
    expect(plan.renderBudget).toMatchObject({
      marksPerDab: 10,
      dabCapped: false,
    });
    expect(plan.renderBudget.estimatedMarks)
      .toBe(plan.renderBudget.maxDabsPerVariation * 10);
  });

  it("produces one exact affine dab variation per symmetry transform", () => {
    const legacyDynamics = normalizeStudioBrushDynamicsSettings({
      seed: 19,
      width: { base: 10, mappings: [] },
      opacity: { base: 1, mappings: [] },
      flow: { base: 1, mappings: [] },
      spacingRatio: null,
      spacing: { base: 4, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
      angle: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
      taper: { enabled: false },
    });
    const plan = requireReady(planStudioDynamicBrushRender(
      drawElement("vertical-symmetry", {
        brushDynamics: legacyDynamics,
        symmetry: {
          type: "vertical",
          centerX: 50,
          centerY: 0,
        },
      }),
      "dry-media",
      false,
    ));
    const identity = requireLegacyVariation(plan, 0);
    const reflected = requireLegacyVariation(plan, 1);

    expect(plan.usesCausalDepositPlan).toBe(false);
    expect(plan.renderBudget.symmetryCount).toBe(2);
    expect(plan.dabVariations).toHaveLength(2);
    expect(reflected).toHaveLength(identity.length);
    expect(reflected.map((dab) => ({
      sourceX: dab.sourceX,
      sourceY: dab.sourceY,
      x: dab.x,
      y: dab.y,
    }))).toEqual(identity.map((dab) => ({
      sourceX: 100 - dab.sourceX,
      sourceY: dab.sourceY,
      x: 100 - dab.x,
      y: dab.y,
    })));
  });

  it("uses the live legacy budget only for active drafts and restores committed fidelity", () => {
    const alphaBytes = new Uint8Array(8 * 8);
    alphaBytes.fill(255);
    const texturedLegacyDynamics = normalizeStudioBrushDynamicsSettings({
      seed: 5,
      width: { base: 8, mappings: [] },
      opacity: { base: 1, mappings: [] },
      flow: { base: 1, mappings: [] },
      spacingRatio: null,
      spacing: { base: 0.25, mappings: [] },
      scatterRatio: null,
      scatter: { base: 0, mappings: [] },
      roundness: { base: 1, mappings: [] },
      tip: {
        shape: "hard",
        softness: 0,
        alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(alphaBytes),
        alphaMapSize: 8,
      },
      taper: { enabled: false },
    });
    const element = drawElement("legacy-budget", {
      points: [0, 0, 10_000, 0],
      pressures: [1, 1],
      tangentialPressures: [0, 0],
      speeds: [0, 0.5],
      tiltXs: [0, 0],
      tiltYs: [0, 0],
      twists: [0, 0],
      brushDynamics: texturedLegacyDynamics,
    });
    const active = requireReady(
      planStudioDynamicBrushRender(element, "dry-media", true),
    );
    const committed = requireReady(
      planStudioDynamicBrushRender(element, "dry-media", false),
    );
    const activeDabs = requireLegacyVariation(active, 0);
    const committedDabs = requireLegacyVariation(committed, 0);

    expect(active.markBudget).toBe(STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET);
    expect(committed.markBudget).toBe(STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET);
    expect(active.renderBudget.dabCapped).toBe(true);
    expect(committed.renderBudget.dabCapped).toBe(false);
    expect(activeDabs.length).toBe(active.renderBudget.maxDabsPerVariation);
    expect(committedDabs.length).toBe(committed.renderBudget.maxDabsPerVariation);
    expect(committedDabs.length).toBeGreaterThan(activeDabs.length);
  });

  it("rejects malformed causal input instead of falling back to a legacy deposition", () => {
    const malformed = drawElement("malformed-causal", {
      points: [0, 0, Number.NaN, 12],
      pressures: [0.5, 0.7],
      tangentialPressures: [0, 0],
      speeds: [0, 0.3],
      tiltXs: [0, 0],
      tiltYs: [0, 0],
      twists: [0, 0],
    });

    expect(planStudioDynamicBrushRender(
      malformed,
      "g-pen-flex",
      true,
    )).toEqual({
      status: "rejected",
      reason: "deposit-plan",
    });
  });

  it("plans kit-owned web brushes through kit dabs and leaves intrinsic-symmetry folds on the ordinary path", () => {
    const ownedId = STUDIO_WEB_DRAWING_KIT_OWNED_BRUSH_IDS[0];
    expect(ownedId).toBeDefined();
    const ownedCatalog = studioBrushDynamicsSettingsForBrushId(ownedId!);
    expect(ownedCatalog).not.toBeNull();
    const ownedElement = drawElement("kit-owned-stroke", {
      brush: ownedId,
      brushDynamics: ownedCatalog!,
    });
    const ownedPlan = requireReady(
      planStudioDynamicBrushRender(ownedElement, ownedId!, false),
    );
    expect(ownedPlan.usesCausalDepositPlan).toBe(false);

    const kitDabs = planStudioWebDrawingKitOwnedDabs(
      {
        brushId: ownedId,
        points: ownedElement.points,
        pressures: ownedElement.pressures,
        baseWidth: Math.max(1, ownedElement.strokeWidth),
        baseOpacity: ownedPlan.dynamics.opacity.base,
        seed: ownedPlan.seed,
        maxDabs: ownedPlan.renderBudget.maxDabsPerVariation,
      },
      ownedPlan.dynamics,
    );
    expect(kitDabs).not.toBeNull();
    expect(kitDabs!.length).toBeGreaterThan(0);

    const ownedVariation = requireLegacyVariation(ownedPlan, 0);
    expect(ownedVariation.map((dab) => ({ x: dab.x, y: dab.y }))).toEqual(
      kitDabs!.map((dab) => ({ x: dab.x, y: dab.y })),
    );

    const pageCenter = {
      type: "none" as const,
      centerX: 50,
      centerY: 30,
      radialCount: 6,
    };
    for (const brushId of ["web-mirror-ink", "web-kaleido-ink"] as const) {
      const catalog = studioBrushDynamicsSettingsForBrushId(brushId);
      expect(catalog, brushId).not.toBeNull();
      const symmetry = resolveStudioStrokeSymmetry(pageCenter, brushId);
      expect(symmetry, brushId).toBeDefined();
      const element = drawElement(`${brushId}-ordinary`, {
        brush: brushId,
        brushDynamics: catalog!,
        symmetry,
      });
      const plan = requireReady(planStudioDynamicBrushRender(element, brushId, false));
      expect(planStudioWebDrawingKitOwnedDabs(
        {
          brushId,
          points: element.points,
          pressures: element.pressures,
          baseWidth: Math.max(1, element.strokeWidth),
          baseOpacity: plan.dynamics.opacity.base,
          seed: plan.seed,
          maxDabs: plan.renderBudget.maxDabsPerVariation,
        },
        plan.dynamics,
      ), brushId).toBeNull();
      expect(plan.dabVariations, brushId).toHaveLength(
        studioBrushSymmetryTransforms(symmetry).length,
      );
    }
  });
});

/**
 * Legacy replay fail-safe. Strokes drawn before element-level dynamics capture carry no
 * `brushDynamics`, so their dynamics are re-derived from today's catalogue. That catalogue now
 * mints the dry-media kernel pin for freshly authored presets — and inheriting it would move a
 * saved stroke off the union carrier it was actually drawn with, changing its grain and edge in a
 * document the artist already finished. Only an element's own stored snapshot may carry the pin.
 */
describe("legacy dry-media replay ownership", () => {
  const DRY_MEDIA_IDS = ["crayon", "chalk", "charcoal", "pastel", "oil-pastel"] as const;

  it("keeps the fresh-authoring catalogue pin off strokes that stored no dynamics", () => {
    for (const brushId of DRY_MEDIA_IDS) {
      const authored = studioBrushDynamicsSettingsForBrushId(brushId);
      if (!authored?.dryMediaKernelProgram) continue;
      const legacy = drawElement(`legacy-${brushId}`, {
        brush: brushId,
        brushDynamics: undefined,
      });

      const plan = requireReady(planStudioDynamicBrushRender(legacy, brushId, false));

      expect(plan.dynamics.dryMediaKernelProgram, brushId).toBeUndefined();
    }
  });

  it("still honours the pin when the stroke stored it itself", () => {
    const brushId = DRY_MEDIA_IDS.find(
      (id) => studioBrushDynamicsSettingsForBrushId(id)?.dryMediaKernelProgram !== undefined,
    );
    if (!brushId) return;
    const authored = studioBrushDynamicsSettingsForBrushId(brushId)!;
    const captured = drawElement(`captured-${brushId}`, {
      brush: brushId,
      brushDynamics: authored,
    });

    const plan = requireReady(planStudioDynamicBrushRender(captured, brushId, false));

    expect(plan.dynamics.dryMediaKernelProgram).toBeDefined();
  });

  it("keeps the pin off the SVG export fallback too, not just the canvas planner", () => {
    // Canvas and SVG each re-derive dynamics for an element that stored none. Fixing only the
    // canvas made the SAME document render through the union carrier on screen and the kernel
    // engine in an export — so both now share studioReplaySafeBrushDynamicsSettingsForBrushId.
    const brushId = DRY_MEDIA_IDS.find(
      (id) => studioBrushDynamicsSettingsForBrushId(id)?.dryMediaKernelProgram !== undefined,
    );
    if (!brushId) return;
    const authored = studioBrushDynamicsSettingsForBrushId(brushId)!;
    const stroke = {
      id: "legacy-dry-media-export",
      type: "draw" as const,
      kind: "freehand" as const,
      mode: "pen" as const,
      brush: brushId,
      points: [8, 44, 24, 20, 44, 48, 66, 16, 88, 42, 104, 28],
      pressures: [0.18, 0.38, 0.72, 0.94, 0.58, 0.32],
      stroke: "#2457d6",
      strokeWidth: 12,
      opacity: 0.82,
      sampleSpacing: 1,
    };
    const render = (element: Record<string, unknown>): string => exportPageToSvg({
      width: 112,
      height: 72,
      transparentBg: true,
      elements: [element as never],
    }).svg;

    // No stored snapshot -> id-derived fallback. Must NOT match the pinned rendering.
    const legacy = render({ ...stroke });
    const pinned = render({ ...stroke, brushDynamics: authored });

    expect(legacy).not.toBe(pinned);
  });
});
