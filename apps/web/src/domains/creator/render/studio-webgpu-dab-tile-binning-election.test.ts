import { describe, expect, it } from "vitest";

import {
  electStudioWebGpuDabTileBinningBackend,
  type StudioWebGpuDabTileBinningBenchmarkReport,
  type StudioWebGpuDabTileBinningTimingDistribution,
} from "./studio-webgpu-dab-tile-binning-election";

function timing(value: number): StudioWebGpuDabTileBinningTimingDistribution {
  return {
    samplesMs: Array.from({ length: 16 }, () => value),
    meanMs: value,
    p50Ms: value,
    p95Ms: value,
    p99Ms: value,
  };
}

function report(
  overrides: Partial<StudioWebGpuDabTileBinningBenchmarkReport> = {},
): StudioWebGpuDabTileBinningBenchmarkReport {
  return {
    kind: "studio-webgpu-dab-tile-binning-benchmark",
    revision: 1,
    environment: { userAgent: "test", adapterInfo: {} },
    workload: {
      dabCount: 4096,
      tileCount: 256,
      referenceCount: 8192,
      warmupIterations: 4,
      measuredIterations: 16,
    },
    cpu: timing(10),
    gpu: timing(8),
    parity: { offsetMismatches: 0, indexMismatches: 0 },
    diagnostics: {
      shaderCompilationMessages: 0,
      scopedGpuErrors: 0,
      uncapturedGpuErrors: 0,
    },
    ...overrides,
  };
}

describe("WebGPU dab tile binning promotion gate", () => {
  it("promotes only an exact materially faster browser result", () => {
    expect(electStudioWebGpuDabTileBinningBackend(report())).toMatchObject({
      selected: "webgpu-compute",
      promoted: true,
      reasons: [],
    });
  });

  it("keeps the CPU oracle on a single CSR mismatch", () => {
    const candidate = report();
    expect(electStudioWebGpuDabTileBinningBackend(report({
      parity: { ...candidate.parity, indexMismatches: 1 },
    }))).toMatchObject({
      selected: "cpu-oracle",
      promoted: false,
      reasons: ["csr-parity"],
    });
  });

  it("does not let a faster median hide a p95 regression", () => {
    const candidate = report();
    const result = electStudioWebGpuDabTileBinningBackend(report({
      gpu: { ...candidate.gpu, p50Ms: 5, p95Ms: 9, p99Ms: 9 },
    }));
    expect(result.selected).toBe("cpu-oracle");
    expect(result.reasons).toContain("p95");
  });

  it("fails closed on missing evidence or GPU diagnostics", () => {
    expect(electStudioWebGpuDabTileBinningBackend(null)).toMatchObject({
      selected: "cpu-oracle",
      reasons: ["missing-or-invalid-report"],
    });
    const candidate = report();
    const result = electStudioWebGpuDabTileBinningBackend(report({
      diagnostics: {
        ...candidate.diagnostics,
        shaderCompilationMessages: 1,
      },
    }));
    expect(result.selected).toBe("cpu-oracle");
    expect(result.reasons).toContain("shader-diagnostics");
  });
});
