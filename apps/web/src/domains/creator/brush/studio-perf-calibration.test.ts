import { describe, expect, it } from "vitest";

import {
  evaluateStudioCalibratedBudget,
  evaluateStudioCalibratedDetection,
  evaluateStudioCalibratedSampledBudget,
  evaluateStudioCalibratedSampledDetection,
  judgeStudioCalibratedBudget,
  judgeStudioCalibratedDetection,
  measureStudioCalibratedPasses,
  readStudioPerfCalibrationSink,
  scaleStudioPerfCalibrationPass,
  reduceStudioPerfCalibrationSamples,
  runStudioPerfCalibrationRounds,
  STUDIO_PERF_CALIBRATION_MAX_GROWTH,
  type StudioPerfCalibrationPass,
  type StudioPerfCalibrationSample,
} from "./studio-perf-calibration";

/**
 * Recorded passes, not invented ones. Every `(referenceMs, workMs)` pair below was measured by
 * this harness on a 4-vCPU cloud dev container, four runs per row: two on an idle box and two
 * with the box deliberately oversubscribed (six spinning CPU hogs against four cores) so the
 * workload window and the reference window each got starved in turn.
 *
 * `honest` rows are the unmodified hot path. `doubled` rows ran the identical workload twice per
 * sample — a real, exactly 2x regression of the same code, not a hand-written number. The gate
 * has to separate the two populations on THIS data, which is the whole claim being made.
 */
const RECORDED_PASSES = {
  "impasto 2000-station stroke": {
    honest: [
      { referenceMs: 63.40, workMs: 74.54 },
      { referenceMs: 63.43, workMs: 74.61 },
      { referenceMs: 81.18, workMs: 89.78 },
      { referenceMs: 192.49, workMs: 230.17 },
    ],
    doubled: [
      { referenceMs: 66.26, workMs: 128.79 },
      { referenceMs: 63.70, workMs: 130.79 },
      { referenceMs: 92.52, workMs: 197.34 },
      { referenceMs: 205.38, workMs: 450.87 },
    ],
  },
  "impasto self-crossing scribble": {
    honest: [
      { referenceMs: 130.12, workMs: 138.46 },
      { referenceMs: 131.97, workMs: 150.64 },
      { referenceMs: 455.46, workMs: 446.61 },
      { referenceMs: 394.08, workMs: 366.67 },
    ],
    doubled: [
      { referenceMs: 126.31, workMs: 260.49 },
      { referenceMs: 130.22, workMs: 262.67 },
      { referenceMs: 353.06, workMs: 845.61 },
      { referenceMs: 327.13, workMs: 796.65 },
    ],
  },
  // Recorded before the paper budget moved onto a frozen-baseline denominator, so this row is
  // history rather than a live call site — it stays because it is the noisiest honest series in
  // the corpus and the judge has to clear it.
  "scalar sampler vs the built-in kernel (historical)": {
    honest: [
      { referenceMs: 157.64, workMs: 152.82 },
      { referenceMs: 165.90, workMs: 156.61 },
      // The worst honest reading in the whole corpus (1.388): the reference window happened to
      // run in a clean slot while the workload window did not.
      { referenceMs: 422.24, workMs: 586.16 },
      { referenceMs: 609.77, workMs: 570.52 },
    ],
    doubled: [
      { referenceMs: 164.03, workMs: 324.70 },
      { referenceMs: 162.72, workMs: 332.74 },
      { referenceMs: 517.55, workMs: 1123.99 },
      { referenceMs: 540.54, workMs: 1207.08 },
    ],
  },
} as const satisfies Record<
  string,
  { honest: readonly StudioPerfCalibrationSample[]; doubled: readonly StudioPerfCalibrationSample[] }
>;

/**
 * The recorded false positive that motivates confirmation passes. Measured on the same
 * oversubscribed container by an earlier, single-pass form of this harness: an unmodified
 * scribble plan scored 1.83 once and 0.92 on the very next run.
 */
const RECORDED_UNLUCKY_THEN_CLEAN: readonly StudioPerfCalibrationSample[] = [
  { referenceMs: 68.70, workMs: 125.42 },
  { referenceMs: 67.83, workMs: 62.30 },
];

function passOf(sample: StudioPerfCalibrationSample): StudioPerfCalibrationPass {
  return reduceStudioPerfCalibrationSamples([sample]);
}

describe("studio perf calibration — reference kernel", () => {
  it("retires deterministic work whose cost is linear in rounds", () => {
    expect(runStudioPerfCalibrationRounds(0)).toBe(0);
    const once = runStudioPerfCalibrationRounds(8);
    // Deterministic per round index, but each call carries the previous call's scratch tail in,
    // so identity is asserted where it matters: the kernel is pure CPU work with no allocation
    // and no growth, hence a stable per-round cost the call sites can size against.
    expect(Number.isFinite(once)).toBe(true);
    expect(once).not.toBe(0);

    const measure = (rounds: number): number => {
      let best = Number.POSITIVE_INFINITY;
      for (let sample = 0; sample < 9; sample += 1) {
        const started = performance.now();
        runStudioPerfCalibrationRounds(rounds);
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const single = measure(400);
    const quadruple = measure(1600);
    expect(single).toBeGreaterThan(0);
    // The claim is only that rounds are a usable dial for sizing a window. It is stated as a
    // very wide band on purpose: min-of-N finds a clean scheduling slot for a 1.2ms window far
    // more often than for a 4.8ms one, so a contended box reads the growth well above the
    // nominal 4x (8.04 and 17.66 both recorded at 6 spinning hogs against 4 cores) — contention
    // can only ever push it UP, so the lower bound is the side that carries the meaning.
    expect(quadruple / single).toBeGreaterThan(2);
    expect(quadruple / single).toBeLessThan(40);
    expect(Number.isFinite(readStudioPerfCalibrationSink())).toBe(true);
  });
});

describe("studio perf calibration — pass reduction", () => {
  it("keeps the cheapest reference and the cheapest workload window", () => {
    const pass = reduceStudioPerfCalibrationSamples([
      { referenceMs: 60, workMs: 90 },
      { referenceMs: 200, workMs: 61 },
      { referenceMs: 64, workMs: 400 },
    ]);
    expect(pass.referenceMs).toBe(60);
    expect(pass.workMs).toBe(61);
    expect(pass.ratio).toBeCloseTo(61 / 60, 10);
    expect(pass.sampleCount).toBe(3);
  });

  it("refuses a pass it cannot form a ratio from", () => {
    expect(() => reduceStudioPerfCalibrationSamples([])).toThrow(/at least one sample/u);
    expect(() =>
      reduceStudioPerfCalibrationSamples([{ referenceMs: 0, workMs: 12 }]),
    ).toThrow(/sized too small/u);
  });
});

describe("studio perf calibration — gate", () => {
  it("clears every recorded honest pass and fails every recorded 2x regression", () => {
    for (const [label, corpus] of Object.entries(RECORDED_PASSES)) {
      const honest = corpus.honest.map(passOf);
      const doubled = corpus.doubled.map(passOf);

      // Every honest pass clears the gate on its own — no confirmation needed.
      for (const pass of honest) {
        expect(
          judgeStudioCalibratedBudget(label, [pass]).ok,
          `${label} honest ${pass.ratio.toFixed(3)}`,
        ).toBe(true);
      }
      // Every doubled pass trips it on its own, so confirmation passes cannot rescue it either.
      for (const pass of doubled) {
        expect(
          judgeStudioCalibratedBudget(label, [pass]).ok,
          `${label} doubled ${pass.ratio.toFixed(3)}`,
        ).toBe(false);
      }
      expect(judgeStudioCalibratedBudget(label, doubled).ok, label).toBe(false);

      // The populations are separated with margin on both sides, which is what makes the gate
      // both slow-machine-proof and regression-proof rather than one at the cost of the other.
      const worstHonest = Math.max(...honest.map((pass) => pass.ratio));
      const bestDoubled = Math.min(...doubled.map((pass) => pass.ratio));
      expect(worstHonest, label).toBeLessThan(STUDIO_PERF_CALIBRATION_MAX_GROWTH);
      expect(bestDoubled, label).toBeGreaterThan(STUDIO_PERF_CALIBRATION_MAX_GROWTH);
      expect(bestDoubled / worstHonest, label).toBeGreaterThan(1.35);
    }
  });

  it("makes a violation earn itself: one unlucky pass beside a clean one acquits", () => {
    const [unlucky, clean] = RECORDED_UNLUCKY_THEN_CLEAN.map(passOf);
    expect(unlucky!.ratio).toBeGreaterThan(STUDIO_PERF_CALIBRATION_MAX_GROWTH);
    expect(judgeStudioCalibratedBudget("scribble", [unlucky!]).ok).toBe(false);
    expect(judgeStudioCalibratedBudget("scribble", [unlucky!, clean!]).ok).toBe(true);
    expect(judgeStudioCalibratedBudget("scribble", [unlucky!, clean!]).ratio)
      .toBeCloseTo(clean!.ratio, 10);
  });

  it("reports the evidence it convicted on", () => {
    const label = "scalar sampler vs the built-in kernel (historical)";
    const verdict = judgeStudioCalibratedBudget(
      label,
      RECORDED_PASSES[label].doubled.map(passOf),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain(label);
    expect(verdict.detail).toContain("budget 1.50x");
    expect(verdict.passes).toHaveLength(4);
    expect(verdict.ratio).toBeCloseTo(324.70 / 164.03, 6);
  });

  it("convicts a recorded honest pass once its workload is restated 2x slower", () => {
    for (const [label, corpus] of Object.entries(RECORDED_PASSES)) {
      for (const sample of corpus.honest) {
        const honest = passOf(sample);
        const doubled = scaleStudioPerfCalibrationPass(honest, 2);
        expect(doubled.referenceMs, label).toBe(honest.referenceMs);
        expect(doubled.workMs, label).toBeCloseTo(honest.workMs * 2, 10);
        expect(judgeStudioCalibratedBudget(label, [honest]).ok, label).toBe(true);
        expect(judgeStudioCalibratedBudget(label, [doubled]).ok, label).toBe(false);
      }
    }
  });

  it("rejects a nonsense regression factor", () => {
    const pass = passOf({ referenceMs: 60, workMs: 61 });
    expect(() => scaleStudioPerfCalibrationPass(pass, 0)).toThrow(/positive finite/u);
    expect(() => scaleStudioPerfCalibrationPass(pass, Number.NaN)).toThrow(/positive finite/u);
  });

  it("refuses to judge nothing", () => {
    expect(() => judgeStudioCalibratedBudget("empty", [])).toThrow(/No calibration passes/u);
  });
});

describe("studio perf calibration — end to end", () => {
  // ~48ms windows. A 10ms window is short enough that min-of-N stops finding a clean slot on a
  // badly oversubscribed box, and the two sides then starve at visibly different rates.
  const ROUNDS = 4_000;

  it("passes a workload that costs one calibration unit, in a single pass", () => {
    const verdict = evaluateStudioCalibratedBudget({
      label: "reference-sized workload",
      workload: () => void runStudioPerfCalibrationRounds(ROUNDS),
      referenceRounds: ROUNDS,
      samples: 4,
      warmups: 2,
    });
    expect(verdict.ok, verdict.detail).toBe(true);
  });

  it("stops at the first pass that clears the gate", () => {
    // A workload that does nothing cannot cost 1.5 reference kernels on any machine, so this
    // pins the control flow — the happy path never pays for confirmation — without depending on
    // how any particular box schedules the two windows.
    const verdict = evaluateStudioCalibratedBudget({
      label: "empty workload",
      workload: () => undefined,
      referenceRounds: ROUNDS,
      samples: 2,
      warmups: 1,
    });
    expect(verdict.ok, verdict.detail).toBe(true);
    expect(verdict.passes).toHaveLength(1);
    expect(verdict.ratio, verdict.detail).toBeLessThan(0.1);
  });

  /**
   * Measures a workload built to cost `factor` times the reference and returns the reading the
   * harness would have judged on. The claim rides on the best-calibrated pass for the reason
   * `measureStudioCalibratedPasses` documents; the acquitting direction has to be earned across
   * passes exactly as the convicting direction is.
   */
  function readMultipleOfReference(label: string, factor: number): {
    best: number;
    verdict: ReturnType<typeof judgeStudioCalibratedBudget>;
  } {
    const passes = measureStudioCalibratedPasses({
      label,
      workload: () => void runStudioPerfCalibrationRounds(Math.round(ROUNDS * factor)),
      referenceRounds: ROUNDS,
      samples: 5,
      warmups: 2,
      passes: 3,
    });
    const bestPass = passes.reduce((best, pass) => (pass.ratio > best.ratio ? pass : best));
    return { best: bestPass.ratio, verdict: judgeStudioCalibratedBudget(label, [bestPass]) };
  }

  it("reads a workload doing exactly twice the work as 2x, and the gate convicts it", () => {
    const { best, verdict } = readMultipleOfReference("doubled workload", 2);
    expect(verdict.ok, verdict.detail).toBe(false);
    expect(best, verdict.detail).toBeGreaterThan(1.5);
  });

  it("proves its own detection power from a healthy reading, measuring nothing again", () => {
    // A pass that already shows detection must cost nothing extra, so the workload here throws
    // if it is ever called. Seeded rather than measured on purpose: this is a statement about
    // the harness's control flow, and no wall clock belongs in it.
    const healthy = reduceStudioPerfCalibrationSamples([{ referenceMs: 64, workMs: 66 }]);
    const detection = evaluateStudioCalibratedDetection({
      label: "healthy reading",
      workload: () => {
        throw new Error("must not measure again");
      },
      referenceRounds: ROUNDS,
      seed: [healthy],
      factor: 2,
    });
    expect(detection.detected, detection.detail).toBe(true);
    expect(detection.passes).toEqual([healthy]);
    // A workload costing one calibration unit is convicted a long way short of doubling.
    expect(detection.detectableFactor, detection.detail).toBeCloseTo(1.5 / healthy.ratio, 10);
    expect(detection.detectableFactor, detection.detail).toBeLessThan(1.6);
  });

  it("keeps a live budget reading and its detection claim on the same measurement", () => {
    const budget = evaluateStudioCalibratedBudget({
      label: "reference-sized workload",
      workload: () => void runStudioPerfCalibrationRounds(ROUNDS),
      referenceRounds: ROUNDS,
      samples: 4,
      warmups: 2,
    });
    expect(budget.ok, budget.detail).toBe(true);
    const detection = evaluateStudioCalibratedDetection({
      label: budget.label,
      workload: () => void runStudioPerfCalibrationRounds(ROUNDS),
      referenceRounds: ROUNDS,
      seed: budget.passes,
      factor: 2,
      samples: 4,
      warmups: 1,
    });
    expect(detection.detected, detection.detail).toBe(true);
    // The budget's own passes lead, and any pass added to prove detection follows them.
    expect(detection.passes.slice(0, budget.passes.length)).toEqual(budget.passes);
  });

  it("reduces an attempt the way the gate does, so it cannot claim detection the gate misses", () => {
    // Regression test for a real defect: detection reduced a flat pool of passes by the MAXIMUM
    // while the gate reduces by the minimum. Ratios of 1.0 and 0.5 at factor 2 then reported
    // "detectable" (1.0 x 2 > 1.5) even though a genuinely doubled workload measures 2.0 and 1.0,
    // whose minimum (1.0) clears the 1.5 gate and acquits. Reported by Codex on #39.
    const passes = [
      reduceStudioPerfCalibrationSamples([{ referenceMs: 100, workMs: 100 }]),
      reduceStudioPerfCalibrationSamples([{ referenceMs: 100, workMs: 50 }]),
    ];
    expect(passes.map((pass) => pass.ratio)).toEqual([1, 0.5]);

    const detection = evaluateStudioCalibratedDetection({
      label: "mixed attempt",
      workload: () => {
        throw new Error("must not measure again");
      },
      referenceRounds: 1,
      seed: passes,
      factor: 2,
      attemptCount: 1,
    });
    expect(detection.detected, detection.detail).toBe(false);

    // And the claim it refuses to make is exactly the one the gate would refuse: doubling this
    // very attempt's workload leaves a minimum the gate acquits.
    const doubled = passes.map((pass) => scaleStudioPerfCalibrationPass(pass, 2));
    expect(judgeStudioCalibratedBudget("mixed attempt (doubled)", doubled).ok).toBe(true);
  });

  it("lets a clean attempt override a distorted one, but never a clean pass inside one", () => {
    // Pinned on controlled pass data, not a live measurement. A wall-clock attempt here would
    // flake on an oversubscribed runner for exactly the reason this module documents: the same
    // kernel measured against itself read 2.133 and then 0.538 in consecutive passes, and one
    // sub-0.75 reading would flip `detected`. Semantics get pinned without a clock.
    const pass = (ratio: number) =>
      reduceStudioPerfCalibrationSamples([{ referenceMs: 100, workMs: 100 * ratio }]);
    const distorted = [pass(1), pass(0.5)];
    const clean = [pass(1.05), pass(1.1)];

    // A whole clean attempt beside a distorted one carries the claim.
    expect(
      judgeStudioCalibratedDetection("recovering", [distorted, clean], 2).detected,
    ).toBe(true);
    // The distorted attempt alone does not, even though it holds a 1.0 pass.
    expect(judgeStudioCalibratedDetection("distorted only", [distorted], 2).detected).toBe(false);
    // And a clean pass sitting INSIDE a distorted attempt never rescues it — only another
    // attempt does. This is the asymmetry the whole fix turns on.
    expect(
      judgeStudioCalibratedDetection("one attempt, mixed", [[...distorted, pass(1.2)]], 2).detected,
    ).toBe(false);

    const verdict = judgeStudioCalibratedDetection("recovering", [distorted, clean], 2);
    expect(verdict.detectableFactor).toBeCloseTo(1.5 / 1.05, 10);
    expect(verdict.passes).toHaveLength(4);
    expect(verdict.detail).toContain("#2 min 1.050");
  });

  it("refuses to treat an empty attempt as evidence", () => {
    // Math.min() of nothing is Infinity, which would certify detection without measuring at all.
    expect(() => judgeStudioCalibratedDetection("empty attempt", [[]], 2))
      .toThrow(/not evidence/u);
    expect(() => judgeStudioCalibratedDetection("nothing", [], 2))
      .toThrow(/No calibration passes/u);
    for (const bad of [0, -1, 1.5]) {
      expect(() =>
        evaluateStudioCalibratedDetection({
          label: "zero passes",
          workload: () => {
            throw new Error("must not measure");
          },
          referenceRounds: 1,
          factor: 2,
          passes: bad,
        }),
      ).toThrow(/at least one pass/u);
    }
    expect(() =>
      evaluateStudioCalibratedDetection({
        label: "zero attempts",
        workload: () => {
          throw new Error("must not measure");
        },
        referenceRounds: 1,
        factor: 2,
        attemptCount: 0,
      }),
    ).toThrow(/at least one attempt/u);
  });

  it("re-measures rather than letting one starved reference condemn the calibration", () => {
    // A recorded pass whose reference window was starved ~2.5x harder than its workload window:
    // it reads 0.697, which alone would claim a doubling (1.394) is undetectable here. Detection
    // must be EARNED as a failure, so the harness measures again instead of believing it.
    const starved = reduceStudioPerfCalibrationSamples([
      { referenceMs: 964.6, workMs: 672.4 },
    ]);
    expect(starved.ratio * 2).toBeLessThan(STUDIO_PERF_CALIBRATION_MAX_GROWTH);
    const detection = evaluateStudioCalibratedDetection({
      label: "starved reference",
      workload: () => void runStudioPerfCalibrationRounds(ROUNDS),
      referenceRounds: ROUNDS,
      seed: [starved],
      factor: 2,
      samples: 4,
      warmups: 1,
    });
    expect(detection.detected, detection.detail).toBe(true);
    expect(detection.passes.length).toBeGreaterThan(1);
    expect(detection.passes[0]).toBe(starved);
  });

  it("rejects a detection factor that claims nothing", () => {
    expect(() =>
      evaluateStudioCalibratedDetection({
        label: "nonsense",
        workload: () => undefined,
        referenceRounds: 1,
        factor: 1,
      }),
    ).toThrow(/greater than 1/u);
  });

  it("catches a regression short of 2x — the gate is not a doubling detector", () => {
    const { verdict } = readMultipleOfReference("80% slower workload", 1.8);
    expect(verdict.ok, verdict.detail).toBe(false);
  });
});

/**
 * The caller-timed form. Two brush gates cannot hand over a workload closure — the idle-prewarm
 * freeze gate's subject is the worst SLICE inside a drain, and the per-move growth gate has to
 * keep each lane's `seek` outside the window it times — so they hand over the finished pair
 * instead. Everything downstream of that is the same code, and these pin that it stays so.
 */
describe("studio perf calibration — caller-timed samples", () => {
  /** A sampler that replays a fixed series of pairs, so the semantics can be pinned exactly. */
  function replaying(pairs: readonly StudioPerfCalibrationSample[]): {
    takeSample: () => StudioPerfCalibrationSample;
    taken: () => number;
  } {
    let index = 0;
    return {
      takeSample: () => pairs[index++ % pairs.length]!,
      taken: () => index,
    };
  }

  it("reduces, judges and stops exactly as the closure-timed form does", () => {
    const source = replaying([{ referenceMs: 100, workMs: 110 }]);
    const verdict = evaluateStudioCalibratedSampledBudget({
      label: "replayed pair",
      takeSample: source.takeSample,
      samples: 3,
      warmups: 2,
    });
    expect(verdict.ok, verdict.detail).toBe(true);
    expect(verdict.ratio).toBeCloseTo(1.1, 10);
    expect(verdict.passes).toHaveLength(1);
    // Warm-up samples are taken and thrown away, exactly like the closure form's warm-up work.
    expect(source.taken()).toBe(5);
  });

  it("makes a caller-timed violation earn itself across every pass", () => {
    // Alternating passes: the first violates, the second acquits, and the minimum of the two is
    // what the gate reports — the same refusal to convict on one reading.
    const source = replaying([
      { referenceMs: 100, workMs: 400 },
      { referenceMs: 100, workMs: 90 },
    ]);
    const verdict = evaluateStudioCalibratedSampledBudget({
      label: "alternating pairs",
      takeSample: source.takeSample,
      samples: 1,
      warmups: 0,
      passes: 2,
    });
    expect(verdict.ok, verdict.detail).toBe(true);
    expect(verdict.ratio).toBeCloseTo(0.9, 10);
    expect(verdict.passes).toHaveLength(2);
  });

  it("proves detection from a caller-timed seed without measuring again", () => {
    const source = replaying([{ referenceMs: 1, workMs: 1 }]);
    const seed = [reduceStudioPerfCalibrationSamples([{ referenceMs: 100, workMs: 100 }])];
    const detection = evaluateStudioCalibratedSampledDetection({
      label: "healthy caller-timed reading",
      takeSample: source.takeSample,
      seed,
      factor: 2,
      samples: 4,
      warmups: 2,
    });
    expect(detection.detected, detection.detail).toBe(true);
    expect(source.taken(), "a healthy seed must not cost another measurement").toBe(0);
  });

  it("re-measures a caller-timed attempt that failed to detect", () => {
    // The seeded attempt reads 0.5, where a doubling lands at 1.0 and the gate would acquit. The
    // failure has to be earned, so a whole second attempt is taken — and it detects.
    const source = replaying([{ referenceMs: 100, workMs: 100 }]);
    const starved = [reduceStudioPerfCalibrationSamples([{ referenceMs: 200, workMs: 100 }])];
    const detection = evaluateStudioCalibratedSampledDetection({
      label: "starved caller-timed reading",
      takeSample: source.takeSample,
      seed: starved,
      factor: 2,
      samples: 2,
      warmups: 1,
      passes: 1,
    });
    expect(detection.detected, detection.detail).toBe(true);
    expect(detection.passes[0]).toBe(starved[0]);
    expect(source.taken()).toBe(3);
  });
});
