import { describe, expect, it, vi } from "vitest";

import {
  planStudioWebGpuDabTileSpans,
  type StudioWebGpuDabTileBinningComputeExecutionResult,
  type StudioWebGpuDabTileBinningComputeRuntimeStats,
} from "./studio-webgpu-dab-tile-binning-compute";
import {
  createStudioGpuSparseBrushComputeRuntimeWithBoundary,
  studioGpuTouchedTilesFromDabSpans,
  type StudioGpuSparseBrushComputeBinningBoundary,
} from "./studio-webgpu-sparse-brush-compute-runtime";

interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fakeGpu() {
  const lost = deferred<GPUDeviceLostInfo>();
  const textures: Array<Readonly<{
    descriptor: GPUTextureDescriptor;
    texture: GPUTexture;
    view: GPUTextureView;
    destroy: ReturnType<typeof vi.fn>;
  }>> = [];
  const destroyDevice = vi.fn();
  const device = {
    lost: lost.promise,
    limits: { maxTextureDimension2D: 8_192 },
    createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
      const destroy = vi.fn();
      const view = { textureIndex: textures.length } as unknown as GPUTextureView;
      const texture = {
        createView: vi.fn(() => view),
        destroy,
      } as unknown as GPUTexture;
      textures.push({ descriptor, texture, view, destroy });
      return texture;
    }),
    destroy: destroyDevice,
  } as unknown as GPUDevice;
  return { device, lost, textures, destroyDevice };
}

function computeStats(
  overrides: Partial<StudioWebGpuDabTileBinningComputeRuntimeStats> = {},
): StudioWebGpuDabTileBinningComputeRuntimeStats {
  return {
    status: "ready",
    deviceEpoch: 1,
    executions: 0,
    spanCapacity: 0,
    tileCapacity: 0,
    referenceCapacity: 0,
    bufferAllocationEpoch: 0,
    ...overrides,
  };
}

function fakeBinningBoundary() {
  let executions = 0;
  let nextResult:
    | StudioWebGpuDabTileBinningComputeExecutionResult
    | null = null;
  const offsets = { label: "offsets" } as unknown as GPUBuffer;
  const indices = { label: "indices" } as unknown as GPUBuffer;
  const execute = vi.fn<StudioGpuSparseBrushComputeBinningBoundary["execute"]>(
    async (requestSequence, input, options) => {
      if (nextResult) {
        const result = nextResult;
        nextResult = null;
        return result;
      }
      const planned = planStudioWebGpuDabTileSpans(input);
      if (planned.status !== "ready") {
        return {
          status: "rejected",
          reason: planned.reason,
        } as StudioWebGpuDabTileBinningComputeExecutionResult;
      }
      executions += 1;
      return {
        status: "completed",
        receipt: {
          kind: "studio-webgpu-dab-tile-binning-compute-receipt",
          revision: 1,
          requestSequence,
          deviceEpoch: 1,
          tileCount: planned.plan.tileCount,
          dabCount: planned.plan.dabCount,
          referenceCount: planned.plan.referenceCount,
          countDispatches: planned.plan.dabCount > 0 ? 1 : 0,
          scanDispatches: 1,
          scatterDispatches:
            planned.plan.referenceCount > 0 ? planned.plan.tileCount : 0,
          queueState: "completed",
          complete: true,
        },
        output: {
          tileOffsetsBuffer: offsets,
          dabIndicesBuffer: indices,
          tileCount: planned.plan.tileCount,
          referenceCount: planned.plan.referenceCount,
        },
        readback: options?.readback
          ? {
              tileOffsets: new Uint32Array(planned.plan.tileCount + 1),
              dabIndices: new Uint32Array(planned.plan.referenceCount),
            }
          : null,
      };
    },
  );
  const dispose = vi.fn();
  const boundary: StudioGpuSparseBrushComputeBinningBoundary = {
    deviceEpoch: 1,
    execute,
    stats: () => computeStats({ executions }),
    dispose,
  };
  return {
    boundary,
    execute,
    dispose,
    offsets,
    indices,
    rejectNext(result: StudioWebGpuDabTileBinningComputeExecutionResult) {
      nextResult = result;
    },
  };
}

function frameInput(
  requestSequence = 1,
  overrides: Partial<{
    frameId: string;
    documentWidth: number;
    documentHeight: number;
    dabs: Array<{ x: number; y: number; radius: number }>;
    visibleTileIds: string[];
  }> = {},
) {
  return {
    frameId: `frame-${requestSequence}`,
    requestSequence,
    documentWidth: 384,
    documentHeight: 256,
    dabs: [
      { x: 64, y: 64, radius: 20 },
      { x: 128, y: 64, radius: 16 },
      { x: 300, y: 190, radius: 28 },
    ],
    ...overrides,
  };
}

function createRuntime(
  gpu = fakeGpu(),
  binning = fakeBinningBoundary(),
  options: Partial<{
    columns: number;
    rows: number;
    tileSize: number;
    bleed: number;
    ownsDevice: boolean;
  }> = {},
) {
  const created = createStudioGpuSparseBrushComputeRuntimeWithBoundary({
    device: gpu.device,
    columns: 2,
    rows: 2,
    tileSize: 128,
    bleed: 2,
    ...options,
  }, binning.boundary, true);
  if (created.status !== "ready") throw new Error(created.reason);
  return { gpu, binning, runtime: created.runtime };
}

describe("sparse WebGPU brush compute runtime", () => {
  it("derives a deterministic row-major touched-tile set without CPU CSR materialization", () => {
    const planned = planStudioWebGpuDabTileSpans(frameInput());
    expect(planned.status).toBe("ready");
    if (planned.status !== "ready") return;

    const all = studioGpuTouchedTilesFromDabSpans(planned.plan);
    expect(all && [...all]).toEqual([0, 1, 5]);
    const visible = studioGpuTouchedTilesFromDabSpans(
      planned.plan,
      new Set([1, 5]),
    );
    expect(visible && [...visible]).toEqual([1, 5]);
  });

  it("binds GPU CSR buffers and touched tiles to one transactional physical atlas frame", async () => {
    const target = createRuntime();
    const result = await target.runtime.prepareFrame(frameInput());
    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") return;

    expect(target.gpu.textures).toHaveLength(1);
    expect(target.gpu.textures[0]!.descriptor).toMatchObject({
      label: "Studio sparse compute RGBA16F brush atlas",
      size: { width: 264, height: 264, depthOrArrayLayers: 1 },
      format: "rgba16float",
    });
    expect(target.binning.execute).toHaveBeenCalledTimes(1);
    expect(target.binning.execute.mock.calls[0]?.[2]).toEqual({
      readback: false,
      signal: undefined,
    });
    expect(result.frame.binning.tileOffsetsBuffer).toBe(target.binning.offsets);
    expect(result.frame.binning.dabIndicesBuffer).toBe(target.binning.indices);
    expect(result.frame.tiles.map((tile) => tile.logicalTileId)).toEqual([
      "0:0",
      "1:0",
      "2:1",
    ]);
    expect(result.frame.tiles.map((tile) => tile.assignment.slot)).toEqual([0, 1, 2]);
    expect(result.frame.tiles[0]).toMatchObject({
      tileIndex: 0,
      allocationRect: { x: 0, y: 0, width: 132, height: 132 },
      contentRect: { x: 2, y: 2, width: 128, height: 128 },
      logicalRenderOrigin: { x: -2, y: -2 },
    });
    expect(result.frame.tiles[2]).toMatchObject({
      tileIndex: 5,
      contentRect: { width: 128, height: 128 },
    });
    expect(target.runtime.stats()).toMatchObject({
      status: "busy",
      activeFrameId: "frame-1",
      residentTiles: 0,
    });

    expect(target.runtime.completeFrame(result.frame.token)).toMatchObject({
      status: "completed",
      frameId: "frame-1",
      requestSequence: 1,
      residentTiles: 3,
    });
    expect(target.runtime.stats()).toMatchObject({
      status: "ready",
      residentTiles: 3,
      misses: 3,
    });
    target.runtime.dispose();
  });

  it("intersects a validated visibility set before reserving physical slots", async () => {
    const target = createRuntime();
    const result = await target.runtime.prepareFrame(frameInput(1, {
      visibleTileIds: ["1:0", "2:1"],
    }));
    expect(result.status).toBe("prepared");
    if (result.status !== "prepared") return;
    expect(result.frame.tiles.map((tile) => tile.logicalTileId)).toEqual([
      "1:0",
      "2:1",
    ]);
    target.runtime.abortFrame(result.frame.token);

    await expect(target.runtime.prepareFrame(frameInput(2, {
      visibleTileIds: ["3:0"],
    }))).resolves.toEqual({
      status: "rejected",
      reason: "invalid-visible-tiles",
    });
    target.runtime.dispose();
  });

  it("rolls back a tentative atlas mapping when compute rejects and accepts the next sequence", async () => {
    const target = createRuntime();
    target.binning.rejectNext({
      status: "rejected",
      reason: "stable-operation-budget",
    });
    await expect(target.runtime.prepareFrame(frameInput(1))).resolves.toEqual({
      status: "rejected",
      reason: "compute-rejected",
      detail: "stable-operation-budget",
    });
    expect(target.runtime.stats()).toMatchObject({
      status: "ready",
      residentTiles: 0,
      activeFrameId: null,
      lastRequestSequence: 1,
    });

    const next = await target.runtime.prepareFrame(frameInput(2));
    expect(next.status).toBe("prepared");
    if (next.status === "prepared") target.runtime.completeFrame(next.frame.token);
    target.runtime.dispose();
  });

  it("keeps output buffers leased until explicit settlement and rejects concurrent work", async () => {
    const target = createRuntime();
    const first = await target.runtime.prepareFrame(frameInput(1));
    expect(first.status).toBe("prepared");
    if (first.status !== "prepared") return;

    await expect(target.runtime.prepareFrame(frameInput(2))).resolves.toEqual({
      status: "rejected",
      reason: "busy",
    });
    expect(target.runtime.abortFrame(first.frame.token)).toMatchObject({
      status: "aborted",
      requestSequence: 1,
    });
    const second = await target.runtime.prepareFrame(frameInput(2));
    expect(second.status).toBe("prepared");
    if (second.status === "prepared") target.runtime.completeFrame(second.frame.token);
    target.runtime.dispose();
  });

  it("invalidates the active frame on device loss and releases owned resources exactly once", async () => {
    const target = createRuntime(
      fakeGpu(),
      fakeBinningBoundary(),
      { ownsDevice: true },
    );
    const prepared = await target.runtime.prepareFrame(frameInput());
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    const info = { reason: "unknown", message: "test loss" } as GPUDeviceLostInfo;
    target.gpu.lost.resolve(info);
    await Promise.resolve();
    expect(target.runtime.stats().status).toBe("device-lost");
    expect(target.runtime.completeFrame(prepared.frame.token)).toEqual({
      status: "rejected",
      reason: "device-lost",
    });

    target.runtime.dispose();
    target.runtime.dispose();
    expect(target.gpu.textures[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(target.gpu.destroyDevice).toHaveBeenCalledTimes(1);
    expect(target.binning.dispose).toHaveBeenCalledTimes(1);
  });
});
