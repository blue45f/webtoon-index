import { beforeEach, describe, expect, it, vi } from "vitest";

import { acquireStudioGpuPresentationDevice } from "./studio-gpu-presentation-device";

const fabricHarness = vi.hoisted(() => ({
  acquireStudioGpuDevice: vi.fn(),
}));

vi.mock("./studio-gpu-fabric", () => ({
  acquireStudioGpuDevice: fabricHarness.acquireStudioGpuDevice,
}));

function fakeGpu(input?: {
  readonly format?: GPUTextureFormat;
  readonly device?: GPUDevice;
}) {
  const device = input?.device ?? ({} as GPUDevice);
  const requestDevice = vi.fn(async () => device);
  const requestAdapter = vi.fn(async () => ({ requestDevice }));
  const getPreferredCanvasFormat = vi.fn(
    () => input?.format ?? "bgra8unorm",
  );
  return {
    gpu: {
      getPreferredCanvasFormat,
      requestAdapter,
    } as unknown as GPU,
    device,
    getPreferredCanvasFormat,
    requestAdapter,
    requestDevice,
  };
}

function fakeLease(device: GPUDevice, lost = false) {
  return {
    device,
    epoch: 7,
    lost,
    released: false,
    release: vi.fn(),
  };
}

beforeEach(() => {
  fabricHarness.acquireStudioGpuDevice.mockReset();
});

describe("acquireStudioGpuPresentationDevice", () => {
  it("borrows the Studio GPU fabric and maps destroy to an idempotent lease release", async () => {
    const createBuffer = vi.fn(function createBuffer(this: GPUDevice) {
      return this;
    });
    const physicalDestroy = vi.fn();
    const physicalDevice = {
      createBuffer,
      destroy: physicalDestroy,
    } as unknown as GPUDevice;
    const { gpu, requestAdapter } = fakeGpu({ device: physicalDevice });
    const lease = fakeLease(physicalDevice);
    fabricHarness.acquireStudioGpuDevice.mockResolvedValue(lease);

    const acquired = await acquireStudioGpuPresentationDevice({
      gpu,
      strategy: "shared",
    });

    expect(acquired).toMatchObject({
      deviceEpoch: 7,
      canvasFormat: "bgra8unorm",
      ownership: "fabric-lease",
    });
    expect(fabricHarness.acquireStudioGpuDevice).toHaveBeenCalledWith({ gpu });
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(acquired?.device.createBuffer({} as GPUBufferDescriptor)).toBe(
      physicalDevice,
    );

    acquired?.device.destroy();
    acquired?.device.destroy();
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(physicalDestroy).not.toHaveBeenCalled();
  });

  it("keeps the explicit dedicated strategy for isolated harnesses", async () => {
    const destroy = vi.fn();
    const physicalDevice = { destroy } as unknown as GPUDevice;
    const { gpu, requestAdapter, requestDevice } = fakeGpu({
      device: physicalDevice,
      format: "rgba8unorm",
    });

    const acquired = await acquireStudioGpuPresentationDevice({
      gpu,
      strategy: "dedicated",
    });

    expect(acquired).toEqual({
      device: physicalDevice,
      deviceEpoch: 1,
      canvasFormat: "rgba8unorm",
      ownership: "dedicated",
    });
    expect(requestAdapter).toHaveBeenCalledWith({
      powerPreference: "high-performance",
    });
    expect(requestDevice).toHaveBeenCalledTimes(1);
    expect(fabricHarness.acquireStudioGpuDevice).not.toHaveBeenCalled();

    acquired?.device.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("uses the dedicated compatibility path automatically under Vitest", async () => {
    const physicalDevice = { destroy: vi.fn() } as unknown as GPUDevice;
    const { gpu, requestAdapter } = fakeGpu({ device: physicalDevice });

    const acquired = await acquireStudioGpuPresentationDevice({ gpu });

    expect(acquired?.ownership).toBe("dedicated");
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(fabricHarness.acquireStudioGpuDevice).not.toHaveBeenCalled();
  });

  it("rejects unsupported presentation formats before allocating a device", async () => {
    const { gpu, requestAdapter } = fakeGpu({ format: "r8unorm" });

    await expect(
      acquireStudioGpuPresentationDevice({ gpu, strategy: "shared" }),
    ).resolves.toBeNull();
    expect(requestAdapter).not.toHaveBeenCalled();
    expect(fabricHarness.acquireStudioGpuDevice).not.toHaveBeenCalled();
  });

  it("fails closed when the shared fabric is unavailable", async () => {
    const { gpu } = fakeGpu();
    fabricHarness.acquireStudioGpuDevice.mockRejectedValue(
      new Error("adapter unavailable"),
    );

    await expect(
      acquireStudioGpuPresentationDevice({ gpu, strategy: "shared" }),
    ).resolves.toBeNull();
  });

  it("releases a lease that is already marked lost", async () => {
    const physicalDevice = {} as GPUDevice;
    const { gpu } = fakeGpu({ device: physicalDevice });
    const lease = fakeLease(physicalDevice, true);
    fabricHarness.acquireStudioGpuDevice.mockResolvedValue(lease);

    await expect(
      acquireStudioGpuPresentationDevice({ gpu, strategy: "shared" }),
    ).resolves.toBeNull();
    expect(lease.release).toHaveBeenCalledTimes(1);
  });
});
