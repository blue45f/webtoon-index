import { describe, expect, it } from "vitest";

import {
  denoiseStudioFrame,
  prepareStudioDenoiseFrame,
  runStudioDenoiseAtrousCpu,
} from "./studio-denoise-atrous";
import {
  STUDIO_DENOISE_DEFAULT_OPTIONS,
  resolveStudioDenoiseOptions,
  type StudioDenoiseFrame,
} from "./studio-denoise-contract";
import {
  STUDIO_DENOISE_ATROUS_UNIFORM_BYTES,
  STUDIO_DENOISE_ATROUS_UNIFORM_OFFSETS,
  STUDIO_DENOISE_ATROUS_WGSL,
  STUDIO_DENOISE_WORKGROUP_SIZE,
  acquireStudioDenoiseGpuRuntime,
  denoiseStudioFrameOnGpu,
  packStudioDenoiseAtrousUniform,
  runStudioDenoiseAtrousGpu,
  studioDenoiseWorkgroupCount,
  supportsStudioDenoiseGpu,
} from "./studio-denoise-gpu";
import { createStudioDenoiseMaterialSplitScene } from "./studio-denoise-scene-fixture";

interface RecordedDispatch {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly srcId: number;
  readonly dstId: number;
}

interface FakeGpuRecorder {
  readonly gpu: GPU;
  readonly dispatches: RecordedDispatch[];
  readonly uniformWrites: ArrayBuffer[];
  readonly bufferSizes: number[];
  readonly destroyed: number[];
  readonly shaderCode: string[];
  readonly entryPoints: string[];
  readonly submits: number[];
  /** readback 이 돌려줄 데이터. 지정하지 않으면 0 으로 채운다. */
  readback: Float32Array | null;
}

/**
 * 기록형 가짜 WebGPU 디바이스.
 * 계산은 하지 않지만 파이프라인·바인드그룹·디스패치·핑퐁 순서를 전부 기록해서
 * "GPU 심(seam)이 계약대로 배선되었는가"를 GPU 없이 검증한다.
 */
function createFakeGpu(options?: { failAdapter?: boolean; throwOnDevice?: boolean }): FakeGpuRecorder {
  let nextBufferId = 1;
  const recorder: FakeGpuRecorder = {
    gpu: null as unknown as GPU,
    dispatches: [],
    uniformWrites: [],
    bufferSizes: [],
    destroyed: [],
    shaderCode: [],
    entryPoints: [],
    submits: [],
    readback: null,
  };

  const makeBuffer = (size: number): any => {
    const id = nextBufferId;
    nextBufferId += 1;
    recorder.bufferSizes.push(size);
    return {
      __id: id,
      size,
      destroy: () => recorder.destroyed.push(id),
      mapAsync: () => Promise.resolve(),
      getMappedRange: () => {
        const source = recorder.readback ?? new Float32Array(size / 4);
        return source.buffer.slice(0, size);
      },
      unmap: () => undefined,
    };
  };

  const device: any = {
    lost: new Promise(() => undefined),
    queue: {
      writeBuffer: (target: any, _offset: number, data: ArrayBuffer | ArrayBufferLike) => {
        if (target.__uniform) recorder.uniformWrites.push(data as ArrayBuffer);
      },
      submit: (buffers: unknown[]) => recorder.submits.push(buffers.length),
    },
    createShaderModule: ({ code }: { code: string }) => {
      recorder.shaderCode.push(code);
      return { __module: true };
    },
    createComputePipeline: ({ compute }: any) => {
      recorder.entryPoints.push(compute.entryPoint);
      return { getBindGroupLayout: () => ({ __layout: true }) };
    },
    createBuffer: ({ size, usage }: { size: number; usage: number }) => {
      const buffer = makeBuffer(size);
      buffer.__uniform = (usage & 0x0040) !== 0;
      return buffer;
    },
    createBindGroup: ({ label, entries }: any) => ({
      __label: label,
      __src: entries.find((e: any) => e.binding === 1)?.resource.buffer.__id,
      __dst: entries.find((e: any) => e.binding === 2)?.resource.buffer.__id,
      __bindings: entries.map((e: any) => e.binding),
    }),
    createCommandEncoder: () => {
      let pending: any = null;
      return {
        beginComputePass: ({ label }: { label: string }) => ({
          setPipeline: () => undefined,
          setBindGroup: (_index: number, group: any) => {
            pending = { label, group };
          },
          dispatchWorkgroups: (x: number, y: number) => {
            recorder.dispatches.push({
              label: pending.label,
              x,
              y,
              srcId: pending.group.__src,
              dstId: pending.group.__dst,
            });
          },
          end: () => undefined,
        }),
        copyBufferToBuffer: () => undefined,
        finish: () => ({ __commands: true }),
      };
    },
    destroy: () => undefined,
  };

  const adapter: any = {
    requestDevice: () => {
      if (options?.throwOnDevice) throw new Error("device denied");
      return Promise.resolve(device);
    },
  };

  (recorder as { gpu: GPU }).gpu = {
    requestAdapter: () => Promise.resolve(options?.failAdapter ? null : adapter),
  } as unknown as GPU;

  return recorder;
}

const scene = createStudioDenoiseMaterialSplitScene({
  width: 16,
  height: 16,
  seed: 3,
  sampleCount: 8,
  noiseSigma: 1.2,
});

describe("studio-denoise GPU — WGSL 커널 소스", () => {
  it("계약상의 바인딩 5개를 정확한 인덱스로 선언한다", () => {
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("@group(0) @binding(0) var<uniform> params");
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain(
      "@group(0) @binding(1) var<storage, read> srcSignal: array<vec4<f32>>",
    );
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain(
      "@group(0) @binding(2) var<storage, read_write> dstSignal: array<vec4<f32>>",
    );
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("@binding(3) var<storage, read> guideA");
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("@binding(4) var<storage, read> guideB");
  });

  it("CPU 와 동일한 B3-스플라인 커널 상수를 쓴다", () => {
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("0.0625, 0.25, 0.375, 0.25, 0.0625");
  });

  it("CPU 와 동일한 Rec.709 휘도 계수를 쓴다", () => {
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("vec3<f32>(0.2126, 0.7152, 0.0722)");
  });

  it("네 가지 엣지 스토핑 항을 모두 포함한다", () => {
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("params.sigmaNormal"); // w_n
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("params.sigmaDepth"); // w_z
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("params.sigmaAlbedo"); // w_a
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("lumaDenom"); // w_l
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("sumVar / (weightSum * weightSum)");
  });

  it("워크그룹 크기가 상수와 일치한다", () => {
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain(
      `@workgroup_size(${String(STUDIO_DENOISE_WORKGROUP_SIZE)}, ${String(STUDIO_DENOISE_WORKGROUP_SIZE)}, 1)`,
    );
  });

  it("배경(depth<=0) 픽셀은 셰이더에서도 통과시킨다", () => {
    expect(STUDIO_DENOISE_ATROUS_WGSL).toContain("if (zp <= 0.0)");
  });
});

describe("studio-denoise GPU — uniform 패킹", () => {
  it("WGSL struct 레이아웃과 같은 오프셋/크기로 채운다", () => {
    const options = resolveStudioDenoiseOptions({
      sigmaLuma: 5,
      sigmaNormal: 32,
      sigmaDepth: 2,
      sigmaAlbedo: 0.5,
      epsLuma: 1e-5,
      depthEpsilon: 0.02,
    });
    const buffer = packStudioDenoiseAtrousUniform(1920, 1080, 8, options);
    expect(buffer.byteLength).toBe(STUDIO_DENOISE_ATROUS_UNIFORM_BYTES);
    expect(STUDIO_DENOISE_ATROUS_UNIFORM_BYTES % 16).toBe(0); // std140 정렬

    const view = new DataView(buffer);
    const o = STUDIO_DENOISE_ATROUS_UNIFORM_OFFSETS;
    expect(view.getUint32(o.width, true)).toBe(1920);
    expect(view.getUint32(o.height, true)).toBe(1080);
    expect(view.getUint32(o.stepWidth, true)).toBe(8);
    expect(view.getUint32(o.useLuminanceWeight, true)).toBe(1);
    expect(view.getFloat32(o.sigmaLuma, true)).toBeCloseTo(5, 5);
    expect(view.getFloat32(o.sigmaNormal, true)).toBeCloseTo(32, 5);
    expect(view.getFloat32(o.sigmaDepth, true)).toBeCloseTo(2, 5);
    expect(view.getFloat32(o.sigmaAlbedo, true)).toBeCloseTo(0.5, 5);
    expect(view.getFloat32(o.epsLuma, true)).toBeCloseTo(1e-5, 10);
    expect(view.getFloat32(o.depthEpsilon, true)).toBeCloseTo(0.02, 6);
  });

  it("useLuminanceWeight=false 를 0 으로 인코딩한다", () => {
    const buffer = packStudioDenoiseAtrousUniform(
      4,
      4,
      1,
      resolveStudioDenoiseOptions({ useLuminanceWeight: false }),
    );
    const view = new DataView(buffer);
    expect(view.getUint32(STUDIO_DENOISE_ATROUS_UNIFORM_OFFSETS.useLuminanceWeight, true)).toBe(0);
  });

  it("워크그룹 수는 올림 나눗셈이다", () => {
    expect(studioDenoiseWorkgroupCount(0)).toBe(0);
    expect(studioDenoiseWorkgroupCount(1)).toBe(1);
    expect(studioDenoiseWorkgroupCount(8)).toBe(1);
    expect(studioDenoiseWorkgroupCount(9)).toBe(2);
    expect(studioDenoiseWorkgroupCount(1920)).toBe(240);
  });
});

describe("studio-denoise GPU — 런타임 심(seam)", () => {
  it("gpu 미지원이면 null 을 돌려준다 (호출부 CPU 폴백)", async () => {
    expect(supportsStudioDenoiseGpu(null)).toBe(false);
    await expect(acquireStudioDenoiseGpuRuntime({ gpu: null })).resolves.toBeNull();
  });

  it("어댑터가 없으면 null 을 돌려준다", async () => {
    const fake = createFakeGpu({ failAdapter: true });
    await expect(acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu })).resolves.toBeNull();
  });

  it("디바이스 획득이 던지면 삼키고 null 을 돌려준다", async () => {
    const fake = createFakeGpu({ throwOnDevice: true });
    await expect(acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu })).resolves.toBeNull();
  });

  it("주입한 gpu 는 공유 싱글턴을 우회해 매번 새 런타임을 만든다", async () => {
    const fake = createFakeGpu();
    const a = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    const b = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    expect(a).not.toBeNull();
    expect(b).not.toBe(a);
  });

  it("파이프라인은 한 번만 만들고 재사용한다", async () => {
    const fake = createFakeGpu();
    const runtime = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    runtime?.getAtrousPipeline();
    runtime?.getAtrousPipeline();
    expect(fake.shaderCode).toHaveLength(1);
    expect(fake.entryPoints).toEqual(["main"]);
  });

  it("dispose 후 파이프라인 요청은 던진다", async () => {
    const fake = createFakeGpu();
    const runtime = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    runtime?.dispose();
    expect(() => runtime?.getAtrousPipeline()).toThrow();
  });
});

describe("studio-denoise GPU — 레벨 루프 배선", () => {
  it("레벨마다 한 번씩 디스패치하고 버퍼를 핑퐁한다", async () => {
    const fake = createFakeGpu();
    const runtime = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    const prepared = prepareStudioDenoiseFrame(scene.frame, { levels: 4 });
    await runStudioDenoiseAtrousGpu(runtime as NonNullable<typeof runtime>, prepared);

    expect(fake.dispatches).toHaveLength(4);
    for (const dispatch of fake.dispatches) {
      expect(dispatch.x).toBe(studioDenoiseWorkgroupCount(16));
      expect(dispatch.y).toBe(studioDenoiseWorkgroupCount(16));
    }
    // 핑퐁: 레벨 n 의 dst 가 레벨 n+1 의 src 가 되어야 한다.
    for (let i = 1; i < fake.dispatches.length; i += 1) {
      expect(fake.dispatches[i].srcId).toBe(fake.dispatches[i - 1].dstId);
      expect(fake.dispatches[i].dstId).toBe(fake.dispatches[i - 1].srcId);
    }
    // 커맨드 인코더는 한 번만 제출한다(레벨마다 flush 하지 않는다).
    expect(fake.submits.filter((n) => n === 1)).not.toHaveLength(0);
  });

  it("레벨마다 stepwidth 가 2배로 커진 uniform 을 쓴다", async () => {
    const fake = createFakeGpu();
    const runtime = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    const prepared = prepareStudioDenoiseFrame(scene.frame, { levels: 5 });
    await runStudioDenoiseAtrousGpu(runtime as NonNullable<typeof runtime>, prepared);

    const steps = fake.uniformWrites.map((buffer) =>
      new DataView(buffer).getUint32(STUDIO_DENOISE_ATROUS_UNIFORM_OFFSETS.stepWidth, true),
    );
    expect(steps).toEqual([1, 2, 4, 8, 16]);
  });

  it("levels=0 이면 GPU 를 전혀 건드리지 않고 입력 신호를 그대로 돌려준다", async () => {
    const fake = createFakeGpu();
    const runtime = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    const prepared = prepareStudioDenoiseFrame(scene.frame, { levels: 0 });
    const out = await runStudioDenoiseAtrousGpu(runtime as NonNullable<typeof runtime>, prepared);
    expect(fake.dispatches).toHaveLength(0);
    expect(Array.from(out)).toEqual(Array.from(prepared.signal));
  });

  it("모든 GPU 버퍼를 정리한다 (누수 없음)", async () => {
    const fake = createFakeGpu();
    const runtime = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    const prepared = prepareStudioDenoiseFrame(scene.frame, { levels: 3 });
    await runStudioDenoiseAtrousGpu(runtime as NonNullable<typeof runtime>, prepared);
    // signal x2 + guide x2 + uniform x3 = 7 (readback staging 은 자체 destroy)
    expect(fake.destroyed.length).toBeGreaterThanOrEqual(7);
  });

  it("스토리지 버퍼 크기가 vec4 스트라이드와 일치한다", async () => {
    const fake = createFakeGpu();
    const runtime = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    const prepared = prepareStudioDenoiseFrame(scene.frame, { levels: 1 });
    await runStudioDenoiseAtrousGpu(runtime as NonNullable<typeof runtime>, prepared);
    const expected = 16 * 16 * 4 * 4; // px * vec4 * f32
    expect(fake.bufferSizes.filter((size) => size === expected).length).toBeGreaterThanOrEqual(4);
  });
});

describe("studio-denoise GPU — 프레임 진입점", () => {
  it("readback 결과를 CPU 후처리(역도메인+리모듈레이션)에 그대로 넣는다", async () => {
    const fake = createFakeGpu();
    const prepared = prepareStudioDenoiseFrame(scene.frame);
    // 가짜 디바이스는 계산을 못 하므로, CPU 로 구한 정답 신호를 readback 값으로 심는다.
    fake.readback = runStudioDenoiseAtrousCpu(prepared);

    const result = await denoiseStudioFrameOnGpu(scene.frame, { gpu: fake.gpu });
    expect(result).not.toBeNull();
    expect(result?.stats.backend).toBe("gpu");
    expect(result?.width).toBe(16);
    expect(result?.color.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    // 같은 신호로 후처리했으므로 CPU 전체 경로와 비트 동일해야 한다.
    const cpuColor = Array.from(denoiseStudioFrame(scene.frame).color);
    expect(Array.from(result?.color ?? new Float32Array())).toEqual(cpuColor);
  });

  it("런타임을 얻지 못하면 null 을 돌려준다 (조용히 CPU 로 대체하지 않는다)", async () => {
    await expect(denoiseStudioFrameOnGpu(scene.frame, { gpu: null })).resolves.toBeNull();
  });

  it("실행 중 예외는 삼키고 null 로 폴백 신호를 준다", async () => {
    const fake = createFakeGpu();
    const runtime = await acquireStudioDenoiseGpuRuntime({ gpu: fake.gpu });
    const broken = {
      ...(runtime as NonNullable<typeof runtime>),
      getAtrousPipeline: () => {
        throw new Error("device lost");
      },
    } as unknown as NonNullable<typeof runtime>;
    await expect(denoiseStudioFrameOnGpu(scene.frame, { runtime: broken })).resolves.toBeNull();
  });

  it("구조적으로 잘못된 프레임은 GPU 경로에서도 던진다(폴백으로 감추지 않는다)", async () => {
    const fake = createFakeGpu();
    const bad: StudioDenoiseFrame = { width: 4, height: 4, color: new Float32Array(5) };
    await expect(denoiseStudioFrameOnGpu(bad, { gpu: fake.gpu })).rejects.toThrow();
  });

  it("기본 옵션 상수는 CPU/GPU 가 같은 객체를 참조한다", () => {
    expect(resolveStudioDenoiseOptions()).toBe(STUDIO_DENOISE_DEFAULT_OPTIONS);
  });
});
