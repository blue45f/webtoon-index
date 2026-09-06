import { describe, expect, it, vi } from "vitest";

import {
  planStudioGpuDabTileBinning,
} from "./studio-webgpu-dab-tile-binning";
import {
  STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_DABS,
  STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_STABLE_TESTS,
  STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_TILES,
  STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS,
  STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL,
  createStudioWebGpuDabTileBinningComputeRuntime,
  planStudioWebGpuDabTileSpans,
} from "./studio-webgpu-dab-tile-binning-compute";

function materializeSpanPlan(
  plan: Extract<ReturnType<typeof planStudioWebGpuDabTileSpans>, { status: "ready" }>["plan"],
): Readonly<{ tileOffsets: Uint32Array; dabIndices: Uint32Array }> {
  const counts = new Uint32Array(plan.tileCount);
  for (let dabIndex = 0; dabIndex < plan.dabCount; dabIndex += 1) {
    const base = dabIndex * 4;
    const minimumColumn = plan.spans[base]!;
    if (minimumColumn === 0xffff_ffff) continue;
    const maximumColumn = plan.spans[base + 1]!;
    const minimumRow = plan.spans[base + 2]!;
    const maximumRow = plan.spans[base + 3]!;
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        counts[row * plan.columns + column] += 1;
      }
    }
  }
  const tileOffsets = new Uint32Array(plan.tileCount + 1);
  for (let tile = 0; tile < plan.tileCount; tile += 1) {
    tileOffsets[tile + 1] = tileOffsets[tile]! + counts[tile]!;
  }
  const cursors = tileOffsets.slice(0, plan.tileCount);
  const dabIndices = new Uint32Array(plan.referenceCount);
  for (let dabIndex = 0; dabIndex < plan.dabCount; dabIndex += 1) {
    const base = dabIndex * 4;
    const minimumColumn = plan.spans[base]!;
    if (minimumColumn === 0xffff_ffff) continue;
    const maximumColumn = plan.spans[base + 1]!;
    const minimumRow = plan.spans[base + 2]!;
    const maximumRow = plan.spans[base + 3]!;
    for (let row = minimumRow; row <= maximumRow; row += 1) {
      for (let column = minimumColumn; column <= maximumColumn; column += 1) {
        const tile = row * plan.columns + column;
        dabIndices[cursors[tile]!] = dabIndex;
        cursors[tile] += 1;
      }
    }
  }
  return { tileOffsets, dabIndices };
}

function deterministicDabs(count: number) {
  let state = 0x9e37_79b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  return Array.from({ length: count }, (_, index) => ({
    x: index % 17 === 0 ? -40 : random() * 1024,
    y: index % 29 === 0 ? 1100 : random() * 768,
    radius: 0.25 + random() * 96,
  }));
}

function fakeDevice() {
  const pipelines: GPUComputePipelineDescriptor[] = [];
  const device = {
    lost: new Promise<GPUDeviceLostInfo>(() => undefined),
    limits: {
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupStorageSize: 16_384,
    },
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
    createShaderModule: vi.fn(() => ({} as GPUShaderModule)),
    createComputePipeline: vi.fn((descriptor: GPUComputePipelineDescriptor) => {
      pipelines.push(descriptor);
      return { getBindGroupLayout: vi.fn() } as unknown as GPUComputePipeline;
    }),
    createBindGroup: vi.fn(() => ({} as GPUBindGroup)),
    destroy: vi.fn(),
  } as unknown as GPUDevice;
  return { device, pipelines };
}

describe("WebGPU dab tile binning compute candidate", () => {
  it("packs exact half-open spans that materialize to the CPU oracle", () => {
    const input = {
      documentWidth: 1024,
      documentHeight: 768,
      tileSize: 128,
      dabs: [
        { x: 128, y: 64, radius: 32 },
        { x: 256, y: 256, radius: 128 },
        { x: 0, y: 0, radius: 1 },
        { x: -1, y: 64, radius: 1 },
        { x: 1024, y: 768, radius: 1 },
        ...deterministicDabs(512),
      ],
    };
    const cpu = planStudioGpuDabTileBinning(input);
    const spans = planStudioWebGpuDabTileSpans(input);
    expect(cpu.status).toBe("ready");
    expect(spans.status).toBe("ready");
    if (cpu.status !== "ready" || spans.status !== "ready") return;
    const materialized = materializeSpanPlan(spans.plan);
    expect([...materialized.tileOffsets]).toEqual([...cpu.plan.tileOffsets]);
    expect([...materialized.dabIndices]).toEqual([...cpu.plan.dabIndices]);
    expect(spans.plan.referenceCount).toBe(cpu.plan.referenceCount);
  });

  it("rejects work outside the bounded exact stable-scatter envelope", () => {
    expect(planStudioWebGpuDabTileSpans({
      documentWidth: 128,
      documentHeight: 128,
      dabs: Array.from(
        { length: STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_DABS + 1 },
        () => ({ x: 1, y: 1, radius: 1 }),
      ),
    })).toEqual({ status: "rejected", reason: "dab-limit" });

    expect(planStudioWebGpuDabTileSpans({
      documentWidth:
        (STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_TILES + 1) * 128,
      documentHeight: 128,
      dabs: [],
    })).toEqual({ status: "rejected", reason: "tile-grid-limit" });

    expect(planStudioWebGpuDabTileSpans({
      documentWidth: 4096,
      documentHeight: 4096,
      tileSize: 64,
      dabs: Array.from({ length: 4097 }, () => ({
        x: 1024,
        y: 1024,
        radius: 1,
      })),
      maximumTiles: 4096,
    }, {
      maximumDabs: STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_DABS,
      maximumTiles: STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_TILES,
      maximumReferences: 262_144,
      maximumStableTests:
        STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_STABLE_TESTS,
    })).toEqual({
      status: "rejected",
      reason: "stable-operation-budget",
    });
  });

  it("contains independent count, full 4096-element scan, and stable scatter kernels", () => {
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_SCAN_ELEMENTS).toBe(4096);
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL.count).toContain(
      "atomicAdd(&tile_counts",
    );
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL.scan).toContain(
      "scratch[right] += scratch[left]",
    );
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL.scan).toContain(
      "tile_offsets[config.tile_count] = config.reference_count",
    );
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL.scatter).toContain(
      "output_cursor + local_offset",
    );
    expect(STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_WGSL.scatter).not.toContain(
      "atomicAdd",
    );
  });

  it("creates all three compute pipelines but no large buffers before admission", () => {
    const harness = fakeDevice();
    const created = createStudioWebGpuDabTileBinningComputeRuntime({
      device: harness.device,
    });
    expect(created.status).toBe("ready");
    expect(harness.pipelines).toHaveLength(3);
    expect(harness.pipelines.map((pipeline) => pipeline.label)).toEqual([
      "Studio dab tile binning count pipeline",
      "Studio dab tile binning scan pipeline",
      "Studio dab tile binning stable scatter pipeline",
    ]);
    if (created.status === "ready") created.runtime.dispose();
  });

  it("rejects impossible runtime limits before compiling shaders", () => {
    const harness = fakeDevice();
    expect(createStudioWebGpuDabTileBinningComputeRuntime({
      device: harness.device,
      maximumTiles: STUDIO_WEBGPU_DAB_TILE_BINNING_COMPUTE_MAX_TILES + 1,
    })).toEqual({ status: "rejected", reason: "invalid-options" });
    expect(harness.pipelines).toHaveLength(0);
  });

  it("rejects devices below the exact scan workgroup envelope", () => {
    const harness = fakeDevice();
    Object.assign(harness.device.limits, {
      maxComputeWorkgroupStorageSize: 8_192,
    });
    expect(createStudioWebGpuDabTileBinningComputeRuntime({
      device: harness.device,
    })).toEqual({ status: "rejected", reason: "invalid-options" });
    expect(harness.pipelines).toHaveLength(0);
  });

});
