import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acquireStudioPathtraceGpuRuntime,
  disposeStudioPathtraceGpuRuntime,
  studioPathtraceAccumByteLength,
  supportsStudioPathtraceGpu,
} from "./studio-pathtrace-gpu-runtime";
import { STUDIO_PATHTRACE_MAX_PIXELS } from "./studio-pathtrace-scene";
import { STUDIO_PATHTRACE_SHADER } from "./studio-pathtrace-wgsl";

interface FakeBuffer {
  size: number;
  usage: number;
  label?: string;
  destroyed: boolean;
  destroy(): void;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

interface FakeDeviceState {
  buffers: FakeBuffer[];
  writes: { target: FakeBuffer; byteLength: number }[];
  shaderModules: string[];
  pipelines: string[];
  destroyed: boolean;
  submits: number;
}

function createFakeGpu(options: { adapter?: boolean; throwOnDevice?: boolean } = {}) {
  const state: FakeDeviceState = {
    buffers: [],
    writes: [],
    shaderModules: [],
    pipelines: [],
    destroyed: false,
    submits: 0,
  };
  let resolveLost: ((info: unknown) => void) | null = null;
  const lost = new Promise<unknown>((resolve) => {
    resolveLost = resolve;
  });

  function makeBuffer(descriptor: { size: number; usage: number; label?: string }): FakeBuffer {
    const backing = new ArrayBuffer(descriptor.size);
    const buffer: FakeBuffer = {
      size: descriptor.size,
      usage: descriptor.usage,
      label: descriptor.label,
      destroyed: false,
      destroy() {
        buffer.destroyed = true;
      },
      mapAsync: () => Promise.resolve(),
      getMappedRange: () => backing,
      unmap: () => undefined,
    };
    state.buffers.push(buffer);
    return buffer;
  }

  const device = {
    lost,
    destroy() {
      state.destroyed = true;
    },
    createBuffer: (d: { size: number; usage: number; label?: string }) => makeBuffer(d),
    createShaderModule: (d: { code: string; label?: string }) => {
      state.shaderModules.push(d.label ?? "");
      return { code: d.code };
    },
    createComputePipeline: (d: { label?: string }) => {
      state.pipelines.push(d.label ?? "");
      return { label: d.label };
    },
    createCommandEncoder: () => ({
      copyBufferToBuffer: () => undefined,
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: (target: FakeBuffer, _offset: number, data: ArrayBuffer | ArrayBufferView) => {
        state.writes.push({ target, byteLength: data.byteLength });
      },
      submit: () => {
        state.submits += 1;
      },
    },
  };

  const gpu = {
    requestAdapter: () =>
      Promise.resolve(
        options.adapter === false
          ? null
          : {
              requestDevice: () =>
                options.throwOnDevice ? Promise.reject(new Error("no device")) : Promise.resolve(device),
            },
      ),
  };

  return { gpu: gpu as unknown as GPU, state, loseDevice: () => resolveLost?.({ reason: "destroyed" }) };
}

afterEach(() => {
  disposeStudioPathtraceGpuRuntime();
  vi.unstubAllGlobals();
});

describe("기능 감지", () => {
  it("gpu 가 null 이거나 requestAdapter 가 없으면 미지원", () => {
    expect(supportsStudioPathtraceGpu(null)).toBe(false);
    expect(supportsStudioPathtraceGpu({} as GPU)).toBe(false);
    expect(supportsStudioPathtraceGpu(createFakeGpu().gpu)).toBe(true);
  });

  it("navigator 가 없는 node 환경에서 기본값이 미지원이다", () => {
    expect(supportsStudioPathtraceGpu()).toBe(typeof navigator !== "undefined" && !!navigator.gpu);
  });
});

describe("acquireStudioPathtraceGpuRuntime — 폴백 계약", () => {
  it("gpu: null 은 즉시 null(호출부 CPU 폴백)", async () => {
    await expect(acquireStudioPathtraceGpuRuntime({ gpu: null })).resolves.toBeNull();
  });

  it("어댑터가 없으면 null", async () => {
    const { gpu } = createFakeGpu({ adapter: false });
    await expect(acquireStudioPathtraceGpuRuntime({ gpu })).resolves.toBeNull();
  });

  it("디바이스 요청이 던지면 null(예외를 밖으로 흘리지 않는다)", async () => {
    const { gpu } = createFakeGpu({ throwOnDevice: true });
    await expect(acquireStudioPathtraceGpuRuntime({ gpu })).resolves.toBeNull();
  });

  it("주입된 gpu 는 싱글턴을 우회해 매번 새 런타임을 만든다", async () => {
    const { gpu } = createFakeGpu();
    const a = await acquireStudioPathtraceGpuRuntime({ gpu });
    const b = await acquireStudioPathtraceGpuRuntime({ gpu });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).not.toBe(b);
    a?.dispose();
    b?.dispose();
  });

  it("싱글턴 경로는 같은 런타임을 재사용하고 dispose 후 새로 만든다", async () => {
    const { gpu, state } = createFakeGpu();
    vi.stubGlobal("navigator", { gpu });
    const a = await acquireStudioPathtraceGpuRuntime();
    const b = await acquireStudioPathtraceGpuRuntime();
    expect(a).toBe(b);
    expect(state.destroyed).toBe(false);
    disposeStudioPathtraceGpuRuntime();
    expect(state.destroyed).toBe(true);
    const c = await acquireStudioPathtraceGpuRuntime();
    expect(c).not.toBe(a);
    disposeStudioPathtraceGpuRuntime();
  });

  it("device lost 는 런타임을 lost 로 표시하고 싱글턴을 비운다", async () => {
    const { gpu, loseDevice } = createFakeGpu();
    vi.stubGlobal("navigator", { gpu });
    const runtime = await acquireStudioPathtraceGpuRuntime();
    expect(runtime?.lost).toBe(false);
    loseDevice();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime?.lost).toBe(true);
    const next = await acquireStudioPathtraceGpuRuntime();
    expect(next).not.toBe(runtime);
  });

  it("획득 도중 dispose 되면 새 디바이스를 정리하고 null 을 준다", async () => {
    const { gpu, state } = createFakeGpu();
    vi.stubGlobal("navigator", { gpu });
    const pending = acquireStudioPathtraceGpuRuntime();
    disposeStudioPathtraceGpuRuntime();
    await expect(pending).resolves.toBeNull();
    expect(state.destroyed).toBe(true);
  });
});

describe("버퍼/파이프라인 계약", () => {
  it("storage/uniform/accum 버퍼가 규격에 맞는 usage 와 정렬을 갖는다", async () => {
    const { gpu, state } = createFakeGpu();
    const runtime = await acquireStudioPathtraceGpuRuntime({ gpu });
    expect(runtime).not.toBeNull();
    if (!runtime) return;

    const storage = runtime.createStorageBuffer(Float32Array.from([1, 2, 3]), "positions");
    expect((storage as unknown as FakeBuffer).size).toBe(12);
    expect((storage as unknown as FakeBuffer).usage & 0x0080).toBe(0x0080); // STORAGE
    expect((storage as unknown as FakeBuffer).usage & 0x0008).toBe(0x0008); // COPY_DST

    // 4의 배수가 아닌 바이트도 올림한다.
    const odd = runtime.createStorageBuffer(new Uint8Array([1, 2, 3]), "odd");
    expect((odd as unknown as FakeBuffer).size).toBe(4);

    const accum = runtime.createAccumBuffer(studioPathtraceAccumByteLength(16, 16), "accum");
    expect((accum as unknown as FakeBuffer).size).toBe(16 * 16 * 16);
    expect((accum as unknown as FakeBuffer).usage & 0x0004).toBe(0x0004); // COPY_SRC

    const uniform = runtime.createUniformBuffer(new ArrayBuffer(144), "uniform");
    expect((uniform as unknown as FakeBuffer).size).toBe(144);
    expect((uniform as unknown as FakeBuffer).usage & 0x0040).toBe(0x0040); // UNIFORM

    runtime.writeUniform(uniform, new ArrayBuffer(144));
    expect(state.writes.filter((w) => w.byteLength === 144).length).toBe(2);

    runtime.dispose();
    expect(state.buffers.every((b) => b.destroyed)).toBe(true);
    expect(state.destroyed).toBe(true);
  });

  it("파이프라인은 shaderId 로 캐시된다", async () => {
    const { gpu, state } = createFakeGpu();
    const runtime = await acquireStudioPathtraceGpuRuntime({ gpu });
    if (!runtime) throw new Error("runtime");
    const a = runtime.getComputePipeline(
      STUDIO_PATHTRACE_SHADER.shaderId,
      STUDIO_PATHTRACE_SHADER.wgsl,
      STUDIO_PATHTRACE_SHADER.entryPoint,
    );
    const b = runtime.getComputePipeline(
      STUDIO_PATHTRACE_SHADER.shaderId,
      STUDIO_PATHTRACE_SHADER.wgsl,
      STUDIO_PATHTRACE_SHADER.entryPoint,
    );
    expect(a).toBe(b);
    expect(state.shaderModules.length).toBe(1);
    expect(state.pipelines.length).toBe(1);
    runtime.dispose();
  });

  it("readback 은 복사 → map → 새 Float32Array 를 돌려주고 스테이징을 정리한다", async () => {
    const { gpu, state } = createFakeGpu();
    const runtime = await acquireStudioPathtraceGpuRuntime({ gpu });
    if (!runtime) throw new Error("runtime");
    const source = runtime.createAccumBuffer(64, "accum");
    const result = await runtime.readbackFloats(source, 16);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(16);
    expect(state.submits).toBe(1);
    // 스테이징 버퍼(마지막 생성분)는 즉시 파기된다.
    expect(state.buffers[state.buffers.length - 1].destroyed).toBe(true);
    runtime.dispose();
  });
});

describe("누적 버퍼 크기 계산", () => {
  it("픽셀당 16바이트이고 상한을 넘으면 0(거절)", () => {
    expect(studioPathtraceAccumByteLength(4, 4)).toBe(4 * 4 * 16);
    expect(studioPathtraceAccumByteLength(1920, 1080)).toBe(1920 * 1080 * 16);
    expect(studioPathtraceAccumByteLength(0, 10)).toBe(0);
    expect(studioPathtraceAccumByteLength(4096, 4096)).toBe(0);
    expect(studioPathtraceAccumByteLength(2048, 2048)).toBe(STUDIO_PATHTRACE_MAX_PIXELS * 16);
  });
});
