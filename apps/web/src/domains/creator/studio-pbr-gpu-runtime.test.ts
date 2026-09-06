import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireStudioPbrGpuRuntime,
  disposeStudioPbrGpuRuntime,
  StudioPbrGpuRuntimeError,
  supportsStudioPbrGpu,
} from "./studio-pbr-gpu-runtime";

interface FakeDeviceHarness {
  readonly device: GPUDevice;
  readonly createShaderModule: ReturnType<typeof vi.fn>;
  readonly createComputePipeline: ReturnType<typeof vi.fn>;
  readonly createBuffer: ReturnType<typeof vi.fn>;
  readonly writeBuffer: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  readonly loseDevice: () => void;
}

/** WebGPU 가 없는 node 에서 수명 규율만 검증하기 위한 위조 GPUDevice. */
function createFakeDevice(readback?: Float32Array): FakeDeviceHarness {
  let resolveLost: (() => void) | null = null;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = () => resolve({ reason: "destroyed", message: "test" } as GPUDeviceLostInfo);
  });
  const createShaderModule = vi.fn((descriptor: { label?: string; code: string }) => ({
    label: descriptor.label,
    code: descriptor.code,
  }));
  const createComputePipeline = vi.fn((descriptor: { label?: string }) => ({
    label: descriptor.label,
    getBindGroupLayout: vi.fn(() => ({})),
  }));
  const createBuffer = vi.fn((descriptor: { size: number; usage: number; label?: string }) => ({
    size: descriptor.size,
    usage: descriptor.usage,
    label: descriptor.label,
    destroy: vi.fn(),
    mapAsync: vi.fn(async () => undefined),
    getMappedRange: vi.fn(() => {
      const buffer = new ArrayBuffer(descriptor.size);
      if (readback) new Float32Array(buffer).set(readback.subarray(0, descriptor.size / 4));
      return buffer;
    }),
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
      finish: vi.fn(() => ({})),
    })),
    queue: { writeBuffer, submit: vi.fn() },
    destroy,
    lost,
  } as unknown as GPUDevice;
  return {
    device,
    createShaderModule,
    createComputePipeline,
    createBuffer,
    writeBuffer,
    destroy,
    loseDevice: () => resolveLost?.(),
  };
}

function fakeGpuFor(device: GPUDevice): GPU {
  return { requestAdapter: async () => ({ requestDevice: async () => device }) } as unknown as GPU;
}

function acquireSharedWebGpu() {
  return acquireStudioPbrGpuRuntime({ executionBackend: "webgpu" });
}

function acquireInjectedWebGpu(gpu: GPU | null) {
  return acquireStudioPbrGpuRuntime({ executionBackend: "webgpu", gpu });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  disposeStudioPbrGpuRuntime();
});

describe("studio-pbr-gpu-runtime: 기능 감지", () => {
  it("node 환경(navigator.gpu 없음)은 선택한 WebGPU unavailable로 종료한다", async () => {
    expect(supportsStudioPbrGpu()).toBe(false);
    await expect(acquireSharedWebGpu()).rejects.toMatchObject({
      status: "unavailable",
      executionBackend: "webgpu",
      code: "webgpu-unavailable",
      selectedExecutionBackend: "webgpu",
      attemptedExecutionBackends: ["webgpu"],
    });
    // 실패를 CPU reference 성공으로 relabel하지 않고 다음 명시적 WebGPU operation도 거부한다.
    await expect(acquireSharedWebGpu()).rejects.toMatchObject({
      code: "webgpu-unavailable",
      attemptedExecutionBackends: ["webgpu"],
    });
  });

  it("gpu: null 오버라이드는 선택한 WebGPU unavailable을 강제한다", async () => {
    expect(supportsStudioPbrGpu(null)).toBe(false);
    await expect(acquireInjectedWebGpu(null)).rejects.toMatchObject({
      code: "webgpu-unavailable",
      attemptedExecutionBackends: ["webgpu"],
    });
  });

  it("어댑터 없음/획득 예외는 backend를 바꾸지 않고 typed unavailable로 종료한다", async () => {
    const noAdapter = { requestAdapter: async () => null } as unknown as GPU;
    await expect(acquireInjectedWebGpu(noAdapter)).rejects.toMatchObject({
      code: "adapter-unavailable",
      attemptedExecutionBackends: ["webgpu"],
    });
    const throwing = {
      requestAdapter: async () => {
        throw new Error("boom");
      },
    } as unknown as GPU;
    await expect(acquireInjectedWebGpu(throwing)).rejects.toMatchObject({
      code: "adapter-request-failed",
      attemptedExecutionBackends: ["webgpu"],
    });

    const deviceFailure = {
      requestAdapter: async () => ({
        requestDevice: async () => {
          throw new Error("device-boom");
        },
      }),
    } as unknown as GPU;
    await expect(acquireInjectedWebGpu(deviceFailure)).rejects.toMatchObject({
      code: "device-request-failed",
      attemptedExecutionBackends: ["webgpu"],
    });
  });

  it("CPU reference를 GPU acquire에 넘겨 같은 operation에서 backend를 바꿀 수 없다", async () => {
    await expect(acquireStudioPbrGpuRuntime({
      executionBackend: "cpu-reference" as never,
    })).rejects.toThrow(/executionBackend=webgpu/u);
  });
});

describe("studio-pbr-gpu-runtime: 파이프라인 캐시", () => {
  it("같은 커널을 두 번 요청해도 모듈·파이프라인을 한 번만 만든다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    expect(runtime).toMatchObject({
      executionBackend: "webgpu",
      selectedExecutionBackend: "webgpu",
      attemptedExecutionBackends: ["webgpu"],
    });
    const first = runtime.getComputePipeline("ssao");
    const second = runtime.getComputePipeline("ssao");
    expect(second).toBe(first);
    expect(harness.createShaderModule).toHaveBeenCalledTimes(1);
    expect(harness.createComputePipeline).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("서로 다른 커널은 별도 모듈을 만든다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    runtime.getComputePipeline("ssao");
    runtime.getComputePipeline("bloomThreshold");
    runtime.getComputePipeline("brdfLut");
    expect(harness.createShaderModule).toHaveBeenCalledTimes(3);
    const codes = harness.createShaderModule.mock.calls.map((call) => (call[0] as { code: string }).code);
    expect(new Set(codes).size).toBe(3);
    runtime.dispose();
  });

  it("알 수 없는 커널 id 는 던진다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    expect(() =>
      runtime.getComputePipeline("nope" as unknown as Parameters<typeof runtime.getComputePipeline>[0]),
    ).toThrow();
    runtime.dispose();
  });
});

describe("studio-pbr-gpu-runtime: 버퍼", () => {
  it("f32 storage 버퍼가 요소 수 × 4 바이트로 잡히고 usage 비트가 맞다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    runtime.createFloatBuffer(1024, "ao");
    const descriptor = harness.createBuffer.mock.calls[0][0] as { size: number; usage: number };
    expect(descriptor.size).toBe(4096);
    expect(descriptor.usage & 0x0080).toBe(0x0080); // STORAGE
    expect(descriptor.usage & 0x0004).toBe(0x0004); // COPY_SRC
    expect(descriptor.usage & 0x0008).toBe(0x0008); // COPY_DST
    runtime.dispose();
  });

  it("uniform 버퍼는 UNIFORM|COPY_DST 이고 즉시 기록된다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    const uniform = new ArrayBuffer(32);
    runtime.createUniformBuffer(uniform, "params");
    const descriptor = harness.createBuffer.mock.calls[0][0] as { size: number; usage: number };
    expect(descriptor.size).toBe(32);
    expect(descriptor.usage & 0x0040).toBe(0x0040); // UNIFORM
    expect(harness.writeBuffer).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("잘못된 요소 수는 던진다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    expect(() => runtime.createFloatBuffer(0)).toThrow();
    expect(() => runtime.createFloatBuffer(1.5)).toThrow();
    runtime.dispose();
  });

  it("readback 이 매핑된 메모리의 복사본을 돌려준다(unmap 후에도 유효)", async () => {
    const payload = Float32Array.from([1.5, 2.5, 3.5, 4.5]);
    const harness = createFakeDevice(payload);
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    const source = runtime.createFloatBuffer(4);
    const result = await runtime.readbackFloats(source, 4);
    expect(Array.from(result)).toEqual([1.5, 2.5, 3.5, 4.5]);
    runtime.dispose();
  });
});

describe("studio-pbr-gpu-runtime: 수명·경합", () => {
  it("device lost 면 선택한 WebGPU가 terminal unavailable이고 모든 연산이 거부된다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    expect(runtime.lost).toBe(false);
    harness.loseDevice();
    await flushMicrotasks();
    expect(runtime.lost).toBe(true);
    for (const operation of [
      () => runtime.getComputePipeline("ssao"),
      () => runtime.createFloatBuffer(1),
      () => runtime.createUniformBuffer(new ArrayBuffer(16)),
      () => runtime.writeFloats({} as GPUBuffer, Float32Array.of(1)),
    ]) {
      expect(operation).toThrow(StudioPbrGpuRuntimeError);
      expect(operation).toThrow(/계속할 수 없습니다/u);
    }
    await expect(runtime.readbackFloats({} as GPUBuffer, 1)).rejects.toMatchObject({
      status: "unavailable",
      code: "device-lost",
      selectedExecutionBackend: "webgpu",
      attemptedExecutionBackends: ["webgpu"],
    });
  });

  it("공유 싱글턴을 재사용하고 다음 명시적 WebGPU operation만 새 device를 획득한다", async () => {
    const first = createFakeDevice();
    const gpuFactory = { current: first };
    const gpu = {
      requestAdapter: async () => ({ requestDevice: async () => gpuFactory.current.device }),
    } as unknown as GPU;

    // 주입 경로는 싱글턴을 우회하므로, 싱글턴 동작은 navigator.gpu 를 흉내 내 검증한다.
    // node 의 navigator 는 getter-only 라 직접 대입이 안 된다 → stubGlobal 사용.
    vi.stubGlobal("navigator", { gpu });
    try {
      const a = await acquireSharedWebGpu();
      const b = await acquireSharedWebGpu();
      expect(b).toBe(a);

      first.loseDevice();
      await flushMicrotasks();
      const second = createFakeDevice();
      gpuFactory.current = second;
      const c = await acquireSharedWebGpu();
      expect(c).not.toBe(a);
      expect(c.device).toBe(second.device);
    } finally {
      disposeStudioPbrGpuRuntime();
      vi.unstubAllGlobals();
    }
  });

  it("dispose 는 디바이스를 파괴하고 두 번 불러도 안전하다", async () => {
    const harness = createFakeDevice();
    const runtime = await acquireInjectedWebGpu(fakeGpuFor(harness.device));
    runtime.dispose();
    runtime.dispose();
    expect(harness.destroy).toHaveBeenCalledTimes(1);
    expect(() => runtime.getComputePipeline("ssao")).toThrowError(expect.objectContaining({
      code: "runtime-disposed",
      attemptedExecutionBackends: ["webgpu"],
    }));
  });

  it("획득 중 dispose 가 끼어들면 늦게 온 디바이스를 심지 않고 폐기한다", async () => {
    const harness = createFakeDevice();
    let releaseDevice: ((device: GPUDevice) => void) | null = null;
    const slowGpu = {
      requestAdapter: async () => ({
        requestDevice: () =>
          new Promise<GPUDevice>((resolve) => {
            releaseDevice = resolve;
          }),
      }),
    } as unknown as GPU;

    vi.stubGlobal("navigator", { gpu: slowGpu });
    try {
      const pending = acquireSharedWebGpu();
      // requestAdapter 가 먼저 resolve 돼야 requestDevice 가 불린다.
      await flushMicrotasks();
      disposeStudioPbrGpuRuntime(); // 세대 증가 — 이 시점에 디바이스는 아직 in-flight
      releaseDevice!(harness.device);
      await expect(pending).rejects.toMatchObject({
        code: "acquisition-superseded",
        attemptedExecutionBackends: ["webgpu"],
      });
      // 버려진 디바이스는 실제로 destroy 된다(누수 방지).
      expect(harness.destroy).toHaveBeenCalledTimes(1);
    } finally {
      disposeStudioPbrGpuRuntime();
      vi.unstubAllGlobals();
    }
  });
});
