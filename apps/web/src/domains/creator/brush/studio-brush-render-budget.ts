/**
 * Shared deterministic work planner for the dynamic-brush Canvas and SVG renderers.
 *
 * One render mark is one solid ellipse or one alpha-tip sample (`arc` + `fill`). The planner uses
 * the exact normalized tip maps and accounts for every symmetry copy. Ordinary strokes retain the
 * existing seven-sample grid and every planned dab; only work proven to exceed the selected budget
 * is degraded.
 */

import {
  isStudioDynamicBrushCausalDepositPipeline,
  studioDynamicBrushDepositPipelineUsesContinuation,
  type NormalizedStudioBrushDynamicsSettings,
} from "./studio-brush-dynamics";
import {
  composeStudioBrushDualTipAlphaMap,
  studioBrushDualTipUsesSolidEllipse,
} from "./studio-brush-tip-composition";
import {
  countStudioBrushTipStampSamples,
  type NormalizedStudioBrushTipSettings,
} from "./studio-brush-tip-stamp";

export const STUDIO_DYNAMIC_BRUSH_RENDER_STAMP_GRIDS = [7, 5, 3] as const;
export type StudioDynamicBrushRenderStampGrid =
  (typeof STUDIO_DYNAMIC_BRUSH_RENDER_STAMP_GRIDS)[number];
/**
 * Causal deposits accept marks append-only, so they cannot switch from a dense pointer-down lattice to a
 * sparse long-stroke lattice without clearing already-visible paint. Causal snapshots without a
 * `causalStampGridRule` pin — every persisted pre-rule stroke — use this one bounded lattice across
 * live, retained and export consumers. Legacy snapshots keep adaptive 7/5/3 planning below;
 * rule-v2 snapshots select a width-adaptive lattice ONCE at stroke start
 * (`selectStudioDynamicBrushCausalStampGrid`) and pin it for the whole stroke.
 */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID = 3 as const;

/**
 * Versioned causal stamp-grid selection rule (v2): size-adaptive, pinned per stroke.
 *
 * The fixed three-sample lattice reads as visible sparsity on large dry-media nibs (charcoal,
 * crayon), while re-latticing mid-stroke would clear already-accepted causal paint. Rule v2 keeps
 * append-only determinism by selecting the grid from the authored base width exactly once at
 * stroke start; the selection never changes while the stroke grows, so live append, pointer-up
 * replay, retained rendering and SVG export all lattice the same accepted dabs identically.
 *
 * The pin follows the `depositPipeline`/`dryMediaKernelProgram` convention: it is minted only by
 * fresh authoring, preserved byte-for-byte by dynamics normalization and never injected, so every
 * persisted record without the exact pin keeps the historical fixed grid 3 and renders exactly as
 * before.
 */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2 =
  "causal-stamp-grid-v2" as const;
export type StudioDynamicBrushCausalStampGridRule =
  typeof STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2;

export function isStudioDynamicBrushCausalStampGridRule(
  value: unknown,
): value is StudioDynamicBrushCausalStampGridRule {
  return value === STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_RULE_V2;
}

/**
 * Rule-v2 width steps, densest first. Below the smallest step the legacy grid 3 is kept.
 *
 * The renderer's stamp lattice is odd-centred (`normalizedStudioBrushTipStampGrid` bumps even
 * grids so one sample sits on the tip centre) and the plan type only admits 7/5/3, so the steps
 * quantize the nominal small/medium/large nib bands onto the existing odd ladder: nibs under 24px
 * keep 3, 24-64px take 5, and wider nibs take 7.
 */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_V2_WIDTH_STEPS = [
  { minBaseWidth: 64, grid: 7 },
  { minBaseWidth: 24, grid: 5 },
] as const satisfies readonly Readonly<{
  minBaseWidth: number;
  grid: StudioDynamicBrushRenderStampGrid;
}>[];

export interface StudioDynamicBrushCausalStampGridSelectionInput {
  /** Version pin carried by the stroke's dynamics snapshot; anything unrecognized is legacy. */
  rule?: unknown;
  /** Authored stroke base width in CSS px, pinned at stroke start. */
  baseWidth: number;
  /** Symmetry copies rendered per dab; pinned per stroke like the width. */
  symmetryCount?: number;
  /** Enabled extra tip layers — each adds one more worst-case lattice per dab. */
  activeTipLayerCount?: number;
}

/**
 * Selects the causal stamp grid for one stroke. Pure and pinned: every input is fixed at stroke
 * start (rule pin, authored base width, symmetry, tip layers), so replaying the same stroke —
 * live append, pointer-up, retained, SVG, CRDT — always selects the same grid.
 *
 * Budget clamp math: a sampled alpha tip expands one dab into at most `grid²` marks per tip per
 * symmetry copy against the live pointer budget (`STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET` = 4,096).
 * Because a causal grid can never be lowered mid-stroke, a long stroke must still afford at least
 * `STUDIO_DYNAMIC_BRUSH_MIN_DABS_PER_VARIATION` (32) whole-path stations per variation at the
 * pinned grid. So a step's grid is admitted only while
 *
 *   grid² × tipCount × 32 × symmetryCount ≤ 4,096  ⇔  grid² ≤ 4,096 / (32 × symmetry × tips)
 *
 * e.g. symmetry 1 allows grid² ≤ 128 (7 fits), symmetry 3 allows ≤ 42 (7 → clamp to 5), symmetry 6
 * allows ≤ 21 (5 → clamp to 3). The clamp deliberately uses the fixed LIVE constant rather than
 * the caller's mark budget: live (4,096) and committed/export (65,536) plan the same stroke, and a
 * budget-dependent grid would make one persisted stroke lattice differently per consumer.
 */
export function selectStudioDynamicBrushCausalStampGrid(
  input: StudioDynamicBrushCausalStampGridSelectionInput,
): StudioDynamicBrushRenderStampGrid {
  if (!isStudioDynamicBrushCausalStampGridRule(input.rule)) {
    return STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID;
  }
  const baseWidth = Number.isFinite(input.baseWidth) ? input.baseWidth : 0;
  const symmetryCount = finiteInteger(input.symmetryCount ?? 1, 1, 1, 64);
  const tipCount = 1 + finiteInteger(input.activeTipLayerCount ?? 0, 0, 0, 64);
  const worstCaseMarkAllowancePerDab = Math.floor(
    STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET
      / (
        STUDIO_DYNAMIC_BRUSH_MIN_DABS_PER_VARIATION
        * symmetryCount
        * tipCount
      ),
  );
  for (const step of STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID_V2_WIDTH_STEPS) {
    if (baseWidth < step.minBaseWidth) continue;
    if (step.grid * step.grid <= worstCaseMarkAllowancePerDab) return step.grid;
  }
  return STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID;
}

/**
 * Reads the versioned causal stamp-grid rule pin from a dynamics snapshot.
 *
 * Read defensively so records minted before the pin existed (and normalizers that strip unknown
 * fields) resolve to legacy grid 3 without any schema coupling; only the exact rule string
 * carried by a freshly minted snapshot enables the v2 selection.
 */
export function studioDynamicBrushCausalStampGridRuleOf(
  settings: NormalizedStudioBrushDynamicsSettings,
): StudioDynamicBrushCausalStampGridRule | undefined {
  const rule = (
    settings as { causalStampGridRule?: unknown }
  ).causalStampGridRule;
  return isStudioDynamicBrushCausalStampGridRule(rule) ? rule : undefined;
}

/**
 * Keeps live pointer frames below roughly 4k Canvas arc/fill marks.
 *
 * The previous 16k ceiling let complex alpha tips consume most of a 60Hz frame by themselves on
 * desktop and several frames on mobile. This budget affects only the replaceable pointer-down
 * preview; the committed document and SVG keep the 65k fidelity ceiling below.
 */
export const STUDIO_DYNAMIC_BRUSH_LIVE_MARK_BUDGET = 4_096;
/** Retained Canvas and SVG use the same higher-fidelity deterministic ceiling. */
export const STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET = 65_536;
/** Shared causal deposit ceiling; solid one-mark nibs may use the complete range. */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_DAB_BUDGET = 65_536;
/** Number of independently bounded causal work segments admitted by the V3 persistence contract. */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_SEGMENTS = 16;
/** Complete logical-stroke dab ceiling for the V3 segmented causal contract. */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_DAB_BUDGET =
  STUDIO_DYNAMIC_BRUSH_CAUSAL_DAB_BUDGET
  * STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_SEGMENTS;
/**
 * Causal strokes retain one material plan across live append, pointer-up replay and SVG export.
 * Live append normally plans only the unseen suffix, so sharing the committed ceiling protects
 * long textured strokes without making every pointer frame replay 65k marks.
 */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET =
  STUDIO_DYNAMIC_BRUSH_COMMITTED_MARK_BUDGET;
/** Complete logical-stroke mark ceiling; each segment retains the historical 65,536 mark bound. */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_MARK_BUDGET =
  STUDIO_DYNAMIC_BRUSH_CAUSAL_MARK_BUDGET
  * STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_SEGMENTS;
/** Prefer at least this many full-path stations before retaining a denser alpha-tip grid. */
export const STUDIO_DYNAMIC_BRUSH_MIN_DABS_PER_VARIATION = 32;
/**
 * Causal overflow is deliberately a prefix receipt, not a whole-stroke redistribution.
 *
 * Once a live dab is visible it is immutable. Redistributing old dabs when a later pointer sample
 * crosses the work ceiling would make the accepted live prefix jump and would no longer match
 * replay. Versioning the policy also gives future chunked/WebGPU implementations a migration point
 * without silently changing persisted causal-v2 pixels.
 */
export const STUDIO_DYNAMIC_BRUSH_CAUSAL_OVERFLOW_POLICY =
  "accepted-prefix-v1" as const;

export interface StudioDynamicBrushAcceptedPrefixReceipt {
  readonly kind: "studio-dynamic-brush-accepted-prefix-receipt";
  readonly version: 1;
  readonly policy: typeof STUDIO_DYNAMIC_BRUSH_CAUSAL_OVERFLOW_POLICY;
  readonly requestedDabsPerVariation: number;
  readonly acceptedDabsPerVariation: number;
  readonly rejectedDabsPerVariation: number;
  readonly marksPerDab: number;
  /** Fixed non-dab marks reserved once for every non-empty symmetry variation. */
  readonly fixedMarksPerVariation: number;
  readonly symmetryCount: number;
  readonly markBudget: number;
  readonly acceptedMarkBudget: number;
}

export interface StudioDynamicBrushRenderBudgetInput {
  settings: NormalizedStudioBrushDynamicsSettings;
  /**
   * Requested base-dab count from the selected legacy or causal deposit plan.
   *
   * Causal callers may pass the authored count before the versioned deposit ceiling is applied.
   * The planner never admits work beyond that ceiling, but retains this count in its overflow
   * receipt so an upstream v2/v3 rejection cannot be mistaken for a complete render.
   */
  dabCount: number;
  /** Number of Canvas/SVG symmetry copies that will be rendered. */
  symmetryCount: number;
  /**
   * Deterministic non-dab marks emitted once for every non-empty variation.
   *
   * This is intentionally separate from `marksPerDab`: origin/end-cap material contracts must
   * not halve a long stroke's affordable dab count merely because one extra mark is required.
   */
  fixedMarksPerVariation?: number;
  /**
   * Renderer-neutral material expansion performed after source-dab planning.
   *
   * An anisotropic dry-media bridge, for example, lowers one pastel dab to five physical fibres.
   * Supplying that exact multiplier makes causal prefix admission account for the real commands
   * before the bridge allocates them. Ordinary brushes omit it and retain the historical value 1.
   */
  materialMarkMultiplier?: number;
  markBudget: number;
}

export interface StudioDynamicBrushRenderBudgetPlan {
  stampGrid: StudioDynamicBrushRenderStampGrid;
  maxDabsPerVariation: number;
  marksPerDab: number;
  fixedMarksPerVariation: number;
  symmetryCount: number;
  estimatedMarks: number;
  estimatedUnbudgetedMarks: number;
  dabCapped: boolean;
  stampGridReduced: boolean;
  capped: boolean;
  /**
   * Present only when a causal stroke exceeded the shared mark ceiling. Consumers must render this
   * exact prefix instead of rejecting the complete stroke or redistributing already-visible dabs.
   */
  acceptedPrefixReceipt?: StudioDynamicBrushAcceptedPrefixReceipt;
}

interface GridWorkPlan {
  grid: StudioDynamicBrushRenderStampGrid;
  marksPerDab: number;
  maxDabs: number;
  estimatedMarks: number;
}

function finiteInteger(value: number, fallback: number, min: number, max: number): number {
  return Math.trunc(Math.min(max, Math.max(
    min,
    Number.isFinite(value) ? value : fallback
  )));
}

function studioBrushTipMarkCount(
  tip: NormalizedStudioBrushTipSettings,
  grainActive: boolean,
  grid: StudioDynamicBrushRenderStampGrid,
  dualBrush?: unknown
): number {
  // 듀얼 브러시(1차 팁 전용)가 활성이면 합성 맵 기준으로 샘플 수를 센다 — 비활성 시 기존과 동일.
  if (!grainActive && studioBrushDualTipUsesSolidEllipse(tip, dualBrush)) return 1;
  const alphaMap = composeStudioBrushDualTipAlphaMap(tip, dualBrush);
  return countStudioBrushTipStampSamples(tip, { alphaMap, grid });
}

/** Exact per-dab mark count for one normalized multi-tip brush at the requested stamp grid. */
export function countStudioDynamicBrushMarksPerDab(
  settings: NormalizedStudioBrushDynamicsSettings,
  grid: StudioDynamicBrushRenderStampGrid
): number {
  if (
    isStudioDynamicBrushCausalDepositPipeline(settings.depositPipeline)
  ) {
    // Causal pipelines carry each solid, analytic or full alpha-map tip as one affine command. The
    // dual tip is precomposed into the primary map; each enabled extra layer contributes one more.
    // `grid` remains serialized for legacy replay but does not reduce a causal texture to circles.
    return 1 + settings.tipLayers.filter((layer) => layer.opacity > 0).length;
  }
  const grainActive = settings.grain.amount > 0;
  let marks = studioBrushTipMarkCount(settings.tip, grainActive, grid, settings.dualBrush);
  for (const layer of settings.tipLayers) {
    if (layer.opacity <= 0) continue;
    marks += studioBrushTipMarkCount(layer.tip, grainActive, grid);
  }
  return Math.max(1, marks);
}

function gridWorkPlans(
  settings: NormalizedStudioBrushDynamicsSettings,
  dabCount: number,
  symmetryCount: number,
  fixedMarksPerVariation: number,
  materialMarkMultiplier: number,
  markBudget: number,
  stampGrids: readonly StudioDynamicBrushRenderStampGrid[],
  allowEmptyAcceptedPrefix: boolean,
): GridWorkPlan[] {
  return stampGrids.map((grid) => {
    const marksPerDab =
      countStudioDynamicBrushMarksPerDab(settings, grid)
      * materialMarkMultiplier;
    const marksPerSymmetricDab = symmetryCount * marksPerDab;
    const fixedMarks = dabCount > 0
      ? symmetryCount * fixedMarksPerVariation
      : 0;
    const affordableDabs = Math.floor(
      Math.max(0, markBudget - fixedMarks) / marksPerSymmetricDab,
    );
    const maxDabs = dabCount === 0
      ? 0
      : Math.max(
          allowEmptyAcceptedPrefix ? 0 : 1,
          Math.min(dabCount, affordableDabs),
        );
    return {
      grid,
      marksPerDab,
      maxDabs,
      estimatedMarks:
        maxDabs * marksPerSymmetricDab
        + (maxDabs > 0 ? fixedMarks : 0),
    };
  });
}

/**
 * Selects the least destructive render plan:
 *
 * 1. keep every dab with the highest grid that fits;
 * 2. otherwise keep the seven/five grid if it still covers a useful number of whole-path dabs;
 * 3. on pathological combinations, use the three grid and a uniformly redistributed dab cap.
 */
export function planStudioDynamicBrushRenderBudget(
  input: StudioDynamicBrushRenderBudgetInput
): StudioDynamicBrushRenderBudgetPlan {
  const causal = isStudioDynamicBrushCausalDepositPipeline(
    input.settings.depositPipeline,
  );
  const causalDabCeiling = studioDynamicBrushDepositPipelineUsesContinuation(
    input.settings.depositPipeline,
  )
    ? STUDIO_DYNAMIC_BRUSH_CAUSAL_CONTINUATION_DAB_BUDGET
    : STUDIO_DYNAMIC_BRUSH_CAUSAL_DAB_BUDGET;
  const requestedDabCount = finiteInteger(
    input.dabCount,
    0,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const admittedDabCount = Math.min(
    requestedDabCount,
    causal
      ? causalDabCeiling
      : 4_096,
  );
  const symmetryCount = finiteInteger(input.symmetryCount, 1, 1, 64);
  const fixedMarksPerVariation = finiteInteger(
    input.fixedMarksPerVariation ?? 0,
    0,
    0,
    64,
  );
  const materialMarkMultiplier = finiteInteger(
    input.materialMarkMultiplier ?? 1,
    1,
    1,
    64,
  );
  const markBudget = finiteInteger(input.markBudget, 1, 1, 100_000_000);
  // The causal lattice is versioned and pinned per stroke: legacy snapshots (no rule pin) keep the
  // fixed grid 3, rule-v2 snapshots select once from the authored base width. Every consumer —
  // live overlay, retained plan, SVG export — resolves through this same pure selection, so the
  // grid cannot diverge between planners for one persisted stroke.
  const causalStampGrid = causal
    ? selectStudioDynamicBrushCausalStampGrid({
        rule: studioDynamicBrushCausalStampGridRuleOf(input.settings),
        baseWidth: input.settings.width.base,
        symmetryCount,
        activeTipLayerCount: input.settings.tipLayers.filter(
          (layer) => layer.opacity > 0,
        ).length,
      })
    : STUDIO_DYNAMIC_BRUSH_CAUSAL_STAMP_GRID;
  const candidates = gridWorkPlans(
    input.settings,
    admittedDabCount,
    symmetryCount,
    fixedMarksPerVariation,
    materialMarkMultiplier,
    markBudget,
    causal
      ? [causalStampGrid]
      : STUDIO_DYNAMIC_BRUSH_RENDER_STAMP_GRIDS,
    causal,
  );
  const fullDabPlan = candidates.find(
    (candidate) => candidate.maxDabs >= admittedDabCount,
  );
  const minimumUsefulDabs = Math.min(
    admittedDabCount,
    STUDIO_DYNAMIC_BRUSH_MIN_DABS_PER_VARIATION,
  );
  const selected = fullDabPlan
    ?? candidates.find((candidate) => candidate.maxDabs >= minimumUsefulDabs)
    ?? candidates.at(-1)!;
  const defaultPlan = candidates[0]!;
  // Legacy/non-causal planning retains its historical 4,096 normalization semantics. Causal
  // receipts, however, compare against the original authored request so both the version ceiling
  // and a tighter symmetry/mark ceiling remain observable without admitting extra work.
  const receiptRequestedDabCount = causal
    ? requestedDabCount
    : admittedDabCount;
  const dabCapped = selected.maxDabs < receiptRequestedDabCount;
  const stampGridReduced = causal
    ? false
    : selected.grid !== STUDIO_DYNAMIC_BRUSH_RENDER_STAMP_GRIDS[0];
  const acceptedPrefixReceipt = causal && dabCapped
    ? {
        kind: "studio-dynamic-brush-accepted-prefix-receipt" as const,
        version: 1 as const,
        policy: STUDIO_DYNAMIC_BRUSH_CAUSAL_OVERFLOW_POLICY,
        requestedDabsPerVariation: receiptRequestedDabCount,
        acceptedDabsPerVariation: selected.maxDabs,
        rejectedDabsPerVariation:
          receiptRequestedDabCount - selected.maxDabs,
        marksPerDab: selected.marksPerDab,
        fixedMarksPerVariation,
        symmetryCount,
        markBudget,
        acceptedMarkBudget: selected.estimatedMarks,
      }
    : undefined;

  return {
    stampGrid: selected.grid,
    maxDabsPerVariation: selected.maxDabs,
    marksPerDab: selected.marksPerDab,
    fixedMarksPerVariation,
    symmetryCount,
    estimatedMarks: selected.estimatedMarks,
    estimatedUnbudgetedMarks:
      receiptRequestedDabCount * symmetryCount * defaultPlan.marksPerDab
      + (
        receiptRequestedDabCount > 0
          ? symmetryCount * fixedMarksPerVariation
          : 0
      ),
    dabCapped,
    stampGridReduced,
    capped: dabCapped || stampGridReduced,
    ...(acceptedPrefixReceipt ? { acceptedPrefixReceipt } : {}),
  };
}
