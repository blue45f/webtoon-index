import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireStudioSmokeGpuRuntime,
  disposeStudioSmokeGpuRuntime,
  supportsStudioSmokeGpu,
} from "./studio-smoke-gpu-runtime";
import { STUDIO_SMOKE_WGSL_KERNELS } from "./studio-smoke-wgsl";

interface FakeDeviceHarness {
  readonly device: GPUDevice;
  readonly createShaderModule: ReturnType<typeof vi.fn>;
  readonly createComputePipeline: ReturnType<typeof vi.fn>;
  readonly createBuffer: ReturnType<typeof vi.fn>;
  readonly writeBuffer: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  resolveLost(): void;
}

function createFakeDevice(): FakeDeviceHarness {
  let resolveLost: (() => void) | null = null;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = () => resolve({ reason: "destroyed", message: "test" } as GPUDeviceLostInfo);
  });
  const createShaderModule = vi.fn((descriptor: { label?: string; code: string }) => ({ label: descriptor.label }));
  const createComputePipeline = vi.fn((descriptor: { label?: string }) => ({
    label: descriptor.label,
    getBindGroupLayout: vi.fn(() => ({})),
  }));
  const createBuffer = vi.fn((descriptor: { size: number; usage: number; label?: string }) => ({
    label: descriptor.label,
    size: descriptor.size,
    usage: descriptor.usage,
    destroy: vi.fn(),
    mapAsync: vi.fn(async () => undefined),
    getMappedRange: vi.fn(() => new ArrayBuffer(descriptor.size)),
    unmap: vi.fn(),
  }));
  const writeBuffer = vi.fn();
  const destroy = vi.fn();
  const device = {
    createShaderModule,
    createComputePipeline,
    createBuffer,
    createCommandEncoder: vi.fn(() => ({
      copyBufferToBuffer: vi.fn(),
      clearBuffer: vi.fn(),
      beginComputePass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups: vi.fn(),
        end: vi.fn(),
      })),
      finish: vi.fn(() => ({})),
    })),
    createBindGroup: vi.fn(() => ({})),
    queue: { writeBuffer, submit: vi.fn() },
    destroy,
    lost,
    limits: {
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65_535,
    },
  } as unknown as GPUDevice;
  return { device, createShaderModule, createComputePipeline, createBuffer, writeBuffer, destroy, resolveLost: resolveLost! };
}

function fakeGpuFor(device: GPUDevice): GPU {
  return { requestAdapter: async () => ({ requestDevice: async () => device }) } as unknown as GPU;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  disposeStudioSmokeGpuRuntime();
});

describe("studio-smoke-gpu-runtime: 기능 감지·획득", () => {
  it("node 환경(navigator.gpu 없음)에서는 미지원 → acquire 가 null", async () => {
    expect(supportsStudioSmokeGpu()).toBe(false);
    expect(await acquireStudioSmokeGpuRuntime()).toBeNull();
    // 실패는 캐시되지 않으며 두 번째 호출도 조용히 null 이다.
    expect(await acquireStudioSmokeGpuRuntime()).toBeNull();
  });

  it("gpu: null 오버라이드는 미지원 강제 → null", async () => {
    expect(supportsStudioSmokeGpu(null)).toBe(false);
    expect(await acquireStudioSmokeGpuRuntime({ gpu: null })).toBeNull();
  });

  it("어댑터가 없거나 requestDevice 가 던지면 null(예외를 밖으로 흘리지 않는다)", async () => {
    const noAdapter = { requestAdapter: async () => null } as unknown as GPU;
    expect(await acquireStudioSmokeGpuRuntime({ gpu: noAdapter })).toBeNull();

    const throwingAdapter = {
      requestAdapter: async () => {
        throw new Error("adapter unavailable");
      },
    } as unknown as GPU;
    expect(await acquireStudioSmokeGpuRuntime({ gpu: throwingAdapter })).toBeNull();

    const throwingDevice = {
      requestAdapter: async () => ({
        requestDevice: async () => {
          throw new Error("device unavailable");
        },
      }),
    } as unknown as GPU;
    expect(await acquireStudioSmokeGpuRuntime({ gpu: throwingDevice })).toBeNull();
  });

  it("정상 획득 시 디바이스를 노출하고 lost=false 로 시작한다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioSmokeGpuRuntime({ gpu: fakeGpuFor(harness.device) });
    expect(runtime).not.toBeNull();
    expect(runtime!.device).toBe(harness.device);
    expect(runtime!.lost).toBe(false);
    runtime!.dispose();
    expect(harness.destroy).toHaveBeenCalledTimes(1);
    // dispose 는 멱등이다.
    runtime!.dispose();
    expect(harness.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("studio-smoke-gpu-runtime: 파이프라인 캐시", () => {
  it("shaderId 당 셰이더 모듈/파이프라인을 한 번만 만든다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioSmokeGpuRuntime({ gpu: fakeGpuFor(harness.device) });
    expect(runtime).not.toBeNull();

    const first = runtime!.getComputePipeline(STUDIO_SMOKE_WGSL_KERNELS.advect_scalar);
    expect(runtime!.getComputePipeline(STUDIO_SMOKE_WGSL_KERNELS.advect_scalar)).toBe(first);
    expect(harness.createShaderModule).toHaveBeenCalledTimes(1);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(1);

    runtime!.getComputePipeline(STUDIO_SMOKE_WGSL_KERNELS.pressure_jacobi);
    runtime!.getComputePipeline(STUDIO_SMOKE_WGSL_KERNELS.pressure_jacobi);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(2);

    // 11개 커널 전부를 캐시해도 컴파일은 11회뿐이다.
    for (const shader of Object.values(STUDIO_SMOKE_WGSL_KERNELS)) runtime!.getComputePipeline(shader);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(Object.keys(STUDIO_SMOKE_WGSL_KERNELS).length);
    runtime!.dispose();
  });
});

describe("studio-smoke-gpu-runtime: 버퍼", () => {
  it("필드 버퍼는 STORAGE|COPY_SRC|COPY_DST, uniform 은 UNIFORM|COPY_DST 로 만든다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioSmokeGpuRuntime({ gpu: fakeGpuFor(harness.device) });
    runtime!.createFieldBuffer(1024, "density");
    const fieldDescriptor = harness.createBuffer.mock.calls[0][0] as { size: number; usage: number };
    expect(fieldDescriptor.size).toBe(1024);
    expect(fieldDescriptor.usage).toBe(0x0080 | 0x0004 | 0x0008);

    runtime!.createUniformBuffer(new ArrayBuffer(64), "params");
    const uniformDescriptor = harness.createBuffer.mock.calls[1][0] as { size: number; usage: number };
    expect(uniformDescriptor.size).toBe(64);
    expect(uniformDescriptor.usage).toBe(0x0040 | 0x0008);
    expect(harness.writeBuffer).toHaveBeenCalledTimes(1);
    runtime!.dispose();
  });

  it("readField 는 스테이징 버퍼를 만들고 반드시 정리한다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioSmokeGpuRuntime({ gpu: fakeGpuFor(harness.device) });
    const source = runtime!.createFieldBuffer(32);
    const values = await runtime!.readField(source, 32);
    expect(values).toBeInstanceOf(Float32Array);
    expect(values.length).toBe(8);
    const staging = harness.createBuffer.mock.results[1].value as { destroy: ReturnType<typeof vi.fn> };
    expect(staging.destroy).toHaveBeenCalledTimes(1);
    runtime!.dispose();
  });
});

describe("studio-smoke-gpu-runtime: 디바이스 손실", () => {
  it("device.lost 가 해소되면 runtime.lost=true 이고 파이프라인 캐시가 비워진다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireStudioSmokeGpuRuntime({ gpu: fakeGpuFor(harness.device) });
    runtime!.getComputePipeline(STUDIO_SMOKE_WGSL_KERNELS.curl);
    expect(runtime!.lost).toBe(false);

    harness.resolveLost();
    await flushMicrotasks();
    expect(runtime!.lost).toBe(true);

    // 캐시가 비었으므로 같은 셰이더를 다시 요청하면 새로 컴파일된다.
    runtime!.getComputePipeline(STUDIO_SMOKE_WGSL_KERNELS.curl);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(2);
    runtime!.dispose();
  });

  it("dispose 후 다음 acquire 는 새 디바이스를 받는다", async () => {
    const first = createFakeDevice();
    const runtimeA = await acquireStudioSmokeGpuRuntime({ gpu: fakeGpuFor(first.device) });
    expect(runtimeA!.device).toBe(first.device);
    runtimeA!.dispose();

    const second = createFakeDevice();
    const runtimeB = await acquireStudioSmokeGpuRuntime({ gpu: fakeGpuFor(second.device) });
    expect(runtimeB!.device).toBe(second.device);
    expect(runtimeB!.lost).toBe(false);
    runtimeB!.dispose();
  });
});
