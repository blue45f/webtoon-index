import { describe, expect, it, vi } from "vitest";

import {
  createStudioEngineWebGpuTileProviderProductionWithFactories,
  STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_DEFAULT_BACKEND,
  type StudioEngineWebGpuTileProviderProductionFactories,
  type StudioEngineWebGpuTileProviderProductionRequest,
} from "./studio-engine-webgpu-tile-provider-production";

import type { StudioEngineTileProviderInput } from "./studio-engine-tile-authority";
import type { StudioEngineWebGpuTileProviderV1 } from "./studio-engine-webgpu-tile-provider-v1";
import type { StudioEngineWebGpuTileProviderV2 } from "./studio-engine-webgpu-tile-provider-v2-atlas";

function input(): StudioEngineTileProviderInput {
  return { kind: "test-input" } as unknown as StudioEngineTileProviderInput;
}

function productionRequest(
  value: StudioEngineTileProviderInput = input(),
): StudioEngineWebGpuTileProviderProductionRequest {
  return {
    kind: "studio-engine-webgpu-tile-provider-production-request",
    version: 1,
    mode: "rebuild",
    requestEpoch: 7,
    deviceEpoch: 3,
    requestSequence: 11,
    input: value,
  };
}

function fakeV1() {
  const execute = vi.fn(async (request) => ({
    status: "completed" as const,
    receipt: {
      kind: "studio-engine-webgpu-tile-provider-receipt",
      version: 1,
      backend: "webgpu",
    },
    batch: { kind: "v1-batch" },
    request,
  }));
  const render = vi.fn(async () => ({ status: "completed" }));
  const dispose = vi.fn();
  const stats = vi.fn(() => ({ status: "ready", requestEpoch: 7 }));
  return {
    provider: { execute, render, dispose, stats } as unknown as StudioEngineWebGpuTileProviderV1,
    execute,
    render,
    dispose,
    stats,
  };
}

function fakeV2() {
  const execute = vi.fn(async (request) => ({
    status: "completed" as const,
    receipt: {
      kind: "studio-engine-webgpu-tile-provider-v2-receipt",
      version: 2,
      backend: "webgpu-atlas",
    },
    batch: { kind: "v2-batch" },
    request,
  }));
  const render = vi.fn(async () => ({ status: "completed" }));
  const dispose = vi.fn();
  const stats = vi.fn(() => ({
    status: "ready",
    requestEpoch: 7,
    storage: "single-rgba16float-2d-atlas",
    physicalTextureCount: 1,
  }));
  return {
    provider: { execute, render, dispose, stats } as unknown as StudioEngineWebGpuTileProviderV2,
    execute,
    render,
    dispose,
    stats,
  };
}

function factories(
  v1 = fakeV1(),
  v2 = fakeV2(),
): {
  boundary: StudioEngineWebGpuTileProviderProductionFactories;
  v1: ReturnType<typeof fakeV1>;
  v2: ReturnType<typeof fakeV2>;
  createV1: ReturnType<typeof vi.fn>;
  createV2: ReturnType<typeof vi.fn>;
} {
  const createV1 = vi.fn(() => ({ status: "ready" as const, provider: v1.provider }));
  const createV2 = vi.fn(() => ({ status: "ready" as const, provider: v2.provider }));
  return {
    boundary: {
      v1: createV1 as unknown as StudioEngineWebGpuTileProviderProductionFactories["v1"],
      v2: createV2 as unknown as StudioEngineWebGpuTileProviderProductionFactories["v2"],
    },
    v1,
    v2,
    createV1,
    createV2,
  };
}

describe("production WebGPU tile-provider selection", () => {
  it("selects the single-atlas V2 backend by default", async () => {
    const harness = factories();
    const created = createStudioEngineWebGpuTileProviderProductionWithFactories({
      boundary: { device: {} as GPUDevice },
      requestEpoch: 7,
    }, harness.boundary);

    expect(created.status).toBe("ready");
    expect(created.backend).toBe(STUDIO_ENGINE_WEBGPU_TILE_PROVIDER_DEFAULT_BACKEND);
    expect(harness.createV2).toHaveBeenCalledTimes(1);
    expect(harness.createV1).not.toHaveBeenCalled();
    if (created.status !== "ready") return;

    const request = productionRequest();
    const result = await created.provider.execute(request);
    expect(result).toMatchObject({
      status: "completed",
      backend: "webgpu-atlas-v2",
      receipt: {
        kind: "studio-engine-webgpu-tile-provider-v2-receipt",
        backend: "webgpu-atlas",
      },
      batch: { kind: "v2-batch" },
    });
    expect(harness.v2.execute).toHaveBeenCalledWith({
      kind: "studio-engine-webgpu-tile-provider-v2-request",
      version: 2,
      mode: "rebuild",
      requestEpoch: 7,
      deviceEpoch: 3,
      requestSequence: 11,
      input: request.input,
    }, undefined);
    expect(created.provider.stats()).toMatchObject({
      backend: "webgpu-atlas-v2",
      provider: {
        physicalTextureCount: 1,
        storage: "single-rgba16float-2d-atlas",
      },
    });
  });

  it("never silently falls through to V1 when V2 creation fails", () => {
    const harness = factories();
    harness.createV2.mockReturnValue({
      status: "failed",
      reason: "atlas-budget",
    });

    const created = createStudioEngineWebGpuTileProviderProductionWithFactories({
      boundary: { device: {} as GPUDevice },
      requestEpoch: 7,
    }, harness.boundary);

    expect(created).toEqual({
      status: "failed",
      backend: "webgpu-atlas-v2",
      reason: "atlas-budget",
    });
    expect(harness.createV1).not.toHaveBeenCalled();
  });

  it("keeps V1 as an explicit rollback with the same public request contract", async () => {
    const harness = factories();
    const created = createStudioEngineWebGpuTileProviderProductionWithFactories({
      boundary: { device: {} as GPUDevice },
      requestEpoch: 7,
      backend: "webgpu-v1",
    }, harness.boundary);

    expect(created.status).toBe("ready");
    expect(created.backend).toBe("webgpu-v1");
    expect(harness.createV1).toHaveBeenCalledTimes(1);
    expect(harness.createV2).not.toHaveBeenCalled();
    if (created.status !== "ready") return;

    const request = productionRequest();
    const result = await created.provider.execute(request);
    expect(result).toMatchObject({
      status: "completed",
      backend: "webgpu-v1",
      receipt: {
        kind: "studio-engine-webgpu-tile-provider-receipt",
        backend: "webgpu",
      },
      batch: { kind: "v1-batch" },
    });
    expect(harness.v1.execute).toHaveBeenCalledWith({
      kind: "studio-engine-webgpu-tile-provider-request",
      version: 1,
      mode: "rebuild",
      requestEpoch: 7,
      deviceEpoch: 3,
      requestSequence: 11,
      input: request.input,
    }, undefined);
  });

  it("rejects malformed envelopes and disposes the selected backend once", async () => {
    const harness = factories();
    const created = createStudioEngineWebGpuTileProviderProductionWithFactories({
      boundary: { device: {} as GPUDevice },
      requestEpoch: 7,
    }, harness.boundary);
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;

    const malformed = {
      ...productionRequest(),
      kind: "wrong",
    } as unknown as StudioEngineWebGpuTileProviderProductionRequest;
    await expect(created.provider.execute(malformed)).resolves.toEqual({
      status: "rejected",
      backend: "webgpu-atlas-v2",
      reason: "invalid-request",
    });
    expect(harness.v2.execute).not.toHaveBeenCalled();

    created.provider.dispose();
    created.provider.dispose();
    expect(harness.v2.dispose).toHaveBeenCalledTimes(1);
    await expect(created.provider.execute(productionRequest())).resolves.toEqual({
      status: "rejected",
      backend: "webgpu-atlas-v2",
      reason: "disposed",
    });
  });
});
