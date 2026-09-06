/**
 * Real Chromium evidence boundary for the bounded exact WebGPU dab tile-binning candidate.
 */
import {
  planStudioGpuDabTileBinning,
  type StudioGpuDabTileBinningInput,
} from "../apps/web/src/domains/creator/render/studio-webgpu-dab-tile-binning";
import {
  STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL,
  createStudioWebGpuDabTileBinningComputeRuntime,
  studioWebGpuDabTileBinningMatchesCpuOracle,
  type StudioWebGpuDabTileBinningComputeRuntimeStats,
} from "../apps/web/src/domains/creator/render/studio-webgpu-dab-tile-binning-compute";
import {
  electStudioWebGpuDabTileBinningBackend,
  type StudioWebGpuDabTileBinningBenchmarkReport,
  type StudioWebGpuDabTileBinningTimingDistribution,
} from "../apps/web/src/domains/creator/render/studio-webgpu-dab-tile-binning-election";

const WARMUP_ITERATIONS = 4;
const MEASURED_ITERATIONS = 16;
const WAIT_TIMEOUT_MS = 120_000;

interface ShaderMessageEvidence {
  readonly source: string;
  readonly type: string;
  readonly message: string;
  readonly lineNum: number;
  readonly linePos: number;
}

interface CaseEvidence {
  readonly id: string;
  readonly dabCount: number;
  readonly tileCount: number;
  readonly referenceCount: number;
  readonly offsetMismatches: number;
  readonly indexMismatches: number;
}

interface AdapterEvidence {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly isFallbackAdapter: boolean | null;
}

type BrowserResult =
  | Readonly<{
      status: "ok";
      capabilities: {
        webgpu: true;
        userAgent: string;
      };
      adapter: AdapterEvidence;
      cases: readonly CaseEvidence[];
      benchmark: StudioWebGpuDabTileBinningBenchmarkReport;
      election: ReturnType<typeof electStudioWebGpuDabTileBinningBackend>;
      shaderMessages: readonly ShaderMessageEvidence[];
      scopedGpuErrors: readonly string[];
      uncapturedGpuErrors: readonly string[];
      runtimeStats: Readonly<StudioWebGpuDabTileBinningComputeRuntimeStats>;
      timeoutMilliseconds: number;
    }>
  | Readonly<{
      status: "unsupported";
      reason: string;
      capabilities: { webgpu: false; userAgent: string };
    }>
  | Readonly<{
      status: "error";
      message: string;
      stack: string | null;
      capabilities: { webgpu: boolean; userAgent: string };
    }>;

declare global {
  interface Window {
    __studioWebGpuDabTileBinningComputeResult?: BrowserResult;
  }
}

function deterministicDabs(count: number, width: number, height: number) {
  let state = 0x6d2b_79f5;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  return Array.from({ length: count }, (_, index) => ({
    x: index % 31 === 0 ? -64 : random() * width,
    y: index % 47 === 0 ? height + 48 : random() * height,
    radius: 0.5 + random() * 72,
  }));
}

function cases(): readonly Readonly<{
  id: string;
  input: StudioGpuDabTileBinningInput;
}>[] {
  return [
    {
      id: "half-open-boundaries",
      input: {
        documentWidth: 512,
        documentHeight: 384,
        tileSize: 128,
        dabs: [
          { x: 0, y: 0, radius: 1 },
          { x: -1, y: 64, radius: 1 },
          { x: 128, y: 64, radius: 32 },
          { x: 256, y: 256, radius: 128 },
          { x: 512, y: 384, radius: 1 },
          { x: 513, y: 128, radius: 1 },
        ],
      },
    },
    {
      id: "seeded-random",
      input: {
        documentWidth: 1024,
        documentHeight: 768,
        tileSize: 128,
        dabs: deterministicDabs(1024, 1024, 768),
      },
    },
    {
      id: "dense-cross-tile",
      input: {
        documentWidth: 2048,
        documentHeight: 2048,
        tileSize: 128,
        dabs: deterministicDabs(2048, 2048, 2048),
      },
    },
  ];
}

function mismatchCount(left: Readonly<Uint32Array>, right: Readonly<Uint32Array>): number {
  let mismatches = Math.abs(left.length - right.length);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) mismatches += 1;
  }
  return mismatches;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[position]!;
}

function distribution(samples: readonly number[]): StudioWebGpuDabTileBinningTimingDistribution {
  const sorted = [...samples].sort((left, right) => left - right);
  return Object.freeze({
    samplesMs: Object.freeze([...samples]),
    meanMs: samples.reduce((total, value) => total + value, 0) / samples.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
  });
}

function adapterEvidence(adapter: GPUAdapter): AdapterEvidence {
  const info = adapter.info;
  return Object.freeze({
    vendor: info?.vendor ?? "",
    architecture: info?.architecture ?? "",
    device: info?.device ?? "",
    description: info?.description ?? "",
    isFallbackAdapter:
      typeof adapter.isFallbackAdapter === "boolean"
        ? adapter.isFallbackAdapter
        : null,
  });
}

async function compilationMessages(
  device: GPUDevice,
): Promise<readonly ShaderMessageEvidence[]> {
  const messages: ShaderMessageEvidence[] = [];
  for (const [source, code] of Object.entries(
    STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL,
  )) {
    const module = device.createShaderModule({
      label: `Verifier ${source} shader`,
      code,
    });
    const info = await module.getCompilationInfo();
    for (const message of info.messages) {
      messages.push({
        source,
        type: message.type,
        message: message.message,
        lineNum: message.lineNum,
        linePos: message.linePos,
      });
    }
  }
  return Object.freeze(messages);
}

async function observe(): Promise<BrowserResult> {
  const userAgent = navigator.userAgent;
  if (!navigator.gpu) {
    return Object.freeze({
      status: "unsupported",
      reason: "navigator.gpu-unavailable",
      capabilities: { webgpu: false, userAgent },
    });
  }
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    return Object.freeze({
      status: "unsupported",
      reason: "adapter-unavailable",
      capabilities: { webgpu: false, userAgent },
    });
  }
  const device = await adapter.requestDevice();
  const uncapturedGpuErrors: string[] = [];
  device.addEventListener("uncapturederror", (event) => {
    uncapturedGpuErrors.push(event.error.message);
  });
  const shaderMessages = await compilationMessages(device);
  device.pushErrorScope("internal");
  device.pushErrorScope("out-of-memory");
  device.pushErrorScope("validation");
  const created = createStudioWebGpuDabTileBinningComputeRuntime({ device });
  if (created.status !== "ready") {
    throw new Error(`runtime creation failed: ${created.reason}`);
  }
  const runtime = created.runtime;
  let requestSequence = 0;
  const caseEvidence: CaseEvidence[] = [];
  try {
    for (const candidate of cases()) {
      const cpu = planStudioGpuDabTileBinning(candidate.input);
      if (cpu.status !== "ready") {
        throw new Error(`${candidate.id}: CPU oracle rejected: ${cpu.reason}`);
      }
      const result = await runtime.execute(
        ++requestSequence,
        candidate.input,
        { readback: true },
      );
      if (result.status !== "completed" || !result.readback) {
        throw new Error(`${candidate.id}: GPU candidate failed: ${JSON.stringify(result)}`);
      }
      caseEvidence.push(Object.freeze({
        id: candidate.id,
        dabCount: cpu.plan.dabCount,
        tileCount: cpu.plan.tileCount,
        referenceCount: cpu.plan.referenceCount,
        offsetMismatches: mismatchCount(
          result.readback.tileOffsets,
          cpu.plan.tileOffsets,
        ),
        indexMismatches: mismatchCount(
          result.readback.dabIndices,
          cpu.plan.dabIndices,
        ),
      }));
    }

    const benchmarkInput: StudioGpuDabTileBinningInput = {
      documentWidth: 2048,
      documentHeight: 2048,
      tileSize: 128,
      dabs: deterministicDabs(4096, 2048, 2048),
    };
    const benchmarkOracle = planStudioGpuDabTileBinning(benchmarkInput);
    if (benchmarkOracle.status !== "ready") {
      throw new Error(`benchmark CPU oracle rejected: ${benchmarkOracle.reason}`);
    }
    for (let index = 0; index < WARMUP_ITERATIONS; index += 1) {
      planStudioGpuDabTileBinning(benchmarkInput);
      const result = await runtime.execute(++requestSequence, benchmarkInput);
      if (result.status !== "completed") {
        throw new Error(`GPU warmup failed: ${JSON.stringify(result)}`);
      }
    }
    const cpuSamples: number[] = [];
    const gpuSamples: number[] = [];
    for (let index = 0; index < MEASURED_ITERATIONS; index += 1) {
      let started = performance.now();
      const cpu = planStudioGpuDabTileBinning(benchmarkInput);
      cpuSamples.push(performance.now() - started);
      if (cpu.status !== "ready") {
        throw new Error(`CPU benchmark failed: ${cpu.reason}`);
      }
      started = performance.now();
      const gpu = await runtime.execute(++requestSequence, benchmarkInput);
      gpuSamples.push(performance.now() - started);
      if (gpu.status !== "completed") {
        throw new Error(`GPU benchmark failed: ${JSON.stringify(gpu)}`);
      }
    }

    const finalParity = await runtime.execute(
      ++requestSequence,
      benchmarkInput,
      { readback: true },
    );
    if (finalParity.status !== "completed" || !finalParity.readback) {
      throw new Error(`final GPU parity failed: ${JSON.stringify(finalParity)}`);
    }
    if (!studioWebGpuDabTileBinningMatchesCpuOracle(
      finalParity.readback,
      benchmarkOracle.plan,
    )) {
      throw new Error("final GPU parity did not match CPU oracle");
    }

    const scopedGpuErrors = (
      await Promise.all([
        device.popErrorScope(),
        device.popErrorScope(),
        device.popErrorScope(),
      ])
    ).filter((error): error is GPUError => error !== null)
      .map((error) => error.message);
    const totalOffsetMismatches = caseEvidence.reduce(
      (total, evidence) => total + evidence.offsetMismatches,
      0,
    ) + mismatchCount(
      finalParity.readback.tileOffsets,
      benchmarkOracle.plan.tileOffsets,
    );
    const totalIndexMismatches = caseEvidence.reduce(
      (total, evidence) => total + evidence.indexMismatches,
      0,
    ) + mismatchCount(
      finalParity.readback.dabIndices,
      benchmarkOracle.plan.dabIndices,
    );
    const report: StudioWebGpuDabTileBinningBenchmarkReport = Object.freeze({
      kind: "studio-webgpu-dab-tile-binning-benchmark",
      revision: 1,
      environment: {
        userAgent,
        adapterInfo: adapterEvidence(adapter),
      },
      workload: {
        dabCount: benchmarkOracle.plan.dabCount,
        tileCount: benchmarkOracle.plan.tileCount,
        referenceCount: benchmarkOracle.plan.referenceCount,
        warmupIterations: WARMUP_ITERATIONS,
        measuredIterations: MEASURED_ITERATIONS,
      },
      cpu: distribution(cpuSamples),
      gpu: distribution(gpuSamples),
      parity: {
        offsetMismatches: totalOffsetMismatches,
        indexMismatches: totalIndexMismatches,
      },
      diagnostics: {
        shaderCompilationMessages: shaderMessages.length,
        scopedGpuErrors: scopedGpuErrors.length,
        uncapturedGpuErrors: uncapturedGpuErrors.length,
      },
    });
    return Object.freeze({
      status: "ok",
      capabilities: { webgpu: true, userAgent },
      adapter: adapterEvidence(adapter),
      cases: Object.freeze(caseEvidence),
      benchmark: report,
      election: electStudioWebGpuDabTileBinningBackend(report),
      shaderMessages,
      scopedGpuErrors,
      uncapturedGpuErrors: Object.freeze(uncapturedGpuErrors),
      runtimeStats: runtime.stats(),
      timeoutMilliseconds: WAIT_TIMEOUT_MS,
    });
  } finally {
    runtime.dispose();
    device.destroy();
  }
}

void observe()
  .then((result) => {
    window.__studioWebGpuDabTileBinningComputeResult = result;
  })
  .catch((error: unknown) => {
    window.__studioWebGpuDabTileBinningComputeResult = Object.freeze({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
      capabilities: {
        webgpu: typeof navigator.gpu !== "undefined",
        userAgent: navigator.userAgent,
      },
    });
  });
