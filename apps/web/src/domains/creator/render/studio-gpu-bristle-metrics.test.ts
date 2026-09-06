import { describe, expect, it } from "vitest";

import {
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE,
  STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT,
  STUDIO_GPU_BRISTLE_TIP_LAG_FLOOR_RATIO,
  STUDIO_GPU_BRISTLE_TOLERANCES,
} from "./studio-gpu-bristle-contract";
import {
  STUDIO_GPU_BRISTLE_METRICS_VERSION,
  StudioGpuBristleMetricsError,
  judgeStudioGpuBristleConstraintSatisfaction,
  judgeStudioGpuBristlePigmentConservation,
  judgeStudioGpuBristleSplayRecovery,
  judgeStudioGpuBristleTerminalLoadDistribution,
  judgeStudioGpuBristleTipLag,
  studioGpuBristleDepositedSplatCount,
  studioGpuBristleFailures,
  studioGpuBristleKolmogorovSmirnov,
  studioGpuBristleMaxEdgeViolation,
  studioGpuBristleSplatCoverage,
  studioGpuBristleSplayRecoveryTau,
  studioGpuBristleStandardDeviation,
  studioGpuBristleTerminalLoads,
  studioGpuBristleTipLag,
  type StudioGpuBristleStateShape,
} from "./studio-gpu-bristle-metrics";

const VERTICES = 10;
const REST = 5;

/** One bristle laid straight down the z axis with the given per-edge length. */
function straightChain(edgeLength: number, bristleCount = 1): Float64Array {
  const state = new Float64Array(bristleCount * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE);
  for (let bristle = 0; bristle < bristleCount; bristle += 1) {
    const base = bristle * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE;
    for (let vertex = 0; vertex < VERTICES; vertex += 1) {
      const slot = base + vertex * 4;
      state[slot] = bristle * 100;
      state[slot + 1] = 0;
      state[slot + 2] = -vertex * edgeLength;
      state[slot + 3] = 1;
    }
  }
  return state;
}

function shape(bristleCount = 1, restLengths: ArrayLike<number> | number = REST) {
  return { bristleCount, verticesPerBristle: VERTICES, restLengths } satisfies
    StudioGpuBristleStateShape;
}

function splatBuffer(
  records: readonly { weight: number; radius: number; ax?: number; bx?: number }[],
): Float64Array {
  const buffer = new Float64Array(records.length * STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT);
  records.forEach((record, index) => {
    const slot = index * STUDIO_GPU_BRISTLE_COMPONENTS_PER_SPLAT;
    buffer[slot] = record.ax ?? 0;
    buffer[slot + 2] = record.bx ?? record.ax ?? 0;
    buffer[slot + 4] = 1;
    buffer[slot + 7] = record.weight;
    buffer[slot + 8] = record.radius;
    buffer[slot + 9] = record.weight;
  });
  return buffer;
}

describe("studio-gpu-bristle-metrics constraint satisfaction", () => {
  it("reports zero stretch on an exactly satisfied chain", () => {
    expect(studioGpuBristleMaxEdgeViolation(straightChain(REST), shape())).toBe(0);
    expect(judgeStudioGpuBristleConstraintSatisfaction(straightChain(REST), shape()).pass).toBe(
      true,
    );
  });

  it("reports the relative stretch and fails past the declared slack", () => {
    const stretched = straightChain(REST * 1.05);
    expect(studioGpuBristleMaxEdgeViolation(stretched, shape())).toBeCloseTo(0.05, 10);
    const judgement = judgeStudioGpuBristleConstraintSatisfaction(stretched, shape());
    expect(judgement.pass).toBe(false);
    expect(judgement.threshold).toBe(STUDIO_GPU_BRISTLE_TOLERANCES.constraintSlack);
  });

  it("accepts a per-bristle rest length array", () => {
    const state = new Float64Array(2 * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE);
    state.set(straightChain(4).subarray(0, STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE), 0);
    state.set(
      straightChain(9).subarray(0, STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE),
      STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE,
    );
    expect(studioGpuBristleMaxEdgeViolation(state, shape(2, [4, 9]))).toBe(0);
    expect(studioGpuBristleMaxEdgeViolation(state, shape(2, 4))).toBeCloseTo(1.25, 10);
  });

  it("refuses a truncated state buffer rather than reading past the end", () => {
    expect(() => studioGpuBristleMaxEdgeViolation(new Float64Array(4), shape())).toThrow(
      StudioGpuBristleMetricsError,
    );
  });
});

describe("studio-gpu-bristle-metrics deposit conservation", () => {
  it("sums weight × π r² over occupied slots only", () => {
    const buffer = splatBuffer([
      { weight: 0.5, radius: 2 },
      { weight: 0, radius: 9 },
      { weight: 0.25, radius: 4 },
    ]);
    expect(studioGpuBristleSplatCoverage(buffer)).toBeCloseTo(
      0.5 * Math.PI * 4 + 0.25 * Math.PI * 16,
      10,
    );
    expect(studioGpuBristleDepositedSplatCount(buffer)).toBe(2);
  });

  it("passes on a repeat and fails when a splat goes missing", () => {
    const reference = splatBuffer([
      { weight: 0.4, radius: 3 },
      { weight: 0.4, radius: 3 },
      { weight: 0.4, radius: 3 },
    ]);
    expect(judgeStudioGpuBristlePigmentConservation(reference, reference).pass).toBe(true);
    const dropped = splatBuffer([
      { weight: 0.4, radius: 3 },
      { weight: 0, radius: 3 },
      { weight: 0.4, radius: 3 },
    ]);
    const judgement = judgeStudioGpuBristlePigmentConservation(dropped, reference);
    expect(judgement.pass).toBe(false);
    expect(judgement.threshold).toBe(STUDIO_GPU_BRISTLE_TOLERANCES.pigmentConservation);
  });

  it("treats paint appearing out of an empty reference as an infinite miss", () => {
    const judgement = judgeStudioGpuBristlePigmentConservation(
      splatBuffer([{ weight: 1, radius: 1 }]),
      splatBuffer([{ weight: 0, radius: 1 }]),
    );
    expect(judgement.pass).toBe(false);
    expect(judgement.value).toBe(Number.POSITIVE_INFINITY);
  });

  it("refuses a splat buffer that is not a whole number of records", () => {
    expect(() => studioGpuBristleSplatCoverage(new Float64Array(13))).toThrow(
      StudioGpuBristleMetricsError,
    );
  });
});

describe("studio-gpu-bristle-metrics tip lag", () => {
  it("measures the perpendicular offset of a tip trailing a straight root path", () => {
    const root = new Float64Array(20);
    const tip = new Float64Array(20);
    for (let index = 0; index < 10; index += 1) {
      root[index * 2] = index * 4;
      root[index * 2 + 1] = 0;
      tip[index * 2] = index * 4;
      tip[index * 2 + 1] = 3;
    }
    expect(studioGpuBristleTipLag(root, tip)).toBeCloseTo(3, 10);
  });

  it("returns zero when the tip sits exactly on the swept path", () => {
    const root = Float64Array.from([0, 0, 5, 0, 10, 0]);
    expect(studioGpuBristleTipLag(root, root)).toBe(0);
  });

  it("rejects a degenerate chain even when the reference degenerated the same way", () => {
    const bristleLengthPx = 67.5;
    const floor = STUDIO_GPU_BRISTLE_TIP_LAG_FLOOR_RATIO * bristleLengthPx;
    // A one-vertex hair snaps to a closed-form offset and reports almost no lag. Two of them agree
    // with each other perfectly, so only the absolute floor can see the degeneration.
    const degenerate = judgeStudioGpuBristleTipLag(floor * 0.5, floor * 0.5, bristleLengthPx);
    expect(degenerate.pass).toBe(false);
    expect(degenerate.detail).toContain("degenerate-chain floor");
    expect(judgeStudioGpuBristleTipLag(20, 20, bristleLengthPx).pass).toBe(true);
  });

  it("fails outside the pinned band", () => {
    const bristleLengthPx = 67.5;
    expect(judgeStudioGpuBristleTipLag(20 * 1.05, 20, bristleLengthPx).pass).toBe(true);
    expect(judgeStudioGpuBristleTipLag(20 * 1.4, 20, bristleLengthPx).pass).toBe(false);
  });

  it("refuses mismatched traces", () => {
    expect(() => studioGpuBristleTipLag(new Float64Array(4), new Float64Array(6))).toThrow(
      StudioGpuBristleMetricsError,
    );
  });
});

describe("studio-gpu-bristle-metrics splay recovery", () => {
  it("recovers the time constant of a decaying series", () => {
    const tau = 0.05;
    const dt = 1 / 240;
    const samples = 400;
    const spread = new Float64Array(samples);
    const dtSeconds = new Float64Array(samples).fill(dt);
    for (let index = 0; index < samples; index += 1) {
      spread[index] = index < 100 ? 30 : 10 + 20 * Math.exp(-((index - 100) * dt) / tau);
    }
    expect(studioGpuBristleSplayRecoveryTau(spread, dtSeconds, 100)).toBeCloseTo(tau, 3);
  });

  it("returns the whole observed duration when the series never relaxes", () => {
    const spread = Float64Array.from([10, 10, 10, 10]);
    const dtSeconds = Float64Array.from([0.01, 0.01, 0.01, 0.01]);
    // Deviation is already zero, so there is nothing to relax.
    expect(studioGpuBristleSplayRecoveryTau(spread, dtSeconds, 0)).toBe(0);
    const stuck = Float64Array.from([30, 30, 30, 30]);
    expect(studioGpuBristleSplayRecoveryTau(stuck, dtSeconds, 0)).toBe(0);
  });

  it("judges against the declared tolerance", () => {
    expect(judgeStudioGpuBristleSplayRecovery(0.052, 0.05).pass).toBe(true);
    expect(judgeStudioGpuBristleSplayRecovery(0.1, 0.05).pass).toBe(false);
    expect(judgeStudioGpuBristleSplayRecovery(0.05, 0.05).threshold).toBe(
      STUDIO_GPU_BRISTLE_TOLERANCES.splayRecoveryTau,
    );
  });

  it("refuses a step index outside the series", () => {
    expect(() =>
      studioGpuBristleSplayRecoveryTau(new Float64Array(4), new Float64Array(4), 9),
    ).toThrow(StudioGpuBristleMetricsError);
  });
});

describe("studio-gpu-bristle-metrics distributions", () => {
  it("computes a two-sample Kolmogorov–Smirnov statistic", () => {
    const sample = Float64Array.from([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    expect(studioGpuBristleKolmogorovSmirnov(sample, sample)).toBe(0);
    expect(
      studioGpuBristleKolmogorovSmirnov(
        Float64Array.from([0, 0, 0, 0]),
        Float64Array.from([1, 1, 1, 1]),
      ),
    ).toBe(1);
    const shifted = Float64Array.from(sample, (value) => value + 0.3);
    expect(studioGpuBristleKolmogorovSmirnov(sample, shifted)).toBeCloseTo(0.3, 10);
  });

  it("fails the terminal-load gate when the tuft collapses to a uniform rake", () => {
    const varied = Float64Array.from({ length: 44 }, (_unused, index) => 0.4 + index / 200);
    const uniform = new Float64Array(44).fill(0.4);
    expect(judgeStudioGpuBristleTerminalLoadDistribution(varied, varied).pass).toBe(true);
    const judgement = judgeStudioGpuBristleTerminalLoadDistribution(uniform, varied);
    expect(judgement.pass).toBe(false);
    expect(judgement.threshold).toBe(STUDIO_GPU_BRISTLE_TOLERANCES.terminalLoadKs);
  });

  it("reads terminal load out of the tip vertex", () => {
    const state = straightChain(REST, 3);
    for (let bristle = 0; bristle < 3; bristle += 1) {
      state[bristle * STUDIO_GPU_BRISTLE_COMPONENTS_PER_BRISTLE + (VERTICES - 1) * 4 + 3] =
        0.25 * (bristle + 1);
    }
    expect(Array.from(studioGpuBristleTerminalLoads(state, shape(3)))).toEqual([0.25, 0.5, 0.75]);
  });

  it("measures population spread", () => {
    expect(studioGpuBristleStandardDeviation([1, 1, 1, 1])).toBe(0);
    expect(studioGpuBristleStandardDeviation([2, 4])).toBeCloseTo(1, 10);
    expect(studioGpuBristleStandardDeviation([])).toBe(0);
  });

  it("refuses an empty sample", () => {
    expect(() => studioGpuBristleKolmogorovSmirnov([], [1])).toThrow(
      StudioGpuBristleMetricsError,
    );
  });
});

describe("studio-gpu-bristle-metrics reporting", () => {
  it("returns only failures, worst overshoot first", () => {
    const judgements = [
      { metric: "a", value: 0.01, threshold: 0.02, pass: true, detail: "" },
      { metric: "b", value: 0.06, threshold: 0.02, pass: false, detail: "" },
      { metric: "c", value: 0.2, threshold: 0.02, pass: false, detail: "" },
    ];
    expect(studioGpuBristleFailures(judgements).map((entry) => entry.metric)).toEqual(["c", "b"]);
    expect(STUDIO_GPU_BRISTLE_METRICS_VERSION).toBe("studio-gpu-bristle-metrics-v1");
  });
});
