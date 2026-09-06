/**
 * Product-facing lifecycle controller for the sparse tiled-document WebGPU path.
 *
 * This is intentionally UI-agnostic. StudioPage only needs to feed resize/visibility/frame
 * requests and react to an explicit WebGPU-unavailable callback. Consumer and bridge construction,
 * requestAnimationFrame coalescing, device-loss recovery and teardown stay bounded here.
 */

import {
  StudioTileDocWebGpuBridge,
  type StudioTileDocWebGpuBridgeStats,
  type StudioTileDocWebGpuPresentResult,
} from "./studio-tiledoc-webgpu-bridge";
import {
  StudioTileDocWebGpuCompositeConsumer,
  type StudioTileDocWebGpuCompositeConsumerOptions,
  type StudioTileDocWebGpuCompositeConsumerStats,
  type StudioTileDocWebGpuValidationReadback,
} from "./studio-tiledoc-webgpu-composite-consumer";

import type { StudioTileDocCompositeLayer } from "./studio-tiledoc-composite-plan";
import type { StudioTileDocRect } from "./studio-tiledoc-geometry";
import type { StudioTiledDocumentStore } from "./studio-tiledoc-store";

export const STUDIO_TILEDOC_WEBGPU_RUNTIME_MAX_DPR = 8;
export const STUDIO_TILEDOC_WEBGPU_RUNTIME_MAX_BACKING_DIMENSION = 16_384;
export const STUDIO_TILEDOC_WEBGPU_RUNTIME_MAX_BACKING_PIXELS = 64 * 1_024 * 1_024;
export const STUDIO_TILEDOC_WEBGPU_RUNTIME_DEFAULT_DEVICE_RECOVERY_ATTEMPTS = 3;

export type StudioTileDocWebGpuRuntimeStatus =
  | "disposed"
  | "idle"
  | "paused"
  | "presenting"
  | "ready"
  | "recovering"
  | "scheduled"
  | "unavailable";

export interface StudioTileDocWebGpuRuntimeResize {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio?: number;
}

export type StudioTileDocWebGpuRuntimeResizeResult =
  | {
      readonly status: "resized";
      readonly cssWidth: number;
      readonly cssHeight: number;
      readonly devicePixelRatio: number;
      readonly backingWidth: number;
      readonly backingHeight: number;
    }
  | {
      readonly status: "rejected";
      readonly reason: "backing-size-limit" | "invalid-resize";
    };

export interface StudioTileDocWebGpuRuntimeFrameRequest {
  readonly frameId: string;
  readonly viewport: StudioTileDocRect;
  readonly layers: readonly StudioTileDocCompositeLayer[];
}

export interface StudioTileDocWebGpuUnavailable {
  readonly kind: "studio-tiledoc-webgpu-unavailable";
  readonly reason:
    | "device-recovery-exhausted"
    | "invalid-resize"
    | "presentation-rejected"
    | "runtime-error";
  readonly requestSequence: number;
  readonly frameId: string | null;
  readonly recoverable: boolean;
  readonly bridgeReason?: string;
  readonly consumerReason?: string;
}

export type StudioTileDocWebGpuRuntimeFrameResult =
  | {
      readonly status: "ready";
      readonly requestSequence: number;
      readonly frameId: string;
      readonly presentation: Extract<StudioTileDocWebGpuPresentResult, { status: "ready" }>;
    }
  | {
      readonly status: "unavailable";
      readonly requestSequence: number;
      readonly frameId: string;
      readonly failure: StudioTileDocWebGpuUnavailable;
    }
  | {
      readonly status: "rejected";
      readonly requestSequence: number;
      readonly frameId: string | null;
      readonly reason: "disposed" | "invalid-frame" | "revision-exhausted";
    }
  | {
      readonly status: "superseded";
      readonly requestSequence: number;
      readonly frameId: string;
    };

export interface StudioTileDocWebGpuRuntimeStats {
  readonly status: StudioTileDocWebGpuRuntimeStatus;
  readonly visible: boolean;
  readonly unavailableActive: boolean;
  readonly requestSequence: number;
  readonly pendingFrameId: string | null;
  readonly activeFrameId: string | null;
  readonly lastFrameId: string | null;
  readonly scheduledFrames: number;
  readonly presentedFrames: number;
  readonly coalescedFrames: number;
  readonly unavailableCount: number;
  readonly deviceLossCount: number;
  readonly recoveryAttempts: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly bridge: StudioTileDocWebGpuBridgeStats | null;
  readonly consumer: StudioTileDocWebGpuCompositeConsumerStats | null;
}

export interface StudioTileDocWebGpuRuntimeCallbacks {
  readonly onStatusChange?: (status: StudioTileDocWebGpuRuntimeStatus) => void;
  readonly onFrameReady?: (
    frameId: string,
    result: Extract<StudioTileDocWebGpuPresentResult, { status: "ready" }>
  ) => void;
  readonly onUnavailable?: (failure: StudioTileDocWebGpuUnavailable) => void;
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

interface RuntimeConsumer {
  readonly supportedBlendModes: readonly string[];
  present: StudioTileDocWebGpuCompositeConsumer["present"];
  stats(): StudioTileDocWebGpuCompositeConsumerStats;
  invalidate(): void;
  dispose(): void;
  readbackRetainedTileForValidation?(
    tileId: string
  ): Promise<StudioTileDocWebGpuValidationReadback | null>;
}

interface RuntimeBridge {
  present: StudioTileDocWebGpuBridge["present"];
  stats(): StudioTileDocWebGpuBridgeStats;
  invalidate(): void;
  dispose(): void;
}

export interface StudioTileDocWebGpuRuntimeFactoryContext {
  readonly canvas: HTMLCanvasElement;
  readonly gpu?: GPU | null;
  readonly onDeviceLost: (info: GPUDeviceLostInfo) => void;
  readonly consumerOptions?: Omit<
    StudioTileDocWebGpuCompositeConsumerOptions,
    "canvas" | "gpu" | "onDeviceLost"
  >;
}

export interface StudioTileDocWebGpuRuntimeOptions extends StudioTileDocWebGpuRuntimeCallbacks {
  readonly canvas: HTMLCanvasElement;
  readonly store: StudioTiledDocumentStore;
  readonly gpu?: GPU | null;
  readonly consumerOptions?: Omit<
    StudioTileDocWebGpuCompositeConsumerOptions,
    "canvas" | "gpu" | "onDeviceLost"
  >;
  readonly maxDeviceRecoveryAttempts?: number;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
  /** Test/host seam; production callers should use the defaults. */
  readonly createConsumer?: (context: StudioTileDocWebGpuRuntimeFactoryContext) => RuntimeConsumer;
  /** Test/host seam; production callers should use the defaults. */
  readonly createBridge?: (
    store: StudioTiledDocumentStore,
    consumer: RuntimeConsumer
  ) => RuntimeBridge;
}

interface QueuedFrame {
  readonly requestSequence: number;
  readonly request: StudioTileDocWebGpuRuntimeFrameRequest;
  readonly resolve: ((result: StudioTileDocWebGpuRuntimeFrameResult) => void) | null;
  settled: boolean;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteRect(rect: StudioTileDocRect): boolean {
  return typeof rect.x === "number"
    && Number.isFinite(rect.x)
    && typeof rect.y === "number"
    && Number.isFinite(rect.y)
    && typeof rect.width === "number"
    && Number.isFinite(rect.width)
    && rect.width >= 0
    && typeof rect.height === "number"
    && Number.isFinite(rect.height)
    && rect.height >= 0;
}

function validFrameId(frameId: unknown): frameId is string {
  return typeof frameId === "string" && frameId.length > 0 && frameId.length <= 1_024;
}

function cloneFrameRequest(
  request: StudioTileDocWebGpuRuntimeFrameRequest
): StudioTileDocWebGpuRuntimeFrameRequest | null {
  if (
    !request
    || typeof request !== "object"
    || !validFrameId(request.frameId)
    || !finiteRect(request.viewport)
    || !Array.isArray(request.layers)
  ) {
    return null;
  }
  const layers = request.layers.map((layer) => Object.freeze({
    id: layer.id,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
  }));
  return Object.freeze({
    frameId: request.frameId,
    viewport: Object.freeze({
      x: request.viewport.x,
      y: request.viewport.y,
      width: request.viewport.width,
      height: request.viewport.height,
    }),
    layers: Object.freeze(layers),
  });
}

function nextSequence(value: number): number | null {
  return value < Number.MAX_SAFE_INTEGER ? value + 1 : null;
}

function defaultRequestAnimationFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return globalThis.setTimeout(
    () => callback(performance.now()),
    16
  ) as unknown as number;
}

function defaultCancelAnimationFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else globalThis.clearTimeout(handle);
}

function positiveRecoveryAttempts(value: number | undefined): number {
  if (value === undefined) return STUDIO_TILEDOC_WEBGPU_RUNTIME_DEFAULT_DEVICE_RECOVERY_ATTEMPTS;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * Latest-frame controller. It retains at most one queued request and one active request.
 * Superseded queued promises are resolved immediately; no unbounded callback list accumulates.
 */
export class StudioTileDocWebGpuRuntime {
  private readonly canvas: HTMLCanvasElement;
  private readonly store: StudioTiledDocumentStore;
  private readonly gpuOverride: GPU | null | undefined;
  private readonly consumerOptions: StudioTileDocWebGpuRuntimeOptions["consumerOptions"];
  private readonly callbacks: StudioTileDocWebGpuRuntimeCallbacks;
  private readonly createConsumerOverride: StudioTileDocWebGpuRuntimeOptions["createConsumer"];
  private readonly createBridgeOverride: StudioTileDocWebGpuRuntimeOptions["createBridge"];
  private readonly requestAnimationFrameImpl: (callback: FrameRequestCallback) => number;
  private readonly cancelAnimationFrameImpl: (handle: number) => void;
  private readonly maxDeviceRecoveryAttempts: number;

  private consumer: RuntimeConsumer | null = null;
  private bridge: RuntimeBridge | null = null;
  private status: StudioTileDocWebGpuRuntimeStatus = "idle";
  private visible = true;
  private unavailableActive = false;
  private disposed = false;
  private requestSequence = 0;
  private pending: QueuedFrame | null = null;
  private active: QueuedFrame | null = null;
  private activeAbort: AbortController | null = null;
  private lastRequest: StudioTileDocWebGpuRuntimeFrameRequest | null = null;
  private lastFailure: StudioTileDocWebGpuUnavailable | null = null;
  private animationFrameHandle: number | null = null;
  private deviceLossEpoch = 0;
  private recoveryAttempts = 0;

  private scheduledFrames = 0;
  private presentedFrames = 0;
  private coalescedFrames = 0;
  private unavailableCount = 0;
  private deviceLossCount = 0;
  private cssWidth = 0;
  private cssHeight = 0;
  private devicePixelRatio = 1;

  public constructor(options: StudioTileDocWebGpuRuntimeOptions) {
    this.canvas = options.canvas;
    this.store = options.store;
    this.gpuOverride = options.gpu;
    this.consumerOptions = options.consumerOptions;
    this.callbacks = {
      onStatusChange: options.onStatusChange,
      onFrameReady: options.onFrameReady,
      onUnavailable: options.onUnavailable,
      onDeviceLost: options.onDeviceLost,
    };
    this.createConsumerOverride = options.createConsumer;
    this.createBridgeOverride = options.createBridge;
    this.requestAnimationFrameImpl =
      options.requestAnimationFrame ?? defaultRequestAnimationFrame;
    this.cancelAnimationFrameImpl =
      options.cancelAnimationFrame ?? defaultCancelAnimationFrame;
    this.maxDeviceRecoveryAttempts = positiveRecoveryAttempts(
      options.maxDeviceRecoveryAttempts
    );
    this.hideCanvas();
  }

  public stats(): StudioTileDocWebGpuRuntimeStats {
    return Object.freeze({
      status: this.status,
      visible: this.visible,
      unavailableActive: this.unavailableActive,
      requestSequence: this.requestSequence,
      pendingFrameId: this.pending?.request.frameId ?? null,
      activeFrameId: this.active?.request.frameId ?? null,
      lastFrameId: this.lastRequest?.frameId ?? null,
      scheduledFrames: this.scheduledFrames,
      presentedFrames: this.presentedFrames,
      coalescedFrames: this.coalescedFrames,
      unavailableCount: this.unavailableCount,
      deviceLossCount: this.deviceLossCount,
      recoveryAttempts: this.recoveryAttempts,
      cssWidth: this.cssWidth,
      cssHeight: this.cssHeight,
      devicePixelRatio: this.devicePixelRatio,
      backingWidth: this.canvas.width,
      backingHeight: this.canvas.height,
      bridge: this.bridge?.stats() ?? null,
      consumer: this.consumer?.stats() ?? null,
    });
  }

  /** Quality-lab only; never called by frame scheduling or product interaction paths. */
  public readbackRetainedTileForValidation(
    tileId: string
  ): Promise<StudioTileDocWebGpuValidationReadback | null> {
    if (this.disposed || this.active || this.pending || !this.consumer) {
      return Promise.resolve(null);
    }
    return this.consumer.readbackRetainedTileForValidation?.(tileId)
      ?? Promise.resolve(null);
  }

  public resize(input: StudioTileDocWebGpuRuntimeResize): StudioTileDocWebGpuRuntimeResizeResult {
    const dpr = input.devicePixelRatio ?? 1;
    if (
      !finitePositive(input.cssWidth)
      || !finitePositive(input.cssHeight)
      || !finitePositive(dpr)
      || dpr > STUDIO_TILEDOC_WEBGPU_RUNTIME_MAX_DPR
    ) {
      const failure = this.enterUnavailable("invalid-resize", null, "invalid-resize");
      this.failQueuedUnavailable(failure);
      return { status: "rejected", reason: "invalid-resize" };
    }
    const backingWidth = Math.max(1, Math.ceil(input.cssWidth * dpr));
    const backingHeight = Math.max(1, Math.ceil(input.cssHeight * dpr));
    if (
      backingWidth > STUDIO_TILEDOC_WEBGPU_RUNTIME_MAX_BACKING_DIMENSION
      || backingHeight > STUDIO_TILEDOC_WEBGPU_RUNTIME_MAX_BACKING_DIMENSION
      || backingWidth * backingHeight > STUDIO_TILEDOC_WEBGPU_RUNTIME_MAX_BACKING_PIXELS
    ) {
      const failure = this.enterUnavailable("invalid-resize", null, "backing-size-limit");
      this.failQueuedUnavailable(failure);
      return { status: "rejected", reason: "backing-size-limit" };
    }
    const changed = this.canvas.width !== backingWidth
      || this.canvas.height !== backingHeight
      || this.cssWidth !== input.cssWidth
      || this.cssHeight !== input.cssHeight
      || this.devicePixelRatio !== dpr;
    this.canvas.width = backingWidth;
    this.canvas.height = backingHeight;
    this.canvas.style.width = `${input.cssWidth}px`;
    this.canvas.style.height = `${input.cssHeight}px`;
    this.cssWidth = input.cssWidth;
    this.cssHeight = input.cssHeight;
    this.devicePixelRatio = dpr;
    if (changed && !this.unavailableActive && this.lastRequest && !this.pending) {
      this.enqueueInternal(this.lastRequest);
      if (this.visible) this.scheduleAnimationFrame();
    }
    return {
      status: "resized",
      cssWidth: input.cssWidth,
      cssHeight: input.cssHeight,
      devicePixelRatio: dpr,
      backingWidth,
      backingHeight,
    };
  }

  public requestFrame(
    request: StudioTileDocWebGpuRuntimeFrameRequest
  ): Promise<StudioTileDocWebGpuRuntimeFrameResult> {
    const cloned = cloneFrameRequest(request);
    if (this.disposed) {
      return Promise.resolve({
        status: "rejected",
        requestSequence: this.requestSequence,
        frameId: cloned?.frameId ?? null,
        reason: "disposed",
      });
    }
    const sequence = nextSequence(this.requestSequence);
    if (!cloned || sequence === null) {
      return Promise.resolve({
        status: "rejected",
        requestSequence: this.requestSequence,
        frameId: cloned?.frameId ?? null,
        reason: cloned ? "revision-exhausted" : "invalid-frame",
      });
    }
    this.requestSequence = sequence;
    this.lastRequest = cloned;
    this.scheduledFrames += 1;
    if (this.unavailableActive) {
      const previous = this.lastFailure;
      const failure = this.failureFor(
        previous?.reason ?? "presentation-rejected",
        sequence,
        cloned.frameId,
        previous?.recoverable ?? true,
        previous?.bridgeReason ?? "unavailable-active",
        previous?.consumerReason
      );
      this.callbacks.onUnavailable?.(failure);
      return Promise.resolve({
        status: "unavailable",
        requestSequence: sequence,
        frameId: cloned.frameId,
        failure,
      });
    }
    return new Promise((resolve) => {
      const queued: QueuedFrame = {
        requestSequence: sequence,
        request: cloned,
        resolve,
        settled: false,
      };
      this.replacePending(queued);
      this.scheduleAnimationFrame();
    });
  }

  public setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.cancelScheduledAnimationFrame();
      this.activeAbort?.abort(new DOMException("Studio tiledoc runtime paused", "AbortError"));
      this.hideCanvas();
      this.setStatus("paused");
      return;
    }
    if (this.unavailableActive) {
      this.setStatus("unavailable");
      return;
    }
    if (!this.pending && !this.active && this.lastRequest) {
      this.enqueueInternal(this.lastRequest);
    }
    this.scheduleAnimationFrame();
  }

  /** Explicitly retries the immutable WebGPU selection using the latest retained frame. */
  public retrySelectedWebGpu(): boolean {
    if (this.disposed || !this.unavailableActive || !this.lastRequest) return false;
    this.unavailableActive = false;
    this.lastFailure = null;
    this.recoveryAttempts = 0;
    this.consumer?.invalidate();
    this.bridge?.invalidate();
    this.enqueueInternal(this.lastRequest);
    if (this.visible) this.scheduleAnimationFrame();
    else this.setStatus("paused");
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelScheduledAnimationFrame();
    this.activeAbort?.abort(new DOMException("Studio tiledoc runtime disposed", "AbortError"));
    if (this.pending) {
      this.settle(this.pending, {
        status: "rejected",
        requestSequence: this.pending.requestSequence,
        frameId: this.pending.request.frameId,
        reason: "disposed",
      });
      this.pending = null;
    }
    if (this.active) {
      this.settle(this.active, {
        status: "rejected",
        requestSequence: this.active.requestSequence,
        frameId: this.active.request.frameId,
        reason: "disposed",
      });
    }
    this.bridge?.dispose();
    this.consumer?.dispose();
    this.bridge = null;
    this.consumer = null;
    this.hideCanvas();
    this.setStatus("disposed");
  }

  private ensureRuntime(): { consumer: RuntimeConsumer; bridge: RuntimeBridge } | null {
    if (this.disposed) return null;
    if (this.consumer && this.bridge) {
      return { consumer: this.consumer, bridge: this.bridge };
    }
    let createdConsumer: RuntimeConsumer | null = null;
    try {
      const context: StudioTileDocWebGpuRuntimeFactoryContext = {
        canvas: this.canvas,
        gpu: this.gpuOverride,
        onDeviceLost: (info) => this.handleDeviceLost(info),
        consumerOptions: this.consumerOptions,
      };
      const consumer = this.createConsumerOverride
        ? this.createConsumerOverride(context)
        : new StudioTileDocWebGpuCompositeConsumer({
            canvas: context.canvas,
            gpu: context.gpu,
            ...context.consumerOptions,
            onDeviceLost: context.onDeviceLost,
          });
      createdConsumer = consumer;
      const bridge = this.createBridgeOverride
        ? this.createBridgeOverride(this.store, consumer)
        : new StudioTileDocWebGpuBridge({ store: this.store, consumer });
      this.consumer = consumer;
      this.bridge = bridge;
      return { consumer, bridge };
    } catch {
      createdConsumer?.dispose();
      this.consumer = null;
      this.bridge = null;
      return null;
    }
  }

  private replacePending(next: QueuedFrame): void {
    if (this.pending) {
      this.coalescedFrames += 1;
      this.settle(this.pending, {
        status: "superseded",
        requestSequence: this.pending.requestSequence,
        frameId: this.pending.request.frameId,
      });
    }
    this.pending = next;
  }

  private enqueueInternal(request: StudioTileDocWebGpuRuntimeFrameRequest): void {
    if (this.disposed || this.pending) return;
    const sequence = nextSequence(this.requestSequence);
    if (sequence === null) return;
    this.requestSequence = sequence;
    this.scheduledFrames += 1;
    this.pending = {
      requestSequence: sequence,
      request,
      resolve: null,
      settled: false,
    };
  }

  private scheduleAnimationFrame(): void {
    if (
      this.disposed
      || !this.visible
      || this.unavailableActive
      || this.animationFrameHandle !== null
      || this.active
      || !this.pending
    ) {
      return;
    }
    this.setStatus("scheduled");
    this.animationFrameHandle = this.requestAnimationFrameImpl(() => {
      this.animationFrameHandle = null;
      void this.flushPending();
    });
  }

  private cancelScheduledAnimationFrame(): void {
    if (this.animationFrameHandle === null) return;
    this.cancelAnimationFrameImpl(this.animationFrameHandle);
    this.animationFrameHandle = null;
  }

  private async flushPending(): Promise<void> {
    if (
      this.disposed
      || !this.visible
      || this.unavailableActive
      || this.active
      || !this.pending
    ) {
      return;
    }
    const queued = this.pending;
    this.pending = null;
    this.active = queued;
    const controller = new AbortController();
    this.activeAbort = controller;
    const lossEpoch = this.deviceLossEpoch;
    this.setStatus("presenting");

    try {
      const runtime = this.ensureRuntime();
      if (!runtime) {
        const failure = this.enterUnavailable(
          "runtime-error",
          queued,
          "runtime-construction-failed"
        );
        this.settle(queued, {
          status: "unavailable",
          requestSequence: queued.requestSequence,
          frameId: queued.request.frameId,
          failure,
        });
        return;
      }
      const result = await runtime.bridge.present({
        viewport: queued.request.viewport,
        layers: queued.request.layers,
        signal: controller.signal,
      });
      if (this.disposed) return;
      if (controller.signal.aborted && !this.visible) {
        this.requeuePausedFrame(queued);
        return;
      }
      if (this.deviceLossEpoch !== lossEpoch && !this.unavailableActive) {
        this.requeueRecoveryFrame(queued);
        return;
      }
      if (this.unavailableActive && this.lastFailure) {
        this.settle(queued, {
          status: "unavailable",
          requestSequence: queued.requestSequence,
          frameId: queued.request.frameId,
          failure: this.lastFailure,
        });
        return;
      }
      if (result.status === "ready") {
        this.recoveryAttempts = 0;
        this.presentedFrames += 1;
        this.showCanvas();
        this.setStatus("ready");
        this.callbacks.onFrameReady?.(queued.request.frameId, result);
        this.settle(queued, {
          status: "ready",
          requestSequence: queued.requestSequence,
          frameId: queued.request.frameId,
          presentation: result,
        });
        return;
      }
      const failure = this.enterUnavailable(
        "presentation-rejected",
        queued,
        result.reason,
        result.consumerReason
      );
      this.settle(queued, {
        status: "unavailable",
        requestSequence: queued.requestSequence,
        frameId: queued.request.frameId,
        failure,
      });
    } catch {
      if (this.disposed) return;
      if (controller.signal.aborted && !this.visible) {
        this.requeuePausedFrame(queued);
        return;
      }
      if (this.unavailableActive && this.lastFailure) {
        this.settle(queued, {
          status: "unavailable",
          requestSequence: queued.requestSequence,
          frameId: queued.request.frameId,
          failure: this.lastFailure,
        });
        return;
      }
      const failure = this.enterUnavailable("runtime-error", queued, "runtime-exception");
      this.settle(queued, {
        status: "unavailable",
        requestSequence: queued.requestSequence,
        frameId: queued.request.frameId,
        failure,
      });
    } finally {
      if (this.active === queued) this.active = null;
      if (this.activeAbort === controller) this.activeAbort = null;
      if (!this.disposed && this.visible && !this.unavailableActive) {
        this.scheduleAnimationFrame();
      }
    }
  }

  private requeuePausedFrame(queued: QueuedFrame): void {
    if (this.pending) {
      this.settle(queued, {
        status: "superseded",
        requestSequence: queued.requestSequence,
        frameId: queued.request.frameId,
      });
      return;
    }
    this.pending = queued;
    this.setStatus("paused");
  }

  private requeueRecoveryFrame(queued: QueuedFrame): void {
    if (this.pending) {
      this.settle(queued, {
        status: "superseded",
        requestSequence: queued.requestSequence,
        frameId: queued.request.frameId,
      });
      return;
    }
    this.pending = queued;
    this.setStatus("recovering");
  }

  private handleDeviceLost(info: GPUDeviceLostInfo): void {
    if (this.disposed) return;
    this.deviceLossEpoch += 1;
    this.deviceLossCount += 1;
    this.recoveryAttempts += 1;
    this.consumer?.invalidate();
    this.bridge?.invalidate();
    this.hideCanvas();
    this.callbacks.onDeviceLost?.(info);
    if (this.recoveryAttempts > this.maxDeviceRecoveryAttempts) {
      const failure = this.enterUnavailable(
        "device-recovery-exhausted",
        this.active,
        "device-lost"
      );
      this.failQueuedUnavailable(failure);
      return;
    }
    this.setStatus("recovering");
    if (!this.active && !this.pending && this.lastRequest) {
      this.enqueueInternal(this.lastRequest);
      this.scheduleAnimationFrame();
    }
  }

  private enterUnavailable(
    reason: StudioTileDocWebGpuUnavailable["reason"],
    queued: QueuedFrame | null,
    bridgeReason?: string,
    consumerReason?: string
  ): StudioTileDocWebGpuUnavailable {
    const wasActive = this.unavailableActive;
    this.unavailableActive = true;
    this.hideCanvas();
    this.cancelScheduledAnimationFrame();
    this.setStatus("unavailable");
    if (!wasActive) this.unavailableCount += 1;
    const failure = this.failureFor(
      reason,
      queued?.requestSequence ?? this.requestSequence,
      queued?.request.frameId ?? this.lastRequest?.frameId ?? null,
      reason !== "device-recovery-exhausted",
      bridgeReason,
      consumerReason
    );
    this.lastFailure = failure;
    this.callbacks.onUnavailable?.(failure);
    return failure;
  }

  private failureFor(
    reason: StudioTileDocWebGpuUnavailable["reason"],
    requestSequence: number,
    frameId: string | null,
    recoverable: boolean,
    bridgeReason?: string,
    consumerReason?: string
  ): StudioTileDocWebGpuUnavailable {
    return Object.freeze({
      kind: "studio-tiledoc-webgpu-unavailable",
      reason,
      requestSequence,
      frameId,
      recoverable,
      bridgeReason,
      consumerReason,
    });
  }

  private settle(
    queued: QueuedFrame,
    result: StudioTileDocWebGpuRuntimeFrameResult
  ): void {
    if (queued.settled) return;
    queued.settled = true;
    queued.resolve?.(Object.freeze(result));
  }

  private failQueuedUnavailable(failure: StudioTileDocWebGpuUnavailable): void {
    this.activeAbort?.abort(new DOMException("Studio tiledoc WebGPU unavailable", "AbortError"));
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    this.settle(pending, {
      status: "unavailable",
      requestSequence: pending.requestSequence,
      frameId: pending.request.frameId,
      failure: this.failureFor(
        failure.reason,
        pending.requestSequence,
        pending.request.frameId,
        failure.recoverable,
        failure.bridgeReason,
        failure.consumerReason
      ),
    });
  }

  private setStatus(status: StudioTileDocWebGpuRuntimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private showCanvas(): void {
    this.canvas.style.visibility = "visible";
    this.canvas.style.opacity = "1";
  }

  private hideCanvas(): void {
    this.canvas.style.visibility = "hidden";
    this.canvas.style.opacity = "0";
  }
}
