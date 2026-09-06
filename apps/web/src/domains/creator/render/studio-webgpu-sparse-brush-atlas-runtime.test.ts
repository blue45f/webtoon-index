import { describe, expect, it, vi } from "vitest";

import {
  createStudioGpuSparseBrushAtlasRuntime,
  STUDIO_GPU_SPARSE_BRUSH_ATLAS_USAGE,
  type StudioGpuSparseBrushAtlasRuntimeOptions,
} from "./studio-webgpu-sparse-brush-atlas-runtime";

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

function fakeDevice() {
  const lost = deferred<GPUDeviceLostInfo>();
  const destroyTexture = vi.fn();
  const destroyDevice = vi.fn();
  const view = { atlasView: true } as unknown as GPUTextureView;
  const texture = {
    createView: vi.fn(() => view),
    destroy: destroyTexture,
  } as unknown as GPUTexture;
  const createTexture = vi.fn(() => texture);
  const device = {
    limits: { maxTextureDimension2D: 4_096 },
    lost: lost.promise,
    createTexture,
    destroy: destroyDevice,
  } as unknown as GPUDevice;
  return {
    device,
    lost,
    texture,
    view,
    createTexture,
    destroyTexture,
    destroyDevice,
  };
}

function runtime(
  gpu: ReturnType<typeof fakeDevice>,
  overrides: Partial<Omit<StudioGpuSparseBrushAtlasRuntimeOptions, "device">> = {},
) {
  const created = createStudioGpuSparseBrushAtlasRuntime({
    device: gpu.device,
    columns: 2,
    rows: 1,
    tileSize: 128,
    bleed: 2,
    ...overrides,
  });
  expect(created.status).toBe("ready");
  if (created.status !== "ready") throw new Error(created.reason);
  return created.runtime;
}

describe("Studio WebGPU sparse brush atlas runtime", () => {
  it("allocates one RGBA16F texture and maps every logical tile into that resource", () => {
    const gpu = fakeDevice();
    const target = runtime(gpu);

    expect(gpu.createTexture).toHaveBeenCalledTimes(1);
    expect(gpu.createTexture).toHaveBeenCalledWith({
      label: "Studio sparse physical RGBA16F brush atlas",
      size: { width: 264, height: 132, depthOrArrayLayers: 1 },
      format: "rgba16float",
      usage: STUDIO_GPU_SPARSE_BRUSH_ATLAS_USAGE,
    });
    const prepared = target.prepareFrame({
      frameId: "frame-1",
      documentWidth: 256,
      documentHeight: 128,
      dabs: [
        { x: 64, y: 64, radius: 8 },
        { x: 192, y: 64, radius: 8 },
      ],
    });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    expect(prepared.frame.texture).toBe(gpu.texture);
    expect(prepared.frame.view).toBe(gpu.view);
    expect(prepared.frame.tiles).toHaveLength(2);
    expect(prepared.frame.tiles.map((tile) => ({
      id: tile.logicalTileId,
      allocation: tile.allocationRect,
      content: tile.contentRect,
      origin: tile.logicalRenderOrigin,
    }))).toEqual([
      {
        id: "0:0",
        allocation: { x: 0, y: 0, width: 132, height: 132 },
        content: { x: 2, y: 2, width: 128, height: 128 },
        origin: { x: -2, y: -2 },
      },
      {
        id: "1:0",
        allocation: { x: 132, y: 0, width: 132, height: 132 },
        content: { x: 134, y: 2, width: 128, height: 128 },
        origin: { x: 126, y: -2 },
      },
    ]);
    expect(prepared.frame.tiles[1]!.contentUv).toEqual({
      minimumU: 134 / 264,
      minimumV: 2 / 132,
      maximumU: 262 / 264,
      maximumV: 130 / 132,
    });
    expect(target.completeFrame(prepared.frame.token).status).toBe("completed");
    expect(target.stats()).toMatchObject({
      status: "ready",
      atlasWidth: 264,
      atlasHeight: 132,
      textureBytes: 264 * 132 * 8,
      residentTiles: 2,
    });
  });

  it("clips the content rectangle for partial document-edge tiles", () => {
    const gpu = fakeDevice();
    const target = runtime(gpu);
    const prepared = target.prepareFrame({
      frameId: "edge",
      documentWidth: 180,
      documentHeight: 80,
      dabs: [{ x: 170, y: 70, radius: 8 }],
    });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    // Logical tile 1:0 is the only resident tile, so sparse allocation places it in physical slot 0.
    expect(prepared.frame.tiles[0]).toMatchObject({
      logicalTileId: "1:0",
      contentRect: {
        x: 2,
        y: 2,
        width: 52,
        height: 80,
      },
      logicalRenderOrigin: { x: 126, y: -2 },
    });
    expect(target.abortFrame(prepared.frame.token).status).toBe("aborted");
    expect(target.stats().residentTiles).toBe(0);
  });

  it("reuses the single texture across frame and LRU residency changes", () => {
    const gpu = fakeDevice();
    const target = runtime(gpu, { columns: 1 });
    const first = target.prepareFrame({
      frameId: "first",
      documentWidth: 256,
      documentHeight: 128,
      visibleTileIds: ["0:0"],
      dabs: [{ x: 64, y: 64, radius: 8 }],
    });
    expect(first.status).toBe("prepared");
    if (first.status !== "prepared") return;
    target.completeFrame(first.frame.token);

    const second = target.prepareFrame({
      frameId: "second",
      documentWidth: 256,
      documentHeight: 128,
      visibleTileIds: ["1:0"],
      dabs: [{ x: 192, y: 64, radius: 8 }],
    });
    expect(second.status).toBe("prepared");
    if (second.status !== "prepared") return;
    expect(second.frame.texture).toBe(first.frame.texture);
    target.completeFrame(second.frame.token);

    expect(gpu.createTexture).toHaveBeenCalledTimes(1);
    expect(target.stats()).toMatchObject({ residentTiles: 1, evictions: 1 });
  });

  it("fails closed after device loss and invalidates an active frame token", async () => {
    const gpu = fakeDevice();
    const onDeviceLost = vi.fn();
    const target = runtime(gpu, { onDeviceLost });
    const prepared = target.prepareFrame({
      frameId: "before-loss",
      documentWidth: 128,
      documentHeight: 128,
      dabs: [{ x: 64, y: 64, radius: 8 }],
    });
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;

    const info = { reason: "unknown", message: "synthetic loss" } as GPUDeviceLostInfo;
    gpu.lost.resolve(info);
    await Promise.resolve();

    expect(onDeviceLost).toHaveBeenCalledWith(info);
    expect(target.stats()).toMatchObject({ status: "device-lost", deviceGeneration: 2 });
    expect(target.prepareFrame({
      frameId: "after-loss",
      documentWidth: 128,
      documentHeight: 128,
      dabs: [],
    })).toEqual({ status: "rejected", reason: "device-lost" });
    expect(target.completeFrame(prepared.frame.token)).toEqual({
      status: "rejected",
      reason: "stale-generation",
    });
  });

  it("destroys the atlas and an optionally owned device exactly once", () => {
    const gpu = fakeDevice();
    const target = runtime(gpu, { ownsDevice: true });

    target.dispose();
    target.dispose();

    expect(gpu.destroyTexture).toHaveBeenCalledTimes(1);
    expect(gpu.destroyDevice).toHaveBeenCalledTimes(1);
    expect(target.stats().status).toBe("disposed");
    expect(target.prepareFrame({
      frameId: "after-dispose",
      documentWidth: 128,
      documentHeight: 128,
      dabs: [],
    })).toEqual({ status: "rejected", reason: "disposed" });
  });

  it("rejects malformed configuration before allocating GPU resources", () => {
    const gpu = fakeDevice();
    expect(createStudioGpuSparseBrushAtlasRuntime({
      device: gpu.device,
      columns: 0,
      rows: 1,
    })).toEqual({ status: "rejected", reason: "invalid-options" });
    expect(gpu.createTexture).not.toHaveBeenCalled();

    const oversized = fakeDevice();
    expect(createStudioGpuSparseBrushAtlasRuntime({
      device: oversized.device,
      columns: 40,
      rows: 1,
      tileSize: 128,
    })).toEqual({ status: "rejected", reason: "initialization-failed" });
    expect(oversized.createTexture).not.toHaveBeenCalled();
  });
});
