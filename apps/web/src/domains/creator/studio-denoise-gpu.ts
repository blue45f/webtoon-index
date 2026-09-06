/**
 * Studio Denoise — à-trous 레벨 루프의 WebGPU 컴퓨트 포트 (고속 경로)
 *
 * 전처리(정규화·디모듈레이션·파이어플라이·분산 추정)와 후처리(역도메인·리모듈레이션)는
 * studio-denoise-atrous 의 CPU 코드를 그대로 공유하고, **레벨 루프만** GPU 로 옮긴다.
 * 무거운 건 O(levels × 25탭 × 픽셀) 인 그 루프뿐이고, 전/후처리는 픽셀당 상수 시간이라
 * 이 분할이 코드 중복 없이 최대 이득을 준다(그리고 두 백엔드의 결과가 같은 수식에서 나온다).
 *
 * 디바이스 수명 규율은 studio-gpu-filter-runtime 과 같은 원칙을 따르되 완전히 독립이다:
 *  - 기능 감지 실패 / 어댑터 없음 / 획득 예외 → null (선택한 GPU 경로 unavailable)
 *  - device lost → 런타임을 lost 로 표시(진행 중 호출은 마지막 정상 프레임을 유지)
 *  - `gpu` 를 주입하면 공유 싱글턴을 우회한다 → 테스트가 가짜 디바이스로 심(seam)을 검증
 *
 * 버퍼는 텍스처가 아니라 storage buffer 를 쓴다. HDR 은 f32 4채널이라 rgba8 텍스처로는
 * 담을 수 없고, storage buffer 는 256B row-padding 이 없어 CPU 배열과 바이트 동일하다.
 *
 * 이 모듈은 node 테스트에서도 import 되므로 GPUBufferUsage/GPUMapMode 전역 대신 WebGPU
 * 명세의 고정 상수 값을 쓴다.
 */

import {
  finishStudioDenoise,
  prepareStudioDenoiseFrame,
  studioDenoiseStepWidth,
  type StudioDenoisePreparedFrame,
} from "./studio-denoise-atrous";
import {
  STUDIO_DENOISE_VEC4_STRIDE,
  type StudioDenoiseFrame,
  type StudioDenoiseOptions,
  type StudioDenoiseResolvedOptions,
  type StudioDenoiseResult,
} from "./studio-denoise-contract";

// WebGPU 명세 고정 상수(GPUBufferUsage/GPUMapMode) — node 환경에는 전역이 없다.
const USAGE_MAP_READ = 0x0001;
const USAGE_COPY_SRC = 0x0004;
const USAGE_COPY_DST = 0x0008;
const USAGE_UNIFORM = 0x0040;
const USAGE_STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;

/** 컴퓨트 워크그룹 타일 크기 (WGSL @workgroup_size 와 반드시 일치). */
export const STUDIO_DENOISE_WORKGROUP_SIZE = 8;

/** AtrousParams uniform 의 바이트 길이 (WGSL std140 정렬 기준 3 × vec4). */
export const STUDIO_DENOISE_ATROUS_UNIFORM_BYTES = 48;

/** uniform 필드 바이트 오프셋 — 셰이더 struct 와 테스트가 공유하는 단일 진실. */
export const STUDIO_DENOISE_ATROUS_UNIFORM_OFFSETS = {
  width: 0,
  height: 4,
  stepWidth: 8,
  useLuminanceWeight: 12,
  sigmaLuma: 16,
  sigmaNormal: 20,
  sigmaDepth: 24,
  sigmaAlbedo: 28,
  epsLuma: 32,
  depthEpsilon: 36,
} as const;

/**
 * 한 레벨의 à-trous 컴퓨트 커널.
 * 가중치 수식은 studio-denoise-atrous.ts 의 `runStudioDenoiseAtrousLevel` 과 1:1 이다.
 */
export const STUDIO_DENOISE_ATROUS_WGSL = /* wgsl */ `
struct AtrousParams {
  width: u32,
  height: u32,
  stepWidth: u32,
  useLuminanceWeight: u32,
  sigmaLuma: f32,
  sigmaNormal: f32,
  sigmaDepth: f32,
  sigmaAlbedo: f32,
  epsLuma: f32,
  depthEpsilon: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> params: AtrousParams;
// signal: vec4(신호 RGB, 가이드 분산)
@group(0) @binding(1) var<storage, read> srcSignal: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> dstSignal: array<vec4<f32>>;
// guideA: vec4(노멀 XYZ, 깊이).  깊이 <= 0 이면 배경/미스.
@group(0) @binding(3) var<storage, read> guideA: array<vec4<f32>>;
// guideB: vec4(알베도 RGB, |grad z|)
@group(0) @binding(4) var<storage, read> guideB: array<vec4<f32>>;

const KERNEL = array<f32, 5>(0.0625, 0.25, 0.375, 0.25, 0.0625);

fn luminance(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(${String(STUDIO_DENOISE_WORKGROUP_SIZE)}, ${String(
  STUDIO_DENOISE_WORKGROUP_SIZE,
)}, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) {
    return;
  }
  let p = gid.y * params.width + gid.x;
  let center = srcSignal[p];
  let ga = guideA[p];
  let zp = ga.w;
  if (zp <= 0.0) {
    dstSignal[p] = center;
    return;
  }

  let gb = guideB[p];
  let np = ga.xyz;
  let gradP = gb.w;
  let ap = gb.xyz;
  let lp = luminance(center.xyz);
  let varP = max(center.w, 0.0);
  let lumaDenom = max(params.sigmaLuma * sqrt(varP) + params.epsLuma, 1e-12);

  var sumColor = vec3<f32>(0.0, 0.0, 0.0);
  var sumVar = 0.0;
  var weightSum = 0.0;
  let step = i32(params.stepWidth);
  let w = i32(params.width);
  let h = i32(params.height);
  let x = i32(gid.x);
  let y = i32(gid.y);

  for (var ky = 0; ky < 5; ky = ky + 1) {
    let dy = (ky - 2) * step;
    let yy = y + dy;
    if (yy < 0 || yy >= h) { continue; }
    for (var kx = 0; kx < 5; kx = kx + 1) {
      let dx = (kx - 2) * step;
      let xx = x + dx;
      if (xx < 0 || xx >= w) { continue; }
      let q = u32(yy * w + xx);
      let qa = guideA[q];
      let zq = qa.w;
      if (zq <= 0.0) { continue; }

      let hk = KERNEL[kx] * KERNEL[ky];
      let wn = pow(max(dot(np, qa.xyz), 0.0), params.sigmaNormal);
      if (wn <= 0.0) { continue; }

      let dist = sqrt(f32(dx * dx + dy * dy));
      let denomZ = params.sigmaDepth * gradP * dist + params.depthEpsilon * max(zp, 1.0);
      let wz = exp(-abs(zp - zq) / max(denomZ, 1e-8));

      let qb = guideB[q];
      let da = abs(ap.x - qb.x) + abs(ap.y - qb.y) + abs(ap.z - qb.z);
      let wa = exp(-da / params.sigmaAlbedo);

      let qs = srcSignal[q];
      var wl = 1.0;
      if (params.useLuminanceWeight != 0u) {
        wl = exp(-abs(lp - luminance(qs.xyz)) / lumaDenom);
      }

      let weight = hk * wn * wz * wa * wl;
      if (weight <= 0.0) { continue; }
      sumColor = sumColor + weight * qs.xyz;
      sumVar = sumVar + weight * weight * max(qs.w, 0.0);
      weightSum = weightSum + weight;
    }
  }

  if (weightSum > 0.0) {
    dstSignal[p] = vec4<f32>(sumColor / weightSum, sumVar / (weightSum * weightSum));
  } else {
    dstSignal[p] = center;
  }
}
`;

/** uniform 버퍼 바이트 패킹. WGSL struct 레이아웃과 오프셋이 정확히 일치해야 한다. */
export function packStudioDenoiseAtrousUniform(
  width: number,
  height: number,
  stepWidth: number,
  options: StudioDenoiseResolvedOptions,
): ArrayBuffer {
  const buffer = new ArrayBuffer(STUDIO_DENOISE_ATROUS_UNIFORM_BYTES);
  const view = new DataView(buffer);
  const o = STUDIO_DENOISE_ATROUS_UNIFORM_OFFSETS;
  view.setUint32(o.width, width >>> 0, true);
  view.setUint32(o.height, height >>> 0, true);
  view.setUint32(o.stepWidth, stepWidth >>> 0, true);
  view.setUint32(o.useLuminanceWeight, options.useLuminanceWeight ? 1 : 0, true);
  view.setFloat32(o.sigmaLuma, options.sigmaLuma, true);
  view.setFloat32(o.sigmaNormal, options.sigmaNormal, true);
  view.setFloat32(o.sigmaDepth, options.sigmaDepth, true);
  view.setFloat32(o.sigmaAlbedo, options.sigmaAlbedo, true);
  view.setFloat32(o.epsLuma, options.epsLuma, true);
  view.setFloat32(o.depthEpsilon, options.depthEpsilon, true);
  return buffer;
}

/** 한 축의 워크그룹 디스패치 수. */
export function studioDenoiseWorkgroupCount(extent: number): number {
  return Math.ceil(Math.max(0, extent) / STUDIO_DENOISE_WORKGROUP_SIZE);
}

export interface StudioDenoiseGpuRuntime {
  readonly device: GPUDevice;
  /** true 면 선택한 GPU 경로를 다시 쓸 수 없고 해당 작업은 unavailable이다. */
  readonly lost: boolean;
  getAtrousPipeline(): GPUComputePipeline;
  createStorageBuffer(byteLength: number, label?: string): GPUBuffer;
  createUniformBuffer(data: ArrayBuffer, label?: string): GPUBuffer;
  uploadFloats(target: GPUBuffer, data: Float32Array): void;
  readbackFloats(source: GPUBuffer, byteLength: number): Promise<Float32Array>;
  dispose(): void;
}

export interface StudioDenoiseGpuRuntimeOptions {
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

/** WebGPU 디노이즈 고속 경로 사용 가능 여부(디바이스 획득 없이 기능 감지만). */
export function supportsStudioDenoiseGpu(gpu: GPU | null = defaultGpu()): boolean {
  return !!gpu && typeof gpu.requestAdapter === "function";
}

function safeDestroyDevice(device: GPUDevice | null): void {
  try {
    device?.destroy();
  } catch {
    // 이미 lost 된 디바이스에서 destroy 는 던질 수 있다 — 폐기 경로에서는 무시.
  }
}

class StudioDenoiseGpuRuntimeImpl implements StudioDenoiseGpuRuntime {
  readonly device: GPUDevice;
  lost = false;
  private pipeline: GPUComputePipeline | null = null;
  private disposed = false;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  markLost(): void {
    this.lost = true;
    this.pipeline = null;
  }

  getAtrousPipeline(): GPUComputePipeline {
    if (this.lost || this.disposed) {
      throw new Error("studio-denoise: GPU 런타임이 이미 종료되었다");
    }
    if (!this.pipeline) {
      const module = this.device.createShaderModule({
        label: "studio-denoise-atrous",
        code: STUDIO_DENOISE_ATROUS_WGSL,
      });
      this.pipeline = this.device.createComputePipeline({
        label: "studio-denoise-atrous",
        layout: "auto",
        compute: { module, entryPoint: "main" },
      });
    }
    return this.pipeline;
  }

  createStorageBuffer(byteLength: number, label?: string): GPUBuffer {
    return this.device.createBuffer({
      label,
      size: Math.max(4, byteLength),
      usage: USAGE_STORAGE | USAGE_COPY_SRC | USAGE_COPY_DST,
    });
  }

  createUniformBuffer(data: ArrayBuffer, label?: string): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: data.byteLength,
      usage: USAGE_UNIFORM | USAGE_COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  uploadFloats(target: GPUBuffer, data: Float32Array): void {
    this.device.queue.writeBuffer(target, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  async readbackFloats(source: GPUBuffer, byteLength: number): Promise<Float32Array> {
    const staging = this.device.createBuffer({
      label: "studio-denoise-readback",
      size: byteLength,
      usage: USAGE_MAP_READ | USAGE_COPY_DST,
    });
    const encoder = this.device.createCommandEncoder({ label: "studio-denoise-readback" });
    encoder.copyBufferToBuffer(source, 0, staging, 0, byteLength);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(MAP_MODE_READ);
    const copy = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return copy;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pipeline = null;
    safeDestroyDevice(this.device);
  }
}

let sharedRuntime: StudioDenoiseGpuRuntimeImpl | null = null;
let sharedPending: Promise<StudioDenoiseGpuRuntimeImpl | null> | null = null;

async function acquireDevice(gpu: GPU): Promise<StudioDenoiseGpuRuntimeImpl | null> {
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (!device) return null;
    const runtime = new StudioDenoiseGpuRuntimeImpl(device);
    void device.lost
      ?.then(() => {
        runtime.markLost();
        if (sharedRuntime === runtime) sharedRuntime = null;
      })
      .catch(() => {
        runtime.markLost();
      });
    return runtime;
  } catch {
    // 어댑터/디바이스 획득은 정책·드라이버 이유로 던질 수 있다 → GPU unavailable.
    return null;
  }
}

/**
 * 디노이즈 전용 GPU 런타임 획득. 미지원/실패면 null(호출부는 CPU 경로).
 * `options.gpu` 를 주면 싱글턴을 우회한다.
 */
export async function acquireStudioDenoiseGpuRuntime(
  options?: StudioDenoiseGpuRuntimeOptions,
): Promise<StudioDenoiseGpuRuntime | null> {
  if (options && "gpu" in options) {
    const injected = options.gpu;
    if (!supportsStudioDenoiseGpu(injected ?? null)) return null;
    return acquireDevice(injected as GPU);
  }
  const gpu = defaultGpu();
  if (!supportsStudioDenoiseGpu(gpu)) return null;
  if (sharedRuntime && !sharedRuntime.lost) return sharedRuntime;
  sharedPending ??= acquireDevice(gpu as GPU).finally(() => {
    sharedPending = null;
  });
  const runtime = await sharedPending;
  if (runtime && !runtime.lost) sharedRuntime = runtime;
  return runtime;
}

/** 공유 싱글턴 폐기(테스트/언마운트). */
export function disposeSharedStudioDenoiseGpuRuntime(): void {
  sharedRuntime?.dispose();
  sharedRuntime = null;
}

/** GPU 에서 à-trous 레벨 루프만 실행한다. 최종 signal 버퍼를 CPU 배열로 돌려준다. */
export async function runStudioDenoiseAtrousGpu(
  runtime: StudioDenoiseGpuRuntime,
  prepared: StudioDenoisePreparedFrame,
): Promise<Float32Array> {
  const { sanitized, options } = prepared;
  const { width, height, pixelCount } = sanitized;
  if (pixelCount === 0 || options.levels === 0) return Float32Array.from(prepared.signal);

  const byteLength = pixelCount * STUDIO_DENOISE_VEC4_STRIDE * 4;
  const pipeline = runtime.getAtrousPipeline();
  const layout = pipeline.getBindGroupLayout(0);

  const bufferA = runtime.createStorageBuffer(byteLength, "studio-denoise-signal-a");
  const bufferB = runtime.createStorageBuffer(byteLength, "studio-denoise-signal-b");
  const guideABuffer = runtime.createStorageBuffer(byteLength, "studio-denoise-guide-a");
  const guideBBuffer = runtime.createStorageBuffer(byteLength, "studio-denoise-guide-b");
  runtime.uploadFloats(bufferA, prepared.signal);
  runtime.uploadFloats(guideABuffer, prepared.guideA);
  runtime.uploadFloats(guideBBuffer, prepared.guideB);

  const groupsX = studioDenoiseWorkgroupCount(width);
  const groupsY = studioDenoiseWorkgroupCount(height);
  const uniformBuffers: GPUBuffer[] = [];

  let src = bufferA;
  let dst = bufferB;
  const encoder = runtime.device.createCommandEncoder({ label: "studio-denoise-atrous" });
  for (let level = 0; level < options.levels; level += 1) {
    const uniform = runtime.createUniformBuffer(
      packStudioDenoiseAtrousUniform(width, height, studioDenoiseStepWidth(level), options),
      `studio-denoise-atrous-l${String(level)}`,
    );
    uniformBuffers.push(uniform);
    const bindGroup = runtime.device.createBindGroup({
      label: `studio-denoise-atrous-l${String(level)}`,
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: dst } },
        { binding: 3, resource: { buffer: guideABuffer } },
        { binding: 4, resource: { buffer: guideBBuffer } },
      ],
    });
    const pass = encoder.beginComputePass({ label: `studio-denoise-atrous-l${String(level)}` });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(groupsX, groupsY, 1);
    pass.end();
    const swap = src;
    src = dst;
    dst = swap;
  }
  runtime.device.queue.submit([encoder.finish()]);

  try {
    return await runtime.readbackFloats(src, byteLength);
  } finally {
    bufferA.destroy();
    bufferB.destroy();
    guideABuffer.destroy();
    guideBBuffer.destroy();
    for (const uniform of uniformBuffers) uniform.destroy();
  }
}

export interface StudioDenoiseGpuOptions extends StudioDenoiseGpuRuntimeOptions {
  readonly denoise?: StudioDenoiseOptions;
  /** 이미 획득한 런타임 재사용(프레임마다 디바이스 재획득 방지). */
  readonly runtime?: StudioDenoiseGpuRuntime | null;
}

/**
 * GPU 고속 경로로 한 프레임을 디노이즈한다.
 * 런타임을 얻을 수 없거나 실행 중 실패하면 **null** 을 반환한다. 이는 선택한 GPU 작업의
 * unavailable 영수증이며, 호출부는 마지막 정상 프레임을 유지해야 한다. CPU 참조 경로는
 * 다음 작업을 시작하기 전에 명시적으로 선택했을 때만 실행한다.
 */
export async function denoiseStudioFrameOnGpu(
  frame: StudioDenoiseFrame,
  options?: StudioDenoiseGpuOptions,
): Promise<StudioDenoiseResult | null> {
  const runtime =
    options?.runtime ??
    (await acquireStudioDenoiseGpuRuntime(options && "gpu" in options ? { gpu: options.gpu } : undefined));
  if (!runtime || runtime.lost) return null;

  const prepared = prepareStudioDenoiseFrame(frame, options?.denoise);
  try {
    const filtered = await runStudioDenoiseAtrousGpu(runtime, prepared);
    return finishStudioDenoise(prepared, filtered, "gpu");
  } catch {
    // 디바이스 lost·검증 오류 등 — 선택한 GPU 작업은 fail-closed로 끝난다.
    return null;
  }
}
