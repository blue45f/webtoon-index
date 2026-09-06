/**
 * Studio Path Tracer — WebGPU 디바이스 seam (studio-pathtrace-gpu-runtime)
 *
 * `GPU*` 타입을 만지는 **유일한** 패스트레이스 모듈이다. 나머지 전부(BVH·인테그레이터·
 * 필름·WGSL 문자열)는 순수하며 node 테스트에서 그대로 돈다.
 *
 * 수명 규율은 studio-gpu-filter-runtime.ts 를 그대로 복제한다:
 *  - 기능 감지 실패 / adapter 없음 / 획득 예외 → `null` (선택한 WebGPU 경로 unavailable)
 *  - device lost → 런타임을 lost 로 표시하고 공유 싱글턴을 비운다
 *  - dispose 는 generation 카운터로 in-flight 획득과 경합해도 안전하다
 *  - `options.gpu` 를 주면 싱글턴을 우회한다(테스트는 fake seam, `null` 은 미지원 강제)
 *
 * 이 모듈은 node 테스트에서도 import 되므로 `GPUBufferUsage`/`GPUMapMode` 전역 대신
 * WebGPU 명세의 고정 상수 값을 직접 쓴다.
 *
 * 정직한 한계
 *  - 파이프라인 생성/버퍼 할당/디스패치 **오케스트레이션만** 제공한다. 실제 커널 실행의
 *    정확성은 실브라우저 verify 스크립트 영역이며, 여기 테스트는 획득/lost/dispose/버퍼
 *    계약만 검증한다("컴파일된다"를 주장하지 않는다).
 *  - 패스트레이스 버퍼는 필터 런타임(rgba8-as-u32 픽셀 전용)과 재사용할 수 없어
 *    독립 디바이스를 잡는다.
 */

import { STUDIO_PATHTRACE_MAX_PIXELS } from "./studio-pathtrace-scene";

// WebGPU 명세 고정 상수(GPUBufferUsage/GPUMapMode) — node 환경에는 전역이 없다.
const USAGE_MAP_READ = 0x0001;
const USAGE_COPY_SRC = 0x0004;
const USAGE_COPY_DST = 0x0008;
const USAGE_UNIFORM = 0x0040;
const USAGE_STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;

export interface StudioPathtraceGpuRuntimeOptions {
  /**
   * 테스트/하니스 주입용 GPU 오버라이드. 지정되면 공유 싱글턴을 우회해 매 호출 새로
   * 획득한다(테스트 간 상태 오염 방지). `null` 은 "미지원 환경" 강제.
   */
  readonly gpu?: GPU | null;
}

export interface StudioPathtraceGpuRuntime {
  readonly device: GPUDevice;
  /** true 면 선택한 WebGPU 경로를 다시 쓸 수 없고 해당 작업은 unavailable이다. */
  readonly lost: boolean;
  getComputePipeline(shaderId: string, wgsl: string, entryPoint: string): GPUComputePipeline;
  /** 읽기 전용 씬 데이터(STORAGE | COPY_DST). */
  createStorageBuffer(data: ArrayBufferView, label?: string): GPUBuffer;
  /** 누적 필름(STORAGE | COPY_SRC | COPY_DST) — 디스패치마다 read_write 로 갱신된다. */
  createAccumBuffer(byteLength: number, label?: string): GPUBuffer;
  createUniformBuffer(uniform: ArrayBuffer, label?: string): GPUBuffer;
  writeUniform(target: GPUBuffer, uniform: ArrayBuffer): void;
  /** 스테이징 MAP_READ 버퍼로 복사 → mapAsync → 새 Float32Array 로 반환. */
  readbackFloats(source: GPUBuffer, floatCount: number): Promise<Float32Array>;
  dispose(): void;
}

function defaultGpu(): GPU | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as { gpu?: GPU }).gpu ?? null;
}

/** WebGPU 사용 가능 여부(디바이스 획득 없이 기능 감지만). */
export function supportsStudioPathtraceGpu(gpu: GPU | null = defaultGpu()): boolean {
  return !!gpu && typeof gpu.requestAdapter === "function";
}

/** 누적 버퍼 바이트 수. 상한(MAX_PIXELS)을 넘으면 0 을 돌려 호출부가 거절하게 한다. */
export function studioPathtraceAccumByteLength(width: number, height: number): number {
  const pixels = width * height;
  if (!Number.isInteger(pixels) || pixels < 1 || pixels > STUDIO_PATHTRACE_MAX_PIXELS) return 0;
  return pixels * 4 * 4;
}

function safeDestroyDevice(device: GPUDevice | null): void {
  try {
    device?.destroy();
  } catch {
    // destroy 는 이미 lost 된 디바이스에서 던질 수 있다 — 폐기 경로에서는 무시.
  }
}

class StudioPathtraceGpuRuntimeImpl implements StudioPathtraceGpuRuntime {
  readonly device: GPUDevice;
  lost = false;
  private readonly modules = new Map<string, GPUShaderModule>();
  private readonly pipelines = new Map<string, GPUComputePipeline>();
  private readonly buffers = new Set<GPUBuffer>();
  private disposed = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  markLost(): void {
    this.lost = true;
  }

  private track(buffer: GPUBuffer): GPUBuffer {
    this.buffers.add(buffer);
    return buffer;
  }

  getComputePipeline(shaderId: string, wgsl: string, entryPoint: string): GPUComputePipeline {
    const key = `${shaderId}::${entryPoint}`;
    const cached = this.pipelines.get(key);
    if (cached) return cached;
    let shaderModule = this.modules.get(shaderId);
    if (!shaderModule) {
      shaderModule = this.device.createShaderModule({ code: wgsl, label: shaderId });
      this.modules.set(shaderId, shaderModule);
    }
    const pipeline = this.device.createComputePipeline({
      label: key,
      layout: "auto",
      compute: { module: shaderModule, entryPoint },
    });
    this.pipelines.set(key, pipeline);
    return pipeline;
  }

  createStorageBuffer(data: ArrayBufferView, label?: string): GPUBuffer {
    // WebGPU 는 버퍼 크기를 4의 배수로 요구한다.
    const size = Math.max(4, Math.ceil(data.byteLength / 4) * 4);
    const buffer = this.device.createBuffer({
      label,
      size,
      usage: USAGE_STORAGE | USAGE_COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    return this.track(buffer);
  }

  createAccumBuffer(byteLength: number, label?: string): GPUBuffer {
    const size = Math.max(4, Math.ceil(byteLength / 4) * 4);
    return this.track(
      this.device.createBuffer({
        label,
        size,
        usage: USAGE_STORAGE | USAGE_COPY_SRC | USAGE_COPY_DST,
      }),
    );
  }

  createUniformBuffer(uniform: ArrayBuffer, label?: string): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: Math.max(16, Math.ceil(uniform.byteLength / 16) * 16),
      usage: USAGE_UNIFORM | USAGE_COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, uniform);
    return this.track(buffer);
  }

  writeUniform(target: GPUBuffer, uniform: ArrayBuffer): void {
    this.device.queue.writeBuffer(target, 0, uniform);
  }

  async readbackFloats(source: GPUBuffer, floatCount: number): Promise<Float32Array> {
    const byteLength = Math.max(4, floatCount * 4);
    const staging = this.device.createBuffer({
      label: "studio-pathtrace-readback",
      size: byteLength,
      usage: USAGE_MAP_READ | USAGE_COPY_DST,
    });
    try {
      const encoder = this.device.createCommandEncoder({ label: "studio-pathtrace-readback" });
      encoder.copyBufferToBuffer(source, 0, staging, 0, byteLength);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(MAP_MODE_READ);
      const copy = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      return copy.subarray(0, floatCount);
    } finally {
      try {
        staging.destroy();
      } catch {
        // 이미 파기된 경우 무시.
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.buffers) {
      try {
        buffer.destroy();
      } catch {
        // 무시.
      }
    }
    this.buffers.clear();
    this.modules.clear();
    this.pipelines.clear();
    safeDestroyDevice(this.device);
  }
}

let sharedRuntime: StudioPathtraceGpuRuntimeImpl | null = null;
let sharedAcquisition: Promise<StudioPathtraceGpuRuntime | null> | null = null;
let lifecycleGeneration = 0;

async function createRuntime(
  gpu: GPU | null,
  generation: number,
): Promise<StudioPathtraceGpuRuntimeImpl | null> {
  if (!supportsStudioPathtraceGpu(gpu)) return null;
  try {
    const adapter = await (gpu as GPU).requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (generation !== lifecycleGeneration) {
      // 획득 도중 dispose 됨 — 새 디바이스를 조용히 정리하고 실패로 처리한다.
      safeDestroyDevice(device);
      return null;
    }
    const runtime = new StudioPathtraceGpuRuntimeImpl(device);
    void device.lost.then(() => {
      runtime.markLost();
      if (sharedRuntime === runtime) {
        sharedRuntime = null;
        sharedAcquisition = null;
      }
    });
    return runtime;
  } catch {
    return null;
  }
}

/**
 * 공유 패스트레이스 런타임 획득 — 미지원/실패/획득 중 dispose 는 전부 null.
 * `options.gpu` 가 지정되면 싱글턴을 우회해 독립 런타임을 만든다(호출부가 dispose 책임).
 */
export function acquireStudioPathtraceGpuRuntime(
  options?: StudioPathtraceGpuRuntimeOptions,
): Promise<StudioPathtraceGpuRuntime | null> {
  if (options && "gpu" in options) {
    return createRuntime(options.gpu ?? null, lifecycleGeneration);
  }
  if (sharedRuntime && !sharedRuntime.lost) return Promise.resolve(sharedRuntime);
  if (sharedAcquisition) return sharedAcquisition;
  const generation = lifecycleGeneration;
  sharedAcquisition = createRuntime(defaultGpu(), generation).then((runtime) => {
    if (generation !== lifecycleGeneration) {
      runtime?.dispose();
      return null;
    }
    if (runtime) {
      sharedRuntime = runtime;
    } else {
      // 실패는 캐시하지 않는다 — 다음 acquire 가 새로 시도할 수 있게 비운다.
      sharedAcquisition = null;
    }
    return runtime;
  });
  return sharedAcquisition;
}

/** 공유 런타임/디바이스를 파기하고 다음 acquire 가 처음부터 다시 시도하게 한다. */
export function disposeStudioPathtraceGpuRuntime(): void {
  lifecycleGeneration += 1;
  sharedRuntime?.dispose();
  sharedRuntime = null;
  sharedAcquisition = null;
}
