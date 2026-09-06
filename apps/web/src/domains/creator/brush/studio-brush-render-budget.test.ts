import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  planStudioDynamicBrushDabs,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
  STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
} from "./studio-brush-dynamics";
import {
  countStudioDynamicBrushMarksPerDab,
  planStudioDynamicBrushRenderBudget,
  selectStudioDynamicBrushCausalStampGrid,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_DAB_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_DAB_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
  STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2,
  STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
  STUDIO_DYNAMIC_BRUSH_MIN_DABS_PER_VARIATION,
  studioDynamicBrushCausalStampGridRuleOf,
} from "./studio-brush-render-budget";
import { encodeStudioBrushTipAlphaMapBase64 } from "./studio-brush-tip-stamp";

function fullAlphaTip() {
  const alphaMapSize = 8;
  const bytes = new Uint8Array(alphaMapSize * alphaMapSize);
  bytes.fill(255);
  return {
    shape: "hard" as const,
    softness: 0,
    alphaMapBase64: encodeStudioBrushTipAlphaMapBase64(bytes),
    alphaMapSize,
  };
}

function worstCaseSettings() {
  const tip = fullAlphaTip();
  return normalizeStudioBrushDynamicsSettings({
    tip,
    tipLayers: [
      { tip, opacity: 1 },
      { tip, opacity: 1 },
    ],
    taper: { enabled: false },
    spacingRatio: null,
    spacing: { base: 0.25, mappings: [] },
  });
}

describe("studio dynamic brush render budget", () => {
  it("counts causal-v2 full alpha textures as one command instead of a three-sample circle grid", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: fullAlphaTip(),
      grain: { amount: 0.25 },
    });
    const tap = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: 1,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });
    const longStroke = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: 1_024,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });

    expect(tap).toMatchObject({
      stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
      maxDabsPerVariation: 1,
      marksPerDab: 1,
      stampGridReduced: false,
      capped: false,
    });
    expect(longStroke).toMatchObject({
      stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
      maxDabsPerVariation: 1_024,
      marksPerDab: 1,
      estimatedMarks: 1_024,
      stampGridReduced: false,
      dabCapped: false,
      capped: false,
    });
  });

  it("charges one causal command for each enabled full-texture tip layer", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: fullAlphaTip(),
      grain: { amount: 0.25 },
      tipLayers: [
        { tip: fullAlphaTip(), opacity: 1 },
        { tip: fullAlphaTip(), opacity: 0.5 },
      ],
      dualBrush: {
        enabled: true,
        tip: { shape: "star", softness: 0.1 },
        blendMode: "multiply",
        sizeRatio: 0.8,
      },
    });

    expect(countStudioDynamicBrushMarksPerDab(settings, 3)).toBe(3);
    expect(countStudioDynamicBrushMarksPerDab(settings, 7)).toBe(3);
    expect(planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: 1_000,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    })).toMatchObject({
      maxDabsPerVariation: 1_000,
      marksPerDab: 3,
      estimatedMarks: 3_000,
      dabCapped: false,
    });
  });

  it("issues a deterministic complete-dab-wave prefix receipt at 64-way symmetry", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: fullAlphaTip(),
      grain: { amount: 0.25 },
      tipLayers: [
        { tip: fullAlphaTip(), opacity: 1 },
        { tip: fullAlphaTip(), opacity: 0.5 },
      ],
      taper: { enabled: false },
    });
    const acceptedWaveCount = Math.floor(
      STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET / (64 * 3),
    );
    const atBudget = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: acceptedWaveCount,
      symmetryCount: 64,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
    });
    const overBudget = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: acceptedWaveCount + 1,
      symmetryCount: 64,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
    });

    expect(atBudget).toMatchObject({
      maxDabsPerVariation: acceptedWaveCount,
      marksPerDab: 3,
      estimatedMarks: acceptedWaveCount * 64 * 3,
      dabCapped: false,
    });
    expect(atBudget.acceptedPrefixReceipt).toBeUndefined();
    expect(overBudget).toMatchObject({
      maxDabsPerVariation: acceptedWaveCount,
      estimatedMarks: acceptedWaveCount * 64 * 3,
      dabCapped: true,
      acceptedPrefixReceipt: {
        kind: "studio-dynamic-brush-accepted-prefix-receipt",
        version: 1,
        policy: "accepted-prefix-v1",
        requestedDabsPerVariation: acceptedWaveCount + 1,
        acceptedDabsPerVariation: acceptedWaveCount,
        rejectedDabsPerVariation: 1,
        marksPerDab: 3,
        symmetryCount: 64,
        markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
        acceptedMarkBudget: acceptedWaveCount * 64 * 3,
      },
    });
    expect(overBudget.estimatedMarks).toBeLessThanOrEqual(
      STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
    );
  });

  it("retains 1,500 causal solid-tip dabs inside the shared live/retained/SVG ceiling", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      tipLayers: [],
      dualBrush: { enabled: false },
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: 1_500,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
    });

    expect(plan).toMatchObject({
      stampGrid: STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID,
      maxDabsPerVariation: 1_500,
      marksPerDab: 1,
      estimatedMarks: 1_500,
      dabCapped: false,
      capped: false,
    });
  });

  it("keeps v2 capped at 65,536 while v3 admits deterministic continuation work", () => {
    const base = {
      tip: { shape: "round" as const, softness: 0 },
      grain: { amount: 0 },
      tipLayers: [],
      dualBrush: { enabled: false },
      taper: { enabled: false },
    };
    const requestedDabs = STUDIO_DYNAMIC_BRUSH_CAUSAL_DAB_BUDGET + 769;
    const v2 = planStudioDynamicBrushRenderBudget({
      settings: normalizeStudioBrushDynamicsSettings({
        ...base,
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V2,
      }),
      dabCount: requestedDabs,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });
    const v3 = planStudioDynamicBrushRenderBudget({
      settings: normalizeStudioBrushDynamicsSettings({
        ...base,
        depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      }),
      dabCount: requestedDabs,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });

    expect(v2).toMatchObject({
      maxDabsPerVariation: STUDIO_DYNAMIC_BRUSH_CAUSAL_DAB_BUDGET,
      estimatedMarks: STUDIO_DYNAMIC_BRUSH_CAUSAL_DAB_BUDGET,
      estimatedUnbudgetedMarks: requestedDabs,
      dabCapped: true,
      acceptedPrefixReceipt: {
        requestedDabsPerVariation: requestedDabs,
        acceptedDabsPerVariation: STUDIO_DYNAMIC_BRUSH_CAUSAL_DAB_BUDGET,
        rejectedDabsPerVariation: 769,
      },
    });
    expect(v3).toMatchObject({
      maxDabsPerVariation: requestedDabs,
      estimatedMarks: requestedDabs,
      dabCapped: false,
    });
  });

  it("reports v3 work rejected above the sixteen-segment ceiling without admitting it", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      tipLayers: [],
      dualBrush: { enabled: false },
      taper: { enabled: false },
    });
    const rejectedDabs = 513;
    const requestedDabs =
      STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_DAB_BUDGET + rejectedDabs;
    const plan = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: requestedDabs,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });

    expect(plan).toMatchObject({
      maxDabsPerVariation:
        STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_DAB_BUDGET,
      estimatedMarks: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
      estimatedUnbudgetedMarks: requestedDabs,
      dabCapped: true,
      capped: true,
      acceptedPrefixReceipt: {
        requestedDabsPerVariation: requestedDabs,
        acceptedDabsPerVariation:
          STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_DAB_BUDGET,
        rejectedDabsPerVariation: rejectedDabs,
        symmetryCount: 1,
        markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
        acceptedMarkBudget:
          STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
      },
    });
  });

  it("charges a post-plan material expansion before causal prefix admission", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      taper: { enabled: false },
    });
    const plan = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: 3,
      symmetryCount: 1,
      materialMarkMultiplier: 5,
      markBudget: 10,
    });

    expect(plan).toMatchObject({
      maxDabsPerVariation: 2,
      marksPerDab: 5,
      estimatedMarks: 10,
      estimatedUnbudgetedMarks: 15,
      dabCapped: true,
      acceptedPrefixReceipt: {
        requestedDabsPerVariation: 3,
        acceptedDabsPerVariation: 2,
        rejectedDabsPerVariation: 1,
        marksPerDab: 5,
        acceptedMarkBudget: 10,
      },
    });
  });

  it("combines the v3 version ceiling with a tighter symmetry mark ceiling in one receipt", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      tip: { shape: "round", softness: 0 },
      grain: { amount: 0 },
      tipLayers: [],
      dualBrush: { enabled: false },
      taper: { enabled: false },
    });
    const requestedDabs =
      STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_DAB_BUDGET + 257;
    const symmetryCount = 4;
    const acceptedDabs = Math.floor(
      STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET / symmetryCount,
    );
    const plan = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: requestedDabs,
      symmetryCount,
      markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
    });

    expect(plan).toMatchObject({
      maxDabsPerVariation: acceptedDabs,
      estimatedMarks:
        acceptedDabs * symmetryCount,
      estimatedUnbudgetedMarks:
        requestedDabs * symmetryCount,
      dabCapped: true,
      acceptedPrefixReceipt: {
        requestedDabsPerVariation: requestedDabs,
        acceptedDabsPerVariation: acceptedDabs,
        rejectedDabsPerVariation: requestedDabs - acceptedDabs,
        marksPerDab: 1,
        symmetryCount,
        markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET,
        acceptedMarkBudget:
          acceptedDabs * symmetryCount,
      },
    });
    expect(plan.maxDabsPerVariation).toBeLessThan(
      STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_DAB_BUDGET,
    );
  });

  it("preserves every ordinary solid-tip dab and the existing seven-sample quality", () => {
    const settings = normalizeStudioBrushDynamicsSettings({
      tip: { shape: "round" },
      grain: { amount: 0 },
    });
    const plan = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: 1_024,
      symmetryCount: 1,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });

    expect(plan).toMatchObject({
      stampGrid: 7,
      maxDabsPerVariation: 1_024,
      marksPerDab: 1,
      estimatedMarks: 1_024,
      dabCapped: false,
      stampGridReduced: false,
      capped: false,
    });
  });

  it("counts exact multi-tip samples and bounds both grid quality and live stations", () => {
    const settings = worstCaseSettings();
    expect(countStudioDynamicBrushMarksPerDab(settings, 7)).toBe(147);
    expect(countStudioDynamicBrushMarksPerDab(settings, 5)).toBe(75);
    expect(countStudioDynamicBrushMarksPerDab(settings, 3)).toBe(27);

    const plan = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: 100,
      symmetryCount: 2,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    });
    expect(plan).toMatchObject({
      stampGrid: 3,
      maxDabsPerVariation: 75,
      estimatedMarks: 4_050,
      dabCapped: true,
      stampGridReduced: true,
      capped: true,
    });
  });

  it("retains the legacy adaptive seven, five and three-sample quality ladder", () => {
    const settings = worstCaseSettings();
    const plan = (dabCount: number, symmetryCount = 1) =>
      planStudioDynamicBrushRenderBudget({
        settings,
        dabCount,
        symmetryCount,
        markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
      });

    expect(plan(20).stampGrid).toBe(7);
    expect(plan(32).stampGrid).toBe(5);
    expect(plan(100, 2).stampGrid).toBe(3);
  });

  it("bounds the 1024 x three-tip x 49-sample x 64-symmetry worst case deterministically", () => {
    const settings = worstCaseSettings();
    const input = {
      settings,
      dabCount: 1_024,
      symmetryCount: 64,
      markBudget: STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET,
    } as const;
    const first = planStudioDynamicBrushRenderBudget(input);
    const second = planStudioDynamicBrushRenderBudget(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      stampGrid: 3,
      maxDabsPerVariation: 2,
      marksPerDab: 27,
      estimatedMarks: 3_456,
      dabCapped: true,
      stampGridReduced: true,
      capped: true,
    });
    expect(first.estimatedMarks).toBeLessThanOrEqual(STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET);
    expect(first.estimatedUnbudgetedMarks).toBe(1_024 * 3 * 49 * 64);
  });

  it("redistributes a capped plan over the whole stroke and retains both source endpoints", () => {
    const settings = worstCaseSettings();
    const input = {
      points: [0, 0, 5_000, 0],
      pressures: [0.7, 0.7],
      baseWidth: 8,
      baseOpacity: 1,
      settings,
      seed: 918,
    } as const;
    const ordinaryDabs = planStudioDynamicBrushDabs({ ...input, maxDabs: 1_024 });
    const renderBudget = planStudioDynamicBrushRenderBudget({
      settings,
      dabCount: ordinaryDabs.length,
      symmetryCount: 64,
      markBudget: STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET,
    });
    const cappedDabs = planStudioDynamicBrushDabs({
      ...input,
      maxDabs: renderBudget.maxDabsPerVariation,
    });
    const replay = planStudioDynamicBrushDabs({
      ...input,
      maxDabs: renderBudget.maxDabsPerVariation,
    });

    expect(ordinaryDabs).toHaveLength(1_024);
    expect(renderBudget.maxDabsPerVariation).toBe(37);
    expect(cappedDabs).toHaveLength(37);
    expect(cappedDabs[0]?.sourceX).toBe(0);
    expect(cappedDabs.at(-1)?.sourceX).toBe(5_000);
    for (const [index, dab] of cappedDabs.entries()) {
      expect(dab.sourceX).toBeCloseTo(5_000 * index / 36, 10);
    }
    expect(replay).toEqual(cappedDabs);
  });
});

describe("causal stamp grid rule v2", () => {
  const v2 = STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2;

  function causalSettingsWithBaseWidth(baseWidth: number) {
    return normalizeStudioBrushDynamicsSettings({
      depositPipeline: STUDIO_DYNAMIC_BRUSH_DEPOSIT_PIPELINE_CAUSAL_V3,
      tip: fullAlphaTip(),
      grain: { amount: 0.25 },
      taper: { enabled: false },
      width: { base: baseWidth, mappings: [] },
    });
  }

  it("selects the width-adaptive grid from the authored base width", () => {
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: v2, baseWidth: 4 })).toBe(3);
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: v2, baseWidth: 23.9 })).toBe(3);
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: v2, baseWidth: 24 })).toBe(5);
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: v2, baseWidth: 63.9 })).toBe(5);
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: v2, baseWidth: 64 })).toBe(7);
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: v2, baseWidth: 300 })).toBe(7);
  });

  it("keeps every record without the exact rule pin on the legacy three-sample lattice", () => {
    expect(selectStudioDynamicBrushCausalStampGrid({ baseWidth: 300 }))
      .toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: undefined, baseWidth: 300 }))
      .toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: "causal-stamp-grid-v3", baseWidth: 300 }))
      .toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    expect(selectStudioDynamicBrushCausalStampGrid({ rule: 2, baseWidth: 300 }))
      .toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    // Normalization preserves the causalStampGridRule pin byte-for-byte and drops malformed
    // values closed, so a snapshot that never carried the pin resolves to no rule at all — the
    // byte-exact pin convention shared with depositPipeline/program pins.
    expect(studioDynamicBrushCausalStampGridRuleOf(causalSettingsWithBaseWidth(300)))
      .toBeUndefined();
  });

  it("clamps the pinned grid so grid-squared lattice work stays inside the live mark budget", () => {
    // grid² × tips × 32 stations × symmetry ≤ 4,096 ⇔ grid² ≤ 4,096 / (32 × symmetry × tips).
    const allowance = (symmetryCount: number, tipCount: number) => Math.floor(
      STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET
        / (STUDIO_DYNAMIC_BRUSH_MIN_DABS_PER_VARIATION * symmetryCount * tipCount),
    );
    expect(allowance(1, 1)).toBe(128);
    expect(allowance(3, 1)).toBe(42);
    expect(allowance(6, 1)).toBe(21);

    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: v2, baseWidth: 300, symmetryCount: 2,
    })).toBe(7);
    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: v2, baseWidth: 300, symmetryCount: 3,
    })).toBe(5);
    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: v2, baseWidth: 300, symmetryCount: 6,
    })).toBe(3);
    // Two enabled extra tip layers triple the worst-case lattice work per dab.
    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: v2, baseWidth: 300, activeTipLayerCount: 2,
    })).toBe(5);
    // The clamp never drops below the legacy lattice even when the maths cannot fit grid 3.
    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: v2, baseWidth: 300, symmetryCount: 64,
    })).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
  });

  it("plans legacy causal snapshots on grid 3 and pinned rule-v2 snapshots on the width grid", () => {
    const legacySettings = causalSettingsWithBaseWidth(100);
    const pinnedSettings = {
      ...legacySettings,
      causalStampGridRule: v2,
    };
    const planFor = (settings: typeof legacySettings) =>
      planStudioDynamicBrushRenderBudget({
        settings,
        dabCount: 1_024,
        symmetryCount: 1,
        markBudget: STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET,
      });
    const legacy = planFor(legacySettings);
    const pinned = planFor(pinnedSettings);

    expect(legacy.stampGrid).toBe(STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID);
    expect(pinned.stampGrid).toBe(7);
    // Causal textures stay one affine command per tip, so the denser lattice never changes the
    // admitted dab prefix — only how sampled-tip consumers lattice each accepted dab.
    expect({ ...pinned, stampGrid: legacy.stampGrid }).toEqual(legacy);
  });

  it("replays the same stroke to the same pinned grid across live and committed budgets", () => {
    const pinnedSettings = {
      ...causalSettingsWithBaseWidth(48),
      causalStampGridRule: v2,
    };
    const planFor = (markBudget: number) =>
      planStudioDynamicBrushRenderBudget({
        settings: pinnedSettings,
        dabCount: 500,
        symmetryCount: 2,
        markBudget,
      });
    const live = planFor(STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET);
    const committed = planFor(STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET);
    const replayed = planFor(STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET);

    // The clamp deliberately uses the fixed live constant, so live append and committed/export
    // replay of one stroke can never lattice its accepted dabs differently.
    expect(live.stampGrid).toBe(5);
    expect(committed.stampGrid).toBe(5);
    expect(replayed).toEqual(committed);
    expect(selectStudioDynamicBrushCausalStampGrid({
      rule: studioDynamicBrushCausalStampGridRuleOf(pinnedSettings),
      baseWidth: pinnedSettings.width.base,
      symmetryCount: 2,
      activeTipLayerCount: 0,
    })).toBe(committed.stampGrid);
  });
});
