import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireStudioGpuDevice,
  acquireStudioGpuFilterRuntimeOnFabric,
  activeStudioGpuDeviceLeaseCount,
  disposeStudioGpuFabric,
  getStudioGpuFabricCapabilities,
  onStudioGpuDeviceLost,
  supportsStudioGpuFabric,
} from "./studio-gpu-fabric";
import { STUDIO_GPU_FILTER_KERNELS } from "./studio-gpu-filter-kernels";

interface FakeDeviceHarness {
  readonly device: GPUDevice;
  readonly createShaderModule: ReturnType<typeof vi.fn>;
  readonly createComputePipeline: ReturnType<typeof vi.fn>;
  readonly createBuffer: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  resolveLost(): void;
}

function createFakeDevice(withTimestampQuery = true): FakeDeviceHarness {
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
      maxTextureDimension2D: 16_384,
      maxStorageBufferBindingSize: 128 * 1024 * 1024,
      maxBufferSize: 256 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65_535,
      maxComputeInvocationsPerWorkgroup: 256,
    },
    features: withTimestampQuery ? new Set(["timestamp-query"]) : new Set<string>(),
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

interface FakeGpuHarness {
  readonly gpu: GPU;
  readonly requestAdapter: ReturnType<typeof vi.fn>;
  readonly requestDevice: ReturnType<typeof vi.fn>;
}

function fakeGpuFor(device: GPUDevice): FakeGpuHarness {
  const requestDevice = vi.fn(async () => device);
  const requestAdapter = vi.fn(async () => ({ requestDevice }));
  return { gpu: { requestAdapter } as unknown as GPU, requestAdapter, requestDevice };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  disposeStudioGpuFabric();
});

describe("studio-gpu-fabric: 기능 감지·획득", () => {
  it("node 환경(navigator.gpu 없음)에서는 미지원 → acquire 가 null(실패 미캐시)", async () => {
    expect(supportsStudioGpuFabric()).toBe(false);
    expect(await acquireStudioGpuDevice()).toBeNull();
    expect(await acquireStudioGpuDevice()).toBeNull();
  });

  it("gpu: null 오버라이드는 미지원 강제 → null", async () => {
    expect(supportsStudioGpuFabric(null)).toBe(false);
    expect(await acquireStudioGpuDevice({ gpu: null })).toBeNull();
  });

  it("어댑터가 없거나 획득이 던지면 null(예외를 밖으로 흘리지 않는다)", async () => {
    const noAdapter = { requestAdapter: async () => null } as unknown as GPU;
    expect(await acquireStudioGpuDevice({ gpu: noAdapter })).toBeNull();

    const throwing = {
      requestAdapter: async () => {
        throw new Error("adapter unavailable");
      },
    } as unknown as GPU;
    expect(await acquireStudioGpuDevice({ gpu: throwing })).toBeNull();
  });
});

describe("studio-gpu-fabric: 단일 소유권·참조 카운트", () => {
  it("여러 acquire 는 같은 디바이스·같은 epoch 를 공유한다(어댑터 요청 1회)", async () => {
    const harness = createFakeDevice();
    const { gpu, requestAdapter, requestDevice } = fakeGpuFor(harness.device);
    const first = await acquireStudioGpuDevice({ gpu });
    const second = await acquireStudioGpuDevice({ gpu });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.device).toBe(harness.device);
    expect(second!.device).toBe(harness.device);
    expect(second!.epoch).toBe(first!.epoch);
    expect(activeStudioGpuDeviceLeaseCount()).toBe(2);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(1);
  });

  it("동시(in-flight) acquire 도 생성 한 번을 기다려 같은 디바이스를 받는다", async () => {
    const harness = createFakeDevice();
    const { gpu, requestAdapter } = fakeGpuFor(harness.device);
    const [first, second] = await Promise.all([
      acquireStudioGpuDevice({ gpu }),
      acquireStudioGpuDevice({ gpu }),
    ]);
    expect(first!.device).toBe(harness.device);
    expect(second!.device).toBe(harness.device);
    expect(activeStudioGpuDeviceLeaseCount()).toBe(2);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it("release 는 멱등이고, 마지막 lease 해제로 디바이스를 파기하지 않는다(보존 정책)", async () => {
    const harness = createFakeDevice();
    const { gpu, requestAdapter } = fakeGpuFor(harness.device);
    const first = (await acquireStudioGpuDevice({ gpu }))!;
    const second = (await acquireStudioGpuDevice({ gpu }))!;
    expect(activeStudioGpuDeviceLeaseCount()).toBe(2);

    first.release();
    expect(first.released).toBe(true);
    expect(activeStudioGpuDeviceLeaseCount()).toBe(1);
    first.release();
    expect(activeStudioGpuDeviceLeaseCount()).toBe(1);

    second.release();
    expect(activeStudioGpuDeviceLeaseCount()).toBe(0);
    expect(harness.destroy).not.toHaveBeenCalled();

    // 재획득은 살아있는 디바이스를 그대로 공유한다 — 새 어댑터 요청 없음.
    const third = (await acquireStudioGpuDevice({ gpu }))!;
    expect(third.device).toBe(harness.device);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it("dispose 는 디바이스를 파기하고, 획득 도중 dispose 경합은 null + 새 디바이스 정리", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    const lease = (await acquireStudioGpuDevice({ gpu }))!;
    expect(lease.device).toBe(harness.device);
    disposeStudioGpuFabric();
    expect(harness.destroy).toHaveBeenCalledTimes(1);
    expect(activeStudioGpuDeviceLeaseCount()).toBe(0);

    // 획득이 in-flight 인 동안 dispose — 결과는 null, 뒤늦게 생성된 디바이스는 파기된다.
    const racing = createFakeDevice();
    const pending = acquireStudioGpuDevice({ gpu: fakeGpuFor(racing.device).gpu });
    disposeStudioGpuFabric();
    expect(await pending).toBeNull();
    expect(racing.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("studio-gpu-fabric: device-loss 리스너 허브", () => {
  it("loss 시 모든 리스너에 epoch·reason 으로 1회 통지하고 상태를 비운다", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    const lease = (await acquireStudioGpuDevice({ gpu }))!;
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    onStudioGpuDeviceLost(firstListener);
    onStudioGpuDeviceLost(secondListener);

    harness.resolveLost();
    await flushMicrotasks();

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(firstListener).toHaveBeenCalledWith({ epoch: lease.epoch, reason: "destroyed" });
    expect(secondListener).toHaveBeenCalledTimes(1);
    expect(lease.lost).toBe(true);
    expect(activeStudioGpuDeviceLeaseCount()).toBe(0);

    // 다음 acquire 는 새 디바이스·새 epoch 다.
    const replacement = createFakeDevice();
    const next = (await acquireStudioGpuDevice({ gpu: fakeGpuFor(replacement.device).gpu }))!;
    expect(next.device).toBe(replacement.device);
    expect(next.epoch).toBeGreaterThan(lease.epoch);
  });

  it("해제된 리스너는 통지받지 않고, 던지는 리스너가 다른 리스너를 막지 않는다", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    await acquireStudioGpuDevice({ gpu });

    const removed = vi.fn();
    const unsubscribe = onStudioGpuDeviceLost(removed);
    unsubscribe();
    const throwing = vi.fn(() => {
      throw new Error("listener boom");
    });
    const surviving = vi.fn();
    onStudioGpuDeviceLost(throwing);
    onStudioGpuDeviceLost(surviving);

    harness.resolveLost();
    await flushMicrotasks();

    expect(removed).not.toHaveBeenCalled();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(surviving).toHaveBeenCalledTimes(1);
  });

  it("명시적 dispose 후의 lost 해소는 통지하지 않는다(계획된 종료 ≠ 손실)", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    await acquireStudioGpuDevice({ gpu });
    disposeStudioGpuFabric();

    const lateListener = vi.fn();
    onStudioGpuDeviceLost(lateListener);
    harness.resolveLost();
    await flushMicrotasks();
    expect(lateListener).not.toHaveBeenCalled();
  });
});

describe("studio-gpu-fabric: 기능 프로브 캐시", () => {
  it("디바이스 생성 시 1회 프로브하고 epoch 동안 같은 동결 객체를 돌려준다", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    const lease = (await acquireStudioGpuDevice({ gpu }))!;

    const capabilities = getStudioGpuFabricCapabilities();
    expect(capabilities).not.toBeNull();
    expect(capabilities!.deviceEpoch).toBe(lease.epoch);
    expect(capabilities!.maxTextureDimension2D).toBe(16_384);
    expect(capabilities!.maxBufferSize).toBe(256 * 1024 * 1024);
    expect(capabilities!.maxStorageBufferBindingSize).toBe(128 * 1024 * 1024);
    expect(capabilities!.maxComputeWorkgroupsPerDimension).toBe(65_535);
    expect(capabilities!.maxComputeInvocationsPerWorkgroup).toBe(256);
    expect(capabilities!.timestampQuery).toBe(true);
    expect(capabilities!.features).toContain("timestamp-query");
    expect(Object.isFrozen(capabilities)).toBe(true);
    // 캐시 증명 — 재호출은 재프로브 없이 동일 참조.
    expect(getStudioGpuFabricCapabilities()).toBe(capabilities);
  });

  it("timestamp-query 미지원 디바이스는 false 로 프로브되고, loss 후에는 null", async () => {
    const harness = createFakeDevice(false);
    const { gpu } = fakeGpuFor(harness.device);
    await acquireStudioGpuDevice({ gpu });
    expect(getStudioGpuFabricCapabilities()!.timestampQuery).toBe(false);

    harness.resolveLost();
    await flushMicrotasks();
    expect(getStudioGpuFabricCapabilities()).toBeNull();
  });
});

describe("studio-gpu-fabric: 필터 런타임 배선(공유 계약)", () => {
  it("fabric 필터 런타임은 fabric 디바이스 위에서 파이프라인을 shaderId 로 캐시한다", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    const runtime = await acquireStudioGpuFilterRuntimeOnFabric({ gpu });
    expect(runtime).not.toBeNull();
    expect(runtime!.lost).toBe(false);

    // 기존 필터 런타임 파이프라인 캐시 계약 무회귀 — lut3 셰이더 하나를 공유.
    const levelsPipeline = runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS.levels);
    expect(runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS.curves)).toBe(levelsPipeline);
    expect(runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS["brightness-contrast"]))
      .toBe(levelsPipeline);
    expect(runtime!.getComputePipeline(STUDIO_GPU_FILTER_KERNELS["lut-fused"]))
      .toBe(levelsPipeline);
    // 파사드가 실제 fabric 디바이스로 위임했다는 증거.
    expect(harness.createShaderModule).toHaveBeenCalledTimes(1);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(1);
  });

  it("fabric 필터 런타임은 싱글턴이고 lease 하나만 쥔다", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    const first = await acquireStudioGpuFilterRuntimeOnFabric({ gpu });
    const second = await acquireStudioGpuFilterRuntimeOnFabric({ gpu });
    expect(second).toBe(first);
    expect(activeStudioGpuDeviceLeaseCount()).toBe(1);
  });

  it("런타임 dispose 는 lease 해제일 뿐 공유 디바이스를 파괴하지 않는다", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    const runtime = (await acquireStudioGpuFilterRuntimeOnFabric({ gpu }))!;
    expect(activeStudioGpuDeviceLeaseCount()).toBe(1);

    runtime.dispose();
    expect(harness.destroy).not.toHaveBeenCalled();
    expect(activeStudioGpuDeviceLeaseCount()).toBe(0);

    // 디바이스는 살아있으므로 재획득은 같은 디바이스 위에 새 런타임을 만든다.
    const replacement = (await acquireStudioGpuFilterRuntimeOnFabric({ gpu }))!;
    expect(replacement).not.toBe(runtime);
    expect(replacement.lost).toBe(false);
    expect(harness.destroy).not.toHaveBeenCalled();

    // fabric dispose 만이 실제 디바이스를 파기한다.
    disposeStudioGpuFabric();
    expect(harness.destroy).toHaveBeenCalledTimes(1);
  });

  it("device loss 는 런타임에 전파되고 다음 acquire 는 새 디바이스로 복구한다", async () => {
    const harness = createFakeDevice();
    const { gpu } = fakeGpuFor(harness.device);
    const runtime = (await acquireStudioGpuFilterRuntimeOnFabric({ gpu }))!;

    harness.resolveLost();
    await flushMicrotasks();
    expect(runtime.lost).toBe(true);

    const replacement = createFakeDevice();
    const recovered = await acquireStudioGpuFilterRuntimeOnFabric({
      gpu: fakeGpuFor(replacement.device).gpu,
    });
    expect(recovered).not.toBeNull();
    expect(recovered).not.toBe(runtime);
    expect(recovered!.lost).toBe(false);
    expect(activeStudioGpuDeviceLeaseCount()).toBe(1);
  });
});
