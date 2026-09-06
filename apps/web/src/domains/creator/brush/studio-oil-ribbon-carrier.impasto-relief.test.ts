import { beforeAll, describe, expect, it } from "vitest";

import { planOilBrushDabs } from "../studio-fx-brush";

import {
  planStudioOilRibbonCarrier,
  STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR,
  STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION,
  studioOilRibbonPathData,
  traceStudioOilRibbonPath,
  type StudioOilRibbonImpastoReliefKind,
} from "./studio-oil-ribbon-carrier";
import {
  evaluateStudioCalibratedBudget,
  evaluateStudioCalibratedDetection,
  STUDIO_PERF_CALIBRATION_MAX_GROWTH,
  type StudioCalibratedBudgetVerdict,
} from "./studio-perf-calibration";

const HORIZONTAL_STROKE = {
  points: [0, 60, 90, 60, 180, 60, 270, 60],
  pressures: [0.62, 0.7, 0.66, 0.6],
  baseWidth: 26,
  seed: 41,
} as const;

function reliefPointsOf(
  plan: ReturnType<typeof planStudioOilRibbonCarrier>,
  kind: StudioOilRibbonImpastoReliefKind,
): readonly number[] {
  return (plan.impastoReliefLanes ?? [])
    .filter((lane) => lane.kind === kind)
    .flatMap((lane) => lane.runs.flatMap((run) => [...run.points]));
}

function meanOfYs(points: readonly number[]): number {
  let sum = 0;
  let count = 0;
  for (let index = 1; index < points.length; index += 2) {
    sum += points[index]!;
    count += 1;
  }
  return count > 0 ? sum / count : Number.NaN;
}

type PlannedDabs = Parameters<typeof planStudioOilRibbonCarrier>[0];

/**
 * Wall-clock budgets used to measure the planner AND the machine underneath it. A raw "under
 * 30ms" bound failed a push at 30.11ms — 0.4% over — while passing every isolated run, and a
 * throttled 4-vCPU dev container reproduced 32.5ms (and 88.7ms against the 60ms scribble bound)
 * on the merge-base commit, so `pnpm test` could not be run to completion there at all.
 * Min-of-N sampling removes what a transient stall ADDS; it cannot remove the machine, and
 * widening the number until the slowest box passes is how a budget stops catching regressions.
 *
 * The budget is therefore stated against `studio-perf-calibration`: a reference measured in the
 * same process, interleaved sample by sample with the plan itself. Both sides scale with the
 * machine, so the verdict does not — while a planner that got slower moves only the workload side.
 *
 * That reference used to be the module's synthetic kernel, and the kernel does not co-scale with
 * this planner. Sized so an unregressed plan scored ~1.0 on a 4-vCPU x86 container, the same plan
 * scored 0.47-0.56 on Apple silicon: the kernel cost the same on both boxes while the planner ran
 * ~1.6x faster on one of them. No round count repairs that. The gate needs the reading to stay
 * under 1.5 and the 2x-detection assertion needs it to stay over 0.75, so a 2x spread between
 * machines leaves no value to pin — which is the hazard `studio-perf-calibration.ts`'s own header
 * documents under "pick the denominator that resembles the work", here landing on one of its
 * first call sites.
 *
 * The denominator is now THE SAME PLAN WITH THE OVERLAY OFF. Nothing resembles this planner like
 * this planner: same call, same stroke, same allocations, differing only in the feature the file
 * is about. The carrier guarantees that difference is clean — `body`, `bodyOpacity` and
 * `bristleLanes` stay byte-identical with `impastoRelief` disabled, which the first assertion
 * below re-checks rather than trusting — so the ratio is exactly the overlay's cost over the plan
 * it rides on, and it holds on any CPU.
 *
 * Detection power is not traded away for the portability: because the denominator is a fixed
 * share of the same plan, the two formulations convict at almost the same relief slowdown, and
 * this one is the tighter of the two. The old gate tripped when the whole plan grew 1.5x, which
 * is a x2.41 overlay on the long stroke and x1.57 on the scribble; this one trips at x2.36 and
 * x1.43.
 *
 * Two things this denominator cannot see, and where they are covered instead:
 *   - A uniform slowdown of the shared carrier body moves both sides. That is the `oil-ribbon`
 *     lane's own growth gate in studio-long-stroke-per-move-cost.test.ts.
 *   - Conversely, making the carrier body FASTER raises this ratio without the overlay changing.
 *     That is a re-pin with a red build attached, not a silent decay, and it is the honest
 *     reading: the overlay really would have become a larger share of the plan.
 * The deterministic painted-work counts below still hold the part of the budget that never needed
 * a clock at all.
 */
const LONG_STROKE_PLANS_PER_SAMPLE = 4;
const SCRIBBLE_PLANS_PER_SAMPLE = 2;

/**
 * Recorded ratios of overlay-on to overlay-off, measured the way the gate measures them: the
 * geometric centre of the band over sixteen runs on an Apple-silicon dev machine under Node 24,
 * eight idle (long x1.31-x1.62, scribble x5.71-x6.94) and eight with the box deliberately
 * oversubscribed at 8 spinning hogs against 12 cores (x1.28-x1.58, x4.88-x7.51). The budget is
 * `STUDIO_PERF_CALIBRATION_MAX_GROWTH` x these, which puts the whole measured envelope inside the
 * [x0.75, x1.5] band a pinned value buys with ~26% and ~14% left over for machine-to-machine
 * drift on top of it.
 *
 * The scribble sits so much higher because the overlay is 87.5% of that plan against 35.5% of the
 * long stroke's -- a self-crossing blob maximises grid area and splat density at once, which is
 * the whole reason it is here.
 */
const LONG_STROKE_OVERLAY_RATIO = 1.36;
const SCRIBBLE_OVERLAY_RATIO = 5.7;

/** Kept live so no plan in a timed window can be optimized away as dead code. */
let plannedLaneSink = 0;

function planReliefWorkload(dabs: PlannedDabs, plansPerSample: number): () => void {
  return () => {
    for (let plan = 0; plan < plansPerSample; plan += 1) {
      plannedLaneSink += planStudioOilRibbonCarrier(dabs, {
        impastoRelief: { enabled: true },
      }).impastoReliefLanes!.length;
    }
  };
}

/** The denominator: the identical plan with the overlay off, same count, same stroke. */
function planWithoutReliefWorkload(dabs: PlannedDabs, plansPerSample: number): () => void {
  return () => {
    for (let plan = 0; plan < plansPerSample; plan += 1) {
      plannedLaneSink += planStudioOilRibbonCarrier(dabs, {
        impastoRelief: { enabled: false },
      }).bristleLanes.length;
    }
  };
}

/**
 * Deterministic proxy for the work the budget is really protecting: every run and vertex the
 * planner hands to the painter. It is a pure function of the stroke, so it holds on any machine
 * and catches the pathological-blowup case (grid area x splat density) with no clock involved.
 */
function paintedWorkOf(plan: ReturnType<typeof planStudioOilRibbonCarrier>): {
  reliefLanes: number;
  reliefRuns: number;
  reliefVertices: number;
  bristleLanes: number;
  bristleRuns: number;
  bristleVertices: number;
} {
  const reliefLanes = plan.impastoReliefLanes ?? [];
  const countRuns = (lanes: readonly { runs: readonly { points: readonly number[] }[] }[]) =>
    lanes.reduce((total, lane) => total + lane.runs.length, 0);
  const countVertices = (lanes: readonly { runs: readonly { points: readonly number[] }[] }[]) =>
    lanes.reduce(
      (total, lane) =>
        total + lane.runs.reduce((runTotal, run) => runTotal + run.points.length / 2, 0),
      0,
    );
  return {
    reliefLanes: reliefLanes.length,
    reliefRuns: countRuns(reliefLanes),
    reliefVertices: countVertices(reliefLanes),
    bristleLanes: plan.bristleLanes.length,
    bristleRuns: countRuns(plan.bristleLanes),
    bristleVertices: countVertices(plan.bristleLanes),
  };
}

function longStrokeDabs(): PlannedDabs {
  // The budget is 2400 rather than 2048 because the capped spacing ladder lands the bed inside a
  // band below its limit instead of exactly on it. Sizing up keeps the measured bed at least as
  // large as the one this budget was calibrated against, rather than relaxing the assertion.
  return planOilBrushDabs({
    points: [0, 0, 1200, 40, 2400, -30, 3600, 20],
    pressures: [0.5, 0.75, 0.6, 0.8],
    baseWidth: 24,
    seed: 7,
    maxDabs: 2400,
  });
}

function scribbleDabs(): PlannedDabs {
  // A blob-shaped self-crossing scribble: maximises grid area AND splat density at once.
  const points: number[] = [];
  for (let step = 0; step <= 160; step += 1) {
    points.push(
      20 + (step % 2 === 0 ? 0 : 190) + Math.sin(step * 0.7) * 20,
      20 + step * 1.35,
    );
  }
  return planOilBrushDabs({ points, baseWidth: 26, seed: 3, maxDabs: 2048 });
}

describe("studio oil ribbon carrier — impasto relief overlay (impastoRelief program)", () => {
  it("keeps every plan without the program structurally identical (no overlay key at all)", () => {
    const dabs = planOilBrushDabs(HORIZONTAL_STROKE);
    const legacy = planStudioOilRibbonCarrier(dabs);

    expect("impastoReliefLanes" in legacy).toBe(false);
    expect(planStudioOilRibbonCarrier(dabs, {})).toEqual(legacy);
    expect(
      planStudioOilRibbonCarrier(dabs, { impastoRelief: { enabled: false } }),
    ).toEqual(legacy);
    expect(JSON.stringify(planStudioOilRibbonCarrier(dabs, {}))).toBe(
      JSON.stringify(legacy),
    );
  });

  it("appends relief lanes without changing any settled base field, deterministically", () => {
    const dabs = planOilBrushDabs(HORIZONTAL_STROKE);
    const legacy = planStudioOilRibbonCarrier(dabs);
    const relief = planStudioOilRibbonCarrier(dabs, { impastoRelief: { enabled: true } });

    // The overlay is additive-only: body pigment and bristle bands are byte-identical, so the
    // impasto lane inherits the exact silhouette its oil-ribbon siblings settled on.
    expect(relief.body).toEqual(legacy.body);
    expect(relief.bodyOpacity).toBe(legacy.bodyOpacity);
    expect(relief.bristleLanes).toEqual(legacy.bristleLanes);
    expect(relief.sourceStationCount).toBe(legacy.sourceStationCount);

    const lanes = relief.impastoReliefLanes;
    expect(lanes).toBeDefined();
    expect(lanes!.length).toBeGreaterThan(0);
    // Bounded (kind × tone bucket) quantisation: one paint pass per lane, at most 3 + 3.
    expect(lanes!.length).toBeLessThanOrEqual(6);
    const kinds = new Set(lanes!.map(({ kind }) => kind));
    expect(kinds.has("highlight")).toBe(true);
    expect(kinds.has("shadow")).toBe(true);
    for (const lane of lanes!) {
      expect(lane.lineWidth).toBeGreaterThan(0);
      expect(lane.opacity).toBeGreaterThan(0);
      expect(lane.opacity).toBeLessThanOrEqual(0.44);
      expect(lane.runs.length).toBeGreaterThan(0);
      for (const run of lane.runs) {
        expect(run.points.length % 2).toBe(0);
        expect(run.points.length).toBeGreaterThanOrEqual(4);
      }
    }
    // Paint order contract both surfaces share: every shadow lane precedes every glint lane.
    const firstHighlight = lanes!.findIndex(({ kind }) => kind === "highlight");
    const lastShadow = lanes!.map(({ kind }) => kind).lastIndexOf("shadow");
    expect(firstHighlight).toBeGreaterThan(lastShadow);

    expect(
      JSON.stringify(planStudioOilRibbonCarrier(dabs, { impastoRelief: { enabled: true } })),
    ).toBe(JSON.stringify(relief));
    expect(STUDIO_OIL_IMPASTO_RELIEF_OVERLAY_VERSION).toBe("oil-impasto-relief-overlay-v1");
    expect(STUDIO_OIL_IMPASTO_RELIEF_HIGHLIGHT_COLOR).toBe("#ffffff");
  });

  it("orients relief by the dli light (0, −1, 1): glints sit above their shadows", () => {
    const plan = planStudioOilRibbonCarrier(planOilBrushDabs(HORIZONTAL_STROKE), {
      impastoRelief: { enabled: true },
    });
    const highlightY = meanOfYs(reliefPointsOf(plan, "highlight"));
    const shadowY = meanOfYs(reliefPointsOf(plan, "shadow"));

    // Every ridge's lit flank is displaced toward the light relative to that same ridge's shaded
    // flank, so on a horizontal stroke the highlight population must average strictly higher
    // (smaller y) than the shadow population.
    expect(Number.isFinite(highlightY)).toBe(true);
    expect(Number.isFinite(shadowY)).toBe(true);
    expect(shadowY - highlightY).toBeGreaterThan(0.3);
  });

  it("keeps every relief point inside the painted body so screen glints cannot halo", () => {
    const dabs = planOilBrushDabs(HORIZONTAL_STROKE);
    const plan = planStudioOilRibbonCarrier(dabs, { impastoRelief: { enabled: true } });
    const maxRadiusY = Math.max(...dabs.map(({ radiusY }) => radiusY));
    const minX = Math.min(...dabs.map(({ x }) => x));
    const maxX = Math.max(...dabs.map(({ x }) => x));

    for (const kind of ["highlight", "shadow"] as const) {
      const points = reliefPointsOf(plan, kind);
      expect(points.length).toBeGreaterThan(0);
      for (let index = 0; index + 1 < points.length; index += 2) {
        // Stations carry ≤0.6px of normal jitter before smoothing; everything else must stay
        // within the ribbon's own half-width.
        expect(Math.abs(points[index + 1]! - 60)).toBeLessThanOrEqual(maxRadiusY + 0.6);
        expect(points[index]!).toBeGreaterThanOrEqual(minX - maxRadiusY);
        expect(points[index]!).toBeLessThanOrEqual(maxX + maxRadiusY);
      }
    }
  });

  it("shares identical quantized relief coordinates between Canvas tracing and SVG", () => {
    const plan = planStudioOilRibbonCarrier(planOilBrushDabs(HORIZONTAL_STROKE), {
      impastoRelief: { enabled: true },
    });
    for (const lane of plan.impastoReliefLanes ?? []) {
      for (const run of lane.runs) {
        const canvasCoordinates: number[] = [];
        traceStudioOilRibbonPath({
          moveTo: (x, y) => canvasCoordinates.push(x, y),
          lineTo: (x, y) => canvasCoordinates.push(x, y),
        }, run);
        const svgCoordinates = (
          studioOilRibbonPathData(run).match(/-?(?:\d+\.\d+|\d+)/gu) ?? []
        ).map(Number);
        expect(svgCoordinates).toEqual(canvasCoordinates);
      }
    }
  });

  it("skips the overlay for taps (a single station has no band relief to shade)", () => {
    const plan = planStudioOilRibbonCarrier(planOilBrushDabs({
      points: [12, 18],
      pressures: [0.7],
      baseWidth: 27,
      seed: 13,
    }), { impastoRelief: { enabled: true } });
    expect(plan.impastoReliefLanes).toEqual([]);
  });

  describe("calibrated plan budgets", () => {
    let longStroke: StudioCalibratedBudgetVerdict;
    let scribble: StudioCalibratedBudgetVerdict;

    // Measured once and shared: the budget assertion and its synthetic-regression twin are two
    // readings of the SAME measurement, so the regression proof is anchored to what this machine
    // actually just did rather than to a number recorded on some other box.
    beforeAll(() => {
      longStroke = evaluateStudioCalibratedBudget({
        label: "2000-station impasto plan",
        workload: planReliefWorkload(longStrokeDabs(), LONG_STROKE_PLANS_PER_SAMPLE),
        referenceWorkload: planWithoutReliefWorkload(longStrokeDabs(), LONG_STROKE_PLANS_PER_SAMPLE),
        maxRatio: LONG_STROKE_OVERLAY_RATIO * STUDIO_PERF_CALIBRATION_MAX_GROWTH,
        samples: 5,
      });
      scribble = evaluateStudioCalibratedBudget({
        label: "self-crossing scribble impasto plan",
        workload: planReliefWorkload(scribbleDabs(), SCRIBBLE_PLANS_PER_SAMPLE),
        referenceWorkload: planWithoutReliefWorkload(scribbleDabs(), SCRIBBLE_PLANS_PER_SAMPLE),
        maxRatio: SCRIBBLE_OVERLAY_RATIO * STUDIO_PERF_CALIBRATION_MAX_GROWTH,
        samples: 4,
      });
    });

    it("plans the same body and bristles with the overlay off, so the denominator is honest", () => {
      // The reference is only a measure of "this plan without the overlay" while the overlay is
      // genuinely all that differs. If the carrier ever started varying the shared work behind the
      // flag, the budget below would silently be dividing by a different plan -- so that is
      // checked here, byte for byte, before any clock is involved.
      for (const dabs of [longStrokeDabs(), scribbleDabs()]) {
        const on = planStudioOilRibbonCarrier(dabs, { impastoRelief: { enabled: true } });
        const off = planStudioOilRibbonCarrier(dabs, { impastoRelief: { enabled: false } });
        expect(off.impastoReliefLanes ?? []).toEqual([]);
        expect((on.impastoReliefLanes ?? []).length).toBeGreaterThan(0);
        expect(off.body).toEqual(on.body);
        expect(off.bodyOpacity).toEqual(on.bodyOpacity);
        expect(off.bristleLanes).toEqual(on.bristleLanes);
      }
    });

    it("plans a 2000-station impasto stroke inside its calibrated plan budget", () => {
      expect(longStrokeDabs().length).toBeGreaterThanOrEqual(2000);
      expect(longStroke.ok, longStroke.detail).toBe(true);
      expect(plannedLaneSink).toBeGreaterThan(0);
    });

    it("stays within the plan budget on a dense self-crossing scribble too", () => {
      // Held through a 7 -> 20 hair bed on this stroke. The bed scaling alone took it to 65ms;
      // every millisecond of that came back out as redundancy rather than as texture, and the
      // ridge count is unchanged at twenty: runs are quantised once instead of once per shell
      // they appear in, the ridges and flank stripes stride the bed so hairs finer than the
      // field's own cell are not splatted twice, and each ridge segment is one capsule distance
      // field instead of a chain of overlapping discs that was quadrature for exactly that field.
      expect(scribbleDabs().length).toBeGreaterThan(1200);
      expect(scribble.ok, scribble.detail).toBe(true);
    });

    it("would have failed both budgets had the planner become 2x more expensive", () => {
      // The point of a calibrated budget is that it survives a slow machine WITHOUT becoming a
      // no-op, so the doubling has to be checked on the same machine, against the same reference
      // windows, in the same run. That is exactly what this asserts, and it reuses the passes
      // just measured — the healthy case measures nothing extra. The other half of the claim,
      // that the harness really does read a doubled hot path as 2x, is measured end to end in
      // studio-perf-calibration.test.ts, and against recorded series from these two strokes.
      for (const [verdict, workload, referenceWorkload] of [
        [longStroke, planReliefWorkload(longStrokeDabs(), LONG_STROKE_PLANS_PER_SAMPLE),
          planWithoutReliefWorkload(longStrokeDabs(), LONG_STROKE_PLANS_PER_SAMPLE)],
        [scribble, planReliefWorkload(scribbleDabs(), SCRIBBLE_PLANS_PER_SAMPLE),
          planWithoutReliefWorkload(scribbleDabs(), SCRIBBLE_PLANS_PER_SAMPLE)],
      ] as const) {
        const detection = evaluateStudioCalibratedDetection({
          label: verdict.label,
          workload,
          referenceWorkload,
          maxRatio: verdict.maxRatio,
          seed: verdict.passes,
          factor: 2,
          samples: 4,
          warmups: 1,
        });
        // `detectableFactor` is the smallest slowdown this reading would have convicted;
        // recorded honest readings put it around 1.3x-1.6x, so the budget is not merely a
        // doubling detector. 2x is the line it must never lose, and that is what is asserted.
        expect(detection.detected, detection.detail).toBe(true);
      }
    });
  });

  it("keeps the painted work of both budget strokes bounded, with no clock involved", () => {
    // Recorded counts (deterministic, so these are exact): the 2000-station stroke plans 6
    // relief lanes / 116 runs / 8844 vertices over 25 bristle lanes / 5030 runs / 132526
    // vertices; the scribble plans 6 / 1176 / 5213 over 25 / 5140 / 132568. The bounds below
    // carry ~20% headroom for tuning, and are what actually guards pathological blowup: an
    // algorithmic explosion in grid area or splat density shows up here identically on a
    // laptop, a CI runner and a starved container.
    //
    // The relief counts stepped up when the height grid was made prefix-stable: a snapped origin
    // lands crests on cell centres consistently instead of smearing them differently every frame,
    // so the Sobel reads steeper slopes and more runs clear IMPASTO_RELIEF_MIN_STRENGTH (scribble
    // 954 -> 1176 runs). That is more relief, not looser quantisation, and it is paid for many
    // times over: the carrier's per-move cost on a capped bed went 88.5ms -> 61.0ms (min-of-3)
    // because the same stability lets the field be retained across moves. The BRISTLE counts are
    // untouched, which is the check that the overlay stayed additive-only.
    const long = paintedWorkOf(
      planStudioOilRibbonCarrier(longStrokeDabs(), { impastoRelief: { enabled: true } }),
    );
    const scribble = paintedWorkOf(
      planStudioOilRibbonCarrier(scribbleDabs(), { impastoRelief: { enabled: true } }),
    );

    for (const [label, work] of [["long", long], ["scribble", scribble]] as const) {
      expect(work.reliefLanes, label).toBeGreaterThan(0);
      expect(work.reliefLanes, label).toBeLessThanOrEqual(6);
      expect(work.bristleLanes, label).toBeLessThanOrEqual(30);
      expect(work.bristleRuns, label).toBeLessThanOrEqual(6_200);
      expect(work.bristleVertices, label).toBeLessThanOrEqual(160_000);
    }
    expect(long.reliefRuns).toBeLessThanOrEqual(160);
    expect(long.reliefVertices).toBeLessThanOrEqual(9_700);
    // The scribble crosses itself, so it quantises into ~8x more (but shorter) relief runs than
    // the long stroke while painting FEWER vertices. Both directions are pinned: run count is
    // where a de-quantisation bug would explode, vertex count is where a splat-density bug would.
    expect(scribble.reliefRuns).toBeLessThanOrEqual(1_200);
    expect(scribble.reliefVertices).toBeLessThanOrEqual(6_300);
    // FLOORS, because a ceiling cannot see relief that stopped existing. `impastoHairStride`
    // divides by the grid cell through a `floor`, so anything that coarsens the cell resolves
    // fewer hairs and silently deletes ridges — rounding `impastoReliefCell` to the rung ABOVE
    // `natural` instead of below took a straight capped stroke from 43 rasterised ridge runs to
    // 20, and every assertion above stayed green through it. Measured 114/8842 and 1176/5213;
    // these sit ~20% under, which a halving cannot clear.
    expect(long.reliefRuns).toBeGreaterThanOrEqual(90);
    expect(long.reliefVertices).toBeGreaterThanOrEqual(7_000);
    expect(scribble.reliefRuns).toBeGreaterThanOrEqual(940);
    expect(scribble.reliefVertices).toBeGreaterThanOrEqual(4_100);
  });
});
