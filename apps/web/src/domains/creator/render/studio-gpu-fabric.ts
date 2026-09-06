/**
 * StudioGpuFabric — 단일 GPUDevice 소유권 브로커 (V12 §6 GpuInteropBroker의 TS측 실구현).
 *
 * V12 §6.1의 단일 디바이스 목표는 현행 vello 0.9/wgpu 29 상류 API만으로는 막혔지만,
 * `crates/vendor/wgpu-toon`의 최소 WebGPU handle-adoption 패치와 pkg-gpu의
 * `adoptGpuDevice`/raw `GPUTexture` 표면으로 해소했다. StudioVelloHub는 이 fabric의
 * GPUDevice를 참조 동일성까지 확인해 채택하고, same-device 텍스처를 L4 zero-copy로
 * 넘긴다. 미지원·검증 실패 island만 §6.3의 낮은 교환 레벨로 강등한다. 근거는
 * ADR-0011과 `tests/benchmarks/results/toon-vello-fork.json`에 고정돼 있다.
 *
 * 소유권·공유 계약:
 *  - 물리 GPUDevice는 이 fabric 하나가 소유한다. 소비자는 lease(참조 카운트)를 받아
 *    쓰고 release 한다. 마지막 lease 해제로 디바이스를 파기하지 않는다 — 60fps 프리뷰가
 *    매 프레임 acquire/release 해도 디바이스는 유지된다(기존 필터 런타임 싱글턴과 동일
 *    보존 정책). 파기는 명시적 disposeStudioGpuFabric() 또는 브라우저 device-loss 뿐이다.
 *  - studio-gpu-filter-runtime 과의 통합: 그 모듈의 공개 주입 표면
 *    `acquireStudioGpuFilterRuntime({ gpu })`을 통해 fabric 디바이스 위에 필터 런타임을
 *    올린다(acquireStudioGpuFilterRuntimeOnFabric). 런타임에는 destroy()가 lease 해제로
 *    치환된 파사드 디바이스를 건네므로, 런타임의 dispose 규율(디바이스 destroy)이
 *    공유 디바이스를 파괴하지 않는다. `studio-gpu-filter-apply`의 기본 제품 경로도 이
 *    fabric을 사용하며, 명시적 GPU override를 받은 하니스/embed만 독립 런타임을 소유한다.
 *  - device loss: 리스너 허브(onStudioGpuDeviceLost)가 epoch 단위로 1회 통지한다.
 *    명시적 dispose 는 loss 통지를 발생시키지 않는다(계획된 종료 ≠ 손실).
 *  - 기능 프로브(maxTextureDimension2D·timestamp-query 등)는 디바이스 생성 시 1회
 *    수집해 epoch 수명 동안 캐시한다 — 핫패스에서 재프로브 금지.
 */

import { acquireStudioGpuFilterRuntime } from "./studio-gpu-filter-runtime";

import type { StudioGpuFilterRuntime } from "./studio-gpu-filter-runtime";

export interface StudioGpuFabricCapabilities {
  /** 이 프로브가 수집된 디바이스 epoch — loss/재획득 시 증가한다. */
  readonly deviceEpoch: number;
  readonly maxTextureDimension2D: number;
  readonly maxBufferSize: number;
  readonly maxStorageBufferBindingSize: number;
  readonly maxComputeWorkgroupsPerDimension: number;
  readonly maxComputeInvocationsPerWorkgroup: number;
  /** features.has("timestamp-query") — GPU 패스 실측 타이밍 가능 여부. */
  readonly timestampQuery: boolean;
  /** 활성화된 GPUFeatureName 목록(열거 가능한 환경에서만, 아니면 빈 배열). */
  readonly features: readonly string[];
}

export interface StudioGpuDeviceLease {
  readonly device: GPUDevice;
  /** lease 가 속한 디바이스 epoch. */
  readonly epoch: number;
  /** true 면 이 디바이스는 손실됐고 선택한 작업은 마지막 정상 상태를 유지해야 한다. */
  readonly lost: boolean;
  /** release 후 true. release 는 멱등이다. */
  readonly released: boolean;
  release(): void;
}

export interface StudioGpuDeviceLossEvent {
  readonly epoch: number;
  readonly reason: string;
}

export type StudioGpuDeviceLossListener = (event: StudioGpuDeviceLossEvent) => void;

export interface StudioGpuFabricOptions {
  /**
   * 테스트/하니스 주입용 GPU. 필터 런타임의 오버라이드와 달리 싱글턴을 우회하지
   * 않는다 — 단일 소유권 자체가 계약이므로, 주입 GPU 는 "다음 디바이스 생성"에만
   * 쓰인다(이미 살아있는 디바이스가 있으면 그것을 공유). `null` 은 미지원 강제.
   */
  readonly gpu?: GPU | null;
}

function defaultGpu(): GPU | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as { gpu?: GPU }).gpu ?? null;
}

/** WebGPU 사용 가능 여부(디바이스 획득 없이 기능 감지만). */
export function supportsStudioGpuFabric(gpu: GPU | null = defaultGpu()): boolean {
  return !!gpu && typeof gpu.requestAdapter === "function";
}

function safeDestroyDevice(device: GPUDevice | null): void {
  try {
    device?.destroy();
  } catch {
    // destroy 는 이미 lost 된 디바이스에서 던질 수 있다 — 폐기 경로에서는 무시.
  }
}

function readLimit(limits: unknown, key: string): number {
  if (typeof limits !== "object" || limits === null) return 0;
  const value = (limits as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function probeCapabilities(device: GPUDevice, epoch: number): StudioGpuFabricCapabilities {
  const limits: unknown = (device as { limits?: unknown }).limits;
  const features = (device as { features?: { has?(name: string): boolean } }).features;
  const hasFeature = (name: string): boolean => {
    try {
      return typeof features?.has === "function" && features.has(name);
    } catch {
      return false;
    }
  };
  let featureNames: readonly string[] = [];
  try {
    if (features && typeof (features as Iterable<string>)[Symbol.iterator] === "function") {
      featureNames = [...(features as Iterable<string>)];
    }
  } catch {
    featureNames = [];
  }
  return Object.freeze({
    deviceEpoch: epoch,
    maxTextureDimension2D: readLimit(limits, "maxTextureDimension2D"),
    maxBufferSize: readLimit(limits, "maxBufferSize"),
    maxStorageBufferBindingSize: readLimit(limits, "maxStorageBufferBindingSize"),
    maxComputeWorkgroupsPerDimension: readLimit(limits, "maxComputeWorkgroupsPerDimension"),
    maxComputeInvocationsPerWorkgroup: readLimit(limits, "maxComputeInvocationsPerWorkgroup"),
    timestampQuery: hasFeature("timestamp-query"),
    features: featureNames,
  });
}

interface FabricState {
  readonly device: GPUDevice;
  readonly epoch: number;
  readonly capabilities: StudioGpuFabricCapabilities;
  lost: boolean;
  /** 명시적 dispose 로 종료됨 — 이후 device.lost 해소는 loss 통지를 내지 않는다. */
  disposedByFabric: boolean;
  activeLeases: number;
}

let fabricState: FabricState | null = null;
let fabricAcquisition: Promise<FabricState | null> | null = null;
let fabricGeneration = 0;
let epochCounter = 0;
const lossListeners = new Set<StudioGpuDeviceLossListener>();

function notifyLoss(event: StudioGpuDeviceLossEvent): void {
  for (const listener of lossListeners) {
    try {
      listener(event);
    } catch {
      // 리스너 격리 — 한 리스너의 예외가 다른 리스너/loss 처리를 막지 않는다.
    }
  }
}

async function createFabricState(
  gpu: GPU | null,
  generation: number,
): Promise<FabricState | null> {
  if (!supportsStudioGpuFabric(gpu)) return null;
  try {
    const adapter = await gpu!.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    if (generation !== fabricGeneration) {
      // 획득 도중 dispose 됨 — 새 디바이스를 조용히 정리하고 실패로 처리한다.
      safeDestroyDevice(device);
      return null;
    }
    epochCounter += 1;
    const state: FabricState = {
      device,
      epoch: epochCounter,
      capabilities: probeCapabilities(device, epochCounter),
      lost: false,
      disposedByFabric: false,
      activeLeases: 0,
    };
    void device.lost.then((info) => {
      state.lost = true;
      if (fabricState === state) {
        fabricState = null;
        fabricAcquisition = null;
      }
      if (!state.disposedByFabric) {
        notifyLoss({
          epoch: state.epoch,
          reason: typeof info?.reason === "string" ? info.reason : "unknown",
        });
      }
    });
    return state;
  } catch {
    return null;
  }
}

function mintLease(state: FabricState): StudioGpuDeviceLease {
  state.activeLeases += 1;
  let released = false;
  return {
    device: state.device,
    epoch: state.epoch,
    get lost() {
      return state.lost;
    },
    get released() {
      return released;
    },
    release() {
      if (released) return;
      released = true;
      state.activeLeases -= 1;
    },
  };
}

/**
 * 공유 GPUDevice lease 획득 — 미지원/실패/획득 중 dispose 는 전부 null(선택 경로 unavailable).
 * 살아있는 디바이스가 있으면 새 lease 로 공유하고, 없으면 한 번만 생성한다(동시 호출은
 * 같은 생성을 기다린다).
 */
export async function acquireStudioGpuDevice(
  options?: StudioGpuFabricOptions,
): Promise<StudioGpuDeviceLease | null> {
  if (fabricState && !fabricState.lost) return mintLease(fabricState);
  if (!fabricAcquisition) {
    const generation = fabricGeneration;
    const gpu = options && "gpu" in options ? options.gpu ?? null : defaultGpu();
    fabricAcquisition = createFabricState(gpu, generation).then((state) => {
      if (generation !== fabricGeneration) {
        if (state) safeDestroyDevice(state.device);
        return null;
      }
      if (state) {
        fabricState = state;
      } else {
        // 실패는 캐시하지 않는다 — 다음 acquire 가 새로 시도할 수 있게 비운다.
        fabricAcquisition = null;
      }
      return state;
    });
  }
  const state = await fabricAcquisition;
  if (!state || state.lost) return null;
  return mintLease(state);
}

/** 현재 epoch 의 활성 lease 수(디바이스 없음/손실 후에는 0) — 진단·테스트용. */
export function activeStudioGpuDeviceLeaseCount(): number {
  return fabricState?.activeLeases ?? 0;
}

/**
 * device-loss 리스너 허브 — 브라우저 loss 마다 epoch·reason 으로 1회 통지된다.
 * 반환값은 해제 함수. 명시적 disposeStudioGpuFabric() 은 통지하지 않는다.
 */
export function onStudioGpuDeviceLost(listener: StudioGpuDeviceLossListener): () => void {
  lossListeners.add(listener);
  return () => {
    lossListeners.delete(listener);
  };
}

/**
 * 기능 프로브 캐시 조회 — 살아있는 디바이스가 없으면 null. 같은 epoch 동안 항상 같은
 * 동결 객체를 돌려준다(재프로브 없음).
 */
export function getStudioGpuFabricCapabilities(): StudioGpuFabricCapabilities | null {
  if (!fabricState || fabricState.lost) return null;
  return fabricState.capabilities;
}

// ---------------------------------------------------------------------------
// studio-gpu-filter-runtime 배선 — fabric 디바이스 위의 필터 런타임(공유 계약 참조).
// ---------------------------------------------------------------------------

/**
 * lease 파사드: destroy() 만 lease 해제로 치환하고 나머지는 실제 디바이스로 위임한다.
 * 필터 런타임의 dispose 규율(markLost 후 device.destroy())이 공유 디바이스를 파괴하는
 * 대신 참조 카운트를 반납하게 만드는 최소 계약 지점이다.
 */
function createLeaseDeviceFacade(lease: StudioGpuDeviceLease): GPUDevice {
  return new Proxy(lease.device, {
    get(real, property) {
      if (property === "destroy") {
        return () => {
          lease.release();
        };
      }
      const value: unknown = Reflect.get(real, property, real);
      return typeof value === "function"
        ? (value as (...args: unknown[]) => unknown).bind(real)
        : value;
    },
  });
}

function gpuForFacade(device: GPUDevice): GPU {
  const bridge = {
    requestAdapter: async () => ({ requestDevice: async () => device }),
  };
  // 구조적 브리지 — 필터 런타임은 requestAdapter/requestDevice 만 사용한다.
  return bridge as unknown as GPU;
}

let fabricFilterRuntime: StudioGpuFilterRuntime | null = null;
let fabricFilterLease: StudioGpuDeviceLease | null = null;
let fabricFilterAcquisition: Promise<StudioGpuFilterRuntime | null> | null = null;

/**
 * fabric 디바이스 위에 올린 공유 필터 런타임 획득. 파이프라인/버퍼 풀 캐시를 가진
 * 런타임 싱글턴을 fabric 이 소유한다 — 반환된 런타임의 dispose() 는 lease 해제일 뿐
 * 공유 디바이스를 파괴하지 않으므로 호출해도 안전하지만, 통상 호출부는 그대로 쓰면 된다.
 * 실패/loss 시 null — 선택한 GPU 작업은 마지막 정상 화면을 유지하고 닫힌다. (기존
 * acquireStudioGpuFilterRuntime() 무옵션 경로와 공존한다 — 모듈 헤더의 공유 계약 참조.)
 */
export async function acquireStudioGpuFilterRuntimeOnFabric(
  options?: StudioGpuFabricOptions,
): Promise<StudioGpuFilterRuntime | null> {
  if (fabricFilterRuntime && !fabricFilterRuntime.lost) return fabricFilterRuntime;
  if (fabricFilterAcquisition) return fabricFilterAcquisition;
  const generation = fabricGeneration;
  fabricFilterAcquisition = (async () => {
    // 이전 런타임이 loss 로 죽었다면 잔여 lease 를 반납한다(멱등).
    fabricFilterLease?.release();
    fabricFilterRuntime = null;
    fabricFilterLease = null;
    const lease = await acquireStudioGpuDevice(options);
    if (!lease) return null;
    const runtime = await acquireStudioGpuFilterRuntime({
      gpu: gpuForFacade(createLeaseDeviceFacade(lease)),
    });
    if (!runtime || generation !== fabricGeneration) {
      runtime?.dispose();
      lease.release();
      return null;
    }
    fabricFilterRuntime = runtime;
    fabricFilterLease = lease;
    return runtime;
  })();
  const runtime = await fabricFilterAcquisition;
  fabricFilterAcquisition = null;
  return runtime;
}

/**
 * fabric 전체 파기 — 필터 런타임과 디바이스를 내리고 리스너 허브를 비운다. 다음
 * acquire 는 처음부터 다시 시도한다. loss 통지는 발생하지 않는다(계획된 종료).
 */
export function disposeStudioGpuFabric(): void {
  fabricGeneration += 1;
  const state = fabricState;
  if (state) state.disposedByFabric = true;
  // 런타임 dispose 는 파사드 destroy(=lease 해제)로 끝난다 — 실제 파기는 아래에서.
  fabricFilterRuntime?.dispose();
  fabricFilterLease?.release();
  fabricFilterRuntime = null;
  fabricFilterLease = null;
  fabricFilterAcquisition = null;
  fabricState = null;
  fabricAcquisition = null;
  lossListeners.clear();
  if (state) safeDestroyDevice(state.device);
}

export interface StudioGpuTextureRecord {
  readonly id: string;
  readonly texture: GPUTexture;
  readonly width: number;
  readonly height: number;
  readonly epoch: number;
  revision: number;
}

/**
 * TextureRegistry for the single-fabric FrameGraph. Providers look up handles
 * by id; GPUTexture objects never enter DocumentSceneIR.
 */
export class StudioGpuTextureRegistry {
  private readonly records = new Map<string, StudioGpuTextureRecord>();

  get(id: string): StudioGpuTextureRecord | null {
    return this.records.get(id) ?? null;
  }

  put(record: StudioGpuTextureRecord): void {
    const existing = this.records.get(record.id);
    if (existing && existing.texture !== record.texture) {
      try {
        existing.texture.destroy();
      } catch {
        // A lost-device texture may already be invalid.
      }
    }
    this.records.set(record.id, record);
  }

  evict(id: string): void {
    const existing = this.records.get(id);
    if (!existing) return;
    try {
      existing.texture.destroy();
    } catch {
      // Best-effort eviction.
    }
    this.records.delete(id);
  }

  dispose(): void {
    for (const id of [...this.records.keys()]) this.evict(id);
  }
}

export interface StudioGpuPass {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly reads: readonly string[];
  readonly writes: readonly string[];
  encode(context: { readonly device: GPUDevice; readonly epoch: number }): void | Promise<void>;
}

/**
 * Central submit epoch. Providers encode into this scheduler instead of
 * calling queue.submit() independently.
 */
export class StudioGpuSubmitScheduler {
  private readonly pending: GPUCommandBuffer[] = [];
  private epoch = 0;

  enqueue(buffer: GPUCommandBuffer): void {
    this.pending.push(buffer);
  }

  submit(device: GPUDevice): number {
    if (this.pending.length === 0) return this.epoch;
    device.queue.submit(this.pending.splice(0, this.pending.length));
    this.epoch += 1;
    return this.epoch;
  }

  get submitEpoch(): number {
    return this.epoch;
  }
}
