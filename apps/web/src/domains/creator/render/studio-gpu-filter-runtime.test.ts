import { afterEach, describe, expect, it, vi } from "vitest";

import { STUDIO_GPU_FILTER_KERNELS } from "./studio-gpu-filter-kernels";
import {
  acquireStudioGpuFilterRuntime,
  disposeStudioGpuFilterRuntime,
  supportsStudioGpuFilters,
} from "./studio-gpu-filter-runtime";
import { STUDIO_GPU_SPATIAL_FILTER_KERNELS } from "./studio-gpu-filter-spatial-kernels";

interface FakeDeviceHarness {
  readonly device: GPUDevice;
  readonly createShaderModule: ReturnType<typeof vi.fn>;
  readonly createComputePipeline: ReturnType<typeof vi.fn>;
  readonly createBuffer: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  resolveLost(): void;
}

function createFakeDevice(): FakeDeviceHarness {
  let resolveLost: (() => void) | null = null;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = () => resolve({ reason: "destroyed", message: "test" } as GPUDeviceLostInfo);
  });
  const createShaderModule = vi.fn((descriptor: { label?: string; code: string }) => ({
    label: descriptor.label,
  }));
  const createComputePipeline = vi.fn((descriptor: { label?: string }) => ({
    label: descriptor.label,
    getBindGroupLayout: vi.fn(() => ({})),
  }));
  const createBuffer = vi.fn((descriptor: { size: number }) => ({
    size: descriptor.size,
    destroy: vi.fn(),
    mapAsync: vi.fn(async () => undefined),
    getMappedRange: vi.fn(() => new ArrayBuffer(descriptor.size)),
    unmap: vi.fn(),
  }));
  const destroy = vi.fn();
  const device = {
    createShaderModule,
    createComputePipeline,
    createBuffer,
    createCommandEncoder: vi.fn(() => ({
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    destroy,
    lost,
    limits: {
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65_535,
    },
  } as unknown as GPUDevice;
  return {
    device,
    createShaderModule,
    createComputePipeline,
    createBuffer,
    destroy,
    resolveLost: resolveLost!,
  };
}

function fakeGpuFor(device: GPUDevice): GPU {
  return {
    requestAdapter: async () => ({ requestDevice: async () => device }),
  } as unknown as GPU;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  disposeStudioGpuFilterRuntime();
});

describe("studio-gpu-filter-runtime: 기능 감지·획득", () => {
  it("node 환경(navigator.gpu 없음)에서는 미지원 → acquire 가 null", async () => {
    expect(supportsStudioGpuFilters()).toBe(false);
    expect(await acquireStudioGpuFilterRuntime()).toBeNull();
    // 실패는 캐시되지 않으며 두 번째 호출도 조용히 null 이다.
    expect(await acquireStudioGpuFilterRuntime()).toBeNull();
  });

  it("gpu: null 오버라이드는 미지원 강제 → null", async () => {
    expect(supportsStudioGpuFilters(null)).toBe(false);
    expect(await acquireStudioGpuFilterRuntime({ gpu: null })).toBeNull();
  });

  it("어댑터가 없거나 획득이 던지면 null(예외를 밖으로 흘리지 않는다)", async () => {
    const noAdapter = { requestAdapter: async () => null } as unknown as GPU;
    expect(await acquireStudioGpuFilterRuntime({ gpu: noAdapter })).toBeNull();

    const throwing = {
      requestAdapter: async () => {
        throw new Error("adapter unavailable");
      },
    } as unknown as GPU;
    expect(await acquireStudioGpuFilterRuntime({ gpu: throwing })).toBeNull();
  });

  it("정상 획득 시 디바이스를 노출하고 lost=false 로 시작한다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioGpuFilterRuntime({ gpu: fakeGpuFor(harness.device) });
    expect(runtime).not.toBeNull();
    expect(runtime!.device).toBe(harness.device);
    expect(runtime!.lost).toBe(false);
    runtime!.dispose();
    expect(harness.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("studio-gpu-filter-runtime: 파이프라인 캐시", () => {
  it("shaderId 로 캐시한다 — 밝기대비/레벨/커브/융합은 lut3 파이프라인 하나를 공유", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioGpuFilterRuntime({ gpu: fakeGpuFor(harness.device) });
    expect(runtime).not.toBeNull();

    const levelsPipeline = runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS.levels);
    expect(runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS.curves)).toBe(levelsPipeline);
    expect(runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS["brightness-contrast"])).toBe(levelsPipeline);
    expect(runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS["lut-fused"])).toBe(levelsPipeline);
    expect(harness.createShaderModule).toHaveBeenCalledTimes(1);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(1);

    runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS.hsl);
    runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS.hsl);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(2);
    runtime!.dispose();
  });

  it("Gaussian/morphology의 가로·세로 패스는 각각 동일 파이프라인을 공유한다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioGpuFilterRuntime({ gpu: fakeGpuFor(harness.device) });
    expect(runtime).not.toBeNull();

    const gaussianHorizontal = runtime!.getComputePipeline(
      STUDIO_GPU_SPATIAL_FILTER_KERNELS["gaussian-box-horizontal"],
    );
    expect(runtime!.getComputePipeline(
      STUDIO_GPU_SPATIAL_FILTER_KERNELS["gaussian-box-vertical"],
    )).toBe(gaussianHorizontal);
    const morphologyHorizontal = runtime!.getComputePipeline(
      STUDIO_GPU_SPATIAL_FILTER_KERNELS["morphology-horizontal"],
    );
    expect(runtime!.getComputePipeline(
      STUDIO_GPU_SPATIAL_FILTER_KERNELS["morphology-vertical"],
    )).toBe(morphologyHorizontal);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(2);
    runtime!.dispose();
  });

  it("reuses exact-size pixel and readback buffers across interactive filter ticks", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioGpuFilterRuntime({ gpu: fakeGpuFor(harness.device) });
    expect(runtime).not.toBeNull();

    const firstPixel = runtime!.acquirePixelBuffer(4_096, "first");
    runtime!.releasePixelBuffer(firstPixel, 4_096);
    const secondPixel = runtime!.acquirePixelBuffer(4_096, "second");
    expect(secondPixel).toBe(firstPixel);

    await runtime!.readbackPixels(secondPixel, 4_096);
    await runtime!.readbackPixels(secondPixel, 4_096);
    // One storage buffer + one staging buffer. The second acquisition/readback reuses both.
    expect(harness.createBuffer).toHaveBeenCalledTimes(2);

    runtime!.releasePixelBuffer(secondPixel, 4_096);
    runtime!.dispose();
  });
});

describe("studio-gpu-filter-runtime: 디바이스 손실", () => {
  it("device.lost 가 해소되면 runtime.lost=true — 호출부는 CPU 폴백", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioGpuFilterRuntime({ gpu: fakeGpuFor(harness.device) });
    expect(runtime).not.toBeNull();
    expect(runtime!.lost).toBe(false);

    harness.resolveLost();
    await flushMicrotasks();
    expect(runtime!.lost).toBe(true);
    runtime!.dispose();
  });
});
