import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_FILTER_LANE_COST_SEED,
  STUDIO_FILTER_LANE_MIN_MEASURED_SAMPLES,
  chooseLaneByCost,
  estimateLaneCostMs,
  gpuDispatchCountForChainSteps,
  megapixelsOf,
  type StudioFilterLane,
} from "./studio-filter-lane-cost-model";

/**
 * The seed constants are the whole point of this module, so they are pinned
 * against the benchmark they were distilled from rather than against
 * hand-copied numbers: if tests/benchmarks/results/filter-lanes.json is
 * re-measured and the model no longer reproduces its verdicts, this suite
 * fails and the constants must be re-derived.
 */

interface FilterLaneBenchmark {
  host: { cpu: string };
  generatedAt: string;
  config: { chains: Array<{ id: string; steps: string[] }> };
  crossover: {
    thresholdByChain: Array<{
      chain: string;
      gpuWinsFromSize: number;
      largestCpuWinSize: number;
    }>;
    costModelSeed: {
      byChain: Array<{
        chain: string;
        gpuDispatches: number;
        lanes: Record<string, { fixedMs: number; perMegapixelMs: number; r2: number }>;
      }>;
    };
    cells: Array<{ size: number; chain: string; gpuWins: boolean }>;
  };
}

const benchmark = JSON.parse(
  readFileSync(
    new URL("../../../../../../tests/benchmarks/results/filter-lanes.json", import.meta.url),
    "utf8",
  ),
) as FilterLaneBenchmark;

function stepsOf(chainId: string): number {
  const chain = benchmark.config.chains.find((entry) => entry.id === chainId);
  if (!chain) throw new Error(`unknown chain ${chainId}`);
  return chain.steps.length;
}

function dispatchesOf(chainId: string): number {
  const seed = benchmark.crossover.costModelSeed.byChain.find(
    (entry) => entry.chain === chainId,
  );
  if (!seed) throw new Error(`unknown chain seed ${chainId}`);
  return seed.gpuDispatches;
}

describe("filter lane cost model — seed provenance", () => {
  it("is pinned to the host and run the constants were measured on", () => {
    expect(STUDIO_FILTER_LANE_COST_SEED.measuredOn).toContain(benchmark.host.cpu);
    expect(STUDIO_FILTER_LANE_COST_SEED.measuredAt).toBe(benchmark.generatedAt);
    expect(STUDIO_FILTER_LANE_COST_SEED.source).toBe(
      "tests/benchmarks/results/filter-lanes.json",
    );
  });

  it("matches the least-squares fits in crossover.costModelSeed", () => {
    for (const chain of benchmark.crossover.costModelSeed.byChain) {
      const gpuFit = chain.lanes["gpu-fused-apply"];
      const cpuFit = chain.lanes["worker-cpu"];
      expect(gpuFit).toBeDefined();
      expect(cpuFit).toBeDefined();
      if (!gpuFit || !cpuFit) continue;
      // GPU: a size-independent floor near 2.4 ms plus ≈1.8 ms/MP throughput.
      expect(gpuFit.fixedMs).toBeCloseTo(STUDIO_FILTER_LANE_COST_SEED.gpu.fixedMs, 0);
      const modelledGpuPerMp =
        STUDIO_FILTER_LANE_COST_SEED.gpu.perMegapixelMs +
        STUDIO_FILTER_LANE_COST_SEED.gpu.perMegapixelMsPerDispatch * chain.gpuDispatches;
      expect(Math.abs(gpuFit.perMegapixelMs - modelledGpuPerMp)).toBeLessThan(0.35);
      // CPU: no real floor, and ≈3.7 ms/MP for every pass in the chain.
      expect(Math.abs(cpuFit.fixedMs)).toBeLessThan(1.5);
      const steps = stepsOf(chain.chain);
      const perStep = cpuFit.perMegapixelMs / steps;
      expect(perStep).toBeGreaterThan(3.5);
      expect(perStep).toBeLessThan(4.6);
    }
  });

  it("derives the measured GPU dispatch counts from the chain length", () => {
    for (const chain of benchmark.crossover.costModelSeed.byChain) {
      expect(gpuDispatchCountForChainSteps(stepsOf(chain.chain))).toBe(chain.gpuDispatches);
    }
    // Degenerate inputs never produce a zero-pass chain.
    expect(gpuDispatchCountForChainSteps(0)).toBe(1);
  });
});

describe("filter lane cost model — reproduces the measured verdicts", () => {
  it("agrees with gpuWins on every measured (size, chain) cell", () => {
    for (const cell of benchmark.crossover.cells) {
      const megapixels = megapixelsOf(cell.size * cell.size);
      const gpuMs = estimateLaneCostMs("gpu-chain", megapixels, dispatchesOf(cell.chain));
      const cpuMs = estimateLaneCostMs("worker", megapixels, stepsOf(cell.chain));
      expect({ size: cell.size, chain: cell.chain, gpuWins: gpuMs < cpuMs }).toEqual({
        size: cell.size,
        chain: cell.chain,
        gpuWins: cell.gpuWins,
      });
    }
  });

  it("puts each chain's crossover inside the measured step it was bracketed by", () => {
    for (const threshold of benchmark.crossover.thresholdByChain) {
      const steps = stepsOf(threshold.chain);
      const dispatches = dispatchesOf(threshold.chain);
      const cpuPerMp = STUDIO_FILTER_LANE_COST_SEED.cpu.perMegapixelMsPerStep * steps;
      const gpuPerMp =
        STUDIO_FILTER_LANE_COST_SEED.gpu.perMegapixelMs +
        STUDIO_FILTER_LANE_COST_SEED.gpu.perMegapixelMsPerDispatch * dispatches;
      const crossoverSide = Math.sqrt(
        (STUDIO_FILTER_LANE_COST_SEED.gpu.fixedMs / (cpuPerMp - gpuPerMp)) * 1e6,
      );
      expect(crossoverSide).toBeGreaterThan(threshold.largestCpuWinSize);
      expect(crossoverSide).toBeLessThanOrEqual(threshold.gpuWinsFromSize);
    }
  });

  it("charges the GPU lane a near-constant floor and the CPU lanes pure throughput", () => {
    const tiny = estimateLaneCostMs("gpu-chain", megapixelsOf(1), 1);
    const small = estimateLaneCostMs("gpu-chain", megapixelsOf(256 * 256), 1);
    expect(tiny).toBeCloseTo(STUDIO_FILTER_LANE_COST_SEED.gpu.fixedMs, 5);
    // 256² only adds ~0.12 ms on top of the floor — the floor dominates.
    expect(small - tiny).toBeLessThan(0.2);
    // CPU is linear in pixels × passes and has no floor to amortise.
    expect(estimateLaneCostMs("worker", megapixelsOf(1), 1)).toBeCloseTo(0, 5);
    expect(estimateLaneCostMs("worker", 2, 3)).toBeCloseTo(
      estimateLaneCostMs("worker", 1, 3) * 2,
      5,
    );
  });

  it("treats the CPU lanes as equal cost (they measured identical)", () => {
    expect(estimateLaneCostMs("konva-native", 4.2, 3)).toBe(
      estimateLaneCostMs("worker", 4.2, 3),
    );
  });

  it("rejects nonsense workloads instead of guessing", () => {
    expect(() => estimateLaneCostMs("gpu-chain", Number.NaN, 1)).toThrow(RangeError);
    expect(() => estimateLaneCostMs("worker", -1, 1)).toThrow(RangeError);
    expect(() => megapixelsOf(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("filter lane cost model — measured samples outrank the seed", () => {
  const candidates: StudioFilterLane[] = ["gpu-chain", "worker", "konva-native"];
  // 256² single-step: far below every measured crossover, so the seed puts the
  // CPU lanes first. This is exactly the workload the old boolean got wrong.
  const smallWorkload = { megapixels: megapixelsOf(256 * 256), chainSteps: 1 };

  it("falls back to the seed when nothing was measured", () => {
    const ranking = chooseLaneByCost(candidates, smallWorkload);
    expect(ranking.lanes).toEqual(["worker", "konva-native", "gpu-chain"]);
    expect(ranking.basis).toBe("seed");
    expect(ranking.entries.map((entry) => entry.lane)).toEqual(candidates);
    expect(ranking.entries.every((entry) => entry.samples === 0)).toBe(true);
  });

  it("prefers a device's own samples over the seed prior", () => {
    // A device where the GPU floor is far cheaper than the M2 Max seed says.
    const ranking = chooseLaneByCost(candidates, {
      ...smallWorkload,
      measured: (lane) =>
        lane === "gpu-chain"
          ? { warmP50Ms: 0.05, samples: 8 }
          : { warmP50Ms: 0.9, samples: 8 },
    });
    expect(ranking.lanes[0]).toBe("gpu-chain");
    expect(ranking.basis).toBe("measured");
    expect(ranking.entries[0]).toEqual({
      lane: "gpu-chain",
      costMs: 0.05,
      basis: "measured",
      samples: 8,
    });
  });

  it("ignores under-sampled and unusable measurements (noise guard)", () => {
    const thin = chooseLaneByCost(candidates, {
      ...smallWorkload,
      measured: () => ({
        warmP50Ms: 0.01,
        samples: STUDIO_FILTER_LANE_MIN_MEASURED_SAMPLES - 1,
      }),
    });
    expect(thin.basis).toBe("seed");
    expect(thin.lanes).toEqual(["worker", "konva-native", "gpu-chain"]);
    // Cold-only samples have no warm median — that is "no evidence", not zero.
    const coldOnly = chooseLaneByCost(candidates, {
      ...smallWorkload,
      measured: () => ({ warmP50Ms: null, samples: 50 }),
    });
    expect(coldOnly.basis).toBe("seed");
  });

  it("mixes tiers per lane and reports the mixed basis", () => {
    const ranking = chooseLaneByCost(candidates, {
      ...smallWorkload,
      measured: (lane) =>
        lane === "gpu-chain" ? { warmP50Ms: 0.02, samples: 5 } : null,
    });
    expect(ranking.basis).toBe("mixed");
    expect(ranking.lanes[0]).toBe("gpu-chain");
    expect(ranking.entries[1]?.basis).toBe("seed");
  });

  it("is a stable sort — equal-cost CPU lanes keep the planner's order", () => {
    const big = chooseLaneByCost(["worker", "konva-native"], {
      megapixels: megapixelsOf(4096 * 4096),
      chainSteps: 6,
    });
    expect(big.lanes).toEqual(["worker", "konva-native"]);
    const reversed = chooseLaneByCost(["konva-native", "worker"], {
      megapixels: megapixelsOf(4096 * 4096),
      chainSteps: 6,
    });
    expect(reversed.lanes).toEqual(["konva-native", "worker"]);
  });

  it("keeps the GPU lane at the head for large canvases (no regression)", () => {
    const ranking = chooseLaneByCost(candidates, {
      megapixels: megapixelsOf(4096 * 4096),
      chainSteps: 6,
    });
    expect(ranking.lanes).toEqual(["gpu-chain", "worker", "konva-native"]);
  });
});
