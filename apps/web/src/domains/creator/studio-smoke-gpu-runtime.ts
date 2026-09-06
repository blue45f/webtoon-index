/**
 * Studio Smoke GPU Runtime — 연기 컴퓨트 전용 경량 WebGPU 디바이스 매니저
 *
 * studio-gpu-filter-runtime 의 수명 규율을 그대로 복제하되 완전히 독립이다:
 *  - 기능 감지 실패/어댑터 없음/획득 예외 → null (선택한 WebGPU 경로 unavailable)
 *  - device lost → 런타임을 lost 로 표시하고 공유 싱글턴을 비운다
 *  - dispose 는 세대(generation) 카운터로 in-flight 획득과 경합해도 안전
 *  - `options.gpu` 주입 시 싱글턴을 우회해 독립 런타임 생성(테스트 격리)
 *
 * 이 모듈은 node 테스트에서도 import 되므로 `GPUBufferUsage`/`GPUMapMode` 전역 대신
 * WebGPU 명세의 고정 상수 값을 직접 쓴다(node 에는 그 전역이 없다).
 *
 * **정직한 한계**: 이 파일이 하는 일은 디바이스/버퍼/파이프라인 수명 관리와 디스패치
 * 인코딩까지다. 셰이더가 수치적으로 CPU 와 맞는지는 여기서 검증되지 않으며, node 에는
 * WebGPU 가 없어 검증할 수도 없다(studio-smoke-wgsl 상단 참고).
 */

// WebGPU 명세 고정 상수(GPUBufferUsage/GPUMapMode) — node 환경에는 전역이 없다.
const USAGE_MAP_READ = 0x0001;
const USAGE_COPY_SRC = 0x0004;
const USAGE_COPY_DST = 0x0008;
const USAGE_UNIFORM = 0x0040;
const USAGE_STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;

export interface StudioSmokeGpuShaderSource {
  readonly shaderId: string;
  readonly wgsl: string;
  readonly entryPoint: string;
}

export interface StudioSmokeGpuRuntime {
  readonly device: GPUDevice;
  /** true 면 선택한 WebGPU 경로를 다시 쓸 수 없고 해당 작업은 unavailable이다. */
  readonly lost: boolean;
  getComputePipeline(shader: StudioSmokeGpuShaderSource): GPUComputePipeline;
  /** f32 필드용 storage buffer(STORAGE|COPY_SRC|COPY_DST). */
  createFieldBuffer(byteLength: number, label?: string): GPUBuffer;
  createUniformBuffer(uniform: ArrayBuffer, label?: string): GPUBuffer;
  writeUniform(target: GPUBuffer, uniform: ArrayBuffer): void;
  uploadField(target: GPUBuffer, data: Float32Array | Uint32Array): void;
  readField(source: GPUBuffer, byteLength: number): Promise<Float32Array>;
  dispose(): void;
}

export interface StudioSmokeGpuRuntimeOptions {
  /**
   * 테스트/하니스 주입용 GPU 오버라이드. 지정되면 공유 싱글턴을 우회해 매 호출 새로
   * 획득한다(테스트 간 상태 오염 방지). `null` 은 "미지원 환경" 강제.
   */
  readonly gpu?: GPU | null;
}

function defaultGpu(): GPU | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as { gpu?: GPU }).gpu ?? null;
}

/** WebGPU 사용 가능 여부(디바이스 획득 없이 기능 감지만). */
export function supportsStudioSmokeGpu(gpu: GPU | null = defaultGpu()): boolean {
  return !!gpu && typeof gpu.requestAdapter === "function";
}

function safeDestroyDevice(device: GPUDevice | null): void {
  try {
    device?.destroy();
  } catch {
    // 이미 lost 된 디바이스는 destroy 에서 던질 수 있다 — 폐기 경로에서는 무시.
  }
}

class StudioSmokeGpuRuntimeImpl implements StudioSmokeGpuRuntime {
  readonly device: GPUDevice;
  lost = false;
  private readonly modules = new Map<string, GPUShaderModule>();
  private readonly pipelines = new Map<string, GPUComputePipeline>();
  private disposed = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  markLost(): void {
    this.lost = true;
    this.modules.clear();
    this.pipelines.clear();
  }

  getComputePipeline(shader: StudioSmokeGpuShaderSource): GPUComputePipeline {
    const cached = this.pipelines.get(shader.shaderId);
    if (cached) return cached;
    let module = this.modules.get(shader.shaderId);
    if (!module) {
      module = this.device.createShaderModule({ label: shader.shaderId, code: shader.wgsl });
      this.modules.set(shader.shaderId, module);
    }
    const pipeline = this.device.createComputePipeline({
      label: shader.shaderId,
      layout: "auto",
      compute: { module, entryPoint: shader.entryPoint },
    });
    this.pipelines.set(shader.shaderId, pipeline);
    return pipeline;
  }

  createFieldBuffer(byteLength: number, label?: string): GPUBuffer {
    return this.device.createBuffer({
      label,
      size: byteLength,
      usage: USAGE_STORAGE | USAGE_COPY_SRC | USAGE_COPY_DST,
    });
  }

  createUniformBuffer(uniform: ArrayBuffer, label?: string): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: uniform.byteLength,
      usage: USAGE_UNIFORM | USAGE_COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, uniform);
    return buffer;
  }

  writeUniform(target: GPUBuffer, uniform: ArrayBuffer): void {
    this.device.queue.writeBuffer(target, 0, uniform);
  }

  uploadField(target: GPUBuffer, data: Float32Array | Uint32Array): void {
    this.device.queue.writeBuffer(target, 0, data, 0, data.length);
  }

  async readField(source: GPUBuffer, byteLength: number): Promise<Float32Array> {
    const staging = this.device.createBuffer({
      label: "studio-smoke/readback",
      size: byteLength,
      usage: USAGE_MAP_READ | USAGE_COPY_DST,
    });
    try {
      const encoder = this.device.createCommandEncoder({ label: "studio-smoke/readback" });
      encoder.copyBufferToBuffer(source, 0, staging, 0, byteLength);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(MAP_MODE_READ);
      const values = new Float32Array(staging.getMappedRange().slice(0));
      staging.unmap();
      return values;
    } finally {
      try {
        staging.destroy();
      } catch {
        // 폐기 경로 — lost 디바이스면 이미 해제됐다.
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.markLost();
    safeDestroyDevice(this.device);
  }
}

// ---------------------------------------------------------------------------
// 공유 싱글턴 수명주기
// ---------------------------------------------------------------------------

let sharedRuntime: StudioSmokeGpuRuntimeImpl | null = null;
let sharedAcquisition: Promise<StudioSmokeGpuRuntime | null> | null = null;
let lifecycleGeneration = 0;

async function createRuntime(gpu: GPU | null, generation: number): Promise<StudioSmokeGpuRuntimeImpl | null> {
  if (!supportsStudioSmokeGpu(gpu)) return null;
  try {
    const adapter = await gpu!.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (generation !== lifecycleGeneration) {
      // 획득 도중 dispose 됨 — 새 디바이스를 조용히 정리하고 실패로 처리한다.
      safeDestroyDevice(device);
      return null;
    }
    const runtime = new StudioSmokeGpuRuntimeImpl(device);
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

/** 공유 연기 GPU 런타임 획득 — 미지원/실패/획득 중 dispose 는 전부 null(fail-closed). */
export function acquireStudioSmokeGpuRuntime(
  options?: StudioSmokeGpuRuntimeOptions,
): Promise<StudioSmokeGpuRuntime | null> {
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
export function disposeStudioSmokeGpuRuntime(): void {
  lifecycleGeneration += 1;
  sharedRuntime?.dispose();
  sharedRuntime = null;
  sharedAcquisition = null;
}
