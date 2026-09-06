import { HybridExecutionPlanner } from "./planner";

import type { ProviderDescriptor, ProviderRuntime } from "./descriptor";
import type { IslandRequest, PlanMode, SurfacePlan, SurfacePlanRequest } from "./planner";
import type { EngineCapabilityRegistry } from "./registry";
import type { RenderWorkloadFingerprint } from "./workload-fingerprint";

/**
 * Cost-model provider selection — SHADOW ONLY (V13 §2.5, GPU planning).
 *
 * HybridExecutionPlanner's chooseProvider ranks candidates by accelerator
 * class and otherwise by registration order, so among same-runtime providers
 * the first-registered one wins regardless of workload fit. This module runs
 * a WorkloadFingerprint-driven cost ranking NEXT TO the legacy selection and
 * emits a receipt; the legacy winner remains the only routing authority.
 * Promotion of the cost ranking requires the disagreement receipts collected
 * here as evidence — same observation-only pattern as
 * studio-surface-plan-shadow / studio-filter-plan-shadow.
 *
 * Fail-closed invariants:
 * - PlanUnsatisfiableError from the legacy planner propagates unchanged; the
 *   shadow never rescues a plan the authority rejects.
 * - A missing or unusable fingerprint yields `fingerprint: "absent"`, no cost
 *   ranking and no disagreement evidence; the legacy winner stands.
 * - Exact-total ties defer to the legacy winner, so a disagreement is only
 *   recorded on strictly cheaper evidence.
 * - Capability filtering happens BEFORE costing (the shadow ranks exactly the
 *   candidates the legacy query admitted), so cost can never trade away a
 *   required capability — quality is never sacrificed for a cheaper lane.
 *
 * Calibration honesty: evidence is only worth collecting if the model can be
 * wrong. The coefficients below are anchored to this repo's measurements and
 * carry a provenance class each (COST_MODEL_REFERENCE /
 * COST_MODEL_PROVENANCE), and the model has the same fixed-plus-slope shape
 * as the product's measured filter-lane model, so small islands really do
 * rank cpu first and large ones really do rank shared-device gpu first.
 */

/**
 * The fingerprint fields the cost model consumes — the subset of the V13 §7.2
 * RenderWorkloadFingerprint that planner call sites can actually populate
 * today. A full RenderWorkloadFingerprint is assignable as-is.
 */
export type CostShadowFingerprint = Pick<
  RenderWorkloadFingerprint,
  | "pathCount"
  | "segmentCount"
  | "changedPathRatio"
  | "imageCount"
  | "glyphCount"
  | "gradientCount"
  | "isolatedLayerCount"
  | "maskDepth"
  | "filterNodeCount"
  | "visibleAreaRatio"
  | "dpr"
>;

export const COST_SHADOW_FINGERPRINT_FIELDS = [
  "pathCount",
  "segmentCount",
  "changedPathRatio",
  "imageCount",
  "glyphCount",
  "gradientCount",
  "isolatedLayerCount",
  "maskDepth",
  "filterNodeCount",
  "visibleAreaRatio",
  "dpr",
] as const satisfies readonly (keyof CostShadowFingerprint)[];

/**
 * Execution lane a descriptor's runtime maps onto. A RegisteredProvider does
 * not carry a full ProviderExecutionContract today, so the lane is derived
 * from `descriptor.runtime` mirroring the checked-in V13 execution contracts
 * (feature-contract.ts):
 *
 * - `webgpu` ⇒ accelerator webgpu, shared-device interop, gpu-texture output
 *   (VELLO_CLASSIC_EXECUTION / VELLO_HYBRID_EXECUTION) — composited in place,
 *   zero per-present transfer.
 * - `webgl` ⇒ accelerator webgl, external-image interop, image-bitmap output
 *   (SKIA_GPU_EXECUTION) — one encode/decode hop per present.
 * - `js` / `wasm` / `wasm-worker` / `native-bridge` ⇒ accelerator cpu, no
 *   device interop, pixels output (SKIA_CPU_REFERENCE_EXECUTION) — full
 *   readback + upload per present.
 */
export type CostLane = "webgpu" | "webgl" | "cpu";

export function costLaneForRuntime(runtime: ProviderRuntime): CostLane {
  if (runtime === "webgpu") return "webgpu";
  if (runtime === "webgl") return "webgl";
  return "cpu";
}

/**
 * Where the numbers below come from. The shadow used to carry abstract
 * "µ-units" whose only claim was relative order; that claim was wrong in the
 * one direction that matters — it made the webgpu lane strictly cheaper than
 * every cpu lane for every *filter* fingerprint, because the layering term
 * was a flat per-node constant with no area scaling. The product's measured
 * filter-lane model says the opposite below its crossover.
 *
 * So every coefficient is now expressed in **milliseconds on the reference
 * host** and carries a provenance class (see {@link COST_MODEL_PROVENANCE}).
 * The shape deliberately mirrors the measured model
 * (`apps/web/src/domains/creator/filter/studio-filter-lane-cost-model.ts`):
 *
 *     cost(MP) = fixedMs + perMegapixelMs × megapixels
 *
 * — a per-island fixed floor the gpu lanes must amortize, plus an area slope
 * the cpu lanes lose on. That is what produces a real crossover instead of a
 * constant verdict. This module does NOT reuse the product model: the shadow
 * ranks arbitrary ProviderDescriptors from a WorkloadFingerprint, so it needs
 * descriptor-derived generality. Only the *shape* and the measured constants
 * are borrowed, and each borrow is cited.
 */
export const COST_MODEL_REFERENCE = {
  /** Milliseconds on the reference host; only ratios travel between devices. */
  unit: "milliseconds",
  host: "Apple M2 Max (darwin/arm64, 12 cores, 32GB, node v24.16.0)",
  sources: {
    /**
     * Filter lane ladder: gpu submit/readback floor, gpu pure-compute slope,
     * cpu per-pass slope. Same file the product cost model is seeded from.
     */
    filterLanes: "tests/benchmarks/results/filter-lanes.json",
    /**
     * vello GPU (browser WebGPU) vs vello_cpu in the same wasm build, 512²,
     * 5000 vs 15000 paths — the only in-repo GPU-vs-CPU *vector geometry*
     * measurement. `gpuBrowser.scenes` in that file.
     */
    largeScene: "tests/benchmarks/results/large-scene.json",
  },
  /**
   * The area factor `visibleAreaRatio × max(1, dpr)²` is read as megapixels
   * against a 1 MP reference surface (1000² device px; the benchmark ladder's
   * 1024² cell is 1.05 MP, within 5%). Call sites that know their real pixel
   * count encode it directly — studio-filter-island-plan derives
   * `dpr = √megapixels, visibleAreaRatio = 1` so the factor *is* the island's
   * megapixels.
   */
  referenceSurfaceMegapixels: 1,
} as const;

/**
 * Provenance class per coefficient, so the promotion review can tell a
 * measured number from an ordering guess at a glance.
 *
 * - `measured`   — read off a benchmark result in this repo.
 * - `derived`    — a stated proportion of a measured number (the proportion
 *                  itself is an engineering assumption, written out).
 * - `ordinal`    — not measured anywhere in this repo. Magnitude is chosen to
 *                  sit *below* the measured terms so it can only ever order
 *                  lanes that the measured terms already tie.
 */
export type CostCoefficientProvenance = "measured" | "derived" | "ordinal";

export interface LaneCostCoefficients {
  /**
   * Area-independent per-island lane entry cost (ms). MEASURED for webgpu and
   * cpu: filter-lanes.json `crossover.costModelSeed` fits gpu-fused-apply at
   * fixedMs 2.446 / 2.597 / 2.172 (1/2/4 dispatches) ⇒ 2.4, and every cpu
   * lane at −1.45…+0.60 ms, i.e. noise around zero ⇒ 0. This single number is
   * the amortization term: it is what a small island cannot pay off.
   */
  readonly base: number;
  /** Per-path encode/coverage cost, per presented megapixel (ms/path/MP). */
  readonly perPath: number;
  /** Per-segment coverage cost, per presented megapixel (ms/segment/MP). */
  readonly perSegment: number;
  /** Per-image sample, per presented megapixel (ms/image/MP). */
  readonly perImage: number;
  /** Per-glyph shaping/atlas or glyph-path lowering (ms/glyph, area-free). */
  readonly perGlyph: number;
  /** Per-gradient ramp build (ms/gradient, area-free). */
  readonly perGradient: number;
  /**
   * Per isolated layer: one offscreen surface + one composite copy, per
   * presented megapixel (ms/layer/MP).
   */
  readonly perIsolatedLayer: number;
  /**
   * Per filter graph node: one full-surface filter pass, per presented
   * megapixel (ms/node/MP). This is the coefficient whose missing area term
   * made the old model always prefer webgpu on filter fingerprints.
   */
  readonly perFilterNode: number;
  /**
   * Per-present output transfer, per presented megapixel (ms/MP).
   * gpu-texture output composites in place (0), image-bitmap pays the full
   * measured round trip, pixels pays the upload half.
   */
  readonly outputPenaltyPerArea: number;
}

/**
 * All cost-model coefficients, in one place so the promotion review audits a
 * single table. Units: milliseconds on {@link COST_MODEL_REFERENCE}.host.
 * Provenance per key lives in {@link COST_MODEL_PROVENANCE}; the derivations
 * are spelled out here.
 *
 * ## base — the amortization term
 * webgpu 2.4 (MEASURED, filter-lanes gpu-fused-apply fixedMs ≈ 2.4),
 * cpu 0 (MEASURED, cpu intercepts are ±1.5 ms noise around zero),
 * webgl 3.0 (ORDINAL: the same submit floor plus an external-image import and
 * GL state restore per island; SKIA_GPU_EXECUTION has no in-repo benchmark).
 * large-scene's gpu intercept is higher (≈8 ms at 512²) but that figure also
 * carries the wasm scene-serde and first-frame pipeline creation, so it is
 * not a steady-state per-island floor; the shadow takes the lower, cleaner
 * measurement — which is also the conservative choice, since a smaller gpu
 * floor makes the shadow *less* eager to claim a cpu-favouring disagreement.
 *
 * ## perPath / perSegment — DERIVED from a MEASURED slope (large-scene.json)
 * 5000 paths @512² and 15000 paths @512², same wasm build:
 *   gpu 73.7 → 205.0 ms  ⇒ 0.01313 ms/path
 *   cpu 2471.7 → 7410.3 ms ⇒ 0.49386 ms/path
 * The harness canvas is 512² = 0.262 MP and path cost is coverage-dominated,
 * so both slopes are divided by that area: gpu 0.0501, cpu 1.8841 ms/path/MP.
 * The harness draws fixed 24-point strokes (`config.pointsPerStroke`), so
 * per-path and per-segment work cannot be separated by measurement; the model
 * splits the measured slope 1:5 (setup : segment work) across 23 segments per
 * path, which reproduces the measured slope exactly at that shape:
 *   cpu    0.314   + 23 × 0.0683  = 1.885 ms/path/MP  (measured 1.8841)
 *   webgpu 0.0083  + 23 × 0.00181 = 0.0499 ms/path/MP (measured 0.0501)
 * webgl is ORDINAL at 2× webgpu: it replays per-draw state instead of
 * tessellating in compute, and has no in-repo measurement.
 *
 * ## perImage — DERIVED
 * A source read is already inside a filter pass: fitting the measured cpu
 * chain (3.696 / 13.535 / 24.823 ms/MP at 1 / 3 / 6 steps) gives a per-chain
 * intercept of ≈ −0.53 ms/MP, i.e. no separate read cost. An island with
 * images but no filter passes must still pay the blit, so cpu is charged
 * 1.0 ms/MP — read+write memory traffic without the per-pixel math, ≈27% of
 * the measured 3.7 ms/MP pass rate. The gpu lanes are charged 0.02 ms/MP,
 * ≈¼ of the measured full-surface pure pass (0.076 ms/MP), for the bind and
 * sample alone.
 *
 * ## perIsolatedLayer — DERIVED
 * One offscreen surface plus one composite copy. cpu 1.0 ms/MP (same blit
 * rate as perImage, same derivation). gpu 0.08 ms/MP = one measured
 * full-surface pure pass (gpu-fused-pure-pass 0.076 ms/MP at 1 dispatch).
 *
 * ## perFilterNode — MEASURED
 * cpu 3.7 ms/MP/node: filter-lanes single-step fits worker 3.696,
 * direct 3.665, konva 3.953 — the same number the product seed uses.
 * webgpu 0.05 ms/MP/node: `perMegapixelMsPerDispatch` in the product seed,
 * cross-checked against gpu-fused-pure-pass (0.076 / 1, 0.154 / 2, 0.16 / 4
 * dispatches). webgl 0.08 ms/MP/node is DERIVED: no LUT fusion there, so each
 * node is charged a full measured pure pass instead of the fused add-on.
 *
 * ## outputPenaltyPerArea — MEASURED / DERIVED
 * The measured gpu round trip is `gpu-fused-apply` slope minus
 * `gpu-fused-pure-pass` slope = 1.779 − 0.076 ≈ 1.70 ms/MP (upload +
 * readback). webgl (image-bitmap output) pays that whole hop ⇒ 1.7 (DERIVED:
 * measured on the webgpu harness, applied to webgl by contract shape).
 * cpu (pixels output) pays the upload half only — it never reads back from a
 * device — ⇒ 0.85 (DERIVED: half of the measured round trip). webgpu keeps
 * its texture on the shared device (VELLO_*_EXECUTION gpu-texture output) and
 * pays 0.
 *
 * ## perGlyph / perGradient — ORDINAL
 * No in-repo GPU-vs-CPU text or gradient benchmark. Magnitudes are nominal
 * per-element costs (a cpu glyph shape+fill ≈ 4 µs, a cpu gradient ramp
 * ≈ 20 µs) and are capped — by test — under 1% of the measured cpu per-pass
 * rate (3.7 ms/MP), so a glyph or a gradient can never outweigh a
 * full-surface pass and can only order lanes the measured terms already tie.
 * webgpu is charged more per glyph than webgl because it lowers glyphs to
 * paths rather than sampling an atlas (VELLO_*_FEATURE_CONTRACTS
 * "glyph-path").
 */
export const COST_MODEL_COEFFICIENTS = {
  lane: {
    webgpu: {
      base: 2.4,
      perPath: 0.0083,
      perSegment: 0.00181,
      perImage: 0.02,
      perGlyph: 0.002,
      perGradient: 0.004,
      perIsolatedLayer: 0.08,
      perFilterNode: 0.05,
      outputPenaltyPerArea: 0,
    },
    webgl: {
      base: 3,
      perPath: 0.0166,
      perSegment: 0.00362,
      perImage: 0.02,
      perGlyph: 0.0015,
      perGradient: 0.006,
      perIsolatedLayer: 0.08,
      perFilterNode: 0.08,
      outputPenaltyPerArea: 1.7,
    },
    cpu: {
      base: 0,
      perPath: 0.314,
      perSegment: 0.0683,
      perImage: 1,
      perGlyph: 0.004,
      perGradient: 0.02,
      perIsolatedLayer: 1,
      perFilterNode: 3.7,
      outputPenaltyPerArea: 0.85,
    },
  },
  /**
   * Geometry floor under incremental repaint: re-encoding scales with
   * changedPathRatio, but scene-diff and cache upkeep never vanish, so the
   * geometry term never drops below 25% of a full repaint. ORDINAL — the
   * benchmarks all render full frames, so no incremental ratio was measured.
   */
  incrementalFloor: 0.25,
  /**
   * Each level of mask nesting multiplies the layering passes by +50% — a
   * mask at depth n re-composites everything beneath it. ORDINAL — no nested
   * mask benchmark exists in this repo.
   */
  maskDepthSurcharge: 0.5,
  /**
   * Residency pressure: 0.0001 ms per estimated MB. ORDINAL and deliberately
   * tiny — at the 512 MB descriptors this repo declares it contributes
   * 0.05 ms, ~50× under the measured webgpu submit floor, so it can only
   * reorder providers whose workload terms already land within 0.05 ms of
   * each other (in practice: identical-lane providers).
   */
  memoryPressurePerMb: 0.0001,
} as const satisfies {
  lane: Record<CostLane, LaneCostCoefficients>;
  incrementalFloor: number;
  maskDepthSurcharge: number;
  memoryPressurePerMb: number;
};

/**
 * Provenance for every coefficient key, keyed exactly like
 * {@link COST_MODEL_COEFFICIENTS}. Pinned by the test suite: a new coefficient
 * without a provenance entry fails CI, so an undocumented number cannot enter
 * the promotion evidence.
 */
export const COST_MODEL_PROVENANCE = {
  lane: {
    webgpu: {
      base: "measured", // filter-lanes gpu-fused-apply fixedMs ≈ 2.4
      perPath: "derived", // measured slope, split 1:5 across 23 segments/path
      perSegment: "derived", // same split
      perImage: "derived", // ¼ of the measured full-surface pure pass
      perGlyph: "ordinal",
      perGradient: "ordinal",
      perIsolatedLayer: "measured", // gpu-fused-pure-pass 0.076 ms/MP
      perFilterNode: "measured", // perMegapixelMsPerDispatch 0.05
      outputPenaltyPerArea: "derived", // gpu-texture output composites in place
    },
    webgl: {
      base: "ordinal", // no SKIA_GPU_EXECUTION benchmark in this repo
      perPath: "ordinal", // 2x webgpu, unmeasured
      perSegment: "ordinal",
      perImage: "derived",
      perGlyph: "ordinal",
      perGradient: "ordinal",
      perIsolatedLayer: "measured",
      perFilterNode: "derived", // a full measured pure pass, no LUT fusion
      outputPenaltyPerArea: "derived", // measured round trip, applied by contract
    },
    cpu: {
      base: "measured", // filter-lanes cpu intercepts are noise around zero
      perPath: "derived", // measured slope, split 1:5 across 23 segments/path
      perSegment: "derived",
      perImage: "derived", // blit rate below the measured per-pass math rate
      perGlyph: "ordinal",
      perGradient: "ordinal",
      perIsolatedLayer: "derived", // same blit rate
      perFilterNode: "measured", // worker/direct/konva single-step ≈ 3.7 ms/MP
      outputPenaltyPerArea: "derived", // upload half of the measured round trip
    },
  },
  incrementalFloor: "ordinal",
  maskDepthSurcharge: "ordinal",
  memoryPressurePerMb: "ordinal",
} as const satisfies {
  lane: Record<CostLane, Record<keyof LaneCostCoefficients, CostCoefficientProvenance>>;
  incrementalFloor: CostCoefficientProvenance;
  maskDepthSurcharge: CostCoefficientProvenance;
  memoryPressurePerMb: CostCoefficientProvenance;
};

export interface ProviderCostBreakdown {
  readonly providerId: string;
  readonly lane: CostLane;
  readonly base: number;
  readonly geometry: number;
  readonly raster: number;
  readonly text: number;
  readonly gradients: number;
  readonly layering: number;
  readonly transfer: number;
  readonly memory: number;
  /** Sum of every component, in ms on {@link COST_MODEL_REFERENCE}.host. */
  readonly total: number;
  /** Presented megapixels the area-scaled terms were evaluated at. */
  readonly areaMegapixels: number;
  /**
   * Area-independent share of `total` (base + text + gradients + memory).
   * Together with {@link perMegapixelMs} this is the measured model's shape:
   * `total === fixedMs + perMegapixelMs × areaMegapixels`.
   */
  readonly fixedMs: number;
  /** Area slope of `total` — geometry + raster + layering + transfer per MP. */
  readonly perMegapixelMs: number;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Rejects fingerprints the cost model cannot trust: every consumed field must
 * be a finite, non-negative number. Anything else is treated exactly like a
 * missing fingerprint (fail closed).
 */
export function isUsableCostShadowFingerprint(
  fingerprint: CostShadowFingerprint | null | undefined,
): fingerprint is CostShadowFingerprint {
  if (fingerprint === null || fingerprint === undefined) return false;
  for (const field of COST_SHADOW_FINGERPRINT_FIELDS) {
    const value = fingerprint[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Presented megapixels for a fingerprint: the visible fraction of the surface
 * times dpr², read against {@link COST_MODEL_REFERENCE}.referenceSurfaceMegapixels.
 * dpr is floored at 1 — a sub-1 dpr never shrinks work below the logical
 * surface. Call sites that know their real pixel count encode it here (see
 * COST_MODEL_REFERENCE.referenceSurfaceMegapixels).
 */
export function presentedMegapixels(fingerprint: CostShadowFingerprint): number {
  return (
    clamp01(fingerprint.visibleAreaRatio)
    * Math.max(1, fingerprint.dpr) ** 2
    * COST_MODEL_REFERENCE.referenceSurfaceMegapixels
  );
}

/**
 * Pure per-provider cost estimate, in ms on {@link COST_MODEL_REFERENCE}.host.
 * Deterministic: same descriptor + same fingerprint always yields the same
 * breakdown.
 *
 * The result decomposes into the measured model's linear shape —
 * `total = fixedMs + perMegapixelMs × areaMegapixels` — because every
 * pixel-touching term (geometry coverage, image sampling, layer/filter passes,
 * output transfer) is charged per presented megapixel, while the lane entry
 * cost, glyph shaping, gradient ramp build and residency pressure are not.
 * That split is what gives the lanes a crossover instead of a fixed verdict:
 * a cpu lane starts near zero and loses on slope, a shared-device gpu lane
 * starts at its submit floor and wins once the area amortizes it.
 */
export function estimateProviderCost(
  descriptor: ProviderDescriptor,
  fingerprint: CostShadowFingerprint,
): ProviderCostBreakdown {
  const lane = costLaneForRuntime(descriptor.runtime);
  const c = COST_MODEL_COEFFICIENTS.lane[lane];
  const areaMegapixels = presentedMegapixels(fingerprint);
  const geometryScale =
    COST_MODEL_COEFFICIENTS.incrementalFloor
    + (1 - COST_MODEL_COEFFICIENTS.incrementalFloor) * clamp01(fingerprint.changedPathRatio);
  const base = c.base;
  const geometryPerMegapixel =
    (c.perPath * fingerprint.pathCount + c.perSegment * fingerprint.segmentCount) * geometryScale;
  const rasterPerMegapixel = c.perImage * fingerprint.imageCount;
  const layeringPerMegapixel =
    (c.perIsolatedLayer * fingerprint.isolatedLayerCount
      + c.perFilterNode * fingerprint.filterNodeCount)
    * (1 + COST_MODEL_COEFFICIENTS.maskDepthSurcharge * fingerprint.maskDepth);
  const text = c.perGlyph * fingerprint.glyphCount;
  const gradients = c.perGradient * fingerprint.gradientCount;
  const memory = descriptor.memoryEstimateMb * COST_MODEL_COEFFICIENTS.memoryPressurePerMb;
  const perMegapixelMs =
    geometryPerMegapixel + rasterPerMegapixel + layeringPerMegapixel + c.outputPenaltyPerArea;
  const fixedMs = base + text + gradients + memory;
  return {
    providerId: descriptor.id,
    lane,
    base,
    geometry: geometryPerMegapixel * areaMegapixels,
    raster: rasterPerMegapixel * areaMegapixels,
    text,
    gradients,
    layering: layeringPerMegapixel * areaMegapixels,
    transfer: c.outputPenaltyPerArea * areaMegapixels,
    memory,
    total: fixedMs + perMegapixelMs * areaMegapixels,
    areaMegapixels,
    fixedMs,
    perMegapixelMs,
  };
}

/**
 * Analytic lane crossover: the presented-megapixel size at which `b` becomes
 * as cheap as `a`, for the fingerprint shape both breakdowns were computed
 * from. Returns null when the lines never cross in the positive-area domain
 * (one lane is cheaper everywhere, or the two lanes are parallel).
 *
 * This is the documented threshold the promotion review reads: below it the
 * cheaper-at-zero lane wins, above it the flatter-slope lane does. It is a
 * pure function of the two breakdowns, so it can only ever agree with what
 * {@link estimateProviderCost} actually ranked.
 */
export function laneCrossoverMegapixels(
  a: ProviderCostBreakdown,
  b: ProviderCostBreakdown,
): number | null {
  const slopeGap = a.perMegapixelMs - b.perMegapixelMs;
  if (slopeGap === 0) return null;
  const crossover = (b.fixedMs - a.fixedMs) / slopeGap;
  if (!Number.isFinite(crossover) || crossover <= 0) return null;
  return crossover;
}

export interface CostShadowIslandRequest extends IslandRequest {
  /** Optional workload fingerprint; absent ⇒ no cost ranking (fail closed). */
  readonly fingerprint?: CostShadowFingerprint;
}

export interface CostShadowPlanRequest extends Omit<SurfacePlanRequest, "islands"> {
  readonly islands: CostShadowIslandRequest[];
}

export interface IslandCostShadowReceipt {
  readonly islandId: string;
  /** Provider the legacy planner chose — the only routing authority. */
  readonly legacyWinner: string;
  /** Cheapest provider by cost model, or null when no ranking ran. */
  readonly costWinner: string | null;
  /**
   * True unless the cost model produced strictly cheaper evidence for a
   * different provider. Absent fingerprints and exact ties are agreements.
   */
  readonly agreed: boolean;
  /** The fingerprint the ranking consumed, or "absent" when none was usable. */
  readonly fingerprint: CostShadowFingerprint | "absent";
  /** Every admitted candidate's breakdown, cheapest first (ties by id). */
  readonly costs: readonly ProviderCostBreakdown[];
}

export interface SurfaceCostShadowReceipt {
  readonly surfaceId: string;
  readonly mode: PlanMode;
  readonly islands: readonly IslandCostShadowReceipt[];
  /** True iff every island receipt agreed. */
  readonly agreed: boolean;
}

export interface CostShadowPlanResult {
  /** The legacy plan, byte-identical to HybridExecutionPlanner.plan(). */
  readonly plan: SurfacePlan;
  readonly receipt: SurfaceCostShadowReceipt;
}

function compareCosts(a: ProviderCostBreakdown, b: ProviderCostBreakdown): number {
  if (a.total !== b.total) return a.total - b.total;
  return a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0;
}

function pickCostWinner(
  costs: readonly ProviderCostBreakdown[],
  legacyWinner: string,
): string | null {
  const cheapest = costs[0];
  if (cheapest === undefined) return null;
  // Exact-total ties defer to the legacy winner: disagreement requires
  // strictly cheaper evidence (fail closed).
  const legacyTiesCheapest = costs.some(
    (cost) => cost.total === cheapest.total && cost.providerId === legacyWinner,
  );
  return legacyTiesCheapest ? legacyWinner : cheapest.providerId;
}

function normalizeFingerprint(fingerprint: CostShadowFingerprint): CostShadowFingerprint {
  return {
    pathCount: fingerprint.pathCount,
    segmentCount: fingerprint.segmentCount,
    changedPathRatio: fingerprint.changedPathRatio,
    imageCount: fingerprint.imageCount,
    glyphCount: fingerprint.glyphCount,
    gradientCount: fingerprint.gradientCount,
    isolatedLayerCount: fingerprint.isolatedLayerCount,
    maskDepth: fingerprint.maskDepth,
    filterNodeCount: fingerprint.filterNodeCount,
    visibleAreaRatio: fingerprint.visibleAreaRatio,
    dpr: fingerprint.dpr,
  };
}

/**
 * Runs the legacy selection AND the cost ranking, returning the legacy plan
 * as the routing authority plus a per-island receipt. NO routing change:
 * consuming `result.plan` behaves exactly like calling the legacy planner
 * directly, including PlanUnsatisfiableError propagation.
 */
export function planWithCostShadow(
  registry: EngineCapabilityRegistry,
  request: CostShadowPlanRequest,
): CostShadowPlanResult {
  const planner = new HybridExecutionPlanner(registry);
  // Authority first; an unsatisfiable plan throws here, untouched.
  const plan = planner.plan(request);

  const requestsById = new Map<string, CostShadowIslandRequest>();
  for (const island of request.islands) {
    requestsById.set(island.islandId, island);
  }

  const islands: IslandCostShadowReceipt[] = plan.islands.map((planned) => {
    const island = requestsById.get(planned.islandId);
    const fingerprint = island?.fingerprint;
    if (island === undefined || !isUsableCostShadowFingerprint(fingerprint)) {
      return {
        islandId: planned.islandId,
        legacyWinner: planned.providerId,
        costWinner: null,
        agreed: true,
        fingerprint: "absent",
        costs: [],
      };
    }
    // Cost ranks exactly the candidates the legacy capability query admitted.
    const candidates = registry.query(island.kind, island.requiredCapabilities);
    const costs = candidates
      .map((candidate) => estimateProviderCost(candidate.descriptor, fingerprint))
      .sort(compareCosts);
    const costWinner = pickCostWinner(costs, planned.providerId);
    return {
      islandId: planned.islandId,
      legacyWinner: planned.providerId,
      costWinner,
      agreed: costWinner === null || costWinner === planned.providerId,
      fingerprint: normalizeFingerprint(fingerprint),
      costs,
    };
  });

  return {
    plan,
    receipt: {
      surfaceId: plan.surfaceId,
      mode: plan.mode,
      islands,
      agreed: islands.every((entry) => entry.agreed),
    },
  };
}
