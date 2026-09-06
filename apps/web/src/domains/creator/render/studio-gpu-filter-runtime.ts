/**
 * Studio GPU Filter Runtime (엔진 로드맵 M1)
 * 이미지 보정 컴퓨트 커널 전용 경량 WebGPU 디바이스 매니저.
 *
 * studio-webgpu-engine(잉크 엔진)의 디바이스 수명 규율을 그대로 따르되 완전히 독립이다:
 *  - 기능 감지 실패/어댑터 없음/획득 예외 → null (선택한 WebGPU provider 사용 불가)
 *  - device lost → 런타임을 lost 로 표시하고 공유 싱글턴을 비운다(진행 중 호출은 실패 →
 *    마지막 정상 화면 유지; 다른 provider는 같은 작업에서 시작하지 않음)
 *  - dispose 는 세대(generation) 카운터로 in-flight 획득과 경합해도 안전하다
 *
 * 픽셀은 rgba8 을 u32 로 패킹한 storage buffer 로 오르내린다 — 텍스처 row-padding(256B
 * 정렬)이 없고, LUT 커널이 순수 정수 조회로 CPU 와 비트 동일해지는 결정성 우선 선택이다.
 * 컴퓨트 파이프라인은 shaderId 로 캐시한다(레벨/커브가 lut3 셰이더 하나를 공유).
 *
 * 이 모듈은 node 테스트에서도 import 되므로 GPUBufferUsage/GPUMapMode 전역 대신
 * WebGPU 명세의 고정 상수 값을 쓴다.
 */

// WebGPU 명세 고정 상수(GPUBufferUsage/GPUMapMode) — node 환경에는 전역이 없다.
const USAGE_MAP_READ = 0x0001;
const USAGE_COPY_SRC = 0x0004;
const USAGE_COPY_DST = 0x0008;
const USAGE_UNIFORM = 0x0040;
const USAGE_STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;
// Keep the hot interactive path allocation-free without letting a sequence of differently sized
// documents retain unbounded GPU memory. A 4 MP page needs three 16 MiB buffers (ping, pong,
// readback), so 96 MiB preserves the common full-page working set while larger documents simply
// fall back to transient buffers.
const STUDIO_GPU_FILTER_BUFFER_POOL_MAX_BYTES = 96 * 1024 * 1024;
const STUDIO_GPU_FILTER_BUFFER_POOL_MAX_ENTRIES = 6;

export interface StudioGpuFilterShaderSource {
  /** 파이프라인 캐시 키 — 같은 id 는 셰이더 모듈/파이프라인을 재사용한다. */
  readonly shaderId: string;
  readonly wgsl: string;
  readonly entryPoint: string;
}

export interface StudioGpuFilterRuntime {
  readonly device: GPUDevice;
  /** true 면 선택한 WebGPU provider를 다시 쓸 수 없고 해당 작업은 unavailable이다. */
  readonly lost: boolean;
  getComputePipeline(shader: StudioGpuFilterShaderSource): GPUComputePipeline;
  /** ping-pong 픽셀 버퍼(STORAGE|COPY_SRC|COPY_DST) lease. */
  acquirePixelBuffer(byteLength: number, label?: string): GPUBuffer;
  /** A lease must be returned only after all submitted work that references it has completed. */
  releasePixelBuffer(buffer: GPUBuffer, byteLength: number): void;
  createUniformBuffer(uniform: ArrayBuffer, label?: string): GPUBuffer;
  createLutBuffer(lut: Uint32Array, label?: string): GPUBuffer;
  uploadPixels(target: GPUBuffer, pixels: Uint8ClampedArray): void;
  /** 스테이징 MAP_READ 버퍼로 복사 → mapAsync → 새 Uint8ClampedArray 로 반환. */
  readbackPixels(source: GPUBuffer, byteLength: number): Promise<Uint8ClampedArray>;
  dispose(): void;
}

export interface StudioGpuFilterRuntimeOptions {
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
export function supportsStudioGpuFilters(gpu: GPU | null = defaultGpu()): boolean {
  return !!gpu && typeof gpu.requestAdapter === "function";
}

function safeDestroyDevice(device: GPUDevice | null): void {
  try {
    device?.destroy();
  } catch {
    // destroy 는 이미 lost 된 디바이스에서 던질 수 있다 — 폐기 경로에서는 무시.
  }
}

function safeDestroyBuffer(buffer: GPUBuffer | null): void {
  try {
    buffer?.destroy();
  } catch {
    // 이미 파기됐거나 lost 된 디바이스의 버퍼 — 폐기 경로에서는 무시.
  }
}

interface PooledGpuBuffer {
  readonly buffer: GPUBuffer;
  readonly byteLength: number;
  readonly kind: "pixel" | "readback";
  lastUsed: number;
}

class StudioGpuFilterRuntimeImpl implements StudioGpuFilterRuntime {
  readonly device: GPUDevice;
  lost = false;
  private readonly modules = new Map<string, GPUShaderModule>();
  private readonly pipelines = new Map<string, GPUComputePipeline>();
  private readonly pooledBuffers: PooledGpuBuffer[] = [];
  private pooledBufferBytes = 0;
  private poolClock = 0;
  private disposed = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  markLost(): void {
    this.lost = true;
    this.modules.clear();
    this.pipelines.clear();
    this.destroyPooledBuffers();
  }

  getComputePipeline(shader: StudioGpuFilterShaderSource): GPUComputePipeline {
    const cached = this.pipelines.get(shader.shaderId);
    if (cached) return cached;
    let module = this.modules.get(shader.shaderId);
    if (!module) {
      module = this.device.createShaderModule({
        label: shader.shaderId,
        code: shader.wgsl,
      });
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

  private takePooledBuffer(
    kind: PooledGpuBuffer["kind"],
    byteLength: number,
  ): GPUBuffer | null {
    const index = this.pooledBuffers.findIndex(
      (entry) => entry.kind === kind && entry.byteLength === byteLength,
    );
    if (index < 0) return null;
    const [entry] = this.pooledBuffers.splice(index, 1);
    if (!entry) return null;
    this.pooledBufferBytes -= entry.byteLength;
    return entry.buffer;
  }

  private returnPooledBuffer(
    kind: PooledGpuBuffer["kind"],
    buffer: GPUBuffer,
    byteLength: number,
  ): void {
    if (
      this.disposed
      || this.lost
      || byteLength <= 0
      || byteLength > STUDIO_GPU_FILTER_BUFFER_POOL_MAX_BYTES
    ) {
      safeDestroyBuffer(buffer);
      return;
    }

    while (
      this.pooledBuffers.length >= STUDIO_GPU_FILTER_BUFFER_POOL_MAX_ENTRIES
      || this.pooledBufferBytes + byteLength > STUDIO_GPU_FILTER_BUFFER_POOL_MAX_BYTES
    ) {
      let oldestIndex = 0;
      for (let index = 1; index < this.pooledBuffers.length; index += 1) {
        if (this.pooledBuffers[index]!.lastUsed < this.pooledBuffers[oldestIndex]!.lastUsed) {
          oldestIndex = index;
        }
      }
      const [evicted] = this.pooledBuffers.splice(oldestIndex, 1);
      if (!evicted) break;
      this.pooledBufferBytes -= evicted.byteLength;
      safeDestroyBuffer(evicted.buffer);
    }

    if (this.pooledBufferBytes + byteLength > STUDIO_GPU_FILTER_BUFFER_POOL_MAX_BYTES) {
      safeDestroyBuffer(buffer);
      return;
    }
    this.pooledBuffers.push({
      buffer,
      byteLength,
      kind,
      lastUsed: ++this.poolClock,
    });
    this.pooledBufferBytes += byteLength;
  }

  private destroyPooledBuffers(): void {
    for (const entry of this.pooledBuffers.splice(0)) {
      safeDestroyBuffer(entry.buffer);
    }
    this.pooledBufferBytes = 0;
  }

  acquirePixelBuffer(byteLength: number, label?: string): GPUBuffer {
    const pooled = this.takePooledBuffer("pixel", byteLength);
    if (pooled) return pooled;
    return this.device.createBuffer({
      label,
      size: byteLength,
      usage: USAGE_STORAGE | USAGE_COPY_SRC | USAGE_COPY_DST,
    });
  }

  releasePixelBuffer(buffer: GPUBuffer, byteLength: number): void {
    this.returnPooledBuffer("pixel", buffer, byteLength);
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

  createLutBuffer(lut: Uint32Array, label?: string): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: lut.byteLength,
      usage: USAGE_STORAGE | USAGE_COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, lut);
    return buffer;
  }

  uploadPixels(target: GPUBuffer, pixels: Uint8ClampedArray): void {
    // ArrayBufferView 오버로드의 dataOffset/size 는 요소 단위 — Uint8ClampedArray 요소=바이트.
    this.device.queue.writeBuffer(target, 0, pixels, 0, pixels.byteLength);
  }

  async readbackPixels(source: GPUBuffer, byteLength: number): Promise<Uint8ClampedArray> {
    const staging = this.takePooledBuffer("readback", byteLength) ?? this.device.createBuffer({
      label: "studio-gpu-filter/readback",
      size: byteLength,
      usage: USAGE_MAP_READ | USAGE_COPY_DST,
    });
    let reusable = false;
    try {
      const encoder = this.device.createCommandEncoder({ label: "studio-gpu-filter/readback" });
      encoder.copyBufferToBuffer(source, 0, staging, 0, byteLength);
      this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(MAP_MODE_READ);
      const bytes = new Uint8ClampedArray(staging.getMappedRange().slice(0));
      staging.unmap();
      reusable = true;
      return bytes;
    } finally {
      if (reusable) this.returnPooledBuffer("readback", staging, byteLength);
      else safeDestroyBuffer(staging);
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
// 공유 싱글턴 수명주기 — 60fps 프리뷰가 매 프레임 acquire 해도 디바이스는 하나만 유지된다.
// ---------------------------------------------------------------------------

let sharedRuntime: StudioGpuFilterRuntimeImpl | null = null;
let sharedAcquisition: Promise<StudioGpuFilterRuntime | null> | null = null;
let lifecycleGeneration = 0;

async function createRuntime(gpu: GPU | null, generation: number): Promise<StudioGpuFilterRuntimeImpl | null> {
  if (!supportsStudioGpuFilters(gpu)) return null;
  try {
    const adapter = await gpu!.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (generation !== lifecycleGeneration) {
      // 획득 도중 dispose 됨 — 새 디바이스를 조용히 정리하고 실패로 처리한다.
      safeDestroyDevice(device);
      return null;
    }
    const runtime = new StudioGpuFilterRuntimeImpl(device);
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
 * 공유 필터 런타임 획득 — 미지원/실패/획득 중 dispose 는 전부 null(fail-closed).
 * options.gpu 가 지정되면 싱글턴을 우회해 독립 런타임을 만든다(호출부가 dispose 책임).
 */
export function acquireStudioGpuFilterRuntime(
  options?: StudioGpuFilterRuntimeOptions,
): Promise<StudioGpuFilterRuntime | null> {
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
export function disposeStudioGpuFilterRuntime(): void {
  lifecycleGeneration += 1;
  sharedRuntime?.dispose();
  sharedRuntime = null;
  sharedAcquisition = null;
}
